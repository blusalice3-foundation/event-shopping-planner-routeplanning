# D&D・選択・描画レビュー修正と自動検証（2026-10-28）

作業開始日：2026-10-27。2026-10-28の追加指示を反映し、今回指定された自動・ローカル検証の範囲を完了した。全144ケースの正式実測、160msの別再判定、受容された相対差、原計画から今回保留した確認を分けて記録する。

対象は[レビュー報告](D:/esp-dnd-full-review-20261027-59f3c741/review.md)と[指定計画書](D:/esp-dnd-plan-20261021/docs/dnd-selection-rendering-remediation-plan-20261021.md)。通常運用は単一画面PWAとし、別タブ同時編集だけの再現を未完了根拠に加えていない。物理touch・人の体感と実GitHub CIは、ユーザーが今回の範囲から明示的に保留した。

## 2026-10-28の追加ユーザー指示

ユーザーは「中央値+1.95ms・95%点+4.90msの増加を受け入れて修正対応しない」と回答し、関連動作の中央値・95%点を160msとすること、および関連文書への記載を指定した。正常500品目touch同列移動の差は受容として扱い、追加の製品修正を行わない。解消・改善したとは記録しない。

本プランに直接関連する `range`／`drag`／`transfer` を160／160ms、識別子 `dnd-selection-rendering-160-160-2026-10-28`・基準日2026-10-28へ統一する。shopping65／100ms、profile／回数、144ケース、fixture、各終了点・保存整合性・retry0は不変。実測は旧150msのsource3eのまま保持し、新160msの数値再判定を新policy sourceへ結び付けた別記録にする。その他の観測差の包括受容や全相対差の解消を意味しない。

## 修正とソースの対応

受入検証の修正は `3e6cece7cc5cf114cbe02a9d028a6d158cdfd5c2` の12ファイル。親はレビュー対象 `62087221941e10a55562842288a8cc1ab298b1c4`。製品 `src` treeは両者とも `2d0212f838557beefdffdb474737a7b2d6df46b1`、public treeは `90071a462092c45bc3ae11df5e696a053fc8a1ed` で同一である。

- 前方向の複数・範囲移動は、入力前のraw・実行ID・有効な移動ID・訪問・anchorから完全な期待順序を独立に作る。保存されたraw／実行順、論理DOM、移動カードのDOM順、実フレームに照合する。[順序oracle](../tests/browser/shopping-transfer-oracle.spec.ts)
- DOM応答は入力前に表示が必要な対象IDを固定し、全カードとcheckboxの存在・対象順が揃うまで終了しない。画面外統合先の既存シナリオだけは事前に理由を定義する。計測中は対象への限定selectorを使う。[応答計測器](../tests/browser/shopping-transfer-measurement.ts)、[反例試験](../tests/browser/shopping-transfer-response-endpoint.spec.ts)
- 計測器を `shopping-rendering-v4` とし、旧v3のraw・元artifact・当初合否を現行受入へ付け替えない。25計測ファイル・18fixture sourceの実byte対応を保持する。fixtureの値・件数・地図・過去品目の負荷や各終了点は維持した。

`7fd1c0c596e9eeafc186866afb655ebedf670df9` は、採取後に変更前の観測不能証拠を読むオフライン検証器と自己試験の修正である。実際に出力された13共有項目をsource hit・入力前状態・相関ID・必要カード・独立期待順序へ結び付ける。測定処理・元rawは変更しない。測定HEAD／instrument hashとconsumerのコミット／ファイルhashを別記録にする。[consumer修正記録](D:/esp-fix-validation-20261027/offline-validator-finalization-20261027T114633324Z/finalization.json)

最終ローカル検査で検出した統合fixtureの共有項目不足は、test helperだけ27行追加した `de5f5ddf71cec46ae1b7482c31864017def3311b` で補正した。製品・本番検証ロジック・判定regexを変えず、妥当なpositive controlから意図した単一フィールドの反例を検証する。旧7fdの全体失敗5件を保持し、de5では全1,524件、新160ms方針のC160では全1,526件の試験コマンドが通過した。外側のguard判定と別の入力不変性監査は後述する。

## 6指摘の状態

| 指摘                                           | 現在の処理                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1：前方向の完全順序の独立期待値がない          | v4 oracleを実装し、保存・DOM・frameと照合。反例試験・通常runnerで確認                                                           |
| 2：必要な移動カードが欠けてもDOM応答が終了する | 入力前の必要ID・全カード／checkbox／順序を終了条件に実装。反例試験で確認                                                        |
| 3：正式性能証拠が現行製品ソースと異なる        | 6208722と製品src／publicが同一の3eで、新規の全144ケース・completion10を完走                                                     |
| 4：正常操作の相対悪化                          | 同列500touchの+1.95／+4.90msはユーザーが受容・追加修正なしと指定。解消とはしない。全277増加行・その他の観測差・因果の限界は保持 |
| 5：現行PWA・物理touch・人の体感                | 自動PWAは今回の3eで通過。物理touch・人の体感はユーザー指定で今回保留・未確認                                                    |
| 6：実GitHub CIの証拠がない                     | ユーザー指定で今回保留・未実施。ローカル結果やworkflow配線を実CI成功へ転用しない                                                |

## 新しい正式completionと独立検算

測定runは `2026-10-27T14-31-16-898Z-f2ea7d79-7bff-4841-9503-db68546215e5`、製品sourceは3e、profileはcompletion各10回。性能1worker・retry0、通常のper-group webServerを使った。新規の1回のcanonical commandを完走し、全5群passed・exit0だった。

| 性能群   | ケース数／通過 | 最大中央値ms | 最大95%点ms | 実測時基準（中央値／95%点） |
| -------- | -------------- | -----------: | ----------: | --------------------------- |
| shopping | 16／16         |        43.90 |       53.40 | 65／100                     |
| range    | 20／20         |        54.95 |       75.20 | 150／150                    |
| drag     | 8／8           |        46.05 |       63.30 | 150／150                    |
| transfer | 100／100       |      93.7545 |     98.7622 | 150／150                    |

各最大値は独立した列の最大であり、同じ操作を表すとは限らない。全576指標がexact10で、rawから再計算した中央値・95%点が保存値と一致した。主530指標すべてが適用基準内。保存46指標は補助として別枠で、時間合否に混ぜていない。実フレーム48ケース・480サンプル・2,400証拠ファイルを検証した。1,500品目は任意診断のままで、今回の必須集合に加えていない。

一般機能は427件通過・既存54件skip、flaky／unexpected／再試行は0。a11yの2ケースもこの結果に含まれ、別に加算しない。

根拠：[新run](D:/esp-fix-build-20261027/artifacts/dnd-selection-rendering/after/2026-10-27T14-31-16-898Z-f2ea7d79-7bff-4841-9503-db68546215e5/run-result.json)、[外側の単一実行結果](D:/esp-fix-validation-20261027/after-confirmation-3e-20261027T143026939Z/exit.json)、[独立監査](D:/esp-fix-validation-20261027/final-confirmation-independent-20261027T161119437Z/independent-final-audit.json)。

新160ms方針の確定コミットは `b9cea9fd5dcf602e100745deb490a2f07b260187`（C160）、共通定義SHA256は `47f4f3c45cb24f5499202aed4fe051c282615e18cf52576d809dbe81b50ebce9`。この方針で元before／afterを読み取り専用で1回再判定し、変更後の主530指標は全通過、保存46指標は別扱いだった。旧150msでの実測source3e・元判定・17入力のhashは不変であり、C160で新たに性能測定した記録ではない。変更前は数値515通過・11未達・4真正未観測、元39試験失敗・24機能artifact失敗・40未観測試行を保持して全体不合格のまま。閾値変更で数値判定だけ変わった変更前の1frameも、producer失敗を維持した。全277増加行のうち受容注記は同列500touch responseのrow571だけである。[160ms別再判定・独立レビューの最終記録](D:/esp-fix-validation-20261027/criteria-160-actual-reassessment-20261027T174731976Z-1d69efc8/final-handoff.json)、[全576行](D:/esp-fix-validation-20261027/criteria-160-actual-reassessment-20261027T174731976Z-1d69efc8/all-576-reassessment-rows.csv)。

## 初回失敗と実行前確認の保持

初回run `2026-10-27T06-50-54-497Z-19b890c5-883b-4007-a742-03054075e180` は143／144通過・1件の起動準備失敗で、全体failedのまま保持する。auto-scroll500native・group ON・light・実行→候補のresponseで、fixture投入前に初期画面が終わらず、当該4指標は0件／nullだった。原レポート6ファイルのhashは新run前後で同一である。

今回の独立runではその4指標を各10件取得した。初回143件と今回の1件を混ぜず、今回の全144条件だけで今回の結果を判定する。起動の元原因は未確定で、修復したとは主張しない。startup-only500と同一workload400contextの診断で再現しなかった結果も、性能受入へ流用しない。[初回の独立集計](D:/esp-fix-validation-20261027/initial-failed-independent-final-20261027/group-summary.json)、[startup診断](D:/esp-fix-validation-20261027/startup-workload-replay/audit-20261027-400-contexts/audit.json)

新runの最初の呼出しは、外側のTCP接続式ポート確認だけが待ち切れず、claim／npm呼出し0で止まった。実行前失敗を保持し、その1関数だけをOS待受一覧へ修正した。実際の空き→所有listener使用中の拒否→finally停止後の空き、3確認と独立レビューを経て、同じcampaignを1回だけ実行した。製品コード・測定期限・サンプル数は変更していない。[限定修正の記録](D:/esp-fix-validation-20261027/confirmation-port-inventory-repair-20261027T142915920Z/port-guard-repair-result.json)

## 変更前比較と相対性能の記録

変更前は、元製品200cd756とsrc／publicが同一の採取HEAD `cadb70754c5b76e8ab9eef13c34a1250035f9f38` で、同じv4・25計測／18fixture・completion10・環境で全144条件を試行した。原結果は105通過・39失敗を保持する。数値572指標・真正frame未観測4指標があり、通常のmissingは0だった。

7fd consumerによる最終比較は576行を列挙し、572行が数値比較、4行が変更前の真正frame未観測。変更前24artifactの機能postcondition失敗も保持し、`incomplete`／exit1を成功へ変えない。afterのエラーは0、absoluteStatusはpassed。全増加277行のうち、変更前に機能が正常だった条件は269行、旧機能失敗の条件は8行。保存補助の増加1行も別に保持する。

| 正常500touch同列移動 | 変更前中央値／95%点ms | 今回中央値／95%点ms |
| -------------------- | --------------------: | ------------------: |
| response             |          75.65／77.50 |        77.60／82.40 |
| commit→DOM           |          10.90／11.40 |        14.45／16.70 |
| nextPending          |          32.70／37.40 |        22.35／23.40 |

同列responseの+1.95／+4.90msとcommit→DOMの+3.55／+5.30msは、先の通常ABBAと方向が一致する。nextPendingの改善を使って残る増加を消さない。同じFRAMEモード同士では中央値+6.00586ms・95%点−4.72803msで、responseと差し引かない。

今回の別条件では、range500・全表示・smartphone・長いselectRangeの95%点+27.10ms、shopping500・集中・地図ONのbackUI中央値+6.20〜6.25ms等も観測した。全増加をノイズとも製品回帰確定とも一括分類せず、全値・正常／旧機能失敗・段階差・保存補助を分けて残す。

根拠：[最終比較と判定](D:/esp-fix-validation-20261027/relative-analysis/final-confirmation-comparison-20261027T161016902Z-c087fea6/final-relative-regression-review.md)、[全277増加](D:/esp-fix-validation-20261027/relative-analysis/final-confirmation-comparison-20261027T161016902Z-c087fea6/all-positive-deltas.csv)、[全576行](D:/esp-fix-validation-20261027/relative-analysis/final-confirmation-comparison-20261027T161016902Z-c087fea6/all-576-comparison-rows.csv)。

## 因果確認と不採用候補

通常ABBAで同列の増加を保持し、別3条件のABBAでも区間と同一source controlを確認した。Main Profiler／Tracingの40context・200windowではpostcommitの主スレッド処理増加を観測した。ただしサンプルself-timeは推定、RunTaskは経過時間で、正確なOS CPU時間ではない。opaqueなprogram部分が残り、全遅延の単一関数原因を確定していない。[CPU／task評価](D:/esp-fix-validation-20261027/terminal-cpu-task-diagnostic/analysis-clean-20261027T1250/causal-assessment.json)

製品候補 `d2f9593` と `1718a74` は、無効navigatorの集計遅延化と入力guard付きID cacheを検討し、各12条件の通常crossoverと機能・単体検査を実施した。主反応の改善が一貫せず、一部shoppingの増加もあったため、両方とも不採用・未merge。これらの単体3,619／3,628件の通過を、採用製品の試験数へ付け替えない。候補のraw・判定と旧32-file build archiveは保持する。[d2f判定](D:/esp-fix-validation-20261027/navigator-normal-crossover-20261027/analysis-normal-crossover-20261027T1350/adoption-assessment.json)、[1718判定](D:/esp-fix-validation-20261027/navigator-normal-crossover-20261027/analysis-normal-crossover-1718-20261027T1420/adoption-assessment.json)

限定source追跡では、itemIndexとbuildListRowsのアルゴリズムは200cd→3eで同一だった。memo入力が無効化された場合の呼出し経路は、非空選択では両版とも制御用／表示用の2つ、空選択では旧版2つ・3eが1つで、新規の二重生成は確認できなかった。これはsource上の経路比較であり、1操作内の実呼出し回数やcommit回数を測定した主張ではない。同じ状態の選択再同期はreducerで旧stateを返し、store revisionを公開しない。新規二重生成やitem参照のcloneを原因とした修正は裏付けられなかった。安全な因果修正を確定せず、別のcache変更を採用しない。[限定source調査](D:/esp-fix-validation-20261027/same-column-row-selection-bounded-source-rca-20261027.json)、[呼出し経路の補足](D:/esp-fix-validation-20261027/same-column-row-selection-callgraph-addendum-20261027.json)

## インストール型PWAの自動機能確認

今回の3e buildで、変更していないv6を1回実行。1テスト・2操作・ソースで定義した37確認項目を含む処理が通過した。37行の別runtime ledgerが存在するとは主張しない。Chrome156.0.8078.48、standalone windowとactivated SW、専用profile `f25d8c6411b14d8a` を使用した。

自然な保存待ちと強制gateの保存待ちの両方で、次入力・focus／caret・数量／memo・順序・reloadを確認した。gate付きの機能診断を、性能や人の体感へ転用しない。同一sessionのuninstall／osIntegrationRemoved、context.close、所有Chromeの終了、所有previewのCtrl-C停止と4173未使用を確認。32dist／collector／依存・実行ファイルのbefore／after bytesは同一だった。

準備用の複合監督commandは自動承認審査で実行前に拒否されたが、所有tool sessionのpreview経路で実施できた。拒否時の実行・claim・PWAは0。PWA自体を再試行していない。[実PWAとcleanupの記録](D:/esp-fix-validation-20261027/pwa-supervision-20261027T162541092Z/final-handoff.json)

## ローカル検査と資料の状態

製品とTypeScript試験が同一の3eで、全Vitestは確認実行3,609通過・既存88skip。初回の既定並列実行のtimeout1件と、分離確認・2workerの全体確認を区別して保存した。計測契約等Node512件、oracle22件、応答反例6件の既存結果も保持する。

最初の7fd full foundationではprehook73件通過、main1,425通過・5失敗、API21通過。5失敗は1つの統合fixtureの共有v4項目不足で、厳密なsource bindingが意図した後段の反例判定より先に拒否していた。consumerを弱めず、de5のtest helperだけ27行追加し、対象232試験・lint／format／encodingが通過した。de5の別cohortではprehook73・main1,430・API21の計1,524件が通過した。元の失敗記録は保持する。

C160のクリーンな確定ソースでは `npm run build:release-a` を1回実行し、Release Aのcapability・source SHA・32生成ファイルを検証した。通常prehook73件、foundation1,432件、API21件の計1,526件が通過し、fail／skipは0、各コマンドは1回・終了0だった。全3,283 tracked source、生成物32ファイル、退避した旧de5生成物32ファイルの不変性も確認した。[C160ビルド・ローカル試験の記録](D:/esp-fix-validation-20261027/C160-source-quality-20261027T175011475Z/C160-source-quality-result.json)。

de5とC160の外側wrapperは、ともにChromiumの `debug.log` への215byte追記でbyte guardが終了1となった原記録を保持する。各cohortを別の厳密なオフライン検証へ渡し、固定パスの追記、元全長prefixのhash一致、その他すべてのsource／生成物／依存／実行ファイルとsnapshot項目・集合の一致を確認した。ログは実行時出力として区別し、入力の一般除外やguardの成功への書き換えは行わない。追記したprocessの帰属は未確定である。試験を再実行してログ差分を回避していない。[de5の別監査](D:/esp-fix-validation-20261027/offline-runtime-output-append-audit-20261027T170604218Z/offline-guard-interpretation-final.json)、C160の別監査は上記C160記録に結び付けた。

160ms変更の対象3ファイルのNode自己試験は293件通過。型・文字コード・performance policy・対象lint／formatも通過した。これらはdirty de5で検査した11ファイルの実byteがC160と完全一致することを別に確認しており、検査時HEADをC160へ付け替えていない。de5のmembership・architecture・DB互換等の静的検査も保存し、製品sourceが同一のため重複実行しない。最終の文書変更には、文書のformat・文字コード・リンク・差分の検査を追加する。[160ms対象検査](D:/esp-fix-validation-20261027/policy160-validation-20261027T173511245Z/targeted-validation-result.json)、[静的検査](D:/esp-fix-validation-20261027/final-static-checks-20261027T170327580Z-c780e84e/static-check-result.json)。

製品source3eと、オフラインconsumer／自己試験・160ms方針・資料の後続コミットを区別する。資料の最終コミットでも製品src／public・browser計測器は3eと同一、実行コードはC160と同一である。最終HEAD・文字コード・元workspaceの保持と反映は外部引渡し記録へ保存する。実CI、coverage全体、Linux専用disposable DBを実行したとは主張しない。

## 完了判定と残事項

計画書§11.4に基づく相談に対し、ユーザーは2026-10-28に同列移動の+1.95／+4.90msを受容し、追加修正なし・関連3群160msを指定した。今回の完了範囲は、この明示指示を反映したコード・文書・新基準の別記録と自動・ローカル確認であり、これらの検証は完了した。原計画の全相対差ゼロ、変更前の未観測解消、物理端末・人の体感・実CIを含む完全受入を主張しない。その他の観測差は元値と限界を残し、一律に受容・解消したとは扱わない。

PWAの物理touch・人の体感と実GitHub CIは、既にユーザーが今回保留と回答しているため再確認しない。保留を合格へ変えず、今回のローカル検査を未完了とする根拠にも追加しない。

元workspaceの既存1,444未追跡pathを削除・stash・上書きせず保持する。UTF-8 BOMなし・元の改行を維持し、保存後の再読込・日本語・U+FFFD／疑問符・差分を検査する。AGENTSは元のCRLF、他の対象文書は元のLFを維持する。製品 `src`／`public` にencodingの変更はない。最終反映時にもtracked statusと既存pathを確認する。
