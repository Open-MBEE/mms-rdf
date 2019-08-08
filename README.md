# MMS-RDF

## General Requirements

The following environment variables need to be set:

 - MMS_PROJECT_NAME - name of the project (determines name of generated data graph)
 - MMS_MAPPING_FILE - path to input JSON mapping file(s) (either absolute path or relative to this project root dir)


### Using with AWS Neptune Requirements

The following environment variables need to be set:
 - AWS_ACCESS_KEY_ID
 - AWS_SECRET_ACCESS_KEY
 - NEPTUNE_ENDPOINT - URL of the SPARQL endpoint which will be updated and queried during triplification.
 - NEPTUNE_S3_BUCKET - S3 Bucket URI (see example)
 - NEPTUNE_REGION - S3 Bucket region string
 - NEPTUNE_PROXY - (optional) define a proxy to tunnel requests to the endpoint thru (see example)


### `.env` file example:

```bash
#!/bin/bash
export NEPTUNE_ENDPOINT=http://open-cae-mms.c0fermrnxxyy.us-east-2.neptune.amazonaws.com:8182
export NEPTUNE_S3_BUCKET_URL=s3://open-cae-mms-rdf
export NEPTUNE_S3_IAM_ROLE_ARN=arn:aws:iam::230084004409:role/NeptuneLoadFromS3
export NEPTUNE_REGION=us-east-2
export NEPTUNE_PROXY=socks://127.0.0.1:3031

export MMS_PROJECT_NAME=tmt
export MMS_MAPPING_FILE=input/tmt/mapping/*.json

export AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_ACCESS_KEY
```
