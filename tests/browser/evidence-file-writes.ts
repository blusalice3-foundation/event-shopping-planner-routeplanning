import { writeFile } from "node:fs/promises";

type EvidenceFile = {
  path: string;
  data: Parameters<typeof writeFile>[1];
};

// Use only after measured capture has stopped. Every write settles even on an
// I/O failure, so no write leaks into a later sample or outlives its caller.
export async function writeEvidenceFiles(files: readonly EvidenceFile[]) {
  const batchSize = 4;
  let firstFailure: PromiseRejectedResult | undefined;
  for (let index = 0; index < files.length; index += batchSize) {
    const results = await Promise.allSettled(
      files
        .slice(index, index + batchSize)
        .map(({ path, data }) => writeFile(path, data, { encoding: "utf8" })),
    );
    firstFailure ??= results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
  }
  if (firstFailure) throw firstFailure.reason;
}
