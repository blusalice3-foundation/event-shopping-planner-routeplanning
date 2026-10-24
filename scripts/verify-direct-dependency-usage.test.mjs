import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const verifier = path.join(
  repositoryRoot,
  "scripts",
  "verify-direct-dependency-usage.mjs",
);

const writeJson = (file, value) =>
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const createFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dependency-usage-"));
  await Promise.all([
    mkdir(path.join(root, "config"), { recursive: true }),
    mkdir(path.join(root, "src"), { recursive: true }),
    mkdir(path.join(root, "node_modules", "foo"), { recursive: true }),
    mkdir(path.join(root, "node_modules", "tool"), { recursive: true }),
  ]);
  await Promise.all([
    writeJson(path.join(root, "package.json"), {
      scripts: { lint: "tool ." },
      dependencies: { foo: "1.0.0" },
      devDependencies: { tool: "2.0.0" },
    }),
    writeJson(path.join(root, "node_modules", "foo", "package.json"), {
      name: "foo",
      version: "1.0.0",
    }),
    writeJson(path.join(root, "node_modules", "tool", "package.json"), {
      name: "tool",
      version: "2.0.0",
      bin: { tool: "bin/tool.js" },
    }),
    writeFile(path.join(root, "src", "app.js"), 'import "foo";\n', "utf8"),
    writeJson(path.join(root, "config", "direct-dependency-usage.json"), {
      schemaVersion: 1,
      graphs: {
        productionRoots: ["src/app.js"],
        buildConfigRoots: [],
        testSetupRoots: [],
      },
      packages: {
        foo: {
          scope: "dependencies",
          evidence: [
            {
              kind: "module-import",
              graph: "production",
              file: "src/app.js",
              specifier: "foo",
            },
          ],
        },
        tool: {
          scope: "devDependencies",
          evidence: [{ kind: "cli", script: "lint", binary: "tool" }],
        },
      },
    }),
  ]);
  return root;
};

const runVerifier = (root) =>
  spawnSync(process.execPath, [verifier, "--root", root], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

test("accepts reachable module and package-owned CLI evidence", async () => {
  const root = await createFixture();
  try {
    const result = runVerifier(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 known, 0 unknown, 0 unused/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when a direct dependency has no policy entry", async () => {
  const root = await createFixture();
  try {
    const packagePath = path.join(root, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    packageJson.dependencies.bar = "1.0.0";
    await writeJson(packagePath, packageJson);
    const result = runVerifier(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown direct dependencies.*bar/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an import that exists only in an orphan file", async () => {
  const root = await createFixture();
  try {
    await writeFile(
      path.join(root, "src", "orphan.js"),
      'import "foo";\n',
      "utf8",
    );
    const policyPath = path.join(
      root,
      "config",
      "direct-dependency-usage.json",
    );
    const policy = JSON.parse(await readFile(policyPath, "utf8"));
    policy.packages.foo.evidence[0].file = "src/orphan.js";
    await writeJson(policyPath, policy);
    const result = runVerifier(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /orphan\.js is not reachable in production/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a CLI claim when the package does not own that binary", async () => {
  const root = await createFixture();
  try {
    await writeJson(path.join(root, "node_modules", "tool", "package.json"), {
      name: "tool",
      version: "2.0.0",
      bin: { other: "bin/other.js" },
    });
    const result = runVerifier(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tool does not own CLI tool/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a direct dependency with empty evidence", async () => {
  const root = await createFixture();
  try {
    const policyPath = path.join(
      root,
      "config",
      "direct-dependency-usage.json",
    );
    const policy = JSON.parse(await readFile(policyPath, "utf8"));
    policy.packages.tool.evidence = [];
    await writeJson(policyPath, policy);
    const result = runVerifier(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /evidence must not be empty/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const createDelegatedBrowserFixture = async () => {
  const root = await createFixture();
  await Promise.all([
    mkdir(path.join(root, "node_modules", "@playwright", "test"), {
      recursive: true,
    }),
    mkdir(path.join(root, "scripts"), { recursive: true }),
  ]);
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  packageJson.scripts["test:browser"] =
    "node scripts/browser-runner.mjs --phase after";
  packageJson.scripts["test:shopping-performance:run"] =
    "node scripts/browser-preflight.mjs && playwright test --workers=1 --retries=0";
  packageJson.devDependencies["@playwright/test"] = "1.0.0";
  await writeJson(packagePath, packageJson);
  await Promise.all([
    writeJson(
      path.join(root, "node_modules", "@playwright", "test", "package.json"),
      {
        name: "@playwright/test",
        version: "1.0.0",
        bin: { playwright: "cli.js" },
      },
    ),
    writeFile(
      path.join(root, "scripts", "browser-runner.mjs"),
      "export {};\n",
      "utf8",
    ),
    writeFile(
      path.join(root, "scripts", "browser-preflight.mjs"),
      "export {};\n",
      "utf8",
    ),
    writeFile(
      path.join(root, "playwright.config.ts"),
      'import { defineConfig } from "@playwright/test";\nexport default defineConfig({});\n',
      "utf8",
    ),
  ]);
  const policyPath = path.join(root, "config", "direct-dependency-usage.json");
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  policy.graphs.buildConfigRoots.push({
    file: "playwright.config.ts",
    loaderPackage: "@playwright/test",
    loaderScript: "test:shopping-performance:run",
    loaderBinary: "playwright",
  });
  policy.packages["@playwright/test"] = {
    scope: "devDependencies",
    evidence: [
      {
        kind: "cli",
        script: "test:shopping-performance:run",
        binary: "playwright",
      },
      {
        kind: "module-import",
        graph: "build",
        file: "playwright.config.ts",
        specifier: "@playwright/test",
      },
    ],
  };
  policy.packages = Object.fromEntries(
    Object.entries(policy.packages).sort(([left], [right]) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    ),
  );
  await writeJson(policyPath, policy);
  return root;
};

test("accepts the direct Playwright child loader when the normal browser script delegates to a runner", async (t) => {
  const root = await createDelegatedBrowserFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = runVerifier(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /3 known, 0 unknown, 0 unused/);
});

test("does not accept the node wrapper as direct Playwright loader or CLI evidence", async (t) => {
  const root = await createDelegatedBrowserFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const policyPath = path.join(root, "config", "direct-dependency-usage.json");
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  policy.graphs.buildConfigRoots[0].loaderScript = "test:browser";
  policy.packages["@playwright/test"].evidence[0].script = "test:browser";
  await writeJson(policyPath, policy);
  const result = runVerifier(root);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /unsupported or mismatched default loader binding/,
  );
  assert.match(
    result.stderr,
    /package script test:browser does not invoke playwright/,
  );
});

test("rejects both the config loader and CLI claim when the child no longer invokes Playwright", async (t) => {
  const root = await createDelegatedBrowserFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  packageJson.scripts["test:shopping-performance:run"] =
    "node scripts/browser-preflight.mjs";
  await writeJson(packagePath, packageJson);
  const result = runVerifier(root);
  assert.notEqual(result.status, 0);
  const rejectedClaims =
    result.stderr.match(
      /package script test:shopping-performance:run does not invoke playwright/g,
    ) ?? [];
  assert.equal(rejectedClaims.length, 2, result.stderr);
});
