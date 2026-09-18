# Pomodoro Desk

A simple, self-contained Pomodoro timer with a task list. Plain HTML + CSS + JS — no build step, no frameworks, no CDN, no external assets.

## Features

- **Configurable durations** — work, short break, and long break in minutes. Changing any duration resets the current phase. Defaults to 25 / 5 / 15.
- **Start / Pause / Reset** controls with drift-free timing (wall-clock based).
- **Cycle logic** — 4 work sessions, then a long break. Four progress dots show how far through the cycle you are.
- **Phase-change beep** — a short WebAudio triple-beep; the `AudioContext` is created on a user gesture so it works in browsers.
- **Live tab title** — `document.title` always shows remaining time and the current phase (e.g. `12:34 · Work — Pomodoro Desk`).
- **Task list** — add tasks, toggle complete, delete. Undone tasks sort above done ones.
- **Persistence** — tasks, duration settings, and session counts (work sessions completed today / all-time) are stored in `localStorage`.
- **Responsive + dark mode** — clean layout on phones and desktops; respects `prefers-color-scheme`.

## Run locally

Any static file server works. From this directory:

```bash
# Python 3
python3 -m http.server 8000

# or Node
npx serve .
```

Then open http://localhost:8000 in a browser.

## Deploy

All asset paths are relative (`styles.css`, `app.js`), so the site works when served from a subpath such as `https://briceockman.github.io/pomodoro-desk/`. To publish there, copy these files into that repo (root or `docs/`) and enable GitHub Pages.

## Files

- `index.html` — page structure; links `styles.css` and `app.js`
- `styles.css` — all styling
- `app.js` — timer, cycle logic, audio, tasks, persistence
