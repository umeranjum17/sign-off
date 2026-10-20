import { basename, dirname, join, resolve } from 'node:path';

/** Where the plan-review journey keeps its diagnostics: outside the evidence folder by default, so
 *  records that repeat between states are never cited as two captures proving one claim. */
export const recordsDir = (out, override = process.env.PLAN_REVIEW_DIAGNOSTICS) =>
  override ? resolve(override) : join(dirname(out), `${basename(out)}-diagnostics`);
