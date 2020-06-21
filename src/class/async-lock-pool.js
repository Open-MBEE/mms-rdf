
function AsyncLockPool$_release(k_self, g_lock) {
	return () => {
		// remove self from locks
		k_self._a_locks.splice(k_self._a_locks.indexOf(g_lock), 1);

		// free
		k_self._c_free += 1;

		queueMicrotask(() => {
			// at least one promise waiting for lock
			if(k_self._a_awaits.length) {
				let g_lock_await = k_self._a_awaits.shift();

				g_lock_await.confirm();
			}
		});
	};
}

class AsyncLockPool {
	constructor(n_locks) {
		this._c_free = n_locks;
		this._a_awaits = [];
		this._a_locks = [];
	}

	acquire(g_data=null) {
		// at least one free lock
		if(this._c_free > 0) {
			// consume a lock
			this._c_free -= 1;

			// 
			let g_lock = {
				data: g_data,
			};

			g_lock.free = AsyncLockPool$_release(this, g_lock);

			// push to open
			this._a_locks.push(g_lock);

			// done
			return Promise.resolve(g_lock.free);
		}
		else {
			return new Promise((fk_acquire) => {
				let g_lock = {
					confirm: fk_acquire,
					data: g_data,
				};

				g_lock.free = AsyncLockPool$_release(this, g_lock);

				this._a_awaits.push(g_lock);
			});
		}
	}
}

module.exports = AsyncLockPool;
