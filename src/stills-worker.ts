import { parentPort, workerData } from 'node:worker_threads';
import { faultsAsync } from './evidence-text.js';

/** One slice of a board's stills, measured off the server's thread so page and media requests keep answering. */
const jobs = workerData as { path: string; sha256: string }[];
for (const { path, sha256 } of jobs) {
  let unfit = false;
  try { unfit = (await faultsAsync(path)).some((f) => f !== 'text'); } catch { /* an undecodable or unreadable still is not refused */ }
  parentPort!.postMessage([sha256, unfit]);
}
