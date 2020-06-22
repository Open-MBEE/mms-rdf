const stream = require('stream');

const {parser:json_parser} = require('stream-json');
const {pick:json_filter_pick} = require('stream-json/filters/Pick');
const {streamObject:json_stream_object} = require('stream-json/streamers/StreamObject');

const factory = require('@graphy/core.data.factory');
const ttl_write = require('@graphy/content.ttl.write');

const Endpoint = require('../class/endpoint.js');

const gc_app = require('../../config.js');

const pluralize = require('pluralize');

const P_XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean';

const cardinality = s_cardinality => '^uml-model-dt:cardinalityRange"'+s_cardinality;
const multiplicity_to_cardinality = s_multiplicity => cardinality(/\.\.(.+)$/.exec(s_multiplicity)[1]);

// map specific property keys to RDF datatype properties
const h_property_datatypes = {
	date: {
		'rdfs:range': 'xsd:dateTime',
	},

	boolean: {
		'rdfs:range': 'xsd:boolean',
	},

	text: {
		'rdfs:range': 'xsd:string',
	},
};

// map specific property keys to predefined RDF templates
const h_property_ids = {
	URI: {
		$: 'uri',
		'rdf:type': 'mms-ontology:DatatypeProperty',
		'rdfs:range': 'xsd:anyURI',
	},

	uri: {
		$: 'uri',
		'rdf:type': 'mms-ontology:DatatypeProperty',
		'rdfs:range': 'xsd:anyURI',
	},

	body: {
		'rdf:type': 'mms-ontology:DatatypeProperty',
		'rdfs:range': 'mms-ontology:Comment_EN',
	},

	documentation: {
		'rdf:type': 'mms-ontology:DatatypeProperty',
		'rdfs:range': 'mms-ontology:Comment_EN',
	},

	visibility: {
		'rdf:type': 'mms-ontology:ObjectProperty',
		'rdfs:range': 'mms-ontology:Visibility',
	},
};

const H_ASSERTED_DERIVED_OBJECT_PROPERTIES = {
	_creator: {
		'rdfs:comment': '@en"The user who created this Element',
		'rdfs:range': 'mms-ontology:User',
	},

	_modifier: {
		'rdfs:comment': '@en"The user who last modified this Element',
		'rdfs:range': 'mms-ontology:User',
	},
};


// endpoint
let k_endpoint = new Endpoint({
	url: process.env.SPARQL_ENDPOINT,
	prefixes: gc_app.prefixes,
});

async function uml_properties(s_uml_name) {
	// query uml model for all properties that use this uml name
	let dpg_query = await k_endpoint.query(/* syntax: sparql */ `
		select * from mms-graph:vocabulary {
			?property xmi:type uml:Property ;
				xmi:id ?sourceId ;
				uml-model:name ${factory.literal(s_uml_name).verbose()} ;
				rdfs:domain ?domain ;
				rdfs:range ?range ;
				.

			optional {
				?property rdfs:comment ?comment .
			}

			optional {
				?property uml-model:compositeAggregation ?composite .
			}

			optional {
				?property uml-model:isOrdered ?ordered .
			}

			optional {
				?property uml-model:isUnique ?unique .
			}

			optional {
				?property uml-model:multiplicity ?multiplicity .
			}

			?domain xmi:id ?domainId .

			?range xmi:id ?rangeId .

			optional {
				?range uml-model:primitiveTypeEquivalent ?primitiveType ;
					.
			}
		}
	`);

	// types of ranges
	let h_ranges = {};

	// map of properties
	let h_properties = {};

	// each property from uml model
	for await (let g_row of dpg_query) {
		let p_range = g_row.range.value;
		let p_property = g_row.property.value;

		// add range type
		let g_range = (h_ranges[p_range] = h_ranges[p_range] || {
			id: g_row.rangeId.value,
			refs: [],
			primitive_types: new Set(),
		});

		// add property ref
		g_range.refs.push(p_property);

		// add range primitive type
		if(g_row.primitiveType) g_range.primitive_types.add(g_row.primitiveType.value);

		// append property iri and set domain value
		h_properties[p_property] = {
			domain: g_row.domain.value,
			domain_id: g_row.domainId.value,
			source_id: g_row.sourceId.value,
			range_primitive_type: g_row.primitiveType? g_row.primitiveType.value: null,
			comment: g_row.comment? g_row.comment.value: null,
			composite: g_row.composite? g_row.composite.value: null,
			ordered: g_row.ordered? g_row.ordered.value: null,
			unique: g_row.unique? g_row.unique.value: null,
			multiplicity: g_row.multiplicity? g_row.multiplicity.value: null,
		};
	}

	return {
		ranges: h_ranges,
		properties: h_properties,
	};
}


function Converter$save_predicate(k_self, si_mapping_domain, s_relation, g_value=true) {
	let h_predicates = k_self._h_predicates[si_mapping_domain];

	if(h_predicates[s_relation]) {
		let g_first = h_predicates[s_relation];

		// same relation, different keys; issue warning
		if(g_value.source === g_first.source && g_value.mapping_domain === g_first.mapping_domain) {
			console.warn(`WARNING: The '${g_first.source}' UML property has multiple keys: '${g_first.key}' and '${g_value.key}'`);
		}
		// otherwise throw
		else {
			throw new Error(`predicate minting conflict '${s_relation}'`);
		}
	}

	h_predicates[s_relation] = g_value;
}

function Converter$transform_uml_property_direct(k_self, g_transform) {
	let {
		si_mapping_domain,
		s_property,
		s_uml_name,
		b_solo_ref,
		p_range,
		g_range,
		p_ref,
		g_property: {
			domain: p_domain,
			domain_id: si_domain,
			comment: s_comment,
			source_id: si_source,
			range_primitive_type: p_primitive,
		},
	} = g_transform;

	// set range if primitive
	if(p_primitive) p_range = p_primitive;

	let si_range = g_range.id;

	// relation id
	let s_relation = `${s_uml_name}${si_range}${b_solo_ref? '': `From${si_domain}`}`;

	// avoid redundant labels
	let b_redundant_label = s_uml_name.toLowerCase() === si_range.toLowerCase();
	if(b_redundant_label) {
		s_relation = `${s_uml_name}${b_solo_ref? '': `From${si_domain}`}`;
	}

	{
		// range redundant
		let a_words = s_uml_name.split(/(?=[A-Z])/g);

		// check all combinations of words from end
		for(let nl_words=a_words.length, i_start=nl_words-1; i_start>0; i_start-=1) {
			let s_class_test = a_words.slice(i_start).join('');

			// redundancy found
			if(si_range === s_class_test) {
				// simplify relation name
				s_relation = s_uml_name;

				// disambiguate predicates based on domain
				if(!b_solo_ref) s_relation += `${b_solo_ref? '': `From${si_domain}`}`;

				// redundant label
				b_redundant_label = true;
				break;
			}
		}
	}

	// mint mms property iri
	let sc1_property = `mms-property:${s_relation}`;

	let hc3_write = {
		// create property
		[sc1_property]: {
			a: p_primitive? 'mms-ontology:UmlDatatypeProperty': 'mms-ontology:UmlObjectProperty',
			'mms-ontology:cardinality': cardinality(1),
			'mms-ontology:key': '"'+s_property,
			'rdfs:label': '"'+s_relation,
			'rdfs:comment': `@en"The ${si_range} that ${b_redundant_label? 'belongs to': `is the ${s_uml_name} of`} this ${si_domain}. Based on the UML property '${si_source}'`
				+(s_comment? ` which is described as: ${s_comment}`: '.'),
			'rdfs:domain': '>'+p_domain,
			'rdfs:range': '>'+p_range,
			'mms-ontology:umlPropertySource': '>'+p_ref,
		},
	};

	// check no conflict and save predicate to map
	Converter$save_predicate(k_self, si_mapping_domain, s_relation, {
		method: 'direct',
		key: s_property,
		mapping_domain: si_mapping_domain,
		domain: p_domain,
		range: p_range,
		source: p_ref,
	});

	// push triples
	k_self._ds_out.write({
		type: 'c3',
		value: hc3_write,
	});
}

async function Converter$transform_uml_property_id(k_self, si_mapping_domain, s_property) {
	// derive uml name
	let s_uml_name = s_property.slice(0, -'Id'.length);

	// fetch properties from uml model
	let {
		ranges: h_ranges,
		properties: h_properties,
	} = await uml_properties(s_uml_name);

	// each range type
	for(let [p_range, g_range] of Object.entries(h_ranges)) {
		let a_refs = g_range.refs;

		// solo ref
		let b_solo_ref = 1 === a_refs.length;

		// each ref
		for(let p_ref of g_range.refs) {
			let g_property = h_properties[p_ref];

			let g_bundle = {
				si_mapping_domain,
				s_property,
				s_uml_name,
				b_solo_ref,
				p_range,
				g_range,
				p_ref,
				g_property,
			};

			Converter$transform_uml_property_direct(k_self, g_bundle);
		}
	}
}

function Converter$transform_uml_property_ordered_list(k_self, g_transform) {
	let {
		si_mapping_domain,
		s_property,
		s_uml_name,
		b_solo_range,
		b_solo_ref,
		p_range,
		g_range,
		p_ref,
		g_property: {
			domain: p_domain,
			domain_id: si_domain,
			comment: s_comment,
			source_id: si_source,
			multiplicity: s_multiplicity,
			range_primitive_type: p_primitive,
		},
	} = g_transform;

	// set item range if primitive
	if(p_primitive) p_range = p_primitive;

	let si_range = g_range.id;

	// relation id
	let s_relation = `${b_solo_range? pluralize(s_uml_name): s_uml_name+pluralize(si_range)}${b_solo_ref? '': `From${si_domain}`}`;

	// avoid redundant labels
	let b_redundant_label = s_uml_name.toLowerCase() === si_range.toLowerCase();
	if(b_redundant_label) {
		s_relation = `${pluralize(s_uml_name)}${b_solo_ref? '': `From${si_domain}`}`;
	}

	{
		// range redundant
		let a_words = s_uml_name.split(/(?=[A-Z])/g);

		// check all combinations of words from end
		for(let nl_words=a_words.length, i_start=nl_words-1; i_start>0; i_start-=1) {
			let s_class_test = a_words.slice(i_start).join('');

			// redundancy found
			if(si_range === s_class_test) {
				// simplify relation name
				s_relation = a_words.slice(0, -1).join('')+pluralize(a_words[a_words.length-1]);

				// disambiguate predicates based on domain
				if(!b_solo_ref) s_relation += `${b_solo_ref? '': `From${si_domain}`}`;

				// redundant label
				b_redundant_label = true;
				break;
			}
		}
	}

	// mint mms property iri
	let sc1_property = `mms-property:${s_relation}`;

	// mint list iri
	let sc1_list = `mms-class:${s_relation[0].toUpperCase()+s_relation.slice(1)}List`;


	let hc3_write = {
		// create property
		[sc1_property]: {
			a: p_primitive? 'mms-ontology:UmlDatatypeProperty': 'mms-ontology:UmlObjectProperty',
			'mms-ontology:cardinality': multiplicity_to_cardinality(s_multiplicity),
			'mms-ontology:key': '"'+s_property,
			'rdfs:label': '"'+s_relation,
			'rdfs:comment': `@en"List of ${pluralize(si_range)} that ${b_redundant_label? 'belong to': `are the ${s_uml_name} of`} this ${si_domain}. Based on the UML property '${si_source}'`
				+(s_comment? ` which is described as: ${s_comment}`: '.'),
			'rdfs:domain': '>'+p_domain,
			'rdfs:range': sc1_list,
			'mms-ontology:listItemRange': '>'+p_range,
			'mms-ontology:umlPropertySource': '>'+p_ref,
		},

		// create list type
		[sc1_list]: {
			a: 'owl:Class',
			'mms-ontology:category': 'mms-class:ElementList',
			'rdfs:subClassOf': {
				a: 'owl:Class',
				'owl:intersectionOf': [[
					'rdf:List',
					{
						a: 'owl:Restriction',
						'owl:onProperty': 'rdf:first',
						'owl:allValuesFrom': '>'+p_range,
					},
					{
						a: 'owl:Restriction',
						'owl:onProperty': 'rdf:rest',
						'owl:allValuesFrom': sc1_list,
					},
				]],
			},
		},
	};

	// check no conflict and save predicate to map
	Converter$save_predicate(k_self, si_mapping_domain, s_relation, {
		method: 'ids_list_ordered_list',
		key: s_property,
		mapping_domain: si_mapping_domain,
		domain: p_domain,
		range: p_range,
		source: p_ref,
	});

	// push triples
	k_self._ds_out.write({
		type: 'c3',
		value: hc3_write,
	});
}

function Converter$transform_uml_property_unordered_set(k_self, g_transform) {
	let {
		si_mapping_domain,
		s_property,
		s_uml_name,
		b_solo_range,
		b_solo_ref,
		p_range,
		g_range,
		p_ref,
		g_property: {
			domain: p_domain,
			domain_id: si_domain,
			comment: s_comment,
			source_id: si_source,
			multiplicity: s_multiplicity,
			range_primitive_type: p_primitive,
		},
	} = g_transform;

	// set item range if primitive
	if(p_primitive) p_range = p_primitive;

	let si_range = g_range.id;

	// relation id
	let s_relation = `${b_solo_range? s_uml_name: s_uml_name+si_range}${b_solo_ref? '': `From${si_domain}`}`;

	// avoid redundant labels
	let b_redundant_label = s_uml_name.toLowerCase() === si_range.toLowerCase();
	if(b_redundant_label) {
		s_relation = `${s_uml_name}${b_solo_ref? '': `From${si_domain}`}`;
	}

	{
		// range redundant
		let a_words = s_uml_name.split(/(?=[A-Z])/g);

		// check all combinations of words from end
		for(let nl_words=a_words.length, i_start=nl_words-1; i_start>0; i_start-=1) {
			let s_class_test = a_words.slice(i_start).join('');

			// redundancy found
			if(si_range === s_class_test) {
				// simplify relation name
				s_relation = a_words.slice(0, -1).join('')+a_words[a_words.length-1];

				// disambiguate predicates based on domain
				if(!b_solo_ref) s_relation += `${b_solo_ref? '': `From${si_domain}`}`;

				// redundant label
				b_redundant_label = true;
				break;
			}
		}
	}

	// mint mms property iri
	let sc1_property = `mms-property:${s_relation}`;

	let hc3_write = {
		// create property
		[sc1_property]: {
			a: p_primitive? 'mms-ontology:UmlDatatypeProperty': 'mms-ontology:UmlObjectProperty',
			'mms-ontology:cardinality': multiplicity_to_cardinality(s_multiplicity),
			'mms-ontology:key': '"'+s_property,
			'rdfs:label': '"'+s_relation,
			'rdfs:comment': `@en"A ${si_range} that ${b_redundant_label? 'belongs to': `is the ${s_uml_name} of`} this ${si_domain}. Based on the UML property '${si_source}'`
				+(s_comment? ` which is described as: ${s_comment}`: '.'),
			'rdfs:domain': '>'+p_domain,
			'rdfs:range': '>'+p_range,
			'mms-ontology:umlPropertySource': '>'+p_ref,
		},
	};

	// check no conflict and save predicate to map
	Converter$save_predicate(k_self, si_mapping_domain, s_relation, {
		method: 'ids_list_unordered_set',
		key: s_property,
		mapping_domain: si_mapping_domain,
		domain: p_domain,
		range: p_range,
		source: p_ref,
	});

	// push triples
	k_self._ds_out.write({
		type: 'c3',
		value: hc3_write,
	});
}

const R_ADAPT_UML_PROPRETY = /^(.+)Ids?$/;

async function Converter$transform_uml_property_object(k_self, si_mapping_domain, s_property) {
	// derive uml name
	let s_uml_name = s_property.replace(R_ADAPT_UML_PROPRETY, '$1');

	// fetch properties from uml model
	let {
		ranges: h_ranges,
		properties: h_properties,
	} = await uml_properties(s_uml_name);

	// solo range
	let b_solo_range = 1 === Object.keys(h_ranges).length;

	// each range type
	for(let [p_range, g_range] of Object.entries(h_ranges)) {
		let a_refs = g_range.refs;

		// solo ref
		let b_solo_ref = 1 === a_refs.length;

		// each ref
		for(let p_ref of g_range.refs) {
			let g_property = h_properties[p_ref];

			let {
				multiplicity: s_multiplicity,
				ordered: b_ordered=false,
			} = g_property;

			let g_bundle = {
				si_mapping_domain,
				s_property,
				s_uml_name,
				b_solo_range,
				b_solo_ref,
				p_range,
				g_range,
				p_ref,
				g_property,
			};

			// not one-to-many mutliplicty
			switch(s_multiplicity) {
				case '1..*': {
					// ordered
					if(b_ordered) {
						Converter$transform_uml_property_ordered_list(k_self, g_bundle);
					}
					// unordered
					else {
						Converter$transform_uml_property_unordered_set(k_self, g_bundle);
					}

					break;
				}

				case '1..1': {
					Converter$transform_uml_property_direct(k_self, g_bundle);
					break;
				}

				case '1..2': {
					console.warn(`NOTICE: Adapting '${s_property}' UML property from multiplicity '${s_multiplicity}' to ordered list`);
					Converter$transform_uml_property_ordered_list(k_self, g_bundle);
					break;
				}

				default: {
					debugger;
					throw new Error(`unexpected multiplicity '${s_multiplicity}' found on UML source property '${p_ref}' based on key '${s_property}'`);
				}
			}
		}
	}
}

async function Converter$transform_uml_property_boolean(k_self, si_mapping_domain, s_property) {
	// simplify property name
	let s_property_simple;
	{
		let s_property_reduce = s_property.slice('is'.length);

		// lower-case
		s_property_simple = s_property_reduce[0].toLowerCase()+s_property_reduce.slice(1);
	}

	// fetch properties from uml model
	let {
		ranges: h_ranges,
		properties: h_properties,
	} = await uml_properties(s_property);

	let a_range_keys = Object.keys(h_ranges);

	// multiple range types
	if(a_range_keys.length > 1) {
		debugger;
		throw new Error(`expected single range type for boolean relation '${s_property}'`);
	}

	// ref solo range
	let p_range = a_range_keys[0];
	let g_range = h_ranges[p_range];

	let as_primitive_types = g_range.primitive_types;

	// multiple range primitive types
	if(as_primitive_types.size > 1) {
		debugger;
		throw new Error(`expected single primitive range type for Boolean type.`);
	}

	// non boolean range
	if(P_XSD_BOOLEAN !== [...as_primitive_types][0]) {
		debugger;
		throw new Error(`expected xsd:boolean schema type mapping for Boolean type.`);
	}

	let a_refs = g_range.refs;

	// solo ref
	let b_solo = 1 === a_refs.length;

	// each ref
	for(let p_ref of a_refs) {
		let g_property = h_properties[p_ref];

		let s_relation_full = `${s_property}${g_property.domain_id}`;

		let s_relation = b_solo? s_property: s_relation_full;

		let sc1_property = `mms-property:${s_relation}`;

		let hc3_write = {
			[sc1_property]: {
				a: 'mms-ontology:UmlDatatypeProperty',
				'mms-ontology:key': '"'+s_property,
				'rdfs:label': '"'+s_relation,
				'rdfs:comment': '@en"'+g_property.comment,
				'rdfs:domain': '>'+g_property.domain,
				'rdfs:range': 'xsd:boolean',
				'mms-ontology:umlPropertySource': '>'+p_ref,
			},
		};

		// check no conflict and save predicate to map
		Converter$save_predicate(k_self, si_mapping_domain, s_relation, {
			method: 'boolean',
			key: s_property,
			mapping_domain: 'Element',
			domain: g_property.domain,
			range: p_range,
			source: p_ref,
		});

		// add solo alias
		if(b_solo) {
			hc3_write[`mms-property:${s_relation_full}`] = {
				a: 'mms-ontology:UmlDatatypeProperty',
				'owl:equivalentProperty': sc1_property,
			};

			// check no conflict and save predicate to map
			Converter$save_predicate(k_self, si_mapping_domain, s_relation_full, {
				method: 'boolean_solo_alias',
				key: s_property,
				mapping_domain: 'Element',
				domain: g_property.domain,
				range: p_range,
				source: p_ref,
			});
		}

		k_self._ds_out.write({
			type: 'c3',
			value: hc3_write,
		});
	}
}


function Converter$transform_derived_datatype_property(k_self, si_mapping_domain, s_property, si_datatype) {
	let s_relation = s_property.slice(1);

	let sc1_property = `mms-property:_${s_relation}`;

	let hc3_write = {
		[sc1_property]: {
			a: 'mms-ontology:DerivedDatatypeProperty',
			'mms-ontology:key': '"'+s_property,
			'rdfs:label': '"'+s_relation,
			'rdfs:comment': `@en"Based on the key '${s_property}'`,
			'rdfs:domain': `mms-class:${si_mapping_domain}`,
			'rdfs:range': `xsd:${si_datatype}`,
			'mms-ontology:mappingDomain': `mms-class:${si_mapping_domain}`,
		},
	};

	// check no conflict and save predicate to map
	try {
		Converter$save_predicate(k_self, si_mapping_domain, 'derived:'+s_relation, {
			method: `derived-${si_datatype}`,
			key: s_property,
			mapping_domain: si_mapping_domain,
			domain: '?',
			range: si_datatype,
			source: ':derived',
		});
	}
	catch(e_save) {
		console.warn(`derived predicate duplication: '${s_relation}'`);
	}

	k_self._ds_out.write({
		type: 'c3',
		value: hc3_write,
	});
}

// function Converter$transform_derived_object_property_generic(k_self, si_mapping_domain, s_property) {
// 	let s_relation = s_property.slice(1);

// 	let sc1_property = `mms-property:${s_relation}`;

// 	let si_range = s_relation[0].toUpperCase() + s_relation.slice(1);

// 	let sc1_range = `mms-class:${si_range}`;


// 	let hc3_write = {
// 		// create property
// 		[sc1_property]: {
// 			a: 'mms-ontology:DerivedObjectProperty',
// 			'mms-ontology:key': '"'+s_property,
// 			'rdfs:label': '"'+s_relation,
// 			'rdfs:comment': `@en"Based on the derived property '${s_property}'.`,
// 			'rdfs:domain': `mms-ontology:${si_mapping_domain}`,
// 			'rdfs:range': sc1_range,
// 			'mms-ontology:mappingDomain': `mms-ontology:${si_mapping_domain}`,
// 		},
// 	};

// 	console.warn(`minted derived property range class '${sc1_range}'`);

// 	// check no conflict and save predicate to map
// 	try {
// 		Converter$save_predicate(k_self, si_mapping_domain, s_relation, 'derived-id');
// 	}
// 	catch(e_save) {
// 		console.warn(`derived predicate duplication: '${s_relation}'`);
// 	}

// 	k_self.push({
// 		type: 'c3',
// 		value: hc3_write,
// 	});
// }



function Converter$transform_derived_property_id(k_self, si_mapping_domain, s_property) {
	let s_relation = s_property.slice(1, -'Id'.length);

	let sc1_property = `mms-property:_${s_relation}`;

	let si_range = s_relation[0].toUpperCase() + s_relation.slice(1);

	let sc1_range = `mms-class:${si_range}`;

	let hc3_write = {
		// create property
		[sc1_property]: {
			a: 'mms-ontology:DerivedObjectProperty',
			'mms-ontology:key': '"'+s_property,
			'rdfs:label': '"'+s_relation,
			'rdfs:comment': `@en"Based on the derived property '${s_property}'.`,
			'rdfs:domain': `mms-class:${si_mapping_domain}`,
			'rdfs:range': sc1_range,
			'mms-ontology:mappingDomain': `mms-class:${si_mapping_domain}`,
		},
	};

	console.warn(`minted derived property range class '${sc1_range}'`);

	// check no conflict and save predicate to map
	try {
		Converter$save_predicate(k_self, si_mapping_domain, 'derived:'+s_relation, {
			method: 'derived-id',
			key: s_property,
			mapping_domain: si_mapping_domain,
			domain: '?',
			range: sc1_range,
			source: ':derived-id',
		});
	}
	catch(e_save) {
		console.warn(`derived predicate duplication: '${s_relation}'`);
	}

	k_self._ds_out.write({
		type: 'c3',
		value: hc3_write,
	});
}

function Converter$transform_derived_property_ids_list(k_self, si_mapping_domain, s_property) {
	let s_relation = s_property.slice(1, -'Ids'.length);

	let sc1_property = `mms-property:_${pluralize(s_relation)}`;

	let si_range = s_relation[0].toUpperCase() + s_relation.slice(1);

	let sc1_range = `mms-class:${si_range}`;

	let sc1_list = `mms-class:${pluralize(si_range)}List`;


	let hc3_write = {
		// create property
		[sc1_property]: {
			a: 'mms-ontology:DerivedObjectProperty',
			'mms-ontology:key': '"'+s_property,
			'rdfs:label': '"'+s_relation,
			'rdfs:comment': `@en"List of ${pluralize(si_range)} that belong to this ${si_mapping_domain}. Based on the derived property '${s_property}'.`,
			'rdfs:domain': `mms-class:${si_mapping_domain}`,
			'rdfs:range': sc1_list,
			'mms-ontology:listItemRange': sc1_range,
			'mms-ontology:mappingDomain': `mms-class:${si_mapping_domain}`,
		},

		// create list type
		[sc1_list]: {
			a: 'owl:Class',
			'mms-ontology:category': 'mms-class:ElementList',
			'rdfs:subClassOf': {
				a: 'owl:Class',
				'owl:intersectionOf': [[
					'rdf:List',
					{
						a: 'owl:Restriction',
						'owl:onProperty': 'rdf:first',
						'owl:allValuesFrom': sc1_range,
					},
					{
						a: 'owl:Restriction',
						'owl:onProperty': 'rdf:rest',
						'owl:allValuesFrom': sc1_list,
					},
				]],
			},
		},
	};

	console.warn(`minted derived property range class '${sc1_range}'`);

	// check no conflict and save predicate to map
	try {
		Converter$save_predicate(k_self, si_mapping_domain, 'derived:'+s_relation, {
			method: 'derived-ids-list',
			key: s_property,
			mapping_domain: si_mapping_domain,
			domain: '?',
			range: sc1_range,
			source: ':derived-ids-list',
		});
	}
	catch(e_save) {
		console.warn(`derived predicate duplication: '${s_relation}'`);
	}

	k_self._ds_out.write({
		type: 'c3',
		value: hc3_write,
	});
}

function Converter$transform_derived_object_property_keyword(k_self, si_mapping_domain, s_property) {
	if(s_property in H_ASSERTED_DERIVED_OBJECT_PROPERTIES) {
		let s_relation = s_property.slice(1);

		let sc1_property = `mms-property:_${s_relation}`;

		let hc3_write = {
			// create property
			[sc1_property]: {
				a: 'mms-ontology:DerivedObjectProperty',
				'mms-ontology:key': '"'+s_property,
				'rdfs:label': '"'+s_relation,
				'rdfs:comment': `@en"Based on the derived property '${s_property}'.`,
				'rdfs:domain': `mms-class:${si_mapping_domain}`,
				'mms-ontology:mappingDomain': `mms-class:${si_mapping_domain}`,
				...H_ASSERTED_DERIVED_OBJECT_PROPERTIES[s_property],
			},
		};

		// check no conflict and save predicate to map
		try {
			Converter$save_predicate(k_self, si_mapping_domain, 'derived:'+s_relation, {
				method: 'derived-keywords',
				key: s_property,
				mapping_domain: si_mapping_domain,
				domain: '?',
				range: '?',
				source: ':derived-ids-list',
			});
		}
		catch(e_save) {
			console.warn(`derived predicate duplication: '${s_relation}'`);
		}

		k_self._ds_out.write({
			type: 'c3',
			value: hc3_write,
		});
	}
	else {
		console.warn(`unmapped derived object property '${s_property}'`);
	}
}

// triplify properties from an Elasticsearch mapping object to RDF
async function Converter$transform_properties(k_self, si_mapping_domain, g_domain, sct_nested=null) {
	// element properties
	for(let [s_property, g_property] of Object.entries(g_domain.properties)) {
		// derived property
		if('_' === s_property[0]) {
			if(sct_nested) continue;

			// id_as_keywords: .*Id
			if(s_property.endsWith('Id')) {
				await Converter$transform_derived_property_id(k_self, si_mapping_domain, s_property);

				continue;
			}
			// id_as_keywords (list): .*Ids
			else if(s_property.endsWith('Ids')) {
				await Converter$transform_derived_property_ids_list(k_self, si_mapping_domain, s_property);

				continue;
			}
			// datatype
			switch(g_property.type) {
				case 'boolean': {
					await Converter$transform_derived_datatype_property(k_self, si_mapping_domain, s_property, 'boolean');
					break;
				}

				case 'text': {
					await Converter$transform_derived_datatype_property(k_self, si_mapping_domain, s_property, 'string');
					break;
				}

				case 'date': {
					await Converter$transform_derived_datatype_property(k_self, si_mapping_domain, s_property, 'dateTime');
					break;
				}

				case 'keyword': {
					await Converter$transform_derived_object_property_keyword(k_self, si_mapping_domain, s_property);
					break;
				}

				default: {
					// await Converter$transform_derived_object_property_generic(k_self, si_mapping_domain, s_property);
					console.warn(`skipping derived property '${s_property}'`);
				}
			}

			continue;
		}
		// boolean: is[A-Z].*
		else if(/^is[A-Z]/.test(s_property)) {
			await Converter$transform_uml_property_boolean(k_self, si_mapping_domain, s_property);

			continue;
		}
		// all others
		else {
			await Converter$transform_uml_property_object(k_self, si_mapping_domain, s_property);

			continue;
		}
	}
}


// Elasticsearch mapping converter
class Converter {
	constructor(ds_out) {
		this._ds_out = ds_out;

		// initialialize output with following static RDF; push once with backpressure
		ds_out.write({
			type: 'array',
			value: [
				// prefix mappings
				{
					type: 'prefixes',
					value: gc_app.prefixes,
				},

				// primer
				{
					type: 'c3',
					value: {
						'mms-class:Element': {
							a: 'owl:Class',
							'rdfs:label': '"Element',
							'owl:equivalentClass': 'uml-class:Element',
							'mms-ontology:category': 'mms-class:Element',
						},

						'mms-class:Commit': {
							a: 'owl:Class',
							'rdfs:label': '"Commit',
							'mms-ontology:category': 'mms-class:Artifact',
						},

						'mms-class:Ref': {
							a: 'owl:Class',
							'rdfs:label': '"Ref',
							'mms-ontology:category': 'mms-class:Artifact',
						},

						'mms-class:Project': {
							a: 'owl:Class',
							'rdfs:label': '"Project',
							'mms-ontology:category': 'mms-class:Artifact',
						},

						'mms-ontology:Property': {
							a: 'owl:Class',
							'rdfs:label': '"Property',
						},

						'mms-class:PropertyPath': {
							a: 'owl:Class',
							'rdfs:label': '"Property Path',
							'mms-ontology:category': 'mms-class:ElementList',
						},

						'mms-ontology:ObjectProperty': {
							a: 'owl:Class',
							'rdfs:label': '"Object Property',
							'owl:equivalentClass': 'owl:ObjectProperty',
							'rdfs:subClassOf': 'mms-ontology:Property',
						},

						'mms-ontology:DatatypeProperty': {
							a: 'owl:Class',
							'rdfs:label': '"Datatype Property',
							'owl:equivalentClass': 'owl:DatatypeProperty',
							'rdfs:subClassOf': 'mms-ontology:Property',
						},

						'mms-ontology:UmlObjectProperty': {
							a: 'owl:Class',
							'rdfs:label': '"UML Object Property',
							'rdfs:subClassOf': 'mms-ontology:ObjectProperty',
						},

						'mms-ontology:UmlDatatypeProperty': {
							a: 'owl:Class',
							'rdfs:label': '"UML Datatype Property',
							'rdfs:subClassOf': 'mms-ontology:DatatypeProperty',
						},

						'mms-ontology:DerivedObjectProperty': {
							a: 'owl:Class',
							'rdfs:label': '"Derived Object Property',
							'rdfs:subClassOf': 'mms-ontology:ObjectProperty',
						},

						'mms-ontology:DerivedDatatypeProperty': {
							a: 'owl:Class',
							'rdfs:label': '"Derived Datatype Property',
							'rdfs:subClassOf': 'mms-ontology:DatatypeProperty',
						},

						[factory.comment()]: 'a datatype restriction for properties with langString ranges',
						'mms-ontology:Comment_EN': {
							'owl:equivalentClass': {
								a: 'rdfs:Datatype',
								'owl:onDatatype': 'rdfs:langString',
								'owl:withRestrictions': [[
									{'xml:lang':'^xsd:language"en'},
								]],
							},
						},

						[factory.comment()]: 'an enumerated class declaration for types of visibility',
						'mms-class:Visibility': {
							a: 'mms-ontology:EnumeratedClass',
							'mms-ontology:category': 'mms-class:Element',
							'owl:oneOf': [
								[
									'Public',
									'Private',
									'None',
								].map(s => `mms-class:Visibility.${s}`),
							],
						},

						'mms-class:Visibility.Public': {
							a: 'owl:Class',
							'mms-ontology:enumerationValue': '"public',
							'mms-ontology:category': 'mms-class:Element',
						},

						'mms-class:Visibility.Private': {
							a: 'owl:Class',
							'mms-ontology:enumerationValue': '"private',
							'mms-ontology:category': 'mms-class:Element',
						},

						'mms-class:Visibility.None': {
							a: 'owl:Class',
							'mms-ontology:enumerationValue': 'rdf:nil',
							'mms-ontology:category': 'mms-class:Element',
						},

						[factory.comment()]: 'special properties that need to be manually added to extend UML specification',
						'mms-property:appliedStereotypeInstance': {
							a: 'mms-ontology:UmlObjectProperty',
							'mms-ontology:cardinality': '^uml-model-dt:cardinalityRange"1',
							'mms-ontology:key': '"appliedStereotypeInstanceId',
							'rdfs:label': '"Applied Stereotype Instance',
							'rdfs:comment': '@en"An extension to the UML specification to account stereotype application from the Cameo Systems Modeler.',
							'rdfs:domain': 'uml-class:Element',
							'rdfs:range': 'uml-class:InstanceSpecification',
							// 'mms-ontology:umlPropertySource': 'rdf:nil',
						},

						[factory.comment()]: 'special properties that need to be manually added to extend UML specification',
						'mms-ontology:elementId': {
							a: 'mms-ontology:DatatypeProperty',
							'rdfs:label': '"Element ID',
							'rdfs:comment': '@en"A custom property to describe the original ID of the model element as a string.',
							'rdfs:domain': 'mms-class:Element',
							'rdfs:range': 'xsd:string',
						},
					},
				},
			],
		});

		this._h_predicates = {};
	}

	// // implements node.js stream.Transform#_transform
	// // eslint-disable-next-line class-methods-use-this
	// async _transform({value:g_mappings}, s_encoding, fk_transform) {
	// 	// triplify each mapping object
	// 	for(let s_type in g_mappings) {
	// 		let si_domain = s_type[0].toUpperCase() + s_type.slice(1);

	// 		this._h_predicates[si_domain] = {};

	// 		if('element' === s_type) {
	// 			await Converter$transform_properties(this, si_domain, g_mappings[s_type]);
	// 		}
	// 	}

	// 	// done
	// 	fk_transform();
	// }
}


// triplify properties from an Elasticsearch mapping object to RDF
async function Converter$transform_uml_properties(k_self) {
	// create element predicates cache map
	k_self._h_predicates.element = {};

	// query UML model for names of all properties
	let dpg_query = await k_endpoint.query(/* syntax: sparql */ `
		select distinct ?key from mms-graph:vocabulary {
			?property uml-model:name ?key
		}
	`);

	// create mms element properties based on UML names
	for await (let g_row of dpg_query) {
		let s_property = g_row.key.value;

		// boolean: is[A-Z].*
		if(/^is[A-Z]/.test(s_property)) {
			await Converter$transform_uml_property_boolean(k_self, 'element', s_property);
		}
		// all others
		else {
			await Converter$transform_uml_property_object(k_self, 'element', s_property);
		}
	}
}

async function Converter$transform_derived_properties(k_self) {
	// element properties
	for(let [s_property, g_property] of Object.entries(g_domain.properties)) {
		// derived property
		if('_' === s_property[0]) {
			if(sct_nested) continue;

			// id_as_keywords: .*Id
			if(s_property.endsWith('Id')) {
				await Converter$transform_derived_property_id(k_self, si_mapping_domain, s_property);

				continue;
			}
			// id_as_keywords (list): .*Ids
			else if(s_property.endsWith('Ids')) {
				await Converter$transform_derived_property_ids_list(k_self, si_mapping_domain, s_property);

				continue;
			}
			// datatype
			switch(g_property.type) {
				case 'boolean': {
					await Converter$transform_derived_datatype_property(k_self, si_mapping_domain, s_property, 'boolean');
					break;
				}

				case 'text': {
					await Converter$transform_derived_datatype_property(k_self, si_mapping_domain, s_property, 'string');
					break;
				}

				case 'date': {
					await Converter$transform_derived_datatype_property(k_self, si_mapping_domain, s_property, 'dateTime');
					break;
				}

				case 'keyword': {
					await Converter$transform_derived_object_property_keyword(k_self, si_mapping_domain, s_property);
					break;
				}

				default: {
					// await Converter$transform_derived_object_property_generic(k_self, si_mapping_domain, s_property);
					console.warn(`skipping derived property '${s_property}'`);
				}
			}
		}
	}
}

(async() => {
	// write to turtle
	let ds_writer = ttl_write();

	// pipe to stdout
	ds_writer.pipe(process.stdout);

	let k_converter = new Converter(ds_writer);

	ds_writer.on('error', (e_pipeline) => {
		throw e_pipeline;
	});

	await Converter$transform_uml_properties(k_converter);
})();


// // json object
// stream.pipeline(...[
// 	// standard input stream
// 	process.stdin,

// 	// parse json and stream into object format
// 	json_parser(),
// 	json_filter_pick({filter:/./}),
// 	json_stream_object(),

// 	// apply converter
// 	new Converter(),

// 	// writer to turtle
// 	ttl_write({}),

// 	// pipe to standard output
// 	process.stdout,

// 	// catch pipeline errors
// 	(e_pipeline) => {
// 		if(e_pipeline) {
// 			debugger;
// 			throw e_pipeline;
// 		}
// 		else {
// 			console.log('Finished generating MMS vocabulary from mappings');
// 		}
// 	},
// ]);
