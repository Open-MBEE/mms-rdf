/* eslint-disable no-loop-func */
const H_PREFIXES = require('../../config.js').prefixes;

const factory = require('@graphy/core.data.factory');
const ttl_read = require('@graphy/content.ttl.read');
const dataset = require('@graphy/memory.dataset.fast');

const csv_writer = require('csv-write-stream');
const fs = require('fs');

const P_RDF = H_PREFIXES.rdf;
const SV1_RDF_TYPE = `>${P_RDF}type`;
const SV1_RDF_NIL = `>${P_RDF}nil`;
const SV1_RDF_FIRST = `>${P_RDF}first`;
const SV1_RDF_REST = `>${P_RDF}rest`;

const P_RDFS = H_PREFIXES.rdfs;
const SV1_RDFS_LABEL = `>${P_RDFS}label`;

const SV1_PRE_MMS_PROPERTY = '>'+H_PREFIXES['mms-property'];
const SV1_PRE_MMS_ONTOLOGY = '>'+H_PREFIXES['mms-ontology'];
const SV1_PRE_MMS_ELEMENT = '>'+H_PREFIXES['mms-element'];
const SV1_PRE_MMS_CLASS = '>'+H_PREFIXES['mms-class'];
const SV1_PRE_UML_CLASS = '>'+H_PREFIXES['uml-class'];

const sc1_to_sv1 = sc1 => factory.c1(sc1, H_PREFIXES).concise();

const unroll_collection = (as_objects, h_triples) => {
	let sv1_object = [...as_objects][0];
	// end of list
	if(SV1_RDF_NIL === sv1_object) {
		return [];
	}

	// step
	let {
		[SV1_RDF_FIRST]: as_first,
		[SV1_RDF_REST]: as_rest,
	} = h_triples[sv1_object];

	// recurse and merge
	return [
		[...as_first][0],
		...unroll_collection(as_rest, h_triples),
	];
};

const AS_PREDICATES_EXCLUDE = new Set([
	'mms-ontology:path',
	...[
		// '_appliedStereotypes',
		'_commit',
		'_creator',
		// '_displayedElements',
		'_elastic',
		// '_group',
		'_inRefs',
		'_modifier',
		'_project',
		// '_propertyPaths',
		'_qualified',
		'_ref',
	].map(s => `mms-property:${s}`),
].map(sc1_to_sv1));

(async() => {
	let as_lpg_properties = new Set();
	let as_lpg_edges = new Set();
	let as_lpg_lists = new Set();

	let h_prefixes = {};

	let i_edge = +(process.argv[2] || 0);

	// read once through to extract properties and edges
	let y_data;
	{
		y_data = await process.stdin
			.pipe(ttl_read({
				maxTokenLength: Infinity,

				data(y_quad) {
					let {
						predicate: yt_predicate,
						object: yt_object,
					} = y_quad;

					let sv1_predicate = yt_predicate.concise();

					// mms-property
					if(sv1_predicate.startsWith(SV1_PRE_MMS_PROPERTY) && !AS_PREDICATES_EXCLUDE.has(sv1_predicate)) {
						// object is literal
						if(yt_object.isLiteral) {
							as_lpg_properties.add(sv1_predicate);
						}
						// object is named node
						else if(yt_object.isNamedNode) {
							// not rdf:nil
							if(`${P_RDF}nil` !== yt_object.value) {
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
			.pipe(dataset())
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
		let h_triples = y_data._h_quad_tree['*'];

		// nodes csv writer
		let ds_nodes = csv_writer({
			headers: [
				'~id',
				'~label',
				'_label',
				...([...as_lpg_properties]
					.map(s => s.slice(SV1_PRE_MMS_PROPERTY.length))
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

		// pipe nodes to fd3
		ds_nodes.pipe(fs.createWriteStream(null, {
			fd: 3,
		}));

		// pipe edges to fd4
		ds_edges.pipe(fs.createWriteStream(null, {
			fd: 4,
		}));

		let as_voids = new Set();

		// convert every subject to a vertex
		for(let sv1_subject of y_data.c1_subjects('*')) {
			let h_pairs = h_triples[sv1_subject];

			let as_types = h_pairs[SV1_RDF_TYPE];

			// typed node
			if(sv1_subject.startsWith(SV1_PRE_MMS_ELEMENT) && as_types) {
				let si_node = sv1_subject.slice(SV1_PRE_MMS_ELEMENT.length);

				let a_class_types = [...as_types].filter(sv1 => sv1.startsWith(SV1_PRE_MMS_CLASS) || sv1.startsWith(SV1_PRE_UML_CLASS));
				if(!a_class_types.length) continue;
				let sv1_type = a_class_types[0];
				let s_class_node = factory.c1(sv1_type).concise(h_prefixes).replace(/^[^:]+:/, '');
				let s_label_node = [...(h_pairs[SV1_RDFS_LABEL] || [])]
					.filter(sv1 => sv1)
					.map(sv1 => factory.c1(sv1).value)
					.slice(0, 1)[0] || '';

				let g_node = {
					'~id': si_node,
					'~label': s_class_node,
					'_label': s_label_node,
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
					let s_label_edge = sv1_predicate.slice(SV1_PRE_MMS_PROPERTY.length);

					// predicate is in edges
					if(as_lpg_edges.has(sv1_predicate)) {
						// each object
						for(let sv1_object of h_pairs[sv1_predicate]) {
							// object is not node; skip
							let yt_object = factory.c1(sv1_object);
							if(yt_object.isLiteral) continue;

							// check that object will become a node
							{
								// check for voids
								if(!(sv1_object in h_triples)) as_voids.add(sv1_object);

								// // object is not mms-object: prefix node; skip
								// if(!sv1_object.startsWith(sv1_pre_mms_element)) continue;

								// // object is not subject
								// if(!(sv1_object in h_triples)) continue;

								// // object does not have its own type(s)
								// if(!(SV1_RDF_TYPE in h_triples[sv1_object])) continue;

								// // ref types
								// let as_o_types = h_triples[sv1_object][SV1_RDF_TYPE];
								// let a_o_class_types = [...as_o_types].filter(sv1 => sv1.startsWith(sv1_pre_mms_class));
								// if(!a_o_class_types.length) continue;
							}

							// write to edges
							ds_edges.write({
								'~id': `e${++i_edge}`,
								'~label': s_label_edge,
								'~from': si_node,
								'~to': sv1_object.slice(SV1_PRE_MMS_ELEMENT.length),
							});
						}
					}
					// predicate is in lists edges
					else if(as_lpg_lists.has(sv1_predicate)) {
						// unroll collection
						let a_objects = unroll_collection(h_pairs[sv1_predicate], h_triples);

						// check for voids
						for(let sv1_object of a_objects) {
							if(!(sv1_object in h_triples)) as_voids.add(sv1_object);
						}

						// write to edges
						for(let sv1_object of a_objects) {
							ds_edges.write({
								'~id': `e${++i_edge}`,
								'~label': s_label_edge,
								'~from': si_node,
								'~to': sv1_object.slice(SV1_PRE_MMS_ELEMENT.length),
							});
						}
					}
				}

				// // clear voids
				// as_voids = new Set();
			}
		}

		// serailize all voids
		for(let sv1_void of as_voids) {
			ds_nodes.write({
				'~id': factory.c1(sv1_void).concise(h_prefixes).replace(/^[^:]+:/, ''),
				'~label': 'Void',
			});
		}

		// end node/edges csv writers
		ds_nodes.end();
		ds_edges.end();
	}

	// write edge id to stdout
	console.log(i_edge);
})();
