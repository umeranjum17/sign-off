# README media and rendered README

The README images in `docs/media/` are shots of the real page serving `fixtures/demo-decisions.json`. They are clean synthetic demos, never proof records. `docs/flow-*.svg` is an explanatory illustration, not a product screenshot.

## Product media

For a docs-only change, reuse the unchanged genuine shots; do not rerun product proof to recreate them. The `desktop-*-list.png` derivatives crop the original 2560×1520 desktop shots to `1680x1460+440+0`, removing only the empty side margins and bottom. Preserve the originals.

If the product page changes:

1. Copy `fixtures/demo-decisions.json` to `$SCR/demo.json` and serve it (Launch in `SKILL.md`).
2. Answer `weekly-digest` Yes in the page and poll `answers` until it is saved.
3. Shoot desktop at `1440x900x1` and phone at `390x844x3,mobile,touch`, in both themes. Use viewport shots, not full-page. Keep private proof outside the repo; publish only clean synthetic demos and adjust the documented crop to the actual source dimensions.

## Rendered README

Use the unique browser session/profile from `SKILL.md`. Set `EVIDENCE` to a fresh private folder and `COMMIT` to the full pushed candidate SHA. Record both the SHA and `git ls-remote origin refs/heads/<branch>` in that folder.

1. Open `https://github.com/<owner>/sign-off/blob/$COMMIT/README.md`; wait for `Quick start`.
2. For each theme (`light`, `dark`), emulate both `1440x900x1` and `390x844x3,mobile,touch`. Always pass viewport AND color scheme. Await the actual README images and record their loaded state, resolved URL, natural width and rendered width:
   ```sh
   chrome-devtools-axi eval 'async () => { const imgs = [...document.querySelectorAll(".markdown-body img")]; await Promise.all(imgs.map(i => i.decode().catch(() => null))); return {url:location.href,theme:matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",background:getComputedStyle(document.body).backgroundColor,images:imgs.map(i => ({alt:i.alt,src:i.currentSrc,loaded:i.complete && i.naturalWidth > 0,naturalWidth:i.naturalWidth,width:i.getBoundingClientRect().width}))}; }'
   ```
3. Before EVERY screenshot, reset the page scroll and allow GitHub's sticky file toolbar to settle; restored scroll can otherwise cover the flow in a full-page capture:
   ```sh
   chrome-devtools-axi eval 'async () => { window.scrollTo(0,0); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return {scrollY}; }'
   ```
   Confirm `scrollY: 0`, then capture `readme-desktop-light.png`, `readme-desktop-dark.png`, `readme-phone-light.png`, `readme-phone-dark.png` with `chrome-devtools-axi screenshot "$EVIDENCE/<name>.png" --full-page`.
4. In each theme, also inspect `320x700x2,mobile,touch`. Repeat at 130% text size on narrow phone and desktop. This is a text-only browser stress probe, not a production style change:
   ```sh
   chrome-devtools-axi eval '() => { const a=document.querySelector(".markdown-body"); const sizes=[a,...a.querySelectorAll("*")].map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]); sizes.forEach(([e,s])=>e.style.fontSize=`${s*1.3}px`); return {fontScale:1.3}; }'
   ```
   Record article bounds, `clientWidth`/`scrollWidth`, and image bounds; inspect the visual's three labels for clipping. Capture the stress cases privately. Open the same URL again to reset text before another normal-size case, then re-emulate.
5. Find the visible `file-format reference` link in a fresh snapshot, click it, wait for `Questions`, and confirm its URL is `docs/file-formats.md` at the same SHA and both Questions and Answers render. Save the observed result.
6. Inspect every screenshot. Close only the named session you launched and remove its scratch profile.

Pass when: the purple three-step visual clearly explains agent question → one-click answer → agent receipt; both desktop shots are single full-width readable lists, not tiny table thumbnails; the genuine phone shots wrap rather than force a wide table; the source quick start stays three steps; the docs link opens the unchanged reference. All assets must load, both README themes must be observed, and no new content may overlap, clip or create horizontal overflow at phone390, narrow320, desktop1440 or 130% text. GitHub's own code blocks may scroll internally; do not confuse that with new page overflow.
