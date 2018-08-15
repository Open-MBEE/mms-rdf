const request = require('request');

class endpoint {
	constructor(gc_endpoint) {
		let {
			url: p_endpoint,
			prefixes: h_prefixes={},
		} = gc_endpoint;

		Object.assign(this, {
			url: p_endpoint,
			prefixes: h_prefixes,
		});
	}

	static request(g_request) {
		return new Promise((fk_response, fe_response) => {
			request(g_request, (e_req, d_res, g_body) => {
				// network error
				if(e_req) {
					fe_response(e_req);
				}

				// non-200 response
				if(200 !== d_res.statusCode || '200 OK' !== g_body.status) {
					fe_response(new Error(`non 200 response: `+g_body));
				}

				// okay; callback
				fk_response(g_body);
			});
		});
	}

	async query(z_query) {
		// query argument is a string
		if('string' === typeof z_query) {
			// 'cast' to string
			let s_query = z_query;

			// submit POST request to endpoint
			let w_response = await endpoint.request({
				method: 'POST',
				uri: this.url,
				form: {
					query: s_query.replace(/\n/g, ' '),
				},
				gzip: true,
				headers: {
					accept: 'application/sparql-results+json',
				},
			}).catch((e_query) => {
				throw e_query;
			});

			debugger;
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
				uri: this.url,
				body: `update=${s_update}`,
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
