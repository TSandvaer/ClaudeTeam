/**
 * messageReceiver — webview side of the host ↔ webview bridge.
 *
 * Registers a `window.message` listener and dispatches typed `HostMessage`
 * objects to a per-type handler. The webview's `main.ts` calls
 * `initMessageReceiver` once at boot and registers handlers for the message
 * types it cares about (`state:full`, `state:delta`, `roster:loaded`,
 * `roster:error`).
 *
 * Design notes:
 *   - Strictly type-driven dispatch — a runtime that doesn't match the
 *     discriminator is logged and ignored (defensive against unexpected VS Code
 *     internals posting messages on the same channel).
 *   - No global singleton state — `initMessageReceiver` returns a Disposable
 *     so tests can register / unregister cleanly.
 *   - The receiver does NOT diff state itself. Re-render diffing is the
 *     renderer's responsibility (per AC7 — the receiver hands off the typed
 *     payload, the renderer decides what to repaint).
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Message protocol"
 *         team/iris-ux/m2-dashboard-tile-spec.md §9 (Interaction contract)
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC1, AC7
 */

import type {
  HostMessage,
  StateFullMessage,
  StateDeltaMessage,
  RosterLoadedMessage,
  RosterErrorMessage,
  SetupDetectionMessage,
  SetupCharactersMessage,
  SetupConfigSavedMessage,
  OpenManageTeamPanelMessage,
} from "../shared/messages.js";

/** One handler per HostMessage `type` discriminator. All optional. */
export interface HostMessageHandlers {
  onStateFull?(msg: StateFullMessage): void;
  onStateDelta?(msg: StateDeltaMessage): void;
  onRosterLoaded?(msg: RosterLoadedMessage): void;
  onRosterError?(msg: RosterErrorMessage): void;
  /**
   * Team-setup epic (TS-03 / spec §2, §3). Host emits the detection
   * trichotomy + the scanned-agents list; the webview switches the dashboard
   * root + feeds the wizard's scan step. `scanned` is always the full scan
   * (even in `configured`) for the Manage Team panel.
   */
  onSetupDetection?(msg: SetupDetectionMessage): void;
  /**
   * Team-setup epic (spec §5). Host emits the merged bundled + user character
   * sources for the picker grid.
   */
  onSetupCharacters?(msg: SetupCharactersMessage): void;
  /**
   * Team-setup epic (spec §3.3, §4.3). Ack for `ui:run-setup` / `ui:save-team`
   * — drives the panel's single success/error banner (NIT 2) + the wizard →
   * edit-layout transition.
   */
  onSetupConfigSaved?(msg: SetupConfigSavedMessage): void;
  /**
   * Host asked the webview to open the Manage Team panel (86ca1u0nf —
   * `setup:open-manage-team`). Driven by the `claudeteam.manageTeam` command
   * (title-bar button + Command Palette). The handler flips the webview-local
   * `managePanelOpen` flag + re-renders; layout (wizard vs edit) is decided by
   * the existing detection + config state.
   */
  onOpenManageTeamPanel?(msg: OpenManageTeamPanelMessage): void;
  /**
   * Called when the incoming message's `type` did not match any known
   * discriminator. Defaults to console.warn if not supplied; tests can override
   * to assert the unknown-type branch is taken.
   */
  onUnknown?(raw: unknown): void;
}

/** Resource handle returned by `initMessageReceiver`. */
export interface MessageReceiverDisposable {
  dispose(): void;
}

/**
 * Tests can run jsdom under `environment: 'jsdom'`. In bare-Node test
 * environments `window` is undefined — guard so importing this module
 * never throws at module-init time.
 */
function getMessageTarget(): EventTarget | undefined {
  if (typeof window !== "undefined") {
    return window;
  }
  return undefined;
}

/**
 * Type-guard for HostMessage. We only check the discriminator + that the
 * object is a non-null object — payload shape is the handler's problem
 * (the type-system gives us the contract; the runtime check is just a
 * structural guard).
 */
function isHostMessage(raw: unknown): raw is HostMessage {
  if (typeof raw !== "object" || raw === null) return false;
  const t = (raw as { type?: unknown }).type;
  return (
    t === "state:full" ||
    t === "state:delta" ||
    t === "roster:loaded" ||
    t === "roster:error" ||
    t === "setup:detection" ||
    t === "setup:characters" ||
    t === "setup:config-saved" ||
    t === "setup:open-manage-team"
  );
}

/**
 * Register the webview-side message receiver. Returns a Disposable that
 * removes the listener — tests / hot-reload scenarios call dispose to avoid
 * stacking handlers on repeat init.
 */
export function initMessageReceiver(
  handlers: HostMessageHandlers,
): MessageReceiverDisposable {
  const target = getMessageTarget();
  if (!target) {
    // No window — running in node without jsdom. Return a no-op disposable.
    return { dispose: () => undefined };
  }

  const listener = (event: Event): void => {
    // VS Code's webview posts MessageEvent with `data` carrying the payload.
    const data = (event as MessageEvent).data;
    if (!isHostMessage(data)) {
      (handlers.onUnknown ?? defaultUnknownHandler)(data);
      return;
    }

    switch (data.type) {
      case "state:full":
        handlers.onStateFull?.(data);
        return;
      case "state:delta":
        handlers.onStateDelta?.(data);
        return;
      case "roster:loaded":
        handlers.onRosterLoaded?.(data);
        return;
      case "roster:error":
        handlers.onRosterError?.(data);
        return;
      case "setup:detection":
        handlers.onSetupDetection?.(data);
        return;
      case "setup:characters":
        handlers.onSetupCharacters?.(data);
        return;
      case "setup:config-saved":
        handlers.onSetupConfigSaved?.(data);
        return;
      case "setup:open-manage-team":
        handlers.onOpenManageTeamPanel?.(data);
        return;
    }
  };

  target.addEventListener("message", listener);
  return {
    dispose: () => target.removeEventListener("message", listener),
  };
}

function defaultUnknownHandler(raw: unknown): void {
  // Soft warning — VS Code internals can post messages we don't recognise.
  // Console output is captured in VS Code's webview devtools.

  console.warn("[claudeteam] unknown message shape:", raw);
}
