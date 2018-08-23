const endpoint = require('../class/endpoint.js');

let k_endpoint = new endpoint({
	url: process.env.NEPTUNE_ENDPOINT,
});

(async function() {
	await k_endpoint.update(`clear all`);
})();
