/**
 * TS-04 (team-setup QA) — cross-cutting integration tests that the TS-02/TS-03
 * impl tests do NOT cover: the END-TO-END seam from a generated `claudeteam.yaml`
 * through the PRODUCTION matcher feed (`loadRoster` → `parseFile` → matcher).
 *
 * Why this file exists (the gap):
 *   - `teamSetupHost.test.ts` / `teamSetupFs.test.ts` stop at gen → write → read
 *     via `readClaudeTeamConfig` (the panel/controller schema, `claudeTeamConfigSchema`).
 *   - `matcher.test.ts` matches against HAND-BUILT rosters, never a generated config.
 *   - NOBODY tests that a config produced by `generateStarterConfig` actually feeds
 *     the matcher through the SAME path `main.ts` wires up:
 *         main.ts:206  projectRosterPath = <folder>/.claude/claudeteam.yaml
 *         main.ts:217  startWatcher({ projectRosterPath })
 *         watcherLoop  loadRoster(undefined, projectRosterPath)  ← MATCHER FEED
 *     `loadRoster` validates with `rosterFileSchema` (the LEGACY schema), NOT
 *     `claudeTeamConfigSchema`. The two schemas DIVERGE — and that divergence is
 *     a SHIPPED DEFECT (see DEFECT block below).
 *
 * AC8 non-vacuity: each routing assertion is paired with a negative (a wrong
 * agentType / engine-type does NOT match), so a matcher that returns a constant
 * fails.
 *
 * =========================================================================
 * DEFECT — "freshly set-up team renders zero tiles" (found by TS-04 QA)
 * =========================================================================
 * `generateStarterConfig` seeds `role: ""` for every member — the documented
 * lean-OPTIONAL default (spec §7.3; `claudeTeamConfigSchema` makes role optional).
 * But the PRODUCTION matcher feed validates with `rosterFileSchema`, whose
 * `memberSchema` still requires `role: z.string().min(1)` (schema.ts:58). On a
 * validation failure `parseFile` (loader.ts:126-134) pushes errors and returns
 * `teams: null` — i.e. it drops the ENTIRE file. Observed error verbatim from
 * this test run:
 *     "project roster schema error at teams.0.members.0.role:
 *      Too small: expected string to have >=1 characters"
 *
 * Product impact: a user who runs setup and does NOT type a role for some member
 * (the default the wizard ships) gets ZERO tiles — the matcher feed sees an empty
 * roster. This is the exact failure the epic exists to prevent (scan → generate →
 * see your team). Isolated cause: a config whose members all have NON-EMPTY roles
 * loads + routes correctly (matcher + gen logic are fine) — only the empty-role
 * default trips the legacy schema. Filed as a TS-02 follow-up; the fix is to make
 * the matcher feed tolerate the new `claudeteam.yaml` role-optional shape (e.g.
 * route `claudeteam.yaml` through `claudeTeamConfigSchema`, or relax
 * `rosterFileSchema`'s role to optional, reconciling the two schemas).
 *
 * The two assertions below capture the DESIRED behavior with `it.fails` so this
 * QA PR stays green while the assertions are RED-READY: when TS-02's fix lands,
 * flip `it.fails` → `it` and they pass. The companion `it` test documents the
 * CURRENT (defective) observed behavior so the regression is pinned either way.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  generateStarterConfig,
  writeClaudeTeamConfig,
} from "../../src/extension/roster/claudeTeamConfig.js";
import { loadRoster } from "../../src/extension/roster/loader.js";
import { matchAgent } from "../../src/extension/roster/matcher.js";
import type { AgentMeta, ClaudeTeamConfig } from "../../src/shared/types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ct-ts04-res-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Generate + write a starter claudeteam.yaml, optionally mutating it, then load
 *  through the PRODUCTION matcher feed (`loadRoster`, project-only — global
 *  undefined, mirroring main.ts:561). Returns the RosterLoadResult. */
function writeAndLoad(
  included: string[],
  mutate?: (cfg: ClaudeTeamConfig) => void,
  teamName = "Demo",
) {
  const cfg = generateStarterConfig(included, teamName);
  mutate?.(cfg);
  const path = join(root, ".claude", "claudeteam.yaml");
  const w = writeClaudeTeamConfig(path, cfg);
  expect(w.ok).toBe(true);
  expect(existsSync(path)).toBe(true);
  return loadRoster(undefined, path);
}

/** Fill every member's role so the config clears the legacy role.min(1) gate —
 *  isolates the matcher routing assertions from the empty-role DEFECT. */
function fillRoles(cfg: ClaudeTeamConfig): void {
  for (const team of cfg.teams) {
    for (const m of team.members) m.role = `${m.id} role`;
  }
}

// v2.1.119 old-schema meta (agentType = persona slug, no toolUseId).
function metaV119(agentType: string): AgentMeta {
  return {
    schemaVersion: "v2.1.119",
    agentType,
    name: undefined,
    description: `${agentType} old-schema spawn`,
    toolUseId: null,
  };
}

// v2.1.145 persona-named meta (agentType = persona slug, toolUseId present).
function metaV145Persona(agentType: string): AgentMeta {
  return {
    schemaVersion: "v2.1.145-persona",
    agentType,
    name: null,
    description: `${agentType} new-persona spawn`,
    toolUseId: "toolu_persona",
  };
}

// ---------------------------------------------------------------------------
// DEFECT pin — current (defective) observed behavior + red-ready desired
// ---------------------------------------------------------------------------

describe("DEFECT: empty-role generated config dropped by matcher feed", () => {
  it("DOCUMENTS CURRENT BEHAVIOR: empty-role members are rejected → empty roster", () => {
    // This asserts the DEFECTIVE state shipped on main so the regression is
    // pinned. Observed error text is quoted in the DEFECT block above. When the
    // TS-02 fix lands, this test SHOULD start failing (roster becomes non-empty)
    // — that is the signal to delete this pin and promote the it.fails below.
    const { roster, errors } = writeAndLoad(["felix", "maya"]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("role"))).toBe(true);
    expect(roster).toEqual([]); // ENTIRE file dropped — zero tiles
  });

  it.fails(
    "DESIRED (red-ready): a generated empty-role config loads clean with both members",
    () => {
      const { roster, errors } = writeAndLoad(["felix", "maya"]);
      expect(errors).toEqual([]);
      expect(roster).toHaveLength(1);
      expect(roster[0]!.members.map((m) => m.id)).toEqual(["felix", "maya"]);
    },
  );

  it.fails(
    "DESIRED (red-ready): seeded agentType_equals routes a live agent from an empty-role config",
    () => {
      const { roster } = writeAndLoad(["felix", "maya"]);
      expect(matchAgent(metaV119("felix"), roster)).toEqual({
        teamId: roster[0]!.id,
        memberId: "felix",
      });
    },
  );
});

// ---------------------------------------------------------------------------
// AC5 — gen → matcher routing (roles filled to isolate from the DEFECT)
// ---------------------------------------------------------------------------

describe("generated claudeteam.yaml → matcher routing (TS-04 AC5)", () => {
  it("loads through the production feed without errors when roles are non-empty", () => {
    const { roster, errors } = writeAndLoad(["felix", "maya"], fillRoles);
    expect(errors).toEqual([]);
    expect(roster).toHaveLength(1);
    expect(roster[0]!.members.map((m) => m.id)).toEqual(["felix", "maya"]);
  });

  it("seeded agentType_equals routes a v2.1.119 live agent to the right member", () => {
    const { roster } = writeAndLoad(["felix", "maya"], fillRoles);
    const team = roster[0]!;
    expect(matchAgent(metaV119("felix"), roster)).toEqual({
      teamId: team.id,
      memberId: "felix",
    });
    expect(matchAgent(metaV119("maya"), roster)).toEqual({
      teamId: team.id,
      memberId: "maya",
    });
  });

  it("seeded agentType_equals routes a v2.1.145 persona-named live agent", () => {
    const { roster } = writeAndLoad(["felix", "maya"], fillRoles);
    const team = roster[0]!;
    expect(matchAgent(metaV145Persona("felix"), roster)).toEqual({
      teamId: team.id,
      memberId: "felix",
    });
    expect(matchAgent(metaV145Persona("maya"), roster)).toEqual({
      teamId: team.id,
      memberId: "maya",
    });
  });

  it("NON-VACUOUS: an unrostered persona slug + a general-purpose engine type are background (null)", () => {
    const { roster } = writeAndLoad(["felix", "maya"], fillRoles);
    // A persona slug not in the generated roster → no match.
    expect(matchAgent(metaV119("bram"), roster)).toBeNull();
    // The dominant background case: nameless general-purpose engine agent.
    expect(
      matchAgent(
        {
          schemaVersion: "v2.1.145-general",
          agentType: "general-purpose",
          name: null,
          description: "background work",
          toolUseId: "toolu_bg",
        },
        roster,
      ),
    ).toBeNull();
  });

  it("DROP-global behavioral proof: matcher feed uses ONLY the project path (global undefined)", () => {
    // writeAndLoad passes global=undefined (mirrors main.ts:561). The roster is
    // non-empty + correct purely from the project claudeteam.yaml — no global
    // ~/.claudeteam/teams.yaml exists or is consulted (none is ever written).
    const { roster, errors } = writeAndLoad(["felix", "maya"], fillRoles);
    expect(errors).toEqual([]);
    expect(roster).toHaveLength(1);
  });
});
