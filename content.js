/* =============================================================================
 * Claude Section Navigator
 * A Word-style navigation pane injected between Claude's sidebar and the chat.
 *
 * Architecture:
 *   CONFIG        -> all DOM selectors live here, centralized for easy patching
 *   Store         -> per-conversation persistence (titles, stars, ui state)
 *   TitleMaker    -> "catch the key element" heuristic for auto titles
 *   Scanner       -> finds your prompts in the current conversation
 *   Panel         -> builds + renders the navigation UI
 *   Layout        -> positions the pane between sidebar and chat, shifts content
 *   App           -> wires everything together + live observation (SPA aware)
 * ========================================================================== */
(() => {
  "use strict";

  if (window.__claudeSectionNavigatorLoaded) return;
  window.__claudeSectionNavigatorLoaded = true;

  /* ---------------------------------------------------------------------------
   * CONFIG — Claude's DOM is not a public API. If Anthropic ships a UI change
   * and the pane stops finding messages, the fix almost always lives right here.
   * Each entry is an ordered list of candidate selectors; the first that matches
   * wins, so older + newer markup are both covered.
   * ------------------------------------------------------------------------ */
  const CONFIG = {
    // Your own messages (the prompts we index).
    userMessage: [
      '[data-testid="user-message"]',
      'div.font-user-message',
      '[data-testid^="user-message"]',
    ],
    // The left navigation sidebar Claude already renders.
    sidebar: [
      'nav[aria-label="Sidebar"]',
      'nav[data-testid="menu-sidebar"]',
      'div[data-testid="menu-sidebar"]',
      'nav',
    ],
    // Pixel width of the navigation pane when expanded.
    paneWidth: 290,
    // How far the floating handle pokes left past the chat's left edge,
    // so it sits visually over the sidebar seam when the pane is collapsed.
    handleOverhang: 14,
    // How often to re-check for layout/conversation changes (ms).
    pollInterval: 700,
  };

  const PANE_ID = "csn-pane";
  const HANDLE_ID = "csn-handle";
  const NS = "csn"; // storage namespace prefix

  /* ---------------------------------------------------------------------------
   * Small DOM helpers
   * ------------------------------------------------------------------------ */
  const firstMatch = (selectors, root = document) => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  const allMatches = (selectors, root = document) => {
    for (const sel of selectors) {
      const els = root.querySelectorAll(sel);
      if (els.length) return Array.from(els);
    }
    return [];
  };

  const getConversationId = () => {
    const m = location.pathname.match(/\/chat\/([0-9a-f-]+)/i);
    return m ? m[1] : null;
  };

  const findScrollableAncestor = (el) => {
    let node = el?.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      const oy = style.overflowY;
      if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };

  /* ---------------------------------------------------------------------------
   * Store — persists custom titles, starred ids and UI state per conversation.
   * Keyed by conversation id so everything comes back when you reopen a chat.
   * ------------------------------------------------------------------------ */
  const Store = {
    _key(convId) {
      return `${NS}:conv:${convId}`;
    },
    _uiKey() {
      return `${NS}:ui`;
    },
    load(convId) {
      try {
        const raw = localStorage.getItem(this._key(convId));
        return raw ? JSON.parse(raw) : { titles: {}, starred: [] };
      } catch {
        return { titles: {}, starred: [] };
      }
    },
    save(convId, data) {
      try {
        localStorage.setItem(this._key(convId), JSON.stringify(data));
      } catch {
        /* storage full / disabled — fail silently */
      }
    },
    loadUI() {
      try {
        const raw = localStorage.getItem(this._uiKey());
        return raw ? JSON.parse(raw) : { collapsed: false };
      } catch {
        return { collapsed: false };
      }
    },
    saveUI(data) {
      try {
        localStorage.setItem(this._uiKey(), JSON.stringify(data));
      } catch {}
    },
  };

  /* ---------------------------------------------------------------------------
   * TitleMaker — "catch the key element by default".
   * Takes the raw prompt text and returns a short, meaningful label:
   *   1. strip markdown noise
   *   2. prefer the first substantive line
   *   3. if that line is trivial (a greeting / too short), fall back to the
   *      longest sentence in the prompt
   *   4. truncate cleanly
   * ------------------------------------------------------------------------ */
  const TitleMaker = {
    TRIVIAL: new Set([
      "hi", "hey", "hello", "yo", "ok", "okay", "thanks", "thank you",
      "yes", "no", "sure", "please", "cool", "nice", "great",
    ]),
    MAX: 64,

    stripMarkdown(s) {
      return s
        .replace(/```[\s\S]*?```/g, " ")          // fenced code blocks
        .replace(/`([^`]+)`/g, "$1")               // inline code
        .replace(/^[#>\-\*\+\s]+/gm, "")           // headings / quotes / bullets
        .replace(/[*_~]+/g, "")                     // emphasis marks
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")   // links -> text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")     // images
        .replace(/\s+/g, " ")
        .trim();
    },

    isTrivial(line) {
      const clean = line.toLowerCase().replace(/[^a-z\s]/g, "").trim();
      return clean.length < 4 || this.TRIVIAL.has(clean);
    },

    truncate(s) {
      if (s.length <= this.MAX) return s;
      const cut = s.slice(0, this.MAX);
      const lastSpace = cut.lastIndexOf(" ");
      return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim() + "…";
    },

    make(rawText) {
      const text = (rawText || "").trim();
      if (!text) return "Untitled";

      const lines = text
        .split(/\n+/)
        .map((l) => this.stripMarkdown(l))
        .filter(Boolean);

      // 1) first substantive line
      const firstGood = lines.find((l) => !this.isTrivial(l));
      if (firstGood) return this.truncate(firstGood);

      // 2) fall back to the longest sentence anywhere in the prompt
      const flat = this.stripMarkdown(text);
      const sentences = flat.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (sentences.length) {
        const longest = sentences.reduce((a, b) => (b.length > a.length ? b : a));
        return this.truncate(longest);
      }

      // 3) last resort
      return this.truncate(flat) || "Untitled";
    },
  };

  /* ---------------------------------------------------------------------------
   * Scanner — locates your prompts and assigns each a stable id.
   * The id is index-based ("m0", "m1", …) so custom titles/stars stay attached
   * to the same turn across reloads as long as the conversation order holds.
   * ------------------------------------------------------------------------ */
  const Scanner = {
    scan() {
      const nodes = allMatches(CONFIG.userMessage);
      return nodes.map((el, i) => ({
        id: `m${i}`,
        el,
        text: (el.innerText || el.textContent || "").trim(),
      }));
    },
  };

  /* ---------------------------------------------------------------------------
   * Layout — positions the pane in the gap between the sidebar and the chat,
   * and nudges the chat's scroll container over so nothing overlaps.
   * ------------------------------------------------------------------------ */
  const Layout = {
    scrollContainer: null,

    measure(messages) {
      // Find (and remember) the chat's scroll viewport.
      if (!this.scrollContainer || !document.contains(this.scrollContainer)) {
        const anchor = messages[0]?.el;
        this.scrollContainer = anchor ? findScrollableAncestor(anchor) : null;
      }

      const sidebar = firstMatch(CONFIG.sidebar);
      const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 0;

      let containerLeft = sidebarRight;
      if (this.scrollContainer) {
        const r = this.scrollContainer.getBoundingClientRect();
        containerLeft = Math.max(sidebarRight, r.left);
      }
      return { left: Math.max(0, containerLeft), sidebarRight };
    },

    apply(pane, handle, collapsed) {
      const { left } = this._lastMeasure || { left: 0 };
      const leftPx = `${left}px`;

      // Only touch the DOM when a value actually changed — otherwise every
      // poll tick restyles the pane + scroll container and the chat "dances".
      if (pane.style.left !== leftPx) pane.style.left = leftPx;

      if (collapsed) {
        // Collapsed: pane becomes invisible, no padding on the chat, and a
        // discreet floating handle sits at the sidebar's right edge.
        if (pane.style.width !== "0px") pane.style.width = "0px";
        if (this.scrollContainer && document.contains(this.scrollContainer)) {
          if (this.scrollContainer.style.paddingLeft !== "") {
            this.scrollContainer.style.paddingLeft = "";
          }
        }
        if (handle) {
          // Anchor the handle just inside the chat area, overlapping sidebar.
          const handleLeft = `${Math.max(0, left - CONFIG.handleOverhang)}px`;
          if (handle.style.left !== handleLeft) handle.style.left = handleLeft;
          if (handle.style.display !== "flex") handle.style.display = "flex";
        }
      } else {
        // Expanded: full pane, chat shifted over, handle hidden.
        const widthPx = `${CONFIG.paneWidth}px`;
        if (pane.style.width !== widthPx) pane.style.width = widthPx;
        if (this.scrollContainer && document.contains(this.scrollContainer)) {
          if (this.scrollContainer.style.paddingLeft !== widthPx) {
            this.scrollContainer.style.paddingLeft = widthPx;
          }
        }
        if (handle && handle.style.display !== "none") {
          handle.style.display = "none";
        }
      }
    },

    refresh(pane, handle, messages, collapsed) {
      this._lastMeasure = this.measure(messages);
      this.apply(pane, handle, collapsed);
    },

    reset() {
      if (this.scrollContainer && document.contains(this.scrollContainer)) {
        this.scrollContainer.style.paddingLeft = "";
      }
    },
  };

  /* ---------------------------------------------------------------------------
   * Panel — the navigation UI itself.
   * ------------------------------------------------------------------------ */
  const Panel = {
    el: null,
    listEl: null,
    starredEl: null,
    starredWrap: null,
    convId: null,
    data: { titles: {}, starred: [] },
    messages: [],

    build() {
      const pane = document.createElement("div");
      pane.id = PANE_ID;
      pane.className = "csn-pane";
      pane.innerHTML = `
        <div class="csn-header">
          <span class="csn-title">Navigation</span>
          <button class="csn-collapse" title="Collapse panel" aria-label="Collapse panel">
            <svg viewBox="0 0 16 16" width="15" height="15"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="csn-body">
          <div class="csn-section csn-starred-wrap" hidden>
            <div class="csn-section-label">★ Starred</div>
            <ul class="csn-list csn-starred"></ul>
          </div>
          <div class="csn-section">
            <div class="csn-section-label">Sections</div>
            <ul class="csn-list csn-all"></ul>
          </div>
          <div class="csn-empty" hidden>No prompts yet. Send a message to start.</div>
        </div>
        <footer class="csn-ftr">
          <div class="csn-ftr-line"></div>
          <div class="csn-ftr-top">
            Made with <span class="csn-heart" aria-label="love">&#9829;</span> by
            <a href="https://tools.gauraverse.com" target="_blank" rel="noopener" class="csn-ftr-author">Gaurav</a>
          </div>
          <div class="csn-ftr-bottom">
            <div class="csn-ftr-counter">
              <span class="csn-ftr-bolt">&#9889;</span>
              <span class="csn-ftr-num">0</span>
              <span class="csn-ftr-lbl">Sections</span>
            </div>
            <div class="csn-ftr-version">
              V4.0 <span class="csn-ftr-dot">&bull;</span> <span class="csn-ftr-private">LOCAL &amp; PRIVATE</span>
            </div>
          </div>
        </footer>
      `;

      // Separate floating handle — lives outside the pane so it stays visible
      // even when the pane is collapsed to width 0.
      const handle = document.createElement("button");
      handle.id = HANDLE_ID;
      handle.className = "csn-handle";
      handle.type = "button";
      handle.title = "Open Navigator";
      handle.setAttribute("aria-label", "Open Navigator");
      handle.style.display = "none";
      handle.innerHTML = `
        <svg viewBox="0 0 16 16" width="13" height="13"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      `;

      this.el = pane;
      this.handleEl = handle;
      this.listEl = pane.querySelector(".csn-all");
      this.starredEl = pane.querySelector(".csn-starred");
      this.starredWrap = pane.querySelector(".csn-starred-wrap");
      this.emptyEl = pane.querySelector(".csn-empty");
      this.counterEl = pane.querySelector(".csn-ftr-num");

      pane.querySelector(".csn-collapse").addEventListener("click", () =>
        App.setCollapsed(true)
      );
      handle.addEventListener("click", () => App.setCollapsed(false));

      // (The old "whole rail is a click target" logic is gone — there is no
      // rail anymore. The floating handle IS the only hit target.)

      document.body.appendChild(pane);
      document.body.appendChild(handle);
      return pane;
    },

    setCollapsedUI(collapsed) {
      this.el.classList.toggle("csn-collapsed", collapsed);
      // Visibility of pane vs. handle is driven by Layout.apply() so that
      // the handle only shows after we've measured where to park it.
    },

    scrollToMessage(item) {
      if (!item?.el || !document.contains(item.el)) return;
      item.el.scrollIntoView({ behavior: "smooth", block: "center" });
      // brief highlight so you can see where you landed
      item.el.classList.add("csn-flash");
      setTimeout(() => item.el.classList.remove("csn-flash"), 1200);
    },

    makeRow(item, index) {
      const li = document.createElement("li");
      li.className = "csn-item";
      li.dataset.id = item.id;

      const starred = this.data.starred.includes(item.id);
      const title = this.data.titles[item.id] ?? TitleMaker.make(item.text);

      li.innerHTML = `
        <button class="csn-star ${starred ? "is-on" : ""}" title="${starred ? "Unstar" : "Star"}" aria-label="Star section">
          <svg viewBox="0 0 16 16" width="13" height="13"><path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4 4.2 13.4l.7-4.3-3.1-3 4.3-.6z" fill="${starred ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>
        </button>
        <span class="csn-num">${index + 1}</span>
        <span class="csn-label" title="Double-click to rename">${escapeHtml(title)}</span>
        <button class="csn-edit" title="Rename section" aria-label="Rename section">
          <svg viewBox="0 0 16 16" width="12" height="12"><path d="M11 2.5l2.5 2.5-7 7L3.5 13l1-3z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
        </button>
      `;

      const label = li.querySelector(".csn-label");

      // navigate
      label.addEventListener("click", () => this.scrollToMessage(item));

      // star toggle
      li.querySelector(".csn-star").addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleStar(item.id);
      });

      // rename (button + double-click)
      const startRename = (e) => {
        e.stopPropagation();
        this.beginRename(label, item.id);
      };
      li.querySelector(".csn-edit").addEventListener("click", startRename);
      label.addEventListener("dblclick", startRename);

      return li;
    },

    beginRename(label, id) {
      const current = this.data.titles[id] ?? label.textContent;
      const input = document.createElement("input");
      input.className = "csn-rename-input";
      input.value = current;
      label.replaceWith(input);
      input.focus();
      input.select();

      const commit = (save) => {
        const val = input.value.trim();
        if (save && val) {
          this.data.titles[id] = val;
          Store.save(this.convId, this.data);
        }
        this.render(); // rebuild rows to restore label element
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit(true);
        if (e.key === "Escape") commit(false);
      });
      input.addEventListener("blur", () => commit(true));
    },

    toggleStar(id) {
      const i = this.data.starred.indexOf(id);
      if (i === -1) this.data.starred.push(id);
      else this.data.starred.splice(i, 1);
      Store.save(this.convId, this.data);
      this.render();
    },

    render() {
      if (!this.el) return;
      this.listEl.innerHTML = "";
      this.starredEl.innerHTML = "";

      const hasItems = this.messages.length > 0;
      this.emptyEl.hidden = hasItems;
      if (this.counterEl) this.counterEl.textContent = this.messages.length;

      const indexById = new Map(this.messages.map((m, i) => [m.id, i]));

      // starred section (in conversation order)
      const starredItems = this.messages.filter((m) =>
        this.data.starred.includes(m.id)
      );
      this.starredWrap.hidden = starredItems.length === 0;
      starredItems.forEach((item) =>
        this.starredEl.appendChild(this.makeRow(item, indexById.get(item.id)))
      );

      // all sections
      this.messages.forEach((item, i) =>
        this.listEl.appendChild(this.makeRow(item, i))
      );
    },

    update(convId, messages) {
      const convChanged = convId !== this.convId;
      this.convId = convId;
      this.messages = messages;
      if (convChanged) this.data = Store.load(convId);
      this.render();
    },
  };

  const escapeHtml = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  /* ---------------------------------------------------------------------------
   * App — orchestration + live observation. claude.ai is a single page app,
   * so we watch for both DOM mutations (new turns) and URL changes (new chat).
   * ------------------------------------------------------------------------ */
  const App = {
    ui: { collapsed: false },
    lastSig: "",

    init() {
      this.ui = Store.loadUI();
      Panel.build();
      Panel.setCollapsedUI(this.ui.collapsed);
      this.tick(true);

      // React to new messages / layout shifts.
      // IMPORTANT: skip mutations that happened inside our own pane — otherwise
      // every render we do triggers the observer, which schedules another
      // render, which triggers the observer... the hovered/last section ends up
      // "dancing" as it gets rebuilt many times a second.
      const obs = new MutationObserver((muts) => {
        for (let i = 0; i < muts.length; i++) {
          const t = muts[i].target;
          if (Panel.el && (t === Panel.el || Panel.el.contains(t))) continue;
          if (Panel.handleEl && (t === Panel.handleEl || Panel.handleEl.contains(t))) continue;
          this.scheduleTick();
          return;
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });

      // Safety net for SPA route changes + late-loading layout.
      setInterval(() => this.tick(false), CONFIG.pollInterval);
      window.addEventListener("resize", () => this.refreshLayout());
    },

    scheduleTick() {
      clearTimeout(this._t);
      this._t = setTimeout(() => this.tick(false), 200);
    },

    tick(force) {
      const convId = getConversationId();
      if (!convId) {
        // Not in a conversation (e.g. home screen) — hide pane AND handle.
        Panel.el.style.display = "none";
        if (Panel.handleEl) Panel.handleEl.style.display = "none";
        Layout.reset();
        return;
      }
      Panel.el.style.display = "";

      const messages = Scanner.scan();
      // Signature lets us skip needless re-renders.
      const sig = convId + "|" + messages.length + "|" +
        messages.map((m) => m.text.slice(0, 20)).join("¦");

      if (force || sig !== this.lastSig) {
        this.lastSig = sig;
        Panel.update(convId, messages);
      }
      this.refreshLayout(messages);
    },

    refreshLayout(messages) {
      const msgs = messages || Scanner.scan();
      Layout.refresh(Panel.el, Panel.handleEl, msgs, this.ui.collapsed);
    },

    setCollapsed(collapsed) {
      this.ui.collapsed = collapsed;
      Store.saveUI(this.ui);
      Panel.setCollapsedUI(collapsed);
      this.refreshLayout();
    },
  };

  // Boot once the page is interactive.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => App.init());
  } else {
    App.init();
  }
})();
