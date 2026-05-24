/**
 * Layer-3 roster-error chip smoke test (M3-09 AC3).
 *
 * Drives the M3-04 production code path under VS Code's real Electron
 * runtime: write malformed YAML to the roster path, call `runTick`, and
 * assert:
 *
 *   - `state.rosterErrors` is a non-empty string[] (the loader recorded
 *     the YAML parse failure — chip will render in the webview).
 *   - `serializeState(state).rosterErrors` preserves the error array
 *     verbatim on the wire (so the chip on the webview side sees what
 *     the host produced).
 *   - The first error string contains a recognisable parse-failure
 *     fingerprint ("YAML parse error" — the literal label loader.ts
 *     uses) so the test fails noisily if the loader silently swallowed
 *     the error and produced an empty errors array.
 *
 * What this catches that Layer-1/2 doesn't:
 *   - `loadRoster` → `runTick` → `state.rosterErrors` → `serializeState`
 *     composition under VS Code's real Electron runtime. Catches
 *     regressions where the bundled js-yaml + zod chain breaks under
 *     Node 22+ inside Electron (a real risk we hit at M2-08 with the
 *     ERR_REQUIRE_ESM bundle regression).
 *
 * Pass criteria (per M3-09 AC3):
 *   - `state.rosterErrors.length > 0` (loader recorded the YAML failure).
 *   - The serialized wire shape preserves the error array (which is what
 *     the webview's `renderRosterErrorChip` reads from to decide whether
 *     to render the chip element).
 *
 * Negative-path coverage (per test-plan negative-path requirement):
 *   - The "control" test asserts that a VALID YAML produces ZERO errors —
 *     proves the malformed-YAML test isn't passing because rosterErrors
 *     is always non-empty regardless of input (which would be a useless
 *     assertion). The control gives meaning to the malformed assertion.
 *
 * Webview-DOM limitation (mirrors `webviewSmoke.test.ts` header):
 *   VS Code's Extension API does NOT expose the webview iframe DOM from
 *   the host process. The AC text "webview HTML contains the chip
 *   element" translates at this layer to: the production runTick fills
 *   `state.rosterErrors`, AND serializeState carries it to the wire
 *   shape that the webview's `renderRosterErrorChip` reads from. The
 *   chip-element DOM rendering is covered by Layer-1 jsdom unit tests
 *   (`tests/unit/webview/rosterErrorChip.test.ts`); this Layer-3 test
 *   is the host-observable proxy for "the data the chip needs is
 *   present in the message payload."
 *
 * Source: src/extension/watcher/watcherLoop.ts runTick (rosterErrors stamp)
 *         src/extension/roster/loader.ts loadRoster (error capture)
 *         src/extension/messageBus.ts serializeState (wire-shape carry)
 *         src/webview/components/rosterErrorChip.ts (consumer)
 *         team/nora-pl/milestone-3-backlog.md §M3-09 AC3
 *         .claude/docs/testing-strategy.md "Layer 3 — VS Code integration"
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { runTick } from "../../../src/extension/watcher/watcherLoop.js";
import { serializeState } from "../../../src/extension/messageBus.js";

const EXTENSION_ID = "claudeteam.claudeteam";

// Deliberately malformed YAML: unclosed `[` triggers js-yaml parser failure
// at the syntactic level (before zod validation), so loader.ts records the
// error in `errors` rather than `warnings`. The exact failure-mode string
// is "YAML parse error" (see loader.ts parseFile).
const ROSTER_MALFORMED = `teams:
  - id: borked
    name: "Borked Team"
    members:
      - id: failure
        display: "Failure"
        role: "syntactic disaster"
        match:
          - agentType_equals: [unterminated array
`;

// Valid YAML for the negative-path control. The matcher rule never
// matches anything in this test (no agents are seeded), so the resulting
// rosterTiles are empty — irrelevant to the AC3 assertion, which is
// about rosterErrors being absent (loader succeeded).
const ROSTER_VALID = `teams:
  - id: valid-team
    name: "Valid Team"
    members:
      - id: ok
        display: "OK"
        role: "filler"
        match:
          - agentType_equals: "never-matches"
`;

suite("M3-09 AC3 — Roster-error chip smoke (Layer-3)", () => {
  let tempRoot: string;
  let claudeHome: string;
  let rosterPath: string;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);
    if (!ext.isActive) {
      await ext.activate();
    }

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ct-m3-09-roster-err-"));
    claudeHome = path.join(tempRoot, "claude");
    // Empty claudeHome — no sessions seeded. The reducer produces an empty
    // sessions array; the roster failure surfaces independently because
    // loadRoster runs unconditionally inside runTick.
    fs.mkdirSync(claudeHome, { recursive: true });

    const rosterDir = path.join(tempRoot, "claudeteam");
    fs.mkdirSync(rosterDir, { recursive: true });
    rosterPath = path.join(rosterDir, "teams.yaml");
  });

  suiteTeardown(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  test("malformed YAML → state.rosterErrors is non-empty", async () => {
    fs.writeFileSync(rosterPath, ROSTER_MALFORMED, "utf8");

    const state = await runTick({
      claudeHome,
      globalRosterPath: rosterPath,
      logger: { warn: () => {} },
    });

    assert.ok(
      state.rosterErrors,
      `state.rosterErrors must be defined (runTick should always stamp the ` +
        `field, even when empty); got ${state.rosterErrors}. Check ` +
        `watcherLoop.ts runTick — it spreads rosterResult.errors into the ` +
        `returned tree.`,
    );
    assert.ok(
      state.rosterErrors.length > 0,
      `Expected at least one rosterError from malformed YAML; got an empty ` +
        `array. The loader may be silently swallowing parse failures — check ` +
        `loader.ts parseFile error branches. (rosterWarnings was: ` +
        `${JSON.stringify(state.rosterWarnings)})`,
    );
    // Negative-path within the same test — the first error must look like
    // a YAML parse failure, not a generic schema rejection. This catches
    // the bug class where loader.ts maps every failure to a generic
    // "roster error" string and loses the parse-vs-schema distinction
    // the chip's verbatim summary depends on.
    assert.match(
      state.rosterErrors[0]!,
      /YAML parse error/i,
      `First error should contain "YAML parse error" (loader.ts's literal ` +
        `label for js-yaml failures); got "${state.rosterErrors[0]}". If a ` +
        `schema error surfaces here, the YAML must have been parseable — ` +
        `the malformed fixture is no longer triggering the parse branch.`,
    );
  });

  test("malformed YAML → serializeState preserves rosterErrors on the wire", async () => {
    fs.writeFileSync(rosterPath, ROSTER_MALFORMED, "utf8");
    const state = await runTick({
      claudeHome,
      globalRosterPath: rosterPath,
      logger: { warn: () => {} },
    });

    // The webview's renderRosterErrorChip reads its `errors` prop from the
    // wire-shape rosterErrors[]. If serializeState drops the field on the
    // wire, the chip never renders — even though the host's in-memory
    // state has the data. Exercise that boundary here.
    const wire = serializeState(state);
    assert.ok(
      Array.isArray(wire.rosterErrors),
      `Wire rosterErrors must always be an array (serializeState defaults ` +
        `undefined to [] per the JSON-safe contract); got ` +
        `${typeof wire.rosterErrors}.`,
    );
    assert.ok(
      wire.rosterErrors!.length > 0,
      `Wire rosterErrors must carry the in-memory errors verbatim; got ` +
        `empty array on the wire despite ${state.rosterErrors?.length ?? 0} ` +
        `errors in state. Check serializeState — the rosterErrors line was ` +
        `added in M3-04.`,
    );
    assert.deepStrictEqual(
      wire.rosterErrors,
      state.rosterErrors,
      `Wire rosterErrors must be value-equal to state.rosterErrors. Any ` +
        `divergence breaks the webview's chip lifecycle (dismiss-then-` +
        `reshow-on-change depends on byte-identity of the first error ` +
        `across ticks).`,
    );
  });

  test("CONTROL: valid YAML → state.rosterErrors is empty", async () => {
    // Negative-path control. Without this, the malformed test could pass
    // against a regression that ALWAYS reports errors (regardless of YAML
    // validity) and we'd never know. The contrast between this test and
    // the malformed-test is what gives the AC3 assertion its meaning.
    fs.writeFileSync(rosterPath, ROSTER_VALID, "utf8");

    const state = await runTick({
      claudeHome,
      globalRosterPath: rosterPath,
      logger: { warn: () => {} },
    });

    assert.ok(
      state.rosterErrors,
      `state.rosterErrors must always be defined; got ${state.rosterErrors}.`,
    );
    assert.strictEqual(
      state.rosterErrors.length,
      0,
      `Valid YAML should produce zero errors; got ` +
        `${JSON.stringify(state.rosterErrors)}. The loader may be over-` +
        `reporting (treating warnings as errors, or failing on a valid ` +
        `schema branch).`,
    );

    // Wire-shape check on the empty path too — must be `[]`, never undefined.
    const wire = serializeState(state);
    assert.deepStrictEqual(
      wire.rosterErrors,
      [],
      `Wire rosterErrors on the empty path must be [], not undefined. The ` +
        `webview's renderRosterErrorChip treats undefined as [] defensively, ` +
        `but the wire contract says always-array.`,
    );
  });
});
