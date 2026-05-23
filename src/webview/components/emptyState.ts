/**
 * emptyState — "No live Claude Code sessions." per spec §3.2.
 *
 * Renders ONLY when AgentTree.sessions is empty OR every session has
 * isAlive === false. The exact string is hard-mirrored from M1-03 §1.7 for
 * vocabulary parity between CLI and dashboard.
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §3.2
 */

export function renderEmptyState(): HTMLElement {
  const container = document.createElement("div");
  container.className = "empty-state";
  container.textContent = "No live Claude Code sessions.";
  return container;
}
