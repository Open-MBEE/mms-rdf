const fs = require('fs');
const fsp = fs.promises;
const stream = require('stream');

const worker = require('worker');
const json_parser = require('stream-json').parser;
const json_pick = require('stream-json/filters/Pick').pick;
const json_stream_array = require('stream-json/streamers/StreamArray').streamArray;
const json_stream_values = require('stream-json/streamers/StreamValues').streamValues;
const json_pulse = require('stream-json/utils/Pulse');

const ttl_write = require('@graphy/content.ttl.write');

const triplifier = require('../class/triplifier.js');


let b_locked = false;
let b_waiting = false;
let f_waiting;

let f_set_waiting = (fk_resolve) => {
	f_waiting = fk_resolve;
};

worker.dedicated({
	async convert(a_ranges, gc_convert) {
		let {
			output_dir: pd_output,
			input_file: p_input,
			prefixes: h_prefixes_init,
			endpoint: p_endpoint,
		} = gc_convert;

		let k_triplifier = new triplifier({
			endpoint: p_endpoint,
			prefixes: h_prefixes_init,
			output: fs.createWriteStream(`${pd_output}/data_${process.env.WORKER_INDEX}.ttl`),
		});

		// // create ttl writer
		// let ds_out = ttl_write({
		// 	prefixes: h_prefixes_init,
		// });

		// // pipe to output destination
		// ds_out.pipe(fs.createWriteStream(`${pd_output}/data_${process.env.WORKER_INDEX}.ttl`));


		let a_unread = [];

		// json parser
		let ds_parser = json_parser({jsonStreaming:true});

		// pulse pipeline
		let ds_pulse = stream.pipeline(...[
			ds_parser,
			json_stream_values(),
			new json_pulse(),

			(e_pipeline) => {
				if(e_pipeline) {
					throw e_pipeline;
				}
			},
		]);

		// pulse batch
		ds_pulse.on('data', async(a_items) => {
			console.warn(`worker ${process.env.WORKER_INDEX} pulsed ${a_items.length} items`);

			b_locked = true;

			// each object in item list
			for(let {value:g_object} of a_items) {
				// triplify object
				await k_triplifier.convert_write(g_object._source, g_object);

				// // triplify object
				// let ac3_items = await k_triplifier.convert_object(g_object._source, g_object);

				// // write items to output
				// ds_out.write({
				// 	type: 'array',
				// 	value: ac3_items.map(hc3 => ({type:'c3', value:hc3})),
				// });
			}

			b_locked = false;

			if(b_waiting) {
				// console.warn(`worker ${process.env.WORKER_INDEX} waiting after data; released`);

				b_waiting = false;
				f_waiting();
			}
		});

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

				// console.warn(`worker ${process.env.WORKER_INDEX} read ${nb_filled} bytes from file @${ib_read}`);

				ds_parser.write(at_filled);

				// console.warn(`worker ${process.env.WORKER_INDEX} locked after write`);

				if(b_locked) {
					b_waiting = true;
					await new Promise(f_set_waiting);
				}
			}

			console.warn(`worker ${process.env.WORKER_INDEX} finished reading range ${a_range}`);

			a_unread.push({
				type: 'buffer',
				value: Buffer.from(ds_parser._buffer),
			});
		}

		console.warn(`worker ${process.env.WORKER_INDEX} finished all ranges`);

		// close input file handle
		await df_input.close();

		// await triplifier flush
		await k_triplifier.flush();

		// return unread chunks
		return a_unread;
	},
});
