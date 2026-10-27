# D&D・選択・描画改善プランの性能基準（2026-10-24）

2026-10-28の最新ユーザー指定「関連動作の中央値・95%点を160ms」を適用する。対象は [D&D・選択・描画改善プラン](D:/esp-dnd-plan-20261021/docs/dnd-selection-rendering-remediation-plan-20261021.md) である。既存の一般基準に対する、このプラン限定の例外として扱う。

| 対象                                | 性能試験群                    |      中央値 |       95%点 |        測定回数 |
| ----------------------------------- | ----------------------------- | ----------: | ----------: | --------------: |
| D&D・範囲選択・描画・移動後の次操作 | `range` / `drag` / `transfer` | 160.0ms以下 | 160.0ms以下 | PR各2／完了各10 |
| 通常の買い物6操作など、上記以外     | `shopping` など               |  65.0ms以下 | 100.0ms以下 | PR各2／完了各10 |

プランの回帰確認に含まれる通常6操作は、一般基準を維持する。対象群の従来互換応答・期待UI応答・実フレーム・次操作応答は、それぞれ160msで判定する。保存完了時間は補助指標として別に記録する。

2026-10-26のユーザー指定で測定回数のみPR各2回／実装完了判定各10回へ変更する。入力、DOM反映、実フレーム、次操作の終了点、fixture、ウォームアップ、ジェスチャー、座標、再試行禁止、必要な原子性・整合性検証は維持する。

過去の50ms・55ms・65ms・110ms・150ms基準で採取した測定値と当初の合否は保持する。新基準による再判定は、元run・source・旧基準・新基準・対象範囲を併記した別記録に保存する。元artifactの閾値や合否を書き換えない。サンプル不足・欠測・機能不成立・整合性エラーは、閾値変更によって通過へ変えない。部分実行の通過から全条件の合格を推定しない。

今後の通常試験と検証器は、artifactが自己申告する閾値ではなく、試験群から選ぶ基準を使う。計測器・fixture・sourceの識別と過去データの比較条件も維持し、基準更新による識別差を無視して旧runとの厳密比較を成立させない。

## 2026-10-28：160msと受容した同列移動の差（現行）

対象3群の識別子は `dnd-selection-rendering-160-160-2026-10-28`、基準日は2026-10-28。shoppingの `shopping-operations-150-500-65-100-2026-10-25` と65／100ms、sampling policy `performance-samples-2026-10-26`、PR各2回・completion各10回、必須144ケース・530主＋46保存補助は変更しない。

ユーザーは正常500品目touch同列移動の75.65／77.50ms→77.60／82.40ms（中央値+1.95ms・95%点+4.90ms）を受容し、製品の追加修正を行わないと回答した。元の値・run・sourceは保持し、改善・解消の証拠へ読み替えない。その他の観測差を一律に受容したとは扱わない。

今回の全144ケースは、source3eのv4・旧150msの下で新規採取して全件通過した。その元記録を不変とし、新160msは別の読み取り専用再判定として元run／測定source／旧150基準／新160基準／新policy sourceを結び付ける。変更前4frame未観測・旧機能失敗、初回afterの欠測と失敗も維持する。詳細は[レビュー修正・自動検証記録](dnd-selection-rendering-review-remediation-20261027.md)。

新160msの読み取り専用再判定は、確定方針source `b9cea9f` に結び付けて1回完了した。実測source3eの変更後主530指標は全通過し、保存46指標は別扱い。元150msのrun・raw・当初合否、変更前の機能失敗・真正未観測、全277相対増加行を保持し、受容注記は指定の同列500touch responseだけとした。[別再判定の最終記録](D:/esp-fix-validation-20261027/criteria-160-actual-reassessment-20261027T174731976Z-1d69efc8/final-handoff.json)。

## 2026-10-25：通常の買い物操作の対象品目数

ユーザー指定により、1,500品目は通常利用の範疇ではないため修正対象外とする。通常の `shopping` 受入は150／500品目の16条件、各6操作の従来互換応答・期待UI応答をそれぞれ中央値65.0ms以下・95%点100ms以下で判定する。測定回数は2026-10-26の用途別指定に従う。計測終了点、fixture、ウォームアップ、地図・過去10,000品目の負荷、保存・整合性検証は維持する。

`shopping` の基準識別子は `shopping-operations-150-500-65-100-2026-10-25`、基準日は2026-10-25とする。2026-10-25時点では `range`／`drag`／`transfer` の対象集合と110ms／110msを維持した。その後、回数は2026-10-26の用途別指定、対象3群の時間基準は同日150ms、2026-10-28に160msへ更新した。新しい必須inventoryは全144ケース、530主指標行と46保存補助行（合計576行）であり、この件数自体を全件合格の根拠にしない。

既存の1,500品目の買い物8条件とbounded DOM 1件は `@shopping-large-list-diagnostic` の任意診断9件へ分離する。ビルド済み環境で `npm run test:shopping-large-list-diagnostic:run` を明示的に実行し、通常runner／CIの必須集合から除外する。任意診断には `diagnosticOnly: true`／`acceptanceMeasurement: false`、対象外決定と参考基準を記録し、150／500品目の不足条件や失敗を補う合格証拠へ使わない。一般機能の必須集合から外すのは1,500品目のbounded DOM 1件のみであり、150／500品目の一般機能は維持する。

過去のshopping24条件、152 artifact、626主指標／672全指標、1,500品目の測定値・不合格・元artifact・当初判定は履歴として保持する。新しい対象範囲でのbefore／after比較は同じ計測器・条件・基準metadataで別記録とし、対象変更によって過去の失敗を成功へ書き換えない。

## 2026-10-26：PR確認2回・実装完了判定10回

| 用途                         | profile      | 各操作・指標の測定回数 | 完了判定への利用             |
| ---------------------------- | ------------ | ---------------------: | ---------------------------- |
| PR確認                       | `pr`         |                    2回 | 不可                         |
| 実装完了判定・通常の完了受入 | `completion` |                   10回 | 全必須条件等の通過後に利用可 |

`ESP_PERFORMANCE_PROFILE=pr|completion` または通常runnerの `--profile pr|completion` で選ぶ。指定なしは `completion`。通常一括実行は `npm run test:browser:pr`／`npm run test:browser:completion`、ビルド済みなら `node scripts/run-shopping-browser-evidence.mjs --phase after --profile completion` とする。変更前も同じprofileで採取し、PR2回の `passed` を10回の実装完了証拠へ流用しない。

必須のshopping16・range20・drag8・transfer100条件、全操作、時間基準、保存・再読込・整合性検証、入力から各終了点までの測定、ウォームアップ、retry 0は不変である。CIはPR eventで `pr`、非PRで `completion` を指定し、群を個別実行するときも同じprofileを環境変数で渡す。異なるprofileを合算して件数を満たさない。

回数だけを変更した時点では時間基準のcriteria ID／基準日を維持した。後続の150ms改訂は下記の別criteria IDで識別する。回数の改訂は `samplingPolicyId: "performance-samples-2026-10-26"` と `samplingProfile: { id, sampleCount, policyDate, completionEligible }` で識別し、共通定義の `performanceSamplingProfile(profile)`／`performanceAcceptanceCriteriaForGroup(group, profile)` を使う。`acceptanceThresholds.minimumCount` は選んだprofileの2／10となる。sampling profileが異なる記録や、profileのない過去記録を現行の完了証拠として自動受理しない。

過去20回のraw・当初合否・元artifactと中断runはそのまま保持する。新しい回数の測定と前後比較は独立したrun IDで保存する。旧runを切り詰めたり、遅い値を除去・補充したりせず、欠測・失敗・部分実行を全条件通過へ変えない。

## 2026-10-26：対象3群を150msへ変更した当時の記録（履歴）

変更は `range`／`drag`／`transfer` の中央値と95%点の上限だけであり、どちらも150.0ms以下とする。基準識別子は `dnd-selection-rendering-150-150-2026-10-26`、基準日は2026-10-26とする。shoppingの識別子・基準日と65.0ms／100ms、PR各2回／completion各10回、sampling policyは維持する。

全144ケース・530主指標と46保存補助、全操作・終了点・fixture・地図と過去品目の負荷・ウォームアップ・ジェスチャー・retry 0・保存整合性を変更しない。基準更新自体は全条件通過の証拠ではない。150ms基準での新しい全条件受入、同条件の前後比較、未観測・機能不成立・全増加行の評価を別に行う。

旧110msのbe259通常runはユーザーの基準変更によりfunctional段階で途中中断した。shopping／range／drag／transferはすべてnot-runであり、run-resultの初期値failedを製品失敗や正式全条件判定に読み替えない。[中断sidecar](D:/esp-dnd-audit-remediation-validation-20261025/completion10-20261026/final-normal-be259e8-20261026T033140806Z-126ee514/user-criteria-change-interruption.json)と元rawは保持する。新150msの正式通常runnerは採取HEAD6b95af67d75b5a4cc81c8535cd2d7b2e27987ce3で[全5群完走・exit0](D:/esp-dnd-audit-remediation-20261025/artifacts/dnd-selection-rendering/after/2026-10-26T05-07-18-845Z-37e9fb2e-ac11-44c2-af2d-e0f08786f4da/run-result.json)となった。正式性能4群はshopping16・range20・drag8・transfer100の144ケース、全576行（530主＋46保存補助）、各10サンプルで成立し、530主指標は適用基準内。保存46行は補助として別扱いとする。 一般機能は408expected／54skip／flaky1／unexpected0で、初回timeout→retry1成功を保持する。同一caseの別診断isolationは5回ともretry0で通過し、失敗は再現しなかった（[結果](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/functional-flaky-source-review/isolation-getter-20261026T072057620Z-789e6e1e/isolation-summary.json)）。trace overheadを含むため性能受入に用いず、環境起因と断定せず、正式flaky1を置き換えない。

[最終比較](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/comparison-final-150-6b95af6.json)はincomplete。全576行を列挙し、572行は数値比較、4行はbeforeの真正frame未観測（各10attempt）で、通常の未測定missingは0。before24artifactの機能postcondition失敗も数値と別に保持する。[独立integrity review](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/final-comparison-reviews/comparison-review-20261026T071649241Z-b6dcb723/review.json)はissues0であり、比較のincompleteや旧機能失敗を成功へ変えない。strict＞0全増加と正常操作／正方向の理由・source採否の最終評価は [全増加CSV](D:/esp-dnd-audit-remediation-validation-20261025/criteria-150-20261026/final-comparison-reviews/comparison-review-20261026T071649241Z-b6dcb723/all-increases.csv)にstrict＞0の180行（主179／保存1、中央値141／95%点118／両方79）を列挙した。[最終報告](D:/esp-dnd-audit-remediation-validation-20261025/remediation-result-20261026.md)で正常2経路と最大2件を区間評価した。正常150touch応答中央値43.25→41.30msに対し500touch同列は74.00→76.25ms／95%点75.20→90.30msの増加が残る。最大中央値増加はrejectの+9.35msで主にDOM後rAF／task区間、最大95%点増加はshopping戻りUIの+17.40msである。CPU等の因果未確定部分を残し、増加ゼロや総合比較完了とは判定しない。現行sourceは絶対基準全通過と既存動作の回帰検証に基づき採用するが、完全受入とは区別する。 実GitHub CIとphysical touch／human feelは未確認であり、全計画完了へ繰り上げない。後続docs-only HEADと採取HEADを分け、rawのsource・閾値・当初合否は変更しない。

旧50／55／65／110msでの元値・当初合否を保持し、150ms再判定は別の記録に保存する。旧artifactの閾値・合否やsourceを直接書き換えず、旧criteria IDを現行と同一視しない。基準更新だけでサンプル不足、欠測、機能不成立、整合性エラー、profile／fixture／計測器不一致を通過へ変えない。

## 2026-10-24時点の110msによる既存測定の再判定（履歴）

[再判定資料](D:/esp-dnd-remediation-validation-20261024/scoped-110-reassessment-20261024/reassessment.md) は、既存実測を当時の110ms基準で評価した別記録であり、新しい性能測定ではない。4e9be8の全672指標行は、保存補助46行を除く626主指標中625通過・1未達となる。残るのは500品目・タッチ・グループON・実用負荷・実行→候補の実フレームで、中央値94.557861328125ms、95%点116.8662109375ms、n20である。

f068a71の部分7ケースは17主指標すべて新基準内だが、上記未達条件の実フレームは含まない。部分結果で全条件の合格を判定せず、追加候補の採用も別に判断する。旧runの終了状態・旧基準での合否・元データ・before欠測90行は保持している。

新しい比較結果の基準表は `acceptanceCriteriaByGroup`、各指標行の適用基準は `acceptanceThresholds` に記録する。旧外部report generatorの単一トップレベル `acceptanceThresholds` 前提を、新しい結果へ流用しない。新結果のレポートは群別基準に対応させ、厳密な計測器・fixtureのSHA照合を維持する。

## 110ms記録と150ms記録を比較した当時の方法（履歴）

以下は当時の150ms／v3比較器・bridgeを固定して使う履歴の方法である。現行160ms／v4へ読み替えない。当時の通常比較は150msのmetadataと計測器一致を要求し、旧110ms metadataを自動では受理しなかった。旧110msのbeforeを使う場合だけ、そのbeforeの製品コミットと一致するclean Git作業ツリーを明示する。

```text
node scripts/compare-shopping-browser-evidence.mjs --before-root <旧110msのrunRoot> --after-root <新150msのrunRoot> --before-policy-root <beforeのclean Git作業ツリー> --profile completion --output <新しい比較JSON>
```

`--before-policy-root` は比較時だけの指定であり、採取の入力・条件・終了点・rawを変えない。旧検証器の依存4ファイル、runner、24計測ソース、17fixtureソースをGit・SHA・完全な集合と照合してから旧beforeを元の110ms metadataのまま検証する。許す差分は、既知のD&D基準の110→150・ID・基準日・対応コメントの変更だけである。その他の計測器差、fixture差、profile差、途中run、未知policyは拒否し、afterには現行150msを必須とする。

新しい比較JSONの `beforePolicyReevaluation` に再判定の根拠を保存する。各行の `beforeOriginalCriteria`／`beforeOriginalAbsolute`／`beforeOriginalProducerTestStatus` に元の基準・数値判定・producer判定を保持し、150msでの数値判定とは分ける。元artifact・元run-result・元比較の判定は書き換えない。観測不能や機能postcondition失敗はそのまま残し、時間上限の変更で比較完了へ読み替えない。PR2回を完了10回へ昇格したり、旧20回を切り詰めたりする指定ではない。
