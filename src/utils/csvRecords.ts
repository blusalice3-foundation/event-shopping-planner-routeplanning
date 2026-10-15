export interface CsvRecord {
  readonly sourceRowId: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly cells: string[];
}
export interface CsvError {
  line: number;
  message: string;
}
export class CsvInputError extends Error {
  constructor(readonly errors: readonly CsvError[]) {
    super(
      errors.map(({ line, message }) => `${line}行目: ${message}`).join("\n"),
    );
    this.name = "CsvInputError";
  }
}

/** Parse records before interpreting columns; quoted line breaks are cell content. */
export function parseCsvRecords(input: string): {
  records: CsvRecord[];
  errors: CsvError[];
} {
  const text = input.replace(/^\uFEFF/, "");
  const records: CsvRecord[] = [];
  const errors: CsvError[] = [];
  let cells: string[] = [],
    value = "",
    line = 1,
    startLine = 1;
  let quoted = false,
    closed = false,
    started = false;
  const field = () => {
    cells.push(value);
    value = "";
    closed = false;
    started = false;
  };
  const record = () => {
    field();
    records.push({
      sourceRowId: `csv:${records.length}:${startLine}`,
      startLine,
      endLine: line,
      cells,
    });
    cells = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        value += char;
        if (char === "\n" || (char === "\r" && text[index + 1] !== "\n"))
          line++;
      }
      continue;
    }
    if (char === ",") {
      field();
      continue;
    }
    if (char === "\r" || char === "\n") {
      record();
      if (char === "\r" && text[index + 1] === "\n") index++;
      line++;
      startLine = line;
      continue;
    }
    if (char === '"' && !started && !closed && value === "") {
      quoted = true;
      started = true;
      continue;
    }
    if (char === '"' || (closed && char.trim() !== "")) {
      errors.push({
        line,
        message: "引用符の位置が不正です。CSVの列と引用符を確認してください。",
      });
    }
    if (!closed || char.trim() !== "") value += char;
    started = true;
  }
  if (quoted)
    errors.push({ line: startLine, message: "引用符が閉じられていません。" });
  if (started || closed || value !== "" || cells.length) record();
  return { records, errors };
}
