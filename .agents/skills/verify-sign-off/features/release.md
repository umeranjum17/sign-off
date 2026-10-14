# Release workflow

`.github/workflows/release.yml` publishes `sign-off-axi` to npm on every push to main when the package.json version is not on npm yet. It uses npm trusted publishing (OIDC), so there is no token or secret to check.

1. `actionlint .github/workflows/release.yml` (or `npx --yes actionlint`) prints nothing.
2. Run the publish gate step's script from the repo root in a throwaway HOME. With a version already on npm it prints `<name>@<version> already on npm` and exits 0; with a version not on npm (try `99.0.0` in a copy of package.json) it reaches `npm publish`. Never let it actually publish.
3. After a merge, `gh run list --workflow release.yml` shows the run; a version-bump merge ends with the new version in `npm view sign-off-axi version`.

Pass when: lint is clean and the gate takes the right branch for both versions.
