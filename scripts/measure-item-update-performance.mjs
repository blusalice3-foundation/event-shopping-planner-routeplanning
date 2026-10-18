import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { platform, release } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Transpile source in memory so both revisions use exactly the same Node runtime.
// This also removes older type-only imports that omit the `type` keyword.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error.code === "ERR_MODULE_NOT_FOUND" &&
        specifier.startsWith(".") &&
        !path.extname(specifier)
      )
        return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    };
  },
});

const args = process.argv.slice(2);
const argument = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const baselineRoot = argument("--baseline");
assert(baselineRoot, "Pass --baseline <clean baseline checkout>");
const samples = Number(argument("--samples", "100"));
const warmup = Number(argument("--warmup", "30"));
assert(
  Number.isInteger(samples) && samples >= 20,
  "At least 20 samples required",
);
assert(Number.isInteger(warmup) && warmup >= 0, "Invalid warmup count");
const currentRoot = fileURLToPath(new URL("../", import.meta.url));
const loadRevision = async (root) => {
  const load = (name) =>
    import(pathToFileURL(path.join(root, `src/features/events/${name}.ts`)));
  const [diff, matching, apply, sheet] = await Promise.all([
    load("updateDiff"),
    load("sheetMatching"),
    load("updateApply"),
    load("sheetImport"),
  ]);
  return { ...diff, ...matching, ...apply, ...sheet };
};
const revisions = {
  baseline: await loadRevision(path.resolve(baselineRoot)),
  current: await loadRevision(currentRoot),
};
const gitHead = (root) =>
  execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

function makeFixture(size, scenario) {
  const current = Array.from({ length: size }, (_, index) => {
    const pair = Math.floor(index / 2);
    const a = index % 2 === 0;
    return {
      id: `item-${index}`,
      circle:
        scenario === "collision-title"
          ? `サークル${pair}${a ? " " : ""}`
          : `サークル${index}`,
      eventDate: "1日目",
      block: "東A",
      number: scenario === "collision-title" ? String(pair) : String(index),
      title:
        scenario === "collision-title" ? (a ? "旧A" : "旧B") : `品目${index}`,
      price: 900 + index,
      catalogPrice: a ? 500 : 700,
      quantity: 1 + (index % 3),
      remarks: `利用者メモ${index}`,
      sheetRemarks: "シート備考",
      purchaseStatus: index % 3 === 0 ? "Purchased" : "None",
      source: "spreadsheet",
      protectionLevel: "none",
      sheetIdentityVerified: true,
      url: "https://example.com/catalog",
    };
  });
  let incoming = current.map((item, index) => {
    const a = index % 2 === 0;
    return {
      ...item,
      circle: item.circle.trim(),
      title: scenario === "collision-title" ? (a ? "旧A" : "新A") : item.title,
      catalogPrice:
        scenario === "collision-title" ? (a ? 700 : 500) : item.catalogPrice,
      rawQuantity: scenario === "collision-title" ? "" : String(item.quantity),
    };
  });
  if (scenario === "duplicates")
    incoming = incoming.flatMap((item) => [item, { ...item }]);
  const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const header = Array(27).fill("");
  ["サークル名", "参加日", "ブロック", "番号"].forEach((value, index) => {
    header[12 + index] = value;
  });
  const csv = [
    header,
    ...incoming.map((item) => {
      const row = Array(27).fill("");
      [
        item.circle,
        item.eventDate,
        item.block,
        item.number,
        item.title,
        item.catalogPrice,
      ].forEach((value, index) => {
        row[12 + index] = value;
      });
      row[22] = item.sheetRemarks;
      row[24] = item.url;
      row[26] = item.rawQuantity;
      return row;
    }),
  ]
    .map((row) => row.map(escape).join(","))
    .join("\n");
  return { current, csv };
}

const percentile = (values, fraction) =>
  values.slice().sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const summary = (values) => ({
  sampleCount: values.length,
  medianMs: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
});
const results = [];
const realFetch = globalThis.fetch;
try {
  for (const size of [150, 500]) {
    for (const scenario of ["normal", "collision-title", "duplicates"]) {
      const fixture = makeFixture(size, scenario);
      // Zero network latency, with the real request builder and Response.text path.
      globalThis.fetch = async (url) => {
        assert.equal(url, "/api/google-sheets-csv");
        return new Response(fixture.csv, {
          headers: { "Content-Type": "text/csv" },
        });
      };
      const stages = {};
      const outcomes = {};
      for (const [revision, api] of Object.entries(revisions)) {
        const rows = api
          .readEventCsv(fixture.csv, { format: "google", header: true })
          .rows.map((row) => row.item);
        const normalized = api.normalizeSheetItemsUrls(rows);
        const diff = api.createEventUpdateDiff(fixture.current, normalized);
        outcomes[revision] = {
          inputRows: rows.length,
          added: diff.itemsToAdd.length,
          deleted: diff.itemsToDelete.length,
          duplicateAdditionsSkipped: diff.duplicateItemCount ?? 0,
        };
        stages[revision] = {
          "fetch-local-response": () =>
            api.fetchGoogleSheetCsv(
              "https://docs.google.com/spreadsheets/d/benchmark/edit#gid=0",
              "",
            ),
          "parse-csv": () =>
            api.readEventCsv(fixture.csv, { format: "google", header: true }),
          "normalize-urls": () => api.normalizeSheetItemsUrls(rows),
          "match-items": () => api.matchSheetItems(fixture.current, normalized),
          "create-diff": () =>
            api.createEventUpdateDiff(fixture.current, normalized),
          "apply-items": () =>
            api.applyEventUpdateToItems(fixture.current, diff),
        };
        if (revision === "current") {
          assert.equal(
            diff.itemsToAdd.length,
            0,
            `${scenario}: new duplicate/missing whitespace match`,
          );
          assert.equal(
            diff.itemsToDelete.length,
            0,
            `${scenario}: existing ID deleted`,
          );
          assert.equal(
            new Set(
              api
                .applyEventUpdateToItems(fixture.current, diff)
                .map((item) => item.id),
            ).size,
            size,
          );
          if (scenario === "collision-title") {
            const match = api.matchSheetItems(fixture.current, normalized);
            for (let index = 0; index < size; index++)
              assert.equal(
                match.matches.get(index)?.id,
                `item-${index % 2 === 0 ? index + 1 : index - 1}`,
              );
          }
        }
      }
      for (const stage of Object.keys(stages.current)) {
        const timings = { baseline: [], current: [] };
        for (let iteration = -warmup; iteration < samples; iteration++) {
          // Alternate execution order to reduce first/second-run bias.
          const order =
            iteration % 2 === 0
              ? ["baseline", "current"]
              : ["current", "baseline"];
          for (const revision of order) {
            const started = performance.now();
            const value = stages[revision][stage]();
            if (stage === "fetch-local-response") await value;
            const elapsed = performance.now() - started;
            if (iteration >= 0) timings[revision].push(elapsed);
          }
        }
        const baseline = summary(timings.baseline),
          current = summary(timings.current);
        results.push({
          size,
          scenario,
          stage,
          baseline,
          current,
          medianDeltaMs: current.medianMs - baseline.medianMs,
          p95DeltaMs: current.p95Ms - baseline.p95Ms,
          outcomes,
        });
      }
    }
  }
} finally {
  globalThis.fetch = realFetch;
}
process.stdout.write(
  `${JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      node: process.version,
      os: `${platform()} ${release()}`,
      baselineRoot: path.resolve(baselineRoot),
      baselineCommit: gitHead(path.resolve(baselineRoot)),
      currentCommit: gitHead(currentRoot),
      currentHasUncommittedChanges:
        execFileSync("git", ["-C", currentRoot, "status", "--porcelain"], {
          encoding: "utf8",
        }).trim() !== "",
      samples,
      warmup,
      fetchMeasurement:
        "Synthetic zero-latency local Response using the real fetch request and text-reading path; excludes network wait.",
      scope:
        "Source pipeline only. Confirmation rendering, checkbox reaction and persistent save completion require browser measurements separately.",
      results,
    },
    null,
    2,
  )}\n`,
);
