const MAX_VISIBLE_MAPS = 20;
const MAX_MAP_NAME_LENGTH = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapNameExcerpt(name: string): string {
  const excerpt = name
    .slice(0, MAX_MAP_NAME_LENGTH)
    .replace(/[\uD800-\uDBFF]$/, "")
    .replace(/\s/g, " ");
  return name.length > MAX_MAP_NAME_LENGTH ? `${excerpt}…` : excerpt;
}

function dimension(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : "不明";
}

function count(value: unknown): string {
  return Array.isArray(value) ? String(value.length) : "不明";
}

function describeMaps(value: unknown): string {
  if (value === null || value === undefined) return "地図なし";
  if (!isRecord(value)) return "地図あり（詳細情報なし）";
  const names = Object.keys(value);
  if (names.length === 0) return "地図なし";
  const lines = [`地図${names.length}件`];
  for (const name of names.slice(0, MAX_VISIBLE_MAPS)) {
    const map = value[name];
    const label = mapNameExcerpt(name);
    lines.push(
      isRecord(map)
        ? `- ${label}: ${dimension(map.maxRow)}行 × ${dimension(map.maxCol)}列、セル${count(map.cells)}件、結合${count(map.mergedCells)}件、ブロック${count(map.blocks)}件`
        : `- ${label}: 詳細情報なし`,
    );
  }
  if (names.length > MAX_VISIBLE_MAPS)
    lines.push(
      `ほか${names.length - MAX_VISIBLE_MAPS}件の地図は表示を省略します。`,
    );
  return lines.join("\n");
}

// Only display text is summarized. Restore data and confirmation comparisons
// retain every cell, including changes that leave dimensions/counts unchanged.
export function formatEventRestoreSection(
  key: string,
  before: unknown,
  after: unknown,
): string {
  if (key === "mapData")
    return `地図データ（要約）\n現在:\n${describeMaps(before)}\n復元後:\n${describeMaps(after)}\n地図の内容全体を復元します。表示は地図名・サイズ・件数の要約です。`;
  return `${key}\n現在: ${JSON.stringify(before, null, 2)}\n復元後: ${JSON.stringify(after, null, 2)}`;
}
