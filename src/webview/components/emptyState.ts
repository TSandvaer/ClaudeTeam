/**
 * emptyState — empty-state messaging per spec §3.2 and M3-04 AC4.
 *
 * Two variants:
 *
 * 1. **Generic empty** (M2-05 default): "No live Claude Code sessions."
 *    Mirrored verbatim from M1-03 §1.7 for vocabulary parity between CLI
 *    and dashboard. Renders when the dashboard has no sessions and no
 *    workspace filter applied.
 *
 * 2. **Filtered empty** (M3-04 AC4): renders when
 *    `state.sessions.length === 0 && state.filterApplied === true`. Tells
 *    the user the window-scoped filter ate the session list and points
 *    them at the workaround (run `claude` here, or flip the global
 *    setting). The "Show all sessions" mention is rendered as PLAIN TEXT
 *    per M3-04 AC4 — there is no `ui:open-settings` message wired and the
 *    AC explicitly says not to block on adding one.
 *
 * Backwards-compatible API — calling `renderEmptyState()` with no args
 * yields the original generic message (existing tests / render.ts call
 * sites keep working unchanged).
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §3.2
 *         team/nora-pl/milestone-3-backlog.md § M3-03 AC6 (text source),
 *                                                M3-04 AC4 (consumption)
 */

/**
 * EXACT copy for the team-setup `empty` detection state (spec §2.3, LOCKED —
 * quote verbatim: no trailing period, no rewording). Sage asserts an exact
 * string match (TS-04 AC2). Exported so tests reference the constant rather
 * than re-typing the literal.
 */
export const NO_ORCHESTRATION_SETUP_COPY =
  "This project has no orchestration setup, nothing to show";

export interface EmptyStateProps {
  /**
   * When true, render the M3-04 filtered-empty variant. When false / absent,
   * render the M2-05 generic variant. The caller (`render.ts`) decides
   * based on `state.filterApplied`.
   */
  filtered?: boolean;
}

/**
 * Render the team-setup `empty` detection-state card (spec §2.3): a centered,
 * quiet card with the LOCKED EXACT copy and a muted icon. No "Set up team" CTA
 * (with <2 agents there is nothing meaningful to roster — offering setup would
 * mislead). All color via `--vscode-*` tokens (theme-aware, no hardcoded hex).
 *
 * Distinct from `renderEmptyState` (the "no live sessions" variants) — this is
 * the detection-state card switched on by `SetupDetectionState === "empty"`.
 */
export function renderNoSetupState(): HTMLElement {
  const container = document.createElement("div");
  container.className = "empty-state ct-no-setup-state";
  // role=status so AT announces the quiet state without it reading as an error.
  container.setAttribute("role", "status");

  const icon = document.createElement("span");
  icon.className = "ct-no-setup-icon";
  icon.setAttribute("aria-label", "no orchestration setup");
  // Muted dots glyph — paired with the copy below (no icon-only).
  icon.textContent = "( · · · )";
  container.appendChild(icon);

  const copy = document.createElement("p");
  copy.className = "ct-no-setup-copy";
  // LOCKED EXACT string — verbatim, no trailing period (spec §2.3).
  copy.textContent = NO_ORCHESTRATION_SETUP_COPY;
  container.appendChild(copy);

  return container;
}

export function renderEmptyState(props: EmptyStateProps = {}): HTMLElement {
  const { filtered = false } = props;

  const container = document.createElement("div");
  container.className = filtered
    ? "empty-state empty-state--filtered"
    : "empty-state";

  if (!filtered) {
    // M2-05 / M1-03 generic empty — verbatim string preserves CLI parity.
    container.textContent = "No live Claude Code sessions.";
    return container;
  }

  // M3-04 filtered-empty (text from M3-03 AC6). Render as semantic markup
  // so the inline setting name and `claude` command are visually distinct
  // (monospace via .empty-state-code) without changing the wording.
  const headline = document.createElement("p");
  headline.className = "empty-state-headline";
  headline.textContent = "No Claude Code sessions for this workspace.";
  container.appendChild(headline);

  const guidance = document.createElement("p");
  guidance.className = "empty-state-guidance";

  guidance.appendChild(document.createTextNode("Run "));

  const claudeCmd = document.createElement("code");
  claudeCmd.className = "empty-state-code";
  claudeCmd.textContent = "claude";
  guidance.appendChild(claudeCmd);

  guidance.appendChild(
    document.createTextNode(" in this folder, or enable "),
  );

  const settingName = document.createElement("code");
  settingName.className = "empty-state-code";
  settingName.textContent = "claudeteam.showAllSessionsGlobally";
  guidance.appendChild(settingName);

  guidance.appendChild(
    document.createTextNode(" to see sessions from other workspaces."),
  );

  container.appendChild(guidance);

  return container;
}
