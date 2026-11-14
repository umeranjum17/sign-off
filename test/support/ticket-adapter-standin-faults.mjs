#!/usr/bin/env node
// The faults driver of the stand-in adapter, called as `faults <none|unreadable|partial>`: it switches the stand-in's backend (in $TICKET_STANDIN_DIR) between healthy,
// unreadable and readable only in part, which the conformance script needs to prove a failed read is an error and a list that cannot be whole is refused.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [mode] = process.argv.slice(2);
if (!['none', 'unreadable', 'partial'].includes(mode)) { console.error('usage: faults <none|unreadable|partial>'); process.exit(2); }
writeFileSync(join(process.env.TICKET_STANDIN_DIR, 'fault'), mode);
