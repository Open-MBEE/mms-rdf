const factory = require('@graphy/core.data.factory');
const ttl_write = require('@graphy/content.ttl.write');
const rqr_term = factory.from.sparql_result;

const H_PRREFIXES = require('../../config.js').prefixes;
const Endpoint = require('../class/endpoint.js');
const MmsClient = require('../class/mms-client.js');
const Triplifier = require('../class/triplifier.js');
const AsyncLockPool = require('../class/async-lock-pool.js');

const Progress = require('progress');

const P_PREFIX_ELEMENT = H_PRREFIXES['mms-element'];

(async() => {
	// instantiate endpoint connection
	let k_endpoint = new Endpoint({
		url: process.env.SPARQL_ENDPOINT,
		prefixes: H_PRREFIXES,
	});

	// instantiate MMS client
	let k_mms_client = new MmsClient();

	// collect all elements that might be missing from the graph
	let k_response;
	let s_query = /* syntax: sparql */ `
		select distinct ?element {
			?source ?property ?element .

			?property a/rdfs:subClassOf* mms-ontology:ObjectProperty .

			filter(?element != rdf:nil)

			filter not exists {
				?element ?p ?o .
			}
		}
	`;

	// submit the query
	try {
		k_response = await k_endpoint.query(s_query);
	}
	catch(e_query) {
		// connection refused
		if(e_query.message.startsWith('connect ECONNREFUSED')) {
			throw new Error(`Unable to query endpoint ${process.env.SPARQL_ENDPOINT}; have you set up the proxy correctly?\n${e_query.stack}`);
		}

		// some other error
		throw new Error(`error: ${e_query.stack}\n from SPARQL query:\n${s_query}`);
	}

	// triplifier
	let k_triplifier = new Triplifier({
		endpoint: process.env.SPARQL_ENDPOINT,
		prefixes: H_PRREFIXES,
		output: process.stdout,
	});

	let a_rows = await k_response.rows();
	// debugger;

	let k_pool = new AsyncLockPool(64);

	// // each streaming query result
	// for await (let g_row of k_response) {

	// progress bar
	let y_bar = new Progress('[:bar] :percent :current/:total; +:elapseds; -:etas', {
		incomplete: ' ',
		complete: '∎', // 'Ξ',
		width: 40,
		total: a_rows.length,
	});

	// each streaming query result
	for(let g_row of a_rows) {
		// ref element uri
		let p_element = g_row.element.value;

		// mms-element prefix
		if(p_element.startsWith(P_PREFIX_ELEMENT)) {
			// extract element id
			let si_element = p_element.slice(P_PREFIX_ELEMENT.length);

			// acquire lock
			let f_release = await k_pool.acquire();

			// request this element from MMS
			k_mms_client.element(si_element).then(async(g_element) => {
				if(g_element) {
					try {
						await k_triplifier.convert_write(g_element);
					}
					catch(e_convert) {
						console.error(e_convert);
					}
				}

				f_release();

				y_bar.tick();
			}, (e_req) => {
				if(e_req.response) {
					// if(404 === e_req.response.statusCode) {
					// 	// ignore
					// 	return;
					// }
					// else if(410 === e_req.response.statusCode) {
					// 	console.error('retrying');

					// 	// try again to request this element from MMS
					// 	return k_mms_client.element(si_element).then(async(g_element) => {
					// 		if(g_element) {
					// 			try {
					// 				await k_triplifier.convert_write(g_element);
					// 			}
					// 			catch(e_convert) {
					// 				console.error(e_convert);
					// 			}
					// 		}
					// 	}, (e_req2) => {
					// 		console.error(e_req);
					// 	});
					// }

					console.error(e_req.request.url);
				}
				else if(e_req.message && e_req.message.startsWith('Empty JSON')) {
					console.error('retrying');

					// try again to request this element from MMS
					return k_mms_client.element(si_element).then(async(g_element) => {
						if(g_element) {
							try {
								await k_triplifier.convert_write(g_element);
							}
							catch(e_convert) {
								console.error(e_convert);
							}
							finally {
								f_release();

								y_bar.tick();
							}
						}
					}, (e_req2) => {
						console.error(e_req2);

						f_release();

						y_bar.tick();
					});
				}

				console.error(e_req);

				f_release();

				y_bar.tick();
			});

			// debugger;
			// dp_elmt.data().then(async(g_element) => {
				// await k_triplifier.convert_write(g_element, g_element);
			// }, () => {
			// 	console.warn(`nested element does not exist: ${si_element}`);
			// });
		}
	}

	// await triplifier flush
	await k_triplifier.flush();
})();
