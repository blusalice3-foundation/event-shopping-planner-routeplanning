# D&D・選択・描画改善プランの性能基準（2026-10-24）

2026-10-24のユーザー指定「本プランの関連動作に限って中央値・95%点を110ms」を適用する。対象は [D&D・選択・描画改善プラン](D:/esp-dnd-plan-20261021/docs/dnd-selection-rendering-remediation-plan-20261021.md) である。既存の一般基準に対する、このプラン限定の例外として扱う。

| 対象                                | 性能試験群                    |      中央値 |       95%点 |        測定回数 |
| ----------------------------------- | ----------------------------- | ----------: | ----------: | --------------: |
| D&D・範囲選択・描画・移動後の次操作 | `range` / `drag` / `transfer` | 110.0ms以下 | 110.0ms以下 | PR各2／完了各10 |
| 通常の買い物6操作など、上記以外     | `shopping` など               |  65.0ms以下 | 100.0ms以下 | PR各2／完了各10 |

プランの回帰確認に含まれる通常6操作は、一般基準を維持する。対象群の従来互換応答・期待UI応答・実フレーム・次操作応答は、それぞれ110msで判定する。保存完了時間は補助指標として別に記録する。

2026-10-26のユーザー指定で測定回数のみPR各2回／実装完了判定各10回へ変更する。入力、DOM反映、実フレーム、次操作の終了点、fixture、ウォームアップ、ジェスチャー、座標、再試行禁止、必要な原子性・整合性検証は維持する。

過去の50ms・55ms・65ms基準で採取した測定値と当初の合否は保持する。新基準による再判定は、元run・source・旧基準・新基準・対象範囲を併記した別記録に保存する。元artifactの閾値や合否を書き換えない。サンプル不足・欠測・機能不成立・整合性エラーは、閾値変更によって通過へ変えない。部分実行の通過から全条件の合格を推定しない。

今後の通常試験と検証器は、artifactが自己申告する閾値ではなく、試験群から選ぶ基準を使う。計測器・fixture・sourceの識別と過去データの比較条件も維持し、基準更新による識別差を無視して旧runとの厳密比較を成立させない。

## 2026-10-25：通常の買い物操作の対象品目数

ユーザー指定により、1,500品目は通常利用の範疇ではないため修正対象外とする。通常の `shopping` 受入は150／500品目の16条件、各6操作の従来互換応答・期待UI応答をそれぞれ中央値65.0ms以下・95%点100ms以下で判定する。測定回数は2026-10-26の用途別指定に従う。計測終了点、fixture、ウォームアップ、地図・過去10,000品目の負荷、保存・整合性検証は維持する。

`shopping` の基準識別子は `shopping-operations-150-500-65-100-2026-10-25`、基準日は2026-10-25とする。`range`／`drag`／`transfer` の対象集合、2026-10-24の識別子・基準日、110ms／110msは変更しない。測定回数だけを2026-10-26の用途別指定へ更新する。新しい必須inventoryは全144ケース、530主指標行と46保存補助行（合計576行）であり、この件数自体を全件合格の根拠にしない。

既存の1,500品目の買い物8条件とbounded DOM 1件は `@shopping-large-list-diagnostic` の任意診断9件へ分離する。ビルド済み環境で `npm run test:shopping-large-list-diagnostic:run` を明示的に実行し、通常runner／CIの必須集合から除外する。任意診断には `diagnosticOnly: true`／`acceptanceMeasurement: false`、対象外決定と参考基準を記録し、150／500品目の不足条件や失敗を補う合格証拠へ使わない。一般機能の必須集合から外すのは1,500品目のbounded DOM 1件のみであり、150／500品目の一般機能は維持する。

過去のshopping24条件、152 artifact、626主指標／672全指標、1,500品目の測定値・不合格・元artifact・当初判定は履歴として保持する。新しい対象範囲でのbefore／after比較は同じ計測器・条件・基準metadataで別記録とし、対象変更によって過去の失敗を成功へ書き換えない。

## 2026-10-26：PR確認2回・実装完了判定10回

| 用途                         | profile      | 各操作・指標の測定回数 | 完了判定への利用             |
| ---------------------------- | ------------ | ---------------------: | ---------------------------- |
| PR確認                       | `pr`         |                    2回 | 不可                         |
| 実装完了判定・通常の完了受入 | `completion` |                   10回 | 全必須条件等の通過後に利用可 |

`ESP_PERFORMANCE_PROFILE=pr|completion` または通常runnerの `--profile pr|completion` で選ぶ。指定なしは `completion`。通常一括実行は `npm run test:browser:pr`／`npm run test:browser:completion`、ビルド済みなら `node scripts/run-shopping-browser-evidence.mjs --phase after --profile completion` とする。変更前も同じprofileで採取し、PR2回の `passed` を10回の実装完了証拠へ流用しない。

必須のshopping16・range20・drag8・transfer100条件、全操作、時間基準、保存・再読込・整合性検証、入力から各終了点までの測定、ウォームアップ、retry 0は不変である。CIはPR eventで `pr`、非PRで `completion` を指定し、群を個別実行するときも同じprofileを環境変数で渡す。異なるprofileを合算して件数を満たさない。

時間基準のcriteria ID／基準日は維持する。回数の改訂は `samplingPolicyId: "performance-samples-2026-10-26"` と `samplingProfile: { id, sampleCount, policyDate, completionEligible }` で識別し、共通定義の `performanceSamplingProfile(profile)`／`performanceAcceptanceCriteriaForGroup(group, profile)` を使う。`acceptanceThresholds.minimumCount` は選んだprofileの2／10となる。sampling profileが異なる記録や、profileのない過去記録を現行の完了証拠として自動受理しない。

過去20回のraw・当初合否・元artifactと中断runはそのまま保持する。新しい回数の測定と前後比較は独立したrun IDで保存する。旧runを切り詰めたり、遅い値を除去・補充したりせず、欠測・失敗・部分実行を全条件通過へ変えない。

## 既存測定の再判定

[再判定資料](D:/esp-dnd-remediation-validation-20261024/scoped-110-reassessment-20261024/reassessment.md) は、既存実測を新基準で評価した別記録であり、新しい性能測定ではない。4e9be8の全672指標行は、保存補助46行を除く626主指標中625通過・1未達となる。残るのは500品目・タッチ・グループON・実用負荷・実行→候補の実フレームで、中央値94.557861328125ms、95%点116.8662109375ms、n20である。

f068a71の部分7ケースは17主指標すべて新基準内だが、上記未達条件の実フレームは含まない。部分結果で全条件の合格を判定せず、追加候補の採用も別に判断する。旧runの終了状態・旧基準での合否・元データ・before欠測90行は保持している。

新しい比較結果の基準表は `acceptanceCriteriaByGroup`、各指標行の適用基準は `acceptanceThresholds` に記録する。旧外部report generatorの単一トップレベル `acceptanceThresholds` 前提を、新しい結果へ流用しない。新結果のレポートは群別基準に対応させ、厳密な計測器・fixtureのSHA照合を維持する。
