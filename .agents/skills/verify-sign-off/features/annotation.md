# Comments on mock elements

Covers **Comment on the mocks** on a design card, the comment editor and list (one comment per element, Edit, Delete), comments kept in `decisions.annotations.jsonl` and shown only on the mock file they were made on, and the "No mock for this option" placeholder. Follow Launch and Drive in `SKILL.md` first, with a board from `init` in the scratch folder and the demo below.

Demo: write these two files under `.sign-off/mocks/look/`, then `post .sign-off/decisions.json --type design --key look --title "Pick the sign-in look" --option a="A: one column" --option b="B: split" --option c="C: no mock yet" --mock a=mocks/look/a.html --mock b=mocks/look/b.html --tradeoff "A is simplest; B greets Umer first." --recommend a` (C has no mock).

`a.html`:
```html
<!doctype html><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{margin:0;font:18px system-ui;background:#fafafa;color:#222}main{padding:16px 24px;display:grid;gap:16px}h1{font-size:30px;margin:0}input,button{width:100%;font:inherit;padding:14px;border-radius:10px}input{border:1px solid #bbb}button{font-weight:600;min-height:96px;border:0;background:#2b59c3;color:#fff}a{color:#2b59c3}</style>
<main id="sign-in"><h1>Welcome back, Umer</h1><input placeholder="Email"><input placeholder="Password" type="password"><button onclick="this.textContent='Clicked'">Sign in</button><a href="#">Forgot password?</a></main>
```

`b.html`:
```html
<!doctype html><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{margin:0;font:18px system-ui;color:#222;background:#fff}header{background:#2b59c3;color:#fff;padding:48px 24px}h1{font-size:30px;margin:0 0 8px}p{margin:0}main{padding:24px;display:grid;gap:16px}input,button{width:100%;font:inherit;padding:14px;border-radius:10px}input{border:1px solid #bbb}button{font-weight:600;border:0;background:#222;color:#fff}</style>
<header><h1>Hi, Umer</h1><p>Your boards are one tap away.</p></header><main id="sign-in"><input placeholder="Email"><input placeholder="Password" type="password"><button>Sign in</button></main>
```

| # | Step | Pass when |
|---|---|---|
| 1 | Phone and desktop, light and dark, `#waiting`, shot | A and B show their mocks, with A's fields and button inside the frame and clear of its edge; C shows a "No mock for this option" box the size of a frame; each option keeps its Pick button |
| 2 | Click `Comment on the mocks` | It shows pressed, a line says a tap comments, and the A and B frames' edges take the accent colour |
| 3 | `click` the `Open mock A ... full size` link (its middle lands in the frame), shot | The board stays on its tab; an editor opens under the mocks, "Comment on A: one column · <tag> “<words>”" (a container's words keep a space between its parts), with its box focused |
| 4 | `fill` the box with a comment from Umer, click `Save comment`, then `eval "JSON.stringify(state.annotations)"` and `sha256sum` A's file | One row in "Your comments on the mocks, not sent yet" with Edit and Delete; its `hash` equals the file's sha256 |
| 5 | Click the same link again | The editor shows the saved words; saving new words keeps one row with the same `id` |
| 6 | Click `Open mock B ...` (on a phone, swipe to it), save a comment, shots at 390 and 1440, light and dark | Two rows, each naming its option, tag and words; the open editor and the list read clearly in both themes |
| 7 | Reload | Both rows are still there |
| 8 | `Delete` on B's row | The row goes; `decisions.annotations.jsonl` ends with a `"deleted":true` line for that id |
| 9 | Change a word in A's file, delete B's file, reload | A's row is gone (its file changed) while `state.annotations` still holds it, and a quiet line reads "1 comment on an earlier version of “A: one column” is hidden"; B now shows the placeholder and the toggle only covers A |
| 10 | Add `"readonly": true` to the board file, reload; `curl` a `POST /api/annotations` | No toggle and no list; the POST answers 403 |
