const fs = require('fs');

const G_CONFIG = require('./config.js');

const A_ENVS = [
	'MMS_PROJECT_NAME',
	'MMS_MAPPING_FILE',
];

for(let s_key of A_ENVS) {
	if(!process.env[s_key]) {
		throw new Error(`the following environment variable is either not set or empty: ${s_key}\nHave you sourced the .env file?`);
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
		vocab_mode: [
			'uml-vocab',
			'primitive-types',
			'element-properties',
		],
		output_data_file: a_outputs,
	},

	tasks: {
		all: [
			'remote.upload.*',
		],

		local: {
			vocabulary: {
				':vocab_mode': h => `build/vocabulary/${h.vocab_mode}.ttl`,
				// 'uml-vocab': 'build/vocabulary/uml-vocab.ttl',
				// 'element-properties': 'build/vocabulary/element-properties.ttl',
			},
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
				data: () => ({
					deps: [
						'src/action/upload-s3.js',
						`build/data/**`,
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

					'element-properties': () => ({
						deps: [
							'remote.update.vocabulary.uml-vocab',
							'local.vocabulary.element-properties',
							'remote.upload.vocabulary.element-properties',
							'src/action/update-neptune.js',
						],
						run: /* syntax: bash */ `
							node $4 vocabulary "${P_MMS_GRAPH}vocabulary"
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
						node $4 data/${S_PROJECT_NAME} "${P_MMS_GRAPH}data.${S_PROJECT_NAME}"
						# node $4 data/${S_PROJECT_NAME} "${P_MMS_GRAPH}data.${S_PROJECT_NAME}_copy"
					`,
				}),
			},
		},
	},

	outputs: {
		build: {
			cache: {
				'uml.xmi': g => ({
					run: /* syntax: bash */ `
						curl "${g.url || 'https://www.omg.org/spec/UML/20161101/UML.xmi'}" > $@
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

				'element-properties.ttl': () => ({
					deps: [
						'src/vocabulary/mappings-to-rdf.js',
						'remote.update.vocabulary.uml-vocab',
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
								`input/${S_PROJECT_NAME}/data/${h_data_files[si_target]}`,
							],
							run: /* syntax: bash */ `
								node $1 -o $(dirname $@) -i $2
								npx graphy content.ttl.read \
									--pipe util.dataset.tree --union \
									--pipe content.ttl.write \
									--inputs \
										<(ls build/data/*.ttl)
									> $@
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
