const HttpClient = require('./http-client.js');
const env = require('../util/env.js');

class ElementError {
	constructor(s_message, si_element) {
		this._si_element = si_element;
	}

	get element() {
		return this._si_element;
	}
}

class MmsClient {
	constructor(gc_client={}) {
		this._si_project = gc_client.project_id || env('MMS_PROJECT_ID');
		this._si_ref = gc_client.ref_id || process.env.MMS_REF_ID || 'master';

		this._k_client = new HttpClient({
			base_url: process.env.MMS_BASE_URL || 'https://mms.openmbee.org/',
		});
		// this._p_base = process.env.MMS_BASE_URL || 'https://mms.openmbee.org/';
	}

	async element(si_element) {
		let y_reqres;
		// try {
			y_reqres = await this._k_client.request({
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
				retry: {
					limit: 4,
					statusCodes: [
						403,
						404,
						408,
						410,
						413,
						429,
						500,
						502,
						503,
						504,
						521,
						522,
						524,
					],
				},
			});

			if(!y_reqres.body.elements) {
				throw new ElementError('Empty JSON response', si_element);
			}

			return y_reqres.body.elements[0];
		// }
		// catch(e_req) {
		// 	// HTTP Error
		// 	if(e_req.response) {
		// 		let d_res = e_req.response;

		// 		// element not found
		// 		if(404 === d_res.statusCode) {
		// 			throw new Error('HTTP 404 response. No data');
		// 			// return {
		// 			// 	data: () => Promise.reject(new Error('HTTP 404 response. No data')),
		// 			// };
		// 		}
		// 	}
		// 	else {
		// 		throw e_req;
		// 	}
		// }
	}
}

module.exports = MmsClient;
