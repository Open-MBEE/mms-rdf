
module.exports = class vocab_entry {
	constructor(s_type) {
		Object.assign(this, {
			type: s_type,
			ready: false,
			keys: [],
			waiters: [],
		});
	}

	await() {
		if(this.ready) {
			return this.keys;
		}
		else {
			return new Promise((fk_resolve) => {
				this.waiters.push(fk_resolve);
			});
		}
	}

	async load(dp_query) {
		let a_keys = this.keys = await dp_query;
		this.ready = true;

		for(let fk_waiter of this.waiters) {
			fk_waiter(a_keys);
		}

		this.waiters.length = 0;

		return a_keys;
	}
};
