const N_MAX_REQUESTS = parseInt(process.env.MMS_MAX_REQUESTS || 128);

const request = require('../util/request.js');

const {parser:json_parser} = require('stream-json');
const {pick:json_filter_pick} = require('stream-json/filters/Pick');
const {streamArray:json_stream_array} = require('stream-json/streamers/StreamArray');

class HttpClient {
	constructor(gc_client={}) {
		let {
			max_requests: n_max_requests=N_MAX_REQUESTS,
		} = gc_client;

		this._f_request = request.defaults({
			https: process.env.MMS_SPARQL_ENDPOINT.startsWith('https'),
			maxSockets: n_max_requests,
		});

		this._n_max_requests = n_max_requests;
		this._a_queue = [];
		this._c_requests = 0;
	}

	request(g_request) {
		let a_queue = this._a_queue;

		let mk_req = () => this._f_request(g_request)
			.on('error', (e_req) => {
				debugger;
				// console.error(e_req);
			})
			.on('response', async(d_res) => {
				let xc_status = d_res.statusCode;

				// non-200 response
				if(xc_status < 200 || xc_status >= 300) {
					let s_body = '';
					for await (let s_chunk of d_res) {
						s_body += s_chunk;
					}

					throw new Error(`non 200 response: ${JSON.stringify(d_res.statusCode)}\n${s_body}\n${g_request.form && g_request.form.query}`);
				}

				// once the connection is closed
				d_res.on('close', () => {
					// decrement request counter
					this._c_requests -= 1;

					// next on queue
					if(a_queue.length) {
						a_queue.shift()();
					}
				});
			});

		// console.warn(`${c_requests} open requests`);
		return new Promise((fk_response) => {
			if(++this._c_requests >= this._n_max_requests) {
				a_queue.push(() => {
					fk_response(mk_req());
				});
			}
			else {
				fk_response(mk_req());
			}
		});
	}
}

const K_GLOBAL_CLIENT = new HttpClient();


class QueryResponse {
	constructor(ds_res) {
		this._ds_res = ds_res;
	}

	async* [Symbol.asyncIterator]() {
		// parse json and stream into object format
		let ds_stream = this._ds_res
			.pipe(json_parser())
			.pipe(json_filter_pick({filter:'results.bindings'}))
			.pipe(json_stream_array())
			.on('error', (e_query) => {
				throw e_query;
			});

		for await (let g_item of ds_stream) {
			yield g_item.value;
		}
	}

	async rows() {
		let a_rows = [];

		for await (let g_row of this) {
			a_rows.push(g_row);
		}

		return a_rows;
	}
}


function Endpoint$prefix_string(k_self) {
	if(k_self._s_cached_prefix_string) return k_self._s_cached_prefix_string;

	let s_out = '';
	for(let [si_prefix, p_prefix] of Object.entries(k_self._h_prefixes)) {
		s_out += `PREFIX ${si_prefix}: <${p_prefix}> `;
	}

	return (k_self._s_cached_prefix_string = s_out);
}

class Endpoint {
	constructor(gc_endpoint) {
		let {
			url: p_endpoint,
			prefixes: h_prefixes={},
			client: k_client=K_GLOBAL_CLIENT,
		} = gc_endpoint;

		this._p_url = p_endpoint.replace(/\/$/, '');
		this._h_prefixes = h_prefixes;
		this._k_client = k_client;
	}

	async query(z_query) {
		// query argument is a string
		if('string' === typeof z_query) {
			// 'cast' to string
			let s_query = z_query;

			// submit POST request to endpoint
			return new QueryResponse(await this._k_client
				.request({
					method: 'POST',
					uri: `${this._p_url}/sparql`,
					form: {
						query: Endpoint$prefix_string(this)+s_query,
					},
					gzip: true,
					headers: {
						accept: 'application/sparql-results+json',
					},
					json: true,
				}));
		}
		// query argument is object (and not null)
		else if(z_query && 'object' === typeof z_query) {
			// 'cast' to object
			let g_query = z_query;

			// submit POST request to endpoint
			return new QueryResponse(await this._k_client
				.request({
					method: 'POST',
					uri: `${this._p_url}/sparql`,
					form: {
						query: Endpoint$prefix_string(this)+z_query.sparql,
					},
					gzip: true,
					headers: {
						...(g_query.headers || {}),
					},
				}));
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
			return new QueryResponse(await this._k_client
				.request({
					method: 'POST',
					uri: `${this._p_url}/update`,
					form: {
						update: Endpoint$prefix_string(this)+s_update,
					},
					gzip: true,
					headers: {
						accept: 'application/sparql-results+json',
					},
					json: true,
				}));
		}
		// not supported
		else {
			throw new TypeError('invalid argument type for update');
		}
	}

	async post(g_post) {
		return await this._k_client.request({
			method: 'POST',
			gzip: true,
			uri: `${this._p_url}/data`,
			...g_post,
			headers: {
				...g_post.headers,
			},
		});
	}
}

module.exports = Endpoint;
