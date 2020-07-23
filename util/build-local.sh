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
pd_output="./build/multi/${MMS_PROJECT_ALIAS}"
mkdir -p $pd_output

# master output
p_master="./build/${MMS_PROJECT_ALIAS}-master.ttl"

# build
echo $ node src/multi/triplify.js -o $pd_output -i $p_input
node src/multi/triplify.js -o $pd_output -i $p_input

echo "INFO: Finished triplification."
echo "INFO: Merging build output into single Turtle file..."

# merge
cat "${pd_output}/*.ttl" > $p_master


echo "INFO: Creating labeled property graph..."

# convert instance data graph to lpg
node --max-old-space-size=65536 src/lpg/convert.js  \
	< $p_master  \
	3> "build/lpg/${MMS_PROJECT_ALIAS}-nodes_all.csv"  \
	4> "build/lpg/${MMS_PROJECT_ALIAS}-edges_all.csv"

echo "INFO: Done."