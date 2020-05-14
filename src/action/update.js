const once = require('events').once;
const endpoint = require('../class/endpoint.js');
const G_CONFIG = require('../../config.js');

let h_prefixes = G_CONFIG.prefixes;

// async upload method
async function upload(s_prefix, p_graph='', s_upload_format='text/turtle') {
	// assert required environment variables
	if(!process.env.MMS_SPARQL_ENDPOINT) {
		throw new Error(`the following environment variable is either not set or is empty: MMS_SPARQL_ENDPOINT`);
	}

	// ref endpoint
	let k_endpoint = new endpoint({
		url: process.env.MMS_SPARQL_ENDPOINT,
		prefixes: h_prefixes,
	});

	// submit post request graph store protocol
	let g_res = await k_endpoint.post({
		...(p_graph
			? {
				qs: {
					graph: p_graph,
				},
			}
			: {}),
		headers: {
			'content-type': s_upload_format || 'text/turtle',
		},
	});

	// upload file as stream thru request body
	process.stdin.pipe(g_res);

	// await end
	await once(g_res, 'end');
}

// cli
let a_args = process.argv.slice(2);
upload(a_args[0] || 'vocabulary', a_args[1] || '', a_args[2]);
