# Full Split Map Cell Implementation Plan

- 文書状態: 2026-08-25総合レビューの実装開始blockerを反映済み。観測HEAD `fa743f7cad2d61e5a8f3e723dfc751fba225ced2`ではpre-I0の`npm run quality`と外部前提subgateが未通過のためFSMC-I0実装はNo-Goであり、計画修正、pre-I0 hygiene、外部前提のread-only確認だけがGo。両subgateが同一HEADで成功した後に限ってFSMC-I0へ着手可、FSMC-I1以降は直前phase Exit通過後に限って着手可
- 対象機能: 地図番号セルのa/b完全分割
- 対象ソース基準: `2eaba922816e8b263c6479e81ab9f265321654b2`（短縮: `2eaba92`、実装code基準。後続のplan-only commitはpre-I0 inventoryで追跡）
- 固定旧版Aのソース基準: `3db4be011d0f4123aa3953b559280c58f33d026a`（互換試験専用。現行実装の基準に使用しない）
- 作成日: 2026-08-12、最終判断反映日: 2026-08-25
- 想定規模: 大規模、初版37～47個の論理PRに加えてpre-I0準備2 commitと後続版。I0は9個の固定WBS bundleに分け、詳細は9章をauthorityとする

## 1. 目的

地図上の1つの番号セルを、a側とb側の独立した地図領域として扱えるようにする。

例として、Aブロックの26番を「左がa・右がb」に設定した場合、次を実現する。

- 26aと26bを別々に着色する
- 26aと26bへ別々のアイテムを関連付ける
- 片側を選択したとき、その側のアイテムだけを表示する
- 購入・巡回状態の変更を反対側へ波及させない
- 経路と番号マーカーを各側の中央へ接続する
- 通常マップと集中モードの両方で同じ位置解決を使用する
- 地図再取込とイベント単位Backup V2でも設定を維持する
- 問題発生時はBackup V2で新版へ復旧でき、losslessなV1互換coreを同伴できるsnapshotでは旧版アプリへ戻して従来の未分割セルとして開けるようにする。同伴不能時はV2-onlyであることを出力前後に明示する

初版は、原子的保存、通常マップ、集中モード、経路、常に生成可能であることを要求するイベント単位Backup V2、lossless representabilityを満たす場合に同時出力する旧版用V1互換core backup、旧版fallbackを主機能とする。これらを安全に成立させるための同一地図内copy、event／map／hall lifecycle、地図再取込・通常編集、dormant／quarantined管理UI、共有訪問projection、ローカル有効化・復旧導線も初版の必須support scopeに含める。完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図への設定コピー、意図的な同一売場再訪は後続版とし、初版のExitやDefinition of Doneへ含めない。

### 1.1 レビュー結論と確定判断

2026-08-12の総合レビュー、2026-08-22までのQ1～Q18回答、2026-08-23の二度の実装開始可否レビューで検出・確定した、基準source、識別子衝突、保存原子性、旧形式復元、経路表現、ローカル停止、性能測定、試験範囲、現行code接続面の不整合を本版で是正する。製品判断は次のとおり確定し、未回答の製品事項は残さない。FSMC-I0は契約、fixture、固定旧版A、試験projectを用意する最初の実装フェーズだが、phase外のpre-I0品質・外部前提gateが成功したHEADを固定するまでは着手しない。機能本体を実装済みと仮定するExitは置かず、機械判定可能なFSMC-I0 Exitが未達の場合はFSMC-I1以降へ進まない。

| 判断ID  | 確定内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PD-01` | 分割設定を含まない旧形式の完全復元では、対象範囲の既存分割設定を削除せず`dormant`へ移し、事前previewで件数・理由・復旧方法を表示する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `PD-02` | `01a`、`1a`、`０１ａ`は端末内preflightで統合衝突が0件の場合だけ同じ売場へ正規化する。衝突があるeventは分割機能をONにせずlegacy identityを維持し、利用者へ対象と解決方法を表示する。表示用原文は常に維持する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `PD-03` | 配布制御は外部serviceを使わず、端末全体のローカルOFF、イベント別のローカルON／OFF、DB・schema異常時の自動安全モードだけで構成する。既存イベントは初期OFFとする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PD-04` | 機能OFF／安全モードではsplit固有の表示、位置解決、保存、経路、操作を従来の未分割セル動作へ戻し、保存済み分割設定を通常操作で変更しない。`PD-14.C2`はI7以降、`PD-14.C3`はI10以降のnon-promotable QA artifactだけで先行してON／OFF共通不変条件として検証し、I10以前のproduction artifactでは基準source挙動とpublic edge 0件を維持する。I11のproduction `Vcap` migrationとdurable visit初期化が`ready`になったrelease-ready artifactで初めてC2／C3をON／OFFにかかわらず常時適用する。重複物理`(row, col)`を新規作成するimport・通常編集after-imageの原子的拒否、および既存重複を配列順で選ばず当該mapの経路生成・cache再利用を停止する`map-data-untrusted`安全判定は各該当commandの導入時から常時適用し、固定旧版Aとのphase-awareな許容差分とする。復旧用backupへのread-only収録、authority正常時の内部legacy rebase、`PD-09`の期限到達cleanupは非表示のsidecar保守として許可する |
| `PD-05` | スマートフォンでは表示サイズにかかわらず必ずpickerを経由する。pickerはa/b順ではなく画面上の空間順に並べ、「左側 b」「右側 a」等、位置と文字を併記する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PD-06` | ブロックコピーは解除しない「追加・変更のみ」を既定とし、「完全同期（解除を含む）」を別の明示操作として提供する。どちらも変更previewを必須とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PD-07` | 完了判定はunit、integration、browser、a11y、性能の自動テストで行い、外部証跡、実イベントpilot、managed device receiptは作らない。特定機種の正式保証は表記せず、自動テスト対象と対象外を明記する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PD-08` | 初版の主機能は原子的保存、通常・集中表示、経路、常に生成可能なイベント単位Backup V2、losslessな場合だけのV1互換core同時出力、条件付き旧版fallbackとし、安全上不可分な同一地図内copy、lifecycle、再取込・通常編集、retained管理、共有訪問projection、ローカル制御・復旧導線も必須support scopeへ含める。完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図コピー、意図的再訪は後続版へ送る                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PD-09` | イベント削除時は「30日保持」を既定、「今すぐ完全削除」を明示選択とする。保持中は端末内で再関連付けでき、30日後に端末時計が正常な場合だけ対象設定を自動削除する。設定単独ファイル出力は後続版とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PD-10` | 実機receiptや3実イベントpilotを完了条件にせず、fixtureを使うretryなしの自動テストをrelease gateとする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PD-11` | 分割セルに`whole`または非対応番号がある場合はa/bへ推測割当てせず、「側未設定」badge、一覧、分割有効化前previewで存在を知らせる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PD-12` | 健全なV2 snapshotはcompanion V1のlossless representabilityにかかわらずBackup V2を必ず生成可能にする。V1互換coreをlosslessに生成できる場合は同じsnapshotから同時出力し、構造上losslessでない場合は理由・旧版fallback不可・V2保管必須を確認させた`structural-v2-only-prepared`、V1／pairのresource上限だけを超える場合は同じ確認を持つ`resource-v2-only-prepared`として出力する。V1のためにV2まで禁止したり、値をdrop／正規化してV1を捏造したりしない                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PD-13` | 経路connectorは自セルまたは結合セル領域内で安全に接続できる場合だけ描画し、領域外や障害物横断が必要なら`unroutable`とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `PD-14` | 同じ`ExecutionVisitIdentity`の商品追加は既存訪問へglobal統合し、raw訪問位置を動かさず、必要な`PhaseVisitIdentity`投影だけを追加して全画面へ同じ結果を反映・通知する。利用者が同じ売場を意図的に複数回訪れる機能は初版対象外とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PD-15` | 1イベントにつき主に編集する端末は1台とし、端末間自動同期・自動mergeを行わない。Backupはpreview後の原子的置換であり、端末全体OFF・イベント別ON／OFFを収録せず、新規復元はOFF、既存イベントへの復元は復元先のローカル状態を維持する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PD-16` | 分割ON中の編集、取込、復元、地図変更が`01a`／`1a`等の正規化衝突を新たに作る場合、その操作全体をstore書込み前に原子的に拒否する。既存data、分割設定、ローカルONは維持し、自動OFFや部分取込を行わず、衝突した原文と修正方法を表示する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PD-17` | 3.13および10.5の性能数値は製品要件としてI0で固定する。I0ではprofile、測定法、config、未実装scenarioの適用開始phaseを検証し、実測合格は各機能の実装phaseとI11で要求する。上限緩和は製品判断IDの追加と通常reviewを必須とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PD-18` | browser／OS／profileによる保存領域の完全消去はアプリが新規installと区別できないためデータ保持保証の対象外とする。部分破損、payload／metadata／checkpoint不整合、store欠落、quota、abortは検出して誤接続・部分commitを防ぎ、安全モードとBackup復旧案内を提供する。完全消去はclean-startと事前Backup案内を試験する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

FSMC-I0で次を契約・fixture・実行可能な自動検証として固定し、いずれかが未達の場合はFSMC-I1へ進まない。後続phaseで実装する振る舞いはgolden input／expected resultとphase manifestへ登録し、I0で未実装featureを成功扱いにするstub、空test、`--passWithNoTests`は置かない。

- DBなし、現行core DB version、`Vcap - 1`、`Vcap`、`supportedMaximumVersion`、`supportedMaximumVersion + 1`を重複排除した境界集合、`Vcap`更新commit直前／直後の終了、運用後に全recordだけを失った空storeのfixture、capability decision table、preflight harnessを用意し、I2で実装する各分岐の期待結果を固定する。現行値5／候補6／supported上限7／拒否境界8はprovenance fixtureの具体例として残すが、期待分岐をliteralへ結び付けない。I0自身はproduction DB versionやruntime保存経路を変更しない
- full observed root、checkpoint、candidateの物理locationをIDB transaction内／localStorage externalへ分けたroot別観測vector、全governed rootのbaselineを保持するexternal durable fenceを持つ`(storeName, key)`単位のCAS契約、`onupgradeneeded`内の初期root原子作成、partial-loss snapshot、ローカル発行ID、anchor token、active／dormant／quarantined、30日保持と時計異常、control root、`durable-visit-state` root、衝突時全拒否を固定する。さらに、現行localStorageの`blockDetectionSettings`をcanonical IDB `eventSettings` rootへ移す旧版互換bridge journal、全削除対象のcoverage closure、unknown store／keyのlossless退避不能時stopをexact schema・ADR・golden fixtureへ含める
- 15,000セル、最大8,192論理ブロック、15,000分割設定、30,000半領域、400アイテム、400売場、400 `ExecutionVisitIdentity`、最大800 `PhaseVisitIdentity`（単一phaseの経路は最大400）の最大fixtureについて、寸法、block／merge／障害物／visit分布と生成payload hashを固定する。製品上限、測定法、単一値の`enforcedFromPhase`、scenario/profile shard、各shard直前calibration、結果reducerをversion付きconfigへ固定し、I0ではconfig検証とsynthetic sampleによる統計・shard集合計算だけを実行する
- 固定旧版A→候補新版B→固定旧版A→候補新版B、旧形式完全復元、Backup V2＋V1互換core、通常地図編集、地図再取込、複数tab競合、ローカルOFF切替について、fixture・期待値・失敗注入stageを登録する。実装前scenarioは担当phaseのExitで初めて必須実行に昇格する
- Desktop／Mobile Chromiumの必須2 project、両projectへ属するretry 0の安全性／a11y suite tag、WebKit advisory project、同一candidateにhash拘束したWebKit safety observation、traceability verifier、I0専用verification commandを作成し、project／suite membership、observation欠落・未分類と「該当test 0件」を機械的に失敗させる

基準source `2eaba92`には`PD-14`の共有訪問projectionが一部実装済みである。責務を`PD-14.C0`（I0: inventory／fixture）、`PD-14.C1`（I1: pure identity／projection／adapter契約）、`PD-14.C2`（I7: global projection、member移動、挿入、全画面通知）、`PD-14.C3`（I10: route、hit-test、cache、route insertion anchor）へ分ける。I2～I6はport／after-image hookと基準source挙動のnon-regressionだけを提供し、C2／C3の完成や固定旧版Aとの差分許可を前phase Exitへ要求しない。C2はI7 Exit後、C3はI10 Exit後のQA artifactで常時適用してconformanceを完了するが、productionへの切替はI11 release-readyの`Vcap` migration、durable visit全scope初期化、public registrationと同じ公開境界で行う。固定旧版Aは完全SHA `3db4be011d0f4123aa3953b559280c58f33d026a`のsource、lockfile、Node/npm version、build command、起動command、生成artifactのSHA-256を`tests/fixtures/fsmc/legacy-a/manifest.json`へ記録し、artifactをCIで再生成せず固定入力として検証する。候補新版Bは各CI runの対象commitから一度だけbuildする。

I0でFSMC専用の一方向導入証跡`FSMC_CAPABILITY_DB_VERSION`（以下`Vcap`）をsource、decision table、`config/fsmc-capability-adoption.json`へ固定し、そのversionを他用途へ再利用しない。候補versionの採択入力は固定旧版Aとcurrent sourceだけでなく、全remote-tracking history、tag、配布済みversion／artifact、release manifest、同一DB名のversion別object-store inventoryを含む。少なくともlocal historyの`81795770cca30c68bb1526f989dcd7ab0af1edb4`が持つDB6／`memberRouteItems`を「未配布」または「移行対象」と権威あるrelease provenanceで分類できなければ`Vcap = 6`を採択しない。decisionは`adopt-vcap`または`alternative-witness-required`の判別可能unionとし、後者ではI0 ExitとI2開始を閉じる。I2は採択済みversionのmigration／repositoryをintegration harnessとnon-promotable QA database namespaceで実装・検証するが、I2～I10のproduction artifactは現行`DB_VERSION=5`を維持し、capability storeをopen／createしない。I11の`release-ready` production candidateだけが、I2の全migration testを同じproduction artifactで再実行してから採択済み`Vcap`を有効化する。legacy external coreはFSMC open前に現行core versionへlossless materializeし、FSMCの`dbVersion === null`は外部coreも空のtrue fresh profileだけを表す。`dbVersion === null || dbVersion < Vcap`でnew storeもsplit対象rootのmetadata／checkpoint／candidate／fence traceもなく、event名基準day preflightがcollision-free、proposalからのscope導出がresolvedの場合は未導入分類とするが、`core-only` terminalを返せるのは`databaseTargetMode = "core-current"`だけである。`fsmc-vcap-qa | fsmc-vcap-production`は同じresolved inputを0→`Vcap`またはpre-`Vcap` upgradeへ進め、通常core traceはこの判定を変えない。raw day collisionはmaterialize後のpresent pre-`Vcap` profileだけをsnapshot外`capability-adoption-blocked`へ止める。`dbVersion >= Vcap`はversion自体が導入済みのdurable witnessなので、capability storeまたは必須rootが欠ければsplit痕跡の有無にかかわらず部分欠損の自動安全モードと復旧runbook案内にする。安全な候補versionを証明できない場合は、衝突しない一方向導入証跡、新DB方式、個別退避・再構築を別ADRで決め、同じ欠損判定を全fixtureへ反映するまでproduction DBを変更しない。

本書の`true fresh`は、main DBがabsent、`LEGACY_MIGRATION_TARGETS`の10 core external sourceが全absent、固定`localStorage["syncQueue"]`もabsentの3条件を同一pre-open inventoryで満たすprofileだけを指す。以下の短縮表現「legacy external coreも空／ないtrue fresh」は必ずこの定義を参照し、syncQueue-only profileを含めない。syncQueue-onlyはarchive-only current-version commit後のpresent pre-`Vcap` profileである。

### 1.2 実装開始可否レビューの是正決定

次の`RC-*`は2026-08-23および2026-08-25レビューで追加したnormativeな是正決定である。既存節へ同じ内容を反映し、各normative IDをrequirement catalogのexact 1 rowとexact 1 owner phaseへ対応させる。fixture、test、command、implementation symbol、document、DoDは重複なしのone-to-many関係とし、enforced requirementでは各必須classを1件以上持たせる。test IDから実行する`requiredCommand`だけをexact 1とする。本文と`RC-*`が矛盾する場合に一方を優先して実装するのではなく、I0のcross-verifierが矛盾として失敗し、同じPRで本文、schema、manifestを整合させる。

| 決定ID  | 確定内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RC-01` | 最初のI0変更前にclean worktreeで`git diff --check`と、`package.json`が定義する既存`npm run quality`の完全な順序付きcommand graphを省略なしでgreenにした専用pre-I0 commitを作り、そのcommitを`i0StartHeadSha`へ一度だけ固定する。手書きsubset、既知失敗、coverage省略を許さない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RC-02` | `PD-14.C0` inventoryはI0、C1 pure契約はI1、C2 projection／挿入／通知はI7、C3 route／hit-test／cacheはI10が所有する。I2～I6はport／hookと基準挙動のnon-regressionだけを所有し、後続ownerのconformanceを前phase Exitへ要求しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RC-03` | 初版support scopeに同一地図内copy、lifecycle、再取込・通常編集、retained管理、共有訪問projection、ローカル制御・復旧導線を含め、主機能だけを列挙した短いscope文から必須作業を除外しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `RC-04` | I2～I10のproduction artifactは現行DB5のままとし、採択済み`Vcap`へのmigrationはQA namespace／integration harnessだけで検証する。production `DB_VERSION`を採択済み`Vcap`へ進めるのはI11 release-ready candidateだけとする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `RC-05` | 現行`NavigatorItem`へevent／map／hall責務を混入させず、runtime snapshotから解決済み`ProjectedPhaseVisit`を作るadapterを正式境界にする。`ResolvedMapLocation`、`MapLocationIndex`、projection revision vectorとassociation／hall／split input DTOはI1前にexact readonly型、revision、cardinality、canonical順、mapless／ambiguous表現まで固定する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `RC-06` | 新しい3×3経路型は`SubcellPathNode`とし、既存`PathNode`と同名にしない。現行`MapVisitListPanel`にはfilter／focus復帰責務がないため、I8で同componentをshellへ拡張し、新しい`ProjectedVisitList`をpure DOM viewとする。callbackは最新projectionを`PhaseVisitIdentityKey`で再解決する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `RC-07` | Backup V2 wire DTOをruntime `AppData`／persistence型から独立させる。V1とXLSX 2.2 full restoreをI4の初版compat ownerへ割り当て、URLは共通safe-link policyを通す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RC-08` | `recovery-required`は行き止まりにせず、trusted core read-only export、診断、in-place reset可能条件、profile reset＋検証済みbackup再取込の明示runbookを提供する。untrusted split rootを自動採用・自動修復しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RC-09` | Backupの性能保証、import hard limit、export generation limitを方向別に固定し、UI main threadで全file `arrayBuffer`を作らない。同一origin module Worker、bounded slice、CSP／PWA asset、cancel cleanupを初版要件にする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `RC-10` | 性能runnerはGitHub Actions `ubuntu-24.04`上のrepo-owned OCI image digest固定jobとし、provider、owner、image、cgroupをI0で実在値へ固定する。製品測定は機能jobと分離したscenario/profile shardごとに同じcontainer／browserで直前calibrationし、hash付き全shardをreducerで完全照合する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `RC-11` | 固定旧版A artifactの保管・取得・hash・license・serve方法と、既存test membership／coverage／architecture／quality workflowの更新をI0成果物にする。`ApplicationSnapshotCommitPort`と全caller、Backup Worker entry／server／client、`useCanvasViewport.ts`とCanvas callerもchange-surfaceへ列挙し、transitive dependencyを直接importしない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `RC-12` | readinessを「code存在・public到達・dispatch認可・commit可能」に分け、future profileを初版gateから分離する。DOM代替は検索・絞込み・virtualization・focus復元、通知は固定`role=status`、Canvasはtoken contrast／forced-colors試験を持つ。画面読み上げ要件はversion付きAT代替oracleでrole、name、description、state、順序、focus、live-region発火を自動検証する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RC-13` | V2の`eventSettings` authorityはcapability store内のgoverned IDB rootとし、現行localStorage `blockDetectionSettings`は固定旧版A互換projectionへ降格する。移行・旧版書込み取込・mirrorはdurable bridge journalとbefore／after witnessで再開可能にし、補償rollbackをcommit authorityにしない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `RC-14` | `Vcap`はsource履歴だけでなく全配布artifact／release provenance／store manifestをdecision inputにする。guided resetは実profileの全object storeと全削除local keyをcoverage closureで照合し、未知対象をlosslessに退避・復元できない場合は必ず`unsupported-stop`とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `RC-15` | durable visit stateはgoverned IDB key `durable-visit-state`の`DurableVisitStateRootV1`を唯一のauthorityとし、現在phase＋anchor、phase別保存anchor、完了状態、購入変更anchorを表現する。item IDだけからphase visitを推測せず、base visit順はdenseな`executionVisitOrder`、全phaseはnormal→postponed→late、各phase内はbase順へ固定する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `RC-16` | active `(eventInstanceId, mapInstanceId, blockInstanceId, number)`をexact uniqueとし、runtime／全writer／startup／V2で同じinvariantを使う。identity token、tuple、`ReadonlyMap`、checkpoint digestはversion付きbyte canonical contractとgolden fixtureを持つ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RC-17` | 現行のimport競合`create-alias`をイベント全体複製とみなさない。初版のイベント全体複製はI3の新command／UIとして全core、eventSettings、map／block／item／visit／split IDをgroup-preserving remapする。通常セル編集と`MapVisitListPanel` shell拡張も既存機能ではなくI6／I8の新規scopeとして見積もる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `RC-18` | retained再関連付けは候補exact 1件、target未占有、trusted authority、commit直前も同じ候補集合の場合だけ許可し、2件以上からの利用者選択によるactive化は初版に設けない。rekey／挿入、同anchor遷移、connector mask、hit-test、表示競合もpureな決定表へ固定し、自owner番号領域だけをconnector maskで許可する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `RC-19` | performance required gateはplan→scenario/profile matrix→shard→reducer→required-results finalizerのDAGとする。各shardの静的上限を300分、job timeoutを330分以下とし、別run／別attempt／別shardのsample混在、欠落、重複を拒否する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RC-20` | normative requirementのID集合を`PD-*`、`RC-*`、`DOD-FSMC-*`、`EXIT-FSMC-*`へ限定して全件に安定IDを与え、その他の規則・実装bulletはexact 1件以上のIDへsupporting sourceとして結ぶ。catalog hashをtraceability、test manifest、required-resultsで一致させ、未追跡bulletと初版要件のfuture誤分類をI0 verifierで拒否する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `RC-21` | 最大fixtureは件数だけでなく、100×150 grid、block／merge／obstacle／visit配置、生成recipe、payload／topology／期待root hashをversion付きmanifestへ固定し、OFF referenceとON targetでdata topologyを一致させる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RC-22` | 外部前提を`requiredAt`で分離する。pre-I0はrepository／environment admin、package作成・public化権限、Actions／GHCR利用可否、branch gate接続可能性、fork PR token方針だけを確認し、未作成のDockerfile／publisher／package／digestを要求しない。I0 Exitでそれらの実在、最小permission、OCI source labelによるrepository link、exact digest匿名pull、runner qualificationを、release-readyでdriftなしを再確認する                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `RC-23` | `split-picker-popup`を通常マップI8／集中モードI9とDesktop direct-hit／Mobile pickerの4 scenarioへ分割し、各entryに単一profileと単一値の`enforcedFromPhase`を持たせる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `RC-24` | 重複物理`(row, col)`だけをmap-wide fatalな`map-data-untrusted`とする。重複番号、複数block owner、番号領域重複、merge越境は`ready-with-exclusions`として正規化済み影響領域だけを除外し、無関係なlocation、描画、訪問、経路を継続する。fatalと局所除外を同じresult branchへ潰さない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `RC-25` | map上の一意な物理geometry slotと、whole／a／b／unsupported suffixごとの論理locationを分離する。`26c`／`26d`／`26ab`はitem snapshot由来のcanonical suffix request集合からpure APIで別々の`LocationKey`へ導出し、同じwhole-cell中心へ接続する。lookupの最大2 location前提を廃止し、suffix、item association revision、logical location集合をindex revisionへ拘束する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `RC-26` | 新route inputへ選択hall identity、map identity、canonical polygon、polygon fingerprintを持つdata-only `RoutePathConstraintV1`を追加し、main path、simplification後segment、routing port、全connector、same-cell directを同じinclusive polygon内へ閉じる。constraint fingerprintをcache signatureへ含め、whole-map／別hall／stale polygon間でcacheを再利用しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `RC-27` | I7で`executionVisitOrder`を唯一のbase順authorityとする共通reorder planner／atomic commandへ、`useMapRouteCommands`のhall順reorderと`useMapVisitListCommands`の手動reorderを移す。raw item ID配列を並べ替えず、hall route settingsとdurable orderを同じ`ExpectedRootVector`・transactionで確定し、UIのdraft／cancelは永続rootを変更しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `RC-28` | Backup V2は主端末移行と完全復旧の必須artifactであり、healthy V2 snapshotのcompanion V1不能をV2生成blockerにしない。lossless V1がある場合はpair、ない場合は理由digestと旧版fallback不可表示を持つV2-only handoffとし、両分岐でV2 bytes、source SHA、snapshot revision、handoff receiptを再検証する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `RC-29` | `forcedPickerOverride`は端末全体・全event・通常／集中共通のboolean設定とし、canonical `control` rootへ保存する。既定false、authority不明時のeffective値true、入口は設定のアクセシビリティ「常にセル側選択ダイアログを表示」、解除は利用者の明示OFFまたはprofile resetだけとし、viewport／UA変化やevent切替で自動解除せずBackupへ収録しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `RC-30` | pre-I0 observer、schema、read-only method allowlist、sanitized result verifier、runbookをpre-I0準備commitとしてH候補へ先に置く。source hygieneはclean detached worktreeの`npm ci`、固定Node／npm、quality、実行前後HEAD／status／diffを検証し、外部subgate結果も同じsource SHAへ拘束する。observerや結果形式をI0で初めて作る循環依存を禁止する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RC-31` | Playwright browser installは全標準commandを`npx playwright install --with-deps <browser>`へ統一する。lockfileのlocal Playwrightを解決し、固定Node 24.19.0／npm 11.19.0で`--dry-run`引数転送testをI0へ置く。npm 11で`--with-deps`をtarget化して失敗する二重`--`形式は使用しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RC-32` | traceabilityは「normative ID→catalog row／owner phase」だけexact 1、fixture／test／command／implementation／documentはcanonicalな重複なし配列とする。1 fixture／testが複数requirementを満たすことと、1 requirementが複数fixture／testを持つことを許し、逆向きindexと集合一致をverifierが再計算する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `RC-33` | 初版見積りを37～47論理PR＋pre-I0 2 commitへ改め、I0を9個の依存順WBS bundleへ固定する。1 PRへ複数bundleを畳む場合も各bundleの独立check、review owner、Exit coverageを維持し、巨大な「I0一括PR」または後phaseへのtest先送りを禁止する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `RC-34` | performance matrixは`max-parallel = 12`、最大54 shard、1 shard計算上限300分／job timeout 330分、5 wave、matrix計算上限1,500分／hard-timeout上限1,650分、runner計算上限16,200分／hard-timeout ceiling 17,820分／attemptを明示する。qualificationのhalf-open稼働区間からqueue除外360分以下、観測concurrency 12以上を再計算し、canonical 54 shardを12 laneへ割り当てたprojected 5-waveも360分以下をI0 Exit条件とする。test retry／自動workflow retryは0、schema-validな開始前allowlisted infrastructureだけCI Operator承認後にGitHub Actionsの`Re-run all jobs`でquality、prerequisite、build、functional、WebKit、performance全段、finalizer、gateを同一sourceの新attemptへexact 1回再実行する。最大2 attemptのperformance shard matrix部分だけを3,300 matrix分／35,640 runner分とし、partial rerun、別attempt混在、product failureの再実行合格化を禁止する |
| `RC-35` | Backup V2 embedded digestは`digest` fieldを除くexact validated objectを`{ domain: "fsmc-app-backup-v2-v1", backupWithoutDigest }`として`esp-json-v1` canonical serializeしたUTF-8 bytesのSHA-256とする。schema／duplicate-property／未知key検証後に計算し、`scope.companionCore`のincluded／unavailable分岐を含む全field mutationを検出する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `RC-36` | build artifact全体hashはmanifest自身を含むarchive byte hashではなく、manifestを除外したcanonical file-tree digestとする。POSIX `/`相対path、全regular fileのbyte SHA-256／length、UTF-16 code-unit path順を固定する。nested directoryは許すがdirectory entry自体は列挙せず、symlink／junction／reparse point／device fileを禁止する。manifestはそのtree digestと自身のschema versionを持つ。別root／timezoneで同値、path／byte差で不一致をI0 fixtureにする                                                                                                                                                                                                                                                                                                                                                                                                |
| `RC-37` | Pointer FSMは全state×eventのtotal transition tableをI0で固定し、capture取得失敗、non-primary、pointer ID再利用、multi-pointer drain、unmount、lost capture、synthetic click抑止の開始／解除を明示する。全terminalはpointer registry／timer／captureを空にして`idle`へ戻り、未定義eventやcleanup漏れをbrowser/property testで拒否する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `RC-38` | branch gateは既存required contextへFSMCを逆接続せず、既存`quality`を独立required producerのまま維持し、I0 Exit前に`fsmc-required-gate`を一度だけ追加required化する。`quality → FSMC build/test/finalizer → fsmc-required-gate`のacyclic DAGを固定し、phase別context変更、既存qualityへの循環needs、FSMC gate未requiredのI0 Exitを禁止する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `RC-39` | foundation qualityは同一workflow runの既存`quality` jobが`npm ci`＋canonical `npm run quality`を1回だけ実行してresult artifactを生成する唯一のproducerとする。全FSMC build／test／aggregatorはdownload／hash verifyだけを行い、各buildでqualityを再実行しない。package quality graphとworkflow全体のFSMC gateを別result classとして区別する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

現時点の実行可否は次のとおりである。計画書の修正やpre-I0整備はFSMC-I0実装に含めない。

| 対象                          | 判定                        |
| ----------------------------- | --------------------------- |
| 計画書修正・pre-I0 hygiene    | Go                          |
| 外部pre-I0前提のread-only確認 | Go                          |
| FSMC-I0実装                   | No-Go                       |
| FSMC-I1以降                   | 直前phase Exit達成までNo-Go |

観測HEAD `fa743f7cad2d61e5a8f3e723dfc751fba225ced2`ではworktree clean、`git diff --check`成功、Node 24.19.0／npm 11.19.0一致、`npm run test:encoding`成功、`npm run format:check`失敗であり、失敗対象は`docs/各フェーズのFormal Exit達成.md`である。外部pre-I0前提はobserver未実装かつcredential／`gh` CLI不在の現環境で未確認であり、成功とは判定しない。この失敗を専用hygiene commitで解消し、clean detached worktreeの`npm ci`後に実行前後HEAD一致、clean status、`git diff --check`、canonical `npm run quality`を先頭から省略なく完走し、外部pre-I0 subgateも成功した同一HEADだけを`H`／`i0StartHeadSha`へ一度固定する。途中まで成功した後続testや個別commandの成功でcanonical quality失敗を相殺しない。Playwright installは同toolchainで、現行の一重separatorと`npx`形式が`--dry-run`成功、二重`--`形式が`Invalid installation targets`で失敗することを再観測したため、15章は`npx`形式をauthorityとする。

## 2. 現行実装の確認結果

アイテムと訪問単位では、すでにa/bを区別する基盤がある。

- `ShoppingItem.number`は文字列であり、`26a`と`26b`を別々に保存できる
- `26a2`は26a、`26b3`は26bとしてグループ化される
- 買い物一覧と集中モードの訪問IDでは、26aと26bは別スペースである

不足しているのは地図側である。

- 地図照合時に先頭の数字だけが取得され、26aと26bが同じ26番セルへ集約される
- 通常マップと集中モードは、状態、着色、クリック判定を行・列単位で管理する
- 経路の開始・終了地点は番号セルの中央に固定されている
- 地図訪問一覧と経路マーカーも行・列単位で重複を除去する
- 分割方向やa側の位置を保存するデータ領域がない

主な現行境界:

- 地図型: `src/types/map.ts`
- 番号解析: `src/xlsx/domain/itemNumber.ts`
- 通常マップ: `src/components/map/MapCanvas.tsx`
- 集中モード: `src/components/FocusModeMapCanvas.tsx`
- 集中モード位置解決: `src/components/FocusMode.tsx`
- 経路探索: `src/utils/pathfinding.ts`
- 経路点: `src/utils/mapRoutePoints.ts`
- 選択hall経路constraint型／生成／polygon validity／predicate: `src/types/map.ts`、`src/utils/mapRouteMapData.ts`、`src/utils/polygonValidation.ts`、`src/utils/mapRoutePolygon.ts`、`src/components/map/HallDefinitionPanel.tsx`とimport／Backup validator caller
- 保存Port: `src/app/ports/PersistenceCommandPort.ts`
- patch-only保存Port、composition adapter、構造的callback caller: `src/app/commands/ApplicationSnapshotCommitPort.ts`、`src/App.tsx`、`src/app/commands/useMapEditorCommands.ts`、`src/app/commands/useShoppingItemMutationCommands.ts`、`src/app/commands/useMapImportCommands.ts`、`src/features/map/domain/mapImportFlow.ts`
- IndexedDB定義: `src/persistence/db/constants.ts`
- バックアップ: `src/utils/appBackup.ts`
- Backup UI／restore境界: `src/features/events/backupRestore.ts`、`src/components/BackupRestoreDialog.tsx`
- 完全版XLSX: `src/xlsx/engine/eventWorkbookEngine.ts`
- 地図再取込: `src/features/map/domain/mapReimport.ts`
- 通常マップcomposition: `src/components/map/MapView.tsx`
- 地図訪問一覧: `src/components/map/MapVisitListPanel.tsx`
- 通常マップ経路adapter: `src/components/map/mapViewRouteCalculations.ts`
- 集中モードcomposition: `src/features/map/components/FocusModeContainer.tsx`
- space-navigation: `src/features/space-navigation/types.ts`、`src/features/space-navigation/domain/buildNavigatorEntries.ts`、`src/features/space-navigation/domain/visitIdentity.ts`
- 経路hit-test／描画: `src/utils/mapRouteHitTest.ts`、`src/utils/routeRendering.ts`、`src/utils/focusRouteCalculation.ts`
- 地図再取込command／overlay: `src/features/map/domain/mapImportFlow.ts`、`src/app/commands/useMapImportCommands.ts`、`src/app/state/appOverlayState.ts`
- Backup command／overlay: `src/app/commands/useEventTransferCommands.ts`、`src/app/state/appOverlayState.ts`
- Canvas gesture authority／DOM終端: `src/features/map/canvas/useCanvasViewport.ts`、`src/components/map/MapCanvas.tsx`、`src/components/map/MapCanvasPresentation.tsx`、`src/components/FocusModeMapCanvas.tsx`
- Worker参照実装: `src/xlsx/worker/xlsx.worker.ts`、`src/xlsx/worker/workerServer.ts`、`src/xlsx/adapters/workerXlsxExecutionPort.ts`

FSMCの地図描画と経路探索はローカルCanvasと`src/utils/pathfinding.ts`の3×3 A\*を使用し、Mapbox、Google Maps、MapLibre、Leaflet等の外部地図・経路APIやAPI keyを追加しない。外部pre-I0前提はGitHub Actions、branch gate、GHCR利用・package作成可能性に限り、I0で作るrunner imageの実在はI0 Exitで確認する。runtimeの機能可否や経路結果を外部serviceへ依存させない。

## 3. 確定した製品仕様

### 3.1 番号の扱い

| 入力例                | 分割セルでの扱い                                      |
| --------------------- | ----------------------------------------------------- |
| `26a`                 | a側                                                   |
| `26a2`                | a側                                                   |
| `26b3`                | b側                                                   |
| `26A`                 | a側へ正規化                                           |
| `２６ａ`              | a側へ正規化                                           |
| `01a`、`1a`、`０１ａ` | 衝突preflight通過時だけ同じ1a売場。衝突時は機能ON不可 |
| `01b`、`1b`、`０１ｂ` | 衝突preflight通過時だけ同じ1b売場。衝突時は機能ON不可 |
| `26`                  | a/bのどちらにも関連付けず「側未設定」と表示           |
| `26c`、`26d`、`26ab`  | 初版の半セル対象外。a/bへ誤変換しない                 |

番号は表示用原文と識別用正規値を分ける。表示、入力欄、バックアップ上のアイテム番号は可能な限り原文を維持する。地図照合、`SpaceIdentity`、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、索引、経路、再取込照合の番号tokenは`normalizeFsmcNumberTokenV1`だけをauthorityとし、NFKC、全Unicode空白除去、ASCII `A-Z`だけの小文字化をこの順で行う。日程とブロックは5.2の別関数を使い、番号規則を流用しない。数字部分の先頭ゼロ除去は、event内の地図、item、保存済み訪問・順序・進行状態を端末内preflightで検査し、統合前後の異なるidentityが同時に存在しない場合だけ有効にする。`01a`と`1a`等が別identityとして共存する衝突を検出したeventではONへの変更を拒否し、完全legacy identityを維持して対象件数、影響、解決方法を表示する。検査対象payloadや結果を外部送信しない。一方、a/b以外の非対応番号は、基準番号と正規化済み英字suffixをidentity tokenへ残し、`26c`、`26d`、`26ab`を互いに衝突させない。英字suffix後の商品枝番は既存規則を維持し、`26c2`は`26c`と同じunsupported token、`26d2`は`26d`と同じtokenへまとめる。正規化を理由に保存済みitem番号の原文を自動で書き換えない。

非対応suffixはmap cellのraw値から列挙できないため、物理番号領域を表す`MapLocationGeometrySlotV1`と論理locationを分離する。item／association snapshot内の`ParsedSpaceNumber.kind = "unsupported"`から、対象`(blockInstanceId, baseNumber)`ごとの`normalizedSuffix`をUTF-16 code-unit順・重複なしの`logicalLocationRequests`へ集約し、pure `deriveLogicalMapLocationsV1`だけがslotのwhole bounds／中央anchorを共有する別々の`ResolvedMapLocation`を作る。`26c`と`26c2`は同じlocation、`26c`、`26d`、`26ab`は別`LocationKey`とし、item順shuffleでrequest集合、index revision、location配列を変えない。a／b、空文字、unresolved tokenをunsupported requestへ混入させない。

正規化parserは次の順序と正規表現をI0のgolden fixtureで固定する。先にNFKC、前後trim、すべてのUnicode空白除去、ASCII小文字化を行い、`^(\d+)(a|b)(\d*)$`を対応split候補、`^\d+$`をwhole候補、`^(\d+)([a-z]+)(\d*)$`のうちsuffixがa／b以外または複数文字のものをunsupported候補とする。新規UI／CSV／XLSX／Backup入力は先に`FSMC_NUMBER_TOKEN_MAX_UTF8_BYTES`を検査し、超過時はparserや`BigInt`を呼ばずcommand全体を`resource-limit`で拒否する。上限内の数字captureは`BigInt`へ渡す前に、先頭ゼロを線形scanで除いた比較token（全桁0なら`"0"`）を作り、`MAX_SAFE_INTEGER_DECIMAL = "9007199254740991"`との桁数比較、同桁時のASCII辞書順比較を行う。比較tokenが16桁以下かつ上限以下の場合だけ`BigInt`または同等のbounded parseを許し、0なら`unresolved-number / non-positive-base-number`、上限超なら`unresolved-number / unsafe-base-number`、1以上のsafe integerだけを`split-side | whole | unsupported`として返す。既存永続dataに上限超tokenがある場合だけ、巨大`BigInt`化せず`unsafe-base-number`として原文を保持する。負数、小数、指数、記号混入、regex不一致は`unresolved-number / malformed-number`とし、数字や側を推測しない。番号parserは地図を参照せず、`resolveItemMapLocation`がevent、day、hall、block、mapの文脈とparser結果を受けて`ItemSpaceResolution`の`mapped | mapless | legacy-unresolved | ambiguous`を返す。unsupportedの枝番を除いた英字suffixはidentityへ残し、mapがないイベントや一意な物理セルがない商品をmappedへ偽装しない。

イベントがOFFの間は有効化previewで全対象を検査する。イベントがONの間は商品編集、CSV／XLSX取込、Backup復元、通常地図編集、地図再取込、複製を含むidentityへ影響する全commandが、同じtransaction内で最新rootを読んだ後に衝突不変条件を再検査する。操作により新たな正規化衝突が1件でも生じる場合は`PD-16`に従って全store書込み前に操作全体を拒否し、既存data、分割設定、制御rootのONを維持する。衝突原文、対象event、修正例（例: 別売場のつもりなら片方の番号を変更）を表示し、自動OFF、片方だけの取込、衝突identityの自動統合を行わない。旧版操作等により起動前から衝突していた場合はstored ONを書き換えず、当該eventのeffective状態だけをlegacy fallbackにして修正を案内し、他eventを停止しない。

`PD-16`の「新たな衝突」は件数ではなく、次のcanonicalな衝突ペア集合で判定する。

```ts
type PreZeroIdentityKey = string & { readonly __brand: "PreZeroIdentityKey" };
type PostZeroLocationKey = LocationKey;
type NormalizationCollisionPairKey = string & {
  readonly __brand: "NormalizationCollisionPairKey";
};
```

`PreZeroIdentityKey`は、itemと保存済み訪問・順序・進行状態に存在する独立したlegacy identity bucketを、`["pre-zero-space", 1, eventInstanceId, ownerContext, normalizedNumberTokenPreservingLeadingZeros, sideToken]`で表す。`ownerContext`は`["mapped-owner", mapInstanceId, blockInstanceId]`、`["mapless-owner", normalizedDayKey, ["hall", hallId] | ["hall-unassigned"], normalizedBlockToken]`、`["legacy-owner", normalizedDayKey, ["block", normalizedBlockToken] | ["block-missing"] | ["dangling-manual-hall", manualHallId, normalizedBlockToken]]`のexact union、`sideToken`は`["whole"]`、`["split-side", "a" | "b"]`、`["unsupported", normalizedSuffix]`、`["unresolved"]`のexact unionとする。`manualHallId`はvalidated opaque stable IDをbyte同値で使い、表示名や候補hallへ置換しない。同じbucketへの重複参照は1件へ畳み、map／association／settingsはbucket数を増やす入力ではなく`ownerContext`とafter-imageの解決根拠にする。`PostZeroLocationKey`は同じbucketを先頭ゼロ除去後の`SpaceIdentity`へ写したkeyとする。異なる2個の`PreZeroIdentityKey`が同じ`PostZeroLocationKey`へ写るとき、2 keyをUTF-16 code-unit順に並べた`["normalization-collision", 1, postZeroLocationKey, lowerPreKey, higherPreKey]`を1衝突ペアとする。snapshot `S`の全ペア集合を`C(S)`とし、event有効化は`C(after) = ∅`の場合だけ成功する。

ON中の通常commandは`C(before) = C(after) = ∅`を必須とし、`C(after) \ C(before) != ∅`なら、総件数が同じpair swapでも操作全体を拒否する。旧版や別経路で`C(before) != ∅`になったeventではstored ONを維持したままeffective legacy fallbackとし、指定された衝突修正commandだけ`C(after) ⊂ C(before)`となる厳密減少を許可する。新しいpairを加えながら別pairを消す変更、同数置換、部分import、自動mergeは修正扱いにしない。`C(after) = ∅`になった同一commit後だけeffective ONへ復帰し、衝突を減らさない他commandは拒否する。I0で空集合、有効化拒否、pair swap、厳密減少、完全解消のoracleを固定する。

指定衝突修正は共通`NormalizationCollisionRepairPort`の`previewNormalizationCollisionRepair`と`repairNormalizationCollisionsAtomically`だけを入口とし、I0のcommand allowlistを次の3 IDへ閉じる。通常の商品・地図・import writerへ`repairMode` booleanを足して迂回させない。

| command ID                          | 変更できる対象                                                                                                                                         | owner |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `fsmc.repair.item-numbers.v1`       | 利用者が選んだ既存item IDの番号原文。派生する訪問・順序・進行identityは同じafter-imageから再計算する                                                   | I7    |
| `fsmc.repair.map-identity.v1`       | I6のpreview済み通常地図編集planに含まれるblock ownership、番号cell、merge。mapData、association、settings、route cacheを同じcommitへ含める             | I6    |
| `fsmc.repair.orphan-visit-state.v1` | 現在item参照が0件であることを再検証した、利用者選択済み`PreZeroIdentityKey`の保存済み訪問・順序・進行状態だけ。item、map、split definitionは削除しない | I7    |

previewは`eventInstanceId`、command固有の選択、`C(before)`、計算した`C(after)`、全変更・破棄内容、`ExpectedRootVector`、canonical `previewDigest`を返す。commitは同じintent、`previewDigest`、期待衝突pair集合、期待root vectorを受け、transaction内の最新rootからafter-imageを再構築する。`C(after) ⊂ C(before)`、新規pair 0件、選択外変更0件を同時に満たす場合だけ全対象storeを原子的に確定し、pair swap、同数置換、stale preview、通常writerからの呼出しを全拒否する。UIはroot authorityが正常、device ON、stored-enabled eventが衝突によるeffective fallbackである場合だけ到達可能とし、衝突原文、修正後の番号例、地図修正、item参照のない巡回状態の破棄内容を非技術者向けにpreviewする。`C(after) = ∅`のcommit後だけ対象eventを自動でeffective ONへ戻す。I2はallowlist dispatcherと未所有command拒否まで、I6は地図修正、I7はitem／孤立状態修正と統合UIを所有する。

`26`単体と`26c`などの非対応番号は、片側のポップアップ、着色、状態へ混入させず、警告を理由にa/bへ推測割当てしない。分割設定preview、地図上の中央badge、DOM一覧に「側未設定」と件数を表示し、利用者が元アイテムを編集できる導線を設ける。これらが既存の訪問対象に残る場合、一覧からは失わず、経路は従来のセル中央へ接続する。`26`は`whole`、`26c`等は基準番号と正規化suffixを持つ別々の`unsupported` identityとし、互いのアイテム、訪問状態、順序を統合しない。

### 3.2 分割形式

初版では次の4種類を扱う。

1. 左がa・右がb
2. 左がb・右がa
3. 上がa・下がb
4. 上がb・下がa

画面文言では「左右分割」「上下分割」を使用し、「縦分割」のように分割線と領域方向が曖昧になる表現は避ける。

### 3.3 編集操作

- 地図メニューへ独立した「セル分割設定」を追加する
- 番号セルを1個または複数選択できる
- 選択したセルへ4種類の分割または「分割なし」を一括適用できる
- 選択したcurrent owner＋番号にretained履歴がある場合、通常の新規設定としてactiveを追加せず「保持履歴の再関連付けが必要」と表示してI5の明示previewへ送る。候補exact 1件、target activeなし、map／root authority trusted、commit直前も候補集合と`ExpectedRootVector`が一致する場合だけ、そのretained除去＋active作成を同一transactionで確定する。0件、2件以上、target occupied、stale、untrustedは理由と全候補のlast-known owner／evidenceを表示してwrite 0件とし、2件以上から1件を選ぶactive化UIは初版に設けない
- 1つの地図内で論理ブロック名は`normalizeFsmcBlockTokenV1`（NFKC、Unicode `White_Space`連続をU+0020へ畳み、前後U+0020除去、ASCII `A-Z`だけ小文字化）の照合キーで一意とする。locale依存case foldや番号用の全空白除去を流用しない。手動の同名追加は既存ブロックの置換previewを経由する。XLSX上の完全に同じ名前の複数領域は現行仕様どおり1つの論理ブロック・複数`cellGroups`として同じ`blockInstanceId`へまとめるが、原文が異なるのに照合キーだけが衝突するブロックはcore map import結果を変えず、分割機能では影響する番号を対象外または`quarantined`として理由を表示する
- 同じ論理ブロック内に正規化後の同一番号セルが複数ある場合、その重複番号の全候補領域だけをcanonical `duplicate-number-region` exclusionへ入れて初版対象外とし、同じ地図内の一意な他番号は`ready-with-exclusions` indexから利用可能とする
- 重複番号を検出した場合はセル選択画面を設けず、保存・コピー・自動継承から除外して理由を表示し、いずれかを推測で選ばない
- 同じ物理番号領域が複数ブロックに属する、番号領域同士が重なる、または結合セルがブロック境界をまたぐ場合も、原因に参加する全lookup cell、block、base numberを1個以上持つcanonical exclusionへまとめ、その影響領域だけを保存・コピー・自動継承・split描画・location解決から除外し、既存entryは`quarantined`へ移す。配列順の先頭ブロックを暗黙に選ばず、無関係なslot、訪問、経路は継続する
- `DayMapData.cells`に同じ`(row, col)`の物理セルが複数ある場合だけをmap-wide fatalとする。配列の先頭／末尾を採用せず、機能状態を問わず、その重複を新規作成するimport・通常編集のafter-imageを全store書込み前に原子的に拒否する。起動時から存在する場合は当該mapをFSMC上`map-data-untrusted`、`index: null`とし、split表示だけをlegacy whole-cell fallbackへ戻す一方、当該mapの経路は生成もcache再利用もせず安全停止し、影響entryを`quarantined`へ移す。異なる`value`／`backgroundColor`を持つ重複セルの並べ替えで表示・経路結果が変わる状態を許さない。他の4理由をこのfatal分岐へ昇格させない
- ブロック追加、削除、改名、移動、番号セル変更、結合・結合解除を含む通常の地図編集でも、地図再取込と同じ再関連付けplanとpreviewを通し、地図と分割設定を同じ原子的commitで確定する。現行`BlockDefinitionPanel`／commandには番号セル変更、結合・結合解除が存在しないため、I6で新しい`MapCellTopologyEditor`、pure `buildMapTopologyEditPlan`、専用atomic commandを追加する。初版はpreview／取消／commit後に逆操作を新しいpreviewとして行う導線を持ち、未検証の汎用undo stackへ迂回しない
- 解除しても26a/26bのアイテム番号は変更しない
- 再設定すると、既存番号から元のa/b側へ戻る

既存の`BlockDefinitionPanel`は肥大化しているため、分割設定を直書きせず、新しい小型コンポーネントとして実装する。

### 3.4 同形状ブロックへのコピー

- コピー元とコピー先のブロックを利用者が選択する
- 番号ではなく、ブロック内の相対的な行・列位置で対応させる
- 自動回転、自動左右反転、自動上下反転は行わない
- 既定の「追加・変更のみ」はコピー元の分割ありだけをコピーし、コピー元が分割なしでもコピー先の既存分割を解除しない
- 別操作の「完全同期（解除を含む）」だけが、対応するコピー元が分割なしの場合にコピー先の既存分割を解除対象にする。選択時は解除を含むことを確認してからpreviewへ進む
- コピー元の番号がdormant／quarantined、物理領域競合、または曖昧である場合は「分割なし」と解釈せず除外し、コピー先を変更しない
- 両モードが変更するのは、安全に一意対応できたコピー先の`active`状態だけとする。コピー先の`dormant`／`quarantined`履歴は、別の明示削除操作なしに削除・上書きしない
- コピー先の同じcurrent owner＋番号を指すretained履歴が1件でもある場合は、通常の追加・変更・完全同期から`除外（履歴あり・手動再関連付けが必要）`とし、新activeとretainedを重ねない。I5の明示的な再関連付けだけが、最新候補集合がexact 1件であることを再検証し、そのsole retainedをactiveへ状態遷移できる。同じowner＋numberを持つ他retainedが1件でも残る場合はwrite 0件とし、複数候補からの利用者選択、自動選択、copyによる履歴削除を初版に設けない
- 適用前に選択中のモードと「追加」「変更」「解除」「変更なし」「除外」の件数・対象・理由を表示する。「追加・変更のみ」では解除件数を0とし、維持する既存設定を明示する
- 結合範囲や対応セルが一致しない箇所は変更しない
- 一部不一致でも、適合する箇所だけを適用できる
- プレビューを取り消した場合は画面状態・保存状態とも変更しない
- 対応はブロックの正規化済み占有mask、相対行列、番号領域、結合範囲で行う。穴のある形状や非連続形状もmaskを維持し、コピー元に対応領域がないコピー先セルは変更しない
- preview作成時のコピー元・コピー先root vectorを確定時に再検証し、stale、保存失敗、CAS競合では対象全体を変更しない
- 分割設定は1イベント内の1地図インスタンスに属し、同じレイアウトや同じ地図名でも別日程へ自動共有しない
- 別日程・別地図インスタンスへのコピーは後続版とし、初版UIとcommandには入口を設けない

### 3.5 描画と色

- 分割線は常に表示する
- a/b文字は、表示領域に十分な大きさがある場合だけ表示する。位置は地図とともに回転させるが文字glyph自体は常に正立させる
- 通常マップは現在の「巡回リストへの追加状態・優先度」の色規則を維持する
- 集中モードは現在の購入状態・進行状態の色規則を維持する
- 状態集計はa/bごとに独立させる
- 空の側は着色しない
- 結合セルは結合された長方形全体を半分にする
- 分割方向は地図座標で保存し、地図の回転と一緒に見た目も回転する

### 3.6 クリック・タップ

- `PD-05`に従い、表示用の`layoutMode`と操作用の`isSmartphoneSelectionMode`を分離する。pure `resolveSmartphoneSelectionModeV1`は`forcedPickerOverride`、`mobileCapability: true | false | "unknown"`、primary pointer／touch capabilityを入力とする。`forcedPickerOverride`は`MapCellSplitControlRoot.forceSplitPicker`だけから読み、設定のアクセシビリティにある「常にセル側選択ダイアログを表示」toggleで端末全体へ保存する。全event、通常マップ、集中モードで共通、既定false、Backup非収録、明示OFFまたはprofile resetまで維持し、event／viewport／UA変更で自動解除しない。control authorityを信頼できない場合は保存値を推測せずeffective trueとする。production `MobileCapabilityPort`はbooleanの`navigator.userAgentData?.mobile`だけをmobile authorityとし、User-Agent文字列、viewport幅、touch有無からmobile値を捏造しない。優先順位はoverrideによるpicker強制、`mobileCapability=true`、`mobileCapability=false`、unknownの順とし、unknownはpointer情報にかかわらず安全側pickerへ倒す。`mobile=false`の狭幅／touch PCは非スマートフォン規則、`mobile=true`はtouch情報が矛盾してもpickerとする。overrideは非スマートフォン強制を持たない。gesture開始時に判定snapshotとcontrol revisionを固定し、途中で変わればgestureをcancelして全pointerが離れた次操作から新値を使う。I0のtruth tableとI2永続化、I8／I9 UI・browser testで全組合せを固定する
- `isSmartphoneSelectionMode=false`では、片側の表示上の最短辺が入力種別ごとの閾値以上で、分割線の曖昧帯外にある場合だけ選択した側を直接開く
- スマートフォン以外の初期閾値は、マウスでは片側の最短辺12 CSS px、タッチ・ペンでは44 CSS pxとする
- 閾値と完全一致する場合は直接選択する。スマートフォン以外で閾値未満、分割線の曖昧帯、または候補が複数の場合は選択を変更せず、「拡大してa側またはb側の中央付近を選択してください」と案内する。スマートフォン専用pickerを開かない
- 閾値と曖昧帯の半幅は入力別CSS px定数としてFSMC-I0で固定し、直前・一致・直後をbrowser testする
- テスト対象Chromiumでmobile情報が取得不能または入力能力と矛盾し、利用者overrideもない判定不能状態はpickerへ倒して誤選択を防ぎ、診断理由を表示する。mobile情報が`false`のPC profileは、touchscreenや狭いviewportだけを理由にpickerへ切り替えない
- スマートフォンのa/b選択ボタンは最低44×44 CSS pxとする
- pickerの候補は各側anchorをviewport変換したCSS px座標で並べる。2側の差`dx`／`dy`について`abs(dx) >= abs(dy)`（45度同値を含む）ならscreen x昇順で左／右、それ以外はscreen y昇順で上／下とする。0.01 CSS px以内の同値はscreen y、screen x、最後に安定side tokenの順で決定し、DOM順、focus順、読み上げ順、位置labelを同じ結果から生成する。`左側 b`／`右側 a`、`上側 a`／`下側 b`のように位置名とsideを併記し、単なるa→b順へ並べない。DPRはviewport変換後のCSS pxへ二重適用しない
- CSS px判定には地図zoom、アプリ表示倍率、responsive scaleを反映し、DPRを二重適用しない。画面回転でlayout判定が変わった場合は進行中gestureを取消し、次の操作から新規則を適用する
- `pointerdown`から`pointerup`／`pointercancel`／`lostpointercapture`までpointer IDごとの状態を管理し、pointer captureを使用する。パン、ピンチ、ドラッグ、2本目の指の追加後は全pointerが離れるまで選択と後続synthetic clickを抑止し、指離しをタップと誤認しない

### 3.7 ポップアップと新規アイテム

- 26aを選択した場合は26a、26bを選択した場合は26bだけを対象にする
- 通常・編集画面で空の側を選んだ場合は「A-26b：アイテムなし」と既存の追加導線を表示する
- 集中モードのセルクリック後は、既存のセルポップアップ、追加ダイアログ、`onAddItem`、`computeAddItemFromFocusMode`の処理を流用する
- 集中モードのポップアップは、選択側、現在の参加日、現在の`executeModeItemIds`をすべて満たす今回の巡回対象だけを表示する
- 登録済みでも今回の実行リスト外のアイテムは、現行動作どおり集中モードのセルポップアップへ表示しない
- 今回の巡回対象が0件の場合は、登録済み対象外アイテムの有無にかかわらず次を表示する
  - 見出し: `A-26b`
  - メッセージ: 「このセルには今回の巡回対象アイテムがありません」
  - 新規アイテム追加ボタン
- 追加画面には現在の参加日、クリックしたブロック、選択側を含む`26a`または`26b`を事前入力する
- 既存の初期値を維持し、サークル名・タイトル・価格・メモ・URLは空、数量は1、購入状態は「購入済」、優先度は`none`とする
- 追加確定時は全状態の商品をイベントのアイテム一覧へ追加する
- 「購入済」で追加した商品は現行動作どおり実行リストへ自動追加せず、経路も変更しない
- 「後回し」または「遅参」で追加した商品は現行規則に従って該当日のraw実行商品ID配列へ追加する。同じ`ExecutionVisitIdentity`の既存訪問が配列内のどこかにある場合は非連続でもその訪問へglobal統合し、raw訪問位置、現在位置、保存位置を動かさず、normal投影へ統合すると同時に必要な後回し／遅参`PhaseVisitIdentity`だけをbase順で追加する。通常マップ、集中モード、買い物一覧、`MapVisitListPanel`／`ProjectedVisitList`、routeへ同じ結果を反映して「既存のA-26a訪問へ追加しました」と通知する。既存execution identityがない場合だけ実行リスト末尾に新しいbase訪問を作る。共有投影または経路座標signatureが変化した場合だけ経路を再計算する
- 既存商品のevent日程、block、番号、side、優先度、`manualHallId`、hall association、mapped／mapless ownerを編集して`ExecutionVisitIdentity`が変わり、変更先identityがすでに存在する場合も、変更先訪問の位置を維持する。変更item IDだけを旧membershipから外して変更先訪問のmember末尾へ再配置し、他の商品IDの相対順を変えない。変更元訪問が空になれば除去し、現在位置、保存位置、後回し・遅参をitem ID対応から新しい`PhaseVisitIdentityKey`へ再解決する。経路anchorは再解決後のphase visit IDを参照し、全画面へ同じ結果を通知する
- 「今回の巡回へ追加」専用操作や自動的な現在位置変更は追加しない

### 3.8 売場、訪問、優先度

空間上の同一性と巡回上の同一性を分ける。

- `SpaceIdentity`は`mapped`、`mapless`、`legacy-unresolved`の判別可能unionとする。`mapped`だけがevent／map／block instance ID、先頭ゼロを除いた基準番号、`SpaceSideIdentity`を持つ。`mapless`はevent、day、hall、block、番号のcanonical tokenを持ち、`legacy-unresolved` identityは候補を選ばないcanonical legacy tokenだけを持つ。原文と解決reasonは`ItemSpaceResolution`の診断payloadに置き、structural identityへ混入させない。3種とも`ExecutionVisitIdentity`を形成できるが、map geometry、marker、route anchorへ入れるのは`mapped`だけとする。`SpaceSideIdentity`は`{ kind: "whole" }`、`{ kind: "split-side", side: "a" | "b" }`、`{ kind: "unsupported", normalizedSuffix: string }`の判別可能unionとし、非対応番号同士を単一の`unsupported`値へ潰さない
- `ExecutionVisitIdentity`は`SpaceIdentity`に優先度区分を加えて構成し、raw実行商品ID配列のmemberをglobal集約するbase訪問単位とする。I7 migration後のbase訪問順authorityはdenseな`executionVisitOrder`であり、raw配列はitem membershipと訪問内member相対順を保持する
- `PhaseVisitIdentity`は進行区分と`ExecutionVisitIdentity`から構成し、通常マップ、集中モード、訪問一覧、経路の投影単位とする。進行状態・表示・経路上は別訪問だが、独立した手動順や挿入位置を所有しない
- raw実行商品ID配列では、同じ`ExecutionVisitIdentity`のアイテムが非連続でも配列全体で1訪問へ統合する。legacy dataからの初回投影では最初に現れる商品位置からdense `executionVisitOrder`を1回だけseedし、以後は`executionVisitOrder`をbase訪問順authorityとして保持する。raw商品ID配列自体をglobal sortせず、同一visitのmemberはraw出現順で投影する
- normal投影は全実行商品から作り、後回し・遅参はnormalとは別の追加投影として作る。同じ商品がnormalと後回し、またはnormalと遅参の複数`PhaseVisitIdentity`へ属し得る
- 進行区分は`"normal" | "postponed" | "late"`、優先度は`"none" | "priority" | "highest"`のexact unionとする。全実行商品はnormalへ属し、同じ商品が追加で属せるのはpostponedまたはlateのどちらか一方だけとする。import／restoreのafter-imageが両方を主張する場合はcommit前に拒否し、既存の矛盾dataはnormalだけを維持して追加phaseを作らず診断表示する。配列順で一方を採用しない
- 同じ側でも優先度が異なるアイテムは、通常の実行列・候補列と同じ規則で別`ExecutionVisitIdentity`・別訪問として表示する
- 異なる優先度を最高優先度へ代表集約しない
- 後回し、遅参など進行区分が異なる場合は別`PhaseVisitIdentity`として扱うが、「別訪問」は「別のbase挿入位置」を意味しない。各phase内の順序はbase execution順から決定的に派生し、基礎となる`ExecutionVisitIdentity`のraw位置を動かさない
- migration前は利用者が指定したraw実行商品順の最初の出現をbase execution順のseedとし、migration後はdense `executionVisitOrder`を優先する。phase別の独立した手動順は初版で保存せず、全phaseをnormal→postponed→late、各phase内base execution順で投影する
- base executionの手動順がない場合だけ、同じ優先度内でa→bを自然順とし、各phase投影もその順序を使用する
- I7以降の並べ替えintentは`ExecutionVisitIdentityKey`の重複なしexact permutationだけを受けるpure `planExecutionVisitOrderMutationV1`へ集約する。`useMapVisitListCommands.updateOrder`は`ShoppingItem[]`からraw item ID列を即時変更せず、projection上のbase visit ID draftを作り、保存時だけdurable order commandを呼ぶ。取消はdraftだけを破棄する
- 永続commandは`ExecutionVisitOrderMutationCommandV1`のexact unionとし、通常reorderのstable IDを`fsmc.visits.reorder-execution-order.v1`、hall連動reorderを`fsmc.visits.reorder-by-hall.v1`に固定する。両branchはsource event／day、projection revision、before／after execution visit permutation、raw execution rootのread-only witness、durable root、必要時hall route root、`ExpectedRootVector`、preview digestを持つ。raw execution rootはcommit直前のCAS read対象だがbyte保持するためlogical write participantへ水増しせず、durableとhall routeの実writeだけをparticipant／fenceへexact登録する
- hall順変更は`useMapRouteCommands.reorderExecuteListByHallOrder`によるraw item配列更新を廃止し、hall route settings after-imageと同じsnapshotからbase visit permutationを作る`planHallRouteAndExecutionOrderMutationV1`へ移す。commitはcoreのhall route root、`durable-visit-state`、metadata／checkpoint／fenceを同じ`ExpectedRootVector`とtransactionでall-old／all-newにし、raw実行商品ID配列と訪問内member相対順をbyte同値で維持する。stale、unknown visit、非全単射、rekey競合、quotaでは双方write 0件とする
- 同じ`ExecutionVisitIdentity`を意図的に複数の別訪問として作る「再訪」は初版対象外とし、商品追加・編集・復元・経路挿入の全経路で既存訪問へのglobal統合を優先する
- identity変更を伴う商品編集だけは、変更item IDを変更先identityの既存member末尾へ決定的に移す。変更先の最初のmember位置は動かさず、変更item以外のraw順を維持する
- 投影済み訪問のroute、hit-test、挿入位置は代表商品IDやmember配列の先頭ではなく`PhaseVisitIdentityKey`で参照する。memberの商品ID列は訪問payloadとし、identityには含めない
- 同じ`PhaseVisitIdentityKey`にmemberが残る状態で先頭memberを削除・変更した場合は、同じ訪問へ再解決して訪問位置、座標、経路順、挿入anchorを維持する。member列だけが変わりidentity・座標・順序signatureが同じならroute cacheを破棄しない
- preflight衝突0件の場合だけ`01a`と`1a`の表記差を同じ`SpaceIdentity`へ正規化し、表示用番号は各アイテムの原文を維持する。衝突時はイベントをONにしない

既存データで表記差が同一`ExecutionVisitIdentity`へ衝突する場合、商品IDと既存のraw実行列順を正とする。

- migration初回は実行列の商品ID配列を並べ替えず、非連続な同一identityもglobalに集約し、最初に現れる商品位置を統合後訪問の初期位置とする。以後はidentity単位の訪問位置と訪問内の商品順を維持し、先頭memberの変更だけで別訪問の前後へ移動させない
- 旧`FocusModeSessionState`の`phase`／`phaseIndex`、3 `savedPhaseIndices`、`postponedItemIds`、`lateItemIds`、`isCompleted`、`lastPurchaseChangeAt`はすべてUI memoryだけのvolatile値であり、core／旧Backup／reload後から再構築できるとは扱わない。同一processで`LegacyFocusSessionFreezePortV1`が最新stateのcapture ackとfreeze tokenを返したscopeだけ、正式現在位置を旧phase indexの商品IDから`{ phase, anchorItemId }`へ、各saved indexをphase別anchorへ、追加phase item集合、completion、purchase anchorを一度限りで変換する。親へ遅延通知された`focusModeSessions`やunmount時点のeffect値をexact snapshotとして採用しない
- live snapshotのanchor商品が消えた場合は同phaseの旧位置以降、直前、先頭、`null`の順で解決し、別phaseへfallbackしない。postponed／lateの欠損item IDは除外するが、両集合に同じitemがある、index／phase／型が不正、purchaseが0／複数visitへ解決するfieldは`unresolved-legacy-focus-session-field`とし、そのfieldだけを黙示補正しない
- live snapshotがないreload／service-worker update／process再起動後、または不正fieldにはpure `defaultDurableVisitEntryV1(coreScope)`を候補として提示する。defaultはcore raw順由来の`executionVisitOrder`、全itemの`additionalPhaseByItemId = null`、`current = { phase: "normal", anchorItemId: 最初のnormal visitの最初のmemberまたはnull }`、saved 3 phaseすべて`null`、`isCompleted = false`、`lastPurchaseChangeAt = null`である
- default適用はscope、失われる旧field名、回収不能理由、beforeがunknownであること、exact after-imageをmigration previewへ列挙し、全scope／全default fieldを利用者が明示確認した一つのcommitだけで許す。安全に解決できる同一process fieldを一律破棄せず、確認取消では全scopeをmigratingのまま維持する。durable rootがreadyになった後の不能／曖昧値は自動default化せず要修復として保持する
- 旧`eventName::eventDate` keyは文字列分割せず、live coreが列挙する各exact event名／raw day tupleから現行`buildFocusSessionKey`で再生成したkeyとのbyte一致を最初に検査する。event名基準の`auditLegacyFocusDayScopesV1`がcollision-freeかつ同attemptの`EventAuthorityProposalResultV1.kind = "proposed"`となった後だけexact 1 event instanceへ写し、`(eventInstanceId, normalizedDayKey)`を作る。legacy keyからscope候補0件／複数件、または複数legacy keyから同一scopeは`unresolved-legacy-focus-session-key`とし、対応scopeのdefault候補と未使用legacy recordの破棄を同じloss previewで明示確認する。異なるraw dayが同じnormalized dayへ衝突する場合は未発行IDを使わないcanonical witness付き`capability-adoption-blocked`へ止め、capability store write／ID proposal／token／seed／default／loss previewを0件にする。専用repairはtarget-firstのtotal／injective／closed mapping、全physical sourceをrow化したうえで全present source↔assignmentをexact partitionし、event-wide hall source、map／Focus closure、external absence E0／E1／E2をCASする。`distinctNormalizedDayScopeCount`、`executionBucketCount`、`hallDefinitionSlotCount`、`hallRouteSlotCount`だけを宣言済み決定式で遷移させ、`hallDefinitionEntryCount`、`hallRouteListCount`、`hallRouteItemReferenceCount`、execution referenceとその他の保存field count／payload bytesを維持し、domain外target、merge、drop、copyを拒否する。表示名一致や`::`の最初／最後の位置をparser authorityにしない
- capture authorityはprocess-localでrevision付きの単一registryとし、state mutation、record出現・削除・再作成、legacy key remapのたびにprocess-global safe-integer generationを単調増加させ、その値をrecordの`sessionRevision`へ付ける。A→B→A、削除→同bytes再作成、親stateのsemantic同値抑止でもgenerationを再利用しない。freeze tokenには内容generationと別のprocess-global `freezeIssuanceId`を発行ごとに単調増加して含め、Port内ledgerを`active → invalidated | consumed`の一方向に進める。同じ内容を取消／quota後に再captureしても新issuance IDとdigestを発行し、旧tokenは再びactiveにしない。`registryGeneration`、`freezeIssuanceId`、`operationGeneration`のいずれも上限到達時はwrapせず、対応する`LegacyFocusSessionCounterExhaustionReasonV1`でprocessをlatchする。発端setter／lifecycle commandをUI publish／core DB first write前に拒否し、freeze token／default／loss previewを0件としてruntime `repair-required`へ送る。freezeはstate setterとevent lifecycle operation leaseを共有する直列化queueで「進行中lease完了→新規lease／interaction停止→active state ownerのlatest committed state capture ack→全setter拒否→immutable token発行→旧writer unmount」の順とする。freezeが先ならrename／delete／pruneをcore DB first write前に拒否し、lifecycleが先ならcore persistence成功後のregistry after-image適用までleaseを解放しない。ack前unmount、passive effectだけのflush、core commitとkey remapの間でfreeze、freeze後のprune／lifecycle mutation、invalidated／consumed token再利用を許さない
- 一時移動、inspect、return history、経路cache、座標signatureはidentity変更時に破棄し、変換済みの正式現在位置へ戻す。実行中なら一時移動を終了した理由を通知する

### 3.9 経路

- selected hallの`polygonFingerprint = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-hall-route-polygon-v1", eventInstanceId, mapInstanceId, hallId, hallDefinitionRevision, polygon, boundaryRule })))`とする。selected constraintの`constraintFingerprint`は検証済みpolygon fingerprintを含む自身以外の全fieldを`{ domain: "fsmc-route-path-constraint-v1", constraint }`でhashする。開始頂点／向きだけの差は同値、頂点／hall／revisionの差は別値とする
- 26aと26bの経路終点と番号マーカーを各半領域の中央へ置く
- 同じセル内の26a→26bでも、両中心間の短い線を表示する
- 経路挿入と経路ヒットテストもa/bを区別する
- 同じ側、同じ進行区分、同じ優先度に属する複数アイテムだけを1訪問・1マーカーへまとめる
- 同じ側でも優先度または進行区分が異なる訪問を重複除去しない
- 異なる訪問が同じ半領域anchorを共有しても、訪問順、進行状態、一覧表示は別々に維持する
- 26aと26b、および同一側の異なる`PhaseVisitIdentity`を行・列や`locationKey`だけで重複除去しない
- 同じanchorを共有する複数訪問は、Canvas上では件数badge付きの1つの位置markerとして描画し、選択後のDOM一覧で優先度・進行区分ごとの別訪問として表示する。現在訪問だけは最前面の状態ringで示し、後描画で他訪問の存在を隠さない
- 同じanchorを共有する位置marker本体は特定訪問の色で代表させず中立色とし、件数badgeと現在訪問ringを独立layerで描画する
- DOM訪問一覧の各`PhaseVisitIdentity`に「この訪問の後へ挿入」を設ける。追加対象の`ExecutionVisitIdentity`が存在しない場合だけ、anchor phase visitからbase execution visitを求め、denseな`executionVisitOrder`でその直後へ新identityを挿入して後続orderを1ずつ進める。raw商品IDは既存member相対順を維持して追加し、`[A1, B, A2]`のような非連続memberの「最後のraw index」をbase順authorityにしない。既存execution identityがある場合は、追加対象phaseがまだ存在しなくても指定anchorを無視し、商品を既存base訪問へglobal統合して必要な新phase entryをbase位置へ追加する。「既存訪問へ統合したため、指定位置に新規訪問は作成しませんでした」と通知する。例としてnormalが`A→B`のときに後回しAを「Bの後」へ指定しても、後回しAはnormal Aとは別のphase訪問としてbase A位置へ投影し、Bの後には置かない。成功・取消・競合をstable operation event ID付きで通知し、操作元へfocusを戻す
- 選択ホールが`all`以外の場合は、route inputへstable event／map／hall ID、hall definition revision、canonical polygon、`polygonFingerprint`を持つ`selected-hall-polygon` constraintを必須にする。現行`HallDefinition`／polygon validationと同じ4頂点以上を維持し、hall不在、4頂点未満、stale revisionは無制約routeへfallbackせず`invalid-route-constraint`として経路を停止する。main pathの全node間segment、simplification後segment、routing port、anchor connector、`same-cell-direct`をinclusive polygon内で検証し、端点だけ内側でも凹polygon外へ出る線を`outside-route-constraint`でunroutableにする。`all`だけが明示的な`whole-map` constraintを使う

### 3.10 地図再取込と通常編集

- ブロック名と番号が新旧地図で一意に一致する場合は分割設定を継承する
- 行・列が移動しても一意であれば継承する
- rawブロック名の完全一致がない場合、双方を`normalizeFsmcBlockTokenV1`で正規化した一致候補がexact 1件だけなら候補にする。ASCII以外のcase fold、locale比較、trimだけの別規則を使わない
- 0件または複数候補なら継承しない
- 新旧いずれかの地図で同じ論理ブロック内に同じ正規化番号が複数ある場合は、その番号を自動継承しない
- 確定前に継承件数、除外件数、除外理由をプレビューする
- 地図と分割設定は同じ原子的コミットで確定する
- 一致しない設定は削除せず`dormant`、曖昧・不正な設定は`quarantined`として保持し、誤った地図へ自動接続しない
- `dormant`／`quarantined`は、内容と理由を確認して端末内の手動再関連付けまたは削除を選べるようにする。設定だけのJSON出力は後続版とし、初版UIには入口を設けない
- 通常の地図編集でも変更前後のブロック・番号領域を照合する。同じ`blockInstanceId`と正規化番号が一意でgeometry不変ならactiveを維持し、対象番号の移動・結合変更はpreview付きで再関連付けし、曖昧・重複・境界横断だけを`quarantined`にする
- 無関係な別ブロックの追加・削除だけを理由に、影響を受けないentryを一括して休眠・隔離しない

### 3.11 ファイルへの収録

- 初版のイベント単位Backup V2へ収録する
- Backup V2と同時に出力する旧版用V1互換core backupには分割設定を収録せず、その旨をファイル名と完了画面へ表示する
- 完全版XLSX 2.3への収録は後続版とする
- 簡易XLSXへは収録しない
- CSVへは収録しない
- 簡易XLSXとCSVでも、アイテム番号文字列の26a/26b自体は維持する
- イベント単位Backup V2の復元は、事前プレビューで復元先、置換範囲、休眠化、除外理由を表示したうえで、復元対象イベントの地図と分割設定をまとめて置換する
- `PD-01`に従い、分割設定を収録しないBackup V1またはXLSX 2.2を完全復元する場合、対象範囲の既存分割設定は削除・active維持せず、`legacy-full-restore-without-split-settings`理由で`dormant`へ移す。取消時は何も変更しない
- アイテムだけのインポートは既存の地図・分割設定を維持し、暗黙に削除・置換しない
- 後続版の完全版XLSXからの復元も、地図を含む完全取込時だけ分割設定を適用し、アイテム取込では維持する

### 3.12 対象端末とアクセシビリティ境界

`PD-07`に従い、初版の自動テスト対象:

- 単一Desktop Chromium profile（Chrome／Edge系と同じChromium engineを検証するが、個別browser channelの正式保証ではない）
- Mobile Chromium emulation profileのスマートフォン表示・touch操作
- CIで使用するbrowser engine、channel、viewport、device scale factor、入力能力をversion付き設定へ固定する

任意の手動確認対象。完了gateや正式保証とは表記しない:

- 利用可能なWindows 11／10 PC、Androidスマートフォン、iPhone、ペン入力

自動テスト対象外の環境・入力:

- iPhone SafariおよびiPhone PWA
- ペン入力
- Windowsのversionや端末機種に固有の挙動
- 任意確認でデータ消失、a/b混同、誤保存を検出した場合は、再現fixtureを追加して自動テストで修正を固定する

保証対象外:

- macOS、iPadOS、Firefox
- CIで固定していないbrowser engine、channel、OS・端末固有機能

Desktop Chromium profileではマウスと通常touchによる半セルのCanvas直接選択、Mobile Chromium emulationではセル選択後に必ずpickerを経由する動作を自動テストする。ペンは自動テスト対象外とする。キーボード・画面読み上げによるCanvas半セルの直接選択だけを初版対象外とし、DOM代替導線は必須とする。

Canvasを操作できない利用者向けに、DOMで構成した次の代替導線を必須とする。

- セル分割設定画面のブロック・番号一覧から26a/26bの設定と詳細を開ける
- 買い物一覧と訪問一覧から該当する26a/26bの詳細を開ける
- 一覧または通常のアイテム追加画面から、Canvasを使わず26a/26bのアイテムを追加・編集できる
- アイテム状態と訪問状態をCanvasの色だけでなく文字でも確認・変更できる
- 訪問一覧の各`PhaseVisitIdentity`から「この訪問の後へ挿入」を選べる。追加対象の`ExecutionVisitIdentity`が未存在の場合だけ直後へ新規訪問を挿入し、既存の場合はanchorを無視してglobal統合した旨を通知する

a/b選択画面、番号一覧、設定画面、ポップアップ、新規追加画面には通常のフォーカス管理、読み上げ名、Escape閉鎖を実装する。DOMから開いた場合は呼出ボタンへ、Canvas操作から開いた場合は地図ツールバー内の固定focus対象へ戻し、`body`やfocus不能なCanvasへ戻さない。Canvasへ見せかけの`role="button"`は付けず、本機能を完全なWCAG対応とは表記しない。

### 3.13 保証規模

受入試験では、1イベントの1地図に次の最大条件が同時に存在するfixtureを使用する。

- 地図の論理セル数: 15,000
- 論理ブロック数: 最大8,192
- 分割設定: 最大15,000件
- 分割後のa/b領域数: 最大30,000
- アイテム数: 400
- 異なる売場を表す`SpaceIdentity`: 400
- `ExecutionVisitIdentity`: 400
- `PhaseVisitIdentity`: 最大800（normal最大400＋postponed／late追加投影の合計最大400）。単一phaseのroute入力は最大400

「分割数30,000」は15,000セルをすべてa/b分割した結果の領域数を意味し、30,000件の分割設定を意味しない。400 itemは各itemがnormalに加えて高々1個の追加phaseへ属せるため、全`PhaseVisitIdentity`投影は最大800、1本のphase別経路は最大400となる。active 15,000件の最大healthy fixtureとretained 15,000件の管理UI fixtureは独立profileであり、同時30,000 entryを初版の自動export保証とはしない。初版で保証するexportable profileはactive＋retained合計20,000件以下とし、7.3のhard limit、V2／V1各byte上限、pair上限をすべて満たす。15,000セル、400 item等の性能fixture値自体は入力拒否の上限ではないが、active＋retained合計20,000件は7.3の明示hard limitであり、超過exportはbest effortにせず停止する。7.3のhard limitは1 eventあたりmap 256、block 8,192であり、1地図・最大8,192 blockの本保証fixtureを包含する。

## 4. 非対象

初版では次を実装しない。

- c/dを含む3分割以上
- 任意個数の領域分割
- 同形状コピー時の自動回転・自動反転
- 別日程・別地図インスタンスへの分割設定コピー
- 完全版XLSX 2.3、設定単独portable JSON、multipart backup
- 端末間の自動同期、自動merge、同じイベントの複数主端末運用
- 同じ`ExecutionVisitIdentity`を意図的に複数回訪れる再訪機能
- 簡易XLSX・CSVによる分割設定の持ち運び
- 旧版アプリからの分割設定編集
- Canvas半セルのキーボード・画面読み上げによる直接選択。ただしDOM一覧による代替操作は必須

現行の`duplicateEvent`／`create-alias`はimport時のイベント名競合解決であり、地図・設定を含むイベント全体複製ではない。初版ではI3に新しい「イベント全体を複製」UIと`duplicateWholeEventAtomically` commandを追加する。commandは同一snapshotのevent metadata、全item、実行順、`DurableVisitStateRootV1`の対象event slice、map／hall／route／viewport、canonical `eventSettings`、association、active／retained split設定を対象に、event／map／block／item／entry／historical ownerのfresh local IDをgroup-preservingにremapする。新eventはローカルOFF、一時位置・route cache・hover／dialogは未開始とし、durable順序、現在／保存／購入変更anchor、phase、完了状態はremap済みitem／visitへ同一commitで保存する。名前衝突、ID再発行失敗、stale、quota、bridge未完了ではwrite 0件とし、previewに対象件数、生成名、remap、コピーしない一時状態を表示する。別日程・別地図へ分割設定だけをコピーする操作とは別commandであり、`create-alias`から呼び出さない。

- 同一論理ブロック内で重複する正規化番号への分割設定
- iPhone、ペン、Mac、iPad、Firefox、旧ブラウザの正式保証
- IndexedDBのバージョンダウングレード

## 5. アーキテクチャ

### 5.1 共通位置索引と解決API

通常マップ、集中モード、ポップアップ、訪問一覧、経路が個別にa/b判定を実装してはならない。一方、商品から場所を探す処理だけへ集約すると、商品が0件の側をpointerやDOM一覧から解決できないため、同じimmutable索引とgeometryを共有する3つのAPIへ責務を分ける。

```text
src/features/map-cell-split/
  domain/
    types.ts
    spaceNumber.ts
    splitGeometry.ts
    mapLocationIndex.ts
    mapSpaceResolver.ts
    mapLocationHitTest.ts
    splitCopyPlan.ts
    splitReimportPlan.ts
    splitManualMapEditPlan.ts
    splitRouteTypes.ts
    projectPhaseVisits.ts
  backup/
    wireTypes.ts
    validation.ts
    backup.worker.ts
    workerServer.ts
    workerClient.ts
    workerProtocol.ts
  components/
    CellSplitDefinitionPanel.tsx
    CellSidePickerDialog.tsx
    ProjectedVisitList.tsx
```

公開API:

1. `resolveItemMapLocation(item, context)`: `mapped | mapless | legacy-unresolved | ambiguous`の判別可能unionを返す。mappedだけが物理地図位置を持ち、商品番号から`whole`、a/b、または個別の非対応番号identityを解決する
2. `hitTestMapLocation(mapPoint, context)`: pointer位置から、商品が0件の側を含む`none | single | ambiguous`候補を解決する。スマートフォン／直接選択の可否はgeometryではなくinteraction policyが判断する
3. `listMapCellLocations(blockInstanceId, baseNumber, context)`: 設定画面、picker、DOM代替導線用にCanvasを使わず候補を列挙する

各APIは地図と分割設定から一度構築した`MapLocationIndex`を共有する。描画、pointer move、経路計算ごとに全セル・全商品を総当たりしない。商品一覧の取得は`locationKey`索引へ分離し、位置解決自体へ優先度、進行区分、購入状態を混入させない。

既存`NavigatorItem`は表示用の軽量型のまま維持し、`eventDate`、`manualHallId`、map／event／hall contextを追加しない。app層の`buildProjectedPhaseVisits(input: VisitIdentityInputSnapshot)`が、`ShoppingItem`と同一revisionのevent／map／hall／durable visit snapshotをpure resolverへ渡し、解決済み`LocationKey`、resolution summary、`PhaseVisitIdentityKey`を持つ`PhaseVisitProjectionSnapshot`を生成する。non-promotable QA artifactではspace-navigation、通常マップ、集中モード、一覧をI7から、経路をI10からこのsnapshotへ切り替え、各consumerで`buildVisitIdentity`、番号parser、hall resolverを再実行しない。production artifactはI10までlegacy adapterを維持してFSMC public edgeを0件とし、I11 release-readyかつdurable `ready`後にだけ同じsnapshotへ初回切替する。既存`buildVisitIdentity`は機能OFF／pre-release production互換adapterとして隔離し、I7 ExitはQA機能ON caller 0件、I11 Exitはready後のproduction FSMC callerについて許可したlegacy adapter以外0件を、artifact purposeを識別するarchitecture testで検証する。

`LocationKey`／`ExecutionVisitIdentity`のafter-image入力には、日程、block、番号、side、優先度、`manualHallId`、hall definitionの追加・変更・削除、hall association／remap、map association、mapped↔mapless、hall-unassigned↔resolvedの遷移を含める。優先度は`ExecutionVisitIdentity`だけを変更し、`LocationKey`へ混入させない。`VisitIdentityInputSnapshot`は単一revisionのevent metadata、map association、hall definition、split settings、商品after-imageを束ね、異なるsnapshot revisionの混在を拒否する。mapless hallは、存在する`manualHallId`のexact 1件一致、manual指定なし時の既存resolver exact 1件、0件時の`hall-unassigned`の順で解決する。dangling manual IDを別hallやunassignedへfallbackせず`missing-manual-hall-reference`、複数候補を`multiple-hall-owners`としてunresolved／ambiguousへ送る。hall表示名だけの変更や、解決後のstable hall IDが同じ変更ではidentityを変えない。

I1はpure `planVisitIdentityTransitions(before, after)`を固定し、I6までは変更planとhookを作るが共有訪問状態のruntime migrationを成功扱いにしない。I7はnon-promotable QA artifactの全item／map／hall internal writerへ同planを接続し、durableな現在位置、保存位置、phase状態を同じ`ExpectedRootVector`で移送する。I2～I10 production writerはDB5／capability write 0とlegacy挙動を維持し、I11 release-ready productionのdurable `ready`後にだけ同じplanへ初回接続する。memory-only route cache、hover、picker候補はdurable vectorへ入れず、commit成功後だけ新signatureに従って破棄または再計算する。同一commandで複数itemが同じdestinationへ移る場合はraw実行列での元順にmember末尾へ追加する。

mapped解決だけが持つ共通の返却値:

```text
lookupCell       番号セルのcanonical parent
baseCell         1-based整数のGridCellAddress
baseNumber       先頭ゼロを除いたsafe integer
displayNumber    地図セル由来の標準売場表記
sideIdentity     whole / a / b / unsupported:<正規化済みsuffix>
locationKey      安定したSpaceIdentity
markerStackKey   同じ物理anchorの表示集約キー
bounds           0-based連続MapPoint上の半開矩形
anchor           半領域またはwhole領域のMapPoint中心
```

座標契約を混在させない。`GridCellAddress`は1-based整数の`row`／`col`、geometryの`MapPoint`は列1左端・行1上端を`(0, 0)`とする0-based連続`x`／`y`である。単一セル`(row, col)`のboundsは`[col - 1, col) × [row - 1, row)`、whole中心は`(col - 0.5, row - 0.5)`とする。`startRow..endRow`、`startCol..endCol`の結合領域は`[startCol - 1, endCol) × [startRow - 1, endRow)`へ正規化し、そのboundsをa/bへ二分する。pathfindingは`SUB_CELL_RESOLUTION = 3`の0-based整数`SubcellPathNode { subRow, subCol }`を使い、1-basedセル`(row, col)`は`subRow = (row - 1) * 3 .. row * 3 - 1`、`subCol = (col - 1) * 3 .. col * 3 - 1`を所有する。`pathNodeToMapPoint`は`x = (subCol + 0.5) / 3`、`y = (subRow + 0.5) / 3`とし、routing adapter以外で相互変換しない。client座標、アプリ倍率、地図zoom、任意回転、DPRは通常マップと集中モードで共有するviewport adapterが処理し、`projectedSideMinCssPx`と`projectedDistanceToSplitCssPx`を返す。interaction policyだけが端末判定、入力別閾値、曖昧帯を評価し、CSS px閾値やDPRをdomain geometryへ混入させない。

- `SpaceIdentity`はmapped、mapless、legacy-unresolvedを区別し、`LocationKey`はその正規化済みidentityを表す。preflight通過後の機能ON時だけ`01a`と`1a`で同じ値になる
- mappedの`locationKey`は表示文字列の連結ではなく、`["mapped-space", 1, eventInstanceId, mapInstanceId, blockInstanceId, baseNumber, sideIdentity]`のversion付きtupleをcanonical JSON化して生成する。非対応番号ではtokenを必ずtupleへ含める。maplessとlegacy-unresolvedは5.2の別tupleを使い、架空のmap／block IDを入れない
- `ExecutionVisitIdentity`はspace-navigation側で`locationKey + 優先度区分`、`PhaseVisitIdentity`は`進行区分 + ExecutionVisitIdentity`から構築する
- 表示名であるイベント名、日付表示、地図名、ブロック名を安定キーにしない
- 優先度が異なる訪問は同じ`anchor`を共有できるが、訪問IDと巡回状態は共有しない
- Canvas、位置marker、売場見出しの`displayNumber`は、split-sideでは`${baseNumber}${side}`、wholeでは`${baseNumber}`、unsupportedでは`${baseNumber}${normalizedSuffix}`とする。したがって`26c2`は`26c`、`26d`は`26d`、`26ab`は`26ab`と表示する。各アイテム行・編集欄・exportでは入力原文を維持する

### 5.2 分割設定型

既存の`DayMapData`、`CellData`、`BlockDefinition`、`NumberCellInfo`には新しいキーを追加しない。旧版の厳格な地図検証を壊さないためである。

新しい型は専用機能内で定義する。

```ts
type NormalizedDayKeyV1 = string & { readonly __brand: "NormalizedDayKeyV1" };
type NormalizedBlockTokenV1 = string & {
  readonly __brand: "NormalizedBlockTokenV1";
};
type NormalizedNumberTokenV1 = string & {
  readonly __brand: "NormalizedNumberTokenV1";
};
type LocationKey = string & { readonly __brand: "LocationKey" };
type MarkerStackKey = string & { readonly __brand: "MarkerStackKey" };
type MapLocationIndexRevision = string & {
  readonly __brand: "MapLocationIndexRevisionSha256";
};
type MapLocationIndexLookupKey = string & {
  readonly __brand: "MapLocationIndexLookupKeyV1";
};
type MapLocationPhysicalSlotKey = string & {
  readonly __brand: "MapLocationPhysicalSlotKeyV1";
};
type GridCellAddress = {
  row: number;
  col: number;
  readonly __brand: "GridCellAddress1BasedInteger";
};
type MapPoint = {
  x: number;
  y: number;
  readonly __brand: "MapPoint0BasedContinuous";
};
interface MapBoundsV1 {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type SpaceSideIdentity =
  | { kind: "whole" }
  | { kind: "split-side"; side: "a" | "b" }
  | { kind: "unsupported"; normalizedSuffix: string };

type ParsedSpaceNumber =
  | {
      kind: "split-side";
      baseNumber: number;
      sourceBaseNumberToken: string;
      side: "a" | "b";
      normalizedBranchDigits: string;
    }
  | { kind: "whole"; baseNumber: number; sourceBaseNumberToken: string }
  | {
      kind: "unsupported";
      baseNumber: number;
      sourceBaseNumberToken: string;
      normalizedSuffix: string;
      normalizedBranchDigits: string;
    }
  | {
      kind: "unresolved-number";
      normalizedNumberTokenPreservingLeadingZeros: string;
      reason:
        | "malformed-number"
        | "unsafe-base-number"
        | "non-positive-base-number";
    };

type SpaceIdentity =
  | {
      kind: "mapped";
      eventInstanceId: string;
      mapInstanceId: string;
      blockInstanceId: string;
      baseNumber: number;
      sideIdentity: SpaceSideIdentity;
    }
  | {
      kind: "mapless";
      eventInstanceId: string;
      normalizedDayKey: NormalizedDayKeyV1;
      hallIdentity:
        | { kind: "assigned"; hallId: string }
        | { kind: "unassigned" };
      normalizedBlockToken: NormalizedBlockTokenV1;
      normalizedNumberToken: NormalizedNumberTokenV1;
    }
  | {
      kind: "legacy-unresolved";
      canonicalLegacyToken: string;
    };

type LegacyResolutionReason =
  | "malformed-number"
  | "unsafe-base-number"
  | "non-positive-base-number"
  | "missing-map-location"
  | "missing-manual-hall-reference"
  | "normalization-collision";

type AmbiguousResolutionReason =
  | "multiple-map-slots"
  | "multiple-block-owners"
  | "multiple-hall-owners"
  | "duplicate-number-regions"
  | "overlapping-number-regions";

type AmbiguousSpaceCandidate =
  | Extract<SpaceIdentity, { kind: "mapped" }>
  | Extract<SpaceIdentity, { kind: "mapless" }>;

type ItemSpaceResolution =
  | {
      kind: "mapped";
      identity: Extract<SpaceIdentity, { kind: "mapped" }>;
      location: ResolvedMapLocation;
    }
  | { kind: "mapless"; identity: Extract<SpaceIdentity, { kind: "mapless" }> }
  | {
      kind: "legacy-unresolved";
      identity: Extract<SpaceIdentity, { kind: "legacy-unresolved" }>;
      originalNumber: string;
      reason: LegacyResolutionReason;
    }
  | {
      kind: "ambiguous";
      identity: Extract<SpaceIdentity, { kind: "legacy-unresolved" }>;
      originalNumber: string;
      candidates: readonly AmbiguousSpaceCandidate[];
      reason: AmbiguousResolutionReason;
    };

type MapCellSplit =
  | { direction: "left-right"; aSide: "left" | "right" }
  | { direction: "top-bottom"; aSide: "top" | "bottom" };

interface ResolvedMapLocation {
  identity: Extract<SpaceIdentity, { kind: "mapped" }>;
  locationKey: LocationKey;
  physicalSlotKey: MapLocationPhysicalSlotKey;
  markerStackKey: MarkerStackKey;
  lookupCell: GridCellAddress;
  baseCell: GridCellAddress;
  baseNumber: number;
  displayNumber: string;
  sideIdentity: SpaceSideIdentity;
  bounds: MapBoundsV1;
  anchor: MapPoint;
}

interface MapLocationIndexCellInputV1 {
  lookupCell: GridCellAddress;
  baseCell: GridCellAddress;
  rawNumberToken: string;
  blockInstanceIds: readonly string[];
  mergedBounds: MapBoundsV1 | null;
}

interface MapLocationLogicalRequestV1 {
  blockInstanceId: string;
  baseNumber: number;
  normalizedUnsupportedSuffixes: readonly string[];
}

type MapLocationLogicalSourceItemV1 =
  | {
      itemId: string;
      resolution: "mapped-to-target-map";
      blockInstanceId: string;
      parsedNumber:
        | { kind: "whole"; baseNumber: number }
        | { kind: "split-side"; baseNumber: number; side: "a" | "b" }
        | {
            kind: "unsupported";
            baseNumber: number;
            normalizedSuffix: string;
          };
    }
  | {
      itemId: string;
      resolution:
        | "mapped-to-other-map"
        | "mapless"
        | "legacy-unresolved"
        | "no-map-association";
    };

interface LogicalLocationSourceSnapshotV1 {
  schemaVersion: 1;
  eventInstanceId: string;
  targetMapInstanceId: string;
  itemRootRevision: ProjectionInputRootRevisionV1;
  associationRootRevision: ProjectionInputRootRevisionV1;
  eventItemIds: readonly string[];
  items: readonly MapLocationLogicalSourceItemV1[];
  itemSetDigest: string;
  snapshotDigest: string;
}

// `eventItemIds`は重複なしのECMAScript UTF-16 code-unit順、`items`も同じ比較による`itemId`順とし、両配列のIDは同じindexで一致するexact bijectionでなければならない。source item／association入力のshuffleでも両配列、`itemSetDigest`、`snapshotDigest`、index revision、論理location集合をbyte同値にする。BMP／astral文字を混在させたopaque item IDの全shuffleをgoldenにし、Unicode code point順やlocale順への差替えを拒否する。

interface MapLocationIndexSplitInputV1 {
  blockInstanceId: string;
  baseNumber: number;
  split: MapCellSplit;
}

interface MapLocationIndexBuildInputV1 {
  schemaVersion: 1;
  eventInstanceId: string;
  mapInstanceId: string;
  mapStructureFingerprint: string;
  mapRootRevision: ProjectionInputRootRevisionV1;
  splitRootRevision: ProjectionInputRootRevisionV1;
  cells: readonly MapLocationIndexCellInputV1[];
  activeSplits: readonly MapLocationIndexSplitInputV1[];
  logicalLocationSourceSnapshot: Readonly<LogicalLocationSourceSnapshotV1>;
}

interface MapLocationGeometrySlotV1 {
  physicalSlotKey: MapLocationPhysicalSlotKey;
  eventInstanceId: string;
  mapInstanceId: string;
  blockInstanceId: string;
  lookupCells: readonly [GridCellAddress, ...GridCellAddress[]];
  baseCell: GridCellAddress;
  baseNumber: number;
  displayNumber: string;
  wholeBounds: MapBoundsV1;
  wholeAnchor: MapPoint;
}

type MapLocationExclusionReason =
  | "duplicate-number-region"
  | "multiple-block-owners"
  | "overlapping-number-regions"
  | "merge-crosses-block";

interface MapLocationExclusionV1 {
  exclusionKey: string;
  reasons: readonly [
    MapLocationExclusionReason,
    ...MapLocationExclusionReason[],
  ];
  affectedRegionKeys: readonly [
    MapLocationIndexLookupKey,
    ...MapLocationIndexLookupKey[],
  ];
  blockInstanceIds: readonly string[];
  baseNumbers: readonly number[];
  lookupCells: readonly [GridCellAddress, ...GridCellAddress[]];
}

interface MapLocationIndex<
  TExclusions extends readonly MapLocationExclusionV1[] =
    readonly MapLocationExclusionV1[],
> {
  schemaVersion: 1;
  eventInstanceId: string;
  mapInstanceId: string;
  inputRevision: MapLocationIndexRevision;
  physicalSlots: readonly MapLocationGeometrySlotV1[];
  locations: readonly ResolvedMapLocation[];
  exclusions: TExclusions;
  byPhysicalSlotKey: ReadonlyMap<
    MapLocationPhysicalSlotKey,
    MapLocationGeometrySlotV1
  >;
  byLocationKey: ReadonlyMap<LocationKey, ResolvedMapLocation>;
  byBlockNumberKey: ReadonlyMap<
    MapLocationIndexLookupKey,
    MapLocationGeometrySlotV1
  >;
  byLookupCellKey: ReadonlyMap<
    MapLocationIndexLookupKey,
    MapLocationGeometrySlotV1
  >;
}

type BuildMapLocationIndexResult =
  | { kind: "ready"; index: MapLocationIndex<readonly []> }
  | {
      kind: "ready-with-exclusions";
      index: MapLocationIndex<
        readonly [MapLocationExclusionV1, ...MapLocationExclusionV1[]]
      >;
    }
  | {
      kind: "map-data-untrusted";
      index: null;
      reasons: readonly ["duplicate-physical-cell"];
      duplicateLookupCells: readonly [GridCellAddress, ...GridCellAddress[]];
    };

interface SplitBindingEvidenceV1 {
  algorithmVersion: 1;
  blockFingerprint: string;
  locationFingerprint: string;
}

interface ActiveMapCellSplitEntry {
  entryId: string;
  blockInstanceId: string;
  lastKnownBlockName: string;
  number: number;
  split: MapCellSplit;
  bindingEvidenceAtLastActive: SplitBindingEvidenceV1;
  status: "active";
}

interface RetainedMapCellSplitEntryBase {
  dormantEntryId: string;
  lastKnownEventName: string;
  lastKnownDayKey: string;
  lastKnownMapName?: string;
  lastKnownBlockName: string;
  split: MapCellSplit;
  priorOwner?:
    | { mapInstanceId: string; blockInstanceId?: never }
    | { mapInstanceId: string; blockInstanceId: string };
}

type RetainedNumberIdentity =
  | { number: number; originalNumberToken?: string }
  | { number?: never; originalNumberToken: string };

type LastActiveEvidence = {
  evidenceOrigin: "last-active";
  evidenceAtLastActive: SplitBindingEvidenceV1 & {
    diagnosticMapStructureFingerprint?: string;
  };
};

type NeverActivePortableEvidence = {
  evidenceOrigin: "portable-never-active";
  evidenceAtLastActive?: never;
};

type DormantReason =
  | "map-missing"
  | "anchor-missing-after-legacy-operation"
  | "legacy-full-restore-without-split-settings"
  | "no-unique-match"
  | "event-deleted"
  | "portable-unresolved-reference"
  | "manual-unlink";

type QuarantinedReason =
  | "invalid-value"
  | "ambiguous-match"
  | "duplicate-number"
  | "duplicate-block-ownership"
  | "overlapping-number-regions"
  | "merge-crosses-block"
  | "fingerprint-contradiction"
  | "association-duplicate"
  | "invalid-retention-window"
  | "normalization-collision"
  | "normalized-block-name-collision"
  | "duplicate-physical-cell"
  | "map-data-untrusted";

type RetainedMapCellSplitEntry = RetainedMapCellSplitEntryBase &
  RetainedNumberIdentity &
  (
    | ({
        status: "dormant";
        statusReason: Exclude<DormantReason, "portable-unresolved-reference">;
      } & LastActiveEvidence)
    | ({
        status: "dormant";
        statusReason: "portable-unresolved-reference";
      } & (LastActiveEvidence | NeverActivePortableEvidence))
    | ({
        status: "quarantined";
        statusReason: QuarantinedReason;
      } & LastActiveEvidence)
  );

interface MapSplitBinding {
  mapInstanceId: string;
  lastKnownDayKey: string;
  lastKnownMapName?: string;
  mapStructureFingerprint: string;
  entries: ActiveMapCellSplitEntry[];
}

interface SplitIdentityAnchorV1 {
  schemaVersion: 1;
  token: string;
}

interface MapCellSplitAssociationRegistry {
  eventAssociations: Array<{
    currentEventKey?: string;
    eventInstanceId: string;
    anchorToken: string;
  }>;
  mapAssociations: Array<{
    eventInstanceId: string;
    currentDayMapSlotKey?: string;
    mapInstanceId: string;
  }>;
  blockAssociations: Array<{
    mapInstanceId: string;
    currentBlockSlotKey?: string;
    blockInstanceId: string;
  }>;
}

type RetentionClockState =
  | { kind: "trusted" }
  | {
      kind: "confirmation-required";
      reason:
        | "clock-rollback"
        | "large-unobserved-forward-jump"
        | "in-session-jump";
      stableSince: string;
      confirmationNotBefore: string;
    };

interface EventDeletionRetentionV1 {
  reason: "event-deleted";
  dormantSince: string;
  purgeAfter: string;
  lastObservedWallClock: string;
  clockState: RetentionClockState;
}

interface EventMapCellSplitSettings {
  eventInstanceId: string;
  lastKnownEventName: string;
  maps: MapSplitBinding[];
  retainedEntries: RetainedMapCellSplitEntry[];
  deletionRetention?: EventDeletionRetentionV1;
}

interface MapCellSplitSettingsRoot {
  schemaVersion: 1;
  associations: MapCellSplitAssociationRegistry;
  events: EventMapCellSplitSettings[];
}

interface MapCellSplitControlRoot {
  schemaVersion: 1;
  deviceEnabled: boolean;
  forceSplitPicker: boolean;
  enabledEventInstanceIds: string[];
}

type SplitImplementationReadiness =
  | "contracts-only"
  | "internal-testing"
  | "release-ready";
```

`buildMapLocationIndexV1`は最初に物理cell重複を全mapで検査し、1件でもあれば他の診断を局所除外へ偽装せず`map-data-untrusted`だけを返す。物理cellが一意なら、番号region／owner／overlap／merge関係を配列順に依存しないconnected componentへ正規化し、各不正componentをexact 1 `MapLocationExclusionV1`、残りを`MapLocationGeometrySlotV1`へ写す。各componentの`reasons`は該当する全原因を`duplicate-number-region → multiple-block-owners → overlapping-number-regions → merge-crosses-block`の固定enum順で重複なく保持し、先頭reasonや走査順で1件へ縮退させない。exclusion keyは全reasonsとregion／block／number／lookup cellを拘束し、各配列はcanonical順・重複なし、同じ不正入力とreason発見順のshuffleでbyte同値にする。exclusion 0件だけが`ready`、1件以上は同じindexとbyte一致するnonempty exclusionsを持つ`ready-with-exclusions`である。影響外の`resolveItemMapLocation`、hit-test、list、描画、訪問projection、routeは継続し、除外領域へ解決し得るitemだけをambiguous／unroutable診断へ送る。

`collectLogicalLocationSourceSnapshotV1`は対象eventの全item rootと全map associationを同じread boundaryで読み、`eventItemIds`と`items`をexact bijectionにした`LogicalLocationSourceSnapshotV1`を作る唯一のconstructorである。`mapped-to-target-map`だけがblock／parsed numberを持ち、other-map／mapless／legacy-unresolved／associationなしは明示ignored branchとしてsnapshot completenessへ残す。`eventItemIds`は重複なしの3.3と同じECMAScript UTF-16 code-unit順とし、`itemSetDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-logical-location-item-set-v1", eventInstanceId, eventItemIds })))`、`snapshotDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-logical-location-source-snapshot-v1", snapshotWithoutSnapshotDigest })))`のliteral式で自身以外の全fieldを拘束する。builder callerがpartial item列、独自filter、suffix配列を渡すedgeをarchitecture testで0件にする。

`deriveMapLocationLogicalRequestsV1(sourceSnapshot)`はevent item ID順にtotal走査し、target mapのunsupported分岐だけを`(blockInstanceId, baseNumber)`ごとのcanonical suffix集合へ集約する。source item／`eventItemIds`の欠落・余分・重複、event／map不一致、digest差、mapped targetのblock解決不能、非canonical parser結果、`a | b`をunsupported suffixへ混入した入力はindex 0件のtyped rejectとする。mapless／legacy-unresolved／other-mapをtarget map errorにせず、明示ignored branchとして同じdigestへ保持する。index revisionはitem root revision、association root revision、snapshot digestを全て含む。

`deriveLogicalMapLocationsV1(slot, split, normalizedUnsupportedSuffixes)`は全slotでwholeを必ず生成し、splitありの場合だけa／bを追加し、その後にcanonical unsupported suffixごとのlocationを加える。したがってsplit済み物理slotでも`26`、`26a`、`26b`、`26c`、`26d`、`26ab`は相異なる論理`LocationKey`になり、whole／unsupportedは同じ`wholeBounds`／`wholeAnchor`を共有する。`byBlockNumberKey`／`byLookupCellKey`は論理location配列ではなく一意な物理slotを返し、`byLocationKey`だけが可変個数の論理locationを扱う。index revisionはmap、split、logical-location source item、associationの各revisionと導出済み論理location集合を拘束する。

分割なしはentryを保存しない。非対応番号は分割entryにはならないが、`SpaceSideIdentity`のtokenを含む別の空間・訪問identityとして扱う。maplessは既存の`MAPLESS_HALL_KEY`、日程、一意に解決したhall ID（manual指定または既存hall resolver）もしくは未割当て、block、番号のcanonical tokenから構成し、mapped用の架空IDを発行しない。legacy-unresolvedの`SpaceIdentity`は`canonicalLegacyToken`だけをidentity payloadに持ち、原文と`LegacyResolutionReason`／`AmbiguousResolutionReason`は`ItemSpaceResolution`の表示・診断payloadで維持する。reasonや原文の違いだけで同じ`LocationKey`に複数のstructural identityを作らず、mappedまたはmaplessへ推測変換しない。ただし`missing-manual-hall-reference`では、異なるdangling manual hallを統合しないためvalidated opaque `manualHallId`をowner evidenceとしてcanonical keyへ含める。`canonicalLegacyToken`は`esp-json-v1`で直列化した`["legacy-space-token", 1, eventInstanceId, normalizedDayKey, ["block", normalizedBlockToken] | ["block-missing"] | ["dangling-manual-hall", manualHallId, normalizedBlockToken], ["number", normalizedNumberTokenPreservingLeadingZeros]]`とする。番号tokenはNFKC、Unicode空白除去、ASCII小文字化後も先頭ゼロを維持し、表示原文とhall表示名はcanonical keyへ直接入れない。別blockまたは別dangling `manualHallId`の同じ不正番号を統合せず、`ambiguous`でも候補を選ばずこのlegacy identityを共有訪問projectionへ残す。各unionはそれぞれ`["mapped-space", 1, ...]`、`["mapless-space", 1, ...]`、`["legacy-space", 1, canonicalLegacyToken]`のcanonical JSON tupleから`LocationKey`を生成し、`SpaceIdentity`と`LocationKey`を一対一にする。

`normalizeFsmcDayKeyV1`はNFKC後にUnicode `White_Space`の連続をU+0020へ畳み、前後U+0020を除去するがcase foldせず、空結果を拒否する。`normalizeFsmcBlockTokenV1`は同じ空白処理後にASCII `A-Z`だけを小文字化し、locale依存case foldを使わず、空結果を拒否する。`normalizeFsmcNumberTokenV1`は3.1のparser前処理そのもので、NFKC、全Unicode空白除去、ASCII小文字化を行い、先頭ゼロはparser分岐が明示的に除去するまで維持する。欠損値を空文字、`undefined`文字列、表示名で代用せず、tupleの`["day-missing"]`、`["block-missing"]`等のtagged branchで表す。現行`normalizeExecutionVisitDay`、`normalizeSpaceBlock`、`normalizeBlockName`の相違はI1 adapterでこの3関数へ集約し、旧関数をcanonical authorityとして混在させない。

identity、fingerprint、projection revisionのtupleはlength-prefix付きUTF-8 `esp-json-v1` canonical bytesでhashし、区切り文字連結、`JSON.stringify(Map)`、object挿入順、locale sortを使わない。`ReadonlyMap`はkeyをcanonical UTF-16 code-unit比較でsortした`[[key, value], ...]`へ、`ReadonlySet`はsort済み配列へ変換する。day／block／numberの全角、空白、ASCII大小文字、leading zero、missing、mapless、dangling hallと、同値Mapの挿入順shuffleをI0 goldenへ固定する。

イベント、地図、ブロック、active entry、retained entry、anchor tokenのローカルopaque IDは、小文字canonical UUIDv4を`crypto.randomUUID()`で発行する。発行transaction内の全namespaceと既存rootを照合し、衝突時は最大3回まで再発行し、3回とも衝突またはAPI利用不能なら操作全体をabortする。バックアップ内の外部IDを採用せず、表示名は診断と手動再関連付けだけに使う。canonical配列順は`a === b ? 0 : a < b ? -1 : 1`というECMAScript UTF-16 code-unit比較に固定し、`localeCompare`、OS locale、大小文字の暗黙変換を使わない。

activeと保持中entryの型を分け、activeだけが現在の`mapInstanceId`／`blockInstanceId`を必須参照できる。retained entryは`number`または`originalNumberToken`の少なくとも一方を必須とし、`blockInstanceId`があれば親`mapInstanceId`も必須とする。最後にactiveだったentryは`evidenceOrigin: "last-active"`とevidenceを必須にし、evidenceを持たずportable fileから初めて保持したentryは`portable-unresolved-reference`かつ`evidenceOrigin: "portable-never-active"`に限定する。portable fileから未解決entryを取り込む場合は、新しいローカル`dormantEntryId`を発行して`retainedEntries`へ置き、外部refをruntime必須ID欄へ代入しない。map全体の現在authorityは`MapSplitBinding.mapStructureFingerprint`だけとし、active entryはblock／location evidenceだけを持つ。保持entryの旧map fingerprintは診断・preview用であり、自動再接続のauthorityにしない。地図の無関係なblock変更ではmap-level fingerprintと該当map bindingを更新する一方、block／location evidenceが一致する他entryはactiveのまま維持する。

`RetainedNumberIdentity`で`number`と`originalNumberToken`を両方持つ場合、I0のexact番号parserでtokenが`split-side | whole | unsupported`のいずれかへ解決し、その`baseNumber`が`number`と一致することをsemantic invariantにする。先頭ゼロやsuffixの原文は一致時だけ保持できる。不一致またはtokenがunresolvedなのに`number`もあるruntime entryは、`evidenceOrigin: "last-active"`なら`invalid-value`としてquarantinedにして再関連付け候補へ使わない。`portable-never-active`にはlast-active evidenceを捏造してquarantinedへ変換せず、root-untrusted安全モードとBackup復旧案内にする。V2入力はどちらもDB更新前にfile全体を拒否する。`originalNumberToken`だけのentryは未解決のまま保持し、数値を推測しない。

端末全体とevent別ON／OFF、および端末全体の`forceSplitPicker`はsettings payloadから分離し、同じcapability storeのキー`control`に`MapCellSplitControlRoot`として保存する。factory defaultは`deviceEnabled = false`、`forceSplitPicker = false`、enabled event 0件とする。`enabledEventInstanceIds`は重複なしで上記canonical比較順とし、未掲載eventはOFFとする。event削除時は同じcommitでIDを除去するが、device preferenceである`forceSplitPicker`は維持する。control rootがuntrusted／未読の場合、split mutationは既存規則どおり停止し、表示済みsplitへのselection policyだけは`forceSplitPicker = true`相当へ倒す。Backup V1／V2へcontrol rootを含めない。`setForceSplitPickerAtomically`はhealthy capabilityでdevice／event OFF中にも利用でき、最新control revisionを再検証してtoggleだけを変更する。`SplitImplementationReadiness`はbuild sourceに固定する静的gateであり、永続化、外部service、利用者設定から変更できない。I11最終release candidate PRだけがsource固定値をbuild前に`release-ready`へ変更し、その同一production artifactで全Exitを検証する。gate成功までは配布不能で、verifierがreadinessを実行後に書き換えることも、検証済みsourceから別artifactを作り直すことも禁止する。QA buildだけが明示的なtest overrideを持て、production bundleにoverride command、query parameter、storage keyを含めない。

entryの保存・コピー・再関連付け・再取込時に、対象ブロック内の正規化番号が一意であることを検証する。行・列は地図指紋と再取込照合の証拠には含めるが、利用者が選択して保存する識別子にはしない。同一ブロック内の重複番号へentryを新規保存せず、同じ地図内の一意な他番号は処理を継続する。

`active`は現在の地図と安全に結び付いたentry、`dormant`は地図欠落・旧版操作・旧形式完全復元・一致なし等で未接続のentry、`quarantined`は不正値・曖昧一致・物理領域競合・指紋矛盾等のentryを表す。statusはentry単位で保持し、同じ地図内で安全に一致したentryだけをactiveにできる。dormant／quarantinedは地図に描画せず、I5の管理UIで理由、last-known情報、preview付き再関連付け、明示削除を提供する。`PD-09`のイベント削除retentionを除いて時間経過だけで自動削除しない。

active entryでは`bindingEvidenceAtLastActive`のblock／location evidenceが現在の物理番号領域と一致し、`statusReason`は存在しない。dormant／quarantined entryでは最後にactiveだったevidenceを維持し、FSMC-I0 ADRで固定したallowlistの`statusReason`を必須とする。唯一の例外は一度もactiveでない`portable-unresolved-reference`で、`portable-never-active`としてevidenceなしを明示する。地図再取込または通常編集で安全に一意継承できたentryだけ、単一commit内でevidenceを更新する。無関係な別ブロックの変更によるmap fingerprint差だけで全entryを非active化しない。

association registryは、現行のイベントkey、日程内のmap slot、map内のblock slotと各opaque instance IDを結び、再読込後の現在データを解決する。current key／slotは既存データを参照するsidecar内部キーであり、表示名を所有者判定へ使用しない。イベント・地図・ブロックの作成、改名、移動、削除、複製、再取込と同じtransactionでregistryを更新し、参照先不在や多重対応は該当entryをdormant／quarantinedにして自動修復しない。

settings／association配列は上記canonical比較順で保存する。sort keyはevent associationとevent settingsが`[eventInstanceId]`、map associationとmap bindingが`[eventInstanceId, mapInstanceId]`、block associationが`[mapInstanceId, blockInstanceId]`、active entryが`[mapInstanceId, blockInstanceId, number, entryId]`、retained entryが`[dormantEntryId]`、enabled IDが`[eventInstanceId]`とし、tuple要素を左から比較する。sort用`entryId`は同owner tupleの重複を許可するtie-breakerではない。同じevent内のactive `(mapInstanceId, blockInstanceId, number)`はexact 1件を必須とし、directionやentry IDが異なっても重複違反とする。event／map／block／active entry／retained entryのprimary ID、同一`eventInstanceId`のsettings、registry内の親子refをschema不変条件とする。primary ID重複、同一event settings複数、active owner tuple重複、親不在、active entryの親不整合、配列重複・非canonical順はroot-untrustedとして当該capability root全体を自動安全モードにし、読込時に並べ替え・片方採用・自動修復しない。このsemantic validatorをstartup、全mutation after-image、reimport、restore、duplicate、V2 read／writeで共用し、wireだけ厳格またはruntimeだけ寛容な分岐を作らない。一方、root構造とIDは正常だがcore側のanchor、event key、map slot、block slotが0件または複数候補へ解決する場合は、影響するassociation classとそのentryだけをdormant／quarantinedにし、無関係なeventを止めない。control rootの重複enabled IDまたは未知IDもcontrol-untrustedとしてsplit commandを拒否し、core機能は継続する。

同じeventのactive `(mapInstanceId, blockInstanceId, number)`と、同じ`priorOwner`＋`number`を持つretained entryのoverlapもruntime semantic invariant違反とする。通常設定・copy・importは作成前に全拒否し、明示的な再関連付けだけが元retainedを除去してactiveへ一段で状態遷移できる。保存済みrootにoverlapがある場合は片方を採用せずroot-untrusted安全モードとBackup復旧案内にし、V2 exportを成功扱いにしない。V2 inputはpreview前にfile全体を拒否する。`priorOwner`なしまたはtoken-onlyで番号未解決のretainedを名前や原文だけでoverlap判定・自動接続しない。

active entryへ至るevent／map／block associationでは`currentEventKey`、`currentDayMapSlotKey`、`currentBlockSlotKey`をすべて非空かつ一意解決可能とする。dormant／quarantinedでは欠落したslotを未設定にできるが、架空slotや表示名で補完しない。

root payload内に独自の数値revisionを持たせない。CAS authorityは現行のstore別metadataが持つopaqueな文字列revision、baseRevision、checkpointとし、複合commandは参加storeすべての期待rootを`ExpectedRootVector`として保持する。分割設定rootもこのvectorへ参加させ、単一の架空rootへ置き換えない。

### 5.3 地図指紋とentry binding evidence

分割設定を誤った地図へ適用しないため、現在map全体のauthorityである`MapSplitBinding.mapStructureFingerprint`と、active entryごとの`blockFingerprint`／`locationFingerprint`を分けて保存する。同じ現在map fingerprintを各entryへ重複保存しない。

指紋へ含めるもの:

- 正規化したブロック名
- 正規化し先頭ゼロを除いた番号
- 番号セルの行・列
- 結合セル範囲
- 地図の行列数とブロック形状
- canonical化した`cellGroups`の占有mask、番号セルのcanonical parent、物理番号領域の所有関係

含めないもの:

- 背景色
- フォント色
- 回転角度
- 画面のズーム・移動量

canonical field、安定sort、文字列正規化、algorithm version、SHA-256入出力をFSMC-I0 ADRとgolden fixtureで固定する。配列順だけでは指紋を変えない。

`mapStructureFingerprint`は設定の所有・再関連付け用であり、経路cache authorityには使わない。別にversion付き`pathfindingGraphFingerprint`を設け、I0では現行`buildDayMapPathfindingSignature`／`isPassableCellData`と一致する`["pathfinding-graph", 1, maxRow, maxCol, canonicalCells, canonicalMergedRegions, algorithmAndCostConstants]`を固定する。`canonicalCells`は重複`(row, col)`がないことを前提に、row、col、`["undefined" | "null" | "string" | "number", value]`、`backgroundColor ?? null`をrow／col順で含める。現行v1では`backgroundColor`がtruthyかつ完全一致`"#FFFFFF"`以外なら通行不可なので、空文字、`#fff`、大小文字差を推測正規化せず、背景色だけの変更でも通行可否または保守的cache fingerprintを変える。`canonicalMergedRegions`はrouting port／connector領域へ影響する結合範囲と占有mask、`algorithmAndCostConstants`は3×3解像度、passability rule version、overlap／buffer／turn cost、探索algorithm versionを含む。font色、回転、zoom、pan、DPRは含めない。重複物理セルはfingerprintを生成せず3.3の安全境界へ送る。

指紋が一致しない場合、イベント名、日付、マップ名、ブロック名だけで自動接続しない。地図再取込と通常編集の継承previewを通して再対応付けし、確定時だけ既存のmap／block instance IDを引き継ぐ。map-level fingerprintは現在mapの構造変更ごとに更新する。各entryは同じplan内で現在block／location evidenceを再計算し、一致する無関係entryをactiveのまま維持し、影響entryだけを更新・dormant・quarantinedへ移す。map fingerprint差だけで全entryを一括失効させない。改名・位置移動だけでinstance IDと正規化番号が維持され、一意に再解決できるentryはactiveのまま新しいevidenceへ更新する。番号欠落はdormant、重複・領域競合・結合矛盾はquarantinedとする。色・回転・zoomだけの変更ではstatusを変更しない。bounds／anchorまたは通行可否へ影響する地図内容が変化した場合は経路cacheを破棄し、正式現在位置はitem ID anchorから同じ`PhaseVisitIdentity`へ再解決する。新しいevent／map／block実体を複製作成する場合だけ新しいinstance IDを発行する。初版では既存の別日程・別地図・別ブロックへ設定をコピーしない。

### 5.4 経路・訪問ドメイン

- reorder commandの`readOnlyExpectedRoots`はfull `ExpectedStoreRoot`を保つ`expectedRootVector`のうち両witnessが実際に読んだrootとのcanonical exact subsetとする。構造の異なるfull rowをflattened revisionへ直接byte比較せず、各rowへpure `toProjectionInputRootRevisionV1`を適用したcanonical projection集合を、`rootRevisions`／`rootRevision`の同一root集合とexact bijectionかつbyte一致させる。`rawExecutionItemWitness.storeName`は実在authority名`executeModeItems`、`orderedItemIds`はraw membershipとのexact bijection、item／association witnessの2配列は同じsnapshotの全入力とのexact bijectionかつcanonical key順とし、resultがfull read-only rootsと両witnessをbyte同値で返す。item rowの`canonicalPayloadBytes`は同じ`VisitIdentityInputSnapshot.items`行から`itemId`を除いたexact `ExecutionVisitOrderItemInputPayloadV1`を`UTF8(esp-json-v1(payload))`へしたbytes、association rowはmap association／hall definition／hall association／hall remap／split settingsのexact identity DTOをkind付きunion `ExecutionVisitOrderAssociationInputPayloadV1`へ写して同様にserializeしたbytesとする。item `payloadDigest`はexact `{ domain: "fsmc-execution-visit-order-item-input-v1", itemId, canonicalPayloadBytes }`、association `payloadDigest`はexact `{ domain: "fsmc-execution-visit-order-association-input-v1", associationKind, associationKey, canonicalPayloadBytes }`を`esp-json-v1`でcanonical serializeしたUTF-8 bytesのlowercase 64桁SHA-256とする。`membershipDigest`はexact `{ domain: "fsmc-execution-visit-order-item-membership-v1", storeName, rootRevision, orderedItemIds }`、`witnessDigest`はexact `{ domain: "fsmc-execution-visit-order-item-association-witness-v1", rootRevisions, items, associations }`を同様にhashし、自身を入力へ含めない。preview作成時とcommit直前にfresh snapshotから全payload bytes／row digest／outer digestを再構築し、bytesまたはdigestだけの自己申告を採用しない。`ExecutionVisitOrderPreviewDigest`はexact `{ domain: "fsmc-execution-visit-order-preview-v1", command: { commandId, intentKind, eventInstanceId, normalizedDayKey, projectionRevision, beforeExecutionVisitOrder, afterExecutionVisitOrder, expectedRootVector, readOnlyExpectedRoots, rawExecutionItemWitness, itemAndAssociationWitness, hallRouteSettingsAfterImage } }`を同様にhashし、byte payloadは同serializerのlossless byte tagを使う。resultはcommandの`readOnlyExpectedRoots`、両witness、preview digestをbyte同値でechoし、全projection／digest再計算後だけ成功できる。full subsetまたはprojectionの余分／欠落／変換差、item／associationの余分、欠落、別snapshot、架空store名、各witnessのroot／payload／order／digest-only差、item／association domain swap、preview projection各field単独差、別command／hall after-imageのdigest replayを拒否する

経路の論理単位は商品や行・列ではなく共有projectionが返す`PhaseVisitIdentity`とする。

```ts
type ExecutionVisitIdentityKey = string & {
  readonly __brand: "ExecutionVisitIdentityKey";
};
type PhaseVisitIdentityKey = string & {
  readonly __brand: "PhaseVisitIdentityKey";
};
type VisitPhase = "normal" | "postponed" | "late";
type AdditionalVisitPhase = Exclude<VisitPhase, "normal">;
type VisitPriorityLevel = "none" | "priority" | "highest";
type SubcellPathNode = {
  subRow: number;
  subCol: number;
  readonly __brand: "SubcellPathNode0BasedInteger";
};
interface RoutingPort {
  node: SubcellPathNode;
  point: MapPoint;
}

type RoutePathConstraintFingerprint = string & {
  readonly __brand: "RoutePathConstraintFingerprintSha256";
};

type RoutePolygonFingerprint = string & {
  readonly __brand: "RoutePolygonFingerprintSha256";
};

type RoutePathConstraintV1 =
  | {
      kind: "whole-map";
      eventInstanceId: string;
      mapInstanceId: string;
      constraintFingerprint: RoutePathConstraintFingerprint;
    }
  | {
      kind: "selected-hall-polygon";
      eventInstanceId: string;
      mapInstanceId: string;
      hallId: string;
      hallDefinitionRevision: ProjectionInputRootRevisionV1;
      polygon: readonly [MapPoint, MapPoint, MapPoint, MapPoint, ...MapPoint[]];
      polygonFingerprint: RoutePolygonFingerprint;
      boundaryRule: "inclusive-v1";
      constraintFingerprint: RoutePathConstraintFingerprint;
    };

interface ExecutionVisitIdentity {
  locationKey: LocationKey;
  priorityLevel: VisitPriorityLevel;
}

interface PhaseVisitIdentity {
  phase: VisitPhase;
  executionVisitIdentity: ExecutionVisitIdentity;
}

type VisitIdentityInputRevision = string & {
  readonly __brand: "VisitIdentityInputRevisionSha256";
};

interface ProjectionDigestDescriptorV1 {
  algorithm: "SHA-256";
  canonicalization: "esp-json-v1";
  value: string;
}

type ProjectionCheckpointDigestV1 =
  | { kind: "absent" }
  | { kind: "present"; digest: ProjectionDigestDescriptorV1 };

interface ProjectionInputRootRevisionV1 {
  storeName: string;
  key: string;
  payloadDigest: ProjectionDigestDescriptorV1;
  metadataRevision: string;
  checkpointDigest: ProjectionCheckpointDigestV1;
}

interface ProjectionInputRevisionVectorV1 {
  schemaVersion: 1;
  rootRevisions: readonly ProjectionInputRootRevisionV1[];
  uncommittedAfterImageDigest: ProjectionDigestDescriptorV1 | null;
}

interface MapAssociationIdentityInputV1 {
  eventInstanceId: string;
  normalizedDayKey: NormalizedDayKeyV1;
  mapInstanceId: string;
  mapStructureFingerprint: string;
  mapLocationIndexRevision: MapLocationIndexRevision;
  blocks: readonly Readonly<{
    blockInstanceId: string;
    normalizedBlockToken: NormalizedBlockTokenV1;
  }>[];
}

interface HallDefinitionIdentityInputV1 {
  eventInstanceId: string;
  hallId: string;
}

interface HallAssociationIdentityInputV1 {
  eventInstanceId: string;
  normalizedDayKey: NormalizedDayKeyV1;
  normalizedBlockToken: NormalizedBlockTokenV1;
  hallId: string;
}

interface HallRemapIdentityInputV1 {
  eventInstanceId: string;
  fromHallId: string;
  toHallId: string | null;
}

interface MapCellSplitSettingsIdentityInputV1 {
  eventInstanceId: string;
  maps: readonly Readonly<{
    mapInstanceId: string;
    mapStructureFingerprint: string;
    entries: readonly Readonly<{
      blockInstanceId: string;
      number: number;
      split: MapCellSplit;
    }>[];
  }>[];
}

interface DurablePhaseAnchorV1 {
  phase: VisitPhase;
  anchorItemId: string | null;
}

interface DurableVisitStateEntryV1 {
  eventInstanceId: string;
  normalizedDayKey: NormalizedDayKeyV1;
  executionVisitOrder: readonly ExecutionVisitIdentityKey[];
  current: DurablePhaseAnchorV1;
  savedAnchorItemIdByPhase: Readonly<{
    normal: string | null;
    postponed: string | null;
    late: string | null;
  }>;
  additionalPhaseByItemId: readonly (readonly [
    string,
    AdditionalVisitPhase | null,
  ])[];
  isCompleted: boolean;
  lastPurchaseChangeAt: { phase: VisitPhase; anchorItemId: string } | null;
}

interface LegacyFocusSessionScopeV1 {
  eventInstanceId: string;
  normalizedDayKey: NormalizedDayKeyV1;
}

interface LegacyFocusSessionScopeCandidateV1 extends LegacyFocusSessionScopeV1 {
  legacySessionKey: string;
  eventName: string;
  rawDayKey: string;
}

interface LegacyFocusSessionMappingInputV1 {
  authorityRevisionDigest: string;
  expectedScopes: readonly LegacyFocusSessionScopeV1[];
  candidates: readonly LegacyFocusSessionScopeCandidateV1[];
  mappingInputDigest: string;
}

interface LegacyFocusDayTupleV1 {
  eventName: string;
  rawDayKey: string;
  normalizedDayKey: NormalizedDayKeyV1;
}

interface LegacyFocusDayScopeCollisionV1 {
  eventName: string;
  normalizedDayKey: NormalizedDayKeyV1;
  rawDayKeys: readonly [string, string, ...string[]];
}

interface LegacyFocusDayScopeCollisionWitnessV1 {
  kind: "legacy-focus-day-scope-collision";
  authorityRevisionDigest: string;
  collisions: readonly [
    LegacyFocusDayScopeCollisionV1,
    ...LegacyFocusDayScopeCollisionV1[],
  ];
  collisionWitnessDigest: string;
}

type LegacyFocusDayScopePreflightV1 =
  | {
      kind: "collision-free";
      authorityRevisionDigest: string;
      dayTuples: readonly LegacyFocusDayTupleV1[];
      preflightDigest: string;
    }
  | LegacyFocusDayScopeCollisionWitnessV1;

interface EventAuthorityProposalEntryV1 {
  eventName: string;
  eventInstanceId: string;
  coreAnchorToken: string;
}

interface ResolvedEventAuthorityEntryV1 {
  eventName: string;
  eventInstanceId: string;
  coreAnchorToken: string;
}

type EventAuthorityRejectionReasonV1 =
  | "association-missing"
  | "association-extra"
  | "anchor-missing"
  | "anchor-invalid"
  | "anchor-token-mismatch"
  | "anchor-token-duplicate";

declare const canonicalEventAuthorityReasonsBrandV1: unique symbol;

type CanonicalNonEmptyEventAuthorityRejectionReasonsV1<
  Allowed extends EventAuthorityRejectionReasonV1 =
    EventAuthorityRejectionReasonV1,
> = readonly [Allowed, ...Allowed[]] & {
  readonly [canonicalEventAuthorityReasonsBrandV1]: true;
};

interface EventAuthorityRejectionV1 {
  eventName: string;
  reasons: CanonicalNonEmptyEventAuthorityRejectionReasonsV1;
  witnessDigest: string;
}

type EventAuthorityProposalBlockerReasonV1 =
  | "anchor-invalid"
  | "anchor-token-duplicate";

type BootstrapEventAuthorityRejectionReasonsV1 =
  | (readonly ["anchor-invalid"] & {
      readonly [canonicalEventAuthorityReasonsBrandV1]: true;
    })
  | (readonly ["anchor-token-duplicate"] & {
      readonly [canonicalEventAuthorityReasonsBrandV1]: true;
    });

type BootstrapEventAuthorityRejectionV1 = Omit<
  EventAuthorityRejectionV1,
  "reasons"
> & {
  reasons: BootstrapEventAuthorityRejectionReasonsV1;
};

interface ResolvedEventAuthorityV1 {
  entries: readonly ResolvedEventAuthorityEntryV1[];
  rejectedEvents: readonly EventAuthorityRejectionV1[];
  authorityDigest: string;
}

type BootstrapResolvedEventAuthorityV1 = Omit<
  ResolvedEventAuthorityV1,
  "rejectedEvents"
> & {
  rejectedEvents: readonly [];
};

interface PersistedEventAuthorityAssociationV1 {
  eventName: string;
  eventInstanceId: string;
  coreAnchorToken: string;
}

type PersistedEventMetadataAnchorObservationV1 =
  | {
      kind: "valid";
      eventName: string;
      anchor: Readonly<SplitIdentityAnchorV1>;
    }
  | {
      kind: "invalid";
      eventName: string;
      violation:
        | "not-an-object"
        | "unknown-schema-version"
        | "missing-or-invalid-token"
        | "unexpected-property";
      rawWitnessDigest: string;
    };

interface PersistedEventAuthorityLoadInputV1 {
  coreEventNames: readonly string[];
  associations: readonly PersistedEventAuthorityAssociationV1[];
  metadataAnchors: readonly PersistedEventMetadataAnchorObservationV1[];
  associationRevisionSubset: Readonly<ExpectedRootVector>;
  anchorRevisionSubset: Readonly<ExpectedRootVector>;
}

type PersistedEventAuthorityGlobalRejectionReasonV1 =
  | "duplicate-event-name"
  | "duplicate-event-instance-id"
  | "unknown-extra-event-record"
  | "authority-record-set-corrupt"
  | "revision-subset-stale";

declare const canonicalPersistedAuthorityGlobalReasonsBrandV1: unique symbol;

type CanonicalNonEmptyPersistedEventAuthorityGlobalRejectionReasonsV1 =
  readonly [
    PersistedEventAuthorityGlobalRejectionReasonV1,
    ...PersistedEventAuthorityGlobalRejectionReasonV1[],
  ] & {
    readonly [canonicalPersistedAuthorityGlobalReasonsBrandV1]: true;
  };

type PersistedEventAuthorityLoadResultV1 =
  | {
      kind: "resolved";
      authority: Readonly<ResolvedEventAuthorityV1>;
      authorityInputDigest: string;
      associationRevisionSubset: Readonly<ExpectedRootVector>;
      anchorRevisionSubset: Readonly<ExpectedRootVector>;
    }
  | {
      kind: "rejected";
      canonicalReasons: CanonicalNonEmptyPersistedEventAuthorityGlobalRejectionReasonsV1;
      authorityInputDigest: string;
      rejectionDigest: string;
      associationRevisionSubset: Readonly<ExpectedRootVector>;
      anchorRevisionSubset: Readonly<ExpectedRootVector>;
    };

type EventMetadataAnchorActionV1 =
  | {
      kind: "preserve";
      eventName: string;
      anchor: Readonly<SplitIdentityAnchorV1>;
      metadataBeforeImageDigest: string;
    }
  | {
      kind: "create";
      eventName: string;
      anchor: Readonly<SplitIdentityAnchorV1>;
      metadataBeforeImageDigest: string | null;
      metadataAfterImage: Readonly<EventMetadata>;
      metadataAfterImageDigest: string;
    };

interface EventMetadataRootAfterImagePlanV1 {
  root: readonly [storeName: "eventMetadata", key: "data"];
  expectedBeforeRoot: Readonly<ExpectedRootVector>;
  beforeRootPayloadDigest: string;
  afterRootPayload: Readonly<Record<string, Readonly<EventMetadata>>>;
  afterRootPayloadDigest: string;
  mutationRequired: boolean;
}

interface EventAuthorityProposalV1 {
  attemptId: string;
  sourcePreflightDigest: string;
  entries: readonly EventAuthorityProposalEntryV1[];
  anchorActions: readonly EventMetadataAnchorActionV1[];
  eventMetadataRootPlan: Readonly<EventMetadataRootAfterImagePlanV1>;
  eventMetadataRootAfterImageDigest: string;
  resolvedAuthority: Readonly<BootstrapResolvedEventAuthorityV1>;
  proposalDigest: string;
}

type EventAuthorityProposalResultV1 =
  | {
      kind: "proposed";
      proposal: Readonly<EventAuthorityProposalV1>;
    }
  | {
      kind: "rejected";
      canonicalReasons: CanonicalNonEmptyEventAuthorityRejectionReasonsV1<EventAuthorityProposalBlockerReasonV1>;
      rejectedEvents: readonly [
        BootstrapEventAuthorityRejectionV1,
        ...BootstrapEventAuthorityRejectionV1[],
      ];
      rejectionDigest: string;
      databaseWrites: 0;
    }
  | {
      kind: "failed";
      reason:
        | "opaque-id-api-unavailable"
        | "opaque-id-collision-retry-exhausted";
      allocationKind: "event-instance-id" | "core-anchor-token";
      databaseWrites: 0;
    };

type DurableVisitEventAuthoritySourceWitnessV1 =
  | {
      kind: "bootstrap-proposal";
      attemptId: string;
      sourcePreflightDigest: string;
      proposalDigest: string;
      authorityRevisionSubset: Readonly<ExpectedRootVector>;
      witnessDigest: string;
    }
  | {
      kind: "persisted-association";
      authorityInputDigest: string;
      associationRevisionSubset: Readonly<ExpectedRootVector>;
      anchorRevisionSubset: Readonly<ExpectedRootVector>;
      witnessDigest: string;
    };

type DurableVisitEventAuthorityInputV1 =
  | {
      kind: "bootstrap-proposal";
      proposal: Readonly<EventAuthorityProposalV1>;
      sourceWitness: Readonly<
        Extract<
          DurableVisitEventAuthoritySourceWitnessV1,
          { kind: "bootstrap-proposal" }
        >
      >;
    }
  | {
      kind: "persisted-association";
      loadResult: Extract<
        PersistedEventAuthorityLoadResultV1,
        { kind: "resolved" }
      >;
      sourceWitness: Readonly<
        Extract<
          DurableVisitEventAuthoritySourceWitnessV1,
          { kind: "persisted-association" }
        >
      >;
    };

interface DurableVisitScopeDerivationInputV1 {
  core: Readonly<CorePersistenceSnapshot>;
  coreRootSubset: Readonly<ExpectedRootVector>;
  collisionFreePreflight: Extract<
    LegacyFocusDayScopePreflightV1,
    { kind: "collision-free" }
  >;
  eventAuthority: Readonly<DurableVisitEventAuthorityInputV1>;
  expectedAuthorityRevisionSubset: Readonly<ExpectedRootVector>;
  observedAuthorityRevisionSubset: Readonly<ExpectedRootVector>;
}

type DurableVisitScopeDerivationRejectionReasonV1 =
  | "authority-partition-invalid"
  | "authority-revision-subset-stale"
  | "authority-digest-mismatch"
  | "core-authority-snapshot-mismatch";

declare const canonicalDurableScopeDerivationReasonsBrandV1: unique symbol;

type CanonicalNonEmptyDurableVisitScopeDerivationRejectionReasonsV1 = readonly [
  DurableVisitScopeDerivationRejectionReasonV1,
  ...DurableVisitScopeDerivationRejectionReasonV1[],
] & {
  readonly [canonicalDurableScopeDerivationReasonsBrandV1]: true;
};

interface DurableVisitScopeDerivationBoundaryWitnessV1 {
  coreRootSubset: Readonly<ExpectedRootVector>;
  preflightDigest: string;
  eventAuthorityDigest: string;
  authoritySourceWitness: Readonly<DurableVisitEventAuthoritySourceWitnessV1>;
  expectedAuthorityRevisionSubset: Readonly<ExpectedRootVector>;
  observedAuthorityRevisionSubset: Readonly<ExpectedRootVector>;
}

type DurableVisitScopeDerivationV1 =
  | (DurableVisitScopeDerivationBoundaryWitnessV1 & {
      kind: "resolved";
      scopes: readonly LegacyFocusSessionScopeV1[];
      rejectedEvents: readonly EventAuthorityRejectionV1[];
      resolvedEventBases: readonly DurableVisitEventBasisV1[];
      resolvedBasisCoreDigest: string;
      derivationDigest: string;
    })
  | (DurableVisitScopeDerivationBoundaryWitnessV1 & {
      kind: "rejected";
      reasons: CanonicalNonEmptyDurableVisitScopeDerivationRejectionReasonsV1;
      derivationDigest: string;
      databaseWrites: 0;
    });

interface LegacyFocusDayScopeRepairMappingV1 {
  eventName: string;
  fromRawDayKey: string;
  fromNormalizedDayKey: NormalizedDayKeyV1;
  toRawDayKey: string;
  toNormalizedDayKey: NormalizedDayKeyV1;
}

type LegacyMapDayAssociationMappingOutcomeV1 =
  | {
      kind: "mapless";
      fromRawDayKey: string;
      toRawDayKey: string;
    }
  | {
      kind: "owned-map-tab";
      fromRawDayKey: string;
      toRawDayKey: string;
      sourceMapTabName: string;
      targetMapTabName: string;
    };

type LegacyMapTabOwnershipDecisionV1 =
  | {
      kind: "preserve-map-tab";
      mapTabName: string;
      ownerFromRawDayKey: string;
      ownerToRawDayKey: string;
    }
  | {
      kind: "rename-map-tab";
      fromMapTabName: string;
      toMapTabName: string;
      ownerFromRawDayKey: string;
      ownerToRawDayKey: string;
    }
  | {
      kind: "detach-to-mapless";
      mapTabName: string;
    };

interface LegacyMapDayAssociationRepairDecisionSetV1 {
  eventName: string;
  mappingOutcomes: readonly [
    LegacyMapDayAssociationMappingOutcomeV1,
    ...LegacyMapDayAssociationMappingOutcomeV1[],
  ];
  tabDecisions: readonly LegacyMapTabOwnershipDecisionV1[];
  derivedAfterAssociationDigest: string;
}

interface LegacyFocusDayScopeRepairCardinalityV1 {
  eventCount: number;
  rawDayScopeCount: number;
  distinctNormalizedDayScopeCount: number;
  mappingRowCount: number;
  dayModeEntryCount: number;
  itemCount: number;
  executionBucketCount: number;
  executionReferenceCount: number;
  mapDataSlotCount: number;
  mapRotationSlotCount: number;
  routeSlotCount: number;
  hallDefinitionSlotCount: number;
  hallDefinitionEntryCount: number;
  hallRouteSlotCount: number;
  hallRouteListCount: number;
  hallRouteItemReferenceCount: number;
  viewportSlotCount: number;
  focusSessionRecordCount: number;
}

type LegacyFocusSessionTargetOccupantV1 =
  | { kind: "absent" }
  | { kind: "domain-source"; fromKey: string };

type LegacyFocusSessionKeyObservationV1 =
  | { kind: "absent" }
  | {
      kind: "present";
      sessionRevision: number;
      stateDigest: string;
    };

type LegacyNestedSlotObservationV1 =
  | { kind: "absent" }
  | {
      kind: "present";
      payloadDigest: string;
      payloadByteLength: number;
    };

type LegacyNestedSlotDomainSourceIdentityV1 =
  | ({
      sourceScope: "day-scoped";
      eventName: string;
      legacyNormalizedDayKey: NormalizedDayKeyV1;
      sourcePhysicalKey: string;
    } & (
      | { sourceKind: "day-mode"; sourceSurface: "day-mode" }
      | {
          sourceKind: "mapless-hall-definitions";
          sourceSurface: "hall-definitions";
        }
      | {
          sourceKind: "mapless-hall-route-settings";
          sourceSurface: "hall-route-settings";
        }
      | {
          sourceKind: "execution-bucket";
          sourceSurface: "execution-bucket";
        }
    ))
  | ({
      sourceScope: "event-wide-hall";
      eventName: string;
      sourcePhysicalKey: string;
    } & (
      | {
          sourceKind: "unscoped-hall-definitions";
          embeddedMapTabName: null;
          sourceSurface: "hall-definitions";
        }
      | {
          sourceKind: "embedded-mapless-hall-definitions";
          embeddedMapTabName: string;
          sourceSurface: "hall-definitions";
        }
      | {
          sourceKind: "unscoped-hall-route-settings";
          embeddedMapTabName: null;
          sourceSurface: "hall-route-settings";
        }
      | {
          sourceKind: "embedded-mapless-hall-route-settings";
          embeddedMapTabName: string;
          sourceSurface: "hall-route-settings";
        }
    ));

type LegacyNestedSlotTargetOccupantV1 =
  | { kind: "absent" }
  | {
      kind: "domain-source";
      source: Readonly<LegacyNestedSlotDomainSourceIdentityV1>;
    };

type LegacyNestedSlotSurfaceV1 =
  | "day-mode"
  | "hall-definitions"
  | "hall-route-settings";

type LegacyExecutionBucketObservationV1 =
  | { kind: "absent" }
  | {
      kind: "present";
      payloadDigest: string;
      orderedItemIds: readonly string[];
    };

type LegacyAliasReferenceSourceV1 =
  | "route-settings-visit-order"
  | "hall-route-settings-visit-list"
  | "item-manual-hall";

interface LegacyAliasItemOwnershipV1 {
  itemId: string;
  rawDayKey: string;
  sources: readonly [
    LegacyAliasReferenceSourceV1,
    ...LegacyAliasReferenceSourceV1[],
  ];
}

interface LegacyExecutionPartitionRowV1 {
  sourcePhysicalKey: string;
  toRawDayKey: string;
  targetPhysicalKey: string;
  orderedItemIds: readonly [string, ...string[]];
}

interface LegacyAliasPhysicalSourceRowCommonV1 {
  eventName: string;
  legacyNormalizedDayKey: NormalizedDayKeyV1;
  sourcePhysicalKey: string;
  candidateRawDayKeys: readonly [string, ...string[]];
}

type LegacyAliasPhysicalSourceRowV1 = LegacyAliasPhysicalSourceRowCommonV1 &
  (
    | {
        kind: "day-mode";
        sourceSurface: "day-mode";
        sourceBefore: LegacyNestedSlotObservationV1;
      }
    | {
        kind: "mapless-hall-definitions";
        sourceSurface: "hall-definitions";
        sourceBefore: LegacyNestedSlotObservationV1;
      }
    | {
        kind: "mapless-hall-route-settings";
        sourceSurface: "hall-route-settings";
        sourceBefore: LegacyNestedSlotObservationV1;
      }
    | {
        kind: "execution-bucket";
        sourceSurface: "execution-bucket";
        sourceBefore: LegacyExecutionBucketObservationV1;
      }
    | {
        kind: "focus-session";
        sourceSurface: "focus-session";
        sourceBefore: LegacyFocusSessionKeyObservationV1;
      }
  );

interface LegacyNestedSingleOwnerRekeyCommonV1 {
  kind: "nested-single-owner-rekey";
  eventName: string;
  legacyNormalizedDayKey: NormalizedDayKeyV1;
  sourcePhysicalKey: string;
  ownerRawDayKey: string;
  ownerBasis:
    | "unique-physical-source-candidate"
    | "user-selected-no-references"
    | "forced-reference-closure";
  targetPhysicalKey: string;
  targetBefore: LegacyNestedSlotTargetOccupantV1;
}

type LegacyNestedSingleOwnerRekeyAssignmentV1 =
  LegacyNestedSingleOwnerRekeyCommonV1 &
    (
      | {
          sourceKind: "day-mode";
          sourceSurface: "day-mode";
          targetSurface: "day-mode";
        }
      | {
          sourceKind: "mapless-hall-definitions";
          sourceSurface: "hall-definitions";
          targetSurface: "hall-definitions";
        }
      | {
          sourceKind: "mapless-hall-route-settings";
          sourceSurface: "hall-route-settings";
          targetSurface: "hall-route-settings";
        }
    );

type LegacyAliasPhysicalSourceAssignmentV1 =
  | LegacyNestedSingleOwnerRekeyAssignmentV1
  | {
      kind: "focus-session-single-owner-rekey";
      eventName: string;
      legacyNormalizedDayKey: NormalizedDayKeyV1;
      sourceSurface: "focus-session";
      sourcePhysicalKey: string;
      ownerRawDayKey: string;
      ownerBasis:
        | "unique-physical-source-candidate"
        | "user-selected-no-references"
        | "forced-reference-closure";
      targetSurface: "focus-session";
      targetPhysicalKey: string;
      targetBefore: LegacyFocusSessionTargetOccupantV1;
    }
  | {
      kind: "execution-bucket-partition";
      eventName: string;
      legacyNormalizedDayKey: NormalizedDayKeyV1;
      sourceSurface: "execution-bucket";
      sourcePhysicalKey: string;
      partitions: readonly [
        LegacyExecutionPartitionRowV1,
        ...LegacyExecutionPartitionRowV1[],
      ];
    }
  | {
      kind: "empty-execution-bucket-single-owner-rekey";
      eventName: string;
      legacyNormalizedDayKey: NormalizedDayKeyV1;
      sourceSurface: "execution-bucket";
      sourcePhysicalKey: string;
      ownerRawDayKey: string;
      ownerBasis:
        | "unique-physical-source-candidate"
        | "user-selected-no-references";
      targetSurface: "execution-bucket";
      targetPhysicalKey: string;
      targetBefore: LegacyNestedSlotTargetOccupantV1;
    };

type LegacyEventWideHallSourceKindV1 =
  | "unscoped-hall-definitions"
  | "unscoped-hall-route-settings"
  | "embedded-mapless-hall-definitions"
  | "embedded-mapless-hall-route-settings";

type LegacyEventWideHallSourceIdentityV1 =
  | {
      sourceKind: "unscoped-hall-definitions" | "unscoped-hall-route-settings";
      embeddedMapTabName: null;
    }
  | {
      sourceKind:
        | "embedded-mapless-hall-definitions"
        | "embedded-mapless-hall-route-settings";
      embeddedMapTabName: string;
    };

interface LegacyEventWideHallNormalizationSourceCommonV1 {
  eventName: string;
  sourcePhysicalKey: string;
  candidateRawDayKeys: readonly [string, ...string[]];
  referencedRawDayKeys: readonly string[];
  sourceBefore: Extract<LegacyNestedSlotObservationV1, { kind: "present" }>;
}

type LegacyEventWideHallNormalizationSourceV1 =
  LegacyEventWideHallNormalizationSourceCommonV1 &
    LegacyEventWideHallSourceIdentityV1;

interface LegacyEventWideHallNormalizationAssignmentCommonV1 {
  eventName: string;
  sourcePhysicalKey: string;
  ownerRawDayKey: string;
  ownerBasis:
    | "unique-event-day-candidate"
    | "forced-reference-closure"
    | "user-selected-no-references";
  targetPhysicalKey: string;
  targetBefore: LegacyNestedSlotTargetOccupantV1;
  sourceCleanupAfterImageDigest: string;
}

type LegacyEventWideHallNormalizationAssignmentV1 =
  LegacyEventWideHallNormalizationAssignmentCommonV1 &
    (
      | {
          sourceKind: "unscoped-hall-definitions";
          embeddedMapTabName: null;
          sourceSurface: "hall-definitions";
          targetSurface: "hall-definitions";
        }
      | {
          sourceKind: "embedded-mapless-hall-definitions";
          embeddedMapTabName: string;
          sourceSurface: "hall-definitions";
          targetSurface: "hall-definitions";
        }
      | {
          sourceKind: "unscoped-hall-route-settings";
          embeddedMapTabName: null;
          sourceSurface: "hall-route-settings";
          targetSurface: "hall-route-settings";
        }
      | {
          sourceKind: "embedded-mapless-hall-route-settings";
          embeddedMapTabName: string;
          sourceSurface: "hall-route-settings";
          targetSurface: "hall-route-settings";
        }
    );

interface LegacyNormalizedDayAliasRepairDecisionV1 {
  eventName: string;
  legacyNormalizedDayKey: NormalizedDayKeyV1;
  rawDayKeys: readonly [string, string, ...string[]];
  physicalSources: readonly LegacyAliasPhysicalSourceRowV1[];
  physicalSourceAssignments: readonly LegacyAliasPhysicalSourceAssignmentV1[];
  sharedStateItemOwnership: readonly LegacyAliasItemOwnershipV1[];
  resolution:
    | {
        kind: "all-derived-physical-sources-absent";
      }
    | {
        kind: "partition-execution-only";
      }
    | {
        kind: "assign-physical-sources";
        userConfirmationRequired: true;
        lossPreviewDigest: string;
      };
}

interface LegacyFocusSessionRepairKeyTransitionV1 {
  fromKey: string;
  toKey: string;
  sourceBefore: LegacyFocusSessionKeyObservationV1;
  targetBefore: LegacyFocusSessionTargetOccupantV1;
}

type LegacyFocusDayScopeRepairLossPreviewRowV1 =
  | {
      effectKind: "day-scope-mapping";
      mapping: Readonly<LegacyFocusDayScopeRepairMappingV1>;
    }
  | {
      effectKind: "day-scoped-physical-source-assignment";
      assignment: Readonly<LegacyAliasPhysicalSourceAssignmentV1>;
    }
  | {
      effectKind: "event-wide-hall-assignment-and-cleanup";
      assignment: Readonly<LegacyEventWideHallNormalizationAssignmentV1>;
    }
  | {
      effectKind: "map-association-decision";
      decision: Readonly<LegacyMapDayAssociationRepairDecisionSetV1>;
    }
  | {
      effectKind: "focus-session-rekey";
      transition: Readonly<LegacyFocusSessionRepairKeyTransitionV1>;
    };

interface LegacyFocusDayScopeRepairPlanV1 {
  kind: "legacy-focus-day-scope-repair-v1";
  collisionWitnessDigest: string;
  externalCandidateAbsenceWitnessDigest: string;
  preservedLegacySyncQueueWitnessDigest: string;
  requestedTargetsDigest: string;
  choiceRequestDigest: string;
  authorityRevisionDigest: string;
  expectedCoreRoots: Readonly<ExpectedRootVector>;
  mappings: readonly [
    LegacyFocusDayScopeRepairMappingV1,
    ...LegacyFocusDayScopeRepairMappingV1[],
  ];
  normalizedAliasDecisions: readonly LegacyNormalizedDayAliasRepairDecisionV1[];
  observedDayScopedPhysicalSourceDigest: string;
  eventWideHallSources: readonly LegacyEventWideHallNormalizationSourceV1[];
  observedEventWideHallSourceDigest: string;
  eventWideHallOwnerChoiceRequests: readonly LegacyEventWideHallOwnerChoiceRequestV1[];
  eventWideHallAssignments: readonly LegacyEventWideHallNormalizationAssignmentV1[];
  mapAssociationChoiceRequests: readonly LegacyMapDayAssociationChoiceRequestV1[];
  mapAssociationDecisions: readonly LegacyMapDayAssociationRepairDecisionSetV1[];
  expectedRegistryGeneration: number;
  focusSessionTransitions: readonly LegacyFocusSessionRepairKeyTransitionV1[];
  changedCoreRootKeys: readonly (readonly [storeName: string, key: string])[];
  beforeCardinality: Readonly<LegacyFocusDayScopeRepairCardinalityV1>;
  afterCardinality: Readonly<LegacyFocusDayScopeRepairCardinalityV1>;
  afterCollisionFreePreflightDigest: string;
  lossPreviewRows: readonly [
    LegacyFocusDayScopeRepairLossPreviewRowV1,
    ...LegacyFocusDayScopeRepairLossPreviewRowV1[],
  ];
  lossPreviewDigest: string;
  planDigest: string;
}

interface LegacyFocusSessionStateV1 {
  phase: VisitPhase;
  phaseIndex: number;
  savedPhaseIndices: Readonly<{
    normal: number;
    postponed: number;
    late: number;
  }>;
  postponedItemIds: readonly string[];
  lateItemIds: readonly string[];
  isCompleted: boolean;
  lastPurchaseChangeAt: Readonly<{
    phase: VisitPhase;
    phaseIndex: number;
    visitKey: string;
  }> | null;
}

interface LegacyFocusSessionSnapshotV1 extends LegacyFocusSessionScopeV1 {
  legacySessionKey: string;
  sessionRevision: number;
  state: Readonly<LegacyFocusSessionStateV1>;
  stateDigest: string;
}

type LegacyFocusSessionCaptureRecordV1 =
  | {
      kind: "present";
      scope: LegacyFocusSessionScopeV1;
      snapshot: LegacyFocusSessionSnapshotV1;
    }
  | {
      kind: "absent";
      scope: LegacyFocusSessionScopeV1;
    }
  | {
      kind: "unmapped";
      legacySessionKey: string;
      sessionRevision: number;
      state: Readonly<LegacyFocusSessionStateV1>;
      unmappedRecordDigest: string;
      reason:
        | "no-scope-candidate"
        | "multiple-scope-candidates"
        | "duplicate-scope-candidate";
    };

interface FrozenLegacyFocusSessionRegistryV1 {
  kind: "fsmc-frozen-legacy-focus-sessions-v1";
  freezeIssuanceId: number;
  registryGeneration: number;
  mappingInputDigest: string;
  records: readonly LegacyFocusSessionCaptureRecordV1[];
  tokenDigest: string;
}

type LegacyFocusSessionTokenStatusV1 = "active" | "invalidated" | "consumed";

type LegacyFocusSessionOperationLeaseStatusV1 =
  | "active"
  | "completed"
  | "aborted";

type LegacyFocusSessionCounterExhaustionReasonV1 =
  | "legacy-focus-registry-generation-exhausted"
  | "legacy-focus-freeze-issuance-exhausted"
  | "legacy-focus-operation-generation-exhausted";

interface LegacyFocusSessionRuntimeRepairStateV1 {
  status: "repair-required";
  reason: LegacyFocusSessionCounterExhaustionReasonV1;
  counterSnapshot: Readonly<{
    registryGeneration: number;
    freezeIssuanceId: number;
    operationGeneration: number;
  }>;
  originatingMutationRejected: true;
  databaseWritesAllowed: false;
  tokenIssuanceAllowed: false;
}

type LegacyFocusSessionOperationScopeV1 =
  | {
      kind: "event";
      eventInstanceId: string;
    }
  | {
      kind: "profile-repair";
      eventNames: readonly [string, ...string[]];
    };

type LegacyFocusSessionLifecycleTransitionV1 =
  | {
      kind: "rename";
      keyPairs: readonly (readonly [fromKey: string, toKey: string])[];
    }
  | {
      kind: "raw-day-rekey";
      repairPlanDigest: string;
      transitions: readonly LegacyFocusSessionRepairKeyTransitionV1[];
      keyPairs: readonly (readonly [fromKey: string, toKey: string])[];
    }
  | {
      kind: "delete" | "prune";
      legacySessionKeys: readonly string[];
    };

interface LegacyFocusSessionOperationLeaseV1 {
  operationScope: LegacyFocusSessionOperationScopeV1;
  operationGeneration: number;
  registryGenerationBefore: number;
  registryGenerationAfter: number;
  transition: LegacyFocusSessionLifecycleTransitionV1;
  transitionDigest: string;
  leaseDigest: string;
}

type LegacyFocusSessionOperationLeaseAcquisitionResultV1 =
  | {
      kind: "acquired";
      lease: Readonly<LegacyFocusSessionOperationLeaseV1>;
      runtimeRepairState: null;
      databaseWrites: 0;
      focusSessionRecordMutations: 0;
      leaseLedgerTransitionCount: 1;
    }
  | {
      kind: "rejected";
      reason:
        | "operation-scope-busy"
        | "registry-generation-mismatch"
        | "transition-source-mismatch"
        | "transition-target-mismatch"
        | "transition-aba-detected"
        | "transition-invalid";
      runtimeRepairState: null;
      databaseWrites: 0;
      focusSessionRecordMutations: 0;
      leaseLedgerTransitionCount: 0;
    }
  | {
      kind: "rejected";
      reason: "legacy-focus-operation-generation-exhausted";
      runtimeRepairState: Readonly<
        LegacyFocusSessionRuntimeRepairStateV1 & {
          reason: "legacy-focus-operation-generation-exhausted";
        }
      >;
      databaseWrites: 0;
      focusSessionRecordMutations: 0;
      leaseLedgerTransitionCount: 0;
    };

type LegacyFocusSessionRejectedRepairLeaseLedgerOutcomeV1 =
  | {
      kind: "not-acquired";
      transitionCount: 0;
      operationGeneration: null;
      leaseDigest: null;
    }
  | {
      kind: "aborted";
      transitionCount: 2;
      operationGeneration: number;
      leaseDigest: string;
      finalStatus: "aborted";
    };

interface LegacyFocusSessionFreezePortV1 {
  beginLifecycleOperation(input: {
    operationScope: LegacyFocusSessionOperationScopeV1;
    expectedRegistryGeneration: number;
    transition: LegacyFocusSessionLifecycleTransitionV1;
  }): Promise<LegacyFocusSessionOperationLeaseAcquisitionResultV1>;
  completeLifecycleOperationAfterPersistence(
    lease: LegacyFocusSessionOperationLeaseV1,
  ): void;
  abortLifecycleOperation(lease: LegacyFocusSessionOperationLeaseV1): void;
  freezeAndCapture(
    input: Readonly<LegacyFocusSessionMappingInputV1>,
  ): Promise<FrozenLegacyFocusSessionRegistryV1>;
  assertFrozen(token: FrozenLegacyFocusSessionRegistryV1): void;
  invalidate(tokenDigest: string): void;
  consumeAfterCommit(tokenDigest: string): void;
}

type LegacyFocusDayScopeRepairResultV1 =
  | {
      kind: "committed";
      planDigest: string;
      repairReceiptKey: typeof FSMC_LEGACY_FOCUS_DAY_REPAIR_RECEIPT_KEY_V1;
      repairReceiptDigest: string;
      afterCoreRoots: Readonly<ExpectedRootVector>;
      afterPreflight: Extract<
        LegacyFocusDayScopePreflightV1,
        { kind: "collision-free" }
      >;
      afterCardinality: Readonly<LegacyFocusDayScopeRepairCardinalityV1>;
      externalCandidatePostCommitAbsenceWitnessDigest: string;
      capabilityUpgradeAllowed: false;
      bootstrapRetryAllowed: false;
    }
  | {
      kind: "committed-legacy-external-candidate-blocked";
      planDigest: string;
      repairReceiptKey: typeof FSMC_LEGACY_FOCUS_DAY_REPAIR_RECEIPT_KEY_V1;
      repairReceiptDigest: string;
      afterCoreRoots: Readonly<ExpectedRootVector>;
      afterPreflight: Extract<
        LegacyFocusDayScopePreflightV1,
        { kind: "collision-free" }
      >;
      afterCardinality: Readonly<LegacyFocusDayScopeRepairCardinalityV1>;
      externalCandidatePostCommitWitnessDigest: string;
      postRepairRetirement:
        | {
            kind: "available";
            commandId: "fsmc.retire.post-repair-legacy-external-core.v1";
          }
        | {
            kind: "unavailable";
            reason:
              | "materialization-receipt-absent"
              | "reappeared-source-vector-mismatch";
          };
      capabilityUpgradeAllowed: false;
      bootstrapRetryAllowed: false;
      recoveryRunbookId: "fsmc.legacy-external-candidate-blocked.v1";
    }
  | {
      kind: "committed-recovery-required";
      reason:
        | "repair-receipt-unavailable"
        | "reappeared-source-vector-mismatch"
        | "preserved-legacy-sync-queue-stale";
      planDigest: string;
      repairReceiptKey: typeof FSMC_LEGACY_FOCUS_DAY_REPAIR_RECEIPT_KEY_V1;
      repairReceiptDigest: string;
      afterCoreRoots: Readonly<ExpectedRootVector>;
      afterPreflight: Extract<
        LegacyFocusDayScopePreflightV1,
        { kind: "collision-free" }
      >;
      afterCardinality: Readonly<LegacyFocusDayScopeRepairCardinalityV1>;
      observedExternalStateDigest: string;
      capabilityUpgradeAllowed: false;
      bootstrapRetryAllowed: false;
      recoveryRunbookId: "fsmc.legacy-external-candidate-blocked.v1";
    }
  | {
      kind: "rejected";
      reason:
        | "stale-preview"
        | "external-candidate-stale"
        | "preserved-legacy-sync-queue-stale"
        | "incomplete-domain"
        | "non-injective-target"
        | "occupied-target"
        | "cardinality-changed"
        | "normalization-transition-invalid"
        | "alias-owner-required"
        | "execution-partition-invalid"
        | "day-scoped-source-partition-unpartitionable"
        | "physical-source-target-capacity-unpartitionable"
        | "physical-source-assignment-incomplete"
        | "shared-day-reference-unpartitionable"
        | "hall-source-target-capacity-unpartitionable"
        | "map-target-capacity-unpartitionable"
        | "map-decision-mismatch"
        | "focus-transition-mismatch"
        | "plan-digest-mismatch"
        | "loss-preview-row-set-mismatch"
        | "loss-preview-digest-mismatch"
        | "loss-preview-confirmation-mismatch"
        | "operation-lease-mismatch"
        | "new-collision"
        | "persistence-failed";
      databaseWrites: 0;
      focusSessionRecordMutations: 0;
      leaseLedgerOutcome: Readonly<LegacyFocusSessionRejectedRepairLeaseLedgerOutcomeV1>;
    };

interface LegacyAliasPhysicalSourceChoiceRequestV1 {
  eventName: string;
  legacyNormalizedDayKey: NormalizedDayKeyV1;
  sourceKind:
    | "day-mode"
    | "mapless-hall-definitions"
    | "mapless-hall-route-settings"
    | "empty-execution-bucket"
    | "focus-session";
  sourcePhysicalKey: string;
  candidateOwnerRawDayKeys: readonly [string, string, ...string[]];
}

interface LegacyAliasPhysicalSourceOwnerChoiceV1 {
  eventName: string;
  legacyNormalizedDayKey: NormalizedDayKeyV1;
  sourceKind: LegacyAliasPhysicalSourceChoiceRequestV1["sourceKind"];
  sourcePhysicalKey: string;
  ownerRawDayKey: string;
}

interface LegacyEventWideHallOwnerChoiceRequestCommonV1 {
  eventName: string;
  sourcePhysicalKey: string;
  candidateOwnerRawDayKeys: readonly [string, string, ...string[]];
  sourceDigest: string;
}

type LegacyEventWideHallOwnerChoiceRequestV1 =
  LegacyEventWideHallOwnerChoiceRequestCommonV1 &
    LegacyEventWideHallSourceIdentityV1;

interface LegacyEventWideHallOwnerChoiceCommonV1 {
  eventName: string;
  sourcePhysicalKey: string;
  ownerRawDayKey: string;
}

type LegacyEventWideHallOwnerChoiceV1 = LegacyEventWideHallOwnerChoiceCommonV1 &
  LegacyEventWideHallSourceIdentityV1;

type LegacyMapDayAssociationDerivedObservationV1 =
  | { kind: "none" }
  | { kind: "unique"; mapTabName: string }
  | {
      kind: "ambiguous";
      mapTabNames: readonly [string, string, ...string[]];
    };

interface LegacyMapDayAssociationMappingRequestRowCommonV1 {
  fromRawDayKey: string;
  toRawDayKey: string;
  currentDerivedAssociation: LegacyMapDayAssociationDerivedObservationV1;
}

type LegacyMapDayAssociationMappingRequestRowV1 =
  LegacyMapDayAssociationMappingRequestRowCommonV1 &
    (
      | {
          ownershipOptions: "mapless-only";
          eligibleMapTabNames: readonly [];
          ownedTargetMapTabName: null;
        }
      | {
          ownershipOptions: "owned-or-mapless";
          eligibleMapTabNames: readonly [string, ...string[]];
          ownedTargetMapTabName: string;
        }
    );

interface LegacyMapDayAssociationChoiceRequestV1 {
  eventName: string;
  mappings: readonly [
    LegacyMapDayAssociationMappingRequestRowV1,
    ...LegacyMapDayAssociationMappingRequestRowV1[],
  ];
  candidateMapTabNames: readonly string[];
  sixStorePhysicalClosureDigest: string;
  targetOccupancyDigest: string;
  allowedDecisionKinds: readonly LegacyMapTabOwnershipDecisionV1["kind"][];
  requestDigest: string;
}

interface LegacyFocusDayScopeRepairTargetChoicesV1 {
  requestedTargets: readonly (readonly [
    eventName: string,
    fromRawDayKey: string,
    toRawDayKey: string,
  ])[];
}

type LegacyFocusDayScopeRepairChoiceInspectionV1 =
  | {
      kind: "choices-required";
      collisionWitnessDigest: string;
      externalCandidateAbsenceWitnessDigest: string;
      preservedLegacySyncQueueWitnessDigest: string;
      requestedTargetsDigest: string;
      expectedCoreRoots: Readonly<ExpectedRootVector>;
      aliasGroups: readonly Omit<
        LegacyNormalizedDayAliasRepairDecisionV1,
        "physicalSourceAssignments" | "resolution"
      >[];
      observedDayScopedPhysicalSourceDigest: string;
      automaticAssignments: readonly LegacyAliasPhysicalSourceAssignmentV1[];
      ownerChoiceRequests: readonly LegacyAliasPhysicalSourceChoiceRequestV1[];
      eventWideHallSources: readonly LegacyEventWideHallNormalizationSourceV1[];
      observedEventWideHallSourceDigest: string;
      automaticEventWideHallAssignments: readonly LegacyEventWideHallNormalizationAssignmentV1[];
      eventWideHallOwnerChoiceRequests: readonly LegacyEventWideHallOwnerChoiceRequestV1[];
      mapAssociationChoiceRequests: readonly LegacyMapDayAssociationChoiceRequestV1[];
      choiceRequestDigest: string;
    }
  | {
      kind: "rejected";
      reason:
        | "legacy-external-candidate-present"
        | "preserved-legacy-sync-queue-unarchived"
        | "invalid-target-mapping"
        | "occupied-target-outside-domain"
        | "unknown-or-duplicate-item-reference"
        | "execution-partition-invalid"
        | "day-scoped-source-partition-unpartitionable"
        | "physical-source-target-capacity-unpartitionable"
        | "shared-day-reference-unpartitionable"
        | "hall-source-target-capacity-unpartitionable"
        | "map-target-capacity-unpartitionable";
      databaseWrites: 0;
      focusSessionRecordMutations: 0;
    };

interface LegacyFocusDayScopeRepairUserChoicesV1 {
  choiceRequestDigest: string;
  aliasOwnerChoices: readonly LegacyAliasPhysicalSourceOwnerChoiceV1[];
  eventWideHallOwnerChoices: readonly LegacyEventWideHallOwnerChoiceV1[];
  mapAssociationChoices: readonly LegacyMapDayAssociationRepairDecisionSetV1[];
}

interface LegacyFocusDayScopeRepairConfirmationV1 {
  planDigest: string;
  confirmedLossPreviewDigest: string;
  confirmed: true;
}

type LegacyFocusDayScopeRepairPreviewResultV1 =
  | {
      kind: "planned";
      plan: Readonly<LegacyFocusDayScopeRepairPlanV1>;
    }
  | {
      kind: "rejected";
      reason:
        | "choice-request-digest-mismatch"
        | "owner-choice-set-mismatch"
        | "owner-candidate-invalid"
        | "event-wide-hall-choice-set-mismatch"
        | "hall-source-target-capacity-unpartitionable"
        | "map-choice-set-mismatch"
        | "map-choice-invalid"
        | "map-target-capacity-unpartitionable"
        | "day-scoped-source-partition-unpartitionable"
        | "physical-source-target-capacity-unpartitionable"
        | "physical-source-assignment-incomplete"
        | "loss-preview-row-set-mismatch"
        | "loss-preview-digest-mismatch"
        | "inspection-stale";
      databaseWrites: 0;
      focusSessionRecordMutations: 0;
    };

interface LegacyFocusDayScopeRepairPortV1 {
  inspectLegacyFocusDayScopeRepairChoices(input: {
    collisionWitness: Readonly<LegacyFocusDayScopeCollisionWitnessV1>;
    externalCandidateAbsenceWitnessDigest: string;
    preservedLegacySyncQueueWitnessDigest: string;
    targetChoices: Readonly<LegacyFocusDayScopeRepairTargetChoicesV1>;
  }): Promise<LegacyFocusDayScopeRepairChoiceInspectionV1>;
  previewLegacyFocusDayScopeRepair(input: {
    collisionWitness: Readonly<LegacyFocusDayScopeCollisionWitnessV1>;
    inspection: Extract<
      LegacyFocusDayScopeRepairChoiceInspectionV1,
      { kind: "choices-required" }
    >;
    choices: Readonly<LegacyFocusDayScopeRepairUserChoicesV1>;
  }): Promise<LegacyFocusDayScopeRepairPreviewResultV1>;
  repairLegacyFocusDayScopesAtomically(input: {
    plan: Readonly<LegacyFocusDayScopeRepairPlanV1>;
    lease: Readonly<LegacyFocusSessionOperationLeaseV1>;
    confirmation: Readonly<LegacyFocusDayScopeRepairConfirmationV1>;
  }): Promise<LegacyFocusDayScopeRepairResultV1>;
}

interface DurableVisitEventBasisV1 {
  eventNameAtBasis: string;
  eventInstanceId: string;
  basisCoreEventDigest: string;
  basisEventAuthorityEntryDigest: string;
}

interface DurableVisitRejectedEventPartitionCommonV1 {
  eventName: string;
  reasons: CanonicalNonEmptyEventAuthorityRejectionReasonsV1;
  retainedEntriesDigest: string;
  witnessDigest: string;
}

type DurableVisitRejectedEventPartitionV1 =
  DurableVisitRejectedEventPartitionCommonV1 &
    (
      | {
          priorEventInstanceId: null;
          retainedEntryCount: 0;
        }
      | {
          priorEventInstanceId: string;
          retainedEntryCount: number;
        }
    );

interface DurableVisitRetiredEventPartitionV1 {
  reason: "legacy-core-event-disappeared";
  eventNameAtBasis: string;
  eventInstanceId: string;
  basisCoreEventDigest: string;
  basisEventAuthorityEntryDigest: string;
  retainedEntryCount: number;
  retainedEntriesDigest: string;
  legacyTransitionWitnessDigest: string;
  retirementWitnessDigest: string;
}

type DurableVisitInitializationV1 =
  | {
      status: "migrating";
      basisCoreDigest: string;
      basisEventAuthorityDigest: string;
      eventBases: readonly DurableVisitEventBasisV1[];
    }
  | {
      status: "ready";
      basisCoreDigest: string;
      basisEventAuthorityDigest: string;
      eventBases: readonly DurableVisitEventBasisV1[];
    };

type DurableVisitInitializationRepairReasonV1 =
  | "durable-root-untrusted"
  | "basis-core-mismatch"
  | "event-authority-mismatch"
  | "scope-entry-bijection-mismatch"
  | "legacy-session-unresolved"
  | "counter-exhausted";

declare const canonicalDurableInitializationRepairReasonsBrandV1: unique symbol;

type CanonicalNonEmptyDurableVisitInitializationRepairReasonsV1<
  TReason extends DurableVisitInitializationRepairReasonV1 =
    DurableVisitInitializationRepairReasonV1,
> = readonly [TReason, ...TReason[]] & {
  readonly [canonicalDurableInitializationRepairReasonsBrandV1]: true;
};

type CanonicalDurableRootUntrustedReasonsV1 =
  | (readonly ["durable-root-untrusted"] & {
      readonly [canonicalDurableInitializationRepairReasonsBrandV1]: true;
    })
  | (readonly ["durable-root-untrusted", "counter-exhausted"] & {
      readonly [canonicalDurableInitializationRepairReasonsBrandV1]: true;
    });

interface DurableVisitRootSemanticViolationWitnessV1 {
  path: readonly [string, ...string[]];
  violation:
    | "duplicate-or-noncanonical-scope"
    | "entry-count-or-partition-mismatch"
    | "event-basis-set-invalid"
    | "basis-digest-mismatch"
    | "retired-partition-invalid"
    | "persisted-initialization-invalid";
  observedValueDigest: string;
}

type DurableVisitInitializationRepairWitnessInputV1 =
  | {
      evidenceKind: "unparseable-root";
      reasons: CanonicalDurableRootUntrustedReasonsV1;
      persistedRootDigest: null;
      rawRootObservationDigest: string;
      semanticViolationWitnesses: null;
      eventBases: null;
      rejectedEventPartitions: null;
      retiredEventPartitions: null;
      counterWitnesses:
        | readonly []
        | readonly [Readonly<LegacyFocusSessionRuntimeRepairStateV1>];
    }
  | {
      evidenceKind: "parsed-untrusted-root";
      reasons: CanonicalDurableRootUntrustedReasonsV1;
      persistedRootDigest: string;
      rawRootObservationDigest: null;
      semanticViolationWitnesses: readonly [
        DurableVisitRootSemanticViolationWitnessV1,
        ...DurableVisitRootSemanticViolationWitnessV1[],
      ];
      eventBases: null;
      rejectedEventPartitions: null;
      retiredEventPartitions: null;
      counterWitnesses:
        | readonly []
        | readonly [Readonly<LegacyFocusSessionRuntimeRepairStateV1>];
    }
  | {
      evidenceKind: "trusted-localizable-root";
      reasons: CanonicalNonEmptyDurableVisitInitializationRepairReasonsV1<
        Exclude<
          DurableVisitInitializationRepairReasonV1,
          "durable-root-untrusted"
        >
      >;
      persistedRootDigest: string;
      rawRootObservationDigest: null;
      semanticViolationWitnesses: readonly [];
      eventBases: readonly DurableVisitEventBasisV1[];
      rejectedEventPartitions: readonly DurableVisitRejectedEventPartitionV1[];
      retiredEventPartitions: readonly DurableVisitRetiredEventPartitionV1[];
      counterWitnesses:
        | readonly []
        | readonly [Readonly<LegacyFocusSessionRuntimeRepairStateV1>];
    };

type DurableVisitInitializationStateV1 =
  | {
      status: "missing";
      reason: "durable-root-absent";
      persistedRootDigest: null;
      liveScopeDerivationDigest: string;
      witnessDigest: string;
    }
  | {
      status: "migrating";
      persistedRootDigest: string;
      liveScopeDerivationDigest: string;
      basisCoreDigest: string;
      basisEventAuthorityDigest: string;
      eventBases: readonly DurableVisitEventBasisV1[];
      pendingScopeCount: number;
      unmappedRecordCount: number;
      rejectedEventPartitions: readonly DurableVisitRejectedEventPartitionV1[];
      retiredEventPartitions: readonly DurableVisitRetiredEventPartitionV1[];
      witnessDigest: string;
    }
  | {
      status: "ready";
      persistedRootDigest: string;
      liveScopeDerivationDigest: string;
      basisCoreDigest: string;
      basisEventAuthorityDigest: string;
      eventBases: readonly DurableVisitEventBasisV1[];
      entryCount: number;
      activeEntryCount: number;
      quarantinedEntryCount: number;
      retiredEntryCount: number;
      rejectedEventPartitions: readonly DurableVisitRejectedEventPartitionV1[];
      retiredEventPartitions: readonly DurableVisitRetiredEventPartitionV1[];
      witnessDigest: string;
    }
  | ({
      status: "repair-required";
      liveScopeDerivationDigest: string;
      witnessDigest: string;
    } & DurableVisitInitializationRepairWitnessInputV1);

interface DurableVisitStateRootV1 {
  schemaVersion: 1;
  initialization: DurableVisitInitializationV1;
  entries: readonly Readonly<DurableVisitStateEntryV1>[];
  retiredEventPartitions: readonly Readonly<DurableVisitRetiredEventPartitionV1>[];
}

interface VisitIdentityInputSnapshot {
  inputRevision: VisitIdentityInputRevision;
  revisionVector: Readonly<ProjectionInputRevisionVectorV1>;
  event: Readonly<{
    eventInstanceId: string;
    normalizedDayKey: NormalizedDayKeyV1;
    metadataRevision: string;
  }>;
  items: readonly Readonly<{
    itemId: string;
    eventInstanceId: string;
    normalizedDayKey: NormalizedDayKeyV1;
    manualHallId: string | null;
    normalizedBlockToken: NormalizedBlockTokenV1;
    originalNumber: string;
    priorityLevel: VisitPriorityLevel;
  }>[];
  executionOrderItemIds: readonly string[];
  durableVisitState: Readonly<DurableVisitStateEntryV1>;
  mapAssociations: readonly MapAssociationIdentityInputV1[];
  hallDefinitions: readonly HallDefinitionIdentityInputV1[];
  hallAssociations: readonly HallAssociationIdentityInputV1[];
  hallRemaps: readonly HallRemapIdentityInputV1[];
  splitSettings: Readonly<MapCellSplitSettingsIdentityInputV1>;
}

interface VisitIdentityCoreBasisScopeInputV1 {
  normalizedDayKey: NormalizedDayKeyV1;
  items: readonly Readonly<{
    itemId: string;
    eventInstanceId: string;
    normalizedDayKey: NormalizedDayKeyV1;
    manualHallId: string | null;
    normalizedBlockToken: NormalizedBlockTokenV1;
    originalNumber: string;
    priorityLevel: VisitPriorityLevel;
  }>[];
  executionOrderItemIds: readonly string[];
  mapAssociations: readonly MapAssociationIdentityInputV1[];
  hallDefinitions: readonly HallDefinitionIdentityInputV1[];
  hallAssociations: readonly HallAssociationIdentityInputV1[];
  hallRemaps: readonly HallRemapIdentityInputV1[];
  splitSettings: Readonly<MapCellSplitSettingsIdentityInputV1>;
}

interface VisitIdentityCoreBasisInputV1 {
  schemaVersion: 1;
  eventInstanceId: string;
  scopes: readonly VisitIdentityCoreBasisScopeInputV1[];
}

declare function deriveVisitIdentityCoreBasisInputV1(input: {
  eventInstanceId: string;
  scopes: readonly Readonly<VisitIdentityCoreBasisScopeInputV1>[];
}): Readonly<VisitIdentityCoreBasisInputV1>;

type ProjectedVisitResolutionKind =
  | "mapped"
  | "mapless"
  | "legacy-unresolved"
  | "ambiguous";

interface ProjectedVisitResolutionPresentation {
  displayNumber: string;
  blockLabel: string;
}

type ProjectedVisitResolutionSummary =
  | (ProjectedVisitResolutionPresentation & {
      kind: "mapped";
      canJumpToMap: true;
      reason: null;
    })
  | (ProjectedVisitResolutionPresentation & {
      kind: "mapless";
      canJumpToMap: false;
      reason: "mapless";
    })
  | (ProjectedVisitResolutionPresentation & {
      kind: "legacy-unresolved";
      canJumpToMap: false;
      reason: LegacyResolutionReason;
    })
  | (ProjectedVisitResolutionPresentation & {
      kind: "ambiguous";
      canJumpToMap: false;
      reason: AmbiguousResolutionReason;
    });

interface ProjectedPhaseVisit {
  identity: PhaseVisitIdentity;
  visitId: PhaseVisitIdentityKey;
  locationKey: LocationKey;
  resolution: ProjectedVisitResolutionSummary;
  order: number;
  memberItemIds: readonly string[];
}

type PhaseVisitProjectionRevision = string & {
  readonly __brand: "PhaseVisitProjectionRevisionSha256";
};

interface PhaseVisitProjectionSnapshot {
  snapshotRevision: PhaseVisitProjectionRevision;
  visits: readonly ProjectedPhaseVisit[];
  byVisitId: ReadonlyMap<PhaseVisitIdentityKey, ProjectedPhaseVisit>;
  phaseVisitIdsByItemId: ReadonlyMap<string, readonly PhaseVisitIdentityKey[]>;
}

interface ProjectedVisitListRow {
  visitId: PhaseVisitIdentityKey;
  locationKey: LocationKey;
  resolutionKind: ProjectedVisitResolutionKind;
  canJumpToMap: boolean;
  displayNumber: string;
  blockLabel: string;
  resolutionReason: ProjectedVisitResolutionSummary["reason"];
  phase: VisitPhase;
  priorityLevel: VisitPriorityLevel;
  memberItemIds: readonly string[];
  memberCount: number;
  statusText: string;
}

interface ResolvedRouteVisitPoint {
  identity: PhaseVisitIdentity;
  visitId: PhaseVisitIdentityKey;
  locationKey: LocationKey;
  mapInstanceId: string;
  routeConstraintFingerprint: RoutePathConstraintFingerprint;
  markerStackKey: MarkerStackKey;
  baseCell: GridCellAddress;
  routingPort: RoutingPort;
  anchor: MapPoint;
  displayNumber: string;
  order: number;
  memberItemIds: string[];
}

interface ProjectedVisitListProps {
  rows: readonly ProjectedVisitListRow[];
  selectedVisitId: PhaseVisitIdentityKey | null;
  onSelectVisit: (visitId: PhaseVisitIdentityKey) => void;
  onInsertAfterVisit: (visitId: PhaseVisitIdentityKey) => void;
}

type SplitRouteConnectorKind = "from-anchor" | "to-anchor" | "same-cell-direct";

interface SplitRouteConnector {
  kind: SplitRouteConnectorKind;
  path: MapPoint[];
}

interface SplitRouteSegment {
  fromVisitId: PhaseVisitIdentityKey;
  toVisitId: PhaseVisitIdentityKey;
  insertionAfterVisitId: PhaseVisitIdentityKey;
  geometryKind: "path" | "same-cell-direct" | "coincident-anchor";
  routeConstraintFingerprint: RoutePathConstraintFingerprint;
  hitTestable: boolean;
  mainPath: SubcellPathNode[];
  connectors: SplitRouteConnector[];
}

type RouteResolution =
  | {
      kind: "routable";
      from: ResolvedRouteVisitPoint;
      to: ResolvedRouteVisitPoint;
      segment: SplitRouteSegment;
    }
  | {
      kind: "unroutable";
      fromVisitId: PhaseVisitIdentityKey;
      toVisitId: PhaseVisitIdentityKey;
      reason:
        | "no-routing-port"
        | "path-not-found"
        | "unsafe-connector"
        | "invalid-route-constraint"
        | "outside-route-constraint";
    };

interface SplitRouteBuildInputV1 {
  projection: PhaseVisitProjectionSnapshot;
  mapLocationIndexRevision: MapLocationIndexRevision;
  pathfindingGraphFingerprint: string;
  routePathConstraint: RoutePathConstraintV1;
}

interface HallRouteSettingsAfterImageV1 {
  storeName: "hallRouteSettings";
  key: string;
  canonicalPayloadBytes: Uint8Array;
  payloadDigest: PersistenceDigestDescriptor;
}

type ExecutionVisitOrderItemMembershipDigest = string & {
  readonly __brand: "ExecutionVisitOrderItemMembershipDigestSha256";
};

type ExecutionVisitOrderItemAssociationWitnessDigest = string & {
  readonly __brand: "ExecutionVisitOrderItemAssociationWitnessDigestSha256";
};

type ExecutionVisitOrderItemInputPayloadDigest = string & {
  readonly __brand: "ExecutionVisitOrderItemInputPayloadDigestSha256";
};

type ExecutionVisitOrderAssociationInputPayloadDigest = string & {
  readonly __brand: "ExecutionVisitOrderAssociationInputPayloadDigestSha256";
};

interface ExecutionVisitOrderItemInputPayloadV1 {
  eventInstanceId: string;
  normalizedDayKey: NormalizedDayKeyV1;
  manualHallId: string | null;
  normalizedBlockToken: NormalizedBlockTokenV1;
  originalNumber: string;
  priorityLevel: VisitPriorityLevel;
}

type ExecutionVisitOrderAssociationInputPayloadV1 =
  | {
      associationKind: "map-association";
      payload: MapAssociationIdentityInputV1;
    }
  | {
      associationKind: "hall-definition";
      payload: HallDefinitionIdentityInputV1;
    }
  | {
      associationKind: "hall-association";
      payload: HallAssociationIdentityInputV1;
    }
  | { associationKind: "hall-remap"; payload: HallRemapIdentityInputV1 }
  | {
      associationKind: "split-settings";
      payload: MapCellSplitSettingsIdentityInputV1;
    };

interface ExecutionVisitOrderItemMembershipWitnessV1 {
  storeName: "executeModeItems";
  rootRevision: ProjectionInputRootRevisionV1;
  orderedItemIds: readonly string[];
  membershipDigest: ExecutionVisitOrderItemMembershipDigest;
}

interface ExecutionVisitOrderItemAssociationWitnessV1 {
  rootRevisions: ProjectionInputRevisionVectorV1;
  items: readonly {
    itemId: string;
    canonicalPayloadBytes: Uint8Array;
    payloadDigest: ExecutionVisitOrderItemInputPayloadDigest;
  }[];
  associations: readonly {
    associationKind: ExecutionVisitOrderAssociationInputPayloadV1["associationKind"];
    associationKey: string;
    canonicalPayloadBytes: Uint8Array;
    payloadDigest: ExecutionVisitOrderAssociationInputPayloadDigest;
  }[];
  witnessDigest: ExecutionVisitOrderItemAssociationWitnessDigest;
}

type ExecutionVisitOrderPreviewDigest = string & {
  readonly __brand: "ExecutionVisitOrderPreviewDigest";
};

interface ExecutionVisitOrderCommitBaseV1 {
  eventInstanceId: string;
  normalizedDayKey: string;
  projectionRevision: PhaseVisitProjectionRevision;
  beforeExecutionVisitOrder: readonly ExecutionVisitIdentityKey[];
  afterExecutionVisitOrder: readonly ExecutionVisitIdentityKey[];
  expectedRootVector: ExpectedRootVector;
  readOnlyExpectedRoots: readonly [ExpectedStoreRoot, ...ExpectedStoreRoot[]];
  rawExecutionItemWitness: ExecutionVisitOrderItemMembershipWitnessV1;
  itemAndAssociationWitness: ExecutionVisitOrderItemAssociationWitnessV1;
  previewDigest: ExecutionVisitOrderPreviewDigest;
}

type ExecutionVisitOrderMutationCommandV1 =
  | (ExecutionVisitOrderCommitBaseV1 & {
      commandId: "fsmc.visits.reorder-execution-order.v1";
      intentKind: "manual";
      hallRouteSettingsAfterImage: null;
    })
  | (ExecutionVisitOrderCommitBaseV1 & {
      commandId: "fsmc.visits.reorder-by-hall.v1";
      intentKind: "hall-route";
      hallRouteSettingsAfterImage: HallRouteSettingsAfterImageV1;
    });

interface ExecutionVisitOrderMutationResultBaseV1 {
  executionVisitOrderAfterImage: readonly ExecutionVisitIdentityKey[];
  readOnlyExpectedRoots: readonly [ExpectedStoreRoot, ...ExpectedStoreRoot[]];
  rawExecutionItemWitness: ExecutionVisitOrderItemMembershipWitnessV1;
  itemAndAssociationWitness: ExecutionVisitOrderItemAssociationWitnessV1;
  previewDigest: ExecutionVisitOrderPreviewDigest;
}

type ExecutionVisitOrderMutationResultV1 =
  | (ExecutionVisitOrderMutationResultBaseV1 & {
      commandId: "fsmc.visits.reorder-execution-order.v1";
      intentKind: "manual";
      hallRouteSettingsAfterImage: null;
      logicalMutationStoreNames: readonly ["durable-visit-state"];
      payloadWriteStoreNames: readonly ["durable-visit-state"];
    })
  | (ExecutionVisitOrderMutationResultBaseV1 & {
      commandId: "fsmc.visits.reorder-by-hall.v1";
      intentKind: "hall-route";
      hallRouteSettingsAfterImage: HallRouteSettingsAfterImageV1;
      logicalMutationStoreNames: readonly [
        "durable-visit-state",
        "hallRouteSettings",
      ];
      payloadWriteStoreNames: readonly [
        "durable-visit-state",
        "hallRouteSettings",
      ];
    });
```

`markerStackKey`は浮動小数文字列の丸めではなく、map／block instance ID、基準番号、物理anchor種別を含むversion付きtupleから生成する。描画markerだけを同じ`markerStackKey`でまとめ、`PhaseVisitIdentity`、経路順、進行状態、hit-test候補を統合しない。route segment、hit-test、挿入anchorの参照は必ずphase visit IDとし、代表item IDや行・列だけへ戻さない。`memberItemIds`は表示・状態変更用payloadであってidentityではないため、先頭memberの削除後もmemberが残る限り同じvisit ID、座標、順序へ再解決する。

`RoutePathConstraintV1`はfunctionを持たないdata-only DTOとし、hall定義の1-based `{ row, col }`頂点をpure adapter `hallVertexToMapPointV1({ row, col }) = { x: col - 0.5, y: row - 0.5 }`で5.1の0-based連続`MapPoint`へexact 1回だけ変換する。直値利用、二重offset、x／y逆転、非finite座標を拒否し、既存Canvas描画と同じ中心座標にする。version付きpure `validateHallPolygonContractV1`をhall editor、import、Backup reader、route DTO生成の唯一のerror-level validity authorityとし、現行`src/utils/polygonValidation.ts`のproduction defaultを固定値で移植する。4頂点以上、末尾の先頭点重複なし、連続重複頂点なし、自己交差なしに加え、1-based頂点へshoelace式`abs(sum) / 2`を適用した有限面積が`area >= 4`であること、`row = 1..maxRow`／`col = 1..maxCol`の各整数cell centerを共有inclusive point predicateへ通してin-bounds covered cellが1件以上あることを必須にする。`minArea` production overrideを廃止し、overlap warningは保存UIへ返すがroute validity errorにはしない。3頂点、面積`< 4`、covered cell 0件をroute層だけで受理せず、全surfaceで同じerror code集合へ写す。頂点数を`N`とし、全`N`個のforward rotationと全`N`個のreverse rotationの計`2N`候補をそれぞれ`esp-json-v1([[x,y], ...])`へserializeし、その文字列をECMAScript UTF-16 code-unit順で比較して最小の候補を唯一のcanonical polygonとする。同じ最小座標が複数ある場合も座標1個だけでtie-breakせず列全体を比較するため、同じpolygonの開始点／向きだけの差は同一になる。`RoutePolygonFingerprint`はこのcanonical polygonを用いて3.3のdomain-separated式から再計算する。凹形状を凸包へ変換しない。`constraintFingerprint`は自身を除くconstraint全fieldを`{ domain: "fsmc-route-path-constraint-v1", constraint }`としてcanonical SHA-256化する。`whole-map`も固定tag、event、mapを含むnon-null fingerprintを持つ。route cache signatureはprojection revision、順序付きvisit ID／location、index revision、`pathfindingGraphFingerprint`、constraint fingerprintを含め、constraintが異なるcacheを再利用しない。開始点／向きの全variant、同じ最小座標が複数ある形、座標`2`対`10`、面積境界`3.999…`／`4`、covered cell 0／1件をgolden fixtureに固定し、文字列化前の数値比較やlocale比較、surface別validatorによる別canonical化／別validityを拒否する。

選択hall routeでは、全routing port／anchorがinclusive polygon内、`mainPath`の各subcell node中心と隣接node間線分、simplification後の各線分、全connectorと`same-cell-direct`の全線分がpolygon内であることを同じpure predicateで検証する。端点だけが内側でも凹部を横切る線、別hall、削除／変更済みhall revision、map不一致は失敗とする。display routeとinsert previewへ同じconstraint objectを渡し、片方だけ無制約にしない。constraint付きrouteもfingerprint込みでcache可能だが、predicateやpolygonをsignature外のclosureとして渡さない。

`PhaseVisitProjectionRevision`はwall clockや配列object identityではなく、app層が同一read snapshotから作る`ProjectionInputRevisionVectorV1`の`esp-json-v1` canonical SHA-256とする。vectorの`rootRevisions`はitem payload／実行順／`durable-visit-state`、event metadata、map association、hall definition／association／remap、split settingsについて、`ExpectedRootVector` subsetの`(storeName, key, payloadDigest descriptor, metadataRevision, checkpointDigest)`をcanonical順で持ち、未commit after-imageを投影する場合だけ`uncommittedAfterImageDigest`をnon-nullにする。`payloadDigest`は現行`PersistenceDigestDescriptor`と同じalgorithm／canonicalization／valueの3 fieldだけを投影し、別型`PersistenceSynchronousFingerprint`の`canonicalLength`を混入させない。valueはlowercase 64桁hexとする。checkpointはnullだけを`absent`、validated checkpoint全体（kind／version／storeName／key／committedRoot／absorbedCandidates／updatedAt）のcanonical SHA-256を`present`へ写す。存在しない`checkpointRevision`文字列や`committedRoot.revision`だけへ縮退せず、同じcommitted rootでも`absorbedCandidates`／`updatedAt`だけが異なるfixtureでrevision差を必須にする。pure `toProjectionInputRootRevisionV1`はobserved rootとcheckpointが同じread boundaryの場合だけ受理する。consumerはsnapshotとrevisionを一体で受け、UI callbackはvisit IDだけを返す。shellは最新snapshotでvisit IDを再解決し、revisionが変わってvisitが消えた場合はmutationを呼ばず常設statusへ通知する。保存commandは最新`ExpectedRootVector`を再検査し、stale projectionをwrite authorityにしない。I0でabsent／present、checkpoint field単独差、root順shuffle、不正descriptorのgoldenを固定し、I1でbuilder／schema／runtime exact一致、I7で同revision同値・1 root差・callback中rekeyのstale testを固定する。

`VisitIdentityInputRevision`は`revisionVector`とitems／実行順／`DurableVisitStateEntryV1`／association／hall／split after-imageのcanonical digestから導出し、全fieldが同じread boundaryに属する場合だけbuilderが受理する。snapshotはexact 1組の`(eventInstanceId, normalizedDayKey)`をscopeとし、`initialization.status = "ready"`のdurable entryと各itemのevent／day fieldは別authorityではなくscope一致を検証するwitnessである。item IDは重複なしで、`items`、`executionOrderItemIds`、`additionalPhaseByItemId`のkey集合をexact一致させる。normal所属は全execution itemへ暗黙に1件、追加phaseの唯一のauthorityはitem ID昇順のtotal tuple配列`additionalPhaseByItemId`とし、各valueは`null | postponed | late`の1値だけなので同じitemのpostponed＋late同時所属を表現不能にする。`executionVisitOrder`は投影前の全`ExecutionVisitIdentityKey`と重複なしのexact bijectionで、配列indexを唯一のdense orderとする。`ExecutionVisitOrderMutationCommandV1`はpreviewとcommitで同じinput/result schemaを使い、before／after permutation、projection、item／association、raw execution item rootをCAS再検査する。raw execution item rootはmembership競合を検出するread-only witnessであり、byte同値のためlogical mutation participant／physical writeへ含めない。manual branchはdurableだけ、hall-route branchはdurableとhall route settingsだけを実write participantへ登録する。`current`はanchorがnullでもphaseを必須保持し、non-null anchorは指定phaseに実在するitemだけを許す。durable `lastPurchaseChangeAt`はnullまたは指定phaseに実在するnon-null anchor、`savedAnchorItemIdByPhase`はnormal／postponed／lateの明示3 fieldで、non-null itemがそのphaseに属することを必須にする。`isCompleted`はboolean以外を許さない。rootの`entries`は`eventInstanceId`、`normalizedDayKey`のcanonical比較順、scope重複なしとする。公開DTOは上記exact field以外を持たず、runtime component／persistence objectをimportしない。root revision重複・欠落・非canonical順、`cross-event-item`、`cross-day-item`、`duplicate-item-id`、`execution-order-item-set-mismatch`、`durable-phase-item-set-mismatch`、`execution-visit-order-set-mismatch`、`duplicate-execution-visit-order`、`duplicate-durable-visit-scope`、`unknown-phase-anchor-item`、`anchor-item-not-in-phase`、参照不能hall／mapをbuilder入口でtyped errorにし、snapshot混在やphaseを推測補正しない。

pure `auditLegacyFocusDayScopesV1({ core, authorityRevisionSubset })`は、物理keyとsemantic raw dayを同じunionへ入れない。まず`eventLists[].eventDate`のexact値をsemantic raw tupleにし、`executeModeItems`の各ordered item IDはcoreでexact 1 itemへ解決してそのitemのexact raw dayへ帰属させる。day-mode keyとempty execution bucket keyは、同じeventのitem raw daysへ`normalizeFsmcDayKeyV1`一致する候補が0件ならその物理key自体をempty-day semantic tupleとして追加し、1件以上なら候補groupのalias observationにだけ使ってphantom raw tupleを追加しない。nonempty execution bucketの物理keyもsemantic tupleにせず、参照itemのraw day集合へstable partitionするinputとする。unknown／duplicate item ID、同じIDの複数bucket所属、event外参照は既存core preflight errorへ止め、collision repairで推測しない。このcanonical semantic domainを正規化して`LegacyFocusDayScopePreflightV1`を返し、`authorityRevisionSubset`は同じ`H0` boundaryのcore rootだけに閉じ、root既定順のcanonical unique配列とし、associationや未発行IDを含めない。`authorityRevisionDigest`はexact `{ domain: "fsmc-legacy-focus-day-authority-revision-v1", authorityRevisionSubset }`を`esp-json-v1` canonical serializeしたlowercase SHA-256とする。collision 0件なら`kind = "collision-free"`、`(eventName, rawDayKey, normalizedDayKey)`のcanonical unique `dayTuples`、`authorityRevisionDigest`、`preflightDigest`を返す。`preflightDigest`は自身を除くexact object `{ kind, authorityRevisionDigest, dayTuples }`を同じ方法でhashし、event ID／proposal／scope／`basisCoreDigest`を含めない。1件以上ならevent名／normalized day順のcanonical nonempty `LegacyFocusDayScopeCollisionWitnessV1`を返し、event instance IDを仮発行せず、capture／`Vcap` versionchange request／seed／default／loss previewを0件にして`capability-adoption-blocked`へ止める。これによりpreflight／collision witnessの全fieldとdigestは宣言されたinputだけから再計算できる。

collision-free後だけ、`proposeEventAuthorityAssociationsV1`が`H0`内のcanonical unique event名集合とexact bijectionの`EventAuthorityProposalV1`を1 attemptにつき一度生成する。runtimeはopaque ID allocatorを注入し、I0 pure fixtureは決定的allocatorを注入するため、乱数発行を含む関数自体をpureとは呼ばない。allocatorを呼ぶ前に全metadata anchorをtotal parseし、invalid eventと、同じvalid tokenを共有する全participantを一括収集する。blockerが1件でもあればeventごとに全該当reasonをまとめたcanonical `rejectedEvents`と、そのreason集合のunionである`canonicalReasons`を返し、event ID／anchor token発行、proposal、DB writeを0件にする。blocker 0件の場合だけ各entryへ未永続のlocal opaque event IDと`coreAnchorToken`を発行し、既存anchorは`anchorActions.kind = "preserve"`、欠落anchorは同transactionで作るexact metadata after-image付き`create`とする。`sourcePreflightDigest`は同じpreflightの`preflightDigest`とbyte一致させ、`attemptId`、event名／ID／anchor全行、anchor action、`resolvedAuthority`、`proposalDigest`へ拘束し、同attempt中に再発行しない。bootstrap proposalの`ResolvedEventAuthorityV1.rejectedEvents`は必ずemptyとし、`entries`はevent名のUTF-16 code-unit順、event名／event IDとも重複なしにする。`authorityDigest`は自身を除くversion tagとcanonical partition `{ entries, rejectedEvents }`全体のSHA-256であり、attempt ID、proposal digest、revision subsetはlogical authority digestへ含めない。abort／取消／stale後のretryは新attempt・新proposal・新freeze issuanceを作り、旧proposal／tokenを再受理しない。proposalは`Vcap` bootstrapと同じtransactionでassociation rootと必要なmetadata anchorへ確定するまでauthorityではない。bootstrap factoryはproposal全行と実際に書くassociation／metadata after-imageから、全core eventが`entries`側、`rejectedEvents = []`となる同じcanonical `ResolvedEventAuthorityV1`と`authorityDigest`を再構成できる場合だけcommitする。pure `loadPersistedEventAuthorityV1(input: PersistedEventAuthorityLoadInputV1)`は、同一read boundaryのcanonical unique core event名、persisted association、metadata anchor、association／anchor revision subsetを受ける。core event名の重複、event instance ID重複、unknown event名の余分なassociation／anchor、record集合破損、revision subset staleは全体`kind = "rejected"`／write 0件とする。一方、各known core eventについてassociationとanchorの全観測を先に集め、`association-missing → association-extra → anchor-missing → anchor-invalid → anchor-token-mismatch → anchor-token-duplicate`の固定enum順で該当する全reasonを重複なく保持する。reasonが0件でassociation／valid anchorがexact 1件かつtoken一致なら`entries`、1件以上なら同eventをexact 1行の`rejectedEvents`へ振り分ける。単一reasonへの優先順位縮退は禁止する。各`witnessDigest`はevent名、当該eventの全association行、valid／invalidを含む全anchor観測、共有duplicate-token groupの全participant、canonical reasonsを拘束し、`authorityDigest`もreason配列とwitnessを含む。成功`kind = "resolved"`では`entries ∪ rejectedEvents`がcore event名のexact partition、両配列内と配列間でevent名重複なしとなり、event-local不備があっても同じlogical `authorityDigest`と、観測全field＋両revision subsetを拘束する別の`authorityInputDigest`を返す。reload後はこのresolved resultだけを`eventAuthority.kind = "persisted-association"`へ渡し、proposalを再利用しない。event-local rejected eventはそのassociation／settings／entryをdormantまたはquarantinedにし、effective controlをOFF、durable scope新規作成を0件とするが、無関係なresolved eventを停止しない。pure `deriveDurableVisitScopesV1({ core, coreRootSubset, collisionFreePreflight, eventAuthority, expectedAuthorityRevisionSubset, observedAuthorityRevisionSubset })`は、`eventAuthority.kind = "bootstrap-proposal"`または`persisted-association`を判別し、preflight digest、core subset、anchor、authority digestを再検査する。`coreRootSubset`は`core`から同read boundaryで収集したexact projectionで、そのcanonical bytesから再計算した`authorityRevisionDigest`をpreflight値へ一致させる。bootstrapではさらに`sourceWitness.authorityRevisionSubset`を`coreRootSubset`へcanonical byte一致、`expectedAuthorityRevisionSubset`を同source subsetへcanonical byte一致させる。persistedのexpected subsetは`sourceWitness.associationRevisionSubset ∪ anchorRevisionSubset`のcanonical root unionとexact一致させる。`observedAuthorityRevisionSubset`はderivation呼出し直前に各branchのexpectedと同じroot tuple universeをfresh収集し、resolvedを返すにはexpectedとcanonical byte一致しなければならない。root欠落／余分／内容差を`authority-revision-subset-stale`、bootstrapのsource／core／preflight digest差を`core-authority-snapshot-mismatch`へ写す。`entries ∪ rejectedEvents`がcore event名のexact partitionの場合だけ`entries`側から`(eventInstanceId, normalizedDayKey)`のcanonical unique scopesを作り、`rejectedEvents`をbyte同値で`DurableVisitScopeDerivationV1`へ引き継ぐ。両result branchは全boundary witnessを値として返し、global record破損、partition欠落／重複、H0差、digest差ではIDを推測せずwrite 0件とする。

persisted authorityのdigestは全実装で同じdomain-separated式を使う。各event-local `witnessDigest`はexact `{ domain: "fsmc-persisted-event-authority-event-witness-v1", eventName, associationRows, anchorObservations, duplicateTokenGroups, canonicalReasons }`、logical `authorityDigest`はexact `{ domain: "fsmc-resolved-event-authority-v1", entries, rejectedEvents }`、`authorityInputDigest`はexact `{ domain: "fsmc-persisted-event-authority-input-v1", coreEventNames, associations, metadataAnchors, associationRevisionSubset, anchorRevisionSubset }`を`esp-json-v1` canonical serializeしたlowercase SHA-256とする。`associationRows`／`associations`はevent名・event ID・token順、anchor観測はevent名・kind・tokenまたはviolation・raw witness順、`duplicateTokenGroups`はtoken順かつ各participantをevent名順、reasonはenum順、root vectorは既定canonical root順にsort／uniqueする。duplicate groupは当該event以外の全participantも含める。global rejectの`rejectionDigest`はexact `{ domain: "fsmc-persisted-event-authority-rejection-v1", authorityInputDigest, canonicalReasons }`の同canonical SHA-256とする。非canonical順、重複行、観測／revision不変のdigest差、同じlogical partitionでinputだけ違うcaseをfixture化し、logical digestとinput digestを相互代用しない。

`deriveDurableVisitScopesV1`の両branchは`derivationDigest`と同じ`DurableVisitScopeDerivationBoundaryWitnessV1`全fieldを持つ。`eventAuthority.sourceWitness`はinput branchと同じ判別子を必須にし、bootstrapはexact `{ domain: "fsmc-durable-authority-source-bootstrap-v1", kind, attemptId, sourcePreflightDigest, proposalDigest, authorityRevisionSubset }`、persistedはexact `{ domain: "fsmc-durable-authority-source-persisted-v1", kind, authorityInputDigest, associationRevisionSubset, anchorRevisionSubset }`を`esp-json-v1` canonical serializeしたlowercase SHA-256へ`witnessDigest`として拘束する。bootstrap source witnessは`authorityRevisionSubset === coreRootSubset`、そのsubsetの`fsmc-legacy-focus-day-authority-revision-v1` digestが`collisionFreePreflight.authorityRevisionDigest`と一致、`expectedAuthorityRevisionSubset === authorityRevisionSubset`、freshな`observedAuthorityRevisionSubset === expectedAuthorityRevisionSubset`をすべてcanonical bytesで満たす場合だけresolvedへ進める。proposal／load resultの対応fieldと1 fieldでも異なるwitness、branchを跨ぐfield、bootstrapの`proposalDigest`を`authorityInputDigest`として代用した入力を拒否する。resolvedはexact `{ domain: "fsmc-durable-visit-scope-derivation-resolved-v1", kind: "resolved", scopes, rejectedEvents, resolvedEventBases, resolvedBasisCoreDigest, coreRootSubset, preflightDigest, eventAuthorityDigest, authoritySourceWitness, expectedAuthorityRevisionSubset, observedAuthorityRevisionSubset }`を、scope `(eventInstanceId, normalizedDayKey)`順、rejected event名順、basis event ID順、root既定順でcanonical SHA-256化する。semantic validation失敗は`kind = "rejected"`へtotalに写し、partition欠落／重複は`authority-partition-invalid`、expected／observed revision subset差は`authority-revision-subset-stale`、authority digest差は`authority-digest-mismatch`、preflightとcore／authority snapshot境界差は`core-authority-snapshot-mismatch`とし、同時に成立する全reasonをこの固定enum順のcanonical unique nonempty `reasons`へ収集する。rejectedの`derivationDigest`はexact `{ domain: "fsmc-durable-visit-scope-derivation-rejection-v1", kind: "rejected", reasons, coreRootSubset, preflightDigest, eventAuthorityDigest, authoritySourceWitness, expectedAuthorityRevisionSubset, observedAuthorityRevisionSubset }`の同canonical SHA-256とし、理由配列の先頭だけをstatus／UI authorityにしない。resultだけから両digestを再構築でき、initializerの`liveScopeDerivationDigest`は実branchのこのfieldとbyte一致させる。resolved全field単独差、両authority source branch、bootstrap source／core／preflightの1 field差、expected／observedの入替え、reason順shuffle／重複、単独4種、複合、観測不変のdigest差を拒否し、rejectedはwrite 0件にする。consumerは`kind = "resolved"`をnarrowした後だけscope／basisを読み、rejected branchを空scopeやrepair済みへ縮退させない。

`ResolvedEventAuthorityV1.entries`は`coreAnchorToken`も重複なしとする。anchor候補はraw metadataから`PersistedEventMetadataAnchorObservationV1`へtotal parseし、object形状、schema version、token、unknown propertyが不正な値を「欠落」としてcreateへ流さない。bootstrap前のinvalid anchorとduplicate valid tokenは同一scanで全eventから集めるが、各eventのmetadata anchor観測は`valid | invalid`の排他1行であり、duplicate判定にはvalid tokenだけが参加するため、`BootstrapEventAuthorityRejectionV1.reasons`はeventごとに`["anchor-invalid"] | ["anchor-token-duplicate"]`のbranded singletonとする。別eventにinvalidとduplicateが併存するときだけ全体`canonicalReasons`が両reasonのcanonical unionになる。同一eventの複合row、invalid観測をduplicate候補に流用する入力、event行重複はschema／semantic errorである。`EventAuthorityProposalResultV1.kind = "rejected"`の`rejectedEvents`はevent名順のexact partitionで、duplicate tokenは各groupの全participantをwitnessへ含める。proposal／ID再発行／`Vcap` request／capability writeは0件とする。persisted loaderではassociationとanchorの複数観測からevent-local複合理由が到達可能なので、invalidは該当event、duplicateは同token participant全件を`rejectedEvents`へ移し、複合不備を単一reasonへ落としたり片方を配列順で採用したりしない。event ID重複、unknown event record、record集合破損はevent-local ownerを安全に確定できないため引き続き全体`rejected`とする。

bootstrap前のinvalid anchorまたは重複tokenはcanonical reason集合と全participant witnessが一致する`FsmcDatabaseOpenResult.kind = "event-authority-adoption-blocked"`へ写し、現profileではtrusted core V1退避以外のwriteを許可しない。`fsmc.event-authority-adoption-blocked.v1` runbookは、invalid raw witnessまたは重複participant、両者の併発、in-place repairがないこと、退避fileのSHA-256確認、6.1.1のcoverage-verified guided clean-profile reset、clean profileへのV1 full restoreを順に案内する。V1 wireのlocal-only anchor tokenをrestore authorityにせず、clean-profile restore transactionが各eventのfresh unique event ID／anchor tokenをbounded allocatorで発行し、core payload、利用者metadata、復元後association、durable defaultを同一commitへ入れる。backup失敗、coverage不完備、確認取消、restore validation／allocator／quota失敗ではresetまたはrestoreを開始せず、各command境界で全旧または全新だけにする。split導入trace 0件のpre-adoption専用分岐なので失うsplit authorityはなく、invalid値やduplicate tokenを欠落扱い・配列順採用・上書きしない。

proposal中のevent IDまたは欠落anchor token発行でWeb Crypto unavailable、またはI0固定3回の衝突retryを使い切った場合は`EventAuthorityProposalResultV1.kind = "failed"`から`FsmcDatabaseOpenResult.kind = "event-authority-proposal-failed"`へexact mappingし、proposal／metadata／association／capability write、`Vcap` requestを0件にする。UIはallocation kindとtyped reason、再試行・trusted V1退避案内を表示し、同attempt内でfallback ID、時刻、乱数でない連番へ切り替えない。

pure `resolveLegacyFocusSessionScopesV1`は上記resolved result後だけ動き、raw legacy keyをparseせず、同じcore／resolved event authority snapshotの候補tupleごとに`buildFocusSessionKey(eventName, rawDayKey)`を再実行して`legacySessionKey`とのbyte exact一致を検査し、resolved authorityからexact 1 event instanceへ写した`LegacyFocusSessionMappingInputV1`を返す。mapping側の`authorityRevisionDigest`はcoreの`ExpectedRootVector` subsetとresolved authority全体、`mappingInputDigest`は同authority revision、全候補tuple、導出scope、0／1／複数判定をcanonical serializeしたlowercase SHA-256であり、Portは自己再計算して不一致を拒否する。candidateはevent名、raw day、instance ID、normalized dayの全fieldを持ち、expected scopeとcandidateをcanonical順・重複なしにする。present recordの`scope`と`snapshot`内scopeはbyte一致し、全expected scopeがpresentまたはabsentのexact 1行、未使用legacy keyがunmappedのexact 1行となることを必須にする。`DurableVisitScopeDerivationV1.resolvedEventBases`は`eventAuthority.entries`の全eventだけについてzero-scopeも含むevent-local core／authority digestを持つcanonical exact bijectionであり、rejected／retired basisを含めない。`resolvedBasisCoreDigest`はexact `{ domain: "fsmc-durable-resolved-core-basis-aggregate-v1", eventDigests: [{ eventInstanceId, basisCoreEventDigest }] }`をresolved event ID順にhashする。initializer／writerはこのper-event row集合を検証済みprior rejected／retired basisとdisjoint unionしてから、最終rootの別field `basisCoreDigest`／`basisEventAuthorityDigest`を6.0のaggregate式で計算し、両digestを直接比較・流用しない。event ID未発行のpreflightでは作らず、event名とvolatile phase／index／saved position／postponed／late／completion／purchase入力を含めない。resolved＋rejected＋retired混在、同ID overlap、prior row欠落、resolved aggregateをfinal aggregateへ流用するfixtureを拒否する。`LegacyFocusSessionSnapshotV1.stateDigest`は`stateDigest`自身を除くlegacy key、scope、process-global safe-integer `sessionRevision`、全`state` fieldのcanonical SHA-256で、migration previewの`legacySessionInputDigest: string | null`へ分離する。`unmappedRecordDigest`はexact object `{ kind: "unmapped", legacySessionKey, sessionRevision, state, reason }`を同じcanonical serializerでSHA-256化したlowercase 64桁hexとし、scopeを仮定しない。`FrozenLegacyFocusSessionRegistryV1.tokenDigest`は`tokenDigest`自身を除く`freezeIssuanceId`、registry generation、mapping digest、全導出scopeのpresent／absent exact partition、全unmapped recordをcanonical順で拘束する。Portのprocess-local ledgerはissuance ID、token digest、`LegacyFocusSessionTokenStatusV1`を持ち、`assertFrozen`はexact 1 active rowだけを受理し、`invalidate`／`consumeAfterCommit`はactiveから一度だけ遷移して逆行・再active化を拒否する。

pure `deriveDurableVisitInitializationStateV1`は永続root、live core derivation、persisted event authorityから`DurableVisitInitializationStateV1`を作る。保存rootとderived `migrating | ready`の双方が同じcanonical `eventBases`を返す。initializerはscope derivationの`resolvedEventBases`と、root／checkpoint／fence・partition digestを検証済みのprior rejected／retired basisをevent ID重複なしのdisjoint unionにしてfinal `eventBases`を作る。`DurableVisitInitializationV1.eventBases`は`eventNameAtBasis`と`eventInstanceId`がともにuniqueなcanonical配列で、各行のcore event slice digestとauthority entry digest、aggregate `basisCoreDigest`／`basisEventAuthorityDigest`を相互再計算できなければroot全体を`repair-required`にする。root欠落だけをwitness付き`missing`とする。`migrating`ではresolved eventの全導出scopeをpending／mapped／absentへexact partitionする。rejected eventは、対応する保存entryが0件の場合に限りprior event basis 0件と`priorEventInstanceId = null`を許し、prior basisがある場合はentry 0件でもstring branch、保存entryが1件以上なら全entryを同じprior event IDへ帰属させるevent basis exact 1件を必須にして`DurableVisitRejectedEventPartitionV1`へ移す。prior basis複数、basis 0件なのに帰属候補entryあり、未知IDへ跨るentryは局所化不能とする。`ready`ではresolved eventごとに現在scopeと同event IDのactive entriesをexact bijectionにし、各eventのbasis digestを一致させる。rejected eventの既存entriesはbyte不変のquarantined partitionとして保持し、projection、V2 export、通常FSMC command、control enableの対象から除外するが、全件のcount／digestをderived witnessへ含める。これらのlocal partitionを一意に作れる場合、global current authority digestが保存時aggregateと異なることだけを全体`repair-required`にせず、無関係なresolved eventは`ready`のまま継続する。resolved eventのbasisが0件／複数、rejected eventが上記0件例外を満たさない、resolved eventのscope欠落／余分／重複、非局所化core差、未解決legacy session、counter exhaustionはreason／witness付き`repair-required`とする。persisted rootの`DurableVisitInitializationV1`は`migrating | ready`だけを保存し、derived `missing | repair-required`をrootへ捏造保存しない。bootstrap時はproposalとassociation after-imageから全eventの`eventBases`と両aggregate digestを作り、reload後はpersisted associationのresolved／rejected partitionからevent単位に再検証する。true fresh以外の`migrating`はmigration preview／commitだけの非公開状態、`missing`／`repair-required`は6.1のrecovery-requiredとする。初版のrejected partitionは診断表示だけのread-only quarantineとし、再関連付け／個別削除／通常Backup V2 export commandを登録せず、通常public edgeを0件にする。復旧は定義済みtrusted core退避＋coverage-verified profile runbookへ限定する。

`persistedRootDigest`はroot payloadがある場合、full `DurableVisitStateRootV1`の`schemaVersion`、persisted `initialization`、全`entries`、全`retiredEventPartitions`をexact `{ domain: "fsmc-durable-visit-persisted-root-v1", root }`として`esp-json-v1` canonical serializeしたlowercase SHA-256、root absentまたはschema parse不能ならnullとする。構造parse後にsemantic invariantだけが壊れたrootはhash可能なのでnon-nullとし、`ExpectedRootVector`のpayload descriptor／metadata revision／checkpoint digestとは相互代用しない。derived initialization witnessはbranch別domain-separated exact objectとする。`missing.witnessDigest`は`{ domain: "fsmc-durable-visit-initialization-missing-v1", status, reason, persistedRootDigest: null, liveScopeDerivationDigest }`、`migrating.witnessDigest`は`{ domain: "fsmc-durable-visit-initialization-migrating-v1", status, persistedRootDigest, liveScopeDerivationDigest, basisCoreDigest, basisEventAuthorityDigest, eventBases, pendingScopeCount, unmappedRecordCount, rejectedEventPartitions, retiredEventPartitions }`、`ready.witnessDigest`は`{ domain: "fsmc-durable-visit-initialization-ready-v1", status, persistedRootDigest, liveScopeDerivationDigest, basisCoreDigest, basisEventAuthorityDigest, eventBases, entryCount, activeEntryCount, quarantinedEntryCount, retiredEntryCount, rejectedEventPartitions, retiredEventPartitions }`を同canonical SHA-256とする。countは0以上のsafe integer、eventBases／partitionは宣言済みcanonical順・uniqueとする。readyではactive、rejected-quarantined、retiredのentry sliceがroot `entries`のdisjoint exact partitionで、`retiredEntryCount = sum(retiredEventPartitions[].retainedEntryCount)`かつ`activeEntryCount + quarantinedEntryCount + retiredEntryCount = entryCount = root.entries.length`を必須にする。repair evidenceは`DurableVisitInitializationRepairWitnessInputV1`のexact unionとする。schema parse不能な`unparseable-root`は`persistedRootDigest = null`、raw observation digest non-null、semantic witness／typed event・partitionをnullにする。schema parse後のsemantic不正は`parsed-untrusted-root`、full root digest non-null、raw digest null、違反path／kind／value digestのcanonical nonempty `semanticViolationWitnesses`を持ち、未信頼のtyped event・partitionをnullにする。両untrusted branchのreasonsは固定順の`[durable-root-untrusted]`または`[durable-root-untrusted, counter-exhausted]`だけとし、root trustがない状態で他4種のroot由来reasonを推測しない。`trusted-localizable-root`だけがempty semantic witnessとtyped canonical arraysを持ち、reason集合から`durable-root-untrusted`を除外する。全branchで`counter-exhausted`がreasonにあるiff `counterWitnesses`は対応する`LegacyFocusSessionRuntimeRepairStateV1` exact 1行、ない場合はemptyとし、root parse不能とprocess-local counter exhaustionの併発も表現する。repairの`witnessDigest`はexact `{ domain: "fsmc-durable-visit-initialization-repair-v1", status: "repair-required", liveScopeDerivationDigest, evidence: { evidenceKind, reasons, persistedRootDigest, rawRootObservationDigest, semanticViolationWitnesses, eventBases, rejectedEventPartitions, retiredEventPartitions, counterWitnesses } }`の同canonical SHA-256とする。全initialization branchと3 repair evidence branchで各field単独差、root payload digestとExpectedRoot descriptorの取り違え、parse不能rootへの架空typed array、semantic不正rootの空違反集合、trusted rootのnull array、digestだけの差、到達可能な単独／複合reason、reason順shuffle／重複、event-local partitionを変えずdigestだけ差し替えるfixtureを拒否し、先頭reasonだけをrunbook authorityにしない。

`EventMetadataAnchorActionV1.kind = "create"`はactual `metadataAfterImage`を持ち、`metadataAfterImageDigest`は自身を含まないexact `{ eventName, metadataAfterImage }`のcanonical SHA-256とする。preserve actionもH0のevent metadata object digestを持つ。`EventMetadataRootAfterImagePlanV1.expectedBeforeRoot`は同じH0の`("eventMetadata", "data")` exact 1 descriptor、`beforeRootPayloadDigest`はそのfull `Record<string, EventMetadata>`、`afterRootPayload`はH0 payloadへ全create actionをevent名順に適用し、preserve eventとanchor以外のfieldをbyte維持した実payloadである。`afterRootPayloadDigest`と`EventAuthorityProposalV1.eventMetadataRootAfterImageDigest`はこのactual full payloadのcanonical SHA-256へbyte一致させる。per-event digestだけからaggregate digestを合成したり、digestをpayload代わりにfactoryへ渡したりしない。`mutationRequired`はcreate actionが1件以上の場合だけtrueとし、trueならactual anchor mutation rootはexact 1 tuple `("eventMetadata", "data")`、factory write、participant、historical evidence after-imageを`afterRootPayload`へbyte一致させる。preserveだけならafter payloadはbeforeとbyte同値、root tupleをparticipantへ加えず、byte同値`put`を行わない。proposal digestはaction、expected before、actual after payload／digest、mutation flagを含め、不整合fixtureを拒否する。

`DurableVisitInitializationStateV1.rejectedEventPartitions`は、保存済み`entries`／`eventBases`と同一revisionのpersisted authority rejectionから毎回導出するwitnessであり、`DurableVisitStateRootV1`へserializeしない。永続rootが保存するpartition行は旧版削除を表す`retiredEventPartitions`だけとし、rejected witnessのpayload／digestをcommit participantやroot fieldとして捏造しない。

partition digestは同じdomain-separated canonical SHA-256へ固定する。entry sliceはfull `DurableVisitStateEntryV1`を`(eventInstanceId, normalizedDayKey)`順にsortした重複なし配列とする。rejectedの`retainedEntriesDigest`はexact `{ domain: "fsmc-durable-rejected-retained-entries-v1", eventName, priorEventInstanceId, entries }`、`witnessDigest`はexact `{ domain: "fsmc-durable-rejected-event-partition-v1", authorityRejection: { eventName, reasons, witnessDigest }, priorEventBasis, retainedEntryCount, retainedEntriesDigest }`をhashする。`priorEventBasis`は`priorEventInstanceId = null`ならnullかつentry／eventBasesとも0件、stringなら同IDの`DurableVisitEventBasisV1` exact 1行であり、string branchはentry 0件も許す。retiredの`retainedEntriesDigest`はexact `{ domain: "fsmc-durable-retired-retained-entries-v1", eventNameAtBasis, eventInstanceId, entries }`、`retirementWitnessDigest`はexact `{ domain: "fsmc-durable-retired-event-partition-v1", reason, eventBasis: { eventNameAtBasis, eventInstanceId, basisCoreEventDigest, basisEventAuthorityEntryDigest }, retainedEntryCount, retainedEntriesDigest, legacyTransitionWitnessDigest }`をhashする。`legacyTransitionWitnessDigest`は固定旧版A delete classifierが検証したexact transition witnessである。rejected配列はevent名順・unique、retired配列は`(eventNameAtBasis, eventInstanceId)`順・両field uniqueとする。retired rowと同IDのretired `eventBasis`はexact bijection、各rowの`retainedEntryCount`／`retainedEntriesDigest`は同IDのpossibly-empty entry sliceとexact一致させ、全retired entryはexact 1 rowへ帰属させる。zero-entry retired rowをvalid fixtureに含め、非canonical entry／partition順、重複、null＋entry、string＋basis 0／複数、count差、entry payload差、authority／legacy transition witness差、digestだけの差をfixtureで拒否する。

collision branchで0件とする`DB open`は採択済み`Vcap`へのversionchange requestとcapability store open／createを意味する。既存core versionをread-onlyで開いて`CorePersistenceSnapshot`とcollision witnessを作ること、および専用repair commandの明示core writeは許可する。

`LegacyFocusSessionOperationLeaseV1`の`operationGeneration`はprocess-global safe integerとして発行ごとに単調増加する。`transitionDigest`はexact `{ domain: "fsmc-legacy-focus-session-transition-v1", transition }`、`leaseDigest`はexact `{ domain: "fsmc-legacy-focus-session-operation-lease-v1", operationScope, operationGeneration, registryGenerationBefore, registryGenerationAfter, transition, transitionDigest }`を`esp-json-v1` canonical serializeしたlowercase SHA-256とし、digest自身やledger statusを入力へ含めない。`operationScope.kind = "event"`はassociation確定後の通常rename／delete／pruneに対するexact 1 event instance、pre-adoptionの`profile-repair`はraw-day repairが変更するexact event名のUTF-16 code-unit順・uniqueなnonempty全体だけを表し、未発行event IDを要求しない。`transition.kind = "raw-day-rekey"`は同じ`LegacyFocusDayScopeRepairPlanV1.planDigest`、planのfull `LegacyFocusSessionRepairKeyTransitionV1`配列、そこから投影したdistinct physical source recordのtotal `keyPairs`を拘束する。source／targetのpresence、`sessionRevision`／`stateDigest`、occupant identityがplanと一致し、`keyPairs`が`transitions`のexact projectionである場合だけ取得できる。`transition.kind = "rename"`もrename前の算出済みlegacy Focus key domainと`keyPairs`をexact一致させ、domain 0件のeventだけempty配列を許し、1件以上でempty／partialを許さない。raw-day-rekeyも対象recordが0件のときだけempty transition／key pairを許し、partial event名集合、重複名、重複from／to、plan外key mutationを拒否する。

`beginLifecycleOperation`は例外やbare leaseではなく`LegacyFocusSessionOperationLeaseAcquisitionResultV1`を返す。scope busy、registry generation差、source差、target差、monotonic generationで検出したABA、transition不正は対応するtyped `reason`、operation counter上限は同reasonの`runtimeRepairState`を返し、いずれもDB write、Focus session record mutation、lease ledger transitionを0件にする。成功だけがledgerへ`none → active`の1 transitionを記録してleaseを返す。Port内のlease ledgerは`(operationScope, operationGeneration)`、lease digest、`LegacyFocusSessionOperationLeaseStatusV1`をexact 1行で保持する。`completeLifecycleOperationAfterPersistence`はexact active leaseかつ現在registry generationがbefore値の場合だけFocus session record after-imageを一度適用して`active → completed`へ進め、`abortLifecycleOperation`はcore persistenceが成功していないexact active leaseだけをFocus session record byte不変のまま`active → aborted`へ進める。したがってcommit拒否resultの`focusSessionRecordMutations: 0`はsession record after-imageだけを数え、取得後失敗では別fieldの`leaseLedgerOutcome.kind = "aborted"`と`transitionCount = 2`が`none → active → aborted`を表す。取得前拒否は`not-acquired`／0 transitionである。二重complete／abort、abort後complete、complete後abort、旧lease replay、generation／transition／digest不一致はFocus session record mutationとlease ledger transitionの双方0件で拒否し、completed／abortedをactiveへ戻さない。`operationGeneration`を含む3 counterの上限は各exact exhaustion reasonへ一意に対応し、`LegacyFocusSessionRuntimeRepairStateV1`をprocess-localにlatchして発端mutation、DB write、token発行、黙示defaultを0件にする。この状態を永続`DurableVisitInitializationV1`やpartial-loss snapshotへ偽装せず、migration診断とtrusted core V1退避だけを許す。

`ProjectedVisitResolutionSummary`はopaque `LocationKey`を再parseせず`ItemSpaceResolution`からprojection時に作る。mappedは一意なmap authorityを解決済みの場合だけ成立して`canJumpToMap: true`、他3 kindはreason型と`canJumpToMap: false`を判別可能unionで固定する。pure `toProjectedVisitListRows(snapshot, formatter)`は各visitのsummaryとphase／priority／memberだけからrowを作り、formatterはreason codeをlocalized `statusText`へ変換する。ambiguous候補、missing manual hall、maplessを文字で区別し、不正なkind／reason／jump組合せをcompile-time negative fixtureで拒否する。

集約後の`ProjectedVisitResolutionSummary`は代表memberや元itemのraw fieldから選ばず、canonical `SpaceIdentity`と同じ`VisitIdentityInputRevision`のresolver結果だけから導出する。同じ`ExecutionVisitIdentity`へ属する全memberはbyte-identicalなsummaryを生成しなければならず、1件でも異なる場合はbuilder全体をtyped `inconsistent-resolution-summary`で拒否してprojectionを返さず、mutationはwrite 0件、UIは常設statusへ理由を表示する。member順shuffle、先頭member削除、destination統合でもsummaryが不変であるproperty testをI1で固定し、I7 Exitで実data adapterに対して再実行する。

`PhaseVisitProjectionSnapshot`は、`visits`の`visitId`が重複なし、`order`が配列indexと一致する`0..n-1`、各`memberItemIds`がnonempty・重複なし・raw実行順、`byVisitId`が`visits`とのexact bijection、`phaseVisitIdsByItemId`のkey集合が全member item IDのexact集合で、各valueが`visits`を順に走査して当該itemを含むvisit IDを得た重複なし配列とする。存在しないvisit／item、余分・欠落index、別object内容、非canonical順をbuilderのunit／property testで拒否する。I1はinvariant contract、I7 Exitは最大800投影とrekey／member削除after-imageで同じinvariantを実行し、consumerは独自indexを作らない。

`SubcellPathNode`は新しい公開route DTOであり、現行`src/types/map.ts`のA\*探索用`PathNode`とは別型である。I10で既存型を`AStarSearchNode`へ改名してpathfinding module内部へ閉じ、`findPath`、現行`RouteSegment`、`MapRoutePoint`、`mapViewRouteCalculations`、`mapRouteHitTest`、`focusRouteCalculation`、route cache signatureを同じmigration PRで`SubcellPathNode`／`SplitRouteSegment`へ接続する。I10までは現行route modelを独立維持し、未定義のroute型やproduction compat変換を追加しない。I10の同一PRで全callerを新型へ直接置換し、逆変換、row／colの小数pathを新APIへ渡すこと、両`PathNode`名の同時export、旧`RouteSegment`のproduction caller残存をarchitecture testで拒否する。

現行`MapVisitListPanel`が所有するのはopen／closeと行button描画であり、projection内製、row／col callbackをI8で除去する。同component名をopen／close、選択event、filter、virtualized list状態、focus restoreを所有するshellへ拡張し、pureな`ProjectedVisitList`を内包する。`ProjectedVisitList`は上記propsだけを受け、選択時は`PhaseVisitIdentityKey`だけを返す。shell／callerは最新projectionからlocationを再解決し、staleなrow／col、代表item ID、重複した`LocationKey` payloadをcallback authorityにしない。

共有projectionは各`ExecutionVisitIdentity`にnormalを必ず1件作り、postponed／lateは該当memberが1件以上ある場合だけ追加する。出力のglobal順はphase-majorのnormal→postponed→late、各phase内は`executionVisitOrder`の配列順とし、重複、欠落、余分keyをsort tie-breakで救済せず入力不正として拒否する。1 itemは追加phaseを高々1個しか増やさないため、3.13の400 item／400 execution visit fixtureでは全phase合計最大800、各phase最大400となる。異なるmemberにより同じexecution identityへpostponedとlateの両方が生じることは許すが、1 itemを両方へ二重投影しない。rekey先identityが既存ならそのorderを維持してmember末尾へ移す。新identityで変更元にmemberが残る場合は変更元直後、変更元が空になる場合は変更元slotを継承し、同じanchorへ複数destinationが生じる場合はbefore snapshotの最小source order、次にcanonical execution key順で並べ、変更元以外の相対順を保ったまま全体をdense配列へ再構成する。利用者が明示した挿入anchorはdestination identityが未存在の場合だけその直後へ適用し、既存destinationでは無視して統合通知する。

## 6. 保存と旧版互換

persisted authorityのglobal rejectionも単一reasonへ短絡しない。`duplicate-event-name → duplicate-event-instance-id → unknown-extra-event-record → authority-record-set-corrupt → revision-subset-stale`の固定順で、該当する全reasonをcanonical unique nonempty集合へ収集する。`authorityInputDigest`は全入力観測とassociation／anchor revision subset、`rejectionDigest`はその値とcanonical global reasonsを拘束し、reason配列の先頭だけをstatus、UI、runbook authorityにしない。順序shuffle、重複、観測またはrevisionを変えずdigestだけ差し替えた入力をschema／semantic fixtureで拒否する。

bootstrap前のinvalid anchor／duplicate token blockerでは、`EventAuthorityProposalResultV1.kind = "rejected"`の`rejectionDigest`を、digest自身を除くexact `{ domain: "fsmc-event-authority-proposal-rejection-v1", canonicalReasons, rejectedEvents: [{ eventName, reasons, witnessDigest }] }`の`esp-json-v1` canonical SHA-256へ固定する。`rejectedEvents`はevent名順、各reasonsは上記branded singleton、全体`canonicalReasons`だけをenum順のcanonical unique nonempty集合とする。各event-local `witnessDigest`はexact `{ domain: "fsmc-event-authority-proposal-event-witness-v1", sourcePreflightDigest, eventName, anchorObservation, duplicateTokenGroups, reasons }`の同canonical SHA-256とする。`anchorObservation`は`{ kind: "valid", token } | { kind: "invalid", violation, rawWitnessDigest }`、`duplicateTokenGroups`はvalid token順かつ各participantをevent名順にした全関係groupで、invalid rowではempty、duplicate rowでは当該token group exact 1件とする。open resultの`canonicalReasons`と`proposalRejectionDigest`を内包proposal rejectionの同名集合／`rejectionDigest`へbyte一致させる。invalid単独、duplicate単独、別event群での両者併発、同一event複合rowのschema拒否、全体reason順shuffle／重複、anchor観測／participant欠落・余分、観測不変のwitness差、outer digestだけの再計算をI0 fixtureへ固定し、配列先頭だけでterminalやrunbookを選ばない。

固定旧版Aによるevent削除は新版の明示delete commandと区別する。generic authority loaderより先にfixed legacy transition classifierが、previous fenceのexact 1 association／event basisとcurrent coreのevent消失をmanifestへ一致させる。説明可能な場合だけ内部rebaseが`data`／`control`／`durable-visit-state`を必須participantにし、current associationとenabled membershipを除去し、split entryを既定retained状態へ移し、durable entryと対応basis 4 fieldをbyte保持した`DurableVisitRetiredEventPartitionV1` exact 1行を作る。rootのretired rowとretired `eventBasis`は同event IDでexact bijectionとし、各rowのcount／digestを同IDのpossibly-empty entry sliceへ一致させ、全retired entryをexact 1 rowへ帰属させる。これらはprojection、通常V2 event export、enable、C2／C3、通常mutationから除外する。初版は診断画面のread-only retired表示だけを提供し、個別退避／再関連付け／削除commandを登録しない。reloadではcurrent coreにないbasisをretired rowからだけ局所化し、retired rowなし、同名再作成、basis 0／複数、entryが別IDへ跨る場合はglobal repair-requiredとする。新版の確認済みevent deleteはretired化せず、core、association、control、split retained policy、durable slice、event basisを宣言どおり同一commitで除去する。旧版deleteを通常loaderのunknown-extra associationへ先に渡したり、自動的にdurable entryを削除したりしない。

durable basis digestの合成規則はdomain tag付き`esp-json-v1` canonical SHA-256へ一つに固定する。canonical `eventBases`集合はcurrent resolved rowとbyte保持したprior rejected／retired rowのdisjoint unionであり、保存entryも帰属候補も0件のrejected eventに限るbasis 0行例外はこの集合へ入れない。current resolved eventのcore projectionはevent-level exact `{ eventInstanceId, visitIdentityCoreInputDigest }`とする。`visitIdentityCoreInputDigest`はpure `deriveVisitIdentityCoreBasisInputV1`が同じafter-imageから作るevent全体の`VisitIdentityCoreBasisInputV1`をexact `{ domain: "fsmc-visit-identity-core-input-v1", input }`としてhashしたcanonical SHA-256であり、scope-local digestを各scopeへ反復しない。zero-scope eventも`VisitIdentityCoreBasisInputV1.scopes = []`の入力とprojection exact 1行を持ち、scope追加／削除はevent-level digestを変える。authorityは`config/fsmc-visit-identity-core-basis.schema.json`と上記DTOで、scopeをnormalized day順、itemsをitem ID順、association／hall／remap／split inputを各identity DTOのcanonical key順にsort／uniqueし、`executionOrderItemIds`だけはraw順を維持する。leafはitem ID／event instance／normalized day／`manualHallId`／normalized block token／original number／priority、map association、hall definition／association／remap、split identity inputの上記exact fieldだけで、unknown fieldを拒否する。event表示名、metadata revision、runtime object全体の暗黙spread、durable entry／aggregate自身は含めない。`VisitIdentityInputSnapshot`から`durableVisitState`／revision bookkeepingを除いたidentity field集合とschemaの双方に対するadapter exhaustiveness testをI0で固定し、resolver inputを追加するPRはDTO、schema、adapter、digest fixtureを同時更新する。resolved rowの`basisCoreEventDigest`はlive projectionからexact `{ domain: "fsmc-durable-core-event-basis-v1", projection }`を再計算し、prior rejected／retired rowはroot／checkpoint／fenceと保存row自身を検証した後、そのbyte保持済みper-event core digestを使う。aggregate `basisCoreDigest`はexact `{ domain: "fsmc-durable-core-basis-aggregate-v1", eventDigests: [{ eventInstanceId, basisCoreEventDigest }] }`をevent ID順にhashする。event名だけのrenameはcore projectionを変えないが、number／block／side入力／priority／`manualHallId`／map／hall／split identity inputの単独差は必ず変える。`basisEventAuthorityEntryDigest`はexact `{ domain: "fsmc-durable-authority-event-basis-v1", projection: { eventNameAtBasis, eventInstanceId, coreAnchorToken } }`をhashし、resolved rowはcurrent authorityから再計算、prior rejected／retired rowは同じ検証済み保存digestを使う。aggregate `basisEventAuthorityDigest`はexact `{ domain: "fsmc-durable-authority-basis-aggregate-v1", eventDigests: [{ eventInstanceId, basisEventAuthorityEntryDigest }] }`をevent ID順にhashする。両aggregateの`eventDigests`は同じcanonical `eventBases`集合とそれぞれexact bijectionであり、同じevent ID順を使う。これによりraw prior projectionをcurrent authorityから再構成できないrejected／retired行もaggregateを再計算できる。unaffected行はper-event digestを保持し、rename／create／delete／restoreまたはidentity-bearing after-imageで変わる行だけを置換する。core／authority間またはevent／aggregate間のdomain tag流用、両aggregateのevent集合差、event IDとdigestの組替え、resolved zero-scope省略、basis 0例外の架空行、identity field差でdigest不変、aggregateだけ更新、rejected／retired rowをcurrent authorityから捏造する実装をfixtureで拒否する。

### 6.1 IndexedDBと`Vcap`／supported上限の事前判定

初期案は`DB_VERSION`を5から6へ上げ、`mapCellSplitSettings` object storeを追加する。ただし、現行契約はDB5を現行、DB7を前方互換上限としており、DB7の実利用profileが存在しないことは証明されていない。DB7ではversion 6の`onupgradeneeded`が走らないため、新storeを無条件の必須storeにすると起動不能になる。

FSMC-I0ではproduction起動経路を変えず、DB capability decision table、fixture、pure preflight harnessを実装する。I2で同じcontractをintegration harnessとnon-promotable QA database namespaceへ接続し、I2～I10のproductionはDB5のままopen／create write 0件を検証する。I11 release-ready candidateでだけproduction起動preflightと`DB_VERSION=Vcap`を同時に有効化する。

- DBなし、現行core DB version、`Vcap - 1`、`Vcap`から`supportedMaximumVersion`までの各整数versionについて互換storeあり・欠落・非互換、`supportedMaximumVersion + 1`のfixtureを重複排除して自動テストする。現行の5／6／7／8 fixtureは同じparameterized generatorから生成する
- 新版の起動preflightは現在の端末内でDB versionとstore capabilityだけを判定し、結果やpayloadを外部収集しない
- capability判定結果は現在sessionの診断表示に使用できるが、外部送信、運用receipt、利用者追跡へ使用しない
- I0はまず候補versionの排他性と配布provenanceを証明して`Vcap`を固定する。`config/fsmc-db-version-provenance.json`はauthoritative release／artifact ledgerのhash、completeness boundary、source SHA、DB名、DB version、object-store schema fingerprint、data class、`distributed | verified-never-distributed | unknown`、evidence IDをexactに持つ。少なくともcommit `81795770cca30c68bb1526f989dcd7ab0af1edb4`の同名DB6／`memberRouteItems`を必須conflict fixtureとし、branch名やtag欠落を未配布の証拠にしない。distributedまたはunknown conflictが1件でもあれば候補versionを採択せず、代替ADRがversion、supported上限、decision table、fixture、runbookを一括更新するまでI0 ExitとI2を閉じる
- present `dbVersion < Vcap`かつsplit導入trace 0件のprofileでは、open request前のcore-only `H0` boundaryから`auditLegacyFocusDayScopesV1`を実行する。`legacy-focus-day-scope-collision`ならevent名基準のcanonical witness付き`FsmcDatabaseOpenResult.kind = "capability-adoption-blocked"`を返し、旧DB version／store／dataをbyte不変に保ってversionchangeを開始しない。`collision-free`の場合だけevent authority proposalを1 attemptにつき一度作り、同じcore subset／proposalから`deriveDurableVisitScopesV1`を実行する。true freshの`dbVersion === null`はexternal core absenceとempty `dayTuples`を再検査し、空event authority／scopeを同じfactoryへ渡す。resolved `scopes`、`resolvedEventBases`、`resolvedBasisCoreDigest`、`eventAuthorityDigest`、proposal digest、anchor actionをfactory inputへ固定し、factoryは検証済みprior rejected／retired basisとのdisjoint unionからfinal `eventBases`、`basisCoreDigest`、`basisEventAuthorityDigest`を再計算する。resolved aggregateをfinal aggregateへ直接流用しない
- verifierが採択した`Vcap`について、split対象の導入traceが外部precheckとversionchange transaction内再検証の両方で0件の場合に限り、既存profileの`onupgradeneeded`は新store、同attemptのevent authority proposalを含む`data`、`control`／`durable-visit-state`／`event-settings`／`event-settings-bridge`のfactory payload、全非fence governed rootのtotal historical evidence、その全行digest、実write集合とexact一致するparticipant digest、全governed rootのexternal baselineを持つinitial fence、全6 capability rootのmetadata／checkpointを原子的に作成する。present既存profileはscope 0件でもunmapped Focus recordの有無を移行で確定するため、durable rootを`initialization.status = "migrating"`、`entries = []`、bootstrap時の両basis digestとする。legacy external coreもないtrue fresh profileかつscope 0件だけは`ready`、空entries、空scope digestとする。新規DBの0→`Vcap`も同じinstrumented bootstrap factoryを使い、proposalをtransaction外authorityとして先行採用しない
- `databaseTargetMode = "core-current"`では、true fresh DBなし、またはpresent `dbVersion < Vcap`で新storeもsplit recovery traceもなく、day preflightがcollision-freeのprofileだけを未導入の`core-only` terminalとして従来機能へ渡せる。Vcap target modeの同じresolved inputは0→`Vcap`またはpre-`Vcap` upgradeへ進める。present pre-`Vcap`のraw day collisionを`core-only`へ畳まず専用`capability-adoption-blocked`へ止め、DBなしでlegacy coreが見つかった場合は先にcore materializationへ戻す
- `Vcap <= dbVersion`かつschema互換な新storeが存在する場合は、supported上限内でDB versionを変更せず通常経路を使用する
- `Vcap <= dbVersion`なのに新storeが欠落する場合は、DB version自体をdurable introduction witnessとして、split用metadata、checkpoint、fallback candidate、metadata anchorが一切なくても部分欠損の自動安全モードとBackup復旧案内へ進む。未導入profileとみなして空storeを再作成しない。store shape・root schemaが非互換な場合も同じ安全境界にする
- 採択された`Vcap`以上かつsupported上限以下を上記2分岐、上限超過をデータ変更なしのunsupportedとして拒否する。候補を承認できない場合はI2を停止し、別ADRで新しい一方向導入証跡とsupported上限を決めてからこの表・fixture・復旧手順を一括更新する

新storeの初期契約:

- `keyPath`: なし
- `autoIncrement`: false
- payloadレコードキー: `data`（空のassociation／event配列を持つ`MapCellSplitSettingsRoot`）、`control`（device OFF、enabled event ID 0件の`MapCellSplitControlRoot`）、`durable-visit-state`（present既存profileはscope 0件を含め`migrating`＋空entries、legacy external coreもないtrue fresh profileだけ`ready`＋空entriesの`DurableVisitStateRootV1`）、`event-settings`（canonical `EventSettingsRootV1`）、`event-settings-bridge`（常在する`EventSettingsBridgeRootV1`）。内部key `FSMC_EXTERNAL_CANDIDATE_FENCE_KEY`にはbootstrap時の候補vector付きtotal historical evidence、その全行digest、`committedParticipantRoots`、同集合のdigest、root別external digestを持つinitial fenceを保存する。6 keyと各metadata／checkpointはstore作成と同じversionchange transactionで必ず初期化する。bridge／fenceはBackup payloadへ含めず、`ready`の`durable-visit-state`だけをportable wireへ変換して含める
- 既存永続化契約に従うmetadata／checkpoint／recovery candidateは`(storeName, key)`ごとに管理し、payload objectへ埋め込まない
- `mapData`本体へ分割項目を追加しない
- capability判定前に新storeをcoreの無条件必須store一覧へ追加しない
- capability判定を無視して採択済み`Vcap`または`supportedMaximumVersion`を飛び越えない
- 旧版へ戻すときもDB版を下げず、storeを削除しない

store集合を次の2層へ分ける。

- core stores: 現行の従来機能が必須とするstore。全profileで従来どおり検証する
- capability store: `mapCellSplitSettings`。preflightが互換と判定した場合だけsnapshot型、load／save、atomic transaction、recovery、checksum対象へ加える

現行`src/app/ports/PersistenceCommandPort.ts`の10-section `PersistenceSnapshot`は`CorePersistenceSnapshot`というimport aliasでそのまま使う。FSMCの起動判定結果は次の`FsmcPersistenceSnapshot`へ分け、runtimeの`AppData`へ設定を無条件に追加しない。

```ts
type FsmcStoreName = StoreName | "mapCellSplitSettings";

type FsmcObservedRevisionRoot = Omit<ObservedRevisionRoot, "storeName"> & {
  storeName: FsmcStoreName;
};

type FsmcRecoveryCandidateIdentity = Omit<
  StartupRecoveryCandidateIdentity,
  "storeName"
> & {
  storeName?: FsmcStoreName;
};

type FsmcRecoveryCandidatePhysicalLocation =
  | {
      authority: "indexeddb-transactional";
      storeName: FsmcStoreName;
      recordKey: string;
    }
  | {
      authority: "external-fenced";
      medium: "local-storage";
      storageKey: string;
    };

type IndexedDbTransactionalRecoveryCandidateLocation = Extract<
  FsmcRecoveryCandidatePhysicalLocation,
  { authority: "indexeddb-transactional" }
>;

type ExternalFencedRecoveryCandidateLocation = Extract<
  FsmcRecoveryCandidatePhysicalLocation,
  { authority: "external-fenced" }
>;

type CandidateAbsorptionMatchProjectionV1 = Pick<
  PersistenceCheckpointAbsorbedCandidate,
  | "schemaVersion"
  | "revision"
  | "baseRevision"
  | "digest"
  | "writerId"
  | "createdAt"
>;

type IndexedDbCandidatePhysicalContentWitnessV1 = {
  kind: "indexeddb-canonical-record";
  digestAlgorithm: "SHA-256";
  digestCanonicalization: "fsmc-idb-candidate-record-v1";
  digestCanonicalLength: number;
  digest: string;
};

type ExternalCandidatePhysicalContentWitnessV1 = {
  kind: "local-storage-raw-utf16-code-units";
  digestAlgorithm: "SHA-256";
  digestCanonicalization: "fsmc-local-storage-raw-utf16-code-units-v1";
  codeUnitLength: number;
  digest: string;
};

type LocalStorageRawWitnessV1 =
  | { kind: "absent" }
  | {
      kind: "present";
      content: ExternalCandidatePhysicalContentWitnessV1;
    };

type CandidatePhysicalContentWitnessFor<
  TLocation extends FsmcRecoveryCandidatePhysicalLocation,
> = TLocation extends IndexedDbTransactionalRecoveryCandidateLocation
  ? IndexedDbCandidatePhysicalContentWitnessV1
  : ExternalCandidatePhysicalContentWitnessV1;

interface FsmcRecoveryCandidateObservationEntry<
  TLocation extends FsmcRecoveryCandidatePhysicalLocation,
> {
  identity: FsmcRecoveryCandidateIdentity;
  physicalLocation: TLocation;
  physicalContentWitness: CandidatePhysicalContentWitnessFor<TLocation>;
  absorptionMatchProjection: CandidateAbsorptionMatchProjectionV1 | null;
}

type ExpectedIndexedDbRecoveryCandidateVector = ReadonlyArray<
  FsmcRecoveryCandidateObservationEntry<IndexedDbTransactionalRecoveryCandidateLocation>
>;

type ExpectedExternalRecoveryCandidateVector = ReadonlyArray<
  FsmcRecoveryCandidateObservationEntry<ExternalFencedRecoveryCandidateLocation>
>;

type AnyFsmcRecoveryCandidateObservationEntry =
  | ExpectedIndexedDbRecoveryCandidateVector[number]
  | ExpectedExternalRecoveryCandidateVector[number];

interface ExpectedRecoveryCandidateObservation {
  indexedDbTransactional: ExpectedIndexedDbRecoveryCandidateVector;
  external: ExpectedExternalRecoveryCandidateVector;
  externalDigest: string;
}

type FsmcCapabilityRootKey =
  | "data"
  | "control"
  | "durable-visit-state"
  | "event-settings"
  | "event-settings-bridge"
  | "__esp_internal__:fsmc-external-candidate-fence:v1";

type ExpectedStoreRoot = {
  state: "present";
  observed: FsmcObservedRevisionRoot;
  checkpoint: PersistenceCheckpoint | null;
  recoveryCandidates: ExpectedRecoveryCandidateObservation;
};

type ExpectedRootVector = ReadonlyArray<ExpectedStoreRoot>;

type SplitIntroductionWitness =
  | { kind: "db-version"; observedVersion: number }
  | {
      kind: "capability-store";
      storeName: "mapCellSplitSettings";
      objectStoreSchemaFingerprint: string;
    }
  | {
      kind: "required-payload-root";
      storeName: "mapCellSplitSettings";
      key: Exclude<
        FsmcCapabilityRootKey,
        "__esp_internal__:fsmc-external-candidate-fence:v1"
      >;
    }
  | {
      kind: "external-candidate-fence";
      storeName: "mapCellSplitSettings";
      key: "__esp_internal__:fsmc-external-candidate-fence:v1";
    }
  | {
      kind: "recovery-trace";
      source: "metadata" | "checkpoint";
      storeName: "mapCellSplitSettings";
      rootKey: FsmcCapabilityRootKey;
      recordKey: string;
    }
  | {
      kind: "recovery-trace";
      source: "recovery-candidate";
      targetStoreName: "mapCellSplitSettings";
      targetKey: FsmcCapabilityRootKey;
      candidate: AnyFsmcRecoveryCandidateObservationEntry;
    };

type SplitCapabilityPartialLossReason =
  | "capability-store-missing"
  | "capability-store-schema-incompatible"
  | "required-root-missing"
  | "required-root-schema-incompatible"
  | "external-candidate-fence-missing"
  | "external-candidate-fence-inconsistent"
  | "event-settings-bridge-conflict"
  | "legacy-core-transition-unclassifiable"
  | "metadata-checkpoint-incomplete"
  | "recovery-authority-inconsistent"
  | "unexpected-introduction-trace";

type NonEmptySplitIntroductionWitnesses = readonly [
  SplitIntroductionWitness,
  ...SplitIntroductionWitness[],
];

type NonEmptySplitCapabilityPartialLossReasons = readonly [
  SplitCapabilityPartialLossReason,
  ...SplitCapabilityPartialLossReason[],
];

type FsmcDatabaseTargetModeV1 =
  | "core-current"
  | "fsmc-vcap-qa"
  | "fsmc-vcap-production";

type FsmcAbsentDatabaseCoordinateV1 = {
  databasePresence: "absent";
  dbVersion: null;
};

type FsmcPresentDatabaseCoordinateV1 = {
  databasePresence: "present";
  dbVersion: number;
};

type FsmcCoreOnlySnapshotV1 =
  | ({
      capability: "core-only";
      databaseTargetMode: "core-current";
      core: CorePersistenceSnapshot;
      split?: never;
      control?: never;
      durableVisitState?: never;
      eventSettings?: never;
      eventSettingsBridge?: never;
      expectedRoots?: never;
    } & FsmcAbsentDatabaseCoordinateV1)
  | ({
      capability: "core-only";
      databaseTargetMode: "core-current";
      core: CorePersistenceSnapshot;
      split?: never;
      control?: never;
      durableVisitState?: never;
      eventSettings?: never;
      eventSettingsBridge?: never;
      expectedRoots?: never;
    } & FsmcPresentDatabaseCoordinateV1);

type FsmcRecoveryRequiredSnapshotCommonV1 = {
  capability: "map-cell-split-recovery-required";
  databaseTargetMode: FsmcDatabaseTargetModeV1;
  core: CorePersistenceSnapshot;
  introductionWitnesses: NonEmptySplitIntroductionWitnesses;
  reasons: NonEmptySplitCapabilityPartialLossReasons;
  diagnosticMode: "read-only";
  untrustedSplitRoots: "not-adopted";
  backupGuidanceRequired: true;
  split?: never;
  control?: never;
  durableVisitState?: never;
  eventSettings?: never;
  eventSettingsBridge?: never;
  expectedRoots?: never;
};

type FsmcRecoveryRequiredSnapshotV1 =
  | (FsmcRecoveryRequiredSnapshotCommonV1 & FsmcAbsentDatabaseCoordinateV1)
  | (FsmcRecoveryRequiredSnapshotCommonV1 & FsmcPresentDatabaseCoordinateV1);

type FsmcSplitSnapshotV1 = {
  capability: "map-cell-split-v1";
  databaseTargetMode: FsmcDatabaseTargetModeV1;
  databasePresence: "present";
  dbVersion: number;
  introductionWitness: { kind: "db-version"; observedVersion: number };
  core: CorePersistenceSnapshot;
  split: MapCellSplitSettingsRoot;
  control: MapCellSplitControlRoot;
  durableVisitState: DurableVisitStateRootV1;
  eventSettings: EventSettingsRootV1;
  eventSettingsBridge: EventSettingsBridgeRootV1;
  expectedRoots: ExpectedRootVector;
};

type FsmcPersistenceSnapshot =
  | FsmcCoreOnlySnapshotV1
  | FsmcRecoveryRequiredSnapshotV1
  | FsmcSplitSnapshotV1;

const FSMC_SUPPORTED_MAXIMUM_DB_VERSION = 7 as const;

type FsmcDatabasePresenceObservationV1 =
  | {
      kind: "absent";
      dbVersion: null;
      method: "indexeddb-databases";
      databaseCreated: false;
    }
  | {
      kind: "present";
      dbVersion: number;
      method: "indexeddb-databases";
      probeRequired: true;
    };

type FsmcDatabaseOpenProgressV1 = {
  kind: "capability-upgrade-blocked";
  databaseTargetMode: Exclude<FsmcDatabaseTargetModeV1, "core-current">;
  observedVersion: number | null;
  requestAttemptId: string;
  upgradeRequestOrdinal: 1;
  blocker: "non-probe-connection";
  sameUpgradeRequestPending: true;
  thisAttemptUpgradeWritesCommitted: false;
  retryRequestIssued: false;
};

type FsmcDatabaseOpenSnapshotResultV1 =
  | {
      kind: "snapshot";
      snapshot:
        | Extract<FsmcCoreOnlySnapshotV1, { databasePresence: "absent" }>
        | Extract<
            FsmcRecoveryRequiredSnapshotV1,
            { databasePresence: "absent" }
          >;
      requestAttemptId: string;
      upgradeRequestCount: 0;
      terminalDisposition: "no-upgrade-snapshot";
      terminalOrdinal: 1;
      connectionDisposition: "not-opened";
    }
  | {
      kind: "snapshot";
      snapshot:
        | Extract<FsmcCoreOnlySnapshotV1, { databasePresence: "present" }>
        | FsmcSplitSnapshotV1;
      requestAttemptId: string;
      upgradeRequestCount: 0;
      terminalDisposition: "no-upgrade-snapshot";
      terminalOrdinal: 1;
      connectionDisposition: "current-version-probe-result-handed-off";
    }
  | {
      kind: "snapshot";
      snapshot: Extract<
        FsmcRecoveryRequiredSnapshotV1,
        { databasePresence: "present" }
      >;
      requestAttemptId: string;
      upgradeRequestCount: 0;
      terminalDisposition: "no-upgrade-snapshot";
      terminalOrdinal: 1;
      connectionDisposition: "closed";
    }
  | {
      kind: "snapshot";
      snapshot: FsmcSplitSnapshotV1 & {
        databaseTargetMode: Exclude<FsmcDatabaseTargetModeV1, "core-current">;
      };
      requestAttemptId: string;
      upgradeRequestCount: 1;
      terminalDisposition: "upgrade-succeeded";
      terminalOrdinal: 1;
      connectionDisposition: "same-upgrade-request-result-handed-off";
    };

interface FsmcEventAuthorityAdoptionBlockedCommonV1 {
  kind: "event-authority-adoption-blocked";
  databaseTargetMode: Exclude<FsmcDatabaseTargetModeV1, "core-current">;
  databasePresence: "present";
  dbVersion: number;
  core: CorePersistenceSnapshot;
  capabilityDatabaseWritesAllowed: false;
  capabilityAuthorityAdopted: false;
  legacyCoreWritesAllowed: false;
  repairCommandId: null;
  recoveryRunbookId: "fsmc.event-authority-adoption-blocked.v1";
  backupGuidanceRequired: true;
  requestAttemptId: string;
  upgradeRequestCount: 0;
  terminalDisposition: "adoption-blocked";
  terminalOrdinal: 1;
  connectionDisposition: "closed";
}

type FsmcEventAuthorityAdoptionBlockedResultV1 =
  FsmcEventAuthorityAdoptionBlockedCommonV1 & {
    canonicalReasons: CanonicalNonEmptyEventAuthorityRejectionReasonsV1<EventAuthorityProposalBlockerReasonV1>;
    proposalRejectionDigest: string;
    proposalRejection: Extract<
      EventAuthorityProposalResultV1,
      { kind: "rejected" }
    >;
  };

interface FsmcEventAuthorityProposalFailedCommonV1 {
  kind: "event-authority-proposal-failed";
  databaseTargetMode: Exclude<FsmcDatabaseTargetModeV1, "core-current">;
  reason: "opaque-id-api-unavailable" | "opaque-id-collision-retry-exhausted";
  allocationKind: "event-instance-id" | "core-anchor-token";
  databaseWritesAllowed: false;
  capabilityAuthorityAdopted: false;
  backupGuidanceRequired: true;
  retryRequired: true;
  requestAttemptId: string;
  upgradeRequestCount: 0;
  terminalDisposition: "pre-upgrade-failed";
  terminalOrdinal: 1;
}

type FsmcEventAuthorityProposalFailedResultV1 =
  FsmcEventAuthorityProposalFailedCommonV1 & {
    databasePresence: "present";
    observedVersion: number;
    connectionDisposition: "closed";
  };

type LegacyFocusDayScopeRepairAvailabilityV1 =
  | {
      kind: "available";
      externalCandidateAbsenceWitnessDigest: string;
      legacyCoreWritesAllowed: "repair-command-only";
      repairCommandId: "fsmc.repair.legacy-focus-day-scope.v1";
      retirementCommandId: null;
    }
  | {
      kind: "unavailable";
      reason: "legacy-external-candidate-present";
      externalCandidateWitnessDigest: string;
      legacyCoreWritesAllowed: false;
      repairCommandId: null;
      retirementCommandId: "fsmc.retire.legacy-external-core.v1";
      recoveryRunbookId: "fsmc.legacy-external-candidate-blocked.v1";
    };

declare const FSMC_LEGACY_EXTERNAL_RETIREMENT_JOURNAL_KEY_V1: "__esp_internal__:fsmc-legacy-external-retirement:v1";
declare const FSMC_LEGACY_EXTERNAL_MATERIALIZATION_RECEIPT_KEY_V1: "__esp_internal__:fsmc-legacy-external-materialization-receipt:v1";
declare const FSMC_LEGACY_FOCUS_DAY_REPAIR_RECEIPT_KEY_V1: "__esp_internal__:fsmc-legacy-focus-day-repair-receipt:v1";
declare const FSMC_LEGACY_EXTERNAL_OPERATION_FENCE_KEY_V1: "__esp_internal__:fsmc-legacy-external-operation-fence:v1";
declare const LEGACY_SYNC_QUEUE_LOCAL_STORAGE_KEY: "syncQueue";

type PreservedLegacySyncQueueSourceV1 =
  | {
      kind: "absent";
      storageKey: typeof LEGACY_SYNC_QUEUE_LOCAL_STORAGE_KEY;
      absenceWitnessDigest: string;
    }
  | {
      kind: "present";
      storageKey: typeof LEGACY_SYNC_QUEUE_LOCAL_STORAGE_KEY;
      rawWitness: ExternalCandidatePhysicalContentWitnessV1;
    };

type LegacyExternalPreOpenDispositionV1 =
  | {
      kind: "true-fresh";
      coreCandidates: readonly [];
      preservedSyncQueue: Extract<
        PreservedLegacySyncQueueSourceV1,
        { kind: "absent" }
      >;
    }
  | {
      kind: "core-materialization-required";
      coreCandidates: readonly [
        LegacyRetirableCoreExternalCandidateV1,
        ...LegacyRetirableCoreExternalCandidateV1[],
      ];
      preservedSyncQueue: PreservedLegacySyncQueueSourceV1;
    }
  | {
      kind: "sync-queue-archive-only-required";
      coreCandidates: readonly [];
      preservedSyncQueue: Extract<
        PreservedLegacySyncQueueSourceV1,
        { kind: "present" }
      >;
    };

type LegacyPreservedSyncQueueArchiveWitnessV1 =
  | { kind: "absent" }
  | {
      kind: "archived";
      storageKey: typeof LEGACY_SYNC_QUEUE_LOCAL_STORAGE_KEY;
      sourceWitness: ExternalCandidatePhysicalContentWitnessV1;
      archiveRecordKey: string;
      archiveEntryDigest: string;
    };

declare const legacyRetirableCoreCandidateBrandV1: unique symbol;

type LegacyRetirableCoreExternalCandidateV1 =
  ExpectedExternalRecoveryCandidateVector[number] & {
    readonly [legacyRetirableCoreCandidateBrandV1]: true;
  };

interface LegacyExternalCoreMaterializationReceiptV1 {
  schemaVersion: 1;
  storeName: "syncQueue";
  receiptKey: typeof FSMC_LEGACY_EXTERNAL_MATERIALIZATION_RECEIPT_KEY_V1;
  sourceCandidates: readonly [
    LegacyRetirableCoreExternalCandidateV1,
    ...LegacyRetirableCoreExternalCandidateV1[],
  ];
  sourceCandidateDigest: string;
  preservedLegacySyncQueue: LegacyPreservedSyncQueueArchiveWitnessV1;
  materializedCoreRoots: Readonly<ExpectedRootVector>;
  materializedCoreDigest: string;
  receiptDigest: string;
}

interface LegacyFocusDayScopeRepairReceiptV1 {
  schemaVersion: 1;
  storeName: "syncQueue";
  receiptKey: typeof FSMC_LEGACY_FOCUS_DAY_REPAIR_RECEIPT_KEY_V1;
  planDigest: string;
  plan: Readonly<LegacyFocusDayScopeRepairPlanV1>;
  confirmation: Readonly<LegacyFocusDayScopeRepairConfirmationV1>;
  operationLeaseDigest: string;
  beforeCoreDigest: string;
  afterCoreRoots: Readonly<ExpectedRootVector>;
  afterCoreDigest: string;
  materializationBasis:
    | { kind: "none" }
    | {
        kind: "materialize-origin";
        materializationReceiptDigest: string;
        retiredExternalSourceDigest: string;
      };
  preservedLegacySyncQueueWitnessDigest: string;
  committedAt: string;
  receiptDigest: string;
}

interface LegacySyncQueueArchiveOnlyOutcomeV1 {
  kind: "sync-queue-archive-only-committed";
  source: Extract<PreservedLegacySyncQueueSourceV1, { kind: "present" }>;
  archive: Extract<
    LegacyPreservedSyncQueueArchiveWitnessV1,
    { kind: "archived" }
  >;
  databaseVersion: number;
  corePayloadWrites: 0;
  syncQueueDataWrites: 0;
  capabilityWrites: 0;
  connectionDisposition: "closed-before-fsmc-attempt";
}

interface LegacyExternalCoreRetirementPlanV1 {
  kind: "legacy-external-core-retirement-v1";
  basis:
    | {
        kind: "materialization";
        materializationReceiptDigest: string;
      }
    | {
        kind: "post-repair";
        materializationReceiptDigest: string;
        repairReceiptDigest: string;
      };
  expectedCoreRoots: Readonly<ExpectedRootVector>;
  expectedExternalCandidates: readonly [
    LegacyRetirableCoreExternalCandidateV1,
    ...LegacyRetirableCoreExternalCandidateV1[],
  ];
  preservedLegacySyncQueue: LegacyPreservedSyncQueueArchiveWitnessV1;
  expectedExternalCandidateDigest: string;
  expectedPostRetirementAbsenceWitnessDigest: string;
  backupArtifactSha256: string;
  planDigest: string;
}

type LegacyExternalCoreRetirementResultV1 =
  | {
      kind: "committed";
      planDigest: string;
      postRetirementAbsenceWitnessDigest: string;
      databaseWrites: 0;
    }
  | {
      kind: "resume-required";
      planDigest: string;
      journalKey: typeof FSMC_LEGACY_EXTERNAL_RETIREMENT_JOURNAL_KEY_V1;
      journalDigest: string;
      databaseWrites: 0;
    }
  | {
      kind: "partially-retired-blocked";
      planDigest: string;
      journalKey: typeof FSMC_LEGACY_EXTERNAL_RETIREMENT_JOURNAL_KEY_V1;
      journalDigest: string;
      blockedStage: "selector-retirement" | "post-retirement-verification";
      retiredSelectors: readonly LegacyRetirableCoreExternalCandidateV1[];
      remainingSelectors: readonly LegacyRetirableCoreExternalCandidateV1[];
      reason:
        | "expected-core-stale-after-partial-retirement"
        | "external-candidate-third-value"
        | "external-candidate-reappeared-after-retirement"
        | "retirement-basis-stale-after-partial-retirement"
        | "preserved-legacy-sync-queue-stale-after-partial-retirement";
      repairAllowed: false;
      databaseWrites: 0;
    }
  | {
      kind: "rejected";
      reason:
        | "retirement-basis-missing-or-invalid"
        | "expected-core-stale"
        | "external-candidate-stale"
        | "preserved-legacy-sync-queue-stale"
        | "backup-confirmation-mismatch"
        | "retirement-journal-conflict";
      databaseWrites: 0;
      externalCandidateMutations: 0;
    };

type LegacyExternalCoreRetirementPreviewInputV1 =
  | {
      kind: "materialization";
      materializationReceipt: Readonly<LegacyExternalCoreMaterializationReceiptV1>;
      backupArtifactSha256: string;
    }
  | {
      kind: "post-repair";
      materializationReceipt: Readonly<LegacyExternalCoreMaterializationReceiptV1>;
      repairReceipt: Readonly<LegacyFocusDayScopeRepairReceiptV1>;
      backupArtifactSha256: string;
    };

interface LegacyExternalCoreRetirementPortV1 {
  previewLegacyExternalCoreRetirement(
    input: Readonly<LegacyExternalCoreRetirementPreviewInputV1>,
  ): Promise<Readonly<LegacyExternalCoreRetirementPlanV1>>;
  retireLegacyExternalCore(input: {
    plan: Readonly<LegacyExternalCoreRetirementPlanV1>;
    confirmed: true;
  }): Promise<LegacyExternalCoreRetirementResultV1>;
  resumeLegacyExternalCoreRetirement(): Promise<LegacyExternalCoreRetirementResultV1>;
}

type FsmcDatabaseOpenResult =
  | FsmcDatabaseOpenSnapshotResultV1
  | {
      kind: "capability-adoption-blocked";
      databaseTargetMode: Exclude<FsmcDatabaseTargetModeV1, "core-current">;
      reason: "legacy-focus-day-scope-collision";
      databasePresence: "present";
      dbVersion: number;
      core: CorePersistenceSnapshot;
      collisionWitness: LegacyFocusDayScopeCollisionWitnessV1;
      capabilityDatabaseWritesAllowed: false;
      capabilityAuthorityAdopted: false;
      repairAvailability: LegacyFocusDayScopeRepairAvailabilityV1;
      backupGuidanceRequired: true;
      requestAttemptId: string;
      upgradeRequestCount: 0;
      terminalDisposition: "adoption-blocked";
      terminalOrdinal: 1;
      connectionDisposition: "closed";
    }
  | FsmcEventAuthorityAdoptionBlockedResultV1
  | FsmcEventAuthorityProposalFailedResultV1
  | {
      kind: "unsupported-database-version";
      databaseTargetMode: FsmcDatabaseTargetModeV1;
      observedVersion: number;
      supportedMaximumVersion: typeof FSMC_SUPPORTED_MAXIMUM_DB_VERSION;
      diagnosticMode: "read-only";
      databaseWritesAllowed: false;
      databaseAuthorityAdopted: false;
      backupGuidanceRequired: true;
      requestAttemptId: string;
      upgradeRequestCount: 0;
      terminalDisposition: "unsupported";
      terminalOrdinal: 1;
      connectionDisposition: "closed";
    }
  | {
      kind: "capability-upgrade-failed";
      databaseTargetMode: FsmcDatabaseTargetModeV1;
      reason:
        | "presence-observation-unavailable"
        | "preflight-probe-failed"
        | "probe-close-failed";
      observedVersion: number | null;
      requestAttemptId: string;
      upgradeRequestCount: 0;
      terminalDisposition: "pre-upgrade-failed";
      terminalOrdinal: 1;
      connectionDisposition: "not-opened-or-closed";
      thisAttemptUpgradeWritesCommitted: false;
      capabilityAuthorityAdopted: false;
      retryRequired: true;
    }
  | {
      kind: "capability-upgrade-failed";
      databaseTargetMode: Exclude<FsmcDatabaseTargetModeV1, "core-current">;
      reason:
        | "preflight-stale"
        | "versionchange-error"
        | "versionchange-aborted";
      observedVersion: number | null;
      requestAttemptId: string;
      upgradeRequestCount: 1;
      terminalDisposition: "upgrade-failed";
      terminalOrdinal: 1;
      connectionDisposition: "closed";
      thisAttemptUpgradeWritesCommitted: false;
      capabilityAuthorityAdopted: false;
      retryRequired: true;
    };

interface FsmcDatabaseOpenPortV1 {
  readonly databaseTargetMode: FsmcDatabaseTargetModeV1;
  open(input: {
    onProgress(progress: Readonly<FsmcDatabaseOpenProgressV1>): void;
  }): Promise<FsmcDatabaseOpenResult>;
}
```

FSMC open attemptより前に、現行`src/persistence/migration/legacyMigration.ts::migrateFromLocalStorage`をI2で`prepareLegacyExternalSourcesAtCurrentVersionV1`へ分離する。pre-open inventoryは`LEGACY_MIGRATION_TARGETS`のexact 10 key、すなわち`eventShoppingLists`、`eventMetadata`、`executeModeItems`、`dayModes`、`mapData`、`mapRotationSettings`、`routeSettings`、`hallDefinitions`、`hallRouteSettings`、`mapViewportSettings`をretirable core sourceとしてcanonical exact 10行観測し、固定`localStorage["syncQueue"]`は`PreservedLegacySyncQueueSourceV1`の別行へ入れる。後者をcore candidate、unknown／extra selector、raw-day source、adoptable queue payloadへ混入させない。`LegacyExternalPreOpenDispositionV1`はDB absent時の`core = 0／>0`とpreserved queue `absent／present`をtotal partitionし、core 0＋queue absentだけを`true-fresh`とする。

core sourceが1件以上presentなら、`materializeLegacyCoreAtCurrentVersionV1`が`CORE_CURRENT_DB_VERSION`の全10 core storeへ既存lossless migrationを完了する。同じIDB transactionへ`STORES.SYNC_QUEUE`を加え、固定record key `FSMC_LEGACY_EXTERNAL_MATERIALIZATION_RECEIPT_KEY_V1`にpresent core selectorだけのnonempty branded vector／raw UTF-16 witness、materialized全core root、両digestを持つ`LegacyExternalCoreMaterializationReceiptV1`を保存する。preserved queueもpresentならraw値をparseせず`sourceKind = "preserved-legacy-sync-queue"`のarchive entryへbyte exactに保存し、そのarchive key／entry digest／source witnessをreceiptへ入れる。既存IDB `syncQueue/data`、queue metadata／checkpointをbyte不変にし、localStorage sourceはcore／queueとも削除しない。receipt recordはapp payloadでもsplit導入traceでもsync journalでもなくretirement verifierだけが読む。

core source 0件＋preserved queue presentの`sync-queue-archive-only-required`は、current-version transactionで既存V2 migration journalとimmutable archiveだけを作り、core payload、`syncQueue/data`、その既存metadata／checkpoint、`Vcap`／capability／proposalを0 writeにする。DB absentならこのtransactionがcore-current DBを作り、commit後にconnectionをcloseして新しいFSMC attemptへ進むため、そのprofileは以後present pre-`Vcap`かつzero-scope `migrating`であり、null／true-fresh initial readyへ戻さない。DB presentでもmatching archiveを検証または同じarchive-only transactionで作る。non-JSON、empty stringを含むraw値を解釈せず、archive後にsourceが自然消失した場合は許すが、presentならarchive rawとbyte一致を必須にする。第三値、archive／journal conflict、write failureはtyped deferred／recoveryへ止め、FSMC writeを0件にする。

両materialization branchともcommit前終了はDB absentまたは全旧、commit後は完全なcore-current after-image＋必要なjournal／archive／receiptだけを許し、connection close後にfresh `requestAttemptId`を発行する。materialization中はhall normalization、autosave、repair registryを0件とする。したがってFSMC presenceの`absent`は10 core sourceとpreserved queueがともにabsentのtrue fresh profileだけで、raw-day collisionを構築できない。core materialize後のpresent profileはevent名preflightを使うが、retirable core sourceが残る間はraw-day repairを実行せず、次のretirement runbookを先に完了する。

DB presenceはrequired ChromiumでI0 qualification済みの`indexedDB.databases()`から`FsmcDatabasePresenceObservationV1`を作り、version省略`indexedDB.open()`でabsenceを調べてDB1を副作用生成しない。API unavailable、重複DB名、観測不能は`presence-observation-unavailable`、upgrade request 0件で停止する。present branchだけcurrent-version probe connectionで`H0`／`E0`、core-only authority、`LegacyFocusDayScopePreflightV1`を読み、全IDB requestのsuccess／errorとreadonly transactionの`oncomplete`を待つ。collision／unsupported／preflight error、introduction traceあり、またはpartial-lossならupgrade request 0件でprobeをcloseし、対応するadoption-blocked／unsupported／recovery／failed terminalを返す。`databaseTargetMode = "core-current"`かつ`dbVersion < Vcap`のtrace 0／collision-freeはprobeを閉じず、そのcurrent-version probe result connectionをrepositoryへhandoffして`core-only`／upgrade request 0件とする。任意target modeの`Vcap <= dbVersion <= supportedMaximumVersion`で6 capability rootが完全なら同じcurrent-version probe result connectionをhandoffして`map-cell-split-v1`／upgrade request 0件とする。`fsmc-vcap-qa | fsmc-vcap-production`かつ`dbVersion < Vcap`のtrace 0／collision-free／resolvedだけが、probeのhandlerを解除してrepository所有connection registryから除外し、`probe.close()`を同期実行して自己所有probe connection 0件を確認した後、exact 1件の`Vcap` open requestへ進む。`core-current`は`Vcap` requestを発行せず、probe close前のupgrade、upgrade branchでのprobe connection再利用、同attemptでの2件目upgrade requestを禁止する。absent branchはprobeを作らず、empty core factory `H0`、10 core external sourceとpreserved syncQueueの全absenceを表す`E0`、DB absence witnessを同じfresh preflightへ入れる。

`IDBOpenDBRequest.onblocked`はterminal resultではなく`FsmcDatabaseOpenProgressV1`を通知する。同じrequestとPromiseをpendingのまま維持し、別request、通常app／repair write、成功UIを開始しない。自己probeは既にclose済みなのでblockerはnon-probe connectionとして扱い、そのconnectionが閉じた後は同じrequestが`onupgradeneeded`へ進む。`onupgradeneeded.oldVersion`はpresenceがabsentならexact 0、presentなら観測済み`dbVersion`とexact一致させ、不一致は`preflight-stale`としてtransactionをabortし新attemptを要求する。request `onerror`とversionchange transaction `onabort`が連続してもattempt ledgerで同じ`terminalOrdinal = 1`へdedupeし、旧version／旧dataを維持する。`onsuccess`はversionchange commit、6 capability root検証、pending bridge resume、`E2`分類の完了後だけ`snapshot`を返し、`request.result` connectionをrepositoryへ直接handoffして再open 0件とする。progress後のsuccess／error／abort、page終了を二重terminalや偽successへ数えず、request attempt ID、upgrade request count、terminal disposition、connection dispositionをI0 schemaで再計算する。

`FsmcDatabaseOpenSnapshotResultV1`はterminal座標を直積にしない。absent core-only／recoveryはupgrade request 0＋`not-opened`、present core-only／complete splitは0＋`current-version-probe-result-handed-off`、present recoveryは0＋`closed`、upgrade成功はVcap targetのcomplete splitだけを1＋`same-upgrade-request-result-handed-off`とする。`upgrade-succeeded`＋0、`no-upgrade-snapshot`＋1、absence＋handoff、recovery＋open connection、upgrade success＋closedをcompile-time negative fixtureで拒否する。Portの`databaseTargetMode`はbuild-fixed constant／artifact manifestと一致させ、query／storage／caller inputで差し替えない。

`databaseTargetMode = fsmc-vcap-qa | fsmc-vcap-production`のnull決定表は、10 core external sourceとpreserved syncQueueがともにabsent＋trace 0＋empty collision-free preflight／resolvedならprobeなしexact 1 requestの0→`Vcap`、traceありならupgrade request 0件の`map-cell-split-recovery-required`とする。nullでcore sourceがpresentなら前置core materialization、core 0＋syncQueue presentならarchive-only current-version transactionへ戻し、完了後のpresent attemptで判定する。`core-current` artifactだけはDBを作らず、true fresh null＋trace 0を`core-only` terminalとして返せる。したがってVcap target modeのfresh nullを`core-only` terminalへ短絡せず、null collision fixtureを捏造しない。

`capability-adoption-blocked`は部分欠損snapshotではなく、`databasePresence = "present"`、`dbVersion < Vcap`、split導入trace 0件のままversionchange前に停止したtyped open resultである。legacy external coreからmaterializeしたprofileも新しいpresent attemptの同じcollision分岐を使う。`collisionWitnessDigest`は自身を除く`kind`、同じ`H0` boundaryのcore-only `authorityRevisionDigest`、event名／normalized day順のcollision配列、各配列内のUTF-16 code-unit順・重複なし・2件以上のraw day keyを`esp-json-v1` canonical serializeしたlowercase SHA-256とする。通常app write、capability store open／create、event ID proposal、token発行、default、loss previewは0件とする。retirable core external 10 selectorがすべてabsentで、preserved `syncQueue`がabsentまたはpresent byte-exact archivedならtrusted coreのread-only V1退避と`fsmc.repair.legacy-focus-day-scope.v1`をpre-adoption registryへ登録する。core selectorが1件でもpresentならrepairを登録せずtrusted V1退避と`fsmc.legacy-external-candidate-blocked.v1`を提示し、preserved queueがunarchived／第三値ならretirementへ誤誘導せずrecovery-requiredへ止める。absenceからcore materializationした事実はrepair attemptのDB writeに数えず、materialization、external retirement、raw-day repairを同一transaction／requestへ偽装しない。

`fsmc.legacy-external-candidate-blocked.v1`はmaterialize-origin collisionを恒久停止にしないための明示runbookである。利用者が全旧tab／Workerを閉じ、trusted core V1のSHA-256を確認した後だけretirementを選べる。通常basisはmaterialization receiptのretirable core source vectorとmaterialized core digest、post-repair basisは同receiptに加えて`LegacyFocusDayScopeRepairReceiptV1`の`beforeCoreDigest === materializedCoreDigest`、source digest一致、current core `=== afterCoreDigest`を検証する。後者だけが`fsmc.retire.post-repair-legacy-external-core.v1`を許し、repair receiptなし、第三値、source vector差では削除しない。preserved `localStorage["syncQueue"]`はretirable／unknown／extraへ数えず、absentまたはarchive rawとbyte一致を必須にして、いかなるbasisでもremove／parse／IDB queue採用しない。

P0でbasis digest、plan digest、retirable core各selectorのraw witness、期待absence witness、expected core vector、preserved queue witness、backup hashを専用localStorage journalへ書き、journal、operation fence、IDB receipt／repair receipt keyをretirable inventoryから明示除外する。その後、receipt source keyだけを期待raw値または既にabsentの場合にidempotent削除する。1件も削除していない段階のbasis／core／backup／external差だけを`rejected`＋`externalCandidateMutations: 0`にできる。1件以上削除後の第三値、expected core差、basis receipt差、preserved queue第三値は、journal digest、retired／remaining exact partition、`blockedStage = "selector-retirement"`、`repairAllowed: false`を持つ`partially-retired-blocked`とし、以後の削除とrepairを停止する。process終了だけの中断は`resume-required`とする。全retirable selector削除後のP1差または再出現は`remainingSelectors = []`、`blockedStage = "post-retirement-verification"`で停止し、selector stageではremainingをnonempty、post stageではemptyとする。P1でretirable core全selector absent、preserved queue integrity、expected core byte不変を確認した場合だけjournalを完了・削除し、receipt類は監査証跡としてsyncQueueへ保持する。journalなしの部分削除、別origin／未知key削除を行わない。完了後の新openだけがrepairを再評価する。

`LegacyFocusDayScopeRepairPlanV1.mappings`は、collisionを含む全affected eventについて`auditLegacyFocusDayScopesV1`が作ったsemantic raw-day domainをexact 1行ずつ含むtotal mappingとする。exact item raw dayと候補0件のstandalone empty-day slotはrowを持つが、複数raw dayが共有する物理keyをphantom mapping rowにしない。変更しないdayもidentity rowを持ち、domain欠落、余分なfrom、重複from／to、同一event内の重複`toRawDayKey`または重複`toNormalizedDayKey`を拒否する。target raw day／mapless key／Focus keyが既に存在する場合は、そのoccupant自身が同じplan domainのfromである閉じた置換だけを許し、domain外targetへの上書き、many-to-one merge、暗黙drop、copyを禁止する。`beforeCardinality`／`afterCardinality`では`distinctNormalizedDayScopeCount`、`executionBucketCount`、`hallDefinitionSlotCount`、`hallRouteSlotCount`以外の全fieldをexact一致させ、`before.rawDayScopeCount === after.rawDayScopeCount === before.mappingRowCount === after.mappingRowCount`を必須にする。normalized distinct countはcollision→raw count、execution bucket countはstable partition＋empty rekeyのdistinct target数、hall 2 slot countは`normalizeHydratedHallState`と同じextraction／source cleanup after-imageに残るdistinct physical key数からだけ再計算する。embedded source tabにmapped payloadが残りowner targetがabsentならhall slotが1増えることを許すが、`hallDefinitionEntryCount`、`hallRouteListCount`、`hallRouteItemReferenceCount`と各payload bytesはexact維持し、増減をmerge／dropの隠れ蓑にしない。item ID／eventDate以外のpayload、execution reference総数とsource内相対順、day-mode entry、Focus record／state、mapData／rotation／route／viewport slot、eventのday以外のcore fieldも維持する。nonempty execution sourceは各IDをafter partitionへexact 1回写し、empty sourceはexact 1 empty partitionへrekeyする。unknown／duplicate／event外ID、source row欠落、ID drop／copy、target key重複、partition後keyとitem day不一致、hall entry／reference差を拒否する。collision 0件、保存field一致、いずれかのcount遷移、またはexecution reference総数だけでは成功条件を満たさない。

pre-Vcapのmap-day associationは永続fieldではなく`useMapSelectors`の`normalizeMapDayToken`一致から導出されるため、存在しないassociation rowを書き換えない。canonical `normalizeFsmcDayKeyV1`はNFKC＋Unicode空白処理だが、現行`normalizeExecutionVisitDay`、day-mode selector、`getMaplessKey`、`buildFocusSessionKey`は同一規則とは限らない。そのため`１日目`／`1日目`のようなcanonical collisionでも、day-mode、execution、mapless、Focusに複数のdistinct physical keyが存在し得る。plannerはcurrent sourceの各物理key builderで全raw dayから生成できるkeyと、対象eventに実在するkeyをevent単位でunion／dedupeし、各`(eventName, sourceSurface, sourcePhysicalKey)`を`LegacyAliasPhysicalSourceRowV1`のexact 1行へ置く。各行は自己記述する`eventName`／`legacyNormalizedDayKey`とsource kindに対応するliteral `sourceSurface`を持ち、`candidateRawDayKeys`はcanonical順のnonempty exact集合、`sourceBefore`はpresence、payload digest、execution ordered IDs、またはFocus revision／state digestを保持する。全`normalizedAliasDecisions[].physicalSources`のunionはevent-wide observed day-scoped source集合のexact partitionとし、同じphysical sourceが別canonical groupにも候補となる場合は配列順で片方へ入れず`day-scoped-source-partition-unpartitionable`／write 0件とする。未観測の代表keyへ複数recordを潰さず、このflat source集合を`observedDayScopedPhysicalSourceDigest`へ拘束する。

`physicalSourceAssignments`はpresent source行のexact partitionとし、absent source行にはassignmentを作らない。各assignmentの`eventName`／`legacyNormalizedDayKey`は親alias groupとbyte一致し、flat `automaticAssignments`からも`(eventName, legacyNormalizedDayKey, sourceSurface, sourcePhysicalKey)`で元source exact 1行へ戻せなければならない。source kind／surface／target surfaceは型の判別unionどおり、day-mode→day-mode、hall definitions→hall definitions、hall route→hall route、Focus→Focus、execution→execution以外を表現不能にする。day-mode、mapless hall 2面、Focusの各present sourceは`sourcePhysicalKey`からexact 1 ownerの`targetPhysicalKey`へ一度だけrekeyし、source／target beforeをCASへ拘束する。全alias groupのassignment unionとexecution partition全rowについて`(eventName, targetSurface, targetPhysicalKey)`をglobal injectiveにし、同surfaceの複数sourceを同targetへmergeする場合は`physical-source-target-capacity-unpartitionable`／write 0件とする。別eventの同relative keyは別tupleとして許す。sourceをdrop／copy／default化しない。`routeSettings.visitOrder[].itemIds`、`hallRouteSettings.hallVisitLists[].itemIds`、`ShoppingItem.manualHallId`から各physical sourceが必要とするitemをexact raw dayへ逆引きし、参照raw dayがexact 1件なら`forced-reference-closure`、0件なら利用者選択、2件以上なら`shared-day-reference-unpartitionable`／write 0件とする。hall definitionsとhall route settingsが同じphysical keyで対を成す場合は同じownerへassignし、片面だけ別ownerへ送らない。nonempty execution sourceは`execution-bucket-partition`へ写し、各rowのsource keyをbyte一致、target keyをunique、`orderedItemIds`をnonemptyにする。after partition row集合はitemのexact raw dayとtarget keyで得る全nonempty equivalence classのexact集合であり、全ordered item IDのsource順stable exact partitionを必須にして、zero-member row、equivalence classの分割／統合、owner choiceを禁止する。empty after bucketはpresent empty execution sourceから`empty-execution-bucket-single-owner-rekey`で作るexact 1行だけを許し、nonempty sourceのpartitionへ混入させない。empty sourceは候補owner exact 1件なら自動、2件以上なら専用choiceを経る。present sourceのkindがexecutionだけなら、各present sourceを観測内容に応じてnonempty→`execution-bucket-partition`、empty→`empty-execution-bucket-single-owner-rekey`へexact 1回写し、少なくとも一方を含みexecution以外のassignment kindを含まない`partition-execution-only`とする。全nonemptyまたは全emptyもvalidであり、両kindの同時存在を要求しない。全kind absentは`all-derived-physical-sources-absent`、それ以外は全assignmentとloss確認を持つ`assign-physical-sources`とする。複数eventで同じrelative physical keyを持つpositive fixture、execution onlyの全nonempty／全empty／mixed positive fixture、同event cross-group duplicate／target collision、余分なempty partition、equivalence class差、親group差、assignmentのevent／group／surface欠落・差替えを`choiceRequestDigest`／preview／CASで検証する。

present非execution sourceの`candidateRawDayKeys`が1件なら`unique-physical-source-candidate`として自動assignmentし、2件以上でも参照closureがexact 1 ownerを強制する場合は`forced-reference-closure`として自動assignmentする。2件以上かつ参照0件の場合だけ`LegacyAliasPhysicalSourceChoiceRequestV1`をexact 1件作り、`aliasOwnerChoices`を`(eventName, legacyNormalizedDayKey, sourceKind, sourcePhysicalKey)`でrequest集合とexact bijectionにする。nonempty executionはitem raw dayから決定的にstable partitionしchoiceを作らない。一方、item reference 0件のempty execution bucketは候補1件だけを自動化し、候補2件以上では`sourceKind = "empty-execution-bucket"`のrequest exact 1件とchoice exact 1件を必須にする。choice ownerへempty bucketを一度だけrekeyし、候補外owner、request欠落／余分／重複、別source choice流用、空bucketの配列順owner選択をpreview前に拒否する。`automaticAssignments`と利用者choiceから導くassignmentのunionが全present sourceのexact partitionになるまでplanを返さない。

map choiceはaffected eventごとに`LegacyMapDayAssociationChoiceRequestV1` exact 1件を作る。requestの`mappings`はそのeventの全semantic mappingを`(fromRawDayKey, toRawDayKey)`でexact partitionし、各行に現行helperでのderived association 0／1／複数と、最終outcomeではなく利用可能なownership optionを持つ。eligible tabが0件なら`ownershipOptions = "mapless-only"`、`eligibleMapTabNames = []`、`ownedTargetMapTabName = null`をexact一致させ、最終outcomeはmaplessだけを許す。eligible tabが1件以上なら`ownershipOptions = "owned-or-mapless"`、canonical nonempty `eligibleMapTabNames`、ownerを選んだ場合だけ使うexact `ownedTargetMapTabName`を持ち、最終outcomeはeligible sourceによるownedまたは明示maplessを許す。mapless outcomeへ未使用の架空ownerを割り当てず、owned outcomeでだけtarget名を採用する。`candidateMapTabNames`は全rowのeligible集合のcanonical unionで、canonical collision groupが別でも同じphysical tabへ収束する場合を同一event request内へ一度だけ取り込む。requestはさらに6-store physical closure digest、全target occupancy digest、許可decision kindを拘束し、`requestDigest`は自身を除くexact `{ domain: "fsmc-legacy-map-day-association-choice-request-v1", eventName, mappings, candidateMapTabNames, sixStorePhysicalClosureDigest, targetOccupancyDigest, allowedDecisionKinds }`の`esp-json-v1` canonical SHA-256とする。`mapAssociationChoices`はevent request集合と`LegacyMapDayAssociationRepairDecisionSetV1`を`eventName`でexact bijectionにする。

event単位decision setの`mappingOutcomes`はrequestの全mappingとexact bijectionにし、`mapless-only` rowは`mapless` exact 1件、`owned-or-mapless` rowは`owned-map-tab`または`mapless` exact 1件へ写す。`tabDecisions`はevent requestの全`candidateMapTabNames`とmap tab名でexact bijectionにし、各tabを高々1 mapping ownerへの`preserve-map-tab | rename-map-tab`またはownerなしの`detach-to-mapless`へ一度だけ割り当てる。owner source tabはそのmapping rowの`eligibleMapTabNames`に含まれ、`owned-map-tab.sourceMapTabName`とowner decisionのsource、`owned-map-tab.targetMapTabName`とrowの`ownedTargetMapTabName`／preserveまたはrename後のdestinationがすべてbyte一致しなければならない。全owner decisionのdestination `(eventName, targetMapTabName)`はglobal injectiveとし、occupied destinationは同じevent decision setでexact 1 source tabが必ず退去するclosed replacementだけを許す。2 renameが同じabsent targetへ入る、domain外target、preserve destinationとrename destinationの衝突は`map-target-capacity-unpartitionable`／write 0件にする。同一tabのcross-request／cross-group重複、同一mappingの複数owner、owner decisionなしのowned outcome、mapless-onlyのowned outcome、owner付きtabのdetach、候補tab／mappingの欠落・余分・重複、ambiguous observationの配列先頭採用、request外mappingのUI内製、別eventのclosure digest流用をpreview前に拒否する。map tab改名では`mapData`、`mapRotationSettings`、`routeSettings`、`hallDefinitions`、`hallRouteSettings`、`mapViewportSettings`の6 nested `[eventName][dayMapName]` keyを同じafter-imageへ含め、storeごとのpresence／absenceとpayloadを維持する。6面のdestinationがclosed replacement外で1面でも占有済みなら全拒否し、partial rename、lossy merge、代表storeだけの移動を許さない。mapless化はmap payloadを削除せず元tabをbyte不変で残し、失われるderived associationをpreviewへ明示する。after-image上で現行`normalizeMapDayToken`／association helperを全mappingへ再実行し、各結果を`mappingOutcomes`とexact一致させたcanonical projectionを`derivedAfterAssociationDigest`へ拘束する。decisionだけ整ってもhelper再導出が別owner／ambiguous／missingになるcase、digest差、同eventの2 incoming targetは拒否し、別eventの同名tabは許す。全physical source row、assignment、execution bucket count／partition、event-level map decision setがbefore snapshotとafter candidateから再計算できない場合はpreviewもcommitも返さない。

`mapData`の物理closureは論理`[eventName][dayMapName]`だけで推測しない。現行`mapRepository`のper-entry key `mapData:${JSON.stringify([eventName, dayMapName])}`とlegacy monolithic `data`、両者のschema／payloadを`readMapEntriesFromStore`／`materializeMapData`で同一transactionに観測する。legacy-only、split-only、byte同値coexistはrepoのcanonical `buildMapDataPuts`／delete manifestからexact after-imageを作り、不一致coexist、parse不能key、orphan physical keyはwrite 0件で拒否する。`assertCurrentMapMatchesExpected`をfirst-write CASへ含め、logical rename後に旧physical keyやmonolithic stale copyを残さない。

hall repairはday-scoped 2面だけでなく、`MAPLESS_HALL_KEY`のunscoped `hallDefinitions`／`hallRouteSettings`と全map-tab内legacy-mapless payloadを`normalizeHydratedHallState`のcurrent extraction規則で観測する。これらはcanonical collision groupではなくevent全日へ作用するため`normalizedAliasDecisions[].physicalSources`へ入れず、canonical source identity `(eventName, sourceKind, embeddedMapTabName, sourcePhysicalKey)`ごとの`LegacyEventWideHallNormalizationSourceV1` exact 1行へ分離する。unscopedは`embeddedMapTabName = null`、embeddedは元tab名non-nullを必須にし、同じrelative physical keyを複数tabが持っても別sourceとして保持する。全source rowのcanonical projectionを`observedEventWideHallSourceDigest`へ拘束し、assignment、choice request／choice、choiceRequestDigest、cleanup CASも同じ4-tupleへexactに戻せなければならない。`candidateRawDayKeys`はcollision外の日を含むeventの全semantic raw-day domain、`referencedRawDayKeys`はroute／manual hall参照から逆算したexact集合とする。候補1件は自動、参照exact 1件はforced、参照0件かつ候補複数だけは`eventWideHallOwnerChoiceRequests`とchoiceをsource 4-tupleでexact bijectionにしてownerを決め、参照2件以上、day domain 0件、候補外choiceは`shared-day-reference-unpartitionable`／write 0件とする。同じtab／physical keyで対を成すdefinitions／route settingsは同じownerへassignする。全present event-wide sourceと`eventWideHallAssignments`をexact bijectionにし、day-scoped hall assignmentとのunion全体で`(eventName, targetSurface, targetPhysicalKey)`をglobal injectiveにする。`targetSurface`はsource kindからdefinitions／route settingsへ一意導出し、paired definitions／routeは同ownerでもsurfaceが異なるため許す。source数に対してdistinct target容量が不足する、同surfaceの複数sourceが同targetへ入る、day-scopedとevent-wideが衝突する場合は`hall-source-target-capacity-unpartitionable`／write 0件とし、repair after-imageが各owner targetへ一度だけ吸収してsource cleanup digestまで拘束できる場合だけ続行する。`targetBefore`はabsentまたは同plan内で必ず退去するexact `domain-source`だけとし、任意present targetへのmerge、byte同値duplicate cleanup、上書きを許さない。commit後に`normalizeHydratedHallState`を再許可してもclone／追加write 0件のno-opとなること、collision groupが複数または非衝突dayを併存してもsourceを重複計上しないこと、同keyの複数embedded tab、tab名欠落／差替え、unscoped＋non-null／embedded＋nullをcompile／semantic negative fixtureにする。

各`LegacyEventWideHallOwnerChoiceRequestV1.sourceDigest`は、同じsource 4-tupleへ戻る`eventWideHallSources`のexact 1行を`source`として、exact `{ domain: "fsmc-legacy-event-wide-hall-owner-choice-source-v1", source }`を`esp-json-v1` canonical serializeしたlowercase SHA-256とする。requestの候補集合はそのsource rowの`candidateRawDayKeys`とbyte一致させ、digestだけの架空request、source row 0件／複数、候補差を拒否する。inspectionのcanonical `eventWideHallOwnerChoiceRequests`全体をplanへbyte同値で保存し、`ownerBasis = "user-selected-no-references"`のassignmentおよび利用者choiceとsource 4-tupleでexact bijectionにする。automatic／forced assignmentにはrequestやchoiceを作らない。これによりreceiptのfull planだけから各source digest、request集合、assignment対応、aggregate `choiceRequestDigest`を再構築できる。

全nested rekeyの`targetBefore.kind = "domain-source"`は単なるkind／physical keyではなく`LegacyNestedSlotDomainSourceIdentityV1.source`全体を保存する。day-scoped sourceは`(sourceScope, eventName, legacyNormalizedDayKey, sourceKind, sourceSurface, sourcePhysicalKey)`、event-wide hall sourceは`(sourceScope, eventName, sourceKind, embeddedMapTabName, sourceSurface, sourcePhysicalKey)`で元source exact 1行へ戻り、当該source自身のassignmentが同plan内で別targetへ退去する場合だけoccupantとして許す。別event、別canonical group、別embedded tab、definitions／route surfaceのすり替え、同じrelative keyだけでの誤照合、退去assignment欠落をtarget-first inspectionとcommit前CASのnegative fixtureにし、退去先も含むglobal target injectivityを再検査する。

`fsmc.repair.legacy-focus-day-scope.v1`は新設`LegacyFocusDayScopeRepairPortV1`だけを入口とする。現行`PersistenceCommandPort.commitApplicationSnapshotAtomically(afterSnapshot)`はpreviewのexpected beforeを受けず、command開始後に自前observationを採って全10 core rootをwriteするため流用しない。Portは3段階とする。まず利用者がcollision witnessの全raw tupleへtargetを指定し、inspectionがtotal／injective／closed target、occupancy、retirable core absence、preserved queue archive integrityを検証する。成功時だけfull core vector、target digest、全physical source行、決定的execution partition、自動assignment、source-specific／event-wide owner choice request、shared-state参照closure、map choice requestの`choiceRequestDigest`をwrite 0件で返す。次にowner／map choicesからloss一覧付きimmutable planを作り、最後のcommitはplan／loss digestへの明示確認を必須にする。target不正ならchoice requestもpreviewも返さない。

専用Portは全10 core store、`STORES.SYNC_QUEUE`の固定repair receipt key、必要なmetadata／checkpoint／candidate storeを一つのreadwrite transactionへ入れ、first write直前にexpected before、semantic domain、collision witness、target／occupancy、physical source、assignment、execution partition、map／hall closure、4可変countと保持count、changed-root集合を再計算する。全て一致する場合だけ宣言core rootと`LegacyFocusDayScopeRepairReceiptV1`を原子的に更新する。receiptはplan、before／after core digest、after core vector、preserved queue witnessを持ち、materialize-originならoriginal materialization receipt digest／source digestも拘束する。`receiptDigest`は自身を除くreceipt全fieldをexact `{ domain: "fsmc-legacy-focus-day-repair-receipt-v1", receipt }`として`esp-json-v1` canonical serializeしたlowercase SHA-256とし、`committedAt`は妥当なUTC ISO 8601 instantへ正規化する。`beforeCoreDigest`がoriginal `materializedCoreDigest`と異なるのにmaterialize-originを名乗る入力、receiptなしのpost-repair削除、digest／timestamp不正を拒否する。`afterCollisionFreePreflightDigest`はcommit candidateとbyte一致させ、unchanged payloadのbyte同値putでparticipantを水増ししない。Focus transitionはdistinct sourceとassignmentのexact bijection、full transition witnessと同plan digestを持つone-shot leaseとし、core commit成功後だけ同期completeする。取消、confirmation不一致、partial指定、choice不整合はlease取得前に拒否してDB／Focus session record mutation／lease ledger transitionを0件とする。lease取得不能もtyped acquisition rejectとして同じ0件を返す。取得後のstale、execution／hall cardinality不正、shared reference、occupied target、別collision、transaction失敗ではDB／Focus session record mutationを0件に保ち、exact active leaseだけをabortしてledgerの`none → active → aborted`を`LegacyFocusSessionRejectedRepairLeaseLedgerOutcomeV1`へ記録する。normalization／autosaveは新preflightまで停止し、成功後もsame attempt bootstrapへ直結しない。

external candidateにはIDBとの共通原子transactionがないため、E0／E1／E2は連続absenceの証明ではなくsampled fenceである。利用者が全旧tab／Workerを閉じたことを確認し、新版writerは`FSMC_LEGACY_EXTERNAL_OPERATION_FENCE_KEY_V1`のactive lease中に10 core external keyを書かない。inspection開始時はretirable core全selector absenceとpreserved queueのabsent-or-byte-exact-archivedを`E0`の2 digestへ入れ、planまで伝播する。first write直前の`E1`差はtransactionをabortしてDB／Focus session record writeを0件にし、取得済みleaseはledger上で`active → aborted`へ進めるが、gate間の出現→消失ABAを検出できたとは主張しない。core＋repair receipt commitとFocus lease complete後、成功UI前に`E2`を再観測する。retirable coreがabsentかつqueue integrity正常なら`committed`、core sourceがoriginal materialization vectorどおり再出現した場合は修復済みIDBをrollbackせず`committed-legacy-external-candidate-blocked`＋post-repair retirement available、vector差／receiptなしまたはpreserved queue第三値なら同じ全new IDBを維持した`committed-recovery-required`とする。commit後・E2前の終了は次回openでdurable repair receipt、external vector、collision-free coreを再分類する。E2後もsame attempt bootstrapは禁止し、次open／mutation boundaryで再検査する。

repair同意chainのdigestはすべてdomain-separated exact式へ固定する。`requestedTargetsDigest`はcanonical unique target rowsをexact `{ domain: "fsmc-legacy-focus-day-repair-requested-targets-v1", requestedTargets }`、各map `requestDigest`は自身を除くexact `{ domain: "fsmc-legacy-map-day-association-choice-request-v1", eventName, mappings, candidateMapTabNames, sixStorePhysicalClosureDigest, targetOccupancyDigest, allowedDecisionKinds }`、aggregate `choiceRequestDigest`は`choices-required` branchから自身だけを除いたexact `{ domain: "fsmc-legacy-focus-day-repair-choice-request-v1", kind: "choices-required", collisionWitnessDigest, externalCandidateAbsenceWitnessDigest, preservedLegacySyncQueueWitnessDigest, requestedTargetsDigest, expectedCoreRoots, aliasGroups, observedDayScopedPhysicalSourceDigest, automaticAssignments, ownerChoiceRequests, eventWideHallSources, observedEventWideHallSourceDigest, automaticEventWideHallAssignments, eventWideHallOwnerChoiceRequests, mapAssociationChoiceRequests: [{ eventName, requestDigest }] }`として`esp-json-v1` canonical serializeしたlowercase SHA-256とする。各配列は宣言済みsource identity／event名順でsort／uniqueし、UI順をhash authorityにしない。planはinspectionのfull canonical `eventWideHallOwnerChoiceRequests`と`mapAssociationChoiceRequests`をbyte一致で保持する。前者は`ownerBasis = "user-selected-no-references"`の`eventWideHallAssignments`とsource 4-tupleでexact bijectionにし、各requestのsource digest／candidate／選択ownerを再検査する。後者は`mapAssociationDecisions`とeventNameでexact bijectionにし、各outcomeをrequestのmapping row、allowed kind、eligible tab、6-store closure、target occupancyへ一致させる。planの`lossPreviewRows`はeffect kind固定順の後、day mapping、day-scoped source tuple、event-wide 4-tuple、map event、Focus from keyの各canonical key順で、mapping、source移管／execution partition、mapless化／rename／detach、hall cleanup、Focus rekeyの全effectとexact bijectionにする。alias groupの`resolution.lossPreviewDigest`は`kind = "assign-physical-sources"` branchだけに存在し、そのgroupと同じ`(eventName, legacyNormalizedDayKey)`へ直接帰属するday mapping、day-scoped physical assignment／execution partition、Focus transition projectionのrowsだけをexact `{ domain: "fsmc-legacy-focus-day-repair-group-loss-preview-v1", eventName, legacyNormalizedDayKey, rows }`としてhashする。event-wide hall／event-level map rowsはgroup digestへ重複収録せずplan全体のloss digestだけへ含める。他の2 branchは同fieldを持たず、branch外のdigestを要求しない。planの`lossPreviewDigest`は全rowsをexact `{ domain: "fsmc-legacy-focus-day-repair-loss-preview-v1", rows }`として同canonical SHA-256化する。`planDigest`は自身だけを除くplan全fieldをexact `{ domain: "fsmc-legacy-focus-day-repair-plan-v1", plan }`としてhashし、inspectionの`requestedTargetsDigest`／`choiceRequestDigest`をbyte一致で引き継ぐ。confirmationは同じ`planDigest`と`lossPreviewDigest`を必須にし、receiptはfull plan、別fieldのplan digest、confirmation、入力leaseの`leaseDigest`とbyte一致する`operationLeaseDigest`が全て一致する場合だけ作る。`receiptDigest`は自身を除くreceipt全fieldをhashするため、このlease digest、event-wide hall request bytes、full map request bytesも永続的に拘束する。digest／loss確認不一致はactive lease取得前ならDB／Focus session record／ledger mutation 0件、取得後の再検査差ならDB／Focus session record mutation 0件＋`aborted` ledger outcomeとする。不一致lease／旧lease replayは`operation-lease-mismatch`として新しいledger transition 0件で拒否し、例外へ逃がさない。receipt内planはpost-commit監査authorityとして保存し、digestだけを参照してrequest／plan bytesを捨てない。

`previewLegacyFocusDayScopeRepair`はchoice集合、candidate、inspection digestを再検査し、成功時だけcanonical nonempty `lossPreviewRows`を含む`{ kind: "planned", plan }`を返す。`plan.authorityRevisionDigest`は入力`collisionWitness.authorityRevisionDigest`とbyte一致させ、同じH0 boundaryから得た`expectedCoreRoots`／inspection／collision witnessへ拘束する。preview時のauthority revisionまたはroot boundary差は`LegacyFocusDayScopeRepairPreviewResultV1.reason = "inspection-stale"`、commit直前の差は`LegacyFocusDayScopeRepairResultV1.reason = "stale-preview"`とする。preview rejectionはDB／Focus session record／lease ledger mutation 0件、取得後に判明したcommit rejectionはDB／Focus session record mutation 0件と`aborted` ledger outcomeである。choice request／requested target digest差、owner／event-wide hall／map choiceの欠落・余分・重複・候補外、physical source assignment不完備もpreviewの`kind = "rejected"`へtotalに写す。effectとrowの欠落／余分／重複はpreview／commitとも`loss-preview-row-set-mismatch`、canonical row bytesから再計算したdigest差は`loss-preview-digest-mismatch`、正しいplan loss digestと利用者confirmationだけの差はcommitの`loss-preview-confirmation-mismatch`へ分ける。attackerがmalformed rowsとplan／confirmation digestをまとめて再計算してもsemantic row再導出を省略せず、例外throwや空planで表現しない。

repair対象が複数eventなら、影響event名のcanonical sort／uniqueな全体、plan digest、`expectedRegistryGeneration`、全`focusSessionTransitions`のsource `absent | present(sessionRevision, stateDigest)`とtarget `absent | domain-source(fromKey)`を一つの`operationScope.kind = "profile-repair"`／`transition.kind = "raw-day-rekey"`へ拘束してからcore first writeへ進む。lifecycle transitionの`transitions`はplan配列とbyte一致、`keyPairs`は同配列の`(fromKey, toKey)` projectionとexact一致させる。lease取得不能、source／target presence差、monotonic generationが示すABA、counter exhaustionは`LegacyFocusSessionOperationLeaseAcquisitionResultV1.kind = "rejected"`の対応reasonへ写し、core／Focus session record／lease ledger mutation 0件にする。取得成功後にcore commit前の検査またはpersistenceが失敗した場合はDB／Focus session record mutation 0件、ledgerだけを`active → aborted`へ進める。core commit成功後は予約済み全key after-imageを一度の同期completeで適用し、leaseがcompletedになるまでUI successやbootstrap retryを許さない。部分event scope、重複event名、transition外key mutationを禁止する。

`NonEmptySplitCapabilityPartialLossReasons`はI0 enum順の重複なしnonempty配列とし、同じreasonの重複、順序違い、reasonとwitness許可対応の不一致をschema／semantic verifierで拒否する。reason集合は表示順だけでなくrecovery decisionのcanonical入力であり、先頭reasonだけを代表として選ばない。

`ObservedRevisionRoot`は現行`persistenceCore.ts`のexact field、すなわち`storeName`、`key`、`revision`、`baseRevision`、`payloadDigest`、`payloadFingerprint`、`writerId`、`committedAt`、optionalな`synthetic`、`missing`、`runtimeFallback`を失わず保持する。`PersistenceCheckpoint`もkind／version、storeName／key、committedRoot、absorbedCandidates、updatedAtを含む構造全体を保持し、固定旧版Aが書かないfieldを`absorbedCandidates`へ追加しない。`FsmcRecoveryCandidateIdentity`は現行`StartupRecoveryCandidateIdentity`の`source`、`role`、optional storeName／sourceKey／targetKey／revision／digest／digestAlgorithm／digestCanonicalization／digestCanonicalLength／migrationConflictをexactに保持し、payloadと`rawValue`本体はdurable CAS vectorへ複製しない。代わりにpre-transaction collectorは物理recordを必ず読み、IndexedDBはI0固定のlossless／injectiveな`fsmc-idb-candidate-record-v1` canonical bytes全体、localStorageは`getItem(storageKey)`が返すraw DOMStringのUTF-16 code unit列全体から、長さとSHA-256を持つauthority対応`physicalContentWitness`をtransaction外で生成し、そのcommand attempt中だけ比較用canonical bytes／raw stringをmemoryへ保持する。localStorageのdigest入力はASCII `fsmc-local-storage-raw-utf16-code-units-v1`＋NUL、big-endian uint64のcode unit数、各code unitのbig-endian uint16をこの順に連結したbytesとし、lone surrogateをU+FFFDへ置換しないlossless／injective形式へ固定する。canonicalizerが未対応値を同じbytesへ畳み込むことを禁止し、対応subset外、証明不能、読込不能、authorityとwitness kind不一致はrecovery-requiredとする。既存identity digestが物理内容全体を拘束するとfixtureで証明できるsourceも必須witness fieldへ同じ検証済み値を投影する。各candidate recordから既存`PersistenceCheckpointAbsorbedCandidate`と共通の6 fieldだけを`CandidateAbsorptionMatchProjectionV1`として導出できない場合はnullにし、吸収済み消滅の根拠へ使わない。CASはobserved root、checkpoint、candidate identity、物理location、物理内容witness、absorption match projectionをversion付きcanonical形式で比較し、revisionだけ、checkpointの文字列化だけ、candidateの件数だけ、物理recordを読まない比較へ縮退しない。

candidateのauthority classは`source`名ではなく、I0で全生成・読込箇所を列挙する`config/fsmc-recovery-candidate-locations.json`とpure `collectRecoveryCandidateObservationsForRoot(storeName, key)`が返す物理locationだけで決める。inventoryはroot tupleごとに、現在候補の有無とは独立した全potential IndexedDB store／record selectorと全external key selectorを列挙する。現行の`source: "indexedDB"`に加え、`syncQueue`の`LEGACY_MIGRATION_JOURNAL_KEY`、`LEGACY_MIGRATION_ARCHIVE_KEY_PREFIX`、recovery adoption／retention recordから導く`source: "migration-journal"`は、exactな`recordKey`を持つ`indexeddb-transactional`である。`legacy-localStorage`と、現行`readRuntimeCandidateSnapshots`が`localStorage`から読む`runtime-fallback`だけを、exactな`storageKey`を持つ`external-fenced`とする。同じ`source`でも物理locationとinventoryが一致しないcandidate、未知媒体、memoryにしか残らず元recordへ再解決できないcandidateは分類を推測せずrecovery-requiredとし、通常commandへ参加させない。

rootごとの観測は上記collectorの全出力とし、そのrootを変更し得るunscoped candidateは該当する各rootへ同じidentity／physical location／physical content witness／absorption match projectionのまま含める。root／authority class内の重複は拒否するが、別rootへの決定的な重複帰属を省略しない。`indexedDbTransactional`配列は`authority: "indexeddb-transactional"`＋`kind: "indexeddb-canonical-record"`だけ、`external`配列は`authority: "external-fenced"`＋`kind: "local-storage-raw-utf16-code-units"`だけを型とJSON Schemaの両方で許可し、逆配列への混入、unionへの型拡張、inventoryと異なる媒体／witnessを拒否する。前者の全`storeName`はcommand transaction scope、後者の全`storageKey`はexternal inventoryとexact一致させ、両authority配列の交差混入をnegative compile-time fixtureとschema fixtureで検出する。全physical content witnessのSHA-256 `digest`はlowercase 64桁hex、IDB witnessの`digestCanonicalLength`は正のsafe integer、external witnessの`codeUnitLength`は0を許す非負safe integerとし、それぞれinventoryで固定したhard limit以下をJSON Schemaとsemantic verifierで強制する。`externalDigest`はphysical content witnessを含むexternal全entryのcanonical JSON UTF-8 SHA-256であり、空vectorにも固定digestを持つ。同じstorage key／identity／locationのままrawValueが1 code unitでも変わる場合はlone surrogate同士の差を含めdigestが必ず変わる。`objectStoreSchemaFingerprint`はkeyPath、autoIncrement、index名／keyPath／unique／multiEntryをcanonical順でhashする。正常`map-cell-split-v1`は`introductionWitness.observedVersion === dbVersion`かつ両方`>= Vcap`、recovery-requiredで`dbVersion`がnon-nullの`db-version` witnessも`observedVersion === dbVersion`かつ`>= Vcap`をschema／semantic invariantにし、同snapshot内の`db-version` witness重複を拒否する。`dbVersion < Vcap`でstoreだけ、`data`／`control` payloadだけ、fenceだけが存在しても、それぞれ`capability-store`、`required-payload-root`、`external-candidate-fence` witnessによりnonempty recovery-required分岐を構築する。

`db-version` witnessはさらに必要十分条件へ固定する。supported range内のrecovery-requiredでは`dbVersion !== null && dbVersion >= Vcap`の場合に限りexact 1件を必須とし`observedVersion === dbVersion`、`dbVersion === null || dbVersion < Vcap`なら0件とする。正常snapshotは単一witnessと`Vcap <= dbVersion <= supportedMaximumVersion`を要求する。`core-only` terminalは`databaseTargetMode = "core-current"`だけに許し、`dbVersion === null`なら`databasePresence = "absent"`、numberなら`databasePresence = "present"`かつ`dbVersion < Vcap`を必須にする。recovery-requiredもpresenceとnull／numberを同様にexact一致させる。Vcap target modeはnull／pre-Vcap resolvedをcore-onlyへ返さず前記decision tableへ送る。phantom witness、必須witness欠落、重複、値ずれ、presence矛盾をJSON Schema／semantic verifierのnegative fixtureで拒否する。`dbVersion > supportedMaximumVersion`は`FsmcPersistenceSnapshot`を構築せず`FsmcDatabaseOpenResult.kind = "unsupported-database-version"`としてconnectionを閉じ、core／split authorityを採用せずwrite 0件で専用案内へ送る。

`recovery-trace` witnessはcapability storeの`data`／`control`／`durable-visit-state`／`event-settings`／`event-settings-bridge`／fence rootだけへ閉じる。metadata／checkpointの`recordKey`は`createPersistenceMetadataKey("mapCellSplitSettings", rootKey)`または`createPersistenceCheckpointKey(...)`の戻り値とexact一致し、candidateは同じtarget tupleへI0 inventoryで一意帰属する場合だけ許可する。通常core storeのmetadata、checkpoint、candidateはsplit導入witnessではなく、split traceがない健全なpre-`Vcap` profileはそれらが存在しても`core-only`である。任意store／key、表示上の`source`、候補件数だけからsplit導入を推測しない。

root vectorは`(storeName, key)`で安定sortし、同じtupleの重複、command参加rootの欠落、vector外rootへの書込み、observed rootとcheckpointのstoreName／key不一致を拒否する。各authority classはidentity全field、physical location、physical content witness、absorption match projectionのcanonical JSONで安定sortし、同一entry重複を拒否し、optional fieldの欠落と明示値を区別する。各参加rootについてlocation inventoryが列挙する全potential IndexedDB storeの和集合を、snapshot時のcandidateが0件のstoreも含めてcommandの同じreadwrite transaction scopeへ加える。最初のwriteをqueueする前に同transaction上のIDB requestで全selectorを再読込し、結果を同期canonical encodeしてpre-transactionの一時bytesとbyte-exact比較する。transaction内でWebCrypto SHA-256や別async taskをawaitせず、empty→insertを含む追加、消滅、identity／location／content／projection変更が1件でもあれば全CASをabortする。一致時はtransaction外で計算済みのdurable witnessを再利用する。別`openDB()`、別readonly transaction、`readInternalControlRecord`をtransaction内からawaitしてはならない。`mapData`は物理event／day recordが複数でも現行の論理aggregate root `(mapData, "data")`とpayload fingerprintで全体を拘束する。capability storeの5 payload rootは別々のroot tupleであり、command manifestが列挙するactual after-image write集合だけをparticipantとする。definition-only split writerは`data`と必要時の`control`、item／map／hall identity変更、event lifecycle、visit progress、restore writerは`durable-visit-state`も参加させ、event settings shadowを更新する専用writerだけがさらに`event-settings`／`event-settings-bridge`を参加させる。余分なbyte同値writeでparticipantを水増ししない。

IndexedDB transactionでロックできないexternal candidateには、存在しない原子CASを主張せず次のfence protocolを使う。I0のcommand participant manifestの和集合とcapabilityの5 payload root＋fenceから、canonicalで重複のない全root universe `FSMC_GOVERNED_ROOTS_V1`を`config/fsmc-governed-roots.json`へ固定する。同configは各tupleを`capability-owned | legacy-mutable-core | legacy-shadow-bridged | fence`へexact分類し、`data`／`control`／`durable-visit-state`／`event-settings-bridge`はcapability-owned、canonical `event-settings`はIDB差を許さず対応localStorage shadow差だけを専用reconcileへ送るlegacy-shadow-bridged、固定旧版Aが書けるcore rootはlegacy-mutable-core、fence自身はfence policyとする。未知policy、未分類root、同一tupleの複数policyを拒否し、config SHA-256をfenceへ保存する。

transaction instrumentationは物理`put`件数をparticipant集合へ直接流用せず、`logicalRootMutationTuples`と`administrativeFencePhysicalWrites`を別々に記録する。前者はfence以外についてpayload、metadata、checkpoint、candidateの作成・更新・削除を所有する論理`(storeName, key)`へ正規化した重複なし集合であり、本節の`actual write tuple`／`actualCapabilityWrites`はこの集合だけを意味する。後者は自己参照を避けるためparticipant／historical rowから除外するfence payloadとfence所有metadata／checkpointの物理write集合で、`config/fsmc-fence-write-manifest.json`のcommand種別ごとのexact集合と一致しなければtransactionをabortする。通常commandとbootstrapは必要なfence administrative writeをexact 1 set行う一方、fence tupleを`committedParticipantRoots`、participant digest、historical rowへ入れない。logical rootのbyte同値payload `put`だけでparticipantを水増しすることは禁止し、full `ExpectedStoreRoot`のafter-imageを進めるpayload／metadata／checkpoint／candidate transitionがあるrootだけを含める。bridge ackだけはexternal shadow変更をcanonical rootのhistorical evidenceへ結び直すため、`event-settings` payloadをbyte同値に保ったままrevision、metadata、checkpointを専用ack transitionとして進める。このexact after-imageと`event-settings-bridge`のpending→syncedを同じtransactionで書く場合に限り両rootを`logicalRootMutationTuples`へ含め、任意commandが同じ手法でpaddingすることを禁止する。

`FSMC_EXTERNAL_CANDIDATE_FENCE_KEY = "__esp_internal__:fsmc-external-candidate-fence:v1"`をcapability storeの内部recordとし、schemaVersion、`commitContext: { kind: "bootstrap"; profile: "existing-profile" | "fresh-profile" } | { kind: "command"; commandId: string }`、config SHA-256、canonical sort／uniqueな`committedParticipantRoots`、全非fence governed rootにexact 1件ずつ対応する`historicalRootEvidenceByRoot`、`historicalEvidenceDigest`、`committedParticipantDigest`、全governed rootにexact 1件ずつ対応する`externalBaselineByRoot`、writerId、committedAtを持たせ、fence自身も外側の`ExpectedRootVector`へ参加させる。historical evidence rowはcanonical `(storeName, key, observed root, checkpoint, ExpectedRecoveryCandidateObservation)`全体であり、payload digestのauthorityは`observed.payloadDigest`だけとする。候補はIDB／external双方のidentity全field、物理location、物理内容witness、absorption match projection、externalDigestをlosslessに保持する。全rowをroot tupleで安定sortしたUTF-8 SHA-256を`historicalEvidenceDigest`、`committedParticipantRoots`が指すrowだけを同じ規則でhashした値を`committedParticipantDigest`とする。readerはfenceに埋め込まれたhistorical rowから両digestを再計算して自己整合を検証し、live core rootから過去digestを再計算しない。fence自身をparticipant／historical rowへ含めず、全非fence rootで`historicalRootEvidenceByRoot[root].recoveryCandidates.externalDigest === externalBaselineByRoot[root]`を必須にし、fence rootだけはbaselineのみを持つ。自己参照hash、`logicalRootMutationTuples`とparticipant／digest集合の不一致、`administrativeFencePhysicalWrites`とfence write manifestの不一致、参加row／非参加historical rowの欠落・改変、未知・重複root、候補vector／物理location／content witness／projectionの欠落、historical／baseline external digest不一致、件数だけのdigestを拒否する。

通常FSMC commandは、同transactionで再読込したactual after-image write rootの候補vector付きhistorical rowだけをnew evidenceへ置換し、非参加rootのhistorical rowは前fenceからbyte同値で維持する。`committedParticipantRoots`、transaction instrumentationが記録した`logicalRootMutationTuples`、置換historical row集合、participant digest対象集合をexact一致させ、administrative fence writeは別manifestと照合する。全rowの`historicalEvidenceDigest`と参加rowの`committedParticipantDigest`を毎回再計算する。external baselineは毎commandで全governed rootを再観測して完全置換し、空vectorにも固定digestを保存する。E0→E1不変と前fenceのcross-invariantを検証したうえで、全非fence historical rowの`externalDigest`とnew baselineが一致する場合だけcommitする。historical／externalのどちらも、非参加rootを前回値ごと落とす疎な上書きを禁止する。通常FSMC commandはbridge protocol以外のexternal candidateを作成・変更・削除しない。

固定旧版Aは正常なcore rootを更新できるが、capability rootとfenceを更新できない。この正当な差を破損へ誤分類しないため、I0でpure `classifyLegacyCoreTransitionV1(previousFence, currentSnapshot)`と内部command `fsmc.internal.rebase-legacy-core.v1`を固定する。classifierは`unchanged | rebase-required | recovery-required`のexact unionを返し、次をすべて満たす場合だけ`rebase-required`にできる。

- fence schema、config SHA、埋込`historicalEvidenceDigest`と`committedParticipantDigest`、全非fence historical candidate `externalDigest`と同root baselineのcross-invariantが自己整合し、live capability payload rootとcapability-owned external baselineがhistorical evidence／fenceから変化していない。`event-settings-bridge.state !== "synced"`またはshadow witness差はgeneric classifierへ渡す前に専用bridge resume／reconcileで処理し、正常なpending shadow更新をcapability corruptionへ誤分類しない
- 差分tupleが`legacy-mutable-core`だけのnonempty集合であり、current coreのpayload digest／fingerprint、metadata、checkpoint、IDB candidate、external candidate lineageが既存core load契約でrootごとに完全整合する。I0は固定旧版Aの全candidate writer／cleanup pathから、root policy、authority、物理selector、old／new canonical record shape、必須root／checkpoint関係、許可する`created | absorbed | replaced`をwildcardなしで列挙した`config/fsmc-legacy-candidate-transitions.json`を作る。classifierはprevious historical rowのlossless candidate vectorとcurrent vectorの差を、同manifestのtransition instanceへ重複なく全件対応できる場合だけ説明済みとする。同じidentity／locationのまま`physicalContentWitness`または`absorptionMatchProjection`だけが変わるcaseを自動的な「旧entry消滅＋new追加」とみなさず、old／new canonical recordとroot／checkpoint transitionがexact 1件の`replaced`定義に一致する場合だけ許す。manifest外、0件・複数件一致、1 entry／descriptorの再利用はrecovery-requiredとする。`absorbed`はcurrent checkpointの各`absorbedCandidates` descriptorと旧entryのnon-null `absorptionMatchProjection`がexact一致し、そのdescriptorに一致する旧entryがroot内でちょうど1件の場合だけ、identity／locationを旧rowから一意に確定してroot payload transitionへの吸収とみなす。checkpoint自体がidentity／locationを持つとは仮定しない。同一projectionの旧entryが物理location違いで複数ある、0件、nullの場合はrecovery-requiredとする。`created`もinventory、digest、対象root、checkpointとの対応が一意な既存core recovery契約とmanifestのnew shapeに合う場合だけ許す。過去vectorを復元できない、吸収証跡がない、physical content witness／projectionだけの説明不能な変更、external差をprevious row＋inventory＋current logical root／checkpointのallowlist transitionで一意に説明できない場合もrecovery-requiredとする
- 現在のanchor、association、map／block binding、番号衝突をI0固定after-image validatorで再計算できる。完全一致entryはactiveを維持し、owner消失はdormant、曖昧・競合はquarantined、旧版編集で生じた`C(S) != ∅`はstored ONを変更せずevent単位effective fallbackにでき、別ownerへの自動接続とdurable state削除が0件である

capability-owned rootのlive差、fenceの自己不整合、core rootのpayload／metadata／checkpoint／candidate不整合、policy外root差、説明できないexternal差は`legacy-core-transition-unclassifiable`を含むrecovery-requiredとする。writerIdや`source`名だけで旧版writeと推測しない。逆に、healthyなlegacy-mutable core差そのものは`external-candidate-fence-inconsistent`にしない。

`fsmc.internal.rebase-legacy-core.v1`は利用者向けcollision repair allowlistとは別のI2所有maintenance commandであり、split mutationや番号修正の入口にしない。全legacy-mutable core store、inventoryが列挙するcandidate用の全potential物理IDB store、5 payload root、fenceを単一readwrite transactionでlockし、同transaction内でclassifier入力を再読込する。staleならwrite 0件で再判定する。一致時の`rebaseParticipantRoots`は、previous historical rowとcurrent rowのobserved root／checkpoint／candidate vectorのいずれかが異なる全legacy-mutable-core tupleと、そのafter-imageに実際に書くcapability rootの和集合、すなわち`sort(unique(changed legacy roots ∪ actualCapabilityWrites))`とする。通常coreだけのrebaseではstatus／associationを維持または更新する`data`とstored membershipを維持する`control`が`actualCapabilityWrites`のbase集合である。item／visit identityだけでなく、`eventNameAtBasis`、event ID、per-event core／authority digest、両aggregate、entries、persisted retired rowのいずれかが変わる全transitionで`durable-visit-state`を加えるため、固定旧版Aのanchor保持renameとmanifest一致deleteも必ず参加する。event settings shadow reconcileを同時に行う場合だけ専用ack after-imageに従って`event-settings`／`event-settings-bridge`を加え、fence自身は含めない。historical rowの置換集合、transaction instrumentationの`logicalRootMutationTuples`、`committedParticipantRoots`、digest対象集合をexact一致させ、administrative fence writeは別manifestと照合し、その他の非参加rowは前fenceからbyte同値で維持する。`committedParticipantDigest`はこのexact集合だけ、`historicalEvidenceDigest`は全rowから再計算し、全external baselineも現在値へ完全置換したfenceを同じtransactionでcommitする。余分・欠落・重複、changed rowとの不一致はschema／runtimeで拒否する。

rebase自身もexternal candidateをlockできないため、通常commandと別名のvector `R0`／`R1`／`R2`で同じ安全境界を持つ。transaction開始前に全governed rootのexternal `R0`とraw stringを読み、全IDB rootをlock・同期byte比較した後、最初のwrite前にexternal `R1`を同期再読込して`R0`のraw stringとexact比較する。`R1 != R0`ならwrite 0件でtransactionをabortし、追加差もhealthy legacy-onlyなら最新snapshotからrebaseを再試行、capability-ownedまたは分類不能ならrecovery-requiredとする。`R1 = R0`かつclassifier再検証成功時だけ、transaction外で計算済みの`externalBaselineByRoot = digest(R1)`を持つnew fenceと必要なstatus変更をcommitする。`transaction.oncomplete`後・split再開前に`R2`を同期再読込し、`R2 = R1`なら完了、追加差がhealthy legacy-onlyなら確定済みrebaseをrollbackせず非durableな`legacy-rebase-pending`から次のrebaseを行い、それ以外は確定済みrootを維持してrecovery-requiredにする。rebaseはexternal candidateを変更・cleanupせず、IDB transaction内で非同期hashを待たない。

commit前終了・quota・abortでは固定旧版Aが既に確定したcurrent legacy core＋rebase前fenceを維持し、その組合せから導出する非durableな`legacy-rebase-pending`として次回境界で安全に再試行する。未保存rollbackや破損とは表示しない。splitはrebase完了までlegacy fallback／read-onlyとし、利用者commandのpreviewは完了後に最新rootから作り直す。

通常commandの境界protocolは次とする。

1. preview／command開始時にlive governed root、external vector `E0`、durable fenceを読み、fence自己整合とroot policyを検査する。差がlegacy-mutable coreだけなら先にclassifier／rebaseへ送り、capability-owned差または分類不能差ならwrite 0件のrecovery-requiredとする
2. command参加rootと、location inventoryが各rootへ列挙する全potential IndexedDB storeを、現在candidateが0件でも含めた単一readwrite transactionを開く。最初のwrite前に同transactionのIDB requestでroot／checkpoint／`indexedDbTransactional` selectorを再読込し、同期canonical bytesをpre-transaction bytesとexact比較してCASする。transaction内で非同期hashや別transactionを待たない
3. 同じ最初のwrite前境界で`localStorage`から全governed rootのexternal raw stringを`E1`として同期再読込し、`E0`のraw stringとexact比較する。`E1 != E0`がlegacy-mutable coreだけならwrite 0件の`legacy-rebase-required`、それ以外はwrite 0件のconflict／recovery-requiredとする。一致時だけtransaction外で計算済みのSHA-256 witness／digestを再利用する
4. IDB内candidateと全rootのCAS成功時だけ、new participant historical evidence、全rowのnew `historicalEvidenceDigest`、new `committedParticipantDigest`、`digest(E1)`の完全`externalBaselineByRoot`を持つfenceを同じtransactionでcommitする
5. `transaction.oncomplete`後かつUI成功通知前に全governed rootの`E2`を再観測する。`E2 = E1`なら成功とする。差がlegacy-mutable coreだけなら全new IDB rootを維持して`committed-legacy-rebase-required`とし、classifier／rebase完了まで成功UIを保留する。それ以外は全new IDB rootのまま`committed-recovery-required`としてsplitを即時read-only安全モードにし、Backup復旧案内を出す。いずれもrollback、旧状態表示、自動merge、未保存扱いをしない

commit後・post-check前の終了は、次回起動時にlive root／全external vectorとdurable fenceを比較し、差なしはcommitted stateを正常採用、legacy-mutable coreだけの説明可能な差はrebase、capability-ownedまたは分類不能な差はrecovery-requiredへ入る。別tabの`storage` event、`focus`／`visibilitychange`、split read／mutation前にも全rootを再比較し、分類完了前に新しいauthorityを自動採用しない。post-check後に起きた変更も次の通知または境界checkで検出する。Web Lockは旧版や外部storage writerを拘束できないため正当性の前提にせず、IDB原子commit、root policy、legacy rebase oracleを境界にする。

`Vcap`導入は、core preflightが正常で`LegacyFocusDayScopePreflightV1.kind = "collision-free"`、proposalからの`DurableVisitScopeDerivationV1.kind = "resolved"`となり、I0 decision tableが「capability store／5 payload root／各metadata・checkpoint・candidate／fenceの導入traceなし」と判定した`dbVersion === null || dbVersion < Vcap`だけに許す。collision branchは`capability-adoption-blocked`を返してupgrade requestを発行しない。既存DBではprobe close前に、全非fence governed rootのpayload、metadata、checkpointと、`config/fsmc-recovery-candidate-locations.json`が列挙する全potential IndexedDB store／record selector（現在0件のselectorと明示absenceを含む）を同一preflight snapshot `H0`として読み、lossless canonical bytesとtransaction外で計算した物理内容witnessをcommand attempt中だけ保持する。DBなしでは同じtupleをabsence sentinelとし、probe connectionを作らない。同じ境界で全governed rootのexternal raw DOMStringを`E0`として観測し、全capability rootのexternal vectorが導入契約どおりであることを要求する。legacy `blockDetectionSettings`はcandidate空を要求せず、event anchorへ一意変換できるE0 raw witnessとしてbootstrap planへ参加させる。

versionchange transactionはupgrade開始時点で存在する全storeと、新設するcapability storeをscopeにし、最初のwriteをqueueする前に次を順序固定で行う。まず`syncQueue`内journal／archiveを含むsplit対象IDB trace皆無を同transactionのrequestで再検証する。これはbootstrap source CASと別の判定であり、stableなcandidate-only／metadata-only／checkpoint-onlyを「変化なし」としてupgradeしてはならない。次に全非fence rootのpayload、metadata、checkpointと全potential candidate selectorを同transactionで`H1`として再読込し、同期lossless canonical encodeしたbytesを`H0`の値またはabsence sentinelとbyte-exact比較する。transaction内でWebCrypto、別transaction、別async taskをawaitせず、`H1 != H0`ならupgrade transaction全体をabortして旧DB version／旧store／旧dataを維持する。同じ最初のwrite前境界でexternal `E1`を同期再読込し、`E1`のraw DOMStringが`E0`とexact一致する場合だけ`H0`で計算済みのwitnessを`H1`へ再利用できる。`E1 != E0`も全abortとする。

既存DBのbootstrapは`H1 = H0`かつ`E1 = E0`の場合だけ実行する。initial historical evidenceは全非fence governed rootでtotalとし、変更しないlegacy rowは`H1`、`anchorActions.kind = "create"`で更新するevent metadata rowとnew capability rowは同じinstrumented factoryが実際に書くpost-bootstrap payload／metadata／checkpoint／candidate観測から一度だけ作る。fence root自身にはhistorical rowを作らずbaselineだけを持たせる。existing-profileの`logicalRootMutationTuples`／`committedParticipantRoots`は`{data, control, durable-visit-state, event-settings, event-settings-bridge} ∪ actualAnchorMutationRoots`とexact一致させ、`actualAnchorMutationRoots`はproposalのcreate actionが変更するlegacy event-metadata rootだけ、preserve actionだけなら空集合とする。fresh-profileはfactoryが作る`FSMC_GOVERNED_ROOTS_V1 - {fence}`とexact一致させる。両profileともlogical tuple、participant、置換row、digest対象の欠落・余分・重複、またはbootstrap用`administrativeFencePhysicalWrites`とfence write manifestの不一致でupgrade transactionをabortする。`data` rootは全event名とexact bijectionのevent association、対応するempty event split settingsを持ち、map／block associationとsplit entryだけをemptyにする。event settings rootも同じevent ID集合とする。durable rootはpresent既存profileならscope 0件でも`migrating`＋empty entries＋`basisCoreDigest`＋`basisEventAuthorityDigest`、legacy external coreもないtrue fresh profileかつscope 0件だけは同digest付き`ready`＋empty entriesとする。既存zero-scopeはunused／unmapped Focus physical recordの全inventoryとloss previewを完了してから別migration commitでreadyへ進める。新store、初期OFF control、syncedまたはpending bridge、合成post-state付きinitial fence、6 capability rootのmetadata／checkpoint、必要なmetadata anchorを同じversionchange transactionでcommitする。fresh profileではpre-open不在を旧snapshotに流用せず、factoryのexact値をroot writeとevidenceの両方へ供給する。`onsuccess`後はbridge pendingなら専用resumeを先に完了し、その後に全governed rootの`E2`を観測する。差なしは正常、healthy legacy差はrebase、それ以外は完全な新DBのまま`committed-recovery-required`とする。commit前終了は旧version／storeなし、commit後からopen success前は`Vcap`・association／anchorを含む全6 capability root完全初期化のどちらかだけを許す。

したがって`ExpectedStoreRoot`は正常snapshotで`present`だけを表す。`dbVersion === null || dbVersion < Vcap`かつ新store、5 payload root、fence、それらのmetadata／checkpoint／recovery candidate導入traceが全てなく、event名基準preflightがcollision-free、proposalからのscope導出がresolvedの場合、`databaseTargetMode = "core-current"`だけを`core-only` terminalとし、`fsmc-vcap-qa | fsmc-vcap-production`はbootstrapへ進める。raw day collisionは`map-cell-split-recovery-required`へ偽装せず、導入trace 0件の`capability-adoption-blocked`としてcanonical collision witnessを返す。通常core rootだけのtraceはこの判定へ混入させない。`dbVersion >= Vcap`でstore、5 payload root、fence、いずれかのmetadata／checkpointが欠ける状態、fence schema／config SHA／埋込historical全行digest／participant digest／actual write coverage／candidate vector／root coverageの自己不整合、capability-owned root差、未処理のbridge conflict、分類不能なlegacy core差、schema非互換、運用後に全recordだけが消えた空store、または`dbVersion === null || dbVersion < Vcap`でも導入traceのいずれかがある状態は`map-cell-split-recovery-required`とし、従来coreだけを継続してsplit／control／durable visit／eventSettings rootをruntime authorityへ採用しない。bridge pendingは専用resume可能状態であり、それ自体をpartial lossへ畳まない。fence欠落は`external-candidate-fence-missing`、fence自己不整合またはcapability-owned差は`external-candidate-fence-inconsistent`、bridge第三値は`event-settings-bridge-conflict`、分類不能core差は`legacy-core-transition-unclassifiable`へ一意に対応させる。healthyなlegacy差はrebase前の一時preflight状態であり、recovery-required snapshotを構築しない。reasonとwitnessの許可対応、必須組合せ、I0 enum順、重複禁止をJSON Schemaへ固定する。通常のsplit export、空root／fence再作成、候補上書き、in-place V2 restoreは行わず、次の明示的な復旧runbookだけを提供する。

#### 6.1.1 `recovery-required`復旧runbook

復旧単位は現在origin内の現在browser profileにあるアプリDB全体とする。event単位の破損に見えても、欠落object storeやfence authorityを別eventの正常性から推測して部分修復しない。画面はorigin、DB名、`dbVersion`、canonical reasons、witness、影響root、読取可能なcore event一覧を表示し、端末外識別子やpayloadを送信しない。

1. I2の`fsmc.recovery.diagnose.v1`はwrite 0件でbounded診断JSONを生成する。untrusted split payload、利用者入力本文、URL、商品名は診断へ含めず、schema／canonical reasons／root存在・digest・件数だけを含める
2. core authorityが正常なeventにはI4の`fsmc.recovery.export-trusted-core.v1`を提供し、eventごとのV1 core、fileName、byteLength、SHA-256と全event checklistを生成する。untrusted split rootを収録せず、「分割設定はこの退避に含まれない」と表示する。core authorityも不正なeventはexport可能と偽らず、既存の外部backupを要求する
3. I2の`fsmc.recovery.reset-split-state.v1`は、`Vcap <= dbVersion <= supportedMaximumVersion`、capability storeとobject-store schemaが互換、全core rootがtrusted、split-owned IDB candidate／durable fallbackの全physical locationをinventoryからexact列挙可能、split-owned external candidate／durable fallback vectorがemptyであり、canonical `reasons`の全要素が`required-root-missing | required-root-schema-incompatible | external-candidate-fence-missing | external-candidate-fence-inconsistent | metadata-checkpoint-incomplete | recovery-authority-inconsistent`のallowlist内で、全reasonに対応する全不整合witnessがcapability-owned rootだけへ閉じる場合に限ってeligibleとする。1件でもallowlist外reason、scope外witness、不明な対応が混在すればeligibleにせず、先頭reasonで上書きしない。previewは失うactive／retained件数、全event OFF、再有効化手順、trusted-core V1または利用者が選択した既存V1／V2／XLSX 2.2の形式別検証結果とfile hash checklistを表示する。利用者がhash checklistと全split設定破棄を二段階確認した後、最新root、preview digest、全physical selectorを再検査し、capability-owned `data`／`control`とsplit対象metadata／checkpointをempty factoryへ置換し、列挙済みsplit-owned IDB candidate／durable fallback recordを同じtransactionで全削除する。pure reset plannerはempty-split after-imageから全resolved eventの`VisitIdentityCoreBasisInputV1`とexecution identityを再構築し、各entryのphase／current／saved／purchase anchor、completion、追加phase membershipをitem ID基準でbyte保持しつつ、必要なら`executionVisitOrder`だけを宣言済みgroup transitionで再keyする。全execution itemがexact 1 groupへ解決し、rejected／retired sliceをbyte保持できる場合だけ、変化するeventのbasis 4 field、両aggregate、durable initialization witnessを更新する。split `data`／`control`と、after-imageが変わる場合の`durable-visit-state` payload／metadata／checkpointだけをlogical participant／historical rowにし、fence payload／metadata／checkpoint自身はそこから除外する。fenceの物理更新は別のexact `administrativeFencePhysicalWrites` manifestへ一致させ、participant digestへ自己参照させない。正常なempty `map-cell-split-v1` after-image、全governed-root baseline、participant historical evidence、administrative fence writeを同一transactionで全旧／全新にする。splitが既にemptyでdurable after-imageもbyte同値ならdurable physical writeを0件にするが、nonempty splitを消したまま旧basis digestだけを保持しない。core payload／metadata／checkpoint／candidateとevent-settings／bridgeはtransaction前後でbyte同値とし、対象root tupleの拡張を禁止する。memory-only fallbackはcommit成功後だけ破棄する。取消、identity再構築不能、stale、quota、abortでは全root／candidate／fallbackを旧状態に維持する
   - 上記eligibleのroot closureはさらにexact化する。`durable-visit-state`／`event-settings`／`event-settings-bridge`のpayload、metadata、checkpoint、全candidateがtrustedかつ相互整合し、bridgeは`synced`、対応localStorage shadow witnessは一致していることを必須の非修復前提とする。`required-root-missing`／`required-root-schema-incompatible`／`metadata-checkpoint-incomplete`／`recovery-authority-inconsistent`をin-place resetで許せるwitnessは`data`または`control`へ閉じるものだけ、fence用reasonは`external-candidate-fence-missing | external-candidate-fence-inconsistent`だけとする。durable visit state、event-settings／bridge、legacy-mutable core、未知rootを指すwitness、またはempty-split after-imageから全entry identity／basisを一意再計算できないcaseが1件でもあればineligibleとし、portable durable visit sectionを含む検証済みV2からのrestore、またはprofile全体coverageがverified-completeなguided reset以外の破壊操作へ進めない。in-place commitはevent-settings／bridgeのpayload・metadata・checkpoint・candidateとlocalStorage shadow、durable entryの進行fieldおよびrejected／retired sliceをbyte同値で維持する一方、empty-split inputで変わるexecution order identity、event basis、aggregate、durable metadata／checkpointを宣言after-imageへ進め、新fenceのtotal historical evidence／baselineへ再拘束する。欠落・untrustedなdurable visit stateまたはevent-settings／bridgeをcore、shadow、empty factoryから再構築しない
4. `FsmcDatabaseOpenResult.kind = "unsupported-database-version"`はsnapshot／core authorityを採用しないため、常に`unsupported-stop`とする。current buildからのDB delete、trusted-core export、restore、in-place／profile resetをすべて0件とし、connectionを閉じたまま対応versionのアプリ入手または既存の外部backup保全だけを案内する。新しいbuildで再診断する前に現在DBを変更しない
5. supported rangeの`map-cell-split-recovery-required`で、`dbVersion === null || dbVersion < Vcap`の`unexpected-introduction-trace`、store欠落・store schema非互換、`legacy-core-transition-unclassifiable`、core不正、candidate／fallbackのselector不明・external nonempty・scope外witness、または3の条件不足ではin-place resetを禁止する。guided profile resetのeligibilityはevent件数だけでなく削除対象全体のcoverage closureで判定する。runtimeでmain DBの`objectStoreNames`、storeごとのkey／record count・schema digest、対象originのapp-owned localStorage keyを列挙し、`config/fsmc-recovery-delete-targets.json`のknown target manifestとexact照合する。全known store／keyの各recordがtrusted-core export、選択V1／V2／XLSX 2.2、またはI0で復元まで証明したlossless opaque backup sectionのexact 1つに被覆される場合だけ削除可能とする。unknown store／key、manifest外schema、被覆0件／複数件、opaque bytesを同じkeyへlossless復元できない対象は、内容が空に見えても`unsupported-stop`、write 0件とし、既知core eventのbackupだけを根拠にDB全体を削除しない。V2はUTF-8 fatal decode、duplicate-property／schema、embedded digestと選択file SHA-256、standalone V1はschemaと選択file SHA-256、companion V1はV2記録hashとの一致、XLSX 2.2はZIP／version／workbook構造と選択file SHA-256を検証し、復元予定／復元不能store・key・eventとhash checklistを表示する。全対象が被覆され、現在originの全tab／Worker／DB connectionを閉じられ、形式別検証が成功した場合だけI5のguided profile resetを選べる。利用者の二段階確認後だけ列挙済みtargetを削除し、6で作るresume key／recovery control DBは完了まで明示除外して、data profileをdevice OFF・enabled event 0件で再作成する
6. in-place resetも、全core eventを被覆する検証済みtrusted-core exportまたは選択backup、recovery exclusive lock、最新eligibility再検査を実行前提とし、backup不足、別tab blocked、stale、条件不明では`unsupported-stop`、write 0件とする。profile resetはdeleteとrestoreを原子的と表示しない。破壊操作前に専用localStorage key `FSMC_RECOVERY_RESUME_KEY = "__esp_internal__:fsmc-recovery-resume:v1"`と専用IDB `FSMC_RECOVERY_CONTROL_DB = "event-shopping-planner-fsmc-recovery-control-v1"`を作り、どちらもguided resetの削除対象から除外する。通常root／candidate／Backup authorityには使わず、current recovery session以外のapp writeを許可しない
   - localStorage journalはexact stage unionとする。`prepared`はresume contract version、origin、app DB名、source build SHA、random session ID、action、選択backupごとのformat／byteLength／SHA-256、pre-delete inventory digest、target別pre-delete witness、delete-target manifest SHA-256、期待clean-profile digest、record self-digestを必須にする。stageは`prepared | delete-observed | clean-profile-created | restore-required | restore-plan-persisted | restored-awaiting-ack`で、後続stageは前stage fieldを維持し、`restore-plan-persisted`以降だけ`restorePlanRecordId`、`restorePlanDigest`、`expectedRestoreAfterImageDigest`を必須にする。payload、file path／name、URL、event名は禁止する
   - clean profileでbackupを同hash再選択した後、importerは新しいlocal UUID、全external-ref remap、writer ID、commit logical timestampを含む全非決定値を先に発行してcollision検査し、pure restore after-imageを作る。core payloadを複製せずremap表、backup hashes、期待clean digest、expected pre-commit root vector、canonical restore plan digest、期待restore after-image root digestを持つ`PreparedRecoveryRestorePlanV1`をcontrol DBへtransactionalに保存する。control record commit後にそのrecord digestを再読込検証し、localStorage journalを`restore-plan-persisted`へCASする。逆順、未保存remapでのrestore、commit中の時刻／ID再発行を禁止する
   - restore開始時はjournal、control record、再選択backup、clean profile rootを再読込し、保存済みremapを使ってplan／expected after-image digestを再計算する。4者が一致する場合だけ、そのexact planを通常I4 importerまたはlegacy full restoreの単一transactionへ渡す。main DB commit直後・journal更新前に終了しても、再起動時のactual root digestが`expectedRestoreAfterImageDigest`ならcommit済みとして`restored-awaiting-ack`へ進め、期待clean digestなら同planを再実行でき、どちらでもなければwrite 0件で停止する。control record保存後・journal CAS前の終了はsession IDでexact 1 orphan recordを照合してjournalへ採用し、0件／複数件／digest不一致なら採用しない
   - journal単独ではdelete／restoreを開始しない。local key削除途中では、各allowlist targetがpre-delete witnessとbyte一致またはabsentのどちらかだけで、DB削除済み、backup再検証、exclusive connection、再確認が揃う場合に限り残りtargetのidempotent `resume-delete`を許す。targetが未知値へ変化、allowlist外削除、未知stage、digest不一致ではwrite 0件で停止する。fresh profileにjournalがなければ通常clean-startとし、自動的に`recovery-resume-required`と推測しない。delete後・restore前はjournalとDB状態の照合後だけresume-requiredとする
   - `config/fsmc-recovery-resume-compatibility.json`はresume contract versionごとにreader build range、exact migrator ID、source／target schema、migration oracleを固定する。current buildが直接compatibleなら再開し、exact migratorがある場合はmain DB write 0件のままnew journal／control recordを作って全digest一致後に旧recordをsupersededにする。どちらもなければjournal／main DBを変更せず対応buildへ誘導する。journalを破棄できるのは、pre-delete DB完全一致でdelete前取消を二段階確認した場合、期待restore after-image一致で成功ackした場合、またはclean／deleted state＋全backup再検証後にcompatibleな新sessionへの引継ぎが完了した場合だけとする。完了時はlocalStorage journalとcontrol recordを削除し、control DBが空ならDB自体も削除する。origin全消去で両方を失った場合は`PD-18`どおり識別不能なclean-startである。V2は通常I4 importer、V1／XLSX 2.2はlegacy full restoreとして再取込し、別origin／別browser profileを自動選択・削除しない
7. I11は、in-place reset成功／stale／quota、別tab blocked、delete前終了、local key削除途中、control record commit直後、journal plan CAS直後、restore commit直後、V2再選択hash不一致、固定remap／plan／expected after-image不一致、compatible build／migratorあり・なし、V1／XLSX 2.2復元、backup不足、unsupported DB停止をDesktop／MobileでE2E化する。どの分岐もuntrusted split採用、自動merge、別origin削除、成功の虚偽表示を0件とする

`config/fsmc-recovery-actions.json`のdecision入力は軸の直積やsentinel付きobjectではなく、`{ kind: "unsupported-database-version", observedVersion, supportedMaximumVersion } | { kind: "supported-recovery", dbVersion, canonicalReasons, canonicalWitnesses, resetEligibility: "eligible" | "ineligible" | "indeterminate", backupCoverage: "verified" | "insufficient" | "invalid", destructiveCoverage: "verified-complete" | "incomplete" | "indeterminate", connectionState: "exclusive" | "blocked" | "unknown" }`のexact discriminated unionとする。`core-only`とhealthy `map-cell-split-v1`はaction matrix対象外である。unsupported分岐は他fieldを持たず常に`unsupported-stop`とし、current buildのwrite authorityを与えない。supported分岐の各statusは入力者の自己申告を信頼せず、canonical reason集合、全witness、DB version range、store schema、core trust、candidate／fallback authority、runtime target inventoryとcoverage closureからpure verifierが再導出する。全reasonが3のallowlist内かつ全条件成立の場合だけ`eligible`、1件でもallowlist外reasonまたは不適格witnessがあれば`ineligible`、収集不能・対応不明なら`indeterminate`とする。supported recovery＋eligible＋verified backup＋exclusive connectionだけは`in-place-reset`、ineligible＋verified backup＋verified-complete destructive coverage＋exclusive connectionだけは`guided-profile-reset`、その他はcanonical全reasonを表示する`unsupported-stop`とし、全reachable union valueをexact 1 actionへ対応付ける。coverage incomplete／indeterminate、unknown target、unsupported DBへの破壊action、条件弱化、reachable値欠落、複数actionをschema／semantic verifierで拒否する。

`resetEligibility`の再導出は6.1.1-3のroot closureを共通pure関数として使う。特にdurable visit stateとevent-settings／bridge、その各metadata／checkpoint／candidateがtrusted、bridge synced、shadow一致、reset後もdurable entry byte同値で妥当でなければ、reason文字列がallowlist内でも`eligible`にしない。in-place許容witnessはdata／control、fence専用reasonだけへ閉じ、durable visit、event-settings／bridge、legacy-mutable core、unknown rootを指すwitnessは必ず`ineligible`または収集不能時`indeterminate`とする。action schema fixtureはdurable root欠落／不整合／reset後identity不整合、event-settings root欠落、bridge欠落／pending／conflict、shadow第三値、metadataだけ欠落の各caseがin-place action 0件であることを固定する。

破壊的coverageはbooleanや件数一致で表現せず、削除対象ごとの復元根拠を持つ次のexact artifactで証明する。

```ts
declare const FSMC_RECOVERY_RESUME_KEY: "__esp_internal__:fsmc-recovery-resume:v1";
declare const FSMC_RECOVERY_CONTROL_DB: "event-shopping-planner-fsmc-recovery-control-v1";

type RecoveryCoverageDispositionV1 =
  | {
      readonly kind: "backup-covered";
      readonly artifactRef: string;
      readonly sourceRootDigest: string;
      readonly restorePlanDigest: string;
    }
  | {
      readonly kind: "reconstructible-internal";
      readonly contractId: string;
      readonly expectedCleanDigest: string;
    }
  | { readonly kind: "uncovered" };

interface DestructiveProfileCoverageV1 {
  readonly dbName: string;
  readonly dbVersion: number;
  readonly objectStores: readonly {
    readonly storeName: string;
    readonly schemaFingerprint: string;
    readonly recordCount: number;
    readonly recordKeySetDigest: string;
    readonly recordRootDigest: string;
    readonly disposition: RecoveryCoverageDispositionV1;
  }[];
  readonly deletedLocalKeys: readonly {
    readonly storageKey: string;
    readonly rawWitness: LocalStorageRawWitnessV1;
    readonly disposition: RecoveryCoverageDispositionV1;
  }[];
  readonly excludedSurvivors: {
    readonly resumeKey: typeof FSMC_RECOVERY_RESUME_KEY;
    readonly controlDbName: typeof FSMC_RECOVERY_CONTROL_DB;
  };
  readonly inventoryDigest: string;
}
```

`config/fsmc-recovery-coverage.json`はruntime inventoryとのexact bijectionを必須にし、各object store／app-owned localStorage keyをexact 1回だけ列挙する。object storeはschema、record count、canonical key集合、全record rootの全てを拘束する。`backup-covered`は選択artifact、source root、復元先を同一restore planへ結び、`reconstructible-internal`は利用者dataを含まない内部状態だけに許可する。`uncovered`、対象の欠落／重複、manifest外target、count／key set／root digest不一致が1件でもあれば`destructiveCoverage = "verified-complete"`を導出しない。preview直前と破壊操作直前にinventoryとartifactを再読込してartifact全体を再計算し、同一digestの場合だけguided profile resetへ進む。

`config/fsmc-recovery-resume.schema.json`、`config/fsmc-recovery-restore-plan.schema.json`、`config/fsmc-recovery-delete-targets.json`、`config/fsmc-recovery-coverage.schema.json`、`config/fsmc-recovery-coverage.json`、`config/fsmc-recovery-resume-compatibility.json`はjournal／control recordのexact stage unionと最大byte／record数、build互換、stage遷移、surviving localStorage key／control DB、削除対象app DB／local key allowlist、runtime inventory、target別pre-delete witness、backup section、restore destinationのbijectionを固定する。delete前、DB削除直後、local key削除途中、clean profile作成直後、control record commit直後、journal plan CAS直後、restore commit直後、ack直前の各強制終了fixtureで、旧profile再確認、残targetのidempotent resume-delete、clean profile作成、同hash再選択、固定plan再実行、restore完了照合のどれか一意な次状態だけを返す。journal／control record欠落・改変、orphan 0件／複数件、別origin、別DB、compatible reader／migratorなし、backup hash差、remap／plan／expected after-image差、target未知値、unknown object store／local key、coverageの0件／複数件、pre／clean／restored digestの0件・複数一致、journal keyまたはcontrol DBを削除対象へ含めるconfigを拒否する。resume metadataを永続data回復の根拠にせず、main DB write前のplan authorityと中断位置判定だけに使う。

capability storeが利用できないprofileでは分割設定を読書きするcommandを登録せず、従来snapshotと現行のcore autosave規則で保存・復元を継続する。利用できるprofileでは、地図・association・split bindingを変更する複合操作に必要なcore root、settings root、control root、fence rootと、参加rootについてinventoryが列挙する`syncQueue`等の全potential物理IDB storeを、現在candidateが0件でも同一readwrite transactionへ必ず参加させ、設定storeやfenceだけを後から別保存しない。複合commandはtransaction開始後に参加rootのpayload、metadata、checkpoint、IDB recovery状態を同transactionで再読込し、`ExpectedRootVector`の全要素が一致し、全governed rootのexternal precheckとcommit直前のcontrolも許可している場合だけ既存のstore別metadata契約に従って同一transactionで確定する。1要素でも不一致なら全体をabortする。既存metadataへ未知の共通commit fieldを追加する場合は固定旧版Aの読込互換をFSMC-I0で証明し、証明できなければ追加しない。この2経路を型とintegration fixtureで分離し、「必須storeへ入れて起動不能」と「transactionから外れて部分commit」の両方を防ぐ。

`config/db-compatibility-contract.json`、契約検証script、integration fixture、復旧手順を同じPRで更新する。現行旧版がDB6・7を前方互換として開き、未知の追加storeを無視できる性質は、固定した旧版ビルドとの自動互換テストで確認してから採用する。

### 6.2 イベント所有者ID

イベント名だけを所有者にすると、旧版で削除後に同名イベントを作成した場合に古い設定が誤接続される。

各イベントへ`eventInstanceId`を付与し、設定をIDで所有させる。

- 新規作成: 新しいID
- 新版で改名: ID維持
- 新版でイベント全体を複製: event／map／blockへ新しいIDを発行し、イベントに属する地図・商品・分割設定を一体でremapする。既存の別日程・別地図へ分割設定だけをコピーする操作ではない
- 新版で削除: 削除画面は「30日保持」を既定、「今すぐ完全削除」を別の明示選択とする。30日保持では現行データと同じ論理commit内で設定を`dormant`へ移し、成功した削除commit時の端末時刻を`dormantSince`、そこから`30 * 24`時間後を`purgeAfter`として記録する。期間内は同じ端末の別の現存イベントへのpreview付き再関連付けと即時削除ができるが、設定単独ファイル出力と削除済みイベント本体の復元は初版で提供しない。期限後は`event-deleted`理由の設定とassociationだけを自動削除する
- event削除previewは対象core itemと`DurableVisitStateRootV1`のevent sliceを失うことを別件数で表示する。30日保持はsplit設定／associationだけの保持であり、削除済みevent本体や訪問進行の復元ではない。利用者がevent削除を確定した同じtransactionだけが対象durable sliceを削除でき、background retention cleanupや別eventへのretained再関連付けでdurable visit stateを削除・移送しない。取消、stale、quotaではcore、settings、durable visitの全てを旧状態にする
- 既存イベントへの復元: 復元先IDを維持し、内容だけ置換
- 新しいイベント名への復元: 新しいID
- 外部バックアップのIDをそのまま採用しない

旧版操作によってIDが失われた場合、設定を名前だけで再接続せず休眠データにする。association registry内で同じ`eventInstanceId`が複数primary recordへ現れる場合はroot-untrustedとしてcapability root全体を自動安全モードにする。一方、registryのprimary IDと親子refは一意で正常だが、core側の異なる複数event metadataに同じanchorが現れる場合は、`lastKnownEventName`や地図指紋が一致しても一方を選ばず、そのanchorに対応するassociation classと関連entryだけをquarantinedへ移す。後者のentry単位隔離では、安全に結び付いた他eventを継続できる。

各日程の地図へsidecar上の`mapInstanceId`、各論理ブロックへ`blockInstanceId`を付与する。

- 地図再取込で一意一致し、利用者がプレビューを確定した場合だけmap／block instance IDを維持する
- イベント全体の複製に伴う地図・ブロック実体の複製では新しいIDを発行し、参照をまとめてremapする。既存の別日程・別地図・別ブロックへの分割設定だけのコピーは後続版とする
- 表示名の改名だけではIDを変更しない
- 地図削除や旧版操作で所有先を確認できない設定は`dormant`、root正常時のcore anchor／slot多重解決・曖昧一致・個別不正値は`quarantined`へ移す。registry primary ID重複はentry隔離へ格下げせずroot-untrustedとする
- `lastKnownEventName`、`lastKnownDayKey`、`lastKnownMapName`、`lastKnownBlockName`は診断用であり、名前だけでactiveへ戻さない

sidecar registryだけでは、旧版でイベントを削除して同名・同内容を再作成した操作を識別できない。このため、現行`EventMetadata`へoptionalな`splitIdentityAnchor: SplitIdentityAnchorV1`を追加し、registryの`eventAssociations.anchorToken`にも同じtokenを必須保存する。anchorはschema versionと暗号学的乱数で発行した不透明なevent tokenだけを持ち、event／map／block instance ID、名前、地図指紋を含めない。map／block IDはsidecar内だけに保持し、`mapData`本体には追加しない。

URLなしで作成したイベントも、分割機能を有効化する最初の原子的commandで既存shapeを満たすempty-source `EventMetadata` recordを作成する。`spreadsheetUrl`、`spreadsheetSheetName`、`lastImportDate`は空文字、`splitIdentityAnchor`は有効tokenとし、架空URLを保存しない。固定旧版Aがこのrecordを読込・保存・V1 exportできることをgolden testで確認する。metadata record、registry token、event設定のいずれか一つだけを作るfallbackは禁止する。

- 新版はsidecar registryと`splitIdentityAnchor`の一致をactive条件とする
- 起動時にregistryの旧event keyが存在せず、同じanchorを持つ`EventMetadata`がちょうど1件だけ存在する場合は、旧版改名としてregistryのcurrent keyをそのevent keyへ原子的に更新する。0件はdormant、複数件はquarantinedにする
- 固定した旧版ビルドが、改名・通常状態更新・バックアップ往復で未知anchorを保持することをA/B/A試験で確認する
- 旧版の更新処理がanchorを落とした場合、または削除・同名再作成でanchorが欠けた場合は、名前・内容・地図指紋が同じでも該当設定をdormantにする
- 旧版複製で同じanchorが複数イベントへ現れた場合はquarantinedとし、自動で片方を所有者に選ばない
- 旧版がanchorを保持しない操作まで分割設定の自動復元を保証しない。従来データを壊さず、preview付き手動再関連付けで復旧する
- 旧版V1バックアップは未知fieldである不透明tokenをそのまま含め得るが、instance IDは含まれない。新版がV1を取り込む際はtokenを外部authorityとして採用せず、現在profileのsidecarに同じtokenの一意な既存対応がある場合だけ同一イベント候補としてpreviewし、0件はdormant、複数件はquarantinedにする
- I0で`EventMetadata`の全writerを`config/fsmc-event-metadata-writers.json`へ列挙し、作成、update、source switch、既存eventへのbulk add、CSV／XLSX import、V1／V2 restore、改名、複製、削除・同名再作成ごとにanchorを「発行」「保持」「新規remap」「意図的除去」のいずれにするか固定する。未登録writerをarchitecture verifierで失敗させ、I3で全行を実装・試験する。固定旧版Aのsource switchや再構築writerがanchorを落とす場合は、新版へ戻した際にdormantとすることを期待値にし、自動rebindを要求しない
- イベント削除retentionの定数を`RETENTION_MS = 30 * 24h`、`MAX_UNOBSERVED_FORWARD_MS = 35 * 24h`、`CLOCK_CONFIRMATION_MS = 24h`、session内wall clockとmonotonic clockの許容差を5分としてI0 fixtureへ固定する。削除commitでは`lastObservedWallClock = dormantSince`、`clockState = { kind: "trusted" }`で初期化する。`purgeAfter`が`dormantSince + RETENTION_MS`と一致しない場合は、該当eventの`event-deleted` entryを`invalid-retention-window`としてquarantinedにし、時計anomaly stateへ変換せずcleanupを停止する。各起動・保守commitで`lastObservedWallClock`をCAS更新し、現在時刻がそれより前、未観測前進が35日超、または同一sessionでmonotonic経過との差が5分超なら`confirmation-required`へ移し、exact reason、`stableSince = now`、`confirmationNotBefore = now + CLOCK_CONFIRMATION_MS`を保存して削除を延期する。確認中に再度anomalyを観測した場合は両時刻をその`now`から再設定する。時刻が逆行せずsession差も許容内で、`now >= confirmationNotBefore`となった後だけ`trusted`へ戻す。trustedかつD+30以降に`event-deleted`対象だけを単一commitで削除する。D+29、D+30、31日offline、36日offline、rollback、session内forward jump、確認中再起動・再anomalyをgolden clock fixtureで固定する

### 6.3 アプリスナップショット

runtime snapshotと外部backup wire typeを分離したうえで、次を同時に対応させる。

- 現行10-section `CorePersistenceSnapshot`と3分岐`FsmcPersistenceSnapshot`。healthy分岐だけが`split`、`control`、`durableVisitState`、`eventSettings`、`eventSettingsBridge`を必須にし、`core-only`／`map-cell-split-recovery-required`分岐では5 fieldを`never`とする。runtimeの`AppData`へcapability sectionを二重追加しない
- 初期読込
- 通常autosave
- 未保存表示と再試行
- PWA更新ブロッカー
- 原子的復元
- recovery candidateと復旧状態
- イベント作成、改名、削除、複製
- 地図再取込
- イベント単位Backup V2とV1互換core同時出力
- event別enabled、端末全体のローカル制御、自動安全モード、active／dormant／quarantined

UIやfeatureコードからIndexedDBを直接呼ばず、既存の`PersistenceCommandPort`と単一コミット経路を通す。現行`src/app/commands/ApplicationSnapshotCommitPort.ts`の`Partial<PersistenceSnapshot>` patch commitと、productionで同callbackを呼ぶ`src/App.tsx`（1 site）、`src/app/commands/useMapEditorCommands.ts`（6 sites）、`src/app/commands/useShoppingItemMutationCommands.ts`（1 site）、`src/app/commands/useMapImportCommands.ts`（1 site）、`src/features/map/domain/mapImportFlow.ts`（1 site）の5 file／10 call siteをI0 change-surface inventoryへ固定する。`useMapImportCommands.ts`と`mapImportFlow.ts`のcanonical Portをimportしない構造的callback再宣言もsymbol／signature探索対象とし、import ASTだけのinventoryを許さない。FSMC capabilityがactiveなQA artifactまたはrelease-ready production artifactでは、これらの直接・間接edgeからcore、split、control、durable visit、event settingsの一部だけをcommitする経路をarchitecture testで0件にする。legacy patch-only Portは`core-only`、またはFSMC OFFでitem／event／map／hall／association／durable visitを変更しないとafter-image participant verifierが証明した明示compatibility allowlistに限る。OFFでもidentityやdurable stateへ影響するcommandは専用atomic Portを必須とする。allowlistのcommand ID、変更可能root、終了phaseを`config/fsmc-command-participants.json`へexact登録し、未登録caller、間接wrapper、structural callback、dynamic dispatch、`Partial<>` castでの迂回を失敗させる。

`mapCellSplitSettings` rootと`durable-visit-state` rootは、他のアプリpayloadと同じtransaction、metadata、checkpoint、recovery candidateへ参加させる。mapDataと設定を同時に変更する操作は`commitMapAndSplitAtomically(expectedRoots, mutation)`、item／map／hall identityまたは訪問進行を変更する操作は`commitVisitStateTransitionAtomically(expectedRoots, mutation)`、イベントanchorを含む操作は`commitEventLifecycleAndSplitAtomically(expectedRoots, mutation)`、イベント単位復元は`restoreSplitCapableEventSnapshotAtomically(expectedRoots, snapshot)`という専用Port commandを通す。各commandのparticipant manifestは実際に変わるcore、`data`、`control`、`durable-visit-state`、`event-settings`、`event-settings-bridge`だけを列挙し、参加storeごとのroot vectorをtransaction内で検証する。いずれか一部だけを確定するfallbackを設けない。

現行V1の`eventSettings.blockDetectionSettings`はlocalStorage key `blockDetectionSettings`をauthorityとしており、IndexedDBだけのtransactionへ参加できない。本計画ではVcap導入時に、capability storeのgoverned key `event-settings`へ次のcanonical rootを作り、新版Bの全read／write／backup authorityをこのrootへ一本化する。event名keyed localStorage objectは固定旧版A専用の互換projectionであり、canonical root、CAS、Backup snapshotのauthorityにしない。

```ts
interface BlockDetectionSettingsValueV1 {
  maxBlockNameLength: number;
  allowedCharTypes: Readonly<{
    katakana: boolean;
    hiragana: boolean;
    alphabet: boolean;
    kanji: boolean;
    digit: boolean;
    symbol: boolean;
  }>;
  allowDigitSymbolOnly: boolean;
  minNumberCellsPerBlock: number;
  minMergedCellCount: number;
  numberCellMin: number;
  numberCellMax: number;
  maxRegionSize: number;
  polygonThreshold: number;
}

interface EventSettingsRootV1 {
  schemaVersion: 1;
  entries: readonly Readonly<{
    eventInstanceId: string;
    lastKnownEventName: string;
    blockDetectionSettings: BlockDetectionSettingsValueV1 | null;
  }>[];
}

interface EventSettingsLegacyBridgeJournalV1 {
  schemaVersion: 1;
  operationId: string;
  commandId: string;
  canonicalBeforeDigest: ProjectionDigestDescriptorV1;
  canonicalAfterDigest: ProjectionDigestDescriptorV1;
  legacyBeforeWitness: EventSettingsShadowWitnessV1;
  legacyAfterWitness: EventSettingsShadowWitnessV1;
}

type EventSettingsShadowWitnessV1 = LocalStorageRawWitnessV1;

type EventSettingsBridgeRootV1 =
  | {
      schemaVersion: 1;
      state: "synced";
      storageKey: "blockDetectionSettings";
      projectionVersion: 1;
      canonicalRootDigest: ProjectionDigestDescriptorV1;
      legacyShadowWitness: EventSettingsShadowWitnessV1;
    }
  | {
      schemaVersion: 1;
      state: "pending";
      storageKey: "blockDetectionSettings";
      projectionVersion: 1;
      journal: EventSettingsLegacyBridgeJournalV1;
    }
  | {
      schemaVersion: 1;
      state: "conflict";
      storageKey: "blockDetectionSettings";
      projectionVersion: 1;
      journal: EventSettingsLegacyBridgeJournalV1;
      observedThirdWitness: EventSettingsShadowWitnessV1;
    };
```

`entries`は`eventInstanceId`のUTF-16 code-unit順、ID重複なしとし、不在はoverrideなしを意味する。`lastKnownEventName`はlegacy projection生成用witnessでありidentity authorityにしない。persistence用`BlockDetectionSettingsValueV1`と独立wire DTOは上記の同じ明示field集合を持ち、`maxBlockNameLength: 1..10`、`minNumberCellsPerBlock: 1..20`、`minMergedCellCount: 1..12`、`numberCellMin: 0..9999`、`numberCellMax: numberCellMin..9999`、`maxRegionSize: 500..10000`、`polygonThreshold: 50..100`の整数、6個の`allowedCharTypes` boolean、`allowDigitSymbolOnly` booleanだけを許し、欠落・未知keyを拒否する。wire層はpersistence型をimportせずschema goldenで同値制約を検証する。event create／rename／delete／whole duplicate／full・core restoreはcore anchorとこのrootを同じIDB transactionでall-old／all-newにする。

初回移行はlocalStorage raw DOMStringのE0 witnessとexact parse結果を作り、transaction内でE1再検証した後、event anchorでevent名をinstance IDへ一意に解決できる行だけをcanonical rootへ移す。`EventSettingsShadowWitnessV1`は`getItem() === null`のabsentとpresent empty stringを区別する。欠損event、同名多重event、不正settingsは推測採用せずrecovery-requiredとする。fresh profileはempty canonical rootと、absent shadowを表す`synced` bridgeをfactory生成する。既存profileでtarget shadowとE1が異なる場合は、canonical rootと`pending` bridgeを同じtransactionでcommitしてからresumeする。新版commandはcanonical rootとcore／split rootを同じIDB transactionで更新し、同transactionでbridge rootを`pending`へ確定する。commit後にlocalStorage全objectをcanonical after-imageへ1回置換し、raw witness一致後の別transactionでbridge rootを`synced`として完了させる。UI success、旧版へのversion handoff、次のeventSettings mutationは`synced`後だけ許可する。

強制終了時はjournal、canonical before／after digest、external before／after witnessからnext actionをexact 1件へ再計算する。externalがbeforeならafter-imageを再適用、afterならackを完了し、それ以外は旧版Aとの競合として第三値を上書きせずdurable `conflict`へ止める。canonical rootを補償rollbackせず、localStorage失敗を「IDB未保存」と表示しない。journalが`synced`の状態で固定旧版Aによる正当なlocalStorage差を検出した場合だけ、`config/fsmc-legacy-event-settings-transitions.json`のbefore／after raw、parser結果、関連core transitionへexact 1件一致することを条件に、`fsmc.internal.reconcile-event-settings-shadow.v1`が同じE0／E1、event anchor、canonical CASを使って新版rootへ取り込む。0件／複数一致、malformed、同名再作成はrecovery-requiredとする。rename、delete、whole-event duplicate、V1／V2 restore、map import時settings保存を含む全writerをinventoryへ列挙し、現行`runWithBlockDetectionSettingsRestore`の補償rollbackを新版commit authorityとして残さない。

`event-settings`、`event-settings-bridge`、対応metadata／checkpoint／candidateは`FSMC_GOVERNED_ROOTS_V1`、initial fence、`ExpectedRootVector`、failure injectionへ参加する。exportはcanonical IDB rootだけをcoreと同じreadonly transactionで読み、localStorageはbridge完了確認用witnessとしてのみ検査する。bridge pending／conflict中はV1／V2 pair生成、restore、rename、delete、duplicateを成功扱いにしない。in-place split resetはcanonical event settingsとbridgeをbyte同値で保持し、missing／untrusted canonical rootをshadowから自動再構築しない。

### 6.4 旧版互換の保証範囲

保証するもの:

- 同じブラウザデータを新版で開いた後、旧版へ戻して起動できる
- 旧版では26a/26bを従来どおり1つの番号セルとして表示する
- 旧版は新しいobject storeを変更しない
- FSMC-I0でanchor保持を確認済みの旧版操作では、`splitIdentityAnchor`、association registry、instance ID、binding evidenceがすべて一致する分割設定が新版で復元される。いずれかが欠ける場合はdormantとし、自動接続しない
- 固定旧版Aがcoreだけを正常に改名・状態更新した後は、新版Bが`classifyLegacyCoreTransitionV1`で`legacy-mutable-core`だけの説明可能な差と検証し、分割機能を再開する前に`fsmc.internal.rebase-legacy-core.v1`でfenceのhistorical evidenceと全root baselineを現在値へ原子的に進める。anchor／bindingが一致すれば設定payloadを変更せずactiveを維持し、owner消失はdormant、曖昧・競合はquarantinedとし、別ownerへの自動接続やdurable state削除を行わない
- capability-owned rootの差、fenceの自己不整合、説明不能なcore差は旧版更新と推測せず、安全モードとBackup復旧案内へ送る。正常な旧版core差だけを理由に破損扱いしない
- 不一致設定を別イベントへ誤適用しない
- 採択済み`Vcap`以上かつsupported上限以下のprofileで新storeなし・非互換ならpartial-loss安全モードで従来機能を起動でき、分割機能が利用不可である理由とBackup復旧案内を表示する。DBなし／pre-`Vcap`の未導入profileをcore-only terminalにできるのは`core-current` artifactだけで、Vcap targetはcollision-freeならupgrade、collisionならadoption-blocked、導入traceありならrecovery-requiredとする

保証しないもの:

- 旧版アプリから分割設定を表示・編集すること
- Backup V2を旧版へ直接復元すること。ただしV2と同時出力するV1互換core backupは旧版へ復元できる
- IndexedDBをDB5へ戻すこと

### 6.5 複数タブの保存競合

分割設定も現行永続化基盤のstore別revision、metadata、checkpoint、CAS規則へ参加させる。専用storeへpayloadだけを直接`put`する経路を作らない。

- 各タブは最後に正常読込または正常保存した参加storeすべてのrevisionを`ExpectedRootVector`として保持する
- 保存transaction内で現在のpayload、metadata、checkpointを再読込し、root vectorの全要素が一致した場合だけ複合操作を確定する
- 同じroot vectorを読んだ2タブでは先にcommitした側だけを成功させ、後続のstale保存を`PersistenceConflict`として停止する
- staleな設定をlast-write-winsで上書きせず、自動マージ、自動再試行、期待rootの黙示更新を行わない
- 競合時は既存の保存失敗表示、他タブを閉じる案内、JSONバックアップ、再試行に加え、最新DBを明示的に再読込する導線を追加する
- 再読込前に未保存データをJSONへ退避できるようにし、利用者がローカル未保存変更の破棄または退避内容との比較・再編集を選べるようにする
- staleな期待root vectorのままの単純再試行は成功扱いにせず、最新root vectorを正常読込した後の編集だけを各storeの次の子revisionとして保存できる
- 初版では通常保存へ新しいタブ間Web Lock、BroadcastChannel同期、他タブの強制閲覧専用化を必須としない。正当性の境界はIDB内root／candidateのtransaction CASと、external candidateのdurable fence＋pre／post観測による検出である
- 地図再取込、イベント改名・削除、イベント単位復元等の複合操作も同じCASで全体をrollbackし、部分commitを起こさない

このCASは同じbrowser profile内の複数タブだけを保護する。PCとスマートフォン等の別端末間には共有revisionがないため、自動同期、自動merge、端末間競合解決を保証しない。初版は1イベントにつき主に編集する端末を1台とし、別端末へ移す場合は移動元でBackup V2を作成し、移動先の既存イベントをpreview後に原子的置換する。両端末で編集した差分を合成せず、復元前に復元先の退避backupを案内する。

I0のfailure injection stage IDは`after-snapshot-read`、`after-external-baseline-e0-check`、`after-transaction-open`、`after-idb-candidate-reread-before-first-write`、`after-external-e1-recheck-before-first-write`、`after-control-reread`、`after-core-write`、`after-settings-write`、`after-control-write`、`after-metadata-checkpoint-write`、`before-commit`、`after-idb-commit-before-external-postcheck`、`after-external-postcheck-before-ui-ack`、`after-legacy-rebase-r0-read`、`after-legacy-rebase-r1-before-first-write`、`before-legacy-rebase-commit`、`after-legacy-rebase-commit-before-r2`、`after-legacy-rebase-r2-before-ui`とする。通常commandのcommit前stageのexception、abort、QuotaExceeded、強制終了では全参加IDB rootを旧状態、commit後では全参加IDB rootとfenceを新状態として再起動時に読めることをoracleにし、いかなるstageでもIDB新旧混在を許さない。commit後のexternal差が説明可能なlegacy-mutable coreだけなら`committed-legacy-rebase-required`としてrollbackせずrebaseし、capability-ownedまたは分類不能な差だけを`committed-recovery-required`とする。legacy rebaseのR0→R1差はwrite 0件、commit前失敗は固定旧版Aが既に確定したcurrent core＋rebase前fenceを維持して`legacy-rebase-pending`から再試行、commit後失敗はcurrent core＋new fenceと必要なstatus変更が全て確定済みとして再開する。R1→R2の追加legacy差は次rebase、それ以外はrecovery-requiredとする。control revision変更はCAS拒否またはtransaction lock順の先行commitとして線形化する。network切断はIndexedDB atomicity faultへ混ぜずoffline matrixで扱う。I2でcore／settings／control／legacy rebase command、I4でBackup置換を実commandへ接続し、I11ですべてを横断再実行する。

### 6.6 ローカル制御と安全モード

端末全体のローカルOFF、イベント単位enabled、build固定の`SplitImplementationReadiness`、DB／root schema／association authority検証失敗時の自動安全モードを`SplitMapLocalControlPort`で一元判定する。優先順位は自動安全モード、readiness不足、端末全体OFF、event OFF、ONの順とし、すべての条件を満たす場合だけsplit mutationを許可する。readinessを満たすのは`release-ready` production、または`internal-testing`かつcompile-time overrideを持つnon-promotable QA artifactだけで、`contracts-only`と`internal-testing` productionは不足とする。外部availability service、署名receipt、TTL、remote kill switch、外部metricsを導入しない。

- 既存イベントとBackupから新規復元したイベントのcontrol entryは`enabled=false`を既定とし、利用者が当該端末でイベントごとに明示ONにする。event setting payloadへenabledを重複保存しない
- 端末全体とevent別状態は`mapCellSplitSettings` storeの`control` rootで管理し、同じprofile内の複数tabではfull observed rootとcheckpointのCASを使う。別端末へ同期せず、Backupにも収録しない
- registryはartifact purpose、readiness、open result、initializationでexactに分ける。`contracts-only` productionは全FSMC command 0件、`internal-testing` productionはcode存在を許すがpublic registration 0件、non-promotable QAはhealthy QA rootでinternal registryへ`readSplitControl`、`previewSplitEnablement`、`enableSplitForEventAtomically`、`disableSplitForEventAtomically`、`setSplitDeviceEnabledAtomically`、`setForceSplitPickerAtomically`を登録できる。release-ready productionの`capability-adoption-blocked`ではtrusted core V1退避、collision診断、`fsmc.repair.legacy-focus-day-scope.v1`だけを登録し、capability DB open／createと通常app writeを0件にする。`migrating`ではmigration診断／V1退避／`fsmc.migrate.durable-visits.v1`だけ、healthy `ready`で初めて通常control 6 commandをpublic registryへ登録する。readyかつOFF中は端末switch、event preview、disable、picker preference変更へ到達できるが、セル分割設定・描画・経路等のmutation commandはeffective ONの場合だけ利用できる。`missing`／`repair-required`は6.1 recovery registryだけとする
- event OFF→ON commandは最新のcore、settings、control、durable visit、metadata、checkpoint、IDB内candidateを同じreadwrite transactionで再読込し、external candidateは6.1のpre／post観測とdurable fenceで拘束して、`C(after) = ∅`、anchor、association、map binding、`DurableVisitInitializationStateV1 = ready`、対象eventの全導出day scopeとdurable entryのexact bijectionを検証する。必要なempty-source metadata anchor、association、event settings、control entryを同じIDB commitで作成・更新するが、ready rootの欠落entryをenable時に黙示作成せず`durable-visit-state-repair-required`、write 0件にする。preview以後のIDB root変更はstaleとして再previewする。commit後のexternal差は、説明可能なlegacy-mutable coreだけなら`committed-legacy-rebase-required`、capability-ownedまたは分類不能なら`committed-recovery-required`とする
- `buildDurableVisitMigrationPlanV1`は`migrating` rootとlatest coreから`deriveDurableVisitScopesV1`の全scopeをcanonical順に総当たりし、core raw順から`executionVisitOrder`を作る。各scopeに同一processのexact `LegacyFocusSessionSnapshotV1`があればphase／current index、saved 3 index、postponed／late item集合、completion、purchaseの全fieldを検証・変換し、snapshotなしまたはfield不正なら3.8の`defaultDurableVisitEntryV1` field候補、`unresolved-legacy-focus-session-field`、loss previewを作る。preview digestは`basisCoreDigest`、全`legacySessionInputDigest` null／値、全field disposition、after-imageを拘束し、旧session全体が永続sourceではないこと、reload／update／process終了を跨ぐ回収を保証しないことを表示する
- `src/features/map-cell-split/visits/LegacyFocusSessionFreezePort.ts`をapp-facing Port、`legacyFocusSessionRegistry.ts`を唯一のprocess-local capture authorityとする。現行`FocusMode.tsx`のpassive `onSessionStateChange` effectと`App.tsx`のsemantic同値抑止済みparent copyをauthorityにせず、phase／index／saved／postponed／late／completion／purchaseの全setterを一つのrevisioned registry queueへ通してからUIへpublishする。event rename／delete／invalid-key pruneは同じqueueで`beginLifecycleOperation`を呼び、旧eventのraw day集合から`buildFocusSessionKey`で作ったexact key pair／key集合、registry before／after generation、transition／lease digestをfirst persistence write前に予約する。prefix `startsWith`や`slice`でevent名とdayを分離しない。lease ledgerは`active → completed | aborted`だけを許し、persistence失敗前だけ`abortLifecycleOperation`でregistry旧状態、成功後は同期で失敗不能な`completeLifecycleOperationAfterPersistence`によりregistry after-imageをexact 1回適用してからleaseを解放し、React state publishはauthorityにしない。二重finalize、終端間遷移、旧lease replay、generation／digest不一致を拒否する。freeze requestは進行中active leaseの完了を待つbarrierで、barrier後の新規lease／setterをDB first write前に拒否してtokenをinvalidにする。ack済みrecordは旧writer unmount後もfrozen registryへ保持し、取消／失敗tokenを再利用せず、retryは全record／absenceを再captureして新tokenを発行する
- I11所有の`fsmc.migrate.durable-visits.v1`だけが、`DurableVisitScopeDerivationV1.kind = "resolved"`かつmigration shellで`freezeAndCapture`のack完了後に旧session writerをunmountし、latest core、migrating root、settings／control、metadata／checkpoint／candidate／fenceと、frozen tokenの`freezeIssuanceId`／active status／`registryGeneration`／`mappingInputDigest`／全scope present・absent／unmapped record／各`sessionRevision`／`stateDigest`／`unmappedRecordDigest`をIDB transaction開始前とfirst write直前に同期再検査する。previewとexact一致し、全default field／unmapped record破棄の明示確認がある場合だけ、resolved全scopeのafter-image entry、byte保持するrejected eventの既存entry、保存済み`retiredEventPartitions`、canonical `eventBases`、最新のper-event 2 digestとaggregate `basisCoreDigest`／`basisEventAuthorityDigest`、`initialization.status = "ready"`を一つのIDB commitで確定してtokenをconsumeする。`rejectedEventPartitions`はcommit後の同一snapshotから再導出し、永続fieldやparticipantにしない。capture ack欠落、session出現／消失／A→B→A／削除再作成、scope mapping変化、token invalidated／consumed／replay、scope単位の部分commit、確認未済fieldのskip、自動default化を禁止する。取消、stale、scope mapping衝突、quotaではtokenをinvalidatedへ進め、migrating rootを維持してwrite 0件とし、同内容retryでも新`freezeIssuanceId`を要求する。3 counter上限は各typed exhaustion reasonのruntime `repair-required`、token 0件とする。raw day normalization collisionはこのcommandへ到達せずversionchange前の`capability-adoption-blocked`へ送る。完了まではmigration画面とV1退避だけを公開し、V2 export、projection、event preview／enable、C2／C3 production registrationを行わない
- ready移行後はevent／day scope、item集合、実行順を追加・変更・削除する全lifecycle／item／import／restore writerがdurable rootを同じcommand participantへ含める。item／day／execution入力変更は対象行の`basisCoreEventDigest`とaggregate core digestを更新する。anchor保持renameだけなら同じevent IDの`eventNameAtBasis`、per-event authority digest、aggregate authority digestを更新し、event-local core projectionがbyte同値ならcore側2 digestを進めない。plain event createだけはfresh event ID／anchor token／association、basis exact 1行、全dayの決定的default entryを作る。whole-event duplicateはsourceのexecution order、phase、current／saved／purchase anchor、additional phase、completionをsource item／visit IDからfresh destination IDへgroup-preserving lossless remapする。新規destinationへのV2 full-split／core-map restoreはportable durable sectionをfresh local IDへremapし、durable sectionを持たないV1／XLSX 2.2 fullまたは明示item-onlyで新規eventを作る場合だけ決定的defaultを使う。既存destinationへのV2 full／core restoreはdestination event ID／anchor tokenを維持してportable durable stateを適用し、legacy fullは既存durable stateを一意移送、item-onlyは既存durable stateを維持・rekeyする。確認済み新版deleteは同eventのentry、basis、retired rowを除去する。全branchで対象basis 4 fieldと両aggregate digestをafter-imageから更新する。commit後の`eventBases`はcurrent resolved event exact 1行、prior basisを持つrejected event exact 1行、retired partition exact 1行のcanonical disjoint unionとし、rejected basis 0件例外以外の欠落／余分を許さない。phase／current／saved／additional phase／completion／purchaseのauthorityはdurable entry自身であり、同fieldだけのmutationはcore由来digestを変えない。rejected／retired eventの通常writerはwrite 0件とし、全writerはcore、association／anchor、durable root、metadata／checkpoint／fenceを全旧または全新にする。ready rootのcoverage差を通常migrationへ戻さずrepair-requiredとし、`ApplicationSnapshotCommitPort`、event enable、projectionのどこからも補完しない
- `setSplitDeviceEnabledAtomically(true)`はevent有効化commandと区別し、latest rootで`enabledEventInstanceIds`の全eventを走査する。DB／root／association authority自体が不正ならdevice ONを拒否するが、個別eventの`C(S) != ∅`だけを理由にdevice ON全体を拒否しない。controlのdevice ONは原子的に確定し、衝突eventはstored enabled membershipを維持したままeffective legacy fallbackと修正案内、衝突0件のeventはeffective ONとする。`NormalizationCollisionRepairPort`のallowlist commandで`C(after) = ∅`になったeventだけ同じcommit後にeffective ONへ復帰し、他eventやsettingsを変更しない。device OFF中のlegacy編集で衝突を作るfixture、複数enabled eventの一部だけがfallbackになるfixtureをI0 oracleへ含める
- split commandは開始時とcommit直前にcontrol rootとDB capabilityを再検証し、途中でOFF、安全モード、staleへ変化した場合は全体をabortして中間状態を残さない。ON中のidentity変更は`PD-16`の衝突不変条件も同じtransactionで再検証する
- `C(S) != ∅`によるevent単位effective fallbackは、DB／root authority不正による自動安全モードとは別状態とする。通常のsplit definition／copy mutationは拒否するが、`PD-16`で定義した3 IDの`NormalizationCollisionRepairPort` commandだけを同じCAS・after-image検査下で許可し、利用者が衝突を解消できないdeadlockを作らない
- 自動安全モードをevent全体へ適用するのは、DB／store／root schema、settings-controlの対応、association registry root、recovery authorityを信頼できない場合に限る。一意に検証できるroot内の個別entryについてbinding、番号、物理領域が不正な場合はそのentryだけをdormant／quarantinedにし、安全な他entryやeventを停止しない
- `fsmc.internal.rebase-legacy-core.v1`は通常split mutationや利用者起点migrationではなくauthority保守である。capability／settings／control／fence authorityが正常でclassifierが`rebase-required`または導出可能な`legacy-rebase-pending`を返す場合だけ、device／event ONとreadinessに依存せずOFF中にも実行できる。stored enabled membershipとcoreを変更せず、完了までsplitをlegacy fallback／read-onlyにする。`map-cell-split-recovery-required`またはauthority不正の自動安全モードではrebaseを禁止し、read-only診断とBackup案内に限定する
- `PD-04`に従い、OFF／安全モードではsplit固有部分に旧版と同じlegacy resolver、whole-cell geometry、番号identity、UI、core保存commandを使用し、上記authority rebaseを除くsplit identity migrationや利用者操作による分割設定書込みを行わない。I7 Exit後のQA artifactは`PD-14.C2`、I10 Exit後のQA artifactは`PD-14.C3`を機能状態に依存しないconformance修正として常時適用するが、I10以前のproduction artifactはC2／C3の新規public edgeを0件にする。I11 release-ready productionでは`Vcap` migrationとdurable visit初期化がreadyになった後に両方を初めて登録し、ON／OFF共通の`implementation-enforced`不変条件とする。I2～I6は基準source挙動のnon-regressionだけを許しC2／C3を前倒ししない。重複物理cellを新規作成するimport・通常編集after-imageの原子的拒否、既存重複の`map-data-untrusted`判定／map単位route停止は各該当commandの導入phaseから常時適用する。先頭ゼロ除去は機能ONかつ`PD-02` preflight通過時だけ適用する
- OFF／安全モードでもsplit storeとanchorを通常のdefinition／copy操作からread-onlyで保持する。authority正常な内部legacy rebaseは前項どおり制御状態に依存せず許可し、それ以外ではauthority正常、device ON、event OFFの場合だけ専用CAS recovery commandによるretained entryの再関連付け／明示削除を許可する。自動安全モードではread-only診断とBackup案内に限定する。再度ローカルONにした場合だけ現在の商品ID・順序からsplit identityを再構築する。期限到達済み`event-deleted` cleanupはsettings rootとretention authorityが信頼できる場合に限り、端末／event制御状態によらず時計契約どおり実行できる。原本の商品番号をON／OFF切替で書き換えない
- Backup V2／V1へ端末全体OFFとevent enabledを出力せず、V2復元入力に`localEnabled`、`deviceEnabled`、`control`等のfieldがあれば未知keyとして拒否する。V1は7.1の互換matrixに従って未知fieldを扱うがcontrol authorityとして採用しない。既存イベントへの復元では復元先のローカル状態を維持し、新規復元ではOFFとする
- オフラインは通常のローカル運用であり、それだけを理由に安全モードへ移行しない。重大障害時にインストール済み旧versionを遠隔停止できない制約を利用者向け文書へ明記し、端末全体OFFの案内と修正版配布で対処する

## 7. 初版バックアップと後続ファイル機能

### 7.1 イベント単位Backup V2とV1互換core

- handoff resultの`expectedArtifactIds`はcanonical role順・重複なしとし、全completed branchは`handedOffArtifactIds = expectedArtifactIds`／`failedArtifactIds = []`、全incomplete branchは両配列が相互排他的なexact partitionでなければならない。V2-onlyの`companionIssuesDigest`はscope、export、prepared artifact、verificationからcompleted／incomplete resultまでbyte一致させる。disposeもpairの2 handle対V2-only／standaloneの1 handleを判別unionで固定し、null digest＋2 handleやnon-null digest＋1 handleを表現不能にする
- unavailable companionの`issues`は各issueの`esp-json-v1` canonical bytes順、重複なしのnonempty配列とする。`issueKinds`はTypeScript unionの宣言順へ依存せず、version付きliteral `COMPANION_V1_ISSUE_KIND_ORDER_V1`のrank順で`issues[].kind`を重複除去したexact projectionとする。tuple、TypeScript kind union、JSON Schema enumはexact bijectionかつ順序一致でなければならず、新kind追加時のtuple／schema未更新をbuildで拒否する。`issuesDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-companion-v1-issues-v1", reason, issues })))`をscope、export result、prepared artifact、verification、handoffへbyte一致で伝播する。構造reasonへresource issue、resource reasonへ構造issueまたは2件以上のresource issue、issue／kind／reason／digestの単独差を拒否する。issue入力順shuffle、同一kind重複、nested 3 kindの順序、tuple欠落／余分／入替えをI0 goldenへ固定する
- 初版の分割対応backupをイベント単位V2として追加する
- schemaVersion、portable参照、active／dormant／quarantinedを含む`mapCellSplitSettings`セクションと、実行訪問順・phase別anchor・completion・購入変更anchorを持つ`durableVisitState`セクションを追加する
- V1の`data` wire shapeは現行sectionを基準に`AppBackupV1Data`として凍結し、runtimeの`AppData`型を直接参照しない。V1 readerは現行どおり既知必須fieldの型と参照を検証し、現行が受理・保持する未知optional fieldを新たに削除・拒否しない。top-level、data section、eventSettings、`EventMetadata`、item、各nested objectごとの「必須検証／未知保持／未知拒否／export保持」を`config/fsmc-v1-compatibility-matrix.json`と固定旧版A goldenで固定する。`EventMetadata.splitIdentityAnchor`はoptional opaque fieldとして検証するが、他の未知fieldを一律拒否する例外理由にはしない。V2だけが全階層exact schemaと未知key拒否を採用する。対象eventにmatrix上保持必須だが明示V2 DTOへ写せない未知extensionが1件でもあれば`legacy-v1-extension-unrepresentable`、unsafe external URLなら`unsafe-external-url-unrepresentable`、V1が受理し得る非finite／unsafe integer／byte上限超過／shape差なら`v2-strict-scalar-unrepresentable`としてV2／pair生成を停止する。V2 adapterは値を削除・丸め・safe URLへ置換せず、V2へopaque extension bagを捏造しない。同じreadonly snapshotから凍結V1 writerがlegacy core projectionだけをlosslessに証明できる場合に限り、split-capable event全体のbackupではない`trusted-core-only` fallbackとして案内する
- V2を出力するたび、同じ対象eventのcore dataだけを収録した旧版用V1互換backupのlossless生成を試みる。成功時はV1のfileName、byteLength、SHA-256をV2 `scope.companionCore.status = "included"`へ入れ、V2／V1を同じnon-null pair digestのrole別immutable handleとしてstageする。構造上lossless変換不能なら`reason = "not-losslessly-representable"`とresource-limit以外のcanonical issue kind集合、V1 bytesまで生成できたがV1／pair上限だけを超えるなら`reason = "companion-v1-resource-limit"`とexact 1 issue kindを`scope.companionCore.status = "unavailable"`へ入れる。前者は`preparationKind = "structural-v2-only"`、後者は`preparationKind = "resource-v2-only"`の全issue digest付きV2を`pairDigest = null`のsole immutable handleとしてstageし、scope→export→prepared→verification→handoffで同じreason discriminantを保持する。両reason／issueKindsの混在、representability failure後の架空byte見積り、resource-limit branchの構造issueを拒否する。V2 bytesとembedded digestは全分岐で自己parse・再hashし、companion不能をV2生成失敗へ変換しない。各prepared artifactの`selfValidationEvidence`はrole／file metadata／source binding、role別exact parser tuple（V2はcurrent V2 reader、V1はcurrent V1 reader→固定旧版A）、schema receipt、canonical projection receipt tupleを持ち、evidenceのmetadataはartifact common fieldとbyte一致させる。`selfValidationDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-prepared-backup-artifact-self-validation-v1", selfValidationEvidence })))`として自身を除外し、parser／projection順、receipt、source binding、digest-only差を拒否する。handoff直前にregistryがexpected 1件または2件のexact bytes、metadata、role、preparation kind、pair／issues digest、source SHA、source snapshot revision／root vector／snapshot digestを再検証し、`PreparedBackupImmutableBytesWitnessV1`へcanonical role順のartifact ID／handle／declared・recomputed length／SHA／self-validation digest、source binding、pair／issues／warning acknowledgement digestをexactに記録する。`immutableBytesWitnessDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-prepared-backup-immutable-bytes-witness-v1", immutableBytesWitness })))`とし、declaredとrecomputed値、prepared artifact、verification input／resultの全fieldを一致させ、artifact 1件／2件、role順、handle replay、digest-only差を拒否する。unknown／finalized handle、bytes差、role差、reason差はhandoff attempt 0件とする。handle ledgerは`active → consumed | disposed`の一方向とし、expected setを一組でfinalizeする。pairでは片方だけのhandoffを完了扱いにせず同じpair再生成を案内する。V2-onlyではV2 receiptが得られた場合だけreason別の`structural-v2-only-completed | resource-v2-only-completed`とし、旧版fallback不可とV2保管必須の確認を出力前後に表示する。handoff前の`V2OnlyLegacyFallbackWarningAcknowledgementV1`はpreparation kind／reason、V2 artifact ID／SHA、issues digest、固定warning codeをexactに持ち、`acknowledgementDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-v2-only-warning-acknowledgement-v1", acknowledgementWithoutDigest })))`とする。verificationはartifact registryとscopeの実値へ再拘束し、未確認、別artifact／issuesへのack replay、field／digest差を`v2-only-warning-not-acknowledged`／handoff attempt 0件として拒否し、verified／completed／incompleteへ同ack digestをechoする。`BackupArtifactHandoffReceiptV1`はsource binding、preparation kind、pair／issues／warning acknowledgement digest、artifact ID／role／SHA、downstream receipt digestをexactに持ち、`receiptDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-backup-artifact-handoff-receipt-v1", receiptWithoutDigest })))`とする。completed／incomplete resultの`handoffReceipts`はcanonical role順かつ`handedOffArtifactIds`とexact bijection、failed IDsとdisjointにし、pair片側成功はexact 1 receipt、成功0件はempty、completedはexpected全件のreceiptを必須にする。pairDigest nullもtagged値として含め、receipt field／順序／ID partition／digest-only差を拒否する。固定旧版A試験は`included`分岐だけでV2が指すexact V1 bytesを復元する
- export開始時にcore、event metadata、map、association、split settings、durable visit state、canonical `eventSettings`の全参加storeを1個のreadonly IndexedDB transactionで読み、各full root、checkpoint、対象event sliceを含むimmutableな`SplitCapableEventExportSnapshotV1`を1回だけ作る。`participantRoots`は全参加rootの`rootKey = [storeName, key]`、observed revision root、checkpoint、payload digestを持つnonempty exact集合とし、`esp-json-v1(rootKey)`のECMAScript UTF-16 code-unit順へsortして重複を拒否する。`sourceRootVectorDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-split-capable-event-export-root-vector-v1", participantRoots })))`、`sourceSnapshotRevision = sourceRootVectorDigest`とする。7 source slice digestはraw structured-clone値をundefined／hole／-0等のtag付きlossless encoderでfield別domain hashし、`sourceSnapshotDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-split-capable-event-export-snapshot-v1", snapshotSchemaVersion, sourceSha, sourceEventInstanceId, participantRoots, sourceRootVectorDigest, sourceSnapshotRevision, sourceSliceDigests, bridgeJournalDigest, externalProjectionWitnessDigest })))`とする。transaction中は値と同期digest材料だけをcopyし、完了後にhashしてDBを再読込しない。source SHAはproduction build manifestのfull commit SHAへ一致させ、4 source binding fieldはwire payloadへ収録せずinternal prepared artifact registryだけへ保持する。全prepared role、verification input／result、handoff result／receiptは同じbindingをechoし、pair両role差、root順shuffle、root欠落／重複、BMP／astral key順差、slice 1件だけ別snapshot、digestだけの差替えをhandoff attempt 0件で拒否する。transaction開始前後にbridge journalが完了済みであることとlocalStorage互換projection witnessを検査するが、external projectionをbackup payload authorityにしない。V2 objectとV1 core bytesはIDB snapshotだけから生成し、途中でUI state、cache、DB、localStorageを再読込しない。V2変換前に`auditV2CoreRepresentabilityV1`がV1 compatibility matrix上の全保持field、V2 strict scalar／URL／structural rule、全10 section slotをtotal走査する。未知保持extension、unsafe URL、V2 strict scalar違反に加え、duplicate physical cell／ref、cross-section ref不正、order-bearing shape不正、owner relation不正を上記typed issueへ写す。manual hall／hall groupのambiguous ownerは`v2-strict-structural-unrepresentable`の`owner-relation-invalid`とし、候補を補完・統合しない。historical owner tableはmap／blockの親子relationだけを持ち、各retained entryのoptional `lastKnownMapName`を含む`lastKnown*`診断値はentry側でabsent／presentと値をexact保持するため、同owner内の診断差やmap名欠落自体をblockerにしない。rotation／route／viewportのkeyはmapData slotへexact解決できなければ`orphan-map-section-slot`とする。hall definitions／hall routeのkeyは、mapData slotへexact解決できる場合を`owner.kind = "map"`、current `getMaplessKey(rawDayKey)`へexact 1 semantic raw dayから再構成できる場合を`owner.kind = "mapless"`へ写し、どちらでもないorphan keyは`orphan-map-section-slot`、raw `MAPLESS_HALL_KEY`等のevent-wide unscoped ownerが残る場合は`legacy-unscoped-hall-owner-unrepresentable`とする。各issueはfield／section、source path／slot key、payload digest付きcanonical nonempty集合でV2とpairを0件にする。mapless hallをmapData orphanと誤分類せず、orphan／unscoped rowをdrop、synthetic mapData／mapRefへ補完、表示名一致で接続しない。representableな場合だけV1 coreとV2 coreがportable ref化、anchor除去、V1互換matrixが要求する明示transform以外で同値であることをself-testする。readonly transaction失敗、bridge pending／conflict、snapshot内参照不整合では両fileを生成しない。V2 blocker時のstandalone V1 eligibilityは全issue kind／section／violation別に`config/fsmc-v1-fallback-eligibility.json`へ固定し、orphan map sectionは既定でunavailableとする。eligible候補も同snapshotからsource保持必須projection→凍結V1 serialize→current V1 reader→固定旧版A parserを実行し、3 projection digestがbyte一致し、V1 self-validationとresource limitを満たす場合だけ`role = "standalone-v1"`／`pairDigest = null`のimmutable handleを返す。unknown extension、unsafe URL、strict scalar／structural blockerも実際にV1でlossless保持できた場合だけfallback可能で、unsafe URLはraw非clickableのままにする。orphan rotation／viewport等のdrop、正規化、parser差、検証失敗はtyped blocker付き`unavailable`／artifact 0件とし、schema-validというだけでlosslessとみなさない
- `auditV2CoreRepresentabilityV1`は明示DTOへのcopyや`JSON.stringify`より前のraw structured-clone snapshotを、own enumerable keyと全array indexについてcycle-safe／boundedに走査する。objectのown-property値`undefined`はJSONでkey消失するため`v2-strict-scalar-unrepresentable`／`invalid-scalar-shape`、arrayのown `undefined`とsparse holeは`null`化を防ぐため前者を同scalar issue、後者を`v2-strict-structural-unrepresentable`／`order-bearing-shape-invalid`、`Object.is(value, -0)`は`0`化を防ぐため`invalid-scalar-shape`へ写す。`Object.hasOwn`とindex presenceを使い、adapter後の欠落やschema-validな`null`／`0`を原値の代用にしない。issueの`rawWitness`はexact tagged unionとし、object own undefinedはproperty key、array own undefined／holeはindex＋array length、negative zeroは専用tag、NaN／±Infinity、unsafe integer、cycle、非JSON structured-clone kindも各専用tag、通常値だけはstrict finite／non-negative-zeroな`json-value` branchへ写す。`valueDigest`はexact `{ domain: "fsmc-v2-raw-representability-witness-v1", issueKind, violation, sourcePath, rawWitness }`を`esp-json-v1` canonical serializeしたlowercase SHA-256とし、raw `undefined`／hole／`-0`自体をJSONへ渡さない。同じpathのobject undefined、array undefined、hole、negative zero、null、0は全て異なるdigestとなり、tag／index／length／path／digest差をschema・semantic検査で拒否する。top-levelから全10 section、settings、split、durableの保持対象leafまでsource pathとlossless raw witnessを持つcanonical issue集合にし、own `undefined`、array `undefined`、hole、`-0`、通常のabsent optional key、explicit `null`、`0`を独立fixtureにする
- V2 representabilityが成功した後、artifact bytesをstageする前にpure `auditCompanionV1RepresentabilityV1`が同じsnapshotを凍結V1 writer→current V1 reader→固定旧版A parserへ通し、source保持必須projectionのacceptanceと同値性をtotal検査する。`hallVisitLists[].hallId`がresolved normal base以外のpriority／highest／unassigned／unresolved／malformed group tokenである場合と、item `manualHallId`がdanglingである場合はV2 wireでは表現可能でも固定旧版A向けcompanionではlosslessでないため、対応する`CompanionV1RepresentabilityIssueV1`をcanonical nonempty集合で返す。issue 0件だけを`pair-prepared`、1件以上を`structural-v2-only-prepared`とし、後者も自己検証済みV2 object／artifactを返す。hall groupのbase化、dangling manual hallのdrop、synthetic hall definition追加はどちらでも禁止する。reader／固定旧版A validation由来の4 issue kindはkind別`CompanionV1ValidationFailureWitnessV1`にcandidate実byteLength／SHA、source／reader／fixed-A projection、matrix／archive／backup-limits SHA、bounded failure codeまたはoversize capをexactに保持する。oversize branchは`candidateByteLength > temporarySpoolMaxRawBytes`、他branchは実行したreader／parser結果との一致を必須にし、`witnessDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-companion-v1-validation-failure-witness-v1", kind, witness })))`として自身を除外する。kind／witness分岐差、unknown key、path／digest／config SHAの単独差をschema／semantic fixtureで拒否する。resolved normalのpair positive、priority／highest／unassigned／dangling／malformed HallVisitListとdangling manual hallのV2-only positive、issue順shuffle／digest差negative fixtureをI0で固定し、I4で実Workerへ接続する
- resource判定のauthorityはestimateでなくcanonical UTF-8 byte streamの実測値とする。Worker内のversion付き`PreparedArtifactByteSinkV1`はcanonical serializerから最大1 MiB chunkだけを受け、safe-integer byteLengthとincremental SHA-256を更新し、retain対象だけをworker-owned temporary spoolへ保存する。`config/fsmc-backup-limits.json`はcompanion／V2各32 MiB、pair 48 MiBとは別に`temporarySpoolMaxRawBytes = 64 MiB`、`exportGenerationTimeoutMs = 300_000`を固定する。V1は32 MiBを超えても64 MiBまでは全exact bytesをtemporary spoolへ保持し、current reader／固定旧版A parse／source projection比較を完了した後だけresource issueへ分類する。64 MiBを超える場合は全文string／単一`Uint8Array`をmaterializeせず全streamのlength／SHAだけを完了し、limit-only resourceへ短絡せず`fixed-legacy-a-oversize-validation-unavailable`の構造issueへ写して`structural-v2-only`にする。これにより固定旧版A不成立をresource reasonで隠さない。V1が32 MiB以内ならretained bytesをpair候補として維持し、32 MiB超ではvalidation後にspoolをdisposeしてからV2を生成する。V2各fixed-point passも同sinkでcount／hashし、最終passだけ32 MiB以内のbytesをretainするため、pair-only超過判定時の最大retained totalは64 MiB以下となる。`companionV1CandidateByteLength`／SHA-256はそのexact stream、`finalV2ByteLength`はresource issueを埋め込んだ最終V2 canonical stream、`pairCandidateByteLength = finalV2ByteLength + companionV1CandidateByteLength`とする。`appliedLimits`はcurrent configのV2／companion 32 MiB、pair 48 MiB、temporary spool 64 MiB、生成timeout 300,000 msと実file SHAへ一致させ、`exceededLimits`はV1 candidateが32 MiB超なら`companion-v1-max`、pair candidateが48 MiB超なら`pair-total-max`をこの順で含むcanonical exact nonempty subsetとする。`limitWitnessDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-companion-v1-resource-limit-witness-v1", companionV1CandidateByteLength, companionV1CandidateSha256, finalV2ByteLength, pairCandidateByteLength, appliedLimits, exceededLimits })))`とし、自身を入力へ含めない。最終V2長の自己参照は、digestを固定長64文字のzero placeholderにしたissueでlength／exceeded setを再計算するbounded 8回のdeterministic fixed-point loop→安定値で実digestへ置換→同じbyteLength／sum／exceeded setを再検証、の順に解く。安定しない、実digest置換後に値が変わる、最終V2実bytesが32 MiBを超える、generation timeout、spool capの実装違反はartifact 0／DB write 0／handoff 0／cleanup後spool 0 byteのtyped `v2-export-failed`とし、resource V2-onlyへ進めない。`V2ExportFailureWitnessV1`はreason別にpassOrdinal 1～8を固定したexact length 8の全pass byteLength／canonical SHA／full `V2FixedPointStateV1`を持つ。各passは次項で定義するordinal非依存の`convergenceStateDigest`とordinal込みの`observationDigest`を持ち、observation byteLengthをstateの`finalV2ByteLength`、canonical SHAをそのpass実bytesへ一致させる。非収束は隣接passの収束用digestが一度も同値でないことを必須にする。digest置換driftは同じpass ordinalのzero-placeholder／substituted full observationを持ち、slot以外のinputを一致させた再serializeでbyteLength、exceeded set、stateまたはcanonical SHAのいずれかが変わった場合だけ成立する。placeholder／実digest置換前後、最終V2実byteLength／SHA、timeoutのelapsed／stage／sink receipt、またはspoolのattempted retained bytes／stage／sink receiptを持ち、全byte／ms値を非負safe integer、全digestをlowercase SHA-256、`appliedLimits`を同じbackup limits実fileの3値＋SHAへ拘束する。timeout／spool witnessの`PreparedArtifactByteSinkReceiptV1`はsource binding、stage／outcome、stream length／SHA、attempted／actual retained bytes、最大chunk／chunk count、spool／timeout値、elapsed、config SHAを持ち、`receiptDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-prepared-artifact-byte-sink-receipt-v1", receiptWithoutDigest })))`とする。全数値を非負safe integer、`chunkMaxRawBytes <= workerSliceBytes`、actual retainedをstream／spool cap以下、config値／SHAとsource bindingをouter resultへ一致させる。V2超過は`finalV2ByteLength > v2ExportMaxRawBytes`、timeoutはouter stage＝receipt stage、receipt outcome `timeout`、outer elapsed＝receipt elapsedかつ`elapsedMs >= exportGenerationTimeoutMs`、spool超過はouter stage＝receipt stage、outcome `temporary-spool-limit-exceeded`、outer attempted retained＝receipt attempted retainedかつ`attemptedRetainedRawBytes > temporarySpoolMaxRawBytes`を必須にし、reasonとwitness branchの不一致、境界未到達、未知keyをexact schemaで拒否する。`failureWitnessDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-v2-export-failure-witness-v1", sourceBinding: { sourceSha, sourceRootVectorDigest, sourceSnapshotRevision, sourceSnapshotDigest }, reason, failureWitness })))`とし、自身を入力へ含めない。早期estimateは確実なlower-bound超過による処理短縮にだけ使え、成功／V2 core blocker／resource branchのauthorityにしない。cancel／timeout／sink errorは全incremental hash state、chunk、temporary spool、未finalize handleをdisposeしてhandoff 0件にする。resource branchでは候補V1をstage／handoffせず、最終V2 artifactの実byteLength、scope issue、issues digest、limit witnessをhandoff直前にも再計算する。V1-only、pair-only、両方超過のlimit直前／一致／+1、V1 temporary spool 64 MiB直前／一致／+1、issue埋込みで境界が反転するcase、候補V1 byte／SHA、config SHA、exceeded order、8-pass非収束、digest置換drift、final V2 +1、timeout／cancel／spool cleanup、reason差替え、各witness field単独差、config SHA差をI0／I4 fixtureで拒否する
- 前項のfixed-point証跡にある`stateDigest`式とその隣接比較は、ordinal非依存の`convergenceStateDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-v2-fixed-point-convergence-state-v1", state })))`へ置き換える。pass固有の証跡は別に`observationDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-v2-fixed-point-pass-observation-v1", passOrdinal, state, byteLength, canonicalSha256, convergenceStateDigest })))`とし、`passOrdinal`はここだけへ含める。収束は隣接passの`convergenceStateDigest`同値、8-pass非収束は7個の隣接pairがすべて不一致であることをauthorityにし、`observationDigest`を収束比較へ使わない。pass中間の`V2FixedPointStateV1`だけは`exceededLimits = []`を許すが、resource issueへ昇格する`V2FixedPointConvergedResourceStateV1`はcanonical nonempty exceeded tupleと`substituted` slotだけを許す。`V2FixedPointConvergenceResultV1`はempty tuple＋zero slot＋resource issue nullの非resource収束と、nonempty tuple＋substituted slot＋exact resource issueのresource収束を判別し、後者のstateからbyteLength／SHA／pair sum／limits／exceeded tupleをresource issueへexact投影してslot valueを`limitWitnessDigest`へ一致させる。state object自体はwire issueやdigest入力へ重複収録しない。digest置換driftはmapped unionによりexact同一pass `P`、`completedPassCount = P`、同一nonempty exceeded tuple、placeholder／substituted slotだけが異なる2 observationへ閉じる。pass ordinal差、empty resource tuple、state／observation digestの取り違え、convergence result／resource issue projection差をschema／semantic fixtureで拒否する
- `PreparedArtifactByteSinkReceiptV1`は全6 stageについて`completed | timeout | cancelled | sink-error`を判別し、spool超過だけを2 retention stageへ限定するstage×outcome exact unionとする。timeoutはgeneration／validation／fixed-point／finalizationに加えてcompanion／V2 retention中も`export-generation-timeout`へ写す。cancelはbounded cancellation reason付き`export-cancelled`、sink errorはbounded error code付き`artifact-byte-sink-error`として、いずれも`V2ExportFailedResultV1`のartifact 0／DB write 0／handoff 0／cleanup後spool 0 byte terminalへtotalに写す。outer failureのstage、reason固有field、receiptのoutcome／terminal code／reasonまたはerror codeをexact一致させ、`receiptDigest`はvariant固有fieldを含む`receiptWithoutDigest`全体をhashする。`completed` receiptをfailureへ流用すること、retention timeoutの欠落、非retention spool超過、cancel／sink errorのsilent return、別stage receipt replayを拒否する
- prepared artifactは`PreparedBackupArtifactCommonV1<Role>`でouter roleと`selfValidationEvidence.role`を`Extract`により型連動させ、V2 artifactへV1 parser tuple、companion／standaloneへV2 parser tupleを組み合わせられなくする。handoffは`BackupArtifactHandoffBindingV1`のpreparation kind×role mapped unionをauthorityとし、pairはV2／companion＋non-null pair digest＋issues／warning null、構造／resource V2-onlyはV2＋null pair digest＋non-null issues／V2-only acknowledgement、standaloneはV1＋null pair／issues＋standalone acknowledgementだけを許す。実downstream成功は同じsource binding、branch binding、artifact ID／SHA／byteLength、attempt ID、channel、downstream ID、accepted length／SHA、完了時刻を持つ`BackupArtifactDownstreamReceiptV1`として返し、`downstreamReceiptDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-backup-artifact-downstream-receipt-v1", downstreamReceiptWithoutDigest })))`とする。outer `BackupArtifactHandoffReceiptV1`はそのreceipt objectを保持し、innerのsource／branch／artifact field、`acceptedByteLength = artifactByteLength`、`acceptedSha256 = artifactSha256`を再検証した後、`receiptDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-backup-artifact-handoff-receipt-v1", receiptWithoutDigest })))`を計算する。inner未検証、kind×role不可能組合せ、pair／issues／ack nullability差、artifact length／hash差、別attempt／source receipt replay、inner／outer digest単独差はhandoff成功へ数えず、completed／incompleteのreceipt partition検証前に拒否する
- companion auditのtyped集合は前項に加え、`hallOrder[]`のmissing-unresolved／malformed、item-only companionにhall definitionsがない状態のresolved manual hallもそれぞれ`hall-order-token-unrepresentable`／`manual-hall-reference-unrepresentable`へ写す。resolved priority／highestとunassignedのhall-order tokenは固定旧版Aが受理するため誤ってblockしない。resolved normal HallVisitListとfixed-A受理hall-orderのpositive、priority／highest／unassigned／unresolved／malformed HallVisitList、missing／malformed hall-order、dangling manual hall、item-only resolved manual hallのnegative fixtureを固定する
- `pairDigest`は`companionCore.status = "included"`の場合だけ、exact `{ domain: "fsmc-backup-pair-v1", v2: { fileName, byteLength, sha256 }, companionV1: { fileName, byteLength, sha256 } }`を`esp-json-v1` canonical serializeしたlowercase SHA-256とする。V2 bytesはdigest確定済みobject、companion bytesはV2 `scope.companionCore`へ記録したexact bytesを使い、両prepared artifact、verification input、handoff result／receiptのpair digestをbyte一致させる。`unavailable`ではpair digestとcompanion handleを必ずnull／absentにし、issues digestをV2 embedded digest、prepared artifact、verification input、handoff resultへbyte一致させる。role順逆転、fileName／length／hashの1 field差、included／unavailable差替え、pair／issues digestだけ再計算したfixtureをstage前に拒否する
- `StandaloneV1FallbackResultV1.kind = "prepared"`のlossless claimはV1 compatibility matrixが保持するlegacy core＋event settings projectionだけに閉じ、prepared artifact自身へ`coverage = "legacy-core-only"`、固定2件の`excludedRoots`、`recoveryWarning`、compatibility matrix／source／current reader／fixed-A projection digestを必須にする。UIはevent settingsがV1内で保持・復元される一方、split settingsとdurable visit order／phase／anchor／completionはこのartifactから復元不能であり、復元後に分割設定・進行状態の再確認が必要なことをdownload確認前とrecovery previewの双方へ表示する。`verifyPreparedExportForHandoff`は`preparationKind = "standalone-v1"`、role、null pair digest、exact bytes／SHA、4 projection digest、coverage／excluded roots／warning、利用者の`warningAcknowledged = true`をhandoff直前に再検証する。`standaloneWarningAcknowledgementDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-standalone-v1-warning-acknowledgement-v1", artifactId, artifactSha256, coverage, excludedRoots, recoveryWarning })))`をverification／immutable witness／completed・incomplete resultへbyte一致でechoし、別artifactへのreplayとdigest-only差を拒否する。`StandaloneV1FallbackFailureWitnessV1`はkind別にcandidate実byteLength／SHA、bounded reader／parser failure code、source／current／fixed-A projection、matrix／archive／backup-limits SHAまたはresource capをexactに持つ。resource branchは`candidateByteLength > companionV1ExportMaxRawBytes`、他branchは実receiptと一致させ、`witnessDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-standalone-v1-fallback-failure-witness-v1", kind, witness })))`として自身を除外する。kind／witness分岐、field、digest-only差を拒否する。未確認はhandoff attempt 0件、receipt成功だけを`standalone-v1-completed`、失敗を`standalone-v1-incomplete`へ写し、expected／handedOff／failed ID partitionを他branchと同じ規則で返す。split／durable rootがnonemptyでもcore＋event settings退避として生成できるが、完全event backup、V2代替、split復元可能とは表記せず、historical-owner等のsplit由来blockerをV1 coreが保持したと主張しない
- V2の`data`はscope別exact core unionとして固定し、`full-split`／`core-map`は対象event sliceの`eventLists`、`eventMetadata`、`executeModeItems`、`dayModes`、`mapData`、`mapRotationSettings`、`routeSettings`、`hallDefinitions`、`hallRouteSettings`、`mapViewportSettings`をすべて持つ。`item-only`は`eventLists`だけを持ち、他のdata keyを未知keyとして拒否する。split設定はtop-levelに一度だけ収録する
- V2 wire typeのtop-level必須keyは`kind`、`version: 2`、`exportedAt`、`scope`、`eventSettings`、`data`、`mapCellSplitSettings`、`durableVisitState`、`digest`とし、全階層で未知keyを拒否する。`scope`は単一`eventRef`、そのeventに属する全地図の`mapRefs`、itemとcurrent／historical ownerを分けたportable reference table `references`、期待section、mapData／split設定の収録有無、件数、`companionCore: included | unavailable`を明示する。readerは両分岐を受理し、`unavailable`を破損やV2復元不能とみなさない。`eventSettings`と`durableVisitState`はfull-split／core-mapで対象eventのexact slice、item-onlyで`null`とする。item-only restoreは復元元のvisit stateを採用せず、復元先のdurable stateを同じtransition plannerで維持・rekeyする。新規item-only eventは決定的defaultを使う。`mapCellSplitSettings`はfull-split時だけactive／retained entryの判別可能unionを持ち、portable refのdata slot対応を重複保存しない。端末全体OFFとevent enabledはどのsectionにも含めない
- top-level scalarは`kind = "event-shopping-planner-backup"`、`version = 2`、`exportedAt`は`new Date(value).toISOString() === value`となるUTC millisecond ISO文字列、`digest`は64文字lowercase hexとする。`kind`をV1と共通にしてversionでdispatchし、未知kind／versionと非canonical日時を拒否する。端末時計の未来／過去は表示上警告できるが、日時だけを理由に正しいdigestのfileを拒否しない
- V1は引き続き読み込む。利用者が選んだUI command種別をauthorityとし、アイテムimportでは設定を維持し、`PD-01`の完全復元では対象範囲の既存設定をpreview後に`legacy-full-restore-without-split-settings`でdormant化する。V1内のmap key欠落や空配列からitem-onlyを推測しない
- ローカルrevision、checkpoint、`locationKey`、event／map／block instance IDをそのまま出力せず、ファイル内だけで有効なportable参照へ置換する
- `data.eventMetadata`の`splitIdentityAnchor`はV2 export時に除去し、`scope.references`のportable event参照へ置換する。V2を新規eventへ復元するときは復元transactionで新しいローカルanchorを発行し、既存eventへの復元では復元先anchorを維持する。V1／XLSX 2.2をhealthy ready profileの新規eventへfull restoreするときも入力anchorを除去した上で、同じrestore transactionがfresh local anchor、event instance ID、event association、event settings、durable entryを発行する。新event OFFはcontrol rootのenabled membershipだけで表現し、anchor発行を最初のenableまで遅延しない。`core-current` artifactでcapability未導入のlegacy restoreはcoreだけを復元し、後のVcap bootstrap proposalがanchor／associationを同時発行する。V1の既存event復元とitem importは入力anchorで復元先anchorを上書きせず、現在profileの既存sidecarと一意一致する場合も候補説明にだけ使い、`PD-01`のpreviewと明示確定を迂回してactive化しない
- 復元時はevent／map／block／item／historical ownerのportable参照を新しいローカルIDへgroup-preservingにremapし、外部IDをそのまま採用しない。portable durable visitのmember／anchor refを同じitem remap表で変換し、全groupが復元after-imageの同一`PhaseVisitIdentityKey`へexact解決することをfirst write前に検証する
- 形式、値、portable参照、重複entry、status、schemaVersionが不正なファイルはDB更新前に全体を拒否する。構造的には正しいが復元先と安全に一致しないretained entryだけに新しいローカル`dormantEntryId`を発行し、dormant／quarantinedとして保持する。外部event／map／block／entry refをruntimeのinstance IDまたは`priorOwner`へ採用しない
- イベント復元は確定前に復元先、置換、維持、休眠化、隔離、除外、ID remap、ローカルON／OFFを引き継がないことをプレビューする
- プレビュー確定時だけ、地図、アイテム、portable execution visit order、phase別anchor、completion、購入変更anchor、canonical eventSettings、分割設定を同じIDB transactionで置換し、eventSettings legacy bridge mirrorまで完了した後だけ成功を通知する。取消、validation error、CAS競合は全storeを旧状態のまま維持し、IDB commit後のmirror中断はjournalから再開して第三状態を採用しない
- 新しいeventとして復元する場合は新しいローカルIDを発行し、controlのenabled ID一覧へ追加しない。既存eventへ復元する場合は復元先IDとcontrol一覧上のmembershipを維持し、内容だけを置換する
- Backupは端末間同期や差分mergeではない。復元元と復元先の双方に変更があっても自動合成せず、復元先の退避backupを案内したうえで選択したV2の内容へ原子的に置換する
- アイテムだけのimportは既存の地図、event／map instance ID、分割設定を維持し、復元先のdurable visit stateをI1のtransition plannerで同じcommitへrekeyする。削除anchorやidentity衝突を`null`へ黙って落とさず、previewで維持・移送・要修復を区別する
- 一致しない旧version設定は削除せず、読み取れる範囲を`dormant`／`quarantined`として保持する
- 利用者は休眠・隔離設定を端末内で手動再関連付けまたは削除できる。設定単独JSON出力は後続版とする
- JSONのraw byte数、nesting、token数、event／map／entry数、文字列長、error保持数をparse・commit前に検証する。UIは`File.size`だけを検査して`File`を同一originのbundled module Workerへstructured cloneし、main threadで全file `arrayBuffer`／全文stringを作らない。Workerは1 MiB以下のbounded slice、streaming `TextDecoder("utf-8", { fatal: true })`、incremental duplicate-property／非再帰depth／token scanner、exact schema validatorの順で処理し、重複したraw bytes＋全文string＋DTOを同時保持しない。error件数と1件の表示長を上限で切り、cancel／timeoutではWorker、reader、timer、transactionを残さない。Workerは`worker-src 'self'`で許可される同一origin production assetとしてVite manifestとPWA precacheへ登録し、`blob:`／`data:` Worker、remote import、未追跡Blob URLを禁止する
- 上限超過、parse error、digest不一致では既存DBを一切変更せず、理由と退避方法を表示する

V1 full restoreと完全版XLSX 2.2 full restoreはI4の初版legacy restore ownerとする。UI command種別をauthorityにしてitem-onlyとfullを推測で切り替えず、XLSX 2.2は現行Worker／parserが返すmap同梱scopeをversion dispatchで明示判定する。full restoreは、対象event、置換core、既存activeを`legacy-full-restore-without-split-settings`のdormantへ移す件数、既存retainedを元の`dormant | quarantined` status、reason、evidence、`dormantEntryId`のまま維持する件数、ローカルON維持、新規event OFFをpreviewし、core、association、active→retained遷移、既存retained、durable visit state、control、fenceを同じ`ExpectedRootVector`で原子的に確定する。旧形式はdurable visit sectionを持たないため、既存eventでは現在のdurable entryをafter-image itemへtransition plannerで移送し、一意に解決できないentry／anchorを自動削除・`null`化せず要修復としてcommitを止める。新規eventだけはcore実行順の初出順からexecution visit orderを作り、`current = { phase: "normal", anchorItemId: null }`、phase別saved anchorを全null、additional phaseを全null、`isCompleted = false`、`lastPurchaseChangeAt = null`の決定的defaultを作る。既存retainedのreasonを一括上書きしたりactiveへ戻したりせず、新しいcoreとのowner衝突が生じる場合は元statusを保ったまま別の除外reasonをpreviewへ表示してcommit全体を拒否する。取消、parse error、unsupported workbook、stale、quotaではwrite 0件とする。I0はV1／XLSX 2.2の複数地図、empty map、item-only、full、既存dormant／quarantined、durable state移送・要修復、新規default、取消、破損fixtureとtest IDを固定し、I4 Exit、10.2 restore matrix、I11 E2E、DoDの全てで両形式を同じ必須集合として追跡する。

item URLはbackup／V1／V2／XLSX／CSV／通常編集に共通の`classifySafeExternalUrl(value, inputPolicy)`を通す。返却は`none | safe(SafeExternalHref) | unsafe-legacy(raw, reason)`の判別可能unionとし、空文字は`none`であってclickable URLではない。clickableにできるのはuserinfoを持たないabsolute `http:`／`https:`だけとする。ASCII control `U+0000..U+001F`／`U+007F`、bidi control `U+061C`／`U+200E`／`U+200F`／`U+202A..U+202E`／`U+2066..U+2069`、未知scheme、`javascript:`、`data:`、`file:`、protocol-relative URL、parse不能値をunsafeとする。`inputPolicy = strict-new`のV2、CSV、新規作成、通常編集はunsafe値をcommit前に操作全体拒否し、V2 exportも既存unsafe値を含む場合はpair生成を止めて修正を案内する。`inputPolicy = legacy-compat`のV1／XLSX 2.2 importと既存profile読込だけは互換のためraw文字列を変更せず`unsafe-legacy`として保存・診断付きplain text表示し、anchorの`href`へ渡さない。選択時warningと後続編集による修正導線を出し、安全値へ推測変換しない。`CellItemsPopup`、`ShoppingItemCard`を含む全URL sinkはbranded `SafeExternalHref`だけを受け、`target="_blank"`時は`rel="noopener noreferrer"`を必須にする。

V2はtop-levelに`digest`を持つ。raw duplicate-property、UTF-8、resource limit、exact schema、未知keyを先に検証し、`digest`自身だけを除いたexact V2 object（`scope.companionCore`の分岐を含む）を`{ domain: "fsmc-app-backup-v2-v1", backupWithoutDigest }`としてキー順序固定の`esp-json-v1` canonical JSONへ変換したUTF-8 bytesに対するSHA-256を保存する。export直後、parse直後、preview確定直前に再計算する。全top-level／nested field単独差、included↔unavailable差、issue kind／digest差、未知fieldを追加してdigestだけ再計算した入力をgolden／negative fixtureで拒否する。これは破損検出であり、発行者の真正性や改ざん耐性を保証する署名ではない。V1にはdigestを追加せず、V1の読込互換を維持する。

全scopeで必須のportable core reference table `scope.references`と、full-splitだけのsplit entriesを次のexact schemaで固定する。

```ts
type PortableMapCellSplitV1 =
  | { direction: "left-right"; aSide: "left" | "right" }
  | { direction: "top-bottom"; aSide: "top" | "bottom" };

interface PortableSplitBindingEvidenceV1 {
  algorithmVersion: 1;
  blockFingerprint: string;
  locationFingerprint: string;
}

type PortableDormantReasonV1 =
  | "map-missing"
  | "anchor-missing-after-legacy-operation"
  | "legacy-full-restore-without-split-settings"
  | "no-unique-match"
  | "event-deleted"
  | "portable-unresolved-reference"
  | "manual-unlink";

type PortableQuarantinedReasonV1 =
  | "invalid-value"
  | "ambiguous-match"
  | "duplicate-number"
  | "duplicate-block-ownership"
  | "overlapping-number-regions"
  | "merge-crosses-block"
  | "fingerprint-contradiction"
  | "association-duplicate"
  | "invalid-retention-window"
  | "normalization-collision"
  | "normalized-block-name-collision"
  | "duplicate-physical-cell"
  | "map-data-untrusted";

interface PortableEventReferenceManifestV2 {
  schemaVersion: 2;
  events: [
    {
      eventRef: string;
      dataEventKey: string;
    },
  ];
  items: Array<{
    eventRef: string;
    itemRef: string;
    dataItemId: string;
  }>;
  maps: Array<{
    eventRef: string;
    mapRef: string;
    dataDayMapSlotKey: string;
    algorithmVersion: 1;
    mapStructureFingerprint: string;
  }>;
  blocks: Array<{
    blockRef: string;
    mapRef: string;
    dataBlockSlotKey: string;
  }>;
  halls: PortableHallReferenceManifestRowV2[];
  historicalOwners: HistoricalOwnerWireV1[];
}

interface PortableHallReferenceManifestRowV2 {
  eventRef: string;
  hallRef: string;
  sourceHallId: string;
  sourceHallName: string;
  owner:
    | {
        kind: "mapless";
        rawDayKey: string;
      }
    | {
        kind: "map";
        rawDayKey: string;
        mapRef: string;
        sourceMapSlotKey: string;
      }
    | {
        kind: "item-only-source-map";
        rawDayKey: string;
        mapRef?: never;
        sourceMapSlotKey: string;
      };
}

interface HistoricalOwnerWireCommonV1 {
  historicalOwnerRef: string;
}

type HistoricalOwnerWireV1 = HistoricalOwnerWireCommonV1 &
  (
    | {
        ownerKind: "map";
        parent: null;
      }
    | {
        ownerKind: "block";
        parent:
          | {
              kind: "current-map";
              mapRef: string;
            }
          | {
              kind: "historical-map";
              historicalOwnerRef: string;
            };
      }
  );

interface PortableActiveSplitEntryV1 {
  entryRef: string;
  eventRef: string;
  mapRef: string;
  blockRef: string;
  lastKnownEventName: string;
  lastKnownDayKey: string;
  lastKnownMapName?: string;
  lastKnownBlockName: string;
  number: number;
  split: PortableMapCellSplitV1;
  status: "active";
  bindingEvidence: PortableSplitBindingEvidenceV1;
}

type PortableRetainedOwnerV1 =
  | {
      ownerKind: "none";
      mapRef?: never;
      blockRef?: never;
      historicalOwnerRef?: never;
    }
  | {
      ownerKind: "current";
      mapRef: string;
      blockRef?: string;
      historicalOwnerRef?: never;
    }
  | {
      ownerKind: "historical";
      historicalOwnerRef: string;
      mapRef?: never;
      blockRef?: never;
    };

type PortableRetainedNumberV1 =
  | { number: number; originalNumberToken?: string }
  | { number?: never; originalNumberToken: string };

type PortableLastActiveEvidenceV1 = {
  evidenceOrigin: "last-active";
  bindingEvidenceAtLastActive: PortableSplitBindingEvidenceV1 & {
    diagnosticMapStructureFingerprint?: string;
  };
};

type PortableNeverActiveEvidenceV1 = {
  evidenceOrigin: "portable-never-active";
  bindingEvidenceAtLastActive?: never;
};

type PortableRetainedSplitEntryBaseV1 = {
  entryRef: string;
  eventRef: string;
  lastKnownEventName: string;
  lastKnownDayKey: string;
  lastKnownMapName?: string;
  lastKnownBlockName: string;
  split: PortableMapCellSplitV1;
};

type PortableRetainedSplitEntryV1 = PortableRetainedSplitEntryBaseV1 &
  PortableRetainedOwnerV1 &
  PortableRetainedNumberV1 &
  (
    | ({
        status: "dormant";
        reason: Exclude<
          PortableDormantReasonV1,
          "portable-unresolved-reference"
        >;
      } & PortableLastActiveEvidenceV1)
    | ({
        status: "dormant";
        reason: "portable-unresolved-reference";
      } & (PortableLastActiveEvidenceV1 | PortableNeverActiveEvidenceV1))
    | ({
        status: "quarantined";
        reason: PortableQuarantinedReasonV1;
      } & PortableLastActiveEvidenceV1)
  );

interface PortableSplitSettingsV1 {
  schemaVersion: 1;
  entries: Array<PortableActiveSplitEntryV1 | PortableRetainedSplitEntryV1>;
}

type EventBackupCountsV2 = {
  maps: number;
  blocks: number;
  historicalOwners: number;
  items: number;
  activeSplitEntries: number;
  retainedSplitEntries: number;
  durableVisitGroups: number;
};

type PurchaseStatusWireV1 =
  | "None"
  | "Purchased"
  | "SoldOut"
  | "Absent"
  | "Postpone"
  | "Late"
  | "LimitedPurchase";

interface ShoppingItemWireV1 {
  itemRef: string;
  circle: string;
  rawDayKey: string;
  block: string;
  number: string;
  title: string;
  price: number | null;
  catalogPrice?: number | null;
  purchaseStatus: PurchaseStatusWireV1;
  quantity: number;
  limitedPurchasedQuantity?: number;
  remarks: string;
  sheetRemarks?: string;
  url?: string;
  priorityLevel?: "none" | "priority" | "highest";
  protectionLevel?: "full" | "deletable" | "none";
  source?: "spreadsheet" | "app";
  assignedTo?: string;
  lastSyncedAt?: string;
  orderIndex?: number;
  postponed?: boolean;
  manualHall?: PortableHallReferenceWireV1;
}

interface EventListsSectionWireV1 {
  schemaVersion: 1;
  entries: [
    {
      eventRef: string;
      dataEventKey: string;
      items: ShoppingItemWireV1[];
    },
  ];
}

interface EventMetadataSectionWireV1 {
  schemaVersion: 1;
  entries: [
    {
      eventRef: string;
      dataEventKey: string;
      spreadsheetUrl: string;
      spreadsheetSheetName: string;
      lastImportDate: string;
      splitIdentityAnchor?: never;
    },
  ];
}

interface ExecuteModeItemsSectionWireV1 {
  schemaVersion: 1;
  entries:
    | []
    | [
        {
          eventRef: string;
          dataEventKey: string;
          days: Array<{
            rawDayKey: string;
            orderedItemRefs: string[];
          }>;
        },
      ];
}

interface DayModesSectionWireV1 {
  schemaVersion: 1;
  entries:
    | []
    | [
        {
          eventRef: string;
          dataEventKey: string;
          days: Array<{
            rawDayKey: string;
            mode: "edit" | "execute" | "focus";
          }>;
        },
      ];
}

interface BorderStyleWireV1 {
  style: "thin" | "medium" | "thick" | "double" | "none";
  color: string;
}

interface CellBordersWireV1 {
  top: BorderStyleWireV1 | null;
  right: BorderStyleWireV1 | null;
  bottom: BorderStyleWireV1 | null;
  left: BorderStyleWireV1 | null;
}

interface MapCellWireV1 {
  row: number;
  col: number;
  value: string | number | null;
  backgroundColor: string | null;
  fontColor?: string | null;
  borders: CellBordersWireV1;
  isMerged?: boolean;
  mergeParent?: { row: number; col: number };
  isVerticalText?: boolean;
}

type MapCellGroupWireV1 =
  | {
      type: "range";
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    }
  | {
      type: "individual";
      cells: Array<{ row: number; col: number }>;
    }
  | {
      type: "legacy-optional-shape";
      sourceType: "range" | "individual";
      startRow?: number;
      startCol?: number;
      endRow?: number;
      endCol?: number;
      cells?: Array<{ row: number; col: number }>;
      sourceShapeDigest: string;
    };

type PortableBlockNameReferenceWireV1 =
  | {
      kind: "resolved";
      blockRef: string;
      sourceBlockName: string;
    }
  | {
      kind: "unresolved";
      sourceBlockName: string;
      reason: "missing" | "ambiguous";
    };

type PortableHallReferenceWireV1 =
  | {
      kind: "resolved";
      hallRef: string;
      sourceHallId: string;
    }
  | {
      kind: "unresolved";
      sourceHallId: string;
      reason: "missing";
    };

interface PortableHallSourceEquivalenceKeyV1 {
  sourceOwnerDescriptorDigest: string;
  sourceHallId: string;
}

type PortableHallGroupTokenWireV1 =
  | {
      kind: "resolved";
      hallRef: string;
      sourceHallId: string;
      priority: "normal" | "priority" | "highest";
    }
  | {
      kind: "unassigned";
      priority: "normal" | "priority" | "highest";
    }
  | {
      kind: "unresolved";
      sourceToken: string;
      sourceHallId: string;
      priority: "normal" | "priority" | "highest";
      reason: "missing";
    }
  | {
      kind: "unresolved";
      sourceToken: string;
      sourceHallId: null;
      priority: null;
      reason: "malformed";
    };

type PortableHallOrderTokenWireV1 = PortableHallGroupTokenWireV1;
type PortableHallVisitGroupTokenWireV1 = PortableHallGroupTokenWireV1;

interface MapBlockWireV1 {
  blockRef: string;
  name: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  numberCells: Array<{ row: number; col: number; value: number }>;
  nameCells?: Array<{ row: number; col: number }>;
  color?: string;
  isAutoDetected?: boolean;
  isWallBlock?: boolean;
  cellGroups?: MapCellGroupWireV1[];
}

interface DayMapDataWireV1 {
  mapRef: string;
  sheetName?: string;
  rows?: number;
  cols?: number;
  maxRow: number;
  maxCol: number;
  cells: MapCellWireV1[];
  mergedCells: Array<{
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
    value: string | number | null;
  }>;
  blocks: MapBlockWireV1[];
}

interface MapDataSectionWireV1 {
  schemaVersion: 1;
  entries:
    | []
    | [
        {
          eventRef: string;
          dataEventKey: string;
          maps: DayMapDataWireV1[];
        },
      ];
}

interface MapRotationSettingsSectionWireV1 {
  schemaVersion: 1;
  entries:
    | []
    | [
        {
          eventRef: string;
          dataEventKey: string;
          maps: Array<{
            mapRef: string;
            initialAngle: number;
            mapTabAngle: number;
            focusModeAngle: number;
          }>;
        },
      ];
}

interface RouteSettingsSectionWireV1 {
  schemaVersion: 1;
  entries:
    | []
    | [
        {
          eventRef: string;
          dataEventKey: string;
          maps: Array<{
            mapRef: string;
            isRouteVisible: boolean;
            visitOrder: Array<{
              row: number;
              col: number;
              block: PortableBlockNameReferenceWireV1;
              number: number;
              order: number;
              itemRefs: string[];
            }>;
          }>;
        },
      ];
}

type HallDayOwnerWireV1 =
  | { kind: "map"; mapRef: string }
  | { kind: "mapless"; rawDayKey: string };

interface HallDefinitionsSectionWireV1 {
  schemaVersion: 1;
  entries:
    | []
    | [
        {
          eventRef: string;
          dataEventKey: string;
          owners: Array<{
            owner: HallDayOwnerWireV1;
            halls: Array<{
              hallRef: string;
              name: string;
              vertices: Array<{ row: number; col: number }>;
              color?: string;
              blockNames?: string[];
            }>;
          }>;
        },
      ];
}

interface HallRouteSettingsSectionWireV1 {
  schemaVersion: 1;
  entries:
    | []
    | [
        {
          eventRef: string;
          dataEventKey: string;
          owners: Array<{
            owner: HallDayOwnerWireV1;
            hallOrder: PortableHallOrderTokenWireV1[];
            hallVisitLists: Array<{
              hallGroup: PortableHallVisitGroupTokenWireV1;
              itemRefs: string[];
            }>;
          }>;
        },
      ];
}

interface MapViewportSettingsSectionWireV1 {
  schemaVersion: 1;
  entries:
    | []
    | [
        {
          eventRef: string;
          dataEventKey: string;
          maps: Array<{
            mapRef: string;
            zoomLevel: number;
            offsetX: number;
            offsetY: number;
          }>;
        },
      ];
}

interface AppBackupV2FullEventCoreWireV1 {
  eventLists: EventListsSectionWireV1;
  eventMetadata: EventMetadataSectionWireV1;
  executeModeItems: ExecuteModeItemsSectionWireV1;
  dayModes: DayModesSectionWireV1;
  mapData: MapDataSectionWireV1;
  mapRotationSettings: MapRotationSettingsSectionWireV1;
  routeSettings: RouteSettingsSectionWireV1;
  hallDefinitions: HallDefinitionsSectionWireV1;
  hallRouteSettings: HallRouteSettingsSectionWireV1;
  mapViewportSettings: MapViewportSettingsSectionWireV1;
}

interface AppBackupV2ItemOnlyCoreWireV1 {
  eventLists: EventListsSectionWireV1;
}

interface BlockDetectionSettingsWireV1 {
  maxBlockNameLength: number;
  allowedCharTypes: {
    katakana: boolean;
    hiragana: boolean;
    alphabet: boolean;
    kanji: boolean;
    digit: boolean;
    symbol: boolean;
  };
  allowDigitSymbolOnly: boolean;
  minNumberCellsPerBlock: number;
  minMergedCellCount: number;
  numberCellMin: number;
  numberCellMax: number;
  maxRegionSize: number;
  polygonThreshold: number;
}

interface EventSettingsWireV2 {
  schemaVersion: 1;
  entries: [
    {
      eventRef: string;
      blockDetectionSettings: BlockDetectionSettingsWireV1 | null;
    },
  ];
}

type PortableVisitPhaseV1 = "normal" | "postponed" | "late";

interface PortableDurableVisitStateEntryWireV1 {
  eventRef: string;
  normalizedDayKey: string;
  executionVisitOrder: Array<{
    memberItemRefs: [string, ...string[]];
  }>;
  current: {
    phase: PortableVisitPhaseV1;
    anchorItemRef: string | null;
  };
  savedAnchorItemRefByPhase: {
    normal: string | null;
    postponed: string | null;
    late: string | null;
  };
  additionalPhaseByItemRef: Array<
    [string, Exclude<PortableVisitPhaseV1, "normal"> | null]
  >;
  isCompleted: boolean;
  lastPurchaseChangeAt: {
    phase: PortableVisitPhaseV1;
    anchorItemRef: string;
  } | null;
}

interface PortableDurableVisitStateWireV1 {
  schemaVersion: 1;
  entries: PortableDurableVisitStateEntryWireV1[];
}

type V2FullCoreSections = [
  "eventSettings",
  "durableVisitState",
  "data.eventLists",
  "data.eventMetadata",
  "data.executeModeItems",
  "data.dayModes",
  "data.mapData",
  "data.mapRotationSettings",
  "data.routeSettings",
  "data.hallDefinitions",
  "data.hallRouteSettings",
  "data.mapViewportSettings",
];

type V2FullSplitSections = [...V2FullCoreSections, "mapCellSplitSettings"];

type V2ItemOnlySections = ["data.eventLists"];

interface EventBackupScopeV2Base {
  scopeKind: "event";
  eventRef: string;
  references: PortableEventReferenceManifestV2;
  companionCore:
    | {
        status: "included";
        fileName: string;
        byteLength: number;
        sha256: string;
      }
    | {
        status: "unavailable";
        reason: "not-losslessly-representable";
        issueKinds: readonly [
          Exclude<
            CompanionV1RepresentabilityIssueV1["kind"],
            "companion-v1-resource-limit"
          >,
          ...Exclude<
            CompanionV1RepresentabilityIssueV1["kind"],
            "companion-v1-resource-limit"
          >[],
        ];
        issues: readonly [
          Exclude<
            CompanionV1RepresentabilityIssueV1,
            { kind: "companion-v1-resource-limit" }
          >,
          ...Exclude<
            CompanionV1RepresentabilityIssueV1,
            { kind: "companion-v1-resource-limit" }
          >[],
        ];
        issuesDigest: string;
      }
    | {
        status: "unavailable";
        reason: "companion-v1-resource-limit";
        issueKinds: readonly ["companion-v1-resource-limit"];
        issues: readonly [
          Extract<
            CompanionV1RepresentabilityIssueV1,
            { kind: "companion-v1-resource-limit" }
          >,
        ];
        issuesDigest: string;
      };
}

type EventBackupScopeV2 = EventBackupScopeV2Base &
  (
    | {
        contentKind: "full-split";
        mapRefs: string[];
        includesMapData: true;
        includesSplitSettings: true;
        expectedSections: V2FullSplitSections;
        counts: EventBackupCountsV2;
      }
    | {
        contentKind: "core-map";
        mapRefs: string[];
        includesMapData: true;
        includesSplitSettings: false;
        expectedSections: V2FullCoreSections;
        counts: EventBackupCountsV2 & {
          activeSplitEntries: 0;
          retainedSplitEntries: 0;
        };
      }
    | {
        contentKind: "item-only";
        mapRefs: [];
        includesMapData: false;
        includesSplitSettings: false;
        expectedSections: V2ItemOnlySections;
        counts: {
          maps: 0;
          blocks: 0;
          historicalOwners: 0;
          items: number;
          activeSplitEntries: 0;
          retainedSplitEntries: 0;
          durableVisitGroups: 0;
        };
      }
  );

type AppBackupV2 =
  | {
      kind: "event-shopping-planner-backup";
      version: 2;
      exportedAt: string;
      scope: Extract<EventBackupScopeV2, { contentKind: "full-split" }>;
      eventSettings: EventSettingsWireV2;
      data: AppBackupV2FullEventCoreWireV1;
      mapCellSplitSettings: PortableSplitSettingsV1;
      durableVisitState: PortableDurableVisitStateWireV1;
      digest: string;
    }
  | {
      kind: "event-shopping-planner-backup";
      version: 2;
      exportedAt: string;
      scope: Extract<EventBackupScopeV2, { contentKind: "core-map" }>;
      eventSettings: EventSettingsWireV2;
      data: AppBackupV2FullEventCoreWireV1;
      mapCellSplitSettings: null;
      durableVisitState: PortableDurableVisitStateWireV1;
      digest: string;
    }
  | {
      kind: "event-shopping-planner-backup";
      version: 2;
      exportedAt: string;
      scope: Extract<EventBackupScopeV2, { contentKind: "item-only" }>;
      eventSettings: null;
      data: AppBackupV2ItemOnlyCoreWireV1;
      mapCellSplitSettings: null;
      durableVisitState: null;
      digest: string;
    };

type InitialReleaseAppBackupV2WriterOutput =
  | Extract<AppBackupV2, { scope: { contentKind: "full-split" } }>
  | Extract<AppBackupV2, { scope: { contentKind: "item-only" } }>;

type V2CanonicalJsonWitnessValueV1 =
  | null
  | boolean
  | string
  | number
  | readonly V2CanonicalJsonWitnessValueV1[]
  | { readonly [key: string]: V2CanonicalJsonWitnessValueV1 };

type V2RawRepresentabilityWitnessV1 =
  | {
      witnessKind: "object-own-undefined";
      propertyKey: string;
    }
  | {
      witnessKind: "array-own-undefined";
      index: number;
      arrayLength: number;
    }
  | {
      witnessKind: "array-hole";
      index: number;
      arrayLength: number;
    }
  | { witnessKind: "negative-zero" }
  | {
      witnessKind: "non-finite-number";
      numberKind: "nan" | "positive-infinity" | "negative-infinity";
    }
  | {
      witnessKind: "unsafe-integer";
      canonicalDecimal: string;
    }
  | {
      witnessKind: "cyclic-reference";
      firstSeenSourcePath: readonly string[];
    }
  | {
      witnessKind: "unsupported-structured-clone-kind";
      intrinsicTag: string;
    }
  | {
      witnessKind: "json-value";
      value: V2CanonicalJsonWitnessValueV1;
    };

type V2CoreRepresentabilityIssueV1 =
  | {
      kind: "legacy-v1-extension-unrepresentable";
      sourcePath: readonly string[];
      valueDigest: string;
    }
  | {
      kind: "orphan-map-section-slot";
      section:
        | "mapRotationSettings"
        | "routeSettings"
        | "hallDefinitions"
        | "hallRouteSettings"
        | "mapViewportSettings";
      dataEventKey: string;
      sourceMapSlotKey: string;
      payloadDigest: string;
    }
  | {
      kind: "legacy-unscoped-hall-owner-unrepresentable";
      section: "hallDefinitions" | "hallRouteSettings";
      dataEventKey: string;
      sourceSlotKey: string;
      payloadDigest: string;
    }
  | {
      kind: "unsafe-external-url-unrepresentable";
      sourcePath: readonly string[];
      rawValueDigest: string;
    }
  | {
      kind: "v2-strict-scalar-unrepresentable";
      violation:
        | "non-finite-number"
        | "unsafe-integer"
        | "string-byte-limit"
        | "invalid-scalar-shape";
      sourcePath: readonly string[];
      rawWitness: Readonly<V2RawRepresentabilityWitnessV1>;
      valueDigest: string;
    }
  | {
      kind: "v2-strict-structural-unrepresentable";
      violation:
        | "duplicate-physical-cell"
        | "duplicate-reference"
        | "cross-section-reference-invalid"
        | "order-bearing-shape-invalid"
        | "owner-relation-invalid"
        | "hall-group-token-noninjection";
      sourcePath: readonly string[];
      rawWitness: Readonly<V2RawRepresentabilityWitnessV1>;
      valueDigest: string;
    };

type CompanionV1ValidationFailureWitnessV1 =
  | {
      kind: "frozen-v1-self-validation-failed";
      failureCode:
        | "schema-invalid"
        | "reference-invalid"
        | "current-reader-projection-mismatch";
      candidateByteLength: number;
      candidateSha256: string;
      sourceProjectionDigest: string;
      currentReaderProjectionDigest: string | null;
      compatibilityMatrixDigest: string;
      backupLimitsConfigSha256: string;
    }
  | {
      kind: "fixed-legacy-a-parse-failed";
      failureCode: "fixed-a-parser-rejected" | "fixed-a-parser-timeout";
      candidateByteLength: number;
      candidateSha256: string;
      fixedLegacyAArchiveSha256: string;
      parserResultDigest: string;
      backupLimitsConfigSha256: string;
    }
  | {
      kind: "fixed-legacy-a-projection-mismatch";
      candidateByteLength: number;
      candidateSha256: string;
      sourceProjectionDigest: string;
      fixedLegacyAProjectionDigest: string;
      mismatchPathSetDigest: string;
      fixedLegacyAArchiveSha256: string;
      backupLimitsConfigSha256: string;
    }
  | {
      kind: "fixed-legacy-a-oversize-validation-unavailable";
      candidateByteLength: number;
      candidateSha256: string;
      temporarySpoolMaxRawBytes: number;
      sourceProjectionDigest: string;
      fixedLegacyAArchiveSha256: string;
      backupLimitsConfigSha256: string;
    };

type CompanionV1ValidationFailureIssueV1 = {
  [Kind in CompanionV1ValidationFailureWitnessV1["kind"]]: {
    kind: Kind;
    witness: Readonly<
      Extract<CompanionV1ValidationFailureWitnessV1, { kind: Kind }>
    >;
    witnessDigest: string;
  };
}[CompanionV1ValidationFailureWitnessV1["kind"]];

type CompanionV1RepresentabilityIssueV1 =
  | {
      kind: "hall-visit-group-token-unrepresentable";
      sourcePath: readonly string[];
      hallGroupKind:
        | "unassigned"
        | "unresolved"
        | "malformed"
        | "priority"
        | "highest";
      valueDigest: string;
    }
  | {
      kind: "hall-order-token-unrepresentable";
      sourcePath: readonly string[];
      hallTokenKind: "unresolved" | "malformed";
      valueDigest: string;
    }
  | {
      kind: "manual-hall-reference-unrepresentable";
      sourcePath: readonly string[];
      resolution: "resolved-without-v1-hall-definitions" | "dangling";
      sourceHallIdDigest: string;
    }
  | CompanionV1ValidationFailureIssueV1
  | {
      kind: "companion-v1-resource-limit";
      companionV1CandidateByteLength: number;
      companionV1CandidateSha256: string;
      finalV2ByteLength: number;
      pairCandidateByteLength: number;
      appliedLimits: {
        v2ExportMaxRawBytes: number;
        companionV1ExportMaxRawBytes: number;
        pairTotalExportMaxRawBytes: number;
        temporarySpoolMaxRawBytes: number;
        exportGenerationTimeoutMs: number;
        backupLimitsConfigSha256: string;
      };
      exceededLimits:
        | readonly ["companion-v1-max"]
        | readonly ["pair-total-max"]
        | readonly ["companion-v1-max", "pair-total-max"];
      limitWitnessDigest: string;
    };

const COMPANION_V1_ISSUE_KIND_ORDER_V1 = [
  "hall-visit-group-token-unrepresentable",
  "hall-order-token-unrepresentable",
  "manual-hall-reference-unrepresentable",
  "frozen-v1-self-validation-failed",
  "fixed-legacy-a-parse-failed",
  "fixed-legacy-a-projection-mismatch",
  "fixed-legacy-a-oversize-validation-unavailable",
  "companion-v1-resource-limit",
] as const satisfies readonly CompanionV1RepresentabilityIssueV1["kind"][];

declare const preparedArtifactHandleBrandV1: unique symbol;
type PreparedArtifactHandleV1 = string & {
  readonly [preparedArtifactHandleBrandV1]: true;
};

interface SplitCapableEventExportRootWitnessV1 {
  rootKey: readonly [storeName: string, key: string];
  observedRevisionRootDigest: string;
  checkpointDigest: string | null;
  payloadDigest: string;
}

type SplitCapableEventExportRootVectorV1 = readonly [
  Readonly<SplitCapableEventExportRootWitnessV1>,
  ...Readonly<SplitCapableEventExportRootWitnessV1>[],
];

interface SplitCapableEventExportSourceSliceDigestsV1 {
  core: string;
  eventMetadata: string;
  map: string;
  association: string;
  splitSettings: string;
  durableVisitState: string;
  eventSettings: string;
}

interface SplitCapableEventExportSnapshotV1<SourceSlices> {
  snapshotSchemaVersion: 1;
  sourceSha: string;
  sourceEventInstanceId: string;
  participantRoots: SplitCapableEventExportRootVectorV1;
  sourceRootVectorDigest: string;
  sourceSnapshotRevision: string;
  sourceSliceDigests: Readonly<SplitCapableEventExportSourceSliceDigestsV1>;
  bridgeJournalDigest: string;
  externalProjectionWitnessDigest: string;
  sourceSlices: Readonly<SourceSlices>;
  sourceSnapshotDigest: string;
}

interface BackupSourceSnapshotBindingV1 {
  sourceSha: string;
  sourceRootVectorDigest: string;
  sourceSnapshotRevision: string;
  sourceSnapshotDigest: string;
}

type PreparedBackupArtifactRoleV1 =
  | "backup-v2"
  | "companion-v1"
  | "standalone-v1";

interface PreparedBackupArtifactSelfValidationCommonV1 extends BackupSourceSnapshotBindingV1 {
  schemaVersion: 1;
  fileName: string;
  byteLength: number;
  sha256: string;
  schemaReceipt: {
    schemaSha256: string;
    validatedProjectionDigest: string;
    status: "passed";
  };
}

interface PreparedBackupParseReceiptV1<
  Parser extends
    | "backup-v2-current-reader"
    | "frozen-v1-current-reader"
    | "fixed-legacy-a-reader",
> {
  parser: Parser;
  parsedPayloadDigest: string;
  status: "passed";
}

interface PreparedBackupProjectionReceiptV1<
  ProjectionKind extends
    | "v2-self"
    | "source-preservation"
    | "current-v1-reader"
    | "fixed-legacy-a",
> {
  projectionKind: ProjectionKind;
  projectionDigest: string;
}

type PreparedBackupArtifactSelfValidationEvidenceV1 =
  | (PreparedBackupArtifactSelfValidationCommonV1 & {
      role: "backup-v2";
      parseReceipts: readonly [
        Readonly<PreparedBackupParseReceiptV1<"backup-v2-current-reader">>,
      ];
      projectionReceipts: readonly [
        Readonly<PreparedBackupProjectionReceiptV1<"v2-self">>,
      ];
    })
  | (PreparedBackupArtifactSelfValidationCommonV1 & {
      role: "companion-v1";
      parseReceipts: readonly [
        Readonly<PreparedBackupParseReceiptV1<"frozen-v1-current-reader">>,
        Readonly<PreparedBackupParseReceiptV1<"fixed-legacy-a-reader">>,
      ];
      projectionReceipts: readonly [
        Readonly<PreparedBackupProjectionReceiptV1<"source-preservation">>,
        Readonly<PreparedBackupProjectionReceiptV1<"current-v1-reader">>,
        Readonly<PreparedBackupProjectionReceiptV1<"fixed-legacy-a">>,
      ];
    })
  | (PreparedBackupArtifactSelfValidationCommonV1 & {
      role: "standalone-v1";
      parseReceipts: readonly [
        Readonly<PreparedBackupParseReceiptV1<"frozen-v1-current-reader">>,
        Readonly<PreparedBackupParseReceiptV1<"fixed-legacy-a-reader">>,
      ];
      projectionReceipts: readonly [
        Readonly<PreparedBackupProjectionReceiptV1<"source-preservation">>,
        Readonly<PreparedBackupProjectionReceiptV1<"current-v1-reader">>,
        Readonly<PreparedBackupProjectionReceiptV1<"fixed-legacy-a">>,
      ];
    });

interface PreparedBackupArtifactCommonV1<
  Role extends PreparedBackupArtifactRoleV1,
> {
  artifactId: string;
  handle: PreparedArtifactHandleV1;
  fileName: string;
  byteLength: number;
  sha256: string;
  selfValidationEvidence: Readonly<
    Extract<PreparedBackupArtifactSelfValidationEvidenceV1, { role: Role }>
  >;
  selfValidationDigest: string;
  sourceSha: string;
  sourceRootVectorDigest: string;
  sourceSnapshotRevision: string;
  sourceSnapshotDigest: string;
}

type PreparedBackupV2ArtifactV1 = PreparedBackupArtifactCommonV1<"backup-v2"> &
  (
    | {
        role: "backup-v2";
        preparationKind: "pair";
        companionUnavailableReason: null;
        pairDigest: string;
        companionIssuesDigest: null;
      }
    | {
        role: "backup-v2";
        preparationKind: "structural-v2-only";
        companionUnavailableReason: "not-losslessly-representable";
        pairDigest: null;
        companionIssuesDigest: string;
      }
    | {
        role: "backup-v2";
        preparationKind: "resource-v2-only";
        companionUnavailableReason: "companion-v1-resource-limit";
        pairDigest: null;
        companionIssuesDigest: string;
      }
  );

type PreparedBackupArtifactV1 =
  | PreparedBackupV2ArtifactV1
  | (PreparedBackupArtifactCommonV1<"companion-v1"> & {
      role: "companion-v1";
      pairDigest: string;
    })
  | (PreparedBackupArtifactCommonV1<"standalone-v1"> & {
      role: "standalone-v1";
      pairDigest: null;
      coverage: "legacy-core-only";
      excludedRoots: readonly [
        "map-cell-split-settings",
        "durable-visit-state",
      ];
      recoveryWarning: "split-settings-and-progress-are-not-restorable";
      compatibilityMatrixDigest: string;
      sourcePreservationProjectionDigest: string;
      currentReaderProjectionDigest: string;
      fixedLegacyAProjectionDigest: string;
    });

interface PreparedBackupArtifactByteReceiptV1<
  Role extends PreparedBackupArtifactRoleV1,
> extends BackupSourceSnapshotBindingV1 {
  artifactId: string;
  handle: PreparedArtifactHandleV1;
  role: Role;
  fileName: string;
  declaredByteLength: number;
  recomputedByteLength: number;
  declaredSha256: string;
  recomputedSha256: string;
  selfValidationDigest: string;
}

type PreparedBackupImmutableBytesWitnessV1 =
  | {
      preparationKind: "pair";
      companionUnavailableReason: null;
      artifacts: readonly [
        Readonly<PreparedBackupArtifactByteReceiptV1<"backup-v2">>,
        Readonly<PreparedBackupArtifactByteReceiptV1<"companion-v1">>,
      ];
      pairDigest: string;
      companionIssuesDigest: null;
      warningAcknowledgementDigest: null;
    }
  | {
      preparationKind: "structural-v2-only";
      companionUnavailableReason: "not-losslessly-representable";
      artifacts: readonly [
        Readonly<PreparedBackupArtifactByteReceiptV1<"backup-v2">>,
      ];
      pairDigest: null;
      companionIssuesDigest: string;
      warningAcknowledgementDigest: string;
    }
  | {
      preparationKind: "resource-v2-only";
      companionUnavailableReason: "companion-v1-resource-limit";
      artifacts: readonly [
        Readonly<PreparedBackupArtifactByteReceiptV1<"backup-v2">>,
      ];
      pairDigest: null;
      companionIssuesDigest: string;
      warningAcknowledgementDigest: string;
    }
  | {
      preparationKind: "standalone-v1";
      companionUnavailableReason: null;
      artifacts: readonly [
        Readonly<PreparedBackupArtifactByteReceiptV1<"standalone-v1">>,
      ];
      pairDigest: null;
      companionIssuesDigest: null;
      warningAcknowledgementDigest: string;
    };

type V2OnlyLegacyFallbackWarningAcknowledgementV1 =
  | {
      preparationKind: "structural-v2-only";
      companionUnavailableReason: "not-losslessly-representable";
      warningCode: "legacy-fallback-unavailable-store-v2";
      v2ArtifactId: string;
      v2ArtifactSha256: string;
      companionIssuesDigest: string;
      acknowledgementDigest: string;
    }
  | {
      preparationKind: "resource-v2-only";
      companionUnavailableReason: "companion-v1-resource-limit";
      warningCode: "legacy-fallback-unavailable-store-v2";
      v2ArtifactId: string;
      v2ArtifactSha256: string;
      companionIssuesDigest: string;
      acknowledgementDigest: string;
    };

type PreparedBackupSetVerificationV1 = Readonly<BackupSourceSnapshotBindingV1> &
  (
    | {
        kind: "pair-verified";
        preparationKind: "pair";
        companionUnavailableReason: null;
        pairDigest: string;
        v2Artifact: Readonly<
          Extract<PreparedBackupV2ArtifactV1, { preparationKind: "pair" }>
        >;
        companionV1Artifact: Readonly<
          Extract<PreparedBackupArtifactV1, { role: "companion-v1" }>
        >;
        immutableBytesWitness: Readonly<
          Extract<
            PreparedBackupImmutableBytesWitnessV1,
            { preparationKind: "pair" }
          >
        >;
        immutableBytesWitnessDigest: string;
        sourceSha: string;
        sourceRootVectorDigest: string;
        sourceSnapshotRevision: string;
        sourceSnapshotDigest: string;
      }
    | {
        kind: "structural-v2-only-verified";
        preparationKind: "structural-v2-only";
        companionUnavailableReason: "not-losslessly-representable";
        pairDigest: null;
        v2Artifact: Readonly<
          Extract<
            PreparedBackupV2ArtifactV1,
            { preparationKind: "structural-v2-only" }
          >
        >;
        companionIssuesDigest: string;
        warningAcknowledgement: Readonly<
          Extract<
            V2OnlyLegacyFallbackWarningAcknowledgementV1,
            { preparationKind: "structural-v2-only" }
          >
        >;
        immutableBytesWitness: Readonly<
          Extract<
            PreparedBackupImmutableBytesWitnessV1,
            { preparationKind: "structural-v2-only" }
          >
        >;
        immutableBytesWitnessDigest: string;
        sourceSha: string;
        sourceRootVectorDigest: string;
        sourceSnapshotRevision: string;
        sourceSnapshotDigest: string;
      }
    | {
        kind: "resource-v2-only-verified";
        preparationKind: "resource-v2-only";
        companionUnavailableReason: "companion-v1-resource-limit";
        pairDigest: null;
        v2Artifact: Readonly<
          Extract<
            PreparedBackupV2ArtifactV1,
            { preparationKind: "resource-v2-only" }
          >
        >;
        companionIssuesDigest: string;
        warningAcknowledgement: Readonly<
          Extract<
            V2OnlyLegacyFallbackWarningAcknowledgementV1,
            { preparationKind: "resource-v2-only" }
          >
        >;
        immutableBytesWitness: Readonly<
          Extract<
            PreparedBackupImmutableBytesWitnessV1,
            { preparationKind: "resource-v2-only" }
          >
        >;
        immutableBytesWitnessDigest: string;
        sourceSha: string;
        sourceRootVectorDigest: string;
        sourceSnapshotRevision: string;
        sourceSnapshotDigest: string;
      }
    | {
        kind: "standalone-v1-verified";
        preparationKind: "standalone-v1";
        companionUnavailableReason: null;
        pairDigest: null;
        standaloneV1Artifact: Readonly<
          Extract<PreparedBackupArtifactV1, { role: "standalone-v1" }>
        >;
        coverage: "legacy-core-only";
        excludedRoots: readonly [
          "map-cell-split-settings",
          "durable-visit-state",
        ];
        recoveryWarning: "split-settings-and-progress-are-not-restorable";
        warningAcknowledged: true;
        standaloneWarningAcknowledgementDigest: string;
        immutableBytesWitness: Readonly<
          Extract<
            PreparedBackupImmutableBytesWitnessV1,
            { preparationKind: "standalone-v1" }
          >
        >;
        immutableBytesWitnessDigest: string;
        sourceSha: string;
        sourceRootVectorDigest: string;
        sourceSnapshotRevision: string;
        sourceSnapshotDigest: string;
      }
    | {
        kind: "rejected";
        reason:
          | "unknown-or-inactive-handle"
          | "handle-role-mismatch"
          | "pair-digest-mismatch"
          | "artifact-metadata-mismatch"
          | "artifact-bytes-mismatch"
          | "handle-already-finalized"
          | "v2-only-warning-not-acknowledged"
          | "standalone-warning-not-acknowledged";
        handoffAttempts: 0;
      }
  );

interface PreparedBackupArtifactPortV1 {
  verifyPreparedExportForHandoff(
    input: Readonly<BackupSourceSnapshotBindingV1> &
      (
        | {
            preparationKind: "pair";
            companionUnavailableReason: null;
            pairDigest: string;
            v2Handle: PreparedArtifactHandleV1;
            companionV1Handle: PreparedArtifactHandleV1;
          }
        | {
            preparationKind: "structural-v2-only";
            companionUnavailableReason: "not-losslessly-representable";
            pairDigest: null;
            v2Handle: PreparedArtifactHandleV1;
            companionIssuesDigest: string;
            warningAcknowledgement: Readonly<
              Extract<
                V2OnlyLegacyFallbackWarningAcknowledgementV1,
                { preparationKind: "structural-v2-only" }
              >
            >;
          }
        | {
            preparationKind: "resource-v2-only";
            companionUnavailableReason: "companion-v1-resource-limit";
            pairDigest: null;
            v2Handle: PreparedArtifactHandleV1;
            companionIssuesDigest: string;
            warningAcknowledgement: Readonly<
              Extract<
                V2OnlyLegacyFallbackWarningAcknowledgementV1,
                { preparationKind: "resource-v2-only" }
              >
            >;
          }
        | {
            preparationKind: "standalone-v1";
            companionUnavailableReason: null;
            pairDigest: null;
            standaloneV1Handle: PreparedArtifactHandleV1;
            coverage: "legacy-core-only";
            excludedRoots: readonly [
              "map-cell-split-settings",
              "durable-visit-state",
            ];
            recoveryWarning: "split-settings-and-progress-are-not-restorable";
            warningAcknowledged: true;
            standaloneWarningAcknowledgementDigest: string;
          }
      ),
  ): Promise<PreparedBackupSetVerificationV1>;
  handoffVerifiedExport(
    input: Exclude<PreparedBackupSetVerificationV1, { kind: "rejected" }>,
  ): Promise<BackupHandoffResultV1>;
  disposePreparedExport(
    input:
      | {
          preparationKind: "pair";
          companionUnavailableReason: null;
          pairDigest: string;
          handles: readonly [
            PreparedArtifactHandleV1,
            PreparedArtifactHandleV1,
          ];
        }
      | {
          preparationKind: "structural-v2-only";
          companionUnavailableReason: "not-losslessly-representable";
          pairDigest: null;
          handles: readonly [PreparedArtifactHandleV1];
        }
      | {
          preparationKind: "resource-v2-only";
          companionUnavailableReason: "companion-v1-resource-limit";
          pairDigest: null;
          handles: readonly [PreparedArtifactHandleV1];
        }
      | {
          preparationKind: "standalone-v1";
          companionUnavailableReason: null;
          pairDigest: null;
          handles: readonly [PreparedArtifactHandleV1];
        },
  ): Promise<void>;
}

type StandaloneV1FallbackFailureWitnessV1 =
  | {
      kind: "v1-self-validation-failed";
      failureCode:
        | "schema-invalid"
        | "reference-invalid"
        | "current-reader-projection-mismatch";
      candidateByteLength: number;
      candidateSha256: string;
      sourceProjectionDigest: string;
      currentReaderProjectionDigest: string | null;
      compatibilityMatrixDigest: string;
      backupLimitsConfigSha256: string;
    }
  | {
      kind: "fixed-legacy-a-parse-failed";
      failureCode: "fixed-a-parser-rejected" | "fixed-a-parser-timeout";
      candidateByteLength: number;
      candidateSha256: string;
      fixedLegacyAArchiveSha256: string;
      parserResultDigest: string;
      backupLimitsConfigSha256: string;
    }
  | {
      kind: "source-v1-projection-mismatch";
      candidateByteLength: number;
      candidateSha256: string;
      sourceProjectionDigest: string;
      currentReaderProjectionDigest: string;
      fixedLegacyAProjectionDigest: string;
      mismatchPathSetDigest: string;
      compatibilityMatrixDigest: string;
      fixedLegacyAArchiveSha256: string;
      backupLimitsConfigSha256: string;
    }
  | {
      kind: "v1-resource-limit";
      candidateByteLength: number;
      candidateSha256: string;
      companionV1ExportMaxRawBytes: number;
      temporarySpoolMaxRawBytes: number;
      backupLimitsConfigSha256: string;
    };

type StandaloneV1FallbackFailureBlockerV1 = {
  [Kind in StandaloneV1FallbackFailureWitnessV1["kind"]]: {
    kind: Kind;
    witness: Readonly<
      Extract<StandaloneV1FallbackFailureWitnessV1, { kind: Kind }>
    >;
    witnessDigest: string;
  };
}[StandaloneV1FallbackFailureWitnessV1["kind"]];

type StandaloneV1FallbackBlockerV1 =
  | {
      kind: "issue-kind-not-v1-losslessly-representable";
      issueKind: V2CoreRepresentabilityIssueV1["kind"];
      section: string | null;
    }
  | StandaloneV1FallbackFailureBlockerV1;

type StandaloneV1FallbackResultV1 =
  | {
      kind: "prepared";
      artifact: Readonly<
        Extract<PreparedBackupArtifactV1, { role: "standalone-v1" }>
      >;
      coverage: "legacy-core-only";
      excludedRoots: readonly [
        "map-cell-split-settings",
        "durable-visit-state",
      ];
      recoveryWarning: "split-settings-and-progress-are-not-restorable";
      compatibilityMatrixDigest: string;
      sourcePreservationProjectionDigest: string;
      currentReaderProjectionDigest: string;
      fixedLegacyAProjectionDigest: string;
    }
  | {
      kind: "unavailable";
      blockers: readonly [
        StandaloneV1FallbackBlockerV1,
        ...StandaloneV1FallbackBlockerV1[],
      ];
    };

interface V2ExportFailureLimitAuthorityV1 {
  v2ExportMaxRawBytes: number;
  temporarySpoolMaxRawBytes: number;
  exportGenerationTimeoutMs: number;
  backupLimitsConfigSha256: string;
}

type V2FixedPointNonemptyExceededLimitsV1 =
  | readonly ["companion-v1-max"]
  | readonly ["pair-total-max"]
  | readonly ["companion-v1-max", "pair-total-max"];

type V2FixedPointPassExceededLimitsV1 =
  | readonly []
  | V2FixedPointNonemptyExceededLimitsV1;

type V2FixedPointDigestSlotV1 =
  | {
      kind: "zero-placeholder";
      value: "0000000000000000000000000000000000000000000000000000000000000000";
    }
  | { kind: "substituted"; value: string };

interface V2FixedPointStateV1<
  ExceededLimits extends V2FixedPointPassExceededLimitsV1 =
    V2FixedPointPassExceededLimitsV1,
  DigestSlot extends V2FixedPointDigestSlotV1 = V2FixedPointDigestSlotV1,
> {
  companionV1CandidateByteLength: number;
  companionV1CandidateSha256: string;
  finalV2ByteLength: number;
  pairCandidateByteLength: number;
  appliedLimits: {
    v2ExportMaxRawBytes: number;
    companionV1ExportMaxRawBytes: number;
    pairTotalExportMaxRawBytes: number;
    temporarySpoolMaxRawBytes: number;
    exportGenerationTimeoutMs: number;
    backupLimitsConfigSha256: string;
  };
  exceededLimits: ExceededLimits;
  limitWitnessDigestSlot: DigestSlot;
}

type V2FixedPointConvergedResourceStateV1 = V2FixedPointStateV1<
  V2FixedPointNonemptyExceededLimitsV1,
  Extract<V2FixedPointDigestSlotV1, { kind: "substituted" }>
>;

type V2FixedPointConvergenceResultV1 =
  | {
      kind: "converged-without-resource-issue";
      state: Readonly<
        V2FixedPointStateV1<
          readonly [],
          Extract<V2FixedPointDigestSlotV1, { kind: "zero-placeholder" }>
        >
      >;
      resourceIssue: null;
    }
  | {
      kind: "converged-resource-issue";
      state: Readonly<V2FixedPointConvergedResourceStateV1>;
      resourceIssue: Readonly<
        Extract<
          CompanionV1RepresentabilityIssueV1,
          { kind: "companion-v1-resource-limit" }
        >
      >;
    };

type V2FixedPointPassOrdinalV1 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface V2FixedPointPassObservationV1<
  PassOrdinal extends V2FixedPointPassOrdinalV1,
  ExceededLimits extends V2FixedPointPassExceededLimitsV1 =
    V2FixedPointPassExceededLimitsV1,
  DigestSlot extends V2FixedPointDigestSlotV1 = V2FixedPointDigestSlotV1,
> {
  passOrdinal: PassOrdinal;
  state: Readonly<V2FixedPointStateV1<ExceededLimits, DigestSlot>>;
  byteLength: number;
  canonicalSha256: string;
  convergenceStateDigest: string;
  observationDigest: string;
}

type V2FixedPointResourceLoopPassObservationV1<
  PassOrdinal extends V2FixedPointPassOrdinalV1,
> = V2FixedPointPassObservationV1<
  PassOrdinal,
  V2FixedPointNonemptyExceededLimitsV1,
  Extract<V2FixedPointDigestSlotV1, { kind: "zero-placeholder" }>
>;

type V2DigestSubstitutionDriftAtPassV1<
  PassOrdinal extends V2FixedPointPassOrdinalV1,
  ExceededLimits extends V2FixedPointNonemptyExceededLimitsV1,
> = {
  completedPassCount: PassOrdinal;
  placeholderPass: Readonly<
    V2FixedPointPassObservationV1<
      PassOrdinal,
      ExceededLimits,
      Extract<V2FixedPointDigestSlotV1, { kind: "zero-placeholder" }>
    >
  >;
  substitutedDigestPass: Readonly<
    V2FixedPointPassObservationV1<
      PassOrdinal,
      ExceededLimits,
      Extract<V2FixedPointDigestSlotV1, { kind: "substituted" }>
    >
  >;
};

type V2DigestSubstitutionDriftWitnessV1 = {
  [PassOrdinal in V2FixedPointPassOrdinalV1]:
    | V2DigestSubstitutionDriftAtPassV1<
        PassOrdinal,
        readonly ["companion-v1-max"]
      >
    | V2DigestSubstitutionDriftAtPassV1<
        PassOrdinal,
        readonly ["pair-total-max"]
      >
    | V2DigestSubstitutionDriftAtPassV1<
        PassOrdinal,
        readonly ["companion-v1-max", "pair-total-max"]
      >;
}[V2FixedPointPassOrdinalV1];

type PreparedArtifactByteSinkStageV1 =
  | "companion-v1-generation"
  | "companion-v1-validation"
  | "companion-v1-retention"
  | "v2-fixed-point"
  | "v2-finalization"
  | "v2-final-retention";

interface PreparedArtifactByteSinkReceiptCommonV1 extends BackupSourceSnapshotBindingV1 {
  schemaVersion: 1;
  streamByteLength: number;
  streamSha256: string;
  attemptedRetainedRawBytes: number;
  retainedRawBytes: number;
  chunkMaxRawBytes: number;
  observedChunkCount: number;
  temporarySpoolMaxRawBytes: number;
  exportGenerationTimeoutMs: number;
  elapsedMs: number;
  backupLimitsConfigSha256: string;
  receiptDigest: string;
}

type PreparedArtifactByteSinkReceiptV1 = Readonly<
  PreparedArtifactByteSinkReceiptCommonV1 &
    (
      | {
          stage: PreparedArtifactByteSinkStageV1;
          outcome: "completed";
          terminalCode: "completed";
        }
      | {
          stage: PreparedArtifactByteSinkStageV1;
          outcome: "timeout";
          terminalCode: "export-generation-timeout";
        }
      | {
          stage: "companion-v1-retention" | "v2-final-retention";
          outcome: "temporary-spool-limit-exceeded";
          terminalCode: "temporary-spool-limit-exceeded";
        }
      | {
          stage: PreparedArtifactByteSinkStageV1;
          outcome: "cancelled";
          terminalCode: "export-cancelled";
          cancellationReason:
            | "user-request"
            | "worker-shutdown"
            | "superseded-export";
        }
      | {
          stage: PreparedArtifactByteSinkStageV1;
          outcome: "sink-error";
          terminalCode: "artifact-byte-sink-error";
          sinkErrorCode:
            | "stream-read-failed"
            | "hash-update-failed"
            | "temporary-spool-write-failed"
            | "temporary-spool-readback-failed"
            | "temporary-spool-finalize-failed";
        }
    )
>;

type V2ExportFailureWitnessV1 =
  | {
      reason: "resource-fixed-point-did-not-converge";
      appliedLimits: Readonly<V2ExportFailureLimitAuthorityV1>;
      fixedPointMaxPasses: 8;
      completedPassCount: 8;
      passes: readonly [
        Readonly<V2FixedPointResourceLoopPassObservationV1<1>>,
        Readonly<V2FixedPointResourceLoopPassObservationV1<2>>,
        Readonly<V2FixedPointResourceLoopPassObservationV1<3>>,
        Readonly<V2FixedPointResourceLoopPassObservationV1<4>>,
        Readonly<V2FixedPointResourceLoopPassObservationV1<5>>,
        Readonly<V2FixedPointResourceLoopPassObservationV1<6>>,
        Readonly<V2FixedPointResourceLoopPassObservationV1<7>>,
        Readonly<V2FixedPointResourceLoopPassObservationV1<8>>,
      ];
    }
  | ({
      reason: "resource-digest-substitution-drift";
      appliedLimits: Readonly<V2ExportFailureLimitAuthorityV1>;
    } & V2DigestSubstitutionDriftWitnessV1)
  | {
      reason: "v2-export-max-raw-bytes-exceeded";
      appliedLimits: Readonly<V2ExportFailureLimitAuthorityV1>;
      finalV2ByteLength: number;
      finalV2Sha256: string;
    }
  | {
      reason: "export-generation-timeout";
      appliedLimits: Readonly<V2ExportFailureLimitAuthorityV1>;
      elapsedMs: number;
      stage: PreparedArtifactByteSinkStageV1;
      sinkReceipt: Readonly<
        Extract<PreparedArtifactByteSinkReceiptV1, { outcome: "timeout" }>
      >;
    }
  | {
      reason: "temporary-spool-limit-exceeded";
      appliedLimits: Readonly<V2ExportFailureLimitAuthorityV1>;
      attemptedRetainedRawBytes: number;
      stage: "companion-v1-retention" | "v2-final-retention";
      sinkReceipt: Readonly<
        Extract<
          PreparedArtifactByteSinkReceiptV1,
          { outcome: "temporary-spool-limit-exceeded" }
        >
      >;
    }
  | {
      reason: "export-cancelled";
      appliedLimits: Readonly<V2ExportFailureLimitAuthorityV1>;
      stage: PreparedArtifactByteSinkStageV1;
      cancellationReason:
        | "user-request"
        | "worker-shutdown"
        | "superseded-export";
      sinkReceipt: Readonly<
        Extract<PreparedArtifactByteSinkReceiptV1, { outcome: "cancelled" }>
      >;
    }
  | {
      reason: "artifact-byte-sink-error";
      appliedLimits: Readonly<V2ExportFailureLimitAuthorityV1>;
      stage: PreparedArtifactByteSinkStageV1;
      sinkErrorCode:
        | "stream-read-failed"
        | "hash-update-failed"
        | "temporary-spool-write-failed"
        | "temporary-spool-readback-failed"
        | "temporary-spool-finalize-failed";
      sinkReceipt: Readonly<
        Extract<PreparedArtifactByteSinkReceiptV1, { outcome: "sink-error" }>
      >;
    };

type V2ExportFailedResultV1 = {
  [Reason in V2ExportFailureWitnessV1["reason"]]: {
    kind: "v2-export-failed";
    reason: Reason;
    failureWitness: Readonly<
      Extract<V2ExportFailureWitnessV1, { reason: Reason }>
    >;
    failureWitnessDigest: string;
    backupV2: null;
    standaloneV1Fallback: null;
    preparedArtifacts: readonly [];
    databaseWrites: 0;
    handoffAttempts: 0;
    temporarySpoolRetainedRawBytesAfterCleanup: 0;
  };
}[V2ExportFailureWitnessV1["reason"]];

type InitialReleaseAppBackupV2ExportResultV1 =
  Readonly<BackupSourceSnapshotBindingV1> &
    (
      | {
          kind: "pair-prepared";
          preparationKind: "pair";
          companionUnavailableReason: null;
          backupV2: InitialReleaseAppBackupV2WriterOutput & {
            scope: {
              companionCore: Extract<
                EventBackupScopeV2Base["companionCore"],
                { status: "included" }
              >;
            };
          };
          v2Artifact: Readonly<
            Extract<PreparedBackupV2ArtifactV1, { preparationKind: "pair" }>
          >;
          companionV1Artifact: Readonly<
            Extract<PreparedBackupArtifactV1, { role: "companion-v1" }>
          >;
          pairDigest: string;
        }
      | {
          kind: "structural-v2-only-prepared";
          preparationKind: "structural-v2-only";
          companionUnavailableReason: "not-losslessly-representable";
          backupV2: InitialReleaseAppBackupV2WriterOutput & {
            scope: {
              companionCore: Extract<
                EventBackupScopeV2Base["companionCore"],
                { reason: "not-losslessly-representable" }
              >;
            };
          };
          v2Artifact: Readonly<
            Extract<
              PreparedBackupV2ArtifactV1,
              { preparationKind: "structural-v2-only" }
            >
          >;
          companionIssues: readonly [
            Exclude<
              CompanionV1RepresentabilityIssueV1,
              { kind: "companion-v1-resource-limit" }
            >,
            ...Exclude<
              CompanionV1RepresentabilityIssueV1,
              { kind: "companion-v1-resource-limit" }
            >[],
          ];
          companionIssuesDigest: string;
          pairDigest: null;
          requiresLegacyFallbackWarningAcknowledgement: true;
        }
      | {
          kind: "resource-v2-only-prepared";
          preparationKind: "resource-v2-only";
          companionUnavailableReason: "companion-v1-resource-limit";
          backupV2: InitialReleaseAppBackupV2WriterOutput & {
            scope: {
              companionCore: Extract<
                EventBackupScopeV2Base["companionCore"],
                { reason: "companion-v1-resource-limit" }
              >;
            };
          };
          v2Artifact: Readonly<
            Extract<
              PreparedBackupV2ArtifactV1,
              { preparationKind: "resource-v2-only" }
            >
          >;
          companionIssues: readonly [
            Extract<
              CompanionV1RepresentabilityIssueV1,
              { kind: "companion-v1-resource-limit" }
            >,
          ];
          companionIssuesDigest: string;
          pairDigest: null;
          requiresLegacyFallbackWarningAcknowledgement: true;
        }
      | {
          kind: "v2-unrepresentable";
          issues: readonly [
            V2CoreRepresentabilityIssueV1,
            ...V2CoreRepresentabilityIssueV1[],
          ];
          backupV2: null;
          standaloneV1Fallback: StandaloneV1FallbackResultV1;
          databaseWrites: 0;
        }
      | V2ExportFailedResultV1
    );

interface ItemOnlyHallMappingCandidateV1 {
  targetHallId: string;
  targetOwnerDigest: string;
  targetDescriptorDigest: string;
}

interface BackupRestoreExpectedRootCasRowV1 {
  rootKey: readonly [storeName: string, key: string];
  observedRevisionRootDigest: string;
  checkpointDigest: string | null;
  recoveryCandidatesDigest: string;
}

type BackupRestoreExpectedRootVectorV1 = readonly [
  BackupRestoreExpectedRootCasRowV1,
  ...BackupRestoreExpectedRootCasRowV1[],
];

interface ItemOnlyHallMappingRequestRowV1 {
  hallRef: string;
  sourceDescriptor: Readonly<PortableHallReferenceManifestRowV2>;
  candidates: readonly [
    ItemOnlyHallMappingCandidateV1,
    ...ItemOnlyHallMappingCandidateV1[],
  ];
}

interface ItemOnlyHallMappingChoiceRequestV1 {
  sourceBackupV2Digest: string;
  sourceBackupArtifactSha256: string;
  destinationEventInstanceId: string;
  expectedDestinationRoots: BackupRestoreExpectedRootVectorV1;
  destinationHallSnapshotDigest: string;
  requests: readonly [
    ItemOnlyHallMappingRequestRowV1,
    ...ItemOnlyHallMappingRequestRowV1[],
  ];
  requestSetDigest: string;
}

interface ItemOnlyHallMappingChoiceV1 {
  sourceBackupV2Digest: string;
  sourceBackupArtifactSha256: string;
  requestSetDigest: string;
  mappings: readonly [
    readonly [hallRef: string, targetHallId: string],
    ...(readonly [hallRef: string, targetHallId: string])[],
  ];
}

interface BackupV2AtomicRestorePlanV1 {
  contentKind: "full-split" | "core-map" | "item-only";
  destinationKind: "new-event" | "existing-event";
  sourceBackupV2Digest: string;
  sourceBackupArtifactSha256: string;
  expectedDestinationRoots: BackupRestoreExpectedRootVectorV1;
  itemIdRemapDigest: string;
  hallMappingBasis: "not-applicable" | "automatic" | "user-selected";
  resolvedHallIdRemaps: readonly (readonly [
    hallRef: string,
    targetHallId: string,
  ])[];
  danglingHallBaseRemapDigest: string;
  afterImageDigest: string;
  logicalParticipantRoots: readonly (readonly [
    storeName: string,
    key: string,
  ])[];
  planDigest: string;
}

type BackupV2RestorePlanResultV1 =
  | {
      kind: "planned";
      plan: Readonly<BackupV2AtomicRestorePlanV1>;
    }
  | {
      kind: "item-only-hall-mapping-required";
      request: Readonly<ItemOnlyHallMappingChoiceRequestV1>;
      databaseWrites: 0;
    }
  | {
      kind: "rejected";
      reason:
        | "item-only-hall-target-unavailable"
        | "item-only-new-destination-hall-unavailable"
        | "item-only-hall-choice-set-mismatch"
        | "item-only-hall-choice-not-a-candidate"
        | "item-only-hall-choice-noninjective"
        | "item-only-hall-injective-matching-unavailable"
        | "destination-roots-stale"
        | "restore-after-image-invalid";
      databaseWrites: 0;
    };

type BackupArtifactHandoffBindingV1 =
  | {
      [Role in "backup-v2" | "companion-v1"]: {
        preparationKind: "pair";
        role: Role;
        pairDigest: string;
        companionIssuesDigest: null;
        warningAcknowledgementDigest: null;
      };
    }["backup-v2" | "companion-v1"]
  | {
      preparationKind: "structural-v2-only";
      role: "backup-v2";
      pairDigest: null;
      companionIssuesDigest: string;
      warningAcknowledgementDigest: string;
    }
  | {
      preparationKind: "resource-v2-only";
      role: "backup-v2";
      pairDigest: null;
      companionIssuesDigest: string;
      warningAcknowledgementDigest: string;
    }
  | {
      preparationKind: "standalone-v1";
      role: "standalone-v1";
      pairDigest: null;
      companionIssuesDigest: null;
      warningAcknowledgementDigest: string;
    };

type BackupPreparationKindV1 =
  BackupArtifactHandoffBindingV1["preparationKind"];

type BackupArtifactDownstreamReceiptV1<
  PreparationKind extends BackupPreparationKindV1,
  Role extends PreparedBackupArtifactRoleV1,
> = Readonly<
  BackupSourceSnapshotBindingV1 &
    Extract<
      BackupArtifactHandoffBindingV1,
      { preparationKind: PreparationKind; role: Role }
    > & {
      schemaVersion: 1;
      handoffAttemptId: string;
      artifactId: string;
      artifactSha256: string;
      artifactByteLength: number;
      handoffChannel:
        | "browser-download"
        | "file-system-access"
        | "native-share";
      downstreamReceiptId: string;
      acceptedByteLength: number;
      acceptedSha256: string;
      completedAtEpochMs: number;
      downstreamReceiptDigest: string;
    }
>;

type BackupArtifactHandoffReceiptV1<
  PreparationKind extends BackupPreparationKindV1,
  Role extends PreparedBackupArtifactRoleV1,
> = Readonly<
  BackupSourceSnapshotBindingV1 &
    Extract<
      BackupArtifactHandoffBindingV1,
      { preparationKind: PreparationKind; role: Role }
    > & {
      schemaVersion: 1;
      artifactId: string;
      artifactSha256: string;
      artifactByteLength: number;
      downstreamReceipt: Readonly<
        BackupArtifactDownstreamReceiptV1<PreparationKind, Role>
      >;
      receiptDigest: string;
    }
>;

type BackupHandoffResultV1 = Readonly<BackupSourceSnapshotBindingV1> &
  (
    | {
        kind: "pair-completed";
        preparationKind: "pair";
        companionUnavailableReason: null;
        pairDigest: string;
        expectedArtifactIds: readonly [string, string];
        handedOffArtifactIds: readonly [string, string];
        failedArtifactIds: readonly [];
        handoffReceipts: readonly [
          Readonly<BackupArtifactHandoffReceiptV1<"pair", "backup-v2">>,
          Readonly<BackupArtifactHandoffReceiptV1<"pair", "companion-v1">>,
        ];
      }
    | {
        kind: "structural-v2-only-completed";
        preparationKind: "structural-v2-only";
        companionUnavailableReason: "not-losslessly-representable";
        pairDigest: null;
        expectedArtifactIds: readonly [string];
        handedOffArtifactIds: readonly [string];
        failedArtifactIds: readonly [];
        companionIssuesDigest: string;
        handoffReceipts: readonly [
          Readonly<
            BackupArtifactHandoffReceiptV1<"structural-v2-only", "backup-v2">
          >,
        ];
        legacyFallbackAvailable: false;
        warningAcknowledged: true;
        warningAcknowledgementDigest: string;
      }
    | {
        kind: "resource-v2-only-completed";
        preparationKind: "resource-v2-only";
        companionUnavailableReason: "companion-v1-resource-limit";
        pairDigest: null;
        expectedArtifactIds: readonly [string];
        handedOffArtifactIds: readonly [string];
        failedArtifactIds: readonly [];
        companionIssuesDigest: string;
        handoffReceipts: readonly [
          Readonly<
            BackupArtifactHandoffReceiptV1<"resource-v2-only", "backup-v2">
          >,
        ];
        legacyFallbackAvailable: false;
        warningAcknowledged: true;
        warningAcknowledgementDigest: string;
      }
    | ({
        kind: "pair-incomplete";
        preparationKind: "pair";
        companionUnavailableReason: null;
        pairDigest: string;
        expectedArtifactIds: readonly [string, string];
        completionAcknowledged: false;
        recoveryGuidance: "regenerate-same-pair";
      } & (
        | {
            handedOffArtifactIds: readonly [];
            failedArtifactIds: readonly [string, string];
            handoffReceipts: readonly [];
          }
        | {
            handedOffArtifactIds: readonly [string];
            failedArtifactIds: readonly [string];
            handoffReceipts: readonly [
              Readonly<
                | BackupArtifactHandoffReceiptV1<"pair", "backup-v2">
                | BackupArtifactHandoffReceiptV1<"pair", "companion-v1">
              >,
            ];
          }
      ))
    | {
        kind: "structural-v2-only-incomplete";
        preparationKind: "structural-v2-only";
        companionUnavailableReason: "not-losslessly-representable";
        pairDigest: null;
        expectedArtifactIds: readonly [string];
        companionIssuesDigest: string;
        handedOffArtifactIds: readonly [];
        failedArtifactIds: readonly [string];
        warningAcknowledged: true;
        warningAcknowledgementDigest: string;
        handoffReceipts: readonly [];
        completionAcknowledged: false;
        recoveryGuidance: "retry-v2-handoff";
      }
    | {
        kind: "resource-v2-only-incomplete";
        preparationKind: "resource-v2-only";
        companionUnavailableReason: "companion-v1-resource-limit";
        pairDigest: null;
        expectedArtifactIds: readonly [string];
        companionIssuesDigest: string;
        handedOffArtifactIds: readonly [];
        failedArtifactIds: readonly [string];
        warningAcknowledged: true;
        warningAcknowledgementDigest: string;
        handoffReceipts: readonly [];
        completionAcknowledged: false;
        recoveryGuidance: "retry-v2-handoff";
      }
    | {
        kind: "standalone-v1-completed";
        preparationKind: "standalone-v1";
        companionUnavailableReason: null;
        pairDigest: null;
        expectedArtifactIds: readonly [string];
        handedOffArtifactIds: readonly [string];
        failedArtifactIds: readonly [];
        coverage: "legacy-core-only";
        excludedRoots: readonly [
          "map-cell-split-settings",
          "durable-visit-state",
        ];
        recoveryWarning: "split-settings-and-progress-are-not-restorable";
        warningAcknowledged: true;
        standaloneWarningAcknowledgementDigest: string;
        handoffReceipts: readonly [
          Readonly<
            BackupArtifactHandoffReceiptV1<"standalone-v1", "standalone-v1">
          >,
        ];
      }
    | {
        kind: "standalone-v1-incomplete";
        preparationKind: "standalone-v1";
        companionUnavailableReason: null;
        pairDigest: null;
        expectedArtifactIds: readonly [string];
        handedOffArtifactIds: readonly [];
        failedArtifactIds: readonly [string];
        coverage: "legacy-core-only";
        excludedRoots: readonly [
          "map-cell-split-settings",
          "durable-visit-state",
        ];
        recoveryWarning: "split-settings-and-progress-are-not-restorable";
        warningAcknowledged: true;
        standaloneWarningAcknowledgementDigest: string;
        handoffReceipts: readonly [];
        completionAcknowledged: false;
        recoveryGuidance: "retry-standalone-v1-handoff";
      }
  );
```

初版readerの`scope`は上記3分岐だけを許すexact unionとし、`includesMapData=false, includesSplitSettings=true`や未知`contentKind`はDB更新前に全体拒否する。`expectedSections`は上記の現行V1／wire DTO inventoryから導いた「非`null` sectionだけ」のexact tupleであり、重複、順序違い、宣言した非`null` sectionの欠落、宣言外の非`null` sectionを拒否する。`full-split`／`core-map`の`data`は`AppBackupV2FullEventCoreWireV1`の全10 top-level keyを必須保持する。`eventLists.entries`と`eventMetadata.entries`は対象eventのexact 1 rowを必須にし、metadataの利用者fieldが全て空でもrowを省略しない。metadata wireはlocal-only anchorを持たず、restore plannerがnew destinationへfresh anchorを作り、existing destinationのanchorを維持する。残る8 sectionの`entries`だけが、sourceにevent rowがない`[]`と、rowはあるがdays／maps／owners等が空の`[present-empty-row]`を区別するexact unionであり、absentをempty rowへ、empty rowをabsentへ畳み込まない。full／core restore plannerは各8 sectionについてwireからdesired after-image actionを`entries=[]`ならdestination当該event rowのabsence、`entries=[row]`ならempty rowを含むexact rowのpresenceとして区別する。beforeとdesired after-imageが異なる場合だけdelete／putとlogical participantを同一transaction planへ出し、既に同じabsence／同じrowならphysical write 0件にするが、absentとpresent-emptyを同じafter-imageへ変換しない。present rowだけが実行順、day mode、route／hall／viewportを保持し、`eventSettings`はsole eventRefのexact 1 row、`durableVisitState`はsole eventRefに属する全semantic day entryを持つ。初版production writerのwire戻り型は`InitialReleaseAppBackupV2WriterOutput`だけで、healthyな`map-cell-split-v1` snapshotかつ`DurableVisitInitializationStateV1 = ready`から`full-split`、明示item-only commandから`item-only`だけを生成する。

export commandはV2 objectだけを成功値にせず、`InitialReleaseAppBackupV2ExportResultV1`の3成功分岐だけをV2 handoffへ渡す。`pair-prepared`は自己検証済みV2、exact companion V1、`preparationKind = "pair"`、non-null pair digest、included metadataのbyte一致を必須にする。`structural-v2-only-prepared`はresource以外のnonempty issue集合と`preparationKind = "structural-v2-only"`、`resource-v2-only-prepared`はexact 1 resource issueと`preparationKind = "resource-v2-only"`を持ち、各scopeのreason／issues／digest、null pair digestと一致させる。V2 core representability failureは`v2-unrepresentable`、fixed-point／digest置換／実byteLength／generation timeout／spool failure／cancel／sink errorは`v2-export-failed`となり、後者はV2／standaloneを含むprepared artifact 0件、DB write 0件である。前者の`standaloneV1Fallback.kind = "prepared"`だけは独立した`standalone-v1` verification／handoffへ渡せる。pairの片側失敗は`pair-incomplete`、V2-only本体失敗はreason別の`structural-v2-only-incomplete | resource-v2-only-incomplete`、standalone本体失敗は`standalone-v1-incomplete`だけを返して完了通知を禁止し、それぞれ同pair再生成、V2 handoff再試行、standalone handoff再試行を案内する。receiptを再検証できた場合だけ対応する`pair-completed | structural-v2-only-completed | resource-v2-only-completed | standalone-v1-completed`とし、全completed branchでhandedOff IDsをexpected IDs、failed IDsをemptyにする。`core-map`は旧・外部生成物との互換reader分岐およびsynthetic golden fixture専用であり、production serialize command／分岐を持たず、runtime persistenceの`core-only`もproducerへ流用しない。`item-only`の`data`は`AppBackupV2ItemOnlyCoreWireV1`だけ、`eventSettings`、`mapCellSplitSettings`、`durableVisitState`はすべて`null`を必須とし、既存復元先のsettingsとdurable visit stateをtransition plannerで維持する。各`*SectionWireV1`はversion付きJSON Schemaから所有する明示DTOで、runtime `AppData`、`ShoppingItem`、persistence rootの`Pick`／`Omit`／intersection、型再exportを禁止する。`snapshotToBackupWireV2`と`backupWireV2ToRestorePlan`だけがruntime境界を変換し、compile-time negative fixtureとarchitecture testでwire moduleからruntime／persistence typeへのimport 0件を検証する。top-levelの3 section key自体はenvelopeの不在sentinelとして常に必須とし、非`null`の場合だけ`expectedSections`へ列挙する。これ以外の`null` sentinelや宣言外keyは許可しない。

`scope.references.events`は全scopeで1件だけとし、`scope.eventRef`と同じ`eventRef`から`dataEventKey`へ対応させる。`scope.references.items`は全scopeで`data.eventLists`の対象event itemとexact bijectionをなし、各`dataItemId`へ一意なportable `itemRef`を割り当てる。`full-split`／`core-map`は、mapData row presentなら`scope.mapRefs = scope.references.maps = data.mapData.entries[0].maps`の全day-map slot、row absentなら3集合ともemptyとし、集合、canonical順、件数を一致させる。`scope.references.blocks`も同梱全mapの全論理block slotと一対一で一致する。rotation／route／viewportの各`mapRef`と、hall definitions／hall routeの`owner.kind = "map"`はこのmapData-derived reference集合へexact 1件解決することを必須にし、orphan mapRef／ownerをreaderでも全体拒否する。`historicalOwners`はcurrent mapDataへ解決しない削除済みownerだけを持ち、parent relationがacyclicで、各retained `historicalOwnerRef`からexact 1行へ解決する。`item-only`はitem referencesを保持する一方で`mapRefs=[]`、referencesのmaps／blocks／historicalOwners空、map／block／historical owner／active／retained／durable visit group件数0、`data.mapData`を含む他の9 data keyなしとする。したがってsplit設定が`null`でも`eventRef`とitemをcore data slotへ一意に解決でき、表示名やobject列挙順を代用しない。複数地図event、複数visit group、削除済みownerを共有する複数retained、残る8 sectionそれぞれのabsent対present-empty、metadata exact 1 present-empty row、各orphan section slotのgolden／negative fixtureを必須にし、地図同梱scopeを単一`mapRef`へ縮退させない。`full`と`multipart` scopeは後続versionで定義し、初版readerは未知scopeとして拒否する。

`counts`は表示用自己申告として信頼せず、export直前とreaderのschema検証後にI0固定pure `deriveEventBackupCountsV2`で実payloadから再計算して全7 fieldのexact一致を必須にする。`items`は`data.eventLists.entries[0]`のeventRef／dataEventKeyをscope manifestへ照合した後の`items.length`、`maps`はmapData row absentなら0、presentなら`maps.length`、`blocks`はpresent mapDataの全mapをcanonical走査した`blocks.length`総数、`historicalOwners`はreference table行数、`activeSplitEntries`／`retainedSplitEntries`はportable entryのstatus別件数、`durableVisitGroups`はportable durable sectionの全`executionVisitOrder` group総数とする。`full-split`／`core-map`のitem／map／block referencesは実payload集合と一対一で一致し、`core-map`はhistorical ownerとsplit 2値を0、`item-only`はitems以外を0とする。負数・非safe integer、自己申告と実数の差、present section間eventRef／dataEventKey差、absent／present-emptyの差替え、`scope.references`だけの水増し／省略はdigestが正しくてもcommit前に全体拒否する。raw scannerのhard limitは自己申告countを使わず、実token／entry数を数える。

portable durable visit entryは`(eventRef, normalizedDayKey)`のcanonical順かつ同tuple重複なしとする。pure `derivePortableDurableVisitScopesV1(data, scope.references)`は3.5のpreflightと同じ`deriveCanonicalSemanticDayDomainV1`を共有し、sole eventのitem raw day、day-mode key、execution bucketをtotal監査する。nonempty execution bucketは各ordered itemRefをeventListsのexact 1 itemへ解決してそのitemのraw dayへ帰属させ、bucket key自体をphantom dayにしない。item raw day候補が0件のstandalone empty day-mode／execution bucket keyだけはempty-day semantic tupleへ加える。unknown／duplicate／cross-event itemRef、同じitemの複数bucket所属、参照item raw dayとbucket candidateの不一致を拒否する。このdomainを`normalizeFsmcDayKeyV1`へ通した期待`(eventRef, normalizedDayKey)`集合とportable entriesのexact bijectionを必須にし、group 0件のempty durable entryも余分・欠落を検出する。

各scopeのexecution authorityは、そのscopeへ帰属する`data.executeModeItems.days[].orderedItemRefs`のstable exact partitionだけである。portable `executionVisitOrder`のouter group順はsource durable identity order、各`memberItemRefs`のinner順はcore raw execution orderとし、全group memberのunionをそのscopeのexecution itemRef集合と重複なしでexact一致させる。eventListsには存在するがexecution集合にない商品は通常の非execution itemとして保持し、group、`additionalPhaseByItemRef`、current／saved／purchase anchorへ0件でなければならない。商品だけ存在するdayもscope自体は持つがexecution集合が空ならempty entryとなる。`additionalPhaseByItemRef`はexecution itemRef順、各current／saved／purchase anchorは指定phaseのmember itemへ一意に解決し、null phase currentもphaseを保持する。importはportable group identityをローカルkeyとして採用せず、fresh item IDへのremap後にassociation／hall／split after-imageからidentityを再構築し、各group memberが同じ再構築identityへ解決し、group集合がexecution item集合のexact partitionである場合だけ同じ単一transactionへ参加させる。同一day tuple 2行、期待dayのempty entry欠落、coreにないempty entry追加、非execution item混入、0件／複数identity、anchor phase不一致、execution item集合差、outer group順／inner member順の重複・欠落を自動補正せずDB更新前に全体拒否する。このcoverage検査は7 fieldの`counts`とは独立する。

- portable durable restoreで再構築した`ExecutionVisitIdentity`列は各group内memberが同一identityへ解決するだけでなく、group集合とpairwise uniqueなidentity集合がexact bijectionでなければならない。別groupが同じidentityへ収束する入力、identity重複をorderで残す入力、2 groupを黙示統合するplannerをDB更新前に全体拒否する
- split-capable production exporterが地図を含むevent scopeを出力する場合は`full-split`かつ`includesSplitSettings=true`を必須とし、分割設定を黙って省略しない。`core-map`を返すserialize branch／commandは初版に存在せず、architecture testとnegative fixtureが戻り型、registry、dispatchの0件を検証する
- synthetic reader fixtureまたは外部入力のvalidなV2 `core-map`（`includesMapData=true`、`includesSplitSettings=false`、non-null `eventSettings`／`durableVisitState`）を復元する場合は、V1 fullと同じく影響範囲の既存split設定をpreview後に`legacy-full-restore-without-split-settings`でdormant化する。runtime `FsmcPersistenceSnapshot.capability = "core-only"`はV2 producerになれず、capability bootstrapとdurable migrationがreadyになるまではV1／XLSX 2.2だけを出力できる
- `includesMapData=false`かつ`includesSplitSettings=false`のitem-only scopeは既存の地図・分割設定を維持する。map置換とitem-onlyを同じ「設定なし」として扱わない

- `scope.references.events[0].dataEventKey`は同じV2のevent-scoped全sectionに存在する唯一のevent keyを指す
- `scope.references.halls`は全scope共通のportable hall descriptor tableとする。`full-split`／`core-map`では同梱hall definitionsの全hallとexact bijection、`item-only`では`eventLists`内のresolved `manualHall.hallRef`が参照するdistinct hallだけとexact bijectionにし、各行はsource hall IDをruntime identityとして採用するためでなく、source hall名とmapless／map owner＋raw day＋source map slotのsemantic descriptorを保持するために使う。resolved manual hallはtable exact 1行、missing unresolved manual hallはhallRefを持たずtable行0件を必須にする。item-onlyを既存eventへ復元するときは、全resolved hallRefと同descriptorのdestination hall definitionから二部候補graphを作り、source hallRef全体からdistinct destination Hall ID全体へのtotal injective matchingだけを許す。matching 0件は`item-only-hall-injective-matching-unavailable`、exact 1件はautomatic、2件以上は全候補graphとexact bijectionの利用者mapping choiceを要求する。個別hallRefのexact 1候補を先に予約して残りを貪欲選択せず、automatic候補とchoice候補を含む全体を同じmatchingとしてcommit直前に再検査する。新規event item-onlyでresolved hallRefが1件でもあればhall definitionを同梱しないため`item-only-new-destination-hall-unavailable`／write 0件とし、外部sourceHallIdの採用、synthetic hall作成、resolvedからmissing／unassignedへの劣化を禁止する。missing sourceHallIdはdistinct値ごとのfresh dangling tokenへgroup-preserving remapし、resolved descriptor mappingと混ぜない
- `backupWireV2ToRestorePlan`は`BackupV2RestorePlanResultV1`を返す。item-only existing destinationでは候補0件のrowを`item-only-hall-target-unavailable`、全候補graphにtotal injective matchingが0件なら`item-only-hall-injective-matching-unavailable`としてtyped rejectする。matchingが複数ある場合の`ItemOnlyHallMappingChoiceRequestV1.requests`は曖昧なrowだけでなく全resolved hallRefのnonempty候補rowをhallRef順に持つ。`requestSetDigest`は自身を除くexact `{ domain: "fsmc-item-only-hall-mapping-request-v1", sourceBackupV2Digest, sourceBackupArtifactSha256, destinationEventInstanceId, expectedDestinationRoots, destinationHallSnapshotDigest, requests }`のcanonical SHA-256とする。choiceは両source digestとrequest digestをbyte一致で引き継ぎ、request row集合とのexact bijection、各targetの候補membership、全target Hall IDのinjectivityを必須にする。new destination＋resolved hallRefはrequestを作らず専用rejectにする。planned branchは両source digestを保持し、`resolvedHallIdRemaps`を全resolved hallRefとのtotal injective exact bijection、missing dangling baseを別digestへ分離する。`planDigest`は自身を除くplan全fieldをexact `{ domain: "fsmc-backup-v2-restore-plan-v1", plan }`としてhashする。commitはsource V2 digest／artifact SHA、expected roots、destination hall snapshot、request／choice、候補graph、選択matching、after-image、logical participantを同一transactionで再検査し、別backupへのchoice replay、取消／stale／候補差／非injective choiceでは全root write 0件にする。同descriptorの2 source hallRefにdestination 1 hallだけ、各row exact 1だが同targetへ衝突、automatic候補とchoice候補の衝突、2通り以上のglobal matching、別item-only backupへのchoice replayをnegative／positive fixtureにする
- `expectedDestinationRoots`は別コードフェンスのruntime aliasへ依存せず、同一snapshotの各full `ExpectedStoreRoot`をcanonical `rootKey`とobserved revision root／checkpoint／recovery candidatesのdomain-separated digestへ写したnonempty `BackupRestoreExpectedRootVectorV1`である。adapterはruntime vectorとのroot集合exact bijection、canonical順、各digestを検証し、root省略、順序差、別snapshotのdigest混在を`destination-roots-stale`／write 0件にする
- hall descriptorのownerはscopeに応じてexactに分ける。`full-split`／`core-map`のmap ownerは`kind = "map"`と同じreference table内のexact 1 `mapRef`を必須にし、source slot keyはaudit witnessにだけ使う。`item-only`はmapsを持たないためmap由来descriptorを`kind = "item-only-source-map"`＋source slot semantic witnessとして持ち、`mapRef`を禁止する。full／coreでitem-only kindを使う入力、item-onlyでmapRefを捏造する入力、source slotだけでfull／core relationを結ぶ入力を拒否する
- hall owner分類はmapData-derived slot集合と`getMaplessKey(rawDayKey)`由来集合のXORを必須にする。両方へ一致するdual-match、どちらにも一致しないorphan、raw event-wide unscoped ownerを配列順やmap優先で分類せずtyped representability issueへ写し、V2／pairを0件にする。readerも同じXORを再検査し、mapless-looking map tab keyをmap ownerとmapless ownerの双方へ流用するfixtureを拒否する
- hall groupをwireへ写す前に、ownerごとのreachable semantic pair `(hallRef | null, priority: normal | priority | highest)`を全列挙し、現行codecについて全pairの`decodeCurrent(encodeCurrent(pair)) === pair`と、pair集合→raw group tokenのinjectivityを必須にする。`undefined`／`undefined:priority`／`undefined:highest`のreserved 3 tokenと実hall IDの衝突、suffix付き実ID単独のdecode変質、同ownerの`A` priorityと`A:priority` normalまたは`A` highestと`A:highest` normalのaliasは`v2-strict-structural-unrepresentable`／`hall-group-token-noninjection`としてV2／pairを0件にし、definition順、suffix除去、別ownerのdefinitionで救済しない。通常unassigned、実ID `undefined`／`undefined:priority`／`undefined:highest`、`A:priority`単独、`A`＋`A:priority`、`A`＋`A:highest`を独立fixtureにする
- `HallDefinitionsSectionWireV1.owners`と各`owners[].halls`はsource payload順を維持し、同一ownerのhall ID重複をstructural rejectにする。`scope.references.halls`は関係manifestとしてcanonical sortするが、その順をpayload hallsの表示／fallback順へ適用しない。各hallの`blockNames`もoptional keyのabsent、present-empty、source順、重複raw stringをexact保持し、map block ref化、sort、dedupeを行わない
- `dataDayMapSlotKey`は参照eventの`data.mapData`にある日程・地図slotを指す
- `dataBlockSlotKey`は参照map内の論理block slotを指す
- `scope.references`のportable map rowはruntimeと同じ`algorithmVersion`とauthoritativeな`mapStructureFingerprint`を持ち、portable active entryは`blockFingerprint`と`locationFingerprint`だけを持つ。entryへ現在map fingerprintを重複させない
- active entryはevent／map／block参照をすべて必須とし、`scope.references`で一意に解決し、同梱mapDataから再計算したmap／block／location evidenceが一致する場合だけ許可する
- 全entryの`eventRef`はscopeのsole `eventRef`と一致させる。retained current ownerは`blockRef`があれば`mapRef`も必須とし、そのblockの親mapと一致させる。historical ownerはcurrent refと相互排他的で`historicalOwners`へ解決する。historical blockの`parent.kind = "current-map"`は同じmanifestのexact 1 current `mapRef`、`historical-map`はexact 1 historical map ownerへ解決し、current map＋deleted blockをfresh historical mapへ劣化させない。最後にactiveだったentryはportable block／location evidenceを必須とし、never-activeは`portable-unresolved-reference`だけに限定する。exportは同じruntime `priorOwner` tupleを同じhistoricalOwnerRefへ写し、importは外部ref／IDを採用せず、historical map ownerだけにfresh opaque map ID、historical block ownerにfresh block IDを1回発行し、current-map parentでは復元済みcurrent mapのlocal IDと組にして全参照をgroup-preservingにremapする。current map exact 1件へ解決できないhistorical blockを表示名で接続せず全体拒否し、retainedのまま維持する。旧map fingerprintは診断fieldとしてだけ受理する
- `scope.references`、core data、preview inputから端末全体OFFまたは`localEnabled`を受け取らない。既存イベントでは復元先のローカル値を表示し、新規復元ではOFFになることを表示する
- portable refはkind別にevent `^e-[0-9]{6}$`、item `^i-[0-9]{6}$`、current map `^m-[0-9]{6}$`、current block `^b-[0-9]{6}$`、hall `^h-[0-9]{6}$`、historical owner `^o-[0-9]{6}$`、split entry `^s-[0-9]{6}$`の7 namespaceとし、export snapshotをcanonical順に走査して連番発行する。kindごとに別counterを使い、同じsuffixでもkindを跨いで参照解決せず、prefixと格納field kindの不一致、kind間ref流用をschemaで拒否する。historical map ownerは`parent = null`、historical block ownerのparentは`{ kind: "current-map", mapRef } | { kind: "historical-map", historicalOwnerRef }`のexact unionとする。前者はcurrent map exact 1件、後者は同tableのhistorical map exact 1件へ解決し、tableはowner kindとblock→map depth 1 relationだけを持つ。全owner ref unique、cycle／unknown parent／parent kind差、current map＋deleted blockをhistorical mapへ変える入力を拒否し、day／map／blockの診断値は各portable retained entryの`lastKnown*` fieldでoptional presenceと値をexact round-tripする。同じownerを共有するentry間で診断名が異なってもtableへ代表値を選ばず、import後も各entry値を統合しない。`mapRefs`、`references`の各配列、split entry配列、durable visit entry／group配列は上記canonical比較順とし、ref文字列は64 code unit以下、利用者表示文字列はI0 hard limit以下とする。`companionCore.fileName`は`^[A-Za-z0-9._-]{1,128}$`、`sha256`は64文字のlowercase hex、全countは0以上、`byteLength`は1以上かつ各々safe integer・hard limit以下をexact schemaで検証する
- 重複ref、存在しないactive参照、同じdata slotへの多重ref、`scope.references`外の未知keyを全体拒否する。加えてactiveの`(eventRef, mapRef, blockRef, number)`重複、同じ現在owner＋numberのactive／retained overlapを拒否する。retained同士は`entryRef`だけをidentityとし履歴を黙って統合しない。明示的な再関連付けでretainedをactiveへ戻す場合は、同じtransactionで元retainedを除去し、新activeとの一時的overlapもcommitしない

10個のcore `*SectionWireV1`と全leaf DTOは、それぞれ`additionalProperties: false`のversion付きJSON Schemaをauthorityとする。`eventLists.entries[0]`、`eventMetadata.entries[0]`、残る8 sectionでpresentな`entries[0]`だけが同じ`eventRef`／`dataEventKey`を持ち、eventListsをportable relation、他rowを同梱core上のevent名／outer keyとして`scope.references.events[0]`とbyte一致させる。8 sectionの`entries=[]`はsource event row absentの唯一のwire表現で、present-empty rowを代用しない。canonical sort／uniqueを要求するのは`scope.references`、historical owner table、section間relation row等の順序を意味に持たないmanifest配列だけとする。`eventLists.items`、`executeModeItems.orderedItemRefs`、route `visitOrder`／各`itemRefs`、hall `hallOrder`／`hallVisitLists`／各`itemRefs`、map cells／merged cells／blocks／vertices／cell groups、raw `blockNames`等のorder-bearing payload配列はadapter inventoryで明示しsource順をexact維持する。ID参照配列はfieldごとの既存invariantどおり重複を拒否する一方、`blockNames`は重複も値として保持し、全配列を一律sort／dedupeしない。`scope.references`、present data section間の参照、実payloadからexact bijectionを検証する。runtimeのitem ID、map／block／hall IDをportable refとして採用せず、`snapshotToBackupWireV2`がscope-local refを発行し、restore plannerがfresh local IDへinjective remapする。表示event名は`dataEventKey`でround-tripするがlocal event instance identityには採用しない。`EventMetadataSectionWireV1`は利用者metadataだけを持ちlocal-only `splitIdentityAnchor`を禁止し、new destinationはfresh anchorを発行、existing destinationは自身のanchorを維持する。optional keyのabsentと明示`null`をschemaどおり区別し、非finite number、unsafe integer、重複key／ref、unknown property、present section間のeventRef／dataEventKey差、owner外hall／block／item参照をDB更新前に拒否する。schema→TS生成symbol名、schema SHA-256、golden payloadはI0 inventoryへ固定し、I4 compile testが10 section／全leaf、8 sectionのabsent／present-empty、metadata exact 1 row、runtime／persistence型importの欠落・余分を拒否する。

`PortableBlockNameReferenceWireV1`は現行block名の0件／複数解決を`missing | ambiguous`としてlosslessに表す。一方、manual hall／hall groupはfresh ID復元後に複数owner候補関係を再現するsidecarを初版wireへ持たないため、`PortableHallReferenceWireV1`とnon-malformed `PortableHallGroupTokenWireV1`のunresolved reasonは`missing`だけを許す。sourceでhall解決がambiguousなら`v2-strict-structural-unrepresentable`／`owner-relation-invalid`としてV2／pairを0件にし、凍結V1→current reader→固定旧版Aでlegacy core同値を証明した場合だけstandalone V1 fallbackを許す。resolvedだけがportable refを参照し、missing unresolvedはopaque source hall IDを診断用に保持してcurrent hallやactive bindingへ採用しない。`HallVisitList.hallId`はbase hall IDだけでなくgroup priority suffixを持つため、`hallVisitLists[].hallGroup`は`hallOrder[]`と同じexact `PortableHallGroupTokenWireV1`を使い、通常／priority／highest、resolved／unassigned／missing-unresolved／malformedを保持する。両arrayのsource順は別々に維持し、片方から他方を導出しない。dangling同値性はraw IDだけでなくowner contextを含む`PortableHallSourceEquivalenceKeyV1(sourceOwnerDescriptorDigest, sourceHallId)`で決める。manual itemはraw dayから導くowner descriptor、hall visit／orderはenclosing owner descriptorを使い、同じraw hall IDでも別day／別ownerなら別keyとして許す。restore plannerは各keyへfresh local baseをinjectiveに一度だけ割り当てるが、同じkeyにresolved hallRef exact 1件があればそのfresh resolved local hall IDをmissing faceにも使い、そのownerで定義がない参照はdanglingのままにする。resolved hallRef 0件ならfresh dangling base、2件以上ならambiguous blockerとする。同じkeyの全item `manualHallId`、全unresolved `HallVisitList.hallId` group、全unresolved hall-order tokenでbaseを共有し、別keyを統合しない。各group tokenのpriority／suffixとraw malformed `sourceToken`はその参照ごとにexact維持し、base remapへ吸収しない。group tokenの`sourceHallId = null`はraw malformedだけ、正式なreserved unassigned tokenは前項のcollision検査後に`kind = "unassigned"`＋priorityとしてround-tripし、dangling identityを発行しない。同じcontext keyのresolved候補複数、異なるkeyの統合、3面の一部だけ別base token化、priority消失、unassignedのresolved化、配列順によるcurrent hall補完を拒否する一方、day A resolved／day B missingの同じraw IDは別context keyとしてlossless round-tripする。`:priority`／`:highest` suffixは両token aliasの`priority`へ分離し、その他のmalformed tokenはraw `sourceToken`を保持する。`HallDefinitionsSectionWireV1.halls[].blockNames`はmap block参照ではなくmapless hallの生block名membershipであり、source配列の順序、重複、各raw文字列をexact保持して復元する。`PortableBlockNameReferenceWireV1`はroute側のblock bindingだけに使い、hall definitionのblock名をportable block refへ解決しない。strict range／individualへ安全に写せない現行`CellGroup` optional combinationは`legacy-optional-shape`のexact optional field＋source digestへ保存し、active geometryには採用せず復元時に同じlegacy shapeへ戻す。digest差、宣言外optional combination、resolved refの参照0／複数を拒否する。

manifestの`dataEventKey`／`dataItemId`／`dataDayMapSlotKey`／`dataBlockSlotKey`はsource coreとのaudit対応witnessであり、portable identityではない。wire payload内の関係は`eventRef`／`itemRef`／`mapRef`／`blockRef`／`hallRef`だけを使い、readerはdata値をfresh local IDとして採用しない。`deriveEventBackupCountsV2.items`は`data.eventLists.entries[0].eventRef === scope.eventRef`かつ`dataEventKey === scope.references.events[0].dataEventKey`を確認して`items.length`、mapsは`data.mapData.entries[0].maps.length`、blocksはその`maps[].blocks.length`の総和から計算する。他sectionもsole eventRef／dataEventKeyを同じ値へ照合し、旧object-map前提のlookup、表示名だけの照合、manifest行数だけのcountを禁止する。

### 7.2 後続版: 完全版XLSX 2.3（informative）

<!-- fsmc-requirement-catalog: informative-start xlsx-2.3-reservation -->

このmarker範囲は後続版ADRへ渡す非規範の設計メモであり、初版の実装フェーズ、test、Exit、Definition of Done、`config/fsmc-requirement-catalog.json`の`sourceAnchor`／`supportingSourceAnchors`へ含めない。以下の「必須」「exact」「拒否」は将来ADRが採否・変更できる候補を説明する語であり、本計画上の実装契約ではない。後続版を開始するPRは、物理schemaを確定する専用ADR、新しいstable requirement ID、traceability、golden fixture、test manifest entryを同時に追加し、このmarkerを除去してから実装する。初版で規範となるのは`DOD-FSMC-038`の「当該機能を初版から分離する」境界だけである。

- 形式バージョンを2.2から2.3へ上げる
- 「セル分割参照」と「セル分割設定」の専用シートを追加する
- mapData JSONには分割項目を混入させない
- XLSX Workerのprotocol、allowlist、resource limit、golden fixtureを更新する
- 2.2以前は分割設定なしとして読み込む
- 簡易XLSXとCSVには専用設定を出力しない
- 2つの専用シートは完全版かつ地図同梱時だけ出力し、アイテム取込では既存設定を維持する
- workbook metadataへ`scopeKind`、対象event／map参照、`includesMapData`、`includesSplitSettings`、期待sheet名、各sheet件数、schema versionを記録する。期待sheetの欠落は破損として全体拒否し、item-only等の意図的省略はmanifestから判定する
- 地図を置換するXLSX 2.3で`includesSplitSettings=false`の場合は旧形式fullと同じdormant previewを適用し、item-onlyでは既存設定を維持する。新版の地図同梱exportは専用sheetを必須とし、欠落を意図的省略に偽装しない
- active／dormant／quarantinedとportable参照をround-tripし、取込時には新しいローカルIDへremapする
- 後続版の専用sheetへ「アプリ管理・直接編集不可」の説明、worksheet protection、必要に応じた非表示設定を付ける。保護はsecurity boundaryとせず、import時の厳格検証を省略しない
- セル分割専用sheetとそのscope metadataはexact headerとscalar cellだけを許可し、formula、error cell、rich text、external linkを拒否する。既存の商品sheetにおけるformula結果の扱いは従来仕様を維持し、本制限を誤って拡大しない
- sheet行数、cell数、shared string、ZIP展開後byte数、entry数、文字列長、Worker時間・memoryを検証し、zip bombや過大workbookをDB更新前に原子的に拒否する

version dispatchは`2.2`以下を分割設定なしのlegacy、`2.3`をこのschemaで厳格読込、`2.3`より大きい未知versionを全体拒否とする。将来versionをlegacy相当として読み、分割設定を黙って落とさない。XLSX 2.3のexport画面、ファイル名、説明へ「旧版アプリでは専用sheetが無視され、分割設定を復元できない」旨を表示する。

「セル分割参照」はportable association manifestを表し、exact headerを次とする。

| 列                        | 必須     | 内容                                                |
| ------------------------- | -------- | --------------------------------------------------- |
| `kind`                    | 必須     | `event`／`map`／`block`                             |
| `ref`                     | 必須     | kind内で一意なportable参照                          |
| `parentRef`               | 状態依存 | mapはeventRef、blockはmapRef、eventは空             |
| `dataSlotKey`             | 必須     | event key、day-map slot key、block slot key         |
| `mapStructureFingerprint` | 状態依存 | map行だけ必須となる地図全体のauthoritative evidence |

「セル分割設定」の物理schema、exact header、列順、空cell規則は初版I0のauthorityにせず、後続版の着手ADRとgolden fixtureで`PortableActiveSplitEntryV1 | PortableRetainedSplitEntryV1`から確定する。次表は欠落してはならない概念fieldの候補であり、実装可能なexact headerではない。

| 列                    | 必須     | 内容                                   |
| --------------------- | -------- | -------------------------------------- |
| `eventRef`            | 列必須   | activeは非空。その他は未解決時に空可   |
| `mapRef`              | 列必須   | activeは非空。その他は未解決時に空可   |
| `blockRef`            | 列必須   | activeは非空。その他は未解決時に空可   |
| `ownerKind`           | 必須     | `none`／`current`／`historical`        |
| `historicalOwnerRef`  | 状態依存 | historical ownerだけ非空               |
| `entryRef`            | 必須     | ファイル内で一意なentry参照            |
| `lastKnownEventName`  | 必須     | preview表示用                          |
| `lastKnownDayKey`     | 必須     | preview表示用                          |
| `lastKnownMapName`    | 任意     | preview表示用                          |
| `lastKnownBlockName`  | 必須     | preview表示用                          |
| `number`              | 状態依存 | 解決済み番号だけsafe integer           |
| `originalNumberToken` | 状態依存 | token-only retainedでは必須            |
| `direction`           | 必須     | `left-right`／`top-bottom`             |
| `aSide`               | 必須     | directionと整合する側                  |
| `status`              | 必須     | `active`／`dormant`／`quarantined`     |
| `reason`              | 状態依存 | activeでは空、その他はallowlist code   |
| `evidenceOrigin`      | 必須     | `last-active`／`portable-never-active` |
| `blockFingerprint`    | 状態依存 | last-activeだけ必須                    |
| `locationFingerprint` | 状態依存 | last-activeだけ必須                    |

後続ADRはactive行のevent／map／block参照、current／historical／none owner、safe integer番号／token-only retained、last-active／portable-never-active evidenceを判別可能unionとして表現し、各分岐で必須／禁止cellをexact化する。dormant／quarantinedの未解決参照を空にできてもlast-known情報とreasonは必須とする。重複ref、未知列、欠落列、分岐で禁止された非空cellを拒否する。上記unionをlosslessに表せない限りXLSX 2.3実装を開始せず、初版I0 Exit／DoDへ未確定headerのfixtureを要求しない。

「セル分割参照」の`dataSlotKey`は同じworkbookの同梱mapDataへ一意に解決するものだけを許可する。map行の`mapStructureFingerprint`を地図全体の唯一のauthorityとし、active設定は3段階の参照解決、map行のevidence、entry行のblock／location evidence一致を必須とする。dormant／quarantinedだけ未解決参照を許可する。端末全体OFFとevent enabledはworkbookへ収録しない。

<!-- fsmc-requirement-catalog: informative-end xlsx-2.3-reservation -->

### 7.3 保証規模と入力安全制限

自動性能テストの保証規模、import拒否境界、export生成境界を形式・file単位とV2＋V1 pair単位に分ける。I0で`config/fsmc-backup-limits.json` schema version 1へ、`performanceGuaranteedRawBytesPerFile = 32 * 1024 * 1024`、V1／V2 JSON専用`jsonImportHardRawBytesPerFile = 64 * 1024 * 1024`、`v2ExportMaxRawBytes = 32 * 1024 * 1024`、`companionV1ExportMaxRawBytes = 32 * 1024 * 1024`、`pairTotalExportMaxRawBytes = 48 * 1024 * 1024`、`temporarySpoolMaxRawBytes = 64 * 1024 * 1024`、`exportGenerationTimeoutMs = 300_000`、`workerSliceBytes = 1 * 1024 * 1024`、nesting 64、JSON token 5,000,000、event 1、map 256、block 8,192、split entry 20,000、item 100,000、1文字列1 MiB（UTF-8）、validation error 100件、1 error 512 Unicode scalar、Worker validation timeout 30秒、cancel確認間隔1秒を整数byteで固定する。pair raw totalはexact `v2CanonicalBytes.byteLength + companionV1Bytes.byteLength`であり、各file 32 MiB以下でも独立に発火できる初版の同時生成／handoff予算として48 MiBへ固定する。manifest、file名、digest文字列はこのraw totalへ含めず別上限を捏造しない。XLSX 2.2は既存`config/xlsx-limits.json` schema version 1の`maxCompressedBytes = 33,554,432`、entry 4,096、単一展開entry 64 MiB、総展開256 MiB、圧縮率100等を初版hard limitとし、backup limits側は同fileのpath、schema version、SHA-256を`xlsxImportLimitsRef`として参照して値を複製しない。各形式ではfile byte上限と構造・展開・count上限のうち最初に超えた厳しいlimitを優先する。3.13の保証fixtureはcount境界とV2／V1各実生成bytesの両方が`performanceGuaranteedRawBytesPerFile`以下、かつpair合計が`pairTotalExportMaxRawBytes`以下でなければならず、超える場合はI0を失敗させて製品判断を更新し、保証を黙って縮小しない。incremental export sink、resource issue、`v2-export-failed` witnessは全てこのconfig実bytesのSHA-256と上記field値へ拘束し、別定数や既定値へのfallbackを禁止する。値を変える場合は参照先を含むconfig schema version、golden境界fixture、互換影響を同じPRで更新する。

- V1／V2 JSON importは選択した各fileが保証規模または32 MiBを超え、64 MiB以下かつ他の全hard limit以下の場合だけ警告付きbest effortでpreviewまで進める。XLSX 2.2にはこの64 MiB best-effort帯を適用せず、compressed 32 MiB以下かつ既存の展開後／entry／sheet／row／cell／圧縮率／時間上限をすべて満たす場合だけpreviewへ進める。複数fileを黙示pairとして合算せず、各fileと明示manifestの関係を別に検証し、自動削除・切捨て・設定解除を行わない
- V1／V2 JSONの単一fileが64 MiBを超える、XLSX 2.2のcompressed fileが32 MiBを超える、またはいずれかの形式固有hard limitを超える場合はWorkerまたはvalidatorで`resource-limit`として拒否する。境界は各形式で`<=`を受理、該当limitの`+1 byte`／`+1 count`を拒否とする
- exportは保証countを1件でも超える場合はV2生成・downloadを停止してevent縮小とtrusted core退避を案内し、incremental sinkで測った最終V2 canonical bytesが32 MiBを超える場合、generation timeout、spool cap実装違反、cancel、sink errorはreason別witness付き`v2-export-failed`／prepared artifact 0件とする。V2が両条件内でcompanion V1 bytesの32 MiBまたは2 file raw byteLength合計48 MiBだけを超える場合は、V1／pairを0件、`companion-v1-resource-limit`のexact issue／digestを持つverified V2-onlyをexact 1件生成する。失敗したpairの片方をV2-onlyへ偽装せず、不完全fileを完了扱いにしない
- `FSMC_NUMBER_TOKEN_MAX_UTF8_BYTES = 1 MiB`をI0 ADRへ固定し、UI、CSV、XLSX、V1／V2の全番号取込で`BigInt`化前に適用する。新規入力・file after-imageの超過は全commit前に`resource-limit`として拒否し、既存永続dataの超過tokenは原文を変更せず`legacy-unresolved / unsafe-base-number`として診断し、経路や自動再関連付けへ使わない
- backupは`JSON.parse`前のraw byte上限、nesting、総entry、文字列UTF-8 byte、duplicate ref、構造fieldのallowlist、validation error保持数を制限する。利用者入力値であるイベント名・日程名等が`__proto__`、`constructor`、`prototype`であること自体は拒否せず、動的keyは`Map`、null-prototype object、または安全なown-property APIで扱ってprototype chainへ代入しない
- 初版XLSX 2.2は既存`config/xlsx-limits.json`のcompressed／entry／展開後XML byte、sheet／row／cell数、圧縮率、wall／CPU timeとI4のcancel／heartbeat／peak memoryをすべて適用する。後続XLSX versionも少なくとも同じ制限を継承し、緩和にはversion付き判断を要求する
- アプリ自身が出力した保証規模内のV2を同version importerがresource limitで拒否しないgolden testを固定する

初版のevent export preflightで1イベント内地図数、entry数、推定byte数を検査する。I0では上記3種類の境界と3.13の保証件数を固定し、I4で実canonical export bytesを使って次を実装・強制する。

- イベント単位Backup V2とV1互換coreのmap／entry、V2各32 MiB、V1各32 MiB、pair raw byteLength合計48 MiBのexport generation上限
- 上限内での自己round-trip保証

初版のeventが保証countを超える場合は読めないV2や不完全ファイルを生成せず出力を停止して対象eventの縮小方法を案内する。incremental sinkの最終V2実byteLengthが32 MiBを超える場合、300,000 ms timeout、64 MiB temporary spool cap違反、cancel、sink errorはconfig SHAとreason別witnessを持つ`v2-export-failed`／artifact 0件とする。V2が保証count・上限内でcompanion V1の32 MiB上限またはpair raw byteLength合計48 MiB上限だけを超える場合は、V1／pair bytesをhandoffせず`companion-v1-resource-limit`のexact issue／digestを埋めたverified V2-onlyへ進む。自動分割するmultipartは後続版とする。外部V1／V2 JSON importだけはfileごとに64 MiB以下のbest effort分岐を持ち、XLSX 2.2は既存compressed 32 MiB hard limitを優先し、export停止と混同しない。I4では最大fixtureのself round-tripが上記limitで拒否されないこと、V2単体、V1単体、独立に発火するpair合計48 MiB、temporary spool 64 MiB、export generation 300,000 ms、JSON import 64 MiB、XLSX compressed／単一entry／総展開／圧縮率の各境界直前・一致・+1、count境界とbyte境界が逆転するcaseを自動テストする。

### 7.4 後続版: 設定単独portable JSON

この節は後続版の設計予約であり、初版の実装フェーズ、テスト、Definition of Doneへ含めない。後続版でdormant／quarantined管理画面から出力する設定単独ファイルは、Backup V2と混同しない別形式とする。

- `kind: "event-shopping-planner-map-cell-split-settings"`
- `version: 1`
- portable event／map／block／entry参照、last-known表示情報、split、status、reason、digest
- アイテム、地図payload、ローカルinstance ID、metadata revisionは含めない
- 再import可能とし、検証後は必ずdormant／quarantinedとしてpreviewへ載せ、利用者の明示的な再関連付けなしにactiveへしない
- Backup V2と同じraw byte、nesting、文字列、entry、digest検証を適用する

## 8. 描画・タップ・経路の実装方針

### 8.1 結合セルと回転

既存の逆回転処理でポインター座標を地図座標へ戻してから、共通geometryでa/bを判定する。

- 保存された左右・上下を画面方向へ読み替えない
- 描画、hit-test、マーカー、経路anchorは同じboundsを使う
- 結合セルは親セル1マスではなく、merge全体のboundsを使う
- DPR 1/2/3と任意角度でも描画位置とhit-testを一致させる

### 8.2 経路anchor

既存の3×3経路探索へ小数行・列をそのまま渡してはならない。配列インデックスが整数前提だからである。

- 経路探索の基準セルは1-based整数の`GridCellAddress`、探索内部は整数`SubcellPathNode`、描画geometryは0-based連続`MapPoint`とする
- 半領域中央を正確な`MapPoint anchor`として別fieldに持ち、既存のfractional row／col shapeをsplit domainへ流さない
- 経路本体は既存3×3探索を利用し、結果の`SubcellPathNode[]`を`mainPath`として保持する。共有adapter `pathNodeToMapPoint({ subRow, subCol }) = { x: (subCol + 0.5) / 3, y: (subRow + 0.5) / 3 }`だけが描画・hit-test用の連続点へ変換する。単一セルまたは結合セルの物理領域を0-based subcell集合`R`へ変換し、`R`の境界nodeのうち、4近傍に`R`外の通常通過可能nodeが1個以上あり、anchorからそのnodeへの線分が`R`内かつ禁止領域非横断となるものだけをrouting port候補にする。候補は外向き方向rankを上、左、右、下、次にbase cell中央nodeからのManhattan距離、`subRow`、`subCol`の昇順で並べ、角は最初の外向き方向だけに重複排除する。from／to候補pairを各indexの辞書順で評価し、経路が得られる最初のpairを採用する。start／goal passability例外は選択したport nodeそのものだけに許可し、fromの次nodeとtoの直前nodeは`R`外でなければならない。これによりmain pathが番号・結合領域内を通過することを禁止する。安全な候補pairがない場合は`unroutable: unsafe-connector`を返す。別セルまでBFSしてanchorへ直線を引く処理や、障害物を無視し得る直線／L字fallbackを使わない。`mainPath`の始終nodeはfrom／toの各`routingPort.node`と一致させる
- `routingPort.point`から半領域anchorへの`from-anchor`／`to-anchor` connectorは、線分全体が対象の自セルまたは結合セル領域内にあり、禁止領域を横断しないことをgeometryで検証した場合だけ`mainPath`と別の`MapPoint[]`で保持し、細い点線で描画する。connectorをpathfindingの通過cost、重複penalty、sub-cell使用量へ混入させない
- connector専用maskでは対象visit自身の番号セル／結合領域`R`だけを許可領域とし、同じmapの他番号領域、他merge、範囲外、非finite geometryを禁止する。既存`isPassableCellData`が番号セルを通常経路では通行不可にする規則をconnectorへそのまま適用せず、逆に自owner以外の番号セルを許可しない。port nodeだけに与えるmain-path start／goal例外とconnector maskを別関数にし、同じmask fixtureをnormal／focusで共有する
- 同一整数セルのa→bは、両anchor間が同じ物理セル領域内で安全な場合だけ`mainPath=[]`と`same-cell-direct` connectorを正式なvisit間segmentとして保持し、安全でなければ`unroutable`とする
- 異なるpriority／phase visitがbyte-identicalなanchorを共有する遷移は`geometryKind="coincident-anchor"`、`mainPath=[]`、`connectors=[]`、`hitTestable=false`のzero-length segmentとしてroute順に保持する。描画線や架空connectorを作らず、to visitへの進行、現在ring、DOM候補、挿入anchor、cache keyからは除去しない
- hit-testの優先順位はmarker、main path、connectorとし、CSS px toleranceはmarker外周12、main path 8、connector 10へ固定する。同priority内はscreen-space距離、route順、canonical visit IDの順で候補を並べ、exact同順位または同markerの複数visitはDOM候補一覧を表示する。`coincident-anchor` segment自体はhit-testせずmarker候補から選ぶ
- 経路cacheとsignatureには順序付き`visitId`、`locationKey`、baseCell、anchor、split binding evidence、index revision、`pathfindingGraphFingerprint`、non-null `RoutePathConstraintFingerprint`を含める。whole-map、別hall、polygon／hall revision差のcacheを再利用しない。`DayMapData.cells`の`value`／`backgroundColor`、map寸法、結合領域、passability rule、3×3解像度、cost定数のいずれかが変われば古い経路を再利用しない。描画px、font色、回転、zoom、pan、DPR値をsnapshotへ保存しない

### 8.3 描画overlayの統合

通常マップと集中モードに重なる選択、hover、現在・次・前・一時位置、購入状態、候補状態、番号マーカー、経路、クリック領域は、共有`MapLocationIndex`と位置APIが返す`bounds`、`anchor`、`locationKey`を使用する。`LocationPresentationState`は既存の通常／集中モード別state reducerを`locationKey`ごとに一度集計して生成し、描画順が後のvisitで先の状態を上書きする「last drawn wins」を禁止する。

- 半領域に属するoverlayを行・列だけのcacheやdedupeへ戻さない
- ベースセル罫線、結合セル外枠などセル全体のoverlayと、a/b別overlayを明示的に分ける
- Canvas描画、DOM popupの見出し、訪問一覧、経路markerが同じ`displayNumber`と`locationKey`を参照する
- 回転、DPR、pan／zoom後も描画位置とhit-testの逆変換を同じgeometryで行う
- feature OFF／安全モードでは従来のwhole-cell overlayだけを使用し、保存済みentryを変更しない

同じboundsへ複数状態を順番に上書き描画せず、物理位置ごとに`LocationPresentationState`へ集約する。layer順は、ベースfill・罫線、a/b別状態fill、分割線、選択等のoutline、main path、点線connector、中立marker・訪問数badge、現在訪問ring、正立した番号・a/b・状態文字とする。単一訪問だけは既存の優先度色markerを維持し、複数訪問markerを特定優先度の代表色にしない。

pure `reduceLocationPresentationStateV1(mode, locationKey, visitStates)`は入力順をsort前提にせず、次の決定表でexact 1結果を作る。`map-data-untrusted`はsplit fill／connectorを出さずlegacy whole-cell安全表示、selectionは独立outline、currentは独立ring、temporary／next／previousは互いを塗り潰さないtagged outline、購入・候補状態はmode別の既存color token集合、複数visitは中立marker＋visit数badge＋phase／priorityのDOM候補とする。同一locationにcurrent、next、temporary、normal、postponed、late、複数priorityが重なる全組合せをgolden matrixにし、visit入力shuffleでrender modelがbyte同値になるproperty testをI1、I8、I9で共有する。

panel／picker／popupは明示的な`role="dialog"`または`role="region"`と一意なaccessible nameを持ち、icon-only close buttonは表示文言と一致する`aria-label`を持つ。状態通知は`{ operationEventId, messageCode, subjectVisitId }`をpure reducerへ渡し、同じoperation event IDを全surfaceでexact 1回だけ常設`role="status"`へ反映する。文言が直前と同じ別操作でも新event IDなら通知し、rerenderや同eventの再配送では通知しない。

### 8.4 Pointer gesture state machine

Canvas入力のauthorityはPointer Eventsへ統一し、native TouchEventとReact PointerEventで別々のgesture状態を管理しない。現行のnative touch処理を持つ`src/features/map/canvas/useCanvasViewport.ts`を唯一のstate-machine migration targetとし、通常Canvasの実DOM listener／style終端`src/components/map/MapCanvasPresentation.tsx`、consumer `MapCanvas.tsx`、`FocusModeMapCanvas.tsx`は同hook／adapterから同じgesture snapshotを受ける。永続する状態は`idle`、`tapCandidate`、`dragging`、`multiPointer`のexact unionとし、cancelを脱出不能なstateとして保持しない。TouchEvent listener、React touch handler、component-local pointer mapの並行authorityはmigration完了時に0件とする。

- `pointerdown`でpointer captureを取得し、pointer ID、開始client座標、開始時刻、入力種別を記録する
- 通常／集中Canvasの実要素はともにinline／stylesheet authorityを一つにしてcomputed `touch-action: none`を必須とし、browser native pan／pinchを発火させずcustom viewport reducerが全gestureを所有する。祖先の別値、`auto`／`manipulation`へのfallback、mode別差を拒否する。listenerは次のexact matrixを`addEventListener` instrumentationで検証し、passive listenerから`preventDefault()`を呼ばない

| DOM event            | passive | `preventDefault()` contract                                        |
| -------------------- | ------- | ------------------------------------------------------------------ |
| `wheel`              | `false` | current Canvas targetかつfinite deltaを受理した全eventで必須       |
| `pointerdown`        | `false` | schema-validなcurrent Canvas inputをnormalizerへ受理した時点で必須 |
| `pointermove`        | `false` | 同じCanvasのtracked／captured pointerだけ必須。untrackedは不可     |
| `pointerup`          | `false` | 同じCanvasのtracked pointerだけ必須。untracked／keyboardは不可     |
| `pointercancel`      | `true`  | 禁止                                                               |
| `lostpointercapture` | `true`  | 禁止                                                               |
| `click`              | `false` | `synthetic-click-matching`だけ必須。keyboard／nonmatchingは不可    |

- 2本目のpointerが入った時点で`multiPointer`とし、全pointerが離れるまでtap候補へ戻さない
- CSS px移動量が入力別drag閾値を超えたら`dragging`とする
- `pointercancel`、active captureの予期しない`lostpointercapture`、画面回転、layout切替、visibility喪失はnormalized global cancelへ写し、同じreduce内で全resourceを解放して`idle`へ戻す。正常`pointerup`後にrelease-request witnessと一致する`lostpointercapture`はcapture bookkeepingだけをclearしてtap／synthetic-click guardを維持し、別ID／別targetのstale lostはdispatch 0件のno-opとする
- tap確定は単一pointerの`tapCandidate`が同じpointer IDの`pointerup`を受けた場合だけ行い、後続synthetic clickで重複実行しない
- route insert、block selection等の編集modeを先に判定し、通常セルpopupとの優先順位を固定する

I0の`config/fsmc-pointer-transition-table.json`は、各validなstate／active-registry invariantからpure `deriveReachablePointerInputDomainV1`が導くexact reachable `(state, normalizedInput)`集合とexact bijectionのrowを持つ。全stateと全tokenの直積は作らず、到達不能row 0件、reachable pairの欠落／重複0件とする。raw downの正規化優先順位は、(1)既にtrackedのIDなら`duplicate-pointer-id-down`、(2)active pointerが1件以上なら`additional-pointer-down-capture-succeeded | failed`、(3)active 0件かつ`isPrimary=true`なら`primary-pointer-down-capture-succeeded | failed`、(4)それ以外は`non-primary-down-without-active`であり、2本目touchをprimaryと重複分類しない。raw moveは、(1)untracked IDを`non-active-pointer-move`、(2)`multiPointer`かつactive 2件以上でcapture順先頭2 IDのowner pairを動かす入力を`multi-pointer-owner-move`、(3)同状態のowner外IDを`multi-pointer-nonowner-move`、(4)`multiPointer`かつactive exact 1件を`multi-pointer-single-remnant-move`、(5)それ以外のtracked IDを`active-pointer-move-below-threshold | active-pointer-move-over-threshold`へこの順で排他的に写す。raw upは、(1)untracked IDを`non-active-pointer-up`、(2)`multiPointer`で除去後active 0件を`multi-pointer-up-drained`、(3)同exact 1件を`multi-pointer-up-single-remnant`、(4)同2件以上かつ離脱IDがowner pair内なら`multi-pointer-owner-up-rebase`、(5)同2件以上のowner外なら`multi-pointer-nonowner-up`、(6)それ以外のtracked IDを`active-pointer-up`へこの順で排他的に写す。残りのdisjoint inputは`pointer-cancel`、`expected-lost-pointer-capture-after-release`、`unexpected-active-lost-pointer-capture`、`stale-nonactive-lost-pointer-capture`、`visibility-or-layout-cancel`、`synthetic-click-matching | nonmatching`、`unmount`とする。release witnessはexact `{ state: "release-requested", pointerId, captureOrdinal, sequenceOrdinal, canvasTargetInstanceId }`で、normal `pointerup`の`release-capture` effectと同時に1件作る。lost eventが同target／IDのwitnessに一致しcurrent Canvasの`hasPointerCapture(pointerId) = false`ならexpected、active registryの同IDまたはcapture保持中ならunexpected、どちらにも該当しない別ID／別targetならstaleへ排他的に正規化する。normalizerは各valid snapshotの全raw inputをreachable token exact 1件へ写す。state／registry invariant自体が不正ならtableへ入れずpre-table corruption guardが全capture／registry／timer／guardをfail-closed cleanupし、invalid invariantを通常transition rowとして水増ししない。非active moveは座標、threshold、gesture stateを変更しない自己遷移に固定する。unknown raw event、非finite座標、owner pairの旧／新距離を安全に算出できない入力は受け口で`visibility-or-layout-cancel`と同じ即時cleanupへ写し、暗黙defaultを持たない。

`idle`の`primary-pointer-down-capture-succeeded`だけが`tapCandidate`へ入り、primary／additionalのcapture failed、duplicate IDはdispatch 0件で即時`idle` cleanupする。active 0件のnon-primary downとnon-active move／upは唯一の`ignored` branchでregistryを変更しない。`tapCandidate`のthreshold超過は`dragging`、additional capture成功は`multiPointer`、同一ID upだけがtapをexact 1回dispatchする。`dragging`はtapをdispatchしない。DOM `PointerEvent.pointerId`はnormalizer入口から非負safe-integer `number`のまま保持し、文字列化やlexicographic比較をしない。active registryはcapture成功ごとに単調増加する非負safe-integer `captureOrdinal`をexact 1件割り当て、entryを数値tuple `(captureOrdinal, pointerId)`の昇順へ正規化する。`multiPointer`のowner pairはその先頭2件で固定し、同じpointer IDの再登録は`duplicate-pointer-id-down`、ordinal重複／overflow／負数／非整数IDはpre-table corruption guardからfail-closed cleanupする。owner moveは旧／新centroid差と正の有限な旧／新distance比をexact `{ translateCssPx, scaleFactor, centroidCssPx }`へしてviewport transformを1回dispatchする。owner外moveはregistryだけを更新する。`multi-pointer-owner-up-rebase`は残存先頭2件をowner pairへ、`multi-pointer-up-single-remnant`は残存1件をpan baselineへeffect 1回でrebaseし、どちらもtransform 0件、`multi-pointer-nonowner-up`はregistry除去だけ、`multi-pointer-up-drained`だけは`idle` cleanupとする。single-remnant moveはpanをdispatchするがtap候補へ戻さない。pointer cancel、unexpected active lost capture、visibility／layout cancel、unmountはstateを問わず全capture／release witnessを解放し、drainを待たず即時`idle`へcleanupする。normal up後のexpected lostは`clear-release-witness`だけでguardを維持し、stale nonactive lostはstate／registry／guard不変とする。新しいprimary downはcapture前に古いrelease witnessをclearし、同pointer ID再利用でも新capture ordinal／sequence ordinalを発行する。pointer ID `2`／`10`、duplicate、up後のID再利用をowner選択goldenへ固定し、decimal文字列順の`10 < 2`を拒否する。

effectは`capture | record-release-request | release-capture | clear-release-witness | start-drag | dispatch-tap | dispatch-drag | dispatch-viewport-transform | rebase-multi-pointer-owners | suppress-synthetic-click | clear-synthetic-click-guard | clear-registry | clear-timers`の重複なし順序付き列として固定し、各table rowへexact 1列を記録する。`dispatch-viewport-transform`は同一rowの正規化済みtranslation／scale／centroidだけを使い、viewport reducerの固定zoom上下限を1回適用する。tapを所有するCanvasでは後続`click`を同じpointer sequenceのone-shot guardでdispatch 0件にする。`SyntheticClickGuardV1`はexact `{ state: "awaiting-matching-click", sequenceOrdinal, canvasTargetInstanceId, sourcePointerId, sourcePointerType, sourceButton: 0, upClientCssPx: { x, y }, upEventTimeStampMs }`を持ち、全数値はfinite、ordinal／IDは非負safe integer、`-0`は`0`へcanonical化する。raw clickはrequired Chromiumで`PointerEvent`、`isTrusted = true`、`detail = 1`、`button = 0`、guardと同じmounted canvas target／pointer ID／pointer type、各client座標差が0.5 CSS px以下、`0 <= click.timeStamp - upEventTimeStampMs <= 1000`、registry empty、guard ordinalがlast completed sequence ordinalと一致する場合だけ`synthetic-click-matching`とする。keyboard activation（`detail = 0`／pointer ID `-1`）、別target、別button／type／ID、非finite／逆行／1000ms超過、同座標でも別sequenceは`synthetic-click-nonmatching`とする。matching clickは`suppress-synthetic-click, clear-synthetic-click-guard`、nonmatching clickはdispatchせずguard不変、次のprimary downではordinal更新前・capture前にguard clear、unexpected lostを含む全global cancel／unmountでもclearとする一方、expected lost／stale lostではclearしない。合法列`down → up(dispatch tap＋guard＋release witness) → expected lost(clear witness only) → matching click(suppress＋clear guard)`はtap exact 1回／click dispatch 0件とする。timer expiryは使わないためtransition domainへ隠れたtimer inputを追加しない。`idle`へ戻る全terminalはactive pointer registry、capture、timer、pending tap／drag／viewport transformが空であり、normal release直後だけrelease witness exact 1件、guardは`dispatch-tap`直後の`awaiting-matching-click`かemptyの直交exact unionを許す。expected lostはwitnessだけを0件にし、matching clickとの到着順が逆でもtapを再dispatchしない。次のpointer sequence開始前またはunmount後はguardも必ずemptyとし、property testは任意event列の後にglobal cancelまたはunmountを与えて全fieldが即時emptyへ収束することを検証する。

## 9. 実装フェーズとPR境界

本章の`FSMC-I0`～`FSMC-I11`はFull Split Map Cell初版固有の実装checkpointであり、リポジトリの正式release gateである`P0-RELEASE`～`P8-CLEAN`とは別物とする。文書、PR、issueでは`P0`等の省略名を使用しない。FSMC checkpoint自体を既存の`RELEASE_PHASE_GATES`へ追加せず、初版の全自動テストを既存release workflowの通常checkとして実行する。

各FSMC phaseは複数PRを許し、見積り上は全体で37～47論理PR、これとは別にHへ入るpre-I0準備2 commitとする。各PRはその時点で追加・変更したunit、integration、browser、schema、fixture、CI設定を同じPRに含め、FSMC-I11まで試験を延期しない。各PRはproductionでsplitを誤公開せず独立してmainへmerge・配布可能でなければならず、前phaseの自動Exit testが未達のまま次phaseを開始しない。外部証跡bundle、remote activation、実イベントpilotは作らない。`config/fsmc-traceability.json`は各requirementのexact 1 rowに`ownerPhase`、重複なし`fixtureIds`／`testIds`／`commands`／`profiles`、`status`、`enforcedFromPhase`、`releaseScope: "initial-release" | "future"`を持つ。配列はone-to-manyであり、同じtestが複数requirementを支援する場合は逆向き`requirementIds`に全IDを列挙する。各PRで初版対象だけを`planned`→`contract-enforced`→`implementation-enforced`へ更新する。後続版対象は`future`として初版gateの選択集合とplanned残存判定から除外し、初版requirement／PD／DoDを`future`へ分類して回避することをcross-verifierで拒否する。

PR見積りのauthorityは次表とし、範囲外へ増減する場合は依存、reviewer、Exit coverage、分割不能理由を同じ計画PRで更新する。pre-I0の2件はFSMC phase実装PRへ数えない。

| workstream | 論理PR数 | 主な境界                                              |
| ---------- | -------- | ----------------------------------------------------- |
| pre-I0     | 2 commit | hygiene修正、read-only observer／schema／runbook      |
| I0         | 9        | 下記`I0-01`～`I0-09`固定bundle                        |
| I1         | 2～3     | identity／geometry／index、visit／route pure contract |
| I2         | 4～5     | Vcap、CAS／fence、control、recovery                   |
| I3         | 2～3     | lifecycle、duplicate／delete／retention               |
| I4         | 4～5     | V2/V1、Worker、restore、handoff                       |
| I5         | 2～3     | definition／copy、retained UI                         |
| I6         | 2～3     | reimport、topology edit、atomic plan                  |
| I7         | 3～4     | migration、projection、共通reorder、writer接続        |
| I8         | 2        | normal map、DOM shell／a11y                           |
| I9         | 1～2     | focus mode、gesture parity                            |
| I10        | 3～4     | route DTO／polygon、connector／cache、hit-test        |
| I11        | 3～4     | production migration、全gate、release-ready           |

readiness、DB target、公開境界を次に固定する。

| phase／artifact               | build固定readiness | `databaseTargetMode`   | command／UI／DB状態                                                                                      |
| ----------------------------- | ------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| I0～I1 production             | `contracts-only`   | `core-current`         | DB5、capability code／store／public command／UIなし                                                      |
| I2～I10／I11作業中 production | `internal-testing` | `core-current`         | DB5、capability store open／create／write 0件、public handler未登録、UI非到達                            |
| I2～I10／I11作業中 QA         | `internal-testing` | `fsmc-vcap-qa`         | 隔離origin／profileだけVcap、QA harnessからcommand登録、effective ON時だけmutation commit可              |
| I11 release-ready production  | `release-ready`    | `fsmc-vcap-production` | productionで初めてVcap。既存scopeはmigration UIだけを先行公開し、ready後にswitch／preview／commandを登録 |

readinessはsourceに固定し、storage、query parameter、URL、remote responseから変更しない。QA overrideはnon-promotable QA artifactだけにcompileし、production bundle verifierがoverride symbol、command、query、storage keyの混入を拒否する。I5でUIを実装してもI11まではproduction navigationへ露出させない。release-ready公開時も端末全体OFF、既存event OFFを既定とし、durable rootが`migrating`ならmigration UIとV1退避以外へ到達させない。`ready`後に問題が起きた場合は端末全体OFFで`PD-04`のsplit固有部分のlegacy動作（release-readyで初めてproduction接続した`PD-14.C2`／`C3`、重複物理cellの新規after-image拒否、`map-data-untrusted`安全判定の常時修正を含む）へ戻す。

command capabilityは`commandCodePresent`、`publiclyRegistered`、`publiclyReachable`、`dispatchAuthorized`、`commitAllowed`を別fieldとしてmanifestへ記録する。pre-release productionでは内部codeが存在しても後4 fieldをfalseとし、router／dispatcherを直接呼んだ場合は`implementation-not-release-ready`、write 0件にする。non-promotable QAは許可readinessかつhealthyなQA root、release-ready productionはhealthyかつ`initialization = ready`の場合だけpreview／enable／disableを通常registryへ登録できる。production `migrating`はmigration-only、`missing`／`repair-required`はrecovery-onlyとし、通常controlを登録しない。ready後のpreviewとdisableはevent OFF中にも利用できるが通常split mutationはeffective ONの場合だけcommitできる。`recovery-required`では診断と6.1.1の明示復旧commandだけを別registryへ登録し、controlを含む通常commandは全てwrite 0件で拒否する。authority保守用legacy rebaseは利用者registryに入れず、recovery-requiredでは実行しない。

phase stateは省略記法をschemaへ持ち込まず、`completedThrough`を`"pre-I0" | "FSMC-I0" | "FSMC-I1" | "FSMC-I2" | "FSMC-I3" | "FSMC-I4" | "FSMC-I5" | "FSMC-I6" | "FSMC-I7" | "FSMC-I8" | "FSMC-I9" | "FSMC-I10"`、`currentPhase`を`"FSMC-I0" | "FSMC-I1" | "FSMC-I2" | "FSMC-I3" | "FSMC-I4" | "FSMC-I5" | "FSMC-I6" | "FSMC-I7" | "FSMC-I8" | "FSMC-I9" | "FSMC-I10" | "FSMC-I11"`、`phaseProgress`を`"in-progress" | "exit-candidate"`とするexact unionである。legal pairは`(pre-I0,I0)`、`(I0,I1)`、`(I1,I2)`、`(I2,I3)`、`(I3,I4)`、`(I4,I5)`、`(I5,I6)`、`(I6,I7)`、`(I7,I8)`、`(I8,I9)`、`(I9,I10)`、`(I10,I11)`だけで、各tuple内は`in-progress → exit-candidate`の一方向、current Exit成功後だけ次tupleの`in-progress`へ進める。`completedThrough = FSMC-I11`、`currentPhase = null`、`phaseProgress = complete`は初版schemaで禁止する。初版のterminal proofはI11 `exit-candidate`と同じ`ciRun`／source／production artifact／phase hashへ拘束された`fsmc-required-results.json`の再計算済み`status = "passed"`、かつ固定required context／job `fsmc-required-gate`の`success`であり、独立した第4状態や別result artifactを追加しない。将来phase追加時はschema versionを上げて新tupleを追加する。

readiness／DB modeのlegal組合せもexactに、I0／I1は両progressで`contracts-only`／`core-current`、I2～I10は両progressで`internal-testing`／production `core-current`、I11 `in-progress`は`internal-testing`／production `core-current`、I11 `exit-candidate`だけは`release-ready`／`fsmc-vcap-production`とする。同一phase内の複数PRは`in-progress`のまま進め、skip、逆行、複数authorityを禁止する。I11 final candidateはbuild前にrelease-readyへ変更して同じproduction artifactをI0～I11の全Exit testへ掛け、そのsource／artifact／run hashに一致するterminal proofが成功するまで配布不能とする。`config/fsmc-implementation-state.json`、build constant、artifact manifest、traceability、test manifestの組合せを各PRで相互検証し、artifact manifestの`databaseTargetMode`と実際にopenしたDB version／originが一致しない場合は失敗させる。

FSMCのCI job ID／status名はI0で`fsmc-required-gate`へ固定し、その後phaseやfindingに応じて追加・削除しない。現行`.github/workflows/quality.yml`は既存requiredの`quality` jobと`release-a-rollback` jobだけでFSMC終端aggregatorを持たないため、既存`quality`へFSMC gateを`needs`で逆接続する案は採用しない。`quality` jobをcanonical package qualityの独立した単一producerとして維持し、その成功result artifactをFSMC build／testがdownloadする一方向`quality → FSMC DAG → fsmc-required-gate`へ固定する。`config/fsmc-ci-gate.json`にowner `Repository Maintainer`、対象branch、固定context名、one-time setup手順、read-only確認commandを記録し、I0でjobを構築中はnon-required、I0 Exit候補の同一HEADでRepository Maintainerが`fsmc-required-gate`を一度required化し、branch protection／rulesetを再読してexact contextを証明するまでI0 Exitを失敗させる。既存`quality`もrequiredのまま外さず、その後の動的変更権限やfinding別contextは作らない。`quality`がFSMC gateを待つcycle、同一runで0回または複数回のfoundation quality producer、別run result流用をworkflow topology verifierで拒否する。

aggregatorはsource固定implementation stateからmodeを再計算する。`phaseProgress = in-progress`では`completedThrough`までの全Exitに加え、current phaseで既に`contract-enforced | implementation-enforced`となった`initial-release` test、production artifactのreadiness一致、早期公開経路なし、current-run WebKit safety artifactを検証するが、未完成のcurrent phase Exitは要求しない。`phaseProgress = exit-candidate`ではこれらにcurrent phaseの全Exitを加える。どちらも`releaseScope = future`のtestや`release-ready`を要求せず公開可能とは表示しない。唯一、I11の`exit-candidate`かつ`release-ready` candidateだけは同じjob内で`verify:fsmc:release-readiness`を実行し、I0～I11の全Exitと初版公開条件を要求する。modeの自己申告、workflow input、branch名、query／storageで分岐せず、state／artifact不一致、skip、選択test 0件を失敗させる。

### FSMC-I0着手前ゲート（phase外）

既存品質失敗はFSMC実装と混ぜず、専用pre-I0 hygiene commitで解消する。次のpre-I0準備commitで、production source／DB／runtime behaviorを変更せず`config/fsmc-pre-i0-observer-command-manifest.json`とschema、`scripts/fsmc/observe-pre-i0-prerequisites.mjs`、`scripts/fsmc/verify-pre-i0-prerequisites-result.mjs`、`docs/runbooks/fsmc-pre-i0-prerequisites.md`、対応npm scriptを先に作る。この準備自体はFSMC-I0ではなくH候補へ含め、observerをI0で初めて作る循環依存を禁止する。

責任境界は次表へ固定する。repository管理actionのresult／approvalにはrole名と担当者のstable repository loginを記録し、同一人物の兼務は許すがowner空欄と自己申告だけのapprovalは許さない。利用者本人になり得る`Local Recovery Operator`だけは個人識別子やrepository loginを収集せず、利用者確認のscope、confirmation digest、result、実行した管理側role／loginだけをreceiptへ記録する。

| role                         | authority／責任                                                          | 必須成果物                    |
| ---------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| `Plan/Architecture Owner`    | PD／RC／WBS、contract変更、I0開始可否                                    | plan decision、ADR approval   |
| `Source Hygiene Owner`       | H候補作成、detached hygiene、baseline range検査                          | hygiene result、H nomination  |
| `External Observer Operator` | allowlisted read-only observer実行、機密非保存                           | sanitized external result     |
| `Repository Maintainer`      | branch ruleset、required context、environment／package管理のone-time操作 | gate／policy verification     |
| `CI Operator`                | runner image、qualification、infrastructure-only rerun判定               | runner result、rerun approval |
| `Release Maintainer`         | I11 candidate、配布停止／再開、利用者通知                                | release／incident decision    |
| `Local Recovery Operator`    | 利用者確認済みBackup／reset scopeだけの復旧                              | recovery preview／receipt     |

pre-I0全体は「source hygiene」と「外部CI前提」の2 subgateからなる。source hygieneのcanonical runnerはH候補SHAを一度読み、同SHAのclean detached worktreeで固定Node 24.19.0／npm 11.19.0を確認して`npm ci`を実行した後、(1) 開始HEAD一致、(2) `git status --porcelain=v1 --untracked-files=all`が空、(3) worktreeの`git diff --check`成功、(4) manifest固定`baselineSourceSha..candidateHeadSha`の`git diff --check`成功、(5) package scriptの再帰展開graphをauthorityにした`npm run quality`成功、(6) 終了HEADが開始値と一致、(7) 終了statusが空、(8) 終了worktree `git diff --check`成功、(9) 同じbaseline rangeの終了`git diff --check`成功とcandidate tree SHA不変、の順で全て検証する。既存`node_modules`を再利用せず、skip、waiver、expected failure、既知失敗を許さない。結果JSONはrepo外の新規一時directoryだけへcreate-newで書き、candidate SHA／tree SHA、`checkedDiffRange`、toolchain、lockfile／script graph hash、各exit、開始／終了status digestを持つ。source hygieneと外部結果が同じ完全SHA／tree SHAを持つ場合だけ基準commit Hを確定し、そのSHAを`i0StartHeadSha`とする。Hの確定後は追更新せず、plan是正とbaseline cleanupを含む`baselineSourceSha..H`の全差分をinventoryへ収録する。どちらかのsubgateが失敗した状態では最初のI0変更を作らない。candidate、script、manifest、toolchainのいずれかを変えた再試行は新attempt IDで両subgateを最初から実行し、過去result、部分成功、同名outputを再利用しない。

`config/fsmc-pre-i0-baseline.json`とschemaはHには含めず、Hを親に持つ最初のI0 commitで作る。既知となった`i0StartHeadSha = H`、Hのtree SHA、`checkedDiffRange`、H上のpackage.json／lockfile SHA-256、Node／npm version、`qualityCommand: "npm run quality"`、quality script SHA、再帰展開した順序付き`qualityCommandGraph`、各script本文SHA、graph SHA、上記9段のexit codeと結果digestを固定する。したがって設定を含むcommit自身のSHAを同じ設定へ埋め込む自己参照は発生しない。`verify:fsmc:pre-i0-baseline`はrecorded Hの一時detached worktreeで同じrunnerとresult verifierを再実行する。本計画採択時に確認された既存`format:check`失敗を専用hygiene commitで解消し、Hを確定するまでFSMC-I0の実装変更を開始可能とは判定しない。

外部CI前提subgateもH候補のclean detached worktreeで実行する。observer toolはGitHub CLI version、API version `2022-11-28`、candidate HEAD／tree開始・終了値、observer manifest／script／verifier SHAを記録し、API methodを`GET`だけへallowlistする。全API呼出しへ`Accept: application/vnd.github+json`と`X-GitHub-Api-Version: 2022-11-28`を固定し、GraphQL／`gh repo view`を使わない。固定manifestは少なくとも`GET /user`、`GET /repos/{owner}/{repo}`、`GET /repos/{owner}/{repo}/actions/permissions`、`GET /repos/{owner}/{repo}/actions/permissions/workflow`、`GET /repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval`、`GET /repos/{owner}/{repo}/environments?per_page=100`、`GET /repos/{owner}/{repo}/branches/{branch}/protection`、`GET /repos/{owner}/{repo}/rulesets?includes_parents=true&per_page=100`、`GET /repos/{owner}/{repo}/rules/branches/{branch}`、`GET /repos/{owner}/{repo}/actions/secrets?per_page=100`、`GET /repos/{owner}/{repo}/actions/variables?per_page=100`、`GET /orgs/{org}/actions/permissions`、`GET /orgs/{org}/actions/permissions/workflow`、`GET /orgs/{org}/packages?package_type=container&per_page=100`をliteral path／queryとして列挙する。一覧childはtyped keyごとに`GET /repos/{owner}/{repo}/environments/{environment_name}`、`GET /repos/{owner}/{repo}/rulesets/{ruleset_id}`、`GET /orgs/{org}/packages/{package_type}/{package_name}`だけを許し、`environment_name | ruleset_id | package_name`を取り違えない。endpoint、query、header、選択field、期待statusは固定IDからだけ構築し、任意URL、mutation option、未宣言queryを受けない。

各endpoint resultは`present | absent-not-yet-required | forbidden | unobservable`のexact unionとする。追加response fieldはallowlisted projection前に捨て、必須選択fieldの欠落・型差だけをschema failureにする。401／403、pagination未完、開始／終了HEAD・tree・clean status差は常に失敗とする。404はmanifestがpre-I0で未作成environment／packageまたは未保護branchへ明示した場合だけ`absent-not-yet-required`、それ以外は失敗とし、認証不足をabsenceへ変換しない。raw response／header、Authorization、token、secret／variable値、自由記述command出力は保存せず、allowlisted projection、HTTP status、observer login／repository permission、checkedAt、endpoint result digestだけをrepo外の一時JSONへ出す。

pre-I0では未作成のenvironment／package／image digest自体を要求しない。`GET /repos/{owner}/{repo}`のprojection `permissions.admin === true`を`repositoryPermission = "admin"`へ正規化し、environment／organization policyのread-only観測と合わせて「作成可能性のproxy」と明示する。実際のenvironment／package作成・public化・repository link・anonymous pullはI0-exitで初めて実証する。read-only情報だけでproxyも証明できなければblockerとし、「作成権限を実行確認済み」と表記しない。成功結果はHを親に持つ最初のI0 commitで`config/fsmc-ci-prerequisites.json`とschemaへ、確認時点、`requiredAt: pre-I0 | I0-exit | release-ready`、非機密result digestと共にimportする。各stageは次の事実だけを要求し、後段で初めて作るartifactの未作成を前段失敗にしない。

H候補で利用者が実行する入口は次の3 commandだけとし、各scriptが上記の詳細command graphをmanifestから展開する。attempt ID付きoutput directoryはrepo外の新規directoryでなければ拒否し、各result fileはcreate-new、3 resultの`candidateHeadSha`／tree SHA／attempt IDをbyte一致させる。

```powershell
$fsmcCandidateHead = git rev-parse HEAD
$fsmcPreI0AttemptId = [guid]::NewGuid().ToString("N")
$fsmcPreI0ResultDirectory = Join-Path ([IO.Path]::GetTempPath()) "fsmc-pre-i0-$fsmcCandidateHead-$fsmcPreI0AttemptId"
New-Item -ItemType Directory -Path $fsmcPreI0ResultDirectory -ErrorAction Stop | Out-Null
npm run verify:fsmc:pre-i0-hygiene -- --candidate-head $fsmcCandidateHead --attempt-id $fsmcPreI0AttemptId --output (Join-Path $fsmcPreI0ResultDirectory "hygiene.json")
npm run observe:fsmc:pre-i0-prerequisites -- --candidate-head $fsmcCandidateHead --attempt-id $fsmcPreI0AttemptId --repository blusalice3-foundation/event-shopping-planner-routeplanning --output (Join-Path $fsmcPreI0ResultDirectory "external.json")
npm run verify:fsmc:pre-i0-prerequisites-result -- --attempt-id $fsmcPreI0AttemptId --hygiene (Join-Path $fsmcPreI0ResultDirectory "hygiene.json") --external (Join-Path $fsmcPreI0ResultDirectory "external.json")
```

| `requiredAt`    | 必須確認                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-I0`        | repository／default branch、repository admin role、既存environment／organization policy、repository visibility、Actions／GHCR availabilityから導くrequired-reviewer environment・GHCR package・public visibility・repository link・`fsmc-required-gate`直接required化の作成可能性proxy、必要permission名、secret／variableの存在名、fork PR token方針。I0で作るenvironment、Dockerfile、publisher workflow、package、digestの実在や作成実行済みは要求しない          |
| `I0-exit`       | repo-owned runner Dockerfile、下記exact path／job／triggerのpublisher、OCI source labelでrepository link済みのpublic GHCR package、publisherだけの`contents: read`／`packages: write`、通常required workflowは`contents: read`かつpackage permission／credentialなし、untrusted PRへのwrite token／secret 0件、publishしたexact OCI digestの匿名pull、consumer jobのliteral `container.options`、runner qualification、固定`fsmc-required-gate`とbranch gateの実接続 |
| `release-ready` | I0 Exitと同じexact digestをproduction artifactが参照し、publisher permission、consumerのpackage permission／credential不在、package visibility／repository link、fork policy、required context、runner qualificationにdriftがないことをcurrent runで再確認                                                                                                                                                                                                           |

repository admin／policy／visibilityから必要な作成可能性proxyを導けない、Actions／GHCRを観測できない、または`fsmc-required-gate`直接required化のone-time権限proxyを証明できない場合はpre-I0 blockerとし、I0内の実装で迂回しない。pre-I0ではenvironment／package作成不能をread-only観測だけから断定しない。`config/fsmc-ci-prerequisites-result.schema.json`はcurrent stage以前の各resultを必須、未来stageを`not-yet-required`とし、未来artifactの欠落を`failed`へ数えない。stage到達後の`unobservable | forbidden`、必須事実の欠落は非0終了とする。

I0が作るpublisherの唯一のpathは`.github/workflows/fsmc-performance-runner-publish.yml`、workflow `name`は`fsmc-performance-runner-publish`、job IDは`publish-fsmc-performance-runner`、triggerは`workflow_dispatch`だけとする。jobは`github.ref == refs/heads/<recorded-default-branch>`をguardし、required reviewer付きenvironment `fsmc-performance-runner-publish`を使う。`infra/fsmc-perf-runner/Dockerfile`は`org.opencontainers.image.source=https://github.com/blusalice3-foundation/event-shopping-planner-routeplanning`をexact OCI labelとして持つ。image URIは`ghcr.io/blusalice3-foundation/event-shopping-planner-routeplanning-fsmc-perf-runner`、package visibilityは`public`とし、publisher後observerがlabel、linked repository、visibility、digestをGitHub API／manifestから再計算する。moving tagをconsumerへ渡さない。public imageなのでconsumerの`packages` permission、`container.credentials`、pull secretを禁止する。consumerは`.github/workflows/quality.yml`のjob ID `fsmc-performance-shard`だけとし、`permissions: { contents: read }`、`container.image`を同URI＋`@sha256:<digest>`、`container.options`をI0でqualificationした非placeholderの`--cpus`、`--memory`、`--memory-swap`、`--pids-limit` literalへ固定する。workflow literal、`config/fsmc-performance-runner.json`、実cgroup観測の3者差をinfrastructure failureにする。

### FSMC-I0: 契約・fixture・基準値

- performance capacity evidenceは`qualification-only | product | not-required`のexact unionとする。I0 qualificationは12 intervalと最大54 product-shard宣言、I2以降productは実planの1～54 shard宣言を持つ。I1 `not-required`だけは`jobIntervals=[]`、`declaredShardExpectedMinutes=[]`、`observedMaxConcurrentJobs=null`、`queueExcludedQualificationMinutes=null`、`projectedFiveWaveMinutes=null`を必須にし、空runner集合を成功productへ偽装しない
- 各`declaredShardExpectedMinutes.expectedMinutes`はconfigの自己申告値ではなく、同じplan内の`setupExpectedMs + calibrationExpectedMs + Σ(warmupRuns × scenarioExpectedMs) + Σ(measuredRuns × (scenarioExpectedMs + cleanupExpectedMs))`をshard keyごとに整数millisecondで加算し、最後に`ceil(totalMs / 60000)`した値とする。`setupExpectedMs`はActions job `started_at`からcheckout／container ready、deadline ledger、`npm ci`、artifact取得／検証、preproduct upload、browser install、runner envelopeまでを含み、calibrationを二重計上しない。全component合計はabsolute product deadlineの300分以下、hard timeoutはreporter予約を含む330分exactとする。expected componentはI0 runner qualification result SHAへ拘束された非負整数、OFF pairはreference→targetの両componentを固定順で合算する。component、qualification result、key集合、runner digestの変更時は全expected minutesと12-lane projectionを再導出し、手入力上書きや実行後durationによる合格化を禁止する
- performance plan／shard／reduced schemaは`foundationQualityResultSha256`、`sourceSha`、`productionArtifactTreeSha256`、`productionBuildManifestSha256`、条件付きの`qaArtifactTreeSha256`／`qaBuildManifestSha256`をexact名で持つ。QA pairは対象phaseなら両方non-null、非対象なら両方nullとし、全hashをcurrent `ciRun`のdownload済みmanifestへ再計算一致させる。shard resultはさらにplan／budget／runner／OCI／browser／catalog／traceability／test manifest／topology hash、expected／executed key、calibration、warmup、30 measured sample、runner-result SHAを持ち、曖昧な`artifactSha`へ縮退させない
- qualification／product reduced resultは`jobIntervals: [{ jobId, startedAtEpochMs, completedAtEpochMs }]`、`observedMaxConcurrentJobs`、`queueExcludedQualificationMinutes`、`declaredShardExpectedMinutes: [{ shardId, expectedMinutes }]`、`projectedFiveWaveMinutes`を必須にする。interval authorityはreducerだけが`actions: read`で取得するAPI version `2022-11-28`のpaginated read-only `GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs?per_page=100&page=<n>` projectionとし、current run／attempt、workflow topology hash、matrix job name／shard IDをexact一致させる。APIの`started_at`／`completed_at` RFC 3339を厳密parseしてUTC safe-integer epoch millisecondへ正規化し、source文字列に小数秒3桁があるとは仮定しない。欠落／null／parse不能、別attempt、pagination未完、重複job／shard、API以外のrunner自己時計を拒否する。`startedAtEpochMs <= completedAtEpochMs`、稼働区間はhalf-open `[startedAtEpochMs, completedAtEpochMs)`とし、同時刻eventはendをstartより先に処理したprefix最大値をobserved concurrencyとする。queue時刻は取得・自己申告せず、`queueExcludedQualificationMinutes`は稼働区間unionのmillisecond長だけを合算して最後に`ceil(ms / 60000)`する。branch内の宣言数`N`はqualificationの対象product planまたはI2以降の実planにある1～54件とexact一致させ、canonical shard ID順のindex `i`をlane `i mod 12`へ割り当てる。各laneの宣言expected minutes合計の最大を`projectedFiveWaveMinutes`として再計算し、lane件数は`ceil(N / 12)`以下かつ最大5とする。qualificationはexact 12 interval、observed concurrency 12以上、queue除外qualificationとprojected値は各360分以下、productはexact N intervalとprojected値360分以下を必須にする。I1 `not-required`は前項どおりN=0のempty／null branchであり、この式へ54件を捏造しない
- 各performance shardのfirst executable stepはdependency-free supervisorを起動し、Actions run-attempt jobs APIのcurrent matrix job `started_at`を唯一の`jobStartedAtEpochMs`へ正規化する。create-new `performance-shard-job-deadline` artifactは`jobStartedAtEpochMs`、`productDeadlineEpochMs = jobStartedAtEpochMs + 300 * 60_000`、`hardDeadlineEpochMs = jobStartedAtEpochMs + 330 * 60_000`、run／attempt／job ID／shard ID／sourceを持ち、upload成功後だけ`npm ci`以降へ進む。supervisorは`npm ci`、artifact download／verify、browser、runner、calibration、製品processの全child process groupを監視し、started時刻から300分を加算し直さずabsolute product deadlineでactive childを終了して後続product stepを禁止する。foundation／plan／production／必要時QA artifactの全hash検証後、browser installより前にcurrent-run `preproduct` lifecycle snapshotをcreate-newしてuploadする。browser／runner envelope／calibration成功後は`started` snapshotへdeadline artifact digest、`preproductCompletedAtEpochMs`、`remainingProductBudgetMs = max(0, productDeadlineEpochMs - preproductCompletedAtEpochMs)`を記録してcreate-new uploadし、そのupload成功かつremaining正値を製品process spawnの必須先行条件にする。独立artifact class `performance-shard-ledger-preproduct | performance-shard-ledger-started | performance-shard-ledger-terminal`は同じdeadline digest、shard／source／run／attempt／plan／artifact hash、UTC millisecond時刻、直前snapshot digestを持ち、上書きや逆行を拒否する。合法系列は`preproduct(productState="not-started") → terminal(productState="not-started", terminalOutcome="preproduct-failed")`、または`preproduct → started(productState="started") → terminal(productState="completed" | "watchdog-terminated")`だけとし、started不在のproduct完了、started後のnot-started terminal、terminal後の追加snapshotを拒否する。absolute 300分deadlineでsupervisorが終了した後、330分hard deadlineまでの予約枠で独立した`if: always()` reporterがterminal snapshotとresultをuploadする。deadline到達前にreporterへ移れない、hard timeout、deadline／ledger／result欠落は常に`failed`であり、started後のdeadline超過、強制終了、watchdog termination、budget超過を`infrastructure-failed`へ変換しない。`preproduct` snapshot取得済み、`started` snapshotなし、sample 0件、always reporterのschema-valid resultが揃い、固定allowlist `browser-install-unavailable | runner-envelope-verification-failed | calibration-runner-envelope-failed`の機械証跡が一致する場合だけinfrastructure候補とする。runner provisioning／container pull／checkout、deadline artifact upload前、`npm ci`／artifact downloadのように`preproduct` snapshotより前に失敗する場合はfail-closedなnon-rerunnable `failed`とする。setup 29／30／31分と299分／300分／300分+1ms、started時刻を後ろへずらす改ざん、watchdog／hard-timeout同着raceをfake-clock fixtureへ固定し、どの場合もproduct deadlineをjob開始+300分、reporter hard deadlineをjob開始+330分から動かさない
- shardのdeadline step IDは`fsmc-performance-job-deadline`、preproductの3 workflow step IDは`fsmc-performance-browser-install`、`fsmc-performance-runner-envelope`、`fsmc-performance-calibration`へ固定し、各stepは順番にexact 1回、`continue-on-error: false`で動く。topology verifierはdeadline stepをjobのfirst executable stepかつdependency-free standard command／pinned artifact upload、browser stepをliteral `npx playwright install --with-deps chromium`、runner／calibrationを下記standard commandへ一致させる。always reporterはworkflow runtimeの各`steps.<id>.outcome`、固定command hash、deadline／preproduct snapshot、runner／calibrationのbounded typed receiptからfailure codeを再計算する。deadline失敗／欠落はallowlist外failed、browserだけ`failure`で後続`skipped`ならbrowser code、browser `success`＋runner `failure`＋calibration `skipped`ならrunner code、前2件`success`＋calibration `failure`ならcalibration codeだけを許す。複数failure、`cancelled | timed_out | unknown`、先行success不成立、必要receipt欠落、step ID／command差はallowlistへ写さず`failed`にする。started snapshotはdeadline＋3 outcome全て`success`かつreceipt検証後だけ作れる
- `config/fsmc-performance-rerun-approval.schema.json`はversion 1の`FsmcPerformanceRerunApprovalV1`を所有し、`sourceSha`、同じ`runId`、`priorRunAttempt = 1`、`approvedRunAttempt = 2`、`rerunMode = "all-jobs"`、workflow topology hash、prior reduced／required-results／WebKit safety observation／WebKit promotion result／prior required-gate result SHA-256、canonical nonempty failed shard ID、上記3-codeとevidence digestのexact bijection、prior WebKit observation `passed`、promotion `not-required | passed`、非performance required-results全class pass、prior gate canonical failure reason exact `performance-infrastructure-only`、CI Operator roster SHA-256、workflow runtimeの`triggeringActor`／`triggeredAt`、自身を除くdomain-separated `approvalDigest`を必須にする。別schemaのcurrent-attempt artifact `FsmcPerformanceRerunApprovalResultV1`は、attempt 1の`{ status: "not-required", approval: null, approvalDigest: null }`、attempt 2の`{ status: "approved", approval, approvalDigest }`、またはattempt 2検証失敗の`{ status: "rejected", canonicalReasons, approval: null, approvalDigest: null }`だけを許し、attempt 3以上をschema rejectにする。固定job ID `performance-rerun-preflight`が全attemptで`if: always()`実行され、attempt 1はcurrent artifactをcreate-new、attempt 2だけはexact prior-attempt名のperformance reduced result／required-results／WebKit safety observation／WebKit promotion result／required-gate resultをdownload／実bytes再hashし、GitHub Actions `Re-run all jobs` runtime metadata、current attempt topology、version付きCI Operator rosterと合わせてapprovalをfinalize／verify／uploadする。artifact名は`fsmc-performance-rerun-approval-run-<runId>-attempt-<runAttempt>`とし、同名0／複数を拒否する。actorがrosterのCI Operator、source／run同一、attemptが連続、prior classificationがallowlisted performance infrastructureだけ、prior failed shard／code／evidenceがexact bijection、required-resultsのfoundation／build／functional／CI prerequisite等の非performance classが全pass、WebKit observationが`passed`、promotionが`not-required | passed`かつ両artifactのfailed／safety／infrastructure reason 0件、prior gateのschema-valid canonical failure reason集合がexact `performance-infrastructure-only`の場合だけapprovedとする。これらのSHA、status、空reason集合、gate reasonをapproval payloadと自身を除く`approvalDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-performance-rerun-approval-v1", approvalWithoutDigest })))`へ含める。partial／failed-jobs／matrix rerun、attempt 3、別source／run、actor不明、product／functional／quality／prerequisite failure、WebKit safety failure／infrastructure failure、promotion failure、prior gateの複合／未知reason混入はtyped rejectedでgateを閉じる。job permissionは`actions: read, contents: read`だけとし、topology verifierは`performance-rerun-preflight → performance-plan → all performance shards → reducer → required-results-finalizer → fsmc-required-gate`の一方向needsとstandard commandを固定する。performance plan／reduced result／required-results／gateはcurrent approval result bytesをdownload／verifyし、attempt 1はnull、attempt 2は同じnon-null approval digestへ一致させる。partial rerunでcurrent artifactがない場合もprior artifactで補完せずfail-closedにし、自己申告actorや自由文承認をauthorityにしない
- `config/fsmc-required-gate-result.schema.json`はversion 1の`FsmcRequiredGateResultV1`を所有し、`ciRun`、source SHA、phase state／readiness、required-results／WebKit safety observation／WebKit promotion／performance rerun approval resultの実bytes SHA-256、workflow topology hash、`status: "passed" | "failed"`、version付き`FSMC_REQUIRED_GATE_FAILURE_REASON_ORDER_V1`順のcanonical failure reasons、`resultDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-required-gate-result-v1", resultWithoutDigest })))`をexactに持つ。reason enumは少なくともfoundation／build／functional／performance-product／CI-prerequisite／WebKit-safety／WebKit-infrastructure／promotion／required-results／rerun-approval／phase-state／artifact欠落を区別する。全inputを再計算してreason 0件だけをpassed、1件以上をfailedとし、performance reducedの開始前3-code infrastructureだけが失敗し他の全inputがpassの場合は唯一のspecial reason exact `performance-infrastructure-only`とする。このreasonは他reasonと共存できず、product timeout／budget／sample failure、WebKitまたは非performance failureを混入できない。gate jobの独立`if: always()` reporterは通常verifierの成否にかかわらずcurrent attempt名`fsmc-required-gate-result-run-<runId>-attempt-<runAttempt>`でcreate-new finalize→verify→uploadし、最後のstatus enforcerだけがverified resultからjob check成功／失敗を決める。欠落／複数／別attempt、reporter起動前失敗、自己申告job outcomeでartifactを省略せず、attempt 2 preflightはattempt 1のsole実bytesを再hashする。
- functional、performance plan／ledger／shard／reduced、WebKit observation／promotion、required-resultsの全result schemaは同じ`foundationQualityResultSha256`を必須にし、各consumerがdownloadしたcurrent attemptのsole foundation artifact bytesへ再hash一致させる。field欠落、自己申告hash、別attempt foundation、consumer内での`npm run quality`再実行を拒否する
  I0は次の9 WBS bundleを依存順に実装する。`config/fsmc-i0-wbs.json`は各I0実装bullet／Exitにexact 1 `primaryBundleId`、0件以上のcanonical `dependsOnBundleIds`、review owner、artifact、verification command、production禁止edgeを持たせ、未割当て、複数primary、循環、依存未達、bundle test 0件を拒否する。複数bundleを同じ物理PRへまとめてもこの境界と個別checkを失わない。

| bundle                            | 依存         | 主成果物                                                                                                                                                                          | primary closure       |
| --------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `I0-01` baseline／inventory       | pre-I0 H     | implementation state、pre-I0 result import、source／toolchain／change-surface inventory                                                                                           | I0-002～004           |
| `I0-02` domain contract           | I0-01        | 番号、物理slot／論理location、局所exclusion、route polygon、picker／pointer schema・fixture                                                                                       | I0-005、009、013      |
| `I0-03` persistence contract      | I0-01        | Vcap provenance、DB open、CAS／fence、control、recovery schema・fixture                                                                                                           | I0-005、010           |
| `I0-04` durable／reorder contract | I0-02、I0-03 | event authority、Focus migration、execution reorder／atomic transition schema・fixture                                                                                            | I0-005、013           |
| `I0-05` backup contract           | I0-02～04    | V2 pair／V2-only total matrix、V1 compatibility、Worker／URL／resource limit                                                                                                      | I0-005、007           |
| `I0-06` fixed-A／policy           | I0-01、I0-05 | fixed legacy A、membership／coverage／architecture／dependency policy                                                                                                             | I0-001、007、010      |
| `I0-07` browser／safety           | I0-02、I0-06 | Chromium／WebKit config、a11y oracle、positive `npx playwright install --with-deps chromium --dry-run` required CLI contractと旧形式negative argument forwarding、safety register | I0-001、005、006、009 |
| `I0-08` performance／external     | I0-01、I0-02 | runner image、publisher、capacity／wall-clock plan、54-shard reducer、I0-exit observer                                                                                            | I0-008、011           |
| `I0-09` traceability／gate        | I0-01～08    | catalog、traceability、test manifest、result finalizer、acyclic required gate                                                                                                     | I0-001～013           |

実装:

- 仕様ADRとversion付きJSON Schemaを作成し、bounded番号grammar、`C(S)`衝突pair集合、mapped／mapless／legacy-unresolved identity、active／retained entry、map／entry／pathfinding graph fingerprint、settings／control root、authority別の型と配列へ分離したfull observed root＋checkpoint＋物理location付きIDB／external recovery candidate観測、全`FSMC_GOVERNED_ROOTS_V1`のroot policy、全非fence rootのlossless candidate vector付きhistorical evidence、その全行digest、participant digest、全root baselineを持つexternal fence protocol、retention clock、座標変換、picker順、Backup V1／V2をexact fixtureで固定する
- Backup hall group codecはowner別の全reachable `(hallRef | null, priority)`についてleft-inverseとraw token injectivityをI0 pure oracleへ固定する。reserved `undefined` 3形、suffix付き実hall ID単独、`A`＋`A:priority`、`A`＋`A:highest`のaliasを`hall-group-token-noninjection`へ写し、current map＋deleted blockをhistorical block→current map parent unionで表すwire fixtureと併せて、V2／pair生成0件またはlossless round-tripを決定的に検証する
- Focus migration契約は、event名だけのraw-day preflight／collision witness、collision-free後だけの`EventAuthorityProposalResultV1`、anchor action、proposalまたはpersisted associationから作る`ResolvedEventAuthorityV1`の`entries | rejectedEvents` exact partition、bootstrap／persistedを分ける`DurableVisitEventAuthoritySourceWitnessV1`、event-local durable quarantine／retired partition、scope derivation、mapped／absent／unmapped recordと各digest、issuance付きfreeze tokenの`active → invalidated | consumed` ledger、`event | profile-repair` operation scope、rename／delete／prune／raw-day-rekey transition、lease digestと`active → completed | aborted` one-shot ledger、3 counterをschema／pure fixtureへ固定する。raw-day collision時はID allocator／proposal 0件、anchor invalid／duplicate tokenは全該当eventのcanonical reason集合と全participantを一つの`event-authority-adoption-blocked`へ写し、ID／token allocator unavailable・3回衝突は`event-authority-proposal-failed`へ写す。invalid単独、duplicate単独、別event群での両者併発をterminal fixture、同一eventのinvalid＋duplicate複合rowをschema／semantic rejectとし、reason順shuffle／重複、witness／digest差、bootstrap proposal digestをpersisted authority input digestへ代用する入力を拒否する。persisted loaderではassociation missing／extra、anchor missing／invalid／mismatch／duplicateの全該当reasonをevent-local canonical集合、event名／ID重複、unknown extra、record破損、revision staleの全該当reasonをglobal canonical集合にし、unaffected eventのdurable `ready`継続とrejected entry byte保持をfixture化する。root parse不能、parse後semantic不正、trusted-localizableの3 repair evidence branch、root-untrusted＋counter exhaustion併発、reason availability、全witness digest式を固定する。token／lease ledgerはexact 1 active rowだけを受理し、二重finalize、旧lease／token replay、scope／generation／transition／digest不一致、各counter境界を拒否する。raw-day repairはexternal candidate retirement、absence E0／E1／E2、total／injective mapping、closed replacement、全day-scoped source集合のalias group間exact partition、present sourceとassignmentのexact partition、day-scoped＋event-wide hall全体のglobal target injectivity、source-specific／event-wide hall choice、map request↔choice exact bijection、6-store closure、Focus source／target CASを固定する。複数event同relative keyのpositive、同event cross-group source重複、2 rename→1 target、hall容量不足、day／event-wide target衝突、zero-member execution partitionをfixture化する。`distinctNormalizedDayScopeCount`、`executionBucketCount`、`hallDefinitionSlotCount`、`hallRouteSlotCount`は各決定式から再計算し、hall entry／list／item-reference count、execution referenceとその他の保存field countを維持する。partial domain、many-to-one、domain外occupied target、source／map request欠落・余分・候補外choice、partial map rename、physical drop／copy、Focus ABA、external staleをnegative fixtureにし、commit後E2出現だけは修復済みIDBを維持したblocked、それ以外の全拒否caseはregistry／UI／DB／token／default／loss preview 0件までI0 oracleへ含める
- `core-current`のDBなし／健全なcore-only profile、Vcap targetのDBなしresolved／collision／split traceあり、capability storeだけ／空store／5 payload rootまたはfenceの各単独・部分集合／metadataだけ／checkpointだけ／candidateだけ、採択済み`Vcap`以上の完全初期6 capability rootあり／storeなし／各root欠落／participant・root universe・baseline不一致、supported上限超過、versionchange commit前後終了のfixtureとdecision tableを作る。`FsmcDatabasePresenceObservationV1`、nullのtarget-mode別決定表、non-creating absence witness、probe transaction settle／close、exact 1 upgrade request、`onblocked` progress、same-request resume、error／abort exact-one terminal、`oldVersion = 0`、success connection handoff／reopen 0件をschemaとfixtureへ固定する。provenanceから採択された`Vcap`の排他性、rootへ閉じたintroduction witness、`db-version` witness一致、外部`E0/E1`、全core／candidate selectorの`H0/H1` byte-exact CAS、legacy row=`H1`、new capability payload／anchor row＝factory canonical after-image、fence＝baseline only、existing／fresh profile別actual participant集合をschema verifierで固定する。`durable-visit-state`単独欠落・metadata欠落・checkpoint欠落、旧tab race、blocked中の旧tab write、probe自己block、導入前absent capability rowをhistorical rowへ誤保存、bridge E0/E1第三値、lone surrogate差、participantとactual write不一致のnegative fixtureを含め、いずれかを証明できなければI2を停止する
- `config/fsmc-capability-adoption.json`を、共通field `schemaVersion`、decision ID、baseline／legacy A source SHA、`coreDbVersion`、`supportedMaximumDbVersion`、reserved purpose、decision input／legacy manifest／provenance manifest SHA、fixture／test IDを持ち、`{ outcome: "adopt-vcap"; capabilityDbVersion; conflictEvidence: [] } | { outcome: "alternative-witness-required"; rejectedCandidateVersion; conflictEvidence: [VcapConflictV1, ...VcapConflictV1[]] }`のexact unionとして作る。adopt側の`capabilityDbVersion`はsafe integerかつ`coreDbVersion < capabilityDbVersion <= supportedMaximumDbVersion`を必須とし、現行5／supported上限7では候補集合を6または7へ限定する。source constant、全remote-tracking history／tag、authoritative release・artifact ledger、同名DB store inventory、fixture resultからverifierが全fieldとoutcomeを再計算し、時刻、自由記述、手入力pass、branch名だけの否定証拠を含めない。distributed／unknown conflictが残る候補のadopt、範囲外候補、入力hash／fixture集合driftを失敗させ、`adopt-vcap`を証明できなければI0 ExitとI2開始を閉じて代替ADRを要求する
- supported range内で`dbVersion >= Vcap` iff exact 1件の値一致`db-version` witness、`dbVersion === null || dbVersion < Vcap` iff witness 0件をschema／fixtureへ固定する。`dbVersion > supportedMaximumVersion`は3 capability snapshotのreasonへ流用せず、`unsupported-database-version`、connection close、authority非採用、write 0件を検証する。現行fixtureのDB8はこの上限超過分岐から導出する
- `config/fsmc-governed-roots.json`へ全root tupleと`capability-owned | legacy-mutable-core | legacy-shadow-bridged | fence`のexact policyを重複なく固定し、5 payload root、fence、config hash、物理内容witnessとabsorption projectionを含むlossless candidate vector付きtotal historical evidence、全historical row digest、actual write集合と一致するparticipant roots／digest、完全external baselineをschemaで拘束する。pure legacy classifier、event-settings bridge classifier、内部rebase／reconcile commandの優先順、lock scope、after-image validator、原子性、制御状態非依存のauthority保守条件をcontract fixtureへ固定する。固定旧版Aによるcore／shadow変更、candidate content-only差、吸収、snapshot時empty storeへの追加、非参加row改変、capability root変更、fence自己不整合、bridge第三値、existing／fresh bootstrap participant mismatchを別fixtureにし、healthy差と破損を同じ期待値にしない。transaction内でWebCrypto Promise、別transaction、別async taskを待たず、pre-transaction bytesとの同期exact比較後にfirst writeへ進むことをarchitecture testで強制する
- `config/fsmc-legacy-candidate-transitions.json`と`config/fsmc-legacy-event-settings-transitions.json`へ固定旧版Aの全candidate／shadow writer・cleanup path、transition ID、root policy、authority、物理selector、old／new canonical shape、parser結果、必須root／checkpoint関係をwildcardなしで固定する。manifestのexact 1 transitionだけをrebase／reconcileし、0件／複数一致・projection-only改変をrecovery-requiredとする。各commandの`logicalRootMutationTuples`、`committedParticipantRoots`、置換historical row、participant digest対象集合のexact一致、`administrativeFencePhysicalWrites`とfence manifestの一致、非参加row byte同値をschema／fixtureへ固定する
- `config/fsmc-event-metadata-writers.json`へ全writerと旧版A／新版Bのanchor方針を列挙し、source switch、bulk add、item-only／full import、V1／V2 restore、XLSX、改名、複製、削除・同名再作成を漏れ検出するarchitecture testを作る
- metadata／anchorのexact change-surfaceとして`src/types/item.ts::EventMetadata`、`src/features/events/updateFlow.ts::applyPendingEventUpdate`、`src/features/events/bulkAdd.ts::buildBulkAddEventMetadata`、`src/app/commands/useShoppingItemMutationCommands.ts`の該当caller、`src/features/events/backupRestore.ts::buildEventRestoreData`、`src/features/events/fileImport.ts::buildXlsxEventRestoreSource`、`src/xlsx/engine/eventWorkbookEngine.ts::{exportToXlsx,importFromXlsx}`、`src/persistence/repositories/applicationSnapshotOps.ts::{removeEventFromApplicationSnapshot,renameEventInApplicationSnapshot}`をmanifestへexact登録する。各symbolについてanchorのcreate／preserve／remap／remove、aggregate metadata after-image digest、durable event basis、associationを同一commandでどう扱うかをcompletion assertionにし、未登録writerまたはdirect caller増加を失敗させる
- DB bootstrap／versionchange ownerは`src/persistence/db/constants.ts::{DB_VERSION,MAX_FORWARD_COMPATIBLE_DB_VERSION,STORES}`と`src/persistence/db/openDatabase.ts::{createMissingStores,requestDatabaseOpen,openDatabase}`をexact登録する。planned target-mode factory、presence probe、request ordinal／connection handoffをこれらへ対応付け、I2～I10 productionの`DB_VERSION = 5`、I11 release-readyだけの`DB_VERSION = Vcap`、QA namespace以外からの`createMissingStores`到達0件をarchitecture assertionにする
- legacy external core materialization／retirement面は`src/persistence/migration/legacyMigration.ts::{LEGACY_MIGRATION_TARGETS,captureLegacySourceStates,runLegacyPersistenceSourceCleanup,migrateFromLocalStorage}`、migration archive owner、`src/hooks/useIndexedDbPersistence.ts::useIndexedDbPersistence`、localStorage exact-key remove helperと、planned `LEGACY_SYNC_QUEUE_LOCAL_STORAGE_KEY`／`captureLegacySyncQueueSourceV1`／`prepareLegacyExternalSourcesAtCurrentVersionV1`／`materializeLegacyCoreAtCurrentVersionV1`／`createLegacyMigrationArchiveV2`／`assertPreservedLegacySyncQueueUnchangedV1`／`LegacyExternalCoreRetirementPortV1`／`LegacyPostRepairExternalCoreRetirementPortV1`、`STORES.SYNC_QUEUE`のmaterialization receipt／repair receipt／archive／retirement journal／operation fence ownerをexact登録する。pre-open dispositionを10 core candidate present、core 0件＋standalone `syncQueue` present、両方absentのexact 3分岐へ固定し、core branchは全10 core store＋receipt、queue-only branchはcore payload／`syncQueue/data`／capability 0 writeのbyte-exact archive、true fresh branchはnon-creating observationとする。各commit後はconnection close→fresh FSMC attempt、trusted V1確認後はreceipt／journal拘束の10 core selector retirement→新open、repair後のexact original vector再出現はrepair receipt chain拘束のpost-repair retirement→新openとする。standalone `syncQueue`はparse／core採用／retirement selector化／削除をせず、archive witnessとのbyte一致だけを検証する。materialization／archive中`Vcap`／capability／proposal write 0件、commit前／後crash、retirement途中resume／selector完了後検証blocked、raw repair E0／E1／E2とoperation fenceをcompletion assertionにする。generic `readRuntimeCandidateSnapshots`／fence cleanupとretirement inventoryを混同せず、sourceを残す現行cleanup、receiptなし／journalなし削除、manifest外localStorage removeを許可edgeにしない
- `mapData`の物理面は`src/persistence/db/constants.ts::{MAP_DATA_KEY_PREFIX,MAP_DATA_LEGACY_KEY}`と`src/persistence/repositories/mapRepository.ts::{getMapDataEntryKey,parseMapDataEntryKey,readMapEntriesFromStore,materializeMapData,buildMapDataPuts,assertCurrentMapMatchesExpected}`をexact登録する。`mapData:${JSON.stringify([eventName, dayMapName])}` split row、legacy `data` row、同値／不一致併存、known-key cleanup、6-store logical closureをfixture化し、materialized objectだけをCAS authorityにするedgeを0件にする
- hall／day aliasのprivate surfaceは`src/types/map.ts::MAPLESS_HALL_KEY`、`src/features/map/domain/normalizeHydratedHallState.ts::{normalizeHallDefinitions,normalizeHallRouteSettings,normalizeHydratedHallState}`、`src/features/map/hooks/useMapSelectors.ts::{toHalfWidthDigits,normalizeMapDayToken}`、`src/utils/indexedDB.ts`のcompatibility re-exportをexact登録する。private helperはplanned inventory上のAST anchorとして追跡し、canonical day adapterへの置換前後でdirect caller数、unscoped／embedded mapless absorption、repair成功後normalizer no-opを検証する
- `config/fsmc-change-surface.json`へbaseline SHAと、各entryの`path`、`symbol`、`layer`、`baselineDirectCallerCount`、`ownerPhase`、`targetApi`、`completionAssertion`を固定する。少なくとも番号parser全caller、`NavigatorItem`／旧visit identity、`MapView`、`MapVisitListPanel`、`FocusModeContainer`／`FocusMode`、item／map／hall mutation commands、event itemOps、map import flow／overlay、Backup command／overlay、pathfinding／route point／hit-test／render／cacheを含める。Focus capture面は`src/types/focus.ts::FocusModeSessionState`、`src/components/focus/hooks/useFocusSessionState.ts::useFocusSessionState`、`src/components/FocusMode.tsx::onSessionStateChange`、`src/features/map/components/FocusModeContainer.tsx`、`src/App.tsx::handleFocusSessionStateChange`とinvalid-key prune effect、`src/app/state/useAppUiState.ts::focusModeSessions`、`src/app/selectors/appMapViewSelectors.ts::buildFocusSessionKey`／`selectCurrentFocusSession`／`selectValidFocusSessionKeys`、`src/app/commands/useEventLifecycleCommands.ts::confirmRename`／`renameFocusModeSessionKeys`／`deleteEvent`／`removeFocusModeSessionByEvent`をexact登録し、planned `src/features/map-cell-split/visits/LegacyFocusSessionFreezePort.ts`／`legacyFocusSessionRegistry.ts`へI7 QA、I11 productionのowner phaseを分ける。patch-only保存は`src/app/commands/ApplicationSnapshotCommitPort.ts`と5 caller file／10 call site、すなわち`src/App.tsx`、`src/app/commands/useMapEditorCommands.ts`、`src/app/commands/useShoppingItemMutationCommands.ts`、`src/app/commands/useMapImportCommands.ts`、`src/features/map/domain/mapImportFlow.ts`をexact登録し、importなしの構造的callback再宣言も数える。gestureは`src/features/map/canvas/useCanvasViewport.ts`、`src/components/map/MapCanvas.tsx`、`src/components/map/MapCanvasPresentation.tsx`、`src/components/FocusModeMapCanvas.tsx`、現行Backupは`src/components/BackupRestoreDialog.tsx`、`src/features/events/backupRestore.ts`、`src/utils/appBackup.ts`、whole-file owner `src/app/commands/useEventTransferCommands.ts`、XLSX Worker参照は`src/xlsx/worker/xlsx.worker.ts`、`workerServer.ts`、`src/xlsx/adapters/workerXlsxExecutionPort.ts`までexact pathで登録する。新規Backup Workerは`src/features/map-cell-split/backup/backup.worker.ts`、`workerServer.ts`、`workerClient.ts`、`workerProtocol.ts`をplanned entryとして登録する。I0はAST symbol／signature inventoryと`rg` fallbackの結果一致を検証し、各owner Exitで旧API production edge 0件または明示legacy allowlistだけを許す
- route constraint移行面は`src/types/map.ts::RoutePathConstraint`、`src/utils/mapRouteMapData.ts`のselected-hall closure factory、`src/utils/polygonValidation.ts::validateHallPolygon`と`minArea` production override、`src/utils/mapRoutePolygon.ts::isPathAllowed`、`src/components/map/HallDefinitionPanel.tsx`およびimport／Backupの全polygon validator callerをchange-surfaceへexact登録する。I1を共有`validateHallPolygonContractV1`／inclusive predicate、I10を`RoutePathConstraintV1`接続のowner phaseとし、旧closure／predicate caller 0件、全surfaceのerror-level validity集合一致をcompletion assertionにする。fixture-only legacy比較はpath／test ID付きallowlist以外を許さない
- raw-day repair面は`src/types/item.ts::ShoppingItem.eventDate`／`DayModeState`／`ExecuteModeItems`、`src/types/map.ts::getMaplessKey`／`HallDefinitionsStore`／`HallRouteSettingsStore`、`src/utils/eventDates.ts::extractEventDates`、`src/utils/visitProjection.ts::normalizeExecutionVisitDay`／`findExecutionDayBucketKey`、`src/features/map/domain/normalizeHydratedHallState.ts::normalizeHydratedHallState`、`src/App.tsx::App/useEffect[normalizeHydratedHallState]`をexact登録する。最後の匿名effectは`hallDefinitionsMigratedRef`をAST anchorとし、adoption-blocked gateをref更新前に置く。`useIndexedDbPersistence` autosaveへ到達する迂回をnegative edgeにする
- legacy map-day association面は`src/features/map/hooks/useMapSelectors.ts::useMapSelectors`の内部`getMapTabForDate`、`src/types/map.ts::MapDataStore`／`MapRotationSettingsStore`／`RouteSettingsStore`／`HallDefinitionsStore`／`HallRouteSettingsStore`／`MapViewportSettingsStore`、`src/features/map/domain/hallOperations.ts::updateMaplessHallDefinitions`／`updateMaplessHallRouteSettings`／`getCombinedHallRouteSettingsForDate`、`src/features/map/domain/mapReimport.ts::buildMapReimportPlan`／`applyMapReimportPlan`、`src/utils/appBackup.ts::getMapEventDate`／`validateItemMapDateReference`をexact登録する。6 storeの`[eventName][dayMapName]` key closureと、mapless用2 storeの`getMaplessKey(rawDay)` closureを別assertionにする
- raw-day CAS面はplanned `src/features/map-cell-split/visits/LegacyFocusDayScopeRepairPort.ts::LegacyFocusDayScopeRepairPortV1`と、置換対象の`src/app/ports/PersistenceCommandPort.ts::PersistenceSnapshot`／`PersistenceCommandPort.commitApplicationSnapshotAtomically`、`src/persistence/db/atomicRestoreTransaction.ts::APPLICATION_SNAPSHOT_STORE_NAMES`／`commitApplicationSnapshotAtomically`、`src/persistence/adapters/indexedDbPersistenceCommandAdapter.ts::IndexedDbPersistenceCommandDelegate`／`createIndexedDbPersistenceCommandAdapter.commitApplicationSnapshotAtomically`、`src/persistence/facade/indexedDbPersistence.ts::db.commitApplicationSnapshotAtomically`、`src/hooks/useIndexedDbPersistence.ts::PersistedStateValues`／`useIndexedDbPersistence`をexact登録する。scope audit、authority proposal、persisted-authority loader、repair planner／Portもplanned symbolとし、既存after-only full-snapshot commandへのrepair edge 0件をowner Exitで検証する
- Hを親に持つ最初のI0 commitで`config/fsmc-implementation-state.json`を追加し、`schemaVersion`、`baselineSourceSha`、`i0StartHeadSha = H`、`completedThrough = "pre-I0"`、`currentPhase = "FSMC-I0"`、`phaseProgress = "in-progress"`、`readiness = "contracts-only"`を固定する。`baselineSourceSha..i0StartHeadSha`だけをpre-I0 inventory対象とし、I0自身のcommitはこのrangeにも基準SHA更新条件にも含めない。I0 closure commitだけが`phaseProgress = "exit-candidate"`へ進める。Exitでは`i0StartHeadSha`がbaselineの子孫であること、最初のI0 commitの第一親とexact一致すること、inventory完備、現在HEADが`i0StartHeadSha`の子孫であること、phase stateの履歴が隣接遷移だけであることを検証する。phase stateは`config/fsmc-implementation-state.json`だけをauthorityとし、test manifest、traceability、source readinessとの不一致を失敗させる
- DB5、V1、完全版XLSX 2.2、複数地図event、writer出力の`full-split`／`item-only`とreader-only synthetic `core-map` Backup V2、部分root欠損、完全profile消去、D+29／D+30／31日／36日／rollbackのgolden fixtureを固定する。V2 fixtureは全scope共通`scope.references`とhall descriptor、`eventLists`／metadata exact 1、残る8 section各々のabsent対present-empty、valid map／mapless owner対dual／orphan／unscoped、実payload一致／不一致の全`counts`、reference水増し／省略、normal／priority／highest／unassigned／missing／malformed hall order・HallVisitList、3面dangling base、ambiguous hall blocker、nonexecution itemだけの日、standalone empty day、empty durable entry、duplicate reconstructed visit identityを含む。unknown extension、unsafe URL、strict scalar／structural blocker、trusted-core-only fallbackのcoverage／excluded roots／warning、companion V1 unrepresentable、resolved manual hallのitem-only mapping／新規destination拒否、exact pair digest、role swap／bytes差、片側handoff incomplete、`core-map` producer 0件をpositive／negative fixtureへ固定する。V1層別互換matrixと固定旧版Aの自己動作だけをI0で実行し、新版Bの後続挙動は担当phaseへ登録する
- `VisitIdentityCoreBasisInputV1`と`config/fsmc-visit-identity-core-basis.schema.json`をexact一致させ、event-level input digest、zero-scope `scopes=[]`、basis core／authority per-event digest、同じevent集合の両aggregateをgoldenへ固定する。number／block／side／priority／manualHall／map／hall／splitの各単独差でcore digestが変わり、event名だけのrenameではcore digest不変・authority digest変更、prior rejected／retired rowは検証済みdigestをbyte保持するfixtureを置く。create／rename／duplicate／V2 full／core restore／V1・XLSX新規full／item-only／fixed-A delete／新版delete／resetのwriter matrixと、aggregateだけ更新・event集合差・scope-local digest反復・durable entry混入をrejectするadapter exhaustiveness fixtureを固定する
- Backup core payloadのorder fixtureは`HallDefinitionsSectionWireV1.owners[].halls`、各hallのraw `blockNames`、hall order／visit list、route order、map cells／blocks／verticesを個別に持つ。`halls`と`blockNames`はsource順をexact維持し、`blockNames`の重複とoptional absent／present-emptyを値としてround-tripする一方、hall ID重複はstructural rejectとする。canonical hall reference manifestのsortをpayload halls順へ逆流させるadapter、配列一律sort／dedupeをnegative fixtureにする
- 固定旧版Aは完全source SHA `3db4be011d0f4123aa3953b559280c58f33d026a`のdetached worktreeから一度だけ生成し、`tests/fixtures/fsmc/legacy-a/legacy-a-artifact.zip`を通常Git blobとして直接追跡する。Git LFS、network download、CI再buildを使わず、`.gitignore`の`dist`規則からこのarchiveだけを明示除外する。`manifest.json`へsource／lockfile／toolchain hash、Node／npm、build／start command、archive path／SHA-256／byteLength、展開後全entryの相対path／size／SHA-256、fileCount、provenance、licenseを固定する。verifierはcompressed 32 MiB、expanded 128 MiB、4,096 filesを上限に一時directoryへ展開し、absolute path、`..`、symlink、duplicate、case collisionを拒否してoffline起動smokeを行う。更新には固定旧版A判断の再承認を要求し、候補新版BはCI対象sourceから一度だけbuildする
- 代表地図、ON／OFF別番号正規化、`01a`／`1a`衝突あり・なし、衝突pair swap／厳密減少／完全解消、safe integer境界、1 MiB数字列を巨大`BigInt`化しない境界、mapless、unresolved、`26`／`26c`／`26d`／`26ab`／`26c2`、retained number／token一致・不一致、active／retained owner overlap、同名block、一意番号、重複・領域競合・merge越境、重複物理`(row, col)`、背景色だけで変わるpathfinding graph、0／45／90度pickerのfixtureを作る
- `config/fsmc-fixture-topologies.json`とschema、`tests/fixtures/fsmc/max/manifest.json`を作り、最大healthy topologyをgrid 100×150＝15,000 logical number cell、8,192 block（2-cell block 6,808、1-cell block 1,384）、15,000 split setting、30,000 half region、orientation各3,750、400 item／space／execution visit、normal 400＋postponed 200＋late 200＝最大800 phase visit、単一phase route最大400へ固定する。max healthyではmerge region 0、blocked cell 0を明示し、merge／obstacle／partial-lossは別の固定topology IDへ分離する。manifestはgenerator ID／version／source SHA、seed、canonical serialization、寸法、block／merge／obstacle／visitのexact座標recipe、route connectedness、payload SHA、`dataTopologySha256`、期待root SHA／countsを持つ。OFF referenceとON targetは同じdata topology、通常／集中は同じdata topologyでUI start-state hashだけを変え、generator再実行のbyte一致をI0 Exitで検証する
- `config/fsmc-performance-budgets.json`、runner configに加え、`config/fsmc-performance-shards.json`、plan／lifecycle-ledger／shard-result／reduced-resultの各schemaを作る。I0でexact OCI source label付き`infra/fsmc-perf-runner/Dockerfile`、`.github/workflows/fsmc-performance-runner-publish.yml`の`publish-fsmc-performance-runner` job、publicかつrepository-linkedなpackage `ghcr.io/blusalice3-foundation/event-shopping-planner-routeplanning-fsmc-perf-runner`を作成し、publisherだけに`packages: write`を与える。`quality.yml`の`fsmc-performance-shard`は`contents: read`だけで、package permission／credentialなしの匿名pullを行う。publisherはdefault branch guard＋承認environmentの`workflow_dispatch`だけで動き、untrusted PRでは起動不能にする。publisherが出力したexact OCI digestをrunner configへ固定し、consumerの`container.image`と`container.options` literalを同configへexact一致させて匿名pull／qualificationする
- keyは`${scenarioId}@${profileId}`、基本1 key／shard、OFF reference→target pairだけを同shard・固定順とし、全62 keyを最大54 shardへ割り当てる。`maxParallel: 12`、`failFast: false`、`computedExecutionLimitMinutes: 300`、workflow `jobTimeoutMinutes: 330`、setup／calibration／browser／scenario／cleanup timeoutを固定し、`calibration + Σ(warmupRuns × scenarioTimeout) + Σ(measuredRuns × (scenarioTimeout + cleanupTimeout)) + setup <= 300分`を静的検証する。各shardは同container／browserで製品sample直前に個別calibrationし、別shard／attempt／runから再利用しない
- shard resultは`ciRun`、`sourceSha`、`foundationQualityResultSha256`、`productionArtifactTreeSha256`、`productionBuildManifestSha256`、条件付き`qaArtifactTreeSha256`／`qaBuildManifestSha256`、shard／plan／budget／runner config SHA、OCI digest、browser revision、requirement／traceability／test manifest／topology hashes、lifecycle ledger、calibration、expected／executed keys、warmup、30 measured sample、runner-result SHAをexactに持つ。reducerは全期待shardをcanonical sortし、欠落・余分・重複・stale hash・別attempt・sample混在・OFF順違反を再計算する。I0は`qualification-only`、I1はrunner集合空の`not-required`、I2以降は`product` reduced resultとする
- `config/fsmc-virtual-list.json`をI0のversion付き契約成果物として追加し、`threshold`、`overscanRows`、`maxMountedRows`、`focusModel: "container-activedescendant"`、component別pattern `definition: "multiselect-listbox-external-toolbar"`、`retained: "single-select-listbox-external-toolbar"`、`projectedVisit: "single-select-listbox-external-toolbar"`、`rowDomIdPrefixes: { definition: "fsmc-definition-row-", retained: "fsmc-retained-row-", projectedVisit: "fsmc-projected-visit-row-" }`、scroll alignmentをnon-nullで固定する。retainedとprojected visitによる同じsingle-select pattern値の共有は意図した正規形として許可し、重複component key、値欠落、未知component、component別prefixの欠落／重複、`grid`／roving focusとの混在、生成後row ID衝突、active row未mountのfixtureをschema／semantic verifierで拒否する。I0ではruntime UIを変更せず、I5がdefinition／retained、I8がprojected visitの実装を所有する
- `config/fsmc-a11y-oracles.json`とschemaへ、definition／retained／picker／popup／projected visit／route insertの各surfaceについてrole、name、description、state、DOM／AX順、focus order／return、live-region politeness／atomicity／mutation countを固定する。I0はcontract／negative fixtureだけ、I5／I8／I9はsurface実装とrequired Chromium oracle、I11はrelease-ready productionでの全再実行を所有し、axe結果だけで代用しない
- `config/fsmc-failure-injection.json`へbarrier ID、対象command、fault、commit前後のoracle、owner phaseを、`config/fsmc-test-manifest.json`の全test／scenario entryへtest ID、project、層、`requiredCommand`、`enforcedFromPhase`、`releaseScope: "initial-release" | "future"`を固定する。各test IDはexact 1件の`requiredCommand`を持ち、複数IDが同じsuite commandを共有することは許すが、1 IDの0件／複数command対応、result側だけのcommand、traceabilityの`commands`にない対応を拒否する。traceabilityのrequirement scopeとtest scopeをexact一致させ、初版PD／DoDに必要なtestを`future`へ移す変更を拒否する。failure barrierには`after-vcap-history-source-preflight`、`after-vcap-history-source-reread-before-first-write`、`before-vcap-versionchange-commit`、`after-vcap-versionchange-commit-before-open-success`、`after-legacy-rebase-r0-read`、`after-legacy-rebase-r1-before-first-write`、`before-legacy-rebase-commit`、`after-legacy-rebase-commit-before-r2`、`after-legacy-rebase-r2-before-ui`、`after-durable-visit-state-write`を含める。`config/fsmc-collision-repair-commands.json`へ利用者向け3 command ID、変更可能範囲、owner phase、UI owner、strict-reduction verifierを固定し、内部`fsmc.internal.rebase-legacy-core.v1`がそのallowlistへ入らないことも検証する。future testは`planned`または契約だけを固定した`contract-enforced`であって、初版の選択集合、成功済み、`implementation-enforced`へ入れない
- `config/fsmc-pre-adoption-repair-commands.json`はexact 1件の`fsmc.repair.legacy-focus-day-scope.v1`、`LegacyFocusDayScopeRepairPortV1`、変更可能core root／nested key、Focus lease、I11 UI ownerを登録する。番号正規化用3 IDの`config/fsmc-collision-repair-commands.json`とは別allowlistとし、相互混入、通常writer／既存full-snapshot commandからのdispatch、未登録participantを拒否する。同commandを`config/fsmc-command-participants.json`、traceability、test manifest、failure injectionへ同じIDでexact登録し、`after-raw-day-repair-preview`、`after-raw-day-repair-lease-before-first-write`、`after-raw-day-repair-core-commit-before-registry-complete`のbarrierを追加する
- `config/fsmc-failure-injection.json`にはopen handoff用`after-vcap-probe-transaction-complete`、`after-vcap-probe-close-before-upgrade-request`、`on-vcap-upgrade-blocked`、`after-vcap-blocker-close-before-h1`、`after-vcap-upgrade-abort-before-request-error`も登録する。各oracleは自己probe connection 0、upgrade request ordinal exact 1、blocked progress非terminal、同request再開、terminal exact 1、page終了の偽success 0、DB absence時`oldVersion = 0`、success時`request.result` handoff後のreopen 0件を検証する
- `config/fsmc-safety-findings.json`は`findingId`、source job／engine、`severity: "Critical" | "High"`、`status: "open" | "closed"`、opened／closed commit、`promotion.kind: "engine-agnostic-required" | "webkit-temporary-required"`、test ID、required command、closure test IDをexactに持ち、test ID／required commandをtest manifestの一意な対応と一致させる。test manifestのsafety entryには`enforcedFromPhase`、`status: "planned" | "contract-enforced" | "implementation-enforced"`、`releaseScope: "initial-release" | "future"`、`artifactMode: "pre-release-production-guard" | "release-production-full" | "qa-chromium-only"`を必須にし、初版traceability／DoDに属するIDを`initial-release`、後続版だけのIDを`future`へexact分類する。`requiredSafetyIds(state)`は、pre-releaseなら`releaseScope = initial-release && enforcedFromPhase <= currentPhase && status != planned && artifactMode = pre-release-production-guard`の全ID、release-readyなら`initial-release`かつ`implementation-enforced`の`release-production-full`と`pre-release-production-guard`の全IDを返す。`release-ready`は、全`initial-release` safety entryが`implementation-enforced`で、`releaseScope = initial-release`の`qa-chromium-only`が0件の場合に限りschema-validとする。future safetyは`planned | contract-enforced`かつ`qa-chromium-only`に限定し、全readinessのselected／executed／result、成功済み、`implementation-enforced`へ入れない。I11最終candidateで`release-production-full`へ移すのはinitial-releaseだけとし、future scopeは全readinessのWebKit集合へ入れない。pre-release production guardは選択0件を禁止し、I2～I10およびI11作業中`internal-testing`のsplit機能safetyはnon-promotable QA artifact上の必須Chromiumへ割り当て、到達不能なproduction WebKit testを成功扱いにしない
- `config/fsmc-webkit-safety-observation.schema.json`は`ciRun`、source SHA、`productionArtifactTreeSha256`、`productionBuildManifestSha256`、`selectionMode: "pre-release-production-guard" | "release-production-full"`、implementation-state SHA、test-manifest SHA、Playwright／WebKit version、`requiredSafetyIds(state)`から導出した`manifestSafetyTestIds`、`executedSafetyTestIds`、`{ testId, result: "passed" | "failed" }`のexact結果、`failedSafetyTestIds`、`infrastructureErrors`を共通fieldとしてcanonical unique配列で持つ。全status分岐でresultのtest IDを重複禁止とし、`executedSafetyTestIds = result test IDs ⊆ manifestSafetyTestIds = requiredSafetyIds(state)`、`failedSafetyTestIds = result = "failed"のID集合`を必須にする。future scope／QA-only／未選択IDのresult混入、現在必要IDの欠落、selectionMode／readiness／`ciRun`不一致をschemaとaggregatorで拒否する
- observationのstatusは結果から再計算する。失敗結果が1件以上なら、未実行やinfra errorも併発していても`safety-failed`を最優先し、nonempty `failedSafetyTestIds`と全失敗要因から作る`stableFailureFingerprint`を必須にする。失敗結果0件かつ未実行IDまたはinfra errorが1件以上なら`infrastructure-failed`とし、nonempty `infrastructureErrors`（未実行IDも正規化したerrorとして列挙）とfingerprintを必須にする。全manifest IDを実行し、全結果passed、infra error 0件の場合だけ`passed`とし、failed IDsは空、fingerprintは禁止する。この3分岐以外、矛盾するoverall status、分岐外fieldをschemaとverifierで拒否する。通常表示／a11y失敗は別fieldへ記録し、このstatus unionへ混入させない
- `config/fsmc-webkit-promotion-result.schema.json`は`ciRun`、source SHA、`productionArtifactTreeSha256`、`productionBuildManifestSha256`、safety-findings file SHA-256、選択finding／test ID／required command、実行済みID、`{ testId, command, result }`、failed IDs、infra errorsと`status: "not-required" | "passed" | "failed" | "infrastructure-failed"`のexact unionを持つ。open `webkit-temporary-required`が0件の場合だけselected／executed／results／failed／infraをすべて空、fingerprintなしの`not-required`にできる。1件以上ならselected IDsと各required commandをopen findingおよびtest manifestからexact導出し、全status分岐でresult IDを重複禁止、`executed IDs = result IDs ⊆ selected IDs`、各`result.command = manifest.requiredCommand`、failed IDs＝失敗結果IDsを必須にする。失敗結果ありは`failed`を最優先、失敗結果なしで未実行またはinfraありは`infrastructure-failed`、全selected実行・全pass・infraなしだけ`passed`とし、失敗2分岐だけfingerprintを必須にする。常設`webkit-safety-promotion` jobは0件ならWebKitをinstallせず`not-required`、1件以上なら`npx playwright install --with-deps webkit`後に全昇格testを実行して結果を`if: always()`相当で出力する。schema verifierとrelease aggregatorはstatus／commandを信頼せず集合、manifest mapping、優先順位を再計算し、advisoryで安全事故を検出した現在candidateの結果受渡し、次commitでのrequired昇格、release blockingをこの3契約へ固定する
- `infrastructureErrors`は`{ code, stage, testId: string | null }`のexact objectだけを許し、version付きJSON Schemaが`code`／`stage` enumを列挙し、message、stack、path、時刻を入れず`(code, stage, testId)`で重複排除・Unicode code point順sortする。`stableFailureFingerprint`はlowercase 64桁hexで、固定property順・空白なしの`{"schemaVersion":1,"artifactKind":...,"status":...,"failedSafetyTestIds":[...],"infrastructureErrors":[...]}`をUTF-8 encodeしたSHA-256とする。failed IDsもUnicode code point順のunique配列とし、observation／promotionで同じ`serializeFailureFingerprintV1` fixtureを共有する。fingerprintは診断上の同一失敗group化だけに使い、release可否、finding close、結果集合の代替authorityにしない
- FSMC専用required Playwright configにDesktop／Mobile Chromiumの2 projectを、別advisory configにWebKitを作る。requiredはUbuntu 24.04、Node 24.19.0、npm 11.19.0、lockfileのPlaywright／Chromium、workers 1、retries 0、`failOnFlakyTests: true`、`fullyParallel: false`、`trace: "retain-on-failure"`を固定する。Desktopの既定contextは1440×900・DPR 1・`isMobile=false`・mouse・touchなし、Mobileは390×844・DPR 3・`isMobile=true`・touchありとする。さらにDesktop project内の必須manifest testだけが`browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: true })`という固定`desktop-touch-context`を作り、`touchscreen.tap`で非スマートフォンtouch直接選択を検証する。第3 projectや別性能profileにはせず、default Desktop／Mobileとこの追加contextで選択test 0件を失敗させる
- 全jobの共通setupは`npm ci`とし、Chromium test runnerだけは加えて`npx playwright install --with-deps chromium`を必須にする。WebKit jobは11章と15章の`npx playwright install --with-deps webkit`契約に従い、build／artifact verifier／aggregatorへ不要なbrowser installを要求しない。固定Node／npm／lockfile toolchainでrequired command `npm run test:fsmc:playwright-cli-contract`を実行し、そのpositive fixture `npx playwright install --with-deps chromium --dry-run`がexit 0、target `chromium`とflag `--with-deps`をPlaywright CLIへ渡したことをstructured observationで確認する。`npm exec -- playwright install`や`npm exec -- playwright install -- --with-deps`はnegative argument-forwarding fixtureで拒否する。このCLI contractはI0からcanonical `npm run quality` graphのexact 1 named childとして登録し、既存`quality` jobだけが実行してfoundation-quality resultのselected／executed command hashへ含める。別FSMC jobで同commandを再実行したり、quality graph外のadvisory resultで代用したりせず、child 0件／複数、command差、dry-run未実行をquality失敗にする。run-bound成果物は共通definitionのexact object `ciRun: { runId: decimal-string, runAttempt: integer >= 1 }`を必須にし、artifact名を`fsmc-<class>-run-<runId>-attempt-<runAttempt>[-shard-<id>]`へ固定する。consumerはcurrent exact nameを1件だけdownloadし、同名複数を拒否する。旧attempt名はcurrent duplicateへ数えない一方、内容混在・別attempt参照を禁止する。production／QA build manifest、required-results、WebKit observation、promotion resultの全てでworkflow runtimeのcurrent run ID／attemptと一致させる。

- `config/fsmc-build-artifact-manifest.schema.json`は`schemaVersion`、`ciRun`、`buildPurpose: production | qa`、`databaseTargetMode`、完全source SHA、lockfile SHA-256、readiness、相対output path、`files`、`artifactTreeSha256`を必須にする。`files`はmanifest自身`fsmc-build-artifact-manifest.json`のexact 1件だけを除外した全regular fileとexact bijectionの`{ path, byteLength, sha256 }`で、pathはroot相対POSIX `/`、absolute／空segment／`.`／`..`／backslashなし、UTF-16 code-unit順、重複なしとする。nested directory自体は列挙せず、symlink／junction／reparse point／device fileを拒否する。`artifactTreeSha256 = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-build-artifact-file-tree-v1", files })))`とし、manifest bytesは自己参照させず別の`buildManifestSha256`としてdownstream resultが拘束する。build jobはproduction／QAを別directoryへ1回だけ生成してmanifestと共にcurrent runへuploadし、別jobはdownload後にtreeをfilesystemから再構築してtree digestとmanifest bytes SHA、`ciRun`、source、purpose、DB mode、readinessを検証してから`*:prebuilt`を実行する。別root／timezoneの同一treeは同値、path／length／byte／manifest差、欠落、上書き、別run／attempt／source／purposeの取り違えは失敗とする
- `config/fsmc-required-results.schema.json`は`ciRun`、source SHA、implementation-state／test-manifest SHA、`completedThrough`、`currentPhase`、`phaseProgress`、readiness、`productionArtifactTreeSha256`、`productionBuildManifestSha256`、`qaArtifactTreeSha256: string | null`、`qaBuildManifestSha256: string | null`、manifestから導出したrequired Exit ID、artifact purpose別selected test／scenario ID、実行済みID、`{ id, command, artifactPurpose: "production" | "qa", result: "passed" | "failed" }`、failed ID、infrastructure error、`status: "passed" | "failed" | "infrastructure-failed"`をexactに持つ。required Exit IDは`in-progress`なら`completedThrough`まで、`exit-candidate`なら`currentPhase`までとし、I11 release-readyだけは全I0～I11とrelease readinessを必須にする。I0／I1／release-ready I11はQAのtree／manifest hashを両方nullかつ全result purposeをproduction、I2～I10と`currentPhase = I11 && readiness = internal-testing`はQAの両hashを必須にし、production guardはproduction、機能／性能testはQAへexact分類する。selected IDsはtest manifestの`releaseScope = initial-release && enforcedFromPhase <= currentPhase && status != planned`を満たす該当purpose集合とし、全status分岐でresult IDを重複禁止、`executed IDs = result IDs ⊆ selected IDs`、各`result.command = selected manifest entry.requiredCommand`、failed IDs＝failed result IDsを必須にする。失敗resultありを`failed`、失敗0件で未実行またはinfraありを`infrastructure-failed`、全required Exitとselected testを実行・全pass・infra 0件だけを`passed`と再計算し、選択0件、future scope／planned／未選択IDのresult混入、IDに対するcommand欠落／差替え／曖昧対応、自己申告status矛盾を拒否する。各resultが参照するtree／manifest hash、buildPurpose、source、readiness、phase state、`ciRun`、`requiredCommand`をdownload済みmanifestとcurrent workflow runtimeから再計算し、別run／attempt、stale QA、production／QA取り違え、resultだけのhash／run／command自己申告を拒否する
- required-resultsはさらに`performanceRerunApprovalResultSha256`と`performanceRerunApprovalDigest: string | null`を必須にし、current attemptのsole approval result実bytesへ前者を再hashする。run attempt 1ではschema-valid `not-required`とnull、attempt 2では`approved`とplan／reduced resultと同じ`FsmcPerformanceRerunApprovalV1.approvalDigest`だけを許す。attempt 2のrejected／欠落／複数／別digest、attempt 1でnon-null、approvalのprior required-results hashが実bytesと不一致ならoverall resultを自己申告statusにかかわらずfailedへ再計算する
- 上記exact artifact schemaを補完し、production／QA build manifestは`foundationQualityResultSha256`を必須とする。finalizerだけが生成するrequired-resultsは同fieldに加え、`functionalResultSha256`、`performanceMode: "qualification-only" | "not-required" | "product"`、`performanceReducedResultSha256`、`performanceRerunApprovalResultSha256`、`fixtureTopologyManifestSha256`、`requirementCatalogSha256`、`traceabilitySha256`、`ciPrerequisitesResultSha256`を必須とする。各fieldをcurrent run／attempt／source／artifactへ拘束し、build manifestへbuild後に生成されるperformance resultを逆参照させない。shardごとのrunner-result SHA mapはreduced result内部だけに持たせ、I0はqualification-only、I1は期待shard／runner集合が空のnot-required、I2以降はmanifestが選ぶproductとする
- `config/fsmc-foundation-quality-result.schema.json`は共通quality graph／script hash／選択件数／exit／source／toolchain／`ciRun`／statusを持つ。performanceはplan、job-start absolute deadline、3段階lifecycle snapshot、shard result、reduced resultのschemaへ分け、各shardの同一container内calibrationと製品sampleを一体化する。browser install／runner envelope／calibration失敗はdeadline＋preproduct snapshot、started snapshot不在、sample 0件、固定allowlist証跡、schema-valid reporter resultが揃う場合だけinfrastructure候補、measured run timeout／budget超過／absolute deadline watchdogは製品failedとする。job hard-timeout、deadline／result／snapshot artifact欠落、preproduct前終了は開始前であってもindeterminate failureとして非再実行にし、workflow outcomeだけからallowlist reasonを捏造しない。overall statusの自己申告を信頼しない
- `config/fsmc-functional-result.schema.json`は`ciRun`、source SHA、`completedThrough`／`currentPhase`／`phaseProgress`／readiness、foundation-quality result SHA、`productionArtifactTreeSha256`／`productionBuildManifestSha256`、`qaArtifactTreeSha256`／`qaBuildManifestSha256`とpurpose、requirement catalog／traceability／test-manifest SHA、manifestから導出したselected／executed test ID、`{ id, command, artifactPurpose, result }`、failed ID、bounded infrastructure error、`passed | failed | infrastructure-failed`のexact unionを持つ。各functional runnerはtest開始前にcurrent-run ledgerを作り、各test commandの終了を追記する。test processの非0終了、起動前失敗、強制終了で通常finalizeへ到達できなくても、workflowの独立した`if: always()` reporter `finalize:fsmc:functional-result`がledger／job outcomeからschema-validなfailedまたはinfrastructure-failed resultを作る。続くverify／`artifact:fsmc:upload:functional-result`も独立した`if: always()` stepとし、欠落、0 test、未実行、別run／attempt／source／artifact、phase state差、command差替えをsuccessへ変換しない
- `config/fsmc-ci-prerequisites-result.schema.json`は`ciRun`、source SHA、prerequisite config SHA、確認command manifest SHA、`currentRequiredAt`、repository／branch、repository／environment adminとrequired reviewer設定可否、package作成／public化／link確認権限、Actions／GHCR availability、required context接続、publisher／OCI source label／linked repository／visibility／exact image digest匿名pull／runner qualification、実際の最小permission名、consumer package permission／credential不在、fork PR token方針、`pre-I0 | I0-exit | release-ready`ごとの`not-yet-required | passed | failed | infrastructure-failed` result、bounded infrastructure error、`checkedAt`をexactに持ち、credential値、token、secret内容、自由記述command出力を禁止する。verifierはcurrent stage以前の全resultを再計算し、未来stageだけを`not-yet-required`にできる。常設`fsmc-ci-prerequisites` jobはread-only observerを実行し、独立した`if: always()` reporter／verifier／`artifact:fsmc:upload:ci-prerequisites-result`でcurrent-run artifactを必ず生成する。admin／package権限不在、Actions／GHCR／required context不在、到達済みstageのlabel／link／visibility／digest pull／qualification失敗、observer起動前失敗を欠落や前run resultで補わない
- `config/fsmc-traceability.json`と`verify:fsmc:i0`を実装し、schema、fixture hash、fixed A、test membership、phase ownership、readiness、production override不在を一括検証する。該当test 0件、重複ID、owner不在、`--passWithNoTests`相当を失敗させる
- `config/test-project-membership.json`、`config/coverage-policy.json`、`config/architecture-policy.json`、dependency usage policy、`.github/workflows/quality.yml`をI0の同じPRで更新し、既存foundation qualityを`fsmc-required-gate`と並列のrequired upstreamとして維持する。新unit／integration／worker／browser testのmembership件数、coverage owner、feature／UIからpersistenceへの禁止edge、Worker assetを機械検証する。FSMC専用commandは0 testやallow-emptyを拒否し、既存一般`test:worker`のallow-empty設定を流用しない。JSON Schema validatorにAjvを使う場合はdirect dependencyへ追加してusage policyを更新し、transitive dependencyの直接importを禁止する
- 固定job／status `fsmc-required-gate`と`verify:fsmc:phase-gate`を実装し、`contracts-only`／`internal-testing`のmerge判定と`release-ready`の`verify:fsmc:release-readiness`呼出しをsource stateだけで切り替える。既存required `quality`へ逆向き`needs`を追加せず、Repository Maintainerが`config/fsmc-ci-gate.json`のone-time setupで`fsmc-required-gate`自体をI0 Exit候補の同一HEADから直接required化する。全readiness値、phase境界、state／artifact不一致、`releaseScope = future`のtestをpre-release／release candidateで省略するcaseと、そのresultを初版gateへ混入するnegative caseをcontract testにする
- Critical／High severity、初版／後続版、外部証跡なし、`PD-18`の部分欠損と完全消去の保証境界、advisoryで見つかった安全事故のrequired昇格・解消手順をADRと利用者文書雛形へ固定する
- `config/fsmc-requirement-catalog.json`とschemaを作り、normative ID集合を全PD／RC／`DOD-FSMC-*`／`EXIT-FSMC-I0-001`形式の全Exitにexact限定する。各entryへ`requirementId`、kind、主`sourceAnchor`、IDを除くstatement SHA-256、parent ID、owner phase、release scope、重複なしnonempty `supportingSourceAnchors`を固定する。章2～15のcode fence／見出し／例示だけの行を除く全table row・list itemはexact 1件以上の`supportingSourceAnchors`へ入れる。ただし7.2の一致するinformative start／end marker間だけはscan対象外とし、marker IDの不一致、入れ子、未閉鎖、7.2外のmarker、marker内anchorのcatalog登録を失敗させる。同じ補足が複数要件を具体化する場合はcanonical ID順で全てへ結び、補足本文を別のIDなしnormative authorityとして扱わない。`config/fsmc-traceability.json`は同じID集合にfixture／test／command／implementation symbol／document／statusを対応させ、test manifest全entryのnonempty `requirementIds`とscopeを一致させる。cross-verifierは未追跡または存在しない補足anchor、ID集合の重複・欠落、statement drift、catalog／traceability／test manifestの集合差、初版requirementのfuture化、enforced requirementのfixture／test／command欠落を拒否する。required-resultsはcatalog／traceability SHA、selected／satisfied requirement ID集合を持ち、release gateがinitial-release集合から再計算する
- event settings root／bridge／legacy transition、DB version provenance、guided-delete coverage closure、projection root revision、portable historical owner、profile別bootstrap participantの各schema／configをI0成果物へ登録する。failure injectionには既存Vcap／rebase境界に加え、`after-event-settings-idb-commit-before-shadow-write`、`after-event-settings-shadow-write-before-bridge-ack`、`after-destructive-coverage-snapshot`、`before-guided-delete-coverage-recheck`を含める

Exit:

- **EXIT-FSMC-I0-001** — `npm run verify:fsmc:i0`、production artifact作成後の`npm run verify:fsmc:i0:prebuilt`、`npm run test:fsmc:i0:prebuilt`、固定旧版A hash／起動smokeが成功し、Desktop／Mobile各projectの選択test数が1件以上である
- **EXIT-FSMC-I0-002** — `verify:fsmc:pre-i0-baseline`がrecorded SHA／treeのdetached worktreeで`npm ci`後に開始・終了HEAD／tree／clean status、worktreeとmanifest固定`baselineSourceSha..i0StartHeadSha`の開始・終了`git diff --check`、再帰展開graph hashが一致する`npm run quality`成功の9段を再現する。tracked／untracked生成、range差し替え、skip／waiver／known failure、過去attempt result再利用が0件である
- **EXIT-FSMC-I0-003** — `config/fsmc-implementation-state.json`の`baselineSourceSha = 2eaba922816e8b263c6479e81ab9f265321654b2`、着手前に一度固定した`i0StartHeadSha`、`completedThrough = "pre-I0"`、`currentPhase = "FSMC-I0"`、`phaseProgress = "exit-candidate"`、`readiness = "contracts-only"`がschemaに合格し、最初のI0 commitの`in-progress`から許可遷移だけで到達する。`baselineSourceSha..i0StartHeadSha`の全変更file、契約影響、既実装FSMC範囲をinventoryへ記録し、I0実装commitを理由にbaselineまたは`i0StartHeadSha`を追更新しない。固定旧版Aとは混同せず、manifestの全hashが一致する
- **EXIT-FSMC-I0-004** — readinessは`contracts-only`で、production DB、runtime UI、business保存動作を変更せず、production artifactにQA override経路がない
- **EXIT-FSMC-I0-005** — 全schema／fixture／configがversion付きverifierに合格し、番号・物理slot／可変論理location・局所exclusion対duplicate-physical fatal・selected hall polygon・Pointer全遷移・forced picker・execution reorder、CAS・control・identity・番号collision repair 3 IDとpre-adoption raw-day repair 1 IDの別allowlist・fingerprint・retention・Backup pair／V2-only total matrixとdomain-separated V2 digest・build file-tree digest、event-settings root／bridge、atomic `Vcap` bootstrap、3 capability snapshot、event名基準collision witness付き`capability-adoption-blocked`、unsupported、presence／progress／terminalを含むopen-result契約、null決定表、probe close／same-request／exact-one terminal、proposal→persisted event authority、Focus token／one-shot lifecycle lease ledgerの全正常・不正遷移、raw-day total／injective／closed replacement／cardinality／map 6面／Focus occupancy、3 counterのexact exhaustion reasonと副作用0件、authority別candidate配列、root policy／total historical evidence／logical-root mutationとadministrative fence writeの分離、legacy core／shadow transition、destructive coverage closure、projection checkpoint全体digest、portable historical owner、WebKit safety、functional／CI prerequisite always-run result、shard reducer／required-results finalizerのnegative contract testが実行される
  I0-005のfixtureは`RoutePolygonFingerprint`の開始点／向き同値と頂点／hall／revision差、active／non-active pointer move、reorder read-only root／item／association witness、Backupのscope→prepared→verification→handoffにわたるpair／構造V2-only／resource V2-only／standalone V1の不可能組合せ、source SHA／snapshot revision／root vector／snapshot digestのpair role差、root順shuffle、BMP／astral key、別slice混在、未acknowledged standalone handoff attempt、`v2-export-failed` 7 reasonのfull fixed-point state／typed sink receipt／source binding／config SHA／field単独差、role別self-validation tuple、immutable bytes witness、handoff receipt objectと0／1／2 receipt partition、issues／receipt digest単独差、build tree／manifest単独差を含む。固定toolchainのrequired Playwright CLI contractもpositive dry-runと旧形式negativeの双方を実行する。

- **EXIT-FSMC-I0-006** — `releaseScope = future`のscenarioは`planned`か契約だけを固定した`contract-enforced`で担当phaseとtest IDを持つが、初版のselected／executed／failed集合、planned残存違反、`implementation-enforced`、成功済みへ混入していない。初版requirement／PD／DoDに紐づくentryは全て`initial-release`である
- **EXIT-FSMC-I0-007** — 固定旧版AのV1 unknown／anchor保持・欠落matrixと自己動作が実測済みで、旧版Aのhealthy legacy-mutable-core-only更新、candidateの正常吸収／追加と不正消失／差替え、anchor missing／invalid／duplicate、invalid-only／duplicate-only／別event群でのinvalid＋duplicate併発、同一event複合rowのschema／semantic reject、reason順shuffle／重複／witness・digest差、番号衝突、fence／capability破損を区別するrebase／bootstrap fixtureと全barrierがI2／I11へ割り当て済みである。新版Bによるanchor保持、DB fallback、atomic command、Backup V2、UI、性能もI2～I11のExitへ割り当てる
- **EXIT-FSMC-I0-008** — FSMC性能configの全製品上限、62 scenario-profile key、最大54 shard、`max-parallel = 12`、OFF pair同居順、1 shard計算上限300分／job timeout 330分が非nullである。54 shardは5 wave、computed wall-clock 1,500分／timeout ceiling 1,650分、runner cap 16,200分／ceiling 17,820分／attemptへ再計算される。I0 qualification-onlyはexact 12 `jobIntervals`をhalf-open UTC millisecond区間としてend-before-startで走査し、queueを除くobserved concurrency 12以上とunion wall-clock 360分以下を実測する。canonical shard IDを12 laneへ割り当てた`declaredShardExpectedMinutes`から`projectedFiveWaveMinutes <= 360`も再計算する。test／automatic workflow retry 0、schema-validな開始前allowlisted infrastructureだけCI Operator承認付き`Re-run all jobs`で全required jobを同一sourceの新attemptへexact 1回再実行し、attempt固有artifact名、最大2 attemptのperformance shard matrix部分だけ3,300 matrix分／35,640 runner分、partial rerun／attempt混在／product failure rerun禁止をschema検証する。Actions job `started_at + 300分`で製品child treeを停止してfailedとし、同じ`started_at + 330分`のhard deadlineまでに独立`if: always()` reporterを完了するabsolute deadline契約、全shard bound、synthetic missing／duplicate／stale／別attempt resultを落とすreducer、runner provider／immutable image／calibrationが成功し、最大fixtureのpayload／topology／root hashとOFF／ON同一`dataTopologySha256`も一致する
- **EXIT-FSMC-I0-009** — `config/fsmc-virtual-list.json`の全component、listbox pattern、focus model、row ID、scroll／mount契約がschema／negative fixtureに合格し、I0 production artifactにruntime UI変更がない
- **EXIT-FSMC-I0-010** — `config/fsmc-capability-adoption.json`がsource／fixture／legacy A／authoritative provenance manifestから`adopt-vcap`へ再計算され、commit `81795770cca30c68bb1526f989dcd7ab0af1edb4`の同名DB6／`memberRouteItems`を含むdistributed／unknown conflictが0件である。採択不能ならI0 Exitは失敗のまま代替ADRへ送る。固定旧版A archive、change-surface、quality／membership／coverage／architecture policyも全てgreenである
- **EXIT-FSMC-I0-011** — `fsmc-required-gate`が`in-progress`では`completedThrough`まで、`exit-candidate`では`currentPhase`までを`phase-gate-passed`にできる一方で公開可能と表示せず、I11 `release-ready` stateでは全I0～I11と`verify:fsmc:release-readiness`なしに成功しない。`fsmc-ci-prerequisites`のrepository admin、required reviewer設定、package作成／public化／link確認、checkedAt／read-only command、Actions、exact OCI source label付きrunner Dockerfile、exact publisher workflow／job／manual trigger／default-branch guard／approval environment、publicかつrepository-linkedなGHCR URI／visibility、publisher-only write permission、consumerのpackage permission／credentialなし匿名pull、`quality.yml`のliteral container、runner qualificationがI0-exit stageで実在する。既存`quality`をrequiredのまま独立producerとして維持し、同一HEADで`fsmc-required-gate`自体をone-time direct required化したruleset再読結果が一致する。既存終端contextへの逆接続、循環needs、phase／findingごとのcontext変更を拒否する
- **EXIT-FSMC-I0-012** — `PD-01`～`PD-18`、`RC-01`～`RC-39`、全DoD／Exit IDがrequirement catalog、traceability、test manifestで集合一致し、statement hash、owner phase、release scope、fixture、test、command、利用者文書または非対象理由へ追跡できる
- **EXIT-FSMC-I0-013** — day preflightの`authorityRevisionSubset`→domain-separated digestとbootstrap source／H0 core／expected／fresh observed subsetのbyte一致、event-wide hall source row→request digest→plan保存request→choice／assignment→receiptの再構築、Focus lifecycle transition／lease digestとtyped acquisition result、拒否時のFocus session record mutationとlease ledger transitionの分離をschema、strict compile fixture、field単独差／ABA／counter exhaustionのnegative fixtureで検証する

### FSMC-I1: 共通ドメイン

実装:

- `spaceNumber.ts`
- `splitGeometry.ts`
- `EventEnablePreflightResult`のpure判定と、衝突一覧・原文・修正案を返す副作用なしvalidator。control／DB commandへの接続はI2が所有する
- 物理geometry slotと可変個数のwhole／a／b／unsupported論理locationを分離した`MapLocationIndex`、source item snapshotからunsupported suffix requestをtotal導出するpure API、item resolver、空側対応hit-test、DOM列挙API
- 通常／集中モード共通viewport adapter
- `layoutMode`から独立した`isSmartphoneSelectionMode`判定と、`none | single | ambiguous`を入力別閾値へ結ぶinteraction policy
- mapped／mapless／legacy-unresolvedの`SpaceIdentity`、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、各canonical keyの型・正規化・生成契約
- 単一revisionの`VisitIdentityInputSnapshot`、`PhaseVisitProjectionSnapshot`、`buildProjectedPhaseVisits` app adapter契約、`planVisitIdentityTransitions(before, after)`。現行`NavigatorItem`を拡張せず、解決済みprojectionだけをspace-navigation consumerへ渡す
- `manualHallId`、hall definition／association／remap、mapped↔mapless、hall-unassigned↔resolvedを含むrekey triggerと、dangling manual hall／複数hall候補を推測解決しないexact reason
- exact番号grammar、巨大`BigInt`化前の桁数／辞書順safe integer検査、`mapped | mapless | legacy-unresolved | ambiguous` resolver
- 1-based `GridCellAddress`、整数`SubcellPathNode`、0-based連続`MapPoint`、結合セルbounds、routing adapter
- map-level authoritative fingerprint、entry-level block／location fingerprintと通常編集planner
- `SpaceSideIdentity`、`ResolvedRouteVisitPoint`、`SplitRouteSegment`、`RouteResolution`
- data-only `RoutePathConstraintV1`、polygon canonicalizer／fingerprint、inclusive point／segment predicate、route cache signature builder。runtime pathfinder接続はI10が所有する
- `planExecutionVisitOrderMutationV1`と`planHallRouteAndExecutionOrderMutationV1`のpure contract。永続Port／既存command接続はI7が所有する
- 分割線境界と低表示サイズ判定
- 表示用原文と識別用番号の分離
- 同一ブロック内の重複番号、重複block ownership、番号領域重複、merge越境をconnected component単位のcanonical local exclusionにし、単一componentで2～4原因が併発する場合も全`reasons`を固定enum順で保持して、影響外slotを`ready-with-exclusions`で継続するvalidation。入力／原因発見順shuffle、reason欠落／重複／順序差をnegative fixtureにする
- 重複物理`(row, col)`だけをmap-wide `map-data-untrusted`にし、local exclusionと同じbranchへ潰さないvalidation
- event名基準`auditLegacyFocusDayScopesV1`、注入allocator付き`proposeEventAuthorityAssociationsV1`、proposal／persisted association共通の`deriveDurableVisitScopesV1`／`loadPersistedEventAuthorityV1`、`LegacyFocusDayScopeRepairPlanV1` pure planner。DB open、IDB write、process-local Focus registry接続はI2／I7／I11が所有する

Exit:

- **EXIT-FSMC-I1-001** — 4方向、分割なし、全番号パターンのunit testが合格
- **EXIT-FSMC-I1-002** — 描画とhit-testが同じgeometry結果を使用する
- **EXIT-FSMC-I1-003** — 回転前後で同じ地図領域を示すproperty testが合格
- **EXIT-FSMC-I1-004** — preflight衝突0件では`01a`と`1a`が同じlocationへ解決され、衝突ありではpure `EventEnablePreflightResult`が`reject`と衝突原文・修正案を返してlegacy identityを維持する。I1ではruntime enable command成功／失敗を主張しない。同じsplit済み物理slot上で`26c`と商品枝番`26c2`は同じunsupported suffix `c` locationへ解決し、distinctな論理`LocationKey`集合は`{ 26, 26a, 26b, 26c／26c2, 26d, 26ab }`となる。source item snapshotからこの可変個数集合を導出し、whole／unsupportedだけがwhole-cell anchorを共有する。item／association入力をshuffleしても`eventItemIds`／`items`の同index exact bijection、両digest、index revision、location集合がbyte同値である。safe integer外や不正文法を数値化しない
- **EXIT-FSMC-I1-005** — 商品なしのa/b側をhit-testとDOM列挙の両方で解決でき、`whole`／unsupportedを「側未設定」と列挙する。重複番号、複数owner、番号領域重複、merge越境があるmapでも影響componentだけをcanonical exclusionにし、無関係なlocation、描画、訪問、route inputを維持する。重複物理`(row, col)`だけは`index = null`のmap-wide fatalとなり、両branchをshuffleしても結果がbyte同値である
- **EXIT-FSMC-I1-006** — maplessとlegacy-unresolvedを共有訪問projection用identityとして維持し、`MapLocationIndex`、geometry、hit-testへ架空のmap／block／cellを渡さない
- **EXIT-FSMC-I1-007** — `manualHallId` X→Y、X→未指定、未指定→X、hall削除、hall remap、mapped↔mapless、hall-unassigned↔resolvedが固定transitionへ一致する。stable hall IDの表示名変更では`LocationKey`、訪問順、route signatureを変更せず、dangling manual hallと複数候補を別hallへ推測接続しない
- **EXIT-FSMC-I1-008** — `ProjectedPhaseVisit`／`ProjectedVisitListRow`は同一`PhaseVisitProjectionSnapshot`から生成され、mapless／legacy-unresolvedを一覧から落とさず`canJumpToMap=false`とする。代表item、row／col、consumer独自番号parseからvisit IDを再構築しない
- **EXIT-FSMC-I1-009** — `VisitIdentityInputSnapshot`が単一event／day scope、items、重複なし`executionVisitOrder`、item ID順の追加phase tuple、明示3 fieldのsaved phase anchorのexact集合を満たす。currentはanchor nullでもphaseを保持し、event／day不一致、重複・未知・欠落・余分item、phase membership不一致はtyped error、projection 0件となる
- **EXIT-FSMC-I1-010** — 狭幅Desktop profileと`desktop-touch-context`は非スマートフォン規則、Mobile Chromium profileは全倍率pickerとなり、mouse／touchの閾値・曖昧帯の直前／一致／直後と0／45／90度のscreen空間順・DOM順・読み上げ順が固定期待値に一致する
- **EXIT-FSMC-I1-011** — `ProjectionDigestDescriptorV1`が実装の`PersistenceDigestDescriptor`と同じalgorithm／canonicalization／valueの3 fieldだけを持ち、checkpoint nullはabsent、presentは構造全体をdigestする。同committedRootでabsorbedCandidatesまたはupdatedAtだけが違うgolden、root順shuffle、不正descriptorをbuilder／schema／runtimeが同じ結果にする
- **EXIT-FSMC-I1-012** — event名／raw-day preflightはcollision時にID allocatorを0回、collision-free時も全anchorを先にtotal parseしてからevent集合とexact bijectionのproposalを1回だけ作る。anchor invalid／duplicate tokenの単独、および別event群での併発はcanonical reason集合、event名uniqueな全participant、全観測を拘束するdigest付き`event-authority-adoption-blocked`、同一eventのinvalid＋duplicate複合rowは型／schemaでreject、allocator unavailable／3回衝突はtyped proposal failureとなり、proposal／request／write 0件にする。proposal after-imageとpersisted associationから同じ`ResolvedEventAuthorityV1`／scope／event bases／aggregate digestを再構成し、association missing／extra、anchor missing／invalid／mismatch／duplicateの複合event-local集合、global複合reason、reason順shuffle／重複、witness／digest差、old proposal replayを拒否する。raw-day repair plannerはaffected eventの全semantic domainをtotal／injective／closedに写し、全day-scoped source集合のalias group間exact partition、present source↔assignment exact bijection、day-scoped＋event-wide hallを跨ぐglobal target injectivity、event-wide hall source、map request↔decision 6面、Focus source／target、retirable core absenceとpreserved queue archive integrityを一つのplanへ拘束する。複数event同relative keyを許すpositiveと、同event cross-group duplicate、2 rename→1 target、hall target容量不足、day／event-wide target衝突、zero-member execution partition rowをtyped rejectにする。可変なのは`distinctNormalizedDayScopeCount`／`executionBucketCount`／`hallDefinitionSlotCount`／`hallRouteSlotCount`の4 countだけで各決定式どおり遷移させ、`hallDefinitionEntryCount`／`hallRouteListCount`／`hallRouteItemReferenceCount`、execution reference exact-once、その他のcardinality／payload bytesを維持する。partial指定、many-to-one、domain外occupied target、choice不整合、physical drop／copy、Focus／external ABAをwrite authorityなしのtyped rejectにする

- **EXIT-FSMC-I1-013** — hallの1-based `{ row, col }`をexact `{ x: col - 0.5, y: row - 0.5 }`へ一度だけ変換し、既存utility／Canvasとnew DTOで同じpolygon／point／segment判定になる。`validateHallPolygonContractV1`をhall editor／import／Backup／routeが共有し、4頂点、面積`3.999…`／`4`、in-bounds covered cell 0／1件、自己交差の境界でerror code集合がbyte一致する。whole-map／選択hallのcanonical polygonでpoint、subcell隣接segment、simplification後segment、connector、same-cell directのinclusive predicateが同じ結果を返す。開始頂点／向きだけが異なる同一polygonは同じ`RoutePolygonFingerprint`、頂点／hall／revisionの単独差は別fingerprintとなり、検証済みpolygon fingerprintを含むconstraint fingerprint差でcache signatureが変わる。直値／二重offset／軸逆転、凹polygonを端点だけで横断する線、別map／hall、stale revision、polygon／fingerprint差を拒否する
- **EXIT-FSMC-I1-014** — execution visitのexact permutationだけを受理するreorder plannerとhall route＋execution order plannerが、raw item ID列／member相対順をbyte同値に保つ。`readOnlyExpectedRoots`はfull expected vectorのexact subsetであり、各full rowを`toProjectionInputRootRevisionV1`へ通したcanonical projectionだけが`executeModeItems` membershipとitem／association witness rootとのexact bijectionになり、resultへfull subsetと両witnessをbyte同値に返す。item／association rowはexact identity DTOのcanonical payload bytesと別domainのbranded digestを持ち、previewとcommitでfresh snapshotから再計算する。両witness digestは固有domainでroot／payload／orderを、自身を除いて拘束する。domain-separated preview digestはcommand ID／intent、scope／revision、before／after order、expected／read-only roots、両witness、nullable hall after-imageの全fieldを拘束し、resultが同値で返す。同値payload、payload 1 field差、canonical bytes差、item／association domain swapを含む各field／order／digest-only差、full subset／projectionの欠落・余分・変換差、item／associationの別snapshot、unknown／duplicate／missing visit、非全単射、stale basisをwrite authorityなしのtyped rejectへ写す

### FSMC-I2: ローカル制御、DB capabilityと保存基盤

実装:

- I0の`config/fsmc-capability-adoption.json`がprovenanceから`adopt-vcap`へ再計算される場合だけ、DB5／absence→採択済み`Vcap` bootstrap factory、`FsmcPersistenceSnapshot` 3 capability＋`capability-adoption-blocked`＋unsupported／upgrade-failedのopen-result、presence／progress protocol、repositoryを実装する。internal-testing production artifactは`databaseTargetMode = "core-current"`かつ`DB_VERSION = 5`を維持し、non-promotable QAだけが`fsmc-vcap-qa`を使う。既存profileではevent名day preflight collision-free、proposal／resolved scope、E0/E1と全非fence root／candidate selectorのH0/H1一致、導入trace 0件の場合だけ、event associationと必要なmetadata anchor、5 payload root、total historical evidence、actual participant集合、全baseline、6 capability rootのmetadata／checkpointを同一transactionで作る。raw day collisionはevent名基準canonical witness付きadoption-blockedとしてID allocator／versionchangeを開始しない。fresh profileは全factory-written non-fence rootをparticipantにする。production `DB_VERSION = Vcap`のownerはI11 release-ready candidateであり、本phaseでは変更しない。adoptionがalternative-witness-requiredなら本phaseを開始しない
- canonical `event-settings`／`event-settings-bridge` migration、`fsmc.internal.reconcile-event-settings-shadow.v1`、pending→shadow→synced resumeを実装する。pending commitはcore／event-settings／bridgeの`logicalRootMutationTuples`をparticipantにし、shadowがbeforeまたはtargetのときだけ続行する。ack transactionはevent-settings payloadをbyte同値に保ちつつ専用ack revision／metadata／checkpointをexact 1段進め、bridgeをsyncedへ進める。両rootだけをparticipantにしてhistorical external digest／baselineをtargetへ揃え、fence payload／metadata／checkpointの物理writeは別の`administrativeFencePhysicalWrites`としてmanifest照合する。第三値はcanonical commitをrollbackせずconflictへ止める。generic fence classifierよりこのstate machineを先に実行し、任意commandのbyte同値participant paddingを禁止する
- `core-current` artifactではsplit対象導入traceなし、`dbVersion === null || dbVersion < Vcap`、day preflight collision-freeだけを`core-only` terminalにできる。Vcap target artifactではnull／pre-Vcap resolvedをexact 1 upgrade requestへ進め、完全rootだけを`map-cell-split-v1`、`dbVersion >= Vcap`のstore／root欠落・非互換またはnull／pre-Vcapのsplit対象導入traceありを`map-cell-split-recovery-required`とする。raw day collisionはmaterialization後または元から存在するpresent pre-`Vcap` profileだけを、導入trace 0件のsnapshot外`capability-adoption-blocked`へ止める。legacy external coreも空のtrue fresh DB absenceにcollision fixtureを作らない。supported上限超過はsnapshot外unsupported open resultとし、通常core metadata／checkpoint／candidateだけをsplit導入traceへ数えない
- FSMC DB presence判定より先に10 core external candidateとstandalone localStorage `syncQueue`を別authorityとしてtotal観測する。core candidateが1件以上ならcurrent-version全10 core＋materialization receiptへ原子materializeし、core 0件＋queue presentならraw DOMStringを解釈せずarchive／journalだけを原子作成してcore payload、既存`syncQueue/data`、capabilityを0 writeにする。両branchともsourceを削除せずconnectionをcloseしてfresh attemptへ進めるため以後はpresent pre-`Vcap`であり、10 core candidateとqueueがともにabsentのときだけtrue fresh absenceを返す。retirementはbranded 10 core selectorだけをreceipt／trusted V1／journal／E0-E2で削除し、queueはbyte-exact archive integrityを維持する。receiptなし削除、queueのparse／core採用／retirement、same-attempt upgradeを禁止する
- `MapCellSplitSettingsRoot`、別keyの`MapCellSplitControlRoot`、association registry、active／retained entry、schema validation
- `FsmcPersistenceSnapshot`の3 capability unionと、`FsmcDatabasePresenceObservationV1`、`FsmcDatabaseOpenProgressV1`、attempt／request count／terminal ordinal／connection disposition付き`FsmcDatabaseOpenResult`、`(storeName, key)`ごとのfull observed root＋checkpoint＋authority別の型・配列へ分離したidentity／物理location／物理内容witness／absorption projection付きcandidate観測、root policy／lossless candidate vector付きtotal historical evidence／全historical row digest／participant digest／全governed root baseline付きexternal fence、inventory上の全potential candidate storeを空でも同一transactionへ含める専用atomic commandを持つrepository、facade、PersistenceCommandPort
- 固定旧版Aのcandidate／event-settings shadow差分をexact transition manifestへ対応付けるclassifierと、`rebaseParticipantRoots = sort(unique(changed legacy roots ∪ actualCapabilityWrites))`をtransaction instrumentation、置換historical row、participant digest対象へexact一致させるlegacy rebase／shadow reconcile writer
- 初期読込、autosave、再試行、更新ブロッカー
- recovery state、6.1.1のdiagnose／trusted-core export port／eligible atomic resetと、実profileの全object store／削除local keyを閉包検査する`DestructiveProfileCoverageV1`。各targetを`backup-covered | reconstructible-internal | uncovered`へexact 1件分類し、unknown／空だが未登録／schema drift／0件・複数coverageは`incomplete | indeterminate`として`unsupported-stop`、delete 0件にする。破壊直前もexclusive connection下でschema／record root／raw witness／inventory digestを再検査し、resume journalへcoverage manifest SHAとclosure digestを保存する。通常V2 restoreとresetを同じcommandにしない
- 現行CASへの参加と複数タブ競合表示
- raw-day repair向けにpreview時のexpected full core vectorとexact changed-root集合を受けるCAS primitiveを実装し、`LegacyFocusDayScopeRepairPortV1`へ提供する。現行after-only `commitApplicationSnapshotAtomically`からは到達不能にし、I2ではcontract／integration harnessだけ、I11でpre-adoption commandとproduction UIへ接続する
- `SplitMapLocalControlPort`、端末全体OFF、event別enabled、端末共通`forceSplitPicker`、同一profile内のcontrol CAS。`setForceSplitPickerAtomically`はhealthy rootの最新revisionを再検証し、device／event OFF中にもtoggleだけを保存できる。preview／enable／disable／picker preferenceのpublic登録はQAとrelease-readyだけとし、pre-release productionは内部codeが存在してもpublic registry／UIを持たず直接dispatchをwrite 0件で拒否する
- I0の`NormalizationCollisionRepairPort` allowlist dispatcher。I6／I7がowner commandを`implementation-enforced`にするまでは対応command IDと通常identity writerを`repair-command-not-implemented`で明示拒否し、通常writerを修復経路として代用しない
- pure `classifyLegacyCoreTransitionV1`と、利用者向けrepair allowlistから独立した内部rebase／event-settings reconcileを実装する。全legacy-mutable core、inventory上の全potential candidate物理store、5 payload root、fenceを同一transactionでlock・再読込し、healthyな旧版差だけについてassociation／status／durable visit transition／canonical event settingsとfence history／baselineを原子的に進める。authority正常な`rebase-required | pending`に限りdevice／event／readiness状態に依存せず実行し、完了までsplitをlegacy fallback／read-onlyとする。recovery-required安全モードでは実行しない
- 初回event enableに必要な既存event／day-map／block slotへのローカルinstance ID、empty-source metadata anchor、registry associationを一意なcurrent coreから同一transactionでbootstrapする最小経路。I3はこの共通APIを全event lifecycle writerへ拡張する
- DB／store／root／association authority不正は自動安全モード、個別binding不正はentry単位隔離とする。OFF時はsplit固有部分をlegacy resolver・保存・UI経路へ戻す。本phaseは`PD-14.C2`／`C3`用port／after-image hookと基準source挙動のnon-regressionだけを所有し、共有projection・挿入・経路conformanceの完成を主張しない
- QA database namespaceの初期controlはdevice OFFかつevent ID一覧空とし、readinessを`internal-testing`へ進める。productionはDB5・public command未登録を維持し、QA buildだけが後続testでONにできる
- 初期索引と15,000件schema validationのDesktop／Mobile性能scenarioを本phaseから強制する

Exit:

- **EXIT-FSMC-I2-001** — non-promotable QA artifact／integration harnessで、通常core traceだけのpre-`Vcap` profileはevent名day preflight collision-freeかつproposal／scope resolvedの場合だけbootstrapへ進み、導入traceが1件でもあればwrite 0件で拒否する。raw day collisionならcanonical witness付き`capability-adoption-blocked`を返し、ID allocator／`Vcap` request／capability write 0件とする。採択時はproposalとexact一致するevent association、必要なmetadata anchor、5 payload root、total historical evidence、全row digest、profile別actual participant集合、全baseline付きinitial fence、6 capability rootのmetadata／checkpointが同じversionchange commitに存在する。existing profile participantは`{ data, control, durable-visit-state, event-settings, event-settings-bridge } ∪ actualAnchorMutationRoots`、fresh profile participantはfactory-written全non-fence rootとし、actual write log／置換row／digest対象がexact一致する。`actualAnchorMutationRoots`はanchor createが1件以上のときだけexact `{ (eventMetadata, data) }`、全preserve時はemptyで、非参加legacy rootはbyte不変となる。E0/E1差は全abort、commit前は旧version／storeなし、commit後は採択済みVcap／association・anchor・全6 root完全初期化のどちらかだけとなる
- **EXIT-FSMC-I2-002** — non-promotable QA artifact／integration harnessのVcap profileを固定旧版Aが開き、従来データを読み書きできる
- **EXIT-FSMC-I2-003** — 固定旧版Aの実行中は新storeのchecksumが変わらず、新版Bへ戻した起動境界でだけroot policyに従うrebaseまたはrecovery判定が行われる
- **EXIT-FSMC-I2-004** — 固定旧版Aのanchor保持改名・通常状態更新は`rebase-required`となり、同じanchor／bindingの設定bytesとstored ONを維持したままfenceを更新してactiveへ復帰する。固定旧版Aによる説明可能なevent削除は`data`／`control`／`durable-visit-state`を必須participantにし、current association／enabled membershipを除去して全entryとbasis 4 fieldをbyte保持した`retiredEventPartitions` exact 1行へ移す。新版の確認済みdeleteはretired化せず、current durable slice／basis／associationを宣言どおり同一commitで除去する。anchor missingはdormant、invalid／duplicateはcanonical reasonに従うquarantined／blocked、旧版編集で作られた番号衝突はstored ONを保つevent単位effective fallbackとなり、別ownerへの自動接続と黙示durable state削除が0件である
- **EXIT-FSMC-I2-005** — non-promotable QA artifact／integration harnessで、`Vcap <= dbVersion <= supportedMaximumVersion`の新store欠落・空store・片root／metadata／checkpoint欠落・非互換、fenceの埋込全historical row digest／participant digest／candidate vector自己不整合、root universe／capability-owned baseline不一致はsplit痕跡の有無にかかわらず`map-cell-split-recovery-required`となり、DBを変更せず従来機能、分割機能利用不可理由、6.1.1の復旧runbookを提供する。healthyなlegacy-mutable core差はこの不一致へ含めない。`core-current`だけはDB absenceまたは`dbVersion < Vcap`＋導入trace 0＋day preflight collision-freeを`core-only` terminalにできる。Vcap targetのabsence／pre-Vcap resolvedは0→`Vcap`へ進み、absence／pre-Vcapで導入traceありはrecovery-required、raw day collisionはsnapshot外`capability-adoption-blocked`、canonical witness、upgrade／capability write 0件となる。各snapshot／open-result分岐でpresence、target mode、禁止fieldがexact一致する
- **EXIT-FSMC-I2-006** — non-promotable QA artifact／integration harnessで、FSMC open前のexternal tri-stateをexactに処理する。10 core sourceが1件でもpresentなら同一`E0`からcore-currentへmaterializeし、syncQueueはpresentならbyte-exact archive、absentならabsence witnessを残して全external sourceをcloseする。core 10件が全absentでsyncQueueだけpresentならqueue-only archive receiptを作ってcloseし、両方absentになった次boundaryだけをtrue fresh候補へ進める。DB absent、10 core source absent、standalone syncQueue absentが同時に再観測された場合だけstrict true freshとする。DB absence resolvedはprobe 0件、exact 1 upgrade request、`onupgradeneeded.oldVersion = 0`、`Vcap - 1` resolvedはH0 transaction settle→probe close→exact 1 requestとなる。`Vcap`／supported上限の互換storeありはno-upgrade snapshot、absence／pre-`Vcap` collisionは`capability-adoption-blocked`、`supportedMaximumVersion + 1`以上はsnapshotを構築しない`unsupported-database-version`としてconnection close・authority非採用・write 0件となる。`onblocked`は非terminalで、blocker close後に同じrequestが再開し、error／abortはterminal ordinal 1へdedupeする。successは`request.result`をhandoffしてreopen 0件とする。現行5／6／7／8 fixtureはpresence／scopeを含む同じ境界generatorの期待値と一致する
- **EXIT-FSMC-I2-007** — `databaseTargetMode = core-current`かつabsence／`dbVersion < Vcap`・day preflight collision-freeのcore-only profileは現行core autosave契約を維持してsplit commandを登録しない。adoption-blockedはtrusted core V1退避／collision診断とI11所有repairのcontract stub以外を登録せず、通常autosaveとhall normalizationをgateする。QAのhealthy split-capable profileだけは制御commandを登録し、機能mutationをeffective ONで許可する。pre-release productionはDB5、public registration 0件、direct dispatch write 0件を維持する。地図・association・split binding・control・イベント復元は必要rootを原子的にcommitし、片方だけのcommitを起こさない
- **EXIT-FSMC-I2-008** — 新storeの保存失敗が未保存表示とPWA更新抑止へ反映される
- **EXIT-FSMC-I2-009** — 同時writerのstale保存が`PersistenceConflict`となり、部分commitとlast-write-winsが起きない
- **EXIT-FSMC-I2-010** — 既存fenceと全governed rootのexternal E0が不一致、またはraw string exact比較でE0→E1が変化した場合、差がhealthyなlegacy-mutable coreだけなら通常commandをwrite 0件で止めて`legacy-rebase-required`へ送り、それ以外は`PersistenceConflict`／recovery-requiredとする。IDB commit後・UI ack前のE1→E2差もlegacy-onlyなら全new IDB root＋fenceを維持した`committed-legacy-rebase-required`、それ以外は`committed-recovery-required`とする。IDB candidateは表示上のsourceや現在件数でscopeを決めず、inventory上の全potential物理storeを空でもtransactionへ含めて再読込する。pre-transaction canonical bytesとの同期exact比較でempty→insertとidentity／location／physical content／projectionのstaleを全abortし、transaction内で非同期hashを待たない。別scope commandで非参加historical row／baselineを失わず、未保存／rollbackと誤表示しない
- **EXIT-FSMC-I2-011** — DB契約、検証script、integration fixture、性能test configが同じversion契約を示す
- **EXIT-FSMC-I2-012** — `verify:architecture`が合格
- **EXIT-FSMC-I2-013** — 同一sourceの`internal-testing` production artifactはDB5のまま、capability store、split metadata／checkpoint／fenceへのopen／create／writeとpublic split command registrationが0件である。production／QA manifestの`databaseTargetMode`、origin、実open versionが一致し、取り違えをverifierが拒否する
- **EXIT-FSMC-I2-014** — DB capability正常、端末全体ON、対象event ON、自動安全モードなしに加え、`release-ready` production、または`internal-testing`かつcompile-time QA overrideを持つnon-promotable QA artifactの場合だけsplit mutationが成功する。`contracts-only`／`internal-testing` productionはcontrol rootがONでも拒否する。event OFF→ON preview／commandとOFF commandはOFF中にも利用できる
- **EXIT-FSMC-I2-015** — I1の`EventEnablePreflightResult`とresolved event authority builderをevent OFF→ON transactionへ接続し、既存の通常eventとempty-source eventの両方で必要なinstance ID／anchor／associationをI2 bootstrapが原子的に作る。既存profile bootstrap後のreloadはpersisted association＋anchorからproposal時と同じlogical partitionを再構成し、migrating rootのzero-scope rowを含む`eventBases`、per-event core／authority digest、aggregate両digestと一致する。anchor invalid／duplicateのcanonical blocker、association／anchorのevent-local rejected partition、global reason集合、番号衝突またはauthority不一致ではcontrolをONにせずcore、settings、association、metadata、checkpoint、物理location付きrecovery candidate vector、fence baselineを全て旧状態に保ち、理由と修正案を表示する。preview後のroot変更も再検査してstaleなら全abortする
- **EXIT-FSMC-I2-016** — device OFF中にlegacy編集で一部enabled eventへ衝突を作った後にdevice ONへ戻すと、device ON自体は成功し、衝突eventだけがstored membershipを維持したeffective fallback、他のenabled eventがeffective ONになる。I2時点では未所有の3修正commandと通常identity writerを明示拒否し、syntheticな「修正成功」を主張しない
- **EXIT-FSMC-I2-017** — 端末全体OFF／event OFF、別タブによる制御revision変更、再起動、オフラインで固定期待値どおりになる。オフラインだけを理由にOFFへしない。authority正常なlegacy rebaseはdevice／event OFFとreadiness不足でも完了でき、recovery-required安全モードではwrite 0件で拒否される
- **EXIT-FSMC-I2-018** — payload／metadata／checkpoint／fallback／candidate vector、fence evidence／全row digest／participant／root universe／baselineの部分欠損・変化と、`dbVersion >= Vcap`の空storeを未初期化と誤認しない。全potential IDB storeを空でもtransactionへ含め、content-only／projection-only差はexact transitionだけをrebaseする。legacy rebase／shadow reconcileはactual write log、`rebaseParticipantRoots`、置換historical row、participant digest対象をexact一致させる。H0後のpayload／metadata／checkpoint／candidate／external差はfirst write前に全abortし、transaction内async hashを使わない。unknown store／local keyまたはcoverage不完全なguided deleteはconfirm／dispatch不能、write 0件とし、全profile消去だけをverified-complete closureからclean-startする
- **EXIT-FSMC-I2-019** — control変更中、QuotaExceeded、通常commandの各failure barrierのcommit前abortでは全root旧状態、commit後・UI通知前の終了では全root新状態となり、部分commitがない。legacy rebaseのR0→R1差はwrite 0件で再判定し、commit前abortではcurrent core＋rebase前fenceの`legacy-rebase-pending`、commit後終了ではcurrent core＋new fenceだけとなる。R1→R2の追加healthy legacy差は次のrebase、capability-owned／分類不能差はrecovery-requiredとなり、次回境界でも同じ決定結果になる
- **EXIT-FSMC-I2-020** — OFF時のsplit固有表示、番号identity、whole-cell位置解決、core保存結果は固定旧版Aに一致する。本phaseのQA artifactではDB version、capability store、read-only split payload、optional `EventMetadata.splitIdentityAnchor`、I0 inventoryで基準sourceに存在した`PD-14`差分、重複物理cellを新規作成するafter-image拒否、既存重複の`map-data-untrusted`判定だけをphase-aware許容差分とする。`PD-14.C2`／`C3`の新規差分を前倒ししない。production artifactはDB version／capability store差分も持たず、重複を作らない同一入力のcore保存結果、anchorだけを正規化除外したlegacy-core checksum、それ以外の全core field、raw item ID・番号原文を一致させる
- **EXIT-FSMC-I2-021** — `FSMC-I2-RECOVERY-RESET-ATOMIC`と`FSMC-I2-RECOVERY-INELIGIBLE-ZERO-WRITE`が、eligible resetの全旧／全新、store欠落・schema非互換・core不正のwrite 0件、reset後のhealthy再openまでを検証する。event-settings／bridgeまたは対応metadata／checkpoint／candidateの欠落・不正・pending／conflict・shadow不一致はin-place eligibilityを必ず閉じ、両rootがtrusted／syncedの場合だけbyte同値で保持する
- **EXIT-FSMC-I2-022** — 本phase担当のDesktop／Mobile性能上限を満たし、未担当scenarioを合格済みにしない
- **EXIT-FSMC-I2-023** — event-settings migration、IDB commit→shadow前、shadow→ack前の各crashがpendingから冪等再開し、before／target以外のshadowはcanonical rootをrollback・上書きせずconflictとなる。create／rename／delete用root adapterのschema、`logicalRootMutationTuples`、別管理のadministrative fence write集合、ack専用のbyte同値payload＋revision／metadata／checkpoint after-image、generic classifierよりbridgeを先に処理する順序がcontract testに合格する
- **EXIT-FSMC-I2-024** — destructive coverage snapshot→delete再検査間にunknown store／record／local key／schema driftを追加するfixtureはdelete 0件となり、既知target全件がbackup-coveredまたは証明済みreconstructible-internalのときだけguided resetを許す

- **EXIT-FSMC-I2-025** — control factoryは`forceSplitPicker = false`、利用者toggle後はreload／offline／event切替で同値、明示OFFまたはprofile resetだけで解除される。toggleはdevice／event enabled membership、settings、coreをbyte保持し、stale revision／untrusted rootではwrite 0件となる。Backup V1／V2にfieldがなく、untrusted／未読時のselection policyだけがeffective trueへ倒れる

### FSMC-I3: イベントIDとライフサイクル

実装:

- I2の初回enable bootstrap APIを、作成、改名、source switch、bulk add、復元、削除、複製を含む全event lifecycleへ適用し、既存event／地図／blockの未発行分をbackfillする
- 現行event／day-map／block slotとinstance IDを結ぶassociation registryの全writer conformance
- URLなしイベントを含むempty-source `EventMetadata`、registry anchor tokenとの一致検証
- 作成、改名、削除、複製と、retained entryの端末内再関連付けbackend。Backup restoreのwire parse・全置換はI4が所有する
- I0 writer inventoryのうち現存するsource switch、既存event bulk add、item-only／V1 full import、XLSX、改名、複製、削除・同名再作成を「発行／保持／remap／意図的除去」matrixどおり実装する。I4のV2 restore等の将来writerには共通anchor policy APIとcontract testを提供し、各owner phaseで`implementation-enforced`へ昇格する
- source switch、既存event bulk add、既存V1 full importを含むI3時点の全identity writerへ`PD-16` after-image validatorを適用する。担当phaseが後のwriterは実装されるまでevent ON中のcommand登録を拒否し、部分的な旧validatorで通さない
- ID衝突、ID欠落、active／dormant／quarantined処理
- 同名イベント再作成の誤接続防止
- 新しい実体の複製時だけの新ID発行。別日程・別地図・別ブロックへの設定コピーは初版commandへ含めない
- 新規`fsmc.event.duplicate-full.v1`／`planFullEventDuplicateV1`／`duplicateWholeEventAtomically`を実装する。現行`create-alias`を呼ばず、sourceの10 core root、canonical event settings、association、active／retained split、durable visit stateを単一snapshotでpreviewし、event／item／map／block／hall／entry／historical owner IDをgroup-preservingかつsourceと交差0へremapする。route／location／visit keyは文字列置換せずafter-imageから再生成し、destinationは必ずlocal OFF、source rootはcommit前後byte同値、stale／name conflict／ID collision／quota／bridge未完了はwrite 0件とする
- イベント削除時の「30日保持」既定、即時完全削除、35日超の未観測進み・rollback・session内jumpで24時間確認を要求する期限cleanup

Exit:

- **EXIT-FSMC-I3-001** — 新版での作成・改名・削除がcore、association／anchor、canonical event settings、split／control、durable entry／`eventBases` 4 field／aggregate両digest、metadata／checkpoint／fenceのall-old／all-newとなる。rename-onlyはcore basis digestをbyte維持してauthority basisだけを更新し、legacy mirror失敗時はcanonical rootを戻さずpendingから再開する
- **EXIT-FSMC-I3-002** — イベント全体複製はsource全root不変、targetとのlocal ID交差0、fresh event ID／anchor／basis exact 1行、全参照のgroup-preserving remap、source durable execution order／phase／current・saved・purchase anchor／additional phase／completionのfresh item・visit IDへのlossless remap、destination OFF、route／hover／dialog等memory-only状態非複製を満たし、取消／stale／quota／重複名／retained／dangling hall／非execution item fixtureが成功する。plain create用defaultをwhole duplicateへ流用せず、import競合`create-alias`をこのcommandとみなすproduction edgeは0件である
- **EXIT-FSMC-I3-003** — 旧版で改名した場合は同じevent IDのbasis name／authority digestをrebaseし、旧版で削除した場合はassociation／controlを除去してbasis 4 field／durable entriesをbyte保持するretired exact 1行へ原子的に移す。reload後もpublic edge 0であり、同名再作成へ誤接続しない。局所化不能な旧版差は自動削除せずrepair-requiredにする
- **EXIT-FSMC-I3-004** — 旧版がanchorを保持する操作ではIDを維持し、anchor欠落／invalid／重複時はcanonical rejected reasonとwitnessを保持して名前や指紋だけで再接続しない
- **EXIT-FSMC-I3-005** — 安全に識別できない設定は地図へ表示せずretained entryとして保持し、I5の管理UIから理由を確認できるbackendを提供して既存dataを壊さない
- **EXIT-FSMC-I3-006** — 名前だけで再接続せず、端末内の手動再関連付けと明示削除が可能。設定単独出力の入口は初版に設けない
- **EXIT-FSMC-I3-007** — event削除previewはdurable visit slice／event basisの削除件数と30日保持がsplit設定だけであることを明示し、取消／stale／quotaでは全旧、確定時だけcore、association／control、durable slice／basis削除とsettings retained化を同一commitする。新版deleteはretired durable rowを作らない。D+29は設定を保持、trustedなD+30は対象settingsだけ削除、31日offlineは正常削除、36日offline・rollback・session jumpは24時間確認後まで延期する。再関連付けと削除はCASで原子的に行い、設定単独出力は提供しない
- **EXIT-FSMC-I3-008** — source switch、bulk add、既存V1 full importがON中に新たな正規化衝突を作るfixtureで全root旧状態とONを維持し、未実装writer commandは明示拒否される
- **EXIT-FSMC-I3-009** — `useEventUpdateCommands`→`applyPendingEventUpdate`のCSV由来update／source switch、`useShoppingItemMutationCommands`→`buildBulkAddEventMetadata`の既存event bulk add、item-only／V1 full import、XLSX 2.2 writerの成功caseで、event ID／anchorを方針どおり保持し、core変更時は対象`DurableVisitEventBasisV1`のbasis core digest、必要時はauthority basis、rootの`basisCoreDigest`／`basisEventAuthorityDigest`、影響durable entryを同一after-imageから再計算する。core、association／metadata、entries、eventBases、両aggregate、checkpoint／fenceはall-old／all-newで、identity非変更ならbyte同値durable sliceを不要writeせず、identity変更をdurable participantなしでcommitするwriter edgeを0件にする

### FSMC-I4: イベント単位Backup V2とV1互換core

実装:

- イベント単位Backup V2
- V1 wire shapeの凍結、V2 representability成功後に同じsnapshotからlossless生成を試みるoptional V1互換core、pair／V2-only handoff、Backup V1／XLSX 2.2 full restoreの共通legacy restore plannerとdormant preview
- event `scope.references`とruntime snapshotから分離した明示core／durable visit wire DTO、`snapshotToBackupWireV2`、`backupWireV2ToRestorePlan`。wire moduleから`AppData`／persistence型をimportしない
- 単一eventRef＋全mapRefs、map-level fingerprint、active／retained portable union、`companionCore`のincluded／unavailable exact unionとpair／issues digest
- production writerはcanonical `eventSettings`とportable `durableVisitState`を`full-split`の対象event exact sliceとして同じreadonly IDB snapshotから出力し、`item-only`では両方をtop-level `null`にする。reader-only `core-map`はsynthetic fixture／外部入力のnon-null両sectionを検証するが、writer adapterやserialize commandへ接続しない。full／core restoreはfresh item ID remap後にgroup／phase anchorを検証して復元先event instanceへ同一commitで適用し、item-onlyはdestination settings checksumを維持しつつdestination durable stateをtransition plannerでrekeyする
- retained priorOwner用にcurrent map／block refsとnamespaceを分けた`historicalOwnerRef = o-NNNNNN`と`ownerKind`付きhistorical owner tableを発行する。historical block parentはcurrent `mapRef`またはhistorical map ownerのexact unionとし、current map＋deleted blockをlosslessに表現する。current parentは同じmanifestへ一意に解決できる場合だけ付け、historical owner refごとに必要なfresh local IDを1回発行して外部ref文字列をruntimeへ保存しない
- `src/features/map-cell-split/backup/backup.worker.ts`、`workerServer.ts`、`workerClient.ts`、`workerProtocol.ts`を実装し、`BackupRestoreDialog.tsx`／`backupRestore.ts`／`appBackup.ts`に加えて、export file生成とJSON `file.text()`／XLSX `file.arrayBuffer()`を現在所有する`src/app/commands/useEventTransferCommands.ts`へclient Portをcomposition注入する。current commandのwhole-file readをWorkerのbounded slice protocolへ置換し、UI／command／`App.tsx`側に別readerを残さない。UTF-8 fatal decode、duplicate-property scanner、非再帰depth／token scanner、same-origin module Worker、bounded slice／error、cancel cleanupを実装し、既存XLSX Workerと同じVite module asset、PWA precache、`worker-src 'self'` CSPへ登録する。`blob:`／`data:` fallbackを作らない
- 壊れた設定の原子的拒否
- イベント復元の全置換previewと、アイテムimport時の設定維持
- portable参照のローカルID remap、端末内ON／OFFの非収録、新規復元OFF、既存復元先状態維持
- 1主端末、復元先全置換、復元前退避案内、自動同期・自動merge禁止
- 32 MiB performance保証／file、V1／V2 JSON 64 MiB import hard limit／file、XLSX 2.2 compressed 32 MiB＋既存展開limitを形式別に適用する。exportはincremental canonical UTF-8 sinkで測った最終V2実byteLengthが32 MiB超ならtyped `v2-export-failed`／artifact 0、V2が上限内でcompanion V1実byteLengthが32 MiB超またはpair実byteLength合計が48 MiB超なら`companion-v1-resource-limit`付きV2-onlyとし、V1のためにV2を停止しない。estimateは確実な早期lower-bound stop以外の判定に使わない。`PreparedArtifactByteSinkV1`、temporary spool 64 MiB、generation timeout 300,000 ms、reason別failure witnessは`config/fsmc-backup-limits.json`実bytesのSHAとexact field値へ拘束し、timeout／cancel／sink error後はhash state、chunk、spool、handleを0件へcleanupする。JSON import best effort、XLSX hard stop、pair／V2-only／V2 export failureを方向別command結果にする
- V1層別互換matrixを維持し、V2だけを全階層exact unknown-key rejectにする
- Backup V2 digestと未知version／未知scope拒否
- scope別exact core section tuple、`deriveEventBackupCountsV2`による実payload件数一致、retained `number`／`originalNumberToken`整合、active／retained owner overlap拒否
- event保証上限超過時は出力を停止し、読めないファイルやmultipartを初版で生成しない
- 全参加storeの単一readonly transactionから`SplitCapableEventExportSnapshot`を1回だけ作る。V2を必ずこのsnapshotから生成し、companionを作れる場合だけV1も同じsnapshotから生成する。export途中のDB再読込、cross-revision pair、included分岐のV1／V2 core不一致、unavailable分岐のcompanion handle混入を拒否する
- `__proto__`／`constructor`／`prototype`を利用者名として安全にround-tripするdynamic key処理
- UIは`File.size`だけを検査して`File`をWorkerへ渡し、main threadで`file.arrayBuffer()`／`file.text()`を呼ばない。Workerは1 MiB sliceでstreaming decode／scanし、raw bytes、全文string、DTOの三重保持を避ける
- `classifySafeExternalUrl`とbranded `SafeExternalHref`をV1／V2／XLSX／CSV／通常編集、`CellItemsPopup`、`ShoppingItemCard`へ適用する。V2／CSV／新規編集のunsafe URLは全拒否、V1／XLSX 2.2／既存profileは`legacy-compat`でraw textを維持して非link表示にする。空文字、control／bidi code point全境界、strict／legacy policyのarchitecture testを持つ
- `PersistenceCommandPort`へasync readonly event export snapshot、atomic restore、recovery trusted-core exportを追加し、concrete IDB処理は`src/persistence`だけが所有する。`useEventTransferCommands`はportを呼び、`appOverlayState`をV1／V2／XLSX 2.2 preview unionとWorker lifecycleへ更新する
- Backup import／exportのDesktop／Mobile性能scenarioを本phaseから強制する
- event ON中のimport／restore after-imageが正規化衝突を新たに作る場合の`PD-16`全拒否

Exit:

- **EXIT-FSMC-I4-001** — V1、XLSX 2.2 full、地図を含むがsplitを含まないV2を読め、map置換では対象の既存split設定をpreview後にdormant化し、V1／XLSX 2.2 item-only importでは維持する
- **EXIT-FSMC-I4-002** — 複数地図eventのV2で4方向とactive／dormant／quarantined、execution visit order、3 phase anchor、completion、購入変更anchorを新版へ往復できる。companion losslessなfixtureはV2がSHA-256で拘束したexact V1互換coreを固定旧版Aへ復元でき、companion不能fixtureは同じV2内容を`structural-v2-only-prepared`で新版へ復元できる一方、旧版fallback不可を出力前後に表示する
- **EXIT-FSMC-I4-003** — 簡易XLSX・CSVに分割設定が含まれない
- **EXIT-FSMC-I4-004** — mapDataを置換する復元だけが設定を同時に置換またはdormant化し、full／core restoreはportable durable visit、destinationの`DurableVisitEventBasisV1` 4 field、aggregate両digestを同一commitでremapする。existing destinationはlocal event ID／anchorを維持し、新規destinationはfresh ID／anchor／basis exact 1行を作る。item-only importでは設定checksumを維持し、destination durable stateとcore basis digestだけをtransition plannerでlossless rekeyする
- **EXIT-FSMC-I4-005** — external refをローカルinstance ID／`priorOwner`として採用せず、未解決entryには新しい`dormantEntryId`を発行し、不正参照・hard limit超過をDB更新前に拒否する
- **EXIT-FSMC-I4-006** — 形式不正は全体拒否し、復元先不一致だけをdormant／quarantinedとして保持する
- **EXIT-FSMC-I4-007** — V2 digest不一致、未知version、未知scope、local ON／OFF fieldを拒否する
- **EXIT-FSMC-I4-008** — `full-split` writer→readerは明示wire DTOの対象event全10 core section、event settings、durable visit stateを欠落なくround-tripし、synthetic `core-map`はreader→restore planだけを検証してproduction serializerの戻り、registry、dispatchを0件にする。`eventLists`／`eventMetadata`はexact 1 row、残る8 sectionは各々source absentの`[]`とpresent-emptyの`[row]`を区別してdesired absence／presenceへ復元し、同値after-imageはphysical write 0件にする。`item-only`は`eventLists`以外のdata sectionと3 top-level sectionの非null値を拒否する一方、全scope共通hall descriptor tableでresolved manual hallを検証し、既存destinationのexact／明示mappingだけを許し、新規destinationの対応hallなし、0候補、stale／noninjective choiceをwrite 0件にする。runtime section追加は自動伝播させずadapter exhaustiveness testとschema version判断を要求する。valid map owner／valid mapless ownerをXORで分類し、dual match、orphan slot、event-wide unscoped ownerをtyped V2 blockerにする。HallVisitListとhallOrderはnormal／priority／highest、unassigned、missing-unresolved、malformedをsource順で検証し、manual／visit group／hall-orderの3面で同じdangling baseをgroup-preserving remap、異なるbaseをinjectiveに分離する。ambiguous hall owner、unknown extension、unsafe URL、strict scalar／structural違反のようなV2 core blockerはV2／pair 0件とし、eligibility matrixと凍結V1→current reader→固定旧版Aのlegacy-core projectionがbyte一致する場合だけcoverage／excluded roots／warning付きtrusted-core-only fallbackを許す。V2 representableだがcompanion auditが不成立の場合はcanonical issue集合／digestを持つ`structural-v2-only-prepared`を生成し、V1／pair handleは0件とする。pairはexact pair digestとrole-specific immutable handleを再hashし、片方だけhandoffした場合はtyped incomplete／完了通知0件／same-pair再生成案内とする。V2-onlyはnull pair digest、issues digest、exact 1 V2 handleを再hashし、V2 receipt成功時だけ完了通知する。3 reader scopeそれぞれで全7 countを実payloadから再計算し、正しいdigestでも過少・過大自己申告、reference水増し／省略を拒否する。portable durable day集合はnonexecution itemだけの日、standalone empty day、group 0件entryを含めexact bijection、groupと再構築identityもpairwise uniqueなexact bijectionとし、retained number／token、active overlap、anchor／phase不整合を全体拒否する
  I4-008のV2 success matrixはscope→export→prepared artifact→verification→handoffまで`pair | structural-v2-only | resource-v2-only`を同じ判別子で閉じる。V2 core blockerでeligibilityと3 projection digestが成立する場合だけ、別系列の`v2-unrepresentable → standalone-v1 prepared → standalone-v1-verified → standalone-v1-completed | standalone-v1-incomplete`を許し、警告未確認はverification rejected／handoff attempt 0件とする。`v2-export-failed`は7 reasonのexact witness／digestを持つartifact 0件の終端であり、standaloneへ接続しない。pairは2 artifact／non-null pair digest、各V2-onlyは1 V2 artifact／null pair digest／reason相関issuesだけを許す。issueのpath／kind／payload、reason、順序、digest、artifact数、guidanceの各1 field mutationと不可能なcross-combinationを拒否し、失敗結果を`pair-incomplete | structural-v2-only-incomplete | resource-v2-only-incomplete | standalone-v1-incomplete`へ分離し、reason／witness／artifact数／warning acknowledgementのcross-branch交換を拒否する。

- **EXIT-FSMC-I4-009** — fullのcanonical event settingsとportable durable visit stateはwriter→readerをexact round-tripし、reader-only coreは同じ両sectionをrestore planから復元先へexact適用する。item-onlyは既存destination settings checksumを維持してdurable transitionを同一commitし、新規destinationは決定的defaultとなる。V1／XLSX 2.2 full restoreも既存durable stateを一意移送し、要修復値を自動破棄しない。全restoreでcore、association／anchor、entry、basis 4 field、aggregate両digest、fenceがall-old／all-newとなり、reloadで再計算一致する。V1 companionも同じIDB snapshotから生成し、bridge pending／conflict中はpair 0件である
- **EXIT-FSMC-I4-010** — deleted map、current map＋deleted block、同じmissing owner共有、見た目同一だが別owner、current-linked active overlapのfixtureでhistorical owner同値関係とinjective remapを往復し、owner tableのduplicate／orphan／multi-link、外部owner ref永続化を拒否する。同じ`historicalOwnerRef`を参照する2 entryで`lastKnownMapName`が一方absent・他方present、または両方presentで異値のfixtureをlosslessにround-tripし、entry-local診断値をowner tableの代表値へ集約しない
- **EXIT-FSMC-I4-011** — 保証上限内でV2／companion双方がrepresentableな自アプリ出力はprepared pair→handoff→reader→restore planをround-tripし、pair metadata／bytes／digest、10 section presence、portable refs、hall descriptor、durable identityを再検証できる。V2 core blockerはtyped issue＋legacy-core-only fallback eligibilityを返してV2 0件とし、eligibleかつ凍結V1→current reader→固定旧版Aの3 projectionがbyte一致する場合だけwarning付きstandalone V1をprepared→acknowledgement→verification→handoffへround-tripする。未確認、metadata／projection digest差、receipt失敗はhandoff attemptまたは完了通知0件とする。V2 representableだがcompanion V1 blockerまたはV1／pair resource上限がある場合は値をdrop／丸めず、canonical issue／digest、null pair digest、exact 1 immutable V2 handleを持つV2-only→handoff→reader→restore planをround-tripする。V2 receipt失敗、V2-only警告未確認、issues digest差は完了通知0件とし、超過V1／pairを生成しない。V2最終byte超過、fixed-point非収束／drift、timeout、spool違反、cancel、sink errorはreason別bounded witnessとconfig SHAを再検証して`v2-export-failed`／artifact 0件とし、reason差替え、fixed-point state／sink receipt／source binding／self-validation／immutable witness／handoff receiptのfield・digest差、standalone接続を拒否する
- **EXIT-FSMC-I4-012** — hall definitionsの`owners[].halls`と各hallのraw `blockNames`はsource順をexact round-tripし、`blockNames`の重複、optional absent、present-emptyを区別する。hall ID重複はtyped structural blocker、reference manifestだけをcanonical sortし、payload halls／blockNamesをsort・dedupeするwriter／readerをgolden差分で拒否する
- **EXIT-FSMC-I4-013** — clean profileへの新規復元はOFF、既存イベントへの復元は復元先のローカル状態を維持し、両端末の変更をmergeせず選択したV2へ原子的に置換する
- **EXIT-FSMC-I4-014** — 本phase担当のDesktop／Mobile性能上限を満たし、pair片方、V2-only本体、standalone V1本体のhandoff失敗を完了扱いにしない。`v2-export-failed`は全reasonでhandoff attempt／prepared artifact／残留spool 0件となる
- **EXIT-FSMC-I4-015** — ON中に衝突を作るimport／restoreはcore、settings、association、controlを一切変更せず、復元先eventをONのまま維持して衝突原文と修正方法を表示する
- **EXIT-FSMC-I4-016** — 同時writerを挟んでもV1とV2が同一source SHA／snapshot revision／canonical root vector／snapshot digestを表し、明示transform以外のcore差がなく、片方だけを別revisionから再生成しない。root順shuffle、BMP／astral key順、1 root／sliceだけ別snapshot、prepared／verification／receiptのbinding差をhandoff attempt 0件で拒否する
- **EXIT-FSMC-I4-017** — XLSX 2.2 full restoreはpreviewどおり既存activeだけを`legacy-full-restore-without-split-settings`でdormant化し、既存retainedのstatus／reason／evidence／IDをbyte同値で維持してcore／association／controlと同一commitになる。item-onlyではmap／split／control checksumが不変である。取消、stale、quota、commit前終了は全旧、commit後終了は全新だけとなる
- **EXIT-FSMC-I4-018** — `javascript:`、`data:`、`file:`、credential付きURL、control／bidi文字を含むV2／CSV／新規編集はcommit前に全拒否し、同じ値を含むV1／XLSX 2.2／既存profileはraw値を壊さず非linkになる。空文字はURLなしとなり、raw item URLからReact `href`への直接edgeが0件である
- **EXIT-FSMC-I4-019** — production CSPを`worker-src 'self'`のまま維持し、online／offlineで同一origin Backup Workerを起動できる。success／error／cancel／timeout後のWorker、reader、timer、transaction、Blob URL残留が0件である
- **EXIT-FSMC-I4-020** — `core-only`へsplit payloadを直接commitせず、独立したcapability bootstrapとhealthy再open後の別preview／別commandだけを許す。`recovery-required`では6.1.1のeligible resetとhealthy再open後、またはclean profileでだけ通常restoreへ進める
- **EXIT-FSMC-I4-021** — owner別hall group codecの全reachable semantic pairで`decodeCurrent(encodeCurrent(pair)) === pair`かつtoken injectiveを満たす入力だけを出力し、reserved 3 token、suffix付き実hall ID単独、`A` priority対`A:priority` normal、`A` highest対`A:highest` normalの衝突はtyped structural blocker／V2・pair 0件にする。historical block parentのcurrent-map／historical-map exact unionでcurrent map＋deleted blockをround-tripし、unknown／ambiguous parentやfresh historical mapへの劣化を拒否する
- **EXIT-FSMC-I4-022** — raw structured-clone snapshotをDTO変換／JSON serialize前にown-propertyとarray index presenceでtotal走査し、own `undefined`、array `undefined`、sparse hole、`-0`をtyped scalar／structural blockerとしてV2・pair 0件にする。absent optional key、explicit `null`、`0`との取り違え、adapter後だけの検査、黙示key drop／`null`化／`0`化をnegative fixtureで拒否する
- **EXIT-FSMC-I4-023** — raw representability issueはobject／array undefined、hole、negative zero、non-finite、unsafe integer、cycle、非JSON kind、strict JSON valueのexact tagged witnessを持ち、domain-separated `valueDigest`がpath、tag、index／length、値を拘束する。同じpathのundefined／hole／`-0`／null／0が相異なるdigestとなり、通常JSONで原値を先に失ったwitness、tag差、digest差を拒否する
- **EXIT-FSMC-I4-024** — V2 embedded digestはschema／duplicate property／未知key検証後、`digest`を除くexact objectを`{ domain: "fsmc-app-backup-v2-v1", backupWithoutDigest }`として`esp-json-v1` canonical serializeしたUTF-8 SHA-256へ再計算する。`companionCore` included／unavailable、issue順、file metadataを含む各単独field差とdigestだけの差替えを拒否する

I0～I10とI11作業中のproduction artifactでは、利用者が分割設定を作成できるUIとenable commandを公開しない。I11最終candidateはbuild前にsourceを`release-ready`へ固定して同UI／commandを含めるが、同一artifactのrequired gate成功までは利用者へ配布しない。

### FSMC-I5: 分割設定UIとブロックコピー

実装:

- 独立した`CellSplitDefinitionPanel`
- 単数・複数選択
- 4方向と解除
- ブロック名一意と重複番号対象外のvalidation
- 相対位置コピーのpreview planner
- 既定の「追加・変更のみ」と別操作の「完全同期（解除を含む）」、選択mode、追加・変更・解除・維持・変更なし・除外の表示
- 非連続`cellGroups`、相対merge形状、stale previewのvalidation
- 別日程・別地図コピーの入口が初版に存在しないことをarchitecture testで固定
- dormant／quarantinedの理由一覧、preview付き再関連付け、明示削除を行う管理UI。地図上には表示しない
- 最大15,000番号行のblock／番号／status検索・絞込みとvirtualization。`config/fsmc-virtual-list.json`へ`threshold`、`overscanRows`、`maxMountedRows`、`focusModel: "container-activedescendant"`、component別patternを`definition: "multiselect-listbox-external-toolbar"`、`retained: "single-select-listbox-external-toolbar"`、`projectedVisit: "single-select-listbox-external-toolbar"`、stable row DOM ID prefix、scroll alignmentとしてI0で固定する。各containerはexactに`role="listbox"`、rowは`role="option"`とし、definitionだけ`aria-multiselectable="true"`、全rowに`aria-selected`／`aria-setsize`／`aria-posinset`を付ける。containerだけをtab stopにしてlogical active rowを`aria-activedescendant`で示し、ArrowUp／Down、Home／Endでactive移動、Spaceで単一選択またはdefinition選択toggle、Enterでprimary詳細、Tabでlist外の固定操作toolbarへ移る。再関連付け、削除、編集、訪問後挿入はrow内にbuttonを置かずtoolbarが現在のactive／selected IDへ実行する。active rowは先にscrollしてmountされたことを確認してから参照し、row自身のroving `tabIndex`、grid role、interactive descendantとの二重運用を禁止する
- 常設の単一`role="status" aria-live="polite" aria-atomic="true"`と、即時対応が必要な失敗用の常設assertive regionを置く。announcement IDをdedupeし、rerender／route再計算／dialog closeで同じ通知を再送しない
- light／dark／forced-colorsでCanvasとDOMが共有するsemantic presentation tokenを定義し、文字／badgeは4.5:1、分割線／outline／marker／ring／focus indicatorは全隣接fillに3:1以上とする。状態差を色だけにせず線種、ring、badge／status文字で表す
- current owner＋番号のretained履歴を通常設定・copyから除外する`RetainedReconnectPlanV1`を実装する。candidate集合がexact 1件でtarget activeなし・map trustedの場合だけreadyとし、0件、2件以上、target occupied、candidate stale、map untrustedはreason付きblocked／write 0件とする。ready commitはcandidate集合とroot vectorを再検査し、選択retained除去＋新active作成を一段で行って非選択履歴を変更しない
- `CellSplitDefinitionPanel`の作成・解除・copy mutationはevent OFF／安全モードで到達不能とする。一方、DB／root authorityが信頼でき、device ONかつevent OFFの場合は、有効化previewと専用CAS commandによるretained entryの再関連付け／明示削除へ到達できる。association／root authorityを信頼できない自動安全モードでは管理画面をread-onlyにし、6.1.1のdiagnosis、trusted-core export可否、eligible in-place resetまたはguided profile resetをreason別に表示する。recovery commandは通常split mutation gateと分離し、productionでは`release-ready`まで全導線を非公開にする
- guided profile reset UIは`FSMC_RECOVERY_RESUME_KEY`と`FSMC_RECOVERY_CONTROL_DB`の作成、二段階確認、全child targetのstore／key／schema／record-root witness、`backup-covered | reconstructible-internal | uncovered` disposition、不足理由、stage表示、再起動後の再照合、同hash backup再選択、固定restore plan、ack後cleanupを所有する。coverageがverified-complete以外ならconfirm／dispatchを表示せず、journalだけを根拠にdelete／restoreしない
- 一括設定・copy preview／commit、単一設定save、active definition 15,000行とretained 15,000行それぞれの初回表示／filter input-to-paintのDesktop／Mobile性能scenarioを本phaseから強制する。両一覧が共有virtual-list engineを使ってもrunSampleとscenario IDを混ぜない

Exit:

- **EXIT-FSMC-I5-001** — preview取消で変更なし
- **EXIT-FSMC-I5-002** — 部分不一致は適合箇所だけ適用
- **EXIT-FSMC-I5-003** — 保存失敗時に全対象が旧状態へ戻る
- **EXIT-FSMC-I5-004** — 分割解除でアイテム番号を変更しない
- **EXIT-FSMC-I5-005** — 重複番号セルへ設定を保存できず、対象外理由を表示する
- **EXIT-FSMC-I5-006** — 「追加・変更のみ」ではコピー元未分割・コピー先分割済みを維持し、「完全同期（解除を含む）」だけが「解除」と表示して確定時に解除する。dormant／quarantined元は解除に変換しない
- **EXIT-FSMC-I5-007** — コピー先の同owner＋番号にretained履歴があれば両copy modeで除外理由を表示し、履歴と重なるactiveを作らない。候補exact 1件の明示再関連付けだけがsole retainedをactiveへ原子的に状態遷移し、0件／2件以上／取消／stale／失敗時は全retainedが元のまま残る
- **EXIT-FSMC-I5-008** — retained reconnectの0／1／2候補、target occupied、candidate stale、同時tabを検証し、1件だけが全旧／全新でactive化され、非選択retainedとhistorical owner evidenceはbyte同値である
- **EXIT-FSMC-I5-009** — 端末全体OFFではsplit管理導線を閉じる。device ON・event OFF・authority正常では有効化previewとretained再関連付け／削除だけを許可し、definition／copy mutationを拒否する。自動安全モードではread-only診断とBackup案内だけを許可し、UIからローカル制御gateを迂回して保存commandを呼べない
- **EXIT-FSMC-I5-010** — QA buildで全UI試験を完了するが、production navigationとenable commandはI11まで非公開のままである
- **EXIT-FSMC-I5-011** — 本phase担当のDesktop／Mobile p95、main-thread task、memory上限を満たす
- **EXIT-FSMC-I5-012** — `CellSplitDefinitionPanel`／retained管理の最大15,000行で検索、virtual scroll、先頭／末尾移動、filter後focus復元、dialog往復をkeyboardだけで完了でき、listbox／option、`aria-selected`、`aria-setsize`／`aria-posinset`／`aria-activedescendant`がfiltered集合と一致する。row内interactive descendant、grid role、roving focusとの混在が0件で、Tab後の固定toolbarがactive／selected IDだけをcommandへ渡す
- **EXIT-FSMC-I5-013** — I5が所有するannouncement dispatcherへsuccess、cancel、no-op、conflict、将来のglobal統合を表すsynthetic eventを渡すcontract testで、status通知がeventごとにexact 1回、rerenderで再通知0件となる。実際のglobal統合とのintegrationはI7 Exit、route挿入とのintegrationはI10 Exitが所有する。light／darkのtoken contrast verifierとforced-colors browser testが成功し、axeだけをCanvas contrastの証明にしない
- **EXIT-FSMC-I5-014** — recoveryの全reachable decision tupleがread-only export可否、eligible reset、guided profile reset、unsupported stopのexact 1分岐へ対応し、unsupported DB、別tab blocked、backup不足、取消時はprofileを変更しない
- **EXIT-FSMC-I5-015** — guided resetのdelete前、DB削除直後、local key削除途中、clean profile作成直後、restore plan record commit直後、journal plan CAS直後、restore commit直後、ack直前で再起動しても、surviving journal／control recordと実DB digestからexact 1 next actionを再計算する。journal／plan／remap／expected after-image／backup hash不一致と未知状態はwrite 0件、compatible build／migratorがなければ対応buildへ誘導し、成功ack後はresume artifact 0件、origin全消去は通常clean-startとなる
- **EXIT-FSMC-I5-016** — guided reset previewはruntime inventoryの全store／local keyとcoverage rowがbijectionし、未知・余分・欠落・重複・schema drift・snapshot後raceを全てwrite 0件にする。canonical event settingsをbackup／restore coverageへ含め、DB6 conflict fixtureの`memberRouteItems`等、lossless planがないstoreは明示unsupported-stopになる
- **EXIT-FSMC-I5-017** — split definition／解除／copyおよびretained→active再関連付けで`MapCellSplitSettingsIdentityInputV1`が変わる場合は、同じafter-imageから対象eventのbasis 4 fieldと両aggregateを再計算して`durable-visit-state`を同一commitへ参加させる。split rootまたはentryだけ更新、aggregateだけ更新、byte同値durable writeの水増しを拒否し、取消／stale／失敗はsplit、durable root、fenceが全旧、成功は全新となる

### FSMC-I6: 地図再取込と通常地図編集

実装:

- 分割継承plan
- 一意一致と除外理由
- 確定前プレビュー
- mapDataと分割設定の単一commit
- `src/features/map/domain/mapReimport.ts`／`mapImportFlow.ts`のcore planと`splitReimportPlan.ts`を同一pre-command snapshotから合成するapp adapter。`useMapImportCommands.ts`、`appOverlayState.ts`、`MapReimportConfirmationDialog.tsx`へcore／split digest、`ExpectedRootVector`、map／association revisionを持つ単一previewを接続する
- previewへ分割維持・更新・dormant・quarantined、`manualHallId`除去／remap、mapped→mapless、mapless→mapped、visit identity変更、route invalidationの件数を表示する。一方だけを別revisionから再計算・適用しない
- ブロック改名・移動・`cellGroups`・番号・merge変更・同名置換のmanual edit plan
- 新規`MapStructureEditorDialog`／`NumberCellEditorPanel`／`MergeCellEditorPanel`と`fsmc.map.edit-number-cell.v1`／`fsmc.map.merge-cells.v1`／`fsmc.map.unmerge-cells.v1`を、共通pure `previewManualMapStructuralEdit`とatomic applyへ接続する。番号は正のsafe integer whole tokenだけ、a/b suffixは地図へ保存しない。duplicate cell、normalized block／number collision、block ownership重複、merge overlap／部分交差／bounds外／block境界横断、複数非空値を隠すlossy mergeを拒否し、unmergeはexact 1 mergeだけを除去して下位cellを変更しない
- reimport match tierを`same-instance-manual-edit`、`exact-raw-block-name-and-number`、`normalized-block-token-and-number`の順へ固定する。各tierはexact 1候補だけを採用し、複数なら下位tierへ進まずambiguous、row／col・配列先頭・表示類似度でtie-breakしない。geometry fingerprintは一意候補のevidence検証だけに使い、outcomeを`preserve | rebind | dormant | quarantine | reject-map`のexact unionにする
- event ON中の通常編集・再取込after-imageへ番号衝突が生じる場合の`PD-16`全拒否
- `NormalizationCollisionRepairPort`の`fsmc.repair.map-identity.v1` adapter。衝突fallback中は通常地図編集commandを開かず、同じmanual edit planを明示repair previewからだけ渡す
- I1のpure `planVisitIdentityTransitions`をafter-imageへ適用し、I6 QA commandはdurable execution order／phase anchorsまでcore／splitと同一commitする。I7は残るwriter conformanceとQA／internal commandの有効化だけを所有し、productionのpublic registration／UI／dispatch／commit authorizationはI11 release-readyまでfalseにする。I6 editor／reimport自身を`visit-projection-owner-not-ready`で試験不能にしない
- reimport preview／commitのDesktop／Mobile性能scenarioを本phaseから強制する

Exit:

- **EXIT-FSMC-I6-001** — セル移動後もブロック名＋番号が一意なら継承
- **EXIT-FSMC-I6-002** — 重複・欠落・曖昧候補は継承しない
- **EXIT-FSMC-I6-003** — raw block名一致をnormalized一致より優先し、各tierの0／1／2候補、normalized token collision、manual hall保持／remap、duplicate physical cell拒否が決定表どおりとなる。core map planとsplit／visit transitionの全rootが単一preview／commitで全旧または全新になる
- **EXIT-FSMC-I6-004** — 取消・例外時は地図と分割設定がともに旧状態
- **EXIT-FSMC-I6-005** — coreまたはsplitのどちらか一方でもstaleならwrite 0件で両planを破棄する。failure injectionの全stageでcore storesとsplit rootsが全旧または全新となり、片側だけ確定しない
- **EXIT-FSMC-I6-006** — 除外設定は削除せずdormant／quarantinedに保持し、誤接続しない
- **EXIT-FSMC-I6-007** — 無関係な地図変更では影響外entryをactiveのまま維持し、一意移動はevidenceとanchorを更新、欠落はdormant、曖昧・領域競合は対象entryだけをquarantinedにする
- **EXIT-FSMC-I6-008** — 旧版による地図変更を新版起動時に検出した場合は、I2のlegacy core classifier／rebaseでanchor、binding、衝突を先に再検証する。強いevidenceで同一ownerへ一意一致するentryだけを決定規則どおり維持し、名前だけの自動rebindは行わない。dormant／quarantinedから別ownerへ再関連付けする場合だけpreviewを要求する
- **EXIT-FSMC-I6-009** — ON中に衝突を作る編集・再取込はmapData、settings、association、controlを一切変更せず拒否し、eventはONのまま、衝突原文と修正方法を表示する
- **EXIT-FSMC-I6-010** — `fsmc.repair.map-identity.v1`はlatest rootの`C(after) ⊂ C(before)`だけを原子的に確定し、pair swap、同数置換、新規pair、選択外変更、stale previewを全拒否する。完全解消時は同じcommit後に対象eventだけがeffective ONへ戻り、未解消ならstrictに減ったpairを表示してfallbackを継続する
- **EXIT-FSMC-I6-011** — previewの`manualHallId`除去、hall remap、mapped／mapless遷移、split status、route invalidation件数がpure after-image planと一致する。I6 QA commandはI1のtransition applicatorでdurable visit状態まで単一commitし、I7は残る全writerのconformanceとQA／internal commandを所有する。production public edgeはI11まで0件である
- **EXIT-FSMC-I6-012** — 番号変更、merge／unmerge、lossy merge拒否、keyboard-only cell address／矩形選択／preview／取消を検証し、stale／quota／取消はwrite 0件、成功はmapData、association、evidence、entry status、durable visit stateを全旧／全新にする。逆操作も新しいpreviewを通り、隠れたdirect undo writerが0件である
- **EXIT-FSMC-I6-013** — 本phase担当のreimport preview／commit性能上限を満たす
- **EXIT-FSMC-I6-014** — topology／reimport／manualHall／map association／hall remap／split statusのafter-imageがvisit identity basisを変える全caseで、durable entry transitionに加えて対象eventのbasis 4 fieldと両aggregateを同じsnapshotから再計算する。entryだけ新しく旧basisを残す、影響外event digestを再生成する、aggregateだけ置換する実装をfailure injectionで拒否し、全rootを全旧／全新にする

### FSMC-I7: 既存データidentity migrationと共有訪問投影

実装:

- 基準source `2eaba92`に部分実装済みの`PD-14.C2`共有訪問projectionをconformance auditし、未適合writer／通常・集中画面／一覧／space-navigationをnon-promotable QA artifactで補完する。経路、hit-test、cache、route insertion anchorの`PD-14.C3`はI10が所有する。FSMC-I1で固定済みのmapped／mapless／legacy-unresolved `SpaceIdentity`、番号正規化、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、canonical key APIをQA data／writerへ適用し、production compositionはI11までlegacy adapterを選ぶ
- `buildProjectedPhaseVisits`をQA app composition rootへ実装し、`MapView`、`FocusModeContainer`、`FocusMode`、`MapVisitListPanel`、space-navigationへ同一`PhaseVisitProjectionSnapshot`を渡す。`NavigatorItem`、旧`buildVisitIdentity`、代表item、row／colからON時identityを再構築するQA consumerを除去する。production buildではこのcomposition／registry／dispatcherへのedgeを0件とし、I11が同じ実装をproduction compositionへ初めて接続する
- 同一revisionのcanonical `SpaceIdentity`からだけ`ProjectedVisitResolutionSummary`を生成し、同一execution visit内の全memberでbyte一致を検査する。一致しなければ`inconsistent-resolution-summary`としてprojection全体を拒否し、代表member選択や配列順で解決結果を決めない
- raw実行商品ID配列をglobal sortせず、非連続な同一`ExecutionVisitIdentity`を配列全体で集約する。legacy初回はraw配列の最初の出現順から重複なし`executionVisitOrder`を生成し、以後はこのordered key arrayをbase訪問順authority、raw配列をmember順authorityにする。全nonempty execution visitとのexact bijectionを保つ
- `src/app/commands/useMapVisitListCommands.ts::updateOrder`を商品配列置換から`ExecutionVisitIdentityKey`のUI draft＋`planExecutionVisitOrderMutationV1`へ移し、保存時だけ`fsmc.visits.reorder-execution-order.v1`／`commitExecutionVisitOrderAtomicallyV1`でdurable orderを更新する。cancel／panel closeはdraftだけを破棄する
- `src/app/commands/useMapRouteCommands.ts::reorderExecuteListByHallOrder`を`planHallRouteAndExecutionOrderMutationV1`へ移し、`fsmc.visits.reorder-by-hall.v1`がhall route settings after-imageとdurable `executionVisitOrder`を同じ`ExpectedRootVector`、preview digest、transactionでall-old／all-newにする。raw execution rootをread-only CAS witnessとして再検査するがwrite participantにせず、raw item ID配列と各visit内member相対順をbyte同値に保ち、2 commandの独立したorder authorityを廃止する
- 日程、ブロック、番号、side、優先度、`manualHallId`、hall definition／association／remap、mapped↔mapless編集でidentityが既存destinationへ変わる場合の、変更itemだけをdestination member末尾へ移す決定的rekey plannerと、item ID対応から現在・保存位置の`PhaseVisitIdentityKey`を再解決する処理
- normalは全実行商品、後回し・遅参は追加phaseとしてbase順から生成し、1商品が複数phaseへ属せる共有projectionを通常マップ、集中モード、`MapVisitListPanel`／`ProjectedVisitList`、space-navigationへ提供する。I10向けには同じsnapshotを入力portとして公開するが、本phaseでroute conformance成功を主張しない
- 通常の実行列・候補列と同じ優先度別グループ規則への統一
- core raw実行列からbase `executionVisitOrder`を生成し、同一QA processのvalid `LegacyFocusSessionSnapshotV1`がある場合だけ旧`postponedItemIds`／`lateItemIds`をphase-major `normal → postponed → late`へ互換変換して各phaseを同じbase順でfilterする。snapshotなしまたは不正fieldは3.8のfield別default候補とloss previewへ送り、後回し／遅参が永続済みだったとは仮定しない。全phase最大800を単一active routeへ混在させない
- valid snapshotの`phase`／`phaseIndex`／`savedPhaseIndices`からrekey前にitem ID anchorを取得し、`current: { phase, anchorItemId }`とnormal／postponed／late別saved anchorへ決定的migrationする。anchor nullでもphaseを保持し、消失時は同phaseの旧位置以降、直前、先頭、nullの順で解決し、別phaseへfallbackしない。同じsnapshotの追加phase集合、`isCompleted`、`lastPurchaseChangeAt`も一つのafter-imageへ変換する
- I7は`LegacyFocusSessionSnapshotV1`全体を受けるpure migration plannerとQA fixtureだけを所有する。同一QA processの全field exact変換、snapshot欠落、各fieldの型／範囲／参照不正、purchaseの0／複数visit、`legacySessionInputDigest`差を`unresolved-legacy-focus-session-field`とfield別default／loss previewへ分類するが、DB5 production保存、明示確認commit、reload／update後の回収を主張しない。productionの全scope seed、session revision／digestまたはabsenceの再検査、`migrating → ready` commitはI11が所有し、ready後はdurable fieldだけをauthorityにする
- I7は`LegacyFocusSessionFreezePortV1`、revisioned process-local registry、I1のresolved authority／scopeを入力とする`resolveLegacyFocusSessionScopesV1`、raw-day repair planへFocus source／target presenceとexact key transitionを供給するlease adapterをnon-promotable QA compositionへ実装する。passive effectが1 render遅れるcase、freeze直前の全field mutation、ack前unmount、A→B→A、同bytes削除再作成、invalid-key prune、event delete／rename、`::`を含むevent名、legacy key mapping 0／1／複数、raw day normalization collision、`registryGeneration`／`freezeIssuanceId`／`operationGeneration`各上限、取消後の同内容再発行と旧token replayをfixture化し、latest ack済みrecordとactiveな最新issuanceだけが受理されることを検証する。day collisionはevent名基準canonical witness付き`capability-adoption-blocked`となり、ID proposal／DB upgrade／token／default／loss preview 0件とする。rename／deleteについてはlifecycle leaseがpersistence commitからexact key remap／removeまでfreezeを待たせ、freeze先行ではcommandをfirst write前に拒否し、prefix一致する別eventのsessionを変更しない。raw-day repair leaseはaffected event名全体、plan digest、registry generation、全source presence／target absenceまたはclosed occupantを拘束する。lease取得のtyped success／failure、正常complete／abortに加え、二重complete／abort、abort後complete、complete後abort、旧lease replay、generation／transition／digest不一致、absence→出現ABAを検証する。取得拒否と不正finalizeはFocus session record mutation／lease ledger transitionとも0件、取得後のpersistence拒否はsession record mutation 0件かつledger `none → active → aborted` exact 2 transitionとする。各counter上限は対応するtyped exhaustion reason、発端UI／DB write 0件、token 0件のruntime `repair-required`とする。I10以前productionはcode存在を許してもcapture／migration／repair command registration 0件とし、I11がproduction composition、adoption-blocked repair shell、freeze shellを所有する
- unsupported番号tokenを含む既存訪問migration。item／row-col中心の経路点から`PhaseVisitIdentity`中心のroute型への変換はI10へ割り当て、I7では変換fixtureとinput portだけを固定する
- `ProjectedPhaseVisit`ではmember商品IDをpayloadとして保持し、代表item IDをvisit identity、route、hit-test、挿入anchorへ流用しない
- event ON中の商品編集・item import after-imageが新しい正規化衝突を作る場合の`PD-16`全拒否。自動OFF、部分適用、黙示skipを行わない
- `NormalizationCollisionRepairPort`の`fsmc.repair.item-numbers.v1`、`fsmc.repair.orphan-visit-state.v1`、I6の地図修正をまとめる衝突修復UI。孤立状態破棄は選択`PreZeroIdentityKey`のcurrent item参照0件をcommit内で再検証し、変更・破棄内容を明示previewする
- I6まで`visit-projection-owner-not-ready`だったmap／hall identity変更commandを同じpreview digestから有効化し、durable現在位置／保存位置／phase stateをcore／split planと同一commitで移送する。memory-only cacheはcommit成功後だけ破棄する
- I7は全item／map／hall writerのconformance、QA registry、internal dispatcherだけを有効化する。production artifactでは`publiclyRegistered = publiclyReachable = dispatchAuthorized = commitAllowed = false`を維持し、public handler／navigation／feature switch edgeは0件とする。最初のproduction public registrationと端末／event enable UIはI11 release-ready candidateだけが所有する
- 400 item rekey／projectionのDesktop／Mobile性能scenarioを本phaseから強制する

Exit:

- **EXIT-FSMC-I7-001** — preflight衝突0件の`01a`と`1a`だけが同じ半領域anchorへ解決され、衝突時は機能ONを拒否してlegacy identityを維持する
- **EXIT-FSMC-I7-002** — 同じ側・同じ優先度は1つの`ExecutionVisitIdentity`へglobal集約され、進行区分ごとに別`PhaseVisitIdentity`へ投影される
- **EXIT-FSMC-I7-003** — 同じ側でも優先度が異なれば別execution／phase訪問として維持される
- **EXIT-FSMC-I7-004** — raw `[A1, B, A2]`を並べ替えず、通常／集中／一覧／space-navigationではnormal `[A(A1,A2), B]`へ一致して投影する。I10 route fixtureも同じ期待snapshot IDを参照するが、本phaseの実行結果へ含めない
- **EXIT-FSMC-I7-005** — 新destinationでsourceにmemberが残る場合はsource直後、sourceが空ならsource slotを継承し、同じanchorへの複数destinationはbefore最小source order→canonical key順となる。既存destinationは位置維持、利用者insert anchorは新destinationだけに効き、全結果の`executionVisitOrder`がexact bijectionになる
- **EXIT-FSMC-I7-006** — A1を既存B identityへ変更した場合、B訪問位置と他itemの相対順を維持してA1だけをB member末尾へ移し、変更元visit、現在位置、保存位置、phase集合を新`PhaseVisitIdentityKey`へ決定的に再解決する。route anchorの移行はI10 Exitで同じfixtureへ追加する
- **EXIT-FSMC-I7-007** — 投影済みvisitの先頭memberを削除しても同じidentityのmemberが残る場合は、同じ`PhaseVisitIdentityKey`と訪問位置へ再解決する。座標、経路順、route cacheはI10 Exitで検証する
- **EXIT-FSMC-I7-008** — 同一processのvalid `LegacyFocusSessionSnapshotV1`について、`phase`／`phaseIndex`、3 saved index、postponed／late集合、`isCompleted`、purchaseを一つのafter-imageへ移し、normal＋追加phaseの同一item、空phase current、anchor削除も決定規則へ一致する。snapshot欠落または各fieldの型／範囲／参照不正は、3.8のexact default候補、失われるfield、before unknown、`unresolved-legacy-focus-session-field`をpure previewへ出し、I7で黙示default、確認、production root書込を行わない。QA freeze Portはlatest state capture ack前のunmountを拒否し、全mutation／appearance／removal／recreate／key remapでgenerationを進め、A→B→A、同bytes再作成、mapping 0／複数、token invalidをstaleへ送る。raw day normalization collisionはevent名基準canonical witness付き`capability-adoption-blocked`、ID allocator／proposal／upgrade request／token／default／loss preview 0件となる。raw-day repair lease adapterはplanの全Focus source presence、target absenceまたはclosed occupant、registry generation、plan digestを拘束し、partial key pair、many-to-one、domain外occupied target、absence→出現ABAをregistry／DB mutation 0件で拒否する。取消後の同内容retryは新issuance、旧token replayは拒否となる。rename／delete lease中のfreezeはregistry after-imageまで待ち、freeze先行のlifecycleはDB write 0件で、event名に`::`を含むcaseとprefix event名caseでもexact keyだけを移送・削除する。leaseは`active → completed | aborted`のone-shotで、二重／終端間遷移／replay／generation・digest不一致を拒否する。3 counterの上限は各typed reason、発端UI／DB write 0件、token 0件のruntime `repair-required`となる。scope preflight／authority derivationはI1 Exitを参照し、全scope seed、adoption-blocked repair command、reload／retry／別tabのdurable復元はI11 Exitで初めて要求する
- **EXIT-FSMC-I7-009** — callback中にpayload root、checkpoint absorbedCandidates、checkpoint updatedAtのいずれかだけが変化した場合もprojection revisionが変わり、stale mutationはwrite 0件となる
- **EXIT-FSMC-I7-010** — `01a`と`1a`の既存訪問が衝突0件で安全に統合できる場合も商品・raw順・後回し・遅参を失わない。item、保存済み訪問・順序・進行状態、durable `lastPurchaseChangeAt`を含むdurable stateは自動破棄0件とし、破棄できるのは`fsmc.repair.orphan-visit-state.v1`で利用者が選択しitem参照0件を再検証した対象だけとする。一意なら新`PhaseVisitIdentityKey`へ同一commitで移し、不能／曖昧なら元durable entryを保持して要修復previewへ送り、自動でnullにしない。再計算で捨ててよい非永続状態は未commitのprojection、route cache、hover／tap candidate、未確定previewだけとする
- **EXIT-FSMC-I7-011** — FSMC-I8以降が確定済みidentity APIだけを利用できる
- **EXIT-FSMC-I7-012** — OFF切替でsplit identityをlegacy keyへ永続的に破壊変換せず、ON復帰時に商品ID・順序から決定的に再構築できる
- **EXIT-FSMC-I7-013** — mapped、mapless、legacy-unresolvedの訪問が通常／集中／一覧／space-navigationで失われず、mapped以外に架空の地図位置を与えない。I10のroute consumerはmapped以外を`no-routing-port`として扱う契約fixtureだけを参照する
- **EXIT-FSMC-I7-014** — event ON中の商品編集・item importが新しい正規化衝突を作る場合は全store書込み前に操作全体を拒否し、core、settings、association、metadata、checkpoint、control ONを旧状態に保って、衝突原文と修正方法を表示する
- **EXIT-FSMC-I7-015** — 3つのallowlist commandだけが衝突fallback画面から到達でき、全て同じ`ExpectedRootVector`、`previewDigest`、期待`C(before)`を再検査する。item修正、map修正、item参照0件の孤立訪問状態破棄の各fixtureでstrict decreaseだけが成功し、pair swap、同数置換、新規pair、stale、選択外変更は全root旧状態となる
- **EXIT-FSMC-I7-016** — 修正後もpairが残ればstored enabledを維持したeffective fallbackと残件表示を継続し、`C(after) = ∅`のcommit後だけ対象eventが自動でeffective ONへ復帰する。他eventのeffective状態、split設定、選択外item／訪問状態を変更しない
- **EXIT-FSMC-I7-017** — `manualHallId` X→Y、X→未指定、未指定→X、hall削除、hall remap、mapped↔maplessが決定済みafter-imageへ一致し、stable hall IDの表示名変更では訪問順とidentityを変えない。ON runtimeからlegacy `buildVisitIdentity(block, number)`へのproduction edgeが0件である
- **EXIT-FSMC-I7-018** — 実際の商品追加・rekeyによるglobal統合がI5のannouncement dispatcherへstable event IDを1回だけ発行し、通常マップ、集中モード、買い物一覧、`MapVisitListPanel`／`ProjectedVisitList`で同じstatus textをexact 1回通知する。rerenderやsnapshot再配布で再通知しない
- **EXIT-FSMC-I7-019** — member順shuffle、先頭member削除、destination統合でresolution summaryが不変かつsnapshot indexがexact bijectionであり、不一致fixtureはtyped error、projection 0件、write 0件、常設status通知となる
- **EXIT-FSMC-I7-020** — QA／internal commandで全writer conformanceを検証できる一方、同sourceのproduction artifactはFSMC public handler、navigation、端末／event switch、dispatch authorization、commit authorizationがすべて0件／falseであり、I11前のproduction公開経路がない
- **EXIT-FSMC-I7-021** — item／day／execution order／number／block／side／priority／manualHall／hall remapを変える全QA writerはtransition後entry、対象eventのbasis 4 field、両aggregateを同じafter-imageから再計算し、logical participant／historical evidence／actual writeへexact一致させる。item import、rekey、delete、orphan visit破棄でold entry＋new basisまたはnew entry＋old basisとなる部分commitを0件にする

- **EXIT-FSMC-I7-022** — 通常訪問一覧のdrag／keyboard reorderは重複なしbase visit exact permutationをdraft表示し、cancel、panel close、staleでは永続root／raw item列を変更しない。保存成功だけがdurable `executionVisitOrder`を一段更新し、reload、通常／集中／一覧／space-navigationで同じ順になる
- **EXIT-FSMC-I7-023** — hall順変更はhall route settingsとdurable orderを同一commitで更新し、raw item ID配列とmember相対順をbyte保持する。片rootだけstale、unknown／duplicate／missing visit、noninjective hall mapping、quota、commit前終了はall-old、commit後終了はall-newとなり、旧2 commandからraw reorderへのproduction edgeが0件である

### FSMC-I8: 通常マップ

実装:

- locationKey単位の状態索引
- `MapView`を通常マップ側のconsumerとし、I7の`PhaseVisitProjectionSnapshot`を通常マップと`MapVisitListPanel`／`ProjectedVisitList`の唯一の訪問入力にする。panel内の商品再集約、番号parse、block検索、row／col dedupeを廃止する。route hit-testへの接続はI10が所有する
- 半領域描画、分割線、正立する条件付きラベル、`LocationPresentationState`
- スマートフォン常時picker、非スマートフォン入力別閾値direct hit、曖昧時no-op案内
- 狭幅PCを含む端末判定adapterと利用者override
- 設定のアクセシビリティに`SplitMapAccessibilitySettingsPanel`を追加し、「常にセル側選択ダイアログを表示」を`setForceSplitPickerAtomically`へ接続する。通常マップだけのlocal stateやevent別設定を作らず、保存中／競合／失敗を常設statusで通知する
- 共通Pointer gesture state machine
- `useCanvasViewport.ts`のnative TouchEvent分岐をPointer Events state machineへ置換し、`MapCanvasPresentation.tsx`の実DOM listener／style終端と`MapCanvas.tsx`へpointer capture、`lostpointercapture`、`touch-action`、passive listener、unmount cleanupを単一ownerとして接続する。共有hookを既に使う`FocusModeMapCanvas.tsx`もI8で同gesture regressionを実行し、旧touch handlerとcomponent-local gesture stateを0件にする
- 側別ポップアップと追加処理
- `whole`／unsupportedの「側未設定」中央badge、一覧、編集導線
- 地図訪問一覧のa/b対応
- 選択、候補、現在位置等の全overlayを共通geometryへ移行
- semantic presentation tokenをCanvasへ接続し、light／dark／forced-colors changeで再描画する。DOM一覧、状態文字、focus indicatorを失わず、Canvasの色だけで状態を表さない
- 最大fixture初回描画、最大800 phase訪問一覧、filter入力、5秒pan／zoom／rotationに加え、`split-direct-popup-normal-desktop`と`split-picker-popup-normal-mobile`を別scenario／単一profile／独立run境界で本phaseから強制する
- `MapVisitListPanel`をI8でshellとして再構築し、filter、logical active ID、selected ID、stale snapshot、focus returnを所有させる。row DOM IDはcanonical visit IDのinjective base64url tokenとし、filterでactive rowが消えたら同index最近傍、空ならcontainer focus＋`aria-activedescendant`除去、opener消失時は地図toolbar固定targetへ戻す

Exit:

- **EXIT-FSMC-I8-001** — 26a操作で26bを開かない・変更しない
- **EXIT-FSMC-I8-002** — 通常マップの既存色規則を維持
- **EXIT-FSMC-I8-003** — 空側で正しい見出しと事前入力値を表示
- **EXIT-FSMC-I8-004** — `26`／`26c`だけが存在しても左右クリックがアイテムなしになり、中央badgeとDOM一覧に「側未設定」が表示される
- **EXIT-FSMC-I8-005** — スマートフォンは最大zoomでもpickerを使用し、非スマートフォンは閾値未満・曖昧帯で選択を変えない
- **EXIT-FSMC-I8-006** — pan、pinch、pointer cancel、unexpected capture喪失、layout切替後にpopupを誤表示せず、正常`up → lostpointercapture → click`ではtap exact 1回、click dispatch 0件となる。expected lostはguardを維持し、unexpected active lostはglobal cleanup、stale別ID lostはno-opとなる
- **EXIT-FSMC-I8-007** — 本phase担当のDesktop／Mobile p95、main-thread task、memory上限を満たす
- **EXIT-FSMC-I8-008** — normal Desktop direct 150 ms／Mobile picker 200 msの各scenario-profile keyがreduced resultにexact 1件あり、I9 focus scenarioを前倒し成功扱いにしない
- **EXIT-FSMC-I8-009** — `MapVisitListPanel` shellがopen／close、filter、focus restoreを維持し、pure `ProjectedVisitList`の選択／挿入callbackが`PhaseVisitIdentityKey`だけを渡す。row／col、代表item、stale location payloadへ縮退しない
- **EXIT-FSMC-I8-010** — Canvas semantic tokenのlight／dark contrast unit test、forced-colors固定screenshot、非色覚手掛かり、theme変更時再描画が成功し、DOM代替導線と表示状態が一致する
- **EXIT-FSMC-I8-011** — `useCanvasViewport.ts`、`MapCanvas.tsx`、`MapCanvasPresentation.tsx`、`FocusModeMapCanvas.tsx`でnative TouchEvent／React touch handlerのproduction edgeが0件となり、通常／集中の両Canvasでsingle pointer、2本指、capture取得失敗／expected・unexpected・stale喪失、unmount、computed `touch-action: none`、wheel／pointerdown／move／up／cancel／lostcapture／clickのexact passive・preventDefault matrixをstyle／listener instrumentationとbrowser property fixtureで検証する。I9まで共有hookの集中モード回帰を延期しない

- **EXIT-FSMC-I8-012** — `forceSplitPicker=false`のDesktopはdirect-hit規則、trueでは画面幅／mouse／touchにかかわらずpickerとなる。toggleは端末全体・全eventへ即時反映し、reload／offline後も維持、stale／失敗時は旧値を表示してwrite 0件、falseへ戻すと次gestureから既定判定へ戻る。Backup export payloadはbyte不変である

### FSMC-I9: 集中モード

実装:

- 共有`MapLocationIndex`、位置API、viewport adapterへの置換
- I7の共有`PhaseVisitProjectionSnapshot`への置換
- `FocusModeContainer`がevent／day／map／hall contextをapp adapterへ渡し、`FocusMode`／`FocusModeMapCanvas`へ解決済み`PhaseVisitProjectionSnapshot`を渡す。表示名や`NavigatorItem`から`LocationKey`を再構築しない
- a/b別の購入状態・現在位置・次・前・一時位置
- 選択側へ絞った後、既存の参加日・実行リスト絞込みを行う側別ポップアップ
- 既存のセルポップアップ外枠、追加ダイアログ、`onAddItem`、`computeAddItemFromFocusMode`の流用
- 一時移動targetは既存の`SpaceIdentity`だけの集約を流用せず`PhaseVisitIdentity`単位で生成し、同じ側の異なる優先度・進行区分を別ボタン／別訪問として表示
- 現行どおりの「購入済」「後回し」「遅参」追加規則
- 実行リストまたはphase集合が変化した場合だけ共有projectionから訪問・経路を再計算
- 通常マップと同じviewport adapter、hit-test、pointer state machine、中立marker・訪問数badge・現在ring
- `FocusModeMapCanvas.tsx`も`useCanvasViewport.ts`由来の同じPointer Events snapshotだけを使用し、focus mode専用TouchEvent／pointer map／synthetic click fallbackを作らない
- I8と同じsemantic presentation tokenを`FocusModeMapCanvas`へ接続し、light／dark／forced-colors changeで再描画する。番号、a/b、状態、選択、現在ring、marker stackを色だけで区別しない
- DOM panelはrow／col callbackではなく同じsnapshotから作った`ProjectedVisitListRow[]`を入力し、`onSelectVisit(visitId)`で選択する。各行にpriority、phase、member件数、mapless／unresolved状態を文字で表示し、同じanchorの別visitを区別する
- 集中モードの最大fixture描画・操作scenarioを本phaseから強制する
- `FocusModeSessionState` adapterは`DurableVisitStateRootV1`のcurrent phase付きanchor、phase別saved anchor、completion、durable lastPurchase anchorを共有snapshotへ接続し、phase切替・空phase・rekey・reload後もI7規則どおり復元する。runtime sessionは未commit表示状態だけを持ち、durable fieldの別authorityにならない
- `split-direct-popup-focus-desktop`と`split-picker-popup-focus-mobile`を別scenario／単一profileで本phaseから強制する
- I8の同じ`forceSplitPicker` read modelとcontrol revisionを使用し、集中モード専用override、event別override、viewport変化による自動解除を作らない

Exit:

- **EXIT-FSMC-I9-001** — a側の購入更新でb側の色・件数が変わらない
- **EXIT-FSMC-I9-002** — 実行リスト外の商品だけが存在する側も「今回の巡回対象なし」と表示する
- **EXIT-FSMC-I9-003** — 追加画面に正しい日付・ブロック・`26a`または`26b`が入る
- **EXIT-FSMC-I9-004** — 「購入済」の追加では実行リスト・正式現在地・経路が変わらない
- **EXIT-FSMC-I9-005** — 「後回し」「遅参」の追加では該当日の実行リストへ入り、訪問列または座標signatureが変わった場合だけ経路が再計算される
- **EXIT-FSMC-I9-006** — 既存A訪問へ後回しA2を追加してもrawの最初のA位置とnormal A位置は動かず、normal Aへ統合すると同時にpostponed Aをbase順で追加投影し、全画面で同じ通知を表示する
- **EXIT-FSMC-I9-007** — 同じ側の異なる優先度・進行区分が一時移動targetでも別訪問になる
- **EXIT-FSMC-I9-008** — 同じanchorの訪問をDOM一覧から別々に選択し、Canvasなしで一時移動・詳細確認できる
- **EXIT-FSMC-I9-009** — 日程、ブロック、番号、side、優先度、manual hall／hall remap、mapped↔mapless編集による既存destinationへの統合が通常マップ、集中モード、買い物一覧、`MapVisitListPanel`／`ProjectedVisitList`で同一結果となり、変更先訪問を移動せず通知する。route一致はI10 Exitで同fixtureへ追加する
- **EXIT-FSMC-I9-010** — DOM panelの選択callbackが`PhaseVisitIdentityKey`だけを渡し、最新snapshotからlocationを再解決する。row／col、代表item ID、stale location payloadへ縮退せず、priority、phase、member件数を読み上げられる
- **EXIT-FSMC-I9-011** — 本phase担当のDesktop／Mobile p95、main-thread task、memory上限を満たす
- **EXIT-FSMC-I9-012** — focus Desktop direct 150 ms／Mobile picker 200 msの各scenario-profile keyがreduced resultにexact 1件あり、normal scenario resultや別profileで代用しない
- **EXIT-FSMC-I9-013** — `FocusModeMapCanvas`のlight／dark contrast unit test、forced-colors固定screenshot、theme変更時再描画、通常マップとのtoken parityが成功する
- **EXIT-FSMC-I9-014** — `FocusModeMapCanvas.tsx`に独立したtouch authorityがなく、通常マップと同じpointer capture／cancel／multi-pointer oracleを満たし、同じgestureからpopupを二重dispatchしない
- **EXIT-FSMC-I9-015** — 購入済／後回し／遅参の商品追加と日程・block・number・side・priority・manual hall編集は、identity-bearing after-imageの場合だけ対象event basis 4 fieldと両aggregateを更新し、進行状態だけでidentity inputが不変ならper-event basis digestをbyte保持する。entry transition、basis、aggregate、item coreを同一commitへ入れ、成功通知前にexact writer conformanceを検証する

- **EXIT-FSMC-I9-016** — I8で保存した`forceSplitPicker`が集中モードでも同じgesture boundaryから有効になり、通常／集中切替、event切替、回転、reloadで値とpicker順が一致する。両surfaceの同時表示でもcontrol reader／status notificationが二重authorityにならない

### FSMC-I10: 経路と訪問集約

実装:

- `PhaseVisitIdentity`／`ResolvedRouteVisitPoint`単位の基準セル、routing port、anchor
- `SubcellPathNode`、`SplitRouteSegment`、`RouteResolution`を新routeの唯一の公開型にし、現行`PathNode`を`AStarSearchNode`へ改名してpathfinding module内部へ閉じる
- `MapRoutePoint`、`mapViewRouteCalculations`、`mapRouteHitTest`、`routeRendering`、`focusRouteCalculation`、通常／集中Canvas、route cacheを同一PRで移行し、legacy row／col route adapterを削除する
- main pathと細い点線connector、`same-cell-direct`、`coincident-anchor` geometryを判別可能unionで分離する。同一anchorの別phase／priority visitはpathfinderを呼ばない正常0距離segment、cost 0、line hit targetなしとし、route順／insertion anchor／marker stack候補を失わない
- 自セル・結合セル領域内の決定的routing portとconnector検証を実装する。connectorだけは自owner領域内の番号cell maskを免除し、領域外、他番号／merge、map外、非owner block境界を禁止する。この免除をmain pathへ伝播させず、領域外BFS・未検証L字fallbackを禁止する
- routable／unroutableの判別可能`RouteResolution`
- marker／main path／connectorのhit-test優先順位とvisit ID候補
- `pathfindingGraphFingerprint`を含むcache／signature更新
- `src/types/map.ts`の旧function closure型`RoutePathConstraint`、`src/utils/mapRouteMapData.ts`のselected-hall closure生成、`src/utils/mapRoutePolygon.ts`のpredicateをexact migration targetにする。data-only `RoutePathConstraintV1`をroute inputの必須値にし、`all`は`whole-map`、選択hallはstable event／map／hall ID、hall definition revision、canonical polygon、fingerprintを持つ`selected-hall-polygon`へ解決する。欠落／stale／不正polygonは無制約へfallbackせずtyped unroutableとし、旧`RoutePathConstraint`／`isPathAllowed` production callerを0件にする
- pathfinder node間、simplification後main path、routing port、全connector、`same-cell-direct`をI1の同じinclusive polygon predicateで検証し、凹polygon外へ出るsegmentを拒否する。constraint fingerprintをroute cache、hit-test、insert preview signatureへ含める
- I7の共有projectionを経路順の唯一の入力とし、同じexecution identityのglobal集約とphase別投影を維持
- route、marker／connector hit-test、挿入anchorを`PhaseVisitIdentityKey`で一貫して参照し、member商品ID列はpayloadとして扱う。座標・順序signatureへmemberの先頭IDや件数を混入させない
- 異なる優先度を別訪問として保持
- 手動順と、手動順がない場合だけのa→b自然順
- DOM訪問一覧は`ProjectedVisitListRow[]`を受け取り、priority、phase、member件数を表示する。同anchorの別visit選択は`onSelectVisit(visitId)`、「この訪問の後へ挿入」は`onInsertAfterVisit(visitId)`で渡す。ただし追加対象の`ExecutionVisitIdentity`がraw配列全体に存在しない場合だけ位置指定を適用する。既存execution identityがある場合は対象phaseが未作成でもbase位置を維持し、新しいphase entryだけをbase execution順から派生させる
- 単一active phaseあたり最大400訪問の経路再計算Desktop／Mobile性能scenarioを本phaseから強制する。全phase投影最大800を1本のrouteへ混在させない

Exit:

- **EXIT-FSMC-I10-001** — a/bが別終点・別マーカーになる
- **EXIT-FSMC-I10-002** — 同じ側・同じ優先度の複数アイテムはraw配列で非連続でも1つの`ExecutionVisitIdentity`になり、phaseごとに投影される
- **EXIT-FSMC-I10-003** — 同じ側でも優先度または進行区分が異なれば別訪問になる
- **EXIT-FSMC-I10-004** — 同じanchorの複数訪問は件数badgeとDOM一覧で存在・優先度・進行区分を確認できる
- **EXIT-FSMC-I10-005** — 手動b→aが維持され、自動時だけa→bになる。phase別訪問は独立manual順を持たずbase execution順から派生する。既存execution identityへの位置指定追加は対象phaseの有無を問わずanchorを無視して既存base訪問へ統合し、「指定位置に新規訪問は作成しませんでした」と通知する
- **EXIT-FSMC-I10-006** — 同一anchorの別訪問が経路順・進行状態・挿入候補として失われず、中立marker・件数badge・現在ringで表示される
- **EXIT-FSMC-I10-007** — 先頭memberを削除しても同identityのmemberが残る場合は、route、hit-test、挿入anchorが同じ`PhaseVisitIdentityKey`へ再解決され、座標、順序、route cacheを維持する。member payloadだけを更新する
- **EXIT-FSMC-I10-008** — 同一セルa→bは自owner領域内mask exemptionで安全な場合だけmain pathなしの`same-cell-direct`として表示・hit-testでき、connector追加で3×3 pathfindingのcostや重複penaltyが変化しない。領域外・他番号横断が必要なら`unsafe-connector`となる
- **EXIT-FSMC-I10-009** — 同一anchorの別phase／priority visitは`coincident-anchor`、main path／connectorとも空、hitTestable false、cost 0となる。unroutableやdedupeにせず、marker stackまたはDOM一覧から各visitを選択でき、cache signatureはgeometryKindと両visit IDを含む
- **EXIT-FSMC-I10-010** — `value`、`backgroundColor`、map寸法、結合領域、passability rule、解像度、cost定数の変更で`pathfindingGraphFingerprint`が変わり、古いroute cacheを再利用しない。重複物理`(row, col)`は配列順で解決せず経路を生成しない
- **EXIT-FSMC-I10-011** — `PD-14.C3`のroute、marker／connector hit-test、cache、route insertion anchorがI7のsnapshotと`PhaseVisitIdentityKey`だけを使用し、member先頭ID、row／col、旧`RouteSegment` production edgeが0件となる
- **EXIT-FSMC-I10-012** — 本phase担当のDesktop／Mobile p95、main-thread task、memory上限を満たす
- **EXIT-FSMC-I10-013** — 選択hallの1-based頂点を`{ x: col - 0.5, y: row - 0.5 }`へexact 1回変換した全route node／segment、simplification後segment、routing port、connector、same-cell directがinclusive polygon内にあり、既存utility／Canvasと同じpoint／segment判定になる。直値／二重offset／軸逆転、凹部横断、別hall／map、stale definition、4頂点未満、面積`< 4`、in-bounds covered cell 0件は`invalid-route-constraint | outside-route-constraint`でunroutableとなる。editor／import／Backupでinvalidなpolygonをrouteだけで受理せず、端点内側だけで成功させず、whole-mapへfallbackしない
- **EXIT-FSMC-I10-014** — `src/types/map.ts`のfunction closure型`RoutePathConstraint`、`src/utils/mapRouteMapData.ts`の旧closure生成、`src/utils/mapRoutePolygon.ts`の旧`isPathAllowed`をdata-only DTO＋共有inclusive predicateへ移行し、旧型／closure／predicateのproduction import／callerが0件である。fixtureだけのlegacy比較は明示allowlistし、route／cache／hit-test／insertへ旧authorityを残さない
- **EXIT-FSMC-I10-015** — whole-map、hall A、hall B、同hall revision／polygon差でconstraint fingerprintとroute／hit-test／insert-preview cache signatureが変わり、別constraintのcacheを再利用しない。通常マップと集中モードは同じconstraint object、projection revision、`PhaseVisitIdentityKey`を使用する

### FSMC-I11: 横断E2E、性能、自動release gate

実装:

- I0で作成済みのDesktop／Mobile required 2 projectへI2～I10とI11所有の`releaseScope = initial-release`の全required testを集約する。I11作業中`internal-testing`はQA、release-readyはproduction artifactで同じinitial-release manifest集合を実行する。別jobのWebKit advisoryはsource stateから導出した`requiredSafetyIds(state)`だけを実行し、pre-releaseの`qa-chromium-only`を混入させない。`desktop-touch-context`はDesktop project内の必須testとして維持する。safetyとa11yは独立Chromium projectを増やさず、両required projectに所属するmanifest suite／tagとし、safety suiteはretry 0を継承する
- Canvasの論理座標assertionと必須projectの画像基準
- 端末全体OFF、event OFF、自動安全モード、ローカル制御変更mid-saveの横断検証
- DOM代替導線と公開上のアクセシビリティ制約
- PWA新旧世代、旧版A／新版B同時tab、failure injection、Backup置換、1主端末制約の横断検証
- 固定旧版A→候補新版B→固定旧版A→候補新版Bの全matrix、healthy legacy core rebase／anchor欠落・重複・衝突・capability破損の分類、rebase commit前後の再起動、metadata writer matrix、V2が拘束したV1 exact bytesの旧版復元
- candidate identity／authority／物理location／物理内容witness／absorption projectionを横断検証し、同じkey／identity／locationのraw DOMString-only・IDB canonical record-content-only変更について、legacy transition manifest一致時だけrebase、未列挙・曖昧時は安全モード、通常command競合時は全CAS abortとなるoracle
- 部分root欠損の安全モード／誤接続なし／Backup案内と、origin／profile完全消去のclean-start／保証外文書を別scenarioとして実行する
- 6.1.1のeligible in-place reset、別tab blocked、delete前／後終了、backup hash再選択、trusted-core export、clean profileからのV2／V1／XLSX 2.2復元を横断検証する
- same-origin Backup Workerのonline／offline、CSP、fatal UTF-8、unsafe URL、cancel／timeout cleanupをproduction PWA artifactで横断検証する
- `releaseScope = initial-release`の全performance scenarioを同一candidate buildのDesktop／Mobile profileで再実行し、対応traceabilityをすべて`implementation-enforced`へする。`future` scenarioは初版結果へ混入させない
- production bundleのreadinessを`release-ready`、`databaseTargetMode`を`fsmc-vcap-production`へ変更し、`DB_VERSION = Vcap`をproductionで初めて有効化する。10 core external candidateがあるDB absenceは先にcore-currentへmaterializeし、core 0件＋standalone `syncQueue` presentはbyte-exact archive-only current-version commitを行い、いずれもconnection close後のfresh attemptではpresent pre-`Vcap`として扱う。10 core candidateとstandalone queueがともにabsentのtrue fresh absenceだけprobeなし0→`Vcap`、present既存pre-`Vcap`＋collision-freeはH0 transaction settle／probe close後の単一request、collisionはrequest 0件とする。strict true fresh＋scope 0件だけをreadyとし、queue-onlyを含むpresent既存profileはscope 0件／unmapped-onlyでもmigratingで起動してmigration UI／V1退避／`fsmc.migrate.durable-visits.v1`だけを登録する。全scopeと全unused／unmapped physical Focus recordの原子migrationがreadyになったhealthy profileで初めてpublic handler、navigation、端末／event switch、C2／C3 projection、dispatch／commit authorizationを登録する。I2のcore materialization、queue-only archive、true fresh absence、現行core DB version、`Vcap - 1`、`Vcap`、supported上限、上限＋1のmigration／partial-loss／blocked handoff／A→B→A→B matrixを同じrelease-ready production artifactで全再実行し、QA override不在、I10以前production public edge 0件、ready前の通常public edge 0件、ready後の初回公開を静的検証する
- production `Vcap` request前にevent名基準`auditLegacyFocusDayScopesV1`をcore-only revisionから作る。raw day collisionでは未発行IDを含まないcanonical witness付き`capability-adoption-blocked`を返す。anchorはinvalid raw値とduplicate valid tokenを同一scanで全eventについて収集し、invalid単独、duplicate単独、別event群での両者併発をcanonical reason集合と全participant witness付き`event-authority-adoption-blocked`へ写す。valid／invalid排他rowへduplicateを付けた同一event複合はterminalへ縮退せずschema／semantic rejectにする。ID／anchor token allocator失敗は`event-authority-proposal-failed`とし、いずれもupgrade request／capability write 0件にする。collision-freeかつproposal成功後だけresolved authority／scopeを作り、bootstrap proposal witnessとpersisted authority input witnessを別branchのexact digestへ拘束する。`core-only`、partial-loss `map-cell-split-recovery-required`、2種adoption-blocked、proposal-failedを相互に代用しない
- raw-day repair previewは全affected semantic domain、全current-normalizer physical source row、全present sourceのsource-specific auto／user assignments、event-wide unscoped／embedded hall source、source-bound owner request、map request／decisionと6面closure、distinct Focus source／target、external candidate absence、preserved queue archive integrity、expected full core vector、changed-root集合を持つ。materialize-origin profileはreceipt拘束のexternal retirementを完了した新openまでrepair不可とし、retirementのselector途中競合と全selector削除後post-retirement verification競合を区別する。repair attemptはoperation fenceと全旧tab／Worker closure確認の下でinspection時`E0`、first write直前`E1`、IDB＋repair receipt＋Focus commit後`E2`を同期再検査する。E0差はwrite／lease取得0件、取得後のE1差はDB／Focus session record write 0件とledger `active → aborted`にする。E2でoriginal materialization vectorがexact再出現した場合は修復済みIDBをrollbackせず`committed-legacy-external-candidate-blocked`としてrepair receipt chain付きpost-repair retirementだけを許し、vector差、repair receipt欠落、preserved queue第三値は全new IDBを維持した`committed-recovery-required`とする。いずれもsame attempt bootstrapを禁止する。専用CAS＋lifecycle leaseはtotal／injective／closed replacement、全present source↔assignment exact bijection、event-wide source exact-once cleanup、owner request source digest／request／choice／assignment exact bijection、map request↔choice exact bijection、execution reference exact-once、`distinctNormalizedDayScopeCount`／`executionBucketCount`／`hallDefinitionSlotCount`／`hallRouteSlotCount`の宣言済み遷移、`hallDefinitionEntryCount`／`hallRouteListCount`／`hallRouteItemReferenceCount`とその他の保存field／payload bytesのexact維持、`before distinct < raw`かつ`after distinct = raw`、after collision-freeを全て満たす場合だけ宣言rootをcommitする。partial domain、many-to-one、domain外occupied target、choice欠落／余分／候補外、shared reference複数day、partial map rename、hall payload count差、physical drop／copy、Focus ABA、stale、取消ではDB／Focus session record mutation 0件とし、lease取得前はledger 0 transition、取得後はaborted outcomeを要求する。成功後の新attemptだけがbootstrapへ進む
- raw-day repairのrelease-ready adapterはさらに、全day-scoped source集合のalias group間exact partition、day-scoped＋event-wide hall assignment unionのglobal target injectivity、target occupantのfull source identity、nonempty execution partition row、map owner option／outcome、requested-target→choice-request→loss rows→plan→confirmation→lease→full-plan receiptのdigest chainを再計算する。複数event同relative keyは許す一方、同event cross-group source重複、2 rename→1 target、hall容量不足、day／event-wide target衝突、zero-member row、loss rowまたはreceipt plan欠落をwrite 0件にする
- 既存profileではpersisted association＋anchorから`ResolvedEventAuthorityV1.entries | rejectedEvents`を再構成する。各resolved eventは`eventBases`のeventName／ID exact 1行とper-event core／authority digestが一致する場合だけscopeを導出する。各rejected eventは保存entry 0件かつ帰属候補0件の場合だけprior basis 0件を許し、保存entry 1件以上なら同一prior event IDのbasis exact 1行を必須にしてbyte不変quarantineへ局所化する。resolved basis 0／複数、rejected basis複数、entryありのrejected basis 0、未知IDへ跨るentry、retired row↔retired basisの非bijection、retired rowのcount／digestと同IDのpossibly-empty entry slice不一致、retired entryのrow帰属0／複数、その他の非局所化差だけを全体`repair-required`とする。zero-entry retired rowはvalidとする。current aggregate authority digestと保存時digestの差だけを全体拒否にせず、domain-separated aggregate、partition digest、全event-local witnessを再計算する。migrationはfreeze barrier、active lifecycle lease完了、latest capture ack、全setter停止、fresh issuance、旧writer unmount後にtoken／record／basisを再検査し、resolved after-image entry、rejected eventのbyte保持entry、persisted retired rows、canonical `eventBases`、両aggregate、root readyだけを一括commitしてtokenをconsumeする。`rejectedEventPartitions`は同じcommitted snapshotから再導出し永続化しない。取消、capture欠落、session ABA、mapping／partition変化、token replay、stale、quota、tab競合、途中終了はmigrating＋public edge 0件を維持しfresh tokenで全resolved scopeを再計画する。ready後のcreate／rename／duplicate／restore／新版deleteと固定旧版A delete rebaseは、対象eventのbasis 4 field、両aggregate、entry、persisted retired rowの宣言済みafter-imageが変わる全場合にdurable rootを参加させ、rejected／retired eventの通常public edge、volatile fallback、event単位部分seed、自動default化を行わない
- WebKit advisory runnerが通常表示／a11y結果と安全性tag結果を分離し、`if: always()`相当で`fsmc-webkit-safety-observation.json`を出力する。常設`webkit-safety-promotion` jobもregisterに応じた結果artifactを必ず出力する。release-readiness jobは同一source SHA・`productionArtifactTreeSha256`・`productionBuildManifestSha256`の両artifact upload完了をDAG dependencyとして待ち、hash検証後に取り込む

Exit:

- **EXIT-FSMC-I11-001** — Desktop／Mobile Chromiumの必須自動テストを通過
- **EXIT-FSMC-I11-002** — データ消失、a/b混同、誤経路が0件
- **EXIT-FSMC-I11-003** — 必須自動テストでCritical／High相当の既知失敗が0件
- **EXIT-FSMC-I11-004** — Backup V2＋V1互換core、portable durable visit round-trip、V1／XLSX 2.2 full restoreの既存state移送／新規default、機能OFF／安全モード→ONの復旧、新規復元OFF、既存復元先状態維持を確認
- **EXIT-FSMC-I11-005** — release-ready production artifactが`databaseTargetMode = fsmc-vcap-production`、成功時の実open version `Vcap`である。absence resolvedはprobe 0／request 1／`oldVersion = 0`、既存pre-`Vcap` resolvedはH0 settle→probe close→request 1、collision／traceあり／unsupportedはrequest 0となる。別tab blockedは非terminal progress、同request再開、error／abort exact-one terminal、successは`request.result` handoff／reopen 0件である。fresh empty profileはresolved authority digest付きready、既存scope profileは同digest付きmigratingで通常public edge 0件となり、全scope原子migration後のready profileだけがproduction public registration／navigation／switch／C2／C3／dispatch authorizationを初めて有効にしてI2のmigration／partial-loss／固定旧版A互換testを全て再実行する。DB5 production artifact、QA namespace result、I10以前のpublic edgeを流用・許容しない
- **EXIT-FSMC-I11-006** — WebKit advisoryの通常表示／a11y失敗は必須Chromium jobと分離し、iPhone／ペン／OS・実機固有挙動を保証対象と表記しない。ただし同一candidateのWebKit safety observation欠落、hash不一致、`safety-failed`、`infrastructure-failed`、`requiredSafetyIds(state)`の現在必須ID未実行はrequired gateを失敗させる
- **EXIT-FSMC-I11-007** — 必須Chromiumと通常advisory WebKitが別job／別scriptで実行され、WebKit browser未導入は必須Chromium job自体を失敗させない。release gateはadvisory observationと常設promotion resultを必ず待つため、初回安全事故をregister追加前にすり抜けさせず、branch protectionのrequired contextを動的変更しない
- **EXIT-FSMC-I11-008** — 性能、PWA multiclient、backup、旧新版互換を通常のCI testとして実行し、外部receipt、実イベントpilot、managed-device artifactを要求しない
- **EXIT-FSMC-I11-009** — foundation quality、test membership、coverage policy、architecture policy、production／必要時QA manifest、functional result、performance reduced result、CI prerequisite resultのcurrent-run artifactとhashがrequired-resultsへ含まれ、いずれかの欠落・重複・stale・失敗ではsource固定readinessを変更せず、required gateを失敗させて配布を許可しない
- **EXIT-FSMC-I11-010** — 固定旧版Aのhealthy legacy-mutable-core-only更新は新版Bで自動rebaseして分割設定を正しいowner／statusへ復元し、capability-owned差、fence自己不整合、説明不能差はrebaseせず安全モードにする。rebaseのcommit前／後終了を含め、別ownerへの誤接続、durable state削除、部分commitが0件である
- **EXIT-FSMC-I11-011** — candidateのraw DOMString-only／IDB canonical record-content-only差を物理内容witnessで検出し、固定旧版Aのexact transitionに一致する場合だけrebaseする。manifest外、曖昧一致、projection-only改変はBackup案内付き安全モード、通常command中の差は全store write 0件のCAS abortとなる
- **EXIT-FSMC-I11-012** — `verify:fsmc:release-readiness`が、build前からsourceへ固定済みの`release-ready`と同一artifactについて、`releaseScope = initial-release`の全requirement、owner phase、required test、performance budget、failure barrier、利用者文書、production override不在を検証し、成功時だけ配布を許可する。verifierはreadinessを書き換えず、`future` entryの未実装は初版失敗にしないが、そのresult混入または初版entryのfuture誤分類は失敗にする
- **EXIT-FSMC-I11-013** — recoveryの全reachable decision tupleがexact 1 runbook actionを持ち、unsupported DBは常にwrite 0件のstop、全適格条件を満たすresetは全旧／全新、supportedだが不適格でbackup／connection前提を満たす場合だけguided reset、その他はwrite 0件となる。clean profile recoveryは再起動後の正常snapshotまで成功し、unsafe URLのclickable sink、Worker／reader／timer／Blob URL残留、untrusted split採用が0件である
- **EXIT-FSMC-I11-014** — advisory WebKitの通常の表示／a11y失敗自体はnonblockingである。ただし安全性tagがデータ消失、a/b混同、誤保存、誤復元を検出した現在candidateはobservationを`safety-failed`として必ずrelease停止し、次commitでstable finding IDを`config/fsmc-safety-findings.json`へ`status: "open"`で登録する。engine非依存に再現できる場合はunit／integration／Chromiumのrequired回帰testへ移し、WebKit固有で再現不能な場合はその最小WebKit回帰testをpromotion kind `webkit-temporary-required`へ昇格し、常設`webkit-safety-promotion` jobが実行する。`verify:fsmc:release-readiness`はcurrent-run observation異常、promotion result欠落／不一致／失敗、open finding、required command未実行、昇格test失敗のいずれかが1件でもあればrelease-readyを拒否し、修正・再現test成功・current-run observation成功・finding close後にだけ通常advisoryへ戻す
- **EXIT-FSMC-I11-015** — durable initializationの`missing`／`migrating`／`ready`／`repair-required`全分岐、scope 0／1／複数、nonexecution itemだけの日、standalone empty day、true fresh zero-scopeだけのinitial ready、core materialize後／queue-only archive後を含むpresent既存zero-scope／unmapped-onlyのmigratingを検証する。repair evidenceはunparseable root、parsed semantic-invalid root、trusted-localizable root、root-untrusted＋counter-exhausted併発、全reason availability／canonical順／witness digestを網羅する。persisted authorityはevent-localのassociation missing／extra、anchor missing／invalid／token mismatch／token duplicate全6 reasonと複合、global 5 reasonと複合、順shuffle／重複／digest差を拒否する。`eventBases`のbasis 4 fieldと両aggregateを再計算し、resolved scope↔active entry bijection、rejected eventのbyte不変quarantine、retired partition bijection、unaffected ready継続、局所化不能差だけの全体repair-requiredを検証する。`rejectedEventPartitions`はcommitted root＋persisted authorityからpost-deriveする非永続witnessであり、ready root／participant／historical rowへ保存しない。pre-upgrade raw-day collision、bootstrap invalid anchor、duplicate token、別event群での両者併発、同一event複合row schema reject、allocator unavailable／3回衝突を各terminalへexact対応させ、request／DB write 0件にする。raw-day repairは全semantic tupleのtotal／injective／closed mapping、day-scoped sourceのgroup間exact partition、全present source↔assignment、day＋event-wide hallのglobal target injectivity、full target occupant identity、source-specific／event-wide choice、map request↔decision＋6面、nonempty execution partition、Focus CAS、requested target→choice→loss rows→plan→confirmation→lease→full-plan receipt digest chain、E0／E1／E2とqueue integrityを一つのauthorityへ拘束する。可変4 count `distinctNormalizedDayScopeCount`／`executionBucketCount`／`hallDefinitionSlotCount`／`hallRouteSlotCount`だけを各式から再計算し、hall entry／list／item-reference count、execution reference、その他count／payloadを維持する。cross-group duplicate、2 rename→1 target、hall capacity、zero-member row、partial domain、many-to-one、domain外target、choice／loss／receipt不整合、shared reference、map 1～5面、physical drop／copy、Focus ABA、E1差、stale、取消、quotaは旧core／registryを維持し、E2再出現は全new IDB＋定義済みblocked／recoveryへ写す。resolved branchではbootstrap／persisted別authority source witness、proposal／association／anchor after-image、logical partition digest、同一process session全field、freeze／lease／ledger／3 counter、commit前後終了、別tab retryを検証する。ready writer matrixはplain createの決定的default、rename、whole-event duplicateの全durable state lossless remap、V2 full／core restoreのportable remap、V1／XLSX新規fullだけのdefault、既存legacy full／item-onlyのtransition、固定旧版A delete retired化、新版delete除去、empty-split reset再計算を含み、basis 4 field／両aggregate／entries／retired rowのafter-imageが変わる全場合だけdurable rootをparticipantにする。ready commitが保存するのはentries、eventBases、両aggregate、retired rows、root metadata／checkpointと別manifestのfence writeだけで、ready前／rejected／retired eventのpublic edge、volatile fallback、黙示default、scope単位部分seedを0件にする
- **EXIT-FSMC-I11-016** — release-ready adapterでbootstrapのsource／core／preflight／expected／observed authority subset鎖、event-wide hallのsource digestとplan保存request集合をfull receiptから再計算する。lease取得前拒否はDB／Focus session record／ledger mutation 0件、取得後拒否はDB／Focus session record mutation 0件かつ`none → active → aborted` exact 2 ledger transition、成功は`none → active → completed` exact 2 transitionとし、bare lease、例外だけの失敗、session recordとledgerを一括した曖昧なzero-mutation oracleを許さない
- **EXIT-FSMC-I11-017** — release-ready production graphをAST／dependency verifierで再走査し、旧function closure型`RoutePathConstraint`、旧selected-hall closure factory、旧`isPathAllowed`のproduction import／callerが0件、`RoutePathConstraintV1`、canonical polygon fingerprint、共有inclusive point／segment predicateだけが通常／集中route、cache、hit-test、insert previewへ到達する
- **EXIT-FSMC-I11-018** — stopped／resumed incident schemaの全dispositionを検証し、pendingだけがevidence／receipt null、preserved／restored／workaroundはkind一致する実artifact refと再計算済みdisposition digest、unrecoverableはassessmentに加えて独立notification receipt／digestを持つ。artifact kind／reference／byteLength／SHA、disposition／notification digest各1 field差、receipt入替え、resumed pending、未確認restoreをnegative fixtureで拒否する

## 10. テスト計画

### 10.1 代表fixture

A-26を「左a・右b」とし、次を登録する。

- 26a: 未処理アイテム
- 26a2: 処理済みアイテム
- 26b: 処理済みアイテム
- 26: 側なしアイテム
- 26c: 非対応アイテム
- 26c2: 26cの商品枝番
- 26d、26ab: 26cとは異なる非対応アイテム

先頭ゼロpreflightは2種類用意する。衝突なしfixtureでは`01a`、`1a`、`０１ａ`のうち単一のlegacy identityだけを保存して同じ売場へ正規化する。衝突ありfixtureでは`01a`と`1a`を別identity・別状態で共存させ、event enableを拒否してlegacy動作と解決案内へ戻す。さらにON中の商品編集、item import、Backup restore、地図編集、再取込の各after-imageが新しい衝突を作るfixtureを置き、全拒否後もcore／settings／control checksumとONが維持される期待値を固定する。衝突pairの同数置換、厳密減少、完全解消、device OFF中の衝突作成と再ON時のevent単位fallbackも含める。safe integer直前／一致／直後、1 MiB長大数字、mapless hall、manual hall、未割当て、legacy-unresolved、同優先度の複数商品・異なる優先度の商品も配置する。

訪問fixtureにはraw実行商品ID順`[A1, B, A2]`を置く。raw順を変更せず、normal投影が`[A(A1,A2), B]`となること、A2を後回しにするとnormal Aの位置を維持したままpostponed Aがbase順で追加されること、通常マップ、集中モード、`MapVisitListPanel`／`ProjectedVisitList`、space-navigation、I10 routeが同じ`PhaseVisitProjectionSnapshot`を使うことを固定する。`manualHallId` X→Y／未指定、hall削除／remap、mapped↔mapless、dangling manual hall、複数hall候補、stable hall IDの表示名変更も同じfixture familyへ含める。

別fixtureとして、横長結合セル、縦長結合セル、非連続`cellGroups`、同形状ブロック、不一致ブロック、重複block ownership、merge越境、重複merge、同一`(row, col)`でvalue／backgroundが異なる物理セルを用意する。`duplicate-number-region`、`multiple-block-owners`、`overlapping-number-regions`、`merge-crosses-block`は影響regionだけを局所exclusionにして影響外location／routeを継続し、同一connected componentで複数原因が併発するfixtureは全reasonを固定enum順の単一exclusionへ保持する。原因発見順shuffleでもkey／bytesを同値にし、duplicate physical cellだけはmap-wide `map-data-untrusted`として停止する。保存・コピー・自動継承・経路生成がこの境界を越えないことを確認し、背景色だけの通行可否変更で`pathfindingGraphFingerprint`とroute cacheが変わる正例も固定する。

永続化・ファイルfixtureには、`EventMetadata`のないevent、複数map event、利用者名が`__proto__`／`constructor`／`prototype`のdata、V1層別unknown、XLSX 2.2 full／item-only、duplicate JSON property、invalid UTF-8、深さ境界、3 scopeのV2、全scope共通`scope.references`、実payload一致／不一致`counts`、V2＋hash拘束V1のpair、companion unavailableのV2-only、32／48／64 MiB境界と300,000 ms export timeout、unsafe URL scheme／control／bidi、Worker cancel／offline、payload／metadata／checkpoint／fallback／candidate identity・authority・physical location・physical content witness・absorption projection／fence historical evidence・全historical row digest・participant digest・全root baseline／storeの部分欠損、同じexternal keyのlone surrogateだけが異なるraw DOMString、historical candidate external digestとbaselineの不一致、通常core traceだけのDB5、split対象traceだけのDB5、`H0`後に旧tabがcore root／candidateを変更するDB5、origin全消去、eligible／ineligible recovery、delete前／後終了、イベント削除D+29／D+30／31日／36日、時計rollback／session jump／24時間再確認を含める。固定旧版A fixtureにはanchor保持改名・通常状態更新、候補の一意な正常吸収／追加、吸収証跡なし消失、同一absorption projectionでlocationが異なる曖昧候補、anchor欠落、同anchor複数化、衝突作成、capability-owned差、fence自己不整合、説明不能なcore差、device／event OFF中rebase、rebase commit前／後終了を含める。ローカル制御fixtureは端末全体OFF、event OFF／ON、自動安全モード、`forceSplitPicker`のfactory default／永続化／再読込、個別entry隔離、別tabによるcontrol revision変更、offline、新規復元OFF、既存復元先状態維持、Backup内の禁止ON／OFF fieldを含める。さらに3.13の保証規模を同時に満たす最大fixtureを用意する。

### 10.2 必須マトリクス

| 観点              | 必須ケース                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分割              | なし、左a、右a、上a、下a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 番号identity      | 完全な`LogicalLocationSourceSnapshotV1`とitem／association／map／split revision、可変論理location集合、`26c = 26c2`、`26d`／`26ab`分離、衝突なしpreflightで`01a`／`1a`／`０１ａ`が同一、衝突ありとOFFではlegacy維持、ON中の新規pair・同数pair swapは全拒否、厳密減少・完全解消、BigInt前safe integer／1 MiB境界、mapless／legacy-unresolved、unsupported分離、「側未設定」表示                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 訪問identity      | 非連続同一execution identityのglobal集約、同側異優先度、異側同優先度、normal＋後回し／遅参、最大400 execution／800 phase、manual／hall両reorderのexact permutation、draft cancel、stale read witness、durable `executionVisitOrder`だけの更新、hall routeとのatomic update、raw item ID順／member相対順byte不変、既存identityへの挿入指定無視、manualHallId／hall定義・remap、mapped↔mapless、dangling／複数hall、stable hall表示名変更                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 形状              | 通常、横長結合、縦長結合、非連続block、4種の局所exclusionでは影響外location／route継続、番号重複、重複block ownership、merge越境、重複merge、duplicate physical cellだけはmap-wide fatal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 回転              | 0°、15°、45°、90°、180°、270°、359°、screen空間・DOM・focus順、a/b・badge文字の正立                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| DPR               | 1、2、3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 拡大・端末判定    | Mobile Chromiumは全倍率picker、狭幅Desktopは非スマートフォン、入力別閾値・曖昧帯の直前・一致・直後、空間順ラベル、persisted `forceSplitPicker`のfactory default／設定変更／再読込／untrusted fallback、アプリ倍率、200%                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 入力              | mouse、touch、長押し、drag、pinch後の片指継続、capture成功／失敗、duplicate pointer ID、additional pointer、Canvas外pointerup、Pointer Cancel、expected release後／unexpected active／stale別ID lost capture、`up→lost→click`／`up→click→lost`、画面回転、layout切替、synthetic click guard、global cancel／unmount後のstate・registry・capture・timer・effect・guard全empty、FSM tableの重複／unreachable／implicit default拒否                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 状態              | 空、巡回対象外、未処理、処理済み、後回し、遅参、後回し＋遅参二重指定拒否／既存診断、優先度混在、同側複数件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 集中追加          | 購入済、後回し、遅参、実行対象外のみ、空側                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 編集              | 単一、複数、一括解除、既定の追加・変更のみ、明示的完全同期、コピー先ID維持、retained overlap除外・手動再関連付け、履歴保護、解除preview、非連続block、manual改名・移動・同名置換、取消、保存失敗                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 再取込・通常編集  | 無関係変更、一意移動、欠落、重複、結合範囲変更、旧版変更検出、休眠・隔離、manualHallId除去／remap、mapped↔mapless、core／split複合digest、片側stale、取消                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DB互換            | non-creating DB absence observation、target-mode別null決定表、`oldVersion = 0`、現行core DB version、`Vcap - 1`／`Vcap`／supported上限のwitness・互換・partial-loss・不正store、supported上限＋1拒否、現行5／6／7／8 provenance fixture、probe settle／close、exact 1 request、blocked同request再開、terminal exact 1、success connection handoff、fence不整合、legacy rebase、I2～I10 production current／write 0、QA Vcap分離origin、I11 production初回Vcap                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ローカル制御      | code存在／public登録／到達／認可／commitのmatrix、端末・event ON／OFF、安全モード、一部event fallback、persisted `forceSplitPicker`の既定false・設定画面／通常／集中モード共通判定、revision競合、commit直前OFF、再起動、オフライン、Backup非収録、新規復元OFF、既存復元先状態維持、pre-release direct dispatch write 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| entry binding状態 | active、dormant、quarantined、同一map内の混在、number／original token整合・不一致、active／retained overlap拒否、地図では非表示・管理UIでは表示、端末内手動再関連付け、即時削除、retention、初版にportable単独出力なし                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 複数タブ          | 同一root vector同時編集、先行commit、stale拒否、複合操作rollback、再読込後の再編集                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PWA世代混在       | 旧SW＋旧tab、新SW waiting、新旧tab同時、自己probe close後のversionchange blocked、非terminal progress、blocker close後の同request再開、blocked中の旧tab writeによるH1 abort、error／abort dedupe、page終了時success 0、request result handoff／再open 0、update blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 障害注入          | QuotaExceeded、通常commandとlegacy rebaseの全barrierのcommit前／後、browser終了、control変更、network切断、payload／metadata／checkpoint／candidate vector／store欠損・変化、origin／profile完全消去                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 復元              | V1／XLSX 2.2 fullとmapあり・splitなしV2の休眠preview、legacy durable stateの既存event移送／新規default、両legacy item-only時の設定・destination durable維持、scope別exact 10 core section、eventLists／metadata exact 1と残る8 sectionのabsent／present-empty、event／item／map／block／hall／historical-owner references、全7 counts、複数map、map／mapless XOR、orphan／unscoped拒否、hall owner descriptor、item-only全体単射hall matchingのautomatic／choice／0件・新規event拒否、hall定義順、normal／priority／highest／unassigned／missing／malformed visit group、blockNames absent／present-empty／順序／重複、portable durableのempty day／非execution／group identity exact bijection、verified pairとverified V2-only、companion V1 representability／resource limit、role別pair digest／registry／incomplete handoff、hash拘束V1、取消、新規／既存、全置換・merge禁止、external ID非採用 |
| 復旧              | open結果・canonical reason・authority／collision witness・eligibility・backup・connection→runbook exact 1件、raw-day／duplicate-anchor adoption-blockedとallocator failureのrequest／write 0件、trusted-core export、total／injective／closed raw-day mapping、全physical source row＋全present source↔assignment exact partition、source-specific／event-wide hall／map choice、execution bucket count遷移、map 6面、Focus ABA、成功後new attempt bootstrap、event-local rejected durable quarantine、eligible atomic reset、不適格write 0、別tab blocked、delete前／後終了、backup hash再選択、clean profileからV2／V1／XLSX 2.2復元、別origin非削除                                                                                                                                                                                                                                               |
| 入力安全          | JSON import各fileの32／64 MiB境界、XLSX compressed 32 MiB＋展開／圧縮率境界、fatal UTF-8、duplicate property、非再帰depth／token、1 MiB数字、総entry、重複ref、retained不整合、未知version／scope／control、V2 domain-separated embedded digestのincluded／unavailable各field mutation、issues digest／pair digest差替え、unsafe URL、same-origin Worker、cancel cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 規模              | 15,000セル、最大8,192ブロック、15,000設定、30,000領域、400アイテム、400売場、400 execution訪問、最大800 phase投影、単一phase経路400、保証境界超過                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ファイル総量      | performance保証32 MiB／file、JSON import hard 64 MiB／file、XLSX compressed hard 32 MiB＋展開limit、export V2自体が32 MiB超なら停止、V2以内でV1 32 MiBまたはpair raw byteLength合計48 MiB超なら`companion-v1-resource-limit`付きV2-only、全上限内ならpair、各境界直前／一致／+1、countとbyte境界の逆転、形式別stop／best effort、V2 digest、未知version拒否                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 形式              | Backup V1/V2、初版legacy XLSX 2.2 full／item-only。XLSX 2.3、multipart、設定単独JSONが初版に露出しないarchitecture test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A11y／DOM         | 15,000行検索・virtualization・keyboard・focus復元、status exact 1回、light／dark token contrast、forced-colors、Canvas以外の全操作                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 品質統合          | test membership、coverage、architecture、foundation quality、required-results hashのcurrent-run成功。0 test、allow-empty、wire→runtime型、UI→persistence、raw URL→href、blob/data Worker edgeを拒否する。build treeはpath／length／byte／manifest-only差、nested directory列挙、symlink／junction／reparse／deviceを拒否し、別root／timezoneの同一treeを同値にする。quality producer 0回／複数回、逆needs／cycle、direct-required未設定／誤contextを拒否し、固定toolchainのpositive Playwright dry-runと旧形式negativeを実行する                                                                                                                                                                                                                                                                                                                                                                     |
| 互換              | 旧版A→新版B→旧版A→新版B、anchor保持時のfence rebase、anchor欠落時dormant、重複時quarantined、衝突時effective fallback、capability差の安全モード                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 経路              | a/b別anchor、安全な同一セルa→b、main path／種別付きconnector、自セル領域内port、unsafe-connector、unroutable、同anchor別phase訪問、共有projection、PhaseVisitIdentityKey基準のhit-test／挿入、先頭member削除、selected hall polygonのrouting port／raw・simplified path／全connector／same-cell全線分inclusive検証、invalid／stale constraintのno fallback、constraint fingerprint／index／graph差によるcache分離、重複物理cell拒否                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| アクセシビリティ  | DOM詳細、空側追加、同anchor候補、一時移動、Canvasなし経路挿入、DOM／Canvas別focus復帰、結果通知                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 自動テストprofile | Desktop／Mobile Chromiumの固定viewport、DPR、入力能力、retry 0、固定fixture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

必須マトリクスは全直積を意味しない。各行についてunit、integration、browser、a11y、性能の担当層をtraceability表へ記録する。a/b分離、原子保存、旧新版同居、ローカルOFF mid-save、Backup置換、訪問global集約はrisk-based必須組合せとし、その他はpairwiseを許可する。各ケースはrequirement ID、fixture、期待値、実行commandを持つ。データ安全性specはCI retryを0とし、初回失敗後のretry成功を合格扱いにしない。実機receiptや外部証跡は要求しない。

### 10.3 主要E2E

1. 左右分割で26a/26bを別々に開き、片側だけ状態更新する
2. 上下分割した結合セルを回転し、描画・タップ・経路を一致させる
3. Mobile Chromiumでpickerを開き、画面上の空間順と「左側 b／右側 a」等の表示・読み上げ順を一致させる。集中モードの空側から追加した結果も通常画面と一致させる
4. 同一地図内の複数セルを「追加・変更のみ」でコピーし、コピー元未分割に対応するコピー先既存設定が維持されることを確認する。別操作の「完全同期（解除を含む）」だけが解除preview・確定を行い、stale時は全abortする
5. 地図再取込後に設定を継承し、イベント単位Backup V2でround-tripする。同時出力したV1互換coreを固定旧版Aへ復元できる
6. 固定旧版Aへ戻してanchorを保持する改名・通常状態更新を従来表示で行い、新版Bでhealthy legacy-only差としてfenceを原子的にrebaseし、同じ分割設定とstored ONを復元する。anchor欠落はdormant、同anchor複数はquarantined、衝突はevent単位effective fallbackとし、別ownerへ自動接続しない
7. 端末全体OFF／event OFF→`PD-04`で定義したsplit固有部分のlegacy動作（I0の`PD-14.C0` baseline、I1の`PD-14.C1` pure contract、I7の`PD-14.C2`共有訪問投影、I10の`PD-14.C3`経路接続、重複物理cellを新規作成するafter-image拒否、`map-data-untrusted`安全判定の常時修正を含む）→ONで設定が戻る。OFF中のimport／通常編集でも新規重複は全store書込み前に拒否し、重複を作らない入力のcore保存結果は固定旧版Aと一致する。オフラインだけではOFFにならず、別タブがcommit直前にOFFへ変更した場合は全abortする
8. 先頭ゼロ衝突なしでは`01a`と`1a`を同じ半領域へ正規化し、衝突ありではevent ONを拒否してlegacy identityと原文を維持し、解決方法を案内する
9. raw実行商品ID順`[A1, B, A2]`を維持したまま、通常マップ、集中モード、`MapVisitListPanel` shell＋pure `ProjectedVisitList`、space-navigation、route／hit-testのnormal投影を単一`PhaseVisitProjectionSnapshot`由来の`[A(A1,A2), B]`へ一致させる
10. raw `[A1, B]`へ後回しA2を追加し、base A位置を動かさずnormal Aへ統合すると同時にpostponed Aをbase順で追加投影する。現在位置・保存位置を動かさず統合通知を全画面で一致させる
11. 「Bの後へAを挿入」を指定してもAの`ExecutionVisitIdentity`が既に存在する場合は位置anchorを無視し、既存Aへ統合して「指定位置に新規訪問は作成しませんでした」と通知する。identity未存在時だけ指定位置へ新規訪問を作る
12. 2タブが同じroot vectorを読み、タブA保存後のタブB保存が`PersistenceConflict`となり、Aのpayload・metadata・checkpointが維持される。タブBは退避後に最新DBを明示再読込してから再編集する
13. 採択済み`Vcap`以上かつsupported上限以下のprofileでnew store／必須6 capability rootが欠落・非互換なら、他の導入痕跡がなくてもpartial-loss安全モードで開き、DBを変更せず従来機能、分割機能利用不可理由、canonical runbookを表示する。`core-current`ではDBなし／pre-`Vcap`かつ導入traceなし・collision-freeの`core-only`、Vcap targetでは同inputのupgrade、collisionのadoption-blocked、DBなし／pre-`Vcap`だが導入traceありのrecovery-requiredを区別する。supported rangeの`db-version` witnessはexact 1件・値一致、pre-`Vcap`／absenceは0件とする。supported上限超過はsnapshot外`unsupported-database-version`、write 0件とする
14. dormant／quarantined設定の端末内手動再関連付けと削除についてpreview取消・確定を確認する。同owner＋番号のretainedがある通常設定・copyは除外し、明示再関連付けだけが元retained除去＋active化を原子的に行い、設定単独portable出力の入口が初版にないことを確認する
15. Backup V2はpreview後に既存イベントを全置換し、自動mergeしない。新規復元はOFF、既存復元は復元先ON／OFFを維持し、Backup内のローカル制御fieldを拒否する
16. `26`または非対応番号だけが登録された分割セルで左右とも誤割当てせず、中央badge、DOM一覧、分割有効化previewへ「側未設定」と件数を表示する
17. `26c`／`26c2`は同じexecution訪問、`26d`／`26ab`は別訪問のまま中央anchorの件数badgeへ表示する
18. 同じanchorの異なる優先度・phaseを中立markerへ重ね、DOM候補一覧で別`PhaseVisitIdentity`として選択できる
19. 横長結合セルのrouting portと半領域anchorを自セル領域内の安全な点線connectorで接続する。領域外または障害物横断が必要なcaseは`unsafe-connector`で`unroutable`とし、同一セルa→bにも同じ規則を適用する
20. block改名・移動では設定を維持してevidenceとanchorを原子的に更新する。重複番号、multiple block owner、overlapping number region、merge越境は該当regionだけをexclusion／quarantineにし、影響外locationの表示・hit-test・routeを継続する。duplicate physical cellだけはmap-wide `map-data-untrusted`となる
21. pointer FSMの導出済み全reachable `(state, normalizedInput)` rowとinvalid-invariant corruption guardを通し、capture成功／失敗、数値pointer ID `2`／`10`、duplicate／再利用、owner pairのcentroid pan／distance pinch、owner外move、owner離脱時rebase、pinch後の片指pan継続、additional pointer drain、Canvas外pointerup、expected release後／unexpected active／stale別ID lost capture、画面回転、layout切替、global cancel、unmountを検証する。viewport transformはexact 1回、tap／popupは0回となり、到達不能／重複rowがない。`dispatch-tap`直後のidleだけsynthetic-click guardはexact sequence／target／pointer／button／座標／timestamp witness付き`awaiting-matching-click`となる。直後のbrowser synthetic clickだけmatching、keyboard click、別target、同座標の別sequence、PointerEvent pointer ID差、1000ms境界超過はnonmatchingにし、matching clickまたは次のprimary downでguardをemptyにする。`down→up→expected lost→matching click`と`down→up→matching click→expected lost`の両順序でtap exact 1回／click dispatch 0件とし、expected lostはrelease witnessだけ、stale lostは何もclearせずguardを維持する。unexpected active lostを含むglobal cancel／unmount後だけstate、active／release registry、capture、timer、pending effect、guardが全てemptyになる遷移列を固定する
22. イベント削除画面の既定が「30日保持」で「今すぐ完全削除」が別選択であること、D+29の端末内再関連付け、正常時計のD+30対象限定cleanup、時計異常時の延期をfake clockで確認する
23. 旧版A tabと新版B、SW waiting、versionchange blocked、QuotaExceeded、transaction各段階abort、browser強制終了で部分commitがない。presence absenceではprobeを作らず`oldVersion = 0`、existingではH0 transaction完了後に自己probeをcloseしてからrequest ordinal 1を発行する。external blocker中は同requestがpending、旧tabがcoreを変更した場合はblocker close後のH1で全abortし、error／abortはterminal ordinal 1へdedupeする。successは`request.result` connectionをhandoffし、再open 0件となる
24. `__proto__`等の利用者名をV2で往復し、不正ref、未知version／scope、hard limit超過、unsafe URL scheme／制御文字／bidi spoofをV2／CSV／新規編集ではDB更新前に拒否する。V1／XLSX 2.2／既存profile由来の同じunsafe URL文字列は`legacy-compat`でraw値を保持してもlink化せず、全href sinkが`SafeExternalHref`以外を拒否する。空文字はURLなしとして受理する
25. 別日程・別地図コピー、XLSX 2.3、multipart、設定単独JSON、意図的再訪の初版UI・command・routeが存在しないことをarchitecture testで確認する
26. 日程、ブロック、番号、side、優先度、`manualHallId`、hall削除／remap、mapped↔maplessの編集でA1のexecution identityを既存Bへ変え、B訪問位置と他itemの相対順を維持してA1だけをB member末尾へ移す。変更元visit、現在位置、保存位置、後回し・遅参、routeの`PhaseVisitIdentityKey` anchorが全画面で同じ結果へ再解決される。dangling manual hallは`missing-manual-hall-reference`のlegacy-unresolved、複数hall候補は`multiple-hall-owners`のambiguousとして非routeableにし、異なるdangling `manualHallId`を統合せず、表示名変更だけではidentityを変えない
27. 同じphase visitの先頭memberを削除しても残存memberがある場合は、DOM panel、route、hit-test、挿入操作が同じ`PhaseVisitIdentityKey`へ再解決され、座標、順序、route cacheが変わらずmember件数だけが更新される。DOM panelの選択・挿入callbackがrow／colや代表item IDではなくvisit IDを渡すことも確認する
28. event ON中に商品編集、source switch、既存event bulk add、item import、V1 full import、legacy XLSX 2.2 full import、Backup V2復元、通常地図編集、地図再取込の各操作で`01a`／`1a`衝突を新規作成し、各操作が全store書込み前に拒否され、元data、settings、durable visit state、anchor、association、control ONが維持されることを確認する
29. mapped、mapless、legacy-unresolvedの商品を同じraw実行列へ置き、共有訪問projectionが全identityを保持する一方、mapless／unresolvedに架空のmap cell、marker、route anchorを作らないことを確認する
30. payload、metadata、checkpoint、runtime fallback、identity／authority／物理location／物理内容witness／absorption projection付きrecovery candidate vector、capability store、fence historical evidence／全historical row digest／全root baselineの各部分欠損・cross-invariant不一致では自動安全モードとなる。同じexternal key／identity／locationでraw DOMStringをlone surrogate間だけ変更した場合もUTF-16 code unit witness差として検出する。参加rootについてinventoryが列挙する`syncQueue`等の全potential IDB storeをsnapshot時emptyでも同transactionへ含め、別transactionやtransaction内WebCryptoを待たず、candidateのempty→insert、消滅、内容変更をCAS abortする。非参加rootを含むexternal candidateをcommit前またはIDB commit後・post-check前に変更した場合、healthyなlegacy-mutable coreだけならそれぞれwrite 0件の`legacy-rebase-required`または全new IDB rootを維持した`committed-legacy-rebase-required`とし、capability-ownedまたは分類不能な差ならそれぞれwrite 0件のrecovery-requiredまたは全new IDB root＋完全baseline fenceの`committed-recovery-required`とする。別scope commandでfenceを更新しても非参加historical row／baselineを消去せず、再起動でも同じ分類となる。origin／profile全消去では空profile、device OFF、enabled event ID 0件で開始し、消去dataの自動復旧や保持成功を表示しない
31. 複数map eventのV2とSHA-256で拘束されたV1を同一snapshotから生成し、V2のfull core全sectionとV1 coreが明示transform以外で同値、V2は新版へ、exact V1 bytesは固定旧版Aへ復元できることを確認する。`backup-v2`／`companion-v1`のrole、`preparationKind`、fileName／byteLength／SHA-256、V2 `companionCore`、domain-separated pair／issues digest、immutable registry bytesをhandoff直前に再検証し、role逆転、片方差替え、stale／finalized handleをhandoff 0件にする。pair branchで片方だけのdownload handoffはexact 2 artifactの`pair-incomplete`、V2-only本体失敗はreasonと同じ`structural-v2-only-incomplete | resource-v2-only-incomplete`のexact 1 artifactとなり、完了通知を禁止して各専用guidanceだけを返す。V1へlossless変換できないhall group／order／manual hallは構造reason＋resource以外のcanonical issuesと`structural-v2-only`、companion／pairだけがresource limitを超えるfixtureはresource reason＋exact 1 resource issueと`resource-v2-only`にし、scope、export、prepared、verification、handoffのreason／issues／digestを一致させる。両fixtureはV2 exact 1、V1／pair 0、null pair digestのreason別verified V2-onlyを新版へ完全復元する。V2自体がunrepresentableまたは32 MiB超の場合だけV2も0件にする。さらにlegacy XLSX 2.2 full／item-onlyをpreviewし、fullはevent coreを全置換してsplitをdormant化、item-onlyはmap／splitを維持し、いずれもstale／cancel／validation失敗でwrite 0件とする
32. 経路計算後に`backgroundColor`だけで通行可否を変え、`pathfindingGraphFingerprint`差により古いcacheを破棄して再計算する。selected hallではrouting port、anchor、raw／simplified main path、全connector、same-cell directの全点・全線分を同じinclusive polygon predicateで検証し、別hall、凹部横断、invalid／stale polygonをwhole-mapへfallbackしない。polygonの開始点／向き差は同じ`RoutePolygonFingerprint`、頂点／hall／revision差は別値とし、polygon／fingerprint不一致を拒否する。whole-map／hall／polygon revisionのconstraint fingerprint差でもcacheを分離する。同一`(row, col)`の重複cellを作るimport／通常編集はON／OFFとも原子的に拒否し、既存重複cellを並べ替えても一方を採用せず、当該mapの経路を安全に停止する
33. 全3 reader scopeで`scope.references`が実event／item／map／block／hall／historical-owner slotとexact bijection、`deriveEventBackupCountsV2`の全7値が実payloadと一致する場合だけ受理する。full-split／synthetic core-mapはeventLists／metadata exact 1 rowと残る8 sectionのabsent対present-empty、実行順、day mode、route／hall／viewport、event settings、durable visit state、複数map、map／mapless owner XOR、hall定義・route owner、hall source順、blockNamesのabsent／present-empty・順序・重複をlosslessに保持する。hall visit groupはnormal／priority／highest／unassigned／missing／malformedの全branchとcontextual 3 faceをround-tripし、orphan／unscoped／dual-match、reserved `undefined` collision、owner／ref／order不正をpreview前に全体拒否する。item-onlyは`eventLists`以外のdata sectionを含めず既存map／split／settings／durable stateを維持・rekeyし、resolved manual hallはsource V2 digest／file SHAへ拘束した全hallRef↔distinct destination Hall IDのtotal injective matchingだけを許す。matching 0件、新規event＋resolved hall、候補衝突、非単射・候補外・別backup choice replayはwrite 0件、unique matchingはautomatic、複数matchingは全graphのchoiceとする。portable durableはcore-derived day scopeとexact bijection、empty durable dayと非execution itemを保持し、再構築group identityもpairwise uniqueなexact bijectionとする。正しいdigestのままsection／counts／referencesだけを水増し・省略する入力も全体拒否し、production writerはfull-split／item-onlyだけ、core-map serialize戻り／command／dispatch 0件とする
34. device再ON後の衝突fallbackでitem番号修正、map identity修正、current item参照0件の孤立訪問状態破棄をそれぞれpreviewし、strict decreaseだけを原子的に確定する。pair swap、同数置換、新規pair、stale、通常writer経由は全拒否し、完全解消commit後だけ対象eventがeffective ONへ戻る
35. FSMC DB absenceはopen前のexternal tri-stateで分類する。10 core external keyのいずれかがpresentならbyte-exact materialize後にretirable coreをarchive／closeし、core 10 keyが全absentでpreserved `syncQueue`だけpresentならqueueをbyte-exact archive／closeしてcoreを捏造しない。DB absent、core 10 key全absent、queue absentの3条件が同時成立する場合だけtrue freshとする。通常core metadata／checkpoint／candidateだけのDB5は`core-only`のまま、split対象metadata／checkpoint／candidateだけのDB5は`map-cell-split-recovery-required`となる。導入trace 0件のDB5→`Vcap`では`after-vcap-history-source-preflight`後に旧tabが非fence rootのpayload／metadata／checkpoint／candidateを1件でも変更すると、versionchange内`H1`の同期byte比較で最初のwrite前に旧DBのままabortする。`after-vcap-history-source-reread-before-first-write`後のfault、external `E0/E1`差、transaction内split IDB traceも同じく全abortし、transaction内WebCrypto／別async taskを使わない。DB5→`Vcap`と新規DB 0→`Vcap`をversionchange commit直前でabortすると旧version／storeなし、commit直後から`onsuccess`前で終了すると`data`／`control`／`durable-visit-state`／`event-settings`／`event-settings-bridge`、lossless candidate vector付きtotal historical evidence／全historical row digest／participant digest／全governed root baselineを持つinitial fence、6 capability rootのmetadata／checkpointが全て存在する。既存DBのlegacy rowは`H1`、capability payload rowはfactoryが実際に書いたcanonical after-image、fence rootはhistorical rowなし／baselineのみであり、導入前のabsent capability payload rowを保存したfenceを拒否する。新規DBは全non-fence root writeとevidenceが同じfactory値で一致する。commit後終了は次回起動でinitial fenceと全rootを検証し、差なしは正常、healthy legacy-only差は全new DBからrebase、それ以外の差は全new DB＋fenceのrecovery-requiredとなる。採択済みVcap以上の運用後空store、fence欠落／埋込全historical row digest・participant digest・candidate vector・historical/baseline cross-invariant・root universe・capability-owned baseline不一致は再初期化せず`map-cell-split-recovery-required`となる。このmigration oracleはI2では`databaseTargetMode = fsmc-vcap-qa` artifactだけで実行し、同candidateのproduction artifactがDB5／公開command 0件を維持することも対で検証する。I11 release-readyでは初めて`fsmc-vcap-production` artifactへ同じoracleを再実行する。existing profile participantは5 payload root、fresh profile participantはfactory-written全non-fence rootとactual write log／digest対象へexact一致し、bridge crashはpendingから再開する
36. 同じproduction artifactでWebKit safety testをpass、safety failure、browser install／起動失敗、observation欠落、source／artifact hash差替えにし、passだけがcurrent-run gateを通る。通常表示／a11yだけの失敗はobservationのsafety statusを偽装せずnonblockingとなる
37. WebKit observation、promotion result、required-resultsについて、`status = passed`なのにfailed resultあり、failed IDと結果集合の差、`requiredSafetyIds(state)`／selected ID未実行、selected外result混入、promotion／required-resultsの正しいIDへ別testのcommandまたは未登録commandのpassを付ける、infra併発、open findingありの`not-required`、分岐外fingerprintをそれぞれ投入し、schemaとrequired aggregatorが集合包含、ID→required command対応、statusを再計算して全て拒否する。pre-releaseへ`releaseScope = future && status = contract-enforced && artifactMode = pre-release-production-guard`のID、future planned、`qa-chromium-only` IDを混入する、現在phaseのinitial-release production guard IDを省略する、release-readyでinitial safetyを非`implementation-enforced`または`qa-chromium-only`のまま残す、full safety IDを省略する、selectionMode／readiness／manifest hashを差し替えるcaseも拒否する。production／QA build manifest、required-results、observation、promotionのいずれか1つだけを別run IDまたは別attemptにしたcaseもcurrent workflow runtimeとの不一致で拒否する。安全assert失敗とinfraが併発した場合は安全失敗を優先し、安全失敗0件で未実行またはinfraがある場合だけinfrastructure failureとなる
38. 新版Bのfence作成後に固定旧版Aでanchor保持改名・通常状態更新を行い、Bで`rebase-required`→`fsmc.internal.rebase-legacy-core.v1`となる。candidate消滅はcheckpoint descriptorとprevious rowの`absorptionMatchProjection`がexact 1件一致する場合だけ正常吸収とし、0件、null、または同一projectionでlocation違いの旧entryが複数ある場合はrecovery-requiredにする。同じidentity／locationのraw DOMString-only／IDB record-content-only変更はlegacy transition manifestのexact 1件へ一致する場合だけrebaseし、未列挙・曖昧・projection-only変更はrecovery-requiredにする。通常core-only rebaseの`actualCapabilityWrites` baseは`{data, control}`とし、`eventNameAtBasis`、event instance ID、per-event basis core／authority digest、root aggregateの`basisCoreDigest`／`basisEventAuthorityDigest`、durable entries、retired rowのいずれかの宣言済みafter-imageが変わるanchor保持rename／delete等では`durable-visit-state`を必ず加える。shadow reconcile併用時だけack after-imageどおり`event-settings`／`event-settings-bridge`も加える。new fenceのparticipant tupleと置換historical rowは`sort(unique(changed legacy roots ∪ actualCapabilityWrites))`、logical mutation／digest対象とexact一致させ、fence payload／metadata／checkpoint writeは別のadministrative manifestへexact一致させる。非参加rowをbyte同値で維持し、device／event OFFとreadiness不足でもauthority正常ならrebase、authority不正なら拒否する。R0→R1の追加変更はwrite 0件で最新snapshotから再試行し、rebase commit前終了はcurrent core＋rebase前fenceのpending、commit後・R2前終了はcurrent core＋new fenceとして再開する。R1→R2の追加healthy legacy差は次のrebaseへ送り、capability-owned／分類不能差は確定済みrootを維持して安全モードにする。anchor missing／invalid／mismatch／duplicateのstatus期待値を確認し、fence自己不整合と説明不能なcore差もrebaseせずBackup案内にする
39. recovery-required画面から診断`fsmc.recovery.diagnose.v1`を生成し、trusted coreだけをV1へ退避する。eligible caseは別tab／接続を閉じ、選択済みBackup hashを再照合してsplit stateだけを単一transactionでresetする。ineligible caseはwrite 0件のまま二段階確認付きclean-profile手順へ進み、delete前終了では元profile、delete後終了では空profileとして再開し、別originを削除しない
40. Backup workerはmain threadでwhole-file `arrayBuffer()`／`text()`を呼ばず、1 MiB以下のsliceでV1／V2 JSONの32 MiB保証境界と64 MiB hard limit、XLSX 2.2のcompressed 32 MiBと展開後limitの直前／一致／+1を判定する。cancel、timeout、malformed UTF-8、worker crash、offline PWA起動後の再実行でWorker、reader、timer、transactionを残さず、`worker-src 'self'`のままblob／data workerを作らない
41. `CellSplitDefinitionPanel`／retained管理の15,000行で検索、filter、virtualization、container focus＋`aria-activedescendant`によるkeyboard移動、選択、閉じて再表示したfocus復元を完了する。別fixtureの`MapVisitListPanel`／`ProjectedVisitList`は最大800 phase訪問で選択・挿入・focus復元を完了する。両方で処理結果ごとに常設`role=status`領域がexact 1回だけ更新され、light／dark／forced-colorsで非色覚手掛かりを維持する
42. test membership、coverage、architecture、foundation qualityの各verifierへ0 test、allow-empty、未登録command、wire→runtime型import、UI→persistence import、raw URL→href、blob／data Worker edge、別run／attemptのtree／manifest hash偽装を投入し、個別testがpassedでもrequired gateが必ず拒否する。file treeのpath／length／byte／manifest-only単独差、nested directory entry、symlink／junction／reparse／device、別root／timezone同値を各fixtureで検証する。quality producer 0回／2回、逆needs／cycle、`fsmc-required-gate` direct-required未設定／誤contextを拒否する。固定Node／npm／lockfileで`npm run test:fsmc:playwright-cli-contract`を実行し、`npx playwright install --with-deps chromium --dry-run`だけがexpected browser／flag転送で成功し、旧`npm exec`2形式が失敗する
43. I11 release-ready productionでDB absent＋10 core external key absent＋preserved queue absentのtrue fresh empty profileだけはevent basis付きready＋entry 0件、core materialize後／queue-only archive後を含むcollision-freeなpresent既存profileはscope 0件／unmapped-onlyでもmigrating＋通常public edge 0件で開始する。raw-day collisionは`capability-adoption-blocked`、invalid／duplicate anchor participantは`event-authority-adoption-blocked`、event ID／anchor token allocator unavailable・3回衝突は`event-authority-proposal-failed`となり、upgrade request／DB／token／default write 0件と各runbookを確認する。raw repairは全semantic raw tupleのtotal／injective／closed mapping、day-scoped sourceのgroup間exact partition、present source↔assignment、day＋event-wide hallのglobal target injectivityとfull target occupant identity、source-specific／event-wide choice、map request↔decision＋6面、nonempty execution partition、Focus CAS、requested target→choice request→loss rows→plan→confirmation→one-shot lease→full-plan receipt digest chain、E0／E1／E2とqueue integrityを一つのauthorityへ拘束する。可変4 count `distinctNormalizedDayScopeCount`／`executionBucketCount`／`hallDefinitionSlotCount`／`hallRouteSlotCount`だけを各決定式から再計算し、hall entry／list／item-reference count、execution reference、その他count／payload bytesを維持する。cross-group duplicate、2 rename→1 target、hall capacity、zero-member row、partial domain、many-to-one、domain外target、choice／plan／loss確認／lease／receipt不整合、shared reference、map 1～5面、physical drop／copy、Focus ABA、E1差、stale／取消／quotaは旧core／registryを維持し、E2再出現は全new IDBを維持した定義済みblocked／recoveryへ写し、成功後のnew attemptだけがbootstrapする。persisted authorityはevent-local association missing／extra、anchor missing／invalid／mismatch／duplicateの6 reasonと複合をcanonical化し、global 5 reasonは全体reject、local rejected eventの既存durable entriesはbyte不変quarantine、unaffected eventはready継続、局所化不能差だけ全体repair-requiredにする。migrationはfreeze request→active lifecycle lease完了→latest capture ack→setter停止→fresh issuance→旧writer unmountを守り、valid session全fieldを移送する。snapshot欠落／field不正／mapping 0・複数／unmapped recordはfield別default／破棄previewと全確認を必須にする。zero-session renameだけempty `keyPairs`を許し、rename／delete persistence→registry lease中freeze、freeze先行拒否、二重finalize／replay、3 counter上限、ABA／同bytes再作成、stale、取消後のfresh issuanceを確認する。commit前終了はmigrating、commit後rootはentries／eventBases／両aggregate／retired rowsだけを保存し、`rejectedEventPartitions`は同じcommitted snapshotからpost-deriveする非永続witnessとする。reload／別tab／Backup V2往復でevent bases、durable order／phase／anchor／completionを復元する

44. Backup hall group codecはowner別reachable semantic pairのleft-inverse／injectivityを検証し、通常unassigned、実hall ID `undefined`／`undefined:priority`／`undefined:highest`、suffix付き実ID単独、`A`＋`A:priority`、`A`＋`A:highest`を区別する。aliasは`hall-group-token-noninjection`でV2／pair 0件とし、current map＋deleted blockはhistorical blockの`current-map` parentでround-trip、unknown／ambiguous parentやhistorical mapへの劣化は全体拒否する

45. raw backup snapshotへobject own-property `undefined`、array own `undefined`、sparse hole、rotation／viewportの`-0`を各sectionで投入し、DTO copy／JSON化前のrepresentability auditがsource path付きtyped blocker、V2／pair 0件を返すことを確認する。absent optional、explicit `null`、正の`0`は別positive fixtureとし、key消失／`null`化／`0`化した後のschema成功をlossless成功にしない

46. 同じsource pathへobject own undefined、array own undefined、hole、`-0`、null、0を置いたraw witnessを作り、exact tag／index／lengthを含むdomain-separated digestが全て異なることを確認する。通常JSON化後の欠落／null／0からraw witnessを逆算したartifactと、tagまたはdigestだけを差し替えたartifactはV2／pair 0件にする

47. CSV由来event update／source switch、既存event bulk add、item-only／V1 full import、XLSX 2.2の各成功writerで、event ID／anchor保持、basis 4 field、`basisCoreDigest`／`basisEventAuthorityDigest`、durable entriesをafter-imageから再計算し、core／metadata／association／durable／checkpoint／fenceがall-old／all-newになることを確認する。identity-bearing差をdurable participantなしでcommitするfixtureと、identity非変更なのにbyte同値durable rootをputするfixtureを拒否する

48. Desktop Chromiumで自動判定が直接選択となる条件でも、設定画面で`forceSplitPicker`をONにすると通常マップ／集中モードの両方がpickerとなり、reload／offline後も維持される。factory default false、OFFへの復帰、untrusted control rootの安全fallback、Backupにfieldが含まれないことも確認する

49. 訪問一覧のmanual reorderはUI draft中とcancel後に全永続rootをbyte保持し、保存時だけ`fsmc.visits.reorder-execution-order.v1`でdurable `executionVisitOrder`を更新する。hall順reorderは`fsmc.visits.reorder-by-hall.v1`でhall route settingsとdurable orderをall-old／all-newにし、両入口ともraw item ID列とmember相対順をbyte保持する。preview後のraw execution item membership差、片root stale、unknown／duplicate／missing visit、quotaはwrite 0件にする

50. 完全なevent item／association snapshotへtarget-map、other-map、mapless、legacy-unresolved、associationなしを混在させ、`itemSetDigest`／`snapshotDigest`とrevisionを再計算する。target mapだけにwhole／a／b／unsupported logical locationを作り、partial caller、独自filter、suffix配列をarchitecture testで拒否する

### 10.4 アクセシビリティ試験

キーボード・画面読み上げによるCanvas半セルの直接選択だけは対象外だが、非スマートフォンのmouse／touch直接選択、スマートフォンpicker、次のDOM代替導線は必須とする。mouseはDesktop既定context、非スマートフォンtouchは同じDesktop project内の`desktop-touch-context`、pickerはMobile projectで実ブラウザ入力まで検証する。

I0で`config/fsmc-a11y-oracles.json`とschemaを作り、surface／fixture／Desktop・Mobile projectごとに期待role、accessible name、description、state、DOM順、Chromium accessibility tree順、focus開始点／移動順／trap、opener、close後のfocus return、live-regionのpoliteness／atomicity、操作ごとの期待mutation回数をexact登録する。required browser testは`getByRole`等のrole／name／description／state query、DOM assertion、Chromium CDP `Accessibility.getFullAXTree`または同等のversion固定AX tree API、keyboard操作を組み合わせ、期待nodeの欠落・余分・順序差を失敗させる。これは実screen readerの代替oracleであってNVDA／JAWS／VoiceOverの実機保証ではない。

live-region testは事前mount済みのsole `role="status"`を操作前から`MutationObserver`で監視し、`operationEventId`ごとにtext mutation exact 1回、`aria-live="polite"`、`aria-atomic="true"`、region nodeの再mount 0回、同一結果の再通知0回を検証する。focus returnはDOM起点とCanvas起点を別fixtureにし、仮想化rowがunmountされた場合の固定fallbackまでoracleへ明記する。axeはこのsemantic／focus／announcement oracleと別assertionとして実行し、いずれか一方で他方を代替しない。

- pickerとポップアップに適切なdialog名
- pickerのDOM順・focus順・読み上げ名が、回転後を含む画面上の左→右または上→下の空間順と一致する
- 初期フォーカス、focus trap、Escape、DOM起点では呼出ボタン、Canvas起点では地図ツールバー内の固定focus対象への復帰。`body`やfocus不能なCanvasへの復帰は禁止する
- `A-26a`、`A-26b`を読み上げ可能
- 状態をポップアップ内の文字でも確認可能
- キーボードだけで分割設定画面のブロック・番号一覧へ到達できる
- Canvasを使わず26a/26bの詳細表示、アイテム追加・編集、状態確認・変更ができる
- 買い物一覧・訪問一覧から対応する側の詳細へ移動できる
- 空の側も番号一覧から選択してアイテム追加へ進める
- `whole`／unsupportedの「側未設定」badgeからCanvasを使わず対象一覧と編集へ進める
- 同じanchorの各`PhaseVisitIdentity`を別候補として選び、Canvasを使わず経路挿入・一時移動を完了できる
- 経路挿入、取消、成功、競合は、事前にDOMへ常設した単一`role="status" aria-live="polite" aria-atomic="true"`領域のtextを操作結果ごとにexact 1回更新して通知する。領域を結果ごとにmountし直さず、同じ結果の重複通知を禁止し、DOM起点では呼出ボタン、Canvas起点では地図ツールバー内の固定focus対象へ戻す
- 画面読み上げでブロック、番号、側、状態、操作結果を区別できる
- ライト／ダークの通常文字は4.5:1以上、大きな文字・UI component・意味を持つgraphicは3:1以上とし、分割側、状態、選択、経路種別を色だけで区別しない
- `forced-colors: active`でも番号・a/b・badge・focus・選択・connector種別が文字、border、patternのいずれかで区別でき、system colorへ追従する
- `CellSplitDefinitionPanel`／retained管理の15,000行と`ProjectedVisitList`の最大800行をkeyboardだけで検索・移動・選択でき、訪問一覧では挿入も完了できる。未mount rowへの移動後も論理順、読み上げ名、container focus＋active descendant、閉じた後のfocus復元が一貫し、roving row focusを混在させない
- 200%拡大で欠けない
- axeのmoderate/serious/critical違反0件

axe合格をCanvasのキーボード対応や完全なWCAG適合の根拠にはしない。Canvas上のsemantic color token、contrast、forced-colors代替はtoken unit testと固定screenshot assertionで別に検証し、DOM代替導線のbrowser testと双方を必須にする。

### 10.5 性能試験

3.13の最大条件を同時に満たすfixtureと同一candidate buildを使う。用語上の`runSample`は、scenarioの固定開始状態へresetしてから終了条件までを1回実行し、他runのmeasurementを再利用しない独立runを指す。profile／scenarioごとに`warmupRun`を1回実行して値を捨て、その後30個の`measuredRunSample`を完走させる。通常のduration scenarioは各runのelapsedを1個の`runValue`とし、interactionはrun内input observationsからlatency metric 1個、memoryはrun内memory observationsからpeak／residualの各metricにつき1個のrunValueへ集約する。最終`scenarioP95`はmetricごとに30 runValueを昇順にした29番目のnearest-rank p95とする。timeout、assert失敗、必要observation不足、cleanup失敗が1 runでもあれば数値へ置換せずscenario全体を失敗させ、外れ値を除外しない。I0では値を製品要件として固定し、各scenarioは下表の適用phaseから通常の自動テストとして合否判定する。外部性能証跡やmanaged-device sampleは保存しない。

`config/fsmc-performance-budgets.json`へNode 24.19.0、npm 11.19.0、lockfileで解決した`@playwright/test` versionとChromium revision、workers 1、viewport、DPR、touch／mobile能力、`warmupRuns: 1`、`measuredRunSamples: 30`、run開始状態、run内aggregation、run間`nearest-rank-p95`、単位、timeout、`enforcedFromPhase`、`scenarioRole: "product" | "off-reference"`を記録し、verifierで実行環境と照合する。runner identityは別の`config/fsmc-performance-runner.json`へGitHub Actions、`ubuntu-24.04` runner class、owner `Repository Maintainer`、`infra/fsmc-perf-runner/Dockerfile`、publisher workflow／job、public image URI `ghcr.io/blusalice3-foundation/event-shopping-planner-routeplanning-fsmc-perf-runner`、exact OCI digest、consumer `.github/workflows/quality.yml#fsmc-performance-shard`、literal `container.options`として固定し、budget変更とrunner変更を分離する。`samples`という曖昧fieldは設けない。各scenarioは`offComparison: { required: boolean, referenceScenarioId: string | null }`を必須とし、`required=true`なら同profile・同fixture・同candidate buildの一意な`off-reference` scenarioを参照し、falseなら`referenceScenarioId=null`とする。referenceは自分や別profileを参照せず、targetの直前に独立process／runSample集合で測る。通常マップと集中モードは別scenario ID・別runSample集合とし、同じ絶対上限を共有できるがobservation／runValueを混ぜない。既存の`config/performance-budgets.json`は別機能の外部証跡契約であり、FSMC scenarioを追加せず、同fileのpending状態をFSMC-I0 blockerにしない。

`ubuntu-24.04`の移動aliasだけでは性能判定に使わない。runner configへ`runnerProvider: "github-actions"`、runner label／class、`executionMode: "container"`、immutableなOCI digest、`architecture: "x64"`、OS／kernel、CPU model allowlist、logical CPU数、cgroup v2 CPU quota、memory limit、swap disabled、job isolation／co-tenancy契約を固定する。`quality.yml`の`fsmc-performance-shard`は同じ値を非placeholderの`container.options: --cpus <literal> --memory <literal> --memory-swap <same-memory-literal> --pids-limit <literal>`として所有し、`container.credentials`を持たない。I0 Exitはpublic packageから実在digestを匿名pullしてDockerfile source hashと対応付けるため、未解決placeholder、moving tagだけ、host直実行、configとworkflow literalの差を受理しない。job開始時にprovider metadata、`/proc/cpuinfo`、`/proc/meminfo`、cgroup CPU／memory、swapを検証し、固定calibration fixtureを同じbrowserで測ってI0固定band内であることを確認する。環境field不一致、取得不能、calibration範囲外はinfrastructure failureとしてsampleを採用せず、製品性能の合否を出さない。上限値とrunner envelopeの変更は別々にdiff・reviewできるようにする。

性能matrixの実行予算はexactに固定する。I0 qualification-onlyは同一run／attempt内のexact 12 shardを`max-parallel: 12`で重複実行し、reducerがcurrent run-attempt jobs APIの`started_at`／`completed_at`から正規化したUTC epoch millisecondのhalf-open区間をend-before-startで走査して最大同時実行数12以上、started→completed区間unionだけのqueue除外wall-clock 360分以下を証明する。productは最大54 shard、Actions job開始から1 shardの計算上限300分、job hard deadline 330分、12並列で5 waveなのでmatrixの計算上限1,500分／hard-timeout上限1,650分、runner消費の計算上限16,200分／hard-timeout ceiling 17,820分を1 attemptの上限とする。canonical shard ID順を12 laneへround-robinし、各lane最大5 shard、宣言expected minutesの最大lane合計を最後に整数分へ切り上げた`projectedFiveWaveMinutes`も360以下にする。test retryと自動workflow retryは0とし、開始前allowlist証跡を持つ`infrastructure-failed`だけをCI Operator承認後のGitHub Actions `Re-run all jobs`でperformance-rerun-preflight、quality、prerequisite、production／QA build、functional、両WebKit、performance plan／全shard／reducer、finalizer、gateまで同一sourceの新attemptへexact 1回再実行する。最大2 attempt、shard単体／failed-jobs／部分matrix rerun、別attempt resultの混在を禁止し、2 attempt合計はperformance shard matrix部分だけで3,300 matrix分／35,640 runner分を上限とする。started後のabsolute deadline watchdog、製品test失敗、budget超過、安全assert失敗、開始状態不明は再実行対象にしない。

5秒操作scenarioでは、連続する各pointer／wheel入力の受付から次のpaintまでを`inputObservation`とし、入力のないidle frameを加えない。各measured runはpan、zoom、rotationを各10 observation以上含み、そのrun内の全inputObservationを昇順にしたnearest-rank p95を`runInputLatencyP95`＝runValueとする。30個のrunInputLatencyP95から求めるscenarioP95が下表のinput-to-next-paint上限を満たし、さらに全30 runの全main-thread task observationが後述の絶対上限を満たす。入力不足を短い高速runとして採用しない。

各scenarioは、timed区間外でfixtureをseedした直後のroot hashを固定し、run後の期待root hashまたはwrite 0件を検証する。scenarioごとにbrowser processを再起動し、同一scenarioのwarmupと30 measured runだけでそのprocessを共有する。各runは新規BrowserContext／page／temporary originから開始し、HTTP cache、IndexedDB、service worker、PWA offline状態はscenario定義どおりにseedする。前runのindex、Worker、transaction、DOM、route cache、download object URLを持ち越した場合はcleanup失敗とする。

全scenarioに非nullの絶対上限を設定し、比較可能な既存操作だけは絶対上限に加えて、同じCI run・同じbuild・同じprofileで直前に測る機能OFF p95からの悪化10%以内も満たす。次の数値は暫定測定値ではなく`PD-17`の製品上限である。厳格化は通常reviewで行えるが、緩和は新しい製品判断ID、理由、影響、期限の有無を記録し、製品判断者の承認と通常code reviewを必須とする。

OFF比較はexactに、`map-first-render-normal → off-map-first-render-normal`、`map-first-render-focus → off-map-first-render-focus`、`map-interaction-normal → off-map-interaction-normal`、`map-interaction-focus → off-map-interaction-focus`の4組だけを`required=true`とする。referenceは同じ最大fixtureを端末全体OFF・event OFFで開き、targetは同fixtureをhealthy effective ONで開く。他のproduct scenarioと全off-reference自身は`required=false, referenceScenarioId=null`とする。4 referenceも下表の独立scenario、初版manifest entry、絶対上限、適用phaseを持ち、未実行、targetより後の実行、異なるbuild／profile／fixture hash、reference resultの再利用を失敗させる。

| scenario ID／対象                                                                   | Desktop Chromium CI p95 | Mobile Chromium emulation CI p95 | 適用開始 |
| ----------------------------------------------------------------------------------- | ----------------------: | -------------------------------: | -------- |
| `startup-preflight-index`：preflight＋初期索引＋15,000件validation                  |                1,500 ms |                         3,000 ms | I2       |
| `local-control-toggle`：端末／event制御のpreview＋commit                            |                1,000 ms |                         2,000 ms | I2       |
| `legacy-rebase-commit`：最大fixtureのhealthy legacy差rebase                         |                2,500 ms |                         5,000 ms | I2       |
| `backup-v2-v1-export`：V2／V1各32 MiB以下・pair raw total 48 MiB以下の生成／handoff |                5,000 ms |                        10,000 ms | I4       |
| `backup-v2-parse-preview`：32 MiB以下のV2 worker parse＋validation＋preview         |                5,000 ms |                        10,000 ms | I4       |
| `backup-v2-restore-commit`：最大fixtureの全置換commit                               |                3,000 ms |                         6,000 ms | I4       |
| `xlsx22-full-restore`：legacy XLSX 2.2 full parse＋preview＋commit                  |                7,500 ms |                        15,000 ms | I4       |
| `event-enable-preview`：15,000設定の有効化preview                                   |                1,500 ms |                         3,000 ms | I5       |
| `event-enable-commit`：15,000設定の有効化commit                                     |                2,500 ms |                         5,000 ms | I5       |
| `single-split-save`：単一分割設定のvalidation＋commit                               |                  250 ms |                           400 ms | I5       |
| `copy-preview`：15,000件の追加・変更／完全同期preview                               |                1,500 ms |                         3,000 ms | I5       |
| `copy-commit`：15,000件copyの原子的commit                                           |                2,500 ms |                         5,000 ms | I5       |
| `definition-list-first-render`：管理panelの15,000 active行初回virtualized表示       |                  750 ms |                         1,200 ms | I5       |
| `definition-list-filter-input`：active設定の検索入力から次paint                     |                  100 ms |                           150 ms | I5       |
| `retained-list-first-render`：管理panelの15,000 retained行初回virtualized表示       |                  750 ms |                         1,200 ms | I5       |
| `retained-list-filter-input`：管理panelの検索入力から次paint                        |                  100 ms |                           150 ms | I5       |
| `map-reimport-commit`：最大fixtureの複合reimport plan＋commit                       |                3,000 ms |                         6,000 ms | I6       |
| `visit-rekey-projection`：400商品／最大800 phase投影のrekey＋snapshot再構築         |                  750 ms |                         1,500 ms | I7       |
| `off-map-first-render-normal`：最大fixtureの通常マップ初回描画、機能OFF             |                1,500 ms |                         2,500 ms | I8       |
| `map-first-render-normal`：最大fixtureの通常マップ初回描画                          |                1,500 ms |                         2,500 ms | I8       |
| `projected-visit-list-first-render`：最大800 phase訪問のDOM一覧初回表示             |                  500 ms |                           800 ms | I8       |
| `projected-visit-list-filter-input`：最大800 phase訪問の検索入力から次paint         |                  100 ms |                           150 ms | I8       |
| `off-map-first-render-focus`：最大fixtureの集中モード初回描画、機能OFF              |                1,500 ms |                         2,500 ms | I9       |
| `map-first-render-focus`：最大fixtureの集中モード初回描画                           |                1,500 ms |                         2,500 ms | I9       |
| `off-map-interaction-normal`：通常マップ5秒操作、機能OFF                            |                  100 ms |                           150 ms | I8       |
| `map-interaction-normal`：通常マップ5秒操作input-to-next-paint                      |                  100 ms |                           150 ms | I8       |
| `off-map-interaction-focus`：集中モード5秒操作、機能OFF                             |                  100 ms |                           150 ms | I9       |
| `map-interaction-focus`：集中モード5秒操作input-to-next-paint                       |                  100 ms |                           150 ms | I9       |
| `split-direct-popup-normal-desktop`：direct half hit→popup paint                    |                  150 ms |                                — | I8       |
| `split-picker-popup-normal-mobile`：cell tap→picker→side選択→popup paint            |                       — |                           200 ms | I8       |
| `split-direct-popup-focus-desktop`：direct half hit→popup paint                     |                  150 ms |                                — | I9       |
| `split-picker-popup-focus-mobile`：cell tap→picker→side選択→popup paint             |                       — |                           200 ms | I9       |
| `route-recalculate`：単一phase 400訪問の経路再計算                                  |                  750 ms |                         1,500 ms | I10      |

- main thread taskは全measured runで観測した各taskが200ms以下とし、p95へ隠さない。1秒を超える処理は進捗表示と取消を提供する
- memory metricは固定Ubuntu runner上で、browser-level CDP `SystemInfo.getProcessInfo`が返す同一candidate Chromiumのbrowser、renderer、Worker、utility、GPU各PIDを`memoryObservation`ごとに列挙し、各`/proc/<pid>/smaps_rollup`の`Pss`をbyteへ変換して合算する。各measured runの開始時に全discoverable page／Worker targetの`HeapProfiler.collectGarbage`後のbaselineを取り、scenario中100ms間隔の各PSS合計をmemoryObservationとする。そのrunの最大値との差を`runPeakDelta`、画面終了、Worker／Blob URL／timer／transaction cleanup、30秒待機、再GC後の1観測との差を`runResidualDelta`とする。終了したPIDは次observationで0、新規PIDはその時点から加算し、同じbrowser外のprocessを含めない。CDP field、PID、`smaps_rollup`、PSSのいずれかを取得不能ならRSSやrenderer heapへfallbackせず当該runとscenarioを失敗させる
- 30個の`runPeakDelta`と`runResidualDelta`をそれぞれ独立にnearest-rank p95へ集約する。peak scenarioP95はDesktop CIで256 MiB、Mobile emulation CIで192 MiB以下、residual scenarioP95は両profileで64 MiB以下とする。MobileはChromium emulation processの指標であり、特定スマートフォンの物理memory保証ではない
- timeout／cancel後にWorker、timer、Blob URL、transactionを残さない
- 描画ごとに全商品と全セルを総当たりせず、`MapLocationIndex`を再利用する
- V1／V2 JSON importは各fileが32 MiBのperformance保証上限を超え64 MiB hard limit以下なら警告付きbest effort、64 MiB超ならparse前に拒否する。XLSX 2.2は`config/xlsx-limits.json`のcompressed 32 MiBと全展開limitをhard stopとして優先し、64 MiB JSON帯を適用しない。exportはV2自体が32 MiBを超える場合はV2を停止する。V2が上限内でcompanion V1 32 MiBまたはpair raw byteLength合計48 MiBだけを超える場合は`companion-v1-resource-limit`とissues digestを持つverified V2-onlyへ進み、全上限内だけpairを作る。不完全なpair handoffをV2-onlyへ偽装しない。count／V2 byte／V1 byte／pair byte／JSON import byte／XLSX compressed・展開byteの各境界は直前／一致／+1で別testにする

上表のscenario ID、閾値、phase、profile、metricを削除・改名・`planned`へ戻す、または担当phaseより後へ延期する変更は、緩和と同じ`PD-17`変更手続を要する。各manifest entryは単一profileと単一`enforcedFromPhase`だけを持ち、Desktop directはhalf hit→popup paint、Mobile pickerはcell tap→picker paint→side selection→popup paintの固定action sequenceとする。I11で全`releaseScope = initial-release` scenarioをproduction artifactへ再実行し、表にない補助measurementやQAだけの結果で代用しない。

## 11. 自動テストゲート

### 必須CI

- `desktop-chromium-required`: Desktop Chromiumの全E2E。既定mouse contextに加え、同project内の`isMobile=false`／`hasTouch=true`固定`desktop-touch-context` testを必須manifestへ含める
- `mobile-chromium-required`: Android相当Mobile Chromiumのスマートフォン常時picker、縦横画面、空側追加、gesture
- `a11y-chromium-required` suite／tag: DOM代替導線、経路挿入、focus、axeをDesktop／Mobile両projectで実行する。独立した第3projectにはしない
- unit、integration、persistence、worker、encoding、architecture、coverage、FSMC compatibility、failure injection、legacy parity
- 必須projectのCanvas画像基準と論理座標assertion
- FSMC required configはworkers 1、retries 0、`failOnFlakyTests: true`、`fullyParallel: false`、`trace: "retain-on-failure"`を同時に固定し、flaky successを合格扱いにしない。一般testの既存retry方針を変更せずFSMC専用configで分離する
- `config/fsmc-test-manifest.json`は`releaseScope = initial-release`かつ`enforcedFromPhase <= currentPhase`で`status != planned`のrequired testをprogressにかかわらず選ぶ。required Exit集合だけを`phaseProgress = in-progress`なら`completedThrough`まで、`exit-candidate`なら`currentPhase`までに分け、選択0件、重複test ID、未登録test、required commandの0件／複数対応、initial-release entryの適用phase以後の`planned`残存を失敗させる。`future` entryは初版gateのselected／executed／failed集合とplanned残存判定へ入れず、scope不一致を失敗させる

I0 Exit候補の同一HEADでRepository Maintainerが`fsmc-required-gate`自体を一度だけ追加required化し、既存`quality`もrequiredのまま維持する。既存branch-protected終端contextへの逆接続、phase／findingごとのcontext変更、循環needsを禁止する。常設`webkit-safety-promotion` upstream jobはopen `webkit-temporary-required`が0件ならregister hash付き`not-required` resultだけを生成し、1件以上なら`npx playwright install --with-deps webkit`を実行して全対象testをretry 0で実行する。対象test 0件、未導入、未実行、失敗はresultを失敗状態にする。aggregatorはI0～I11の毎candidateでproduction build、current phaseで既にenforcedなChromium test、phase結果、advisory observation、promotion resultの完了を`if: always()`相当で待ち、同じsource／`productionArtifactTreeSha256`／`productionBuildManifestSha256`／register hashへ拘束された成果物を必須入力にする。pre-releaseでは`phaseProgress = in-progress`なら`completedThrough`まで、`exit-candidate`なら`currentPhase`までのExitを`verify:fsmc:phase-gate`へ要求し、どちらもcurrent phaseで既にenforcedなtestを全件要求する。I11 `exit-candidate`かつ`release-ready`だけは全条件の`verify:fsmc:release-readiness`を実行する。job skip、artifact欠落、`safety-failed`、`infrastructure-failed`、promotion failure、選択testの未実行、hash不一致ならmerge gateを閉じ、release modeでは`releaseScope = initial-release`の全required test未実行も閉じる。`future` entryの実行結果を初版gateへ混入した場合も閉じる。全jobはテストごとに再buildせず、同一CI runで作成したbuild artifactをhash検証後に再利用する。source-bound証跡bundleやmanaged-device receipt、継続的なbranch protection変更権限は作らない。

### advisory CI

- `webkit-advisory-smoke`
- `webkit-advisory-a11y`
- `webkit-advisory-safety-observer`

WebKitは必須Chromium jobと別のscript／jobで`npx playwright install --with-deps webkit`を実行し、通常の表示／a11y結果をnonblockingとする。advisory runnerは通常testとmanifestのsafety tagを分離集計し、test processの終了状態にかかわらず`if: always()`相当のreport stepで`fsmc-webkit-safety-observation.json`をuploadする。reportには同一`ciRun`のsource SHA、`productionArtifactTreeSha256`、`productionBuildManifestSha256`、selectionMode、implementation-state／manifest SHAを入れ、`requiredSafetyIds(state)`が0件、同導出ID未実行、browser install／起動不能、report不能を`infrastructure-failed`、安全assert失敗を`safety-failed`にする。future scope／QA-only IDはpre-releaseの未実行扱いにせず、導出集合への混入自体をschema違反にする。required gateはこのartifactを待って検証するため、初回安全事故を人手で次commitへ登録するまでの間も公開できない。

通常表示／a11yの失敗件数やreview状態自体をDoDにしない。通常のtest logや失敗時traceはCIデバッグ用途に限り、製品完了の外部証跡や正式保証に使用しない。advisoryで安全問題を発見した場合はstable finding registerへ追加し、engine-agnostic required回帰testへ移すか、WebKit固有ならその最小回帰testだけを一時requiredへ昇格する。open safety findingまたは昇格test失敗中はrelease gateを閉じ、Chromiumで再現不能という理由だけでnonblockingへ戻さない。WebKit safety observationは現在candidateの既知安全事故を止めるgateであり、WebKit／iPhone全般の正式互換保証を意味しない。

Windows、Android、Galaxy A57、iPhone、ペン等の実機確認は任意であり、機種別receipt、実イベント記録、OS build証跡を完了条件にしない。利用者向け文書は「Desktop Chromium／Mobile Chromium emulationで自動テスト済み」と表記し、特定OS・端末を正式保証済みと表記しない。任意確認で安全問題を発見した場合は再現fixtureとretryなしの自動回帰testを追加する。

## 12. ローカル公開と有効化

1. FSMC-I0～I11の必須自動テスト、`verify:fsmc:release-readiness`、既存release gateが成功し、source固定readinessが`release-ready`のproduction buildだけを配布する
2. 配布直後は`control` rootの端末全体をOFF、既存eventをenabled ID一覧へ入れず、`PD-04`のsplit固有部分のlegacy動作（`PD-14`、重複物理cellの新規after-image拒否、`map-data-untrusted`安全判定の常時修正を含む）を維持する
3. 利用者が端末全体設定をONにし、対象eventの番号衝突、側未設定、anchor／association、変更内容を有効化previewで確認してevent単位で明示ONにする。commit時に最新rootで再検証する
4. 新規イベント、Backupから新規復元したイベントも初期OFFとする。既存イベントへの復元は復元先のローカルON／OFFを変えない
5. 問題発生時は端末全体OFFを最優先し、`PD-04`で定義したsplit固有部分のlegacy動作（`PD-14`、重複物理cellの新規after-image拒否、`map-data-untrusted`安全判定の常時修正を含む）へ戻す。保存済み分割設定は削除しない

remote／runtime activation flag、実イベントpilot、利用回数集計、外部metrics、署名receiptは使用しない。source固定readinessは未完成buildの誤公開を防ぐcompile-time安全境界であり、利用率や遠隔配布制御には使わない。インストール済み旧versionを遠隔停止できないため、安全モードの場所、事前Backup作成、修正版への更新方法、browser／OSの完全消去は保持保証外であることを利用者向け文書へ明記する。eventを複数端末で同時編集せず、主端末を移す場合はBackup V2による全置換を使う。

## 13. 公開停止条件

severityはFSMC-I0 ADRの固定rubricで判定する。Criticalはアプリが開始したcommit／import／restore／migration／cleanup、または検出可能な部分破損でのデータ消失、a/b間またはevent間の交差更新、誤復元、ローカル制御迂回等の安全事故またはその再現可能な危険とする。browser／OS／利用者によるorigin／profile全消去そのものは`PD-18`により保持保証外であり、アプリが保持済みと誤表示する、別dataへ誤接続する、事前Backup説明がない場合だけ本rubricの対象にする。Highは必須自動テストprofileで主要flowが完了不能、再現可能なfreeze／crash、絶対性能上限超過等の重大な利用不能とする。

次のいずれかが1件でも発生した場合は公開を停止する。

- 26aの操作で26bのアイテムまたは状態が変更される
- アプリが開始したcommit／import／restore／migration／cleanup、またはrecoverableな部分破損で、分割設定、item、訪問順のいずれかが失われる
- 回転後に描画・タップ・経路位置が一致しない
- 同versionアプリが生成し、embedded digestが正しく保証hard limit内にあるBackup V2を同versionへ復元できない。`companionCore.status = "included"`のpairではcompanion hash／pair digestが正しいV1互換coreを固定旧版Aへ復元できない場合も停止する。`status = "unavailable"`のverified V2-onlyへV1復元を要求せず、破損、未知version／scope、V2自体の上限超過を仕様どおり拒否した場合は停止理由にしない
- 地図再取込で誤った番号セルへ設定が継承される
- 同名の別イベントへ休眠設定が誤接続される
- 優先度が異なる訪問が黙って1訪問へ統合される
- 複数タブ競合が通知されず、後から保存した内容で既存設定が上書きされる
- 採択済み`Vcap`以上かつsupported上限以下のnew storeなし・非互換profileを未導入扱いで変更する、空storeを再作成する、または従来機能まで起動不能にする
- 固定CI profileで性能基準を再現可能に超過する
- offlineでも端末／event OFFを操作できない、またはofflineだけを理由に自動安全モードへ入る
- 外部storage消失のない正常保存後の再起動で、完全profile消去以外の理由により設定が消える、誤接続する、または空dataで上書きする
- payload／metadata／checkpoint／fallback／物理location付きrecovery candidate vector／fence historical evidence・全root baselineの部分root欠損・capability-owned変化を未初期化またはhealthy legacy差扱いして空dataを保存する、残存候補を破壊する、別ownerへcross-bindする、または自動安全モードとBackup復旧案内を出さない。逆に固定旧版Aの説明可能なlegacy-mutable coreだけの差を破損扱いして互換flowを完了不能にすることも停止対象とする。browserが消した欠損payload自体の保持・自動復元は保証しない
- 必須自動テストprofileで再現可能なフリーズまたはクラッシュが発生する
- 端末全体OFF、event OFF、自動安全モードのいずれかをsplit commandが迂回する
- `contracts-only`／`internal-testing`のproduction buildでenable UI／commandが利用できる、またはstorage／query／remote値でreadinessを迂回できる
- Backup復元によって新規イベントが自動ONになる、既存イベントのローカルON／OFFが変わる、または別端末の変更を推測mergeする
- 同じexecution identityの商品追加で既存訪問位置が動く、非連続商品が画面ごとに別訪問になる、またはnormal／後回し／遅参の投影が画面と経路で食い違う
- connectorが自セル・結合セル領域外または障害物を横断する
- feature OFFでsplit固有のlegacy表示、番号identity、whole-cell位置解決、anchorを正規化除外したlegacy-core checksumが`PD-14`と重複物理cellの新規after-image拒否／`map-data-untrusted`安全判定以外に変化する、またはraw item原文を変更する、または常時安全修正が無効化されて通常マップと集中モードの訪問・経路不整合や重複物理cellの新規作成・非決定的経路が再発する
- ON中のidentity変更が新たな正規化衝突を作ったのに操作を全拒否せず、部分適用、自動OFF、黙示統合のいずれかを行う
- safety-critical testが初回失敗しretryだけで成功する

自動テスト対象外のOS・端末・ペン固有、または必須保証外のWebKit固有の表示問題だけでは自動的な公開停止条件にしない。ただし、`PD-18`で明示したbrowser／OS／利用者によるorigin／profile完全消去そのものを除き、アプリ動作によるデータ消失、a/b混同、誤保存、誤復元を再現できた場合は対象環境を問わず停止し、fixtureへ追加する。完全消去でも保持済みとの誤表示、cross-bind、事前Backup案内欠落は停止対象とする。

### 13.1 停止手順

- authorityが正常なら利用者へ端末全体OFFまたは対象event OFFで、`PD-04`で定義したsplit固有部分のlegacy動作（phase時点でimplementation-enforced済みの`PD-14.C2`／`C3`、重複物理cellの新規after-image拒否、`map-data-untrusted`安全判定を含む）へ戻すよう案内する。`recovery-required`ではcontrol writeを案内せず既存の自動安全モードを維持して6.1.1へ進む。どちらも影響versionの配布を停止し、遠隔で既存端末をOFFにできるとは表示しない
- 問題発生前に作成済みのbackupを形式別に検証して優先する。V2はembedded digestを常に検証し、`companionCore.status = "included"`だけは`companionCore.sha256`、exact V1 bytes、pair digestも検証する。`status = "unavailable"`ではnonempty issues、issues digest、`pairDigest = null`、companion handle不在を検証する。standalone V1はschemaと選択時に計算したresume用SHA-256、legacy XLSX 2.2はZIP preflight／version／workbook構造と選択時SHA-256を検証し、選択時SHA-256をV1／XLSX内蔵digestと表現しない。recovery-required発生後に新しく退避できるのは6.1.1の診断がtrustedと分類したcoreから生成するV1だけで、untrusted split rootをBackupへ混入しない。診断情報は利用者が明示的に提供した範囲だけを扱う
- 再現fixtureを作成し、修正版が同じ失敗をretryなしの自動テストで防ぐまで再配布しない
- 影響、回避策、実際に確認できた保持状態、完全profile消去が疑われる場合は保証外であること、Backupからの復旧可否と見込みを推測せず正確に通知する
- 通常の停止・調査ではDB versionを下げたり、新storeや保存済み分割設定を削除したり、自動修復を実行したりしない。唯一の例外は、利用者が6.1.1の診断結果、退避Backup hash、影響scopeを確認して二段階承認したeligible in-place resetまたはguided clean-profile resetであり、対象外originを削除せず、削除と復元を一つの原子操作と表現しない

停止／再開recordは次のversion付きexact discriminated unionとする。自由文だけのincident、finding／artifact不明、利用者個人識別子、未確認の復旧成功を受理しない。

```ts
type FsmcIncidentEvidenceArtifactKindV1 =
  | "preservation-verification"
  | "restore-verification"
  | "workaround-verification"
  | "unrecoverable-assessment"
  | "user-notification-receipt"
  | "root-cause-review"
  | "finding-closure";

type FsmcIncidentScopeBoundEvidenceKindV1 = Exclude<
  FsmcIncidentEvidenceArtifactKindV1,
  "root-cause-review" | "finding-closure"
>;

interface FsmcIncidentScopeRefV1 {
  schemaVersion: 1;
  scopeKind:
    | "profile"
    | "event-instance"
    | "map-instance"
    | "persistence-root"
    | "backup-artifact";
  registryReferenceId: string;
  affectedArtifactBinding: {
    sourceSha: string;
    productionArtifactTreeSha256: string;
    productionBuildManifestSha256: string;
    ciRun: { runId: string; runAttempt: number };
  };
}

interface FsmcIncidentEvidenceArtifactRefV1<
  TKind extends FsmcIncidentEvidenceArtifactKindV1,
> {
  schemaVersion: 1;
  referenceId: string;
  artifactKind: TKind;
  scopeDigest: TKind extends FsmcIncidentScopeBoundEvidenceKindV1
    ? string
    : null;
  byteLength: number;
  sha256: string;
}

type FsmcIncidentDispositionEvidenceV1 =
  | {
      kind: "preserved";
      artifact: FsmcIncidentEvidenceArtifactRefV1<"preservation-verification">;
    }
  | {
      kind: "restored";
      artifact: FsmcIncidentEvidenceArtifactRefV1<"restore-verification">;
    }
  | {
      kind: "preserved-with-workaround";
      artifact: FsmcIncidentEvidenceArtifactRefV1<"workaround-verification">;
    }
  | {
      kind: "unrecoverable-user-notified";
      artifact: FsmcIncidentEvidenceArtifactRefV1<"unrecoverable-assessment">;
    };

interface FsmcIncidentNotificationReceiptV1 {
  kind: "user-notification-receipt";
  artifact: FsmcIncidentEvidenceArtifactRefV1<"user-notification-receipt">;
}

type FsmcIncidentAffectedScopeV1 =
  | {
      scopeRef: FsmcIncidentScopeRefV1;
      scopeDigest: string;
      dataDisposition: "pending-investigation";
      dispositionEvidence: null;
      dispositionEvidenceDigest: null;
      notificationReceipt: null;
      notificationReceiptDigest: null;
    }
  | {
      scopeRef: FsmcIncidentScopeRefV1;
      scopeDigest: string;
      dataDisposition: "preserved";
      dispositionEvidence: Extract<
        FsmcIncidentDispositionEvidenceV1,
        { kind: "preserved" }
      >;
      dispositionEvidenceDigest: string;
      notificationReceipt: null;
      notificationReceiptDigest: null;
    }
  | {
      scopeRef: FsmcIncidentScopeRefV1;
      scopeDigest: string;
      dataDisposition: "restored";
      dispositionEvidence: Extract<
        FsmcIncidentDispositionEvidenceV1,
        { kind: "restored" }
      >;
      dispositionEvidenceDigest: string;
      notificationReceipt: null;
      notificationReceiptDigest: null;
    }
  | {
      scopeRef: FsmcIncidentScopeRefV1;
      scopeDigest: string;
      dataDisposition: "preserved-with-workaround";
      dispositionEvidence: Extract<
        FsmcIncidentDispositionEvidenceV1,
        { kind: "preserved-with-workaround" }
      >;
      dispositionEvidenceDigest: string;
      notificationReceipt: null;
      notificationReceiptDigest: null;
    }
  | {
      scopeRef: FsmcIncidentScopeRefV1;
      scopeDigest: string;
      dataDisposition: "unrecoverable-user-notified";
      dispositionEvidence: Extract<
        FsmcIncidentDispositionEvidenceV1,
        { kind: "unrecoverable-user-notified" }
      >;
      dispositionEvidenceDigest: string;
      notificationReceipt: FsmcIncidentNotificationReceiptV1;
      notificationReceiptDigest: string;
    };

type FsmcIncidentResolvedScopeV1 =
  | {
      scopeRef: FsmcIncidentScopeRefV1;
      scopeDigest: string;
      dataDisposition: "preserved";
      dispositionEvidence: Extract<
        FsmcIncidentDispositionEvidenceV1,
        { kind: "preserved" }
      >;
      dispositionEvidenceDigest: string;
      notificationReceipt: null;
      notificationReceiptDigest: null;
    }
  | {
      scopeRef: FsmcIncidentScopeRefV1;
      scopeDigest: string;
      dataDisposition: "restored";
      dispositionEvidence: Extract<
        FsmcIncidentDispositionEvidenceV1,
        { kind: "restored" }
      >;
      dispositionEvidenceDigest: string;
      notificationReceipt: null;
      notificationReceiptDigest: null;
    }
  | {
      scopeRef: FsmcIncidentScopeRefV1;
      scopeDigest: string;
      dataDisposition: "preserved-with-workaround";
      dispositionEvidence: Extract<
        FsmcIncidentDispositionEvidenceV1,
        { kind: "preserved-with-workaround" }
      >;
      dispositionEvidenceDigest: string;
      notificationReceipt: null;
      notificationReceiptDigest: null;
    }
  | {
      scopeRef: FsmcIncidentScopeRefV1;
      scopeDigest: string;
      dataDisposition: "unrecoverable-user-notified";
      dispositionEvidence: Extract<
        FsmcIncidentDispositionEvidenceV1,
        { kind: "unrecoverable-user-notified" }
      >;
      dispositionEvidenceDigest: string;
      notificationReceipt: FsmcIncidentNotificationReceiptV1;
      notificationReceiptDigest: string;
    };

interface FsmcIncidentRecordBaseV1 {
  schemaVersion: 1;
  incidentId: string;
  findingIds: readonly [string, ...string[]];
  affectedArtifact: {
    sourceSha: string;
    productionArtifactTreeSha256: string;
    productionBuildManifestSha256: string;
    ciRun: { runId: string; runAttempt: number };
  };
  detectedCiRun: { runId: string; runAttempt: number };
  affectedVersions: readonly [string, ...string[]];
  stoppedAt: string;
  ownerRole: "Release Maintainer";
  ownerLogin: string;
}

type FsmcIncidentRecordV1 =
  | (FsmcIncidentRecordBaseV1 & {
      status: "stopped";
      affectedScopes: readonly [
        FsmcIncidentAffectedScopeV1,
        ...FsmcIncidentAffectedScopeV1[],
      ];
      rootCauseReview: {
        status: "open";
        evidenceArtifact: null;
        evidenceDigest: null;
      };
      closedFindingEvidence: readonly [];
      closureTestIds: readonly [];
      resumeCandidate: null;
      resumeApprovedBy: null;
    })
  | (FsmcIncidentRecordBaseV1 & {
      status: "resumed";
      affectedScopes: readonly [
        FsmcIncidentResolvedScopeV1,
        ...FsmcIncidentResolvedScopeV1[],
      ];
      rootCauseReview: {
        status: "completed";
        evidenceArtifact: FsmcIncidentEvidenceArtifactRefV1<"root-cause-review">;
        evidenceDigest: string;
      };
      closedFindingEvidence: readonly [
        {
          findingId: string;
          evidenceArtifact: FsmcIncidentEvidenceArtifactRefV1<"finding-closure">;
          evidenceDigest: string;
        },
        ...{
          findingId: string;
          evidenceArtifact: FsmcIncidentEvidenceArtifactRefV1<"finding-closure">;
          evidenceDigest: string;
        }[],
      ];
      closureTestIds: readonly [string, ...string[]];
      resumeCandidate: {
        sourceSha: string;
        productionArtifactTreeSha256: string;
        productionBuildManifestSha256: string;
        ciRun: { runId: string; runAttempt: number };
        requiredGateResultSha256: string;
      };
      resumeApprovedBy: {
        role: "Release Maintainer";
        login: string;
        approvedAt: string;
      };
    });
```

全ID／version／scopeはcanonical順・重複なしとし、resumed branchでは`closedFindingEvidence.findingId`が`findingIds`とexact bijection、全`closureTestIds`が`resumeCandidate.ciRun`でretry 0成功、required gate resultが同candidateのsource／tree／manifest／runへ再計算一致しなければならない。scopeは個人名、event名、連絡先、自由文を含まない`FsmcIncidentScopeRefV1`を唯一のdescriptorとし、`scopeDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-incident-scope-v1", scopeRef })))`へ固定する。各`scopeRef.affectedArtifactBinding`はrecordの`affectedArtifact`とbyte一致、`registryReferenceId`はkind内でopaque nonempty ID、全scopeは`(scopeKind, registryReferenceId)`順・重複なしとする。evidence artifact refはopaque `referenceId`、固定kind、scope-specific kindでは当該rowとbyte一致する`scopeDigest`、incident-wide root cause／finding kindではnull、非負safe-integer byteLength、lowercase 64桁SHA-256だけを持ち、access-controlled evidence registryの同じmetadataと実bytesをverifierが再hashする。root cause reviewは`rootCauseReview.evidenceDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-incident-root-cause-review-evidence-v1", incidentId, evidenceArtifact: rootCauseReview.evidenceArtifact })))`、finding closureは各行について`evidenceDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-incident-finding-closure-evidence-v1", incidentId, findingId, evidenceArtifact })))`とし、typed artifact refとdigestを必ず対で保持する。`dispositionEvidence.kind`は`dataDisposition`とbyte一致し、`dispositionEvidenceDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-incident-scope-disposition-evidence-v1", incidentId, scopeDigest, dataDisposition, dispositionEvidence })))`として保持／復元／workaround／復旧不能の確認artifactをscopeごとに拘束する。`pending-investigation`だけはevidence／両digest／receiptを全てnullとする。`unrecoverable-user-notified`はさらに`notificationReceiptDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-incident-user-notification-receipt-v1", incidentId, scopeDigest, notificationReceipt })))`を必須にし、assessment evidenceと通知receiptを相互代用しない。他の3 resolved dispositionはnotification receipt／digestをnullとする。stopped branchでclosure、candidate、approvalを先取りせず、resumed branchへ`pending-investigation`、null evidence、未確認の復旧成功を残さない。schema verifierはscope ref／digest、root cause／finding／disposition／notificationの各artifactについてregistry metadataと実bytesを再hashし、scope ref／digest入替え、artifact scope差、artifact kind、reference ID、byteLength、artifact SHA、各digestの単独差、finding間artifact／digest入替え、receipt入替えを拒否する。

### 13.2 再開条件

- 全`findingIds`をclosedにし、root cause reviewを完了し、事故を再現するfixtureとretryなしの`closureTestIds`を追加する
- 修正sourceで必須CI、旧新版同居、failure injection、性能、backup復元を再成功させ、`resumeCandidate`の`sourceSha`、`productionArtifactTreeSha256`、`productionBuildManifestSha256`、`ciRun`とbyte一致するcurrent-run `fsmc-required-gate` result／SHA-256へ拘束する。障害対象の`affectedArtifact`と修正版candidateが同じhashであることは要求しない
- 各影響scopeの`dataDisposition`を確定し、復旧不能時は`unrecoverable-user-notified`を選んで通知事実を記録する。曖昧な「復旧または処置」で再開しない
- 端末全体OFF、event OFF、制御変更mid-save、Backup新規／既存復元の自動回帰testが成功する
- 修正版も既存イベントOFFを既定として配布し、停止前のローカルON状態を自動復元しない
- 上記全条件をRelease Maintainerが再検証し、`resumeApprovedBy`を本人以外の証跡から推測せず明示記録してから配布を再開する

## 14. Definition of Done

次をすべて満たした時点で完全分割初版を完了とする。

- **DOD-FSMC-001** — `PD-01`～`PD-18`が`config/fsmc-traceability.json`で要件ID、owner phase、fixture、実装、自動test、利用者向け文書または非対象理由へ追跡可能で、全対象が`implementation-enforced`となり、初版の4方向、解除、同一地図内copy、再取込・通常編集が実装済み。さらに、イベント全体複製の全ID remap／source不変／destination OFF、番号セル・merge editorのpreview／validation／原子性、全RC／DoD／Exitの安定ID追跡がinitial-releaseで完了する
- **DOD-FSMC-002** — `C(S) = ∅`の場合だけ`01a`／`1a`／`０１ａ`が同じ売場へ解決され、衝突時はevent ONを拒否してlegacy identityを維持する。ON中の編集、import、restore、map変更で`C(after) \ C(before)`が非空となる操作は同数pair swapを含め全store書込み前に全拒否し、既存data、settings、control ON、表示原文を失わない。`fsmc.repair.item-numbers.v1`、`fsmc.repair.map-identity.v1`、`fsmc.repair.orphan-visit-state.v1`だけが既存pair集合を厳密減少でき、完全解消後だけ対象eventをeffective ONへ戻す。`26c`／`26c2`、`26d`、`26ab`は非対応番号同士で誤衝突せず、「側未設定」badge、DOM一覧、previewで識別表示される
- **DOD-FSMC-003** — exact番号grammarと巨大`BigInt`化前のsafe integer境界を満たし、mapped／mapless／legacy-unresolved `SpaceIdentity`を共有訪問projectionが保持する。legacy identityに原文／reasonを混入させず、mapless／unresolvedへ架空のmap／block／cell、marker、route anchorを与えない
- **DOD-FSMC-004** — 機能OFF時はsplit固有部分が固定した旧版Aと同じ番号identity、未分割表示、whole-cell位置解決、core保存結果になり、ON/OFFで商品番号原文やsplit設定を破壊変更しない。optional `EventMetadata.splitIdentityAnchor`だけを正規化除外したlegacy-core checksumと、それ以外の全core field・raw item原文が一致する。訪問・経路・位置指定の`PD-14`修正、重複物理cellを新規作成するimport／通常編集after-imageの原子的拒否、既存重複の`map-data-untrusted`判定／map単位route停止だけは常時適用する。重複を作らない入力では旧版Aと同じcore保存結果を維持する
- **DOD-FSMC-005** — item resolver、空側hit-test、DOM列挙が、対象eventの全item／associationを同じread boundaryで集めた`LogicalLocationSourceSnapshotV1`と同じ`MapLocationIndex`、viewport adapter、geometryを使用する。item set／snapshot／map／split revision差で可変なwhole／a／b／unsupported location集合を再構築し、partial item callerや独自suffix配列を許さない
- **DOD-FSMC-006** — `duplicate-number-region`、`multiple-block-owners`、`overlapping-number-regions`、`merge-crosses-block`を配列順で推測せず影響regionだけの局所exclusionとして安全に除外・隔離し、同じcomponentの複合原因は全件を固定enum順の`reasons`へ保持して、同じmapの影響外location／訪問／描画／routeを継続する。原因順shuffle、欠落、重複、順序差を拒否する。重複物理`(row, col)`だけをmap-wide fatalとし、新規作成するimport／通常編集は機能状態を問わず全store書込み前に拒否する。起動時から存在する重複は当該mapを`map-data-untrusted`としてsplit表示だけをlegacy whole-cellへ戻し、経路生成・cache再利用をmap単位で安全停止する
- **DOD-FSMC-007** — manual map／block editでmapData、association、binding evidence、entry statusが同じ原子的commitで更新され、commit成功後だけmemory-only route cacheを破棄し、無関係なentryを失効させない。`VisitIdentityInputSnapshot`は`manualHallId`、stable hall定義・所属・remap、map association、mapped↔maplessを単一revisionで読み、manual hall X→Y／未指定、hall削除／remap、dangling／ambiguous、表示名だけの変更を決定済み規則どおりrekeyする。番号セル変更、merge／unmergeは専用editorとpure previewを通り、duplicate cell、normalized collision、ownership／merge overlap、bounds／block越境、lossy mergeをfirst write前に拒否し、keyboardだけで取消まで完了できる
- **DOD-FSMC-008** — 地図再取込はcore map planとsplit reimport planを同一pre-command snapshotから合成し、双方のdigest、map／association revision、`ExpectedRootVector`を単一preview authorityにする。core／splitの片側だけがstale、取消、quota、commit前終了ではwrite 0件となる。I7以降のQA internal writerとI11 release-ready productionのdurable `ready`後writerだけが、成功時にmapData、association、binding／status、durable現在位置・保存位置・phase stateを同一commitで更新する。I2～I10 productionはDB5／capability write 0を維持し、route cacheは各許可artifactのcommit後だけ破棄する。reimportはsame-instance、raw block名＋番号、normalized token＋番号のtier順でexact 1件だけを採用し、複数候補をrow／colや配列順でtie-breakしない
- **DOD-FSMC-009** — コピーの既定「追加・変更のみ」は既存分割を解除せず、別操作の「完全同期（解除を含む）」だけが解除する。両方でmode、追加・変更・解除・維持・変更なし・除外のpreview、取消、stale時全abortが機能し、コピー先IDとdormant／quarantined履歴を維持する。同owner＋番号のretainedがあればcopyから除外して明示再関連付けへ送り、active／retained overlapを作らない
- **DOD-FSMC-010** — `layoutMode`とスマートフォン操作判定が分離され、Mobile Chromium profileでは全分割セルが空間順picker、狭幅Desktopと`desktop-touch-context`を含む`isMobile=false`ではmouse／touch別閾値に従い、閾値未満・曖昧時はno-op案内となる。persisted `forceSplitPicker`はfactory default false、設定画面／通常／集中モードの共通authorityであり、ONならDesktopでもpicker、reload／offline後も維持、untrusted rootでは安全fallback、Backupには収録しない
- **DOD-FSMC-011** — 通常マップと集中モードが同じtotal Pointer gesture state machineを使用し、primary／non-primary、capture成功／失敗、duplicate ID、ID再利用、additional pointer drain、pan、pinch、cancel、capture喪失、layout切替、synthetic clickをdisjoint rowで処理する。global cancel／unmount後はstate、active registry、capture、timer、pending effect、guardが全てemptyとなり、重複row、unreachable row、暗黙default、誤tapがない
- **DOD-FSMC-012** — a/bの着色、ポップアップ、状態変更が独立し、集中モードの「購入済」と「後回し／遅参」の既存反映規則を維持する
- **DOD-FSMC-013** — raw実行商品ID配列を並べ替えず、非連続同一`ExecutionVisitIdentity`をglobal集約し、normalと後回し／遅参の`PhaseVisitIdentity`投影を通常マップ、集中モード、`MapVisitListPanel` shell＋pure `ProjectedVisitList`、space-navigation、route／hit-testで同じ`PhaseVisitProjectionSnapshot`から共有する。進行区分・優先度はexact union、1 itemの追加phaseは高々1個とし、既存identityへの位置指定追加はanchorを無視して統合通知し、訪問位置を動かさない。base順は重複なしdurable `executionVisitOrder`だけをauthorityとし、manual reorderはdraft／cancelでwrite 0、保存時だけ`fsmc.visits.reorder-execution-order.v1`、hall reorderは`fsmc.visits.reorder-by-hall.v1`でhall route settingsとall-old／all-newにする。両commandはraw execution rootをCAS read witnessにするがwrite participantにせず、raw item ID列とmember相対順をbyte保持する。global順はnormal→postponed→lateとし、`durable-visit-state` rootでcurrentはphase付きitem anchor、saved位置は3 phase別anchor、購入変更位置もphase付きitem anchor、空phaseと`isCompleted`をreload／retry／Backup往復後も保持する
- **DOD-FSMC-014** — 商品編集でexecution identityが既存destinationへ変わる場合はdestination訪問位置を維持し、変更itemだけをmember末尾へ移して現在・保存位置を新しい`PhaseVisitIdentityKey`へ再解決し、全画面へ同じ結果を反映する。新destinationのsource残存／消滅、複数同anchor、既存destination、利用者insertの全rekey規則でdense ordered key arrayと変更外相対順を維持する
- **DOD-FSMC-015** — route、hit-test、挿入anchorとDOM panel callbackが`PhaseVisitIdentityKey`を使用し、member商品ID列はpayloadに限定される。先頭member削除後も残存memberがあれば同じvisit ID、座標、順序、route cacheへ再解決され、priority、phase、member件数をDOMで確認できる
- **DOD-FSMC-016** — main pathと種別付きconnectorが分離され、connectorは自セル・結合セル領域内で安全な場合だけ表示・hit-testできる。領域外または障害物横断が必要な場合は`unsafe-connector`で`unroutable`とし、同一セルa→bにも同じ規則を使う。selected hallではrouting port／anchor、raw／simplified main path、全connector、same-cell directの全点・全線分を同じinclusive polygon predicateで検証し、invalid／stale constraintをwhole-mapへfallbackしない。canonical polygonと`RoutePolygonFingerprint`をbyte一致で再検証し、開始点／向き差だけを同値、頂点／hall／revision差を別値にする。route signatureはindex revision、`pathfindingGraphFingerprint`、non-null `RoutePathConstraintFingerprint`を含み、whole-map／別hall／polygon revision、value／背景色／map寸法／結合領域／algorithm・cost変更で古いcacheを破棄する。connectorの自owner領域mask exemptionをmain pathへ伝播させず、同anchor別visitはcost 0の`coincident-anchor`としてroute順を維持し、線hit targetを作らない
- **DOD-FSMC-017** — 同位置複数訪問が中立marker、訪問数badge、現在ringで表示され、番号・a/b・badge文字が全回転角で正立する。`LocationPresentationState` reducerは入力shuffleでbyte同値、mixed statusを代表色へ潰さず、selected／hover／temporary／currentを独立fieldとしてCanvas・DOM・forced-colorsで共有する
- **DOD-FSMC-018** — Canvasを使わずDOM訪問一覧から詳細、追加、状態変更、一時移動、経路挿入を完了できる。`config/fsmc-a11y-oracles.json`どおりのrole／name／description／state、DOM／Chromium AX順、keyboard focus order／return、常設live regionのpoliteness／atomicity／exact 1 mutationをDesktop／Mobileで自動検証し、axeも独立して成功する
- **DOD-FSMC-019** — I2ではproduction artifactが`databaseTargetMode = core-current`／現行core DB version／FSMC公開command 0件を維持し、non-promotable QA artifactの`databaseTargetMode = fsmc-vcap-qa`だけがabsence／現行version→採択済み`Vcap`を試験する。I11 release-readyで初めてproduction artifactを`databaseTargetMode = fsmc-vcap-production`へ変え、同じmigration oracleを再実行する。FSMC DB open前に、DB absent＋external core 10 keyのいずれかpresentはbyte-exact core-current materialization→core archive／close、core全absent＋preserved queue presentはqueue-only archive／close、DB absent＋core全absent＋queue absentだけはtrue fresh、というstrict tri-stateを検証する。target-mode別null決定表、existing probe settle／close、exact 1 upgrade request、`onblocked`非terminal／same-request再開、`oldVersion = 0`、error／abort exact-one terminal、no-upgrade probe handoff／upgrade-success same-request handoff／reopen 0、`dbVersion`とexact一致するsplit対象rootへ閉じた`Vcap` witness、event名基準day preflight、collision時ID allocator／proposal／versionchange／capability write 0件、collision-free後のproposal／anchor action／resolved authority、採用直前のsplit導入trace再検証、全非fence root payload／metadata／checkpoint／全potential IDB candidate selectorの`H0/H1` byte-exact CAS、変更しないlegacy rowを`H1`・anchor変更とnew capability rowをfactory after-image・fenceをbaseline-onlyとする合成post-stateのtotal historical evidence／participant digest／全governed root baseline付きinitial fence、commit前／後crash oracle、`Vcap - 1`／`Vcap`／supported上限の空storeを含むpartial-loss安全分岐、supported上限＋1拒否、現行5／6／7／8 provenance fixture、固定manifestの旧版A→候補新版B→固定旧版A→候補新版Bの自動互換試験が成功し、端末情報を外部収集しない。healthy legacy-only差は原子的rebase、bootstrap anchor invalid／duplicateはadoption-blocked、persisted anchor missing／invalid／mismatch／duplicateはevent-local quarantine、capability-owned差／fence自己不整合／説明不能差は安全モードとなる。採択versionは`coreDbVersion < Vcap <= supportedMaximumDbVersion`かつauthoritative release／artifact provenanceから`adopt-vcap`へ再計算され、unknown conflict 0件を要求する。bootstrapはresolved authorityとscopeだけからevent association、必要なanchor、5 payload root＋fenceを作り、materialize／queue-only archive後を含むpresent既存profileはscope 0件／unmapped-onlyでも両basis digest付き`migrating`＋empty entries、strict true fresh zero-scopeだけは同digest付き`ready`＋empty entriesにするdurable root、canonical event settings／pending bridgeを含むactual participant集合と一致する
- **DOD-FSMC-020** — supported rangeでは`dbVersion >= Vcap` iff exact 1件の値一致`db-version` witness、`dbVersion === null || dbVersion < Vcap` iff 0件となり、presence `absent` iff null、`present` iff numberを必須にする。core-only terminalは`core-current`だけ、Vcap targetのnull resolvedは0→`Vcap`、null traceありはrecovery-requiredである。`dbVersion > supportedMaximumVersion`はsnapshot外`unsupported-database-version`としてauthority非採用・write 0件で拒否される。現行のsupported上限7／DB8拒否は同じparameterized境界から導出する
- **DOD-FSMC-021** — target mode／presenceを持つ`core-only`、`map-cell-split-recovery-required`、`map-cell-split-v1` snapshotと、pre-`Vcap`の`capability-adoption-blocked`、`event-authority-adoption-blocked`、`event-authority-proposal-failed`を判別可能unionで区別する。legacy external core付きabsenceはFSMC open前にcore-currentへmaterializeし、core absent＋queue presentはqueue-only archiveし、DB／10 core／queueが全absentのtrue freshだけをabsence decisionへ入れる。snapshot terminalはno-upgrade／upgrade-success、request 0／1、not-opened／probe handoff／same-request handoff／closedの合法組合せだけを型で許す。raw-day blockedはcanonical witness、旧DB byte不変、ID／upgrade 0件、trusted V1退避と専用repairを持つ。repairは全semantic mappingのtotal／injective／closed性、day-scoped sourceのalias group間exact partition、全present physical source↔assignment、day＋event-wide hallのglobal target injectivityとfull occupant identity、source-specific／event-wide choice、map request↔choice＋6面、nonempty execution partition、Focus CAS、requested target→choice request→loss rows→plan→confirmation→lease→full-plan receiptのdigest chain、E0／E1／E2とqueue integrityを必須にする。可変4 count `distinctNormalizedDayScopeCount`／`executionBucketCount`／`hallDefinitionSlotCount`／`hallRouteSlotCount`だけを決定式から再計算し、hall entry／list／item-reference count、execution reference、その他count／payloadを維持する。partial／many-to-one／domain外target、cross-group duplicate、target capacity、choice／plan／loss／lease／receipt不整合、shared-day unpartitionable、map 1～5面、physical drop・copy、Focus ABAを全拒否する。invalid／duplicate anchor blockedは全participant witnessとread-only trusted V1→coverage-verified clean reset→fresh-anchor restore runbook、proposal failedはallocation kind／typed reasonとretryを持ち、いずれもrequest／write 0件とする。recovery-requiredではcoreだけを継続してuntrusted capability rootを採用・再初期化しない。全open結果・reason・witness・eligibility・backup・connection状態→runbookをtotalかつ一意にし、unsupported DB、eligible atomic split reset、不適格write 0、別tab blocked、delete前／後再開、Backup hash、clean restore、別origin非削除を自動試験する。正常時はmetadata anchor、registry ID、resolved／rejected logical authority partition、active／retained entry、event bases付きdurable state、post-derivedで非永続のrejected partition witness、binding evidenceを保持し、全metadata writerがinventoryへ適合する。guided resetは実profileの全store／local key coverageがverified-completeの場合だけ許可する
- **DOD-FSMC-022** — `(storeName, key)`別のfull `ObservedRevisionRoot`、構造化checkpoint、identity＋物理location＋物理内容witness＋absorption projectionを返すpure collectorの全出力、settings／control／durable visit root、root policy、全非fence rootのtotal historical evidenceとその全行digest、participant digest、全`FSMC_GOVERNED_ROOTS_V1`のexternal baselineを持つfenceを含む`ExpectedRootVector`により、`syncQueue`のjournal／archiveとsnapshot時emptyの全potential storeを含むIDB candidateのstaleは同一transactionを全abortする。external raw DOMStringはlone surrogateも区別するlossless UTF-16 code unit witnessで拘束し、transaction内でWebCrypto／別async taskを待たない。candidate content-only／projection-only差は固定旧版Aのexact transition manifest外ならrecovery-requiredとし、legacy rebaseのparticipant tupleと置換historical rowは`sort(unique(changed legacy roots ∪ actualCapabilityWrites))`にexact一致させる。通常core-only rebaseの`actualCapabilityWrites` baseは`{data, control}`とし、event名、event instance ID、`DurableVisitEventBasisV1`のbasis core／authority digest、`basisCoreDigest`／`basisEventAuthorityDigest`、durable entries、persisted retired rowのいずれかの宣言済みafter-imageが変わるanchor保持rename／delete等では`durable-visit-state`を必ず加え、shadow reconcile併用時だけ専用ack rootを加える。external差はhealthyなlegacy-mutable coreだけならcommit前はwrite 0件のrebase、commit後は全new IDB rootを維持したrebaseとし、capability-ownedまたは分類不能な差はcommit前recovery拒否、commit後`committed-recovery-required`として即時または再起動時に検出する。legacy rebaseも同一transactionで全旧fenceまたは全新fenceだけとなり、別scope commandでも非参加historical row／baselineを失わず、last-write-wins、部分IDB commit、黙示mergeがない。quota・abort・crash・OFF mid-save時も各commandのIDBは全旧または全新だけとなる。`ProjectionDigestDescriptorV1`は実装digestの3 fieldだけ、checkpointは構造全体digestとする。durable visit、event-settings／bridgeを含む`logicalRootMutationTuples`、participant roots、置換historical row、digest対象集合をexact一致させ、fence payload／metadata／checkpointは別のadministrative write manifestへ一致させる
- **DOD-FSMC-023** — event削除画面は30日保持が既定、即時完全削除が別選択となる。D+29、trusted D+30、31日offline、36日offline、rollback、session jump、24時間再確認が固定clock契約どおりで、`event-deleted`対象以外を削除しない。設定単独出力は初版にない
- **DOD-FSMC-024** — dormant／quarantinedは地図に表示せず管理UIで理由を表示し、preview付き端末内再関連付けと明示削除が可能で、名前だけで別eventへ再接続しない。retained再関連付けは候補exact 1件、target未占有、trusted mapの場合だけ一段commitし、0／2件以上／staleでは非選択履歴を変更せずwrite 0件となる
- **DOD-FSMC-025** — Backup wire層は`AppBackupV2FullEventCoreWireV1`、`PortableDurableVisitStateWireV1`、scope別の明示section型だけを公開し、`Pick<AppData, ...>`、runtime domain型、persistence型をimportしない。V1層別互換matrix、event単位V2のcore／split／durable分離、eventLists／metadata exact 1＋残る8 sectionのabsent／present-empty、全scope共通のevent／item／map／block／hall／historical-owner reference exact bijection、実payload由来の全7 `counts`、map-level fingerprint、active／retained union、durable day／group／phase anchor、digestを固定する。hall ownerはmap／mapless XOR、item-only source-map descriptorを区別し、hall source order、normal／priority／highest／unassigned／missing／malformed visit group、manual／visit／orderの3-face dangling remap、raw `blockNames`のoptional absent／present-empty／順序／重複をlosslessに扱う。owner別hall group codecは全reachable pairでleft-inverse／token injectiveを必須にし、reserved 3形、suffix付き実ID単独、`A`と`A:priority`／`A:highest`のaliasをtyped blockerにする。item-only resolved hallはsource V2 digest／artifact SHAへ拘束した全hallRef↔distinct destination Hall IDのglobal total injective matchingだけを許し、0件／新規event／stale／候補外／choice replayをwrite 0件にする。historical ownerはcurrent refと別namespaceでrelationだけを持ち、historical block parentのcurrent-map／historical-map unionでcurrent map＋deleted blockを表現し、entry-local `lastKnown*`のabsent／present／異値を代表値へ集約しない。V2とcompanion V1の両representability／resource limitを満たす場合は`preparationKind = "pair"`のrole別immutable artifactとpair digestを生成する。V2がrepresentableかつ上限内でcompanionだけがunrepresentableなら構造reason＋resource以外のcanonical issuesと`preparationKind = "structural-v2-only"`、resource limitならresource reason＋exact 1 issueと`preparationKind = "resource-v2-only"`とし、scope→export→prepared→verification→handoffでreason／issues／digestをexact一致させて新版へ復元できる。pair片側失敗は`pair-incomplete`、V2-only本体失敗は同reasonの`structural-v2-only-incomplete | resource-v2-only-incomplete`だけを返す。V2 core blocker時のlosslessなlegacy-core-only退避だけをwarning acknowledgement必須の`standalone-v1` prepared／verified／completed・incompleteへ閉じ、split／durable復元可能と表記しない。V2生成のfixed-point／digest置換／実byte／timeout／spool／cancel／sink error失敗はsource binding、full state／typed sink receiptを持つreason別witness付き`v2-export-failed`／artifact 0件とし、prepared artifactはrole別exact self-validation tupleとimmutable byte witness、handoffはhandedOff IDとexact bijectionのtyped receipt tupleを持ち、相互のartifact数／digest／guidanceを表現不能にする。初版production writerはhealthy `map-cell-split-v1`かつdurable readyからfull-split、明示item-only commandからitem-onlyだけを生成し、core-mapはreader-onlyでserialize／registry／dispatch 0件とする。full／coreのportable dayはcore-derived scope、groupは再構築identityとpairwise unique exact bijection、item-onlyはsettings／durable nullとする
- **DOD-FSMC-026** — V1、legacy XLSX 2.2 full、地図を含むがsplitを含まないV2では既存split設定をpreview後にdormant化し、V1／XLSX 2.2 item-only importではmap／splitを維持する。event V2はportable execution order、phase別current／saved／purchase anchor、completionを原子的にround-tripし、全形式でcancel／stale／validation失敗はwrite 0件となる。full／core restoreはcanonical event settingsとdurable visit stateを復元先eventへ同一IDB commitで適用し、legacy fullは既存durable stateを一意移送、新規eventだけ決定的default、item-onlyはdestination settings checksumとdurable stateを維持・rekeyする。plain create、anchor保持rename、whole-event duplicate、V2 full／core restore、V1／XLSX新規／既存full、legacy／V2 item-only、固定旧版A delete retired化、新版delete除去、empty-split resetをformat／operation writer matrixで網羅し、event名／ID、basis 4 field、`basisCoreDigest`／`basisEventAuthorityDigest`、entries、retired rowの宣言済みafter-imageが変わる全場合にdurable rootをlogical participantへ加える。各commit後にbasis／aggregateを再計算し、bridge完了前は成功通知しない
- **DOD-FSMC-027** — importはsame-origin bundled module Workerが1 MiB以下のbounded sliceで処理し、main threadのwhole-file `arrayBuffer()`／`text()`、blob／data Workerを禁止する。PWA precacheと`worker-src 'self'`のoffline起動、cancel／timeout／worker crash cleanupを検証する。performance保証32 MiB／file、V1／V2 JSON import hard 64 MiB／file、XLSX 2.2 compressed hard 32 MiB＋既存展開limit、exportは1 MiB以下chunkのincremental canonical UTF-8 sinkを使い、V2実byteLength 32 MiB、V1 32 MiB、pair 48 MiB、temporary spool 64 MiB、generation timeout 300,000 msを同じconfig SHAへ拘束する。V2超過／timeout／spool違反はreason別witness付きartifact 0、V2以内でV1またはpairだけを超える場合は`companion-v1-resource-limit`付きV2-only、全上限内ならpair、fatal UTF-8、duplicate property、非再帰depth／token、V2 digest、未知version／scope、不正ref、1 MiB超番号tokenをDB更新前に判定し、長大数字を境界比較前に巨大`BigInt`化しない。V2のlocal control fieldも未知keyとして拒否する。V1で現行readerが受理する同名未知fieldは互換matrixどおり保持できるがcontrol authorityへ採用しない。V2／新規編集のunsafe URLは拒否し、V1／XLSX 2.2／既存profileのlegacy unsafe URLはraw保持しても非clickable、href sinkは`SafeExternalHref`だけを受理する。bounded errorとcancel cleanupを守り、`__proto__`等の利用者名を安全に自己round-tripする
  DOD-FSMC-027のexport境界ではV2自体／event hard limitだけを停止条件とし、companion／pairだけの超過はresource reason＋exact 1 issueの`resource-v2-only`へ進める。構造issueとの混在、pair artifactの片側をV2-onlyとして再分類すること、`pair-incomplete`、`structural-v2-only-incomplete | resource-v2-only-incomplete`、warning必須の`standalone-v1-incomplete`のartifact数／digest／guidance交換、および`v2-export-failed`のreason／bounded witness／config SHA差替えを型・schema・Worker testで拒否する。

- **DOD-FSMC-028** — 端末全体OFF、event OFF、自動安全モードでは`PD-04`で定義したsplit固有部分のlegacy動作となり、オフラインだけではOFFにならない。C2はI7以降、C3はI10以降のQAだけで先行conformanceし、I10以前production edgeは0件、I11 release-ready productionではdurable ready後に初めて両方をON／OFF共通不変条件として登録する。重複物理cellの新規after-image拒否と`map-data-untrusted`安全判定は各該当commandの導入時から常時適用する。authority正常なlegacy rebaseはdevice／event／readinessに依存せず完了し、recovery-required安全モードでは禁止する。device OFF中の編集後に再ONした場合は衝突eventだけをstored enabledのeffective fallback、他eventをONとし、修正完了したeventだけ復帰する。BackupはローカルON／OFFを含めず、新規復元OFF・既存復元先状態維持となる
- **DOD-FSMC-029** — 端末間同期・自動mergeを行わず、1イベント1主端末とpreview付き全置換、復元前退避案内が利用者向け文書と自動テストで固定される
- **DOD-FSMC-030** — source固定readinessがI0～I1 `contracts-only`、I2～I10とI11作業中`internal-testing`であり、I11最終candidate PRだけはbuild前に`release-ready`へ変更される。同一production artifactの全Exit／release gate成功後だけ配布でき、verifierはreadinessを書き換えない。production bundleにQA override、query、storage、remote迂回がなく、release-ready前のproductionでは有効化UI／commandへ到達できず、production／QA build manifestの`databaseTargetMode`、`buildPurpose`、readinessと実際のDB target／registryをverifierが一致させる
- **DOD-FSMC-031** — 必須Desktop／Mobile Chromium CIがworkers 1、retry 0、`failOnFlakyTests`で成功し、`desktop-touch-context`を含むsafety flakyが0件である。release-ready manifestでは全`releaseScope = initial-release` safetyが`implementation-enforced`であり、その集合内の`qa-chromium-only`が0件である。`releaseScope = future`は選択・実行・成功扱いにせず、初版DoDの0件判定へ混ぜない。WebKitの通常表示／a11y結果自体をDoDにしないが、同一`ciRun`／source／production artifactへhash拘束したrelease-ready `requiredSafetyIds(state)`の全ID実行・全結果passed・failed ID／infra error 0件からcurrent-run safety observationが`passed`へ再計算され、open safety findingは0件、promotion resultはregister 0件と集合一致する`not-required`である。open finding中のpromotion `passed`は修正確認の中間状態に限り、findingをclosedへ更新して`not-required`となるまで最終DoDを満たさない。overall statusの自己申告だけを信頼しない
- **DOD-FSMC-032** — Desktop／Mobile Chromiumの自動browser、PWA、性能テストが成功する。`CellSplitDefinitionPanel`／retained管理の15,000行と`ProjectedVisitList`の最大800行のDOM導線、role／name／description／stateとDOM／AX tree順、常設`role=status`の`operationEventId`別exact 1 mutation、light／dark contrast、forced-colors、200% zoom、container focus＋`aria-activedescendant`のfocus復元を含み、特定screen reader、OS、端末を正式保証済みと表記しない。`MapVisitListPanel`はI8のshellとしてfilter／active／selected／stale／focus returnを所有し、injective row ID、filter 0件、opener消失、同文言別operation eventを正しく扱う
- **DOD-FSMC-033** — WebKitはadvisory自動test対象だが必須保証対象外であり、iPhone、ペン、OS／実機固有挙動は自動test対象外であることを利用者向け文書へ明記する
- **DOD-FSMC-034** — 15,000セル、最大8,192 block、15,000設定、30,000半領域、400商品、400売場、400 execution訪問、最大800 phase投影、単一phase経路400の条件を持つ`releaseScope = initial-release`の全performance scenarioが、検証済みrunner envelope上で専用`config/fsmc-performance-budgets.json`の製品上限を満たす。5秒操作中のinput-to-next-paint、全Chromium process PSS memory metric、memory解放条件も満たし、Mobile emulationを実機memory保証と表記しない。100×150のversion付きtopology manifestと同一OFF／ON topology hashを使い、全62 scenario-profile keyを最大54 shard、`max-parallel: 12`、5 wave、Actions job開始から各300分以下／job hard deadline 330分で実行する。1 attemptは1,500／1,650 matrix分、16,200／17,820 runner分とし、half-open `jobIntervals`、observed concurrency 12以上、queue除外qualification 360分以下、canonical 12-lane projected 5-wave 360分以下をschemaから再計算する。test／automatic workflow retry 0、開始前allowlisted infrastructureだけCI Operator承認付き`Re-run all jobs`を1回許可し、最大2 attemptのperformance shard matrix部分は3,300 matrix分／35,640 runner分とする。current approval resultとjob-start absolute deadline／preproduct／started／terminal ledger chainを含め、reducerがpartial rerun、欠落／重複／stale／別attempt混在、started時刻からのdeadline延長、製品開始後timeoutのinfra偽装を拒否する
- **DOD-FSMC-035** — PWA新旧世代、旧版／新版同時tab、probe close後blocked、blocked中旧tab write、same-request再開、terminal dedupe、absence `oldVersion = 0`、2種connection handoff、QuotaExceeded、部分root／store欠損、強制終了を試験する。明示reset以外はsplit stateを自動削除せず、durable write前後のretry／reload／別tab／Backup往復でorder、phase、current／saved／purchase anchor、completionを失わない。strict true freshだけをzero-scope ready、materialize／queue-only archive後を含むpresent既存profileをzero-scope／unmapped-onlyでもmigratingにする。persisted authorityはevent-local association missing／extra、anchor missing／invalid／mismatch／duplicateの6 reasonと複合、global 5 reasonと複合をcanonical化し、resolved eventを一括ready、rejected entryをbyte不変quarantine、unaffected eventをready継続、局所化不能差だけ全体repair-requiredにする。retired row↔basisはexact bijection、possibly-empty entry sliceはrowのcount／digestと一致させ、zero-entry retiredを許す。`rejectedEventPartitions`はpost-derived非永続witnessとする。freeze barrier、latest capture、setter停止、fresh issuance、旧writer unmount、zero-session renameだけのempty key pair、rename／delete one-shot lease、二重finalize／replay拒否、3 counter境界を検証する。raw-day collisionはrequest／DB／token／default 0件の`capability-adoption-blocked`とし、target-first inspection、total／injective／closed mapping、day-scoped sourceのgroup間partition、全present source↔assignment、day＋event-wide hallのglobal target injectivity／full occupant、source-specific／event-wide choice、map request＋6面、nonempty execution partition、Focus CAS、requested target→choice→loss rows→plan→confirmation→lease→full-plan receipt chainをcommit直前に再検査する。可変4 count `distinctNormalizedDayScopeCount`／`executionBucketCount`／`hallDefinitionSlotCount`／`hallRouteSlotCount`だけを再計算し、hall entry／list／item-reference、execution reference、その他count／payloadを維持する。cross-group duplicate、2 rename→1 target、capacity不足、zero-member、partial／many-to-one／domain外target、choice／plan／loss／lease／receipt不整合、shared-day、map 1～5面、physical drop・copy、Focus ABA、E1差をwrite 0件で拒否し、E2再出現は全new IDB維持のtyped blocked／recoveryへ写す。invalid／duplicate anchor blockedとallocator failureも専用terminal、request 0件、typed runbookへ一致させる。snapshot／field／mapping不正、unmapped recordはloss previewとexact default／破棄確認、token status／issuance／generation／record digest／absence CASを必須にし、取消／quota retryはfresh issuanceだけを受理する。ack前unmount、ABA、黙示default、ready前／rejected／retired eventのpublic edge、scope単位部分seedを0件にする。profile消去はclean-startと事前Backupを確認し、event-settings bridge、durable write、coverage deleteの各crash／raceも全旧または全新で再開・停止する
- **DOD-FSMC-036** — test membership、coverage、architecture、dependency usage、foundation quality、functional result、CI prerequisite result、required-resultsの各verifierがcurrent source、`productionArtifactTreeSha256`／`productionBuildManifestSha256`、必要時`qaArtifactTreeSha256`／`qaBuildManifestSha256`、run hashへ拘束され、0 test、allow-empty、未登録command、wire→runtime型、UI→persistence、raw URL→href、blob／data Worker、別run結果流用をnegative fixtureで拒否する。file-tree／manifestのpath／length／byte／manifest-only差、nested directory entry、symlink／junction／reparse／deviceを拒否し、別root／timezoneの同一treeを同値にする。pre-I0 9段baseline verifierと外部observer、FSMC-I0～I11の各required gateはwaiver／skipなしで成功する。固定Node／npm／lockfileのrequired CLI contractは`npx playwright install --with-deps chromium --dry-run`のbrowser／flag転送成功と旧`npm exec`2形式の失敗を再現する。既存`quality` jobだけがcurrent runでcanonical `npm run quality`をexact 1回実行してfoundation resultを作り、全FSMC build／testはdownload＋verifyし再実行しない。producer 0回／複数回、逆needs／cycleを拒否する。I0 Exit候補の同一HEADで`fsmc-required-gate`自体を一度だけdirect required化し、既存`quality`もrequiredのまま、未設定／誤contextを拒否する。requirement catalogは7.2のexact informative marker範囲だけを除外し、marker不正や将来メモのnormative登録を拒否する。catalog／traceability／test manifest、foundation result、production／必要時QA manifest、functional result、performance reduced result、CI prerequisite resultをfinalizerがcurrent runのhashで統合し、producerの失敗・起動前終了でもalways-run reporterがfail-closed resultを作る。pre-I0 quality graphとActions／GHCR／branch gate前提をwaiverなしで検証する
- **DOD-FSMC-037** — remote availability、署名receipt、外部metrics、実event pilot、managed-device収集、source-bound証跡bundleが実装・完了条件・標準commandに存在しない。source固定の`verify:fsmc:release-readiness`は公開安全gateとして必須とする
- **DOD-FSMC-038** — 完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図コピー、意図的再訪が後続版として初版のUI、command、test gateから分離される
- **DOD-FSMC-039** — Backupのraw structured-clone snapshotをDTO／JSON化前にown-propertyとarray index presenceで監査し、own／array `undefined`、sparse hole、`-0`をtyped representability blockerへ写す。absent optional、explicit `null`、`0`と区別し、黙示JSON変換後だけを検証したV2／pairを生成しない
- **DOD-FSMC-040** — raw representability blockerはlossless tagged witnessとdomain-separated digestを持ち、object／array undefined、hole、`-0`、null、0をpath／index／length込みで区別する。原値を通常JSONへ直接渡したdigestやtag／digest不一致を受理しない
- **DOD-FSMC-041** — event create／rename／duplicate／delete／restoreに加え、CSV update／source switch、既存event bulk add、item-only／V1 full import、XLSX 2.2の成功writerをdurable conformance matrixへ登録し、basis 4 field、`basisCoreDigest`／`basisEventAuthorityDigest`、entries、retired rowの宣言済みafter-imageが変わる全場合にdurable rootをparticipantへ加える。identity非変更のbyte同値put、identity変更時のdurable欠落、partial aggregate更新を拒否する
- **DOD-FSMC-042** — bootstrap authority revisionはH0 core subsetからdomain-separatedに再計算してsource／expected／fresh observed subsetとbyte一致させる。raw-day repairのevent-wide hall requestをsource row digest込みでplan／receiptへ保存し、Focus lifecycleはtyped acquisitionとdomain-separated transition／lease digestを使う。拒否時のDB、Focus session record、lease ledgerの各mutationを別oracleで数え、取得後abortを「全mutation 0件」へ偽装しない

## 15. 標準検証コマンド

リポジトリ指定のNode 24.19.0／npm 11.19.0を使用する。次のFSMC scriptはI0で`package.json`とCIへ追加し、manifestが選ぶtest 0件、`--passWithNoTests`、未実装testの仮成功を拒否する。

以下のphase別blockはjob内payloadの例であり、required workflowの唯一のauthorityは次のDAGとする。既存job ID `quality`だけがcanonical `npm run quality`をcurrent runでexact 1回実行する単一foundation-quality producerであり、常設`fsmc-ci-prerequisites`と固定`performance-rerun-preflight`を並行して開始する。全production／QA buildは`needs: quality`で同じfoundation resultをdownload／verifyし、`quality → production／QA build → functional／WebKit`と、`performance-rerun-preflight + production／QA build → performance-plan → shard matrix → reducer`を`required-results-finalizer → fsmc-required-gate`へ合流させる一方向DAGとする。`required-results-finalizer`だけがfoundation-quality、production／QA manifest、functional result、reduced performance result、CI prerequisite result、current performance rerun approval resultのexact 6入力classを`if: always()`で待って`fsmc-required-results.json`を生成する。preflight／shard／functional／prerequisite jobからrequired-resultsを直接生成しない。reporter、全artifact upload、reducer、finalizer、gateは上流失敗時も動く独立した`if: always()` stepとする。performance hard-timeout／deadline・result・snapshot artifact欠落は開始前後を問わずfailedへ再計算し、schema-validなpreproduct／terminal snapshotとallowlist証跡を持つ完了reporter resultだけをinfrastructure候補にする。その他producer欠落もschema固定の起動前infrastructure証跡なしに再実行可能へしない。既存`quality`へFSMC側の`needs`を逆接続せず、I2～I10とI11 internal-testingだけはnon-promotable QA artifactを機能／製品performanceへ使うが、production artifact、production guard、WebKit系、preflight、finalizerを省略しない。

常設CI prerequisite job:

```powershell
npm ci
npm run observe:fsmc:ci-prerequisites
# 以下3 stepはobserver結果にかかわらずworkflowのif: always()で実行
npm run finalize:fsmc:ci-prerequisites-result
npm run verify:fsmc:ci-prerequisites-result
npm run artifact:fsmc:upload:ci-prerequisites-result
```

既存`quality` jobは次のsole-producer blockを所有する。`verify:fsmc:foundation-quality-graph`は既存`npm run quality`の再帰展開graphを実行前に固定し、finalizerはgraph SHA、各command／script hash、選択test ID／件数、exit、source／toolchain／`ciRun`をresultへ記録する。0 test、allow-empty、前run result、graph差替え、個別失敗をoverall passedにしない。

```powershell
npm ci
npm run verify:fsmc:foundation-quality-graph
npm run quality
# 以下3 stepはquality結果にかかわらずworkflowのif: always()で実行
npm run finalize:fsmc:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run artifact:fsmc:upload:foundation-quality-result
```

performanceは`plan:fsmc:performance`、`verify:fsmc:performance-plan`、`verify:fsmc:performance-runner:shard`、`test:fsmc:performance:shard:*:prebuilt`、`reduce:fsmc:performance`、`verify:fsmc:performance-reduced-result`へ分離し、`finalize:fsmc:required-results`がfunctional／reduced結果を統合する。calibrationは各shardの製品sample直前に同じcontainer／browserで行い、別runから再利用しない。

FSMC-I0 production build job:

```powershell
npm ci
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run verify:fsmc:pre-i0-baseline
npm run verify:fsmc:i0
npm run build:release-a
npm run artifact:fsmc:upload:release
```

FSMC-I0 phase-test job:

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npx playwright install --with-deps chromium
npm run verify:fsmc:i0:prebuilt
npm run test:fsmc:i0:prebuilt
# 以下3 stepはtest結果にかかわらずworkflowのif: always()で実行
npm run finalize:fsmc:functional-result
npm run verify:fsmc:functional-result
npm run artifact:fsmc:upload:functional-result
```

I1以降は`releaseScope = initial-release`の全`contract-enforced` testを常時再実行し、同scopeで現在phase以下の`implementation-enforced` testを加える。`planned`は選択せず、initial-release entryだけは`enforcedFromPhase`到達後に`planned`が残れば失敗させる。`future` entryは初版gateの実行・planned残存判定から除外する。I1はproduction guardとpure domain testを実行する。

FSMC-I1 production build job:

```powershell
npm ci
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run verify:fsmc:phase
npm run build:release-a
npm run artifact:fsmc:upload:release
```

FSMC-I1 phase-test job:

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npx playwright install --with-deps chromium
npm run test:fsmc:production-guard:prebuilt
npm run test:fsmc:domain
# 以下3 stepはtest結果にかかわらずworkflowのif: always()で実行
npm run finalize:fsmc:functional-result
npm run verify:fsmc:functional-result
npm run artifact:fsmc:upload:functional-result
```

I2～I10と`currentPhase = I11 && readiness = internal-testing`は同じsourceからproduction artifactとnon-promotable QA artifactを別outputへ各1回buildする。production artifactではsource readiness、QA override不在、FSMC導線非公開、legacy smokeだけを検証し、QA artifactだけで当該phaseまでの機能testを実行する。両artifactは`buildPurpose`、source SHA、output pathをmanifestで区別し、上書き・取り違えを失敗させる。

FSMC-I2～I10およびI11作業中`internal-testing` build job:

```powershell
npm ci
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run verify:fsmc:phase
npm run build:release-a
npm run artifact:fsmc:upload:release
npm run build:fsmc:qa
npm run artifact:fsmc:upload:qa
```

FSMC-I2～I10およびI11作業中`internal-testing` phase-test job:

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run artifact:fsmc:download:qa
npm run verify:fsmc:artifact:qa
npx playwright install --with-deps chromium
npm run test:fsmc:production-guard:prebuilt
npm run test:fsmc:required:qa-prebuilt
# 以下3 stepはtest結果にかかわらずworkflowのif: always()で実行
npm run finalize:fsmc:functional-result
npm run verify:fsmc:functional-result
npm run artifact:fsmc:upload:functional-result
```

I11のrelease candidateは上記と同じDAGを`release-ready` modeで実行する。同一runのbuild jobでproduction artifactを1回だけ作ってuploadし、browser、a11y、PWA、performance、旧新版互換、WebKit observation／promotionへ再利用する。QA buildをrelease判定へ流用しない。

I11 production build job:

```powershell
npm ci
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run verify:fsmc:phase
npm run build:release-a
npm run artifact:fsmc:upload:release
```

Chromium／performance required jobはbuild jobを待つ。

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npx playwright install --with-deps chromium
npm run test:fsmc:required:prebuilt
# 以下3 stepはtest結果にかかわらずworkflowのif: always()で実行
npm run finalize:fsmc:functional-result
npm run verify:fsmc:functional-result
npm run artifact:fsmc:upload:functional-result
```

performance系は上のfunctional jobへ混ぜず、全phaseでrerun preflight→plan→shard→reducer→required-results finalizerの5段を使う。I0 planは同一run／attemptのexact 12 qualification shard、I1 planは期待shard 0件の`not-required`、I2以降は現在phaseまでのproduct keyを最大54 shardで生成する。matrix strategyは`max-parallel: 12`、workflow自動retry 0、各shard job `timeout-minutes: 330`をliteral固定する。

```powershell
# performance-rerun-preflight job（全attempt、if: always()）
npm ci
# attempt 1は全prior download／verifyがschema-valid not-required、attempt 2だけexact prior attempt名を取得
npm run artifact:fsmc:download:prior-attempt-performance-reduced-result
npm run artifact:fsmc:download:prior-attempt-required-results
npm run artifact:fsmc:download:prior-attempt-webkit-safety-observation
npm run artifact:fsmc:download:prior-attempt-webkit-promotion-result
npm run artifact:fsmc:download:prior-attempt-required-gate-result
npm run verify:fsmc:prior-attempt-performance-reduced-result
npm run verify:fsmc:prior-attempt-required-results
npm run verify:fsmc:prior-attempt-webkit-safety-observation
npm run verify:fsmc:prior-attempt-webkit-promotion-result
npm run verify:fsmc:prior-attempt-required-gate-result
npm run finalize:fsmc:performance-rerun-approval
npm run verify:fsmc:performance-rerun-approval
npm run artifact:fsmc:upload:performance-rerun-approval

# performance-plan job
npm ci
npm run artifact:fsmc:download:performance-rerun-approval
npm run verify:fsmc:performance-rerun-approval
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run artifact:fsmc:download:release-and-qa-if-required
npm run verify:fsmc:artifact:production
npm run verify:fsmc:artifact:qa-if-required
npm run plan:fsmc:performance
npm run verify:fsmc:performance-plan
npm run artifact:fsmc:upload:performance-plan

# performance-shard matrix job（matrix.shardIdごと、max-parallel: 12、timeout-minutes: 330）
# first executable workflow step ID: fsmc-performance-job-deadline
# 次のdependency-free script出力をpinned actions/upload-artifact stepでcreate-new uploadしてからnpm ciへ進む
node scripts/fsmc/begin-performance-shard-deadline.mjs --shard-id $env:FSMC_SHARD_ID --start-supervisor
npm ci
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run artifact:fsmc:download:performance-plan-and-builds
npm run verify:fsmc:artifact:production
npm run verify:fsmc:artifact:qa-if-required
npm run begin:fsmc:performance-shard-ledger -- --shard-id $env:FSMC_SHARD_ID --snapshot preproduct
npm run verify:fsmc:performance-shard-ledger -- --shard-id $env:FSMC_SHARD_ID --snapshot preproduct
npm run artifact:fsmc:upload:performance-shard-ledger-preproduct -- --shard-id $env:FSMC_SHARD_ID
npx playwright install --with-deps chromium
npm run verify:fsmc:performance-runner:shard -- --shard-id $env:FSMC_SHARD_ID
npm run calibrate:fsmc:performance:shard:prebuilt -- --shard-id $env:FSMC_SHARD_ID
npm run mark:fsmc:performance-shard-started -- --shard-id $env:FSMC_SHARD_ID
npm run verify:fsmc:performance-shard-ledger -- --shard-id $env:FSMC_SHARD_ID --snapshot started
npm run artifact:fsmc:upload:performance-shard-ledger-started -- --shard-id $env:FSMC_SHARD_ID
npm run test:fsmc:performance:shard:prebuilt -- --shard-id $env:FSMC_SHARD_ID
# 以下6 stepは先行stepの結果にかかわらずworkflowの独立したif: always() stepで実行
npm run finalize:fsmc:performance-shard-ledger -- --shard-id $env:FSMC_SHARD_ID
npm run verify:fsmc:performance-shard-ledger -- --shard-id $env:FSMC_SHARD_ID --snapshot terminal
npm run artifact:fsmc:upload:performance-shard-ledger-terminal -- --shard-id $env:FSMC_SHARD_ID
npm run finalize:fsmc:performance-shard-result -- --shard-id $env:FSMC_SHARD_ID
npm run verify:fsmc:performance-shard-result -- --shard-id $env:FSMC_SHARD_ID
npm run artifact:fsmc:upload:performance-shard-result -- --shard-id $env:FSMC_SHARD_ID

# reducer job（if: always()）
npm ci
npm run artifact:fsmc:download:performance-rerun-approval
npm run verify:fsmc:performance-rerun-approval
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run artifact:fsmc:download:release-and-qa-if-required
npm run verify:fsmc:artifact:production
npm run verify:fsmc:artifact:qa-if-required
npm run artifact:fsmc:download:performance-plan-and-all-shards
npm run observe:fsmc:performance-run-attempt-jobs
npm run verify:fsmc:performance-job-intervals
npm run reduce:fsmc:performance
npm run verify:fsmc:performance-reduced-result
npm run artifact:fsmc:upload:performance-reduced-result

# required-results-finalizer job（全入力producerをif: always()で待つ）
npm ci
# 各download／verifyと末尾3 stepは独立したworkflowのif: always() step。
# download不能時はcurrent-run missing sentinelを残し、欠落を常にfailedへ再計算する
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm run artifact:fsmc:download:qa-if-required
npm run verify:fsmc:artifact:qa-if-required
npm run artifact:fsmc:download:ci-prerequisites-result
npm run verify:fsmc:ci-prerequisites-result
npm run artifact:fsmc:download:functional-result
npm run verify:fsmc:functional-result
npm run artifact:fsmc:download:performance-reduced-result
npm run verify:fsmc:performance-reduced-result
npm run artifact:fsmc:download:performance-rerun-approval
npm run verify:fsmc:performance-rerun-approval
npm run finalize:fsmc:required-results
npm run verify:fsmc:required-results
npm run artifact:fsmc:upload:required-results
```

各shardではfirst executable deadline artifact upload後だけ`npm ci`へ、preproduct snapshot upload後だけbrowser／runner envelope／calibrationへ、started snapshot upload後だけ製品processへ進む。外側supervisorはActions job `started_at + 300分`のabsolute product deadlineでsetupまたはproduct child treeを止め、`started + 300分`へ延長しない。`started_at + 330分`のhard deadlineまでをalways reporter予約枠とし、deadline artifact／preproduct／started／terminal／resultの時刻とdigest chainを再計算する。hard timeout、resultまたは必須artifact欠落は開始前後を問わずfailedとし、preproduct／terminal snapshotとallowlist証跡が揃うschema-validな開始前failure resultだけをinfrastructure-failedへ再計算する。reducerは同じrun／attempt／shardのdeadline artifactと3 lifecycle artifact classから最長の合法digest chainを構成し、同一class複数、startedだけ、terminal predecessor差、started後not-started、別attempt混在を拒否する。shard jobはown jobのAPI `started_at`取得に限定した`permissions: { actions: read, contents: read }`、reducerと`performance-rerun-preflight`も`actions: read, contents: read`を持ち、package permission／credential／write permissionを持たない。`observe:fsmc:performance-run-attempt-jobs`とdeadline scriptはAPI version headerと上記literal attempt endpoint／pagination以外を拒否し、raw responseをartifactへ保存せずallowlisted job ID／started／completed projectionだけを使う。finalizerはfoundation-quality result、production／必要時QA manifest、functional result、performance reduced result、CI prerequisite result、current performance rerun approval resultのexact 6入力classをcurrent run／attemptから取得し、source、`productionArtifactTreeSha256`／`productionBuildManifestSha256`、必要時`qaArtifactTreeSha256`／`qaBuildManifestSha256`、approval digest、artifact purpose／readiness／`completedThrough`／`currentPhase`／`phaseProgress`／catalog／traceability／test manifest／topology hashを再検証する。class欠落、複数artifact、別run／attempt、producer失敗、phase state差、hash差をfail-closedにし、schema-validな開始前allowlist証跡だけをinfrastructure候補へできる。functional／shard／prerequisite側の自己申告passを採用しない。I0／I1／I11 release-readyではQA tree／manifest hashを「不要であることを検証したnull」、I2～I10とI11 internal-testingでは両方exact 1件として扱う。

性能のtest retry／workflow自動retryは0とする。reducerまたはgateがschema-validな開始前allowlist証跡から`infrastructure-failed`へ再計算し、CI Operatorがversion付き承認条件を満たす場合だけ、GitHub Actionsの`Re-run all jobs`でperformance-rerun-preflight、quality、CI prerequisite、production／必要時QA build、functional、advisory／promotion WebKit、performance plan／全shard／reducer、finalizer、gateの全required jobを同一sourceのnew attemptへexact 1回再実行する。attempt 2 preflightがprior performance／required-results／WebKit observation／promotion／required-gate artifacts、runtime、rosterからcurrent approval artifactを新規生成するまで後段は進まない。shard単体／failed-jobs／部分matrix rerun、product failure／budget超過／製品開始後watchdogの再実行合格化、attempt間のresult混在を禁止し、attempt固有artifact名を使う。最大2 attemptのperformance shard matrix部分だけを3,300 matrix分／35,640 runner分へ制限する。

次のadvisory WebKit jobはI11専用ではなく、I0～I11の毎candidateでproduction build jobを待ち、必須Chromium jobと分離する。pre-releaseでは`requiredSafetyIds(state)`の`pre-release-production-guard`だけ、release-readyでは全`releaseScope = initial-release` safetyが`implementation-enforced`かつその集合内の`qa-chromium-only`が0件であることを先に検証し、`release-production-full`を含む全導出IDをproduction artifact上で実行する。`releaseScope = future`は選択・実行・成功扱いにせず、初版の0件判定にも混ぜない。I2～I10およびI11作業中`internal-testing`の`qa-chromium-only`機能safetyを到達不能なproduction WebKitへ渡さない。

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npx playwright install --with-deps webkit
npm run run:fsmc:webkit-advisory-observed:prebuilt
```

`run:fsmc:webkit-advisory-observed:prebuilt`は通常表示／a11yとsafety tagを分離して実行し、test／browser失敗時もCIの`if: always()` report stepからschema-valid observationをuploadする。scriptがprocess開始前に失敗してもCI wrapperが`infrastructure-failed` observationを作る。`fsmc-required-gate`はこのartifactがないrunを再実行推測や前run流用で補わない。

常設`webkit-safety-promotion` jobもI0～I11の毎candidateでproduction build jobを待つ。branch protectionのrequired context自体には追加せず、register 0件でもjobとresult artifactを省略しない。

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
# open findingが1件以上のbranchだけで実行。0件branchはinstallせずnot-requiredを生成
npx playwright install --with-deps webkit
npm run run:fsmc:webkit-safety-promotion:prebuilt
```

`run:fsmc:webkit-safety-promotion:prebuilt`はregister hashとopen `webkit-temporary-required`を検証する。0件ではWebKitをinstallせず`not-required` artifact、1件以上では上記exact `npx playwright install --with-deps webkit`後に選択testをretry 0で全件実行し、`if: always()` wrapperから`passed | failed | infrastructure-failed` artifactをuploadする。空testやjob skipを`not-required`へ偽装しない。

固定job／status `fsmc-required-gate` aggregatorはI0～I11の毎candidateでbuild、functional、performance reducer、required-results finalizer、advisory observation、promotionの全jobを`if: always()`相当で待つ。通常判定後も独立reporterが`FsmcRequiredGateResultV1`を必ず生成し、verified result statusを最終checkへ反映する。source stateが`contracts-only`／`internal-testing`なら`verify:fsmc:phase-gate`を選び、`phaseProgress = in-progress`では`completedThrough`まで、`exit-candidate`では`currentPhase`までのExitを要求する。I11 `exit-candidate`かつ`release-ready`だけは`verify:fsmc:release-readiness`を選び、どのmodeでも同じstatus名を出す。

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm run artifact:fsmc:download:foundation-quality-result
npm run verify:fsmc:foundation-quality-result
npm run artifact:fsmc:download:qa-if-required
npm run verify:fsmc:artifact:qa-if-required
npm run artifact:fsmc:download:ci-prerequisites-result
npm run verify:fsmc:ci-prerequisites-result
npm run artifact:fsmc:download:required-results
npm run artifact:fsmc:download:functional-result
npm run verify:fsmc:functional-result
npm run artifact:fsmc:download:performance-reduced-result
npm run verify:fsmc:performance-reduced-result
npm run artifact:fsmc:download:performance-rerun-approval
npm run verify:fsmc:performance-rerun-approval
npm run verify:fsmc:required-results
npm run artifact:fsmc:download:webkit-safety-observation
npm run verify:fsmc:webkit-safety-observation
npm run artifact:fsmc:download:webkit-promotion-result
npm run verify:fsmc:webkit-promotion-result
npm run verify:fsmc:safety-findings
npm run verify:fsmc:required-gate
# 以下4 stepは上の判定成否にかかわらずworkflowの独立`if: always()`で実行
npm run finalize:fsmc:required-gate-result
npm run verify:fsmc:required-gate-result
npm run artifact:fsmc:upload:required-gate-result
npm run enforce:fsmc:required-gate-result-status
```

`test:fsmc:required:qa-prebuilt`はI2～I10およびI11 internal-testingのQA artifactへ、`test:fsmc:required:prebuilt`はI11 release-ready production candidateへ、manifestどおりの機能testだけを実行し、performance sampleを同processへ混ぜない。performance planは同じsource、artifact tree／build manifest hashと現在phaseの`initial-release && enforcedFromPhase <= currentPhase && status != planned`集合から独立に導出する。artifact verifierはproduction／QAのsource、tree digest、manifest bytes SHA、purpose、readiness、DB target、`ciRun`を照合する。performance reduced verifierは期待shard、current attempt、plan／budget／runner／topology／catalog／traceability hashes、各sample、OFF pair順、欠落を再計算する。required-results verifierはfoundation、functional、reduced performance、CI prerequisite、catalog／traceabilityの各hash、selected／executed／satisfied／failed集合、ID→command、statusを再計算する。WebKit observation／promotionとrequired gateの既存安全判定は同じcurrent runへ拘束し、外部activation、実event pilot、実機収集、外部metrics、receipt builderを追加しない。

I0 Exit候補の同一HEADでRepository Maintainerがbranch rulesetへ`fsmc-required-gate`を一度だけ直接requiredとして追加し、read-only再取得でexact contextを確認する。既存`quality`もrequiredのまま維持し、既存終端contextへの逆接続、phase／finding別context、動的なrequired変更を標準手順へ追加しない。
