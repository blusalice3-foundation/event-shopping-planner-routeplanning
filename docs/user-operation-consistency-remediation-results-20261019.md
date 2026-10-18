# 操作不整合12件の実装・検証結果

- 対象計画: [2026-10-18の実装計画](user-operation-consistency-remediation-plan-20261018.md)
- 作業日: 2026-10-18～19（日本時間）
- 基準コミット: `5bf82a364d5b656cfa1e67c5233cfac0564840cf`
- 状態: 全12件を実装。最終ソースの機能・品質・性能検証を完了し、指定フォルダーへ反映。
- 作業場所: 既存成果物を保全した独立worktreeで実装・検証し、元フォルダーへ同一内容をコピー。保全・コピーの照合結果は末尾の証跡を参照。

## 実装内容

| ID   | 実装                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OP01 | イベント・世代・日付・実マップを固定する地図編集session。選択の復帰と確定で所有者を検査し、破棄確認と訪問リスト保存／破棄の成功後にだけ文脈を移す。地図ファイルは選択時に捕捉し、確認待ちで取り違えない。                                  |
| OP02 | 一覧へ確定したホールdraftを同期元・同期先へ一度の原子的保存で反映する。clone IDは要求受付時に固定し、同じ実マップは重複保存しない。同期先ごとの簡易ホール順序・訪問・割当を保持する。                                                      |
| OP03 | ホール保存／同期をawaitし、同sessionの確定済み表示用ホールIDでbaselineを更新する。確定的失敗と確認取消ではdraftを保持する。保存結果不明と確定後適用失敗は共通の同期停止理由に接続する。                                                    |
| OP04 | 編集workspaceの共有drag ownerと開始時対象を使用する。実行列は表示グループの上下50%から境界を解決し、既存訪問への末尾合流を優先する。表示不能な境界は全体拒否する。候補列のソート状態と従来のhover指定を維持し、ガイドは局所DOM更新とする。 |
| OP05 | 一時巡回と保存確認にfocus・Escape・scroll lockを接続する。確認hostを維持し、busy・確認交代・入れ子でもfocusを保つ。保存失敗focusは最後のmodalが閉じるまで保留する。外部focus制限は対象dialogだけに適用し、既存の日付移動を維持する。       |
| OP06 | 予定数量draftをform.quantityに統一し、購入状態の往復で予定量・実購入数を元へ戻さない。保存時は同じ予定数量を一度parse・検証して使う。                                                                                                      |
| OP07 | JSON／イベントXLSXの復元候補に共有読込ownerを置き、古い成功・失敗・cleanupを拒否する。候補表示中と復元受付後は新入力を拒否する。取消は表示requestIdと照合し、終端失敗後は再復元を止める。                                                  |
| OP08 | 訪問リストの交換をドラッグ移動から分離する。同一訪問内は品目位置、別訪問間はまとまりを交換し、途中の訪問順と各訪問内順序を保持する。選択対象はIDで解決する。                                                                               |
| OP09 | 手動「次へ」と空フェーズ回復の末尾処理を共有する。再開初期同期中は遷移を止め、同期後に最新実行列に存在するcaptured対象へ回復する。価格・限数guardと一時巡回を維持する。                                                                    |
| OP10 | CSVのFile・input・読込世代を同期捕捉し、await前にinputをclearする。読取失敗を日本語で通知し、同じファイルを再選択できる。古い読込はparse・通知・表示を行わない。                                                                           |
| OP11 | 更新操作ごとに送信済みURL／シート名のimmutable draftを保持する。空シート名も再表示に反映し、通信失敗でmetadataを先行変更しない。次の操作へ持ち越さない。                                                                                   |
| OP12 | 地図取込の解析ownerと保存要求ownerを分離する。キュー・初回読込・操作可能な確認は取消可能とし、保存確認受付後・commit開始後は拒否する。取消成功時だけconfirmation・resolver・pendingを一度だけ清掃する。                                    |

## 保存安全性と通常操作への影響

- DB 11、JSON backup version 2、完全版イベントXLSX 3.0、XLSX Worker protocol 2を維持した。保存キュー、別系統の書込み、依存ライブラリは追加していない。
- 保存結果不明・確定後の状態適用失敗は同じ停止理由を同期伝搬し、後続要求・再送・自動保存・flush・drainからの追加書込みを止める。実WorkerでDB確定後の応答喪失を注入し、物理確定1回・書込RPC1回・保存用Worker生成1回、追加書込み0、saved表示なし、requiresReload、入力保持、JSON退避と再読込後の保存値を確認した。
- 停止後のJSON出力はbackup専用DB読込と受理済み入力の安全な合成を使用する。通常保存の再開やDB読込失敗時のメモリ値への代用は行わない。実Appと同じhandler配線のintegration試験でも、再render前の停止と受理済み入力の退避を確認した。
- 最終ソースの購入・予定数量・メモは、修正前後とも各操作でitems RPC 1回、完了readwrite transaction 1回、ObjectStore変更要求9回。内訳はeventListsのput 2／delete 2、syncQueueのput 4／delete 1で、開くstore集合12種類も同じ。各1観測のI/O比較であり、性能判定とは分けた。メモの保存応答時間にはdebounceを含む。
- Full／Virtual／RetainedViewportの選択とCanvas保持、既存のdrag fallback／保持動作を維持した。ガイドのための恒常的な全件mountや保存は追加していない。
- 性能調整は、同じ比較規則のIntl.Collator再利用、訪問リスト照合の操作内Set化、同一参照品目の重複した候補判定の除去、表示用品目・ホール定義の参照再利用に限定した。地図・定義・全日付の選択と割当・所属条件が同じ場合だけ所属判定を再利用し、訪問順・巡回設定は最新値を投影する。所属metadataが変われば新しい品目を返す。mutation plannerの非cache経路は維持した。
- Viewport内への挿入は実カードをpaint前に反映し、画面外の遅延表示と測定回数の上限を維持した。500／1,500品目の全ID置換、既存先頭の削除、focus、保持、cleanupも確認した。

## 機能・品質検証

| 確認範囲     | 最終結果                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全Vitest     | 3,087成功、88既存スキップ。260ファイル成功、1ファイルスキップ。全projectを単独実行、maxWorkers=4。                                                |
| Chromium回帰 | 214件すべて成功、スキップ・flaky 0。実Appの保存・再読込、native／実touch、候補ソート、数量、地図同期、訪問交換、OP09再開、I/O・Worker停止を含む。 |
| 差分確認     | drag関連105件、Viewport等53件、modal等53件、Worker局所改善131件、最終projection関連30件を各担当範囲で確認。全Vitestと重複するため合算しない。     |
| API          | 21件成功。                                                                                                                                        |
| 品質         | 両typecheck、変更対象ESLint／Prettier、DB互換性、architecture、試験所属、encoding、標準製品buildが成功。architecture例外0。                       |
| 文字コード   | worktreeの1,110テキストファイルを検証。UTF-8 BOMなし、U+FFFD・文字化け・不自然な疑問符なし。既存CRLF 3ファイルは変更対象外。                      |

途中の広い回帰では既存日付キー操作へのfocus干渉を1件検出し、対象dialogだけにfocus制限を適用して修正した。最終214件にはその操作も含む。同期先の日別簡易ホール順序、候補列のhover・折りたたみ境界も修正した。

全Vitestの最初の最終確認はブラウザー回帰・型検査と並列に行い、1,500品目の表示試験1件が明示15秒のtimeoutになった。3,086件は成功した。製品コード・試験の時間制限を変えず、他の重い検査を止めた全project再実行で3,087件が成功した。途中の失敗記録も保存した。

## 性能測定

Windows 11／PowerShell 7.6.3／Node.js 24.19.0／npm 11.19.0、Playwright 1.62.1／Chromium 151.0.7922.34。修正前後とも標準build:app、同じfixture・依存バージョン・1 workerを使用し、性能測定中は重い試験を並列実行していない。

基準は各操作20サンプル以上、中央値55.0ms以下・95%点100ms以下。保存完了は操作反応と分けた。過去の50ms基準の記録と当時の判定は変更していない。

### 通常操作

最終24条件すべて成功。各build 144区分・3,180サンプルで、修正前後の全区分が基準内だった。表は各範囲における操作別中央値／95%点の最大値（ms）。

| 範囲                   | 条件数 | 修正前 中央値／95%点 | 最終 中央値／95%点 | 最小サンプル数 |
| ---------------------- | ------ | -------------------- | ------------------ | -------------- |
| 150／500品目・各6操作  | 16     | 32.1／47.6           | 33.0／41.1         | 20             |
| 既存1,500品目・各6操作 | 8      | 48.4／70.0           | 48.2／52.8         | 20             |

同じ区分での中央値の最大増分は+2.1ms（150品目・集中あり・地図なし・スマートフォンの次へ：11.6→13.7ms）。全区分の対応比較と生サンプルを保存した。最終測定は17.9分。途中build 2A8024C1での24条件比較も別名で保持している。

### 専用ドラッグ

実マップ・ホール・優先度の異なるfixtureを使い、150／500品目×native／touch×スペース別ON／OFFの8構成が成功した。境界切替、複数合流、新規挿入との混在、画面外合流、自動scroll、受付不可、dropの全60区分・各20回、計1,200応答サンプル。最大中央値52.5ms／最大95%点60.5msで基準内。

| 品目数 | 入力   | スペース別 | drop中央値／95%点（ms） |
| ------ | ------ | ---------- | ----------------------- |
| 150    | native | ON         | 30.1／33.7              |
| 150    | native | OFF        | 27.5／29.5              |
| 150    | touch  | ON         | 30.9／34.3              |
| 150    | touch  | OFF        | 28.5／33.5              |
| 500    | native | ON         | 52.3／60.5              |
| 500    | native | OFF        | 45.5／51.1              |
| 500    | touch  | ON         | 52.5／55.8              |
| 500    | touch  | OFF        | 45.2／49.8              |

- pointerの全52区分で、既にmount済みの無関係な品目／グループの更新・再mountは0。必要なviewport進入による新規mountは別計数した。実自動scrollは160回成功。
- pointer中の書込要求と実Worker内の完了readwrite transactionはともに0。反応は正しいガイドまたは実カードを観測後、requestAnimationFrame＋後続taskまで測った。
- 測定中の実engine／strategyは両列ともvirtual／retained-viewport。構成別の開始前・開始中・終了後の実カード／グループ数を集計に併記した。
- drag開始／終了は修正前後とも各構成20回の独立測定。中央値の最大増分は開始+2.4ms、終了+1.0ms。touchの意図的な200ms長押しは分離し、既存fallbackへ新しい絶対時間基準は課していない。
- 修正前の列間UI移動は成立しないため、修正前のguide／drop性能値は記録していない。開始／終了だけを同条件比較した。補助helperの値で代用していない。
- 保存確認時間は保存済みIDをDBからpoll確認するまでの別指標。物理commitの厳密な瞬間ではなく、確認までの上限時間として記録した。
- fixture・hit pointの修正前やCPU調整途中の未達は別証跡に保持した。最終fixtureは修正前後で同一で、trace／CPU profiler／probe比較は最終測定では無効。

## ビルド識別と証跡

- 基準commit: 5bf82a364d5b656cfa1e67c5233cfac0564840cf。
- 基準bundle SHA256: 0FB53B3A5BA23FFB25D102A402CF2B3EA725AD1EA9A4600B99A4317B39AB7756。
- 最終bundle SHA256: A554A5A960F6D3D82A62B381AF7E1D1EC4634310FFD7A5B55E0AA3E8367517DD。
- HEADが同じ変更中buildのため、上記bundleと変更ソース92ファイルのSHA256で最終測定対象を識別する。

| 対象               | 記録・関連試験                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全体検証           | [最終全Vitest](../artifacts/user-operation-remediation-20261019/full-vitest-final-isolated.log)、[最終Chromium 214件](../artifacts/user-operation-remediation-20261019/browser-final-validated-report.json)、[型検査](../artifacts/user-operation-remediation-20261019/final-validated-typecheck.log)、[architecture](../artifacts/user-operation-remediation-20261019/final-validated-architecture.log)                    |
| 通常性能           | [修正前後の全区分比較・生データ参照](../artifacts/user-operation-remediation-20261019/shopping-performance-comparison.json)、[区分別CSV](../artifacts/user-operation-remediation-20261019/shopping-performance-rows.csv)、[対応比較CSV](../artifacts/user-operation-remediation-20261019/shopping-performance-pairs.csv)                                                                                                    |
| 専用ドラッグ       | [8構成の比較・生データ16件](../artifacts/user-operation-consistency-20261018/drag-final-evidence/drag-performance-summary.json)、[相対参照索引](../artifacts/user-operation-consistency-20261018/drag-evidence-index.json)、[最終report](../artifacts/user-operation-consistency-20261018/drag-post-a554-final-report.json)、[基準report](../artifacts/user-operation-consistency-20261018/drag-baseline-final-report.json) |
| 通常I/O            | [最終ソースと修正前の比較](../artifacts/user-operation-remediation-20261019/ordinary-io-final-comparison.json)、[最終生観測](../artifacts/user-operation-remediation-20261019/ordinary-io-final-source.json)                                                                                                                                                                                                                |
| OP03共通停止       | [最終実Worker停止を含むreport](../artifacts/user-operation-remediation-20261019/browser-final-validated-report.json)、[App配線・受理済み入力退避integration](../src/app/state/useApplicationSnapshot.persistence.integration.test.tsx)、[保存hook試験](../src/hooks/useIndexedDbPersistence.test.tsx)、[coordinator試験](../src/app/commands/applicationMutationCoordinator.test.ts)                                        |
| OP07復元owner      | [JSON／XLSX入口・失効・終端失敗](../src/app/commands/useEventTransferCommands.test.tsx)、[候補dialog](../src/components/BackupRestoreDialog.test.tsx)、[requestId照合](../src/app/state/appOverlayState.test.ts)                                                                                                                                                                                                            |
| OP12取込取消       | [実snapshot・overlay接続integration](../src/app/commands/useMapImportCommands.integration.test.tsx)、[owner・busy境界](../src/app/commands/useMapImportCommands.test.tsx)、[初回dialog競合](../src/components/map/MapImportDialog.previewRace.test.tsx)、[再取込dialog](../src/components/map/MapReimportConfirmationDialog.test.tsx)                                                                                       |
| 性能改善の意味保持 | [projection依存・参照保持](../src/features/consistency/domain/projection.test.ts)、[実hookのmetadata境界](../src/app/state/useApplicationSnapshot.projection.test.tsx)、[Worker順序・所属](../src/features/consistency/domain/workerMutationNormalization.test.ts)                                                                                                                                                          |
| 識別・文字コード   | [最終ソースmanifest](../artifacts/user-operation-remediation-20261019/final-source-manifest.json)、[独立再計算・hash照合](../artifacts/user-operation-remediation-20261019/final-independent-evidence-check.json)、[encoding検証](../artifacts/user-operation-remediation-20261019/final-validated-encoding.log)、[DB互換性](../artifacts/user-operation-remediation-20261019/final-validated-db-compatibility.log)         |
| 途中記録           | [並列時のVitest timeout](../artifacts/user-operation-remediation-20261019/full-vitest-final-validated.log)、[旧UI回帰](../artifacts/user-operation-remediation-20261019/browser-regression-final.log)、[CPU改善前の通常性能比較](../artifacts/user-operation-remediation-20261019/shopping-performance-comparison-before-drop-cpu-optimization.json)                                                                        |
| 原本への反映       | [既存6ファイルの保全・コピーhash照合](../artifacts/user-operation-remediation-20261019/original-preservation-verification.json)                                                                                                                                                                                                                                                                                             |

## 文字コード・保全

変更ソースとこの文書はUTF-8（BOMなし）・LFを維持した。保存後にstrict UTF-8で再読込し、日本語代表行、U+FFFD、不自然な疑問符、BOM、改行だけの大量差分を検査した。既存の計画・レビュー成果物6ファイルをSHA256で照合し、元フォルダーへのコピーも各ファイルのhashを照合した。過去の成果物は削除・移動・上書きしていない。
