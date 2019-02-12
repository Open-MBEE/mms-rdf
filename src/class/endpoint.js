const proxy_agent = require('proxy-agent');


// some module within proxy-agent is not respecting the maxSockets option for agent
const N_MAX_REQUESTS = 128;
let c_requests = 0;
let a_queue = [];

const request = require('request').defaults({
	agent: new proxy_agent({
		protocol: 'socks:',
		host: '127.0.0.1',
		port: 3031,
		maxSockets: N_MAX_REQUESTS,
	}),
});


class endpoint {
	constructor(gc_endpoint) {
		let {
			url: p_endpoint,
			prefixes: h_prefixes={},
		} = gc_endpoint;

		Object.assign(this, {
			url: p_endpoint.replace(/\/$/, ''),
			prefixes: h_prefixes,
		});
	}

	static request(g_request) {
		let mk_req = () => new Promise((fk_response, fe_response) => {
			request(g_request, (e_req, d_res, g_body) => {
				c_requests -= 1;

				// next on queue
				if(a_queue.length) {
					a_queue.shift()();
				}

				// network error
				if(e_req) {
					return fe_response(e_req);
				}

				// non-200 response
				if(200 !== d_res.statusCode) {
					return fe_response(new Error(`non 200 response: ${JSON.stringify(g_body)}`));
				}

				// okay; callback
				fk_response(g_body);
			});
		});

		if(++c_requests >= N_MAX_REQUESTS) {
			return new Promise((fk_response) => {
				a_queue.push(async() => {
					fk_response(await mk_req());
				});
			});
		}
		else {
			return mk_req();
		}
	}

	prefix_string() {
		if(this.cached_prefix_string) return this.cached_prefix_string;

		let s_out = '';
		for(let [si_prefix, p_prefix] of Object.entries(this.prefixes)) {
			s_out += `PREFIX ${si_prefix}: <${p_prefix}> `;
		}

		return (this.cached_prefix_string = s_out);
	}

	async query(z_query) {
		// query argument is a string
		if('string' === typeof z_query) {
			// 'cast' to string
			let s_query = z_query;

			// submit POST request to endpoint
			let w_response = await endpoint.request({
				method: 'POST',
				uri: `${this.url}/sparql`,
				form: {
					query: this.prefix_string()+s_query,
				},
				gzip: true,
				headers: {
					accept: 'application/sparql-results+json',
				},
				json: true,
			}).catch((e_query) => {
				throw e_query;
			});

			return w_response;
		}
		// not supported
		else {
			throw new TypeError('invalid argument type for query');
		}
	}

	async update(z_update) {
		// update argument is a string
		if('string' === typeof z_update) {
			// 'cast' to string
			let s_update = z_update;

			// submit POST request to endpoint
			let w_response = await endpoint.request({
				method: 'POST',
				uri: `${this.url}/sparql`,
				form: {
					update: this.prefix_string()+s_update,
				},
				gzip: true,
				headers: {
					accept: 'application/sparql-results+json',
				},
				json: true,
			}).catch((e_query) => {
				throw e_query;
			});

			return w_response;
		}
		// not supported
		else {
			throw new TypeError('invalid argument type for update');
		}
	}
}

module.exports = endpoint;
