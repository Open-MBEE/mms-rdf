
module.exports = class VocabEntry {
	constructor(s_type) {
		Object.assign(this, {
			_s_type: s_type,
			_b_ready: false,
			_a_keys: [],
			_a_waiters: [],
		});
	}

	await() {
		if(this._b_ready) {
			return this._a_keys;
		}
		else {
			return new Promise((fk_resolve) => {
				this._a_waiters.push(fk_resolve);
			});
		}
	}

	async load(k_response) {
		let a_keys = this._a_keys = await k_response.rows();
		this._b_ready = true;

		for(let fk_waiter of this._a_waiters) {
			fk_waiter(a_keys);
		}

		this._a_waiters.length = 0;

		return a_keys;
	}
};
