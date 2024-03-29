const fs = require('fs');

const G_CONFIG = require('./config.js');

const A_ENVS = [
	'MMS_PROJECT_ID',
	'MMS_MAPPING_FILE',
	'SPARQL_ENDPOINT',
];

for(let s_key of A_ENVS) {
	if(!process.env[s_key]) {
		throw new Error(`the following environment variable is either not set or empty: ${s_key}\nHave you sourced the .env file?`);
	}
}

const S_PROJECT_NAME = process.env.MMS_PROJECT_ALIAS;
const P_MMS_GRAPH = G_CONFIG.prefixes['mms-graph'];
const P_ENDPOINT = process.env.SPARQL_ENDPOINT;
const B_LOCAL = /^https?:\/\/(localhost|127\.0\.0.\1)(?::(\d+))?\//.test(P_ENDPOINT);
const S_LOCAL_OR_REMOTE = B_LOCAL? 'local': 'remote';

let h_data_files = {};
try {
	for(let s_input of fs.readdirSync(`input/${S_PROJECT_NAME}`)) {
		if(s_input.endsWith('data.json')) {
			h_data_files[s_input.replace(/\.json$/, '')] = s_input;
		}
	}
}
catch(e_scan) {
	console.warn(`'input/tmt' directory does not exist`);
}

let a_outputs = Object.keys(h_data_files);

console.warn(a_outputs);

const H_LOCAL_VOCAB_DEPS = {
	'primitive-types': [
		'local.clear.vocabulary',
		'local.vocabulary.primitive-types',
	],
	'uml-vocab': [
		'local.update.vocabulary.primitive-types',
		'local.vocabulary.uml-vocab',
	],
	'sysml-vocab': [
		'local.clear.vocabulary',
		'local.vocabulary.sysml-vocab',
	],
	'element-properties': [
		'local.update.vocabulary.uml-vocab',
		'local.vocabulary.element-properties',
	],
};

module.exports = {
	defs: {
		graph: [
			'vocabulary',
			'data',
		],
		vocab_mode: Object.keys(H_LOCAL_VOCAB_DEPS),
		output_data_file: a_outputs,
	},

	tasks: {
		all: [
			B_LOCAL
				? 'local.update.vocabulary.*'
				:'remote.upload.*',
		],

		local: {
			vocabulary: {
				':vocab_mode': h => `build/vocabulary/${h.vocab_mode}.ttl`,
			},

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

			update: {
				vocabulary: {
					':vocab_mode': g => ({
						deps: [
							...(H_LOCAL_VOCAB_DEPS[g.vocab_mode]),
							'src/action/update.js',
							`build/vocabulary/${g.vocab_mode}.ttl`,
						],
						run: /* syntax: bash */ `
							node $3 vocabulary "${P_MMS_GRAPH}vocabulary" < $4
						`,
					}),
				},
			},
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
				data: () => ({
					deps: [
						'src/action/upload-s3.js',
						`build/multi/**`,
					],
					run: /* syntax: bash */ `
						node $1 \${@:2}
					`,
				}),

				vocabulary: {
					':vocab_mode': h => ({
						deps: [
							'src/action/upload-s3.js',
							`build/vocabulary/${h.vocab_mode}.ttl`,
						],
						run: /* syntax: bash */ `
							node $1 \${@:2}
						`,
					}),
				},
			},

			update: {
				vocabulary: {
					'primitive-types': () => ({
						deps: [
							'remote.clear.vocabulary',
							'local.vocabulary.primitive-types',
							'remote.upload.vocabulary.primitive-types',
							'src/action/update-neptune.js',
						],
						run: /* syntax: bash */ `
							node $4 vocabulary "${P_MMS_GRAPH}vocabulary"
						`,
					}),

					'uml-vocab': () => ({
						deps: [
							'remote.update.vocabulary.primitive-types',
							'local.vocabulary.uml-vocab',
							'remote.upload.vocabulary.uml-vocab',
							'src/action/update-neptune.js',
						],
						run: /* syntax: bash */ `
							node $4 vocabulary "${P_MMS_GRAPH}vocabulary"
						`,
					}),

					'sysml-vocab': () => ({
						deps: [
							'local.vocabulary.sysml-vocab',
							'remote.upload.vocabulary.sysml-vocab',
							'src/action/update-neptune.js',
						],
						run: /* syntax: bash */ `
							node $3 vocabulary "${P_MMS_GRAPH}vocabulary"
						`,
					}),

					'element-properties': () => ({
						deps: [
							'remote.update.vocabulary.uml-vocab',
							'remote.update.vocabulary.sysml-vocab',
							'local.vocabulary.element-properties',
							'remote.upload.vocabulary.element-properties',
							'src/action/update-neptune.js',
						],
						run: /* syntax: bash */ `
							node $5 vocabulary "${P_MMS_GRAPH}vocabulary"
						`,
					}),

					// () => ({
					// deps: [
					// 	'remote.clear.vocabulary',
					// 	`local.vocabulary.uml-vocab`,
					// 	'remote.upload.vocabulary.uml-vocab',
					// 	'local.vocabulary.element-properties',
					// 	'remote.upload.vocabulary.element-properties',
					// 	'src/action/update-neptune.js',
					// ],
					// run: /* syntax: bash */ `
					// 	node $4 vocabulary "${P_MMS_GRAPH}vocabulary"
					// `,
				},

				data: () => ({
					deps: [
						'local.data',
						'remote.clear.data',
						'remote.upload.data',
						'src/action/update-neptune.js',
					],
					run: /* syntax: bash */ `
						node $4 data/${S_PROJECT_NAME}/ "${P_MMS_GRAPH}data.${S_PROJECT_NAME}"
					`,
				}),
			},
		},
	},

	outputs: {
		input: {
			[S_PROJECT_NAME]: {
				'data.json': g => ({
					run: /* syntax: bash */ `
						curl '${g.url || `${process.env.MMS_BASE_URL || 'https://mms.openmbee.org/alfresco/service'}/projects/${process.env.MMS_PROJECT_ID}/refs/master/elements?extended=true`}'  \
							${g.insecure? '-k': ''}  \
							-H 'Accept: application/json'  \
							-H 'Authorization: Basic ${Buffer.from((process.env.MMS_AUTH_USERNAME || 'openmbeeguest')+':'+(process.env.MMS_AUTH_PASSWORD || 'guest')).toString('base64')}'  \
							| jq -c '.elements[]' > $@
					`,
				}),
			},
		},

		build: {
			cache: {
				'uml.xmi': g => ({
					run: /* syntax: bash */ `
						curl "${g.url || 'https://www.omg.org/spec/UML/20161101/UML.xmi'}" > $@
					`,
				}),

				'sysml.xmi': g => ({
					run: /* syntax: bash */ `
						curl "${g.url || 'https://www.omg.org/spec/SysML/20181001/SysML.xmi'}" > $@
					`,
				}),

				'primitive-types.xmi': g => ({
					run: /* syntax: bash */ `
						curl "${g.url || 'https://www.omg.org/spec/UML/20161101/PrimitiveTypes.xmi'}" > $@
					`,
				}),
			},

			vocabulary: {
				'primitive-types.ttl': () => ({
					deps: [
						'src/vocabulary/convert-uml.js',
						'build/cache/primitive-types.xmi',
					],
					run: /* syntax: bash */ `
						node $1 < $2 > $@
					`,
				}),

				'uml-vocab.ttl': () => ({
					deps: [
						'src/vocabulary/convert-uml.js',
						'build/cache/uml.xmi',
					],
					run: /* syntax: bash */ `
						node $1 < $2 > $@
					`,
				}),

				'sysml-vocab.ttl': () => ({
					deps: [
						'src/vocabulary/convert-uml.js',
						'build/cache/sysml.xmi',
					],
					run: /* syntax: bash */ `
						node $1 < $2 > $@
					`,
				}),

				'element-properties.ttl': () => ({
					deps: [
						'src/vocabulary/mappings-to-rdf.js',
						`${S_LOCAL_OR_REMOTE}.update.vocabulary.uml-vocab`,
						`${S_LOCAL_OR_REMOTE}.update.vocabulary.sysml-vocab`,
					],
					run: /* syntax: bash */ `
						node $1 < ${process.env.MMS_MAPPING_FILE} > $@
					`,
				}),
			},

			shapes: {
				'uml-classes.shexc': () => ({
					deps: [
						'src/shapes/uml-to-shexc.js',
					],
					run: /* syntax: bash */ `
						node $1 > $@ 3> build/shapes/uml-classes.shape-map
					`,
				}),
			},

			multi: {
				[S_PROJECT_NAME]: {
					':output_data_file': [si_target => ({
						// RDF graph
						[`${si_target}.ttl`]: () => ({
							deps: [
								'src/multi/triplify.js',
								`input/${S_PROJECT_NAME}/${h_data_files[si_target]}.json`,
							],
							run: /* syntax: bash */ `
								node $1 -o $(dirname $@) -i $2
								cat build/multi/${S_PROJECT_NAME}/*.ttl) > $@
							`,
						}),

						// LPG nodes/edges
						[`${si_target}.nodes.csv`]: () => ({
							deps: [
								'src/lpg/convert.js',
								`build/multi/${S_PROJECT_NAME}/${si_target}.ttl`,
							],
							run: /* syntax: bash */ `
								node --max_old_space_size=65536 $1 < $2 3> $@ \
									4> "$(dirname $@)/${si_target}.edges.csv"
							`,
						}),
					})],
				},
			},
		},
	},
};
