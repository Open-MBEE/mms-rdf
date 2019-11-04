const stream = require('stream');

const {parser:json_parser} = require('stream-json');
const {pick:json_filter_pick} = require('stream-json/filters/Pick');
const {streamObject:json_stream_object} = require('stream-json/streamers/StreamObject');

const factory = require('@graphy/core.data.factory');
const ttl_write = require('@graphy/content.ttl.write');

const gc_app = require('../../config.js');

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


// triplify properties from an Elasticsearch mapping object to RDF
function triplify_properties(g_domain, sct_domain=null, a_c3s=[], sct_nested=null) {
	// element properties
	for(let [s_property, g_property] of Object.entries(g_domain.properties)) {
		let si_property = s_property;
		let b_derived = false;

		// cumulative triples
		let a_types = [];
		let a_reps = [];

		// prep triples struct
		let g_add = {
			'mms-ontology:key': '"'+s_property,
		};

		// add domain
		if(sct_domain) {
			g_add['mms-ontology:mappingDomain'] = sct_domain;
		}

		// derived property
		if('_' === s_property[0]) {
			s_property = s_property.slice(1);

			// add triple
			a_types.push('mms-ontology:DerivedProperty');

			b_derived = true;
		}

		// id_as_keywords: .*Id
		if(s_property.endsWith('Id')) {
			s_property = s_property.slice(0, -'Id'.length);

			// add triple
			a_types.push('mms-ontology:ObjectProperty');

			// rep
			if(!b_derived) a_reps.push('"'+s_property);

			// parity 1:1
		}
		// id_as_keywords (list): .*Ids
		else if(s_property.endsWith('Ids')) {
			s_property = s_property.slice(0, -'Ids'.length)+'s';

			// range class
			let s_range = s_property[0].toUpperCase()+s_property.slice(1);
			let sct_range = `mms-ontology:${s_range}`;

			// create list type
			let sct_list = `mms-ontology:${s_range}List`;

			// add as range
			g_add['rdfs:range'] = sct_list;

			// rep
			if(!b_derived) a_reps.push(...['"'+s_property, '"'+s_property.replace(/s$/, '')]);

			// create list type triples
			a_c3s.push({
				[sct_list]: {
					a: 'owl:Class',
					'rdfs:subClassOf': {
						a: 'owl:Class',
						'owl:intersectionOf': [[
							'rdf:List',
							{
								a: 'owl:Restriction',
								'owl:onProperty': 'rdf:first',
								'owl:allValuesFrom': sct_range,
							},
							{
								a: 'owl:Restriction',
								'owl:onProperty': 'rdf:rest',
								'owl:allValuesFrom': sct_list,
							},
						]],
					},
				},
			});

			// add triple
			a_types.push('mms-ontology:ObjectProperty');

			// parity 1:n
		}
		// boolean: is[A-Z].*
		else if(/^is[A-Z]/.test(s_property)) {
			s_property = s_property.slice('is'.length);

			// lower-case
			s_property = s_property[0].toLowerCase()+s_property.slice(1);

			// datatype property
			a_types.push('mms-ontology:DatatypeProperty');

			// rep
			if(!b_derived) a_reps.push('"'+si_property);

			// boolean
			g_add['rdfs:range'] = 'xsd:boolean';
		}
		// add key otherwise
		else if(!b_derived) {
			a_reps.push('"'+s_property);
		}

		// extend with id triples
		if(s_property in h_property_ids) {
			Object.assign(g_add, h_property_ids[s_property]);

			// rewrite id
			if(g_add.$) {
				s_property = g_add.$;
				delete g_add.$;
			}

			// do not run thru property type
			delete g_property.type;
		}

		// self iri
		let sct_self = `mms-property:${sct_nested? sct_nested.replace(/^mms-property:/, '')+'_': ''}${s_property}`;

		// property of exclusively nested property
		if(sct_nested) {
			g_add['mms-ontology:nestedUnder'] = sct_nested;
		}

		// property has type
		if(g_property.type && g_property.type in h_property_datatypes) {
			// datatype property
			a_types.push('mms-ontology:DatatypeProperty');

			// extend with type triples
			let h_merge = h_property_datatypes[g_property.type];

			for(let [sct_predicate, z_objects] of Object.entries(h_merge)) {
				g_add[sct_predicate] = (sct_predicate in g_add)
					? [g_add[sct_predicate], z_objects]
					: z_objects;
			}
		}

		// property has properties
		if(g_property.properties) {
			// object property
			a_types.push('mms-ontology:ObjectProperty');

			// recurse
			triplify_properties(g_property, sct_domain, a_c3s, sct_self);
			// xx--domain: sct_self--xx
		}

		// add triples
		a_c3s.push({
			[sct_self]: Object.assign(g_add, {
				a: a_types,
				'rdfs:label': '"'+s_property,
				...(a_reps.length
					? {'mms-ontology:aliases':a_reps}
					: {}),
			}),
		});
	}
}


// Elasticsearch mapping converter
class Converter extends stream.Transform {
	constructor() {
		super({
			objectMode: true,
		});

		// initialialize output with following static RDF; push once with backpressure
		this.push({
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
						'mms-ontology:Visibility': {
							a: 'mms-ontology:EnumeratedClass',
							'owl:oneOf': [
								[
									'Public',
									'Private',
									'None',
								].map(s => `mms-ontology:Visibility.${s}`),
							],
						},

						'mms-ontology:Visibility.Public': {
							a: 'owl:Class',
							'mms-ontology:enumerationValue': '"public',
						},

						'mms-ontology:Visibility.Private': {
							a: 'owl:Class',
							'mms-ontology:enumerationValue': '"private',
						},

						'mms-ontology:Visibility.None': {
							a: 'owl:Class',
							'mms-ontology:enumerationValue': 'rdf:nil',
						},
					},
				},
			],
		});
	}

	// implements node.js stream.Transform#_transform
	// eslint-disable-next-line class-methods-use-this
	_transform({value:g_mappings}, s_encoding, fk_transform) {
		// accumulate RDF objects in memory
		let a_c3s = [];

		// triplify each mapping object
		for(let s_type in g_mappings) {
			triplify_properties(g_mappings[s_type], `mms-ontology:${s_type[0].toUpperCase()}${s_type.slice(1)}`, a_c3s);
		}

		// write to stream
		fk_transform(null, {
			type: 'array',
			value: a_c3s.map(hc3 => ({type:'c3', value:hc3})),
		});
	}
}

// json object
stream.pipeline(...[
	// standard input stream
	process.stdin,

	// parse json and stream into object format
	json_parser(),
	json_filter_pick({filter:/./}),
	json_stream_object(),

	// apply converter
	new Converter(),

	// writer to turtle
	ttl_write({}),

	// pipe to standard output
	process.stdout,

	// catch pipeline errors
	(e_pipeline) => {
		debugger;
		throw e_pipeline;
	},
]);
