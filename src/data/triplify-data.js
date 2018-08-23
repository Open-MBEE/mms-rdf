const v8 = require('v8');

const json_stream = require('JSONStream');
const factory = require('@graphy-dev/api.data.factory');
const ttl_write = require('@graphy-dev/content.ttl.write');
const sparql_results_read = require('@graphy-dev/content.sparql_results.read');

const endpoint = require('../class/endpoint.js');

const H_PRREFIXES = require('../../config.js').prefixes;

// limit maxiumum concurrent docs to prevent memory leak
const N_MAX_CONCURRENT_DOCS = v8.getHeapStatistics().total_available_size / (1 << 15);

class triplifier {
	constructor(gc_triplifier) {
		let {
			prefixes: h_prefixes,
		} = gc_triplifier;

		// create output
		let k_writer = ttl_write({
			prefixes: h_prefixes,
		});

		// write to stdout
		k_writer.pipe(process.stdout);

		// save fields
		Object.assign(this, {
			prefixes: h_prefixes,
			writer: k_writer,
			endpoint: new endpoint({
				url: process.env.NEPTUNE_ENDPOINT,
				prefixes: h_prefixes,
			}),
		});
	}

	async query(s_query, gc_query) {
		let k_endpoint = this.endpoint;

		// submit query
		let g_response = await k_endpoint.query(s_query);

		// async
		return new Promise((fk_process) => {
			// binding results
			sparql_results_read({
				input: {object:g_response.results},
			})
				.on('data', (h_row) => {
					gc_query.each(h_row);
				})
				.on('end', () => {
					// done w/ promise
					fk_process();
				});
		});
	}

	async triplify_properties(sct_self, h_node, hct_object) {
		let {
			prefixes: h_prefixes,
		} = this;

		// nodes
		let h_properties = {};

		// list of nested objects in need of serialization
		let a_nested = [];

		// query vocabulary for property definition
		await this.query(/* syntax: sparql */ `
			select ?key ?property ?type ?range {
				?property mms-ontology:key ?key ;
					a ?type .

				optional {
					?property rdfs:range ?range .
					filter(isIri(?range))
				}

				filter(isIri(?type))

				values ?key {
					${Object.keys(h_node).map(s => factory.literal(s).terse()).join(' ')}
				}
			}
		`, {
			each(h_row) {
				let si_key = h_row.key.value;
				let z_value = h_node[si_key];

				// null; skip
				if(null === z_value) return;

				// property already seen
				if(si_key in h_properties) {
					// just add to types
					h_properties[si_key].types.add(h_row.type.terse(h_prefixes));
				}
				// nested object; add to queue
				else if('object' === typeof z_value && !Array.isArray(z_value)) {
					a_nested.push(z_value);
				}
				// first encounter
				else {
					// create property struct
					h_properties[si_key] = {
						property: h_row.property,
						range: h_row.range,
						key: si_key,
						value: z_value,

						// transform types into terse strings for simpler searching
						types: new Set([h_row.type.terse(h_prefixes)]),
					};
				}
			},
		});

		// serialize nested objects
		for(let h_nested of a_nested) {
			await this.add_object(h_nested);
		}

		// process properties
		for(let si_key in h_properties) {
			await this.process_property(sct_self, si_key, h_properties[si_key], hct_object);
		}
	}

	async process_property(sct_self, si_key, g_node, hct_object) {
		let {
			prefixes: h_prefixes,
			endpoint: k_endpoint,
			writer: k_writer,
		} = this;

		let astt_types = g_node.types;
		let k_property = g_node.property;

		let wct_value = null;

		// datatype property
		if(astt_types.has('owl:DatatypeProperty')) {
			// has range
			if(g_node.range) {
				let k_range = g_node.range;

				// terse
				let stt_range = k_range.terse(h_prefixes);

				// xsd type; set literal w/ datatype
				if(stt_range.startsWith('xsd:')) {
					wct_value = '^'+stt_range+'"'+g_node.value;
				}
				// other (custom datatype)
				else {
					let g_datatype = null;
					let h_restrictions = {};

					// query vocabulary for property definition
					await this.query(/* syntax: sparql */ `
						select ?datatype ?qualifier ?target {
							${stt_range} owl:equivalentClass [
								a rdfs:Datatype ;
								owl:onDatatype ?datatype ;
								owl:withRestrictions [
									rdf:rest*/rdf:first [
										?qualifier ?target ;
									] ;
								] ;
							] .
						}
					`, {
						each(h_row) {
							// transform types into terse strings for simpler searching
							h_restrictions[h_row.qualifier.value] = h_row.target;

							// set from first result
							if(!g_datatype) {
								g_datatype = {
									property: h_row.datatype,
								};
							}
						},
					});

					// interpret restrictions
					for(let [p_qualifier, k_target] of Object.entries(h_restrictions)) {
						let stt_datatype = g_datatype.property.terse(h_prefixes);
						switch(stt_datatype) {
							// langString
							case 'rdfs:langString': {
								// langauge qualifier
								let stt_qualifier = factory.namedNode(p_qualifier).terse(h_prefixes);
								if('xml:lang' !== stt_qualifier) {
									throw new Error(`unexpected qualifier on 'rdfs:langString' restriction: '${stt_qualifier}'`);
								}

								// language tag datatype
								let stt_tag_datatype = k_target.datatype.terse(h_prefixes);
								if('xsd:language' !== stt_tag_datatype) {
									throw new Error(`expected tag datatype to be 'xsd:language'; instead encountered: '${stt_tag_datatype}'`);
								}

								// construct concise term string
								wct_value = '@'+k_target.value+'"'+g_node.value;
								break;
							}

							// other
							default: {
								debugger;
								throw new Error(`unexpected datatype restriction: '${stt_datatype}'`);
							}
						}
					}
				}
			}
			// no range
			else {
				debugger;
				throw new Error(`expected datatype property '${k_property.terse(h_prefixes)}' to have a range!`);
			}
		}
		// object property
		else if(astt_types.has('owl:ObjectProperty')) {
			wct_value = `mms-object:${g_node.value}`;

			// has range
			if(g_node.range) {
				let b_list = false;

				// query vocabulary for range definition of list
				await this.query(/* syntax: sparql */ `
					select ?datatype ?qualifier ?target {
						${g_node.range.terse(h_prefixes)} rdfs:subClassOf [
							a owl:Class ;
							owl:intersectionOf [
								rdf:first rdf:List ;
							]
						] .
					}
				`, {
					each(h_row) {
						// transform types into terse strings for simpler searching
						b_list = true;
					},
				});

				// range is list
				if(b_list) {
					if(!Array.isArray(g_node.value)) {
						wct_value = [];
					}
					else {
						wct_value = [
							g_node.value.map(s => `mms-object:${s}`),
						];
					}
				}
			}
		}

		if(wct_value) {
			hct_object[`mms-property:${g_node.key}`] = wct_value;
		}
	}

	async add_object(g_object) {
		// type
		let s_type = g_object.type;

		// concise-struct
		let hct_object = {
			a: 'mms-ontology:'+s_type,
		};

		// self concise-term string id
		let sct_self = `mms-object:`+g_object.id;

		// triplify properties
		await this.triplify_properties(sct_self, g_object, hct_object);

		// write it's triples
		this.writer.add({
			[sct_self]: hct_object,
		});
	}

	async add(g_object) {
		// type
		let s_type = g_object._type;
		let s_type_proper = s_type[0].toUpperCase()+s_type.slice(1);

		// concise-struct
		let hct_object = {
			a: 'mms-ontology:'+s_type_proper,
			'mms-ontology:index': `mms-index:${g_object._index}`,
		};

		// self concise-term string id
		let sct_self = `mms-object:`+g_object._id;

		// triplify properties
		await this.triplify_properties(sct_self, g_object._source, hct_object);

		// write it's triples
		this.writer.add({
			[sct_self]: hct_object,
		});
	}

	end() {
		this.writer.end();
	}
}


// instantiate triplifier
let k_triplifier = new triplifier({
	prefixes: H_PRREFIXES,
});

// parse input json
let ds_json = json_stream.parse();
process.stdin
	.pipe(ds_json);

// consume in paused mode so we don't exceed max sockets
let c_docs = 0;
let b_ended = false;
ds_json
	.on('data', async(g_doc) => {
		let b_paused = false;

		// met capacity; pause stream
		if(++c_docs >= N_MAX_CONCURRENT_DOCS) {
			ds_json.pause();
			b_paused = true;
		}

		// run triplifier
		await k_triplifier.add(g_doc);

		// processed one doc
		c_docs -= 1;

		if(b_ended && 0 === c_docs % 1000) {
			console.warn(`${c_docs / 1000}k objects remaining...`);
		}

		// stream is paused; resume
		if(b_paused) {
			b_paused = false;
			ds_json.resume();
		}

		// last document and stream ended
		if(!c_docs && b_ended) {
			// close output
			k_triplifier.end();
		}
	})
	.on('end', () => {
		console.warn(`waiting for last ${c_docs} objects to finish being written`);
		b_ended = true;
	});
