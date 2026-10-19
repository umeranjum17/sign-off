# Notification sender

Drive the sender through the CLI and a local HTTP receiver, not an internal function.

Start a local receiver that records one JSON POST, add a `notify:` block with indented `url:` and `link_base:` lines to `.sign-off/config.yaml`, then run:

```sh
sign-off-axi post --title "Should this ship?" --why "Umer: the real flow works." --outcome yes=Ship --outcome no=Wait --recommend yes --recommend-reason "The checks passed." --default no
```

Verify the receiver recorded the v1 message with the new card id, kind `ask`, title, one-line text, card link, and UTC filing time.

Repeat the post with the same key and verify it does not produce another POST.

## Once per card

A card is announced once; the card keeps the record (`announced` on its item in the board file).

1. Post a sign-in card, wait for its POST, run `signin done --key <key>`, then post the same card
   again with a new `--link`. The card is back in Waiting and the receiver gets no second POST.
2. Serve the board, answer an ask through the page's own API, then undo it
   (`POST api/answers` with `"answer": ""`). The card is back in Waiting with no POST.
3. Post one more new card and check its POST does arrive, so the run proves silence, not a stopped sender.

Keep the receiver capture and CLI transcript outside the repository; never capture a token or full URL query.
