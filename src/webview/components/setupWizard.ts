/**
 * setupWizard — the first-run setup flow inside the Manage Team panel
 * (team-setup spec §3, Decision 3).
 *
 * Two linear steps with back-nav:
 *   Step 1 — Scan results: one checkbox row per `ScannedAgent`, ALL checked
 *            (included) by default (opt-OUT curation). Live "N detected · M
 *            included" count. "Preview →" disabled at 0 included.
 *   Step 2 — Preview: read-only friendly summary of the starter team (display =
 *            agentName, role = the auto-derived `ScannedAgent.role` or "—" when
 *            absent, character "not set" → monogram chip).
 *            "Confirm & create" posts `ui:run-setup { include }`.
 *
 * The wizard owns its OWN ephemeral step + checkbox state (webview-local UI —
 * allowed; the host owns the durable config). It re-renders its own subtree on
 * step/checkbox change without a host round-trip until "Confirm & create".
 *
 * The panel hosts the wizard's success/error banner via the shared
 * `setupBanner` slot (NIT 2 — single-slot, no stacking). On
 * `setup:config-saved { ok:false }` the panel calls `showError` so the wizard
 * stays on the preview step with the curated selection intact (spec §3.3).
 *
 * Theme-aware; monogram chips reuse `renderMonogramChip`. No new tokens (§8).
 *
 * Source: team/iris-ux/team-setup-spec.md §3.1, §3.2, §3.3.
 */

import type { ScannedAgent } from "../../shared/types.js";
import type { WebviewMessage } from "../../shared/messages.js";
import { renderMonogramChip } from "./monogramChip.js";

export interface SetupWizardProps {
  /** Scanned agents from the host `setup:detection` payload. */
  scanned: ScannedAgent[];
  /** Workspace folder name — seeds the preview "Team: <name>" line. */
  teamNameSeed: string;
  /** Webview → host dispatcher. */
  postMessage: (msg: WebviewMessage) => void;
  /** Called when the user cancels the wizard (panel decides what to show). */
  onCancel?: () => void;
}

/** Step indicator labels (spec §3 — "Scan · Curate · Confirm" → 2 active steps). */
type WizardStep = "scan" | "preview";

/**
 * Build the wizard subtree. Returns the root element; internal state lives in
 * the closure and drives re-renders of the body via `rebuild()`.
 */
export function renderSetupWizard(props: SetupWizardProps): HTMLElement {
  const { scanned, teamNameSeed, postMessage, onCancel } = props;

  // Webview-local ephemeral state — included set (agentName → boolean), all
  // checked by default (opt-out curation, spec §3.1).
  const included = new Map<string, boolean>();
  for (const a of scanned) {
    included.set(a.agentName, true);
  }
  let step: WizardStep = "scan";

  const root = document.createElement("section");
  root.className = "ct-wizard";
  root.setAttribute("aria-label", "Set up your team");

  const body = document.createElement("div");
  body.className = "ct-wizard-body";
  root.appendChild(body);

  const includedNames = (): string[] =>
    scanned
      .map((a) => a.agentName)
      .filter((name) => included.get(name) === true);

  const rebuild = (): void => {
    body.replaceChildren();
    if (step === "scan") {
      body.appendChild(buildScanStep());
    } else {
      body.appendChild(buildPreviewStep());
    }
  };

  // ── Step 1 — Scan / curate ────────────────────────────────────────────────
  function buildScanStep(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ct-wizard-scan";

    const heading = document.createElement("h2");
    heading.className = "ct-wizard-heading";
    heading.textContent = "Set up your team — choose which agents to include";
    wrap.appendChild(heading);

    const list = document.createElement("div");
    list.className = "ct-wizard-agent-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Agents to include");

    const countLine = document.createElement("p");
    countLine.className = "ct-wizard-count";

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "ct-btn ct-btn--primary ct-wizard-preview-btn";
    previewBtn.textContent = "Preview →";

    const refreshCount = (): void => {
      const inc = includedNames().length;
      countLine.textContent = `${scanned.length} detected · ${inc} included`;
      // "Preview →" disabled when 0 included (can't generate an empty roster).
      previewBtn.disabled = inc === 0;
    };

    for (const agent of scanned) {
      const row = document.createElement("label");
      row.className = "ct-wizard-agent-row";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "ct-wizard-agent-checkbox";
      cb.checked = included.get(agent.agentName) === true;
      cb.dataset.agentName = agent.agentName;
      cb.addEventListener("change", () => {
        included.set(agent.agentName, cb.checked);
        refreshCount();
      });
      row.appendChild(cb);

      const name = document.createElement("span");
      name.className = "ct-wizard-agent-name";
      name.textContent = agent.agentName;
      row.appendChild(name);

      // filePath basename, muted, for disambiguation.
      const file = document.createElement("span");
      file.className = "ct-wizard-agent-file";
      file.textContent = basename(agent.filePath);
      row.appendChild(file);

      list.appendChild(row);
    }
    wrap.appendChild(list);

    wrap.appendChild(countLine);

    const actions = document.createElement("div");
    actions.className = "ct-wizard-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ct-btn ct-wizard-cancel-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => onCancel?.());
    actions.appendChild(cancelBtn);

    previewBtn.addEventListener("click", () => {
      if (includedNames().length === 0) return;
      step = "preview";
      rebuild();
    });
    actions.appendChild(previewBtn);

    wrap.appendChild(actions);

    refreshCount();
    return wrap;
  }

  // ── Step 2 — Preview ────────────────────────────────────────────────────
  function buildPreviewStep(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ct-wizard-preview";

    const heading = document.createElement("h2");
    heading.className = "ct-wizard-heading";
    heading.textContent = "Preview — this is your starting team";
    wrap.appendChild(heading);

    const teamLine = document.createElement("p");
    teamLine.className = "ct-wizard-team-line";
    teamLine.textContent = `Team: ${teamNameSeed}`;
    wrap.appendChild(teamLine);

    // Bug A (86ca1u41m): the preview must show each member's auto-derived role
    // (86ca1nvae seeds `Member.role` from `ScannedAgent.role` at config gen), so
    // the preview matches what "Confirm & create" will actually persist.
    // Previously this hardcoded "role: —" regardless of the scanned role, so a
    // team with auto-resolved roles still previewed every member as blank.
    // Look the role up by agentName from the `scanned` array (in closure).
    const byName = new Map<string, ScannedAgent>();
    for (const a of scanned) {
      byName.set(a.agentName, a);
    }

    const table = document.createElement("div");
    table.className = "ct-wizard-preview-table";
    for (const name of includedNames()) {
      const memberRow = document.createElement("div");
      memberRow.className = "ct-wizard-preview-row";

      // Fresh member → no character → monogram chip (muted).
      memberRow.appendChild(renderMonogramChip({ display: name, muted: true }));

      const displaySpan = document.createElement("span");
      displaySpan.className = "ct-wizard-preview-display";
      displaySpan.textContent = name; // display = agentName seed
      memberRow.appendChild(displaySpan);

      const roleSpan = document.createElement("span");
      roleSpan.className = "ct-wizard-preview-role";
      // Auto-derived role when present; em-dash fallback when the `.md` had no
      // parseable description (ScannedAgent.role is then absent — matches the
      // empty role string gen will fall back to).
      const role = byName.get(name)?.role;
      roleSpan.textContent =
        role !== undefined && role.length > 0 ? `role: ${role}` : "role: —";
      memberRow.appendChild(roleSpan);

      const charSpan = document.createElement("span");
      charSpan.className = "ct-wizard-preview-char";
      charSpan.textContent = "character: not set";
      memberRow.appendChild(charSpan);

      table.appendChild(memberRow);
    }
    wrap.appendChild(table);

    const hint = document.createElement("p");
    hint.className = "ct-wizard-preview-hint";
    hint.textContent =
      "You can rename, set roles, and pick characters after setup.";
    wrap.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "ct-wizard-actions";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "ct-btn ct-wizard-back-btn";
    backBtn.textContent = "← Back";
    backBtn.addEventListener("click", () => {
      step = "scan";
      rebuild();
    });
    actions.appendChild(backBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "ct-btn ct-btn--primary ct-wizard-confirm-btn";
    confirmBtn.textContent = "Confirm & create";
    confirmBtn.addEventListener("click", () => {
      const include = includedNames();
      if (include.length === 0) return;
      const msg: WebviewMessage = {
        type: "ui:run-setup",
        payload: { include },
      };
      postMessage(msg);
      // The host acks via setup:config-saved; the panel handles the transition
      // (success → edit layout, error → stay here). We don't optimistically
      // advance — staying put keeps the curated selection if the write fails.
    });
    actions.appendChild(confirmBtn);

    wrap.appendChild(actions);
    return wrap;
  }

  rebuild();
  return root;
}

/** Portable basename (handles both `\` and `/`). */
function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx < 0 ? p : p.slice(idx + 1);
}
