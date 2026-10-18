# Contract fixtures

Shared test messages for the [communication contract](../../docs/contract.md). Every tool that posts to sign-off runs them in its CI, so all tools agree on one shape per kind.

## Layout

```
fixtures/contract/<kind>.v<schema>/valid-<name>.json
fixtures/contract/<kind>.v<schema>/invalid-<field>-<rule>.json
```

- `<kind>` is `ask`, `report`, `evidence`, `gate`, `finding` or `plan`, and `<schema>` its schema number, such as `ask.v1/`. A version ships a folder for every kind it validates. This version ships `ask.v1/`, `report.v2/`, `evidence.v1/`, `gate.v1/`, `finding.v1/` and `plan.v1/`. This is the one list of shipped folders; other docs point here.
- Each file holds one message. An evidence fixture that names `media` ships those files next to it, and a report fixture its page and picture, and a plan fixture its page, under `page/`.
- Each kind has at least 2 valid files and 3 invalid ones: one with a required field missing, one over a limit, and one with an unknown field.
- An invalid file breaks exactly one rule. Its name gives the field and the rule, such as `invalid-title-too-long.json`, and sign-off's own tests check that the refusal names that field.
- Demo data uses the name Umer. No real names, paths or tokens.

## Running them

The commands each tool's CI runs are in [section 10 of the contract](../../docs/contract.md#10-conformance).

## Adding a fixture

A new rule gets a new invalid file. A changed shape is a new `schema` for that kind: keep the old folder, and add a new one beside it, such as `ask.v2/`. A schema this version refuses leaves with its folder, as `report.v1/` (a report of text only) did.
