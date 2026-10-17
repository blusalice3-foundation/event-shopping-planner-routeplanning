export const REQUIRED_SHEET_FIELDS = [
  "circle",
  "eventDate",
  "block",
  "number",
] as const;
export type RequiredSheetField = (typeof REQUIRED_SHEET_FIELDS)[number];
export const REQUIRED_SHEET_FIELD_LABELS: Record<RequiredSheetField, string> = {
  circle: "サークル名",
  eventDate: "参加日",
  block: "ブロック",
  number: "番号",
};
export interface SheetRowExclusionSummary {
  excludedCount: number;
  missingFieldCounts: Record<RequiredSheetField, number>;
  examples: Array<{
    sourceRowId: string;
    lineNumber: number;
    missingFields: RequiredSheetField[];
  }>;
}
export interface SheetImportDiagnostics {
  acceptedCount: number;
  rowExclusions: SheetRowExclusionSummary;
}
export function missingRequiredSheetFields(
  fields: Record<RequiredSheetField, string>,
): RequiredSheetField[] {
  return REQUIRED_SHEET_FIELDS.filter((key) => fields[key].trim() === "");
}
export function createSheetRowExclusionSummary(): SheetRowExclusionSummary {
  return {
    excludedCount: 0,
    missingFieldCounts: { circle: 0, eventDate: 0, block: 0, number: 0 },
    examples: [],
  };
}
export function recordSheetRowExclusion(
  summary: SheetRowExclusionSummary,
  sourceRowId: string,
  lineNumber: number,
  missingFields: RequiredSheetField[],
): void {
  summary.excludedCount++;
  for (const key of missingFields) summary.missingFieldCounts[key]++;
  if (summary.examples.length < 20)
    summary.examples.push({ sourceRowId, lineNumber, missingFields });
}
