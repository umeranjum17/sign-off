# Contract fixtures

Shared test messages for the [communication contract](../../docs/contract.md). Every tool that posts to sign-off runs them in its CI, so all tools agree on one shape per kind.

## Layout

```
fixtures/contract/<kind>.v<schema>/valid-<name>.json
fixtures/contract/<kind>.v<schema>/invalid-<field>-<rule>.json
```

- `<kind>` is `ask`, `report`, `evidence`, `gate` or `finding`, and `<schema>` its schema number, such as `ask.v1/`. A version ships a folder for every kind it validates. This version ships `ask.v1/`.
- Each file holds one message. An evidence fixture that names `media` ships those files next to it.
- Each kind has at least 2 valid files and 3 invalid ones: one with a required field missing, one over a limit, and one with an unknown field.
- An invalid file breaks exactly one rule. Its name gives the field and the rule, such as `invalid-title-too-long.json`, and sign-off's own tests check that the refusal names that field.
- Demo data uses the name Umer. No real names, paths or tokens.

## Running them

The npm package ships this folder. Install the exact version your tool targets, then run the valid files (`--expect-invalid` for the invalid ones is not built yet; until then each invalid file run alone exits 2):

```
npm install --no-save sign-off-axi@<exact>
npx sign-off-axi validate node_modules/sign-off-axi/fixtures/contract/*/valid-*.json
npx sign-off-axi validate --expect-invalid node_modules/sign-off-axi/fixtures/contract/*/invalid-*.json
```

Both must exit 0. The first passes only when every valid file is accepted; the second only when every invalid file is refused.

## Adding a fixture

A new rule gets a new invalid file. A changed shape is a new `schema` for that kind: keep the old folder, and add a new one beside it, such as `ask.v2/`.
