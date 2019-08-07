const fs = require('fs');
const url = require('url');
const http = require('http');

const proxy_agent = require('proxy-agent');

const aws = require('aws-sdk');

let a_files = process.argv.slice(2);

let d_agent = null;

// default agent properties
let g_agent = {
	maxSockets: 64,
};

// neptune proxy env var set
if(process.env.NEPTUNE_PROXY) {
	// parse proxy url
	let du_proxy = new url.URL(process.env.NEPTUNE_PROXY);

	// create proxy agent
	d_agent = new proxy_agent({
		protocol: du_proxy.protocol,
		host: du_proxy.host,
		port: du_proxy.port,
		...g_agent,
	});
}
// proxy not set
else {
	d_agent = new http.Agent(g_agent);
}

let y_s3 = new aws.S3({
	region: 'us-east-2',
	apiVersion: '2006-03-01',
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	httpOptions: {
		agent: d_agent,
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
