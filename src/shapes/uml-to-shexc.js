const fs = require('fs');
const factory = require('@graphy/core.data.factory');
const ttl_writer = require('@graphy/content.ttl.write');

const Endpoint = require('../class/endpoint.js');

const gc_app = require('../../config.js');
const H_PREFIXES = gc_app.prefixes;

const c1t = sc1 => factory.c1(sc1, H_PREFIXES).terse(H_PREFIXES);
const t1 = g => factory.from.sparql_result(g).terse(H_PREFIXES);


let k_endpoint = new Endpoint({
	url: process.env.SPARQL_ENDPOINT,
	prefixes: H_PREFIXES,
});

let ds_shexc = process.stdout;
let ds_shape_map = fs.createWriteStream(null, {fd:3});
let ds_shacl = ttl_writer({
	prefixes: H_PREFIXES,
});

ds_shacl.pipe(fs.createWriteStream(null, {fd:4}));

const gobble = (s_text) => {
	let m_indent = /^(?:\s*\n)+([ \t]*)/.exec(s_text);
	if(m_indent) {
		let r_indent = new RegExp('\\n'+m_indent[1], 'g');
		return s_text.trim().replace(r_indent, '\n');
	}
	else {
		return s_text;
	}
};

function multiplicity(s_range) {
	switch(s_range) {
		case '0..1': return '?';

		case undefined:  // eslint-disable-line no-undefined
		case '':
		case '1..1': return '';

		case '0..*': return '*';

		case '1..*': return '+';

		default: {
			let m_range = /^([^.]+)\.\.([^.]+)$/.exec(s_range);

			return `{${m_range[1]},${m_range[2]}}`;
		}
	}
}

function shacl_multiplicity(s_range) {
	switch(s_range) {
		case '0..1': return {
			'shacl:minCount': 0,
			'shacl:maxCount': 1,
		};

		case undefined:  // eslint-disable-line no-undefined
		case '':
		case '1..1': return {
			'shacl:minCount': 1,
			'shacl:maxCount': 1,
		};

		case '0..*': return {
			'shacl:minCount': 0,
		};

		case '1..*': return {
			'shacl:minCount': 1,
		};

		default: {
			let m_range = /^([^.]+)\.\.([^.]+)$/.exec(s_range);

			return {
				'shacl:minCount': +m_range[1],
				...('*' !== m_range[2]
					? {'shacl:maxCount':+m_range[2]}
					: {}),
			};
		}
	}
}


function from_uml_class(s_prefix, g_sparql_result) {
	return c1t(`${s_prefix}:${t1(g_sparql_result).replace(/^uml-class:/, '')}`)
}

async function uml_class_properties(p_class, si_class) {
	// shape
	let st1_shape = c1t(`mms-shape:${si_class}`);

	// supers list
	let a_supers = [];

	// constraint list
	let a_constraints = [];

	// query uml model for all superproperties this this property depends on
	let dpg_supers = await k_endpoint.query(/* syntax: sparql */ `
		select * {
			?class rdfs:subClassOf ?super .

			values ?class {
				${factory.namedNode(p_class).verbose()}
			}
		}
	`);

	// each super class
	for await(let g_row of dpg_supers) {
		a_supers.push(g_row.super);
	}

	// query uml model for all properties that use this uml name
	let dpg_query = await k_endpoint.query(/* syntax: sparql */ `
		select * {
			?property xmi:type uml:Property ;
				xmi:id ?id ;
				rdfs:domain ?class ;
				rdfs:range ?range ;
				uml-model:name ?name ;
				.

			optional {
				?alias mms-ontology:umlPropertySource ?property .

				optional {
					?alias mms-ontology:listItemRange ?list_item_range
				}
			}

			optional {
				?property uml-model:multiplicity ?multiplicity .
			}

			optional {
				?range uml-model:primitiveTypeEquivalent ?range_primitive_type .
			}

			optional {
				?property uml-model:compositeAggregation ?composite .
			}

			optional {
				?property uml-model:isOrdered ?ordered .
			}

			values ?class {
				${factory.namedNode(p_class).verbose()}
			}
		}
	`);

	const ac3s_properties = [];

	// each property
	for await (let g_row of dpg_query) {
		// no alias
		if(!g_row.alias) continue;

		let sxs_constraint = t1(g_row.alias? g_row.alias: g_row.property)+' ';

		let hc2_property = {
			'shacl:path': t1(g_row.alias? g_row.alias: g_row.property),
		};

		ac3s_properties.push(hc2_property);

		// datatype property
		if(g_row.range_primitive_type) {
			sxs_constraint += t1(g_row.range_primitive_type);

			hc2_property['shacl:datatype'] = t1(g_row.range_primitive_type);
		}
		// object property
		else {
			sxs_constraint += '@'+from_uml_class('mms-shape', g_row.list_item_range || g_row.range);

			hc2_property['shacl:class'] = t1(g_row.list_item_range || g_row.range);
		}

		// multuplicity
		sxs_constraint += g_row.multiplicity? multiplicity(g_row.multiplicity.value): '';

		Object.assign(hc2_property, shacl_multiplicity(g_row.multiplicity.value));

		// add constraint
		a_constraints.push(sxs_constraint+' ;');
	}

	return {
		// shexc string
		shexc: gobble(`
			${st1_shape} ${a_supers.map(s => `extends @${from_uml_class('mms-shape', s)} `).join('')}{
				${a_constraints.length
					? a_constraints.join('\n\t')
					: '# no own properties'}
			}
		`)+'\n\n',

		// shape map
		map: gobble(`
			{ FOCUS a ${c1t('uml-class:'+si_class)} }@${c1t('mms-shape:'+si_class)},
		`)+'\n',

		// shacl
		shacl: {
			[`mms-shape:${si_class}`]: {
				a: 'shacl:NodeShape',
				'shacl:targetClass': `uml-class:${si_class}`,
				'shacl:nodeKind': 'shacl:IRI',
				'shacl:property': ac3s_properties,
			},
		},
	};
}


(async() => {
	// initial shexc doc
	ds_shexc.write(
		Object.entries(H_PREFIXES)
			.reduce((s_out, [si_prefix, p_iri]) => s_out+gobble(`
				prefix ${si_prefix}: <${p_iri}>
			`)+'\n\n', ''));

	// query uml model for all properties that use this uml name
	let dpg_query = await k_endpoint.query(/* syntax: sparql */ `
		select * {
			?class xmi:type uml:Class ;
				xmi:id ?id ;
				.
		}
	`);

	// each class from uml model
	for await (let g_row of dpg_query) {
		// build shexc string
		let g_write = await uml_class_properties(g_row.class.value, g_row.id.value);

		if(g_write) {
			// write to outputs
			ds_shexc.write(g_write.shexc);
			ds_shape_map.write(g_write.map);
			ds_shacl.write({
				type: 'c3',
				value: g_write.shacl,
			});
		}
	}

	// close outputs
	ds_shexc.end();
	ds_shape_map.end();
	ds_shacl.end();
})();
