const severities = ["info", "low", "moderate", "high", "critical"];
const blocking = new Set(["high", "critical"]);
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const advisoryId = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
const advisoryUrl =
  /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/;
const uniqueStrings = (values) =>
  Array.isArray(values) &&
  values.length > 0 &&
  values.every(nonempty) &&
  new Set(values).size === values.length;

const packageAtPath = (value) => {
  if (typeof value !== "string") return null;
  const pieces = value.split("/node_modules/");
  const names = [pieces[0].replace(/^node_modules\//, ""), ...pieces.slice(1)];
  return value.startsWith("node_modules/") &&
    names.every((name) => packageName.test(name))
    ? names.at(-1)
    : null;
};

const validExpiry = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const time = Date.parse(value + "T00:00:00Z");
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
};

const matchesAdvisory = (expected, actual) =>
  advisoryId.test(expected)
    ? advisoryUrl.exec(actual)?.[1] === expected
    : expected === actual;

// Only npm's findings exit code (1), and a successful invocation (0), are
// admissible. A transport/process failure is never an empty, clean report.
export const parseAuditResult = (result, label = "npm audit") => {
  if (
    !isRecord(result) ||
    result.error ||
    result.signal != null ||
    ![0, 1].includes(result.status)
  ) {
    throw new Error(label + ": audit command failed");
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(label + ": audit command did not return JSON");
  }
};

const inspectReport = (report, label, errors) => {
  const firstError = errors.length;
  if (
    !isRecord(report) ||
    report.auditReportVersion !== 2 ||
    Object.hasOwn(report, "error") ||
    !isRecord(report.vulnerabilities) ||
    !isRecord(report.metadata?.vulnerabilities)
  ) {
    errors.push(label + ": malformed or failed npm audit report");
    return null;
  }
  const counts = report.metadata.vulnerabilities;
  for (const key of [...severities, "total"]) {
    if (!Number.isSafeInteger(counts[key]) || counts[key] < 0) {
      errors.push(label + ": invalid vulnerability count " + key);
    }
  }
  const actual = Object.fromEntries(severities.map((key) => [key, 0]));
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (
      !packageName.test(name) ||
      !isRecord(vulnerability) ||
      vulnerability.name !== name ||
      !severities.includes(vulnerability.severity) ||
      !uniqueStrings(vulnerability.nodes) ||
      !vulnerability.nodes.every((node) => packageAtPath(node) === name) ||
      !Array.isArray(vulnerability.via) ||
      vulnerability.via.length === 0
    ) {
      errors.push(label + ": malformed vulnerability " + name);
      continue;
    }
    actual[vulnerability.severity] += 1;
    for (const via of vulnerability.via) {
      if (typeof via === "string") {
        if (!Object.hasOwn(report.vulnerabilities, via)) {
          errors.push(
            label + ": unresolved advisory dependency " + name + " -> " + via,
          );
        }
      } else if (
        !isRecord(via) ||
        via.name !== name ||
        via.dependency !== name ||
        !severities.includes(via.severity) ||
        severities.indexOf(via.severity) >
          severities.indexOf(vulnerability.severity) ||
        !nonempty(via.url) ||
        !via.url.startsWith("https://")
      ) {
        errors.push(label + ": malformed advisory leaf for " + name);
      }
    }
  }
  if (
    severities.some((key) => actual[key] !== counts[key]) ||
    severities.reduce((sum, key) => sum + counts[key], 0) !== counts.total
  ) {
    errors.push(label + ": vulnerability metadata does not match findings");
  }
  return errors.length === firstError ? counts : null;
};

// No I/O: callers supply the two original audit reports and the lockfile.
// Lower-severity findings remain visible and do not need a waiver. Graphs
// reachable from blocking findings must be complete, acyclic, and reviewable.
export const evaluateAuditPolicy = ({
  policy,
  lockfile,
  allAudit,
  productionAudit,
  now = Date.now(),
} = {}) => {
  const errors = [];
  const all = inspectReport(allAudit, "all", errors);
  const production = inspectReport(productionAudit, "production", errors);
  const reviewedWaivers = [];
  const waivedPackages = [];
  const result = () => ({
    ok: errors.length === 0,
    errors,
    counts: { all, production },
    reviewedWaivers,
    waivedPackages,
  });
  if (
    !isRecord(policy) ||
    policy.schemaVersion !== 1 ||
    !Array.isArray(policy.waivers)
  ) {
    errors.push("Malformed audit waiver policy");
  }
  if (
    !isRecord(lockfile) ||
    lockfile.lockfileVersion !== 3 ||
    !isRecord(lockfile.packages) ||
    !isRecord(lockfile.packages[""])
  ) {
    errors.push("Malformed npm lockfile");
  }
  if (!Number.isFinite(now)) errors.push("Invalid audit review time");
  if (errors.length > 0) return result();

  const active = new Map();
  const ids = new Set();
  for (const waiver of policy.waivers) {
    const firstError = errors.length;
    if (!isRecord(waiver)) {
      errors.push("Malformed audit waiver");
      continue;
    }
    const label = nonempty(waiver.id) ? waiver.id : "unknown waiver";
    for (const field of [
      "id",
      "advisory",
      "severity",
      "owner",
      "reason",
      "expiry",
      "mitigation",
      "installedPackage",
      "installedVersion",
    ]) {
      if (!nonempty(waiver[field])) errors.push(label + ": missing " + field);
    }
    if (ids.has(waiver.id)) errors.push(label + ": duplicate waiver id");
    ids.add(waiver.id);
    if (
      !advisoryId.test(waiver.advisory) &&
      !advisoryUrl.test(waiver.advisory)
    ) {
      errors.push(
        label + ": advisory must be an exact GitHub advisory URL or GHSA id",
      );
    }
    if (waiver.severity !== "high") {
      errors.push(
        label + ": only reviewed high findings can be waived; never critical",
      );
    }
    if (
      !validExpiry(waiver.expiry) ||
      Date.parse(waiver.expiry + "T00:00:00Z") <= now
    ) {
      errors.push(label + ": audit waiver expiry is invalid or expired");
    }
    const anchorPath = "node_modules/" + waiver.installedPackage;
    const anchor = lockfile.packages[anchorPath];
    if (
      !packageName.test(waiver.installedPackage) ||
      !exactVersion.test(waiver.installedVersion) ||
      anchor?.version !== waiver.installedVersion ||
      anchor.dev !== true ||
      anchor.link === true
    ) {
      errors.push(label + ": installed package/version/dev binding differs");
    }
    if (
      !isRecord(waiver.reachability) ||
      Object.keys(waiver.reachability).length === 0 ||
      Object.entries(waiver.reachability).some(
        ([graph, description]) => !nonempty(graph) || !nonempty(description),
      )
    ) {
      errors.push(label + ": reachability descriptions are missing");
    }
    if (
      !uniqueStrings(waiver.affectedPackages) ||
      !waiver.affectedPackages.every((name) => packageName.test(name))
    ) {
      errors.push(label + ": affectedPackages must be unique package names");
      continue;
    }
    if (!waiver.affectedPackages.includes(waiver.installedPackage)) {
      errors.push(label + ": installed package must be in affectedPackages");
    }
    const expectedPaths = new Set();
    for (const name of waiver.affectedPackages) {
      if (active.has(name))
        errors.push(label + ": overlapping waiver for " + name);
      const vulnerability = allAudit.vulnerabilities[name];
      if (vulnerability?.severity !== "high") {
        errors.push(
          label + ": affected package is not a current high finding: " + name,
        );
        continue;
      }
      for (const node of vulnerability.nodes) expectedPaths.add(node);
    }
    const pinnedPaths = new Set();
    if (
      !Array.isArray(waiver.lockedDependencies) ||
      waiver.lockedDependencies.length === 0
    ) {
      errors.push(label + ": lockedDependencies are missing");
    } else {
      for (const pin of waiver.lockedDependencies) {
        if (
          !isRecord(pin) ||
          packageAtPath(pin.path) === null ||
          !exactVersion.test(pin.version) ||
          pinnedPaths.has(pin.path)
        ) {
          errors.push(label + ": malformed or duplicate locked dependency");
          continue;
        }
        pinnedPaths.add(pin.path);
        const locked = lockfile.packages[pin.path];
        if (
          locked?.version !== pin.version ||
          locked.dev !== true ||
          locked.link === true
        ) {
          errors.push(
            label + ": locked dependency version/dev differs: " + pin.path,
          );
        }
      }
    }
    if (
      expectedPaths.size !== pinnedPaths.size ||
      [...expectedPaths].some((node) => !pinnedPaths.has(node)) ||
      !pinnedPaths.has(anchorPath)
    ) {
      errors.push(
        label +
          ": lockedDependencies must exactly cover all affected audit nodes",
      );
    }
    if (errors.length === firstError) {
      for (const name of waiver.affectedPackages) active.set(name, waiver);
      reviewedWaivers.push({
        id: waiver.id,
        advisory: waiver.advisory,
        severity: waiver.severity,
        installedPackage: waiver.installedPackage,
        installedVersion: waiver.installedVersion,
        expiry: waiver.expiry,
      });
    }
  }

  const blockingLeaves = (name, trail = []) => {
    if (trail.includes(name)) {
      errors.push(
        "Advisory dependency cycle: " + [...trail, name].join(" -> "),
      );
      return [];
    }
    const vulnerability = allAudit.vulnerabilities[name];
    if (!vulnerability) {
      errors.push("Unresolved advisory dependency: " + name);
      return [];
    }
    return vulnerability.via.flatMap((via) =>
      typeof via === "string"
        ? blockingLeaves(via, [...trail, name])
        : blocking.has(via.severity)
          ? [via]
          : [],
    );
  };

  for (const [name, vulnerability] of Object.entries(
    allAudit.vulnerabilities,
  )) {
    if (!blocking.has(vulnerability.severity)) continue;
    const leaves = blockingLeaves(name);
    if (vulnerability.severity === "critical") {
      errors.push(name + ": critical findings can never be waived");
      continue;
    }
    const waiver = active.get(name);
    if (
      !waiver ||
      leaves.length === 0 ||
      leaves.some(
        (leaf) =>
          leaf.severity !== "high" ||
          !matchesAdvisory(waiver.advisory, leaf.url),
      )
    ) {
      errors.push(
        name + ": unwaived high advisory or changed advisory/severity",
      );
    } else {
      waivedPackages.push(name);
    }
  }
  for (const [name, vulnerability] of Object.entries(
    productionAudit.vulnerabilities,
  )) {
    if (blocking.has(vulnerability.severity)) {
      errors.push(
        name +
          ": reachable production " +
          vulnerability.severity +
          " vulnerability",
      );
    }
  }
  return result();
};
