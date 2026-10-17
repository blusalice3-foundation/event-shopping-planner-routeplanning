import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isCoverageSourcePath,
  mergeChangedLines,
  mergeCoverageRecords,
  parseLcov,
  parseUnifiedDiff,
  pathMatchesScope,
  readGitDiff,
  summarizeChangedCoverage,
  summarizeCoverage,
} from "./coverage-policy-lib.mjs";

const projectRoot = "C:/work/repository";

test("parses and merges LCOV without double-counting repeated reports", () => {
  const first = parseLcov(
    [
      "SF:C:\\work\\repository\\src\\pwa\\recovery.ts",
      "FN:2,recover",
      "FNDA:1,recover",
      "BRDA:3,0,0,0",
      "DA:2,1",
      "DA:3,0",
      "end_of_record",
      "",
    ].join("\n"),
    projectRoot,
  );
  const second = parseLcov(
    [
      "SF:src/pwa/recovery.ts",
      "FN:2,recover",
      "FNDA:2,recover",
      "BRDA:3,0,0,1",
      "DA:2,2",
      "DA:3,1",
      "end_of_record",
      "",
    ].join("\n"),
    projectRoot,
  );

  const summary = summarizeCoverage(mergeCoverageRecords(first, second), {
    files: [],
    prefixes: ["src/pwa/"],
  });
  assert.equal(summary.files.length, 1);
  assert.equal(summary.lines.total, 2);
  assert.equal(summary.lines.covered, 2);
  assert.equal(summary.branches.covered, 1);
  assert.equal(summary.functions.covered, 1);
});

test("maps zero-context diff hunks to executable changed lines and branches", () => {
  const changes = parseUnifiedDiff(
    [
      "diff --git a/src/xlsx/security/preflight.ts b/src/xlsx/security/preflight.ts",
      "--- a/src/xlsx/security/preflight.ts",
      "+++ b/src/xlsx/security/preflight.ts",
      "@@ -9,0 +10,2 @@",
      "+first",
      "+second",
      "",
    ].join("\n"),
  );
  const records = parseLcov(
    [
      "SF:src/xlsx/security/preflight.ts",
      "BRDA:11,0,0,0",
      "DA:10,1",
      "DA:11,0",
      "end_of_record",
      "",
    ].join("\n"),
    projectRoot,
  );

  const summary = summarizeChangedCoverage(records, changes, {
    files: [],
    prefixes: ["src/xlsx/security/"],
  });
  assert.deepEqual(summary.changedFiles, ["src/xlsx/security/preflight.ts"]);
  assert.equal(summary.lines.rate, 50);
  assert.equal(summary.branches.rate, 0);
});

test("reports scoped changed source that is absent from every coverage report", () => {
  const changes = mergeChangedLines(
    new Map([["scripts/release-state/reducer.mjs", new Set([1, 2])]]),
    new Map([["scripts/release-state/reducer.mjs", new Set([2, 3])]]),
  );
  const summary = summarizeChangedCoverage(new Map(), changes, {
    files: ["scripts/release-state/reducer.mjs"],
    prefixes: [],
  });

  assert.deepEqual(summary.missingFiles, ["scripts/release-state/reducer.mjs"]);
});

const coverageScope = { files: [], prefixes: ["src/pwa/"] };
const includeCoverageFile = (filePath) =>
  isCoverageSourcePath(filePath) && pathMatchesScope(filePath, coverageScope);
const diffArguments = (comparison) => [
  "diff",
  "--no-prefix",
  "--unified=0",
  "--no-ext-diff",
  "--diff-filter=ACMR",
  comparison,
  "--",
];

const createGitFixture = async (context) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "coverage-policy-"));
  context.after(async () => {
    await rm(cwd, { force: true, recursive: true });
  });
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const write = async (relativePath, source) => {
    const absolutePath = path.join(cwd, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, source, { encoding: "utf8" });
  };
  git("init", "--quiet");
  git("config", "user.name", "Coverage policy tests");
  git("config", "user.email", "coverage-policy@example.invalid");
  git("config", "core.autocrlf", "false");
  git("config", "core.quotepath", "false");
  return { cwd, git, write };
};

test("streams a diff larger than the former buffer without losing changed-code failures", async (context) => {
  const { cwd, git, write } = await createGitFixture(context);
  const sourcePath = "src/pwa/recovery.ts";
  await write(
    sourcePath,
    "export const recover = () => {\n  return false;\n};\n",
  );
  await write("artifacts/performance.jsonl", "{}\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();

  await write(
    sourcePath,
    "export const recover = () => {\n  return true;\n};\n",
  );
  const evidenceRow = `${JSON.stringify({ sample: "x".repeat(1024) })}\n`;
  await write("artifacts/performance.jsonl", evidenceRow.repeat(33 * 1024));
  git("add", ".");
  git("commit", "--quiet", "-m", "source and large raw evidence");
  const args = diffArguments(`${base}...HEAD`);
  const buffered = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(buffered.error?.code, "ENOBUFS");

  const changes = await readGitDiff(args, {
    cwd,
    includeFile: includeCoverageFile,
  });
  assert.deepEqual(changes, new Map([[sourcePath, new Set([2])]]));

  const missing = summarizeChangedCoverage(new Map(), changes, coverageScope);
  assert.deepEqual(missing.missingFiles, [sourcePath]);
  const records = parseLcov(
    [`SF:${sourcePath}`, "DA:2,0", "BRDA:2,0,0,0", "end_of_record", ""].join(
      "\n",
    ),
    cwd,
  );
  const uncovered = summarizeChangedCoverage(records, changes, coverageScope);
  assert.deepEqual(uncovered.changedFiles, [sourcePath]);
  assert.equal(uncovered.lines.total, 1);
  assert.equal(uncovered.lines.rate, 0);
  assert.equal(uncovered.branches.total, 1);
  assert.equal(uncovered.branches.rate, 0);
});

test("retains zero-context changed lines for base, previous-commit, and working-tree comparisons", async (context) => {
  const { cwd, git, write } = await createGitFixture(context);
  const original = Array.from(
    { length: 20 },
    (_value, index) => `export const step${index} = false;`,
  );
  await write("src/pwa/recovery.ts", `${original.join("\n")}\n`);
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();

  git("mv", "src/pwa/recovery.ts", "src/pwa/renamed.ts");
  const committed = [...original];
  committed[10] = "export const step10 = true;";
  await write("src/pwa/renamed.ts", `${committed.join("\n")}\n`);
  await write("src/pwa/new.ts", "export const fresh = true;\n");
  await write("src/pwa/ignored.test.ts", "export const testOnly = true;\n");
  await write("artifacts/ignored.ts", "export const evidence = true;\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "rename, change, and new source");

  for (const comparison of [`${base}...HEAD`, "HEAD^...HEAD"]) {
    const args = diffArguments(comparison);
    const buffered = git(...args);
    assert.match(buffered, /rename from src\/pwa\/recovery\.ts/u);
    const changes = await readGitDiff(args, {
      cwd,
      includeFile: includeCoverageFile,
    });
    assert.deepEqual(
      changes,
      new Map([
        ["src/pwa/new.ts", new Set([1])],
        ["src/pwa/renamed.ts", new Set([11])],
      ]),
    );
    const expected = new Map(
      [...parseUnifiedDiff(buffered)].filter(([filePath]) =>
        includeCoverageFile(filePath),
      ),
    );
    assert.deepEqual(changes, expected);
  }

  const working = [...committed];
  working[14] = "export const step14 = true;";
  await write("src/pwa/renamed.ts", `${working.join("\n")}\n`);
  await write("src/pwa/staged.ts", "export const staged = true;\n");
  git("add", "src/pwa/staged.ts");
  const changes = await readGitDiff(diffArguments("HEAD"), {
    cwd,
    includeFile: includeCoverageFile,
  });
  assert.deepEqual(
    changes,
    new Map([
      ["src/pwa/renamed.ts", new Set([15])],
      ["src/pwa/staged.ts", new Set([1])],
    ]),
  );
});

test("rejects Git failures instead of returning an empty changed-code result", async (context) => {
  const { cwd, git, write } = await createGitFixture(context);
  await write("src/pwa/recovery.ts", "export const recover = true;\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  await assert.rejects(
    readGitDiff(diffArguments("missing-coverage-base...HEAD"), {
      cwd,
      includeFile: includeCoverageFile,
    }),
    /missing-coverage-base/u,
  );
  await assert.rejects(
    readGitDiff(diffArguments("HEAD"), {
      cwd: path.join(cwd, "missing-working-directory"),
      includeFile: includeCoverageFile,
    }),
    { code: "ENOENT" },
  );
});
