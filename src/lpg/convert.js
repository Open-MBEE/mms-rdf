/* eslint-disable no-loop-func */
const factory = require('@graphy/core.data.factory');
const ttl_read = require('@graphy/content.ttl.read');
const dataset_tree = require('@graphy/util.dataset.tree');

const csv_writer = require('csv-write-stream');
const fs = require('fs');

const SV1_RDF_TYPE = factory.c1('a').concise();
const P_RDF_TYPE = SV1_RDF_TYPE.slice(1);

const unroll_collection = (as_objects, h_triples) => {
	let sv1_object = [...as_objects][0];
	// end of list
	if('>http://www.w3.org/1999/02/22-rdf-syntax-ns#nil' === sv1_object) {
		return [];
	}

	// step
	let {
		'>http://www.w3.org/1999/02/22-rdf-syntax-ns#first': as_first,
		'>http://www.w3.org/1999/02/22-rdf-syntax-ns#rest': as_rest,
	} = h_triples[sv1_object];

	// recurse and merge
	return [
		[...as_first][0],
		...unroll_collection(as_rest, h_triples),
	];
};

(async() => {
	let as_lpg_properties = new Set();
	let as_lpg_edges = new Set();
	let as_lpg_lists = new Set();

	let h_prefixes = {};

	// // read vocab first
	// {
	// 	let p_mms_datatype_property;
	// 	let p_mms_object_property;

	// 	await fs.createReadStream('./build/vocabulary/element-properties.ttl')
	// 		.pipe(ttl_read({
	// 			prefix(s_prefix_id, p_iri) {
	// 				h_vocab_prefixes[s_prefix_id] = p_iri;

	// 				if('mms-ontology' === s_prefix_id) {
	// 					p_mms_datatype_property = factory.c1('mms-ontology:DatatypeProperty', h_vocab_prefixes).value;
	// 					p_mms_object_property = factory.c1('mms-ontology:ObjectProperty', h_vocab_prefixes).value;
	// 				}
	// 			},

	// 			// scan vocab for datatype properties
	// 			data(y_quad) {
	// 				if(P_RDF_TYPE === y_quad.predicate.value && y_quad.object.isNamedNode) {
	// 					let p_object = y_quad.object.value;

	// 					// datatype property
	// 					if(p_mms_datatype_property === p_object) {
	// 						as_lpg_properties.add(y_quad.subject.concise());
	// 					}
	// 					// object property
	// 					else if(p_mms_object_property === p_object) {
	// 						as_lpg_edges.add(y_quad.subject.concise());
	// 					}
	// 				}
	// 			},
	// 		}))
	// 		.until('eof');
	// }


	let sv1_pre_mms_property;
	let sv1_pre_mms_object;
	let sv1_pre_mms_class;

	let i_edge = 0;

	// read once through to extract properties and edges
	let y_data;
	{
		y_data = await process.stdin
			.pipe(ttl_read({
				maxStringLength: Infinity,
				maxTokenLength: Infinity,

				prefix(s_prefix_id, p_iri) {
					switch(s_prefix_id) {
						case 'mms-property': {
							sv1_pre_mms_property = '>'+p_iri;
							break;
						}

						case 'mms-object': {
							sv1_pre_mms_object = '>'+p_iri;
							break;
						}

						case 'mms-class': {
							sv1_pre_mms_class = '>'+p_iri;
							break;
						}

						default: {
							break;
						}
					}
				},

				data(y_quad) {
					let {
						predicate: yt_predicate,
						object: yt_object,
					} = y_quad;

					let sv1_predicate = yt_predicate.concise();

					// mms-property
					if(sv1_predicate.startsWith(sv1_pre_mms_property)) {
						// object is literal
						if(yt_object.isLiteral) {
							as_lpg_properties.add(sv1_predicate);
						}
						// object is named node
						else if(yt_object.isNamedNode) {
							// not rdf:nil
							if('http://www.w3.org/1999/02/22-rdf-syntax-ns#nil' !== yt_object.value) {
								as_lpg_edges.add(sv1_predicate);
							}
						}
						// object is blank node (for our dataset, this implies a list container)
						else if(yt_object.isBlankNode) {
							as_lpg_lists.add(sv1_predicate);
						}
					}
				},

				eof(_h_prefixes) {
					h_prefixes = _h_prefixes;
				},
			}))
			.pipe(dataset_tree())
			.until('finish', true);
	}

	// make sure there are no cross-contaminants
	for(let sv1_list of as_lpg_lists) {
		if(as_lpg_edges.has(sv1_list)) {
			throw new Error(`predicate is used for both list containers and named nodes: ${sv1_list}`);
		}
	}

	// iterate through
	{
		let h_triples = y_data.quad_tree['*'];

		// nodes csv writer
		let ds_nodes = csv_writer({
			headers: [
				'~id',
				'~label',
				...([...as_lpg_properties]
					.map(s => factory.c1(s).concise(h_prefixes).slice('mms-property:'.length))
				),
			],
		});

		// edges csv writer
		let ds_edges = csv_writer({
			headers: [
				'~id',
				'~label',
				'~from',
				'~to',
			],
		});

		// pipe nodes to stdout
		ds_nodes.pipe(process.stdout);

		// pipe edges to fd3
		ds_edges.pipe(fs.createWriteStream(null, {
			fd: 3,
		}));

		// convert every subject to a vertex
		for(let sv1_subject of y_data.c1_subjects('*')) {
			let h_pairs = h_triples[sv1_subject];

			let as_types = h_pairs[SV1_RDF_TYPE];

			// typed node
			if(sv1_subject.startsWith(sv1_pre_mms_object) && as_types) {
				let si_node = sv1_subject.slice(sv1_pre_mms_object.length);

				let a_class_types = [...as_types].filter(sv1 => sv1.startsWith(sv1_pre_mms_class));
				if(!a_class_types.length) continue;
				let sv1_type = a_class_types[0];
				let s_label_node = factory.c1(sv1_type).concise().slice(sv1_pre_mms_class);

				let g_node = {
					'~id': si_node,
					'~label': s_label_node,
					...(function *() {
						for(let sv1_property of as_lpg_properties) {
							if(sv1_property in h_pairs) {
								yield [...h_pairs[sv1_property]].join(';');
							}
						}
					}),
				};

				// write to nodes
				ds_nodes.write(g_node);

				// each predicate in pairs
				for(let sv1_predicate in h_pairs) {
					// cast to edge label
					let s_label_edge = sv1_predicate.slice(sv1_pre_mms_property.length);

					// predicate is not in edges
					if(as_lpg_edges.has(sv1_predicate)) {
						// each object
						for(let sv1_object of h_pairs[sv1_predicate]) {
							// object is not node; skip
							let yt_object = factory.c1(sv1_object);
							if(yt_object.isLiteral) continue;

							// object is not mms-object: node; skip
							if(!sv1_object.startsWith(sv1_pre_mms_object)) continue;

							// write to edges
							ds_edges.write({
								'~id': `e${++i_edge}`,
								'~label': s_label_edge,
								'~from': si_node,
								'~to': sv1_object.slice(sv1_pre_mms_object.length),
							});
						}
					}
					// predicate is in lists edges
					else if(as_lpg_lists.has(sv1_predicate)) {
						// predicate is not in lists; skip
						if(!as_lpg_lists.has(sv1_predicate)) continue;

						// unroll collection
						let a_objects = unroll_collection(h_pairs[sv1_predicate], h_triples);

						// write to edges
						for(let sv1_object of a_objects) {
							ds_edges.write({
								'~id': `e${++i_edge}`,
								'~label': s_label_edge,
								'~from': si_node,
								'~to': sv1_object.slice(sv1_pre_mms_object.length),
							});
						}
					}
				}
			}
		}

		// end node/edges csv writers
		ds_nodes.end();
		ds_edges.end();
	}
})();
