const HttpClient = require('./http-client.js');
// const ProxyableHttpClient = require('./http-client.js').ProxyableHttpClient;

const stream = require('stream');
const {parser:json_parser} = require('stream-json');
const {pick:json_filter_pick} = require('stream-json/filters/Pick');
const {streamArray:json_stream_array} = require('stream-json/streamers/StreamArray');


const K_GLOBAL_CLIENT = new HttpClient({
	// proxy: process.env.SPARQL_PROXY,
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
	constructor(y_res) {
		super(y_res);

		// parse json and stream into object format
		this._ds_stream = stream.pipeline(...[
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
	}

	async* [Symbol.asyncIterator]() {
		for await (let g_item of this._ds_stream) {
			yield g_item.value;
		}
	}
}


function Endpoint$prefix_string(k_self) {
	if(k_self._s_cached_prefix_string) return k_self._s_cached_prefix_string;

	let s_out = '';
	for(let [si_prefix, p_prefix] of Object.entries(k_self._h_prefixes)) {
		s_out += `PREFIX ${si_prefix}: <${p_prefix}> \n`;
	}

	return (k_self._s_cached_prefix_string = s_out);
}

let as_open = new Set();

function normalize_action(z_action) {
	let s_query;
	let g_headers = {};

	// action argument is a string
	if('string' === typeof z_action) {
		// 'cast' to string
		s_query = z_action;
	}
	// action argument is object (and not null)
	else if(z_action && 'object' === typeof z_action) {
		// destructure
		({
			sparql: s_query,
			headers: g_headers={},
		} = z_action);
	}
	// not supported
	else {
		throw new TypeError('invalid argument type for query');
	}

	return {
		sparql: s_query,
		headers: g_headers,
	};
}

async function Endpoint$submit(k_self, g_request) {
	let y_reqres;
	try {
		y_reqres = await k_self._k_client.stream(g_request);
	}
	catch(e_req) {
		debugger;
		console.error(e_req);
		throw e_req;
	}

	return new StreamingQueryResponse(y_reqres);
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
		this._as_open = as_open;
	}

	async query(z_query) {
		let {
			sparql: s_query,
			headers: g_headers,
		} = normalize_action(z_query);

		return await Endpoint$submit(this, {
			method: 'POST',
			url: `${this._p_url}/sparql`,
			headers: {
				accept: 'application/sparql-results+json',
				...(g_headers || {}),
			},
			form: {
				query: Endpoint$prefix_string(this)+s_query,
			},
		});
	}

	async update(z_update) {
		let {
			sparql: s_query,
			headers: g_headers,
		} = normalize_action(z_update);

		return await Endpoint$submit(this, {
			method: 'POST',
			url: `${this._p_url}/sparql`,
			headers: {
				accept: 'application/sparql-results+json',
				...(g_headers || {}),
			},
			form: {
				update: Endpoint$prefix_string(this)+s_query,
			},
		});
	}

	async post(g_post) {
		debugger;

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
