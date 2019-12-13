const url = require('url');
const http = require('http');
const https = require('https');
const request = require('request');
const proxy_agent = require('proxy-agent');

const G_AGENT_DEFAULT = {
	maxSockets: parseInt(process.env.MMS_MAX_SOCKETS || 64),
};

// some module within proxy-agent is not respecting the maxSockets option for agent

const self = module.exports = {
	http_agent(g_agent=G_AGENT_DEFAULT) {
		// neptune proxy env var set
		if(process.env.NEPTUNE_PROXY) {
			// parse proxy url
			let du_proxy = new url.URL(process.env.NEPTUNE_PROXY);

			// create proxy agent
			return new proxy_agent({
				protocol: du_proxy.protocol,
				host: du_proxy.hostname,
				port: du_proxy.port,
				...g_agent,
			});
		}
		// proxy not set
		else {
			return new http.Agent(g_agent);
		}
	},

	https_agent(g_agent=G_AGENT_DEFAULT) {
		// neptune proxy env var set
		if(process.env.NEPTUNE_PROXY) {
			// parse proxy url
			let du_proxy = new url.URL(process.env.NEPTUNE_PROXY);

			// create proxy agent
			return new proxy_agent({
				protocol: du_proxy.protocol,
				host: du_proxy.hostname,
				port: du_proxy.port,
				...g_agent,
			});
		}
		// proxy not set
		else {
			return new https.Agent(g_agent);
		}
	},

	defaults(g_defaults={}) {
		let g_agent = g_defaults.agent || {};
		delete g_defaults.agent;

		let b_https = g_defaults.https;
		delete g_defaults.https;

		// construct request object
		return request.defaults({
			agent: b_https? self.https_agent(g_agent): self.http_agent(g_agent),
			...g_defaults,
		});
	},
};
