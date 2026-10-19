# Evidence

The Evidence area (`#evidence`) in the Spacious look: passed proof only, grouped by the project named in the check that ran, with the capture as the card's hero. Every other evidence update waits in Waiting on you with its honest result, so nothing is shown as proof unless it passed and no update is unreachable. A card opens the update's own screen showing the whole capture, what it proves, the result, what ran, the change, who checked it and when.

## Sub-features

- Evidence lists passed proof (`evidenceCard.result` is `RUN PASS`, shown with `Passed`) and any update with its own capture and no checked run (shown with `No result yet`), newest first, the capture as the hero. Every other evidence update (a plain update with no capture, `Failed`, `Did not finish`, `Could not check`) is not listed; it waits in Waiting on you, with its result badge on its row and on Decide, the reason a run could not be checked, and the normal verdicts and Dismiss, so `wait --filer` always gets an answer. Updates are grouped by the project in their run's proof line (`verify-<project>: ...`), trimmed and compared without case so `verify-Sign-Off:` and `verify-sign-off:` share one head; proof that names no project goes under **Other**. Each card shows its first picture (or clip) as the hero, the title, `Passed` and the filing time. A capture that changed or went missing says so instead of showing a broken frame.
- The card opens `#evidence/<key>`. The item shows every capture of the update, the title, the one-line about, `Proof` rows for Result, What ran, Checked by, Project, When and a Change link to the pull request, then the verdicts and the raw run lines under Details. Checked by is the one-word checker named before the first colon of the run's `proof` line (for example `verify-sign-off`); What ran is the rest of that line. A proof line with no such prefix shows no Checked by row and What ran is the whole line.
- On a desk (60rem and wider) cards sit two across. On a phone they keep the screen's width with the whole capture inside the card.
- A verdict saved from the item stays on that screen; back on the list the answered update leaves Evidence for Answered.

## How to get to it (user POV)

Open the URL seed-board.sh prints, then tap Evidence in the sidebar or the tab bar. Tap a card to open the update; the ‹ Evidence link returns to the list.

## Driving it

1. Launch as SKILL.md says and keep BASE.
2. Capture the list at both widths and themes: `shots.sh BASE "$DONE_DONE_EVIDENCE_ROOT" evidence`.
3. The seed links one update to a passing done-done run and leaves another plain, so the list shows the `sign-off` project head with a `Passed` card, and the plain update in Waiting on you with no result badge. Open the passed update, `BASE#evidence/update-2`, and capture it at both widths and themes as `evidence-item.<theme>.<width>w.png`; it shows the Result, What ran, Checked by, Project, When and Change rows.
4. On a phone, check the card fills the content width and the item never scrolls sideways; on a desk, check cards sit two across.
5. Save a verdict from the item and confirm the update leaves Evidence for Answered; undo it if the board is reused.
6. Look at every capture: the capture is whole inside its tile, nothing is cut and the tab bar covers no text.
