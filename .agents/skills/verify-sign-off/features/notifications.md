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

## muxr receiver

`receiver: muxr` in the `notify:` block sends muxr's contract: POST `{title (1-80), body, url, id}` with `Authorization: Bearer <token>` read at send time from `<MUXR_HOME>/notify-token`.

1. Point `MUXR_HOME` at a temp folder with no token file, add `receiver: muxr`, `url: http://127.0.0.1:<fake port>/v1/notify` and `link_base: https://<name>.ts.net/` to the config, then run `sign-off-axi notify` and `notify test`: each says the token file is not there yet, in plain words, and the receiver gets nothing.
2. Write a throwaway token to `$MUXR_HOME/notify-token`, run `notify test`, post a card: the receiver gets the exact four keys and the Bearer header; nothing prints the token.
3. A `link_base` of `http://127.0.0.1:...` is refused by `notify` (it will not open on the iPad). A config with no `notify:` makes `notify` print `notifications: off`.

Never touch the real `~/.muxr`; use a fake receiver and a temp token.
