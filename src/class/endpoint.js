const ProxyableHttpClient = require('./http-client.js').ProxyableHttpClient;

const chalk = require('chalk');

const stream = require('stream');
const {parser:json_parser} = require('stream-json');
const {pick:json_filter_pick} = require('stream-json/filters/Pick');
const {streamArray:json_stream_array} = require('stream-json/streamers/StreamArray');


const K_GLOBAL_CLIENT = new ProxyableHttpClient({
	proxy: process.env.SPARQL_PROXY,
});

class QueryResponse {
	constructor(y_res) {
		this._y_res = y_res;
	}

	async rows() {
		let a_rows = [];

		for await (let g_row of this) {
			a_rows.push(g_row);
		}

		return a_rows;
	}
}

class StreamingQueryResponse extends QueryResponse {
	async* [Symbol.asyncIterator]() {
		// // parse json and stream into object format
		let ds_stream = stream.pipeline(...[
			this._y_res,
			json_parser(),
			json_filter_pick({filter:'results.bindings'}),
			json_stream_array(),
			(e_parse) => {
				if(e_parse) {
					debugger;
					throw e_parse;
				}
			},
		]);

		for await (let g_item of ds_stream) {
			yield g_item.value;
		}
	}
}

class PreParsedQueryResponse extends QueryResponse {
	async* [Symbol.asyncIterator]() {
		for(let g_item of this._y_res.body.results.bindings) {
			yield g_item;
		}
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
		let s_query;
		let g_headers = {};

		// query argument is a string
		if('string' === typeof z_query) {
			// 'cast' to string
			s_query = z_query;
		}
		// query argument is object (and not null)
		else if(z_query && 'object' === typeof z_query) {
			// destructure
			({
				sparql: s_query,
				headers: g_headers={},
			} = z_query);
		}
		// not supported
		else {
			throw new TypeError('invalid argument type for query');
		}

		// submit POST request to endpoint
		return new PreParsedQueryResponse(await this._k_client
			.request({
				method: 'POST',
				url: `${this._p_url}/sparql`,
				form: {
					query: Endpoint$prefix_string(this)+s_query,
				},
				headers: {
					...(g_headers || {}),
				},
				responseType: 'json',
			}));
	}


	async update(z_update) {
		// update argument is a string
		if('string' === typeof z_update) {
			// 'cast' to string
			let s_update = z_update;

			// submit POST request to endpoint
			return new PreParsedQueryResponse(await this._k_client
				.stream({
					method: 'POST',
					url: `${this._p_url}/sparql`,
					form: {
						update: Endpoint$prefix_string(this)+s_update,
					},
					// gzip: true,
					headers: {
						accept: 'application/sparql-results+json',
					},
				}));
		}
		// not supported
		else {
			throw new TypeError('invalid argument type for update');
		}
	}

	async post(g_post) {
		return await this._k_client.stream({
			method: 'POST',
			// gzip: true,
			url: `${this._p_url}/data`,
			...g_post,
			headers: {
				...g_post.headers,
			},
		});
	}
}

module.exports = Endpoint;
