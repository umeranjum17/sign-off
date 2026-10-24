# Installable app

The board installs as an app and reads offline. Drive: `done-done run pwa` (`pwa-shots.mjs <folder>`), measured in a headless Chromium on a loopback board.

- Manifest and worker: Chrome reads `manifest.webmanifest` (name, short name, standalone, start `/`, scope `/`, 192, 512 and maskable icons, light ground) with no error and reports no installability error; `sw.js` (served at the root, `no-cache`, the cache named by the build) controls the page. The page links the manifest with `crossorigin="use-credentials"` so a board behind an access token (cookie) still loads it; the worker's cache holds only the bare `/`, the files the page names, and `/api/decisions`, never a link's token.
- Install: Today's More has an **Install app** row (Chrome and Edge, when the browser offers its prompt; one tap opens the prompt) or, in Safari on an iPad or iPhone, **Add to Home Screen / In Share**; it is absent once installed. Frames at 360, 390, 445, 1280 and 1440, light and dark (`more-install.<theme>.<width>w.png`), and `ipad-safari.<theme>.820w.png`.
- Offline: with the board stopped, a reload draws the kept page and last update under the line "Offline, showing the last update" (`offline.<theme>.390w.png`); a send fails and nothing is queued; only `/api/decisions` is kept (a 401 or 403 from the board empties it). A device that never opened the board offline gets the page's own error, "You are offline and this device has no saved copy of the board yet."
- iPad: `apple-touch-startup-image` links for five iPad sizes, both ways up and both themes (`web/splash-*.png`, made by `scripts/make-splash.mjs`), and the iOS web-app meta tags; only a real iPad shows the splash, which no emulation here proves.
- Regression: test/design.test.mjs ("installable app").
