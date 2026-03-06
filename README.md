# PhantomAI

A transparent, always-on-top AI chat overlay for Windows. Chat with Google Gemini without ever leaving your current app — whether you're watching a video, gaming, or working.

---

## Features

- **Transparent overlay** — sits on top of any application, fully see-through background
- **Click-through mode** — toggle PASS/LOCK to interact with apps underneath via `Ctrl+Shift+Space`
- **Always on top** — stays visible over every window
- **Streaming responses** — AI replies appear in real time as they're generated
- **Image support** — attach images or paste from clipboard for vision queries
- **Conversation memory** — keeps the last 20 messages as context
- **4 themes** — Dark, Light, Midnight, Forest
- **Adjustable opacity & font size**
- **Secure API key setup** — your key is stored locally on your device, never hardcoded
- **Built-in guide** — step-by-step instructions for getting a Gemini API key

---

## Download

Grab the latest `.msi` installer from the [Releases](https://github.com/Last-First/PhantomAI/releases) page.

> Windows will show a SmartScreen warning on install since the app is unsigned. Click **"More info" → "Run anyway"** to proceed.

---

## Getting Started

1. Install PhantomAI via the `.msi` installer
2. Launch the app — a setup screen will appear asking for your Gemini API key
3. Click **"HOW TO GET A KEY"** if you need one, or paste your existing `AIza...` key
4. Hit **SAVE & CONTINUE** and start chatting

To change your key later: open **Settings** (gear icon) → click **CHANGE** next to API Key.

---

## Hotkeys

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Toggle click-through (PASS/LOCK) |
| `Enter` | Send message |
| `Ctrl+V` | Paste image from clipboard |

---

## Built With

- [Tauri 2.0](https://tauri.app/) — Rust-powered desktop framework
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) — UI
- [Vite](https://vitejs.dev/) — build tooling
- [Google Gemini 2.5 Flash](https://ai.google.dev/) — AI backend

---

## Building from Source

**Prerequisites:** Node.js, Rust, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/Last-First/PhantomAI.git
cd PhantomAI
npm install
npm run tauri dev       # development
npm run tauri build     # production .msi
```

---

## License

MIT
