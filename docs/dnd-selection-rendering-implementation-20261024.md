# D&D・選択・描画プランの実装状況（2026-10-24）

## 2026-10-26：対象3群を150msへ変更した後の状態

最新ユーザー指定により、D&D計画に直接関連する `range`／`drag`／`transfer` の中央値・95%点をともに150.0ms以下へ変更した。shoppingは65.0ms／100ms、PR各2回／完了各10回、150／500品目のshopping16・range20・drag8・transfer100の全144ケース、530主指標・46保存補助、全操作・終了点・fixture・保存整合性・retry 0を維持する。1,500品目は通常の修正・必須受入対象外である。基準IDは `dnd-selection-rendering-150-150-2026-10-26`。旧50／55／65／110msの元値・当初合否・rawを保持し、150ms再判定は別記録に保存する。

製品source be259は、Worker私有freezeのgeometry／ordinary分離、planShoppingMove内部だけのreadonly item clone省略、pickupの装飾を保つCSS限定drop opacity即時化、forced viewportの不要な親bbox取得の遅延を含む。一般API隔離、原子性・修復・optional field・確認・manualHallId、offset／anchor／initialBatch、既存のkey・focus・入力保持を維持する。150msの契約・文書変更と製品sourceの識別を分け、後日のsourceへ旧採取を付け替えない。

be259製品の品質記録はunit2,381／integration930通過・既存88skip／Worker254、計3,565通過、foundation1,353通過・skip0。型・lint・encoding・test membership・architecture・DB互換・全体format・Release A buildも通過済みである（[品質ログ](D:/esp-dnd-audit-remediation-validation-20261025/completion10-20261026/lazy-be259e8-validation)）。これは150ms契約変更後の検証や正式全条件受入の代替ではない。

Windows installed PWAのbe259 run `20261026T032753Z-d44cf835` は2操作ケース成功、[独立rawレビュー](D:/esp-dnd-audit-remediation-validation-20261025/completion10-20261026/pwa-passed-raw-independent-review/review.json)37確認・0失敗。自然pending、gate付き数量・メモ、同じe1 DOM・focus・caret、後発選択、保存順、全500品目と3順、reloadを確認した。gate付き機能診断を性能値へ混ぜず、physical touch・human feel・モニター走査の証明とはしない。

旧110msのbe259通常runは、最新基準へのユーザー変更によりfunctional段階で中断した。shopping／range／drag／transferは全not-runであり、原run-resultの初期status failedは製品失敗の判定ではない。[中断sidecar](D:/esp-dnd-audit-remediation-validation-20261025/completion10-20261026/final-normal-be259e8-20261026T033140806Z-126ee514/user-criteria-change-interruption.json)とrawを保持する。新150msでの全条件通常runner・前後比較は未実施、実GitHub CIも未実施であり、P5・計画全体の完了は未認定である。過去bfffの4性能失敗、d467の1性能失敗と旧PWA失敗も履歴として残す。

以下の回数・scope変更と旧実装記録は各時点の履歴である。回数2／10・1500除外は現行でも維持し、旧110msの時間基準は本節で150msへ上書きする。

## 2026-10-26の測定回数変更

最新のユーザー指定により、性能の測定回数だけをPR確認 `pr` の各2回、実装完了判定 `completion` の各10回へ変更する。既定は `completion`。`npm run test:browser:pr`／`npm run test:browser:completion` と通常runnerの `--profile`、各性能群へ渡す `ESP_PERFORMANCE_PROFILE`、CIのPR／非PR選択を揃える。

shopping16・range20・drag8・transfer100の全144ケース、530主指標と46保存補助指標、全操作、時間基準、fixture、ウォームアップ、計測終了点、保存・再読込・整合性検証、retry 0は維持する。`samplingPolicyId`／`samplingProfile` で回数と用途を記録し、PR2回の成功を実装完了の証拠へ流用しない。前後比較も同じprofileで採取する。

過去20回のraw・当初合否・元artifactと、回数変更時に停止した旧runは保持する。この方針変更や配線の更新自体は性能通過・計画完了を示さない。採用ソースの10回による全条件受入と前後比較は別の新規記録で確定する。下記の過去検証件数・旧サンプル数は各記録時点の履歴である。

## 2026-10-25の対象範囲変更

ユーザー指定により、1,500品目は通常利用の範疇ではないため修正対象外とした。必須受入はshopping16条件（150／500品目）・range20・drag8・transfer100、全144ケース・530主指標・46保存補助指標とする。通常6操作の65ms／100ms、対象3群の110ms／110ms、保存・整合性検証は維持し、測定回数は上記2026-10-26の用途別指定に従う。1,500品目の既存8性能条件とbounded DOM 1件は任意診断として保持し、修正必須・未完了の根拠にしない。

以下は2026-10-24時点の実装・検証記録であり、記載されたshopping24条件や旧HEADの結果は当時の対象範囲の履歴として保持する。今回の新対象範囲による性能採取・前後比較・通常runner・実CI・実端末PWAの最終結果は、別の新規記録で確定する。

指定プラン `D:/esp-dnd-plan-20261021/docs/dnd-selection-rendering-remediation-plan-20261021.md` を現ソースと照合し、既存実装を維持して不足差分を統合した。ソースへの反映は済んでいるが、全性能条件の通過・同条件の変更前後比較・実端末PWA確認は未完了である。

## 統合した変更

- 描画: 未変更のgroup metadataを比較してから配列生成を省略する。全比較項目、`Object.is`、数量・価格・備考、訪問ID、gate条件、commit後のcache採用を維持する。
- 順序検証: retained rendererで未mountの行がある場合も、全論理行順と実カードのID・重複を検証する。保存後の順序・品目内容・frame検証を維持し、計測終了点は変更しない。
- 性能基準: `scripts/shopping-performance-evidence-contract.mjs` に中央値65.0ms以下・95%点100ms以下・各20サンプル以上を集約した。6つの性能spec、証拠検証器、前後比較器で共用し、新しい判定には基準日2026-10-24と閾値を記録する。過去のraw・当初の合否は書き換えない。

親選択のmembership同期、受理receipt、移動対象だけの選択消費、同順drop、専用保存command・順序delta・完全snapshot復旧・write-stopは既に実装されていたため、仕様を再実装していない。保存前の画面移動、全体の検証省略、保存の自動再送は追加していない。

## 今回の検証

| 検証                                     | 結果                                                        |
| ---------------------------------------- | ----------------------------------------------------------- |
| 性能契約・検証器・比較器のNodeテスト     | 174件通過                                                   |
| 順序oracle・統計helperの自己テスト       | 17件通過                                                    |
| 型検査                                   | 通過                                                        |
| 文字コード検査                           | 通過                                                        |
| test project所属・architecture・DB互換性 | 通過                                                        |
| 変更対象のESLint・Prettier・差分検査     | 通過                                                        |
| 性能ケース収集                           | shopping 24、range 20、drag 8、transfer 100                 |
| 一般機能ケース収集                       | 436件。収集のみで実行通過とは扱わない                       |
| 製品ビルド                               | 独立配置のcleanな作業ツリーでbuild:release-a通過（1937c6d） |

検証記録: `D:/esp-dnd-remediation-validation-20261024/`。作業用の依存フォルダー共有ではrelease graph検証が外部moduleを拒否したため、その失敗ログを保持した。npm ci --offlineによる独立配置で再実行し、source cleanのrelease-a検証が通過した。

今回の製品ソース `src` / `public` は、既存検証コミット `1ba6062dada5f29c9ac388f8b4c31ff18a4b29ba` と同一である。既存のunit・integration・Worker・release build通過記録は `D:/esp-dnd-implementation-20261021/artifacts/dnd-selection-rendering/final-quality-metadata-preguard-20261024-c2ea9ee1433f4618a2a75b86e1c40160/result.json` にある。これは今回の全テスト再実行としては数えない。

## 性能と残作業

最新の保存済み正式実行は旧HEAD `6b15242` のものであり、今回の最終ソースの通過証拠ではない。同記録を65/100msで参考再集計しても、transferの応答25条件・frame40条件に数値未達があり、順序検証エラーやサンプル不足も別に残る。保存待ち中と反映後の次入力は同記録では基準内だった。

- 全4性能群について、最終製品ソース・同一計測器・独立したrun IDで合否を確定する。
- 変更前後の中央値・95%点・差分msを同条件で比較し、正方向や正常操作の再現する悪化を確認する。
- 実端末の単一画面PWAで、描画・ちらつき・次操作・地図と訪問先の同期を確認する。

既存の変更前／変更後採取プロセスは継続中であり、今回、新しいブラウザ性能採取は重ねて起動していない。未完了・失敗・旧基準の結果を成功へ置き換えない。

## 差分と文字コード

元の作業ツリーのAGENTS.mdと未追跡資料は保持した。変更した既存18ファイルはUTF-8 BOMなし・LFを維持し、U+FFFDと日本語破損はない。新しいこの文書もUTF-8 BOMなし・LFとする。

未測定の訪問ID生成最適化案は、比較対象の製品ソースを維持するため `codex/visit-id-allocation-candidate-20261024` に分離し、今回の統合には含めていない。
