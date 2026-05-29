## Visual summary

When N>1 rostered tiles share the same matched-roster persona name (e.g. four Felix dispatches in one session), the webview now collapses them into a single header row that reads `Felix ×4` with an expand chevron. Click to reveal the per-dispatch tiles unchanged; click again to collapse. N=1 stays as the existing bare-tile shape — zero visible change for the default case.

```
TEAM ClaudeTeam Alpha                                  (2 rostered)
  ▶ Felix ×4
  ● Maya  Webview UI Dev
         idle 14s
         claude-opus-4-7
```

Expanded:

```
TEAM ClaudeTeam Alpha                                  (2 rostered)
  ▼ Felix ×4
      ● Felix  Extension Host Dev
             tool:Edit src/extension/main.ts
             claude-opus-4-7
      ● Felix  Extension Host Dev
             finished 12s
             claude-opus-4-7
      ● Felix  Extension Host Dev
             idle 47s
             claude-opus-4-7
      ● Felix  Extension Host Dev
             tool:Read src/shared/types.ts
             claude-opus-4-7
  ● Maya  Webview UI Dev
         idle 14s
         claude-opus-4-7
```

## Scope

ClickUp **86c9ydug9** (M3-10 persona-tile-collapse). Webview-side ACs only — Felix owns the host-side reducer that produces the wrapper objects (parallel PR). This PR ALSO absorbs ClickUp **86c9ydz4k** (`formatFreshness` rollover NIT — `formatFreshness(59_999)` was returning `"60s"` instead of `"59s"`) per orchestrator's auto-decide rule 6.6 #6 — same persona, mechanical scope, one PR.

## Acceptance criteria — Maya's lane

- **AC2 (collapsed render)** — `renderCollapsedPersonaTile` emits a `<section class="collapsed-persona">` with a `<button class="collapsed-persona-header">`, chevron `▶`, persona name `<personaName> ×<count>`, and a hidden `<div class="collapsed-persona-instances">`. Click toggles `aria-expanded`, flips the chevron to `▼`, populates the container with one `renderAgentTile` per `group.instances` entry, and toggles `hidden`. Lazy-populates on first expand; second-and-subsequent expand cycles reuse the existing children so per-tile state (focus, hover) survives. Verified by `tests/unit/webview/collapsedPersonaTile.test.ts` § AC2 collapsed render (7 cases).
- **AC3 (N=1 back-compat)** — `renderTeamCard` routes per entry via the `isCollapsedPersonaGroup` type guard; bare `AgentTile` entries (the only shape pre-M3-10 and the N=1 shape post-M3-10) go straight to `renderAgentTile` with no wrapper in the DOM. Verified by `tests/unit/webview/collapsedPersonaTile.test.ts` § wrapper / bare-tile routing (4 cases) AND every pre-existing dashboardTile.test.ts test continues to pass unchanged.
- **AC7 (webview tests)** — New file `tests/unit/webview/collapsedPersonaTile.test.ts` (21 cases). Covers the type guard, collapsed render, expand interaction, mixed bare+wrapper routing, integration via `renderFull`, wire round-trip through `serializeState` + JSON + `hydrateState`, and the finishedTracker interaction inside an expanded wrapper.
- **AC8 (Self-Test Report)** — see the PR-comment Self-Test Report below for the AC walkthrough + sub-agent GUI-gap reframe for the interactive-screenshot rows.

### NIT 86c9ydz4k absorbed

`src/webview/freshness.ts:58-67` — clamps the seconds bucket at 59 so `formatFreshness(59_999)` reads `"59s"` (not the misleading `"60s"` that visually collides with the next bucket's `"1m"`). Fix preserves half-up rounding for sub-clamp values (500ms still rounds to 1s). Tests at `tests/unit/webview/freshness.test.ts:50-77` lock the boundary at 59_999 / 60_000 / 3_599_999 / 3_600_000 / 7_199_999 / 7_200_000 ms.

## State-shape contract (alignment with Felix's host PR)

Per the dispatch brief — when N>1 rostered tiles share a matched-roster persona name, the host reducer emits `{kind: "collapsed-persona", personaName: string, count: number, instances: AgentTile[]}` in the `rosterTiles[teamId]` slot. N=1 stays as a bare `AgentTile`. Types live in `src/shared/types.ts`:

- `CollapsedPersonaGroup` — the wrapper. Discriminator is `kind: "collapsed-persona"`.
- `RosterTileEntry = AgentTile | CollapsedPersonaGroup` — the per-entry union.
- `WebviewSessionTree` / `WebviewAgentTree` — the post-hydration shapes the webview renderer accepts. Mirror image of `SessionTree` / `AgentTree` with `rosterTiles` widened to `Map<string, RosterTileEntry[]>`.
- `SerializedSessionTree.rosterTiles: Record<string, RosterTileEntry[]>` — wire shape (`src/shared/messages.ts`); flattened from Map per the JSON-serialization constraint.

The host-side `SessionTree.rosterTiles` value type stays `Map<string, AgentTile[]>` (bare tiles only) until Felix's parallel reducer PR widens it; until then, wrappers originate only in his reducer output and arrive verbatim through the wire. Once Felix's PR merges, the cleanest convergence is to unify `AgentTree.sessions[].rosterTiles` to `RosterTileEntry[]` and drop `WebviewSessionTree` / `WebviewAgentTree` entirely (filed as a follow-up; not in this PR's scope).

## Files in play

**Owned by Maya (this PR):**

- `src/webview/components/collapsedPersonaTile.ts` (new, 167 lines) — wrapper renderer + `isCollapsedPersonaGroup` type guard.
- `src/webview/components/teamCard.ts` — route per entry via the guard; wrapper count semantics ("Felix ×4 = 1 header tile" in the team-count).
- `src/webview/components/sessionBlock.ts` — widen `SessionBlockProps.session` to accept either `SessionTree` or `WebviewSessionTree`.
- `src/webview/render.ts` — widen `renderFull`'s state parameter (`RenderableState = AgentTree | WebviewAgentTree`); descend into wrapper instances in the finished-tracker prune pass so finished tiles inside a collapsed wrapper don't lose their first-seen anchor.
- `src/webview/main.ts` — `hydrateState` widens the in-memory shape to `WebviewAgentTree` (already in place from earlier WIP).
- `src/webview/freshness.ts` — NIT 86c9ydz4k clamp fix.
- `src/webview/styles/dashboard.css` — `.collapsed-persona`, `.collapsed-persona-header`, `.collapsed-persona-chevron`, `.collapsed-persona-name`, `.collapsed-persona-instances` (theme variables only; `--vscode-list-hoverBackground` / `--vscode-focusBorder` for affordance parity with `.agent-tile`).
- `src/shared/types.ts` — `CollapsedPersonaGroup`, `RosterTileEntry`, `WebviewSessionTree`, `WebviewAgentTree`.
- `src/shared/messages.ts` — `SerializedSessionTree` value widened to `RosterTileEntry[]`.
- `tests/unit/webview/collapsedPersonaTile.test.ts` (new, 21 cases).
- `tests/unit/webview/freshness.test.ts` — boundary cases for the NIT fix.
- `tests/unit/webview/hydrateState.test.ts` — small type-narrow updates for the widened `RosterTileEntry[]` shape.
- `tests/unit/messageBus.test.ts` — small type-narrow update at one assertion site.

**Out of scope** (Felix's host PR or future work):

- Reducer grouping logic (`buildAgentTree` emits the wrapper when N>1) — Felix's PR.
- `claudeteam.collapsePersonaTiles` config setting (AC5) — Felix's PR (host reads `vscode.workspace.getConfiguration`; default `true`).
- Animations / transitions on expand/collapse (AC out of scope, M4 polish).
- Unifying `AgentTree.sessions[].rosterTiles` to `RosterTileEntry[]` post-Felix-merge — filed as a follow-up.

## Tests

```
npm run typecheck       → green
npm run lint            → green
npm run test:unit       → 341 passed | 2 skipped (was 320 pre-PR; +21 new)
npm run test:integration → 68 passed
npm run build           → green (dist/extension/main.cjs + dist/webview/main.js + dist/webview/dashboard.css emitted)
```

## Non-obvious findings (for maintain-docs)

- **`"kind" in entry` does NOT narrow `AgentTile | CollapsedPersonaGroup` in TS strict mode** — TypeScript treats AgentTile as an open-record shape, so `"kind" in entry` evaluates to true on the union without producing a discriminated narrowing. The reliable pattern is an explicit type-guard function (`isCollapsedPersonaGroup`) that returns a `entry is CollapsedPersonaGroup` predicate. Cost: one extra import per consumer; benefit: zero runtime risk + clean narrowing. Worth capturing in `vscode-extension-conventions.md` as a discriminated-union note alongside the JSON-serialization constraint.

- **Wrapper-instance-walking is required in the finishedTracker prune pass** — without it, finished tiles inside a collapsed wrapper get pruned from the tracker on every tick (because the prune set didn't see them — they weren't bare entries at the top level), then re-anchored to "now" when the wrapper is expanded. Result: every expand re-zeros the freshness suffix. Tested at `tests/unit/webview/collapsedPersonaTile.test.ts` § "renderFull's prune pass walks wrapper instances".

- **Wire round-trip through `serializeState` + `JSON.stringify` preserves the wrapper unchanged** — `CollapsedPersonaGroup` is plain JSON-safe (no Map/Date/Set; discriminator is a string literal), so no additional flattening was needed on Felix's host-emit side. Verified by `tests/unit/webview/collapsedPersonaTile.test.ts` § wire-shape round-trip. Captured here so a future maintainer doesn't re-flatten it on instinct.
