const assert = require('assert');
const json_stream = require('JSONStream');
const ttl_write = require('@graphy-dev/content.ttl.write');

const gc_app = require('../../config.js');

// json object
process.stdin
	.pipe(json_stream.parse())
	.on('data', (h_json) => {
		// single top-level object
		let a_json_keys = Object.keys(h_json);
		assert.equal(a_json_keys.length, 1, 'expected 1 nested object in JSON mapping');

		// mappings struct
		const g_mappings = h_json[a_json_keys[0]].mappings;

		// create turtle writer
		let k_writer = ttl_write({
			prefixes: gc_app.prefixes,
		});

		// pipe to stdout
		k_writer.pipe(process.stdout);

		// primer
		k_writer.add({
			// a datatype restriction for properties with langString ranges
			'mms-ontology:Comment_EN': {
				'owl:equivalentClass': {
					a: 'rdfs:Datatype',
					'owl:onDatatype': 'rdfs:langString',
					'owl:withRestrictions': [[
						{'xml:lang':'^xsd:language"en'},
					]],
				},
			},
		});

		//
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

		//
		const h_property_ids = {
			URI: {
				$: 'uri',
				'rdf:type': 'owl:DatatypeProperty',
				'rdfs:range': 'xsd:anyURI',
			},
			documentation: {
				'rdf:type': 'owl:DatatypeProperty',
				'rdfs:range': 'mms-ontology:Comment_EN',
			},
		};


		const triplify_properties = (g_domain, sct_domain=null) => {
			// element properties
			for(let [s_property, g_property] of Object.entries(g_domain.properties)) {
				// cumulative triples
				let a_types = [];

				// prep triples struct
				let g_add = {
					'mms-ontology:key': '"'+s_property,
				};

				// add domain
				if(sct_domain) {
					g_add['rdfs:domain'] = sct_domain;
				}

				// derived property
				if('_' === s_property[0]) {
					s_property = s_property.slice(1);

					// add triple
					a_types.push('mms-ontology:DerivedProperty');
				}

				// prefix
				if(s_property.startsWith('is')) {
					s_property = s_property.slice('is'.length);

					// lower-case
					s_property = s_property[0].toLowerCase()+s_property.slice(1);

					// datatype property
					a_types.push('owl:DatatypeProperty');

					// boolean
					g_add['rdfs:range'] = 'xsd:boolean';
				}

				// suffix
				// .*Id
				if(s_property.endsWith('Id')) {
					s_property = s_property.slice(0, -'Id'.length);

					// add triple
					a_types.push('owl:ObjectProperty');

					// parity 1:1
				}
				// .*Ids
				else if(s_property.endsWith('Ids')) {
					s_property = s_property.slice(0, -'Ids'.length)+'s';

					// range class
					let s_range = s_property[0].toUpperCase()+s_property.slice(1);
					let sct_range = `mms-ontology:${s_range}`;

					// create list type
					let sct_list = `mms-ontology:${s_range}List`;

					// add as range
					g_add['rdfs:range'] = sct_list;

					// create list type triples
					k_writer.add({
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
					a_types.push('owl:ObjectProperty');

					// parity 1:n
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
				let sct_self = `mms-property:${s_property}`;

				// property has type
				if(g_property.type && g_property.type in h_property_datatypes) {
					// datatype property
					a_types.push('owl:DatatypeProperty');

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
					a_types.push('owl:ObjectProperty');

					// recurse
					triplify_properties(g_property, null);
					// xx--domain: sct_self--xx
				}

				// add triples
				k_writer.add({
					[sct_self]: Object.assign(g_add, {
						a: a_types,
					}),
				});
			}
		};

		// triplify each type struct
		for(let s_type in g_mappings) {
			triplify_properties(g_mappings[s_type], `mms-ontology:${s_type[0].toUpperCase()}${s_type.slice(1)}`);
		}

		// close output
		k_writer.end();
	});
