const fs = require('fs');

const G_CONFIG = require('./config.js');

const A_ENVS = [
	'MMS_PROJECT_NAME',
	'MMS_MAPPING_FILE',
];

for(let s_key of A_ENVS) {
	if(!process.env[s_key]) {
		throw new Error(`the following environment variable is either not set or empty: ${s_key}`);
	}
}

const S_PROJECT_NAME = process.env.MMS_PROJECT_NAME;
const P_MMS_GRAPH = G_CONFIG.prefixes['mms-graph'];

let h_data_files = {};
for(let s_input of fs.readdirSync(`input/${S_PROJECT_NAME}/data`)) {
	h_data_files[s_input.replace(/\.json$/, '')] = s_input;
}

let a_outputs = Object.keys(h_data_files);

console.warn(a_outputs);

module.exports = {
	defs: {
		graph: [
			'vocabulary',
			'data',
		],
		output_data_file: a_outputs,
	},

	tasks: {
		all: [
			'remote.upload.*',
		],

		local: {
			vocabulary: 'build/vocabulary/**',
			data: 'build/data/**',
		},

		remote: {
			clear: {
				data: () => ({
					deps: [
						'src/action/clear.js',
					],
					run: /* syntax: bash */ `
						node $1 "data.${S_PROJECT_NAME}"
					`,
				}),

				':graph': h => ({
					deps: [
						'src/action/clear.js',
					],
					run: /* syntax: bash */ `
						node $1 "${h.graph}"
					`,
				}),
			},

			upload: {
				':graph': h => ({
					deps: [
						'src/action/upload-s3.js',
						`build/${h.graph}/**`,
					],
					run: /* syntax: bash */ `
						node $1 \${@:2}
					`,
				}),
			},

			update: {
				vocabulary: () => ({
					deps: [
						'local.vocabulary',
						'remote.clear.vocabulary',
						'remote.upload.vocabulary',
						'src/action/update-neptune.js',
					],
					run: /* syntax: bash */ `
						node $4 vocabulary "${P_MMS_GRAPH}vocabulary"
					`,
				}),

				data: () => ({
					deps: [
						'local.data',
						'remote.clear.data',
						'remote.upload.data',
						'src/action/update-neptune.js',
					],
					run: /* syntax: bash */ `
						node $4 data/${S_PROJECT_NAME} "${P_MMS_GRAPH}data.${S_PROJECT_NAME}"
						# node $4 data/${S_PROJECT_NAME} "${P_MMS_GRAPH}data.${S_PROJECT_NAME}_copy"
					`,
				}),
			},
		},
	},

	outputs: {
		build: {
			vocabulary: {
				'element-properties.ttl': () => ({
					deps: [
						'src/vocabulary/mappings-to-rdf.js',
					],
					run: /* syntax: bash */ `
						node $1 < ${process.env.MMS_MAPPING_FILE} > $@
					`,
				}),

				'uml-vocab.ttl': h => ({
					deps: [
						'src/vocabulary/triplify-uml.js',
					],
					run: /* syntax: bash */ `
						curl "${h.url || 'https://www.omg.org/spec/UML/20161101/UML.xmi'}" | node $1 > $@
					`,
				}),
			},

			data: {
				[S_PROJECT_NAME]: {
					':output_data_file': [si_target => ({
						// RDF graph
						[`${si_target}.ttl`]: () => ({
							deps: [
								'src/data/triplify-async.js',
								`input/${S_PROJECT_NAME}/data/${h_data_files[si_target]}`,
							],
							run: /* syntax: bash */ `
								node --max_old_space_size=8192 $1 < $2 > $@
							`,
						}),

						// LPG nodes/edges
						[`${si_target}.nodes.csv`]: () => ({
							deps: [
								'src/lpg/convert.js',
								`build/data/${S_PROJECT_NAME}/${si_target}.ttl`,
							],
							run: /* syntax: bash */ `
								node --max_old_space_size=8192 $1 < $2 > $@ \
									3> "$(dirname $@)/${si_target}.edges.csv"
							`,
						}),
					})],
				},
			},
		},
	},
};
