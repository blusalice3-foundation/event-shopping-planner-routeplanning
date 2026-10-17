import ts from "typescript";

// Opt-in measurement only: observe real function bodies, including calls within
// the same module. No observer or transformed code enters the production build.
export function sheetUrlStageProbe() {
  const targets = {
    "/src/app/commands/applicationMutationCoordinator.ts": {},
    "/src/utils/itemOptionalFields.ts": {
      normalizeSnapshotItemOptionalFields: "normalization",
    },
    "/src/utils/appBackup.ts": {
      validateSnapshotStructure: "validation-structure",
      validateSnapshotReferences: "validation-references",
      parseAppBackup: "backup-processing",
    },
    "/src/xlsx/engine/eventWorkbookEngine.ts": { importFromXlsx: "xlsx-parse" },
    "/src/features/events/sheetImport.ts": { readEventCsv: "csv-parse" },
    "/src/features/events/updateDiff.ts": {
      createEventUpdateDiff: "diff-generation",
      normalizeSheetItemsUrls: "sheet-normalization",
    },
  };
  return {
    name: "sheet-url-measurement-stages",
    enforce: "pre",
    transform(source, id) {
      const path = id.replaceAll("\\", "/").split("?")[0];
      const names = Object.entries(targets).find(([suffix]) =>
        path.endsWith(suffix),
      )?.[1];
      if (!names) return null;
      const tree = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const edits = [];
      for (const node of tree.statements) {
        if (!ts.isFunctionDeclaration(node) || !node.name || !node.body)
          continue;
        const stage = names[node.name.text];
        if (!stage) continue;
        edits.push([
          node.body.getStart(tree) + 1,
          "\nconst __sheetStageStart = performance.now(); try {\n",
        ]);
        edits.push([
          node.body.end - 1,
          `\n} finally { globalThis.__sheetUrlStageObserver?.(${JSON.stringify(stage)}, __sheetStageStart, performance.now()); }\n`,
        ]);
      }
      function visit(node) {
        if (ts.isCallExpression(node)) {
          const expression = node.expression.getText(tree);
          const stage =
            expression === "operation.intent.plan"
              ? "mutation-replan"
              : expression === "JSON.parse" &&
                  node.arguments[0]?.getText(tree) === "source"
                ? "json-decode"
                : null;
          if (stage) {
            edits.push([
              node.getStart(tree),
              "(() => { const __sheetCallStart = performance.now(); try { return ",
            ]);
            edits.push([
              node.end,
              `; } finally { globalThis.__sheetUrlStageObserver?.(${JSON.stringify(stage)}, __sheetCallStart, performance.now()); } })()`,
            ]);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
      for (const [offset, text] of edits.sort((a, b) => b[0] - a[0])) {
        source = source.slice(0, offset) + text + source.slice(offset);
      }
      return { code: source, map: null };
    },
  };
}
