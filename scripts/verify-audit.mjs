#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { fail, readJson } from "./foundation-policy-utils.mjs";
import { evaluateAuditPolicy, parseAuditResult } from "./lib/audit-policy.mjs";

const runAudit = (productionOnly) => {
  const npmArguments = [
    "audit",
    ...(productionOnly ? ["--omit=dev"] : []),
    "--json",
  ];
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
          ["/d", "/s", "/c", "npm " + npmArguments.join(" ")],
          { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        )
      : spawnSync("npm", npmArguments, {
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        });
  return parseAuditResult(
    result,
    productionOnly ? "production npm audit" : "npm audit",
  );
};

try {
  const policy = await readJson("config/audit-waivers.json");
  const lockfile = await readJson("package-lock.json");
  const evaluation = evaluateAuditPolicy({
    policy,
    lockfile,
    allAudit: runAudit(false),
    productionAudit: runAudit(true),
  });
  if (!evaluation.ok) {
    fail("FAIL reachability-aware audit", evaluation.errors);
  } else {
    const { all, production } = evaluation.counts;
    process.stdout.write(
      "PASS reachability-aware audit: all critical=" +
        all.critical +
        ", high=" +
        all.high +
        " (" +
        evaluation.reviewedWaivers.length +
        " reviewed waiver(s); " +
        evaluation.waivedPackages.length +
        " known-risk package findings remain); production critical=" +
        production.critical +
        ", high=" +
        production.high +
        "; moderate=" +
        production.moderate +
        "\n",
    );
  }
} catch (error) {
  fail("FAIL reachability-aware audit", [error.message]);
}
