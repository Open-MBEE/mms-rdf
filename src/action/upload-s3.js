const fs = require('fs');
const url = require('url');

const aws = require('aws-sdk');

const rq = require('../util/request.js');

let a_files = process.argv.slice(2);

let y_s3 = new aws.S3({
	region: 'us-east-2',
	apiVersion: '2006-03-01',
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	httpOptions: {
		agent: rq.https_agent({
			maxSockets: 64,
		}),
	},
});

(async function() {
	for(let pr_file of a_files) {
		let g_upload = await y_s3.upload({
			Bucket: url.parse(process.env.NEPTUNE_S3_BUCKET_URL).hostname,
			Key: pr_file.replace(/^(?:\.\/)?build\//, ''),
			Body: fs.createReadStream(pr_file),
		}).promise();

		console.dir(g_upload);
	}
})();
