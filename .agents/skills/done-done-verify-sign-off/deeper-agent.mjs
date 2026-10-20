// The agent end of Go deeper: waits for the person's tap on a guided plan or report, answers it, and streams the answer back.
// Usage: node deeper-agent.mjs <board.json> <filer> <doc.json> [count]   (cli path: SIGN_OFF_CLI, default dist/cli.js)
// With MINIMAX_API_KEY in the environment a model writes the answer from the document; without it a plainly labelled
// stand-in answers, so the round-trip still proves the board's streaming. The key is read from the environment only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const [board, filer, docPath, count = '1'] = process.argv.slice(2);
const cli = process.env.SIGN_OFF_CLI ?? 'dist/cli.js';
const doc = readFileSync(docPath, 'utf8');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 120000 });

const ANSWER = 'You are the agent that wrote this plan or report. The person tapped Go deeper on one part of it. Answer only what they asked, in plain words, as 2 or 3 short paragraphs of at most 2 sentences each and under 90 words in all, no markdown, no headings, no lists. Use only facts in the document; where it does not say, say what you would check next.';
async function modelAnswer(ask) {
  const res = await fetch('https://api.minimax.io/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.MINIMAX_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'MiniMax-M2', max_tokens: 2500, system: ANSWER,
      messages: [{ role: 'user', content: `The document:\n${doc}\n\nThe part they tapped: ${ask.part} ("${ask.about}")\n${ask.q ? `Their question: ${ask.q}` : 'They tapped Go deeper without a question: explain this part more fully.'}` }] }),
  });
  if (!res.ok) throw new Error(`model answered ${res.status}`);
  const text = (await res.json()).content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    .replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!text) throw new Error('model gave no answer');
  return text;
}
const standIn = (ask) => `Stand-in answer, no model key was set for this run. You tapped Go deeper on ${ask.part}: ${ask.about}`;

let answered = 0;
const until = Date.now() + 10 * 60 * 1000;
while (answered < +count && Date.now() < until) {
  const waited = run('wait', board, '--filer', filer, '--events', '--timeout', '30');
  for (const line of waited.stdout.split('\n')) {
    let ask; try { ask = JSON.parse(line); } catch { continue; }
    if (ask.event !== 'deeper') continue;
    const text = process.env.MINIMAX_API_KEY ? await modelAnswer(ask).catch((e) => `${standIn(ask)} (${e.message})`) : standIn(ask);
    const pieces = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    for (const [i, piece] of pieces.entries()) {
      const r = run('deeper', board, '--id', ask.id, '--text', piece.slice(0, 2000), ...(i < pieces.length - 1 ? ['--more'] : []));
      if (r.status !== 0) throw new Error(r.stdout + r.stderr);
      await sleep(1200);
    }
    answered++;
    console.log(`answered ${ask.id} ${ask.part} (${pieces.length} pieces, ${process.env.MINIMAX_API_KEY ? 'model' : 'stand-in'})`);
  }
}
if (answered < +count) { console.error(`only ${answered} of ${count} asks arrived`); process.exit(1); }
