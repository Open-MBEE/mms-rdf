const url = require('url');

const got = require('got');
const chalk = require('chalk');
const SocksProxyAgent = require('socks-proxy-agent');
const HttpAgent = require('agentkeepalive');
const HttpsAgent = HttpAgent.HttpsAgent;

// const HttpAgent = require('http').Agent;
// const HttpsAgent = require('https').Agent;

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

class HttpClient {
	constructor(gc_client={}) {
		let {
			max_requests: n_max_requests=N_MAX_REQUESTS,
			base_url: p_base='',
		} = gc_client;

		this._f_request = got.extend({
			prefixUrl: p_base || '',
			agent: {
				// http: new HttpAgent(),
				https: new HttpsAgent({
					maxSockets: n_max_requests,
				}),
			},
		});

		this._n_max_requests = n_max_requests;
		this._a_queue = [];
		this._c_requests = 0;
	}

	stream(g_request) {
		return this._f_request.stream(g_request);
	}

	request(g_request) {
		return this._f_request(g_request);
	}
}



module.exports = Object.assign(HttpClient, {
	agent: p_proxy => p_proxy
		? proxy_agent(p_proxy, {
			maxSockets: N_MAX_REQUESTS,
		})
		: new HttpsAgent(),
});
