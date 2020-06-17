const url = require('url');

const stream = require('stream');
const got = require('got');
const chalk = require('chalk');
const SocksProxyAgent = require('socks-proxy-agent');
// const HttpAgent = require('agentkeepalive');
// const HttpsAgent = HttpAgent.HttpsAgent;

const HttpAgent = require('http').Agent;
const HttpsAgent = require('https').Agent;

const N_MAX_REQUESTS = parseInt(process.env.HTTP_MAX_REQUESTS || 128);

const G_AGENT_DEFAULT = {
	maxSockets: parseInt(process.env.HTTP_MAX_SOCKETS || 64),
	// keepAlive: true,
	// timeout: 60000,
};

function proxy_agent(p_proxy, g_agent=G_AGENT_DEFAULT) {
	// parse proxy url
	let du_proxy = new url.URL(p_proxy);

	// create proxy agent
	return new SocksProxyAgent({
		host: du_proxy.hostname,
		port: du_proxy.port,
		...g_agent,
	});
}

function HttpClient$request(k_self, g_request, b_stream=false) {
	let a_queue = k_self._a_queue;

	let mk_req = b_stream
		? () => k_self._f_request.stream(g_request)
			.on('response', (ds_res) => {
				// on socket close
				ds_res.on('close', () => {
					// decrement request counter
					k_self._c_requests -= 1;

					// next on queue
					if(a_queue.length) {
						a_queue.shift()();
					}
				});
			})
			.on('error', (e_req) => {
				debugger;

				// non-200 response
				if(e_req.response) {
					throw new Error(`non 200 response: ${e_req.status}\n${chalk.red(e_req.data)}\n${g_request.form && g_request.form.query}`);
				}

				throw e_req;
			})
		: () => k_self._f_request(g_request);

	// console.warn(`${c_requests} open requests`);
	return new Promise((fk_response) => {
		if(++k_self._c_requests >= k_self._n_max_requests) {
			a_queue.push(() => {
				fk_response(mk_req());
			});
		}
		else {
			fk_response(mk_req());
		}
	});
}

class HttpClient {
	constructor(gc_client={}) {
		let {
			max_requests: n_max_requests=N_MAX_REQUESTS,
			base_url: p_base='',
		} = gc_client;

		this._f_request = got.extend({
			prefixUrl: p_base || '',
			agent: {
				http: new HttpAgent(),
				https: new HttpsAgent(),
			},
		});

		// this._f_request_stream = this._f_request;

		this._n_max_requests = n_max_requests;
		this._a_queue = [];
		this._c_requests = 0;
	}

	stream(g_request) {
		return HttpClient$request(this, g_request, true);
	}

	request(g_request) {
		return HttpClient$request(this, g_request, false);
	}
}

class HttpClientProxy extends HttpClient {
	constructor(p_proxy, gc_client={}) {
		super(gc_client);

		let {
			max_requests: n_max_requests=N_MAX_REQUESTS,
		} = gc_client;

		let d_agent_proxy_socks = proxy_agent(p_proxy, {
			maxSockets: n_max_requests,
		});

		this._f_request = got.extend({
			agent: {
				http: d_agent_proxy_socks,
				https: d_agent_proxy_socks,
			},
		});
	}
}

module.exports = Object.assign(HttpClient, {
	ProxyableHttpClient: function(gc_client) {
		if(gc_client.proxy) {
			return new HttpClientProxy(gc_client.proxy, gc_client);
		}
		else {
			return new HttpClient(gc_client);
		}
	},
	agent: p_proxy => p_proxy
		? proxy_agent(p_proxy, {
			maxSockets: N_MAX_REQUESTS,
		})
		: new HttpsAgent(),
});
