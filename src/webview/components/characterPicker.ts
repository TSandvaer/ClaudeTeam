/**
 * characterPicker — the per-member character-picker grid (team-setup spec §5,
 * Decisions 5 + 7).
 *
 * An inline popover anchored to a Manage Team member row (spec §5.1 — Maya's
 * layout call: inline row-popover). Renders the merged `CharacterSource[]`
 * (bundled + user) as a thumbnail grid; each cell has a thumbnail, a text
 * label, and an origin badge ("bundled" / "user"). Selecting a cell posts
 * `ui:assign-character { memberId, character: <id> }`; "Clear character" posts
 * `{ memberId, character: null }` (revert to text tile).
 *
 * ── NIT 1 (spec §5.2 empty-grid behavior) — RESOLVED ────────────────────────
 * When `sources` is EMPTY (no bundled chars — should not happen post-build,
 * but defended), the picker OPENS (it is NOT disabled). Rationale: the only
 * meaningful action in that state — "Clear character (use text tile)" — must
 * stay reachable, so a member already assigned a now-missing character can be
 * reset. A disabled picker would trap such a member. The grid area shows a
 * muted "No characters available" line in place of cells; the Clear button
 * remains active. Documented here + asserted by a component test.
 *
 * ── `[hidden]` guard (spec §5.2 / §8, conventions doc) ──────────────────────
 * The picker root is a flex/grid popover toggled via the `hidden` attribute by
 * the panel. Its CSS rule declares `display:flex` for the open state, so it
 * MUST carry the `.ct-character-picker[hidden] { display:none }` guard (author
 * `display` beats the UA `[hidden]` default). The guard lives in dashboard.css
 * and is covered by the source-derived guard test.
 *
 * Theme-aware: all colors via `--vscode-*` / existing `--ct-*` tokens (spec §8
 * — no new tokens). Every thumbnail is paired with a text label (no icon-only).
 *
 * Source: team/iris-ux/team-setup-spec.md §5.1, §5.2.
 */

import type { CharacterSource } from "../../shared/types.js";
import type { WebviewMessage } from "../../shared/messages.js";

export interface CharacterPickerProps {
  /** The member the picker is choosing a character for. */
  memberId: string;
  /** Display name (shown in the picker heading "Pick a character for <name>"). */
  display: string;
  /** Merged bundled + user character sources (host `setup:characters`). */
  sources: CharacterSource[];
  /** Currently-assigned character id (highlight the matching cell), or null. */
  current: string | null;
  /** Host-injected webview base URI for resolving `thumbnailPath`. Optional —
   *  absent in browser-dev / tests → thumbnails fall back to a monogram-less
   *  empty cell (label still renders). */
  spriteBaseUri?: string;
  /** Webview → host dispatcher. */
  postMessage: (msg: WebviewMessage) => void;
  /** Called after a selection / clear so the panel can close the popover. */
  onClose?: () => void;
}

/**
 * Build the picker grid element (`<div class="ct-character-picker" role="dialog">`).
 * Not hidden by default — the caller toggles `hidden` for the popover lifecycle.
 */
export function renderCharacterPicker(
  props: CharacterPickerProps,
): HTMLElement {
  const {
    memberId,
    display,
    sources,
    current,
    spriteBaseUri,
    postMessage,
    onClose,
  } = props;

  const root = document.createElement("div");
  root.className = "ct-character-picker";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", `Pick a character for ${display}`);

  // ── Header: heading + close ✕ ────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "ct-character-picker-header";

  const heading = document.createElement("h3");
  heading.className = "ct-character-picker-heading";
  heading.textContent = `Pick a character for ${display}`;
  header.appendChild(heading);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "ct-character-picker-close";
  closeBtn.setAttribute("aria-label", "Close character picker");
  closeBtn.title = "Close";
  closeBtn.textContent = "✕";
  header.appendChild(closeBtn);

  root.appendChild(header);

  // ── Grid (or empty-grid message — NIT 1) ─────────────────────────────────
  const grid = document.createElement("div");
  grid.className = "ct-character-picker-grid";
  grid.setAttribute("role", "listbox");

  if (sources.length === 0) {
    // NIT 1: empty grid — show a muted line, keep Clear reachable below.
    const emptyLine = document.createElement("p");
    emptyLine.className = "ct-character-picker-empty";
    emptyLine.textContent = "No characters available";
    grid.appendChild(emptyLine);
  } else {
    const base =
      spriteBaseUri !== undefined ? spriteBaseUri.replace(/\/+$/, "") : null;
    for (const source of sources) {
      grid.appendChild(
        buildCell({ source, current, base, memberId, postMessage, onClose }),
      );
    }
  }

  root.appendChild(grid);

  // ── Clear character (text tile) — ALWAYS available (incl. empty grid) ─────
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "ct-btn ct-character-picker-clear";
  clearBtn.textContent = "Clear character (use text tile)";
  clearBtn.addEventListener("click", () => {
    const msg: WebviewMessage = {
      type: "ui:assign-character",
      payload: { memberId, character: null },
    };
    postMessage(msg);
    onClose?.();
  });
  root.appendChild(clearBtn);

  // Close ✕ wiring.
  closeBtn.addEventListener("click", () => {
    onClose?.();
  });
  // Esc closes the popover.
  root.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onClose?.();
    }
  });

  return root;
}

function buildCell(opts: {
  source: CharacterSource;
  current: string | null;
  base: string | null;
  memberId: string;
  postMessage: (msg: WebviewMessage) => void;
  onClose?: () => void;
}): HTMLElement {
  const { source, current, base, memberId, postMessage, onClose } = opts;

  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "ct-character-cell";
  cell.setAttribute("role", "option");
  cell.dataset.characterId = source.id;
  const selected = current === source.id;
  cell.setAttribute("aria-selected", String(selected));
  if (selected) {
    cell.classList.add("ct-character-cell--selected");
  }
  // Accessible name combines label + origin so AT users hear both.
  cell.setAttribute("aria-label", `${source.label} (${source.origin})`);

  // Thumbnail — only when a base URI is wired AND a path is present (graceful
  // degrade to a label-only cell otherwise; never a broken <img>).
  if (base !== null && source.thumbnailPath.length > 0) {
    const img = document.createElement("img");
    img.className = "ct-character-thumb";
    img.src = `${base}/${source.thumbnailPath.replace(/^\/+/, "")}`;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.decoding = "async";
    cell.appendChild(img);
  }

  const label = document.createElement("span");
  label.className = "ct-character-label";
  label.textContent = source.label;
  cell.appendChild(label);

  const badge = document.createElement("span");
  badge.className =
    source.origin === "user"
      ? "ct-character-origin ct-character-origin--user"
      : "ct-character-origin ct-character-origin--bundled";
  badge.textContent = source.origin;
  cell.appendChild(badge);

  cell.addEventListener("click", () => {
    const msg: WebviewMessage = {
      type: "ui:assign-character",
      payload: { memberId, character: source.id },
    };
    postMessage(msg);
    onClose?.();
  });

  return cell;
}
