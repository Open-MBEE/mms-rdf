const p_mms_base = 'https://openmbee.org/rdf/mms4';

module.exports = {
	prefixes: {
		rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
		rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
		owl: 'http://www.w3.org/2002/07/owl#',
		xsd: 'http://www.w3.org/2001/XMLSchema#',
		xml: 'http://www.w3.org/XML/1998/namespace/',
		shacl: 'http://www.w3.org/ns/shacl#',

		// project-specific named graph IRIs
		'mms-graph': `${p_mms_base}/graph/`,

		// class definitions that extend UML classes or define novel metamodel concepts for the MMS4 element storage architecture
		'mms-ontology': `${p_mms_base}/ontology/`,

		// instantiations of concepts from the metamodel to create MMS4 element property definitions that proxy UML properties
		'mms-property': `${p_mms_base}/property/`,

		// underscored properties from the MMS4 UML+JSON dump
		'mms-derived-property': `${p_mms_base}/derived-property/`,

		// for describing concepts specific to MMS4 data managaement, e.g., project Visibility
		'mms-class': `${p_mms_base}/class/`,

		// all MMS4 elements by their UUID
		'mms-element': `${p_mms_base}/element/`,

		// for creating optional ShEx shapes that reflect UML concepts
		'mms-shape': `${p_mms_base}/shape/`,

		// reserved for future use
		'mms-artifact': `${p_mms_base}/artifact/`,
		'mms-index': `${p_mms_base}/index/`,

		// namespaces taken directly from OMG XMI documents so that parsed data can be queried
		xmi: 'http://www.omg.org/spec/XMI/20131001#',
		uml: 'http://www.omg.org/spec/UML/20161101#',

		// directly mapped concepts from the UML 2.5.1 metamodel
		'uml-model': 'https://www.omg.org/spec/UML/20161101/UML.xmi#',

		// separate namespace for datatypes of RDF literals adapted from UML datatypes
		'uml-model-dt': 'https://www.omg.org/spec/UML/20161101/UML.xmi#datatype/',

		// namespace for UML primitive dataypes which are defined separately
		'uml-primitives': 'https://www.omg.org/spec/UML/20161101/PrimitiveTypes.xmi#',

		// representing UML concepts in RDF for creating safe TBox statements
		'uml-class': `${p_mms_base}/uml-class/`,
		'uml-property': `${p_mms_base}/uml-property/`,
	},
};
