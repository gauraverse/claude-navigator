<!-- Replace the line below with a screenshot of the pane in action -->
<!-- ![Claude Navigator](docs/screenshot.png) -->

<h1 align="center">Claude Navigator</h1>

<p align="center">
  A Word-style navigation pane for <a href="https://claude.ai">claude.ai</a> —
  jump to any of your prompts, star the important ones, and rename sections inline.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-4.0.0-c96442" alt="version" />
  <img src="https://img.shields.io/badge/manifest-v3-555" alt="manifest v3" />
  <img src="https://img.shields.io/badge/license-MIT-2b7" alt="MIT license" />
  <img src="https://img.shields.io/badge/data-100%25%20local-3a8" alt="100% local" />
</p>

---

## What it does

Long Claude conversations turn into endless scrolling. **Claude Navigator** adds a
third column — between Claude's sidebar and the chat — that lists every prompt
**you** sent, exactly like the Navigation Pane in Microsoft Word. Click any entry
to fly straight to that point in the thread.

It builds the outline automatically, keeps it live as you chat, and remembers your
stars and custom titles per conversation.

## Features

| Feature | What you get |
|---|---|
| Prompt outline | Every message you send becomes a clickable section in the pane. |
| Click to jump | Smooth-scrolls to the exact message and briefly highlights it. |
| Auto titles | Each section is named from the *key element* of your prompt — first meaningful line, markdown stripped, trivial greetings skipped. |
| Rename inline | Double-click a title (or hit the pencil) to give a section your own name. |
| Starred section | Pin the prompts that matter to the top of the pane. |
| Persistent | Titles, stars, and collapse state are saved per conversation and restored when you reopen it. |
| Live | New prompts appear automatically as the conversation grows. |
| Native feel | Collapsible, and follows Claude's light/dark theme so it looks built-in. |

## Why I built it

> I kept losing my place in long Claude threads — scrolling up and down hunting for
> "that prompt where I asked about X." Word has a navigation pane for exactly this,
> so I gave Claude one too. Now every question I ask is a bookmark I can jump back to.

## Installation

### Option 1 - Download the latest release
Grab the ZIP from [Releases](../../releases/latest) and extract it.

### Option 2 - Clone the repo
```bash
git clone https://github.com/gauraverse/claude-navigator.git
```

### Then load it into your browser
1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** and select the `claude-navigator` folder
4. Open any conversation at [claude.ai](https://claude.ai) — the pane appears on the left

## Usage

| Action | How |
|---|---|
| Jump to a prompt | Click its title |
| Star / unstar | Click the star on the left of a row |
| Rename a section | Double-click the title, or click the pencil |
| Collapse the pane | Click the chevron button in the header |

## How it works

Everything runs in a single content script, organized into small modules:

- **`CONFIG`** — all claude.ai selectors live here with ordered fallbacks. If a
  future UI change breaks the pane, this is the one place to patch.
- **`TitleMaker`** — the "catch the key element" heuristic for auto titles.
- **`Scanner`** — finds your prompts and assigns each a stable id.
- **`Panel`** — builds the UI, handles jump / star / rename.
- **`Layout`** — positions the pane between sidebar and chat and shifts the thread so nothing overlaps.
- **`App`** — a `MutationObserver` plus a light poll keep it live and SPA-aware.

## Privacy

**100% local. Nothing leaves your browser.** Claude Navigator has no servers, no
analytics, and no network calls. Your titles and stars are stored in your
browser's `localStorage`, keyed by conversation. The only permission it requests
is `storage`, and it only runs on `https://claude.ai/*`.

## Compatibility

Chromium browsers (Chrome, Edge, Brave, Arc) on Manifest V3. Because claude.ai is
not a public API, layout updates from Anthropic can occasionally shift the markup —
fixes are centralized in `CONFIG` at the top of `content.js`.

## Changelog

### v4.0.0
- Collapsed state is now completely railless — the pane goes to zero width
  and the chat uses the full available space. A small 22×22 circular handle
  floats at the vertical middle of the screen, sitting just over the
  sidebar seam. Click it to reopen the navigator.
- Handle is quiet at rest (soft background, hairline border, 82% opacity),
  lifts to Claude coral with a subtle scale on hover, and has a proper
  focus ring for keyboard use. Light/dark aware.
- Removed the "whole rail is a click target" logic — there's no rail to
  mis-click any more; the handle is the single, discreet affordance.

### v3.0.0
- Fixed a render-loop that made the hovered / last section visibly "dance"
  when the right pane (artifact / doc) was open — the MutationObserver now
  ignores mutations inside our own pane.
- Padding on the chat scroll container is only written when the value
  actually changes, and the CSS transition on it is removed so layout stays
  crisp.
- Slimmer footer divider line (centered, 60% width) to match the uniform
  gauraverse look.
- Collapsed rail: handle is now a vertically-centered pill (22×44) with a
  proper affordance; entire rail is a click target to expand.

### v2.0.0
- Expand handle recentered vertically on the collapsed rail; wider hit area.

### v1.0.0
- Initial release: prompt outline, click-to-jump with highlight, auto titles,
  inline rename, starred section, per-conversation persistence, collapsible
  light/dark pane, live updates.

## License

[MIT](LICENSE) (c) 2026 Gaurav

---

<p align="center">
  Made with &#9829; by <a href="https://tools.gauraverse.com">Gaurav</a> -
  part of <a href="https://tools.gauraverse.com">tools.gauraverse.com</a>
</p>
