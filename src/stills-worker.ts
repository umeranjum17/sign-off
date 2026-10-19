import { parentPort, workerData } from 'node:worker_threads';
import { faults } from './evidence-text.js';

/** One slice of a board's stills, measured off the server's thread so page and media requests keep answering. */
const jobs = workerData as { path: string; sha256: string }[];
parentPort!.postMessage(jobs.map(({ path, sha256 }) => {
  try { return [sha256, faults(path).some((f) => f !== 'text')]; } catch { return [sha256, false]; }
}));
