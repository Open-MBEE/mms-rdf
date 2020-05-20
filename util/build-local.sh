#!/bin/bash
p_input=$1

# check input path
if [ -z "$p_input" ]; then
	echo "ERROR: Missing script argument \$1; should be path to input dataset .json file"
	exit 1
fi

# normalize cwd
pushd "$(dirname "$0")/.."

# output directory
pd_output="./build/multi/${MMS_PROJECT_NAME}"
mkdir -p $pd_output

# master output
p_master="./build/data/${MMS_PROJECT_NAME}.ttl"
mkdir -p $(dirname $p_master)

# build
node src/multi/triplify.js -o $pd_output -i $p_input

echo "INFO: Finished triplification."
echo "INFO: Merging build output into single Turtle file..."

# merge
npx graphy read -c ttl / union / scribe -c ttl   \
	--inputs <(ls "${pd_output}/*.ttl") > "${pd_output}-master.ttl"

echo "INFO: Done."