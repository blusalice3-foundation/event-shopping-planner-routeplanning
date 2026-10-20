# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-import-delayed-cancel.spec.ts >> OP12 real App cancels initial during initial durable read and keeps the next file after its late reply
- Location: tests\browser\map-import-delayed-cancel.spec.ts:296:3

# Error details

```
Error: worker.evaluate: Target page, context or browser has been closed
```

# Test source

```ts
  187 | interface ReadGateTrace {
  188 |   readRequests: number[];
  189 |   readReplies: number[];
  190 |   gatedReadId: number | null;
  191 |   gateReached: number;
  192 |   released: boolean;
  193 |   writes: string[];
  194 |   readwriteStarted: number;
  195 |   readwriteCompleted: number;
  196 | }
  197 | interface ReadGateRealm {
  198 |   __mapCancelReadGate: ReadGateTrace;
  199 |   __releaseMapCancelRead(): void;
  200 | }
  201 | 
  202 | async function delayFirstDurableRead(page: Page): Promise<Worker> {
  203 |   const worker = page
  204 |     .workers()
  205 |     .find((candidate) => candidate.url().includes("persistence.worker"));
  206 |   if (!worker) throw new Error("The real persistence Worker has not started.");
  207 |   await worker.evaluate(() => {
  208 |     const trace: ReadGateTrace = {
  209 |       readRequests: [],
  210 |       readReplies: [],
  211 |       gatedReadId: null,
  212 |       gateReached: 0,
  213 |       released: false,
  214 |       writes: [],
  215 |       readwriteStarted: 0,
  216 |       readwriteCompleted: 0,
  217 |     };
  218 |     let resume: (() => void) | undefined;
  219 |     let armed = true;
  220 |     const realm = globalThis as unknown as ReadGateRealm;
  221 |     realm.__mapCancelReadGate = trace;
  222 |     realm.__releaseMapCancelRead = () => {
  223 |       if (!resume || trace.released)
  224 |         throw new Error("Read gate is not waiting.");
  225 |       trace.released = true;
  226 |       resume();
  227 |     };
  228 |     self.addEventListener("message", (event) => {
  229 |       const method = event.data?.method as string | undefined;
  230 |       if (method === "read") trace.readRequests.push(event.data.id);
  231 |       if (
  232 |         method &&
  233 |         (["commit", "commitDay", "day", "items"].includes(method) ||
  234 |           method.startsWith("save"))
  235 |       )
  236 |         trace.writes.push(method);
  237 |     });
  238 |     const send = self.postMessage.bind(self);
  239 |     self.postMessage = ((message: { id?: number }) => {
  240 |       if (
  241 |         typeof message.id === "number" &&
  242 |         trace.readRequests.includes(message.id)
  243 |       )
  244 |         trace.readReplies.push(message.id);
  245 |       send(message);
  246 |     }) as typeof self.postMessage;
  247 |     const transaction = IDBDatabase.prototype.transaction;
  248 |     IDBDatabase.prototype.transaction = function (
  249 |       ...args: Parameters<IDBDatabase["transaction"]>
  250 |     ) {
  251 |       const result = transaction.apply(this, args);
  252 |       if (args[1] === "readwrite") {
  253 |         trace.readwriteStarted++;
  254 |         result.addEventListener("complete", () => trace.readwriteCompleted++);
  255 |       }
  256 |       const stores = typeof args[0] === "string" ? [args[0]] : [...args[0]];
  257 |       if (
  258 |         armed &&
  259 |         args[1] === "readonly" &&
  260 |         stores.includes("eventLists") &&
  261 |         stores.includes("eventConsistency") &&
  262 |         stores.includes("syncQueue")
  263 |       ) {
  264 |         armed = false;
  265 |         let handler: IDBTransaction["oncomplete"] = null;
  266 |         Object.defineProperty(result, "oncomplete", {
  267 |           configurable: true,
  268 |           get: () => handler,
  269 |           set: (value: IDBTransaction["oncomplete"]) => {
  270 |             handler = value;
  271 |           },
  272 |         });
  273 |         result.addEventListener("complete", (event) => {
  274 |           // IDB has really finished reading. Only the consumer's completion is delayed.
  275 |           trace.gateReached++;
  276 |           trace.gatedReadId = trace.readRequests.at(-1) ?? null;
  277 |           resume = () => handler?.call(result, event);
  278 |         });
  279 |       }
  280 |       return result;
  281 |     };
  282 |   });
  283 |   return worker;
  284 | }
  285 | 
  286 | const gateTrace = (worker: Worker) =>
> 287 |   worker.evaluate(
      |          ^ Error: worker.evaluate: Target page, context or browser has been closed
  288 |     () => (globalThis as unknown as ReadGateRealm).__mapCancelReadGate,
  289 |   );
  290 | 
  291 | for (const route of [
  292 |   "initial",
  293 |   "reimport with impact",
  294 |   "reimport without impact",
  295 | ] as const) {
  296 |   test(`OP12 real App cancels ${route} during initial durable read and keeps the next file after its late reply`, async ({
  297 |     page,
  298 |   }, testInfo) => {
  299 |     test.setTimeout(60_000);
  300 |     const reimport = route !== "initial";
  301 |     await restore(page, reimport);
  302 |     const durableBefore = await allStores(page);
  303 |     const importDialog = await selectMap(
  304 |       page,
  305 |       oldFile,
  306 |       await workbook("旧要求"),
  307 |     );
  308 |     const preconfirmation = page.getByRole("dialog", {
  309 |       name: "マップを入れ替える前の確認",
  310 |       exact: true,
  311 |     });
  312 |     const impact = page.getByRole("dialog", {
  313 |       name: "マップ再取り込みの影響を確認",
  314 |       exact: true,
  315 |     });
  316 |     let ownerDialog = importDialog;
  317 |     if (reimport) {
  318 |       await importDialog
  319 |         .getByRole("button", { name: "取り込む", exact: true })
  320 |         .click();
  321 |       await expect(preconfirmation).toBeVisible();
  322 |       ownerDialog = preconfirmation;
  323 |     }
  324 |     const worker = await delayFirstDurableRead(page);
  325 |     if (reimport)
  326 |       await preconfirmation
  327 |         .getByRole("button", {
  328 |           name:
  329 |             route === "reimport with impact"
  330 |               ? "影響範囲を確認する"
  331 |               : "影響を確認せずに取り込む",
  332 |           exact: true,
  333 |         })
  334 |         .click();
  335 |     else
  336 |       await importDialog
  337 |         .getByRole("button", { name: "取り込む", exact: true })
  338 |         .click();
  339 |     await expect
  340 |       .poll(async () => (await gateTrace(worker)).gateReached)
  341 |       .toBe(1);
  342 |     const held = await gateTrace(worker);
  343 |     expect(held.readRequests).toHaveLength(1);
  344 |     expect(held.gatedReadId).toBe(held.readRequests[0]);
  345 |     expect(held.readReplies).toEqual([]);
  346 |     expect(held.writes).toEqual([]);
  347 |     expect(held.readwriteStarted).toBe(0);
  348 |     expect(held.readwriteCompleted).toBe(0);
  349 |     await expect(
  350 |       ownerDialog.getByRole("button", { name: "キャンセル", exact: true }),
  351 |     ).toBeEnabled();
  352 |     await ownerDialog
  353 |       .getByRole("button", { name: "キャンセル", exact: true })
  354 |       .click();
  355 |     await expect(importDialog).toBeHidden();
  356 |     await expect(preconfirmation).toBeHidden();
  357 |     await expect(impact).toBeHidden();
  358 |     const next = await selectMap(
  359 |       page,
  360 |       nextFile,
  361 |       await workbook("次ファイルの入力"),
  362 |     );
  363 |     await next
  364 |       .getByRole("button", { name: /ブロック自動検出の詳細設定/ })
  365 |       .click();
  366 |     const setting = next.locator('input[type="number"]').first();
  367 |     await setting.fill("3");
  368 |     await expect(setting).toHaveValue("3");
  369 |     await worker.evaluate(() =>
  370 |       (globalThis as unknown as ReadGateRealm).__releaseMapCancelRead(),
  371 |     );
  372 |     await expect
  373 |       .poll(async () => (await gateTrace(worker)).readReplies)
  374 |       .toContain(held.gatedReadId);
  375 |     await expect
  376 |       .poll(() =>
  377 |         page.evaluate(
  378 |           () =>
  379 |             (
  380 |               window as unknown as {
  381 |                 __mapCancelMainTrace: { received: number[] };
  382 |               }
  383 |             ).__mapCancelMainTrace.received,
  384 |         ),
  385 |       )
  386 |       .toContain(held.gatedReadId);
  387 |     await page.evaluate(
```