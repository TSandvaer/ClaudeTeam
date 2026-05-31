# Roster Matching

The roster is sponsor-curated. It draws the line between "my team" (rostered → named tiles) and "background noise" (unrostered → counted, not named).

## Roster YAML schema

```yaml
# teams.yaml — sponsor-curated team roster
teams:
  - id: claudeteam-alpha          # stable internal id (kebab-case)
    name: "ClaudeTeam Alpha"      # display name shown on the team card
    description: "Production extension build team"   # optional
    members:
      - id: felix                 # stable internal id
        display: "Felix"          # name shown on the tile
        role: "Extension Host Dev"
        color: "#5d8aa8"          # optional; paints the running-state dot
        match:
          - name_prefix: "felix-"           # new schema (v2.1.145+)
          - agentType_equals: "felix"       # old schema (v2.1.119)
      - id: maya
        display: "Maya"
        role: "Webview UI Dev"
        color: "#9caf88"
        match:
          - name_prefix: "maya-"
          - agentType_equals: "maya"
```

### `member.color` validation and theme-contrast (spec 86c9zmyef §2.5 / §2.6)

The `color` field personalizes the **running-state dot** on the dashboard so each rostered persona is identifiable at a glance. Idle / finished / error dots IGNORE the field and retain the semantic state colors (M4-01 §2.2). The roster loader (`src/extension/roster/loader.ts`) validates and normalizes each value:

| Raw value | Loader behavior | Tile result |
|---|---|---|
| Field absent | `Member.color = undefined`; no warning | Running dot paints default `--ct-color-state-running` |
| `"#5d8aa8"` (6-digit hex with `#`) | Lowercased pass-through | Dot paints in `#5d8aa8` |
| `"#5DA"` / `"#5da"` (3-digit hex) | Expanded to 6-digit lowercase (`"#55ddaa"`) | Dot paints in expanded form |
| `"reddish"`, `"rgb(0,0,0)"`, `"5d8aa8"` (no `#`), 8-digit hex | Dropped to `undefined` + warning on `RosterLoadResult.warnings` | Running dot paints default (warning chip surfaces the typo) |

No auto-generation when `color` is absent — sponsors opt in by setting the field (per spec §2.3 Option A). V1 is sponsor-curated only.

**Theme-contrast suggestion (not enforced):** pick a color that contrasts with both light and dark editor backgrounds. Material palette mid-saturation values (e.g. `#5d8aa8`, `#9caf88`, `#cd853f`) typically pass; pure black (`#000000`) or pure white (`#ffffff`) fail one theme. The webview's pulse halo continues to render in the semantic `--ct-color-state-running` token so a hard-to-see member color still has a baseline contrast cue.

## Match rule types

Each rule in `match:` is an object with exactly one key:

| Key | Meaning | Example |
|---|---|---|
| `name_prefix` | meta.json `name` field starts with this string (case-sensitive) | `"felix-"` |
| `name_equals` | meta.json `name` field equals this exact string | `"felix"` |
| `agentType_equals` | meta.json `agentType` field equals this exact string | `"felix"` |
| `description_contains` | meta.json `description` contains this substring (case-insensitive) | `"Felix review"` |

Future rule types can be added (e.g. `subagent_type_regex`); keep the matcher extensible.

## Resolution order

For every live agent's `meta.json`:

1. Walk each team's `members` in declaration order.
2. For each member, walk its `match` rules in declaration order.
3. **First match wins.** Tag the agent with that team + member.
4. If no rule matches across all teams → bucket as `background`. The agent is counted in the per-session noise chip; its `description` is shown in the expanded view but no tile is rendered for it.

The order matters: put more-specific rules first. `name_prefix: "felix-pr"` should appear before `name_prefix: "felix-"` if both are defined, because the matcher stops at the first hit.

## Config locations

V1 supports two locations (project overrides global):

1. **Global:** `~/.claudeteam/teams.yaml` (Windows: `C:\Users\<user>\.claudeteam\teams.yaml`)
2. **Per-project:** `<project-root>/.claude/teams.yaml` — applies only when the live agent's session has `cwd == project-root`.

**Watcher implementation note:** monitoring `~/.claudeteam/teams.yaml` requires `createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(rosterDir), '*.yaml'))` — plain-string globs do not fire for paths outside `workspace.workspaceFolders`. Use `*.yaml` glob (not literal `teams.yaml` — VS Code bug #164925) and filter by filename in the callback. Full caveats + polling fallback in `vscode-extension-conventions.md` § "Open questions (decide during M2)" filesystem-watcher entry. (Verified PR #32, merge `7d14976`.)

The matcher loads both, merges (project takes precedence per `id` collision), and rebuilds the match table whenever either file changes (file-watcher both paths).

### Recommended default: per-project

Prefer per-project (`<project-root>/.claude/teams.yaml`) for any roster whose persona names might collide with sibling projects' personas. Global (`~/.claudeteam/teams.yaml`) is the right fit only when the persona genuinely should match across ALL workspaces regardless of cwd — rare in practice.

**Why:** matchers are project-blind by design (first-match-wins, no fuzzy/scoped rules — see "What the matcher does NOT do" below). A global rule like `agentType_equals: "devon"` matches every Devon-named agent anywhere on disk — including Devons in sibling projects that happen to share the name. Validated during V1 dogfood 2026-05-25: a global `embergrave-randomgame` team with a `devon` member surfaced MARIAN-TUTOR's Devon dispatches under the Embergrave team card (Devon exists in both rosters). Per-project rosters are cwd-scoped, so the collision cannot occur — MARIAN-TUTOR's session does not load Embergrave's roster even though both projects ship a Devon persona. See ClickUp `86c9yteju` § Observation 4 for full context.

**Operational pattern:** keep `~/.claudeteam/teams.yaml` empty (`teams: []` + a comment explaining the policy); drop a `.claude/teams.yaml` into each project root. Sponsor edits the per-project YAML as they would any other project artifact, and the cwd-scoping prevents false-attribution by construction.

**Open follow-up:** package.json's `claudeteam.rosterPath` description currently reads "uses the default global location (~/.claudeteam/teams.yaml) with per-project fallback" — that ordering primes users toward the failure mode. Triage open under ticket `86c9yteju` for Bram/Felix to flip the framing (or add a `cwd_prefix` match rule to make global rosters project-scopable without migrating).

## `claudeteam.yaml` (TS-02) reads through TWO divergent schemas — keep them in sync

TS-02 (team-setup epic) introduced the project-scoped `<workspace>/.claude/claudeteam.yaml`, which SUPERSEDES the dropped global `~/.claudeteam/teams.yaml`. The non-obvious trap: **the same file is validated by two different Zod schemas on two different read-paths**, and they diverge:

| Read-path | Schema | `role` rule |
|---|---|---|
| **Matcher feed** — `loadRoster` → `parseFile` (`loader.ts:125`), wired via `main.ts:206` `projectRosterPath` → `watcherLoop.ts:561` | `rosterFileSchema` → `memberSchema` (`schema.ts:58`) | `role: z.string().min(1)` — **required, non-empty** |
| **Panel read-path** — `readClaudeTeamConfig` (`claudeTeamConfig.ts`) | `claudeTeamConfigSchema` → `claudeTeamMemberSchema` (`schema.ts:117`) | `role: z.string().default("")` — **optional** |

Two hard consequences:

1. **A field that validates on one path can be rejected on the other.** A `claudeteam.yaml` the panel happily writes + reads back (e.g. `role: ""`) is *rejected* by the matcher feed. **Rule: any change to the `claudeteam.yaml` shape must update BOTH schemas (`schema.ts`), or the divergence silently breaks one path.** The comment at `schema.ts:96-101` flags the divergence as intentional-but-fragile.

2. **`parseFile` drops the ENTIRE file on any validation failure, not just the bad member.** On a failed `safeParse` it pushes errors and returns with no `teams` (`loader.ts:126-134`); `loadRoster` then returns `roster: []`. So one invalid member → the whole team renders zero tiles, with the error only surfaced as a logged warning / dashboard error chip — easy to mistake for "no agents matched."

**Shipped instance (defect `86ca1p51e`):** the setup wizard's default `role: ""` was accepted by `claudeTeamConfigSchema` but rejected by the matcher's `rosterFileSchema.min(1)` → a freshly set-up team rendered zero tiles. Caught by TS-04 QA (`tests/integration/teamSetupResolution.test.ts`, which is the only test that drives a *generated* config through the *production* matcher feed — the TS-02 impl tests stop at the panel schema). The fix reconciles the two schemas (route `claudeteam.yaml` through `claudeTeamConfigSchema` for the matcher, or relax `rosterFileSchema`'s role). Lesson outlives the fix: **when one file feeds two consumers, test the end-to-end seam through each consumer's real validation, not just the writer's.**

## Why this shape

- **Stable ids** (`team.id`, `member.id`) decouple display from identity, so renaming Felix → Frank doesn't break a UI session.
- **Match rules as a list, not a function**, because the sponsor edits YAML, not TypeScript. Keep the rule vocabulary small and verifiable.
- **Per-team grouping**, not flat list of agents, because the V1 dashboard's primary card is a **team**. An agent always belongs to exactly one team (per `id`).
- **First-match-wins, not score-based**, because predictability beats cleverness. The sponsor should be able to reason about why an agent landed where it did by reading the YAML top-down.

## What the matcher does NOT do

- **No fuzzy matching.** Either a rule hits exactly or it doesn't. If the spawn used `name: "felix_pr310"` instead of `felix-pr310`, that's a sponsor error (or a roster gap), not the matcher's job to forgive.
- **No persona auto-discovery.** The matcher does not infer roster entries from agent `.md` files. The roster is curated, not generated.
- **No retroactive re-matching.** If the sponsor edits the roster, only spawns observed AFTER the edit are matched against the new rules. Historical state stays as-it-was when recorded.

## Background-noise display

Unmatched agents collapse to a per-session chip:

```
+ 3 background agents (this session)
   • Explore "Map MARIAN-TUTOR orchestration" (Sonnet, running)
   • general-purpose "Agent A — data sources" (Sonnet, running)
   • general-purpose "Agent B — limitations" (Sonnet, finished)
```

The count is always visible. The detail list is collapsed by default and expanded on click. Background agents are NOT hidden — that defeats the purpose of an accurate overview.

## Loader edge cases

- **Empty roster** — show no team cards, only the "background agents" panel (still useful).
- **Malformed YAML** — show an error chip in the dashboard with the parser error; do not crash. Fall back to "empty roster" behavior.
- **Member with no `match` rules** — log a warning and skip that member. Don't crash the whole roster.
- **Same `id` in two teams** — the second one wins by load order, and a warning is logged. The dashboard surfaces the warning.
