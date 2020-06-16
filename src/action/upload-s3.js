const fs = require('fs');
const url = require('url');

const aws = require('aws-sdk');
const env = require('../util/env.js');

const mk_agent = require('../class/http-client.js').agent;

let a_files = process.argv.slice(2);

let y_s3 = new aws.S3({
	apiVersion: '2006-03-01',
	region: env('NEPTUNE_REGION'),
	accessKeyId: env('AWS_ACCESS_KEY_ID'),
	secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
	httpOptions: {
		agent: mk_agent(process.env.AWS_S3_PROXY),
	},
});

(async function() {
	for(let pr_file of a_files) {
		let g_upload = await y_s3.upload({
			Bucket: url.parse(env('NEPTUNE_S3_BUCKET_URL')).hostname,
			Key: pr_file.replace(/^(?:\.\/)?build\//, ''),
			Body: fs.createReadStream(pr_file),
		}).promise();

		console.dir(g_upload);
	}
})();
