const fs = require('fs');
const assert = require('assert');
const expect = (z_expect, z_actual) => assert.equal(z_actual, z_expect);

const json_stream = require('JSONStream');
const graphy = require('graphy');

const h_prefixes = require('../config.js').prefixes;

// traverse tree
const triplify = (h_node, k_writer, kg_vocab) => {
	for(let s_key in h_node) {
		// input: term value
		let s_value = h_node[s_key];

		// output: concise term string of value
		let sct_value;

		// query vocabulary for property definition
		await k_endpoint.query(/* syntax: sparql */ `
			select ?property ?type ?range {
				?property mdko:key "${s_key}" ;
					a ?type .

				optional {
					?property rdfs:range ?range .
					filter(isIri(?range))
				}

				filter(isIri(?type))
			}
		`);

		// query voacbulary for property definition
		let {
			property: k_property,
			type: a_types,
			range: k_range,
		} = kg_vocab.pattern()
			.literal('"'+s_key).inv('mdko:key')
			.subject().bind('property')
			.outs({
				a: e => e.nodes().collate('type'),
				'rdfs:range?': e => e.node().bind('range'),
			})
			.exit().row();

		/* equivalent SPARQL query:

			select ?property collate(?type) ?range {
				?property mdko:key "${s_key}" ;
					a ?type .

				optional {
					?property rdfs:range ?range .
					filter(isIri(?range))
				}

				filter(isIri(?type))
			}

		*/

		// transform types into terse strings for simpler searching
		let astt_types = new Set(a_types.map(k => k.terse(h_prefixes)));

		// datatype property
		if(astt_types.has('owl:DatatypeProperty')) {
			// has range
			if(k_range) {
				// terse
				let stt_range = k_range.terse(h_prefixes);

				// xsd type; set literal w/ datatype
				if(stt_range.startsWith('xsd:')) {
					sct_value = '^'+stt_range+'"'+s_value;
				}
				// other (custom datatype)
				else {
					// query for equivalent class
					let {
						datatype: k_datatype,
						restriction: a_restrictions,
					} = kg_vocab.pattern()
						.subject(stt_range).outs({
							a: 'rdfs:Datatype',
							'owl:onDatatype': e => e.node().bind('datatype'),
							'owl:withRestrictions': e => e.list().map(
								k => k.hop().out().bind('qualifier')
									.object().bind('target'))
								.collate('restrictions'),
						})
						.exit().row();

					// interpret restrictions
					for(let {
						k_qualifier: k_qualifier,
						target: k_target,
					} of a_restrictions) {
						let stt_datatype = k_datatype.terse(h_prefixes);
						switch(stt_datatype) {
							// langString
							case 'rdfs:langString': {
								// langauge qualifier
								let stt_qualifier = k_qualifier.terse(h_prefixes);
								if('xml:lang' !== stt_qualifier) {
									throw new Error(`unexpected qualifier on 'rdfs:langString' restriction: '${stt_qualifier}'`);
								}

								// language tag datatype
								let stt_tag_datatype = k_target.datatype.terse(h_prefixes);
								if('xsd:language' !== stt_tag_datatype) {
									throw new Error(`expected tag datatype to be 'xsd:language'; instead encountered: '${stt_tag_datatype}'`);
								}

								// construct concise term string
								sct_value = '@'+k_target.value+'"'+s_value;
								break;
							}

							// other
							default: {
								throw new Error(`unexpected datatype restriction: '${stt_datatype}'`);
							}
						}
					}
				}
			}
			// no range
			else {
				throw new Error(`expected datatype property '${k_property.terse(h_prefixes)}' to have a range!`);
			}
		}
		// object property
		else if(astt_types.has('owl:ObjectProperty')) {
			debugger;
		}
	}
};




// cannot reliably convert to terse/verbose format without a writer to prevent blank node collisions
// so for now, just divide the Turtle document into header (prefixes) and body (triples)
let s_turtle_input = fs.readFileSync(process.argv[2], 'utf8');


// // SPARQL update sections
// let srq_header = '';
// let srq_body = '';

// // read vocab from file and turn into SPARQL update
// graphy.content.ttl.read({
// 	input: fs.createReadStream(process.argv[2]),

// 	// on 'prefix' event; append prefix mapping to header of update query
// 	prefix(s_prefix, p_value) {
// 		srq_header += /* syntax: sparql */ `prefix ${s_prefx}: <${p_value}>\n`;
// 	},

// 	// on 'data' event; 
// 	data(g_quad) {
// 		srq_body += g_quad.verbose();
// 	},
// });

// graphy.query.sparql_update.write

fs.createReadStream(process.argv[2])
	.pipe(graphy.content.ttl.read({
		prefixes: h_prefixes,
	}))
	.pipe(graphy.query.sparql.update())
	.pipe(graphy.store({
		prefixes: h_prefixes,

		// graph is ready to query
		ready(kg_vocab) {
			// parse input json
			process.stdin
				.pipe(json_stream.parse())
				.on('data', (g_doc) => {
					// create output
					let k_writer = graphy.format.ttl.write({
						prefixes: h_prefixes,
					});

					// write to stdout
					k_writer.pipe(process.stdout);

					// element
					let sct_self = 'mdki:'+g_doc._id;

					// type
					let s_type = g_doc._type;
					let s_type_proper = s_type[0].toUpperCase()+s_type.slice(1);

					// it's triples
					k_writer.add({
						[sct_self]: {
							a: 'mdko:'+s_type_proper,
							'mdko:index': g_doc._index,
						},
					});

					// triplify properties
					triplify(g_doc._source, k_writer, kg_vocab);

					// close output
					k_writer.end();
				});
		},
	}));
