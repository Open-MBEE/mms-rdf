const fs = require('fs');
const url = require('url');

const aws = require('aws-sdk');

let a_files = process.argv.slice(2);

let y_s3 = new aws.S3({
	apiVersion: '2006-03-01',
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
