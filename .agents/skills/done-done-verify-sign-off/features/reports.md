# Reports

The Reports tab (`#reports`) from the approved feel prototype (signoff-feel-v2): what agents filed to explain something, read like Mail.

## Sub-features

- Head: the date in small caps over the large title Reports, then "N new · M in all" (or "M reports · all read"), and More (…) at the top right holding Mark all as read (while one is new), Select and Archive all.
- List: Today (filed today) over Earlier, newest first, each under a head with its count. A row is a 58px teal tile with the line drawing of its form (before and after, chart, diagram, or a book), its title, a blue dot while it is not read, two lines of what it says, and one quiet line: form, steps, video, project (`group`) and time, such as "Before and after · Video 0:28 · Sign-in · 07:19". Who asked heads the report's own page.
- Read state, kept beside the board (`<board>.reads.jsonl`, a `{key, read}` line per mark, the last one wins), so a phone and a desk agree: a report filed today is new until it is opened; opening it reads it, and back on the list its dot shrinks away. The phone tab bar's Reports carries a blue count of what is new (Decide's stays red); the desk sidebar counts the same.
- Swipes (phone and desk, by pointer): right toggles read and unread (blue, the row springs home and its dot changes, a toast with Undo); left archives it (indigo, the row flies off and folds away, "Archived: <title>" with Undo, the row flashes back). A press tints the row.
- What has no page (an explainer video, a note with steps) keeps the same row and opens in place; Notes (n) and Archived (n) with Restore stay at the end of the list.
- Room: on a phone the list keeps 140px under its last row, so the last report scrolls fully clear of the tab bar.
- Reduced motion: no rise, no dot shrink, swipes and folds settle at once.
- Desk: until the desk shell (list beside detail) lands, the list is the same rows in the main column and a report opens beside the sidebar.

## How to get to it (user POV)

Open the board, tap Reports in the tab bar (phone) or the sidebar (desk).

## Driving it

`node .agents/skills/done-done-verify-sign-off/reports-shots.mjs <folder>` (journey `reports`; `REPORTS_WIDTHS=390` keeps one width; `SIGN_OFF_REPO=<built base checkout>` records a before, where only the states that board draws are captured). It seeds a fresh board with five reports (before and after with a video, a chart, a diagram, a plain one and a guided one), then at 390 (2x, touch) and 1280 in light and dark captures `reports`, `reports-end` (scrolled to the bottom), `report-page`, `reports-read` (after opening one), `reports-press`, `reports-swipe-right`, `reports-swipe-left`, `reports-menu` and `reports-archived` (toast with Undo), and writes `reports.<theme>.<width>w.txt`: rows, dots, the lede, the tab count and its label, the section heads, how far the last row sits above the tab bar, controls under 44px, sideways overflow and console errors. It asserts 3 dots before and 2 after opening a report, no overflow, the last row at least 16px clear of the tab bar, a left swipe archives, Undo restores and a right swipe reads.

Board actions (`board-actions.mjs`) clicks the Reports actions in every cell: a swipe right to mark unread, Mark all as read with Undo, open, Select, Dismiss 1 with Undo, Cancel and Archive all with Undo.

Regression: test/design.test.mjs ("each card has one place to type ... a report opens full screen and back") checks the head, the row, the swipe layers and the blue count, then at 390 opens a report (read saved, dot and count gone), swipes right (unread saved, dot back) and left (archived, Undo restores).
