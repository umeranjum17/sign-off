# Card detail

A card's own screen in the new look: the open ask, the open proof and the open report, phone (390) and desk (1280 and 1440), light and dark.
It matches the approved prototype (`signoff-restyle-board/v3/proto/index.html`: on a phone its first ask, proof and report opened from `#v=decide`, `#v=evidence` and `#v=reports`; on a desk those screens).
It is built on web/ui.css's shared parts.

## What a user sees

- **One property panel (`uiProps` in web/index.html, `.ui-props` in ui.css).** Every card shows one sunk group of 48px rows: Priority (its P0-P3 chip), Its ask or Ticket, Pull request (its number, opening the change), and on a proof done-done's verdict and when it was filed.
  - Its ask (on an ask and a proof) and Ticket (on a report, plan, design or list card) set the ticket's title in full at the right.
  - Under the title comes a bar and its percent once work on the ticket has begun (full at 100%), else Not started. The row opens the ticket's page.
  - A card with none of these shows no panel.
- **One Activity (`thread` in web/index.html, `.ui-act` in ui.css).** It sits under its label as one sunk group of steps in plain words, each with its time at the right, the note that went with it in quotes under it, and on a ticket's page the card it is on.
  - It is the same on an ask, a proof, a report, a plan, a design and a ticket.
  - A card whose only step is its posting shows none.
- **Phone:**
  - The ask's sheet over Decide shows its question in full, then the panel, the answers, the note, its Activity, and Ask me later beside Answer.
  - The report's sheet over Reports shows What it found, the parts with a check on each read, Read the report, the Ticket row and its Activity.
  - The proof's own screen is still Evidence's (that screen's pass replaces it). It already carries the shared Ticket row and Activity.
- **Desk:** the open item takes eight of the shell's 12 columns beside the list (board-shell.md). It is padded 20/24/24, with the title at 24/32 (18/26 past 160 characters), never cut.
  - **An ask:** its head line (its kind, who asked and when, More holding Dismiss), then the ask and what it carries (Priority, Its ask, why, its preview and its proof) beside Its report and its Activity, split 3 : 2 with 24px between, scrolling.
    - **Its report** shows when the ask names a report on the board (the ask's `report`, `--report` on `raise` and `post`): what the report says, up to four of the numbers its picture shows, each with its label, as tiles two across, and Open report.
    - Decide's count is the head's line, so the list goes straight to the asks with no Waiting on you card. The asks' card carries its head and count inside it (Asks 4), 24px in and 20px down, as the prototype's list card.
    - Under a hairline at its foot the answers stay pinned in view: cards side by side (each 160px or wider, the picked one ringed in ink), then one 48px line of the note, Ask me later and Answer <pick>.
    - Ask me later (L) moves it to Later and steps on to the next ask.
  - **A proof:** its project and time, then its title and what it says with its capture filling the column on the left. On the right:
    - done-done's verdict;
    - the reason a run could not be checked;
    - What it proves (Priority, Its ask, Pull request, Filed);
    - Pass, Fail and Needs work with Add a comment;
    - its Activity.
    `proofPane` is the hook Evidence's own pass fills with its sheet's parts.
  - **A guided report:** its head line (Guided report, its group and day, Mark read and Archive), then on the left its title, what it says, What it found, You asked and Done when, its own chart (a bar per row, the longest full, red or amber by tone) and what it found item by item. On the right:
    - Read k of n parts with a check on each;
    - Read the report (Enter);
    - its Next step;
    - the Ticket row;
    - its Activity.
    A part or Read the report opens it in full over the board.
  - **A page report:** the same head line and words in one column, with its page at the open item's width.
- **The sidebar** (board-shell.md) carries the prototype's blue check, and at its foot whose board it is with the light-or-dark button. The page's head has no light-or-dark button on a desk.
- **Exported copy:** `export` puts tokens.css and ui.css inside the one file, so a read-only copy draws the same new look and desk.

## Drive and prove

`node .agents/skills/done-done-verify-sign-off/detail-shots.mjs <folder> light,dark 390|1280|1440` (journey `detail`) seeds `feel-board.sh` plus, through the real CLI:
- a ticket that the ship ask, the settings proof and a guided report belong to;
- P1 on each;
- the ship ask about the guided report (`report`), whose picture has four rows;
- a pull request on the proof;
- the settings project's own icon;
- a comment on each.

It runs its own Chromium with exact device metrics (2x) and captures:
- at 390: `ask`, `ask-end`, `proof`, `proof-end`, `report` and `report-end`;
- at 1280 and 1440: `decide`, `evidence`, `reports` and `report-page`.

Each capture is measured in the browser:
- **Everywhere:** panel rows 48px or more, Its ask's title in full, no empty bar, Activity steps not cut, the title in full, no words drawn over other words (only text on top counts), no file path or code, no sideways overflow, no console error.
- **On a phone:** panels on the sheet's 16px edges and no control under 44px.
- **On a desk:**
  - one screen with no page scroll and the head 32/40 with the light-or-dark button;
  - the list on columns 1 to 4 and the open item on 5 to 12, on one top and one bottom 24px over the foot;
  - the sidebar's foot with whose board it is and the light-or-dark button, none in the head, and the mark's blue check;
  - on Decide, the asks' head inside its card, 24px in and 20px down, its count the card's rows;
  - the ask's Its report with at least two numbers and Open report to its report;
  - the 3 : 2 split;
  - the answers in view as cards of 160px or more over one 48px line;
  - every scroll area that holds more than it shows fading;
  - the empty share of the viewport, at most 15% while a list holds more than it shows.

`DETAIL_PROTO=<the v3 prototype's index.html>` saves each state beside the prototype's frame in `vs-proto/`. `DETAIL_SIDE=before SIGN_OFF_REPO=<built base checkout>` records the base.

Regressions:
- `test/design.test.mjs`: "Decide on a desk" (the asks' head and count inside the card), "Decide on a pick-one ask", "Reports on a desk", "Evidence: a card per proof", "a card names its ticket" and "report and plan documents use one page scroll".
- The latter also covers the exported copy at 1280.
