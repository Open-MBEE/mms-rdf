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

	async query(z_query) {
		// query argument is a string
		if('string' === typeof z_query) {
			// 'cast' to string
			let s_query = z_query;

			// submit POST request to endpoint
			let w_response = await request.post({
				url: this.url,
				body: `query=${s_query}`,
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
			let w_response = await request.post({
				url: this.url,
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
