Diagnostic harness only: three cases, 20 samples per case and phase.
Run order: AFTER then BEFORE, using the same existing compiled production builds,
fixed fixtures, viewport, direct/worker adapter selection and failure injections.
This output must not replace the frozen 48-case primary evidence or its thresholds.

Files:
- main-harness.spec.ts.archive: byte copy of the frozen 916-line source.
- sheet-import-optional-url.diagnostic.spec.ts: exact-string-derived diagnostic copy.
- exact-replacements.json: complete ordered string-replacement record.
- playwright.diagnostic.config.ts: dedicated testDir/testMatch with inherited browser settings.
- run-diagnostic.ps1: checks frozen sources and server identities; AFTER then BEFORE.

Preparation only; the test/runner has not been executed.
The runner expects the existing preview servers at AFTER :4173 and BEFORE :4275.
It refuses to overwrite previous logs, raw samples or run manifests.

Clock policy:
- Browser clicks, fetch start/headers, Response.text start/complete, DOM/next-rAF
  and the existing main/worker IDB transaction spans use browser epoch timestamps.
- Node action and expect spans use Node performance.now() only.
- Every page.evaluate boundary records enclosing Node send/receive timestamps,
  plus the returned browser epoch/timeOrigin/monotonic timestamp.
- No Node timestamp is subtracted from a browser timestamp, and no point clock
  skew is assumed. Use boundary brackets/round-trip uncertainty explicitly.
- Browser time from the pre-click evaluation to click is an upper bound that
  includes communication/scheduling; it must not be labeled exact actionability time.
- Post-DOM to after-expect browser boundary includes Node/browser transport;
  Node expect duration independently shows the wait/poll span.

Instrumentation cost:
Only the existing MutationObserver/observeScreen is used. No new DOM-wide scan,
trace, CPU profile, screenshot loop or polling loop is added. The existing review
and startup DOM marks are reused. Removal checks use at most the two retained
alert/editor element references for retry, or the captured retry-button reference
for B06, each recorded once. New rAF callbacks are one-shot event markers.
Each action/expect has explicit page.evaluate before/after boundaries; those
round trips affect diagnostic outer intervals, are recorded separately, and are
not comparable as replacements for the uninstrumented primary totals.

Critical interval interpretation:
- retry.initial-save.click and retry.retained.visible are setup/failure spans.
  The injected abort is before the primary retry duration; do not charge its
  transaction to the timed retry. retry.retry.click and subsequent hidden waits
  delimit the actual retry observation.
- update.post-save.validation-read is after saveMs has already been assigned.
  Its main eventLists readonly transaction is outside the saved-operation interval.
- B06 preserves per-sample duration/failure/retry values. Compare/add per-sample
  intervals only. Median/p95 totals do not equal sums of independent quantiles.
- CSV text-to-review DOM and click-to-DOM are browser-only intervals; the Node
  click and expect spans can diagnose actionability/polling without clock fusion.
