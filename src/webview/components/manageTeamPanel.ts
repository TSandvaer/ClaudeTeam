/**
 * manageTeamPanel — the Manage Team panel (team-setup spec §4, Decision 5).
 *
 * The reopenable panel. Two layouts (spec §1):
 *   - wizard layout (`renderSetupWizard`) when no config exists (first run).
 *   - edit layout (this module's `renderEditLayout`) when a config exists.
 *
 * `renderManageTeamPanel` is the entry point; it picks the layout from the
 * presence of a config and wires the shared success/error banner slot (NIT 2 —
 * single banner, no stacking) used by BOTH the wizard-confirm and edit-save
 * acks.
 *
 * ── Edit layout (§4.1, §4.2) ────────────────────────────────────────────────
 * One row per member: leading char-chip (current character thumbnail or
 * monogram), editable `display` + `role` inputs, a "Character: [pick ▸]"
 * trigger that opens the inline `characterPicker` popover, and a read-only
 * match-key help line. Orphaned members (§6.1) render greyed with a
 * "Delete member" → inline confirm → `ui:confirm-orphan-delete`.
 *
 * Save assembles the FULL edited `ClaudeTeamConfig` and posts `ui:save-team`.
 * `display` is required (empty blocks save with an inline message); `role` MAY
 * be empty (lean OPTIONAL, §7.3); `match` + `id` + `status` are immutable
 * (carried through verbatim from the source config).
 *
 * Character assignment is a SEPARATE message (`ui:assign-character`) the picker
 * posts directly (spec §5.2) — the panel doesn't batch it into save. The panel
 * tracks the picker's chosen id locally so the row's chip updates immediately;
 * the host's `setup:config-saved` + fresh state refresh reconciles.
 *
 * `[hidden]` guards: the character-picker popover + each orphan confirm panel
 * are flex/grid + toggled via `hidden` → they carry `[hidden]` guards in
 * dashboard.css (source-derived guard test covers them).
 *
 * Theme-aware; no new tokens (§8).
 *
 * Source: team/iris-ux/team-setup-spec.md §1, §4, §5, §6.1.
 */

import type {
  CharacterSource,
  ClaudeTeamConfig,
  Member,
  ScannedAgent,
  Team,
} from "../../shared/types.js";
import type { WebviewMessage } from "../../shared/messages.js";
import { renderMonogramChip } from "./monogramChip.js";
import { renderCharacterPicker } from "./characterPicker.js";
import { renderSetupWizard } from "./setupWizard.js";

export interface ManageTeamPanelProps {
  /**
   * Parsed config when one exists → edit layout. `null` → wizard layout.
   * Drives the layout choice (spec §1 — host serves wizard vs edit, but the
   * webview also picks defensively from config presence).
   */
  config: ClaudeTeamConfig | null;
  /** Scanned agents (for the wizard's scan step). */
  scanned: ScannedAgent[];
  /** Merged bundled + user character sources for the picker. */
  characters: CharacterSource[];
  /** Workspace folder name — seeds the wizard's "Team: <name>" line. */
  teamNameSeed: string;
  /** Host-injected webview base URI for thumbnails. Optional. */
  spriteBaseUri?: string;
  /** Webview → host dispatcher. */
  postMessage: (msg: WebviewMessage) => void;
  /** Called when the user closes/cancels the panel. */
  onClose?: () => void;
}

/**
 * Build the Manage Team panel. Returns the root element. The shared banner slot
 * is exposed on the root as `data-banner-slot` so `main.ts` can locate it to
 * surface `setup:config-saved` acks (NIT 2 single-slot de-dupe).
 */
export function renderManageTeamPanel(
  props: ManageTeamPanelProps,
): HTMLElement {
  const {
    config,
    scanned,
    characters,
    teamNameSeed,
    spriteBaseUri,
    postMessage,
    onClose,
  } = props;

  const root = document.createElement("section");
  root.className = "ct-manage-panel";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Manage Team");

  // Header.
  const header = document.createElement("header");
  header.className = "ct-manage-panel-header";
  const title = document.createElement("h1");
  title.className = "ct-manage-panel-title";
  title.textContent = "Manage Team";
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "ct-manage-panel-close";
  closeBtn.setAttribute("aria-label", "Close Manage Team");
  closeBtn.title = "Close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => onClose?.());
  header.appendChild(closeBtn);
  root.appendChild(header);

  // Shared banner slot (NIT 2) — ONE banner lives here at a time, for both the
  // wizard-confirm ack and the edit-save ack. main.ts targets it by class.
  const bannerSlot = document.createElement("div");
  bannerSlot.className = "ct-setup-banner-slot";
  root.appendChild(bannerSlot);

  // Layout choice: wizard (no config) vs edit (config present).
  if (config === null) {
    root.appendChild(
      renderSetupWizard({
        scanned,
        teamNameSeed,
        postMessage,
        ...(onClose ? { onCancel: onClose } : {}),
      }),
    );
    return root;
  }

  root.appendChild(
    renderEditLayout({
      config,
      characters,
      ...(spriteBaseUri !== undefined ? { spriteBaseUri } : {}),
      postMessage,
    }),
  );
  return root;
}

interface EditLayoutProps {
  config: ClaudeTeamConfig;
  characters: CharacterSource[];
  spriteBaseUri?: string;
  postMessage: (msg: WebviewMessage) => void;
}

/**
 * Build the edit-layout subtree. Tracks per-member edited display/role +
 * locally-chosen character id in a closure so Save can assemble the config and
 * the row chips update on assign without a host round-trip.
 */
export function renderEditLayout(props: EditLayoutProps): HTMLElement {
  const { config, characters, spriteBaseUri, postMessage } = props;

  const wrap = document.createElement("div");
  wrap.className = "ct-manage-edit";

  // Single-team-per-project in V1 (spec / messages note) — operate on the first
  // team but preserve any others verbatim on save.
  const team: Team | undefined = config.teams[0];
  if (!team) {
    const none = document.createElement("p");
    none.className = "ct-manage-empty";
    none.textContent = "No team in this configuration.";
    wrap.appendChild(none);
    return wrap;
  }

  const teamLine = document.createElement("p");
  teamLine.className = "ct-manage-team-line";
  teamLine.textContent = `Team: ${team.name}`;
  wrap.appendChild(teamLine);

  // Per-member edited state. `character: undefined` means "not yet touched in
  // this panel session → use the source member's value"; once the picker fires
  // we set it (id or null).
  interface EditState {
    display: string;
    role: string;
    character: string | null;
  }
  const edits = new Map<string, EditState>();
  for (const m of team.members) {
    edits.set(m.id, {
      display: m.display,
      role: m.role,
      character: m.character ?? null,
    });
  }

  // Validation message line (display required).
  const saveError = document.createElement("p");
  saveError.className = "ct-manage-save-error";
  saveError.hidden = true;
  saveError.setAttribute("role", "alert");

  const rowsContainer = document.createElement("div");
  rowsContainer.className = "ct-manage-rows";

  for (const member of team.members) {
    rowsContainer.appendChild(buildMemberRow(member));
  }
  wrap.appendChild(rowsContainer);

  // Match-key help line (read-only — match is immutable, §4.2).
  const matchHelp = document.createElement("p");
  matchHelp.className = "ct-manage-match-help";
  matchHelp.textContent =
    "Match keys are fixed (set from the agent filename) and not editable.";
  wrap.appendChild(matchHelp);

  // Format-ownership hint (§4.3).
  const formatHint = document.createElement("p");
  formatHint.className = "ct-manage-format-hint";
  formatHint.textContent =
    "ClaudeTeam manages this file. Edits here are saved to " +
    ".claude/claudeteam.yaml; manual edits to that file may be overwritten.";
  wrap.appendChild(formatHint);

  wrap.appendChild(saveError);

  // Save.
  const actions = document.createElement("div");
  actions.className = "ct-manage-actions";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "ct-btn ct-btn--primary ct-manage-save-btn";
  saveBtn.textContent = "Save team";
  saveBtn.addEventListener("click", () => onSave());
  actions.appendChild(saveBtn);
  wrap.appendChild(actions);

  // ── Member row builder ────────────────────────────────────────────────────
  function buildMemberRow(member: Member): HTMLElement {
    const state = edits.get(member.id)!;
    const orphaned = member.status === "orphaned";

    const row = document.createElement("div");
    row.className = orphaned
      ? "ct-manage-row ct-manage-row--orphaned"
      : "ct-manage-row";
    row.dataset.memberId = member.id;
    if (orphaned) {
      row.setAttribute("aria-label", `${member.display} — orphaned`);
    }

    // Leading char chip — thumbnail when a character is chosen + resolvable,
    // else monogram (text-tile preview).
    const chipCell = document.createElement("div");
    chipCell.className = "ct-manage-row-chip";
    refreshChip(chipCell, member.display, state.character);
    row.appendChild(chipCell);

    // Fields column.
    const fields = document.createElement("div");
    fields.className = "ct-manage-row-fields";

    // Display (required).
    const displayLabel = document.createElement("label");
    displayLabel.className = "ct-manage-field";
    const displayCaption = document.createElement("span");
    displayCaption.className = "ct-manage-field-caption";
    displayCaption.textContent = "Display";
    displayLabel.appendChild(displayCaption);
    const displayInput = document.createElement("input");
    displayInput.type = "text";
    displayInput.className = "ct-manage-input ct-manage-input--display";
    displayInput.value = state.display;
    displayInput.disabled = orphaned;
    displayInput.addEventListener("input", () => {
      state.display = displayInput.value;
      // Keep the monogram chip in sync with the edited display name.
      refreshChip(chipCell, state.display, state.character);
    });
    displayLabel.appendChild(displayInput);
    fields.appendChild(displayLabel);

    // Role (optional).
    const roleLabel = document.createElement("label");
    roleLabel.className = "ct-manage-field";
    const roleCaption = document.createElement("span");
    roleCaption.className = "ct-manage-field-caption";
    roleCaption.textContent = "Role";
    roleLabel.appendChild(roleCaption);
    const roleInput = document.createElement("input");
    roleInput.type = "text";
    roleInput.className = "ct-manage-input ct-manage-input--role";
    roleInput.value = state.role;
    roleInput.placeholder = "optional";
    roleInput.disabled = orphaned;
    roleInput.addEventListener("input", () => {
      state.role = roleInput.value;
    });
    roleLabel.appendChild(roleInput);
    fields.appendChild(roleLabel);

    row.appendChild(fields);

    // Character / orphan controls column.
    const controls = document.createElement("div");
    controls.className = "ct-manage-row-controls";

    if (orphaned) {
      controls.appendChild(buildOrphanControls(member));
    } else {
      controls.appendChild(buildCharacterControls(member, chipCell, state));
    }
    row.appendChild(controls);

    return row;
  }

  // ── Character pick / clear controls (per row) ─────────────────────────────
  function buildCharacterControls(
    member: Member,
    chipCell: HTMLElement,
    state: { display: string; role: string; character: string | null },
  ): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "ct-manage-char-controls";

    const status = document.createElement("span");
    status.className = "ct-manage-char-status";
    const refreshStatus = (): void => {
      status.textContent =
        state.character === null
          ? "(not set → text tile)"
          : characterLabel(characters, state.character);
    };
    refreshStatus();

    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "ct-btn ct-manage-pick-btn";
    pickBtn.textContent = "Character: pick ▸";

    // Picker popover (hidden by default; [hidden]-guarded in CSS).
    const pickerHost = document.createElement("div");
    pickerHost.className = "ct-manage-picker-host";

    const closePicker = (): void => {
      pickerHost.replaceChildren();
      pickBtn.setAttribute("aria-expanded", "false");
      pickBtn.focus();
    };

    pickBtn.setAttribute("aria-haspopup", "dialog");
    pickBtn.setAttribute("aria-expanded", "false");
    pickBtn.addEventListener("click", () => {
      if (pickerHost.firstChild) {
        closePicker();
        return;
      }
      pickBtn.setAttribute("aria-expanded", "true");
      const picker = renderCharacterPicker({
        memberId: member.id,
        display: state.display,
        sources: characters,
        current: state.character,
        ...(spriteBaseUri !== undefined ? { spriteBaseUri } : {}),
        // The picker posts ui:assign-character itself; we ALSO update local
        // state so the chip + status reflect the choice immediately. We sniff
        // the chosen value off the message via a wrapping dispatcher.
        postMessage: (msg: WebviewMessage) => {
          if (msg.type === "ui:assign-character") {
            state.character = msg.payload.character;
            refreshChip(chipCell, state.display, state.character);
            refreshStatus();
          }
          postMessage(msg);
        },
        onClose: closePicker,
      });
      pickerHost.appendChild(picker);
    });

    controls.appendChild(pickBtn);
    controls.appendChild(status);
    controls.appendChild(pickerHost);
    return controls;
  }

  // ── Orphan delete controls (per row, §6.1) ────────────────────────────────
  function buildOrphanControls(member: Member): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "ct-manage-orphan-controls";

    const badge = document.createElement("span");
    badge.className = "ct-manage-orphan-badge";
    badge.textContent = "⚠ orphaned";
    controls.appendChild(badge);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ct-btn ct-manage-orphan-delete-btn";
    deleteBtn.textContent = "Delete member";
    controls.appendChild(deleteBtn);

    // Inline confirm panel (hidden by default; [hidden]-guarded flex in CSS).
    const confirm = document.createElement("div");
    confirm.className = "ct-manage-orphan-confirm";
    confirm.setAttribute("role", "dialog");
    confirm.setAttribute("aria-label", `Delete ${member.display} from the team?`);
    confirm.hidden = true;

    const confirmText = document.createElement("p");
    confirmText.className = "ct-manage-orphan-confirm-text";
    confirmText.textContent =
      `Delete "${member.display}" from the team? ` +
      "Its match key and settings are removed.";
    confirm.appendChild(confirmText);

    const confirmActions = document.createElement("div");
    confirmActions.className = "ct-manage-orphan-confirm-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ct-btn ct-manage-orphan-cancel-btn";
    cancelBtn.textContent = "Cancel";
    const reallyDeleteBtn = document.createElement("button");
    reallyDeleteBtn.type = "button";
    reallyDeleteBtn.className =
      "ct-btn ct-btn--danger ct-manage-orphan-confirm-btn";
    reallyDeleteBtn.textContent = "Delete";
    confirmActions.appendChild(cancelBtn);
    confirmActions.appendChild(reallyDeleteBtn);
    confirm.appendChild(confirmActions);

    deleteBtn.addEventListener("click", () => {
      confirm.hidden = false;
      cancelBtn.focus();
    });
    cancelBtn.addEventListener("click", () => {
      confirm.hidden = true;
      deleteBtn.focus();
    });
    reallyDeleteBtn.addEventListener("click", () => {
      const msg: WebviewMessage = {
        type: "ui:confirm-orphan-delete",
        payload: { memberId: member.id },
      };
      postMessage(msg);
      confirm.hidden = true;
    });
    confirm.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        confirm.hidden = true;
        deleteBtn.focus();
      }
    });

    controls.appendChild(confirm);
    return controls;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  function onSave(): void {
    // Validate: every (non-orphaned) member needs a non-empty display.
    for (const m of team!.members) {
      if (m.status === "orphaned") continue;
      const st = edits.get(m.id)!;
      if (st.display.trim().length === 0) {
        saveError.textContent = "Display name required";
        saveError.hidden = false;
        return;
      }
    }
    saveError.hidden = true;

    // Assemble the edited config — preserve immutable fields (id, match,
    // status) verbatim; carry through any teams beyond the first unchanged.
    const editedTeam: Team = {
      ...team!,
      members: team!.members.map((m): Member => {
        const st = edits.get(m.id)!;
        return {
          ...m,
          display: st.display,
          role: st.role,
          character: st.character,
        };
      }),
    };
    const editedConfig: ClaudeTeamConfig = {
      version: config.version,
      teams: config.teams.map((t, i) => (i === 0 ? editedTeam : t)),
    };
    const msg: WebviewMessage = {
      type: "ui:save-team",
      payload: { config: editedConfig },
    };
    postMessage(msg);
  }

  /** Update a row's leading chip: thumbnail when character resolvable, else monogram. */
  function refreshChip(
    chipCell: HTMLElement,
    display: string,
    character: string | null,
  ): void {
    chipCell.replaceChildren();
    if (character !== null) {
      const source = characters.find((c) => c.id === character);
      if (
        source &&
        spriteBaseUri !== undefined &&
        source.thumbnailPath.length > 0
      ) {
        const img = document.createElement("img");
        img.className = "ct-manage-row-thumb";
        img.src = `${spriteBaseUri.replace(/\/+$/, "")}/${source.thumbnailPath.replace(/^\/+/, "")}`;
        img.alt = "";
        img.setAttribute("aria-hidden", "true");
        img.decoding = "async";
        chipCell.appendChild(img);
        return;
      }
    }
    // null character OR unresolvable thumbnail → monogram.
    chipCell.appendChild(renderMonogramChip({ display }));
  }

  return wrap;
}

/** Resolve a character id to its picker label, falling back to the id itself. */
function characterLabel(sources: CharacterSource[], id: string): string {
  return sources.find((c) => c.id === id)?.label ?? id;
}
