const stream = require('stream');

const {parser:json_parser} = require('stream-json');
const {streamValues:json_stream_values} = require('stream-json/streamers/StreamValues');

const factory = require('@graphy-dev/core.data.factory');
const ttl_write = require('@graphy-dev/content.ttl.write');
// const nt_write = require('@graphy-dev/content.nt.write');
const sparql_results_read = require('@graphy-dev/content.sparql_results.read');

const endpoint = require('../class/endpoint.js');

const H_PRREFIXES = require('../../config.js').prefixes;

// limit maxiumum concurrent docs to prevent memory leak
// const N_MAX_CONCURRENT_DOCS = v8.getHeapStatistics().total_available_size / (1 << 15);
const N_MAX_CONCURRENT_DOCS = 128;

class triplifier extends stream.Transform {
	constructor(gc_triplifier) {
		super({
			// writableObjectMode: true,
			// readableObjectMode: false,
			objectMode: true,
		});

		let {
			prefixes: h_prefixes,
		} = gc_triplifier;

		// push prefixes
		this.push({
			type: 'prefixes',
			value: h_prefixes,
		});

		// save fields
		Object.assign(this, {
			prefixes: h_prefixes,
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
				.on('data', ({value:h_row}) => {
					gc_query.each(h_row);
				})
				.on('end', () => {
					// done w/ promise
					fk_process();
				});
		});
	}

	async triplify_properties(sct_self, h_node, hct_object, a_c3s) {
		let {
			prefixes: h_prefixes,
		} = this;

		// nodes
		let h_properties = {};

		// list of nested objects in need of serialization
		let a_nested = [];

		// query vocabulary for property definition
		let s_query = /* syntax: sparql */ `
			select ?keyLabel ?keyType ?keyRange ?property ?propertyRange from mms-graph:vocabulary {
				?mappingKey mms-ontology:key ?keyLabel ;
					mms-ontology:aliases ?propertyLabel .

				?property xmi:type uml:Property ;
					mms-ontology:umlName ?propertyLabel .

				?property rdfs:domain/(^rdfs:subClassOf)* mms-class:${h_node.type} .

				optional {
					?property rdfs:range ?propertyRange .
					filter(isIri(?propertyRange))
				}

				optional {
					?mappingKey a ?keyType .
				}

				optional {
					?mappingKey rdfs:range ?keyRange .
					filter(isIri(?keyRange))
				}

				values ?keyLabel {
					${/* eslint-disable indent */
						Object.keys(h_node)
							.filter(s => 'type' !== s)
							.map(s => factory.literal(s).terse())
							.join(' ')
						/* eslint-enable */}
				}
			}
		`;

		await this.query(s_query, {
			each(h_row) {
				let si_key = h_row.keyLabel.value;
				let z_value = h_node[si_key];

				// null; skip
				if(null === z_value) return;

				// property already seen
				if(si_key in h_properties) {
					// just add to types
					if(h_row.keyType) h_properties[si_key].key_types.add(h_row.keyType.terse(h_prefixes));
					if(h_row.keyRange) h_properties[si_key].key_ranges.add(h_row.keyRange.terse(h_prefixes));
					if(h_row.propertyRange) h_properties[si_key].property_ranges.add(h_row.propertyRange.terse(h_prefixes));
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
						property_ranges: new Set(h_row.propertyRange? [h_row.propertyRange.terse(h_prefixes)]: []),
						key: si_key,
						key_types: new Set(h_row.keyType? [h_row.keyType.terse(h_prefixes)]: []),
						key_ranges: new Set(h_row.keyRange? [h_row.keyRange.terse(h_prefixes)]: []),
						value: z_value,

						// transform types into terse strings for simpler searching
						// types: h_row.type? new Set([h_row.type.terse(h_prefixes)]): new Set(),
						// types: new Set(['uml:Property']),
					};
				}
			},
		});

		// serialize nested objects
		for(let h_nested of a_nested) {
			await this.add_object(h_nested, a_c3s);
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
			// writer: k_writer,
		} = this;

		let astt_key_types = g_node.key_types;
		let astt_key_ranges = g_node.key_ranges;
		let astt_property_ranges = g_node.property_ranges;
		let k_property = g_node.property;

		let wct_value = null;

		// datatype property
		if(astt_key_types.has('mms-ontology:DatatypeProperty')) {
			// has range(s)
			if(g_node.key_ranges.size) {
				let as_ranges = g_node.key_ranges;

				if(as_ranges.size > 1) {
					debugger;
					console.warn(`encountered key with multiple ranges: ${si_key}`);
				}

				// terse
				let stt_range = [...as_ranges][0];  //.map(k => k.terse(h_prefixes));

				// xsd type; set literal w/ datatype
				if(stt_range.startsWith('xsd:')) {
					if('name' === g_node.key) {
						debugger;
						hct_object;
					}
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
		else if(astt_key_types.has('mms-ontology:ObjectProperty')) {
			if(g_node.value && g_node.value.length) {
				if(Array.isArray(g_node.value)) {
					wct_value = g_node.value.map(s => `mms-object:${s}`);
				}
				else {
					wct_value = `mms-object:${g_node.value}`;
				}
			}
			else {
				wct_value = 'rdf:nil';
			}

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
					debugger;
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

	async add_object(g_object, a_c3s) {
		// type
		let s_type = g_object.type;

		// concise-struct
		let hct_object = {
			a: 'mms-class:'+s_type,
			'mms-ontology:source': '^mms-ontology:JSON"'+JSON.stringify(g_object, null, '\t'),
		};

		// self concise-term string id
		let sct_self = `mms-object:`+g_object.id;

		// triplify properties
		await this.triplify_properties(sct_self, g_object, hct_object, a_c3s);

		// create it's concise triple hash
		a_c3s.push({
			[sct_self]: hct_object,
		});
	}

	// async _transform({value:g_object}, s_encoding, fk_transform) {
	// 	// type
	// 	// let s_type = g_object._type;
	// 	// let s_type_proper = s_type[0].toUpperCase()+s_type.slice(1);
	// 	let s_type = g_object._source.type;

	// 	let a_c3s = [];

	// 	// concise-struct
	// 	let hct_object = {
	// 		a: 'mms-class:'+s_type,
	// 		'mms-ontology:index': `mms-index:${g_object._index}`,
	// 	};

	// 	// self concise-term string id
	// 	let sct_self = `mms-object:`+g_object._source.id;

	// 	// triplify properties
	// 	await this.triplify_properties(sct_self, g_object._source, hct_object, a_c3s);

	// 	a_c3s.push({
	// 		[sct_self]: hct_object,
	// 	});

	// 	// create it's concise triple hash
	// 	fk_transform(null, {
	// 		type: 'array',
	// 		value: a_c3s.map(hc3 => ({type:'c3', value:hc3})),
	// 	});
	// }

	async _transform({value:g_object}, s_encoding, fk_transform) {
		// type
		let s_type = g_object._source.type;

		let a_c3s = [];

		// concise-struct
		let hct_object = {
			a: 'mms-class:'+s_type,
			'mms-ontology:index': `mms-index:${g_object._index}`,
		};

		// self concise-term string id
		let sct_self = `mms-object:`+g_object._source.id;

		// if('_16617_dc23764a-4790-491c-9ac8-bc432e3621e6' === g_object._source.id) debugger;

		// triplify properties
		try {
			await this.triplify_properties(sct_self, g_object._source, hct_object, a_c3s);
		}
		catch(e_unhandled) {
			debugger;
			console.warn(`unhandled promise rejection: ${e_unhandled.stack}`);
		}

		a_c3s.push({
			[sct_self]: hct_object,
		});

		// create it's concise triple hash
		setTimeout(() => {
			// next chunk of data
			fk_transform();

			// fk_transform(null, {
			// 	type: 'array',
			// 	value: a_c3s.map(hc3 => ({type:'c3', value:hc3})),
			// });

			console.warn(g_object._source.id);
		}, 0);
	}

	_flush(fk_flush) {
		this.complete = fk_flush;
		// console.warn('_flush()');
		// fk_flush();
	}
}

// pipeline
stream.pipeline(...[
	// standard input stream
	process.stdin,

	// streaming json parser for concatenated json values
	json_parser({jsonStreaming:true}),
	json_stream_values(),

	// convert object to concise-term objects
	new triplifier({
		prefixes: H_PRREFIXES,
	}),

	// serialize RDF objects
	// ttl_write({}),
	ttl_write({}),

	// standard output stream
	process.stdout,

	(e_pipe) => {
		debugger;
		throw e_pipe;
	},
]);
