#!/bin/bash
# check env variable
if [[ -z "${MMS_PROJECT_ALIAS}" ]]; then
	echo "ERROR: The environment variable MMS_PROJECT_ALIAS must be defined"
	exit 1
fi

# extract the protocol
s_endpoint_proto="`echo $SPARQL_ENDPOINT | grep '://' | sed -e's,^\(.*://\).*,\1,g'`"

# remove the protocol
s_endpoint_url=`echo $SPARQL_ENDPOINT | sed -e s,$s_endpoint_proto,,g`

# userpass
s_endpoint_userpass="`echo $s_endpoint_url | grep @ | cut -d@ -f1`"

# extract the host & port
s_endpoint_hostport=`echo $s_endpoint_url | sed -e s,$s_endpoint_userpass@,,g | cut -d/ -f1`
s_endpoint_port=`echo $s_endpoint_hostport | grep : | cut -d: -f2`
if [ -n "$s_endpoint_port" ]; then
	s_endpoint_host=`echo $s_endpoint_hostport | grep : | cut -d: -f1`
else
	s_endpoint_host=$s_endpoint_hostport
fi

# localhost
if [ $s_endpoint_host != "localhost" ] && [ $s_endpoint_host != "127.0.0.1" ] && [ $s_endpoint_host != "0.0.0.0" ]; then
	echo "ERROR: This helper script was designed for localhost binding only. Inspect the source of this script if you'd like to customize for more advanced local bindings."
	exit 1
fi

# ready string to capture from container
S_READY_STRING="INFO  Start Fuseki"

# container name
si_container="mms-build-${MMS_PROJECT_ALIAS}"

# verbose
echo -e "\n>>  (Re)Starting Apache Jena Fuseki docker container named '${si_container}' and binding to host port :${s_endpoint_port}...\n"

# remove previous docker container
docker rm -f $si_container > /dev/null 2>&1

# launch new container
docker run -d --rm \
	-p "${s_endpoint_port}:3030" \
	--name $si_container \
	-v $(pwd)/build:/usr/share/data \
	atomgraph/fuseki \
	--mem \
	--update /ds


# prepare command string to deduce what container output is telling us
read -r -d '' SX_SUBSHELL <<-EOF
	docker logs -f $si_container \
		| tee >( grep -m1 -e "$S_READY_STRING" > /dev/null && kill -9 \$\$ ) \
		| tee >( grep -m1 -e "exited with code" > /dev/null && kill -2 \$\$ )
EOF

# await service startup
if bash -c "$SX_SUBSHELL"; then
	echo -e "\nfailed to start $si_container"
	exit 1
fi

# show container to user
docker ps -f "name=$si_container"

# verbose
echo -e "\n>>  Launched Apache Jena Fuseki docker container named '${si_container}' and bound to host port :${s_endpoint_port}\n"
