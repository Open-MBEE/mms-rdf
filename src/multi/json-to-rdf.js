const path = require('path');
const wt = require('worker_threads');
const v8 = require('v8');

const cp = require('child_process');
const os = require('os');

// adapted from https://www.npmjs.com/package/physical-cpu-count
let NL_WORKERS_ADVISE = (() => {
	const exec = s_cmd => cp.execSync(s_cmd, {encoding:'utf8'});

	switch(os.platform()) {
		case 'linux': {
			let s_out = exec(/* syntax: shell */ `lscpu -p | egrep -v "^#" | sort -u -t, -k 2,4 | wc -l`);
			return parseInt(s_out.trim(), 10);
		}

		case 'darwin': {
			let s_out = exec(/* syntax: shell */ `sysctl -n hw.physicalcpu_max`);
			return parseInt(s_out.trim(), 10);
		}

		case 'windows': {
			let s_out = exec(/* syntax: shell */ `WMIC CPU Get NumberOfCores`);
			return s_out.split(os.EOL)
				.map(s => parseInt(s))
				.filter(n => !isNaN(n))
				.reduce((c_out, n) => c_out + n, 0);
		}

		default: {
			return os.cpus().filter((g_cpu, i_cpu) => {
				let b_hyperthreading = g_cpu.model.includes('Intel');
				let b_odd = 1 === (i_cpu % 2);
				return !b_hyperthreading || b_odd;
			}).length;
		}
	}
})() - 1;


class Worker extends wt.Worker {
	constructor(pr_worker, gc_worker) {
		let f_message;
		if(gc_worker.message) {
			f_message = gc_worker.message;
			delete gc_worker.message;
		}

		// resource limits
		if('string' === typeof gc_worker.resourceLimits) {
			// must be 'inherit'
			if('inherit' !== gc_worker.resourceLimits) {
				throw new Error(`@graphy/core.iso.threads: Invalid '.resourceLimits' option to Worker constructor: "${gc_worker.resourceLimits}"`);
			}

			// try to get heap stats
			let n_mib_max_old_space = 0;
			try {
				// emprically, node(/v8?) seems to reserve additional 48 MiB of heap
				n_mib_max_old_space = (v8.getHeapStatistics().heap_size_limit / 1024 / 1024) - 48;
			}
			catch(e_stat) {
				delete gc_worker.resourceLimits;
			}

			// inherit max old space size
			if(n_mib_max_old_space) {
				gc_worker.resourceLimits = {
					maxOldGenerationSizeMb: n_mib_max_old_space,
				};
			}
		}

		super(path.join(gc_worker.__dirname, pr_worker), gc_worker);

		this.on('message', f_message);
	}
}


(async() => {
	let nl_workers = NL_WORKERS_ADVISE;

	for(let i_worker=1; i_worker<nl_workers; i_worker++) {
		// spawn new worker
		let d_worker = new Worker('./worker-new.js', {
			// relative path
			__dirname,


			workerData: {},

			// handle message events from worker
			message: MultiConverter$handle_worker_message(this, i_worker),

			// inherit resources limits from main
			resourceLimits: 'inherit',
		});

		// push to worker list
		a_workers.push(d_worker);
	}
})();
