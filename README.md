# Claude Section Navigator

A browser extension that adds a **Word-style navigation pane** between Claude's
sidebar and your chat. Every prompt you send becomes a clickable section, so you
can jump around long conversations the way you'd use the Navigation Pane in MS Word.

## Features

- **Outline of your prompts** — each message you send is indexed as a section.
- **Click to jump** — smooth-scrolls to that exact message and briefly highlights it.
- **Auto titles** — each section is labelled from the "key element" of your prompt
  (first meaningful line, markdown stripped, trivial greetings skipped).
- **Rename inline** — double-click a title (or hit the pencil) to give it your own name.
- **Starred section** — pin important prompts to the top with the ★ button.
- **Persistent** — custom titles, stars and collapse state are saved per
  conversation and restored when you reopen the chat.
- **Live** — new prompts appear automatically as the conversation grows.
- **Collapsible** + light/dark aware so it feels native to claude.ai.

## Install (load unpacked)

1. Go to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. Open any conversation at <https://claude.ai> — the pane appears on the left.

## Usage

| Action            | How                                            |
| ----------------- | ---------------------------------------------- |
| Jump to a prompt  | Click its title                                |
| Star / unstar     | Click the ★ on the left of a row               |
| Rename a section  | Double-click the title, or click the pencil    |
| Collapse the pane | Click the ‹ button in the header               |

## Notes on robustness

Claude's interface is not a public API, so this extension reads its DOM. If a
future claude.ai update changes the markup and the pane stops finding messages,
the fix almost always lives in the **`CONFIG`** object at the top of
`content.js` — the selectors are centralized there with ordered fallbacks.

## Project structure

```
claude-section-navigator/
├── manifest.json     # MV3 manifest
├── content.js        # all logic (CONFIG · Store · TitleMaker · Scanner · Panel · Layout · App)
├── styles.css        # native-feeling light/dark styling
├── popup.html        # toolbar popup (info)
└── icons/            # toolbar / store icons
```

---

Made with ♥ by [Gaurav](https://tools.gauraverse.com)
