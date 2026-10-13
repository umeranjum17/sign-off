# One-of-few options and the answer note

Covers `options` (2 to 6 choices), `recommend_value`/`default_if_silent` naming the question's own values, the optional note on an answer, and old files and answer lines reading as before. Follow Launch and Drive in `SKILL.md` first. Run every step on the Android emulator (labeled `emulator`) and on desktop `1440x900x1`, in light and dark.

Serve a scratch copy of `fixtures/options-decisions.json` (3, 6 and 2 long-label options, plus a plain yes/no). `FIT` below is
`document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('button')].every(b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= innerWidth)`.

| # | Step | Pass when |
|---|---|---|
| 1 | Light and dark, wait `4 waiting`, full-page shots | `FIT` is true; the six-option group has 6 buttons and every long label wraps inside its button; the unbroken label breaks instead of overflowing; the plain yes/no row keeps the two fixed buttons (no `.choices.many`) |
| 2 | Light, `eval "document.documentElement.style.fontSize = '130%'"`, shot | `FIT` is still true; nothing is cut or overlaps |
| 3 | Dark, click `Other answer, When should…`, fill the box (`textbox "Your own answer…"`) with `Umer: after the Friday stand-up.`, shot | The question's about text stays visible; the box sits above the choices |
| 4 | Click `button "Friday, When should…`, poll `answers --json` | Prints `"release-window":{"answer":"friday","label":"Friday","close":"done",…,"note":"Umer: after the Friday stand-up."}` |
| 5 | Click `button "North America, Which region…` with no note, poll `answers --json` | `report-region` is `na` and has no `note` key |
| 6 | Kill the server, start it on the same port, reload dark and light, shots; save `answers --json` as `answers-after-restart.json` | Friday and North America are the only pressed buttons; the row's `Other answer · note saved` opens to a box holding `Umer: after the Friday stand-up.`; the file equals the output before the restart |
| 7 | Desktop keyboard only: Tab to `Other answer, Keep the old export button?`, Enter, type a note (the caret is already in the box), Shift+Tab back to `Keep it for one more release`, shot, Enter | Focus lands in the textarea, then on `Keep it for one more release` with a visible focus ring; `answers --json` prints `keep` with the typed note |
| 8 | Serve a copy of `fixtures/sample-decisions.json` with two old answer lines (no `note`, written before options existed), light and dark, shots | `3 waiting · 2 answered`; only the saved Yes and No are pressed; no note line and no wrapped layout; `answers --json` prints exactly `{"short-question":{"answer":"yes","label":"Yes","close":"done","at":…},"use-dark-default":{…}}` with no new keys |
| 9 | With `HOME` in scratch: `raise --title "Umer: when should it ship?" --option today=Today --option friday=Friday --option next-week="Next week" --recommend friday`, then `raise --title x --option a=A`, then `--recommend maybe`; `open --port 0`, answer Friday with a note on the board, `answers` and `answers --json` | `raised`; exit 2 twice with `error:` naming `options` and `recommend_value`; the board shows the three choices; TOON has `answers[1]{key,answer,at,note}:` and JSON has `"note"` |

The integration test (`npm test`) also covers: old answer lines print byte-for-byte as before, a note over 500 characters or not text (400), an answer outside the options (400), trimming, a repeat click with the same note writing no new line, and invalid files (1 or 7 options, repeated or malformed values, blank labels, a recommendation outside the options) exiting 2 with the item, key and field.
