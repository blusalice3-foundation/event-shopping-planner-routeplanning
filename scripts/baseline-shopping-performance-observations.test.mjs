import assert from "node:assert/strict";
import test from "node:test";
import {
  validateBaselineNoopObservation,
  validateBaselineProductObservation,
} from "./baseline-shopping-performance-observations.mjs";

const source = "67743821a278c22b38f43fc918d443c581d748cb";
const proof = () => ({
  phase: "before",
  sourceCommit: source,
  referenceProductCommit: "200cd7564772a17e2264907ae22e9a93ad30f5dc",
  sourceTree: "4155d4dc250e69b16be9a0455bd99a208b9f8d93",
  publicTree: "90071a462092c45bc3ae11df5e696a053fc8a1ed",
  sourceState: "clean",
});
function artifact(kind = "response") {
  const names = kind === "frame" ? ["frame"] : ["response", "nextApplied"];
  const data = {
    group: "transfer",
    phase: "before",
    runId: "baseline-run",
    measurementKind: kind,
    condition: { scenario: "noop" },
    baselineComparisonObservation: proof(),
    metrics: Object.fromEntries(
      names.map((name) => [name, { raw: [], samples: [] }]),
    ),
    postconditionErrors: [],
    persistence: { writeCount: 0, operationId: null, commits: [], samples: [] },
  };
  for (let index = 0; index < 20; index++) {
    const count = index === 1 ? 0 : index === 2 ? 2 : 1;
    const startEpoch = 1000 + index * 100;
    const commits = Array.from({ length: count }, (_, ordinal) => ({
      at: startEpoch + 10 + ordinal * 5,
      stores: ["eventLists", "syncQueue"],
      writes: [{ store: "eventLists", method: "put" }],
      ...(index === 3 ? {} : { operationId: `op-${index}-${ordinal}` }),
    }));
    const common = {
      measurementId: `measurement-${index + 1}`,
      targetId: "e0",
      startEpoch,
      physicalWriteCount: count,
      operationId: count === 1 && index !== 3 ? commits[0].operationId : null,
      ...(count > 1 || index === 3
        ? {
            operationIdUnavailableReason:
              count > 1
                ? "Multiple transactions cannot be attributed to one operation ID"
                : "No operation ID was exposed",
          }
        : {}),
      commits,
      postconditionErrors: [],
      trusted: true,
    };
    if (count) {
      const record = {
        measurementId: common.measurementId,
        sampleIndex: index + 1,
        code: "unexpected-noop-write",
        itemIds: ["e0"],
        message: `Observed ${count} unexpected transactions`,
        expectedWriteCount: 0,
        actualWriteCount: count,
      };
      data.postconditionErrors.push(record);
      common.postconditionErrors = [record];
    }
    for (const name of names) {
      const sample = structuredClone({
        ...common,
        durationMs: name === "nextApplied" ? 5 : 30,
        ...(name === "nextApplied"
          ? {
              targetId: "e4",
              trusted: true,
              matched: true,
              eventEpoch: startEpoch + 50,
            }
          : {}),
      });
      data.metrics[name].samples.push(sample);
      data.metrics[name].raw.push(sample.durationMs);
    }
    data.persistence.samples.push({
      sampleIndex: index + 1,
      measurementId: common.measurementId,
      physicalWriteCount: count,
      operationId: common.operationId,
      commits: structuredClone(commits),
    });
    data.persistence.commits.push(...structuredClone(commits));
    data.persistence.writeCount += count;
  }
  return data;
}
const identity = {
  productCommit: source,
  runId: "baseline-run",
  phase: "before",
  group: "transfer",
};
const primary = (data) =>
  data.metrics[data.measurementKind === "frame" ? "frame" : "response"].samples;
const eachMetric = (data, index, change) => {
  for (const metric of Object.values(data.metrics))
    change(metric.samples[index]);
};

test("validates exact clean baseline product identity and binds an instrumented source commit", () => {
  const value = proof();
  assert.equal(validateBaselineProductObservation(value, source), value);
  assert.equal(validateBaselineProductObservation(value), value);
  assert.throws(
    () =>
      validateBaselineProductObservation(
        value,
        "200cd7564772a17e2264907ae22e9a93ad30f5dc",
      ),
    /source commit/,
  );
});
for (const [label, change] of [
  [
    "after phase",
    (value) => {
      value.phase = "after";
    },
  ],
  [
    "dirty source",
    (value) => {
      value.sourceState = "dirty";
    },
  ],
  [
    "wrong reference",
    (value) => {
      value.referenceProductCommit = source;
    },
  ],
  [
    "changed product tree",
    (value) => {
      value.sourceTree = "f".repeat(40);
    },
  ],
  [
    "changed public tree",
    (value) => {
      value.publicTree = "f".repeat(40);
    },
  ],
  [
    "malformed source commit",
    (value) => {
      value.sourceCommit = "6774382";
    },
  ],
  [
    "missing source tree",
    (value) => {
      delete value.sourceTree;
    },
  ],
  [
    "unknown proof field",
    (value) => {
      value.acceptance = true;
    },
  ],
])
  test(`product proof rejects ${label}`, () => {
    const value = proof();
    change(value);
    assert.throws(() => validateBaselineProductObservation(value));
  });

for (const kind of ["response", "frame"])
  test(`retains all actual baseline noop writes for ${kind} without mutating the artifact`, () => {
    const data = artifact(kind),
      original = structuredClone(data);
    const records = validateBaselineNoopObservation(data, identity);
    assert.equal(records.size, 19);
    assert.equal(records.get("measurement-1"), data.postconditionErrors[0]);
    assert.equal(records.has("measurement-2"), false);
    assert.equal(records.get("measurement-3").actualWriteCount, 2);
    assert.deepEqual(data, original);
  });

test("a complete zero-write before observation produces no write exceptions", () => {
  const data = artifact();
  data.postconditionErrors = [];
  for (const metric of Object.values(data.metrics))
    for (const sample of metric.samples) {
      sample.commits = [];
      sample.physicalWriteCount = 0;
      sample.operationId = null;
      delete sample.operationIdUnavailableReason;
      sample.postconditionErrors = [];
    }
  for (const sample of data.persistence.samples) {
    sample.commits = [];
    sample.physicalWriteCount = 0;
    sample.operationId = null;
  }
  data.persistence.writeCount = 0;
  data.persistence.commits = [];
  assert.equal(validateBaselineNoopObservation(data, identity).size, 0);
});

for (const [label, change] of [
  [
    "after artifact",
    (data) => {
      data.phase = "after";
    },
  ],
  [
    "different group",
    (data) => {
      data.group = "shopping";
    },
  ],
  [
    "same-column saving scenario",
    (data) => {
      data.condition.scenario = "same-column";
    },
  ],
  [
    "single saving scenario",
    (data) => {
      data.condition.scenario = "single";
    },
  ],
  [
    "cancel scenario",
    (data) => {
      data.condition.scenario = "cancel";
    },
  ],
  [
    "missing before proof",
    (data) => {
      delete data.baselineComparisonObservation;
    },
  ],
  [
    "wrong product source",
    (data) => {
      data.baselineComparisonObservation.sourceTree = "a".repeat(40);
    },
  ],
  [
    "missing run ID",
    (data) => {
      delete data.runId;
    },
  ],
  [
    "missing response metric",
    (data) => {
      delete data.metrics.response;
    },
  ],
  [
    "missing next-input metric",
    (data) => {
      delete data.metrics.nextApplied;
    },
  ],
  [
    "invented save metric",
    (data) => {
      data.metrics.save = structuredClone(data.metrics.response);
    },
  ],
  [
    "partial primary samples",
    (data) => {
      data.metrics.response.samples.pop();
    },
  ],
  [
    "partial secondary samples",
    (data) => {
      data.metrics.nextApplied.samples.pop();
    },
  ],
  [
    "partial clock values",
    (data) => {
      data.metrics.response.raw.pop();
    },
  ],
  [
    "changed raw clock",
    (data) => {
      data.metrics.response.raw[0] = 99;
    },
  ],
  [
    "duplicate measurement ID",
    (data) => {
      data.metrics.response.samples[1].measurementId = "measurement-1";
    },
  ],
  [
    "metric ID mismatch",
    (data) => {
      data.metrics.nextApplied.samples[0].measurementId = "foreign";
    },
  ],
  [
    "reordered metric samples",
    (data) => {
      data.metrics.nextApplied.samples.reverse();
    },
  ],
  [
    "explicit metric ordinal mismatch",
    (data) => {
      primary(data)[0].sampleIndex = 2;
    },
  ],
  [
    "missing functional record",
    (data) => {
      data.postconditionErrors.shift();
    },
  ],
  [
    "duplicate functional record",
    (data) => {
      data.postconditionErrors.push(
        structuredClone(data.postconditionErrors[0]),
      );
    },
  ],
  [
    "zero-write failure record",
    (data) => {
      data.postconditionErrors[0].sampleIndex = 2;
      data.postconditionErrors[0].measurementId = "measurement-2";
    },
  ],
  [
    "out-of-range ordinal",
    (data) => {
      data.postconditionErrors[0].sampleIndex = 21;
    },
  ],
  [
    "wrong record target",
    (data) => {
      data.postconditionErrors[0].itemIds = ["e4"];
    },
  ],
  [
    "extra record target",
    (data) => {
      data.postconditionErrors[0].itemIds.push("e1");
    },
  ],
  [
    "wrong postcondition code",
    (data) => {
      data.postconditionErrors[0].code = "selection-not-consumed";
    },
  ],
  [
    "wrong expected write count",
    (data) => {
      data.postconditionErrors[0].expectedWriteCount = 1;
    },
  ],
  [
    "wrong actual write count",
    (data) => {
      data.postconditionErrors[0].actualWriteCount = 2;
    },
  ],
  [
    "unknown record field",
    (data) => {
      data.postconditionErrors[0].allow = true;
    },
  ],
  [
    "missing record message",
    (data) => {
      delete data.postconditionErrors[0].message;
    },
  ],
  [
    "sample-only postcondition",
    (data) => {
      data.postconditionErrors = [];
    },
  ],
  [
    "missing sample postconditions",
    (data) => {
      delete primary(data)[0].postconditionErrors;
    },
  ],
  [
    "sample postconditions disagree",
    (data) => {
      data.metrics.nextApplied.samples[0].postconditionErrors = [];
    },
  ],
  [
    "fake physical count zero",
    (data) => {
      eachMetric(data, 0, (sample) => {
        sample.physicalWriteCount = 0;
      });
    },
  ],
  [
    "pre-input transaction",
    (data) => {
      eachMetric(data, 0, (sample) => {
        sample.commits[0].at = sample.startEpoch - 1;
      });
    },
  ],
  [
    "invalid transaction timestamp",
    (data) => {
      eachMetric(data, 0, (sample) => {
        sample.commits[0].at = null;
      });
    },
  ],
  [
    "invalid transaction structure",
    (data) => {
      eachMetric(data, 0, (sample) => {
        delete sample.commits[0].writes;
      });
    },
  ],
  [
    "metric input start mismatch",
    (data) => {
      data.metrics.nextApplied.samples[0].startEpoch += 1;
    },
  ],
  [
    "metric commit mismatch",
    (data) => {
      data.metrics.nextApplied.samples[0].commits[0].at += 1;
    },
  ],
  [
    "sole operation ID mismatch",
    (data) => {
      eachMetric(data, 0, (sample) => {
        sample.operationId = "fabricated";
      });
    },
  ],
  [
    "zero-write operation ID",
    (data) => {
      eachMetric(data, 1, (sample) => {
        sample.operationId = "fabricated";
      });
    },
  ],
  [
    "multiple transactions flattened into one ID",
    (data) => {
      eachMetric(data, 2, (sample) => {
        sample.operationId = sample.commits[0].operationId;
      });
    },
  ],
  [
    "missing multiple-ID reason",
    (data) => {
      eachMetric(data, 2, (sample) => {
        delete sample.operationIdUnavailableReason;
      });
    },
  ],
  [
    "missing sole-ID reason",
    (data) => {
      eachMetric(data, 3, (sample) => {
        delete sample.operationIdUnavailableReason;
      });
    },
  ],
  [
    "untrusted next input",
    (data) => {
      data.metrics.nextApplied.samples[0].trusted = false;
    },
  ],
  [
    "wrong next input",
    (data) => {
      data.metrics.nextApplied.samples[0].matched = false;
    },
  ],
  [
    "next input preceding any actual commit",
    (data) => {
      data.metrics.nextApplied.samples[2].eventEpoch =
        primary(data)[2].commits[0].at + 1;
    },
  ],
  [
    "next input before zero-write cleanup",
    (data) => {
      data.metrics.nextApplied.samples[1].eventEpoch =
        primary(data)[1].startEpoch;
    },
  ],
  [
    "fake aggregate zeros",
    (data) => {
      data.persistence.writeCount = 0;
      data.persistence.commits = [];
    },
  ],
  [
    "missing physical samples",
    (data) => {
      delete data.persistence.samples;
    },
  ],
  [
    "partial physical samples",
    (data) => {
      data.persistence.samples.pop();
    },
  ],
  [
    "physical sample order mismatch",
    (data) => {
      data.persistence.samples.reverse();
    },
  ],
  [
    "physical measurement ID mismatch",
    (data) => {
      data.persistence.samples[0].measurementId = "foreign";
    },
  ],
  [
    "physical operation ID mismatch",
    (data) => {
      data.persistence.samples[0].operationId = null;
    },
  ],
  [
    "physical count mismatch",
    (data) => {
      data.persistence.samples[0].physicalWriteCount = 0;
    },
  ],
  [
    "physical commit mismatch",
    (data) => {
      data.persistence.samples[0].commits[0].at += 1;
    },
  ],
  [
    "physical unknown field",
    (data) => {
      data.persistence.samples[0].synthetic = true;
    },
  ],
  [
    "aggregate operation ID",
    (data) => {
      data.persistence.operationId = "fabricated";
    },
  ],
  [
    "aggregate count mismatch",
    (data) => {
      data.persistence.writeCount += 1;
    },
  ],
  [
    "aggregate drops one commit",
    (data) => {
      data.persistence.commits.pop();
    },
  ],
])
  test(`baseline noop observation rejects ${label}`, () => {
    const data = artifact();
    change(data);
    assert.throws(() => validateBaselineNoopObservation(data, identity));
  });

test("source binding and every declared comparison identity are enforced", () => {
  const data = artifact();
  assert.throws(
    () =>
      validateBaselineNoopObservation(data, {
        ...identity,
        productCommit: "f".repeat(40),
      }),
    /source commit/,
  );
  assert.throws(
    () => validateBaselineNoopObservation(data, { ...identity, group: "drag" }),
    /group/,
  );
  assert.throws(
    () =>
      validateBaselineNoopObservation(data, { ...identity, phase: "after" }),
    /phase/,
  );
  assert.throws(
    () =>
      validateBaselineNoopObservation(data, { ...identity, runId: "foreign" }),
    /runId/,
  );
});

test("next-input clock follows the maximum actual transaction timestamp, not just the final array entry", () => {
  const data = artifact();
  eachMetric(data, 2, (sample) => {
    sample.commits.reverse();
  });
  data.persistence.samples[2].commits.reverse();
  data.persistence.commits = data.persistence.samples.flatMap(
    (sample) => sample.commits,
  );
  data.metrics.nextApplied.samples[2].eventEpoch =
    primary(data)[2].commits[1].at + 1;
  assert.throws(
    () => validateBaselineNoopObservation(data, identity),
    /every actual transaction/,
  );
});
