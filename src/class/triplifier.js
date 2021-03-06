const factory = require('@graphy/core.data.factory');
const ttl_write = require('@graphy/content.ttl.write');
const rqr_term = factory.from.sparql_result;
const util = require('util');

const Endpoint = require('../class/endpoint.js');
const VocabEntry = require('../class/vocab-entry.js');
const AsyncLockPool = require('../class/async-lock-pool.js');

let as_warnings = new Set();
function warn_once(s_message) {
	if(!as_warnings.has(s_message)) {
		as_warnings.add(s_message);
		console.warn('\n'+s_message);
	}
}

const suffix = s => {
	if(s.indexOf('<') >= 0) debugger;

	return s.replace(/\s+/g, '_').replace(/[<>]/, '-');
};

function id_mapper(sc1_type, sc1_category, hc3_write, k_triplifier) {
	switch(sc1_category) {
		// artifact
		case 'mms-class:Artifact': {
			let s_type = sc1_type.replace(/^(mms|uml)-class:/, '');

			return s => `mms-artifact:${s_type}.ID:${suffix(s)}`;
		}

		// element
		case null:
		case 'mms-class:Element':
		case 'mms-class:ElementList': {
			return (z_element) => {
				// id string
				if('string' === typeof z_element) {
					return `mms-element:${suffix(z_element)}`;
				}
				// nested element
				else if(z_element.id) {
					return `mms-element:${suffix(z_element.id)}`;
				}
				// other
				else {
					warn_once(`failed to interpret element descriptor: ${util.inspect(z_element)}`);
				}
			};
		}

		default: {
			warn_once(`unmapped mms-class category: '${sc1_category}'`);
			return s => `mms-artifact:Unknown.ID:${suffix(s)}`;
		}
	}
}

async function Triplifier$query(k_self, s_query) {
	let k_endpoint = k_self._k_endpoint;

	// submit query
	let k_response;
	try {
		k_response = await k_endpoint.query(s_query);
	}
	catch(e_query) {
		// connection refused
		if(e_query.message.startsWith('connect ECONNREFUSED')) {
			debugger;
			throw new Error(`Unable to query endpoint ${process.env.SPARQL_ENDPOINT}; have you set up the proxy correctly?\n${e_query.stack}`);
		}
		// some other error
		else {
			debugger;
			throw new Error(`${e_query.stack}\n from SPARQL query:\n${s_query}`);
		}
	}

	// sparql-results rows
	return k_response;
}


module.exports = class Triplifier {
	constructor(gc_triplifier) {
		let {
			endpoint: p_endpoint,
			prefixes: h_prefixes,
			concurrency: n_concurrency=parseInt(process.env.HTTP_MAX_REQUESTS || 16),
			output: ds_output,
		} = gc_triplifier;

		// instantiate endpoint connection
		let k_endpoint = new Endpoint({
			url: p_endpoint,
			prefixes: h_prefixes,
		});

		// create ttl writer
		let ds_writer = ttl_write({
			prefixes: h_prefixes,
		});

		// pipe writer stream to output
		ds_writer.pipe(ds_output);

		this._h_prefixes = h_prefixes;
		this._h_vocabulary = {};
		this._k_endpoint = k_endpoint;
		this._ds_writer = ds_writer;
		this._c_active = 0;
		this._a_queue = [];
		this._n_concurrency = n_concurrency;

		this._k_locks = new AsyncLockPool(n_concurrency);
	}

	async process_property(sc1_self, g_node, hc2_self, hc3_write) {
		let {
			_h_prefixes: h_prefixes,
		} = this;

		let {
			key: si_key,
			value: z_value,
			property: kt_property,
			property_type: kt_property_type,
			property_range: kt_property_range,
			property_range_category: kt_property_range_category,
			list_item_range: kt_list_item_range,
			list_item_range_category: kt_list_item_range_category,
			cardinality: kt_cardinality,
		} = g_node;

		let wct_value = null;

		let sc1_property_type = kt_property_type.concise(h_prefixes);
		let sc1_property_range = kt_property_range.concise(h_prefixes);

		// depending on property type
		switch(sc1_property_type) {
			// datatype property
			case 'mms-ontology:DatatypeProperty':
			case 'mms-ontology:DerivedDatatypeProperty':
			case 'mms-ontology:UmlDatatypeProperty': {
				// xsd type; set literal w/ datatype
				if(sc1_property_range.startsWith('xsd:')) {  //  && 'xsd:string' !== st1_range
					// xsd:string
					if('xsd:string' === sc1_property_range) {
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
								wct_value = '^'+sc1_property_range+'"'+z_value;

								// name synonymize as rdfs:label
								if('name' === g_node.key) {
									hc2_self['rdfs:label'] = '"'+z_value;
								}
							}
						}
					}
					// any other type
					else {
						wct_value = '^'+sc1_property_range+'"'+z_value;
					}
				}
				// other (custom datatype)
				else {
					let g_datatype = null;
					let h_restrictions = {};

					// debugger;

					// query vocabulary for property definition
					let dpg_restrictions = await Triplifier$query(this, /* syntax: sparql */ `
						select ?datatype ?qualifier ?target {
							${kt_property_range.terse(h_prefixes)} owl:equivalentClass [
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

					for await (let g_restriction of dpg_restrictions) {
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

				break;
			}

			// object property
			case 'mms-ontology:ObjectProperty':
			case 'mms-ontology:DerivedObjectProperty':
			case 'mms-ontology:UmlObjectProperty': {
				// query vocabulary for range type
				let f_map_id = id_mapper(kt_property_range.concise(h_prefixes), kt_property_range_category? kt_property_range_category.concise(h_prefixes): null);

				// range is ordered list
				if(kt_list_item_range) {
					// list item category element list
					if(kt_list_item_range_category && 'mms-class:ElementList' === kt_list_item_range_category.concise(h_prefixes)) {
						let sc1_list_item_range = kt_list_item_range.concise(h_prefixes);
						let si_list_item_range = suffix(sc1_list_item_range.replace(/^mms-class:/, ''));
						let sc1_seq_prefix = `mms-artifact:${si_list_item_range}`;
						let si_self = sc1_self.replace(/^mms-element:/, '');

						wct_value = [
							z_value.map((a_seq, i_item) => {
								let sc1_seq = `${sc1_seq_prefix}.Element:${si_self}.Index:${i_item}`;

								hc3_write[sc1_seq] = {
									a: `mms-class:${si_list_item_range}`,
									'mms-ontology:path': [
										a_seq.map(f_map_id),
									],
								};

								return sc1_seq;
							}),
						];
					}
					// empty list
					else if(!Array.isArray(z_value)) {
						wct_value = [[]];
					}
					// map elements in list to iris
					else {
						wct_value = [
							z_value.map(f_map_id),
						];
					}
				}
				// range has cardinality
				else if(kt_cardinality) {
					// range is direct
					if('1' === kt_cardinality.value) {
						// array
						if(Array.isArray(z_value)) {
							// each item
							for(let z_item of z_value) {
								// nested element
								if(z_item && z_item.id) {
									// convert nested element object
									let a_c3s_push = await this.convert_object(z_item);

									// merge triples
									for(let hc3_push of a_c3s_push) {
										Object.assign(hc3_write, hc3_push);
									}
								}
							}

							// within cardinality
							if(z_value.length <= 1) {
								wct_value = z_value.map(f_map_id);
							}
							// exceeds cardinality
							else {
								console.warn(`an array value for the '${g_node.key}' key has more than 1 element but the object property '${kt_property.terse(h_prefixes)}' has cardinality ${kt_cardinality.value}`);
								wct_value = z_value.map(f_map_id);
							}
						}
						// item
						else {
							// nested element
							if(z_value && z_value.id) {
								// convert nested element object
								let a_c3s_push = await this.convert_object(z_value);

								// merge triples
								for(let hc3_push of a_c3s_push) {
									Object.assign(hc3_write, hc3_push);
								}
							}

							wct_value = z_value && f_map_id(z_value);
						}
					}
					// range is unordered set, array
					else if(Array.isArray(z_value)) {
						// each item
						for(let z_item of z_value) {
							// nested element
							if(z_item && z_item.id) {
								// convert nested element object
								let a_c3s_push = await this.convert_object(z_item);

								// merge triples
								for(let hc3_push of a_c3s_push) {
									Object.assign(hc3_write, hc3_push);
								}
							}
						}

						// add pairs
						wct_value = z_value.map(f_map_id);
					}
					// item
					else {
						// nested element
						if(z_value && z_value.id) {
							// convert nested element object
							let a_c3s_push = await this.convert_object(z_value);

							// merge triples
							for(let hc3_push of a_c3s_push) {
								Object.assign(hc3_write, hc3_push);
							}
						}

						wct_value = z_value && f_map_id(z_value);
					}
				}
				// range is not list and no cardinality, try enumerated value
				else {
					let k_response;
					try {
						k_response = await Triplifier$query(this, /* syntax: sparql */ `
							select ?enumeration ?enumerationValue {
								${kt_property_range.terse(h_prefixes)} a mms-ontology:EnumeratedClass ;
									owl:oneOf/rdf:rest*/rdf:first ?enumeration ;
									.

								?enumeration mms-ontology:enumerationValue ?enumerationValue .

								values ?enumerationValue {
									${null === z_value? 'rdf:nil': (
										(Array.isArray(z_value)? z_value: [z_value])
											.map(s => factory.literal(s).terse(h_prefixes))
											.join(' ')
										)}
								}
							}
						`);
					}
					catch(e_query) {
						debugger;
						throw e_query;
					}

					// query vocabulary for property definition
					let a_enumerated = await k_response.rows();

					if(a_enumerated.length) {
						wct_value = a_enumerated[0].enumeration;
					}
					else {
						warn_once(`unmapped object key '${si_key}'`);
					}
				}
				break;
			}

			default: {
				throw new Error('neither object nor datatype property');
			}
		}

		// a value was transformed; write to concise-pairs hash
		if(wct_value) {
			hc2_self[kt_property.concise(h_prefixes)] = wct_value;
		}
	}


	async convert_object(g_object, si_key_nested=null) {
		let {
			_h_prefixes: h_prefixes,
			_h_vocabulary: h_vocabulary,
		} = this;

		let s_type = g_object.type;

		let a_rows = [];

		// vocabulary already defined for source type
		if(s_type in h_vocabulary) {
			a_rows = await h_vocabulary[s_type].await();
		}
		// vocabulary not yet defined for source type
		else {
			let st1_source_type = factory.c1(`uml-class:${s_type}`, h_prefixes).terse(h_prefixes);

			let a_keys_lookup = Object.keys(g_object)
				.filter(s => 'type' !== s && '_elasticId' !== s);

			// query vocabulary for property definitions
			let s_query = /* syntax: sparql */ `
				select ?keyLabel ?property ?propertyType ?propertyRange ?propertyRangeCategory ?cardinality ?listItemRange ?listItemRangeCategory from mms-graph:vocabulary {
					?property a ?propertyType ;
						mms-ontology:key ?keyLabel ;
						rdfs:domain ?propertyDomain ;
						rdfs:range ?propertyRange ;
						.

					?propertyType rdfs:subClassOf* mms-ontology:Property .

					?propertyDomain ((owl:equivalentClass|^owl:equivalentClass)*/(^rdfs:subClassOf)*)* ${st1_source_type} .

					# optional property range category
					optional {
						?propertyRange mms-ontology:category ?propertyRangeCategory .
					}


					# select property with most specific domain class
					filter not exists {
						?subProperty a ?subPropertyType ;
							mms-ontology:key ?keyLabel ;
							rdfs:domain ?subPropertyDomain ;
							.

						?subPropertyType rdfs:subClassOf* mms-ontology:Property .

						?subPropertyDomain ((owl:equivalentClass|^owl:equivalentClass)*/(^rdfs:subClassOf)*)* ${st1_source_type} .

						filter(?subProperty != ?property)

						?subPropertyDomain rdfs:subClassOf+ ?propertyDomain .
					}


					# bind cardinality if it exists
					optional {
						?property mms-ontology:cardinality ?cardinality .
					}


					# bind list item range type if it exists
					optional {
						?property mms-ontology:listItemRange ?listItemRange .

						optional {
							?listItemRange mms-ontology:category ?listItemRangeCategory .
						}
					}

					${si_key_nested  /* eslint-disable indent */
						? /* syntax: sparql */ `
							# do not bind cases when there is a more specific 'nestedUnder' property
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

					values ?keyLabel {
						${/* eslint-disable indent */
							a_keys_lookup
								.map(s => factory.literal(s).terse())
								.join(' ')
							/* eslint-enable */}
					}
				}
			`;

			// if(si_key_nested) debugger;

			// create vocab entry
			let k_entry = h_vocabulary[s_type] = new VocabEntry(s_type);

			let k_response = await Triplifier$query(this, s_query);

			// submit query to endpoint
			a_rows = await k_entry.load(k_response);

			// if(!a_rows.length) {
			// 	debugger;
			// }
			// else if(a_rows.length !== a_keys_lookup.length) {
			// 	debugger;
			// }
		}

		if(!a_rows.length) {
			warn_once(`object type '${s_type}' is not accounted for in the vocabulary`);

			return [];
			// debugger;
		}

		// mint self iri
		let sc1_self = `mms-element:`+suffix(g_object.id);

		// self concise-pairs hash
		let hc2_self = {};

		let hc3_write = {};

		let h_descriptor = {};

		// process properties
		for(let g_row of a_rows) {
			let si_key = g_row.keyLabel.value;

			h_descriptor[si_key] = g_object[si_key];

			await this.process_property(sc1_self, {
				key: si_key,
				value: g_object[si_key],
				property: rqr_term(g_row.property),
				property_type: rqr_term(g_row.propertyType),
				property_range: rqr_term(g_row.propertyRange),
				property_range_category: g_row.propertyRangeCategory? rqr_term(g_row.propertyRangeCategory): null,
				list_item_range: g_row.listItemRange? rqr_term(g_row.listItemRange): null,
				list_item_range_category: g_row.listItemRangeCategory? rqr_term(g_row.listItemRangeCategory): null,
				cardinality: g_row.cardinality? rqr_term(g_row.cardinality): null,
			}, hc2_self, hc3_write);
		}

		let a_c3s_push = [
			{
				[factory.comment()]: JSON.stringify({_id:g_object._id, _type:g_object._type, ...h_descriptor}),
				[sc1_self]: {
					a: `uml-class:${g_object.type}`,
					'mms-ontology:elementId': '"'+g_object.id,
					...hc2_self,
				},

				...hc3_write,
			},
		];

		// debugger;

		return a_c3s_push;
	}

	async convert_write(g_object) {
		let {
			_ds_writer: ds_writer,
		} = this;

		this._c_active += 1;

		// wait for capacity
		let f_release = await this._k_locks.acquire(g_object);

		// convert object
		this.convert_object(g_object)
			.then((ac3_items) => {
				// write items to output
				ds_writer.write({
					type: 'array',
					value: ac3_items.map(hc3 => ({type:'c3', value:hc3})),
				});
			})
			.catch((e_convert) => {
				debugger;

				console.error(e_convert);
				throw e_convert;
			})
			.finally(() => {
				// release slot
				f_release();

				this._c_active -= 1;
			});
	}

	async flush() {
		// something is still active
		if(this._c_active) {
			await new Promise((fk_resolve) => {
				this.resolve_final = fk_resolve;
			});
		}

		// end output
		this._ds_writer.end();
	}
};
