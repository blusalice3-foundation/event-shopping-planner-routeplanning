# ADR: XLSX resource preflight と whole-buffer Worker

## Status

Accepted and implemented for the Phase 3 Worker path.

## Context

XLSX は ZIP container 内の XML であり、圧縮後の file size だけでは展開後の memory、
XML node 数、worksheet 数を制限できない。既存の `exceljs` 呼び出しは UI thread で
whole buffer を直接 parse しており、cancel、ZIP preflight、単一 terminal result の契約を
持たない。

## Decision

- resource limit の機械正本は `config/xlsx-limits.json` とする。
- production import は ZIP central directory と local header を parse 前に照合する。
- encrypted entry、ZIP64、未知の compression method、path traversal、case-insensitive path
  collision、CRC/size mismatch を拒否する。
- XML 展開後に DTD/entity と external relationship を拒否し、worksheet、row、cell、
  shared string、style、XML node/text の上限を検査する。
- digest は preflight 完了後の入力 bytes 全体に対する SHA-256 とする。
- protocol は whole-buffer transferable を用い、request ID、schema version、closed kind、
  basenameだけの `.xlsx` file name、progress、cancel、timeout、single terminal result を
  必須にする。
- input と生成済み output の両方を同じ preflight に通し、成功した単一結果を受け取るまで
  domain state や download side effect を commit しない。
- production は一操作ごとに module Worker を所有し、cancel、timeout、protocol mismatch、
  crash のいずれでも Worker を終了する。unsupported の場合も closed error とし、
  main-thread adapter へ silent fallback しない。
- main-thread adapter は nonproduction QA/test が明示的に import する場合だけ利用でき、
  production mode では constructor 自体が拒否する。
- 2026-11-08: Safari の native `DecompressionStream` を回避するため、既存 zip.js の
  JavaScript fallback を持つ `lib/zip-core-native.js` を採用した。
- 2026-11-09: Worker の UA / platform が Apple 系なら `useCompressionStream: false` とし、
  それ以外では既存の native inflater 経路を優先する。Worker では `maxTouchPoints` に頼れないため、
  Mac 形式 UA の iPad を含めて Apple 系を保守的に対象とする。AppleWebKit を名乗る macOS の Safari / Chromium も JavaScript 経路になる。
  native が未対応の場合も同じライブラリ内の JavaScript fallback を使用する。
  入力と生成済み出力の両方で同じ検証を維持し、追加 dependency や CSP 緩和は行わない。
  WebKit の stream 終了時のクラッシュ修正を踏まえた互換対応であり、報告端末での原因確定を意味しない。
  参照: https://github.com/WebKit/WebKit/commit/43a1b0bafb0c4d47208338c97756cfcb9304fa1f
- イベント xlsx は `File.arrayBuffer()` の前にも圧縮後の 32 MiB 上限を確認する。
  Worker 内の上限・CRC・XML・整合性検証は引き続き必須とする。

## Limits

初期値は一般的なイベント workbook に十分な余裕を持たせつつ、単一 entry 64 MiB、合計
256 MiB、圧縮後 32 MiB、compression ratio 100、wall 30 秒、CPU proxy 25 秒を上限とした。
XML node 200 万、worksheet 256、row 150 万、cell 500 万、shared string 100 万、style
20 万を超える入力は parse 前に拒否する。

数値を変更する場合は同じ変更単位で fixture、30 sample の performance evidence、
`config/xlsx-limits.json`、本 ADR を更新する。

## Consequences

whole-buffer の peak memory が budget を満たさない場合、Phase 3 は不合格とする。streaming
parser や別 dependency はこの ADR へ追記せず、別の versioned plan を先に作る。

semantic round-trip、map preview/import、invalid ZIP、external relationship、DTD/entity、
容量超過、cancel、timeout、Worker crash は automated test で固定する。canonical machine
での30 sample performance measurementが未収集のcandidateは、実装済みであっても
`P3-XLSX`を受理しない。
