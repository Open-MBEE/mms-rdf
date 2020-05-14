const worker = require('worker');
const cp = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const yargs = require('yargs');
const progress = require('progress');

const H_PRREFIXES = require('../../config.js').prefixes;
const NL_WORKERS = require('os').cpus().length;

(async() => {
	const h_argv = yargs
		.options({
			'worker-count': {
				alias: 'c',
				describe: 'limit number of worker to the given count rather than number of CPUs',
				default: NL_WORKERS,
			},
			'output-dir': {
				alias: 'o',
				describe: 'output directory for data files in Turtle format (overwrites existing files)',
				demandOption: true,
			},
			'input-file': {
				alias: 'i',
				describe: 'path of input JSON file (relative to cwd)',
				demandOption: true,
			},
			debug: {
				alias: 'd',
				describe: 'enable debugger inspection on workers',
			},
		})
		.argv;

	let {
		outputDir: pd_output,
		inputFile: p_input,
		workerCount: nl_workers,
	} = h_argv;


	// remove all previous build files in output directory
	let a_files = fs.readdirSync(pd_output).filter(s => s.endsWith('.ttl'));
	for(let s_file of a_files) {
		fs.unlinkSync(`${pd_output}/${s_file}`);
	}

	// count number of lines in input file
	let nl_lines = await new Promise((fk_resolve) => {
		let u_wc = cp.spawn('wc', ['-l', p_input]);

		let s_stdout = '';

		u_wc.stdout.on('data', (s_chunk) => {
			s_stdout += s_chunk;
		});

		u_wc.on('close', () => {
			let snl_lines = s_stdout.replace(/^\s*(\d+)\s+[^]*$/, '$1');
			fk_resolve(Number.parseInt(snl_lines));
		});
	});

	// log to stderr
	console.warn(`${nl_lines} lines in input file`);

	// progress bar
	let y_bar = new progress('[:bar] :percent :current/:total; +:elapseds; -:etas', {
		incomplete: ' ',
		complete: '∎', // 'Ξ',
		width: 40,
		total: nl_lines,
	});

	// create worker group
	let k_group = worker.group('./worker.js', nl_workers, {
		...(h_argv.debug
			? {
				inspect: {
					break: true,
					range: [9230, 9239],
				},
			}
			: {}
		),
	});


	// synchronously stat file
	let nb_input = fs.statSync(p_input).size;

	// create ranges
	let a_ranges = [];

	{
		let nb_increment = Math.ceil(nb_input / nl_workers);
		let ib_range = 0;
		for(; ib_range<nb_input; ib_range+=nb_increment) {
			a_ranges.push([ib_range, ib_range+nb_increment]);
		}

		if(ib_range < nb_input) {
			a_ranges.push([ib_range, nb_input]);
		}
	}

	let a_remainders = [];
	console.dir(a_ranges);

	k_group.data(a_ranges)
		.map('convert', [{
			output_dir: pd_output,
			input_file: p_input,
			prefixes: H_PRREFIXES,
			endpoint: process.env.MMS_SPARQL_ENDPOINT,
		}], {
			progress(i_worker, nl_items) {
				y_bar.tick(nl_items);
			},
		})
		.series((a_unreads) => {
			a_remainders.push(...a_unreads);

			console.warn(`${a_unreads.length} remainders returned`);

			// need at least two ranges to start reading
			if(a_unreads.length >= 2) {
				debugger;
			}
		})
		.end(async() => {
			console.warn(`all remainders returned`);
			await k_group.kill();
			process.exit(1);
		});
})();
