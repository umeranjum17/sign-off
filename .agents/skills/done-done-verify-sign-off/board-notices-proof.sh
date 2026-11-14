#!/usr/bin/env bash
# The whiteboard canvas's licence and notice review in one sealed run (CLI only, screen: none): the real build and its review, the notices it writes, the packages it holds
# inside other packages (each named with its own version), and the test that reads the bundle's packages from the esbuild metafile and not from the review's own list;
# then the approved design-pick listing the merge gate demands. steps.json is written after the Designs capture, because the claim is about the notices.
set -euo pipefail
out=${DONE_DONE_EVIDENCE_ROOT:?DONE_DONE_EVIDENCE_ROOT must be set}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../../.." && pwd)
cd "$repo"
node scripts/build-board.mjs > "$out/board-build.log" 2>&1 || { cat "$out/board-build.log"; exit 1; }
grep -q '^board canvas: [0-9]* packages and the Excalifont font reviewed' "$out/board-build.log"
cp web/board/NOTICES.txt "$out/NOTICES.txt"
grep -q '^Every package the canvas bundle holds is listed here' "$out/NOTICES.txt"
node --input-type=module -e '
import { canvas } from "./scripts/build-board.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const built = await canvas({ write: false }), lines = readFileSync(process.argv[1], "utf8").split("\n");
// What a person reading the notices sees: the opening (the claim and the index of every package) and, for each package nested inside another, the first copyright line of the text shipped for it.
writeFileSync(process.argv[2], `${lines.slice(0, lines.findIndex((l, i) => i > 5 && l.startsWith("## ") && !l.startsWith("## Packages"))).join("\n")}\n`);
const heads = lines.flatMap((l, i) => l.startsWith("The text, as shipped by ") ? [{ i, ids: l.slice(24, -1).split(", ") }] : []);
const holder = (id) => { const h = heads.find((x) => x.ids.includes(id)); if (!h) return ""; const end = lines.findIndex((l, i) => i > h.i && (l.startsWith("The text, as shipped by ") || l.startsWith("## "))); return lines.slice(h.i, end < 0 ? undefined : end).find((l) => /copyright/i.test(l)) ?? ""; };
const nested = [...new Set(built.packages.filter((p) => p.dir.split("node_modules/").length > 2).map((p) => `${p.name}@${p.version}`))];
writeFileSync(process.argv[3], `${built.packages.length} packages reviewed, ${nested.length} of them nested inside another package:\n${nested.map((id) => `${holder(id) ? "named" : "MISSING"}  ${id}  ${holder(id).trim()}`).join("\n")}\n`);
' "$out/NOTICES.txt" "$out/notices-index.txt" "$out/nested-packages.txt"
! grep -q MISSING "$out/nested-packages.txt"
node --test --test-global-setup=./test/temp-folder.mjs test/board-notices.test.mjs > "$out/board-notices.log" 2>&1 || { cat "$out/board-notices.log"; exit 1; }
grep -q '^ℹ fail 0' "$out/board-notices.log"
node "$here/designs-shots.mjs" "$out" dark 1440
node -e '
const fs = require("fs"), out = process.argv[1], v = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).version;
fs.writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "The whiteboard canvas built from the package'"'"'s own files, with its licence and notice review", steps: [
  "Build the canvas: the review reads the licence and notices of every package the bundle holds and the build ends with the count of packages reviewed (board-build.log).",
  "Read the notices the build wrote: the line that says every package is listed is there, with each package named by name and version (notices-index.txt, the opening of NOTICES.txt).",
  "List the packages that sit inside another package'"'"'s own node_modules: each is named in the notices with its own version and the holder line of the text shipped for it (nested-packages.txt).",
  "Run the notices test: it reads the bundle'"'"'s packages from the build'"'"'s own input list and each package'"'"'s package.json, and fails unless every one is named and its own licence text ships (board-notices.log)."], result: "Every package the canvas bundle holds, copies nested inside other packages included, is named in the shipped notices with its own version and licence text, and the test that proves it reads the bundle and not the review (board-build.log, notices-index.txt, nested-packages.txt, board-notices.log)." }, null, 2));
' "$out" "$repo/package.json"
