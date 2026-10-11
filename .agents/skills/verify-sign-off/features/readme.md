# README media and rendered README

The README images in `docs/media/` are shots of the real page serving `fixtures/demo-decisions.json`. They are clean synthetic demos, never proof records.

1. Copy `fixtures/demo-decisions.json` to `$SCR/demo.json` and serve it (Launch in `SKILL.md`).
2. Answer `weekly-digest` Yes in the page and poll `answers` until it is saved.
3. Shoot `desktop-light.png` and `desktop-dark.png` at `1440x900x1`, and `phone-light.png` and `phone-dark.png` at `390x844x3,mobile,touch`, into `docs/media/`. Use viewport shots, not full-page, so the hero stays short.
4. After the branch is pushed, open `https://github.com/<owner>/sign-off/blob/<branch>/README.md` and take four shots into the private evidence folder: `readme-phone-light.png`, `readme-phone-dark.png`, `readme-desktop-light.png`, `readme-desktop-dark.png`, each with `--full-page`.

Pass when: in all four rendered shots the logo, promise, hero, why, screenshot grid and quick start are readable; the hero switches with the theme; nothing is cut or overlapping.
