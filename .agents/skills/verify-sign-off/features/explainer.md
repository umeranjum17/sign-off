# Explainer rung: a narrated stills video

Covers `post --type explainer` (`--media <video>`, `--about`, `--chapter m:ss=<title>`), the copied video under `evidence/<number>/`, its hash-checked serving through `/api/media`, the inline player and chapter buttons on the card, and the skill's video recipe. Follow Launch and Drive in `SKILL.md` first, with a board from `init` in the scratch folder. sign-off makes no video; you make one the way the skill tells an agent to.

Build: follow the "Narrated video" recipe in `skills/sign-off-axi/SKILL.md` as written, with a free local engine installed only in the scratch folder (for example `python3 -m venv $SCR/venv && $SCR/venv/bin/pip install piper-tts`, then `$SCR/venv/bin/python -m piper.download_voices --download-dir $SCR/voices en_US-lessac-medium`; never system-wide, never with sudo). 3 to 5 stills (slides you screenshot, or screenshots), 20 to 40 seconds in total. Keep the build log. `ffprobe` the result: one h264 video stream, one aac audio stream; `ffmpeg -i explainer.mp4 -af volumedetect -vn -f null -` shows a `mean_volume` well above `-91 dB` (not silent).

Audio stays silent on the host: start the browser with `CHROME_DEVTOOLS_AXI_CHROME_ARGS="--mute-audio"` and prove sound by decoding, never through a speaker.

| # | Step | Pass when |
|---|---|---|
| 1 | `post --type explainer --key <key> --title ... --about ... --media explainer.mp4` with one `--chapter` per still, `--option`s and `--recommend`; then the bad posts: two `--media`, a `.png`, `--chapter 12=x`, chapters out of order, `--link`, the same key again | `raised`; `evidence/<n>/1.mp4` has the same sha256 as the source; each bad post exits 2 (the repeated key exits 1 `CONFLICT`) and names the fix |
| 2 | Phone (the emulator; when the host has no emulator room, `390x844x3,mobile,touch`) and desktop `1440x900x1`, light and dark, wait the title, full-page shots | The `EXPLAINER` chip and an `Explainers` filter; the summary shows in full; the video fills the card width with its controls (324 px wide at 390); chapter buttons wrap with no overlap; `FIT` (from [dashboard.md](dashboard.md)) is true |
| 3 | Phone: `snapshot --full`, click `button "play"` inside the video; after a few seconds `eval` the video's `currentTime`, `paused` and `webkitAudioDecodedByteCount` | `currentTime` grows, `paused` is false, the audio byte count is above 0 |
| 4 | Fresh `snapshot`, click `button "Play from <m:ss>, <title>"` | `currentTime` jumps to that chapter and plays on |
| 5 | Record steps 3-4: start Chrome with `--remote-debugging-port=<port>` added to `CHROME_DEVTOOLS_AXI_CHROME_ARGS`, run a CDP `Page.startScreencast` client on the page's `webSocketDebuggerUrl` (save the frames with their timestamps), then join them with `ffmpeg -f concat` into an mp4 in the evidence folder | The recording shows the video playing and the chapter jump |
| 6 | `network` after playback | Every request is to `127.0.0.1:<port>` (or the browser's own `data:` control icons): playback needs no network |
| 7 | Phone dark: open the note, type one, click an answer; `wait --key <key> --json` in the background; `answers --json` | The wait returns the answer and note; the row moves to Answered with its button pressed |
| 8 | Append one byte to `evidence/<n>/1.mp4`, reload | The card says the video can't be shown; `/api/media?key=<key>&i=0` answers 404 |

The integration test (`npm test`, `test/design.test.mjs`) also covers the post validation, the copy, byte ranges, the hash check and the answer read-back.
