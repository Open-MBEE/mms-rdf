const HttpClient = require('../class/http-client.js');
const env = require('../util/env.js');

const K_CLIENT_GLOBAL = new HttpClient();

// .defaults({
// 	agent: {
// 		maxSockets: 64,
// 	},
// 	pool: {
// 		maxSockets: 64,
// 	},
// 	https: !process.env.SPARQL_PROXY && process.env.SPARQL_ENDPOINT && process.env.SPARQL_ENDPOINT.startsWith('https:'),
// });

// TODO: upload files to S3 bucket

class NeptuneLoader {
	constructor({
		endpoint: p_endpoint,
		region: s_region,
	}) {
		Object.assign(this, {
			endpoint: p_endpoint.replace(/\/$/, ''),
			region: s_region,
		});
	}

	static request(g_request) {
		return K_CLIENT_GLOBAL.request(g_request)
			.then(g => g.body, (e_req) => {
				// HTTP error
				if(e_req.response) {
					throw new Error(`non 200 response: `+JSON.stringify(e_req.response.body));
				}
				// network error
				else {
					throw e_req;
				}
			});
	}

	async check_job_status(si_job) {
		let g_body = await NeptuneLoader.request({
			method: 'GET',
			url: `${this.endpoint}/loader/${si_job}`,
			searchParams: {
				details: true,
				errors: true,
			},
			responseType: 'json',
		});

		// depending on the status string
		let s_status = g_body.payload.overallStatus.status;
		switch(s_status) {
			// loading hasn't started or is still in progress
			case 'LOAD_NOT_STARTED':
			case 'LOAD_IN_PROGRESS': {
				console.log(`${s_status}...`);

				// check again
				return await new Promise((fk_checked) => {
					setTimeout(async() => {
						fk_checked(await this.check_job_status(si_job));
					}, 500);
				});
			}

			// load successfully completed
			case 'LOAD_COMPLETED': {
				return g_body.payload;
			}

			default: {
				debugger;
				throw new Error(`Neptune reported an error while trying to load data from the S3 bucket: ${s_status};\n${JSON.stringify(g_body)}`);
			}
		}
	}

	async load_from_s3_bucket({
		source: p_source,
		iamRoleArn: parn_iam_role,
		namedGraph: p_graph=null,
		uploadFormat: s_upload_format,
	}) {
		// 
		console.log(`initiating neptune load from s3 bucket...`);

		// instruct Neptune instance to load all files from the S3 bucket
		let g_body = await NeptuneLoader.request({
			method: 'POST',
			url: `${this.endpoint}/loader`,
			responseType: 'json',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				source: p_source,
				format: s_upload_format,  // AWS should really change this to the correct MIME type: text/turtle
				iamRoleArn: parn_iam_role,
				region: this.region,
				failOnError: 'FALSE',
				...(p_graph
					? {
						parserConfiguration: {
							namedGraphUri: p_graph,
						},
					}
					: {}),
			}),
		});

		//
		console.log(`loading '${p_source}' from s3 bucket${p_graph? ` into ${p_graph}`: ''}...`);
debugger;
		// fetch job id
		let si_job = g_body.payload.loadId;

		// start polling job
		return await this.check_job_status(si_job);
	}
}

async function load(s_prefix, p_graph='', s_upload_format='turtle') {
	// instantiate loader
	let k_loader = new NeptuneLoader({
		endpoint: env('SPARQL_ENDPOINT'),
		region: env('NEPTUNE_REGION'),
	});

	// invoke load from bucket
	let g_loaded = await k_loader.load_from_s3_bucket({
		source: `${env('NEPTUNE_S3_BUCKET_URL')}/${s_prefix}`,
		iamRoleArn: env('NEPTUNE_S3_IAM_ROLE_ARN'),
		uploadFormat: s_upload_format,
		...(p_graph? {namedGraph:p_graph}: {}),
	});

	debugger;
	console.dir(g_loaded);
}


let a_args = process.argv.slice(2);
load(a_args[0] || 'vocabulary/', a_args[1] || '', a_args[2]);
