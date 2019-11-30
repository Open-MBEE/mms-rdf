const fs = require('fs');
const factory = require('@graphy/core.data.factory');

const Endpoint = require('../class/endpoint.js');

const gc_app = require('../../config.js');
const H_PREFIXES = gc_app.prefixes;

const c1t = sc1 => factory.c1(sc1, H_PREFIXES).terse(H_PREFIXES);
const t1 = g => factory.from.sparql_result(g).terse(H_PREFIXES);


let k_endpoint = new Endpoint({
	url: process.env.NEPTUNE_ENDPOINT,
	prefixes: H_PREFIXES,
});

let ds_shexc = process.stdout;
let ds_shape_map = fs.createWriteStream(null, {fd:3});

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


async function uml_class_properties(p_class, si_class) {
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

	// shape
	let st1_shape = c1t(`mms-shape:${si_class}`);

	// constraint list
	let a_constraints = [];

	// each property
	for await (let g_row of dpg_query) {
		// no alias
		if(!g_row.alias) continue;

		let sxs_constraint = t1(g_row.alias? g_row.alias: g_row.property)+' ';

		// datatype property
		if(g_row.range_primitive_type) {
			sxs_constraint += t1(g_row.range_primitive_type);
		}
		// object property
		else {
			sxs_constraint += '@'+c1t(`mms-shape:${t1(g_row.list_item_range || g_row.range).replace(/^uml-class:/, '')}`);
		}

		// multuplicity
		sxs_constraint += g_row.multiplicity? multiplicity(g_row.multiplicity.value): '';

		// add constraint
		a_constraints.push(sxs_constraint+' ;');
	}

	// constraints exist
	if(a_constraints.length) {
		// shexc string
		return {
			shexc: gobble(`
				${st1_shape} {
					${a_constraints.join('\n\t')}
				}
			`)+'\n\n',
			map: gobble(`
				{ FOCUS a <${H_PREFIXES['uml-class']}${si_class}> }@${H_PREFIXES['mms-shape']}${si_class},
			`)+'\n',
		};
	}
}


(async() => {
	// initial shexc doc
	ds_shexc.write(
		Object.entries(H_PREFIXES)
			.reduce((s_out, [si_prefix, p_iri]) => s_out+gobble(`
				prefix ${si_prefix}: <${p_iri}>
			`)+'\n', ''));

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
		}
	}

	// close output
	ds_shexc.end();
	ds_shape_map.end();
})();
