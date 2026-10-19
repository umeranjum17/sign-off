# Evidence text guard

Drive the post through the CLI with an isolated HOME and a throwaway board, not an internal function. The guard refuses a still that is mostly text at post time: a rendered log, receipt or summary.

Refused: post a picture of text with `--type evidence` and with `--kind evidence --from <message.json>`:

```sh
sign-off-axi post .sign-off/decisions.json --type evidence --title "Sync log" --about "Rendered log." --media fixtures/evidence/text-log.png
```

Verify the exit is 2, the error says `is mostly text: a picture of a log, receipt or summary is not evidence`, the help says to post a real capture of the running product, and no `evidence/` folder or item is written.

Accepted: post a real capture of the running product, such as a screenshot of the board's Evidence area (or `fixtures/evidence/product-board.png`), and verify the exit is 0 and `update-<number>` is posted with its copy under `evidence/<number>/`.

Keep the transcripts outside the repository.
