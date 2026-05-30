/**
 * TS-02 (team-setup epic) — integration tests against a fixture filesystem:
 *   - scanAgentsFolder: 0 / 1 / 2+ persona files, non-persona exclusion (AC1)
 *   - detection trichotomy end-to-end via a real folder + config presence (AC1)
 *   - gen → write → read round-trip + malformed-yaml negative path (AC3, AC4, AC9)
 *   - resolveCharacterSources: bundled-only after clean build + bundled+user
 *     merge with bundled-wins dedupe + half-harvest skip (AC7)
 *   - DROP-global regression: assert no source file resolves
 *     `~/.claudeteam/teams.yaml` (AC5)
 *   - SetupController.reconcileDrift: orphan flip persists to disk (AC6)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  scanAgentsFolder,
  resolveAgentsDir,
} from "../../src/extension/roster/agentScanner.js";
import {
  generateStarterConfig,
  readClaudeTeamConfig,
  writeClaudeTeamConfig,
} from "../../src/extension/roster/claudeTeamConfig.js";
import { resolveCharacterSources } from "../../src/extension/characterSources.js";
import { SetupController } from "../../src/extension/setupController.js";
import type { ScannedAgent } from "../../src/shared/types.js";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ct-ts02-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Create a workspace folder with a `.claude/agents/` dir + the given files. */
function makeWorkspace(files: Record<string, string>): string {
  const folder = join(root, "ws");
  const agentsDir = join(folder, ".claude", "agents");
  mkdirSync(agentsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(agentsDir, name), content, "utf8");
  }
  return folder;
}

// ---------------------------------------------------------------------------
// scanner + detection (AC1)
// ---------------------------------------------------------------------------

describe("scanAgentsFolder (AC1)", () => {
  it("returns [] for a missing folder", () => {
    expect(scanAgentsFolder(join(root, "nope", "agents"))).toEqual([]);
  });

  it("scans persona .md files, excludes non-persona docs, sorts by name", () => {
    const ws = makeWorkspace({
      "felix.md": "# Felix",
      "maya.md": "# Maya",
      "TEAM.md": "# convention doc",
      "dispatch-template.md": "# template",
      "notes.txt": "ignored",
    });
    const scanned = scanAgentsFolder(resolveAgentsDir(ws));
    expect(scanned.map((a) => a.agentName)).toEqual(["felix", "maya"]);
    expect(scanned[0]!.filePath.endsWith("felix.md")).toBe(true);
  });

  it("1-agent folder yields a single entry (empty-state count path)", () => {
    const ws = makeWorkspace({ "solo.md": "# Solo" });
    expect(scanAgentsFolder(resolveAgentsDir(ws))).toHaveLength(1);
  });

  // 86ca1nvae — auto-resolve Member.role from the `.md` frontmatter description.
  it("derives a role from the agent .md frontmatter description", () => {
    const ws = makeWorkspace({
      "felix.md":
        "---\nname: felix\ndescription: Senior Developer #1 (extension host) on the ClaudeTeam project. Use for TS.\nmodel: opus\n---\n\nBody.",
      "sage.md":
        "---\nname: sage\ndescription: QA / Tester on the ClaudeTeam project. Use for test planning.\n---\n",
    });
    const scanned = scanAgentsFolder(resolveAgentsDir(ws));
    const byName = new Map(scanned.map((a) => [a.agentName, a.role]));
    expect(byName.get("felix")).toBe("Senior Developer #1");
    expect(byName.get("sage")).toBe("QA / Tester");
  });

  it("omits role (undefined) when the .md has no description frontmatter", () => {
    const ws = makeWorkspace({
      "felix.md": "# Felix — no frontmatter at all",
      "maya.md": "---\nname: maya\nmodel: opus\n---\nNo description key.",
    });
    const scanned = scanAgentsFolder(resolveAgentsDir(ws));
    for (const a of scanned) {
      expect(a.role).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// gen → write → read round-trip (AC3, AC4) + malformed (AC9)
// ---------------------------------------------------------------------------

describe("claudeteam.yaml gen → write → read round-trip (AC3, AC4)", () => {
  it("writes a normalized file that re-reads + validates clean", () => {
    const cfg = generateStarterConfig(["felix", "maya"], "Demo");
    const path = join(root, ".claude", "claudeteam.yaml");
    const w = writeClaudeTeamConfig(path, cfg);
    expect(w.ok).toBe(true);
    expect(existsSync(path)).toBe(true);

    const r = readClaudeTeamConfig(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.version).toBe(1);
    expect(r.config.teams[0]!.members.map((m) => m.id)).toEqual([
      "felix",
      "maya",
    ]);
    expect(r.config.teams[0]!.members[0]!.match).toEqual([
      { agentType_equals: "felix" },
    ]);
    expect(r.config.teams[0]!.members[0]!.character).toBeNull();
    expect(r.config.teams[0]!.members[0]!.status).toBe("live");
  });

  it("creates the parent .claude dir if missing", () => {
    const cfg = generateStarterConfig(["felix"]);
    const path = join(root, "fresh", "deep", ".claude", "claudeteam.yaml");
    expect(writeClaudeTeamConfig(path, cfg).ok).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  // 86ca1nvae — a user-edited role AND a deleted role (→ "") both persist
  // through the normalized structured write + re-read. Empty role validates.
  it("persists a user-edited role and a deleted (empty) role through write→read", () => {
    const path = join(root, ".claude", "claudeteam.yaml");
    // Seed with an auto-derived role for felix.
    const seeded = generateStarterConfig(
      ["felix", "maya"],
      "Demo",
      new Map([["felix", "Senior Developer #1"]]),
    );
    expect(writeClaudeTeamConfig(path, seeded).ok).toBe(true);

    const first = readClaudeTeamConfig(path);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Simulate a panel edit: rename felix's role, and CLEAR maya's role to "".
    const edited = {
      ...first.config,
      teams: first.config.teams.map((t) => ({
        ...t,
        members: t.members.map((m) =>
          m.id === "felix"
            ? { ...m, role: "Host & Data Lead" }
            : m.id === "maya"
              ? { ...m, role: "" }
              : m,
        ),
      })),
    };
    expect(writeClaudeTeamConfig(path, edited).ok).toBe(true);

    const second = readClaudeTeamConfig(path);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const members = new Map(
      second.config.teams[0]!.members.map((m) => [m.id, m.role]),
    );
    expect(members.get("felix")).toBe("Host & Data Lead"); // edit persisted
    expect(members.get("maya")).toBe(""); // delete persisted + validates
  });

  it("malformed YAML → ok:false with a schema/parse error (AC9 negative path)", () => {
    const path = join(root, ".claude", "claudeteam.yaml");
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(path, "version: 1\nteams: [oops\n", "utf8"); // broken YAML
    const r = readClaudeTeamConfig(path);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("claudeteam.yaml");
  });

  it("schema-invalid (missing version) → ok:false", () => {
    const path = join(root, ".claude", "claudeteam.yaml");
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(path, "teams: []\n", "utf8");
    const r = readClaudeTeamConfig(path);
    expect(r.ok).toBe(false);
  });

  it("missing file → ok:false (distinct from malformed)", () => {
    const r = readClaudeTeamConfig(join(root, "none", "claudeteam.yaml"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// character sources (AC7)
// ---------------------------------------------------------------------------

/** Write a valid PixelLab-harvest character folder (animations.json + _pixellab_anims/). */
function makeChar(rootDir: string, id: string): void {
  const dir = join(rootDir, id);
  mkdirSync(join(dir, "_pixellab_anims", "idle", "animations", "x", "south"), {
    recursive: true,
  });
  writeFileSync(join(dir, "animations.json"), "{}", "utf8");
  writeFileSync(
    join(dir, "_pixellab_anims", "idle", "animations", "x", "south", "frame_0.png"),
    "PNG",
    "utf8",
  );
}

describe("resolveCharacterSources (AC7)", () => {
  it("bundled-only present after a clean build (no user folder)", () => {
    const bundled = join(root, "dist-sprites");
    mkdirSync(bundled, { recursive: true });
    makeChar(bundled, "ClaudeTeam-M01-Dev");
    makeChar(bundled, "ClaudeTeam-F01-Dev");
    const sources = resolveCharacterSources({
      bundledSpritesDir: bundled,
      userCharacterDir: join(root, "no-user-folder"),
    });
    expect(sources.map((s) => s.id).sort()).toEqual([
      "ClaudeTeam-F01-Dev",
      "ClaudeTeam-M01-Dev",
    ]);
    expect(sources.every((s) => s.origin === "bundled")).toBe(true);
  });

  it("merges bundled + user with bundled-wins dedupe", () => {
    const bundled = join(root, "bundled");
    const user = join(root, "user");
    makeChar(bundled, "shared");
    makeChar(bundled, "only-bundled");
    makeChar(user, "shared"); // collides — bundled wins, user copy dropped
    makeChar(user, "only-user");
    const sources = resolveCharacterSources({
      bundledSpritesDir: bundled,
      userCharacterDir: user,
    });
    const byId = new Map(sources.map((s) => [s.id, s]));
    expect(byId.get("shared")!.origin).toBe("bundled"); // bundled wins
    expect(byId.get("only-bundled")!.origin).toBe("bundled");
    expect(byId.get("only-user")!.origin).toBe("user");
    // exactly one "shared" entry (no dup)
    expect(sources.filter((s) => s.id === "shared")).toHaveLength(1);
  });

  it("skips a half-finished harvest (missing _pixellab_anims/)", () => {
    const bundled = join(root, "bundled");
    mkdirSync(join(bundled, "half"), { recursive: true });
    writeFileSync(join(bundled, "half", "animations.json"), "{}", "utf8");
    // no _pixellab_anims/ dir → invalid → skipped
    makeChar(bundled, "good");
    const sources = resolveCharacterSources({
      bundledSpritesDir: bundled,
      userCharacterDir: join(root, "none"),
    });
    expect(sources.map((s) => s.id)).toEqual(["good"]);
  });

  it("empty when bundled dir absent (webview defends empty grid)", () => {
    expect(
      resolveCharacterSources({
        bundledSpritesDir: join(root, "missing"),
        userCharacterDir: join(root, "missing2"),
      }),
    ).toEqual([]);
  });

  // 86ca1tv41 (secondary fix): thumbnailPath MUST be a web-root-relative,
  // forward-slashed path the webview can resolve against spriteBaseUri — NOT an
  // absolute fs path (which would break the <img src> once the picker renders).
  it("bundled thumbnailPath is web-root-relative + forward-slashed (NOT absolute)", () => {
    const webRoot = join(root, "dist", "webview");
    const bundled = join(webRoot, "sprites");
    makeChar(bundled, "ClaudeTeam-M01-Dev");
    const sources = resolveCharacterSources({
      bundledSpritesDir: bundled,
      userCharacterDir: join(root, "no-user"),
      // webRootDir defaults to the parent of bundledSpritesDir (dist/webview).
    });
    expect(sources).toHaveLength(1);
    const tp = sources[0]!.thumbnailPath;
    // Relative to dist/webview, starting at `sprites/...` (the manifest
    // convention the persona-tile sprite player also uses).
    expect(tp).toBe(
      "sprites/ClaudeTeam-M01-Dev/_pixellab_anims/idle/animations/x/south/frame_0.png",
    );
    expect(tp).not.toContain("\\");
    // NON-VACUOUS guard: must NOT be the absolute on-disk path.
    expect(tp.startsWith(root)).toBe(false);
    expect(tp).not.toMatch(/^[A-Za-z]:/); // no Windows drive prefix
  });

  it("user-folder thumbnailPath degrades to '' (outside web root → monogram)", () => {
    const webRoot = join(root, "dist", "webview");
    const bundled = join(webRoot, "sprites");
    const user = join(root, "user-chars"); // OUTSIDE dist/webview
    makeChar(user, "Custom-User-Char");
    const sources = resolveCharacterSources({
      bundledSpritesDir: bundled, // absent → no bundled entries
      userCharacterDir: user,
    });
    const userSrc = sources.find((s) => s.id === "Custom-User-Char")!;
    expect(userSrc.origin).toBe("user");
    // Not under dist/webview → not webview-loadable → "" → webview renders the
    // monogram chip (graceful degrade) instead of a broken <img>.
    expect(userSrc.thumbnailPath).toBe("");
  });
});

// ---------------------------------------------------------------------------
// SetupController drift reconcile persists orphan flip (AC6)
// ---------------------------------------------------------------------------

describe("SetupController.reconcileDrift (AC6 — orphan flip persists)", () => {
  function makeController(folder: string) {
    const posts: Array<{ kind: string; args: unknown[] }> = [];
    const memento = new Map<string, boolean>();
    const controller = new SetupController({
      workspaceFolderPath: folder,
      bundledSpritesDir: join(root, "no-bundled"),
      userCharacterDir: join(root, "no-user"),
      post: {
        detection: (...args) => posts.push({ kind: "detection", args }),
        characters: (...args) => posts.push({ kind: "characters", args }),
        configSaved: (...args) => posts.push({ kind: "configSaved", args }),
      },
      dismissStore: {
        get: (k) => memento.get(k),
        update: (k, v) => {
          memento.set(k, v);
          return Promise.resolve();
        },
      },
    });
    return { controller, posts, memento };
  }

  it("flips a member to orphaned on disk when its agent file is removed", () => {
    const ws = makeWorkspace({ "felix.md": "# F", "maya.md": "# M" });
    const { controller } = makeController(ws);
    // Seed a config from both agents.
    controller.runSetup(["felix", "maya"]);
    const cfgPath = join(ws, ".claude", "claudeteam.yaml");
    expect(existsSync(cfgPath)).toBe(true);

    // maya.md removed → reconcile against the present set {felix}.
    rmSync(join(ws, ".claude", "agents", "maya.md"));
    controller.reconcileDrift(new Set(["felix"]));

    const r = readClaudeTeamConfig(cfgPath);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const maya = r.config.teams[0]!.members.find((m) => m.id === "maya")!;
    expect(maya.status).toBe("orphaned"); // KEPT, not deleted
    const felix = r.config.teams[0]!.members.find((m) => m.id === "felix")!;
    expect(felix.status).toBe("live");
  });

  it("confirmOrphanDelete removes the member from disk (the only delete path)", () => {
    const ws = makeWorkspace({ "felix.md": "# F", "maya.md": "# M" });
    const { controller } = makeController(ws);
    controller.runSetup(["felix", "maya"]);
    controller.confirmOrphanDelete("maya");
    const r = readClaudeTeamConfig(join(ws, ".claude", "claudeteam.yaml"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.teams[0]!.members.map((m) => m.id)).toEqual(["felix"]);
  });

  it("dismiss-suggestion persists per-workspace", () => {
    const ws = makeWorkspace({ "felix.md": "# F" });
    const { controller } = makeController(ws);
    expect(controller.isSuggestionDismissed()).toBe(false);
    controller.dismissSuggestion();
    expect(controller.isSuggestionDismissed()).toBe(true);
  });

  // TS-04 AC6 — the non-mutating-nudge contract. The orphan-flip tests above
  // cover removal → orphaned and confirm-delete; this guards the OTHER half of
  // Decision 3: a NEW agent appearing must NEVER auto-add a member. New agents
  // are a nudge signal only; only the user (via ui:run-setup / the wizard) adds
  // members. A reconcileDrift that silently grew the roster would be a serious
  // bug class (a roster the sponsor never curated). NON-VACUOUS: the assertion
  // pins the exact member set, so an auto-add would flip it.
  it("AC6 non-mutating nudge: a NEW agent on disk never auto-adds a member", () => {
    const ws = makeWorkspace({ "felix.md": "# F", "maya.md": "# M" });
    const { controller } = makeController(ws);
    controller.runSetup(["felix"]); // curate ONLY felix (maya deliberately excluded)
    const cfgPath = join(ws, ".claude", "claudeteam.yaml");

    // A brand-new agent file appears (iris.md) AND the previously-excluded maya
    // is still on disk. reconcileDrift sees BOTH as "present" — but neither was
    // curated, so neither may be added to the config.
    writeFileSync(join(ws, ".claude", "agents", "iris.md"), "# I", "utf8");
    controller.reconcileDrift(new Set(["felix", "maya", "iris"]));

    const r = readClaudeTeamConfig(cfgPath);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Still EXACTLY the curated member — no iris, no maya auto-added.
    expect(r.config.teams[0]!.members.map((m) => m.id)).toEqual(["felix"]);
    expect(r.config.teams[0]!.members[0]!.status).toBe("live"); // felix stays live
  });

  // TS-04 AC6 — revive path: an orphaned member whose agent file RETURNS flips
  // back to live (not deleted, not duplicated). Complements the removal flip.
  it("AC6 orphan revive: a returning agent file flips its member back to live", () => {
    const ws = makeWorkspace({ "felix.md": "# F", "maya.md": "# M" });
    const { controller } = makeController(ws);
    controller.runSetup(["felix", "maya"]);
    const cfgPath = join(ws, ".claude", "claudeteam.yaml");

    // maya.md removed → orphaned.
    rmSync(join(ws, ".claude", "agents", "maya.md"));
    controller.reconcileDrift(new Set(["felix"]));
    let r = readClaudeTeamConfig(cfgPath);
    expect(r.ok && r.config.teams[0]!.members.find((m) => m.id === "maya")!.status).toBe(
      "orphaned",
    );

    // maya.md returns → revived to live, still a single maya member.
    writeFileSync(join(ws, ".claude", "agents", "maya.md"), "# M", "utf8");
    controller.reconcileDrift(new Set(["felix", "maya"]));
    r = readClaudeTeamConfig(cfgPath);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mayas = r.config.teams[0]!.members.filter((m) => m.id === "maya");
    expect(mayas).toHaveLength(1); // not duplicated by the round-trip
    expect(mayas[0]!.status).toBe("live");
  });
});

// ---------------------------------------------------------------------------
// DROP-global regression (AC5)
// ---------------------------------------------------------------------------

describe("DROP global ~/.claudeteam/teams.yaml (AC5 regression)", () => {
  /** Recursively collect all .ts source files under src/. */
  function srcFiles(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) srcFiles(p, acc);
      else if (e.name.endsWith(".ts")) acc.push(p);
    }
    return acc;
  }

  it("no source file CONSTRUCTS the global path via homedir()+.claudeteam (code, not comments)", () => {
    // The dropped code was `join(homedir(), ".claudeteam", "teams.yaml")`. Guard
    // the executable construction specifically — a `homedir()` (or `homeDir`)
    // call paired with a `".claudeteam"` string literal in the same file. This
    // is the real regression vector; historical PROSE mentions of the old path
    // in JSDoc/comments are not a code path and are intentionally NOT flagged
    // (e.g. the watcher's optional `globalRosterPath` param doc still references
    // the location it COULD accept, but main.ts no longer passes it).
    const files = srcFiles(join(REPO_ROOT, "src"));
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // Strip line + block comments before scanning so prose can't trip this.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      // The dropped construction pairs the global dir with the OLD roster
      // FILENAME. `characterSources.ts` legitimately uses `homedir()` +
      // ".claudeteam" for the user-CHARACTER folder (".claudeteam/characters"),
      // which is NOT the dropped roster — so we require "teams.yaml" too.
      if (
        /homedir\s*\(\s*\)/.test(code) &&
        code.includes('".claudeteam"') &&
        code.includes('"teams.yaml"')
      ) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// keep ScannedAgent import used (type-only assertion site)
const _typecheck: ScannedAgent = { agentName: "x", filePath: "y" };
void _typecheck;
