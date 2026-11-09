#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const productSpecifier = "@zip.js/zip.js/lib/zip-core-native.js";
const decoderRelativePath = "lib/core/streams/zlib-js/zlib-streams.min.js";

export const zipjsInflatePatch = Object.freeze({
  version: "2.8.34",
  upstreamCommit: "6c859810aadd52b7036f7e34bf2dbd411f9b12fb",
  beforeSha256:
    "bde6b11d9332b355ab68556f164932c11e08f6a29b89e0de232483ec7ad625a8",
  afterSha256:
    "d0c477ce6f1d2b1d7e262088a57d7fd908bedde6cd325ed5d411a48be3c2a3a9",
  before:
    "if(t-=e,z=0,v<t){for(let e=0;e<v;++e)l[f++]=o[z++];t-=v,z=f-y}}else{",
  after:
    "if(t-=e,z=0,v<t){for(let e=0;e<v;++e)l[f++]=o[z++];t-=v,z=f-y}else{for(let e=0;e<t;++e)l[f++]=o[z++];continue e}}else{",
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => {
  throw new Error(`zip.js inflate patch: ${message}`);
};

function readUtf8(file) {
  const bytes = readFileSync(file);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// Resolve from the importing product source, rather than assuming the package in
// this script's nearest node_modules is the dependency used by the application.
function resolveDecoder(root) {
  const productSource = path.resolve(root, "src/xlsx/security/zipPreflight.ts");
  if (
    !/\bfrom\s+["']@zip\.js\/zip\.js\/lib\/zip-core-native\.js["']/.test(
      readUtf8(productSource),
    )
  ) {
    fail(`product import no longer references ${productSpecifier}`);
  }
  const requireFromProduct = createRequire(pathToFileURL(productSource));
  const manifestPath = requireFromProduct.resolve(
    "@zip.js/zip.js/package.json",
  );
  const manifest = JSON.parse(readUtf8(manifestPath));
  if (
    manifest.name !== "@zip.js/zip.js" ||
    manifest.version !== zipjsInflatePatch.version
  ) {
    fail(`unsupported dependency ${manifest.name}@${manifest.version}`);
  }
  const productExport =
    manifest.exports?.["./lib/zip-core-native.js"]?.import?.default;
  if (productExport !== "./lib/zip-core-native.js") {
    fail("product module export has changed");
  }
  const packageRoot = path.dirname(realpathSync(manifestPath));
  const entryPath = path.resolve(packageRoot, productExport);
  if (
    !/\bexport\s+\*\s+from\s+["']\.\/zip-module-native\.js["']/.test(
      readUtf8(entryPath),
    )
  ) {
    fail("native entry no longer exports zip-module-native.js");
  }
  const modulePath = path.join(packageRoot, "lib/zip-module-native.js");
  if (
    !/\bimport\s*\{[^}]*\bDecompressionStreamZlib\b[^}]*\}\s*from\s*["']\.\/core\/streams\/zlib-js\/zlib-streams\.min\.js["']/.test(
      readUtf8(modulePath),
    )
  ) {
    fail("native module no longer imports the expected JS decoder");
  }
  return path.join(packageRoot, decoderRelativePath);
}

function inspectDecoder(root) {
  const decoderPath = resolveDecoder(root);
  const bytes = readFileSync(decoderPath);
  const hash = sha256(bytes);
  if (
    hash !== zipjsInflatePatch.beforeSha256 &&
    hash !== zipjsInflatePatch.afterSha256
  ) {
    fail(`unknown decoder SHA-256 ${hash}; dependency was not modified`);
  }
  // Hashes fix the exact published bytes; retain the explicit format contract so
  // an eventual update cannot accidentally introduce a BOM or line endings.
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (
    bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ||
    /[\r\n\uFFFD]/.test(text)
  ) {
    fail("decoder must be strict UTF-8 without BOM, replacement or newlines");
  }
  return { decoderPath, sha256: hash, text };
}

/** @param {{ root?: string }} [options] */
export function verifyZipjsInflatePatch({ root = repositoryRoot } = {}) {
  const inspected = inspectDecoder(root);
  if (inspected.sha256 !== zipjsInflatePatch.afterSha256) {
    fail(
      "decoder is unpatched; run npm run patch:zipjs-inflate before development, builds or decompression tests",
    );
  }
  return {
    version: zipjsInflatePatch.version,
    decoderPath: inspected.decoderPath,
    sha256: inspected.sha256,
    applied: false,
  };
}

/** @param {{ root?: string }} [options] */
export function applyZipjsInflatePatch({ root = repositoryRoot } = {}) {
  const inspected = inspectDecoder(root);
  if (inspected.sha256 === zipjsInflatePatch.afterSha256) {
    return verifyZipjsInflatePatch({ root });
  }
  const sites = inspected.text.split(zipjsInflatePatch.before).length - 1;
  if (sites !== 1) {
    fail(`expected exactly one patch site, found ${sites}`);
  }
  const patched = inspected.text.replace(
    zipjsInflatePatch.before,
    zipjsInflatePatch.after,
  );
  if (sha256(Buffer.from(patched, "utf8")) !== zipjsInflatePatch.afterSha256) {
    fail(
      "candidate decoder SHA-256 does not match; dependency was not modified",
    );
  }
  writeFileSync(inspected.decoderPath, patched, { encoding: "utf8" });
  const verified = verifyZipjsInflatePatch({ root });
  return { ...verified, applied: true };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (
      process.argv.length !== 3 ||
      !["apply", "verify"].includes(process.argv[2])
    ) {
      fail("usage: node scripts/patch-zipjs-inflate.mjs apply|verify");
    }
    const operation =
      process.argv[2] === "apply"
        ? applyZipjsInflatePatch
        : verifyZipjsInflatePatch;
    const result = operation();
    console.log(
      `zip.js ${result.version} inflate patch ${result.applied ? "applied" : "verified"}: ${result.sha256}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
