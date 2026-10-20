# 保存確定後の停止漏れ補修と全12項目の検証結果

- 作業日: 2026-10-19（日本時間）
- 対象計画: [操作不整合12件の実装計画](user-operation-consistency-remediation-plan-20261018.md)
- 修正前HEAD: `418b92f`
- 最終検証snapshot: `3908b1328ddd8c8f6e03e1c9dfcd755b6533a1eb`（独立worktreeだけに作成）
- 最終判定: 保存安全性の残件を解消。全12項目の機能回帰と最終性能測定を通過。ドラッグ初回1区分の未達は保全し、再測定と区別して併記する。

通常運用は単一画面とし、別タブ同時編集だけで成立する数量競合を未完了判定に含めない。過去の計画、実績、性能記録は変更しない。

## 保存停止漏れの修正

製品変更は [atomicRestoreTransaction.ts](../src/persistence/db/atomicRestoreTransaction.ts) のみ。DB transactionの確定後に行う日別記録の採用、metadata・checkpoint更新、復旧候補の後処理、cache作成を一つの例外境界で保護した。後処理が失敗したらcacheを無効化し、既存の終端エラーは同じオブジェクトで伝え、それ以外は原因を保持した `PersistenceOutcomeUnknownError` に変換する。

transaction確定前の処理はこの境界に含めない。未保存が確定したabortは通常の失敗として扱い、従来どおり再試行できる。確定後の失敗は既存adapter、保存hook、coordinatorの共通停止通知へ伝わり、再render前から再送・後続保存を止める。

新しい保存キュー、snapshot複製、全品目走査、保存I/Oは追加していない。DBスキーマ、JSON／XLSX形式、Worker protocol、依存ライブラリは変更していない。

## 追加した回帰試験

- [adapter試験](../src/persistence/adapters/indexedDbPersistenceCommandAdapter.test.ts): 正式adapterとfake IndexedDBを使用し、DB確定直後だけ `localStorage.length` を失敗させた。修正前は通常のSecurityErrorとなることを再現。修正後は数量2のDB確定を保ち、25の書込入口が同じ終端理由で拒否され、数量3への再保存を含む後続readwrite transaction開始・完了は0。明示abort後に数量2へ再試行できる対照試験も通過した。
- [実接続試験](../src/app/state/fallbackTerminalStop.integration.test.tsx): 実adapter・DB・保存hook・coordinator・画面状態管理を接続。共通停止の同一性、再render前のretry／flush、待機中の要求、予約済みtimer、新規保存の停止、requiresReloadと要求清掃、受理済みメモの表示／JSON保持を確認。復元確定後のnavigation例外も検証した。各ケースのreadwrite transactionは合計1回で、停止後は増えない。
- [追加UI試験6件](../tests/browser/user-operation-final-contracts.spec.ts): 同一key・同一内容の地図再取込完了と旧block／hall選択listenerの拒否、簡易ホール連続同期、交換対象選択後の削除、最後の遅参対象削除、再開時の遅参対象差替えを実App・DB・再読込で確認。旧listenerの実除去、現行イベントの正の対照、旧callbackごとの描画後確認により、複数callbackの相殺による見逃しも防いだ。
- [復元確定後UI失敗試験](../tests/browser/restore-committed-ui-failure.spec.ts): 実際に出力した完全版イベントXLSXを復元し、DB確定後の完了通知だけを例外化。新イベントのDB確定、再読込案内、再取込・再試行・新規購入・timer待機・JSON出力での追加書込0、再読込後の復元値を確認した。別要求の受理済み入力保持は上記の実接続試験で確認している。

## 全12項目の照合

今回の追加製品修正はOP03。ほかは既存実装の回帰確認と、留保されていた組合せの追加試験である。

| 項目                    | 最終確認                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------- |
| OP01 地図編集と画面移動 | 固定session、破棄と訪問遷移、同一地図再取込完了、解除済み旧選択の拒否               |
| OP02 ホール同期         | draft原子保存、詳細・簡易の連続同期、表示ID、共有マップと日別設定の保持             |
| OP03 保存失敗           | draft保持、確定的失敗の再試行、Worker／fallbackの確定後失敗から全書込停止           |
| OP04 列間ドラッグ       | native／touch、50％境界、不能位置拒否、末尾合流、候補ソート、保存・再読込、専用性能 |
| OP05 モーダル           | focus循環、busy中Escape、交代・入れ子、遅着保存失敗との調停                         |
| OP06 数量編集           | 予定数量draft、通常／限数の往復、確認取消、保存・再読込一致                         |
| OP07 復元候補           | JSON／XLSXのowner、旧結果拒否、確定後UI失敗の終端停止と再復元拒否                   |
| OP08 訪問交換           | IDによる交換、異なる長さ、選択後削除、Undo／Redo、保存・再読込                      |
| OP09 空フェーズ         | 初期同期、後回し・遅参の末尾回復、対象差替え、完了と対象外データ保持                |
| OP10 CSV失敗            | 失敗通知、同一ファイル再選択、旧読込拒否                                            |
| OP11 URL更新            | URL・空シート名保持、旧callback拒否、数量承認・世代照合                             |
| OP12 地図取込取消       | 解析と保存要求の取消分離、段階別取消、busy・旧要求の終了                            |

## 機能と品質の検証

| 検証                                     | 結果                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 全Vitest                                 | [3,195成功、既存スキップ88、失敗0](../artifacts/op03-terminal-stop-20261019/vitest-complete.json)                       |
| Chromium機能回帰                         | [236成功、失敗・スキップ・flaky 0](../artifacts/op03-terminal-stop-20261019/browser-final.json)                         |
| API                                      | 21成功、失敗0                                                                                                           |
| 型・architecture・試験所属・DB互換性契約 | すべて成功                                                                                                              |
| 変更対象のESLint／Prettier、文字コード   | すべて成功                                                                                                              |
| clean製品buildとRelease A検証            | [成功](../artifacts/op03-terminal-stop-20261019/build-final-clean.log)。source clean、cleanup forced OFF、PWA証跡を確認 |

全Vitest通過後の変更はブラウザ試験だけであり、製品377ファイルとsrc内の変更対象試験のhash一致を確認した。追加UI試験の補強後、新たな復元UI試験も含めて最終buildから236件を再実行した。

## 操作性能と保存I/O

通常24構成とドラッグ8構成は今回新規測定した。標準製品build、1 workerで順番に実行し、重い機能・品質試験とは重ねていない。基準は各区分20サンプル以上、中央値55.0ms以下、95％点100ms以下。生サンプルからnearest-rankで独立再集計し、保存完了時間とドラッグ開始・終了は操作反応から分けた。

| 範囲                         | 区分数 | 最少サンプル | 最大中央値 | 最大95％点 | 判定 |
| ---------------------------- | -----: | -----------: | ---------: | ---------: | ---- |
| 150／500品目・全16条件×6操作 |     96 |           20 |     32.1ms |     46.1ms | 通過 |
| 既存1,500品目・8条件×6操作   |     48 |           20 |     49.5ms |     64.6ms | 通過 |
| native／touchドラッグ・8構成 |     60 |           20 |     54.3ms |     67.7ms | 通過 |

pointer移動中の物理書込、無関係なカード／グループ更新、既にmount済みの要素の再mountはすべて0。自動scrollで必要な新規mountは別集計した。

比較対象は保存済みの `op19-final-remediation-20261019` の生データであり、今回新規測定した修正前値ではない。対応する中央値増分の最大は通常操作 +25.2 ms、ドラッグ +6.9 ms。保存完了80区分と開始・終了40区分の比較も、操作反応とは分けて [performance-summary](../artifacts/op03-terminal-stop-20261019/performance-summary.json) に記録した。過去の50ms基準・当初の合否は変更していない。

ドラッグ初回は500品目・native・スペース別ONのdropが中央値55.4ms・95％点73.4msとなり不合格だった。[初回記録](../artifacts/op03-terminal-stop-20261019/drag-initial.json)は改変せず保持した。修正前HEADを新規buildして同じ8構成を測定し、その後、同じ修正後buildの全8構成を再測定した。対象dropは修正前55.0／59.8ms、修正後54.3／67.7msで通過。追加の製品変更、閾値変更、初期サンプルの除外はない。初回と再測定の全40サンプルは参考集計として54.9／71.3msであり、初回不合格の代替判定には使わない。原因を特定したとは扱わず、[3run比較](../artifacts/op03-terminal-stop-20261019/drag-run-comparison.json)に全記録を残した。fresh baselineと最終runの全60区分における中央値増分の最大は+2.8msだった。

通常操作の保存済み比較における最大+25.2msは、1,500品目・非集中・地図表示・PCの「戻る」（24.3→49.5ms）だった。大きな差のため同構成を修正前後で追加測定し、両方とも全6操作が通過した。「戻る」は修正前25.6／34.9ms、修正後24.7／31.9msで、差は再現しなかった。このfresh比較の中央値増分最大は+2.2ms。主表と全24構成の生データは追加測定で置き換えず、[通常操作の4run比較](../artifacts/op03-terminal-stop-20261019/normal-focused-comparison.json)へ別記した。

通常の購入・予定数量・メモは、各操作につきitems Worker要求1回、完了readwrite transaction1回、ObjectStore変更9回、対象store12種類を維持した。変更内訳はeventListsのput2／delete2、syncQueueのput4／delete1で従来値と一致。[実I/O比較](../artifacts/op03-terminal-stop-20261019/ordinary-io-summary.json)は各操作1観測であり、性能判定は上表の各20サンプル以上による。

新規生データ: [通常操作](../artifacts/op03-terminal-stop-20261019/shopping-performance.json)、[ドラッグ](../artifacts/op03-terminal-stop-20261019/drag-performance.json)、[測定環境](../artifacts/op03-terminal-stop-20261019/performance-environment.json)。

## 文字コードと原本への反映

製品・試験の変更5ファイルはUTF-8 BOMなし・LFを維持した。日本語代表行「ユーザー登録」「エラーが発生しました」を再読込し、U+FFFD、意図しないBOM変化、改行だけの大量差分はない。疑問符の増分は試験のTypeScript構文として確認した。結果文書もUTF-8 BOMなし・LFで新規作成した。

実装と検証はクリーンな独立worktreeで行い、最終ファイルだけを原本へ反映した。原本のHEAD `418b92f` は変更せず、利用者の既存未追跡8ファイルはすべてSHA256一致で保全。[最終ファイルと反映照合](../artifacts/op03-terminal-stop-20261019/copy-verification.json)、[文字コード確認](../artifacts/op03-terminal-stop-20261019/source-encoding-final.json)を参照。
