import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuditPolicy, parseAuditResult } from "./lib/audit-policy.mjs";

const GHSA = "GHSA-mrhx-c7xc-m3w5";
const URL = "https://github.com/advisories/" + GHSA;
const NOW = Date.parse("2026-10-30T00:00:00Z");
const counts = (vulnerabilities) => {
  const result = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  };
  for (const entry of Object.values(vulnerabilities)) {
    result[entry.severity] += 1;
    result.total += 1;
  }
  return result;
};
const report = (vulnerabilities = {}) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: { vulnerabilities: counts(vulnerabilities) },
});
const leaf = (name = "zod", url = URL, severity = "high") => ({
  source: 1243066,
  name,
  dependency: name,
  url,
  severity,
});
const finding = (
  name,
  via,
  nodes = ["node_modules/" + name],
  severity = "high",
) => ({
  name,
  severity,
  via,
  nodes,
});
const fixture = () => {
  const vulnerabilities = {
    vercel: finding("vercel", ["bridge"]),
    bridge: finding("bridge", ["zod"]),
    zod: finding(
      "zod",
      [leaf()],
      [
        "node_modules/bridge/node_modules/zod",
        "node_modules/vercel/node_modules/zod",
      ],
    ),
  };
  const packages = {
    "": { name: "fixture" },
    "node_modules/vercel": { version: "58.5.1", dev: true },
    "node_modules/bridge": { version: "1.2.3", dev: true },
    "node_modules/bridge/node_modules/zod": { version: "3.22.4", dev: true },
    "node_modules/vercel/node_modules/zod": { version: "3.22.4", dev: true },
  };
  return {
    policy: {
      schemaVersion: 1,
      waivers: [
        {
          id: "reviewed-cli-zod",
          advisory: URL,
          severity: "high",
          owner: "Build/Quality",
          reason: "CLI-only package; no supported Zod 3 patch.",
          expiry: "2026-11-13",
          mitigation: "No untrusted CLI manifests; review upstream migration.",
          installedPackage: "vercel",
          installedVersion: "58.5.1",
          affectedPackages: ["vercel", "bridge", "zod"],
          lockedDependencies: Object.entries(packages)
            .filter(([path]) => path)
            .map(([path, metadata]) => ({ path, version: metadata.version })),
          reachability: {
            production: "Absent from deployed code.",
            "release-tool": "Reviewed repository build inputs only.",
            test: "Dependency identity is inspected.",
            build: "Tool CLI is not a public request handler.",
          },
        },
      ],
    },
    lockfile: { lockfileVersion: 3, packages },
    allAudit: report(vulnerabilities),
    productionAudit: report(),
    now: NOW,
  };
};
const evaluate = (input) => evaluateAuditPolicy(input);
const rejectMutation = (name, mutate, expected) => {
  test(name, () => {
    const input = fixture();
    mutate(input, input.policy.waivers[0]);
    input.allAudit.metadata.vulnerabilities = counts(
      input.allAudit.vulnerabilities,
    );
    input.productionAudit.metadata.vulnerabilities = counts(
      input.productionAudit.vulnerabilities,
    );
    const actual = evaluate(input);
    assert.equal(actual.ok, false);
    assert.match(actual.errors.join("\n"), expected);
  });
};

test("clean reports with no waivers pass", () => {
  const input = fixture();
  input.policy.waivers = [];
  input.allAudit = report();
  const actual = evaluate(input);
  assert.equal(actual.ok, true);
  assert.deepEqual(actual.reviewedWaivers, []);
  assert.deepEqual(actual.waivedPackages, []);
});
test("exact reviewed high advisory and every locked node pass without resolving risk", () => {
  const actual = evaluate(fixture());
  assert.equal(actual.ok, true, actual.errors.join("\n"));
  assert.equal(actual.counts.all.high, 3);
  assert.equal(actual.reviewedWaivers.length, 1);
  assert.deepEqual(actual.waivedPackages, ["vercel", "bridge", "zod"]);
});
test("exact GHSA id also binds the canonical advisory URL", () => {
  const input = fixture();
  input.policy.waivers[0].advisory = GHSA;
  assert.equal(evaluate(input).ok, true);
});
rejectMutation(
  "an unwaived high finding fails",
  (x) => {
    x.policy.waivers = [];
  },
  /unwaived high/,
);
rejectMutation(
  "a second high advisory on the same package fails",
  (x) => {
    x.allAudit.vulnerabilities.zod.via.push(
      leaf("zod", "https://github.com/advisories/GHSA-aaaa-bbbb-cccc"),
    );
  },
  /changed advisory/,
);
rejectMutation(
  "a different URL cannot impersonate a GHSA",
  (x) => {
    x.allAudit.vulnerabilities.zod.via[0].url = "https://example.test/" + GHSA;
  },
  /changed advisory/,
);
rejectMutation(
  "critical escalation of the same advisory fails",
  (x) => {
    x.allAudit.vulnerabilities.zod.severity = "critical";
    x.allAudit.vulnerabilities.zod.via[0].severity = "critical";
  },
  /critical findings|changed advisory/,
);
rejectMutation(
  "a critical meta-finding cannot be waived",
  (x) => {
    x.allAudit.vulnerabilities.vercel.severity = "critical";
  },
  /critical findings can never/,
);
rejectMutation(
  "waiver severity itself cannot be critical",
  (_x, w) => {
    w.severity = "critical";
  },
  /never critical/,
);
rejectMutation(
  "an otherwise waived production high fails",
  (x) => {
    x.productionAudit = structuredClone(x.allAudit);
  },
  /reachable production high/,
);
rejectMutation(
  "a production critical always fails",
  (x) => {
    x.productionAudit = report({
      zod: finding(
        "zod",
        [leaf("zod", URL, "critical")],
        ["node_modules/zod"],
        "critical",
      ),
    });
  },
  /reachable production critical/,
);
rejectMutation(
  "installed CLI version changes fail",
  (x) => {
    x.lockfile.packages["node_modules/vercel"].version = "58.5.2";
  },
  /installed package\/version|locked dependency/,
);
rejectMutation(
  "a nested Zod version change fails",
  (x) => {
    x.lockfile.packages["node_modules/bridge/node_modules/zod"].version =
      "3.25.76";
  },
  /locked dependency version/,
);
rejectMutation(
  "a missing locked node fails",
  (x) => {
    delete x.lockfile.packages["node_modules/vercel/node_modules/zod"];
  },
  /locked dependency version/,
);
rejectMutation(
  "an audit node relocation fails even with a real new lock entry",
  (x) => {
    x.allAudit.vulnerabilities.zod.nodes[0] =
      "node_modules/other/node_modules/zod";
    x.lockfile.packages["node_modules/other/node_modules/zod"] = {
      version: "3.22.4",
      dev: true,
    };
  },
  /exactly cover/,
);
rejectMutation(
  "every waived node must remain dev-only",
  (x) => {
    x.lockfile.packages["node_modules/bridge/node_modules/zod"].dev = false;
  },
  /locked dependency version\/dev/,
);
rejectMutation(
  "linked packages are not version-bound installed packages",
  (x) => {
    x.lockfile.packages["node_modules/vercel"].link = true;
  },
  /installed package\/version/,
);
rejectMutation(
  "a missing nested node pin fails",
  (_x, w) => {
    w.lockedDependencies.pop();
  },
  /exactly cover/,
);
rejectMutation(
  "an extra lock pin fails",
  (x, w) => {
    x.lockfile.packages["node_modules/extra"] = { version: "1.0.0", dev: true };
    w.lockedDependencies.push({ path: "node_modules/extra", version: "1.0.0" });
  },
  /exactly cover/,
);
rejectMutation(
  "duplicate pins fail",
  (_x, w) => {
    w.lockedDependencies.push(w.lockedDependencies[0]);
  },
  /duplicate locked/,
);
rejectMutation(
  "a path traversal pin fails",
  (_x, w) => {
    w.lockedDependencies[0].path = "node_modules/../vercel";
  },
  /malformed.*locked/,
);
rejectMutation(
  "duplicate affected packages fail",
  (_x, w) => {
    w.affectedPackages.push("zod");
  },
  /unique package/,
);
rejectMutation(
  "an omitted affected package is not implicitly waived",
  (_x, w) => {
    w.affectedPackages = ["vercel", "bridge"];
  },
  /exactly cover|unwaived high/,
);
rejectMutation(
  "overlapping duplicate waivers fail",
  (x) => {
    x.policy.waivers.push(structuredClone(x.policy.waivers[0]));
  },
  /duplicate waiver|overlapping waiver/,
);
rejectMutation(
  "empty reachability is rejected",
  (_x, w) => {
    w.reachability = {};
  },
  /reachability/,
);
rejectMutation(
  "blank reachability is rejected",
  (_x, w) => {
    w.reachability.production = " ";
  },
  /reachability/,
);
for (const field of ["owner", "reason", "mitigation", "advisory", "id"]) {
  rejectMutation(
    "missing required review field " + field + " fails",
    (_x, w) => {
      delete w[field];
    },
    /missing/,
  );
}
for (const expiry of [
  "2026-10-29",
  "2026-02-30",
  "not-a-date",
  "2026-11-13T00:00:00Z",
  "",
]) {
  rejectMutation(
    "expired or invalid expiry " + JSON.stringify(expiry) + " fails",
    (_x, w) => {
      w.expiry = expiry;
    },
    /expiry/,
  );
}
rejectMutation(
  "expiry midnight is exclusive",
  (x) => {
    x.now = Date.parse("2026-11-13T00:00:00Z");
  },
  /expired/,
);
rejectMutation(
  "unresolved dependency graph fails closed",
  (x) => {
    x.allAudit.vulnerabilities.bridge.via.push("missing-package");
  },
  /unresolved advisory dependency/,
);
rejectMutation(
  "a cycle within a high dependency graph fails closed",
  (x) => {
    x.allAudit.vulnerabilities.zod.via.push("vercel");
  },
  /dependency cycle/,
);
rejectMutation(
  "a high finding without a high leaf is not waived",
  (x) => {
    x.allAudit.vulnerabilities.zod.via[0].severity = "moderate";
  },
  /unwaived high/,
);
test("lower-severity findings remain reported, without broadening a high waiver", () => {
  const input = fixture();
  input.allAudit.vulnerabilities.bridge.via.push("lower");
  input.allAudit.vulnerabilities.lower = finding(
    "lower",
    [leaf("lower", "https://example.test/lower", "moderate")],
    ["node_modules/lower"],
    "moderate",
  );
  input.allAudit.metadata.vulnerabilities = counts(
    input.allAudit.vulnerabilities,
  );
  assert.equal(evaluate(input).ok, true);
});
test("an unrelated moderate-only npm graph cycle does not change the blocking threshold", () => {
  const input = fixture();
  input.allAudit.vulnerabilities.lower = finding(
    "lower",
    ["other", leaf("lower", "https://example.test/lower", "moderate")],
    ["node_modules/lower"],
    "moderate",
  );
  input.allAudit.vulnerabilities.other = finding(
    "other",
    ["lower"],
    ["node_modules/other"],
    "moderate",
  );
  input.allAudit.metadata.vulnerabilities = counts(
    input.allAudit.vulnerabilities,
  );
  assert.equal(evaluate(input).ok, true);
});
for (const badReport of [
  null,
  {},
  { error: { code: "ENETUNREACH" } },
  { ...report(), error: { code: "EAUDITNOLOCK" } },
  { ...report(), vulnerabilities: [] },
]) {
  test(
    "malformed/network-error audit is not clean: " + JSON.stringify(badReport),
    () => {
      const input = fixture();
      input.allAudit = badReport;
      assert.equal(evaluate(input).ok, false);
    },
  );
}
test("missing or contradictory metadata cannot pass as empty clean audit", () => {
  for (const mutate of [
    (x) => {
      delete x.metadata;
    },
    (x) => {
      x.metadata.vulnerabilities.high = 1;
    },
    (x) => {
      x.metadata.vulnerabilities.total = 1;
    },
    (x) => {
      x.metadata.vulnerabilities.high = -1;
    },
  ]) {
    const input = fixture();
    input.policy.waivers = [];
    input.allAudit = report();
    mutate(input.allAudit);
    assert.equal(evaluate(input).ok, false);
  }
});
for (const graph of ["allAudit", "productionAudit"]) {
  test(
    graph + " cannot hide a direct critical advisory under moderate severity",
    () => {
      const input = fixture();
      input.policy.waivers = [];
      input.allAudit = report();
      input[graph] = report({
        zod: finding(
          "zod",
          [leaf("zod", URL, "critical")],
          ["node_modules/zod"],
          "moderate",
        ),
      });
      const actual = evaluate(input);
      assert.equal(actual.ok, false);
      assert.match(actual.errors.join("\n"), /malformed advisory leaf/);
    },
  );
}
test("malformed production audit also fails", () => {
  const input = fixture();
  input.productionAudit = {};
  assert.equal(evaluate(input).ok, false);
});
test("invalid policy, lockfile or review time fail", () => {
  for (const mutate of [
    (x) => {
      x.policy = {};
    },
    (x) => {
      x.lockfile = {};
    },
    (x) => {
      x.now = NaN;
    },
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(evaluate(input).ok, false);
  }
});
test("npm result parsing allows findings, never command/transport failures", () => {
  for (const status of [0, 1]) {
    assert.deepEqual(
      parseAuditResult({
        status,
        signal: null,
        stdout: JSON.stringify(report()),
      }),
      report(),
    );
  }
  for (const result of [
    { status: 2, stdout: "{}" },
    { status: null, signal: "SIGTERM", stdout: "{}" },
    { status: 0, error: new Error("network"), stdout: "{}" },
    { status: 0, stdout: "" },
    { status: 0, stdout: "not-json" },
  ]) {
    assert.throws(() => parseAuditResult(result), /audit command/);
  }
});
