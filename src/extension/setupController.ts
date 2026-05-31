/**
 * Setup controller (TS-02 / team-setup epic) — the host-side glue that owns the
 * team-setup data plane: project-config path resolution, detection compute,
 * character-source resolution, the `ui:*` handler logic, and the
 * dismiss-suggestion remember-per-workspace flag.
 *
 * Decoupled from VS Code's `webview` so the handler logic is unit-testable —
 * the controller takes a `post` sink (the three `setup:*` posters from
 * messageBus, pre-bound to the live webview) and a `workspaceState`-shaped
 * memento for the dismiss flag. `main.ts` constructs one per webview resolve.
 *
 * ## What the controller does NOT do
 *
 * It does not own the file-watcher tick loop or the roster matcher — those stay
 * in `watcherLoop.ts`. The team-setup config (`claudeteam.yaml`) feeds the
 * matcher via the SAME `projectRosterPath` the watcher already loads (main.ts
 * points the watcher's `projectRosterPath` at `claudeteam.yaml` post-TS-02).
 * The controller's job is detection + setup mutations + character sources.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  clearClaudeTeamConfig,
  generateStarterConfig,
  readClaudeTeamConfig,
  writeClaudeTeamConfig,
} from "./roster/claudeTeamConfig.js";
import { scanAgentsFolder, resolveAgentsDir } from "./roster/agentScanner.js";
import { detectFromScan } from "./roster/detection.js";
import {
  reconcileOrphans,
  removeMemberById,
} from "./roster/orphanReconcile.js";
import {
  resolveCharacterSources,
  resolveUserCharacterDir,
} from "./characterSources.js";
import { workspaceFolderName } from "../shared/types.js";
import type {
  CharacterSource,
  ClaudeTeamConfig,
  MemberCharacter,
  ScannedAgent,
  SetupDetectionState,
} from "../shared/types.js";

/** Minimal Memento shape (subset of `vscode.Memento`) for the dismiss flag. */
export interface DismissStore {
  get(key: string): boolean | undefined;
  update(key: string, value: boolean): Thenable<void>;
}

/** Sink the controller posts through (pre-bound to the live webview in main.ts). */
export interface SetupPostSink {
  detection(state: SetupDetectionState, scanned: ScannedAgent[]): void;
  characters(sources: CharacterSource[]): void;
  configSaved(ok: boolean, error?: string): void;
}

/** Construction inputs. */
export interface SetupControllerOptions {
  /** First workspace folder fsPath (multi-root = first folder). `undefined` → no project. */
  workspaceFolderPath?: string;
  /** Absolute path to the BUNDLED sprites root (`<extensionUri>/dist/webview/sprites`). */
  bundledSpritesDir: string;
  /** Override the user-character folder (tests). Default `~/.claudeteam/characters/`. */
  userCharacterDir?: string;
  /** The setup:* post sink. */
  post: SetupPostSink;
  /** workspaceState-backed dismiss flag store. */
  dismissStore: DismissStore;
  logger?: { warn: (msg: string) => void; info?: (msg: string) => void };
}

/** workspaceState key for the remember-per-workspace dismiss flag (spec §7.2). */
export const DISMISS_SUGGESTION_KEY = "claudeteam.setupSuggestionDismissed";

export class SetupController {
  private readonly opts: SetupControllerOptions;

  constructor(opts: SetupControllerOptions) {
    this.opts = opts;
  }

  /** Resolve `<firstFolder>/.claude/claudeteam.yaml`, or `undefined` when no folder open. */
  configPath(): string | undefined {
    if (!this.opts.workspaceFolderPath) return undefined;
    return join(this.opts.workspaceFolderPath, ".claude", "claudeteam.yaml");
  }

  /** Scan the agents folder. Empty when no workspace folder is open. */
  scan(): ScannedAgent[] {
    if (!this.opts.workspaceFolderPath) return [];
    return scanAgentsFolder(resolveAgentsDir(this.opts.workspaceFolderPath));
  }

  /** Whether `claudeteam.yaml` exists for this project. */
  configExists(): boolean {
    const p = this.configPath();
    return p !== undefined && existsSync(p);
  }

  /** Compute the current detection state (config present → configured; ≥2 → suggest; else empty). */
  detectionState(scanned: ScannedAgent[] = this.scan()): SetupDetectionState {
    return detectFromScan(this.configExists(), scanned);
  }

  /** Resolve the merged bundled + user character list. */
  characterSources(): CharacterSource[] {
    return resolveCharacterSources({
      bundledSpritesDir: this.opts.bundledSpritesDir,
      userCharacterDir:
        this.opts.userCharacterDir ?? resolveUserCharacterDir(),
      logger: this.opts.logger,
    });
  }

  /**
   * Emit the current `setup:detection` + `setup:characters` to the webview.
   * Called on resolve and after any config mutation so the webview's dashboard
   * root switches correctly. Returns the scanned list for callers that need it.
   */
  emitDetection(): ScannedAgent[] {
    const scanned = this.scan();
    this.opts.post.detection(this.detectionState(scanned), scanned);
    return scanned;
  }

  /** Emit `setup:characters`. */
  emitCharacters(): void {
    this.opts.post.characters(this.characterSources());
  }

  // ---------------------------------------------------------------------------
  // ui:* handlers
  // ---------------------------------------------------------------------------

  /**
   * `ui:run-setup` — generate a starter config from `include` (agentNames), write
   * it, ack, and re-emit detection (now `configured`). Team name seeds from the
   * workspace folder basename.
   */
  runSetup(include: string[]): void {
    const path = this.configPath();
    if (!path) {
      this.opts.post.configSaved(false, "no workspace folder open");
      return;
    }
    const teamName = this.opts.workspaceFolderPath
      ? workspaceFolderName(this.opts.workspaceFolderPath) || "My Team"
      : "My Team";
    // 86ca1nvae: build agentName → auto-derived-role lookup from the scan so
    // generated members seed a non-blank role from the `.md` `description`.
    const roles = new Map<string, string>();
    for (const a of this.scan()) {
      if (a.role !== undefined && a.role.length > 0) roles.set(a.agentName, a.role);
    }
    const config = generateStarterConfig(include, teamName, roles);
    const res = writeClaudeTeamConfig(path, config);
    this.opts.post.configSaved(res.ok, res.ok ? undefined : res.error);
    if (res.ok) this.emitDetection();
  }

  /** `ui:save-team` — structured normalized write of the full edited config + ack. */
  saveTeam(config: ClaudeTeamConfig): void {
    const path = this.configPath();
    if (!path) {
      this.opts.post.configSaved(false, "no workspace folder open");
      return;
    }
    const res = writeClaudeTeamConfig(path, config);
    this.opts.post.configSaved(res.ok, res.ok ? undefined : res.error);
    if (res.ok) this.emitDetection();
  }

  /**
   * `ui:assign-character` — read current config, set the member's `character`,
   * re-write, ack. No-op-with-error if no config or member not found.
   */
  assignCharacter(memberId: string, character: MemberCharacter): void {
    const path = this.configPath();
    if (!path) {
      this.opts.post.configSaved(false, "no workspace folder open");
      return;
    }
    const read = readClaudeTeamConfig(path);
    if (!read.ok) {
      this.opts.post.configSaved(false, read.error);
      return;
    }
    let found = false;
    const config: ClaudeTeamConfig = {
      ...read.config,
      teams: read.config.teams.map((team) => ({
        ...team,
        members: team.members.map((m) => {
          if (!found && m.id === memberId) {
            found = true;
            return { ...m, character };
          }
          return m;
        }),
      })),
    };
    if (!found) {
      this.opts.post.configSaved(false, `member "${memberId}" not found`);
      return;
    }
    const res = writeClaudeTeamConfig(path, config);
    this.opts.post.configSaved(res.ok, res.ok ? undefined : res.error);
    if (res.ok) this.emitDetection();
  }

  /**
   * `ui:confirm-orphan-delete` — remove the (orphaned) member from the config,
   * re-write, ack, re-emit detection. The ONLY member-delete path (Decision 3).
   */
  confirmOrphanDelete(memberId: string): void {
    const path = this.configPath();
    if (!path) {
      this.opts.post.configSaved(false, "no workspace folder open");
      return;
    }
    const read = readClaudeTeamConfig(path);
    if (!read.ok) {
      this.opts.post.configSaved(false, read.error);
      return;
    }
    const { config, removed } = removeMemberById(read.config, memberId);
    if (!removed) {
      this.opts.post.configSaved(false, `member "${memberId}" not found`);
      return;
    }
    const res = writeClaudeTeamConfig(path, config);
    this.opts.post.configSaved(res.ok, res.ok ? undefined : res.error);
    if (res.ok) this.emitDetection();
  }

  /**
   * `ui:reset-team` (86ca1u0rw) — remove `claudeteam.yaml`, ack, and re-emit
   * detection (now `empty` / `suggest-setup` instead of `configured`). The
   * destructive confirm is webview-local (the panel's inline confirm); the host
   * only runs this AFTER the user confirmed.
   *
   * Idempotent: an already-absent config is a success (the post-condition "no
   * config exists" holds). On a real filesystem failure the ack carries
   * `ok: false` + the error and detection is NOT re-emitted (nothing changed).
   *
   * After the ok ack, `main.ts`'s handler forces a watcher tick so the empty
   * `roster:loaded` + cleared `state:full` land — the panel transitions to the
   * wizard layout (`manageConfig` → null) and the dashboard reflects the cleared
   * roster on the next tick.
   */
  resetTeam(): void {
    const path = this.configPath();
    if (!path) {
      this.opts.post.configSaved(false, "no workspace folder open");
      return;
    }
    const res = clearClaudeTeamConfig(path);
    this.opts.post.configSaved(res.ok, res.ok ? undefined : res.error);
    if (res.ok) this.emitDetection();
  }

  /**
   * Drift reconcile: given the current present-agent-name set, flip member
   * statuses (live↔orphaned) in the on-disk config and write IF changed. Called
   * by the agent-watcher's removed/added signal. NEVER adds members (new agents
   * are a nudge, not an auto-mutation — Decision 3); only flips status.
   * Re-emits detection afterward so the webview re-renders orphan treatment.
   */
  reconcileDrift(presentAgentNames: ReadonlySet<string>): void {
    const path = this.configPath();
    if (!path || !this.configExists()) {
      // No config yet → nothing to orphan; just re-emit detection (the scan
      // changed, so the suggest/empty count may have shifted).
      this.emitDetection();
      return;
    }
    const read = readClaudeTeamConfig(path);
    if (!read.ok) {
      // Malformed config — surface nothing destructive; re-emit detection only.
      this.emitDetection();
      return;
    }
    const { config, changed } = reconcileOrphans(read.config, presentAgentNames);
    if (changed) {
      const res = writeClaudeTeamConfig(path, config);
      if (!res.ok) {
        this.opts.logger?.warn(
          `[setupController] orphan reconcile write failed: ${res.error}`,
        );
      }
    }
    this.emitDetection();
  }

  // ---------------------------------------------------------------------------
  // Dismiss-suggestion remember-per-workspace (spec §7.2)
  // ---------------------------------------------------------------------------

  /** `ui:dismiss-setup-suggestion` — persist the per-workspace dismiss flag. */
  dismissSuggestion(): void {
    void this.opts.dismissStore.update(DISMISS_SUGGESTION_KEY, true);
  }

  /** Whether the suggestion was dismissed for this workspace. */
  isSuggestionDismissed(): boolean {
    return this.opts.dismissStore.get(DISMISS_SUGGESTION_KEY) === true;
  }
}
