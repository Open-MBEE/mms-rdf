const fs = require('fs');
const worker = require('worker');
const factory = require('@graphy/core.data.factory');

const endpoint = require('../class/endpoint.js');

let k_endpoint;
let h_prefixes = {};
let ds_out;

const init = () => {
	let {
		prefixes: h_prefixes_init,
		path: p_output,
		endpoint: p_endpoint,
	} = g_init;

	h_prefixes = h_prefixes_init;

	ds_out = fs.createWriteStream(p_output);

	k_endpoint = new endpoint({
		url: p_output,
		prefixes: h_prefixes_init,
	});
};

worker.dedicated({
	async convert(g_object) {
		let k_endpoint = this.get('endpoint');

		if(!k_endpoint) {
			k_endpoint = init();
		}

		let {
			source: h_source,
		} = g_object;

		// query vocabulary for property definitions
		let s_query = /* syntax: sparql */ `
			select ?keyLabel ?keyType ?keyRange ?property ?propertyRange from mms-graph:vocabulary {
				?mappingKey mms-ontology:key ?keyLabel ;
					mms-ontology:aliases ?propertyLabel .

				?property xmi:type uml:Property ;
					rdfs:label ?propertyLabel .

				?property rdfs:domain/(^rdfs:subClassOf)* mms-class:${h_source.type} .

				optional {
					?property rdfs:range ?propertyRange .
					filter(isIri(?propertyRange))
				}

				optional {
					?mappingKey a ?keyType .
				}

				optional {
					?mappingKey rdfs:range ?keyRange .
					filter(isIri(?keyRange))
				}

				values ?keyLabel {
					${/* eslint-disable indent */
						Object.keys(h_source)
							.filter(s => 'type' !== s)
							.map(s => factory.literal(s).terse())
							.join(' ')
						/* eslint-enable */}
				}
			}
		`;

		// submit query to endpoint
		let g_response = await k_endpoint.query(s_query);

		return g_response;
	},
});
