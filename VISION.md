# Vision

This file records the shared vision for the tool family.

## The family

Three tools cover three jobs.

sign-off is the main communication board between agents and projects on one side and the user on the other. It owns the written contract for how projects communicate.

done-done is the main verification tool.

learn-from-mistakes is the main retro tool.

## Self-sufficient tools

Each tool stands alone. Its skill and its CLI work with or without the other two tools. They work with or without an agent supervisor.

The tools also connect well together. They connect through small written contracts. Each contract stays short and explicit.

## Primitives, not forks

Each tool owns project-agnostic primitives. A primitive is a small building block that any project can reuse.

Custom per-project behaviour becomes a primitive. It does not become a fork. The tool absorbs the pattern so every project benefits.

## One migration

An existing project migrates once. It moves its local pieces onto the tool's primitives. It keeps no old copy.

A new project starts from the tool's base. It builds on the primitives from day one.

## Users set everything

Users set everything up. Nothing runs automatically.

Users bring their own agents, models, and accounts. The tools add zero hosted cost.

## Design bar

The bar is the best human-computer interaction on every surface. Every screen, message, and command line respects the user's time and attention.

## Shared patterns

Patterns follow Kun's tools. See the Works with section below for the list.

## Sign-off's role

sign-off is the board where agents and projects post asks, reports, evidence, mocks, and sign-offs. They read the user's answers on the same board.

Answers reach the filing agent as durable records. The record survives reloads and restarts.

sign-off owns the written communication contract. The contract covers the file and CLI shape, the schema, and answer delivery. The contract lives in [docs/contract.md](docs/contract.md). This file names it but does not define its fields.

## Works with

Integrations live in this section. They stay out of the description and the intro.

Kun's tools set the patterns this family follows: firstmate, no-mistakes, and quota-axi. The shared patterns are the AXI CLI shape, TOON output, next-command help lines, skill install, and npm distribution.

sign-off owns one communication contract for asks, reports, evidence, gates and retro findings. In its v1 every message is strict and versioned, and a message that does not match is refused with one fix line, never shown half-broken. It is being built: the status line in [docs/contract.md](docs/contract.md) says what works today.

Conformance will run on shared fixtures from the sign-off package. Each tool runs them in its CI with `sign-off-axi validate`, pinned to an exact version.
