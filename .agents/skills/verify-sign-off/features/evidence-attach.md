# Evidence attachment

`post --type evidence --attach <file>` puts a file on an update card for the user to download, over the board link, on a phone or tablet. The first case is an Android `.apk` of about 176 MB. The file is copied under `evidence/<number>/` beside the board (never into git or `board.json`) and streamed on download.

## Driving it

1. Launch as SKILL.md says (isolated HOME) and keep BASE. Make the file: `head -c 176000000 /dev/urandom > app.apk`.
2. Post: `sign-off-axi post <board> --type evidence --title "Android build" --about "The app installs." --media <real capture> --attach app.apk`. Exit 0, the row shows `attached` 1; `evidence/<n>/attach-1.apk` is 176000000 bytes and `board.json` stays small.
3. Open `BASE#evidence` and the update `BASE#evidence/update-<n>` at 390 and 1280: the file row shows the name, `176 MB` and a Download button (at least 44 px high) that fits the width with no sideways scroll. Look at the capture.
4. Download it for real: click Download in the browser (or `curl -b cookie -OJ BASE/api/attachment?key=update-<n>&i=0`); the saved file has the same byte count and sha256 as the source, the header is `Content-Disposition: attachment; filename="app.apk"` and the type `application/vnd.android.package-archive`. A `Range: bytes=-10` request answers 206 with 10 bytes.
5. Refusals (exit 2, a plain line): a missing file, a file over `SIGN_OFF_ATTACH_MAX_MB` (default 1024) that names the variable, more than 5 files, `--attach` on a decision or explainer.
6. Over a private-network bind the download needs the board's token: `/api/attachment` without the cookie is 401; the link from `open` sets the cookie that carries it.
