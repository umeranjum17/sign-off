#!/usr/bin/env node
// A ticket adapter for when another adapter's `list` cannot be read in time: its `describe` is that adapter's own (read only, asked each time), and its tickets are made up here, spread over
// the statuses that describe lists, with the project field only where that describe has one. Nothing is written anywhere; `create`, `update` and `comment` are refused as `unsupported`.
// TICKET_DESCRIBE_FROM=<the adapter whose describe to ask>, with the environment that adapter reads its store from. The tickets are stand-ins: their ids are `stand-in--NN`. Run tickets-real-shots.mjs
// over it (SIGN_OFF_TICKETS_ADAPTER=this file) to see a board drawn from a real `describe` with rows that are not real.
import { execFileSync } from 'node:child_process';

const [op] = process.argv.slice(2), from = process.env.TICKET_DESCRIBE_FROM;
const send = (body, code = 0) => { process.stdout.write(JSON.stringify(body) + '\n'); process.exit(code); };
const fail = (code, message, retryable = false) => send({ error: { code, message, retryable } }, 1);
if (!['describe', 'list', 'get', 'history'].includes(op)) fail('unsupported', `${op} is not answered: this adapter only reads.`);
if (!from) fail('unavailable', 'TICKET_DESCRIBE_FROM names no adapter.');
let input = '';
for await (const chunk of process.stdin) input += chunk;
const req = JSON.parse(input || '{}');

let described;
try { described = execFileSync(from, ['describe'], { input: JSON.stringify({ interface: 1 }), env: process.env, encoding: 'utf8', timeout: 60_000 }); }
catch (e) { process.stdout.write(e.stdout || JSON.stringify({ error: { code: 'unavailable', message: `describe of ${from} failed: ${e.message}`, retryable: true } }) + '\n'); process.exit(1); }
if (op === 'describe') { process.stdout.write(described); process.exit(0); }

const fields = JSON.parse(described).fields, values = (name) => fields.find((f) => f.name === name)?.values?.map((v) => v.value) ?? [], hasProject = fields.some((f) => f.name === 'project');
const statuses = values('status'), kinds = values('kind'), MIN = 60_000, now = Date.now();
// How many tickets each status gets, in the order describe lists them (the pattern repeats if it lists more than four), and who and what they are.
const SPREAD = [5, 3, 2, 4], PEOPLE = ['Umer', 'Sam', null, 'lane-4821-session-handoff-worker'], PROJECTS = ['alpha', 'beta', null], TITLES = ['Ship the settings page', 'Write the release note', 'Move the export to its own page',
  'Check the save twice on a slow network', 'Fix the sheet that opens behind the dock', 'Sort the inbox by hand', 'Publish the plan reader', 'Rename the export button', 'Keep the old settings link for a week',
  'Hold the export until the vendor answers', 'Show the real error when the list cannot be read', 'Make a ticket and pick its epic', 'Wait for the answer to the sign-in question', 'Group the board by project'];
const tickets = statuses.flatMap((status, k) => Array.from({ length: SPREAD[k % SPREAD.length] }, () => status)).map((status, i) => {
  const ago = (i + 1) * 37 * MIN, at = (t) => new Date(now - t).toISOString().replace(/\.\d+Z$/, 'Z'), project = PROJECTS[i % PROJECTS.length];
  return { id: `stand-in--${String(i + 1).padStart(2, '0')}`, rev: `r-${i + 1}`, title: TITLES[i % TITLES.length], body: '', kind: kinds.length ? kinds[i % kinds.length] : '', status, assignee: PEOPLE[i % PEOPLE.length], labels: [],
    parent: null, links: [], created_at: at(ago + 3 * 60 * MIN), updated_at: at(ago), extra: {}, ...(hasProject && project !== null && { project }) };
});

if (op === 'list') send({ tickets, complete: true });
const ticket = tickets.find((t) => t.id === req.id);
if (!ticket) fail('not_found', `No ticket ${req.id}.`);
send(op === 'get' ? { ticket } : { events: [] });
