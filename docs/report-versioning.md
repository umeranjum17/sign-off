# Report posting transitions

`reportPost` in `src/cli.ts` owns report identity and version transitions. `raise --from`, contract `post --kind report`, page-report flags and `post --replace` all use it under the board lock. `writePostedItems` publishes only after the complete input passes and restores the posted reports. No caller writes discard records to supersede a version.

| Before | Post | After |
| --- | --- | --- |
| Absent | Valid report | One card; first filing recorded |
| Current | Identical message | Same card, timestamp and history |
| Current or dismissed | Higher version with change notes | Same live card, new current version; previous document and notes retained |
| Dismissed or archived | Identical message | Same version restored |
| Current | Lower version, changed same version, or missing change notes | Refused; board unchanged |
| Another kind | Report on its key (or report changed to another kind) | Refused; board unchanged |

The board owns `versions`: producers cannot replace this history. Storage stays oldest first; the reader offers versions newest first. Each previous document is retained without nested history. Legacy entries retain their notes; a document never retained cannot be reconstructed and is labelled notes only. Auto-archive uses the latest version's posting time. A historical document is read only; new discard records bind their report version explicitly, and older records use the retained posting times.

`fixtures/report-history.json` sanitizes the reported first/third/fifth drafts, the 57-row fifth draft, and a companion rescan. `test/report-actions.test.mjs` replays these through the CLI and HTTP board. The original caller inputs were unavailable: this is a regression replay, not a raw-history reproduction. A file authored without a post remains unposted. Enforcing a worker's report card at task completion belongs to its caller and is outside Sign-Off.
