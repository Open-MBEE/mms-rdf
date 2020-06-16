const factory = require('@graphy/core.data.factory');

const endpoint = require('../class/endpoint.js');
const G_CONFIG = require('../../config.js');

let h_prefixes = G_CONFIG.prefixes;

let k_endpoint = new endpoint({
	url: process.env.SPARQL_ENDPOINT,
	prefixes: h_prefixes,
});

let s_input = '';
let ds_input = process.stdin;
ds_input.setEncoding('utf8');
ds_input
	.on('data', (s_chunk) => {
		s_input += s_chunk;
	})
	.on('end', () => {
		(async function() {
			console.warn(s_input);

			let s_border = '-'.repeat(80);

			let dpg_query = await k_endpoint.query(s_input);

			for await (let h_row of dpg_query) {
				console.log(s_border);
				for(let s_key in h_row) {
					console.log(`${s_key}:`.padEnd(10, ' ')+` ${factory.from.sparql_result(h_row[s_key]).terse(h_prefixes)}`);
				}
			}
		})();
	});
