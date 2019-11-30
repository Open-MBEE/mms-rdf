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

// write c3 shortcut
const write_c3 = hc3 => k_writer.write({type:'c3', value:hc3});

// pipe to stdout
k_writer.pipe(process.stdout);

// create streaming xml parser
let y_parser = new xml_parser();

/*
	xmi:type rdfs:subPropertyOf rdf:type .
*/

// state variables
let sc1_package;
let sc1_class;
let sc1_element;
let sfx_property;
let sc1_property;

let g_multiplicity = {
	lowerValue: '',
	upperValue: '',
};

// const escape_suffix = s_suffix => s_suffix.replace(/-/g, '_');
const escape_suffix = s => s;
const class_term = s_id => `uml:${s_id.replace(/^uml:/, '')}`;
const remap_uml_spec_version = p_iri => p_iri.replace(/^http:\/\/www\.omg\.org\/spec\/UML\/20131001/, 'https://www.omg.org/spec/UML/20161101');

// sub-tree
let h_map_class_children = {
	// class hierarchy
	generalization: {
		enter(h_attrs) {
			// extends superclass
			if('uml:Generalization' === h_attrs['xmi:type']) {
				write_c3({
					[sc1_class]: {
						'rdfs:subClassOf': `uml-class:${h_attrs.general}`,
					},
				});
			}
		},
	},

	// comments
	ownedComment: {
		enter(h_attrs) {
			if('uml:Comment' === h_attrs['xmi:type'] && 'body' in h_attrs) {
				write_c3({
					[sc1_class]: {
						'rdfs:comment': `@en"${h_attrs.body}`,
					},
				});
			}
		},
	},

	// properties
	ownedAttribute: {
		enter(h_attrs) {
			g_multiplicity.lowerValue = '1';
			g_multiplicity.upperValue = '1';

			// set property term
			sfx_property = escape_suffix(h_attrs['xmi:id']);
			sc1_property = `uml-property:${sfx_property}`;

			// pairs to append
			let h_pairs = {};

			// 'composite aggretation'
			if('composite' === h_attrs.aggregation) {
				h_pairs['uml-model:compositeAggregation'] = true;
			}

			// ordered
			if(h_attrs.isOrdered) {
				h_pairs['uml-model:ordered'] = factory.boolean(h_attrs.isOrdered);
			}

			// 'type of owned attribute' describes range of relation
			if(h_attrs.type) {
				h_pairs['rdfs:range'] = `uml-class:${h_attrs.type}`;
			}

			// add triples about property
			write_c3({
				[sc1_property]: {
					'xmi:type': 'uml:Property',
					'xmi:id': '"'+h_attrs['xmi:id'],
					'xmi:ownedAttributeOf': sc1_class,
					'rdfs:label': '"'+h_attrs['xmi:id'],
					'uml-model:name': '"'+h_attrs.name,
					'rdfs:domain': sc1_class,
					...h_pairs,
				},
			});
		},

		exit() {
			write_c3({
				[sc1_property]: {
					'uml-model:multiplicity': `^uml-model-dt:multiplicityRange"${g_multiplicity.lowerValue}..${g_multiplicity.upperValue}`,
				},
			});
		},

		children: {
			type: {
				enter(h_attrs) {
					// add range restriction to property
					write_c3({
						[sc1_property]: {
							'rdfs:range': '>'+remap_uml_spec_version(h_attrs.href),
						},
					});
				},
			},

			ownedComment: {
				enter(h_attrs) {
					// add comment to property
					write_c3({
						[sc1_property]: {
							'rdfs:comment': '@en"'+h_attrs.body,
						},
					});
				},

				// annotatedElement: {},
			},

			subsettedProperty: {
				enter(h_attrs) {
					write_c3({
						[sc1_property]: {
							'uml-model:subsettedProperty': `uml-property:${escape_suffix(h_attrs['xmi:idref'])}`,
						},
					});
				},
			},

			...['lowerValue', 'upperValue'].reduce((h_out, s_tag) => ({
				...h_out,
				[s_tag]: {
					enter(h_attrs) {
						g_multiplicity[s_tag] = h_attrs.value || '0';
					},
				},
			})),

			defaultValue: {
				enter(h_attrs) {
					let sc1_default_value = `uml-class:${h_attrs['xmi:id']}`;

					write_c3({
						[sc1_default_value]: {
							'xmi:type': class_term(h_attrs['xmi:type']),
							'xmi:id': '"'+h_attrs['xmi:id'],
							...('value' in h_attrs
								? {'uml-model:value':'"'+h_attrs.value}
								: {}),
						},
						[sc1_property]: {
							'xmi:defaultValue': sc1_default_value,
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
				// schema type mappings
				'mofext:Tag': [{
					test: h => 'org.omg.xmi.schemaType' === h.name,

					enter(h_attrs) {
						expect('mofext:Tag', h_attrs['xmi:type']);

						write_c3({
							[`uml-primitives:${h_attrs.element}`]: {
								'uml-model:primitiveTypeEquivalent': '>'+h_attrs.value,
							},
						});
					},
				}],

				// uml package
				'uml:Package': {
					children: {
						packagedElement: [
							// uml package
							{
								test: h => 'uml:Package' === h['xmi:type'],

								enter(h_attrs) {
									expect('uml:Package', h_attrs['xmi:type']);

									// package name
									sc1_package = `uml-class:${h_attrs['xmi:id']}`;

									write_c3({
										[sc1_package]: {
											'xmi:type': 'uml:Package',
											'xmi:id': '"'+h_attrs['xmi:id'],
										},
									});
								},

								children: {
									packagedElement: [{
										test: h => 'uml:Class' === h['xmi:type'],

										enter(h_attrs) {
											expect('uml:Class', h_attrs['xmi:type']);

											// class
											sc1_class = `uml-class:${h_attrs['xmi:id']}`;

											write_c3({
												[sc1_class]: {
													'xmi:type': 'uml:Class',
													'xmi:id': '"'+h_attrs['xmi:id'],
													'xmi:packagedElementOf': sc1_package,
												},
											});
										},

										children: h_map_class_children,
									}],
								},
							},

							// primitive types map
							{
								test: h => 'uml:PrimitiveType' === h['xmi:type'],

								enter(h_attrs) {
									expect('uml:PrimitiveType', h_attrs['xmi:type']);

									// package name
									sc1_package = `uml-primitives:${h_attrs['xmi:id']}`;

									write_c3({
										[sc1_package]: {
											'xmi:type': 'uml-class:PrimitiveType',
											'xmi:id': '"'+h_attrs['xmi:id'],
										},
									});
								},

								children: {
									// comments
									ownedComment: {
										children: {
											body: {
												text(s_text) {
													write_c3({
														[sc1_package]: {
															'rdfs:comment': `@en"${s_text}`,
														},
													});
												},
											},
										},
									},
								},
							},
						],
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

