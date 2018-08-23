const p_mms_base = 'https://open-cae.jpl.nasa.gov/mms/rdf';

module.exports = {
	prefixes: {
		rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
		rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
		owl: 'http://www.w3.org/2002/07/owl#',
		xsd: 'http://www.w3.org/2001/XMLSchema#',
		xml: 'http://www.w3.org/XML/1998/namespace/',
		'mms-ontology': `${p_mms_base}/ontology#`,
		'mms-graph': `${p_mms_base}/graph#`,
		'mms-property': `${p_mms_base}/property#`,
		'mms-class': `${p_mms_base}/class#`,
		'mms-index': `${p_mms_base}/index#`,
		'mms-object': `${p_mms_base}/object#`,
		'mms-element': `${p_mms_base}/element#`,
		'mms-artifact': `${p_mms_base}/artifact#`,
		'mms-commit': `${p_mms_base}/commit#`,
	},
};
