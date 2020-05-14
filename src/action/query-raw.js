const sparql_results_read = require('@graphy-dev/content.sparql_results.read');

const endpoint = require('../class/endpoint.js');
const G_CONFIG = require('../../config.js');

let h_prefixes = G_CONFIG.prefixes;

let k_endpoint = new endpoint({
	url: process.env.MMS_SPARQL_ENDPOINT,
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
			let g_response = await k_endpoint.query({
				sparql: s_input,
			});

			return new Promise((fk_process) => {
				let s_border = '-'.repeat(80);

				// binding results
				sparql_results_read({
					input: {object:g_response.results},
				})
					.on('data', (h_row) => {
						console.log(s_border);
						for(let s_key in h_row) {
							console.log(`${s_key}:`.padEnd(10, ' ')+` ${h_row[s_key].terse(h_prefixes)}`);
						}
					})
					.on('end', () => {
						console.log(s_border);

						// done w/ promise
						fk_process();
					});
			});
		})();
	});
