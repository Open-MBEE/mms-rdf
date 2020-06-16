const HttpClient = require('./http-client.js');
const env = require('../util/env.js');

class MmsClient {
	constructor(gc_client={}) {
		this._si_project = gc_client.project_id || env('MMS_PROJECT_ID');
		this._si_ref = gc_client.ref_id || process.env.MMS_REF_ID || 'master';

		this._k_client = new HttpClient({
			base_url: process.env.MMS_BASE_URL || 'https://mms.openmbee.org/',
		});
	}

	element(si_element) {
		return new Promise((fk_resolve, fe_request) => {
			this._k_client.request({
				debug: true,
				method: 'GET',
				url: `projects/${this._si_project}/refs/${this._si_ref}/elements/${si_element}`,
				headers: {
					...process.env.MMS_AUTH_PASSWORD
						? {
							Authorization: `Basic ${Buffer.from(`${env('MMS_AUTH_USERNAME')}:${env('MMS_AUTH_PASSWORD')}`).toString('base64')}`,
						}
						: {},
				},
				responseType: 'json',
			}).then((ds_res) => {
				fk_resolve({
					data: () => Promise.resolve(ds_res.body.elements[0]),
				});
			}).catch((e_req) => {
				// HTTP Error
				if(e_req.response) {
					let d_res = e_req.response;

					// element not found
					if(404 === d_res.statusCode) {
						return fk_resolve({
							data: () => Promise.reject(new Error('HTTP 404 response. No data')),
						});
					}
				}

				fe_request(e_req);
			});
		});
	}
}

module.exports = MmsClient;
