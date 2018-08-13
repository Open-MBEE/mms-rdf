
module.exports = {
	tasks: {
		all: [
			'build/**',
		],
	},

	outputs: {
		build: {
			'element-properties.ttl': h => ({
				deps: [
					'src/mappings-to-rdf.js',
				],
				run: /* syntax: bash */ `
					node $1 < ${h.mapping_file} > $@
				`,
			}),

			'uml-vocab.ttl': h => ({
				deps: [
					'src/triplify-uml.js',
				],
				run: /* syntax: bash */ `
					curl ${h.url || 'https://www.omg.org/spec/UML/20161101/UML.xmi'} | node $1 > $@
				`,
			}),
		},
	},
};
