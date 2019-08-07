const fs = require('fs');
const worker = require('worker');
const factory = require('@graphy/core.data.factory');
const ttl_write = require('@graphy/content.ttl.write');
const sparql_results_read = require('@graphy-dev/content.sparql_results.read');

const endpoint = require('../class/endpoint.js');

let h_prefixes = {};
let ds_out;
let k_endpoint;
let k_vocabulary = {};

// let k_shared = new triplifier;

class vocab_entry {
	constructor(s_type) {
		Object.assign(this, {
			type: s_type,
			ready: false,
			keys: [],
			waiters: [],
		});
	}

	await() {
		if(this.ready) {
			return this.keys;
		}
		else {
			return new Promise((fk_resolve) => {
				this.waiters.push(fk_resolve);
			});
		}
	}

	async load(dp_query) {
		let a_keys = this.keys = await dp_query;
		this.ready = true;

		for(let fk_waiter of this.waiters) {
			fk_waiter(a_keys);
		}

		this.waiters.length = 0;

		return a_keys;
	}
}


let c_active = 0;

async function query(s_query) {
	// submit query
	let g_response = await k_endpoint.query(s_query)
		.catch((e_query) => {
			// connection refused
			if(e_query.message.startsWith('connect ECONNREFUSED')) {
				throw new Error(`Unable to query endpoint ${process.env.NEPTUNE_ENDPOINT}; have you set up the proxy correctly?\n${e_query.stack}`);
			}
		});

	// sparql-results rows
	let a_rows = [];

	// async
	return new Promise((fk_process) => {
		// binding results
		sparql_results_read({
			input: {object:g_response.results},
		})
			.on('data', ({value:h_row}) => {
				a_rows.push(h_row);
			})
			.on('end', () => {
				// done w/ promise
				fk_process(a_rows);
			});
	});
}


async function process_property(sct_self, si_key, g_node, hc2_self) {
	let {
		key_types: astt_key_types,
		key_ranges: astt_key_ranges,
		property_ranges: astt_property_ranges,
		property: k_property,
		value: z_value,
	} = g_node;

	let wct_value = null;

	// if(['handlerIds', 'handler', 'documentation'].includes(si_key)) {
	// 	debugger;
	// }

	// datatype property
	if(astt_key_types.has('mms-ontology:DatatypeProperty')) {
		// has range(s)
		if(astt_key_ranges.size) {
			if(astt_key_ranges.size > 1) {
				debugger;
				console.warn(`encountered key with multiple ranges: ${si_key}`);
			}

			// terse term
			let st1_range = [...astt_key_ranges][0];  //.map(k => k.terse(h_prefixes));

			// xsd type; set literal w/ datatype
			if(st1_range.startsWith('xsd:')) {  //  && 'xsd:string' !== st1_range
				// xsd:string
				if('xsd:string' === st1_range) {
					// allow JSON type to override range
					switch(typeof z_value) {
						case 'boolean': {
							wct_value = factory.boolean(z_value);
							break;
						}

						case 'number': {
							wct_value = factory.number(z_value);
							break;
						}

						default: {
							wct_value = '^'+st1_range+'"'+z_value;

							// name synonymize as rdfs:label
							if('name' === g_node.key) {
								hc2_self['rdfs:label'] = '"'+z_value;
							}
						}
					}
				}
			}
			// other (custom datatype)
			else {
				let g_datatype = null;
				let h_restrictions = {};

				// query vocabulary for property definition
				let a_restrictions = await query(/* syntax: sparql */ `
					select ?datatype ?qualifier ?target {
						${st1_range} owl:equivalentClass [
							a rdfs:Datatype ;
							owl:onDatatype ?datatype ;
							owl:withRestrictions [
								rdf:rest*/rdf:first [
									?qualifier ?target ;
								] ;
							] ;
						] .
					}
				`);

				for(let g_restriction of a_restrictions) {
					// transform types into terse strings for simpler searching
					h_restrictions[g_restriction.qualifier.value] = g_restriction.target;

					// set from first result
					if(!g_datatype) {
						g_datatype = {
							property: g_restriction.datatype,
						};
					}
				}

				// interpret restrictions
				for(let [p_qualifier, k_target] of Object.entries(h_restrictions)) {
					let st1_datatype = g_datatype.property.terse(h_prefixes);
					switch(st1_datatype) {
						// langString
						case 'rdfs:langString': {
							// langauge qualifier
							let st1_qualifier = factory.namedNode(p_qualifier).terse(h_prefixes);
							if('xml:lang' !== st1_qualifier) {
								throw new Error(`unexpected qualifier on 'rdfs:langString' restriction: '${st1_qualifier}'`);
							}

							// language tag datatype
							let st1_tag_datatype = k_target.datatype.terse(h_prefixes);
							if('xsd:language' !== st1_tag_datatype) {
								throw new Error(`expected tag datatype to be 'xsd:language'; instead encountered: '${st1_tag_datatype}'`);
							}

							// construct concise term string
							wct_value = '@'+k_target.value+'"'+z_value;
							break;
						}

						// other
						default: {
							debugger;
							throw new Error(`unexpected datatype restriction: '${st1_datatype}'`);
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
		if(z_value && z_value.length) {
			if(Array.isArray(z_value)) {
				wct_value = z_value.map(s => `mms-element:${s}`);
			}
			else {
				wct_value = `mms-element:${z_value}`;
			}
		}
		else {
			wct_value = 'rdf:nil';
		}

		// has range
		if(astt_key_ranges.size) {
			let b_list = false;

			// query vocabulary for range definition of list
			let a_lists = await query(/* syntax: sparql */ `
				select ?qualifier ?target from mms-graph:vocabulary {
					?target rdfs:subClassOf [
						a owl:Class ;
						owl:intersectionOf ( rdf:List ?first ?rest ) ;
					] .

					?first a owl:Restriction ;
						owl:onProperty rdf:first ;
						owl:allValuesFrom ?qualifier .

					values ?target {
						${[...astt_key_ranges].join(' ')}
					}
				}
			`);

			// collection
			b_list = a_lists.length;

			// for(let h_row of a_rows) {
			// 	// transform types into terse strings for simpler searching
			// 	b_list = true;
			// }

			// range is list
			if(b_list) {
				if(!Array.isArray(z_value)) {
					wct_value = [];
				}
				else {
					wct_value = [
						z_value.map(s => `mms-element:${s}`),
					];
				}
			}
			else {
				// query vocabulary for property definition
				let a_enumerated = await query(/* syntax: sparql */ `
					select ?class ?enumeration ?enumerationValue {
						?class a mms-ontology:EnumeratedClass ;
							owl:oneOf [
								rdf:rest*/rdf:first ?enumeration ;
							] .

						?enumeration mms-ontology:enumerationValue
							${null === z_value? 'rdf:nil': factory.literal(z_value).terse(h_prefixes)} .

						values ?class {
							${[...astt_key_ranges].join(' ')}
						}
					}
				`);

				if(a_enumerated.length) {
					wct_value = a_enumerated[0].enumeration;
				}
			}
		}
	}

	if(wct_value) {
		hc2_self[`mms-property:${g_node.key}`] = wct_value;
	}
}


async function convert(h_source, g_object, sct_parent=null, si_key_nested=null) {
	let s_type = h_source.type;

	let h_vocab = k_vocabulary;
	let a_keys = [];

	// vocabulary already defined for source type
	if(s_type in h_vocab) {
		a_keys = await h_vocab[s_type].await();
	}
	// vocabulary not yet defined for source type
	else {
		// query vocabulary for property definitions
		let s_query = /* syntax: sparql */ `
			select ?keyLabel ?keyType ?keyRange ?property ?propertyRange from mms-graph:vocabulary {
				?mappingKey mms-ontology:key ?keyLabel ;
					mms-ontology:aliases ?propertyLabel .

				${si_key_nested  /* eslint-disable indent */
					? /* syntax: sparql */ `
						# do not bind cases when there is a more specific 'nestedUnder' property
						filter not exists {
							?nestedVersion mms-ontology:key ?keyLabel ;
								mms-ontology:nestedUnder mms-property:${si_key_nested} .
							filter(?nestedVersion != ?mappingKey)
						}

						# if there is a 'nestedUnder' property, only allow rows matching the specified value
						minus {
							?mappingKey mms-ontology:nestedUnder ?otherUnder .
							filter(?otherUnder != mms-property:${si_key_nested})
						}
					`
					: ''/* eslint-enable indent */}

				?property xmi:type uml:Property ;
					mms-ontology:umlName ?propertyLabel .

				?property rdfs:domain/(^rdfs:subClassOf)* mms-class:${s_type} .

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
						Object.keys(h_source)
							.filter(s => 'type' !== s)
							.map(s => factory.literal(s).terse())
							.join(' ')
						/* eslint-enable */}
				}
			}
		`;

		// if(si_key_nested) debugger;

		// create vocab entry
		let k_entry = h_vocab[s_type] = new vocab_entry(s_type);

		// submit query to endpoint
		a_keys = await k_entry.load(query(s_query));
	}

	let a_nested = [];
	let h_properties = {};

	for(let g_key of a_keys) {
		let si_key = g_key.keyLabel.value;
		let z_value = h_source[si_key];

		// null; skip
		if(null === z_value) continue;

		// property already seen
		if(si_key in h_properties) {
			// just add to types
			if(g_key.keyType) h_properties[si_key].key_types.add(g_key.keyType.terse(h_prefixes));
			if(g_key.keyRange) h_properties[si_key].key_ranges.add(g_key.keyRange.terse(h_prefixes));
			if(g_key.propertyRange) h_properties[si_key].property_ranges.add(g_key.propertyRange.terse(h_prefixes));
		}
		// nested object; add to queue
		else if('object' === typeof z_value && !Array.isArray(z_value)) {
			a_nested.push({
				key: si_key,
				value: z_value,
			});
		}
		// first encounter
		else {
			// create property struct
			h_properties[si_key] = {
				property: g_key.property,
				property_ranges: new Set(g_key.propertyRange? [g_key.propertyRange.terse(h_prefixes)]: []),
				key: si_key,
				key_types: new Set(g_key.keyType? [g_key.keyType.terse(h_prefixes)]: []),
				key_ranges: new Set(g_key.keyRange? [g_key.keyRange.terse(h_prefixes)]: []),
				value: z_value,

				// transform types into terse strings for simpler searching
				// types: h_row.type? new Set([h_row.type.terse(h_prefixes)]): new Set(),
				// types: new Set(['uml:Property']),
			};
		}
	}

	// array of concise-triples hashes to be written
	let a_c3s = [];

	// self concise-term string id
	let sct_self = `mms-element:`+h_source.id;

	// recurse on nested items
	for(let {value:h_nested, key:si_key} of a_nested) {
		a_c3s.push(...await convert(h_nested, g_object, sct_self, si_key));
	}

	// type
	let s_class = h_source.type;

	// stringify source
	let s_json_source = JSON.stringify(h_source);

	// self concise-pairs hash
	let hc2_self = {
		a: 'mms-class:'+s_class,
		// 'mms-ontology:source': s_json_source.length > 6563? `^mms-ontology:JSONFailure"JSON string too long (${s_json_source.length} characters)`: '^mms-ontology:JSON"'+s_json_source,
	};

	// process properties
	for(let si_key in h_properties) {
		await process_property(sct_self, si_key, h_properties[si_key], hc2_self);
	}

	// if(sct_parent) debugger;

	// create concise triple hash
	a_c3s.push({
		[factory.comment()]: JSON.stringify({_id:g_object._id, _type:g_object._type}),
		[sct_self]: hc2_self,
	});

	// add ref from parent
	if(sct_parent) {
		a_c3s.push({
			[factory.comment()]: 'nested object',
			[sct_parent]: {
				[`mms-property:${si_key_nested}`]: sct_self,
			},
		});
	}

	return a_c3s;
}

worker.dedicated({
	// async init(g_init) {
	// 	let {
	// 		prefixes: h_prefixes_init,
	// 		path: p_output,
	// 		endpoint: p_endpoint,
	// 	} = g_init;

	// 	h_prefixes = h_prefixes_init;

	// 	ds_out = fs.createWriteStream(p_output);

	// 	// write prefix map
	// 	ds_out.write({
	// 		type: 'prefixes',
	// 		value: h_prefixes,
	// 	});

	// 	k_endpoint = new endpoint({
	// 		url: p_output,
	// 		prefixes: h_prefixes_init,
	// 	});
	// },

	async convert_write(a_items) {
		for(let g_item of a_items) {
			let g_object = g_item.value;

			let ac3_items = await convert(g_object._source, g_object);

			ds_out.write({
				type: 'array',
				value: ac3_items.map(hc3 => ({type:'c3', value:hc3})),
			});
		}
	},
}, (sgc_init) => {
	let {
		prefixes: h_prefixes_init,
		endpoint: p_endpoint,
		output: p_output,
	} = JSON.parse(sgc_init);

	h_prefixes = h_prefixes_init;

	// create ttl writer
	ds_out = ttl_write({
		prefixes: h_prefixes,
	});

	ds_out.pipe(fs.createWriteStream(`${p_output}_${process.env.WORKER_INDEX}.ttl`));

	// // write prefix map
	// ds_out.write({
	// 	type: 'prefixes',
	// 	value: h_prefixes,
	// });

	k_endpoint = new endpoint({
		url: p_endpoint,
		prefixes: h_prefixes,
	});
});
