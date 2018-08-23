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
	h_data_files[s_input.replace(/\.json$/, '.ttl')] = s_input;
}

let a_outputs = Object.keys(h_data_files);

module.exports = {
	defs: {
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
			clear: () => ({
				deps: [
					'src/action/clear.js',
				],
				run: /* syntax: bash */ `
					node $1
				`,
			}),

			upload: {
				vocabulary: () => ({
					deps: [
						'src/action/upload-s3.js',
						'build/vocabulary/**',
					],
					run: /* syntax: bash */ `
						# node $1 \${@:2}
					`,
				}),

				data: () => ({
					deps: [
						'src/action/upload-s3.js',
						'build/data/**',
					],
					run: /* syntax: bash */ `
						# node $1 \${@:2}
					`,
				}),
			},

			update: {
				vocabulary: () => ({
					deps: [
						'remote.clear',
						'remote.upload.vocabulary',
						'src/action/update-neptune.js',
					],
					run: /* syntax: bash */ `
						node $3 vocabulary "${P_MMS_GRAPH}vocabulary"
					`,
				}),

				data: () => ({
					deps: [
						'remote.clear',
						'remote.upload.data',
						'src/action/update-neptune.js',
					],
					run: /* syntax: bash */ `
						node $3 data/${S_PROJECT_NAME} "${P_MMS_GRAPH}data.${S_PROJECT_NAME}"
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
					':output_data_file': h => ({
						deps: [
							'src/data/triplify-data.js',
							`input/${S_PROJECT_NAME}/data/${h_data_files[h.output_data_file]}`,
						],
						run: /* syntax: bash */ `
							node $1 < $2 > $@
						`,
					}),
				},
			},
		},
	},
};
