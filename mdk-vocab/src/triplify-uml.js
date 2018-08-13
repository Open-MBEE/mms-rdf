// const fs = require('fs');
const assert = require('assert');
const expect = (z_expected, z_actual) => assert.equal(z_actual, z_expected);

const ttl_write = require('@graphy-dev/content.ttl.write');
const xml_parser = require('node-xml-stream-parser');

const gc_app = require('./config.js');

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
let s_package;
let s_class;
let sct_element;
let sct_property;

// sub-tree
let h_map_class_children = {
	ownedAttribute: {
		enter(h_attrs) {
			// set property iri
			sct_property = `mdkp:${h_attrs.name}`;

			// add triples about property
			k_writer.add({
				[sct_property]: {
					'xmi:type': 'uml:Property',
					'xmi:id': '"'+h_attrs['xmi:id'],
					'mdko:key': '"'+h_attrs.name,
					'rdfs:domain': 'mdki:'+s_class,
				},
			});
		},

		children: {
			type: {
				enter(h_attrs) {
					// add range restriction to property
					k_writer.add({
						[sct_property]: {
							'rdfs:range': '>'+h_attrs.href,
						},
					});
				},
			},

			ownedComment: {
				enter(h_attrs) {
					// add comment to property
					k_writer.add({
						[sct_property]: {
							'rdfs:comment': '@en"'+h_attrs.body,
						},
					});
				},

				// annotatedElement: {},
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

						// add prefix mapping to writer
						k_writer.add_prefixes({
							[s_prefix_id]: s_value,
						});
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
								s_package = h_attrs.name;
							},

							children: {
								packagedElement: [{
									test: h => 'uml:Class' === h['xmi:type'],

									enter(h_attrs) {
										expect('uml:Class', h_attrs['xmi:type']);

										// class name
										s_class = h_attrs.name;
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

// stack of ancestors
let a_stack = [];

// event handler struct
let h_events = {
	opentag(s_tag, h_attrs) {
		// no children defs, this one; skip
		if(!k_node.children) return;

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
			if(k_node.enter) k_node.enter(h_attrs);
		}
		// element was not found in children but it should be there
		else if(k_node.exclusive) {
			throw new Error(`expected to encounter one of: [${Object.keys(k_node.children).map(s => `'${s}'`).join(', ')}]; instead found '${s_tag}'`);
		}
	},

	closetag(s_tag) {
		// actual element
		if(s_tag === k_node.tag) {
			// node has exit handler
			if(k_node.exit) k_node.exit();

			// pop state from stack
			k_node = a_stack.pop();
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

