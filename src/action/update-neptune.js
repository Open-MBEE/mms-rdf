const request = require('../util/request.js').defaults({
	agent: {
		maxSockets: 64,
	},
	pool: {
		maxSockets: 64,
	},
});

// TODO: upload files to S3 bucket

class neptune_loader {
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
		return new Promise((fk_response, fe_response) => {
			request(g_request, (e_req, d_res, g_body) => {
				// network error
				if(e_req) {
					fe_response(e_req);
				}

				// non-200 response
				if(200 !== d_res.statusCode || '200 OK' !== g_body.status) {
					fe_response(new Error(`non 200 response: `+JSON.stringify(g_body)));
				}

				// okay; callback
				fk_response(g_body);
			});
		});
	}

	async check_job_status(si_job) {
		let g_body = await neptune_loader.request({
			method: 'GET',
			uri: `${this.endpoint}/loader/${si_job}`,
			qs: {
				details: true,
				errors: true,
			},
			json: true,
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
		let g_body = await neptune_loader.request({
			method: 'POST',
			uri: `${this.endpoint}/loader`,
			json: true,
			body: {
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
			},
		});

		//
		console.log(`loading '${p_source}' from s3 bucket${p_graph? ` into ${p_graph}`: ''}...`);

		// fetch job id
		let si_job = g_body.payload.loadId;

		// start polling job
		return await this.check_job_status(si_job);
	}
}

async function load(s_prefix, p_graph='', s_upload_format='turtle') {
	// assert required environment variables
	let a_envs = ['endpoint', 'region', 's3_bucket_url', 's3_iam_role_arn'];
	for(let s_simple of a_envs) {
		let s_var = `NEPTUNE_${s_simple.toUpperCase()}`;
		if(!process.env[s_var]) {
			throw new Error(`the following environment variable is either not set or is empty: ${s_var}`);
		}
	}

	// instantiate loader
	let k_loader = new neptune_loader({
		endpoint: process.env.NEPTUNE_ENDPOINT,
		region: process.env.NEPTUNE_REGION,
	});

	// invoke load from bucket
	let g_loaded = await k_loader.load_from_s3_bucket({
		source: `${process.env.NEPTUNE_S3_BUCKET_URL}/${s_prefix}`,
		iamRoleArn: process.env.NEPTUNE_S3_IAM_ROLE_ARN,
		uploadFormat: s_upload_format,
		...(p_graph? {namedGraph:p_graph}: {}),
	});

	debugger;
	console.dir(g_loaded);
}


let a_args = process.argv.slice(2);
load(a_args[0] || 'vocabulary', a_args[1] || '', a_args[2]);
