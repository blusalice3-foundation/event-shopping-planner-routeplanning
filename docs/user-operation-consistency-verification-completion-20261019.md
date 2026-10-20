# 操作不整合計画の追加検証結果

2026-10-19、HEAD `53e05fa` を対象に、[操作不整合計画](user-operation-consistency-remediation-plan-20261018.md)のレビューで残ったOP02・OP03の失敗注入試験を追加し、通過を確認した。OP12の実App上での遅延取消も追加確認した。既存の機能回帰を含め、今回の検証残件は解消した。

変更はテスト5ファイルと本結果文書。製品コードは変更していない。製品377ファイルは既存性能計測時のSHA256と全件一致し、DB・JSON・XLSX・Worker protocol・依存ライブラリも維持している。

## 保存確定後の失敗注入

- [経路別coordinator試験](../src/app/commands/applicationMutationCoordinator.test.ts): day fast path・day snapshot・items batchそれぞれの保存成功後にapplyを失敗させる3条件を追加した。対象経路だけが1回実行されたこと、同tickの再送・後続要求が同じ終端理由で拒否されることを確認した。
- [保存経路の接続試験](../src/app/state/routeApplyFailure.integration.test.tsx): 製品のWorker adapter・Worker server・App状態管理・保存hookを接続し、上記3経路をfake IndexedDBで実際に保存した。transportだけをin-processへ置き換えている。DB確定を別readとreadwrite開始1回・完了1回で確認後、applied callbackを失敗させた。items batchは2要求を一括確定する。全ownerの停止理由一致、React再render前のretry／flush、待機要求・新規commandの拒否、停止後の書込実装・RPC・物理書込・Worker再生成0、受理済みメモとJSON出力の保持を確認した。
- [observeSnapshot接続試験](../src/app/state/useApplicationSnapshot.persistence.integration.test.tsx): 実adapterとfake IndexedDBで監視保存を完了し、その後のread・状態採用・applied callbackを別々に失敗させる3条件を追加した。すべて `CommittedStateApplyError` となり、requiresReload、同じ終端理由、確認・pendingの清掃、待機中要求と予約済み自動保存の停止を確認した。DB確定は1回で、停止後の追加書込は0。受理済みメモは保存を伴わないJSON出力に保持される。

## 実Workerによるホール同期の原子性

[新規browser試験](../tests/browser/hall-sync-worker-atomicity.spec.ts)は簡易・詳細の2条件。実Appから同期元と3日付を選択し、実persistence Worker内で同期元・全保存先のhallDefinitions書込要求が成功した後、同じtransactionをabortする。詳細では2日付が同じ実マップを共有する。

両条件とも書込RPCは1回、全12ストアを含むreadwrite transactionは1回でabortし、全ストアの全レコードが開始前と完全一致した。独立したreadonly transactionでもう一度照合し、draftと3日付の選択が残ることを確認した。同じdraftの再試行だけが1回のtransactionで確定し、全対象の更新、共有マップの重複排除、表示用IDの漏出防止、日別巡回設定・購入・対象外日付・別イベントの保持、再読込を確認した。

## 地図取込の遅延取消

[新規browser試験](../tests/browser/map-import-delayed-cancel.spec.ts)は初回取込、再取込の影響確認あり／省略の3条件。実Workerの初回durable readを完了通知直前で待機させ、UIで取消し、次のファイルと設定値を入力してから旧readを解放した。

Workerの返信とメイン画面での受信、描画後まで待ち、書込RPC・readwrite transactionが0、全ストア不変更、旧確認なし、次ファイルと設定値保持、Worker生成1回を確認した。両取込画面とも、初回read待ちの取消が後続入力を壊さない。

## 最終検証

| 検証                               | 結果                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 全Vitest                           | [3,204成功、既存88スキップ、失敗0](../artifacts/op02-op03-verification-20261019/vitest-complete.json)                                           |
| Chromium機能回帰                   | [241成功、失敗・スキップ・flaky 0](../artifacts/op02-op03-verification-20261019/browser-final.json)。既存236件と新規5件、再試行0                |
| API                                | [21成功、失敗0](../artifacts/op02-op03-verification-20261019/test-api.log)                                                                      |
| 型検査                             | [app・release tools成功](../artifacts/op02-op03-verification-20261019/typecheck.log)。新規browser2ファイルの単独TypeScript検査も成功            |
| architecture・DB互換性・テスト所属 | [すべて成功](../artifacts/op02-op03-verification-20261019/quality-initial.json)                                                                 |
| 変更対象ESLint・Prettier           | 成功                                                                                                                                            |
| 製品buildとRelease A検証           | [独立したクリーンworktreeで成功](../artifacts/op02-op03-verification-20261019/build-final.log)。source clean、cleanup forced OFF、PWA証跡を確認 |

追加試験はVitest9件とbrowser5件。既存の正常保存・確定的失敗の再試行、OP01〜OP12に関連する回帰を通過した。通常の購入・予定数量・メモのI/O試験も再実行し、各操作のWorker要求1回・readwrite transaction1回・ObjectStore変更9回を維持した。

準備実行のログは最終結果と区別して保持した。依存junctionを用いたbuildと、未追跡ファイルがある原本でのbuildは既存のbuild検証により失敗したため、最終buildは依存もローカルに配置したクリーンworktreeで実行した。dev試験の初回1件にはWorker失効があり、[同時刻の依存最適化reload](../artifacts/op02-op03-verification-20261019/dev4176-vite-observation.log)を記録したが原因の断定はしない。最終241件はそのdev環境を使用していない。

## 操作性能

製品処理に変更がないため新しい性能測定は行っていない。[独立再集計](../artifacts/op02-op03-verification-20261019/performance-audit.json)で、製品377ファイルの一致と既存生サンプルを確認した。保存完了時間は操作反応から分け、各区分20サンプル以上、中央値55.0ms以下・95％点100ms以下の基準を維持した。

| 範囲                  | 区分数 | 最少サンプル | 最大中央値 | 最大95％点 |
| --------------------- | -----: | -----------: | ---------: | ---------: |
| 150／500品目          |     96 |           20 |     32.1ms |     46.1ms |
| 1,500品目             |     48 |           20 |     49.5ms |     64.6ms |
| native／touchドラッグ |     60 |           20 |     54.3ms |     67.7ms |

500品目・native・スペース別ONのdropは、既存の初回55.4msで不合格、同じ製品の再測定54.3msで合格という記録をそのまま保持した。中央値の余裕0.7msと原因未特定という留保も維持する。過去の50ms基準・初回判定を変更していない。

## 文字コードと原本の保全

変更対象はUTF-8 BOMなし・LFを維持した。[保存後の再読込](../artifacts/op02-op03-verification-20261019/source-encoding.json)とリポジトリ全体の文字コード検査で、日本語代表行、U+FFFD、不自然な疑問符、BOM、改行に異常がないことを確認した。

実装・試験は独立worktreeで行い、最終テストと本結果文書だけを原本へ反映した。原本のHEADと計画書は変更せず、作業開始時の未追跡9ファイルはSHA256一致で保全した。新規成果物は専用ディレクトリに保存し、既存の性能・検証成果物を上書きしない。
