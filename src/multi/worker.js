const fs = require('fs');
const fsp = fs.promises;
const stream = require('stream');

const worker = require('worker');
const json_parser = require('stream-json').parser;
const json_pick = require('stream-json/filters/Pick');
const json_stream_array = require('stream-json/streamers/StreamArray').streamArray;
const json_stream_values = require('stream-json/streamers/StreamValues').streamValues;
const json_stream_object = require('stream-json/streamers/StreamObject').streamObject;
const json_pulse = require('stream-json/utils/Pulse');


const Triplifier = require('../class/triplifier.js');

const B_PULSE = true;

let b_locked = false;
let b_waiting = false;
let f_waiting;

let f_set_waiting = (fk_resolve) => {
	f_waiting = fk_resolve;
};

worker.dedicated({
	async convert(a_ranges, gc_convert) {
		let k_self = this;

		let {
			output_dir: pd_output,
			input_file: p_input,
			prefixes: h_prefixes_init,
			endpoint: p_endpoint,
		} = gc_convert;

		let k_triplifier = new Triplifier({
			endpoint: p_endpoint,
			prefixes: h_prefixes_init,
			output: fs.createWriteStream(`${pd_output}/data_${process.env.WORKER_INDEX}.ttl`),
		});

		let a_unread = [];

		// json parser
		let ds_parser = json_parser({jsonStreaming:true});

		// pulse pipeline
		let ds_pulse = stream.pipeline(...[
			ds_parser,
			json_stream_values(),
			...B_PULSE
				? [new json_pulse()]
				: [],

			(e_pipeline) => {
				if(e_pipeline) {
					// worker reached eof
					if(/^Error: Parser cannot parse input: expected/.test(e_pipeline.stack)) {
						debugger;
						// k_self.emit('unparsed');
					}
					else {
						throw e_pipeline;
					}
				}
			},
		]);

		if(B_PULSE) {
			// pulse batch
			ds_pulse.on('data', async(a_items) => {
				console.warn(`\nworker ${process.env.WORKER_INDEX} pulsed ${a_items.length} items`);

				b_locked = true;

				// each object in item list
				for(let {key:i_object, value:g_object} of a_items) {
					console.warn(i_object);

					// triplify object
					await k_triplifier.convert_write(g_object, g_object);
				}

				b_locked = false;

				if(b_waiting) {
					console.warn(`\nworker ${process.env.WORKER_INDEX} waiting after data; released`);

					b_waiting = false;
					f_waiting();
				}
				else {
					console.warn(`\nworker ${process.env.WORKER_INDEX} NOT waiting after data`);
				}

				// emit progress update
				k_self.emit('progress', a_items.length);
			});
		}
		else {
			ds_pulse.on('data', async({value:g_object}) => {
				console.warn(`\nworker ${process.env.WORKER_INDEX} read 1 items`);

				b_locked = true;

				// triplify object
				await k_triplifier.convert_write(g_object, g_object);

				b_locked = false;

				if(b_waiting) {
					console.warn(`\nworker ${process.env.WORKER_INDEX} waiting after data; released`);

					b_waiting = false;
					f_waiting();
				}

				// emit progress update
				k_self.emit('progress', 1);
			});
		}

		// open input file for reading
		let df_input = await fsp.open(p_input, 'r');

		// each range
		for(let a_range of a_ranges) {
			let [ib_lo, ib_hi] = a_range;

			// flag start boundary
			let b_boundary = 0 === ib_lo;

			let nb_read = 64 * 1024;  // 64 KiB
			let at_read = Buffer.allocUnsafe(nb_read);

			for(let ib_read=ib_lo; ib_read<ib_hi; ib_read+=nb_read) {
				let {
					bytesRead: nb_filled,
					buffer: at_filled,
				} = await df_input.read(at_read, 0, nb_read, ib_read);

				// boundary has not been found yet
				if(!b_boundary) {
					// find boundary
					let i_boundary = at_filled.indexOf(0x0a);

					// no newline found this range
					if(-1 === i_boundary) {
						// push range to unread list
						a_unread.push({
							type: 'range',
							value: a_range,
						});

						// try next section
						continue;
					}
					// newline boundary found
					else {
						// set flag
						b_boundary = true;

						// boundary is not at start; push unread range to unread list
						if(i_boundary) {
							a_unread.push({
								type: 'range',
								value: [ib_read, ib_read+i_boundary],
							});
						}

						// adjust buffer
						at_filled = at_filled.subarray(i_boundary);
					}
				}

				console.warn(`\nworker ${process.env.WORKER_INDEX} read ${nb_filled} bytes from file @${ib_read}`);

				ds_parser.write(at_filled);

				console.warn(`\nworker ${process.env.WORKER_INDEX} ${b_locked? '': 'un'}locked after write`);

				if(b_locked) {
					b_waiting = true;
					await new Promise(f_set_waiting);
				}
			}

			console.warn(`\nworker ${process.env.WORKER_INDEX} finished reading range ${a_range}`);

			a_unread.push({
				type: 'buffer',
				value: Buffer.from(ds_parser._buffer),
			});
		}

		console.warn(`\nworker ${process.env.WORKER_INDEX} finished all ranges`);

		// close input file handle
		await df_input.close();

		// await triplifier flush
		await k_triplifier.flush();

		// return unread chunks
		return a_unread;
	},
});
