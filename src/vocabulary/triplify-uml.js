// const fs = require('fs');
const assert = require('assert');
const expect = (z_expected, z_actual) => assert.equal(z_actual, z_expected);

const factory = require('@graphy/core.data.factory');
const ttl_write = require('@graphy/content.ttl.write');
const xml_parser = require('node-xml-stream-parser');

const gc_app = require('../../config.js');

// create turtle writer
let k_writer = ttl_write({
	prefixes: gc_app.prefixes,
});

// pipe to stdout
k_writer.pipe(process.stdout);

// create streaming xml parser
let y_parser = new xml_parser();

/*
	xmi:type rdfs:subPropertyOf rdf:type .
*/

// state variables
let sct_package;
let sct_class;
let sct_element;
let sfx_property;
let sc1_property;

const escape_suffix = s_suffix => s_suffix.replace(/-/g, '_');
const class_term = s_id => `mms-class:${s_id.replace(/^uml:/, '')}`;

// sub-tree
let h_map_class_children = {
	// class hierarchy
	generalization: {
		enter(h_attrs) {
			// extends superclass
			if('uml:Generalization' === h_attrs['xmi:type']) {
				k_writer.write({
					type: 'c3',
					value: {
						[sct_class]: {
							'rdfs:subClassOf': `mms-class:${h_attrs.general}`,
						},
					},
				});
			}
		},
	},

	// comments
	ownedComment: {
		enter(h_attrs) {
			if('uml:Comment' === h_attrs['xmi:type']) {
				k_writer.write({
					type: 'c3',
					value: {
						[sct_class]: {
							'rdfs:comment': `@en"${h_attrs.body}`,
						},
					},
				});
			}
		},
	},

	// properties
	ownedAttribute: {
		enter(h_attrs) {
			// set property term
			sfx_property = escape_suffix(h_attrs['xmi:id']);
			sc1_property = `mms-property:${sfx_property}`;

			// pairs to append
			let h_pairs = {};

			// 'composite aggretation'
			if('composite' === h_attrs.aggregation) {
				h_pairs['mms-ontology:umlAggregation'] = true;

				// ordered
				if(h_attrs.isOrdered) {
					h_pairs['mms-ontology:umlIsOrdered'] = factory.boolean(h_attrs.isOrdered);
				}
			}

			// add triples about property
			k_writer.write({
				type: 'c3',
				value: {
					[sc1_property]: {
						'xmi:type': 'uml:Property',
						'xmi:id': '"'+h_attrs['xmi:id'],
						'xmi:ownedAttributeOf': sct_class,
						'rdfs:label': '"'+h_attrs['xmi:id'],
						'mms-ontology:umlName': '"'+h_attrs.name,
						'rdfs:domain': sct_class,
						...h_pairs,
					},
				},
			});
		},

		children: {
			type: {
				enter(h_attrs) {
					// add range restriction to property
					k_writer.write({
						type: 'c3',
						value: {
							[sc1_property]: {
								'rdfs:range': '>'+h_attrs.href,
							},
						},
					});
				},
			},

			ownedComment: {
				enter(h_attrs) {
					// add comment to property
					k_writer.write({
						type: 'c3',
						value: {
							[sc1_property]: {
								'rdfs:comment': '@en"'+h_attrs.body,
							},
						},
					});
				},

				// annotatedElement: {},
			},

			subsettedProperty: {
				enter(h_attrs) {
					k_writer.write({
						type: 'c3',
						value: {
							[sc1_property]: {
								'uml:subsettedProperty': `mms-property:${escape_suffix(h_attrs['xmi:idref'])}`,
							},
						},
					});
				},
			},

			...['lowerValue', 'upperValue'].reduce((h_out, s_tag) => ({
				...h_out,
				[s_tag]: {
					enter(h_attrs) {
						// value defined
						if(h_attrs.value) {
							let sc1_value = `mms-property:${escape_suffix(`${sfx_property}_${s_tag}`)}`;

							k_writer.write({
								type: 'c3',
								value: {
									[sc1_property]: {
										'uml:lowerValue': sc1_value,
									},
									[sc1_value]: {
										'xmi:type': h_attrs['xmi:type'],
										'xmi:id': '"'+h_attrs['xmi:id'],
										'uml:value': '"'+h_attrs.value,
									},
								},
							});
						}
					},
				},
			})),

			defaultValue: {
				enter(h_attrs) {
					let sct_default_value = `mms-class:${h_attrs['xmi:id']}`;
					k_writer.write({
						type: 'c3',
						value: {
							[sct_default_value]: {
								'xmi:type': class_term(h_attrs['xmi:type']),
								'xmi:id': '"'+h_attrs['xmi:id'],
								...('value' in h_attrs
									? {'mms-ontology:value':'"'+h_attrs.value}
									: {}),
							},
						},
					});

					k_writer.write({
						type: 'c3',
						value: {
							[sc1_property]: {
								'xmi:defaultValue': sct_default_value,
							},
						},
					});
				},
			},
		},
	},
};

// mapping definitions tree
let h_map_tree = {
	exclusive: true,

	children: {
		'xmi:XMI': {
			enter(h_attrs) {
				// each attribute
				for(let [s_attr, s_value] of Object.entries(h_attrs)) {
					// namespace attribute
					if(s_attr.startsWith('xmlns:')) {
						// extract prefix id from attribute name
						let s_prefix_id = s_attr.slice('xmlns:'.length);

						// // try add prefix mapping to writer
						// try {
						// 	k_writer.write({
						// 		type: 'prefixes',
						// 		value: {
						// 			[s_prefix_id]: s_value+'#',
						// 		},
						// 	});
						// }
						// catch(e_exists) {
						// 	// do nothing if it is already defined
						// }
					}
				}
			},

			children: {
				'uml:Package': {
					children: {
						packagedElement: [{
							test: h => 'uml:Package' === h['xmi:type'],

							enter(h_attrs) {
								expect('uml:Package', h_attrs['xmi:type']);

								// package name
								sct_package = `mms-class:${h_attrs['xmi:id']}`;

								k_writer.write({
									type: 'c3',
									value: {
										[sct_package]: {
											'xmi:type': 'uml:Package',
											'xmi:id': '"'+h_attrs['xmi:id'],
										},
									},
								});
							},

							children: {
								packagedElement: [{
									test: h => 'uml:Class' === h['xmi:type'],

									enter(h_attrs) {
										expect('uml:Class', h_attrs['xmi:type']);

										// class
										sct_class = `mms-class:${h_attrs['xmi:id']}`;

										k_writer.write({
											type: 'c3',
											value: {
												[sct_class]: {
													'xmi:type': 'uml:Class',
													'xmi:id': '"'+h_attrs['xmi:id'],
													'xmi:packagedElementOf': sct_package,
												},
											},
										});
									},

									children: h_map_class_children,
								}],
							},
						}],
					},
				},
			},
		},
	},
};

// node within tree
let k_node = h_map_tree;

let b_skip = false;

// stack of ancestors
let a_stack = [];

// let a_contexts = [{}];

// event handler struct
let h_events = {
	opentag(s_tag, h_attrs) {
		// no children defs, this one; skip
		if(!k_node.children || b_skip) return;

		// found element in children
		if(s_tag in k_node.children) {
			// ref child
			let z_child = k_node.children[s_tag];

			// there are selection criteria
			if(Array.isArray(z_child)) {
				let k_select = null;

				// test each one
				for(let k_option of z_child) {
					// this is the one; select it
					if(k_option.test(h_attrs)) {
						k_select = k_option;
						break;
					}
				}

				// nothing was selected; skip xml element
				if(!k_select) {
					// tag is same as current node
					if(s_tag === k_node.tag) {
						// push so we don't get confused when popping
						a_stack.push(k_node);

						// don't search this node
						k_node = {
							tag: s_tag,
						};
					}

					return;
				}

				// apply selection
				z_child = k_select;
			}

			// push node to stack
			a_stack.push(k_node);

			// traverse to child
			k_node = z_child;

			// save tag
			k_node.tag = s_tag;

			// enter child
			if(k_node.enter) {
				k_node.enter(h_attrs);

				// let h_context = {...a_contexts[0]};
				// k_node.enter(h_attrs, h_context);
				// a_contexts.push(h_context);
			}
		}
		// element was not found in children but it should be there
		else if(k_node.exclusive) {
			throw new Error(`expected to encounter one of: [${Object.keys(k_node.children).map(s => `'${s}'`).join(', ')}]; instead found '${s_tag}'`);
		}
		// skip descendents
		else {
			// push node to stack
			a_stack.push(k_node);

			// traverse to child
			k_node = {tag:s_tag};

			// skip its descdendents
			b_skip = true;
		}
	},

	closetag(s_tag) {
		// actual element
		if(s_tag === k_node.tag) {
			// node has exit handler
			if(k_node.exit) k_node.exit();

			// // pop context off stack
			// a_contexts.pop();

			// pop state from stack
			k_node = a_stack.pop();

			// no more skips
			b_skip = false;
		}
	},

	text(s_text) {
		if(k_node.text) k_node.text(s_text);
	},

	error(e_parse) {
		throw e_parse;
	},

	finish() {
		// close output
		k_writer.end();
	},
};


// bind events
for(let [s_event, f_event] of Object.entries(h_events)) {
	y_parser.on(s_event, f_event);
}

// download xmi spec from OMG; pipe into parser
process.stdin
	.pipe(y_parser);

