const endpoint = require('../class/endpoint.js');
const G_CONFIG = require('../../config.js');

let s_graph = process.argv[2];

let k_endpoint = new endpoint({
	url: process.env.SPARQL_ENDPOINT,
});

(async function() {
	await k_endpoint.update(`clear silent ${s_graph
		? `graph <${G_CONFIG.prefixes['mms-graph']}${s_graph}>`
		: 'all'
	}`);
})();
