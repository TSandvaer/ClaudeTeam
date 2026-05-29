/**
 * suggestSetupCard — the dismissible "Orchestration detected" setup card
 * (team-setup spec §2.2, ratify proposal §7.2 Option A — in-panel card, NOT a
 * toast).
 *
 * Rendered as the full dashboard-area body when `SetupDetectionState ===
 * "suggest-setup"` (≥2 agents scanned, no `claudeteam.yaml` yet). Offers:
 *   - "Set up team" → `ui:open-manage-team` (host serves the wizard layout).
 *   - "Not now" / ✕ → `ui:dismiss-setup-suggestion` (host persists a
 *     remember-per-workspace dismiss flag — §7.2).
 *
 * The count line uses `scanned.length` from the `setup:detection` payload —
 * NEVER a hardcoded number (spec §2.2).
 *
 * Theme-aware: all colors via `--vscode-*` / existing `--ct-*` tokens (spec
 * §8 — no new tokens). Icon (codicon-style gear glyph) is PAIRED with the
 * heading text + carries an aria-label (no icon-only — CLAUDE.md / spec §11).
 *
 * `[hidden]` guard note: this card is NOT toggled via the `hidden` attribute —
 * `render.ts` mounts/unmounts it on the `SetupDetectionState` switch (full DOM
 * replace), so it never needs the `[hidden] { display:none }` flex/grid guard
 * (conventions doc — the guard is only for elements toggled via `el.hidden`).
 *
 * Source: team/iris-ux/team-setup-spec.md §2.2, §7.2.
 */

import type { WebviewMessage } from "../../shared/messages.js";

export interface SuggestSetupCardProps {
  /** Number of agents the host scanned in `.claude/agents/` (drives the count line). */
  scannedCount: number;
  /** Webview → host dispatcher. */
  postMessage: (msg: WebviewMessage) => void;
}

/**
 * Build the suggest-setup card. Returns a `<section class="ct-suggest-card">`
 * containing the heading (icon + text), the count/explanation copy, and the
 * two action buttons.
 */
export function renderSuggestSetupCard(
  props: SuggestSetupCardProps,
): HTMLElement {
  const { scannedCount, postMessage } = props;

  const card = document.createElement("section");
  card.className = "ct-suggest-card";
  card.setAttribute("role", "region");
  card.setAttribute("aria-label", "Orchestration detected — set up your team");

  // ── Header row: icon + heading + dismiss (✕) ────────────────────────────
  const header = document.createElement("div");
  header.className = "ct-suggest-card-header";

  const icon = document.createElement("span");
  icon.className = "ct-suggest-card-icon codicon-gear";
  // Icon is decorative — the heading text carries the meaning; mark aria-hidden
  // so AT doesn't read the glyph, but the heading remains the accessible name.
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⚙";
  header.appendChild(icon);

  const heading = document.createElement("h2");
  heading.className = "ct-suggest-card-heading";
  heading.textContent = "Orchestration detected";
  header.appendChild(heading);

  const dismissX = document.createElement("button");
  dismissX.type = "button";
  dismissX.className = "ct-suggest-card-dismiss";
  dismissX.setAttribute("aria-label", "Dismiss setup suggestion");
  dismissX.title = "Dismiss";
  dismissX.textContent = "✕";
  header.appendChild(dismissX);

  card.appendChild(header);

  // ── Body copy — count line uses scanned.length, never hardcoded ──────────
  const body = document.createElement("p");
  body.className = "ct-suggest-card-body";
  const agentWord = scannedCount === 1 ? "agent" : "agents";
  body.textContent =
    `This project has ${scannedCount} ${agentWord} but no ClaudeTeam roster yet. ` +
    `Set up a team to see them as named tiles.`;
  card.appendChild(body);

  // ── Actions ─────────────────────────────────────────────────────────────
  const actions = document.createElement("div");
  actions.className = "ct-suggest-card-actions";

  const setupBtn = document.createElement("button");
  setupBtn.type = "button";
  setupBtn.className = "ct-btn ct-btn--primary ct-suggest-card-setup";
  setupBtn.textContent = "Set up team";
  actions.appendChild(setupBtn);

  const notNowBtn = document.createElement("button");
  notNowBtn.type = "button";
  notNowBtn.className = "ct-btn ct-suggest-card-notnow";
  notNowBtn.textContent = "Not now";
  actions.appendChild(notNowBtn);

  card.appendChild(actions);

  // ── Wiring ───────────────────────────────────────────────────────────────
  const openManageTeam = (): void => {
    const msg: WebviewMessage = { type: "ui:open-manage-team" };
    postMessage(msg);
  };
  const dismiss = (): void => {
    const msg: WebviewMessage = { type: "ui:dismiss-setup-suggestion" };
    postMessage(msg);
  };

  setupBtn.addEventListener("click", openManageTeam);
  // ✕ and "Not now" are the SAME action (spec §2.2).
  dismissX.addEventListener("click", dismiss);
  notNowBtn.addEventListener("click", dismiss);

  return card;
}
