/**
 * Orphan reconcile + member-delete (TS-02 / team-setup epic, Decision 3 /
 * spec §6.1).
 *
 * When an agent's `.claude/agents/<name>.md` file is REMOVED but a member with
 * a matching `agentType_equals` seed still exists in `claudeteam.yaml`, the host
 * flips that member's `status` to `"orphaned"` (KEPT, not auto-deleted — the
 * sponsor must see the loss and decide). When the file RETURNS, the member
 * flips back to `"live"`. The webview greys orphaned tiles + offers an explicit
 * `ui:confirm-orphan-delete`.
 *
 * This module is PURE — no filesystem. The watcher (`agentWatcher.ts`) supplies
 * the current scanned-agent name set; these helpers compute the reconciled
 * config + perform the confirmed delete. The host then writes the result.
 *
 * ## How a member maps to an agent file
 *
 * A member's backing agent name is the value of its FIRST `agentType_equals`
 * match rule (the immutable seed — Decision 4). A member with no
 * `agentType_equals` rule has no backing agent file (e.g. a hand-authored
 * `name_prefix`-only member) and is NEVER orphaned by drift — it stays as-is.
 * {@link memberBackingAgent} resolves this.
 */

import type { ClaudeTeamConfig, Member } from "../../shared/types.js";

/**
 * The agent name a member is backed by, for orphan purposes: the value of its
 * first `agentType_equals` match rule, or `null` when the member has none.
 * Pure / cheap. Exported for unit coverage.
 */
export function memberBackingAgent(member: Member): string | null {
  for (const rule of member.match) {
    if ("agentType_equals" in rule) {
      return rule.agentType_equals;
    }
  }
  return null;
}

/**
 * Reconcile a config against the set of currently-present agent names.
 *
 * For each member with an `agentType_equals` backing agent:
 *   - backing agent ABSENT from `presentAgentNames` → flip to `"orphaned"`.
 *   - backing agent PRESENT                          → flip to `"live"`
 *     (revives a previously-orphaned member whose file returned).
 * Members with no backing agent are left untouched.
 *
 * Returns the (possibly) updated config PLUS a `changed` flag (true iff any
 * member's status flipped) so the caller can skip a no-op write. The returned
 * config is a NEW object when changed (members are not mutated in place);
 * when unchanged, the SAME reference is returned (cheap identity check).
 *
 * Pure function. Exported for unit coverage.
 */
export function reconcileOrphans(
  config: ClaudeTeamConfig,
  presentAgentNames: ReadonlySet<string>,
): { config: ClaudeTeamConfig; changed: boolean } {
  let changed = false;
  const teams = config.teams.map((team) => ({
    ...team,
    members: team.members.map((member) => {
      const backing = memberBackingAgent(member);
      if (backing === null) return member; // no agent file → never drift-orphaned
      const desired = presentAgentNames.has(backing) ? "live" : "orphaned";
      const current = member.status ?? "live";
      if (current === desired) return member;
      changed = true;
      return { ...member, status: desired as Member["status"] };
    }),
  }));
  if (!changed) return { config, changed: false };
  return { config: { ...config, teams }, changed: true };
}

/**
 * Remove a member by id from the config (the confirmed orphan-delete path —
 * spec §6.1, `ui:confirm-orphan-delete`). Removes the FIRST member matching
 * `memberId` across all teams. Returns the updated config + a `removed` flag
 * (false when no member matched — the caller can ack accordingly).
 *
 * Pure function. Exported for unit coverage. (This is the ONLY member-delete
 * path — orphaned members are kept until this explicit confirm; Decision 3.)
 */
export function removeMemberById(
  config: ClaudeTeamConfig,
  memberId: string,
): { config: ClaudeTeamConfig; removed: boolean } {
  let removed = false;
  const teams = config.teams.map((team) => {
    const filtered = team.members.filter((m) => {
      if (!removed && m.id === memberId) {
        removed = true;
        return false;
      }
      return true;
    });
    return removed && filtered.length !== team.members.length
      ? { ...team, members: filtered }
      : team;
  });
  if (!removed) return { config, removed: false };
  return { config: { ...config, teams }, removed: true };
}
