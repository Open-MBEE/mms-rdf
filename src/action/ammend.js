const factory = require('@graphy/core.data.factory');
const ttl_write = require('@graphy/content.ttl.write');
const rqr_term = factory.from.sparql_result;

const H_PRREFIXES = require('../../config.js').prefixes;
const Endpoint = require('../class/endpoint.js');
const MmsClient = require('../class/mms-client.js');
const Triplifier = require('../class/triplifier.js');

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

	// each streaming query result
	for await (let g_row of k_response) {
		// ref element uri
		let p_element = g_row.element.value;

		// mms-element prefix
		if(p_element.startsWith(P_PREFIX_ELEMENT)) {
			// extract element id
			let si_element = p_element.slice(P_PREFIX_ELEMENT.length);

			// request this element from MMS
			let dp_elmt = await k_mms_client.element(si_element);
			dp_elmt.data().then(async(g_element) => {
				await k_triplifier.convert_write(g_element, g_element);
			}, () => {
				console.warn(`nested element does not exist: ${si_element}`);
			});
		}
	}

	// await triplifier flush
	await k_triplifier.flush();
})();
