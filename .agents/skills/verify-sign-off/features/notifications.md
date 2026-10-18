# Notification sender

Drive the sender through the CLI and a local HTTP receiver, not an internal function.

Start a local receiver that records one JSON POST, write its URL into the `notify.url` field of `.sign-off/config.yaml`, then run:

```sh
sign-off-axi post --title "Should this ship?" --why "Umer: the real flow works." --outcome yes=Ship --outcome no=Wait --recommend yes --recommend-reason "The checks passed." --default no
```

Verify the receiver recorded the v1 message with the new card id, kind `ask`, title, one-line text, card link, and UTC filing time.

Repeat the post with the same key and verify it does not produce another POST.

Keep the receiver capture and CLI transcript outside the repository; never capture a token or full URL query.
