# 操作不整合12件の最終残件修正・検証結果

- 作業日: 2026-10-19（日本時間）
- 対象計画: [操作不整合12件の実装計画](user-operation-consistency-remediation-plan-20261018.md)
- 修正前HEAD: `3e79088`
- 利用前提: PWAの単一画面。同じデータを別タブ・別ウィンドウから同時編集するケースは必須修正の根拠に含めない。
- 状態: **機能・品質・指定性能基準をすべて通過。** 今回のOP02・OP05残件を解消し、確認範囲で全12項目に未解決の残件はない。過去の計画・結果・性能記録は変更しない。

## 今回修正した残件

**OP02: 同期元と同じ実マップへの詳細ホール同期。** 同期先を日付まで識別する狭いcontextを追加した。同期元は詳細・簡易を含む一覧確定済みdraft全体を保存し、同じ実マップを使う同期先には詳細部分だけを反映する。同期先固有の簡易ホールの巡回順・訪問リスト・割当を保持し、同じ保存先のclone・重複保存を増やさない。

実command・coordinator・原子的保存をfake IndexedDBへ接続し、`1日目` を同期元、`１日目`・`1 日目` を共有マップの同期先として検証した。同期元簡易ホールの編集・新規追加、同期元自身と重複した同期先の指定を含め、一回のcommit、同期先の簡易C→簡易Bの順序・訪問・割当保持、保存後の再読込値との一致を確認した。従来の別マップ同期と連続同期も通過した。

**OP05: 独立modalへの遅着保存失敗focus。** URL更新、更新確認、イベント名変更、出力設定、地図取込、ブロック定義、訪問リスト保存確認、イベント操作メニューの8画面を共通modal所有者・キーボード処理へ接続した。最後のmodalを閉じるまで背景への自動focusを保留する。地図取込の取消可否、保存中のEscape禁止、訪問リストの明示的な破棄操作、ブロックのセル選択への移行は維持した。共通hookは無効fieldset内の入力もfocus候補から除外する。

実アプリ・新規context・単一画面で、URL更新／更新確認／名称変更／地図取込／イベント操作メニューの5ケースを確認した。購入保存を保留して各画面を開き、遅れて失敗させると、修正前は背景へのfocus移動で失敗し、修正後はすべて成功した。Tab／Shift+Tab／Enterによる背景Worker要求は0、最後のclose後だけ保留focusと再試行が有効になる。出力設定は出力snapshotの読込が先行保存を待つため、同じ実アプリ手順による再現対象にせず、実部品と実 `useApplicationSnapshot` を接続した遅延失敗試験で確認した。入れ子、画面交代、失敗解消後の起点復帰、全入力無効中も確認した。

## 全12項目の照合

今回の追加製品修正はOP02・OP05である。他項目は既存実装の回帰検証結果であり、新たに修正したとは扱わない。

| 項目 | 確認範囲                                                  | 今回の判定                 |
| ---- | --------------------------------------------------------- | -------------------------- |
| OP01 | 地図編集session、旧選択拒否、移動と訪問保存・破棄         | 既存回帰通過               |
| OP02 | draft一括同期、ID固定、連続同期、共有マップ・日付別順序   | 残件修正・追加試験通過     |
| OP03 | draft保持、取消・再試行、結果不明・適用失敗時の全書込停止 | 既存回帰通過               |
| OP04 | native／touch、50％境界、合流・拒否、候補ソート・局所描画 | 機能・専用性能とも通過     |
| OP05 | focus循環、busy、交代・入れ子、遅着失敗、最終復帰         | 登録漏れ修正・追加試験通過 |
| OP06 | 通常／限数の数量往復、表示・保存一致、確認取消            | 既存回帰通過               |
| OP07 | JSON／XLSXの読込owner、取消、旧結果・cleanup拒否          | 既存回帰通過               |
| OP08 | IDによる訪問交換、異なる長さ、Undo／Redo・再読込          | 既存回帰通過               |
| OP09 | 初期同期待ち、空フェーズ回復、一時巡回・完了              | 既存回帰通過               |
| OP10 | CSV失敗通知、同一ファイル再選択、旧読込拒否               | 既存回帰通過               |
| OP11 | URL・空シート名保持、旧callback拒否、数量・世代照合       | 既存回帰通過               |
| OP12 | 解析／保存の取消分離、段階別取消、busy・旧要求終了        | 既存回帰通過               |

## 機能・品質検証

| 検証                                            | 最終結果                                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 全Vitest                                        | [3,191成功・88既存スキップ・失敗0](../artifacts/op19-final-remediation-20261019/vitest-complete.json) |
| Chromium機能回帰                                | [229成功・失敗0](../artifacts/op19-final-remediation-20261019/browser-clean.json)                     |
| API                                             | 21成功・失敗0                                                                                         |
| 型検査・標準製品build・変更対象ESLint／Prettier | すべて成功                                                                                            |
| architecture・試験所属・DB互換性・文字コード    | すべて成功。文字コードの詳細は[encoding](../artifacts/op19-final-remediation-20261019/encoding.json)  |

初回の全体ブラウザ回帰は228成功・OP09関連1失敗だった。画面切替を待たず、同じIDを持つ切替前の集中モードカードへ合成pointerdownを送れる構造を確認し、試験の待機条件へ `#focus-mode-footer` の非表示と実行列見出しの表示を追加した。製品のOP09動作は変更していない。当該ケースは修正前・修正後ソースで各5回、待機条件補強後の試験でも5回成功し、その後の全体回帰229件はすべて成功した。[初回の失敗](../artifacts/op19-final-remediation-20261019/browser-complete.json)、[修正前の5反復](../artifacts/op19-final-remediation-20261019/op09-repeat-baseline.json)、[待機条件補強後の5反復](../artifacts/op19-final-remediation-20261019/op09-ready-repeat.json)を最終合格とは区別して保管した。

## 性能と保存I/O

基準は各区分20サンプル以上、中央値55.0ms以下・95％点100ms以下。保存完了時間は操作反応と分け、過去の50ms基準の記録・当初判定は変更しない。通常150／500品目の96区分、追加1,500品目の48区分、drag8構成の60区分を生サンプルから再集計した。

通常操作の比較元は既存の [op19-followupの生データ](../artifacts/op19-followup/shopping-performance-report.json) であり、今回新規測定した修正前通常性能ではない。以前の測定対象について、manifest基準 `f59e07e` 以降のsrc／tests変更全28ファイルが今回の修正前HEADと一致することをhash照合した。記録された環境は今回と同じChrome `151.0.7922.34`、Node.js `24.19.0`、npm `11.19.0`、Playwright `1.62.1`、標準 `build:app` である。

今回の修正前drag全8構成は新規測定ですべて成功した。最終通常24構成と最終drag8構成は、重い品質・機能検査の終了後、1 workerで順次測定した。開始／終了のrenderer切替と意図的なtouch長押しは定常反応・保存時間から分け、対応する比較値を記録した。保存キュー・Worker要求・物理commitの経路を増やしていない。

| 範囲                             | 区分数 | 最少サンプル数 | 最大中央値 | 最大95％点 | 判定 |
| -------------------------------- | -----: | -------------: | ---------: | ---------: | ---- |
| 通常150／500品目・全16条件×6操作 |     96 |             20 |     34.3ms |     41.9ms | 通過 |
| 既存1,500品目・8条件×6操作       |     48 |             20 |     46.5ms |     55.8ms | 通過 |
| native／touchドラッグ・8構成     |     60 |             20 |     50.7ms |     61.2ms | 通過 |

専用dragではpointer移動中のObjectStore書込要求・readwrite transactionはともに0、無関係なカード／グループの更新0、既にmount済みの要素の再mount0だった。自動scrollに必要な新規mount48回は別集計し、予期しない新規mountは0だった。詳細は [drag-locality-io](../artifacts/op19-final-remediation-20261019/drag-locality-io.csv) を参照。

開始／終了の比較は [drag-lifecycle-pairs](../artifacts/op19-final-remediation-20261019/drag-lifecycle-pairs.csv) に記録した。対応する中央値の増分は最大3.5msで、touchの意図的な200ms長押しを別記し、定常反応へ混ぜていない。rendererの切替・保持動作も既存試験で確認した。

通常の購入・予定数量・メモは、各操作につきitems Worker要求1回、完了readwrite transaction1回、ObjectStore変更要求9回を維持した。内訳はeventListsのput2／delete2、syncQueueのput4／delete1で、transactionのstore集合12種類も同じだった。このI/O観測は各操作1観測であり、性能の合否は上表の各20サンプル以上による。

最終判定・生データの再集計・比較元の区別は [performance-summary](../artifacts/op19-final-remediation-20261019/performance-summary.json) に記録した。各操作の生データは [通常操作](../artifacts/op19-final-remediation-20261019/shopping-performance.json)、[修正前drag](../artifacts/op19-final-remediation-20261019/drag-baseline.json)、[修正後drag](../artifacts/op19-final-remediation-20261019/drag-performance.json) を参照。通常操作のattachmentにはbrowser／userAgent項目がないため、環境記録と実行環境で照合し、空欄を一致と補完していない。dragのbrowser／userAgentは修正前後で一致した。

## 文字コード・保全・最終反映

製品・試験の変更対象18ファイルはUTF-8 BOMなし・LFを維持した。U+FFFD、意図しないBOM変化、改行だけの大量差分はない。疑問符の増分はTypeScriptの任意引数・任意property等の意図した構文として確認した。永続化形式、DBスキーマ、依存ライブラリ、保存キューは変更していない。

原本の利用者作成の未追跡8ファイルは [preservation-before](../artifacts/op19-final-remediation-20261019/preservation-before.json) のhashで保全した。反映する最終ソースは [final-source-manifest](../artifacts/op19-final-remediation-20261019/final-source-manifest.json)、原本への反映と既存成果物の保全照合は [copy-verification](../artifacts/op19-final-remediation-20261019/copy-verification.json) に記録した。過去文書は上書きしていない。

**最終判定: 全12項目の機能回帰・品質検査・指定性能基準を通過。今回確認した残件2件と同系統のmodal登録漏れを解消し、未解決の残件はない。**
