import type { SheetImportDiagnostics } from "../features/events/sheetRowSelection";
import {
  REQUIRED_SHEET_FIELDS,
  REQUIRED_SHEET_FIELD_LABELS,
} from "../features/events/sheetRowSelection";

export default function SheetImportSummary({
  diagnostics,
}: {
  diagnostics: SheetImportDiagnostics;
}) {
  const { acceptedCount, rowExclusions } = diagnostics;
  return (
    <section
      aria-label="シート取込結果"
      className="rounded border border-slate-300 p-3 text-sm dark:border-slate-600"
    >
      <p>
        取込対象: {acceptedCount}件、必須項目不足による除外:{" "}
        {rowExclusions.excludedCount}行
      </p>
      {rowExclusions.excludedCount > 0 && (
        <>
          <p>
            不足項目:{" "}
            {REQUIRED_SHEET_FIELDS.filter(
              (key) => rowExclusions.missingFieldCounts[key] > 0,
            )
              .map(
                (key) =>
                  `${REQUIRED_SHEET_FIELD_LABELS[key]} ${rowExclusions.missingFieldCounts[key]}行`,
              )
              .join("、")}
          </p>
          <details>
            <summary>
              除外行の例（先頭{rowExclusions.examples.length}行）
            </summary>
            <ul>
              {rowExclusions.examples.map((example) => (
                <li key={example.sourceRowId}>
                  {example.lineNumber}行目:{" "}
                  {example.missingFields
                    .map((key) => REQUIRED_SHEET_FIELD_LABELS[key])
                    .join("・")}
                  が未入力
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
