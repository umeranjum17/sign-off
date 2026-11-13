import { homedir } from 'node:os';
import { join } from 'node:path';

/** The folder to read: a leading ~ is the user's home. Undefined when none is named. */
export const homeOf = (named?: string) => {
  const raw = named?.trim();
  if (!raw) return undefined;
  return raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
};
