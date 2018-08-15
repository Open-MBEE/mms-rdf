const json_stream = require('JSONStream');
const ttl_write = require('@graphy-dev/content.ttl.write');

const endpoint = require('./endpoint.js');

const h_prefixes = require('../../config.js').prefixes;

let k_endpoint = new endpoint({
	url: process.env.NEPTUNE_ENDPOINT,
	prefixes: h_prefixes,
});

async function triplify(h_node, k_writer) {
	for(let s_key in h_node) {
		// input: term value
		let s_value = h_node[s_key];

		// output: concise term string of value
		let sct_value;

		// query vocabulary for property definition
		let z_res = await k_endpoint.query(/* syntax: sparql */ `
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

		debugger;
		console.log(z_res);
	}
}


// parse input json
process.stdin
	.pipe(json_stream.parse())
	.on('data', (g_doc) => {
		// create output
		let k_writer = ttl_write({
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
		triplify(g_doc._source, k_writer);
	});
