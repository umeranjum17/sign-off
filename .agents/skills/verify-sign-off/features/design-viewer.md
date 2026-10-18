# Design viewer

## Sub-features

- "Review full screen" on a design review opens a full-screen viewer over every screen, in order: "n of N" and the screen name, Previous and Next buttons, arrow keys, and a swipe on touch.
- Each screen shows its picture or .html view for the reader's width and theme, with Approve screen or Request change, and a note that stays with the screen.
- Closing the viewer returns to the same review with the screen answers saved; a reload shows them again.
- A stored note with no verdict reads as a change; a screen with no answer reads as not reviewed yet.

## Drive

Build with `npm run build`. Run `.agents/skills/verify-sign-off/viewer-shots.sh "$DONE_DONE_EVIDENCE_ROOT"` from the repo root.
It seeds a 17-screen design in a throwaway HOME, serves it, and captures screen 1 and screen 4 (an .html view) in the viewer at 390 and 1280, light and dark: `viewer-screen-<n>.<theme>.<width>w.png`.
It prints each viewer's header and whether the page scrolls sideways.

The focused behavior is in `test/design.test.mjs`: the posted design test opens the viewer, checks the legacy note reads as a change, steps with the arrow keys, approves a screen, closes, reloads, and reaches 17 of 17.

## Cleanup

The script removes its throwaway folder on exit and stops its own board server. Keep only the captures in the evidence folder.
