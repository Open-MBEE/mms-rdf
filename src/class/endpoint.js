const socks_agent = require('socks5-http-client/lib/Agent');
const request = require('request').defaults({
	agentClass: socks_agent,
	agentOptions: {
		socksHost: 'localhost',
		socksPort: 3031,
	},
	pool: {
		maxSockets: 64,
	},
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
		return new Promise((fk_response, fe_response) => {
			request(g_request, (e_req, d_res, g_body) => {
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
					query: this.prefix_string()+s_query.replace(/[\n\t]+/g, ' '),
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
					update: this.prefix_string()+s_update.replace(/[\n\t]+/g, ' '),
				},
				gzip: true,
				headers: {
					accept: 'application/sparql-results+json',
				},
				json: true,
			}).catch((e_query) => {
				throw e_query;
			});

			debugger;
			return w_response;
		}
		// not supported
		else {
			throw new TypeError('invalid argument type for update');
		}
	}
}

module.exports = endpoint;
