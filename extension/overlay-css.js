// Styles for the Tafsiri overlay. They live inside its shadow root, so the meeting page's CSS
// cannot reach them and they cannot leak into the page.
globalThis.TafsiriCSS = `
:host { all: initial; }

.win {
  --bg: #fafafa;
  --surface: #ffffff;
  --text: #18181b;
  --muted: #5f5f68;
  --line: #e4e4e7;
  --accent: #0f766e;
  --accent-text: #ffffff;
  --accent-soft: #e6f2f1;
  --warn: #9a3412;
  --warn-soft: #fff4ed;
  --radius: 8px;
  --tr-size: 17px;
  color-scheme: light dark;

  position: fixed;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgb(9 9 11 / 0.28), 0 2px 6px rgb(9 9 11 / 0.18);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}

@media (prefers-color-scheme: dark) {
  .win {
    --bg: #131316;
    --surface: #1c1c20;
    --text: #ececef;
    --muted: #a1a1aa;
    --line: #2e2e34;
    --accent: #2dd4bf;
    --accent-text: #0b2422;
    --accent-soft: #15302d;
    --warn: #fdba74;
    --warn-soft: #2a1d14;
  }
}

.win * { box-sizing: border-box; }
.win[hidden], .win [hidden] { display: none !important; }

/* Title bar: drag handle */

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.bar:active { cursor: grabbing; }
.logo { width: 18px; height: 18px; flex-shrink: 0; }
.title { font-weight: 700; font-size: 14px; flex-shrink: 0; }
.status {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--muted);
  font-size: 12px;
}
.status.live { color: var(--accent); font-weight: 600; }
.status.warn { color: var(--warn); }

.win button {
  min-height: 34px;
  padding: 0 12px;
  border-radius: var(--radius);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.win button:active:not(:disabled) { transform: translateY(1px); }
.win button:disabled { opacity: 0.45; cursor: default; }
.win :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.icon {
  display: inline-grid;
  place-items: center;
  width: 30px;
  min-height: 30px !important;
  padding: 0 !important;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.icon:hover:not(:disabled) { background: var(--line); color: var(--text); }
.icon svg { width: 16px; height: 16px; }

/* Language controls */

.body { display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative; }

.controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: 10px 6px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.field label { font-size: 12px; color: var(--muted); }

.win select {
  width: 100%;
  min-height: 34px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-overflow: ellipsis;
}

.swap {
  width: 34px;
  padding: 0 !important;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
}
.swap svg { width: 18px; height: 18px; }

.primary {
  grid-column: 1 / -1;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-text);
}
.secondary {
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 14px;
  border-bottom: 1px solid var(--line);
}
.pair { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; font-weight: 600; }
.ghost {
  min-height: 30px !important;
  padding: 0 10px !important;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  font-weight: 500 !important;
}
.ghost:hover { background: var(--surface); }
.ghost.accent { border-color: var(--accent); color: var(--accent); }

.alerts { display: grid; gap: 8px; padding: 10px 14px 0; }
.alerts:not(:has(> :not([hidden]))) { display: none; }

.notice {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 12.5px;
}
.notice.info { background: var(--accent-soft); color: var(--text); }

/* Feed */

.feed { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 14px 12px; }

.empty { color: var(--muted); padding-top: 10px; }
.empty h2 { margin: 0 0 8px; font-size: 15px; color: var(--text); }
.empty ol { margin: 0 0 12px; padding-left: 20px; display: grid; gap: 5px; }
.empty ol.single { list-style: none; padding-left: 0; }
.empty p { margin: 0; font-size: 12.5px; }

.turns { list-style: none; margin: 0; padding: 0; }
.turn { padding: 9px 0 9px 10px; border-left: 3px solid transparent; }
.turn + .turn { border-top: 1px solid var(--line); }
.turn.live { border-left-color: var(--accent); }
.meta { font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 2px; }
.meta .lang { font-weight: 400; }
.tr { margin: 0; font-size: var(--tr-size); line-height: 1.4; overflow-wrap: anywhere; }
.tr.pending { color: var(--muted); }
.orig { margin: 3px 0 0; font-size: max(12px, calc(var(--tr-size) - 4px)); color: var(--muted); overflow-wrap: anywhere; }
.note { margin: 3px 0 0; font-size: 12px; color: var(--warn); }
.win:not(.show-original) .orig { display: none; }

.jump {
  position: absolute;
  left: 50%;
  bottom: 58px;
  transform: translateX(-50%);
  min-height: 28px !important;
  padding: 0 14px !important;
  border: 1px solid var(--accent);
  border-radius: 999px !important;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 12.5px !important;
  box-shadow: 0 2px 8px rgb(15 118 110 / 0.25);
}
.jump:active { transform: translateX(-50%) translateY(1px) !important; }

/* Footer */

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px 8px 14px;
  border-top: 1px solid var(--line);
}
.check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text); cursor: pointer; }
.check input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); }
.tools { display: flex; align-items: center; gap: 4px; }
.a-sm { font-size: 12px; font-weight: 700; }
.a-lg { font-size: 16px; font-weight: 700; }

/* Resize corner */

.grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
  touch-action: none;
  background:
    linear-gradient(135deg, transparent 50%, var(--muted) 50%, var(--muted) 56%, transparent 56%, transparent 68%, var(--muted) 68%, var(--muted) 74%, transparent 74%);
  opacity: 0.6;
}

/* Minimised: title bar only */

.win.min .body, .win.min .grip { display: none; }
.win.min { height: auto !important; }
.win.min .bar { border-bottom: 0; }

/* Popped out into picture in picture: fill the window, no drag or resize */

.win.pip {
  position: static;
  width: 100vw !important;
  height: 100vh !important;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.win.pip .bar { cursor: default; }
.win.pip .grip, .win.pip .min-btn, .win.pip .close-btn { display: none; }

@media (prefers-reduced-motion: reduce) {
  .win button:active:not(:disabled) { transform: none; }
}
`;
