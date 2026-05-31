/**
 * setupBanner — the single inline success/error banner at the top of the
 * Manage Team panel (team-setup spec §3.3, §4.3).
 *
 * ── NIT 2 (spec §3.3 / §4.3 — de-dupe/sequence success banners) — RESOLVED ──
 * Both the wizard-confirm path ("Team created") and the edit-save path
 * ("Saved") resolve to `setup:config-saved { ok }` and want to show a brief
 * banner. Naively appending one per ack STACKS them (e.g. "Team created"
 * lingering under a later "Saved"). This module enforces a SINGLE banner slot:
 * `showSetupBanner` REPLACES whatever banner is currently mounted in the slot
 * (it does not append a second), and re-arms the auto-dismiss timer. So the
 * sequence wizard-confirm → land-in-edit → save shows exactly one banner at a
 * time — "Team created" is replaced by "Saved", never stacked beneath it.
 *
 * The slot is a stable `<div class="ct-setup-banner-slot">` the panel owns; the
 * banner lives inside it. `clearSetupBanner` empties the slot (used when the
 * panel re-renders or the user starts a fresh edit).
 *
 * Variants:
 *   - `kind: "success"` — green-leaning, transient (auto-dismiss after
 *     `autoDismissMs`, default 4000ms). "Team created" / "Saved".
 *   - `kind: "error"`   — error-leaning, PERSISTENT (no auto-dismiss — the
 *     user must see the failure + retry). "Couldn't save: <error>".
 *
 * Theme-aware: success uses neutral `--vscode-foreground`; error uses
 * `--vscode-inputValidation-errorForeground/Background`. No new tokens (§8).
 *
 * Source: team/iris-ux/team-setup-spec.md §3.3, §4.3.
 */

export type SetupBannerKind = "success" | "error";

export interface ShowSetupBannerProps {
  /** The stable slot element the panel owns (one banner lives here at a time). */
  slot: HTMLElement;
  kind: SetupBannerKind;
  /** Banner text (e.g. "Team created", "Saved", "Couldn't save: <error>"). */
  message: string;
  /**
   * Auto-dismiss delay for success banners (ms). Ignored for error banners
   * (persistent). Default 4000. Pass 0 to disable auto-dismiss (tests).
   */
  autoDismissMs?: number;
  /** Timer scheduler injection (tests). Defaults to setTimeout. */
  schedule?: (cb: () => void, ms: number) => number;
  /** Timer canceller injection (tests). Defaults to clearTimeout. */
  cancel?: (handle: number) => void;
  /**
   * BUG D (86ca1u41m) — fired when a SUCCESS banner's auto-dismiss timer
   * expires and it clears itself. Lets the caller (the boot closure's
   * `pendingBanner`) drop its persisted copy so the banner does not resurrect on
   * the next re-render. Not called for error banners (they persist) nor when a
   * replacement banner pre-empts the timer. Optional.
   */
  onAutoDismiss?: () => void;
}

/**
 * Tracks the active auto-dismiss timer per slot so a replacement banner cancels
 * the prior timer (otherwise a stale timeout could clear the NEW banner early).
 * Keyed by the slot element via a WeakMap so slots GC cleanly.
 */
const activeTimers = new WeakMap<HTMLElement, number>();

/**
 * Replace whatever banner is in `slot` with a fresh one (NIT 2 — single-slot
 * de-dupe). Returns the banner element.
 */
export function showSetupBanner(props: ShowSetupBannerProps): HTMLElement {
  const {
    slot,
    kind,
    message,
    autoDismissMs = 4000,
    schedule = (cb, ms) => window.setTimeout(cb, ms) as unknown as number,
    cancel = (h) => window.clearTimeout(h),
    onAutoDismiss,
  } = props;

  // Cancel any prior auto-dismiss timer for this slot, then clear the slot —
  // this is what prevents stacking: the prior banner is removed, not retained.
  const prior = activeTimers.get(slot);
  if (prior !== undefined) {
    cancel(prior);
    activeTimers.delete(slot);
  }
  slot.replaceChildren();

  const banner = document.createElement("div");
  banner.className =
    kind === "error"
      ? "ct-setup-banner ct-setup-banner--error"
      : "ct-setup-banner ct-setup-banner--success";
  // Success is polite status; error is assertive alert.
  banner.setAttribute("role", kind === "error" ? "alert" : "status");
  banner.dataset.kind = kind;

  const text = document.createElement("span");
  text.className = "ct-setup-banner-text";
  text.textContent = message;
  banner.appendChild(text);

  slot.appendChild(banner);

  // Success banners auto-dismiss; error banners persist until the next action.
  if (kind === "success" && autoDismissMs > 0) {
    const handle = schedule(() => {
      // Only clear if this banner is still the one mounted (a later banner
      // would have replaced it AND re-armed its own timer + WeakMap entry).
      if (slot.firstChild === banner) {
        slot.replaceChildren();
        // BUG D: tell the caller the persisted pending banner can be dropped —
        // only when WE actually cleared it (not when a replacement pre-empted).
        onAutoDismiss?.();
      }
      activeTimers.delete(slot);
    }, autoDismissMs);
    activeTimers.set(slot, handle);
  }

  return banner;
}

/** Empty the banner slot and cancel any pending auto-dismiss timer. */
export function clearSetupBanner(
  slot: HTMLElement,
  cancel: (handle: number) => void = (h) => window.clearTimeout(h),
): void {
  const prior = activeTimers.get(slot);
  if (prior !== undefined) {
    cancel(prior);
    activeTimers.delete(slot);
  }
  slot.replaceChildren();
}
