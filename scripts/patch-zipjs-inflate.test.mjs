import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyZipjsInflatePatch,
  verifyZipjsInflatePatch,
  zipjsInflatePatch,
} from "./patch-zipjs-inflate.mjs";

const scriptPath = fileURLToPath(
  new URL("./patch-zipjs-inflate.mjs", import.meta.url),
);
const installedDecoderPath = fileURLToPath(
  new URL(
    "../node_modules/@zip.js/zip.js/lib/core/streams/zlib-js/zlib-streams.min.js",
    import.meta.url,
  ),
);
const installedText = readFileSync(installedDecoderPath, "utf8");
const originalText = installedText.includes(zipjsInflatePatch.after)
  ? installedText.replace(zipjsInflatePatch.after, zipjsInflatePatch.before)
  : installedText;
const digest = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
assert.equal(digest(originalText), zipjsInflatePatch.beforeSha256);

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zipjs-inflate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, "node_modules/@zip.js/zip.js");
  const decoderPath = path.join(
    packageRoot,
    "lib/core/streams/zlib-js/zlib-streams.min.js",
  );
  const manifestPath = path.join(packageRoot, "package.json");
  const sourcePath = path.join(root, "src/xlsx/security/zipPreflight.ts");
  const write = (file, text) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text, { encoding: "utf8" });
  };
  const manifest = {
    name: "@zip.js/zip.js",
    version: zipjsInflatePatch.version,
    exports: {
      "./package.json": "./package.json",
      "./lib/zip-core-native.js": {
        import: { default: "./lib/zip-core-native.js" },
      },
    },
  };
  write(path.join(root, "package.json"), '{"type":"module"}\n');
  write(
    sourcePath,
    'import { ZipReader } from "@zip.js/zip.js/lib/zip-core-native.js";\n',
  );
  write(manifestPath, JSON.stringify(manifest));
  write(
    path.join(packageRoot, "lib/zip-core-native.js"),
    'export * from "./zip-module-native.js";\n',
  );
  write(
    path.join(packageRoot, "lib/zip-module-native.js"),
    'import { CompressionStreamZlib, DecompressionStreamZlib } from "./core/streams/zlib-js/zlib-streams.min.js";\n',
  );
  write(decoderPath, originalText);
  return {
    root,
    packageRoot,
    decoderPath,
    manifestPath,
    sourcePath,
    manifest,
    write,
  };
}

test("applies only the missing 50-byte branch and verifies exact product decoder bytes", (t) => {
  const f = fixture(t);
  const applied = applyZipjsInflatePatch({ root: f.root });
  assert.equal(applied.applied, true);
  assert.equal(applied.version, "2.8.34");
  assert.equal(applied.sha256, zipjsInflatePatch.afterSha256);
  assert.equal(applied.decoderPath, f.decoderPath);
  const bytes = readFileSync(f.decoderPath);
  assert.equal(bytes.byteLength, Buffer.byteLength(originalText, "utf8") + 50);
  assert.equal(
    bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
    false,
  );
  assert.doesNotMatch(bytes.toString("utf8"), /[\r\n\uFFFD]/);
  assert.equal(
    bytes.toString("utf8"),
    originalText.replace(zipjsInflatePatch.before, zipjsInflatePatch.after),
  );
  assert.equal(
    verifyZipjsInflatePatch({ root: f.root }).sha256,
    applied.sha256,
  );
});

test("repeated apply and verify leave applied bytes and modification time unchanged", (t) => {
  const f = fixture(t);
  applyZipjsInflatePatch({ root: f.root });
  const bytes = readFileSync(f.decoderPath);
  const before = statSync(f.decoderPath, { bigint: true });
  assert.equal(applyZipjsInflatePatch({ root: f.root }).applied, false);
  verifyZipjsInflatePatch({ root: f.root });
  assert.deepEqual(readFileSync(f.decoderPath), bytes);
  assert.equal(
    statSync(f.decoderPath, { bigint: true }).mtimeNs,
    before.mtimeNs,
  );
});

test("verify fails without writing an unpatched decoder", (t) => {
  const f = fixture(t);
  const before = statSync(f.decoderPath, { bigint: true });
  assert.throws(
    () => verifyZipjsInflatePatch({ root: f.root }),
    /decoder is unpatched/,
  );
  assert.equal(readFileSync(f.decoderPath, "utf8"), originalText);
  assert.equal(
    statSync(f.decoderPath, { bigint: true }).mtimeNs,
    before.mtimeNs,
  );
});

test("unknown dependency version is rejected even if decoder bytes are familiar", (t) => {
  const f = fixture(t);
  f.manifest.version = "2.8.35";
  f.write(f.manifestPath, JSON.stringify(f.manifest));
  assert.throws(
    () => applyZipjsInflatePatch({ root: f.root }),
    /unsupported dependency/,
  );
  assert.equal(readFileSync(f.decoderPath, "utf8"), originalText);
});

test("unknown bytes, zero or repeated sites, BOM and line endings all fail without a write", (t) => {
  const f = fixture(t);
  for (const text of [
    `${originalText} `,
    originalText.replace(zipjsInflatePatch.before, ""),
    `${originalText}${zipjsInflatePatch.before}`,
    `\uFEFF${originalText}`,
    `${originalText}\r\n`,
  ]) {
    f.write(f.decoderPath, text);
    const bytes = readFileSync(f.decoderPath);
    const before = statSync(f.decoderPath, { bigint: true });
    for (const operation of [applyZipjsInflatePatch, verifyZipjsInflatePatch]) {
      assert.throws(
        () => operation({ root: f.root }),
        /unknown decoder SHA-256/,
      );
      assert.deepEqual(readFileSync(f.decoderPath), bytes);
      assert.equal(
        statSync(f.decoderPath, { bigint: true }).mtimeNs,
        before.mtimeNs,
      );
    }
  }
});

test("changed product import, package export and native module graph are rejected", (t) => {
  const f = fixture(t);
  const source = readFileSync(f.sourcePath, "utf8");
  f.write(f.sourcePath, source.replace("zip-core-native", "zip-core"));
  assert.throws(
    () => applyZipjsInflatePatch({ root: f.root }),
    /product import/,
  );
  f.write(f.sourcePath, source);
  f.manifest.exports["./lib/zip-core-native.js"].import.default = "./wrong.js";
  f.write(f.manifestPath, JSON.stringify(f.manifest));
  assert.throws(
    () => applyZipjsInflatePatch({ root: f.root }),
    /product module export/,
  );
  f.manifest.exports["./lib/zip-core-native.js"].import.default =
    "./lib/zip-core-native.js";
  f.write(f.manifestPath, JSON.stringify(f.manifest));
  f.write(
    path.join(f.packageRoot, "lib/zip-core-native.js"),
    'export * from "./other.js";',
  );
  assert.throws(() => applyZipjsInflatePatch({ root: f.root }), /native entry/);
  f.write(
    path.join(f.packageRoot, "lib/zip-core-native.js"),
    'export * from "./zip-module-native.js";',
  );
  f.write(
    path.join(f.packageRoot, "lib/zip-module-native.js"),
    'import "./other.js";',
  );
  assert.throws(
    () => applyZipjsInflatePatch({ root: f.root }),
    /native module/,
  );
  assert.equal(readFileSync(f.decoderPath, "utf8"), originalText);
});

test("resolves dependency from product source and rejects a shadowing nested package", (t) => {
  const f = fixture(t);
  const nested = path.join(
    f.root,
    "src/xlsx/node_modules/@zip.js/zip.js/package.json",
  );
  f.write(nested, JSON.stringify({ ...f.manifest, version: "0.0.0" }));
  assert.throws(
    () => applyZipjsInflatePatch({ root: f.root }),
    /unsupported dependency.*0\.0\.0/,
  );
  assert.equal(readFileSync(f.decoderPath, "utf8"), originalText);
});

test("CLI apply/verify work outside the repository cwd, invalid usage and unpatched verify fail", (t) => {
  const f = fixture(t);
  const cli = path.join(f.root, "scripts/patch-zipjs-inflate.mjs");
  f.write(cli, readFileSync(scriptPath, "utf8"));
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: os.tmpdir(),
      encoding: "utf8",
    });
  assert.equal(run("verify").status, 1);
  assert.equal(readFileSync(f.decoderPath, "utf8"), originalText);
  assert.equal(run("apply").status, 0);
  assert.equal(run("verify").status, 0);
  const wrong = run("apply", "unexpected");
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /usage:/);
  assert.equal(
    digest(readFileSync(f.decoderPath, "utf8")),
    zipjsInflatePatch.afterSha256,
  );
});
