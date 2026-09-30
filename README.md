# JAGU — Personal AI Learning & Time-Management Companion

A voice-first personal assistant: it remembers your projects, courses, tasks and
timetable, talks to you (typed or spoken), and can add events, log progress
notes, and start focus sessions — either by conversation or by tapping around
the app directly. Everything is stored locally in your browser; nothing is
sent anywhere except your own AI provider (Google Gemini or Anthropic Claude,
your choice) when JAGU is actually thinking.

This is the **modular source version** — the same app that was previously one
big HTML file, now split into readable files so it's easier to read, edit,
and extend in an editor like VS Code.

## Folder structure

```
jagu-project/
├── index.html          The page shell — markup only, links css/ and js/
├── css/
│   └── styles.css       All styling (the sci-fi HUD look, layout, animations)
├── js/
│   ├── app.js            Entry point: wires the last few cross-cutting bits
│   │                      and boots the app. Start reading here.
│   ├── helpers.js          Small pure utility functions ($ DOM shortcut, time
│   │                        formatting, escaping, etc.) — no dependencies.
│   ├── state.js             The central data model + localStorage persistence
│   │                        (projects, tasks, timetable, events, profile...).
│   ├── render.js             Everything that draws the UI from state: the
│   │                        Home/Dashboard/Learning/Timetable/Settings screens.
│   ├── modals.js              The generic "+Add" form modal, and the specific
│   │                        modals built from it (project/task/timetable/event).
│   ├── focus.js                Focus-session timer.
│   ├── voice.js                 Browser speech recognition + speech synthesis
│   │                        (the "tap to talk" path for non-Live models).
│   ├── live-api.js               Google Gemini's real-time Live API — raw
│   │                        microphone streaming, audio playback, function
│   │                        calling. Only active when the configured Gemini
│   │                        model name contains "live".
│   ├── ai.js                     The AI "brain": builds context, calls
│   │                        Anthropic's or Gemini's API, parses the reply,
│   │                        and carries out actions (add_task, add_event,
│   │                        log_update, etc). Also the timetable photo-scanner.
│   ├── settings.js                Onboarding + the Settings screen's field
│   │                        wiring (name, voice, API keys...).
│   └── diagnostics.js               Voice/connection diagnostics panel
│                              (Settings → Voice diagnostics).
├── netlify.toml          Tells Netlify to publish the repo root with no
│                        build step — avoids the "index.html not found" 404.
└── README.md            This file.
```

Each file does one job and only imports what it actually uses from the
others — a normal ES-modules setup (`import { x } from './y.js'`), no bundler,
no `npm install`, no build step. Opening `index.html` in a real browser (or,
better, serving the folder — see below) just works.

## Running it locally

Browsers are picky about microphone access and ES modules on a plain
double-clicked file. Serve it instead, from inside this folder:

```bash
python -m http.server 8000
```

then open `http://localhost:8000` in Chrome or Edge. (`localhost` counts as
a secure origin, so voice input works there even without HTTPS.)

## Deploying (GitHub + Netlify)

Same flow as before:

1. Push this whole folder to a GitHub repo, with `index.html` at the repo
   root (not nested in a subfolder).
2. Connect that repo in Netlify.
3. Netlify will read `netlify.toml` automatically — no manual "publish
   directory" setting needed, and no build command runs. Deploy.

## Setting up the AI

Go to **Settings** in the running app:

- **Google Gemini** (default, free, no card required) — get a key at
  `aistudio.google.com` → *Get API key*, paste it in.
- **Anthropic Claude** — needs a `console.anthropic.com` account with
  billing enabled.

For real two-way **voice conversation** (not just typed chat with spoken
replies), set the Gemini model field to a model whose name contains
`"live"`, e.g. `gemini-3.8-live`. Any other model name uses the ordinary
browser speech-recognition + typed-AI-call path instead.

Keys are stored only in that browser's local storage and are sent only to
the provider's own API — never anywhere else, and never to whoever hosts
this page.

## Editing

Since it's an editor-friendly modular ES-modules project (not one giant
file), each concern really is isolated — e.g. everything about the timetable
photo-scanner lives in `js/ai.js`. `state.js` is the one file nearly
everything else touches, since it owns the data model.

If you add a new top-level function or constant to a file and another file
needs it, `export` it there and `import { name } from './that-file.js';` at
the top of the file that needs it — same pattern used throughout.
