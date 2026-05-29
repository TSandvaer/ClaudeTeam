/**
 * Diagnostic panel renderer (86c9zn7tm).
 *
 * Pure DOM functions — no global state, no message-sending. The boot loop
 * in `src/diagnostics/main.ts` owns the state machine and threads the
 * latest payload + button callbacks through `renderPanel`. Re-rendering is
 * full-replace via `mount.replaceChildren(...)` — simpler than a diffing
 * approach at the panel's scale (≤50 tick rows + small state table).
 *
 * Theme discipline:
 *   - Every color comes from a `--vscode-*` variable (via the
 *     `panel.css` token block) or one of the four state-semantic hex
 *     values shared with the dashboard. Hardcoded hex appears only on the
 *     state pills (semantic state coding — must NOT theme).
 *
 * Source: ClickUp 86c9zn7tm.
 */

import type {
  DiagnosticStateMessage,
  DiagnosticTickHistoryEntry,
  DiagnosticTickTransition,
  SerializedDashboardState,
  SerializedSessionTree,
} from "../shared/messages.js";
import type {
  AgentState,
  AgentTile,
  CollapsedPersonaGroup,
  MultiAgentPersonaTile,
  RosterTileEntry,
} from "../shared/types.js";

export interface RenderPanelContext {
  mount: HTMLElement;
  payload: DiagnosticStateMessage["payload"] | null;
  paused: boolean;
  onPauseToggle: () => void;
  onClear: () => void;
  onRefresh: () => void;
}

/**
 * Replace the panel DOM with a fresh render of the supplied payload.
 *
 * When `payload === null`, renders an empty-state body explaining "waiting
 * for the first tick". When `payload.state === null`, renders the header
 * + tick table (which may also be empty) without a current-state section.
 *
 * Exported as the single entry point so tests can drive it with mock
 * payloads and assert structural shape (e.g. row counts, state-pill
 * classes) without booting the IIFE.
 */
export function renderPanel(ctx: RenderPanelContext): void {
  const root = createDiv("diagnostic-root");
  root.append(renderHeader(ctx));

  if (ctx.payload === null) {
    root.append(renderEmptyBoot());
    ctx.mount.replaceChildren(root);
    return;
  }

  root.append(renderTickTable(ctx.payload.ticks));
  root.append(renderStateSection(ctx.payload.state));

  ctx.mount.replaceChildren(root);
}

// ===========================================================================
// Header
// ===========================================================================

function renderHeader(ctx: RenderPanelContext): HTMLElement {
  const header = createDiv("diagnostic-header");

  const title = document.createElement("h1");
  title.className = "diagnostic-title";
  title.textContent = "ClaudeTeam Diagnostics";
  header.append(title);

  const meta = createDiv("diagnostic-header-meta");

  // Verbose-mode chip — shows whether the Output channel is currently
  // recording alongside the panel. Surfaced so the user knows whether
  // the panel data is the only persisted record of this session.
  if (ctx.payload) {
    const verboseChip = document.createElement("span");
    verboseChip.className = `diagnostic-chip diagnostic-chip--${
      ctx.payload.verbose ? "on" : "off"
    }`;
    verboseChip.setAttribute(
      "title",
      ctx.payload.verbose
        ? "claudeteam.diagnostic.verbose = true (Output channel recording)"
        : "claudeteam.diagnostic.verbose = false (Output channel idle)",
    );
    verboseChip.textContent = `Output channel: ${ctx.payload.verbose ? "ON" : "OFF"}`;
    meta.append(verboseChip);
  }

  // Tick-count chip — a quick scan of "how much history do I have?".
  const tickCount = ctx.payload ? ctx.payload.ticks.length : 0;
  const tickChip = document.createElement("span");
  tickChip.className = "diagnostic-chip diagnostic-chip--neutral";
  tickChip.textContent = `${tickCount} tick${tickCount === 1 ? "" : "s"} in history`;
  meta.append(tickChip);

  header.append(meta);

  // Buttons — kept native <button> so VS Code's webview focus styling
  // applies, and so keyboard activation works without ARIA scaffolding.
  const controls = createDiv("diagnostic-controls");

  const refreshBtn = makeButton(
    "Refresh",
    "Pull a fresh snapshot from the extension host.",
    ctx.onRefresh,
  );
  controls.append(refreshBtn);

  const pauseBtn = makeButton(
    ctx.paused ? "Resume" : "Pause",
    ctx.paused
      ? "Resume per-tick auto-refresh pushes from the host."
      : "Stop receiving per-tick pushes (host keeps recording).",
    ctx.onPauseToggle,
  );
  pauseBtn.classList.add(
    ctx.paused ? "diagnostic-button--paused" : "diagnostic-button--running",
  );
  controls.append(pauseBtn);

  const clearBtn = makeButton(
    "Clear history",
    "Clear the in-memory tick ring buffer. Does not clear the Output channel.",
    ctx.onClear,
  );
  controls.append(clearBtn);

  header.append(controls);
  return header;
}

function makeButton(
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "diagnostic-button";
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener("click", onClick);
  return btn;
}

// ===========================================================================
// Empty-state body
// ===========================================================================

function renderEmptyBoot(): HTMLElement {
  const body = createDiv("diagnostic-empty");
  const heading = document.createElement("p");
  heading.className = "diagnostic-empty-heading";
  heading.textContent = "Waiting for the first watcher tick…";
  body.append(heading);

  const hint = document.createElement("p");
  hint.className = "diagnostic-empty-hint";
  hint.textContent =
    "Once the file-watcher loop produces a tick, this panel populates automatically.";
  body.append(hint);
  return body;
}

// ===========================================================================
// Tick-history table
// ===========================================================================

function renderTickTable(ticks: DiagnosticTickHistoryEntry[]): HTMLElement {
  const section = createSection("Tick history", "diagnostic-section--ticks");

  if (ticks.length === 0) {
    const empty = createDiv("diagnostic-table-empty");
    empty.textContent = "No ticks recorded yet.";
    section.append(empty);
    return section;
  }

  const table = document.createElement("table");
  table.className = "diagnostic-table";

  const thead = document.createElement("thead");
  thead.append(
    rowFromCells("th", [
      "Time",
      "Tick",
      "Duration",
      "Emitted",
      "Transitions",
    ]),
  );
  table.append(thead);

  const tbody = document.createElement("tbody");
  // Newest ticks at the top — easier to skim during a live diagnosis. Ring
  // buffer is naturally append-order so we reverse for display.
  for (let i = ticks.length - 1; i >= 0; i--) {
    const tick = ticks[i]!;
    tbody.append(renderTickRow(tick));
  }
  table.append(tbody);
  section.append(table);
  return section;
}

function renderTickRow(tick: DiagnosticTickHistoryEntry): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "diagnostic-tick-row";
  if (!tick.emitted) {
    tr.classList.add("diagnostic-tick-row--hash-skip");
  }

  const timeCell = document.createElement("td");
  timeCell.className = "diagnostic-cell diagnostic-cell--time";
  timeCell.textContent = formatTickTimestamp(tick.timestampMs);
  timeCell.title = new Date(tick.timestampMs).toISOString();
  tr.append(timeCell);

  const numCell = document.createElement("td");
  numCell.className = "diagnostic-cell diagnostic-cell--num";
  numCell.textContent = `#${tick.tickNumber}`;
  tr.append(numCell);

  const durCell = document.createElement("td");
  durCell.className = "diagnostic-cell diagnostic-cell--duration";
  durCell.textContent = `${tick.durationMs} ms`;
  tr.append(durCell);

  const emCell = document.createElement("td");
  emCell.className = "diagnostic-cell diagnostic-cell--emitted";
  emCell.textContent = tick.emitted ? "yes" : "skip";
  emCell.title = tick.emitted
    ? "Tick produced a fresh state:full to the webview."
    : "Hash-skip — state unchanged from prior tick, no emission.";
  tr.append(emCell);

  const txCell = document.createElement("td");
  txCell.className = "diagnostic-cell diagnostic-cell--transitions";
  if (tick.transitions.length === 0) {
    txCell.textContent = "—";
    txCell.classList.add("diagnostic-cell--empty");
  } else {
    txCell.append(renderTransitionList(tick.transitions));
  }
  tr.append(txCell);

  return tr;
}

function renderTransitionList(
  transitions: DiagnosticTickTransition[],
): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "diagnostic-transitions";
  for (const t of transitions) {
    const li = document.createElement("li");
    li.className = "diagnostic-transition";

    const ids = document.createElement("span");
    ids.className = "diagnostic-transition-ids";
    ids.textContent = `${t.sessionShortId}/${t.agentShortId}`;
    li.append(ids);

    const arrow = document.createElement("span");
    arrow.className = "diagnostic-transition-arrow";
    arrow.append(stateBadge(t.prev));
    const arrowText = document.createElement("span");
    arrowText.className = "diagnostic-arrow-glyph";
    arrowText.textContent = " → ";
    arrow.append(arrowText);
    arrow.append(stateBadge(t.next));
    li.append(arrow);

    ul.append(li);
  }
  return ul;
}

// ===========================================================================
// Current-state section (live snapshot of last-emitted DashboardState)
// ===========================================================================

function renderStateSection(
  state: SerializedDashboardState | null,
): HTMLElement {
  const section = createSection("Current state", "diagnostic-section--state");

  if (state === null) {
    const empty = createDiv("diagnostic-table-empty");
    empty.textContent =
      "No state recorded yet — the first tick will populate this section.";
    section.append(empty);
    return section;
  }

  // Roster errors / warnings surface above any per-session cards so a
  // broken YAML shows up regardless of whether any sessions are live.
  if (state.rosterErrors && state.rosterErrors.length > 0) {
    const errs = createDiv("diagnostic-banner diagnostic-banner--error");
    errs.append(makeBannerText("Roster errors:", state.rosterErrors));
    section.append(errs);
  }
  if (state.rosterWarnings && state.rosterWarnings.length > 0) {
    const warns = createDiv("diagnostic-banner diagnostic-banner--warn");
    warns.append(makeBannerText("Roster warnings:", state.rosterWarnings));
    section.append(warns);
  }

  if (state.sessions.length === 0) {
    const empty = createDiv("diagnostic-table-empty");
    empty.textContent = "No live Claude Code sessions in scope.";
    section.append(empty);
    return section;
  }

  for (const session of state.sessions) {
    section.append(renderSessionCard(session));
  }
  return section;
}

function makeBannerText(label: string, items: string[]): HTMLElement {
  const wrap = document.createElement("div");
  const heading = document.createElement("span");
  heading.className = "diagnostic-banner-label";
  heading.textContent = label;
  wrap.append(heading);
  const ul = document.createElement("ul");
  ul.className = "diagnostic-banner-list";
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = it;
    ul.append(li);
  }
  wrap.append(ul);
  return wrap;
}

function renderSessionCard(session: SerializedSessionTree): HTMLElement {
  const card = createDiv("diagnostic-session");
  if (!session.isAlive) card.classList.add("diagnostic-session--dead");

  const header = createDiv("diagnostic-session-header");

  const shortId = document.createElement("span");
  shortId.className = "diagnostic-session-shortid";
  shortId.textContent = session.shortId;
  header.append(shortId);

  const titleEl = document.createElement("span");
  titleEl.className = "diagnostic-session-title";
  titleEl.textContent = session.title;
  header.append(titleEl);

  const meta = document.createElement("span");
  meta.className = "diagnostic-session-meta";
  meta.textContent = `pid ${session.pid} · ${session.entrypoint} · v${session.version}`;
  header.append(meta);

  if (!session.isAlive) {
    const dead = document.createElement("span");
    dead.className = "diagnostic-session-dead";
    dead.textContent = "DEAD";
    header.append(dead);
  }

  card.append(header);

  const cwd = createDiv("diagnostic-session-cwd");
  cwd.textContent = session.cwd;
  cwd.title = session.cwd;
  card.append(cwd);

  // Flatten roster tiles (including CollapsedPersonaGroup instances) to a
  // single table — same surface the Output channel uses for transitions.
  const flat: { teamId: string; tile: AgentTile }[] = [];
  for (const [teamId, entries] of Object.entries(session.rosterTiles)) {
    for (const entry of entries as RosterTileEntry[]) {
      if (isCollapsedPersonaGroup(entry) || isMultiAgentPersonaTile(entry)) {
        for (const instance of entry.instances) {
          flat.push({ teamId, tile: instance });
        }
      } else {
        flat.push({ teamId, tile: entry });
      }
    }
  }

  if (flat.length === 0 && session.background.length === 0) {
    const empty = createDiv("diagnostic-table-empty");
    empty.textContent = "No agents in this session.";
    card.append(empty);
    return card;
  }

  if (flat.length > 0) {
    const table = document.createElement("table");
    table.className = "diagnostic-table diagnostic-table--agents";
    const thead = document.createElement("thead");
    thead.append(
      rowFromCells("th", [
        "Team",
        "Persona",
        "State",
        "agentId",
        "Activity",
        "Model",
      ]),
    );
    table.append(thead);

    const tbody = document.createElement("tbody");
    for (const { teamId, tile } of flat) {
      tbody.append(renderAgentRow(teamId, tile));
    }
    table.append(tbody);
    card.append(table);
  }

  if (session.background.length > 0) {
    const bgWrap = createDiv("diagnostic-background");
    const heading = document.createElement("span");
    heading.className = "diagnostic-background-heading";
    heading.textContent = `${session.background.length} background agent${
      session.background.length === 1 ? "" : "s"
    }:`;
    bgWrap.append(heading);
    const ul = document.createElement("ul");
    ul.className = "diagnostic-background-list";
    for (const bg of session.background) {
      const li = document.createElement("li");
      li.append(stateBadge(bg.state));
      const txt = document.createElement("span");
      txt.className = "diagnostic-background-text";
      txt.textContent = ` ${bg.agentType} — ${bg.description}`;
      li.append(txt);
      ul.append(li);
    }
    bgWrap.append(ul);
    card.append(bgWrap);
  }

  return card;
}

function renderAgentRow(teamId: string, tile: AgentTile): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "diagnostic-agent-row";
  tr.setAttribute("data-state", tile.state);

  const teamCell = document.createElement("td");
  teamCell.className = "diagnostic-cell diagnostic-cell--team";
  teamCell.textContent = teamId;
  tr.append(teamCell);

  const personaCell = document.createElement("td");
  personaCell.className = "diagnostic-cell diagnostic-cell--persona";
  personaCell.textContent = tile.display;
  personaCell.title = `${tile.display} (${tile.role})`;
  tr.append(personaCell);

  const stateCell = document.createElement("td");
  stateCell.className = "diagnostic-cell diagnostic-cell--state";
  stateCell.append(stateBadge(tile.state));
  tr.append(stateCell);

  const idCell = document.createElement("td");
  idCell.className = "diagnostic-cell diagnostic-cell--agentid";
  idCell.textContent = tile.agentId.slice(0, 8);
  idCell.title = tile.agentId;
  tr.append(idCell);

  const activityCell = document.createElement("td");
  activityCell.className = "diagnostic-cell diagnostic-cell--activity";
  activityCell.textContent = tile.activity;
  tr.append(activityCell);

  const modelCell = document.createElement("td");
  modelCell.className = "diagnostic-cell diagnostic-cell--model";
  modelCell.textContent = tile.model;
  tr.append(modelCell);

  return tr;
}

// ===========================================================================
// Small helpers — kept inline so the renderer stays one file
// ===========================================================================

function createDiv(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function createSection(title: string, modifierClass: string): HTMLElement {
  const section = document.createElement("section");
  section.className = `diagnostic-section ${modifierClass}`;
  const h2 = document.createElement("h2");
  h2.className = "diagnostic-section-heading";
  h2.textContent = title;
  section.append(h2);
  return section;
}

function rowFromCells(
  cellType: "th" | "td",
  cells: string[],
): HTMLTableRowElement {
  const tr = document.createElement("tr");
  for (const text of cells) {
    const cell = document.createElement(cellType);
    cell.textContent = text;
    tr.append(cell);
  }
  return tr;
}

/**
 * Render the small colored badge for an `AgentState`. Returned as an
 * element so callers can append directly. The state-color hex tokens are
 * shared with the dashboard's `.state-dot[data-state=...]` selectors
 * (semantically state-coded — must NOT theme).
 *
 * Exported for unit-test coverage.
 */
export function stateBadge(state: AgentState): HTMLElement {
  const el = document.createElement("span");
  el.className = "diagnostic-state-badge";
  el.setAttribute("data-state", state);
  el.textContent = state;
  return el;
}

/**
 * Format a tick timestamp for the table's "Time" cell. Uses HH:MM:SS
 * (24h) for compactness — the full ISO is in the title-tooltip. Pure —
 * exported for tests.
 */
export function formatTickTimestamp(timestampMs: number): string {
  const d = new Date(timestampMs);
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Webview-side mirror of `isCollapsedPersonaGroup` from
 * `src/shared/types.ts`. Re-imported here so the panel renderer doesn't
 * depend on the host's bundle layout (the helper is already in
 * `src/shared/types.ts` but the import path is shared — explicit re-export
 * keeps the renderer's surface visible at a glance).
 */
function isCollapsedPersonaGroup(
  entry: RosterTileEntry,
): entry is CollapsedPersonaGroup {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "kind" in entry &&
    (entry as { kind?: unknown }).kind === "collapsed-persona"
  );
}

/**
 * Webview-side mirror of `isMultiAgentPersonaTile` from
 * `src/shared/types.ts` (86ca1dtr5). Sibling of the `isCollapsedPersonaGroup`
 * mirror above — kept local so the panel renderer doesn't pull a value import
 * across the host bundle boundary.
 */
function isMultiAgentPersonaTile(
  entry: RosterTileEntry,
): entry is MultiAgentPersonaTile {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "kind" in entry &&
    (entry as { kind?: unknown }).kind === "multi-agent-persona"
  );
}
