module.exports = (si_var) => {
	let s_value = process.env[si_var];

	// assert required environment variables
	if(!s_value) {
		throw new Error(`the following environment variable is required but is either not set or is empty: ${si_var}`);
	}

	return s_value;
};
