# MMS-RDF

![Prototype Architecture](docs/mms-rdf-flowchart.png)

## Slides

[See slides here.](docs/MMS%20in%20RDF.pdf)

## Difference Between RDF Graph and LPG
The generated labelled property graph (LPG) is a view of the Project Data Graph. Its purpose is to provide a means to perform graph traversal queries on instance-level data. The LPG view strictly covers the **datatype properties of**, and **relationships between**, **model elements**. It does not cover the UML and MMS ontologies, so queries that depend on the type hierarchy from the UML metmodel, such as those involving subclass relations, are not supported. In other words, while RDF allows for ABox and TBox statements to exist within the same model, LPGs are mostly suited for ABox statements.

## General Requirements

Node.js version 10.\*, 11.\*, 12.\* .

make (for building native add-ons for node.js; node-gyp)


The following environment variables also need to be set:

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


## Setup
From the project root dir:
1. Install the npm package: `$ npm i`
2. Set your enviornment variables, e.g., `$ source .env`
3. If you are connecting to AWS Neptune, make sure to open a tunnel to an EC2 instance that is within the same VPC as the Neptune cluster:
  ```bash
  $ ssh -i aws.pem -D 3031 ubuntu@EC2_IP
  ```

## Building and Uploading RDF

Build tasks are handled by [emk.js](https://github.com/blake-regalia/emk.js). The following tasks are available:

In the following sections, `TYPE` is a placeholder for either `vocabulary` or `data`.

Building graphs (i.e., triplification):
 - `local.TYPE` - build the given `TYPE` graph locally (e.g., `local.vocabulary` or `local.data`), which outputs graphs as both RDF (in Turtle format) and LPG (in CSV format).

Modifying contents of the remote triplestore:
 - `remote.clear.TYPE` - clear the given `TYPE` graph from the remote triplestore
 - `remote.upload.TYPE` - upload the local `TYPE` graph file to the S3 bucket
 - `remote.update.TYPE` - load the `TYPE` graph from the S3 bucket into the triplestore

*Example:*
```bash
# clear all graphs from remote triplestore
$ npx emk remote.clear.*

# upload vocabulary graph to S3 and then update Neptune
$ npx emk remote.upload.vocabulary remote.update.vocabulary
``` 

The build targets automatically depend on the necessary tasks, so you can simply run:
```bash
$ npx emk remote.update.*
```
which will build the vocabulary and data graphs, upload them to S3, and then update the triplestore.