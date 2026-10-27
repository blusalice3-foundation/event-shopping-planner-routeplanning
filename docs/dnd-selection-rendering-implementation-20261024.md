# D&D・選択・描画プランの実装状況（2026-10-24）

## 2026-10-28：160ms基準と相対増加の受容

ユーザーは正常500品目touch同列移動の中央値+1.95ms・95%点+4.90msを受容し、製品の追加修正を行わないと回答した。関連動作の `range`／`drag`／`transfer` は中央値・95%点とも160ms、識別子 `dnd-selection-rendering-160-160-2026-10-28` へ統一する。shopping65／100ms、PR2／completion10、全144条件・終了点・fixture・保存整合性は維持する。

以下の全144ケース通過は3eの旧150msによる実測である。新160msの判定は元raw・旧判定を変更せず別記録に保存し、新policy sourceと測定sourceを区別する。明示的に受容した同列の差を、その他の観測差の包括受容や全相対回帰解消へ拡張しない。

新160msの読み取り専用再判定は、確定方針source `b9cea9f` に結び付けて1回完了した。実測source3eの変更後主530指標は全通過し、保存46指標は別扱い。元150msのrun・raw・当初合否、変更前の機能失敗・真正未観測、全277相対増加行を保持し、受容注記は指定の同列500touch responseだけとした。[別再判定の最終記録](D:/esp-fix-validation-20261027/criteria-160-actual-reassessment-20261027T174731976Z-1d69efc8/final-handoff.json)。

## 2026-10-28：レビュー修正と自動・ローカル再検証

前方向の複数・範囲移動は、入力前の凍結状態から完全な期待順序を独立に作り、保存・論理DOM・実フレームへ照合する。DOM応答は入力前に固定した必要カードすべてとチェックボックス・順序がそろうまで終了しない。修正はコミット `3e6cece7cc5cf114cbe02a9d028a6d158cdfd5c2` の12テスト・計測関連ファイルであり、製品 `src`／`public` は親6208722と同一である。終了条件の意味を補正したため計測器をv4とし、旧v3の正式値を現行受入へ付け替えない。

単体3,609件、計測契約512件、ローカル一般browser機能427件は通過済み。最初の現行ソースcompletion runはshopping16・range20・drag8とtransfer99ケースが通過し、transfer1ケースがfixture投入前の静的ローダーで失敗したため、run全体はfailedを維持する。572行の10回rawと統計が整合し、4行はnullの欠測、得られた527主指標は基準内である。起動だけの500回と移動操作を含む400回の診断では再現しなかったが、原因解消とは判定しない。

同じv4・completion10で変更前全144ケースを試行し、新しい現行ソースの正式runは全144ケース・576指標各10回が成立、主530指標すべてが時間基準内だった。機能427件通過・既存54件skip、自動PWAの1テスト・2操作も通過した。比較は変更前の真正frame未観測4件と旧機能失敗を保持してincompleteのままであり、正常500品目touch同列移動の増加も再現した。当時の評価では指摘4・P3／P5を未認定とした。その後の同列増加の受容と160ms方針は上記のユーザー指示として分けて記録する。最新結果と各指摘の処理は[レビュー修正記録](dnd-selection-rendering-review-remediation-20261027.md)に集約する。製品変更候補2案は通常測定で改善が確定せず不採用とし、製品src／publicは6208722と同一を維持した。今回はユーザー指定により自動・ローカルを対象とし、物理touch・人の体感と実GitHub CIは保留・未確認とする。以下の2026-10-26以前の結果・raw・当初合否は履歴として保持する。

## 2026-10-26：対象3群を150msへ変更した後の状態

最新ユーザー指定により、D&D計画に直接関連する `range`／`drag`／`transfer` の中央値・95%点をともに150.0ms以下へ変更した。shoppingは65.0ms／100ms、PR各2回／完了各10回、150／500品目のshopping16・range20・drag8・transfer100の全144ケース、530主指標・46保存補助、全操作・終了点・fixture・保存整合性・retry 0を維持する。1,500品目は通常の修正・必須受入対象外である。基準IDは `dnd-selection-rendering-150-150-2026-10-26`。旧50／55／65／110msの元値・当初合否・rawを保持し、150ms再判定は別記録に保存する。

今回の採取HEADは `6b95af67d75b5a4cc81c8535cd2d7b2e27987ce3` で、製品src／publicはbe259と同一である。Worker私有freezeのgeometry／ordinary分離、planShoppingMove内部だけのreadonly item clone省略、pickupの装飾を保つCSS限定drop opacity即時化、forced viewportの不要な親bbox取得の遅延を含む。一般API隔離、原子性・修復・optional field・確認・manualHallId、offset／anchor／initialBatch、既存のkey・focus・入力保持を維持する。150msの契約・文書変更と製品sourceの識別を分け、後日のsourceへ旧採取を付け替えない。

source6b95の品質記録はunit2,381／integration930通過・既存88skip／Worker254、計3,565通過、foundation1,370通過。型・lint・encoding・test membership・architecture・DB互換・全体format・Release A buildも通過済みである（[品質ログ](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/final-6b95af6-validation)）。ローカル品質と実GitHub CIを区別し、独立集計の根拠は下表に記録した。

Windows installed PWAのbe259 run `20261026T032753Z-d44cf835` は2操作ケース成功、[独立rawレビュー](D:/esp-dnd-audit-remediation-validation-20261025/completion10-20261026/pwa-passed-raw-independent-review/review.json)37確認・0失敗。自然pending、gate付き数量・メモ、同じe1 DOM・focus・caret、後発選択、保存順、全500品目と3順、reloadを確認した。gate付き機能診断を性能値へ混ぜず、physical touch・human feel・モニター走査の証明とはしない。

旧110msのbe259通常runは、最新基準へのユーザー変更によりfunctional段階で中断した。shopping／range／drag／transferは全not-runであり、原run-resultの初期status failedは製品失敗の判定ではない。[中断sidecar](D:/esp-dnd-audit-remediation-validation-20261025/completion10-20261026/final-normal-be259e8-20261026T033140806Z-126ee514/user-criteria-change-interruption.json)とrawを保持する。新150msの正式通常runnerは採取HEAD6b95で全5群完走・passed・exit0となった。全576行の独立raw整合性を確認し、比較のbefore4未観測と24機能失敗を保持した。全180増加を列挙して正常2経路・最大2件を区間評価し、因果未確定の箇所と残る増加を記録した。実GitHub CIは未実施であり、P5・計画全体の完了は未認定である。過去bfffの4性能失敗、d467の1性能失敗と旧PWA失敗も履歴として残す。

一般機能の原reportはexpected408・skipped54・flaky1・unexpected0。flaky1はlocalStorage getter試験のseed起動でretry0 timeout、retry1 passedであり、409件retry0通過とは扱わない。初回のfirst-install identity gateの失敗原因はtrace不足により未確定（[調査記録](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/functional-flaky-source-review/review.json)）。

同一caseの別診断isolationは5回ともretry0で通過し、失敗は再現しなかった（[結果](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/functional-flaky-source-review/isolation-getter-20261026T072057620Z-789e6e1e/isolation-summary.json)）。trace overheadを含むため性能受入に用いず、環境起因と断定せず、正式flaky1を置き換えない。

正式性能4群はshopping16・range20・drag8・transfer100の144ケース、全576行（530主＋46保存補助）、各10サンプルで成立し、530主指標は適用基準内。保存46行は補助として別扱いとする。

[最終比較](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/comparison-final-150-6b95af6.json)はincomplete。全576行を列挙し、572行は数値比較、4行はbeforeの真正frame未観測（各10attempt）で、通常の未測定missingは0。before24artifactの機能postcondition失敗も数値と別に保持する。[独立integrity review](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/final-comparison-reviews/comparison-review-20261026T071649241Z-b6dcb723/review.json)はissues0であり、比較のincompleteや旧機能失敗を成功へ変えない。strict＞0全増加と正常操作／正方向の理由・source採否の最終評価は [全増加CSV](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/final-comparison-reviews/comparison-review-20261026T071649241Z-b6dcb723/all-increases.csv)にstrict＞0の180行（主179／保存1、中央値141／95%点118／両方79）を列挙した。[最終報告](D:/esp-dnd-audit-remediation-validation-20261025/remediation-result-20261026.md)で正常2経路と最大2件を区間評価した。正常150touch応答中央値43.25→41.30msに対し500touch同列は74.00→76.25ms／95%点75.20→90.30msの増加が残る。最大中央値増加はrejectの+9.35msで主にDOM後rAF／task区間、最大95%点増加はshopping戻りUIの+17.40msである。CPU等の因果未確定部分を残し、増加ゼロや総合比較完了とは判定しない。現行sourceは絶対基準全通過と既存動作の回帰検証に基づき採用するが、完全受入とは区別する。

### 最新受入の根拠と確認限界

正式runは [2026-10-26T05-07-18-845Z-37e9fb2e-ac11-44c2-af2d-e0f08786f4da](D:/esp-dnd-audit-remediation-20261025/artifacts/dnd-selection-rendering/after/2026-10-26T05-07-18-845Z-37e9fb2e-ac11-44c2-af2d-e0f08786f4da/run-result.json)。採取HEAD6b95と後続のdocs-only HEADを分け、artifactのsource・判定・rawは書き換えない。

| 最終確認                                                  | 根拠と限界                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source／served bytes／計測器・fixtureの前後証明           | [採取前後証明](D:/esp-dnd-audit-remediation-validation-20261025/completion10-20261026/final-normal-150-6b95af6-20261026T050717962Z-b63403dc)でclean6b95、Release A capability、配信HTML／SW／全runtime JS・CSS、24計測器集約9610c6ea…／17fixture集約edf34cbb…を照合した                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 品質件数とrunner functional／4性能群の厳密集計            | [品質ログ](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/final-6b95af6-validation)と[独立集計](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/final-run-independent-summary/final-independent-review.json)へ各件数と機能flaky1を分けて保存した ／ functionalは408expected／54skip／flaky1／unexpected0、性能は144ケース全passed・retry0                                                                                                                                                                                                                                                                                                                                                                       |
| 144ケース・各10・530主＋46補助の独立raw検証               | [独立検証](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/final-run-independent-summary/result-distinction.json)で独立JSON検算で全576行のexact10／raw統計一致とframe／controlsのproof metadataを確認し、sourceに結び付いたcanonical比較器でfile-backedのPNG／trace内容・順序を照合した。群ごとの最大中央値／最大95%点はshopping34.700／52.300、range51.300／52.300、drag43.950／63.000、transfer88.575／110.026ms。各列は独立した最大値で、保存46行は補助として分離する                                                                                                                                                                                                                                                                |
| 全576行比較・明示policy bridge・strict＞0全増加の理由評価 | [全増加CSV](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/final-comparison-reviews/comparison-review-20261026T071649241Z-b6dcb723/all-increases.csv)にstrict＞0の180行（主179／保存1、中央値141／95%点118／両方79）を列挙した。[最終報告](D:/esp-dnd-audit-remediation-validation-20261025/remediation-result-20261026.md)で正常2経路と最大2件を区間評価した。正常150touch応答中央値43.25→41.30msに対し500touch同列は74.00→76.25ms／95%点75.20→90.30msの増加が残る。最大中央値増加はrejectの+9.35msで主にDOM後rAF／task区間、最大95%点増加はshopping戻りUIの+17.40msである。CPU等の因果未確定部分を残し、増加ゼロや総合比較完了とは判定しない。現行sourceは絶対基準全通過と既存動作の回帰検証に基づき採用するが、完全受入とは区別する |
| source採否・実CI未実施／PWA体感未確認・資料反映           | [引渡し記録](D:/esp-dnd-audit-remediation-validation-20261025/handoff-final-20261026.json)で最終docs-only HEAD、測定6b95とのruntime／計測器／fixture同一性、元workspaceの既存1444 untracked path保全、計画・資料の反映とencodingを記録する。実GitHub APIの読取認証確認は自動承認審査のblocked by policyで実行前に拒否され、実CIは未実施。人によるphysical touch／体感も未確認であり、これらと比較限界・flaky1を引き継ぐ                                                                                                                                                                                                                                                                                                                                        |

以下の回数・scope変更と旧実装記録は各時点の履歴である。回数2／10・1500除外は現行でも維持し、旧110msの時間基準は本節で150msへ上書きする。

## 2026-10-26の測定回数変更

最新のユーザー指定により、性能の測定回数だけをPR確認 `pr` の各2回、実装完了判定 `completion` の各10回へ変更する。既定は `completion`。`npm run test:browser:pr`／`npm run test:browser:completion` と通常runnerの `--profile`、各性能群へ渡す `ESP_PERFORMANCE_PROFILE`、CIのPR／非PR選択を揃える。

shopping16・range20・drag8・transfer100の全144ケース、530主指標と46保存補助指標、全操作、時間基準、fixture、ウォームアップ、計測終了点、保存・再読込・整合性検証、retry 0は維持する。`samplingPolicyId`／`samplingProfile` で回数と用途を記録し、PR2回の成功を実装完了の証拠へ流用しない。前後比較も同じprofileで採取する。

過去20回のraw・当初合否・元artifactと、回数変更時に停止した旧runは保持する。この方針変更や配線の更新自体は性能通過・計画完了を示さない。採用ソースの10回による全条件受入と前後比較は別の新規記録で確定する。下記の過去検証件数・旧サンプル数は各記録時点の履歴である。

## 2026-10-25の対象範囲変更

ユーザー指定により、1,500品目は通常利用の範疇ではないため修正対象外とした。必須受入はshopping16条件（150／500品目）・range20・drag8・transfer100、全144ケース・530主指標・46保存補助指標とする。通常6操作の65ms／100ms、対象3群の110ms／110ms、保存・整合性検証は維持し、測定回数は上記2026-10-26の用途別指定に従う。1,500品目の既存8性能条件とbounded DOM 1件は任意診断として保持し、修正必須・未完了の根拠にしない。

以下は2026-10-24時点の実装・検証記録であり、記載されたshopping24条件や旧HEADの結果は当時の対象範囲の履歴として保持する。今回の新対象範囲による性能採取・前後比較・通常runner・実CI・実端末PWAの最終結果は、別の新規記録で確定する。

以下は2026-10-24作成時の記録である。後続の結果は冒頭とレビュー修正記録を参照する。

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
