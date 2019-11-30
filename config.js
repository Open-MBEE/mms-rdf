const p_mms_base = 'https://opencae.jpl.nasa.gov/mms/rdf';

module.exports = {
	prefixes: {
		rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
		rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
		owl: 'http://www.w3.org/2002/07/owl#',
		xsd: 'http://www.w3.org/2001/XMLSchema#',
		xml: 'http://www.w3.org/XML/1998/namespace/',
		'mms-ontology': `${p_mms_base}/ontology/`,
		'mms-graph': `${p_mms_base}/graph/`,
		'mms-property': `${p_mms_base}/property/`,
		'mms-class': `${p_mms_base}/class/`,
		'mms-element': `${p_mms_base}/element/`,
		'mms-artifact': `${p_mms_base}/artifact/`,
		'mms-index': `${p_mms_base}/index/`,
		'mms-shape': `${p_mms_base}/shape/`,
		// 'mms-commit': `${p_mms_base}/commit/`,
		xmi: 'http://www.omg.org/spec/XMI/20131001#',
		uml: 'http://www.omg.org/spec/UML/20161101#',
		'uml-model': 'https://www.omg.org/spec/UML/20161101/UML.xmi#',
		'uml-model-dt': 'https://www.omg.org/spec/UML/20161101/UML.xmi#datatype/',
		'uml-primitives': 'https://www.omg.org/spec/UML/20161101/PrimitiveTypes.xmi#',
		'uml-class': `${p_mms_base}/uml-class/`,
		'uml-property': `${p_mms_base}/uml-property/`,
	},
};
