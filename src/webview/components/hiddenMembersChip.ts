/**
 * hiddenMembersChip — the "N hidden agents [show]" recovery surface for the
 * reversible hide-agent feature (E-06b / EPIC 86ca11187 §7.2).
 *
 * Mirrors the existing header-chip / per-team-row pattern: a collapsed
 * count chip that the user expands to reveal the list of hidden rostered
 * members, each with a per-member "unhide" affordance + a "show all" action.
 *
 * Wire inputs (VERBATIM from E-06a host vocab merged on main, PR #115):
 *   - `hiddenMemberKeys: HiddenMemberKey[]` — the persisted hidden set as
 *     `` `${teamId}:${memberId}` `` strings. `.length` drives the count chip.
 *     Carries ALL hidden keys (even members with no live tile this session),
 *     so this list is complete.
 *
 * Wire outputs (VERBATIM):
 *   - `ui:show-member` `{ teamId, memberId }` — per-member unhide. Payload
 *     carries the (teamId, memberId) PAIR, never the joined key — the host
 *     re-joins via `hiddenMemberKey()`.
 *   - `ui:show-all-hidden` (no payload) — clear the whole hidden set.
 *
 * Display-name resolution: `hiddenMemberKeys` carries only ids. To render a
 * human-friendly "Bram (hidden) — Research" row, the caller threads a
 * `resolveMember(teamId, memberId)` lookup (webview-local roster cache,
 * populated from tiles seen across ticks — see `memberDirectory.ts`). When the
 * member was never observed (cache miss), the row falls back to the raw
 * `memberId` so the unhide affordance is still reachable.
 *
 * Collapsed by default (spec §7.2 wireframe: "⋯ N hidden agents [show]" →
 * expand). Expansion state is webview-local ephemeral UI (allowed per
 * `vscode-extension-conventions.md` § "State minimalism") and tracked by the
 * caller across re-renders so the panel doesn't snap shut every ~2s poll tick.
 *
 * Source: team/iris-ux/whole-team-display-spec.md §7.2
 *         src/shared/messages.ts (HideMemberMessage / ShowMemberMessage /
 *           ShowAllHiddenMessage — E-06a vocab)
 *         .claude/docs/vscode-extension-conventions.md "Webview rules"
 */

import type { HiddenMemberKey } from "../../shared/types.js";
import { parseHiddenMemberKey } from "../../shared/types.js";
import type { WebviewMessage } from "../../shared/messages.js";

/** Em-dash (U+2014) — single source so tests can match exactly. */
const EM_DASH = "—";

/**
 * Resolved display metadata for one hidden member. Returned by the caller's
 * `resolveMember` lookup; `null` when the member was never observed (the chip
 * falls back to the raw memberId).
 */
export interface ResolvedMember {
  /** Display name (roster `member.display`, e.g. "Bram"). */
  display: string;
  /** Role label (roster `member.role`, e.g. "Research"). Optional. */
  role?: string;
}

export interface HiddenMembersChipProps {
  /**
   * The persisted hidden-member set this tick (`SerializedDashboardState
   * .hiddenMemberKeys`). Empty / undefined → the chip renders nothing
   * (returns null). The count is `hiddenMemberKeys.length`.
   */
  hiddenMemberKeys: HiddenMemberKey[];
  /**
   * Whether the reveal panel is currently expanded. Webview-local ephemeral
   * UI state owned by the caller (`main.ts` boot closure) so it survives the
   * next host-driven `renderFull`. Defaults to collapsed.
   */
  expanded?: boolean;
  /**
   * Caller-supplied toggle handler. Invoked when the user clicks the chip's
   * [show] / [hide] control. The caller flips its tracked expansion flag and
   * re-renders. Optional — when absent the chip still toggles its own DOM
   * optimistically (no persistence across re-render).
   */
  onToggle?: (nextExpanded: boolean) => void;
  /**
   * Resolve a hidden member's display metadata. Cache miss → return null and
   * the row falls back to the raw memberId. Pure lookup; no side effects.
   */
  resolveMember?: (teamId: string, memberId: string) => ResolvedMember | null;
  /** Webview → host postMessage dispatcher. */
  postMessage: (msg: WebviewMessage) => void;
}

/**
 * Render the hidden-members recovery chip. Returns `null` when there is
 * nothing hidden (the chip is absent from the mount — consistent with the
 * background-noise / dead-count chip pattern: surfaces only when relevant).
 */
export function renderHiddenMembersChip(
  props: HiddenMembersChipProps,
): HTMLElement | null {
  const {
    hiddenMemberKeys,
    expanded = false,
    onToggle,
    resolveMember,
    postMessage,
  } = props;

  const count = hiddenMemberKeys.length;
  if (count <= 0) {
    // Nothing hidden — no chip. The header still carries the per-tile hide
    // affordances; recovery surface only matters once something is hidden.
    return null;
  }

  // Outer <aside> — a tangential utility control (same landmark semantics as
  // the header filter chips so screen readers can skip via landmark nav).
  const chip = document.createElement("aside");
  chip.className = "ct-hidden-members-chip";
  chip.dataset.hiddenMemberCount = String(count);
  chip.dataset.expanded = String(expanded);

  // ── Toggle button: "⋯ N hidden agents [show]" / "[hide]" ────────────────
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ct-hidden-members-toggle";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.textContent = toggleLabel(count, expanded);
  toggle.setAttribute(
    "aria-label",
    `${count} hidden agent${count === 1 ? "" : "s"} ${EM_DASH} ${
      expanded ? "hide list" : "show list"
    }`,
  );
  toggle.addEventListener("click", () => {
    const next = !expanded;
    if (onToggle) {
      onToggle(next);
    } else {
      // No persistence handler — toggle the DOM optimistically so the panel
      // opens/closes within the current render (component-test path).
      chip.dataset.expanded = String(next);
      toggle.setAttribute("aria-expanded", String(next));
      toggle.textContent = toggleLabel(count, next);
      list.hidden = !next;
    }
  });
  chip.appendChild(toggle);

  // ── Reveal list: per-member row with [unhide] + a [Show all] footer ─────
  const list = document.createElement("div");
  list.className = "ct-hidden-members-list";
  list.hidden = !expanded;

  for (const key of hiddenMemberKeys) {
    const parsed = parseHiddenMemberKey(key);
    if (!parsed) {
      // Malformed key (no separator) — skip it. Defensive; kebab-case ids
      // never contain ":" so this should not occur in practice.
      continue;
    }
    list.appendChild(
      renderHiddenMemberRow(parsed, resolveMember, postMessage),
    );
  }

  // "Show all" footer — clears the entire hidden set in one click.
  const showAll = document.createElement("button");
  showAll.type = "button";
  showAll.className = "ct-hidden-members-show-all";
  showAll.textContent = "Show all";
  showAll.setAttribute("aria-label", "Show all hidden agents");
  showAll.addEventListener("click", () => {
    const msg: WebviewMessage = { type: "ui:show-all-hidden" };
    postMessage(msg);
  });
  list.appendChild(showAll);

  chip.appendChild(list);

  return chip;
}

/**
 * Render one revealed-hidden member row:
 *
 *   ○ Bram (hidden)   [unhide ↩]
 *     Research
 *
 * Display/role resolved via `resolveMember`; cache miss falls back to the raw
 * memberId so the unhide affordance is always reachable. The unhide button
 * posts `ui:show-member { teamId, memberId }` — the PAIR, not the joined key.
 */
function renderHiddenMemberRow(
  parsed: { teamId: string; memberId: string },
  resolveMember:
    | ((teamId: string, memberId: string) => ResolvedMember | null)
    | undefined,
  postMessage: (msg: WebviewMessage) => void,
): HTMLElement {
  const { teamId, memberId } = parsed;
  const resolved = resolveMember?.(teamId, memberId) ?? null;
  const display = resolved?.display ?? memberId;

  const row = document.createElement("div");
  row.className = "ct-hidden-member-row";
  row.dataset.teamId = teamId;
  row.dataset.memberId = memberId;

  // Identity column (display name + optional role under it).
  const identity = document.createElement("div");
  identity.className = "ct-hidden-member-identity";

  const nameSpan = document.createElement("span");
  nameSpan.className = "ct-hidden-member-name";
  // "(hidden)" suffix per spec §7.2 wireframe — the panel context already
  // implies hidden, but the suffix keeps each row self-describing.
  nameSpan.textContent = `${display} (hidden)`;
  identity.appendChild(nameSpan);

  if (resolved?.role) {
    const roleSpan = document.createElement("span");
    roleSpan.className = "ct-hidden-member-role";
    roleSpan.textContent = resolved.role;
    identity.appendChild(roleSpan);
  }

  row.appendChild(identity);

  // Unhide affordance.
  const unhide = document.createElement("button");
  unhide.type = "button";
  unhide.className = "ct-hidden-member-unhide";
  unhide.textContent = `unhide ${EM_DASH_RETURN}`;
  unhide.setAttribute("aria-label", `Unhide ${display}`);
  unhide.addEventListener("click", () => {
    const msg: WebviewMessage = {
      type: "ui:show-member",
      // Payload carries the (teamId, memberId) PAIR — host re-joins via
      // hiddenMemberKey(). Webview never sends the pre-joined key.
      payload: { teamId, memberId },
    };
    postMessage(msg);
  });
  row.appendChild(unhide);

  return row;
}

/** Return-arrow glyph (U+21A9) for the unhide button — matches spec §7.2. */
const EM_DASH_RETURN = "↩";

/**
 * Toggle-button label. Describes the action the click WILL TAKE (mirrors the
 * header-chip convention): collapsed → "[show]"; expanded → "[hide]".
 *
 * Exported for unit tests so the §7.2 label can be asserted directly.
 */
export function toggleLabel(count: number, expanded: boolean): string {
  const noun = count === 1 ? "hidden agent" : "hidden agents";
  const action = expanded ? "hide" : "show";
  return `${count} ${noun} ${EM_DASH} ${action}`;
}
