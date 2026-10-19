# 操作不整合12件の追加修正・再検証結果

- 作業日: 2026-10-19（日本時間）
- 対象計画: [操作不整合12件の実装計画](user-operation-consistency-remediation-plan-20261018.md)
- 計画の基準: `5bf82a364d5b656cfa1e67c5233cfac0564840cf`
- 今回の修正前: `f59e07ee4738eb95e9de1dcd6bc17a386f67d53c`
- 状態: **全12項目の追加修正と、最終ソースの機能・品質・性能検証を完了。今回の確認範囲で具体的な既知残件なし。** 本文の「初回確認」は性能調整前のソースを対象とし、最終確認と区別する。原本反映は本書確定後に行い、反映後は末尾のcopy-verificationを参照する。
- 利用前提: PWAの単一画面。同じデータを別タブ・別ウィンドウから同時編集するケースを必須修正の根拠に含めない。
- 作業方法: 既存の未追跡成果物を保全し、独立worktreeで実装・検証する。過去の計画・実績・性能証跡は変更しない。

## 指摘4件への対応

| 指摘                                                         | 修正した動作                                                                                                                                                                                                                                                          | 主な確認                                                                                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OP06: 予定量「03」等から通常数量へ戻ると、表示1・保存3になる | 予定量の下書きは既存の `form.quantity` 一つを正本とする。通常selectには保存時と同じ十進整数parserで正規化した値を渡す。空欄・不正入力は明示的な現在入力optionで保持し、別の既定値へ見せかけない。保存時の既存検証を維持する。                                         | 3／03、20超、空欄、不正入力、状態往復、実購入数保持、再試行、同数・超過確認の取消。実Chromiumの未購入／購入済、実DB数量3、再読込後の表示。                                                     |
| OP05: modal表示中の保存失敗で背景の再試行へfocusが移る       | 集中モードの新規追加・フェーズ変更・挿入位置に既存共通modal動作を接続する。他の独立modalは既存のキーボード操作・scroll動作を維持し、共通focus ownerへ登録する狭いhookを追加する。遅着失敗のfocusは最後のmodalが閉じるまで保留し、失敗が既に解決していれば起点へ戻す。 | 実App／Workerの保存失敗中に新規追加・フェーズ変更を開いたままTab／Shift+Tab／Enterを実行。背景再試行のWorker要求0、閉じた後の再試行、nested modal、起点復帰。独立modal12種類の実部品でも確認。 |
| OP04: 複数選択の表示ガイドは受付可能でもdropが拒否される     | 準備済みの訪問・ホールbucket indexを使用し、個々の挿入先だけでなく移動bucket間の最終表示順と連続性も検証する。実現できない境界はpointer段階から受付不可・ガイドなしにする。drop側の最新データ再検証は維持する。                                                       | スペース別OFF・実行A1→B1・移動X(B)→Y(A)をnative／touchの実UIで拒否。独立した全表示投影oracleとの4,095組合せ照合、実移動commandとの567組合せ照合。                                              |
| OP04: native dragが列外へ出ても受付表示・挿入線が残る        | 全rendererの列離脱処理から共有workspaceの `leave()` を呼ぶ。同一列内の子要素間移動では解除せず、列外への離脱で共有ガイドとローカル受付状態を消す。                                                                                                                    | 実Chromiumのマウスでガイド表示後にヘッダーへ移動。スペース別ON／OFFとも、mouse release前にガイド・受付表示が消える。列外書込なし。                                                             |

追加した実ブラウザ境界回帰10件は修正後に成功した。修正前の再現記録と途中の試験修正記録も保存している。入力「3」単独は修正前の当該ブラウザ試験で成功する場合があったため、「03」の明確な再現と区別する。

## 全12項目の照合

以下は今回のコード照合、追加試験、最終ソースの全体回帰・性能測定による判断。全12項目を確認し、今回の範囲で具体的な既知残件はない。

| 項目                | 確認した契約・動作                                                                                                                         | 今回の追加変更                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| OP01 地図編集と移動 | event・世代・日付・実マップを固定したsession、選択・下書き復帰、破棄確認と訪問リスト保存／破棄の合成、失敗時の残留、ファイル置換、再読込。 | 製品変更なし。具体的な追加残件なし。                                    |
| OP02 ホール同期     | 表示draftから元・同期先への一回の原子的保存、要求受付時のclone ID固定、表示用IDへの復帰、連続同期、同期先の訪問・順序保持。                | 製品変更なし。具体的な追加残件なし。                                    |
| OP03 保存失敗保持   | 簡易／詳細のdraft・同期先保持、取消・再試行、保存結果不明／確定後適用失敗の同期停止、再render前の追加書込0、受理済み入力保持。             | 製品変更なし。具体的な追加残件なし。                                    |
| OP04 列間ドラッグ   | 対象固定、既存訪問末尾への合流、上下50%境界、表示不能境界拒否、候補ソート、全renderer、実DB・再読込、ガイド・受付結果一致。                | 上記2件を修正。最終機能回帰と、専用drag・通常操作の性能は全条件で通過。 |
| OP05 キーボード境界 | 一時巡回・汎用保存確認に加え、独立modalを同じfocus ownerへ接続。遅着失敗、保留focus、確認交代、nested modal、起点復帰。                    | 共通ownerへの登録漏れを修正。                                           |
| OP06 予定数量       | 通常／限数の往復、表示と保存の一致、実購入数保持、同数／超過確認、取消、失敗後の下書き保持。                                               | select値の正規化と不正入力の明示表示。                                  |
| OP07 復元owner      | JSON／イベントXLSX共通owner、旧成功・失敗・cleanupの拒否、候補表示中の入力拒否、取消、復元前の移動確認、失敗分類と終端停止。               | 製品変更なし。JSON→XLSX／XLSX→JSONの交差遅着12ケースを追加。            |
| OP08 訪問交換       | IDでの対象解決、異なる長さのまとまり交換、途中順序・訪問内順序、実DB保存、Undo／Redo、再読込。                                             | 製品変更なし。具体的な追加残件なし。                                    |
| OP09 空フェーズ回復 | 再開初期同期待ち、手動「次へ」と共有する末尾処理、一時巡回、最新captured対象への回復、完了処理。                                           | 製品変更なし。具体的な追加残件なし。                                    |
| OP10 CSV読取        | 読取失敗通知、同一ファイルの再選択、inputの同期clear、旧読込のparse・通知・表示拒否、新入力保持。                                          | 製品変更なし。具体的な追加残件なし。                                    |
| OP11 URL更新        | 操作別の送信URL／空シート名保持、通信失敗後の再表示、旧callback拒否、操作終了時の破棄、metadata先行変更なし。                              | 製品変更なし。具体的な追加残件なし。                                    |
| OP12 地図取込取消   | 解析／保存owner分離、段階別取消、commit開始後の取消拒否、busy、旧cleanup拒否、設定／reset／previewと保存待ちの合成。                       | 製品変更なし。具体的な追加残件なし。                                    |

OP07の追加12ケースは、JSON→XLSX／XLSX→JSON、旧要求の成功／通常失敗／AbortError、新候補を保持／取消の組合せである。古い結果の復活、通知、保存、新候補の破棄がなく、その後の入力を正しいownerで受理することを確認した。

## 共通保存契約と既存動作

- DB 11、JSONバックアップversion 2、完全版イベントXLSX 3.0、XLSX Worker protocol 2を維持する。依存ライブラリ、保存キュー、別系統の書込を追加していない。
- 既存のapplication mutation coordinator、request／commitPatch、対象世代・CAS・確認tokenを使う。成功後の二重適用、取消によるイベント全体のinvalidate、未送信ホールdraftの通常バックアップへの混入は追加していない。
- 保存結果不明と `CommittedStateApplyError` の共通停止理由を同期伝搬する契約を維持する。再送・flush・自動保存・後続要求の停止と受理済み入力の保持は、既存の実Worker／IndexedDB回帰を含めて確認する。
- 通常の購入・数量・メモへ全snapshot複製、全地図clone、新しい保存待ち、追加書込を導入していない。通常I/Oの最終ソース比較も基準と一致した。
- 最終ソースの購入・予定数量・メモは、修正前後とも各操作でitems RPC 1回、完了readwrite transaction 1回、ObjectStore変更要求9回だった。内訳はeventListsのdelete 2／put 2、syncQueueのdelete 1／put 4で、開くstore集合12種類も同じ。各1観測の構造比較であり、応答／保存完了の単発時間は性能合否に使用していない。メモの保存完了時間には既存debounceを含む。
- Full／Virtual／RetainedViewportの既存選択、offscreen編集保持、Canvas保持、drag開始時の既存fallbackと終了後の復帰を維持する。
- modal登録は開閉時のowner操作とfocus移動時の包含判定に限定し、通常renderごとのdocument全体探索を追加していない。

## 性能に関する変更と測定の区別

基準は全操作20サンプル以上、中央値55.0ms以下、95%点100ms以下。150／500品目・16条件・各6操作、既存1,500品目、専用drag8構成・60区分を維持し、保存完了を操作反応から分離する。過去の50ms基準の記録と当時の合否は変更しない。

今回の最終ソースに保持した性能変更は、閉じている単数量限数選択dialogのhook処理を開いている部品へ移すこと、drop検証で既に作った訪問projectionと所属IDを再利用すること、ViewportContentの結果が確定した時点で不要な子孫探索を省くことである。Viewportでは既存の可視・保持・印刷・focus・pin条件を先に判定し、要求key集合が空ならrequested descendantの探索を省く。保存形式・訪問key・表示順・viewport高さの測定時点・保持契約は変更しない。

訪問先の番号・block正規化では、同じ入力文字列のNFKC・空白処理・枝番判定を、各4,096件上限の別々のFIFO cacheで再利用する。raw文字列をkeyとし、空文字、大小文字、先頭ゼロを含む既存の出力・公開APIを維持する。品目objectの参照や変更前の値を正本にせず、同じ品目の直接変更・cloneでも最新文字列を判定する。evictionは再計算を生むだけで結果を変えない。Unicode・空欄・alias・mutation・clone・5,000件入力後の再計算を追加試験と独立コード照合で確認した。通常保存のI/O、snapshot複製、全件走査は追加していない。

ResizeObserverの初回測定を遅延させる案、viewport高さkeyの文字列memo案、品目参照をkeyとするexecution visit keyのWeakMap memo案は試験したが、必要な性能改善を確認できず撤回した。同期高さ測定と既存の保持動作を維持し、実験ソース・試験記録・未達測定は別名で保存している。最終ソースのraw文字列正規化cacheは、撤回した品目参照memoとは別の処理である。

### 以前の証跡と今回の測定

以前の最終測定対象92ファイルのSHA256は、今回修正前の `f59e07e` とすべて一致した。以前の通常150／500品目は最大中央値33.0ms／最大95%点41.1ms、既存1,500品目は48.2／52.8ms、専用dragは52.5／60.5msだった。この一致確認は今回の新規性能測定そのものではない。

今回の環境で修正前 `f59e07e` を再ビルドし、負荷の大きい500品目・スペース別ONの2条件を新規測定すると、drop中央値はnative55.8ms、touch57.8msで55.0msを超えた。修正前にも今回の環境で未達があることと、今回の最終ソースの通過判定は分ける。以前の合格値を今回の再測定値へ置き換えず、修正後の基準未達を修正前の未達だけで免除しない。

修正直後の専用drag8構成では6構成成功・2構成未達（500品目ONのnative56.3ms、touch56.9ms）。途中の短絡化、Observer案、高さkey memo案にも未達が残った。CPU profile付き測定は診断用であり、最終合否には使用しない。初期のCPU flagのみの試行と、実profile取得済みの記録も区別している。

高さkey memo案の保存済み試行には、性能suiteの開始（1792384755596ms）とfocused Vitestの終了（1792384756568.4517ms）が約972ms重なった記録が1件ある。この試行は非並列の性能証跡として扱わず、最終合格判定に使用していない。最終採用ソースの測定は全32件を順次実行し、重い試験との並列を避けた。

最終測定に先立ち、raw文字列正規化cacheと空request短絡を含む製品buildの500品目・スペース別ONのnative／touch 2条件が予備測定で成功した。この2条件だけで完了とせず、続けて同じbuild・fixture・1 workerで専用drag全8構成と通常24構成を順次測定した。

### 最終性能結果

最終ソースの専用dragは150／500品目×native／touch×スペース別ON／OFFの8構成すべて成功し、失敗・スキップ・flakyは0だった。全60区分の最大中央値50.2ms／最大95%点59.8ms、各区分20サンプル以上で基準を満たす。pointer中の既にmount済みの無関係なカード／グループの更新・再mount、書込要求、完了readwrite transactionはいずれも0。viewport進入に必要な新規mountは区別する。通常24構成もすべて成功し、最終性能測定は計32件で失敗・スキップ・flaky 0だった。通常の150／500品目は96区分・2,120サンプル、既存1,500品目は48区分・1,060サンプルで、いずれも最小20サンプル。全生サンプルから再計算した中央値・95%点が指定基準内であることを確認した。最終全体回帰も通過し、原本への反映と保全照合は本書確定後に実施する。

開始／終了は定常guide／dropと分け、既存のrenderer切替を含む独立した20サンプルの区分で比較した。以前の同一fixture測定と今回の構成別中央値の範囲は、開始が修正前12.9～19.4ms／今回13.2～18.2ms、終了が7.5～12.9ms／7.6～13.5ms。終了中央値の最大増分は500品目・touch・OFFの8.1→9.8ms（+1.7ms）だった。これらは測定時点の異なる観測を含むため、一律の性能改善・劣化なしとは断定しない。

今回の環境で新規測定した500品目・ONの修正前／今回比較は、開始がnative18.3→18.2ms、touch19.8→17.1ms、終了がnative12.1→12.4ms、touch10.1→11.1msだった。既存fallbackへ新しい絶対時間上限を課したり、rendererを再設計して回避したりしていない。touchの意図的な長押し時間は開始反応から分離する。測定対象buildは各report内の識別を参照する。全生サンプルの再集計と対応比較は [performance-summary](../artifacts/op19-followup/performance-summary.json) に記録し、最終ソースmanifestは最終文書確定後に再生成する。

| 範囲                                   | 最終結果                                                                           | 証跡                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 通常150／500品目・16条件・各6操作      | 全96区分で通過。最大中央値32.5ms／最大95%点37.8ms、2,120サンプル、最小20。         | [通常操作の最終生データ](../artifacts/op19-followup/shopping-performance-report.json)、[集計](../artifacts/op19-followup/performance-summary.json) |
| 既存1,500品目・8条件・各6操作          | 全48区分で通過。最大中央値47.4ms／最大95%点50.3ms、1,060サンプル、最小20。         | [通常操作の最終生データ](../artifacts/op19-followup/shopping-performance-report.json)、[集計](../artifacts/op19-followup/performance-summary.json) |
| 専用drag8構成・60区分                  | 全区分で通過。最大中央値50.2ms／最大95%点59.8ms、最小20サンプル。                  | [最終専用drag](../artifacts/op19-followup/drag-performance-report.json)                                                                            |
| pointer中の無関係な更新／再mount・書込 | いずれも0。必要なviewport進入の新規mountは別計数。                                 | [最終専用dragのlocality／pointerIO](../artifacts/op19-followup/drag-performance-report.json)                                                       |
| 通常購入・数量・メモの保存I/O          | 基準と全3操作で一致。各items RPC 1回・物理commit 1回・変更要求9回、同じstore集合。 | [最終I/O比較](../artifacts/op19-followup/io-comparison.json)                                                                                       |

## 機能・品質検証

Windows 11、PowerShell 7.6.3、Node.js 24.19.0、npm 11.19.0、Playwright 1.62.1／Chromium 151.0.7922.34。製品は標準 `build:app`。最終性能測定は1 workerで順次実行し、重い検査と並列にしなかった。

| 検証                               | 初回確認（性能調整前）                                                               | 最終ソース                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 全Vitest                           | 3,142成功、88既存スキップ、失敗0。261ファイル成功・1ファイルスキップ。maxWorkers=2。 | 3,159成功、88既存スキップ、失敗0。262ファイル、maxWorkers=2。JSON success=true。                             |
| 明示した機能Chromium回帰10spec     | 224成功、スキップ・flaky 0。                                                         | 224成功、失敗・スキップ・flaky 0。327.5秒。                                                                  |
| 今回追加のブラウザ境界回帰         | 10成功。全体224件に含む。                                                            | 10成功。最終224件に含む。                                                                                    |
| API                                | 21成功。                                                                             | 21成功、失敗・スキップ0。                                                                                    |
| typecheck／release-tools typecheck | 成功。                                                                               | 成功。                                                                                                       |
| architecture／試験所属／DB互換性   | 成功。DBはローカル契約の確認で、remote観測なし。                                     | 354 production files／1,730 import edges、例外0。試験所属262ファイル。DBローカル契約成功（remote観測なし）。 |
| encoding／変更対象ESLint・Prettier | 成功。                                                                               | 1,113テキストの検査と変更対象ESLint／Prettierが成功。BOM・U+FFFD・文字化け・不自然な疑問符なし。             |
| 標準製品 `build:app`               | 成功。                                                                               | 成功。最終bundleは下記SHA256。                                                                               |

最終性能測定に使用し、最終Vitest・品質検査と同じソースから作った製品bundleのSHA256は `729425339A9C9796D505C73B79A8CEC837A8A904162512C6D841678DB6FDC8FD`。HEADが同じ変更中buildのため、bundleと確定後の変更ソースmanifestで測定対象を識別する。

追加の `verify-release-a-build.mjs` は未commit変更のあるcheckoutをdirty sourceとして拒否する。今回修正前の `f59e07e` でも同じ拒否を確認した。該当buildのlegacy cleanup capabilityはforced-offであり、この追加公開用gateを回避する製品変更は行っていない。標準 `build:app` の成否と公開条件の検査を区別し、公開は実施していない。

## 証跡

| 内容                   | 記録                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 環境・初回品質         | [environment](../artifacts/op19-followup/environment.json)、[quality status](../artifacts/op19-followup/quality-status.json)、[quality log](../artifacts/op19-followup/quality.log)                                                                                                                                                                                                                                                                                                                                                |
| 最終ブラウザ・I/O      | [Chromium224件](../artifacts/op19-followup/browser-report.json)、[通常保存I/Oの修正前後比較](../artifacts/op19-followup/io-comparison.json)、[比較スクリプト](../artifacts/op19-followup/compare-persistence-io.ps1)                                                                                                                                                                                                                                                                                                               |
| 最終ソースと原本反映   | [最終ソースmanifest（本書確定後に生成）](../artifacts/op19-followup/final-source-manifest.json)、[コピー・既存成果物の保全照合（反映後に生成）](../artifacts/op19-followup/copy-verification.json)                                                                                                                                                                                                                                                                                                                                 |
| 最終Vitest・品質       | [全VitestのJSON結果](../artifacts/op19-followup/vitest-final-report.json)、[型・architecture・DB・encoding・API・lint／format](../artifacts/op19-followup/quality-final.log)、[標準製品build](../artifacts/op19-followup/build.log)                                                                                                                                                                                                                                                                                                |
| 初回全体回帰           | [全Vitest](../artifacts/op19-followup/vitest-before-performance-optimization.log)、[Chromium224件](../artifacts/op19-followup/browser-before-performance-optimization-report.json)、[追加境界10件](../artifacts/op19-followup/regression-browser-report.json)                                                                                                                                                                                                                                                                      |
| 修正前の境界再現       | [数量・focus](../artifacts/op19-followup/esp-op19-baseline-browser.json)、[OP04の修正前実UI](../artifacts/op04-before/)                                                                                                                                                                                                                                                                                                                                                                                                            |
| 以前の測定対象との一致 | [92ファイルのhash照合](../artifacts/op19-followup/earlier-baseline-source-check.json)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 今回環境の修正前性能   | [500品目ONの2条件](../artifacts/op19-followup/drag-baseline-current-environment-report.json)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 未達を含む初回性能     | [専用drag初回8構成](../artifacts/op19-followup/drag-performance-initial-report.json)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 最終専用drag           | [全8構成・60区分、描画・書込・開始／終了](../artifacts/op19-followup/drag-performance-report.json)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 最終通常操作           | [24構成・144区分の生データ](../artifacts/op19-followup/shopping-performance-report.json)、[通常操作CSV](../artifacts/op19-followup/shopping-rows.csv)、[以前の測定との対応比較CSV](../artifacts/op19-followup/shopping-pairs.csv)                                                                                                                                                                                                                                                                                                  |
| 最終性能の再集計       | [全区分集計・生サンプル参照・局所性](../artifacts/op19-followup/performance-summary.json)、[専用drag CSV](../artifacts/op19-followup/drag-rows.csv)、[再集計スクリプト](../artifacts/op19-followup/summarize-performance.ps1)                                                                                                                                                                                                                                                                                                      |
| 診断                   | [実CPU profile](../artifacts/op19-followup/drag-cpu-profile-report.json)、[区間集計](../artifacts/op19-followup/drag-cpu-summary.json)                                                                                                                                                                                                                                                                                                                                                                                             |
| 撤回した実験           | [Observer案の記録](../artifacts/op19-followup/drag-performance-observer-attempt-report.json)、[Observer案ソース](../artifacts/op19-followup/observer-experiment-source/)、[高さkey memo案の記録](../artifacts/op19-followup/drag-height-key-memo-report.json)、[高さkey memo案ソース](../artifacts/op19-followup/height-key-memo-experiment-source/)、[visit key memo案の記録](../artifacts/op19-followup/drag-visit-key-memo-report.json)、[visit key memo案ソース](../artifacts/op19-followup/visit-key-memo-experiment-source/) |
| 保全                   | [既存8ファイルの修正前hash](../artifacts/op19-followup/preservation-before.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

最終ソースmanifestは本書確定後に生成する。原本への反映・保全照合は続けて実施し、反映後は [copy-verification](../artifacts/op19-followup/copy-verification.json) を参照する。本書確定時点では反映前であり、コピー済みとは記録していない。途中の失敗、未達、撤回案、無効な診断試行は最終合格値と混同しない。

## 文字コード・原本保全

新規文書はUTF-8 BOMなし・LFで保存し、strict UTF-8で再読込した。今回の製品ソースは元のUTF-8 BOMなし・LFを維持する。U+FFFD、不自然な疑問符、BOM変化、改行だけの大量差分を検査する。元フォルダーの既存未追跡計画・レビュー成果物8ファイルを修正前hashで保全し、反映時にも再照合する。
