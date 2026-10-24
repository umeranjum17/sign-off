# 0.6.3 performance and PWA plan

Measured 24 October 2026 on main `39eb6c236557c2c714ae761dc071a73dfd37c65f` (0.6.2-dev).
This PR delivers profiling and the implementation plan, not the 0.6.3 release.

## Baseline

Lighthouse 13.0.1, installed Chromium 151, cold mobile navigation, simulated Slow 4G (150 ms RTT, 1638.4 Kbps), CPU 4x, 412×823 at DPR 1.75. The browser used the host's dark preference. Five independent cold runs, one per route; these are observations, not medians or a guarantee about the live board. A separate DevTools light Today audit scored A95/BP100 but did not include Performance.

The real CLI seeded a loopback board, then its valid card templates were expanded to 500 cards: 125 decisions, 125 plans, 125 evidence updates and 125 reports. There are 3000 tickets (300 roots, nine children each), four projects and varied priorities/progress. No live board, personal state, login or token was read. Shared media and repeated text compress better than a diverse live board; flat ticket lists, long histories, unique photos, open details and answered/archive-heavy boards still need coverage before release.

| Screen | Route | Performance | Accessibility | Best Practices | FCP | LCP | TBT | CLS | Main thread |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Today | `/` | 97 | 95 | 100 | 1.65 s | 2.40 s | 0 ms | .0095 | 592 ms |
| Decide | `#waiting` | 97 | 96 | 100 | 1.65 s | 2.40 s | 0 ms | .0097 | 1439 ms |
| Evidence | `#evidence` | 97 | 96 | 100 | 1.65 s | 2.40 s | 13 ms | .0097 | 808 ms |
| Reports | `#reports` | 97 | 96 | 100 | 1.65 s | 2.40 s | 9 ms | .0097 | 1161 ms |
| Tickets | `#tickets` | 97 | 96 | 100 | 1.65 s | 2.40 s | 10 ms | .0097 | 954 ms |

Every screen transfers 246185 bytes (~240 KiB). The same shell and full JSON are loaded on each route; the final Lighthouse frames confirm five distinct screens. Report `finalUrl` drops the fragment, while `finalDisplayedUrl` and the frame preserve it.

Private task evidence: `before/{today,decide,evidence,reports,tickets}-mobile.report.{html,json}`, the five `*-lighthouse.jpg` final frames and `before/summary.json`. Evidence stays outside Git under the task's `data/signoff-pwa-perf/`. Final candidate profiling also runs through default done-done evidence storage (`done-done run pwa-profile`). No media or raw reports are committed.

## What actually costs time

- `web/index.html` is 520797 bytes decoded, including every screen's JavaScript and nearly all screen CSS. Its compressed document costs 123351 bytes on the wire. Lighthouse identifies ~54 KiB of unused JavaScript on Today (69.7% of the script's transfer estimate), with a modelled 300 ms FCP/LCP saving. This is the largest JS opportunity, not a measured speedup.
- Today has ~60 KiB of estimated unused CSS (inline screen styles plus `ui.css`), modelled at 150 ms. `src/cli.ts` compresses HTML, API and media responses but its static `ICONS` branch serves CSS uncompressed. `ui.css` costs 27292 bytes and `tokens.css` 5797 bytes, even though the client accepts Brotli. The render-blocking estimates vary 120–320 ms by screen.
- `/api/decisions` is ~1.05 MB decoded on all five screens: ~533 KB cards, ~520 KB tickets; ~30 KB wire thanks to Brotli. `state()` in `src/cli.ts` constructs all fields; the poll parses the payload and compares two `JSON.stringify` results every 20 seconds, even when the server returns 304 and fetch exposes the cached body. This is a scalability concern, not the dominant measured network cost on this repetitive fixture.
- `ticketOf`, `tkById` and `tkUnder` scan the ticket array repeatedly (`web/index.html`); `tkLists` resolves a parent for every row. The server's `rollUp` builds children and recomputes progress. Ticket script bootup is 319 ms versus Today's 116 ms, but TBT remains ~10 ms. Indexing needs a flat/deep-tree interaction profile before prioritizing it over splitting.
- Inter is already local and preloaded: 48256 bytes, 48464 bytes transferred. Keep the preload and font-display behavior; do not add a second font request. Lists do not fetch evidence captures on this phone layout. Existing light/thumb creation, hashed media URLs and lazy viewers must survive future slices; this baseline does not certify an image-heavy detail load.
- CLS is small but nonzero (~.01), so "no layout shift" is not yet proven. Reserve the loading shell's geometry and inspect the layout-shift attribution before changing it. Today fails contrast and visible-label/accessibility-name checks; other screens fail contrast (and Evidence also has a label mismatch). Today is exactly at the accessibility floor.
- Manifest, 192/512 icons, maskable icon, apple-touch icon and theme-color tags exist. The manifest's old blue theme/background disagree with the current palette. There is no registered service worker or offline shell. A high Performance score is not proof of installability.

## Separate PR slices

Targets below are acceptance floors. Predicted gains are hypotheses to test on the same fixture; Lighthouse opportunities overlap and cannot be added together. Numeric optimization slices are ranked by expected score gain per effort. PWA work is a parallel release prerequisite even though it adds no Lighthouse category points.

| Order | Owner/size | Slice and files | Target and proof | Risk |
| --- | --- | --- | --- | --- |
| 1 | Sonnet, small | Compress static CSS/SVG/manifest responses in `src/cli.ts`, preserve Vary/content type/cache semantics; extend `test/design.test.mjs` load-budget integration journey. | P≥97/A≥95/BP≥95 all five; reduce CSS wire bytes from 33 KB, report FCP/LCP before/after. Expected +0–2 P points for low effort. | Wrong encoding/header or stale CSS cache; verify gzip, br and identity clients. |
| 2 | Sonnet, small | Contrast and accessible names in `web/tokens.css`, `web/ui.css`, relevant `web/index.html` controls; extend board-shell proof. Coordinate token ownership with the PWA worker. | A≥98 (release floor 95), P≥90/BP≥95; light/dark, phone/desk screenshots and Lighthouse. Expected +2–5 A points. | Palette/visual regression; preserve approved intent and test both themes. |
| 3 | **Sol hard spot 1**, medium | Split screen JavaScript and noncritical CSS from `web/index.html`; serve content-hashed files in `src/cli.ts`; preserve `export`'s self-contained output and `scripts/build-demo.mjs`. Update verify journeys and docs. | P≥98 target (floor 90), A≥95/BP≥95; reduce cold unused JS ≥50%, prove direct hashes, route transitions, keyboard/focus, frozen export and offline chunk loading. Expected +0–2 P points; higher regression risk than 1. | Shared closure state, asynchronous navigation races, frozen exports and PWA cache completeness. Land before final SW cache version. |
| 4 | **Sol hard spot 2**, medium | Trim/paginate state at producer `state()` and `/api/decisions` in `src/cli.ts`, screen consumers/poll in `web/index.html`, ticket/card journeys in `test/`. Preserve legacy full endpoint or version the new shape. | P≥90/A≥95/BP≥95, target P≥97; cold list JSON ≤250 KB decoded on this fixture, bounded page size, accurate global counts/search/ticket links, incremental updates with no lost responses. | Global Today counts, cross-screen links, search, read receipts, mutations returning full state and offline completeness; cannot paginate a single array without updating all consumers. |
| 5 | Sonnet, small | Inspect layout-shift attribution and image-heavy details; reserve shell/image space, retain lazy/compressed stills (`web/index.html`, `web/ui.css`, `src/images.ts` only if measurement warrants). Extend load-budget proof with distinct realistic photos. | P≥90/A≥95/BP≥95, CLS≤.01 with no visible shift after first meaningful paint; existing ≤12 captures/1.5 MB Evidence budget retained, dimensions fixed before image/font load. | Aspect ratio/cropping and placeholders; do not preload every image or sacrifice accessible text. |
| Parallel prerequisite | Sonnet, medium | Service worker/offline shell and manifest palette in new `web/sw.js`, `web/manifest.webmanifest`, registration/status in `web/index.html`, routes/cache headers in `src/cli.ts`; icons only if install tests require. Update PWA feature map and integration/browser journey. | Installable on HTTPS/localhost, offline reload and already-loaded data on all five routes; P≥90/A≥95/BP≥95. Cold unknown data gets an honest unavailable state. | Authenticated cached data, stale versions, cache eviction, cookie/token rotation, remote HTTP origins; no silently successful offline writes. Cache only successful authorized reads, version/purge shell caches, keep board data scoped and visibly stale. |
| Final | Sonnet, small | 0.6.3 release bump (`package.json`, lockfile), README/packaged skill/site as applicable, final evidence and feature map. | Three cold mobile runs per screen, median P≥90/A≥95/BP≥95 and no run below floors; Android Chrome and iPad Safari add-to-home-screen launch/offline proof, install-prompt frame (Android) and Safari Add to Home Screen flow frame, theme/splash screenshots. | iPad has its own home-screen flow, no equivalent Android install prompt; current Lighthouse has no PWA category. Verify capabilities explicitly. |

No hard implementation slice is included in this profiling PR: every baseline already exceeds the numeric floors and the ~300 ms split opportunity does not outweigh the missing PWA capability or cheaper CSS work. Sol owns slices 3 and 4 after the cheap slices are remeasured. Firstmate can start the PWA worker and CSS worker independently (both touch `src/cli.ts`, so assign distinct route branches and reconcile before proof); contrast should avoid the PWA worker's manifest files.

## Repeat the measurement

Build first (`npm run build`). Install pinned Lighthouse 13.0.1 into task-owned external tooling/cache with npm/npx, never globally. Set `LIGHTHOUSE_CLI` to that package's `cli/index.js`, `CHROME_PATH=/usr/bin/chromium`, and run through the host memory gate:

```sh
LIGHTHOUSE_CLI=/absolute/task/tooling/node_modules/lighthouse/cli/index.js \
CHROME_PATH=/usr/bin/chromium \
~/firstmate/config/fm-mem-gate.sh done-done run pwa-profile
```

`done-done` uses its default home and records the candidate commit. Alternatively `node scripts/profile-board.mjs /absolute/new/evidence/folder` writes directly into the task evidence folder. It refuses a previously seeded folder, validates 500/3000 API counts, saves five full reports and frames, and stops its own server through the CLI even on failure. Its relative `TMPDIR=tmp` remains under that evidence folder and avoids Chrome's Unix socket path length limit. Delete only that run's scratch after all its Chrome processes have exited; keep reports, summary and the fixture. The harness does not assert scores: a measurement below target must remain visible rather than be hidden by a failing score gate.

For final release, also use a diverse, sanitized large fixture (flat and nested tickets, answers, historical cards, unique large images and long report bodies), record device/browser/commit and audit settings, check the server's response sizes per route, and test warm polls, See all, search, ticket children, and detail taps under throttling. Repeat on the actual deployment's secure origin without putting its access token or cookies into evidence. Before/after must use the same fixture and Lighthouse settings. Capture install evidence only after installation is actually available; this PR makes no install, offline, splash or after-optimization claim.
