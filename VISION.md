# Vision

## Who it is for

A person with coding agents working for them across their projects. sign-off is the open-source review board where those agents bring what needs that person: questions, proof of finished work, plans, reports and proposed changes.

## The problem

Agents need answers and the person needs proof. Without one board, questions come scattered, repeated and badly formed, proof arrives as text in a picture, and a board that fills with noise stops being read. An ask the person cannot answer is a defect.

## The end state

sign-off is the main communication board between agents and projects on one side and the person on the other. It is the one place the person decides:

- **Evidence** from done-done: captures of the real product with the honest result of the check.
- **Quick yes or no decisions**: quick answers first, the recommended answer first, typing last; one tap, with Undo.
- **Retro changes by version** from learn-from-mistakes, to Apply or Skip.
- **Plans and reports** as pages to read and answer in place.

It works on phone and desktop, by day and by night (light and dark), and at the design bar below. The answer reaches the filing agent as a durable record that survives reloads and restarts.

## Principles and quality bar

- **The best human-computer interaction on every surface.** Linear-grade and visual first. Every screen, message and command line respects the person's time and attention.
- **Keeps only what matters.** Decide holds only live asks, and old stuff goes; one decision is one card.
- **Self-sufficient.** The CLI and the skill work alone, with no other tool and no supervisor, and connect well with the sibling tools when installed together. They work the same with or without an agent supervisor. A newcomer installs it from npm in under 5 minutes.
- **Taste built in.** Every design and behaviour call lands in the published package and its shipped skill as the default, never in one person's setup.
- **Strict, written contract.** One small contract covers asks, reports, evidence, gates, retro findings and plans ([docs/contract.md](docs/contract.md)). A message that does not match is refused with one fix line, never shown half-broken.
- **Primitives, not forks.** Per-project behaviour becomes a reusable building block every project gets.
- **Users set everything.** Nothing runs automatically. Users bring their own agents, models and accounts; sign-off adds zero hosted cost.
- **Provider agnostic.** It names no particular person, agent vendor or model.

## What it is not

- Not the worker. sign-off is a dashboard only: it does not do the work, run the checks (done-done does) or run the retros (learn-from-mistakes does). It shows them and carries the answer back.
- Not a hosted service. It runs on the person's own machine.
- Not a status feed. Merges, PR outcomes, receipts and status notes are never reports, and proof is never a Pass/Fail question.

## Next milestones

Each ships in the next [npm release](https://www.npmjs.com/package/sign-off-axi?activeTab=versions) once it merges.

1. **The approved design on every screen.** The live board matches the approved design on every screen: Today, Decide, Evidence and Reports, phone and desk, including the floating tab bar and the design review flow.
2. **Speed budgets and image compression.** The board is held to measured speed budgets, and images are compressed and resized on the way in.
3. **Tickets.** Tickets as a standalone sign-off feature, with an open API.
