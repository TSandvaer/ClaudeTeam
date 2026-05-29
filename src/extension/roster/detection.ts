/**
 * Setup-detection trichotomy (TS-02 / team-setup epic, Decision 2 / spec §2).
 *
 * Computes the {@link SetupDetectionState} the dashboard switches its whole
 * root on. Precedence (LOCKED — restated from the backlog + spec §2):
 *
 *   config present (claudeteam.yaml exists)  → "configured"
 *   else ≥2 scanned agents                   → "suggest-setup"
 *   else (<2 agents)                          → "empty"
 *
 * Pure function over (configExists, scannedCount) — no filesystem inside; the
 * caller supplies both signals (the host reads them once per detection pass via
 * `existsSync(configPath)` + `scanAgentsFolder(...).length`). Pure + cheap so
 * the watcher can recompute every tick without I/O ceremony in this module.
 */

import type { ScannedAgent, SetupDetectionState } from "../../shared/types.js";

/**
 * The agent-count threshold at/above which an unconfigured project is worth
 * suggesting setup for. <2 agents has nothing meaningful to roster (spec §2.3),
 * so it renders the quiet empty-state instead of nagging a setup CTA.
 *
 * Behind a named constant (not an inline `2`) so the threshold is greppable and
 * a future ratify call can flip it in one place.
 */
export const SUGGEST_SETUP_MIN_AGENTS = 2 as const;

/**
 * Compute the detection state from the two host-supplied signals.
 *
 * @param configExists  whether `<workspace>/.claude/claudeteam.yaml` is present.
 * @param scannedCount  number of persona agents found by `scanAgentsFolder`.
 */
export function computeDetectionState(
  configExists: boolean,
  scannedCount: number,
): SetupDetectionState {
  if (configExists) return "configured";
  if (scannedCount >= SUGGEST_SETUP_MIN_AGENTS) return "suggest-setup";
  return "empty";
}

/**
 * Convenience: compute the state directly from the scanned-agents array. Thin
 * wrapper over {@link computeDetectionState} — used by the host emit path so
 * the call site reads naturally (`detectFromScan(configExists, scanned)`).
 */
export function detectFromScan(
  configExists: boolean,
  scanned: ScannedAgent[],
): SetupDetectionState {
  return computeDetectionState(configExists, scanned.length);
}
