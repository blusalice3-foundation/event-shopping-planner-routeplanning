# Full Split Map Cell Implementation Plan

- 文書状態: 2026-08-23実装開始可否再レビューの開始阻害事項是正済み。phase外のpre-I0品質・外部前提gateは未通過であり、通過後に限ってFSMC-I0着手可、FSMC-I1以降は直前phase Exit通過後に限って着手可
- 対象機能: 地図番号セルのa/b完全分割
- 対象ソース基準: `2eaba922816e8b263c6479e81ab9f265321654b2`（短縮: `2eaba92`、実装code基準。後続のplan-only commitはpre-I0 inventoryで追跡）
- 固定旧版Aのソース基準: `3db4be011d0f4123aa3953b559280c58f33d026a`（互換試験専用。現行実装の基準に使用しない）
- 作成日: 2026-08-12、最終判断反映日: 2026-08-23
- 想定規模: 大規模、初版12～17個の論理PRと後続版

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
- 問題発生時は旧版アプリへ戻し、従来の未分割セルとして開けるようにする

初版は、原子的保存、通常マップ、集中モード、経路、イベント単位Backup V2、同時出力する旧版用V1互換core backup、旧版fallbackを主機能とする。これらを安全に成立させるための同一地図内copy、event／map／hall lifecycle、地図再取込・通常編集、dormant／quarantined管理UI、共有訪問projection、ローカル有効化・復旧導線も初版の必須support scopeに含める。完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図への設定コピー、意図的な同一売場再訪は後続版とし、初版のExitやDefinition of Doneへ含めない。

### 1.1 レビュー結論と確定判断

2026-08-12の総合レビュー、2026-08-22までのQ1～Q18回答、2026-08-23の二度の実装開始可否レビューで検出・確定した、基準source、識別子衝突、保存原子性、旧形式復元、経路表現、ローカル停止、性能測定、試験範囲、現行code接続面の不整合を本版で是正する。製品判断は次のとおり確定し、未回答の製品事項は残さない。FSMC-I0は契約、fixture、固定旧版A、試験projectを用意する最初の実装フェーズだが、phase外のpre-I0品質・外部前提gateが成功したHEADを固定するまでは着手しない。機能本体を実装済みと仮定するExitは置かず、機械判定可能なFSMC-I0 Exitが未達の場合はFSMC-I1以降へ進まない。

| 判断ID  | 確定内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PD-01` | 分割設定を含まない旧形式の完全復元では、対象範囲の既存分割設定を削除せず`dormant`へ移し、事前previewで件数・理由・復旧方法を表示する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PD-02` | `01a`、`1a`、`０１ａ`は端末内preflightで統合衝突が0件の場合だけ同じ売場へ正規化する。衝突があるeventは分割機能をONにせずlegacy identityを維持し、利用者へ対象と解決方法を表示する。表示用原文は常に維持する                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `PD-03` | 配布制御は外部serviceを使わず、端末全体のローカルOFF、イベント別のローカルON／OFF、DB・schema異常時の自動安全モードだけで構成する。既存イベントは初期OFFとする                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `PD-04` | 機能OFF／安全モードではsplit固有の表示、位置解決、保存、経路、操作を従来の未分割セル動作へ戻し、保存済み分割設定を通常操作で変更しない。ただし`PD-14.C2`の共有訪問projectionと挿入規則はI7 Exit後、`PD-14.C3`の経路接続はI10 Exit後、重複物理`(row, col)`を新規作成するimport・通常編集after-imageの原子的拒否、および既存重複を配列順で選ばず当該mapの経路生成・cache再利用を停止する`map-data-untrusted`安全判定は導入時からON／OFFを問わず常時適用し、固定旧版Aとのphase-awareな許容差分とする。復旧用backupへのread-only収録、authority正常時の内部legacy rebase、`PD-09`の期限到達cleanupは非表示のsidecar保守として許可する |
| `PD-05` | スマートフォンでは表示サイズにかかわらず必ずpickerを経由する。pickerはa/b順ではなく画面上の空間順に並べ、「左側 b」「右側 a」等、位置と文字を併記する                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PD-06` | ブロックコピーは解除しない「追加・変更のみ」を既定とし、「完全同期（解除を含む）」を別の明示操作として提供する。どちらも変更previewを必須とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PD-07` | 完了判定はunit、integration、browser、a11y、性能の自動テストで行い、外部証跡、実イベントpilot、managed device receiptは作らない。特定機種の正式保証は表記せず、自動テスト対象と対象外を明記する                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PD-08` | 初版の主機能は原子的保存、通常・集中表示、経路、イベント単位Backup V2、V1互換core同時出力、旧版fallbackとし、安全上不可分な同一地図内copy、lifecycle、再取込・通常編集、retained管理、共有訪問projection、ローカル制御・復旧導線も必須support scopeへ含める。完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図コピー、意図的再訪は後続版へ送る                                                                                                                                                                                                                                                                     |
| `PD-09` | イベント削除時は「30日保持」を既定、「今すぐ完全削除」を明示選択とする。保持中は端末内で再関連付けでき、30日後に端末時計が正常な場合だけ対象設定を自動削除する。設定単独ファイル出力は後続版とする                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PD-10` | 実機receiptや3実イベントpilotを完了条件にせず、fixtureを使うretryなしの自動テストをrelease gateとする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PD-11` | 分割セルに`whole`または非対応番号がある場合はa/bへ推測割当てせず、「側未設定」badge、一覧、分割有効化前previewで存在を知らせる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `PD-12` | Backup V2の出力時は、分割設定を含まない旧版用V1互換core backupも同時に出力し、用途と失われる情報を表示する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PD-13` | 経路connectorは自セルまたは結合セル領域内で安全に接続できる場合だけ描画し、領域外や障害物横断が必要なら`unroutable`とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `PD-14` | 同じ`ExecutionVisitIdentity`の商品追加は既存訪問へglobal統合し、raw訪問位置を動かさず、必要な`PhaseVisitIdentity`投影だけを追加して全画面へ同じ結果を反映・通知する。利用者が同じ売場を意図的に複数回訪れる機能は初版対象外とする                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PD-15` | 1イベントにつき主に編集する端末は1台とし、端末間自動同期・自動mergeを行わない。Backupはpreview後の原子的置換であり、端末全体OFF・イベント別ON／OFFを収録せず、新規復元はOFF、既存イベントへの復元は復元先のローカル状態を維持する                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PD-16` | 分割ON中の編集、取込、復元、地図変更が`01a`／`1a`等の正規化衝突を新たに作る場合、その操作全体をstore書込み前に原子的に拒否する。既存data、分割設定、ローカルONは維持し、自動OFFや部分取込を行わず、衝突した原文と修正方法を表示する                                                                                                                                                                                                                                                                                                                                                                                               |
| `PD-17` | 3.13および10.5の性能数値は製品要件としてI0で固定する。I0ではprofile、測定法、config、未実装scenarioの適用開始phaseを検証し、実測合格は各機能の実装phaseとI11で要求する。上限緩和は製品判断IDの追加と通常reviewを必須とする                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PD-18` | browser／OS／profileによる保存領域の完全消去はアプリが新規installと区別できないためデータ保持保証の対象外とする。部分破損、payload／metadata／checkpoint不整合、store欠落、quota、abortは検出して誤接続・部分commitを防ぎ、安全モードとBackup復旧案内を提供する。完全消去はclean-startと事前Backup案内を試験する                                                                                                                                                                                                                                                                                                                  |

FSMC-I0で次を契約・fixture・実行可能な自動検証として固定し、いずれかが未達の場合はFSMC-I1へ進まない。後続phaseで実装する振る舞いはgolden input／expected resultとphase manifestへ登録し、I0で未実装featureを成功扱いにするstub、空test、`--passWithNoTests`は置かない。

- DBなし、現行core DB version、`Vcap - 1`、`Vcap`、`supportedMaximumVersion`、`supportedMaximumVersion + 1`を重複排除した境界集合、`Vcap`更新commit直前／直後の終了、運用後に全recordだけを失った空storeのfixture、capability decision table、preflight harnessを用意し、I2で実装する各分岐の期待結果を固定する。現行値5／候補6／supported上限7／拒否境界8はprovenance fixtureの具体例として残すが、期待分岐をliteralへ結び付けない。I0自身はproduction DB versionやruntime保存経路を変更しない
- full observed root、checkpoint、candidateの物理locationをIDB transaction内／localStorage externalへ分けたroot別観測vector、全governed rootのbaselineを保持するexternal durable fenceを持つ`(storeName, key)`単位のCAS契約、`onupgradeneeded`内の初期root原子作成、partial-loss snapshot、ローカル発行ID、anchor token、active／dormant／quarantined、30日保持と時計異常、制御root、衝突時全拒否を固定する。さらに、現行localStorageの`blockDetectionSettings`をcanonical IDB `eventSettings` rootへ移す旧版互換bridge journal、全削除対象のcoverage closure、unknown store／keyのlossless退避不能時stopをexact schema・ADR・golden fixtureへ含める
- 15,000セル、最大8,192論理ブロック、15,000分割設定、30,000半領域、400アイテム、400売場、400 `ExecutionVisitIdentity`、最大800 `PhaseVisitIdentity`（単一phaseの経路は最大400）の最大fixtureについて、寸法、block／merge／障害物／visit分布と生成payload hashを固定する。製品上限、測定法、単一値の`enforcedFromPhase`、scenario/profile shard、各shard直前calibration、結果reducerをversion付きconfigへ固定し、I0ではconfig検証とsynthetic sampleによる統計・shard集合計算だけを実行する
- 固定旧版A→候補新版B→固定旧版A→候補新版B、旧形式完全復元、Backup V2＋V1互換core、通常地図編集、地図再取込、複数tab競合、ローカルOFF切替について、fixture・期待値・失敗注入stageを登録する。実装前scenarioは担当phaseのExitで初めて必須実行に昇格する
- Desktop／Mobile Chromiumの必須2 project、両projectへ属するretry 0の安全性／a11y suite tag、WebKit advisory project、同一candidateにhash拘束したWebKit safety observation、traceability verifier、I0専用verification commandを作成し、project／suite membership、observation欠落・未分類と「該当test 0件」を機械的に失敗させる

基準source `2eaba92`には`PD-14`の共有訪問projectionが一部実装済みである。責務を`PD-14.C0`（I0: inventory／fixture）、`PD-14.C1`（I1: pure identity／projection／adapter契約）、`PD-14.C2`（I7: global projection、member移動、挿入、全画面通知）、`PD-14.C3`（I10: route、hit-test、cache、route insertion anchor）へ分ける。I2～I6はport／after-image hookと基準source挙動のnon-regressionだけを提供し、C2／C3の完成や固定旧版Aとの差分許可を前phase Exitへ要求しない。I7 Exit後はC2を、I10 Exit後はC3をON／OFFにかかわらず常時適用する。固定旧版Aは完全SHA `3db4be011d0f4123aa3953b559280c58f33d026a`のsource、lockfile、Node/npm version、build command、起動command、生成artifactのSHA-256を`tests/fixtures/fsmc/legacy-a/manifest.json`へ記録し、artifactをCIで再生成せず固定入力として検証する。候補新版Bは各CI runの対象commitから一度だけbuildする。

I0でFSMC専用の一方向導入証跡`FSMC_CAPABILITY_DB_VERSION`（以下`Vcap`）をsource、decision table、`config/fsmc-capability-adoption.json`へ固定し、そのversionを他用途へ再利用しない。候補versionの採択入力は固定旧版Aとcurrent sourceだけでなく、全remote-tracking history、tag、配布済みversion／artifact、release manifest、同一DB名のversion別object-store inventoryを含む。少なくともlocal historyの`81795770cca30c68bb1526f989dcd7ab0af1edb4`が持つDB6／`memberRouteItems`を「未配布」または「移行対象」と権威あるrelease provenanceで分類できなければ`Vcap = 6`を採択しない。decisionは`adopt-vcap`または`alternative-witness-required`の判別可能unionとし、後者ではI0 ExitとI2開始を閉じる。I2は採択済みversionのmigration／repositoryをintegration harnessとnon-promotable QA database namespaceで実装・検証するが、I2～I10のproduction artifactは現行`DB_VERSION=5`を維持し、capability storeをopen／createしない。I11の`release-ready` production candidateだけが、I2の全migration testを同じproduction artifactで再実行してから採択済み`Vcap`を有効化する。DBなし、または`dbVersion < Vcap`でnew storeもsplit対象rootのmetadata／checkpoint／candidate／fence traceもない場合だけ未導入の`core-only`であり、通常core traceはこの判定を変えない。`dbVersion >= Vcap`はversion自体が導入済みのdurable witnessなので、capability storeまたは必須rootが欠ければsplit痕跡の有無にかかわらず部分欠損の自動安全モードと復旧runbook案内にする。安全な候補versionを証明できない場合は、衝突しない一方向導入証跡、新DB方式、個別退避・再構築を別ADRで決め、同じ欠損判定を全fixtureへ反映するまでproduction DBを変更しない。

### 1.2 実装開始可否レビューの是正決定

次の`RC-*`は2026-08-23レビューで追加したnormativeな是正決定である。既存節へ同じ内容を反映し、`config/fsmc-traceability.json`でowner phase、fixture、test、command、DoDへ一対一に追跡する。本文と`RC-*`が矛盾する場合に一方を優先して実装するのではなく、I0のcross-verifierが矛盾として失敗し、同じPRで本文、schema、manifestを整合させる。

| 決定ID  | 確定内容                                                                                                                                                                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RC-01` | 最初のI0変更前にclean worktreeで`git diff --check`と、`package.json`が定義する既存`npm run quality`の完全な順序付きcommand graphを省略なしでgreenにした専用pre-I0 commitを作り、そのcommitを`i0StartHeadSha`へ一度だけ固定する。手書きsubset、既知失敗、coverage省略を許さない                                       |
| `RC-02` | `PD-14.C0` inventoryはI0、C1 pure契約はI1、C2 projection／挿入／通知はI7、C3 route／hit-test／cacheはI10が所有する。I2～I6はport／hookと基準挙動のnon-regressionだけを所有し、後続ownerのconformanceを前phase Exitへ要求しない                                                                                       |
| `RC-03` | 初版support scopeに同一地図内copy、lifecycle、再取込・通常編集、retained管理、共有訪問projection、ローカル制御・復旧導線を含め、主機能だけを列挙した短いscope文から必須作業を除外しない                                                                                                                              |
| `RC-04` | I2～I10のproduction artifactは現行DB5のままとし、採択済み`Vcap`へのmigrationはQA namespace／integration harnessだけで検証する。production `DB_VERSION`を採択済み`Vcap`へ進めるのはI11 release-ready candidateだけとする                                                                                              |
| `RC-05` | 現行`NavigatorItem`へevent／map／hall責務を混入させず、runtime snapshotから解決済み`ProjectedPhaseVisit`を作るadapterを正式境界にする。rekey入力は`manualHallId`、hall definition／association／remap、mapped↔mapless遷移を含む                                                                                      |
| `RC-06` | 新しい3×3経路型は`SubcellPathNode`とし、既存`PathNode`と同名にしない。現行`MapVisitListPanel`にはfilter／focus復帰責務がないため、I8で同componentをshellへ拡張し、新しい`ProjectedVisitList`をpure DOM viewとする。callbackは最新projectionを`PhaseVisitIdentityKey`で再解決する                                     |
| `RC-07` | Backup V2 wire DTOをruntime `AppData`／persistence型から独立させる。V1とXLSX 2.2 full restoreをI4の初版compat ownerへ割り当て、URLは共通safe-link policyを通す                                                                                                                                                       |
| `RC-08` | `recovery-required`は行き止まりにせず、trusted core read-only export、診断、in-place reset可能条件、profile reset＋検証済みbackup再取込の明示runbookを提供する。untrusted split rootを自動採用・自動修復しない                                                                                                       |
| `RC-09` | Backupの性能保証、import hard limit、export generation limitを方向別に固定し、UI main threadで全file `arrayBuffer`を作らない。同一origin module Worker、bounded slice、CSP／PWA asset、cancel cleanupを初版要件にする                                                                                                |
| `RC-10` | 性能runnerはGitHub Actions `ubuntu-24.04`上のrepo-owned OCI image digest固定jobとし、provider、owner、image、cgroupをI0で実在値へ固定する。製品測定は機能jobと分離したscenario/profile shardごとに同じcontainer／browserで直前calibrationし、hash付き全shardをreducerで完全照合する                                  |
| `RC-11` | 固定旧版A artifactの保管・取得・hash・license・serve方法と、既存test membership／coverage／architecture／quality workflowの更新をI0成果物にする。transitive dependencyを直接importしない                                                                                                                             |
| `RC-12` | readinessを「code存在・public到達・dispatch認可・commit可能」に分け、future profileを初版gateから分離する。DOM代替は検索・絞込み・virtualization・focus復元、通知は固定`role=status`、Canvasはtoken contrast／forced-colors試験を持つ                                                                                |
| `RC-13` | V2の`eventSettings` authorityはcapability store内のgoverned IDB rootとし、現行localStorage `blockDetectionSettings`は固定旧版A互換projectionへ降格する。移行・旧版書込み取込・mirrorはdurable bridge journalとbefore／after witnessで再開可能にし、補償rollbackをcommit authorityにしない                            |
| `RC-14` | `Vcap`はsource履歴だけでなく全配布artifact／release provenance／store manifestをdecision inputにする。guided resetは実profileの全object storeと全削除local keyをcoverage closureで照合し、未知対象をlosslessに退避・復元できない場合は必ず`unsupported-stop`とする                                                   |
| `RC-15` | durable visit stateは現在phase＋anchor、phase別保存anchor、完了状態、購入変更anchorを表現し、item IDだけからphase visitを推測しない。base visit順はdenseな`executionVisitOrder`をauthorityにし、全phaseをnormal→postponed→late、各phase内base順へ固定する                                                            |
| `RC-16` | active `(eventInstanceId, mapInstanceId, blockInstanceId, number)`をexact uniqueとし、runtime／全writer／startup／V2で同じinvariantを使う。identity token、tuple、`ReadonlyMap`、checkpoint digestはversion付きbyte canonical contractとgolden fixtureを持つ                                                         |
| `RC-17` | 現行のimport競合`create-alias`をイベント全体複製とみなさない。初版のイベント全体複製はI3の新command／UIとして全core、eventSettings、map／block／item／visit／split IDをgroup-preserving remapする。通常セル編集と`MapVisitListPanel` shell拡張も既存機能ではなくI6／I8の新規scopeとして見積もる                      |
| `RC-18` | retained再関連付け、rekey／挿入、同anchor遷移、connector mask、hit-test、表示競合をpureな決定表へ固定する。自owner番号領域だけをconnector maskで許可し、同anchorは描画・hit-testなしでもroute進行を維持する                                                                                                          |
| `RC-19` | performance required gateはplan→scenario/profile matrix→shard→reducer→required-results finalizerのDAGとする。各shardの静的上限を300分、job timeoutを330分以下とし、別run／別attempt／別shardのsample混在、欠落、重複を拒否する                                                                                       |
| `RC-20` | normative requirementのID集合を`PD-*`、`RC-*`、`DOD-FSMC-*`、`EXIT-FSMC-*`へ限定して全件に安定IDを与え、その他の規則・実装bulletはexact 1件以上のIDへsupporting sourceとして結ぶ。catalog hashをtraceability、test manifest、required-resultsで一致させ、未追跡bulletと初版要件のfuture誤分類をI0 verifierで拒否する |
| `RC-21` | 最大fixtureは件数だけでなく、100×150 grid、block／merge／obstacle／visit配置、生成recipe、payload／topology／期待root hashをversion付きmanifestへ固定し、OFF referenceとON targetでdata topologyを一致させる                                                                                                         |
| `RC-22` | branch gate、GitHub Actions、GHCR publish／pullに必要な外部権限、owner、確認時点、最小workflow permissionsをFSMC専用configへ固定する。secret／credential値は保存せず、必要owner不在はpre-I0 blockerとする                                                                                                            |
| `RC-23` | `split-picker-popup`を通常マップI8／集中モードI9とDesktop direct-hit／Mobile pickerの4 scenarioへ分割し、各entryに単一profileと単一値の`enforcedFromPhase`を持たせる                                                                                                                                                 |

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
- 保存Port: `src/app/ports/PersistenceCommandPort.ts`
- IndexedDB定義: `src/persistence/db/constants.ts`
- バックアップ: `src/utils/appBackup.ts`
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

番号は表示用原文と識別用正規値を分ける。表示、入力欄、バックアップ上のアイテム番号は可能な限り原文を維持する。地図照合、`SpaceIdentity`、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、索引、経路、再取込照合では、NFKC正規化、空白除去、小文字化を行う。数字部分の先頭ゼロ除去は、event内の地図、item、保存済み訪問・順序・進行状態を端末内preflightで検査し、統合前後の異なるidentityが同時に存在しない場合だけ有効にする。`01a`と`1a`等が別identityとして共存する衝突を検出したeventではONへの変更を拒否し、完全legacy identityを維持して対象件数、影響、解決方法を表示する。検査対象payloadや結果を外部送信しない。一方、a/b以外の非対応番号は、基準番号と正規化済み英字suffixをidentity tokenへ残し、`26c`、`26d`、`26ab`を互いに衝突させない。英字suffix後の商品枝番は既存規則を維持し、`26c2`は`26c`と同じunsupported token、`26d2`は`26d`と同じtokenへまとめる。正規化を理由に保存済みitem番号の原文を自動で書き換えない。

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
- 選択したcurrent owner＋番号にretained履歴がある場合、通常の新規設定としてactiveを追加せず「保持履歴の再関連付けが必要」と表示してI5の明示previewへ送る。候補がexact 1件の場合だけそのretainedを同一transactionでactiveへ状態遷移させる。2件以上では候補ごとのlast-known owner、reason、evidenceを表示して利用者に1件を選ばせ、選択時の最新rootでも同じ候補集合である場合だけ、選択retainedを除去してactiveを作る。他候補と同じ`priorOwner`＋numberの履歴が残る場合は同時に解決しない限りwrite 0件とし、active／retained overlapを作らない
- 1つの地図内で論理ブロック名は、NFKC、前後空白除去、大小文字を無視した照合キーで一意とする。手動の同名追加は既存ブロックの置換previewを経由する。XLSX上の完全に同じ名前の複数領域は現行仕様どおり1つの論理ブロック・複数`cellGroups`として同じ`blockInstanceId`へまとめるが、原文が異なるのに照合キーだけが衝突するブロックはcore map import結果を変えず、分割機能では影響する番号を対象外または`quarantined`として理由を表示する
- 同じ論理ブロック内に正規化後の同一番号セルが複数ある場合、その重複番号だけを初版対象外とし、同じ地図内の一意な他番号は利用可能とする
- 重複番号を検出した場合はセル選択画面を設けず、保存・コピー・自動継承から除外して理由を表示し、いずれかを推測で選ばない
- 同じ物理番号領域が複数ブロックに属する、番号領域同士が重なる、または結合セルがブロック境界をまたぐ場合も、影響する領域を保存・コピー・自動継承から除外し、既存entryは`quarantined`へ移す。配列順の先頭ブロックを暗黙に選ばない
- `DayMapData.cells`に同じ`(row, col)`の物理セルが複数ある場合は配列の先頭／末尾を採用せず、機能状態を問わず、その重複を新規作成するimport・通常編集のafter-imageを全store書込み前に原子的に拒否する。起動時から存在する場合は当該mapをFSMC上`map-data-untrusted`とし、split表示だけをlegacy whole-cell fallbackへ戻す一方、当該mapの経路は生成もcache再利用もせず安全停止し、影響entryを`quarantined`へ移す。異なる`value`／`backgroundColor`を持つ重複セルの並べ替えで表示・経路結果が変わる状態を許さない
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
- コピー先の同じcurrent owner＋番号を指すretained履歴が1件でもある場合は、通常の追加・変更・完全同期から`除外（履歴あり・手動再関連付けが必要）`とし、新activeとretainedを重ねない。I5の明示的な再関連付けだけが、最新候補集合と利用者選択を再検証して選択retainedをactiveへ状態遷移できる。同じowner＋numberを持つ他retainedが残る場合は一括解決previewなしにcommitせず、複数候補を自動選択したりcopyが履歴を削除したりしない
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

- `PD-05`に従い、表示用の`layoutMode`と操作用の`isSmartphoneSelectionMode`を分離する。pure `resolveSmartphoneSelectionModeV1`は`forcedPickerOverride`、`mobileCapability: true | false | "unknown"`、primary pointer／touch capabilityを入力とする。production `MobileCapabilityPort`はbooleanの`navigator.userAgentData?.mobile`だけをmobile authorityとし、User-Agent文字列、viewport幅、touch有無からmobile値を捏造しない。優先順位はoverrideによるpicker強制、`mobileCapability=true`、`mobileCapability=false`、unknownの順とし、unknownはpointer情報にかかわらず安全側pickerへ倒す。`mobile=false`の狭幅／touch PCは非スマートフォン規則、`mobile=true`はtouch情報が矛盾してもpickerとする。overrideは非スマートフォン強制を持たずBackupへ収録しない。gesture開始時に判定snapshotを固定し、判定入力が途中で変わればgestureをcancelする。I0のtruth tableとI8／I9 browser testで全組合せを固定する
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
- 同じ`ExecutionVisitIdentity`を意図的に複数の別訪問として作る「再訪」は初版対象外とし、商品追加・編集・復元・経路挿入の全経路で既存訪問へのglobal統合を優先する
- identity変更を伴う商品編集だけは、変更item IDを変更先identityの既存member末尾へ決定的に移す。変更先の最初のmember位置は動かさず、変更item以外のraw順を維持する
- 投影済み訪問のroute、hit-test、挿入位置は代表商品IDやmember配列の先頭ではなく`PhaseVisitIdentityKey`で参照する。memberの商品ID列は訪問payloadとし、identityには含めない
- 同じ`PhaseVisitIdentityKey`にmemberが残る状態で先頭memberを削除・変更した場合は、同じ訪問へ再解決して訪問位置、座標、経路順、挿入anchorを維持する。member列だけが変わりidentity・座標・順序signatureが同じならroute cacheを破棄しない
- preflight衝突0件の場合だけ`01a`と`1a`の表記差を同じ`SpaceIdentity`へ正規化し、表示用番号は各アイテムの原文を維持する。衝突時はイベントをONにしない

既存データで表記差が同一`ExecutionVisitIdentity`へ衝突する場合、商品IDと既存のraw実行列順を正とする。

- migration初回は実行列の商品ID配列を並べ替えず、非連続な同一identityもglobalに集約し、最初に現れる商品位置を統合後訪問の初期位置とする。以後はidentity単位の訪問位置と訪問内の商品順を維持し、先頭memberの変更だけで別訪問の前後へ移動させない
- 正式現在位置は旧`phase`とそのphase indexにある有効な商品IDを`{ phase, anchorItemId }`として、新しい同phaseの`PhaseVisitIdentityKey`へ再解決する。各進行区分の保存位置も`normal`／`postponed`／`late`ごとに独立したanchorとして移行し、item IDだけでphaseを推測しない
- anchor商品がない場合は旧位置以降の最初の生存訪問、次に直前の生存訪問、いずれもなければ先頭へ戻す
- 後回し・遅参の商品ID集合は維持して欠損IDだけを除去し、normalに加える追加phase投影としてbase訪問順から決定的に生成する。visit-key依存集合は商品ごとに新keyへ再配置して衝突時は和集合にする
- `isCompleted`はbooleanのまま維持し、購入変更位置は旧`lastPurchaseChangeAt.phase`と同phase indexの有効な商品IDを`{ phase, anchorItemId }`へ変換する。0件または複数のphase visitへ解決される値だけを`null`へしてreasonを通知し、安全に解決できる値を一律破棄しない
- 一時移動、inspect、return history、経路cache、座標signatureはidentity変更時に破棄し、変換済みの正式現在位置へ戻す。実行中なら一時移動を終了した理由を通知する

### 3.9 経路

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

### 3.10 地図再取込と通常編集

- ブロック名と番号が新旧地図で一意に一致する場合は分割設定を継承する
- 行・列が移動しても一意であれば継承する
- 完全一致がない場合、大小文字差を補正した候補が1件だけなら一致候補にする
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

「分割数30,000」は15,000セルをすべてa/b分割した結果の領域数を意味し、30,000件の分割設定を意味しない。400 itemは各itemがnormalに加えて高々1個の追加phaseへ属せるため、全`PhaseVisitIdentity`投影は最大800、1本のphase別経路は最大400となる。これらは入力拒否の上限ではなく性能保証範囲であり、超過時はbest effortとする。7.3のhard limitは1 eventあたりmap 256、block 8,192であり、1地図・最大8,192 blockの本保証fixtureを包含する。

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

現行の`duplicateEvent`／`create-alias`はimport時のイベント名競合解決であり、地図・設定を含むイベント全体複製ではない。初版ではI3に新しい「イベント全体を複製」UIと`duplicateWholeEventAtomically` commandを追加する。commandは同一snapshotのevent metadata、全item、実行順、durable visit state、map／hall／route／viewport、canonical `eventSettings`、association、active／retained split設定を対象に、event／map／block／item／entry／historical ownerのfresh local IDをgroup-preservingにremapする。新eventはローカルOFF、memory-only focus session・一時位置・route cacheは未開始とし、durable順序・phase anchorはremap済みitem／visitへ保存する。名前衝突、ID再発行失敗、stale、quota、bridge未完了ではwrite 0件とし、previewに対象件数、生成名、remap、コピーしない一時状態を表示する。別日程・別地図へ分割設定だけをコピーする操作とは別commandであり、`create-alias`から呼び出さない。

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

既存`NavigatorItem`は表示用の軽量型のまま維持し、`eventDate`、`manualHallId`、map／event／hall contextを追加しない。app層の`buildProjectedPhaseVisits(input: VisitIdentityInputSnapshot)`が、`ShoppingItem`と同一revisionのevent／map／hall／durable visit snapshotをpure resolverへ渡し、解決済み`LocationKey`、resolution summary、`PhaseVisitIdentityKey`を持つ`PhaseVisitProjectionSnapshot`を生成する。space-navigation、通常マップ、集中モード、一覧はI7から、経路はI10からこのsnapshotだけを受け取り、各consumerで`buildVisitIdentity`、番号parser、hall resolverを再実行しない。既存`buildVisitIdentity`は機能OFF互換adapterとしてI7まで隔離し、I7 Exitで機能ON caller 0件、I11 Exitで許可したlegacy adapter以外のproduction caller 0件をarchitecture testで検証する。

`LocationKey`／`ExecutionVisitIdentity`のafter-image入力には、日程、block、番号、side、優先度、`manualHallId`、hall definitionの追加・変更・削除、hall association／remap、map association、mapped↔mapless、hall-unassigned↔resolvedの遷移を含める。優先度は`ExecutionVisitIdentity`だけを変更し、`LocationKey`へ混入させない。`VisitIdentityInputSnapshot`は単一revisionのevent metadata、map association、hall definition、split settings、商品after-imageを束ね、異なるsnapshot revisionの混在を拒否する。mapless hallは、存在する`manualHallId`のexact 1件一致、manual指定なし時の既存resolver exact 1件、0件時の`hall-unassigned`の順で解決する。dangling manual IDを別hallやunassignedへfallbackせず`missing-manual-hall-reference`、複数候補を`multiple-hall-owners`としてunresolved／ambiguousへ送る。hall表示名だけの変更や、解決後のstable hall IDが同じ変更ではidentityを変えない。

I1はpure `planVisitIdentityTransitions(before, after)`を固定し、I6までは変更planとhookを作るが共有訪問状態のruntime migrationを成功扱いにしない。I7が全item／map／hall writerへ同planを接続し、durableな現在位置、保存位置、phase状態を同じ`ExpectedRootVector`で移送する。memory-only route cache、hover、picker候補はdurable vectorへ入れず、commit成功後だけ新signatureに従って破棄または再計算する。同一commandで複数itemが同じdestinationへ移る場合はraw実行列での元順にmember末尾へ追加する。

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
  enabledEventInstanceIds: string[];
}

type SplitImplementationReadiness =
  | "contracts-only"
  | "internal-testing"
  | "release-ready";
```

分割なしはentryを保存しない。非対応番号は分割entryにはならないが、`SpaceSideIdentity`のtokenを含む別の空間・訪問identityとして扱う。maplessは既存の`MAPLESS_HALL_KEY`、日程、一意に解決したhall ID（manual指定または既存hall resolver）もしくは未割当て、block、番号のcanonical tokenから構成し、mapped用の架空IDを発行しない。legacy-unresolvedの`SpaceIdentity`は`canonicalLegacyToken`だけをidentity payloadに持ち、原文と`LegacyResolutionReason`／`AmbiguousResolutionReason`は`ItemSpaceResolution`の表示・診断payloadで維持する。reasonや原文の違いだけで同じ`LocationKey`に複数のstructural identityを作らず、mappedまたはmaplessへ推測変換しない。ただし`missing-manual-hall-reference`では、異なるdangling manual hallを統合しないためvalidated opaque `manualHallId`をowner evidenceとしてcanonical keyへ含める。`canonicalLegacyToken`は`esp-json-v1`で直列化した`["legacy-space-token", 1, eventInstanceId, normalizedDayKey, ["block", normalizedBlockToken] | ["block-missing"] | ["dangling-manual-hall", manualHallId, normalizedBlockToken], ["number", normalizedNumberTokenPreservingLeadingZeros]]`とする。番号tokenはNFKC、Unicode空白除去、ASCII小文字化後も先頭ゼロを維持し、表示原文とhall表示名はcanonical keyへ直接入れない。別blockまたは別dangling `manualHallId`の同じ不正番号を統合せず、`ambiguous`でも候補を選ばずこのlegacy identityを共有訪問projectionへ残す。各unionはそれぞれ`["mapped-space", 1, ...]`、`["mapless-space", 1, ...]`、`["legacy-space", 1, canonicalLegacyToken]`のcanonical JSON tupleから`LocationKey`を生成し、`SpaceIdentity`と`LocationKey`を一対一にする。

`normalizeFsmcDayKeyV1`はNFKC後にUnicode `White_Space`の連続をU+0020へ畳み、前後U+0020を除去するがcase foldせず、空結果を拒否する。`normalizeFsmcBlockTokenV1`は同じ空白処理後にASCII `A-Z`だけを小文字化し、locale依存case foldを使わず、空結果を拒否する。`normalizeFsmcNumberTokenV1`は3.1のparser前処理そのもので、NFKC、全Unicode空白除去、ASCII小文字化を行い、先頭ゼロはparser分岐が明示的に除去するまで維持する。欠損値を空文字、`undefined`文字列、表示名で代用せず、tupleの`["day-missing"]`、`["block-missing"]`等のtagged branchで表す。現行`normalizeExecutionVisitDay`、`normalizeSpaceBlock`、`normalizeBlockName`の相違はI1 adapterでこの3関数へ集約し、旧関数をcanonical authorityとして混在させない。

identity、fingerprint、projection revisionのtupleはlength-prefix付きUTF-8 `esp-json-v1` canonical bytesでhashし、区切り文字連結、`JSON.stringify(Map)`、object挿入順、locale sortを使わない。`ReadonlyMap`はkeyをcanonical UTF-16 code-unit比較でsortした`[[key, value], ...]`へ、`ReadonlySet`はsort済み配列へ変換する。day／block／numberの全角、空白、ASCII大小文字、leading zero、missing、mapless、dangling hallと、同値Mapの挿入順shuffleをI0 goldenへ固定する。

イベント、地図、ブロック、active entry、retained entry、anchor tokenのローカルopaque IDは、小文字canonical UUIDv4を`crypto.randomUUID()`で発行する。発行transaction内の全namespaceと既存rootを照合し、衝突時は最大3回まで再発行し、3回とも衝突またはAPI利用不能なら操作全体をabortする。バックアップ内の外部IDを採用せず、表示名は診断と手動再関連付けだけに使う。canonical配列順は`a === b ? 0 : a < b ? -1 : 1`というECMAScript UTF-16 code-unit比較に固定し、`localeCompare`、OS locale、大小文字の暗黙変換を使わない。

activeと保持中entryの型を分け、activeだけが現在の`mapInstanceId`／`blockInstanceId`を必須参照できる。retained entryは`number`または`originalNumberToken`の少なくとも一方を必須とし、`blockInstanceId`があれば親`mapInstanceId`も必須とする。最後にactiveだったentryは`evidenceOrigin: "last-active"`とevidenceを必須にし、evidenceを持たずportable fileから初めて保持したentryは`portable-unresolved-reference`かつ`evidenceOrigin: "portable-never-active"`に限定する。portable fileから未解決entryを取り込む場合は、新しいローカル`dormantEntryId`を発行して`retainedEntries`へ置き、外部refをruntime必須ID欄へ代入しない。map全体の現在authorityは`MapSplitBinding.mapStructureFingerprint`だけとし、active entryはblock／location evidenceだけを持つ。保持entryの旧map fingerprintは診断・preview用であり、自動再接続のauthorityにしない。地図の無関係なblock変更ではmap-level fingerprintと該当map bindingを更新する一方、block／location evidenceが一致する他entryはactiveのまま維持する。

`RetainedNumberIdentity`で`number`と`originalNumberToken`を両方持つ場合、I0のexact番号parserでtokenが`split-side | whole | unsupported`のいずれかへ解決し、その`baseNumber`が`number`と一致することをsemantic invariantにする。先頭ゼロやsuffixの原文は一致時だけ保持できる。不一致またはtokenがunresolvedなのに`number`もあるruntime entryは、`evidenceOrigin: "last-active"`なら`invalid-value`としてquarantinedにして再関連付け候補へ使わない。`portable-never-active`にはlast-active evidenceを捏造してquarantinedへ変換せず、root-untrusted安全モードとBackup復旧案内にする。V2入力はどちらもDB更新前にfile全体を拒否する。`originalNumberToken`だけのentryは未解決のまま保持し、数値を推測しない。

端末全体とevent別ON／OFFはsettings payloadから分離し、同じcapability storeのキー`control`に`MapCellSplitControlRoot`として保存する。`enabledEventInstanceIds`は重複なしで上記canonical比較順とし、未掲載eventはOFFとする。event削除時は同じcommitでIDを除去する。Backup V1／V2へ含めない。`SplitImplementationReadiness`はbuild sourceに固定する静的gateであり、永続化、外部service、利用者設定から変更できない。I11最終release candidate PRだけがsource固定値をbuild前に`release-ready`へ変更し、その同一production artifactで全Exitを検証する。gate成功までは配布不能で、verifierがreadinessを実行後に書き換えることも、検証済みsourceから別artifactを作り直すことも禁止する。QA buildだけが明示的なtest overrideを持て、production bundleにoverride command、query parameter、storage keyを含めない。

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

経路の論理単位は商品や行・列ではなく共有projectionが返す`PhaseVisitIdentity`とする。

```ts
type ExecutionVisitIdentityKey = string & {
  readonly __brand: "ExecutionVisitIdentityKey";
};
type PhaseVisitIdentityKey = string & {
  readonly __brand: "PhaseVisitIdentityKey";
};
type LocationKey = string & { readonly __brand: "LocationKey" };
type MarkerStackKey = string & { readonly __brand: "MarkerStackKey" };
type VisitPhase = "normal" | "postponed" | "late";
type AdditionalVisitPhase = Exclude<VisitPhase, "normal">;
type VisitPriorityLevel = "none" | "priority" | "highest";
type GridCellAddress = {
  row: number;
  col: number;
  readonly __brand: "GridCellAddress1BasedInteger";
};
type SubcellPathNode = {
  subRow: number;
  subCol: number;
  readonly __brand: "SubcellPathNode0BasedInteger";
};
type MapPoint = {
  x: number;
  y: number;
  readonly __brand: "MapPoint0BasedContinuous";
};
interface RoutingPort {
  node: SubcellPathNode;
  point: MapPoint;
}

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

interface DurablePhaseAnchorV1 {
  phase: VisitPhase;
  anchorItemId: string | null;
}

interface DurableVisitStateInputV1 {
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
}

interface RuntimeVisitTransitionInputV1 {
  lastPurchaseChangeAt: { phase: VisitPhase; anchorItemId: string } | null;
}

interface VisitIdentityInputSnapshot {
  inputRevision: VisitIdentityInputRevision;
  rootRevisions: readonly ProjectionInputRootRevisionV1[];
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
  durableVisitState: Readonly<DurableVisitStateInputV1>;
  runtimeVisitTransition: Readonly<RuntimeVisitTransitionInputV1>;
  mapAssociations: readonly MapAssociationIdentityInputV1[];
  hallDefinitions: readonly HallDefinitionIdentityInputV1[];
  hallAssociations: readonly HallAssociationIdentityInputV1[];
  hallRemaps: readonly HallRemapIdentityInputV1[];
  splitSettings: Readonly<MapCellSplitSettingsIdentityInputV1>;
}

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
      reason: "no-routing-port" | "path-not-found" | "unsafe-connector";
    };
```

`markerStackKey`は浮動小数文字列の丸めではなく、map／block instance ID、基準番号、物理anchor種別を含むversion付きtupleから生成する。描画markerだけを同じ`markerStackKey`でまとめ、`PhaseVisitIdentity`、経路順、進行状態、hit-test候補を統合しない。route segment、hit-test、挿入anchorの参照は必ずphase visit IDとし、代表item IDや行・列だけへ戻さない。`memberItemIds`は表示・状態変更用payloadであってidentityではないため、先頭memberの削除後もmemberが残る限り同じvisit ID、座標、順序へ再解決する。

`PhaseVisitProjectionRevision`はwall clockや配列object identityではなく、app層が同一read snapshotから作る`ProjectionInputRevisionVectorV1`の`esp-json-v1` canonical SHA-256とする。vectorはitem payload／実行順／durable visit state、event metadata、map association、hall definition／association／remap、split settingsについて、`ExpectedRootVector` subsetの`(storeName, key, payloadDigest descriptor, metadataRevision, checkpointDigest)`をcanonical順で持ち、未commit after-imageを投影する場合はそのcanonical digestも持つ。`payloadDigest`は現行`PersistenceDigestDescriptor`と同じalgorithm／canonicalization／valueの3 fieldだけを投影し、別型`PersistenceSynchronousFingerprint`の`canonicalLength`を混入させない。valueはlowercase 64桁hexとする。checkpointはnullだけを`absent`、validated checkpoint全体（kind／version／storeName／key／committedRoot／absorbedCandidates／updatedAt）のcanonical SHA-256を`present`へ写す。存在しない`checkpointRevision`文字列や`committedRoot.revision`だけへ縮退せず、同じcommitted rootでも`absorbedCandidates`／`updatedAt`だけが異なるfixtureでrevision差を必須にする。pure `toProjectionInputRootRevisionV1`はobserved rootとcheckpointが同じread boundaryの場合だけ受理する。consumerはsnapshotとrevisionを一体で受け、UI callbackはvisit IDだけを返す。shellは最新snapshotでvisit IDを再解決し、revisionが変わってvisitが消えた場合はmutationを呼ばず常設statusへ通知する。保存commandは最新`ExpectedRootVector`を再検査し、stale projectionをwrite authorityにしない。I0でabsent／present、checkpoint field単独差、root順shuffle、不正descriptorのgoldenを固定し、I1でbuilder／schema／runtime exact一致、I7で同revision同値・1 root差・callback中rekeyのstale testを固定する。

`VisitIdentityInputRevision`は`rootRevisions`とitems／実行順／durable state／runtime transition／association／hall／split after-imageのcanonical digestから導出し、全fieldが同じread boundaryに属する場合だけbuilderが受理する。snapshotはexact 1組の`(eventInstanceId, normalizedDayKey)`をscopeとし、各itemのevent／day fieldは別authorityではなくscope一致を検証するwitnessである。item IDは重複なしで、`items`、`executionOrderItemIds`、`additionalPhaseByItemId`のkey集合をexact一致させる。normal所属は全execution itemへ暗黙に1件、追加phaseの唯一のauthorityはitem ID昇順のtotal tuple配列`additionalPhaseByItemId`とし、各valueは`null | postponed | late`の1値だけなので同じitemのpostponed＋late同時所属を表現不能にする。`executionVisitOrder`は投影前の全`ExecutionVisitIdentityKey`と重複なしのexact bijectionで、配列indexを唯一のdense orderとする。`current`はanchorがnullでもphaseを必須保持し、non-null anchorは指定phaseに実在するitemだけを許す。runtime-only `lastPurchaseChangeAt`はnullまたは指定phaseに実在するnon-null anchor、`savedAnchorItemIdByPhase`はnormal／postponed／lateの明示3 fieldで、non-null itemがそのphaseに属することを必須にする。`isCompleted`はboolean以外を許さない。`MapAssociationIdentityInputV1`、`HallDefinitionIdentityInputV1`、`HallAssociationIdentityInputV1`、`HallRemapIdentityInputV1`、`MapCellSplitSettingsIdentityInputV1`はI1が公開するpure readonly DTOで、runtime component／persistence objectをimportしない。root revision重複・欠落・非canonical順、`cross-event-item`、`cross-day-item`、`duplicate-item-id`、`execution-order-item-set-mismatch`、`durable-phase-item-set-mismatch`、`execution-visit-order-set-mismatch`、`duplicate-execution-visit-order`、`unknown-phase-anchor-item`、`anchor-item-not-in-phase`、参照不能hall／mapをbuilder入口でtyped errorにし、snapshot混在やphaseを推測補正しない。

`ProjectedVisitResolutionSummary`はopaque `LocationKey`を再parseせず`ItemSpaceResolution`からprojection時に作る。mappedは一意なmap authorityを解決済みの場合だけ成立して`canJumpToMap: true`、他3 kindはreason型と`canJumpToMap: false`を判別可能unionで固定する。pure `toProjectedVisitListRows(snapshot, formatter)`は各visitのsummaryとphase／priority／memberだけからrowを作り、formatterはreason codeをlocalized `statusText`へ変換する。ambiguous候補、missing manual hall、maplessを文字で区別し、不正なkind／reason／jump組合せをcompile-time negative fixtureで拒否する。

集約後の`ProjectedVisitResolutionSummary`は代表memberや元itemのraw fieldから選ばず、canonical `SpaceIdentity`と同じ`VisitIdentityInputRevision`のresolver結果だけから導出する。同じ`ExecutionVisitIdentity`へ属する全memberはbyte-identicalなsummaryを生成しなければならず、1件でも異なる場合はbuilder全体をtyped `inconsistent-resolution-summary`で拒否してprojectionを返さず、mutationはwrite 0件、UIは常設statusへ理由を表示する。member順shuffle、先頭member削除、destination統合でもsummaryが不変であるproperty testをI1で固定し、I7 Exitで実data adapterに対して再実行する。

`PhaseVisitProjectionSnapshot`は、`visits`の`visitId`が重複なし、`order`が配列indexと一致する`0..n-1`、各`memberItemIds`がnonempty・重複なし・raw実行順、`byVisitId`が`visits`とのexact bijection、`phaseVisitIdsByItemId`のkey集合が全member item IDのexact集合で、各valueが`visits`を順に走査して当該itemを含むvisit IDを得た重複なし配列とする。存在しないvisit／item、余分・欠落index、別object内容、非canonical順をbuilderのunit／property testで拒否する。I1はinvariant contract、I7 Exitは最大800投影とrekey／member削除after-imageで同じinvariantを実行し、consumerは独自indexを作らない。

`SubcellPathNode`は新しい公開route DTOであり、現行`src/types/map.ts`のA\*探索用`PathNode`とは別型である。I10で既存型を`AStarSearchNode`へ改名してpathfinding module内部へ閉じ、`findPath`、現行`RouteSegment`、`MapRoutePoint`、`mapViewRouteCalculations`、`mapRouteHitTest`、`focusRouteCalculation`、route cache signatureを同じmigration PRで`SubcellPathNode`／`SplitRouteSegment`へ接続する。I10までは現行route modelを独立維持し、未定義のroute型やproduction compat変換を追加しない。I10の同一PRで全callerを新型へ直接置換し、逆変換、row／colの小数pathを新APIへ渡すこと、両`PathNode`名の同時export、旧`RouteSegment`のproduction caller残存をarchitecture testで拒否する。

現行`MapVisitListPanel`が所有するのはopen／closeと行button描画であり、projection内製、row／col callbackをI8で除去する。同component名をopen／close、選択event、filter、virtualized list状態、focus restoreを所有するshellへ拡張し、pureな`ProjectedVisitList`を内包する。`ProjectedVisitList`は上記propsだけを受け、選択時は`PhaseVisitIdentityKey`だけを返す。shell／callerは最新projectionからlocationを再解決し、staleなrow／col、代表item ID、重複した`LocationKey` payloadをcallback authorityにしない。

共有projectionは各`ExecutionVisitIdentity`にnormalを必ず1件作り、postponed／lateは該当memberが1件以上ある場合だけ追加する。出力のglobal順はphase-majorのnormal→postponed→late、各phase内は`executionVisitOrder`の配列順とし、重複、欠落、余分keyをsort tie-breakで救済せず入力不正として拒否する。1 itemは追加phaseを高々1個しか増やさないため、3.13の400 item／400 execution visit fixtureでは全phase合計最大800、各phase最大400となる。異なるmemberにより同じexecution identityへpostponedとlateの両方が生じることは許すが、1 itemを両方へ二重投影しない。rekey先identityが既存ならそのorderを維持してmember末尾へ移す。新identityで変更元にmemberが残る場合は変更元直後、変更元が空になる場合は変更元slotを継承し、同じanchorへ複数destinationが生じる場合はbefore snapshotの最小source order、次にcanonical execution key順で並べ、変更元以外の相対順を保ったまま全体をdense配列へ再構成する。利用者が明示した挿入anchorはdestination identityが未存在の場合だけその直後へ適用し、既存destinationでは無視して統合通知する。

## 6. 保存と旧版互換

### 6.1 IndexedDBと`Vcap`／supported上限の事前判定

初期案は`DB_VERSION`を5から6へ上げ、`mapCellSplitSettings` object storeを追加する。ただし、現行契約はDB5を現行、DB7を前方互換上限としており、DB7の実利用profileが存在しないことは証明されていない。DB7ではversion 6の`onupgradeneeded`が走らないため、新storeを無条件の必須storeにすると起動不能になる。

FSMC-I0ではproduction起動経路を変えず、DB capability decision table、fixture、pure preflight harnessを実装する。I2で同じcontractをintegration harnessとnon-promotable QA database namespaceへ接続し、I2～I10のproductionはDB5のままopen／create write 0件を検証する。I11 release-ready candidateでだけproduction起動preflightと`DB_VERSION=Vcap`を同時に有効化する。

- DBなし、現行core DB version、`Vcap - 1`、`Vcap`から`supportedMaximumVersion`までの各整数versionについて互換storeあり・欠落・非互換、`supportedMaximumVersion + 1`のfixtureを重複排除して自動テストする。現行の5／6／7／8 fixtureは同じparameterized generatorから生成する
- 新版の起動preflightは現在の端末内でDB versionとstore capabilityだけを判定し、結果やpayloadを外部収集しない
- capability判定結果は現在sessionの診断表示に使用できるが、外部送信、運用receipt、利用者追跡へ使用しない
- I0はまず候補versionの排他性と配布provenanceを証明して`Vcap`を固定する。`config/fsmc-db-version-provenance.json`はauthoritative release／artifact ledgerのhash、completeness boundary、source SHA、DB名、DB version、object-store schema fingerprint、data class、`distributed | verified-never-distributed | unknown`、evidence IDをexactに持つ。少なくともcommit `81795770cca30c68bb1526f989dcd7ab0af1edb4`の同名DB6／`memberRouteItems`を必須conflict fixtureとし、branch名やtag欠落を未配布の証拠にしない。distributedまたはunknown conflictが1件でもあれば候補versionを採択せず、代替ADRがversion、supported上限、decision table、fixture、runbookを一括更新するまでI0 ExitとI2を閉じる
- verifierが採択した`Vcap`について、split対象の導入traceが外部precheckとversionchange transaction内再検証の両方で0件の場合に限り、既存profileの`onupgradeneeded`は新store、`data`／`control`／`event-settings`／`event-settings-bridge`のfactory payload、全非fence governed rootのtotal historical evidence、その全行digest、実write集合とexact一致するparticipant digest、全governed rootのexternal baselineを持つinitial fence、全5 capability rootのmetadata／checkpointを原子的に作成する。新規DBの0→`Vcap`も同じinstrumented bootstrap factoryを使う
- DBなし、または`dbVersion < Vcap`で新storeもsplit recovery traceもないprofileは未導入の`core-only`として従来機能を継続する。採択されたversion未満だけがこの分岐である
- `Vcap <= dbVersion`かつschema互換な新storeが存在する場合は、supported上限内でDB versionを変更せず通常経路を使用する
- `Vcap <= dbVersion`なのに新storeが欠落する場合は、DB version自体をdurable introduction witnessとして、split用metadata、checkpoint、fallback candidate、metadata anchorが一切なくても部分欠損の自動安全モードとBackup復旧案内へ進む。未導入profileとみなして空storeを再作成しない。store shape・root schemaが非互換な場合も同じ安全境界にする
- 採択された`Vcap`以上かつsupported上限以下を上記2分岐、上限超過をデータ変更なしのunsupportedとして拒否する。候補を承認できない場合はI2を停止し、別ADRで新しい一方向導入証跡とsupported上限を決めてからこの表・fixture・復旧手順を一括更新する

新storeの初期契約:

- `keyPath`: なし
- `autoIncrement`: false
- payloadレコードキー: `data`（空のassociation／event配列を持つ`MapCellSplitSettingsRoot`）、`control`（device OFF、enabled event ID 0件の`MapCellSplitControlRoot`）、`event-settings`（canonical `EventSettingsRootV1`）、`event-settings-bridge`（常在する`EventSettingsBridgeRootV1`）。内部key `FSMC_EXTERNAL_CANDIDATE_FENCE_KEY`にはbootstrap時の候補vector付きtotal historical evidence、その全行digest、`committedParticipantRoots`、同集合のdigest、root別external digestを持つinitial fenceを保存する。5 keyと各metadata／checkpointはstore作成と同じversionchange transactionで必ず初期化し、bridge／fenceをBackup payloadへ含めない
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

type FsmcPersistenceSnapshot =
  | {
      capability: "core-only";
      dbVersion: number | null;
      core: CorePersistenceSnapshot;
      split?: never;
      control?: never;
      eventSettings?: never;
      eventSettingsBridge?: never;
      expectedRoots?: never;
    }
  | {
      capability: "map-cell-split-recovery-required";
      dbVersion: number | null;
      core: CorePersistenceSnapshot;
      introductionWitnesses: NonEmptySplitIntroductionWitnesses;
      reasons: NonEmptySplitCapabilityPartialLossReasons;
      diagnosticMode: "read-only";
      untrustedSplitRoots: "not-adopted";
      backupGuidanceRequired: true;
      split?: never;
      control?: never;
      eventSettings?: never;
      eventSettingsBridge?: never;
      expectedRoots?: never;
    }
  | {
      capability: "map-cell-split-v1";
      dbVersion: number;
      introductionWitness: { kind: "db-version"; observedVersion: number };
      core: CorePersistenceSnapshot;
      split: MapCellSplitSettingsRoot;
      control: MapCellSplitControlRoot;
      eventSettings: EventSettingsRootV1;
      eventSettingsBridge: EventSettingsBridgeRootV1;
      expectedRoots: ExpectedRootVector;
    };

const FSMC_SUPPORTED_MAXIMUM_DB_VERSION = 7 as const;

type FsmcDatabaseOpenResult =
  | { kind: "snapshot"; snapshot: FsmcPersistenceSnapshot }
  | {
      kind: "unsupported-database-version";
      observedVersion: number;
      supportedMaximumVersion: typeof FSMC_SUPPORTED_MAXIMUM_DB_VERSION;
      diagnosticMode: "read-only";
      databaseWritesAllowed: false;
      databaseAuthorityAdopted: false;
      backupGuidanceRequired: true;
    };
```

`NonEmptySplitCapabilityPartialLossReasons`はI0 enum順の重複なしnonempty配列とし、同じreasonの重複、順序違い、reasonとwitness許可対応の不一致をschema／semantic verifierで拒否する。reason集合は表示順だけでなくrecovery decisionのcanonical入力であり、先頭reasonだけを代表として選ばない。

`ObservedRevisionRoot`は現行`persistenceCore.ts`のexact field、すなわち`storeName`、`key`、`revision`、`baseRevision`、`payloadDigest`、`payloadFingerprint`、`writerId`、`committedAt`、optionalな`synthetic`、`missing`、`runtimeFallback`を失わず保持する。`PersistenceCheckpoint`もkind／version、storeName／key、committedRoot、absorbedCandidates、updatedAtを含む構造全体を保持し、固定旧版Aが書かないfieldを`absorbedCandidates`へ追加しない。`FsmcRecoveryCandidateIdentity`は現行`StartupRecoveryCandidateIdentity`の`source`、`role`、optional storeName／sourceKey／targetKey／revision／digest／digestAlgorithm／digestCanonicalization／digestCanonicalLength／migrationConflictをexactに保持し、payloadと`rawValue`本体はdurable CAS vectorへ複製しない。代わりにpre-transaction collectorは物理recordを必ず読み、IndexedDBはI0固定のlossless／injectiveな`fsmc-idb-candidate-record-v1` canonical bytes全体、localStorageは`getItem(storageKey)`が返すraw DOMStringのUTF-16 code unit列全体から、長さとSHA-256を持つauthority対応`physicalContentWitness`をtransaction外で生成し、そのcommand attempt中だけ比較用canonical bytes／raw stringをmemoryへ保持する。localStorageのdigest入力はASCII `fsmc-local-storage-raw-utf16-code-units-v1`＋NUL、big-endian uint64のcode unit数、各code unitのbig-endian uint16をこの順に連結したbytesとし、lone surrogateをU+FFFDへ置換しないlossless／injective形式へ固定する。canonicalizerが未対応値を同じbytesへ畳み込むことを禁止し、対応subset外、証明不能、読込不能、authorityとwitness kind不一致はrecovery-requiredとする。既存identity digestが物理内容全体を拘束するとfixtureで証明できるsourceも必須witness fieldへ同じ検証済み値を投影する。各candidate recordから既存`PersistenceCheckpointAbsorbedCandidate`と共通の6 fieldだけを`CandidateAbsorptionMatchProjectionV1`として導出できない場合はnullにし、吸収済み消滅の根拠へ使わない。CASはobserved root、checkpoint、candidate identity、物理location、物理内容witness、absorption match projectionをversion付きcanonical形式で比較し、revisionだけ、checkpointの文字列化だけ、candidateの件数だけ、物理recordを読まない比較へ縮退しない。

candidateのauthority classは`source`名ではなく、I0で全生成・読込箇所を列挙する`config/fsmc-recovery-candidate-locations.json`とpure `collectRecoveryCandidateObservationsForRoot(storeName, key)`が返す物理locationだけで決める。inventoryはroot tupleごとに、現在候補の有無とは独立した全potential IndexedDB store／record selectorと全external key selectorを列挙する。現行の`source: "indexedDB"`に加え、`syncQueue`の`LEGACY_MIGRATION_JOURNAL_KEY`、`LEGACY_MIGRATION_ARCHIVE_KEY_PREFIX`、recovery adoption／retention recordから導く`source: "migration-journal"`は、exactな`recordKey`を持つ`indexeddb-transactional`である。`legacy-localStorage`と、現行`readRuntimeCandidateSnapshots`が`localStorage`から読む`runtime-fallback`だけを、exactな`storageKey`を持つ`external-fenced`とする。同じ`source`でも物理locationとinventoryが一致しないcandidate、未知媒体、memoryにしか残らず元recordへ再解決できないcandidateは分類を推測せずrecovery-requiredとし、通常commandへ参加させない。

rootごとの観測は上記collectorの全出力とし、そのrootを変更し得るunscoped candidateは該当する各rootへ同じidentity／physical location／physical content witness／absorption match projectionのまま含める。root／authority class内の重複は拒否するが、別rootへの決定的な重複帰属を省略しない。`indexedDbTransactional`配列は`authority: "indexeddb-transactional"`＋`kind: "indexeddb-canonical-record"`だけ、`external`配列は`authority: "external-fenced"`＋`kind: "local-storage-raw-utf16-code-units"`だけを型とJSON Schemaの両方で許可し、逆配列への混入、unionへの型拡張、inventoryと異なる媒体／witnessを拒否する。前者の全`storeName`はcommand transaction scope、後者の全`storageKey`はexternal inventoryとexact一致させ、両authority配列の交差混入をnegative compile-time fixtureとschema fixtureで検出する。全physical content witnessのSHA-256 `digest`はlowercase 64桁hex、IDB witnessの`digestCanonicalLength`は正のsafe integer、external witnessの`codeUnitLength`は0を許す非負safe integerとし、それぞれinventoryで固定したhard limit以下をJSON Schemaとsemantic verifierで強制する。`externalDigest`はphysical content witnessを含むexternal全entryのcanonical JSON UTF-8 SHA-256であり、空vectorにも固定digestを持つ。同じstorage key／identity／locationのままrawValueが1 code unitでも変わる場合はlone surrogate同士の差を含めdigestが必ず変わる。`objectStoreSchemaFingerprint`はkeyPath、autoIncrement、index名／keyPath／unique／multiEntryをcanonical順でhashする。正常`map-cell-split-v1`は`introductionWitness.observedVersion === dbVersion`かつ両方`>= Vcap`、recovery-requiredで`dbVersion`がnon-nullの`db-version` witnessも`observedVersion === dbVersion`かつ`>= Vcap`をschema／semantic invariantにし、同snapshot内の`db-version` witness重複を拒否する。`dbVersion < Vcap`でstoreだけ、`data`／`control` payloadだけ、fenceだけが存在しても、それぞれ`capability-store`、`required-payload-root`、`external-candidate-fence` witnessによりnonempty recovery-required分岐を構築する。

`db-version` witnessはさらに必要十分条件へ固定する。supported range内のrecovery-requiredでは`dbVersion !== null && dbVersion >= Vcap`の場合に限りexact 1件を必須とし`observedVersion === dbVersion`、`dbVersion === null || dbVersion < Vcap`なら0件とする。正常snapshotは単一witnessと`Vcap <= dbVersion <= supportedMaximumVersion`、`core-only`は`dbVersion === null || dbVersion < Vcap`だけを許す。phantom witness、必須witness欠落、重複、値ずれをJSON Schema／semantic verifierのnegative fixtureで拒否する。`dbVersion > supportedMaximumVersion`は`FsmcPersistenceSnapshot`を構築せず`FsmcDatabaseOpenResult.kind = "unsupported-database-version"`としてconnectionを閉じ、core／split authorityを採用せずwrite 0件で専用案内へ送る。

`recovery-trace` witnessはcapability storeの`data`／`control`／`event-settings`／`event-settings-bridge`／fence rootだけへ閉じる。metadata／checkpointの`recordKey`は`createPersistenceMetadataKey("mapCellSplitSettings", rootKey)`または`createPersistenceCheckpointKey(...)`の戻り値とexact一致し、candidateは同じtarget tupleへI0 inventoryで一意帰属する場合だけ許可する。通常core storeのmetadata、checkpoint、candidateはsplit導入witnessではなく、split traceがない健全なpre-`Vcap` profileはそれらが存在しても`core-only`である。任意store／key、表示上の`source`、候補件数だけからsplit導入を推測しない。

root vectorは`(storeName, key)`で安定sortし、同じtupleの重複、command参加rootの欠落、vector外rootへの書込み、observed rootとcheckpointのstoreName／key不一致を拒否する。各authority classはidentity全field、physical location、physical content witness、absorption match projectionのcanonical JSONで安定sortし、同一entry重複を拒否し、optional fieldの欠落と明示値を区別する。各参加rootについてlocation inventoryが列挙する全potential IndexedDB storeの和集合を、snapshot時のcandidateが0件のstoreも含めてcommandの同じreadwrite transaction scopeへ加える。最初のwriteをqueueする前に同transaction上のIDB requestで全selectorを再読込し、結果を同期canonical encodeしてpre-transactionの一時bytesとbyte-exact比較する。transaction内でWebCrypto SHA-256や別async taskをawaitせず、empty→insertを含む追加、消滅、identity／location／content／projection変更が1件でもあれば全CASをabortする。一致時はtransaction外で計算済みのdurable witnessを再利用する。別`openDB()`、別readonly transaction、`readInternalControlRecord`をtransaction内からawaitしてはならない。`mapData`は物理event／day recordが複数でも現行の論理aggregate root `(mapData, "data")`とpayload fingerprintで全体を拘束する。capability storeの4 payload rootは別々のroot tupleであり、command manifestが列挙するactual after-image write集合だけをparticipantとする。通常split writerは`data`／`control`、event lifecycle／settings／restore writerはさらに`event-settings`／`event-settings-bridge`を参加させ、余分なbyte同値writeでparticipantを水増ししない。

IndexedDB transactionでロックできないexternal candidateには、存在しない原子CASを主張せず次のfence protocolを使う。I0のcommand participant manifestの和集合とcapabilityの4 payload root＋fenceから、canonicalで重複のない全root universe `FSMC_GOVERNED_ROOTS_V1`を`config/fsmc-governed-roots.json`へ固定する。同configは各tupleを`capability-owned | legacy-mutable-core | legacy-shadow-bridged | fence`へexact分類し、`data`／`control`／`event-settings-bridge`はcapability-owned、canonical `event-settings`はIDB差を許さず対応localStorage shadow差だけを専用reconcileへ送るlegacy-shadow-bridged、固定旧版Aが書けるcore rootはlegacy-mutable-core、fence自身はfence policyとする。未知policy、未分類root、同一tupleの複数policyを拒否し、config SHA-256をfenceへ保存する。

transaction instrumentationは物理`put`件数をparticipant集合へ直接流用せず、`logicalRootMutationTuples`と`administrativeFencePhysicalWrites`を別々に記録する。前者はfence以外についてpayload、metadata、checkpoint、candidateの作成・更新・削除を所有する論理`(storeName, key)`へ正規化した重複なし集合であり、本節の`actual write tuple`／`actualCapabilityWrites`はこの集合だけを意味する。後者は自己参照を避けるためparticipant／historical rowから除外するfence payloadとfence所有metadata／checkpointの物理write集合で、`config/fsmc-fence-write-manifest.json`のcommand種別ごとのexact集合と一致しなければtransactionをabortする。通常commandとbootstrapは必要なfence administrative writeをexact 1 set行う一方、fence tupleを`committedParticipantRoots`、participant digest、historical rowへ入れない。logical rootのbyte同値payload `put`だけでparticipantを水増しすることは禁止し、full `ExpectedStoreRoot`のafter-imageを進めるpayload／metadata／checkpoint／candidate transitionがあるrootだけを含める。bridge ackだけはexternal shadow変更をcanonical rootのhistorical evidenceへ結び直すため、`event-settings` payloadをbyte同値に保ったままrevision、metadata、checkpointを専用ack transitionとして進める。このexact after-imageと`event-settings-bridge`のpending→syncedを同じtransactionで書く場合に限り両rootを`logicalRootMutationTuples`へ含め、任意commandが同じ手法でpaddingすることを禁止する。

`FSMC_EXTERNAL_CANDIDATE_FENCE_KEY = "__esp_internal__:fsmc-external-candidate-fence:v1"`をcapability storeの内部recordとし、schemaVersion、`commitContext: { kind: "bootstrap"; profile: "existing-profile" | "fresh-profile" } | { kind: "command"; commandId: string }`、config SHA-256、canonical sort／uniqueな`committedParticipantRoots`、全非fence governed rootにexact 1件ずつ対応する`historicalRootEvidenceByRoot`、`historicalEvidenceDigest`、`committedParticipantDigest`、全governed rootにexact 1件ずつ対応する`externalBaselineByRoot`、writerId、committedAtを持たせ、fence自身も外側の`ExpectedRootVector`へ参加させる。historical evidence rowはcanonical `(storeName, key, observed root, checkpoint, ExpectedRecoveryCandidateObservation)`全体であり、payload digestのauthorityは`observed.payloadDigest`だけとする。候補はIDB／external双方のidentity全field、物理location、物理内容witness、absorption match projection、externalDigestをlosslessに保持する。全rowをroot tupleで安定sortしたUTF-8 SHA-256を`historicalEvidenceDigest`、`committedParticipantRoots`が指すrowだけを同じ規則でhashした値を`committedParticipantDigest`とする。readerはfenceに埋め込まれたhistorical rowから両digestを再計算して自己整合を検証し、live core rootから過去digestを再計算しない。fence自身をparticipant／historical rowへ含めず、全非fence rootで`historicalRootEvidenceByRoot[root].recoveryCandidates.externalDigest === externalBaselineByRoot[root]`を必須にし、fence rootだけはbaselineのみを持つ。自己参照hash、`logicalRootMutationTuples`とparticipant／digest集合の不一致、`administrativeFencePhysicalWrites`とfence write manifestの不一致、参加row／非参加historical rowの欠落・改変、未知・重複root、候補vector／物理location／content witness／projectionの欠落、historical／baseline external digest不一致、件数だけのdigestを拒否する。

通常FSMC commandは、同transactionで再読込したactual after-image write rootの候補vector付きhistorical rowだけをnew evidenceへ置換し、非参加rootのhistorical rowは前fenceからbyte同値で維持する。`committedParticipantRoots`、transaction instrumentationが記録した`logicalRootMutationTuples`、置換historical row集合、participant digest対象集合をexact一致させ、administrative fence writeは別manifestと照合する。全rowの`historicalEvidenceDigest`と参加rowの`committedParticipantDigest`を毎回再計算する。external baselineは毎commandで全governed rootを再観測して完全置換し、空vectorにも固定digestを保存する。E0→E1不変と前fenceのcross-invariantを検証したうえで、全非fence historical rowの`externalDigest`とnew baselineが一致する場合だけcommitする。historical／externalのどちらも、非参加rootを前回値ごと落とす疎な上書きを禁止する。通常FSMC commandはbridge protocol以外のexternal candidateを作成・変更・削除しない。

固定旧版Aは正常なcore rootを更新できるが、capability rootとfenceを更新できない。この正当な差を破損へ誤分類しないため、I0でpure `classifyLegacyCoreTransitionV1(previousFence, currentSnapshot)`と内部command `fsmc.internal.rebase-legacy-core.v1`を固定する。classifierは`unchanged | rebase-required | recovery-required`のexact unionを返し、次をすべて満たす場合だけ`rebase-required`にできる。

- fence schema、config SHA、埋込`historicalEvidenceDigest`と`committedParticipantDigest`、全非fence historical candidate `externalDigest`と同root baselineのcross-invariantが自己整合し、live capability payload rootとcapability-owned external baselineがhistorical evidence／fenceから変化していない。`event-settings-bridge.state !== "synced"`またはshadow witness差はgeneric classifierへ渡す前に専用bridge resume／reconcileで処理し、正常なpending shadow更新をcapability corruptionへ誤分類しない
- 差分tupleが`legacy-mutable-core`だけのnonempty集合であり、current coreのpayload digest／fingerprint、metadata、checkpoint、IDB candidate、external candidate lineageが既存core load契約でrootごとに完全整合する。I0は固定旧版Aの全candidate writer／cleanup pathから、root policy、authority、物理selector、old／new canonical record shape、必須root／checkpoint関係、許可する`created | absorbed | replaced`をwildcardなしで列挙した`config/fsmc-legacy-candidate-transitions.json`を作る。classifierはprevious historical rowのlossless candidate vectorとcurrent vectorの差を、同manifestのtransition instanceへ重複なく全件対応できる場合だけ説明済みとする。同じidentity／locationのまま`physicalContentWitness`または`absorptionMatchProjection`だけが変わるcaseを自動的な「旧entry消滅＋new追加」とみなさず、old／new canonical recordとroot／checkpoint transitionがexact 1件の`replaced`定義に一致する場合だけ許す。manifest外、0件・複数件一致、1 entry／descriptorの再利用はrecovery-requiredとする。`absorbed`はcurrent checkpointの各`absorbedCandidates` descriptorと旧entryのnon-null `absorptionMatchProjection`がexact一致し、そのdescriptorに一致する旧entryがroot内でちょうど1件の場合だけ、identity／locationを旧rowから一意に確定してroot payload transitionへの吸収とみなす。checkpoint自体がidentity／locationを持つとは仮定しない。同一projectionの旧entryが物理location違いで複数ある、0件、nullの場合はrecovery-requiredとする。`created`もinventory、digest、対象root、checkpointとの対応が一意な既存core recovery契約とmanifestのnew shapeに合う場合だけ許す。過去vectorを復元できない、吸収証跡がない、physical content witness／projectionだけの説明不能な変更、external差をprevious row＋inventory＋current logical root／checkpointのallowlist transitionで一意に説明できない場合もrecovery-requiredとする
- 現在のanchor、association、map／block binding、番号衝突をI0固定after-image validatorで再計算できる。完全一致entryはactiveを維持し、owner消失はdormant、曖昧・競合はquarantined、旧版編集で生じた`C(S) != ∅`はstored ONを変更せずevent単位effective fallbackにでき、別ownerへの自動接続とdurable state削除が0件である

capability-owned rootのlive差、fenceの自己不整合、core rootのpayload／metadata／checkpoint／candidate不整合、policy外root差、説明できないexternal差は`legacy-core-transition-unclassifiable`を含むrecovery-requiredとする。writerIdや`source`名だけで旧版writeと推測しない。逆に、healthyなlegacy-mutable core差そのものは`external-candidate-fence-inconsistent`にしない。

`fsmc.internal.rebase-legacy-core.v1`は利用者向けcollision repair allowlistとは別のI2所有maintenance commandであり、split mutationや番号修正の入口にしない。全legacy-mutable core store、inventoryが列挙するcandidate用の全potential物理IDB store、4 payload root、fenceを単一readwrite transactionでlockし、同transaction内でclassifier入力を再読込する。staleならwrite 0件で再判定する。一致時の`rebaseParticipantRoots`は、previous historical rowとcurrent rowのobserved root／checkpoint／candidate vectorのいずれかが異なる全legacy-mutable-core tupleと、そのafter-imageに実際に書くcapability rootの和集合、すなわち`sort(unique(changed legacy roots ∪ actualCapabilityWrites))`とする。通常coreだけのrebaseではstatus／associationを維持または更新する`data`とstored membershipを維持する`control`が`actualCapabilityWrites`のexact集合であり、event settings shadow reconcileを同時に行う場合だけ専用ack after-imageに従って`event-settings`／`event-settings-bridge`を加える。fence自身は含めない。historical rowの置換集合、transaction instrumentationの`logicalRootMutationTuples`、`committedParticipantRoots`、digest対象集合をexact一致させ、administrative fence writeは別manifestと照合し、その他の非参加rowは前fenceからbyte同値で維持する。`committedParticipantDigest`はこのexact集合だけ、`historicalEvidenceDigest`は全rowから再計算し、全external baselineも現在値へ完全置換したfenceを同じtransactionでcommitする。余分・欠落・重複、changed rowとの不一致はschema／runtimeで拒否する。

rebase自身もexternal candidateをlockできないため、通常commandと別名のvector `R0`／`R1`／`R2`で同じ安全境界を持つ。transaction開始前に全governed rootのexternal `R0`とraw stringを読み、全IDB rootをlock・同期byte比較した後、最初のwrite前にexternal `R1`を同期再読込して`R0`のraw stringとexact比較する。`R1 != R0`ならwrite 0件でtransactionをabortし、追加差もhealthy legacy-onlyなら最新snapshotからrebaseを再試行、capability-ownedまたは分類不能ならrecovery-requiredとする。`R1 = R0`かつclassifier再検証成功時だけ、transaction外で計算済みの`externalBaselineByRoot = digest(R1)`を持つnew fenceと必要なstatus変更をcommitする。`transaction.oncomplete`後・split再開前に`R2`を同期再読込し、`R2 = R1`なら完了、追加差がhealthy legacy-onlyなら確定済みrebaseをrollbackせず非durableな`legacy-rebase-pending`から次のrebaseを行い、それ以外は確定済みrootを維持してrecovery-requiredにする。rebaseはexternal candidateを変更・cleanupせず、IDB transaction内で非同期hashを待たない。

commit前終了・quota・abortでは固定旧版Aが既に確定したcurrent legacy core＋rebase前fenceを維持し、その組合せから導出する非durableな`legacy-rebase-pending`として次回境界で安全に再試行する。未保存rollbackや破損とは表示しない。splitはrebase完了までlegacy fallback／read-onlyとし、利用者commandのpreviewは完了後に最新rootから作り直す。

通常commandの境界protocolは次とする。

1. preview／command開始時にlive governed root、external vector `E0`、durable fenceを読み、fence自己整合とroot policyを検査する。差がlegacy-mutable coreだけなら先にclassifier／rebaseへ送り、capability-owned差または分類不能差ならwrite 0件のrecovery-requiredとする
2. command参加rootと、location inventoryが各rootへ列挙する全potential IndexedDB storeを、現在candidateが0件でも含めた単一readwrite transactionを開く。最初のwrite前に同transactionのIDB requestでroot／checkpoint／`indexedDbTransactional` selectorを再読込し、同期canonical bytesをpre-transaction bytesとexact比較してCASする。transaction内で非同期hashや別transactionを待たない
3. 同じ最初のwrite前境界で`localStorage`から全governed rootのexternal raw stringを`E1`として同期再読込し、`E0`のraw stringとexact比較する。`E1 != E0`がlegacy-mutable coreだけならwrite 0件の`legacy-rebase-required`、それ以外はwrite 0件のconflict／recovery-requiredとする。一致時だけtransaction外で計算済みのSHA-256 witness／digestを再利用する
4. IDB内candidateと全rootのCAS成功時だけ、new participant historical evidence、全rowのnew `historicalEvidenceDigest`、new `committedParticipantDigest`、`digest(E1)`の完全`externalBaselineByRoot`を持つfenceを同じtransactionでcommitする
5. `transaction.oncomplete`後かつUI成功通知前に全governed rootの`E2`を再観測する。`E2 = E1`なら成功とする。差がlegacy-mutable coreだけなら全new IDB rootを維持して`committed-legacy-rebase-required`とし、classifier／rebase完了まで成功UIを保留する。それ以外は全new IDB rootのまま`committed-recovery-required`としてsplitを即時read-only安全モードにし、Backup復旧案内を出す。いずれもrollback、旧状態表示、自動merge、未保存扱いをしない

commit後・post-check前の終了は、次回起動時にlive root／全external vectorとdurable fenceを比較し、差なしはcommitted stateを正常採用、legacy-mutable coreだけの説明可能な差はrebase、capability-ownedまたは分類不能な差はrecovery-requiredへ入る。別tabの`storage` event、`focus`／`visibilitychange`、split read／mutation前にも全rootを再比較し、分類完了前に新しいauthorityを自動採用しない。post-check後に起きた変更も次の通知または境界checkで検出する。Web Lockは旧版や外部storage writerを拘束できないため正当性の前提にせず、IDB原子commit、root policy、legacy rebase oracleを境界にする。

`Vcap`導入は、既存core preflightが正常で、I0 decision tableが「capability store／4 payload root／各metadata・checkpoint・candidate／fenceの導入traceなし」と判定した`dbVersion < Vcap`だけに許す。既存DBのopen request前に、全非fence governed rootのpayload、metadata、checkpointと、`config/fsmc-recovery-candidate-locations.json`が列挙する全potential IndexedDB store／record selector（現在0件のselectorと明示absenceを含む）を同一preflight snapshot `H0`として読み、lossless canonical bytesとtransaction外で計算した物理内容witnessをcommand attempt中だけ保持する。同じ境界で全governed rootのexternal raw DOMStringを`E0`として観測し、全capability rootのexternal vectorが導入契約どおりであることを要求する。legacy `blockDetectionSettings`はcandidate空を要求せず、event anchorへ一意変換できるE0 raw witnessとしてbootstrap planへ参加させる。

versionchange transactionはupgrade開始時点で存在する全storeと、新設するcapability storeをscopeにし、最初のwriteをqueueする前に次を順序固定で行う。まず`syncQueue`内journal／archiveを含むsplit対象IDB trace皆無を同transactionのrequestで再検証する。これはbootstrap source CASと別の判定であり、stableなcandidate-only／metadata-only／checkpoint-onlyを「変化なし」としてupgradeしてはならない。次に全非fence rootのpayload、metadata、checkpointと全potential candidate selectorを同transactionで`H1`として再読込し、同期lossless canonical encodeしたbytesを`H0`の値またはabsence sentinelとbyte-exact比較する。transaction内でWebCrypto、別transaction、別async taskをawaitせず、`H1 != H0`ならupgrade transaction全体をabortして旧DB version／旧store／旧dataを維持する。同じ最初のwrite前境界でexternal `E1`を同期再読込し、`E1`のraw DOMStringが`E0`とexact一致する場合だけ`H0`で計算済みのwitnessを`H1`へ再利用できる。`E1 != E0`も全abortとする。

既存DBのbootstrapは`H1 = H0`かつ`E1 = E0`の場合だけ実行する。initial historical evidenceは全非fence governed rootでtotalとし、legacy rowは`H1`、new capability rowは同じinstrumented factoryが実際に書くpost-bootstrap payload／metadata／checkpoint／candidate観測から一度だけ作る。fence root自身にはhistorical rowを作らずbaselineだけを持たせる。existing-profileの`committedParticipantRoots`はfactoryの`logicalRootMutationTuples = {data, control, event-settings, event-settings-bridge}`、fresh-profileはfactoryが作る`logicalRootMutationTuples = FSMC_GOVERNED_ROOTS_V1 - {fence}`とexact一致させる。両profileともlogical tuple、participant、置換row、digest対象の欠落・余分・重複、またはbootstrap用`administrativeFencePhysicalWrites`とfence write manifestの不一致でupgrade transactionをabortする。新store、empty split、初期OFF control、canonical event settings、syncedまたはpending bridge、合成post-state付きinitial fence、5 capability rootのmetadata／checkpointを同じversionchange transactionでcommitする。fresh profileではpre-open不在を旧snapshotに流用せず、factoryのexact値をroot writeとevidenceの両方へ供給する。`onsuccess`後はbridge pendingなら専用resumeを先に完了し、その後に全governed rootの`E2`を観測する。差なしは正常、healthy legacy差はrebase、それ以外は完全な新DBのまま`committed-recovery-required`とする。commit前終了は旧version／storeなし、commit後からopen success前は`Vcap`・全5 capability root完全初期化のどちらかだけを許す。

したがって`ExpectedStoreRoot`は正常snapshotで`present`だけを表す。`dbVersion < Vcap`かつ新store、4 payload root、fence、それらのmetadata／checkpoint／recovery candidate導入traceが全てない場合だけ`core-only`とする。通常core rootだけのtraceはこの判定へ混入させない。`dbVersion >= Vcap`でstore、4 payload root、fence、いずれかのmetadata／checkpointが欠ける状態、fence schema／config SHA／埋込historical全行digest／participant digest／actual write coverage／candidate vector／root coverageの自己不整合、capability-owned root差、未処理のbridge conflict、分類不能なlegacy core差、schema非互換、運用後に全recordだけが消えた空store、または`dbVersion < Vcap`でも導入traceのいずれかがある状態は`map-cell-split-recovery-required`とし、従来coreだけを継続してsplit／control／eventSettings rootをruntime authorityへ採用しない。bridge pendingは専用resume可能状態であり、それ自体をpartial lossへ畳まない。fence欠落は`external-candidate-fence-missing`、fence自己不整合またはcapability-owned差は`external-candidate-fence-inconsistent`、bridge第三値は`event-settings-bridge-conflict`、分類不能core差は`legacy-core-transition-unclassifiable`へ一意に対応させる。healthyなlegacy差はrebase前の一時preflight状態であり、recovery-required snapshotを構築しない。reasonとwitnessの許可対応、必須組合せ、I0 enum順、重複禁止をJSON Schemaへ固定する。通常のsplit export、空root／fence再作成、候補上書き、in-place V2 restoreは行わず、次の明示的な復旧runbookだけを提供する。

#### 6.1.1 `recovery-required`復旧runbook

復旧単位は現在origin内の現在browser profileにあるアプリDB全体とする。event単位の破損に見えても、欠落object storeやfence authorityを別eventの正常性から推測して部分修復しない。画面はorigin、DB名、`dbVersion`、canonical reasons、witness、影響root、読取可能なcore event一覧を表示し、端末外識別子やpayloadを送信しない。

1. I2の`fsmc.recovery.diagnose.v1`はwrite 0件でbounded診断JSONを生成する。untrusted split payload、利用者入力本文、URL、商品名は診断へ含めず、schema／canonical reasons／root存在・digest・件数だけを含める
2. core authorityが正常なeventにはI4の`fsmc.recovery.export-trusted-core.v1`を提供し、eventごとのV1 core、fileName、byteLength、SHA-256と全event checklistを生成する。untrusted split rootを収録せず、「分割設定はこの退避に含まれない」と表示する。core authorityも不正なeventはexport可能と偽らず、既存の外部backupを要求する
3. I2の`fsmc.recovery.reset-split-state.v1`は、`Vcap <= dbVersion <= supportedMaximumVersion`、capability storeとobject-store schemaが互換、全core rootがtrusted、split-owned IDB candidate／durable fallbackの全physical locationをinventoryからexact列挙可能、split-owned external candidate／durable fallback vectorがemptyであり、canonical `reasons`の全要素が`required-root-missing | required-root-schema-incompatible | external-candidate-fence-missing | external-candidate-fence-inconsistent | metadata-checkpoint-incomplete | recovery-authority-inconsistent`のallowlist内で、全reasonに対応する全不整合witnessがcapability-owned rootだけへ閉じる場合に限ってeligibleとする。1件でもallowlist外reason、scope外witness、不明な対応が混在すればeligibleにせず、先頭reasonで上書きしない。previewは失うactive／retained件数、全event OFF、再有効化手順、trusted-core V1または利用者が選択した既存V1／V2／XLSX 2.2の形式別検証結果とfile hash checklistを表示する。利用者がhash checklistと全split設定破棄を二段階確認した後、最新root、preview digest、全physical selectorを再検査し、capability-owned `data`／`control`／fenceとsplit対象metadata／checkpointだけをempty factoryへ置換し、列挙済みsplit-owned IDB candidate／durable fallback recordを同じtransactionで全削除して、正常なempty `map-cell-split-v1` after-imageとbaseline fenceを作る。core payload／metadata／checkpoint／candidateはtransaction前後でbyte同値とし、対象root tupleの拡張を禁止する。memory-only fallbackはcommit成功後だけ破棄する。取消、stale、quota、abortでは全root／candidate／fallbackを旧状態に維持する
   - 上記eligibleのroot closureはさらにexact化する。`event-settings`／`event-settings-bridge`のpayload、metadata、checkpoint、全candidateがtrustedかつ相互整合し、bridgeは`synced`、対応localStorage shadow witnessは一致していることを必須の非修復前提とする。`required-root-missing`／`required-root-schema-incompatible`／`metadata-checkpoint-incomplete`／`recovery-authority-inconsistent`をin-place resetで許せるwitnessは`data`または`control`へ閉じるものだけ、fence用reasonは`external-candidate-fence-missing | external-candidate-fence-inconsistent`だけとする。event-settings／bridge、legacy-mutable core、未知rootを指すwitnessが1件でもあればineligibleとし、profile全体coverageがverified-completeなguided reset以外の破壊操作へ進めない。in-place commitはtrustedなevent-settings／bridge payload・metadata・checkpoint・candidateとlocalStorage shadowをbyte同値で維持し、新fenceのtotal historical evidence／baselineへ同じ値を再拘束する。欠落・untrustedなevent-settings／bridgeをshadow、core、empty factoryから再構築しない
4. `FsmcDatabaseOpenResult.kind = "unsupported-database-version"`はsnapshot／core authorityを採用しないため、常に`unsupported-stop`とする。current buildからのDB delete、trusted-core export、restore、in-place／profile resetをすべて0件とし、connectionを閉じたまま対応versionのアプリ入手または既存の外部backup保全だけを案内する。新しいbuildで再診断する前に現在DBを変更しない
5. supported rangeの`map-cell-split-recovery-required`で、`dbVersion < Vcap`の`unexpected-introduction-trace`、store欠落・store schema非互換、`legacy-core-transition-unclassifiable`、core不正、candidate／fallbackのselector不明・external nonempty・scope外witness、または3の条件不足ではin-place resetを禁止する。guided profile resetのeligibilityはevent件数だけでなく削除対象全体のcoverage closureで判定する。runtimeでmain DBの`objectStoreNames`、storeごとのkey／record count・schema digest、対象originのapp-owned localStorage keyを列挙し、`config/fsmc-recovery-delete-targets.json`のknown target manifestとexact照合する。全known store／keyの各recordがtrusted-core export、選択V1／V2／XLSX 2.2、またはI0で復元まで証明したlossless opaque backup sectionのexact 1つに被覆される場合だけ削除可能とする。unknown store／key、manifest外schema、被覆0件／複数件、opaque bytesを同じkeyへlossless復元できない対象は、内容が空に見えても`unsupported-stop`、write 0件とし、既知core eventのbackupだけを根拠にDB全体を削除しない。V2はUTF-8 fatal decode、duplicate-property／schema、embedded digestと選択file SHA-256、standalone V1はschemaと選択file SHA-256、companion V1はV2記録hashとの一致、XLSX 2.2はZIP／version／workbook構造と選択file SHA-256を検証し、復元予定／復元不能store・key・eventとhash checklistを表示する。全対象が被覆され、現在originの全tab／Worker／DB connectionを閉じられ、形式別検証が成功した場合だけI5のguided profile resetを選べる。利用者の二段階確認後だけ列挙済みtargetを削除し、6で作るresume key／recovery control DBは完了まで明示除外して、data profileをdevice OFF・enabled event 0件で再作成する
6. in-place resetも、全core eventを被覆する検証済みtrusted-core exportまたは選択backup、recovery exclusive lock、最新eligibility再検査を実行前提とし、backup不足、別tab blocked、stale、条件不明では`unsupported-stop`、write 0件とする。profile resetはdeleteとrestoreを原子的と表示しない。破壊操作前に専用localStorage key `FSMC_RECOVERY_RESUME_KEY = "__esp_internal__:fsmc-recovery-resume:v1"`と専用IDB `FSMC_RECOVERY_CONTROL_DB = "event-shopping-planner-fsmc-recovery-control-v1"`を作り、どちらもguided resetの削除対象から除外する。通常root／candidate／Backup authorityには使わず、current recovery session以外のapp writeを許可しない
   - localStorage journalはexact stage unionとする。`prepared`はresume contract version、origin、app DB名、source build SHA、random session ID、action、選択backupごとのformat／byteLength／SHA-256、pre-delete inventory digest、target別pre-delete witness、delete-target manifest SHA-256、期待clean-profile digest、record self-digestを必須にする。stageは`prepared | delete-observed | clean-profile-created | restore-required | restore-plan-persisted | restored-awaiting-ack`で、後続stageは前stage fieldを維持し、`restore-plan-persisted`以降だけ`restorePlanRecordId`、`restorePlanDigest`、`expectedRestoreAfterImageDigest`を必須にする。payload、file path／name、URL、event名は禁止する
   - clean profileでbackupを同hash再選択した後、importerは新しいlocal UUID、全external-ref remap、writer ID、commit logical timestampを含む全非決定値を先に発行してcollision検査し、pure restore after-imageを作る。core payloadを複製せずremap表、backup hashes、期待clean digest、expected pre-commit root vector、canonical restore plan digest、期待restore after-image root digestを持つ`PreparedRecoveryRestorePlanV1`をcontrol DBへtransactionalに保存する。control record commit後にそのrecord digestを再読込検証し、localStorage journalを`restore-plan-persisted`へCASする。逆順、未保存remapでのrestore、commit中の時刻／ID再発行を禁止する
   - restore開始時はjournal、control record、再選択backup、clean profile rootを再読込し、保存済みremapを使ってplan／expected after-image digestを再計算する。4者が一致する場合だけ、そのexact planを通常I4 importerまたはlegacy full restoreの単一transactionへ渡す。main DB commit直後・journal更新前に終了しても、再起動時のactual root digestが`expectedRestoreAfterImageDigest`ならcommit済みとして`restored-awaiting-ack`へ進め、期待clean digestなら同planを再実行でき、どちらでもなければwrite 0件で停止する。control record保存後・journal CAS前の終了はsession IDでexact 1 orphan recordを照合してjournalへ採用し、0件／複数件／digest不一致なら採用しない
   - journal単独ではdelete／restoreを開始しない。local key削除途中では、各allowlist targetがpre-delete witnessとbyte一致またはabsentのどちらかだけで、DB削除済み、backup再検証、exclusive connection、再確認が揃う場合に限り残りtargetのidempotent `resume-delete`を許す。targetが未知値へ変化、allowlist外削除、未知stage、digest不一致ではwrite 0件で停止する。fresh profileにjournalがなければ通常clean-startとし、自動的に`recovery-resume-required`と推測しない。delete後・restore前はjournalとDB状態の照合後だけresume-requiredとする
   - `config/fsmc-recovery-resume-compatibility.json`はresume contract versionごとにreader build range、exact migrator ID、source／target schema、migration oracleを固定する。current buildが直接compatibleなら再開し、exact migratorがある場合はmain DB write 0件のままnew journal／control recordを作って全digest一致後に旧recordをsupersededにする。どちらもなければjournal／main DBを変更せず対応buildへ誘導する。journalを破棄できるのは、pre-delete DB完全一致でdelete前取消を二段階確認した場合、期待restore after-image一致で成功ackした場合、またはclean／deleted state＋全backup再検証後にcompatibleな新sessionへの引継ぎが完了した場合だけとする。完了時はlocalStorage journalとcontrol recordを削除し、control DBが空ならDB自体も削除する。origin全消去で両方を失った場合は`PD-18`どおり識別不能なclean-startである。V2は通常I4 importer、V1／XLSX 2.2はlegacy full restoreとして再取込し、別origin／別browser profileを自動選択・削除しない
7. I11は、in-place reset成功／stale／quota、別tab blocked、delete前終了、local key削除途中、control record commit直後、journal plan CAS直後、restore commit直後、V2再選択hash不一致、固定remap／plan／expected after-image不一致、compatible build／migratorあり・なし、V1／XLSX 2.2復元、backup不足、unsupported DB停止をDesktop／MobileでE2E化する。どの分岐もuntrusted split採用、自動merge、別origin削除、成功の虚偽表示を0件とする

`config/fsmc-recovery-actions.json`のdecision入力は軸の直積やsentinel付きobjectではなく、`{ kind: "unsupported-database-version", observedVersion, supportedMaximumVersion } | { kind: "supported-recovery", dbVersion, canonicalReasons, canonicalWitnesses, resetEligibility: "eligible" | "ineligible" | "indeterminate", backupCoverage: "verified" | "insufficient" | "invalid", destructiveCoverage: "verified-complete" | "incomplete" | "indeterminate", connectionState: "exclusive" | "blocked" | "unknown" }`のexact discriminated unionとする。`core-only`とhealthy `map-cell-split-v1`はaction matrix対象外である。unsupported分岐は他fieldを持たず常に`unsupported-stop`とし、current buildのwrite authorityを与えない。supported分岐の各statusは入力者の自己申告を信頼せず、canonical reason集合、全witness、DB version range、store schema、core trust、candidate／fallback authority、runtime target inventoryとcoverage closureからpure verifierが再導出する。全reasonが3のallowlist内かつ全条件成立の場合だけ`eligible`、1件でもallowlist外reasonまたは不適格witnessがあれば`ineligible`、収集不能・対応不明なら`indeterminate`とする。supported recovery＋eligible＋verified backup＋exclusive connectionだけは`in-place-reset`、ineligible＋verified backup＋verified-complete destructive coverage＋exclusive connectionだけは`guided-profile-reset`、その他はcanonical全reasonを表示する`unsupported-stop`とし、全reachable union valueをexact 1 actionへ対応付ける。coverage incomplete／indeterminate、unknown target、unsupported DBへの破壊action、条件弱化、reachable値欠落、複数actionをschema／semantic verifierで拒否する。

`resetEligibility`の再導出は6.1.1-3のroot closureを共通pure関数として使う。特にevent-settings／bridgeとそのmetadata／checkpoint／candidateがtrusted、bridge synced、shadow一致でなければ、reason文字列がallowlist内でも`eligible`にしない。in-place許容witnessはdata／control、fence専用reasonだけへ閉じ、event-settings／bridge、legacy-mutable core、unknown rootを指すwitnessは必ず`ineligible`または収集不能時`indeterminate`とする。action schema fixtureはevent-settings root欠落、bridge欠落／pending／conflict、shadow第三値、metadataだけ欠落の各caseがin-place action 0件であることを固定する。

破壊的coverageはbooleanや件数一致で表現せず、削除対象ごとの復元根拠を持つ次のexact artifactで証明する。

```ts
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

- 現行10-section `CorePersistenceSnapshot`と3分岐`FsmcPersistenceSnapshot`。runtimeの`AppData`へsplit sectionを二重追加しない
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

UIやfeatureコードからIndexedDBを直接呼ばず、既存の`PersistenceCommandPort`と単一コミット経路を通す。

`mapCellSplitSettings` rootは、他のアプリpayloadと同じtransaction、metadata、checkpoint、recovery candidateへ参加させる。mapDataと設定を同時に変更する操作は`commitMapAndSplitAtomically(expectedRoots, mutation)`、イベントanchorを含む操作は`commitEventLifecycleAndSplitAtomically(expectedRoots, mutation)`、イベント単位復元は`restoreSplitCapableEventSnapshotAtomically(expectedRoots, snapshot)`という専用Port commandを通す。参加storeごとのroot vectorをtransaction内で検証し、片方だけを確定するfallbackを設けない。

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
- 採択済み`Vcap`以上かつsupported上限以下のprofileで新storeなし・非互換ならpartial-loss安全モードで従来機能を起動でき、分割機能が利用不可である理由とBackup復旧案内を表示する。DBなし／pre-`Vcap`の未導入profileだけをcore-onlyとする

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
- capabilityが利用可能なbuildでは、通常split mutationとは別に`readSplitControl`、`previewSplitEnablement`、`enableSplitForEventAtomically`、`disableSplitForEventAtomically`、`setSplitDeviceEnabledAtomically`を常時登録する。OFF中でも端末switch、event有効化preview、OFF操作へ到達できる一方、セル分割設定・描画・経路等のmutation commandはgate通過時だけ利用できる
- event OFF→ON commandは最新のcore、settings、control、metadata、checkpoint、IDB内candidateを同じreadwrite transactionで再読込し、external candidateは6.1のpre／post観測とdurable fenceで拘束して、`C(after) = ∅`、anchor、association、map bindingを検証する。必要なempty-source metadata anchor、association、event settings、control entryを同じIDB commitで作成・更新し、commit前失敗なら全rollbackする。preview以後のIDB root変更はstaleとして再previewする。commit後のexternal差は、説明可能なlegacy-mutable coreだけなら`committed-legacy-rebase-required`、capability-ownedまたは分類不能なら`committed-recovery-required`とする
- `setSplitDeviceEnabledAtomically(true)`はevent有効化commandと区別し、latest rootで`enabledEventInstanceIds`の全eventを走査する。DB／root／association authority自体が不正ならdevice ONを拒否するが、個別eventの`C(S) != ∅`だけを理由にdevice ON全体を拒否しない。controlのdevice ONは原子的に確定し、衝突eventはstored enabled membershipを維持したままeffective legacy fallbackと修正案内、衝突0件のeventはeffective ONとする。`NormalizationCollisionRepairPort`のallowlist commandで`C(after) = ∅`になったeventだけ同じcommit後にeffective ONへ復帰し、他eventやsettingsを変更しない。device OFF中のlegacy編集で衝突を作るfixture、複数enabled eventの一部だけがfallbackになるfixtureをI0 oracleへ含める
- split commandは開始時とcommit直前にcontrol rootとDB capabilityを再検証し、途中でOFF、安全モード、staleへ変化した場合は全体をabortして中間状態を残さない。ON中のidentity変更は`PD-16`の衝突不変条件も同じtransactionで再検証する
- `C(S) != ∅`によるevent単位effective fallbackは、DB／root authority不正による自動安全モードとは別状態とする。通常のsplit definition／copy mutationは拒否するが、`PD-16`で定義した3 IDの`NormalizationCollisionRepairPort` commandだけを同じCAS・after-image検査下で許可し、利用者が衝突を解消できないdeadlockを作らない
- 自動安全モードをevent全体へ適用するのは、DB／store／root schema、settings-controlの対応、association registry root、recovery authorityを信頼できない場合に限る。一意に検証できるroot内の個別entryについてbinding、番号、物理領域が不正な場合はそのentryだけをdormant／quarantinedにし、安全な他entryやeventを停止しない
- `fsmc.internal.rebase-legacy-core.v1`は通常split mutationや利用者起点migrationではなくauthority保守である。capability／settings／control／fence authorityが正常でclassifierが`rebase-required`または導出可能な`legacy-rebase-pending`を返す場合だけ、device／event ONとreadinessに依存せずOFF中にも実行できる。stored enabled membershipとcoreを変更せず、完了までsplitをlegacy fallback／read-onlyにする。`map-cell-split-recovery-required`またはauthority不正の自動安全モードではrebaseを禁止し、read-only診断とBackup案内に限定する
- `PD-04`に従い、OFF／安全モードではsplit固有部分に旧版と同じlegacy resolver、whole-cell geometry、番号identity、UI、core保存commandを使用し、上記authority rebaseを除くsplit identity migrationや利用者操作による分割設定書込みを行わない。一方、I7 Exit後は`PD-14.C2`の共有訪問projection、既存訪問へのglobal統合、位置指定挿入規則を、I10 Exit後は`PD-14.C3`のroute／hit-test／cache接続を機能状態に依存しない修正として常時適用し、release-readyでは両方を`implementation-enforced`にする。I2～I6は基準source挙動のnon-regressionだけを許しC2／C3を前倒ししない。重複物理cellを新規作成するimport・通常編集after-imageの原子的拒否、既存重複の`map-data-untrusted`判定／map単位route停止は導入phaseから常時適用する。先頭ゼロ除去は機能ONかつ`PD-02` preflight通過時だけ適用する
- OFF／安全モードでもsplit storeとanchorを通常のdefinition／copy操作からread-onlyで保持する。authority正常な内部legacy rebaseは前項どおり制御状態に依存せず許可し、それ以外ではauthority正常、device ON、event OFFの場合だけ専用CAS recovery commandによるretained entryの再関連付け／明示削除を許可する。自動安全モードではread-only診断とBackup案内に限定する。再度ローカルONにした場合だけ現在の商品ID・順序からsplit identityを再構築する。期限到達済み`event-deleted` cleanupはsettings rootとretention authorityが信頼できる場合に限り、端末／event制御状態によらず時計契約どおり実行できる。原本の商品番号をON／OFF切替で書き換えない
- Backup V2／V1へ端末全体OFFとevent enabledを出力せず、V2復元入力に`localEnabled`、`deviceEnabled`、`control`等のfieldがあれば未知keyとして拒否する。V1は7.1の互換matrixに従って未知fieldを扱うがcontrol authorityとして採用しない。既存イベントへの復元では復元先のローカル状態を維持し、新規復元ではOFFとする
- オフラインは通常のローカル運用であり、それだけを理由に安全モードへ移行しない。重大障害時にインストール済み旧versionを遠隔停止できない制約を利用者向け文書へ明記し、端末全体OFFの案内と修正版配布で対処する

## 7. 初版バックアップと後続ファイル機能

### 7.1 イベント単位Backup V2とV1互換core

- 初版の分割対応backupをイベント単位V2として追加する
- schemaVersion、portable参照、active／dormant／quarantinedを含む`mapCellSplitSettings`セクションを追加する
- V1の`data` wire shapeは現行sectionを基準に`AppBackupV1Data`として凍結し、runtimeの`AppData`型を直接参照しない。V1 readerは現行どおり既知必須fieldの型と参照を検証し、現行が受理・保持する未知optional fieldを新たに削除・拒否しない。top-level、data section、eventSettings、`EventMetadata`、item、各nested objectごとの「必須検証／未知保持／未知拒否／export保持」を`config/fsmc-v1-compatibility-matrix.json`と固定旧版A goldenで固定する。`EventMetadata.splitIdentityAnchor`はoptional opaque fieldとして検証するが、他の未知fieldを一律拒否する例外理由にはしない。V2だけが全階層exact schemaと未知key拒否を採用する
- V2を出力するたび、同じ対象eventのcore dataだけを収録した旧版用V1互換backupも生成する。両bytesを先に自己parse・検証し、V1のfileName、byteLength、SHA-256をV2 `scope.companionCore`へ入れてV2 digestで拘束した後にだけdownloadへ渡す。出力画面とファイル名で、V2は新版用で分割設定を含むこと、V1互換coreは旧版用で分割設定を含まないことを明示する。片方の生成・検証・download handoffが失敗した場合は完了扱いにせず、すでに保存された片方をアプリから撤回できないことと同じpairの再生成を案内する。固定旧版A試験はV2が指すexact V1 bytesを復元する
- export開始時にcore、event metadata、map、訪問anchor、association、split settings、canonical `eventSettings`の全参加storeを1個のreadonly IndexedDB transactionで読み、各full root、checkpoint、対象event sliceを含むimmutableな`SplitCapableEventExportSnapshot`を1回だけ作る。transaction開始前後にbridge journalが完了済みであることとlocalStorage互換projection witnessを検査するが、external projectionをbackup payload authorityにしない。V2 objectとV1 core bytesはIDB snapshotだけから生成し、途中でUI state、cache、DB、localStorageを再読込しない。V1 coreとV2 coreはportable ref化、anchor除去、V1互換matrixが要求する明示transform以外で同値であることをself-testし、readonly transaction失敗、bridge pending／conflict、snapshot内参照不整合では両fileを生成しない
- V2の`data`はscope別exact core unionとして固定し、`full-split`／`core-map`は対象event sliceの`eventLists`、`eventMetadata`、`executeModeItems`、`dayModes`、`mapData`、`mapRotationSettings`、`routeSettings`、`hallDefinitions`、`hallRouteSettings`、`mapViewportSettings`をすべて持つ。`item-only`は`eventLists`だけを持ち、他のdata keyを未知keyとして拒否する。split設定はtop-levelに一度だけ収録する
- V2 wire typeのtop-level必須keyは`kind`、`version: 2`、`exportedAt`、`scope`、`eventSettings`、`data`、`mapCellSplitSettings`、`digest`とし、全階層で未知keyを拒否する。`scope`は単一`eventRef`、そのeventに属する全地図の`mapRefs`、current／historical ownerを分けたportable reference table `references`、期待section、mapData／split設定の収録有無、件数、`companionCore`を明示する。`eventSettings`はfull-split／core-mapでexact 1 event row、item-onlyで`null`とし、item-only restoreは既存設定を維持、新規eventはdefaultを使う。`mapCellSplitSettings`はfull-split時だけactive／retained entryの判別可能unionを持ち、portable refのdata slot対応を重複保存しない。端末全体OFFとevent enabledはどのsectionにも含めない
- top-level scalarは`kind = "event-shopping-planner-backup"`、`version = 2`、`exportedAt`は`new Date(value).toISOString() === value`となるUTC millisecond ISO文字列、`digest`は64文字lowercase hexとする。`kind`をV1と共通にしてversionでdispatchし、未知kind／versionと非canonical日時を拒否する。端末時計の未来／過去は表示上警告できるが、日時だけを理由に正しいdigestのfileを拒否しない
- V1は引き続き読み込む。利用者が選んだUI command種別をauthorityとし、アイテムimportでは設定を維持し、`PD-01`の完全復元では対象範囲の既存設定をpreview後に`legacy-full-restore-without-split-settings`でdormant化する。V1内のmap key欠落や空配列からitem-onlyを推測しない
- ローカルrevision、checkpoint、`locationKey`、event／map／block instance IDをそのまま出力せず、ファイル内だけで有効なportable参照へ置換する
- `data.eventMetadata`の`splitIdentityAnchor`はV2 export時に除去し、`scope.references`のportable event参照へ置換する。V2を新規eventへ復元するときは復元transactionで新しいローカルanchorを発行し、既存eventへの復元では復元先anchorを維持する。V1を新規eventへ復元するときは入力anchorを除去してOFFとし、最初のenableでローカルanchorを発行する。V1の既存event復元とitem importは入力anchorで復元先anchorを上書きせず、現在profileの既存sidecarと一意一致する場合も候補説明にだけ使い、`PD-01`のpreviewと明示確定を迂回してactive化しない
- 復元時はportable参照を新しいローカルIDへremapし、外部IDをそのまま採用しない
- 形式、値、portable参照、重複entry、status、schemaVersionが不正なファイルはDB更新前に全体を拒否する。構造的には正しいが復元先と安全に一致しないretained entryだけに新しいローカル`dormantEntryId`を発行し、dormant／quarantinedとして保持する。外部event／map／block／entry refをruntimeのinstance IDまたは`priorOwner`へ採用しない
- イベント復元は確定前に復元先、置換、維持、休眠化、隔離、除外、ID remap、ローカルON／OFFを引き継がないことをプレビューする
- プレビュー確定時だけ、地図、アイテム、訪問順、canonical eventSettings、分割設定を同じIDB transactionで置換し、eventSettings legacy bridge mirrorまで完了した後だけ成功を通知する。取消、validation error、CAS競合は全storeを旧状態のまま維持し、IDB commit後のmirror中断はjournalから再開して第三状態を採用しない
- 新しいeventとして復元する場合は新しいローカルIDを発行し、controlのenabled ID一覧へ追加しない。既存eventへ復元する場合は復元先IDとcontrol一覧上のmembershipを維持し、内容だけを置換する
- Backupは端末間同期や差分mergeではない。復元元と復元先の双方に変更があっても自動合成せず、復元先の退避backupを案内したうえで選択したV2の内容へ原子的に置換する
- アイテムだけのimportは既存の地図、event／map instance ID、分割設定を維持する
- 一致しない旧version設定は削除せず、読み取れる範囲を`dormant`／`quarantined`として保持する
- 利用者は休眠・隔離設定を端末内で手動再関連付けまたは削除できる。設定単独JSON出力は後続版とする
- JSONのraw byte数、nesting、token数、event／map／entry数、文字列長、error保持数をparse・commit前に検証する。UIは`File.size`だけを検査して`File`を同一originのbundled module Workerへstructured cloneし、main threadで全file `arrayBuffer`／全文stringを作らない。Workerは1 MiB以下のbounded slice、streaming `TextDecoder("utf-8", { fatal: true })`、incremental duplicate-property／非再帰depth／token scanner、exact schema validatorの順で処理し、重複したraw bytes＋全文string＋DTOを同時保持しない。error件数と1件の表示長を上限で切り、cancel／timeoutではWorker、reader、timer、transactionを残さない。Workerは`worker-src 'self'`で許可される同一origin production assetとしてVite manifestとPWA precacheへ登録し、`blob:`／`data:` Worker、remote import、未追跡Blob URLを禁止する
- 上限超過、parse error、digest不一致では既存DBを一切変更せず、理由と退避方法を表示する

V1 full restoreと完全版XLSX 2.2 full restoreはI4の初版legacy restore ownerとする。UI command種別をauthorityにしてitem-onlyとfullを推測で切り替えず、XLSX 2.2は現行Worker／parserが返すmap同梱scopeをversion dispatchで明示判定する。full restoreは、対象event、置換core、既存activeを`legacy-full-restore-without-split-settings`のdormantへ移す件数、既存retainedを元の`dormant | quarantined` status、reason、evidence、`dormantEntryId`のまま維持する件数、ローカルON維持、新規event OFFをpreviewし、core、association、active→retained遷移、既存retained、control、fenceを同じ`ExpectedRootVector`で原子的に確定する。既存retainedのreasonを一括上書きしたりactiveへ戻したりせず、新しいcoreとのowner衝突が生じる場合は元statusを保ったまま別の除外reasonをpreviewへ表示してcommit全体を拒否する。取消、parse error、unsupported workbook、stale、quotaではwrite 0件とする。I0はV1／XLSX 2.2の複数地図、empty map、item-only、full、既存dormant／quarantined、取消、破損fixtureとtest IDを固定し、I4 Exit、10.2 restore matrix、I11 E2E、DoDの全てで両形式を同じ必須集合として追跡する。

item URLはbackup／V1／V2／XLSX／CSV／通常編集に共通の`classifySafeExternalUrl(value, inputPolicy)`を通す。返却は`none | safe(SafeExternalHref) | unsafe-legacy(raw, reason)`の判別可能unionとし、空文字は`none`であってclickable URLではない。clickableにできるのはuserinfoを持たないabsolute `http:`／`https:`だけとする。ASCII control `U+0000..U+001F`／`U+007F`、bidi control `U+061C`／`U+200E`／`U+200F`／`U+202A..U+202E`／`U+2066..U+2069`、未知scheme、`javascript:`、`data:`、`file:`、protocol-relative URL、parse不能値をunsafeとする。`inputPolicy = strict-new`のV2、CSV、新規作成、通常編集はunsafe値をcommit前に操作全体拒否し、V2 exportも既存unsafe値を含む場合はpair生成を止めて修正を案内する。`inputPolicy = legacy-compat`のV1／XLSX 2.2 importと既存profile読込だけは互換のためraw文字列を変更せず`unsafe-legacy`として保存・診断付きplain text表示し、anchorの`href`へ渡さない。選択時warningと後続編集による修正導線を出し、安全値へ推測変換しない。`CellItemsPopup`、`ShoppingItemCard`を含む全URL sinkはbranded `SafeExternalHref`だけを受け、`target="_blank"`時は`rel="noopener noreferrer"`を必須にする。

V2はtop-levelに`digest`を持ち、`digest`自身を除くV2 objectをキー順序固定の`esp-json-v1` canonical JSONへ変換したUTF-8 bytesに対するSHA-256を保存する。export直後、parse直後、preview確定直前に検証する。これは破損検出であり、発行者の真正性や改ざん耐性を保証する署名ではない。V1にはdigestを追加せず、V1の読込互換を維持する。

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
  historicalOwners: Array<{
    historicalOwnerRef: string;
    ownerKind: "map" | "block";
    parentHistoricalOwnerRef: string | null;
    lastKnownDayKey: string;
    lastKnownMapName: string | null;
    lastKnownBlockName: string | null;
  }>;
}

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
};

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

type V2FullCoreSections = [
  "eventSettings",
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
  companionCore: {
    fileName: string;
    byteLength: number;
    sha256: string;
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
      digest: string;
    };
```

初版の`scope`は上記3分岐だけを許すexact unionとし、`includesMapData=false, includesSplitSettings=true`や未知`contentKind`はDB更新前に全体拒否する。`expectedSections`は上記の現行V1／wire DTO inventoryから導いた「非`null` sectionだけ」のexact tupleであり、重複、順序違い、宣言した非`null` sectionの欠落、宣言外の非`null` sectionを拒否する。`full-split`／`core-map`の`data`は`AppBackupV2FullEventCoreWireV1`の全10 keyを対象event sliceとして必須保持し、metadata、実行順、day mode、route／hall／viewportを落とさず、`eventSettings`はsole eventRefのexact 1 rowを持つ。`item-only`の`data`は`AppBackupV2ItemOnlyCoreWireV1`だけ、`eventSettings`と`mapCellSplitSettings`はともに`null`を必須とし、既存復元先のsettingsを維持する。各`*SectionWireV1`はversion付きJSON Schemaから所有する明示DTOで、runtime `AppData`、`ShoppingItem`、persistence rootの`Pick`／`Omit`／intersection、型再exportを禁止する。`snapshotToBackupWireV2`と`backupWireV2ToRestorePlan`だけがruntime境界を変換し、compile-time negative fixtureとarchitecture testでwire moduleからruntime／persistence typeへのimport 0件を検証する。top-levelの2 section key自体はenvelopeの不在sentinelとして常に必須とし、非`null`の場合だけ`expectedSections`へ列挙する。これ以外の`null` sentinelや宣言外keyは許可しない。

`scope.references.events`は全scopeで1件だけとし、`scope.eventRef`と同じ`eventRef`から`dataEventKey`へ対応させる。`full-split`／`core-map`は`scope.mapRefs = scope.references.maps = data.mapData`の全day-map slotが集合、canonical順、件数で一致し、`scope.references.blocks`も同梱全mapの全論理block slotと一対一で一致する。`historicalOwners`はcurrent mapDataへ解決しない削除済みownerだけを持ち、parent relationがacyclicで、各retained `historicalOwnerRef`からexact 1行へ解決する。`item-only`は`mapRefs=[]`、referencesのmaps／blocks／historicalOwners空、map／block／historical owner／active／retained件数0、`data.mapData`を含む他の9 data keyなしとする。したがってsplit設定が`null`でも`eventRef`／`mapRef`をcore data slotへ一意に解決でき、表示名やobject列挙順を代用しない。複数地図eventと削除済みownerを共有する複数retainedのgolden fixtureを必須にし、地図同梱scopeを単一`mapRef`へ縮退させない。`full`と`multipart` scopeは後続versionで定義し、初版readerは未知scopeとして拒否する。

`counts`は表示用自己申告として信頼せず、export直前とreaderのschema検証後にI0固定pure `deriveEventBackupCountsV2`で実payloadから再計算して全6 fieldのexact一致を必須にする。`items`は`scope.references.events[0].dataEventKey`の`data.eventLists`配列要素数、`maps`は対象eventの`data.mapData` day-map slot総数、`blocks`はその全mapをcanonical走査した論理block slot総数、`historicalOwners`はreference table行数、`activeSplitEntries`／`retainedSplitEntries`はportable entryのstatus別件数とする。`full-split`／`core-map`のreferences maps／blocksはこの全map／全block slot集合と一対一で一致し、`core-map`はhistorical ownerとsplit 2値を0、`item-only`はitems以外を0とする。負数・非safe integer、自己申告と実数の差、`scope.references`だけの水増し／省略はdigestが正しくてもcommit前に全体拒否する。raw scannerのhard limitは自己申告countを使わず、実token／entry数を数える。

- split-capable exporterが地図を含むevent scopeを出力する場合は`includesSplitSettings=true`を必須とし、分割設定を黙って省略しない
- core-only source等から`includesMapData=true`かつ`includesSplitSettings=false`のV2を復元する場合は、V1 fullと同じく影響範囲の既存split設定をpreview後に`legacy-full-restore-without-split-settings`でdormant化する
- `includesMapData=false`かつ`includesSplitSettings=false`のitem-only scopeは既存の地図・分割設定を維持する。map置換とitem-onlyを同じ「設定なし」として扱わない

- `scope.references.events[0].dataEventKey`は同じV2のevent-scoped全sectionに存在する唯一のevent keyを指す
- `dataDayMapSlotKey`は参照eventの`data.mapData`にある日程・地図slotを指す
- `dataBlockSlotKey`は参照map内の論理block slotを指す
- `scope.references`のportable map rowはruntimeと同じ`algorithmVersion`とauthoritativeな`mapStructureFingerprint`を持ち、portable active entryは`blockFingerprint`と`locationFingerprint`だけを持つ。entryへ現在map fingerprintを重複させない
- active entryはevent／map／block参照をすべて必須とし、`scope.references`で一意に解決し、同梱mapDataから再計算したmap／block／location evidenceが一致する場合だけ許可する
- 全entryの`eventRef`はscopeのsole `eventRef`と一致させる。retained current ownerは`blockRef`があれば`mapRef`も必須とし、そのblockの親mapと一致させる。historical ownerはcurrent refと相互排他的で`historicalOwners`へ解決する。最後にactiveだったentryはportable block／location evidenceを必須とし、never-activeは`portable-unresolved-reference`だけに限定する。exportは同じruntime `priorOwner` tupleを同じhistoricalOwnerRefへ写し、importは外部ref／IDを採用せず、各historicalOwnerRefへfresh local opaque map／block ID tupleを1回だけ割り当てて全参照をgroup-preservingにremapする。current associationへ自動接続せずretainedのまま維持する。旧map fingerprintは診断fieldとしてだけ受理する
- `scope.references`、core data、preview inputから端末全体OFFまたは`localEnabled`を受け取らない。既存イベントでは復元先のローカル値を表示し、新規復元ではOFFになることを表示する
- portable refはkind別に`^e-[0-9]{6}$`、`^m-[0-9]{6}$`、`^b-[0-9]{6}$`、`^h-[0-9]{6}$`、`^s-[0-9]{6}$`とし、export snapshotをcanonical順に走査して連番発行する。`mapRefs`、`references`の各配列、entry配列は上記canonical比較順とし、ref文字列は64 code unit以下、利用者表示文字列はI0 hard limit以下とする。`companionCore.fileName`は`^[A-Za-z0-9._-]{1,128}$`、`sha256`は64文字のlowercase hex、全countは0以上、`byteLength`は1以上かつ各々safe integer・hard limit以下をexact schemaで検証する
- 重複ref、存在しないactive参照、同じdata slotへの多重ref、`scope.references`外の未知keyを全体拒否する。加えてactiveの`(eventRef, mapRef, blockRef, number)`重複、同じ現在owner＋numberのactive／retained overlapを拒否する。retained同士は`entryRef`だけをidentityとし履歴を黙って統合しない。明示的な再関連付けでretainedをactiveへ戻す場合は、同じtransactionで元retainedを除去し、新activeとの一時的overlapもcommitしない

### 7.2 後続版: 完全版XLSX 2.3

この節は後続版の設計予約であり、初版の実装フェーズ、テスト、Definition of Doneへ含めない。

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

「セル分割設定」の物理schemaをFSMC-I0 ADRとgolden fixtureへ固定する。初期列は次のexact headerとする。

| 列                    | 必須     | 内容                                 |
| --------------------- | -------- | ------------------------------------ |
| `eventRef`            | 列必須   | activeは非空。その他は未解決時に空可 |
| `mapRef`              | 列必須   | activeは非空。その他は未解決時に空可 |
| `blockRef`            | 列必須   | activeは非空。その他は未解決時に空可 |
| `entryRef`            | 必須     | ファイル内で一意なentry参照          |
| `lastKnownEventName`  | 必須     | preview表示用                        |
| `lastKnownDayKey`     | 必須     | preview表示用                        |
| `lastKnownMapName`    | 任意     | preview表示用                        |
| `lastKnownBlockName`  | 必須     | preview表示用                        |
| `number`              | 必須     | 先頭ゼロ除去済みsafe integer         |
| `direction`           | 必須     | `left-right`／`top-bottom`           |
| `aSide`               | 必須     | directionと整合する側                |
| `status`              | 必須     | `active`／`dormant`／`quarantined`   |
| `reason`              | 状態依存 | activeでは空、その他はallowlist code |
| `blockFingerprint`    | 必須     | 論理ブロックevidence                 |
| `locationFingerprint` | 必須     | 物理番号領域evidence                 |

全列headerは必須とする。active行はevent／map／block参照cellがすべて非空で同じworkbook内へ解決することを必須とし、dormant／quarantined行だけ未解決の参照cellを空にできる。その場合もlast-known情報とreasonを必須とする。重複ref、未知列、欠落列、余分な非空cellは拒否する。

「セル分割参照」の`dataSlotKey`は同じworkbookの同梱mapDataへ一意に解決するものだけを許可する。map行の`mapStructureFingerprint`を地図全体の唯一のauthorityとし、active設定は3段階の参照解決、map行のevidence、entry行のblock／location evidence一致を必須とする。dormant／quarantinedだけ未解決参照を許可する。端末全体OFFとevent enabledはworkbookへ収録しない。

### 7.3 保証規模と入力安全制限

自動性能テストの保証規模、import拒否境界、export生成境界を形式・file単位とV2＋V1 pair単位に分ける。I0で`config/fsmc-backup-limits.json` schema version 1へ、`performanceGuaranteedRawBytesPerFile = 32 * 1024 * 1024`、V1／V2 JSON専用`jsonImportHardRawBytesPerFile = 64 * 1024 * 1024`、`v2ExportMaxRawBytes = 32 * 1024 * 1024`、`companionV1ExportMaxRawBytes = 32 * 1024 * 1024`、`pairTotalExportMaxRawBytes = 64 * 1024 * 1024`、`workerSliceBytes = 1 * 1024 * 1024`、nesting 64、JSON token 5,000,000、event 1、map 256、block 8,192、split entry 20,000、item 100,000、1文字列1 MiB（UTF-8）、validation error 100件、1 error 512 Unicode scalar、Worker validation timeout 30秒、cancel確認間隔1秒を整数byteで固定する。XLSX 2.2は既存`config/xlsx-limits.json` schema version 1の`maxCompressedBytes = 33,554,432`、entry 4,096、単一展開entry 64 MiB、総展開256 MiB、圧縮率100等を初版hard limitとし、backup limits側は同fileのpath、schema version、SHA-256を`xlsxImportLimitsRef`として参照して値を複製しない。各形式ではfile byte上限と構造・展開・count上限のうち最初に超えた厳しいlimitを優先する。3.13の保証fixtureはcount境界とV2／V1各実生成bytesの両方が`performanceGuaranteedRawBytesPerFile`以下、かつpair合計が`pairTotalExportMaxRawBytes`以下でなければならず、超える場合はI0を失敗させて製品判断を更新し、保証を黙って縮小しない。値を変える場合は参照先を含むconfig schema version、golden境界fixture、互換影響を同じPRで更新する。

- V1／V2 JSON importは選択した各fileが保証規模または32 MiBを超え、64 MiB以下かつ他の全hard limit以下の場合だけ警告付きbest effortでpreviewまで進める。XLSX 2.2にはこの64 MiB best-effort帯を適用せず、compressed 32 MiB以下かつ既存の展開後／entry／sheet／row／cell／圧縮率／時間上限をすべて満たす場合だけpreviewへ進める。複数fileを黙示pairとして合算せず、各fileと明示manifestの関係を別に検証し、自動削除・切捨て・設定解除を行わない
- V1／V2 JSONの単一fileが64 MiBを超える、XLSX 2.2のcompressed fileが32 MiBを超える、またはいずれかの形式固有hard limitを超える場合はWorkerまたはvalidatorで`resource-limit`として拒否する。境界は各形式で`<=`を受理、該当limitの`+1 byte`／`+1 count`を拒否とする
- exportは保証countを1件でも超える、V2 canonical bytesが32 MiBを超える、companion V1 bytesが32 MiBを超える、または2 file合計が64 MiBを超える場合はpair生成・downloadを開始しない。best effort export、片方だけ、不完全fileを作らず、event縮小とtrusted core退避を案内する
- `FSMC_NUMBER_TOKEN_MAX_UTF8_BYTES = 1 MiB`をI0 ADRへ固定し、UI、CSV、XLSX、V1／V2の全番号取込で`BigInt`化前に適用する。新規入力・file after-imageの超過は全commit前に`resource-limit`として拒否し、既存永続dataの超過tokenは原文を変更せず`legacy-unresolved / unsafe-base-number`として診断し、経路や自動再関連付けへ使わない
- backupは`JSON.parse`前のraw byte上限、nesting、総entry、文字列UTF-8 byte、duplicate ref、構造fieldのallowlist、validation error保持数を制限する。利用者入力値であるイベント名・日程名等が`__proto__`、`constructor`、`prototype`であること自体は拒否せず、動的keyは`Map`、null-prototype object、または安全なown-property APIで扱ってprototype chainへ代入しない
- 初版XLSX 2.2は既存`config/xlsx-limits.json`のcompressed／entry／展開後XML byte、sheet／row／cell数、圧縮率、wall／CPU timeとI4のcancel／heartbeat／peak memoryをすべて適用する。後続XLSX versionも少なくとも同じ制限を継承し、緩和にはversion付き判断を要求する
- アプリ自身が出力した保証規模内のV2を同version importerがresource limitで拒否しないgolden testを固定する

初版のevent export preflightで1イベント内地図数、entry数、推定byte数を検査する。I0では上記3種類の境界と3.13の保証件数を固定し、I4で実canonical export bytesを使って次を実装・強制する。

- イベント単位Backup V2とV1互換coreのmap／entry、V2各32 MiB、V1各32 MiB、pair合計64 MiBのexport generation上限
- 上限内での自己round-trip保証

初版のeventが保証count、V2／V1各fileの32 MiB上限、またはpair合計64 MiB上限を超える場合は、読めない単一ファイルや不完全ファイルを生成せず、出力を停止して対象eventの縮小方法を案内する。自動分割するmultipartは後続版とする。外部V1／V2 JSON importだけはfileごとに64 MiB以下のbest effort分岐を持ち、XLSX 2.2は既存compressed 32 MiB hard limitを優先し、export停止と混同しない。I4では最大fixtureのself round-tripが上記limitで拒否されないこと、V2単体、V1単体、pair合計、JSON import 64 MiB、XLSX compressed／単一entry／総展開／圧縮率の各境界直前・一致・+1、count境界とbyte境界が逆転するcaseを自動テストする。

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
- 経路cacheとsignatureには順序付き`visitId`、`locationKey`、baseCell、anchor、split binding evidence、`pathfindingGraphFingerprint`を含める。`DayMapData.cells`の`value`／`backgroundColor`、map寸法、結合領域、passability rule、3×3解像度、cost定数のいずれかが変われば古い経路を再利用しない。描画px、font色、回転、zoom、pan、DPR値をsnapshotへ保存しない

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

Canvas入力のauthorityはPointer Eventsへ統一し、native TouchEventとReact PointerEventで別々のgesture状態を管理しない。状態は`idle`、`tapCandidate`、`dragging`、`multiPointer`、`cancelled`とする。

- `pointerdown`でpointer captureを取得し、pointer ID、開始client座標、開始時刻、入力種別を記録する
- 2本目のpointerが入った時点で`multiPointer`とし、全pointerが離れるまでtap候補へ戻さない
- CSS px移動量が入力別drag閾値を超えたら`dragging`とする
- `pointercancel`、`lostpointercapture`、画面回転、layout切替、visibility喪失では`cancelled`とする
- tap確定は単一pointerの`tapCandidate`が同じpointer IDの`pointerup`を受けた場合だけ行い、後続synthetic clickで重複実行しない
- route insert、block selection等の編集modeを先に判定し、通常セルpopupとの優先順位を固定する

## 9. 実装フェーズとPR境界

本章の`FSMC-I0`～`FSMC-I11`はFull Split Map Cell初版固有の実装checkpointであり、リポジトリの正式release gateである`P0-RELEASE`～`P8-CLEAN`とは別物とする。文書、PR、issueでは`P0`等の省略名を使用しない。FSMC checkpoint自体を既存の`RELEASE_PHASE_GATES`へ追加せず、初版の全自動テストを既存release workflowの通常checkとして実行する。

各FSMC PRは、そのフェーズのunit、integration、browser、schema、fixture、CI設定を同じPRに含め、FSMC-I11まで試験を延期しない。各PRはproductionでsplitを誤公開せず独立してmainへmerge・配布可能でなければならず、前フェーズの自動Exit testが未達のまま次フェーズを開始しない。外部証跡bundle、remote activation、実イベントpilotは作らない。`config/fsmc-traceability.json`は各requirementに`ownerPhase`、`fixtureIds`、`testIds`、`commands`、`profiles`、`status`、`enforcedFromPhase`、`releaseScope: "initial-release" | "future"`を持ち、各PRで初版対象だけを`planned`→`contract-enforced`→`implementation-enforced`へ更新する。後続版対象は`future`として初版gateの選択集合とplanned残存判定から除外し、初版requirement／PD／DoDを`future`へ分類して回避することをcross-verifierで拒否する。

readiness、DB target、公開境界を次に固定する。

| phase／artifact               | build固定readiness | `databaseTargetMode`   | command／UI／DB状態                                                                         |
| ----------------------------- | ------------------ | ---------------------- | ------------------------------------------------------------------------------------------- |
| I0～I1 production             | `contracts-only`   | `core-current`         | DB5、capability code／store／public command／UIなし                                         |
| I2～I10／I11作業中 production | `internal-testing` | `core-current`         | DB5、capability store open／create／write 0件、public handler未登録、UI非到達               |
| I2～I10／I11作業中 QA         | `internal-testing` | `fsmc-vcap-qa`         | 隔離origin／profileだけVcap、QA harnessからcommand登録、effective ON時だけmutation commit可 |
| I11 release-ready production  | `release-ready`    | `fsmc-vcap-production` | productionで初めてVcap、端末switch、event preview／commandを公開                            |

readinessはsourceに固定し、storage、query parameter、URL、remote responseから変更しない。QA overrideはnon-promotable QA artifactだけにcompileし、production bundle verifierがoverride symbol、command、query、storage keyの混入を拒否する。I5でUIを実装してもI11まではproduction navigationへ露出させない。release-ready公開時も端末全体OFF、既存event OFFを既定とし、問題発生時は端末全体OFFで`PD-04`のsplit固有部分のlegacy動作（phase時点で完成済みの`PD-14.C2`／`C3`、重複物理cellの新規after-image拒否、`map-data-untrusted`安全判定の常時修正を含む）へ戻す。

command capabilityは`commandCodePresent`、`publiclyRegistered`、`publiclyReachable`、`dispatchAuthorized`、`commitAllowed`を別fieldとしてmanifestへ記録する。pre-release productionでは内部codeが存在しても後4 fieldをfalseとし、router／dispatcherを直接呼んだ場合は`implementation-not-release-ready`、write 0件にする。QAとrelease-readyのhealthy profileだけがpreview／enable／disableを登録でき、previewとdisableはevent OFF中にも利用できるが通常split mutationはeffective ONの場合だけcommitできる。`recovery-required`では診断と6.1.1の明示復旧commandだけを別registryへ登録し、controlを含む通常commandは全てwrite 0件で拒否する。authority保守用legacy rebaseは利用者registryに入れず、recovery-requiredでは実行しない。

`currentPhase`は着手した最も後ろのphaseを表す`FSMC-I0`～`FSMC-I11`の列挙値とし、直前phaseのExit verifier成功後にだけ次値へ1段進め、skip、逆行、複数authorityを禁止する。`currentPhase`がI0／I1なら`contracts-only`、I2～I10なら`internal-testing`、I11の作業中candidateは`internal-testing`を許す。I11最終release candidate PRだけがsourceを`release-ready`へ変更し、production `databaseTargetMode`を`fsmc-vcap-production`へ進めて同じproduction artifactを全Exit testへ掛け、そのrunが完了するまでは配布不能とする。したがって「`release-ready`を試験する前にExit成功が必要」という循環も、未試験artifactの配布も許さない。`config/fsmc-implementation-state.json`、build constant、artifact manifest、traceability、test manifestの組合せを各PRで相互検証し、artifact manifestの`databaseTargetMode`と実際にopenしたDB version／originが一致しない場合は失敗させる。

FSMCのCI job ID／status名はI0で`fsmc-required-gate`へ固定し、その後phaseやfindingに応じて追加・削除しない。I0は既存branch protectionでrequiredな終端contextをread-only inventoryし、そのworkflow終端jobを`if: always()`＋`needs: [fsmc-required-gate]`相当へ変更して、FSMC jobが成功しない限り既存required contextも成功しない構成を第一選択とする。これならbranch protection外部設定を変更しない。既存required終端contextを機械的に証明できない場合だけ、`config/fsmc-ci-gate.json`にowner `Repository Maintainer`、対象branch、固定context名、one-time setup手順、read-only確認commandを記録し、Repository Maintainerが`fsmc-required-gate`を一度required化するまでI0 Exitを失敗させる。その後の動的変更権限やfinding別contextは作らない。

aggregatorはsource固定implementation stateからmodeを再計算する。`contracts-only`／`internal-testing`では`verify:fsmc:phase-gate`を実行し、現在phaseまでのExit、同phaseまでに`enforcedFromPhase`へ到達した`initial-release` test、production artifactのreadiness一致、早期公開経路なし、current-run WebKit safety artifactを検証して`phase-gate-passed`にできるが、`releaseScope = future`のtestや`release-ready`を要求せず公開可能とは表示しない。`release-ready` candidateだけは同じjob内で`verify:fsmc:release-readiness`を実行し、I0～I11の全Exitと初版公開条件を要求する。modeの自己申告、workflow input、branch名、query／storageで分岐せず、state／artifact不一致、skip、選択test 0件を失敗させる。

### FSMC-I0着手前ゲート（phase外）

既存品質失敗はFSMC実装と混ぜず、専用pre-I0 hygiene commitで解消する。pre-I0全体は「source hygiene」と「外部CI前提」の2 subgateからなり、前者のcanonical commandは順に、(1) `git status --porcelain=v1`が空、(2) `git diff --check`成功、(3) `npm run quality`成功、の3段だけとする。`quality`の一部を本文へ再列挙せず、package scriptの再帰展開graphをauthorityにする。skip、waiver、expected failure、既知失敗を許さない。3段成功かつ外部CI前提のread-only確認成功時の同一HEADを基準commit Hとして確定し、その完全commit SHAを`i0StartHeadSha`とする。Hの確定後は追更新せず、plan是正とbaseline cleanupを含む`baselineSourceSha..H`の全差分をinventoryへ収録する。どちらかのsubgateが失敗した状態では最初のI0変更を作らない。

`config/fsmc-pre-i0-baseline.json`とschemaはHには含めず、Hを親に持つ最初のI0 commitで作る。既知となった`i0StartHeadSha = H`、H上のpackage.json／lockfile SHA-256、Node／npm version、`qualityCommand: "npm run quality"`、quality script SHA、再帰展開した順序付き`qualityCommandGraph`、各script本文SHA、graph SHA、3段のexit codeを固定する。したがって設定を含むcommit自身のSHAを同じ設定へ埋め込む自己参照は発生しない。`verify:fsmc:pre-i0-baseline`はrecorded Hの一時detached worktreeで`npm ci`後に同じ3段を再実行し、tracked差分とignore対象外untracked生成も拒否する。本計画採択時に確認された既存`format:check`失敗を専用hygiene commitで解消し、Hを確定するまでFSMC-I0の実装変更を開始可能とは判定しない。

外部CI前提subgateは、本節で固定するfieldとread-only確認commandをH候補上で実行し、repository／default branch、branch gate mode、既存required終端contextまたはone-time `fsmc-required-gate`、owner role、GitHub Actions利用可否、GHCR package／publisher workflow、必要permission名、secret／variableの存在名、fork PR方針を確認する。credential値とcommand出力中のsecretは保存しない。成功結果はHを親に持つ最初のI0 commitで`config/fsmc-ci-prerequisites.json`とschemaへ、確認時点、`requiredAt: pre-I0 | I0-exit | release-ready`、非機密result digestと共に記録する。通常required workflowは`contents: read`／`packages: read`、image publisherだけがprotected default branchまたは承認付きmanual dispatchで`contents: read`／`packages: write`を持ち、untrusted PRへwrite tokenを渡さない。pre-I0では権限を持つownerと実施可能性、I0 Exitでは同じcommandの再実行、imageのexact digest pull、branch gate実在状態を検証する。owner不在、Actions／GHCR利用不能、required gate接続不能はpre-I0 blockerとし、I0内の実装で迂回しない。

### FSMC-I0: 契約・fixture・基準値

実装:

- 仕様ADRとversion付きJSON Schemaを作成し、bounded番号grammar、`C(S)`衝突pair集合、mapped／mapless／legacy-unresolved identity、active／retained entry、map／entry／pathfinding graph fingerprint、settings／control root、authority別の型と配列へ分離したfull observed root＋checkpoint＋物理location付きIDB／external recovery candidate観測、全`FSMC_GOVERNED_ROOTS_V1`のroot policy、全非fence rootのlossless candidate vector付きhistorical evidence、その全行digest、participant digest、全root baselineを持つexternal fence protocol、retention clock、座標変換、picker順、Backup V1／V2をexact fixtureで固定する
- DBなし、健全なcore-only profile、capability storeだけ／空store／4 payload rootまたはfenceの各単独・部分集合／metadataだけ／checkpointだけ／candidateだけ、採択済み`Vcap`以上の完全初期5 capability rootあり／storeなし／各root欠落／participant・root universe・baseline不一致、supported上限超過、versionchange commit前後終了のfixtureとdecision tableを作る。provenanceから採択された`Vcap`の排他性、rootへ閉じたintroduction witness、`db-version` witness一致、外部`E0/E1`、全core／candidate selectorの`H0/H1` byte-exact CAS、legacy row=`H1`、new capability payload row＝factory canonical after-image、fence＝baseline only、existing／fresh profile別actual participant集合をschema verifierで固定する。旧tab race、導入前absent capability rowをhistorical rowへ誤保存、bridge E0/E1第三値、lone surrogate差、participantとactual write不一致のnegative fixtureを含め、いずれかを証明できなければI2を停止する
- `config/fsmc-capability-adoption.json`を、共通field `schemaVersion`、decision ID、baseline／legacy A source SHA、`coreDbVersion`、`supportedMaximumDbVersion`、reserved purpose、decision input／legacy manifest／provenance manifest SHA、fixture／test IDを持ち、`{ outcome: "adopt-vcap"; capabilityDbVersion; conflictEvidence: [] } | { outcome: "alternative-witness-required"; rejectedCandidateVersion; conflictEvidence: [VcapConflictV1, ...VcapConflictV1[]] }`のexact unionとして作る。adopt側の`capabilityDbVersion`はsafe integerかつ`coreDbVersion < capabilityDbVersion <= supportedMaximumDbVersion`を必須とし、現行5／supported上限7では候補集合を6または7へ限定する。source constant、全remote-tracking history／tag、authoritative release・artifact ledger、同名DB store inventory、fixture resultからverifierが全fieldとoutcomeを再計算し、時刻、自由記述、手入力pass、branch名だけの否定証拠を含めない。distributed／unknown conflictが残る候補のadopt、範囲外候補、入力hash／fixture集合driftを失敗させ、`adopt-vcap`を証明できなければI0 ExitとI2開始を閉じて代替ADRを要求する
- supported range内で`dbVersion >= Vcap` iff exact 1件の値一致`db-version` witness、`dbVersion === null || dbVersion < Vcap` iff witness 0件をschema／fixtureへ固定する。`dbVersion > supportedMaximumVersion`は3 snapshotのreasonへ流用せず、`unsupported-database-version`、connection close、authority非採用、write 0件を検証する。現行fixtureのDB8はこの上限超過分岐から導出する
- `config/fsmc-governed-roots.json`へ全root tupleと`capability-owned | legacy-mutable-core | legacy-shadow-bridged | fence`のexact policyを重複なく固定し、4 payload root、fence、config hash、物理内容witnessとabsorption projectionを含むlossless candidate vector付きtotal historical evidence、全historical row digest、actual write集合と一致するparticipant roots／digest、完全external baselineをschemaで拘束する。pure legacy classifier、event-settings bridge classifier、内部rebase／reconcile commandの優先順、lock scope、after-image validator、原子性、制御状態非依存のauthority保守条件をcontract fixtureへ固定する。固定旧版Aによるcore／shadow変更、candidate content-only差、吸収、snapshot時empty storeへの追加、非参加row改変、capability root変更、fence自己不整合、bridge第三値、existing／fresh bootstrap participant mismatchを別fixtureにし、healthy差と破損を同じ期待値にしない。transaction内でWebCrypto Promise、別transaction、別async taskを待たず、pre-transaction bytesとの同期exact比較後にfirst writeへ進むことをarchitecture testで強制する
- `config/fsmc-legacy-candidate-transitions.json`と`config/fsmc-legacy-event-settings-transitions.json`へ固定旧版Aの全candidate／shadow writer・cleanup path、transition ID、root policy、authority、物理selector、old／new canonical shape、parser結果、必須root／checkpoint関係をwildcardなしで固定する。manifestのexact 1 transitionだけをrebase／reconcileし、0件／複数一致・projection-only改変をrecovery-requiredとする。各commandの`logicalRootMutationTuples`、`committedParticipantRoots`、置換historical row、participant digest対象集合のexact一致、`administrativeFencePhysicalWrites`とfence manifestの一致、非参加row byte同値をschema／fixtureへ固定する
- `config/fsmc-event-metadata-writers.json`へ全writerと旧版A／新版Bのanchor方針を列挙し、source switch、bulk add、item-only／full import、V1／V2 restore、XLSX、改名、複製、削除・同名再作成を漏れ検出するarchitecture testを作る
- `config/fsmc-change-surface.json`へbaseline SHAと、各entryの`path`、`symbol`、`layer`、`baselineDirectCallerCount`、`ownerPhase`、`targetApi`、`completionAssertion`を固定する。少なくとも番号parser全caller、`NavigatorItem`／旧visit identity、`MapView`、`MapVisitListPanel`、`FocusModeContainer`／`FocusMode`、item／map／hall mutation commands、event itemOps、map import flow／overlay、Backup command／overlay、pathfinding／route point／hit-test／render／cacheを含める。I0はAST inventoryと`rg` fallbackの結果一致を検証し、各owner Exitで旧API production edge 0件または明示legacy allowlistだけを許す
- Hを親に持つ最初のI0 commitで`config/fsmc-implementation-state.json`を追加し、`schemaVersion`、`baselineSourceSha`、`i0StartHeadSha = H`、`currentPhase`、`readiness`を固定する。`baselineSourceSha..i0StartHeadSha`だけをpre-I0 inventory対象とし、I0自身のcommitはこのrangeにも基準SHA更新条件にも含めない。Exitでは`i0StartHeadSha`がbaselineの子孫であること、最初のI0 commitの第一親とexact一致すること、inventory完備、現在HEADが`i0StartHeadSha`の子孫であることを検証する。`currentPhase`は`config/fsmc-implementation-state.json`だけをauthorityとし、test manifest、traceability、source readinessとの不一致を失敗させる
- DB5、V1、完全版XLSX 2.2、複数地図event、`full-split`／`core-map`／`item-only` Backup V2、部分root欠損、完全profile消去、D+29／D+30／31日／36日／rollbackのgolden fixtureを固定する。V2 fixtureは全scope共通`scope.references`、実payloadと一致する全`counts`、正しいdigestだがcountsだけ過少／過大、referenceの水増し／省略を含める。V1層別互換matrixと固定旧版Aの自己動作だけをI0で実行し、新版Bの後続挙動は担当phaseへ登録する
- 固定旧版Aは完全source SHA `3db4be011d0f4123aa3953b559280c58f33d026a`のdetached worktreeから一度だけ生成し、`tests/fixtures/fsmc/legacy-a/legacy-a-artifact.zip`を通常Git blobとして直接追跡する。Git LFS、network download、CI再buildを使わず、`.gitignore`の`dist`規則からこのarchiveだけを明示除外する。`manifest.json`へsource／lockfile／toolchain hash、Node／npm、build／start command、archive path／SHA-256／byteLength、展開後全entryの相対path／size／SHA-256、fileCount、provenance、licenseを固定する。verifierはcompressed 32 MiB、expanded 128 MiB、4,096 filesを上限に一時directoryへ展開し、absolute path、`..`、symlink、duplicate、case collisionを拒否してoffline起動smokeを行う。更新には固定旧版A判断の再承認を要求し、候補新版BはCI対象sourceから一度だけbuildする
- 代表地図、ON／OFF別番号正規化、`01a`／`1a`衝突あり・なし、衝突pair swap／厳密減少／完全解消、safe integer境界、1 MiB数字列を巨大`BigInt`化しない境界、mapless、unresolved、`26`／`26c`／`26d`／`26ab`／`26c2`、retained number／token一致・不一致、active／retained owner overlap、同名block、一意番号、重複・領域競合・merge越境、重複物理`(row, col)`、背景色だけで変わるpathfinding graph、0／45／90度pickerのfixtureを作る
- `config/fsmc-fixture-topologies.json`とschema、`tests/fixtures/fsmc/max/manifest.json`を作り、最大healthy topologyをgrid 100×150＝15,000 logical number cell、8,192 block（2-cell block 6,808、1-cell block 1,384）、15,000 split setting、30,000 half region、orientation各3,750、400 item／space／execution visit、normal 400＋postponed 200＋late 200＝最大800 phase visit、単一phase route最大400へ固定する。max healthyではmerge region 0、blocked cell 0を明示し、merge／obstacle／partial-lossは別の固定topology IDへ分離する。manifestはgenerator ID／version／source SHA、seed、canonical serialization、寸法、block／merge／obstacle／visitのexact座標recipe、route connectedness、payload SHA、`dataTopologySha256`、期待root SHA／countsを持つ。OFF referenceとON targetは同じdata topology、通常／集中は同じdata topologyでUI start-state hashだけを変え、generator再実行のbyte一致をI0 Exitで検証する
- `config/fsmc-performance-budgets.json`、runner configに加え、`config/fsmc-performance-shards.json`、plan／shard-result／reduced-resultの各schemaを作る。keyは`${scenarioId}@${profileId}`、基本1 key／shard、OFF reference→target pairだけを同shard・固定順とし、全62 keyを最大54 shardへ割り当てる。`maxParallel: 12`、`failFast: false`、`computedExecutionLimitMinutes: 300`、workflow `jobTimeoutMinutes: 330`、setup／calibration／browser／scenario／cleanup timeoutを固定し、`calibration + Σ(warmupRuns × scenarioTimeout) + Σ(measuredRuns × (scenarioTimeout + cleanupTimeout)) + setup <= 300分`を静的検証する。各shardは同container／browserで製品sample直前に個別calibrationし、別shard／attempt／runから再利用しない。shard resultはrun ID／attempt、source・artifact SHA、shard／plan／budget／runner config SHA、OCI digest、browser revision、requirement／traceability／manifest／topology hashes、calibration、expected／executed keys、warmup、30 measured sample、runner-result SHAを持つ。reducerは全期待shardをcanonical sortし、欠落・余分・重複・stale hash・別attempt・sample混在・OFF順違反を再計算する。I0は`qualification-only`、I1はrunner集合空の`not-required`、I2以降は`product` reduced resultとする
- `config/fsmc-virtual-list.json`をI0のversion付き契約成果物として追加し、`threshold`、`overscanRows`、`maxMountedRows`、`focusModel: "container-activedescendant"`、component別pattern `definition: "multiselect-listbox-external-toolbar"`、`retained: "single-select-listbox-external-toolbar"`、`projectedVisit: "single-select-listbox-external-toolbar"`、`rowDomIdPrefixes: { definition: "fsmc-definition-row-", retained: "fsmc-retained-row-", projectedVisit: "fsmc-projected-visit-row-" }`、scroll alignmentをnon-nullで固定する。retainedとprojected visitによる同じsingle-select pattern値の共有は意図した正規形として許可し、重複component key、値欠落、未知component、component別prefixの欠落／重複、`grid`／roving focusとの混在、生成後row ID衝突、active row未mountのfixtureをschema／semantic verifierで拒否する。I0ではruntime UIを変更せず、I5がdefinition／retained、I8がprojected visitの実装を所有する
- `config/fsmc-failure-injection.json`へbarrier ID、対象command、fault、commit前後のoracle、owner phaseを、`config/fsmc-test-manifest.json`の全test／scenario entryへtest ID、project、層、`requiredCommand`、`enforcedFromPhase`、`releaseScope: "initial-release" | "future"`を固定する。各test IDはexact 1件の`requiredCommand`を持ち、複数IDが同じsuite commandを共有することは許すが、1 IDの0件／複数command対応、result側だけのcommand、traceabilityの`commands`にない対応を拒否する。traceabilityのrequirement scopeとtest scopeをexact一致させ、初版PD／DoDに必要なtestを`future`へ移す変更を拒否する。failure barrierには`after-vcap-history-source-preflight`、`after-vcap-history-source-reread-before-first-write`、`before-vcap-versionchange-commit`、`after-vcap-versionchange-commit-before-open-success`、`after-legacy-rebase-r0-read`、`after-legacy-rebase-r1-before-first-write`、`before-legacy-rebase-commit`、`after-legacy-rebase-commit-before-r2`、`after-legacy-rebase-r2-before-ui`を含める。`config/fsmc-collision-repair-commands.json`へ利用者向け3 command ID、変更可能範囲、owner phase、UI owner、strict-reduction verifierを固定し、内部`fsmc.internal.rebase-legacy-core.v1`がそのallowlistへ入らないことも検証する。future testは`planned`または契約だけを固定した`contract-enforced`であって、初版の選択集合、成功済み、`implementation-enforced`へ入れない
- `config/fsmc-safety-findings.json`は`findingId`、source job／engine、`severity: "Critical" | "High"`、`status: "open" | "closed"`、opened／closed commit、`promotion.kind: "engine-agnostic-required" | "webkit-temporary-required"`、test ID、required command、closure test IDをexactに持ち、test ID／required commandをtest manifestの一意な対応と一致させる。test manifestのsafety entryには`enforcedFromPhase`、`status: "planned" | "contract-enforced" | "implementation-enforced"`、`releaseScope: "initial-release" | "future"`、`artifactMode: "pre-release-production-guard" | "release-production-full" | "qa-chromium-only"`を必須にし、初版traceability／DoDに属するIDを`initial-release`、後続版だけのIDを`future`へexact分類する。`requiredSafetyIds(state)`は、pre-releaseなら`releaseScope = initial-release && enforcedFromPhase <= currentPhase && status != planned && artifactMode = pre-release-production-guard`の全ID、release-readyなら`initial-release`かつ`implementation-enforced`の`release-production-full`と`pre-release-production-guard`の全IDを返す。`release-ready`は、全`initial-release` safety entryが`implementation-enforced`で、`releaseScope = initial-release`の`qa-chromium-only`が0件の場合に限りschema-validとする。future safetyは`planned | contract-enforced`かつ`qa-chromium-only`に限定し、全readinessのselected／executed／result、成功済み、`implementation-enforced`へ入れない。I11最終candidateで`release-production-full`へ移すのはinitial-releaseだけとし、future scopeは全readinessのWebKit集合へ入れない。pre-release production guardは選択0件を禁止し、I2～I10およびI11作業中`internal-testing`のsplit機能safetyはnon-promotable QA artifact上の必須Chromiumへ割り当て、到達不能なproduction WebKit testを成功扱いにしない
- `config/fsmc-webkit-safety-observation.schema.json`は`ciRun`、source SHA、production artifact SHA-256、`selectionMode: "pre-release-production-guard" | "release-production-full"`、implementation-state SHA、test-manifest SHA、Playwright／WebKit version、`requiredSafetyIds(state)`から導出した`manifestSafetyTestIds`、`executedSafetyTestIds`、`{ testId, result: "passed" | "failed" }`のexact結果、`failedSafetyTestIds`、`infrastructureErrors`を共通fieldとしてcanonical unique配列で持つ。全status分岐でresultのtest IDを重複禁止とし、`executedSafetyTestIds = result test IDs ⊆ manifestSafetyTestIds = requiredSafetyIds(state)`、`failedSafetyTestIds = result = "failed"のID集合`を必須にする。future scope／QA-only／未選択IDのresult混入、現在必要IDの欠落、selectionMode／readiness／`ciRun`不一致をschemaとaggregatorで拒否する
- observationのstatusは結果から再計算する。失敗結果が1件以上なら、未実行やinfra errorも併発していても`safety-failed`を最優先し、nonempty `failedSafetyTestIds`と全失敗要因から作る`stableFailureFingerprint`を必須にする。失敗結果0件かつ未実行IDまたはinfra errorが1件以上なら`infrastructure-failed`とし、nonempty `infrastructureErrors`（未実行IDも正規化したerrorとして列挙）とfingerprintを必須にする。全manifest IDを実行し、全結果passed、infra error 0件の場合だけ`passed`とし、failed IDsは空、fingerprintは禁止する。この3分岐以外、矛盾するoverall status、分岐外fieldをschemaとverifierで拒否する。通常表示／a11y失敗は別fieldへ記録し、このstatus unionへ混入させない
- `config/fsmc-webkit-promotion-result.schema.json`は`ciRun`、source／artifact SHA、safety-findings file SHA-256、選択finding／test ID／required command、実行済みID、`{ testId, command, result }`、failed IDs、infra errorsと`status: "not-required" | "passed" | "failed" | "infrastructure-failed"`のexact unionを持つ。open `webkit-temporary-required`が0件の場合だけselected／executed／results／failed／infraをすべて空、fingerprintなしの`not-required`にできる。1件以上ならselected IDsと各required commandをopen findingおよびtest manifestからexact導出し、全status分岐でresult IDを重複禁止、`executed IDs = result IDs ⊆ selected IDs`、各`result.command = manifest.requiredCommand`、failed IDs＝失敗結果IDsを必須にする。失敗結果ありは`failed`を最優先、失敗結果なしで未実行またはinfraありは`infrastructure-failed`、全selected実行・全pass・infraなしだけ`passed`とし、失敗2分岐だけfingerprintを必須にする。常設`webkit-safety-promotion` jobは0件ならWebKitをinstallせず`not-required`、1件以上なら全昇格testを実行して結果を`if: always()`相当で出力する。schema verifierとrelease aggregatorはstatus／commandを信頼せず集合、manifest mapping、優先順位を再計算し、advisoryで安全事故を検出した現在candidateの結果受渡し、次commitでのrequired昇格、release blockingをこの3契約へ固定する
- `infrastructureErrors`は`{ code, stage, testId: string | null }`のexact objectだけを許し、version付きJSON Schemaが`code`／`stage` enumを列挙し、message、stack、path、時刻を入れず`(code, stage, testId)`で重複排除・Unicode code point順sortする。`stableFailureFingerprint`はlowercase 64桁hexで、固定property順・空白なしの`{"schemaVersion":1,"artifactKind":...,"status":...,"failedSafetyTestIds":[...],"infrastructureErrors":[...]}`をUTF-8 encodeしたSHA-256とする。failed IDsもUnicode code point順のunique配列とし、observation／promotionで同じ`serializeFailureFingerprintV1` fixtureを共有する。fingerprintは診断上の同一失敗group化だけに使い、release可否、finding close、結果集合の代替authorityにしない
- FSMC専用required Playwright configにDesktop／Mobile Chromiumの2 projectを、別advisory configにWebKitを作る。requiredはUbuntu 24.04、Node 24.19.0、npm 11.19.0、lockfileのPlaywright／Chromium、workers 1、retries 0、`failOnFlakyTests: true`、`fullyParallel: false`、`trace: "retain-on-failure"`を固定する。Desktopの既定contextは1440×900・DPR 1・`isMobile=false`・mouse・touchなし、Mobileは390×844・DPR 3・`isMobile=true`・touchありとする。さらにDesktop project内の必須manifest testだけが`browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: true })`という固定`desktop-touch-context`を作り、`touchscreen.tap`で非スマートフォンtouch直接選択を検証する。第3 projectや別性能profileにはせず、default Desktop／Mobileとこの追加contextで選択test 0件を失敗させる
- 全jobの共通setupは`npm ci`とし、Chromium test runnerだけは加えて`npm exec -- playwright install --with-deps chromium`を必須にする。WebKit jobは11章と15章の専用install契約に従い、build／artifact verifier／aggregatorへ不要なbrowser installを要求しない。run-bound成果物は共通definitionのexact object `ciRun: { runId: decimal-string, runAttempt: integer >= 1 }`を必須にし、production／QA build manifest、required-results、WebKit observation、promotion resultの全てで、workflow runtimeが与えるcurrent run ID／attemptとのexact一致をaggregatorまで再検証する。`config/fsmc-build-artifact-manifest.schema.json`は`schemaVersion`、`ciRun`、`buildPurpose: production | qa`、`databaseTargetMode`、完全source SHA、lockfile SHA-256、readiness、相対output path、canonicalな全file path＋byte SHA-256、artifact全体SHA-256を必須にする。build jobはproduction／QAを別directoryへ1回だけ生成してmanifestと共にcurrent runへuploadし、別jobはcurrent runだけからdownload後に全hash、`ciRun`、source SHA、`buildPurpose`、`databaseTargetMode`、期待readinessを検証してから`*:prebuilt`を実行する。欠落、上書き、別run／別attempt／別source／別purpose／DB target artifactの取り違えを失敗させる
- `config/fsmc-required-results.schema.json`は`ciRun`、source SHA、implementation-state／test-manifest SHA、currentPhase、readiness、production artifact SHA-256、`qaArtifactSha256: string | null`、manifestから導出したartifact purpose別selected test／scenario ID、実行済みID、`{ id, command, artifactPurpose: "production" | "qa", result: "passed" | "failed" }`、failed ID、infrastructure error、`status: "passed" | "failed" | "infrastructure-failed"`をexactに持つ。I0／I1／release-ready I11はQA hashをnullかつ全result purposeをproduction、I2～I10と`currentPhase = I11 && readiness = internal-testing`はQA hashを必須にし、production guardはproduction、機能／性能testはQAへexact分類する。selected IDsはtest manifestの`releaseScope = initial-release && enforcedFromPhase <= currentPhase && status != planned`を満たす該当purpose集合とし、全status分岐でresult IDを重複禁止、`executed IDs = result IDs ⊆ selected IDs`、各`result.command = selected manifest entry.requiredCommand`、failed IDs＝failed result IDsを必須にする。失敗resultありを`failed`、失敗0件で未実行またはinfraありを`infrastructure-failed`、全selected実行・全pass・infra 0件だけを`passed`と再計算し、選択0件、future scope／planned／未選択IDのresult混入、IDに対するcommand欠落／差替え／曖昧対応、自己申告status矛盾を拒否する。各resultが参照するartifact hash、buildPurpose、source、readiness、phase、`ciRun`、`requiredCommand`をdownload済みmanifestとcurrent workflow runtimeから再計算し、別run／別attempt、stale QA、production／QA取り違え、resultだけのhash／run／command自己申告を拒否する
- 上記exact artifact schemaを補完し、production／QA build manifestは`foundationQualityResultSha256`を必須とする。finalizerだけが生成するrequired-resultsは同fieldに加え、`functionalResultSha256`、`performanceMode: "qualification-only" | "not-required" | "product"`、`performanceReducedResultSha256`、`fixtureTopologyManifestSha256`、`requirementCatalogSha256`、`traceabilitySha256`、`ciPrerequisitesResultSha256`を必須とする。各fieldをcurrent run／attempt／source／artifactへ拘束し、build manifestへbuild後に生成されるperformance resultを逆参照させない。shardごとのrunner-result SHA mapはreduced result内部だけに持たせ、I0はqualification-only、I1は期待shard／runner集合が空のnot-required、I2以降はmanifestが選ぶproductとする
- `config/fsmc-foundation-quality-result.schema.json`は共通quality graph／script hash／選択件数／exit／source／toolchain／`ciRun`／statusを持つ。performanceはplan、shard result、reduced resultの3 schemaへ分け、各shardの同一container内calibrationと製品sampleを一体化する。calibration失敗はsample 0件のinfrastructure failure、measured run timeout／budget超過は製品failed、job hard-timeoutやartifact欠落はreducerがmissing shardとしてinfrastructure failureへ再計算し、overall statusの自己申告を信頼しない
- `config/fsmc-functional-result.schema.json`は`ciRun`、source SHA、current phase／readiness、foundation-quality result SHA、production／QA artifact SHAとpurpose、requirement catalog／traceability／test-manifest SHA、manifestから導出したselected／executed test ID、`{ id, command, artifactPurpose, result }`、failed ID、bounded infrastructure error、`passed | failed | infrastructure-failed`のexact unionを持つ。各functional runnerはtest開始前にcurrent-run ledgerを作り、各test commandの終了を追記する。test processの非0終了、起動前失敗、強制終了で通常finalizeへ到達できなくても、workflowの独立した`if: always()` reporter `finalize:fsmc:functional-result`がledger／job outcomeからschema-validなfailedまたはinfrastructure-failed resultを作る。続くverify／`artifact:fsmc:upload:functional-result`も独立した`if: always()` stepとし、欠落、0 test、未実行、別run／attempt／source／artifact、command差替えをsuccessへ変換しない
- `config/fsmc-ci-prerequisites-result.schema.json`は`ciRun`、source SHA、prerequisite config SHA、確認command manifest SHA、repository／branch、owner role確認、Actions availability、required context接続、GHCR publisher／exact image digest pull、実際の最小permission名、fork PR token方針、各`requiredAt`条件のresult、bounded infrastructure error、`checkedAt`、`passed | failed | infrastructure-failed`をexactに持ち、credential値、token、secret内容、自由記述command出力を禁止する。常設`fsmc-ci-prerequisites` jobはread-only observerを実行し、独立した`if: always()` reporter／verifier／`artifact:fsmc:upload:ci-prerequisites-result`でcurrent-run artifactを必ず生成する。owner不在、API権限不足、Actions／GHCR／required context不在、digest pull失敗、observer起動前失敗を欠落や前run resultで補わない
- `config/fsmc-traceability.json`と`verify:fsmc:i0`を実装し、schema、fixture hash、fixed A、test membership、phase ownership、readiness、production override不在を一括検証する。該当test 0件、重複ID、owner不在、`--passWithNoTests`相当を失敗させる
- `config/test-project-membership.json`、`config/coverage-policy.json`、`config/architecture-policy.json`、dependency usage policy、`.github/workflows/quality.yml`をI0の同じPRで更新し、既存foundation qualityを`fsmc-required-gate`と並列のrequired upstreamとして維持する。新unit／integration／worker／browser testのmembership件数、coverage owner、feature／UIからpersistenceへの禁止edge、Worker assetを機械検証する。FSMC専用commandは0 testやallow-emptyを拒否し、既存一般`test:worker`のallow-empty設定を流用しない。JSON Schema validatorにAjvを使う場合はdirect dependencyへ追加してusage policyを更新し、transitive dependencyの直接importを禁止する
- 固定job／status `fsmc-required-gate`と`verify:fsmc:phase-gate`を実装し、`contracts-only`／`internal-testing`のmerge判定と`release-ready`の`verify:fsmc:release-readiness`呼出しをsource stateだけで切り替える。既存branch-protected終端contextの`needs`へ接続するか、証明不能時は`config/fsmc-ci-gate.json`のRepository Maintainer one-time setupをI0 Exitまでに完了する。全readiness値、phase境界、state／artifact不一致、`releaseScope = future`のtestをpre-release／release candidateで省略するcaseと、そのresultを初版gateへ混入するnegative caseをcontract testにする
- Critical／High severity、初版／後続版、外部証跡なし、`PD-18`の部分欠損と完全消去の保証境界、advisoryで見つかった安全事故のrequired昇格・解消手順をADRと利用者文書雛形へ固定する
- `config/fsmc-requirement-catalog.json`とschemaを作り、normative ID集合を全PD／RC／`DOD-FSMC-001`～`DOD-FSMC-038`／`EXIT-FSMC-I0-001`形式の全Exitにexact限定する。各entryへ`requirementId`、kind、主`sourceAnchor`、IDを除くstatement SHA-256、parent ID、owner phase、release scope、重複なしnonempty `supportingSourceAnchors`を固定する。章2～15のcode fence／見出し／例示だけの行を除く全table row・list itemはexact 1件以上の`supportingSourceAnchors`へ入り、同じ補足が複数要件を具体化する場合はcanonical ID順で全てへ結ぶ。補足本文を別のIDなしnormative authorityとして扱わない。`config/fsmc-traceability.json`は同じID集合にfixture／test／command／implementation symbol／document／statusを対応させ、test manifest全entryのnonempty `requirementIds`とscopeを一致させる。cross-verifierは未追跡または存在しない補足anchor、ID集合の重複・欠落、statement drift、catalog／traceability／test manifestの集合差、初版requirementのfuture化、enforced requirementのfixture／test／command欠落を拒否する。required-resultsはcatalog／traceability SHA、selected／satisfied requirement ID集合を持ち、release gateがinitial-release集合から再計算する
- event settings root／bridge／legacy transition、DB version provenance、guided-delete coverage closure、projection root revision、portable historical owner、profile別bootstrap participantの各schema／configをI0成果物へ登録する。failure injectionには既存Vcap／rebase境界に加え、`after-event-settings-idb-commit-before-shadow-write`、`after-event-settings-shadow-write-before-bridge-ack`、`after-destructive-coverage-snapshot`、`before-guided-delete-coverage-recheck`を含める

Exit:

- **EXIT-FSMC-I0-001** — `npm run verify:fsmc:i0`、production artifact作成後の`npm run verify:fsmc:i0:prebuilt`、`npm run test:fsmc:i0:prebuilt`、固定旧版A hash／起動smokeが成功し、Desktop／Mobile各projectの選択test数が1件以上である
- **EXIT-FSMC-I0-002** — `verify:fsmc:pre-i0-baseline`がrecorded SHAのdetached worktreeで`npm ci`後にclean status、`git diff --check`、再帰展開graph hashが一致する`npm run quality`の成功を再現し、tracked／untracked生成、skip／waiver／known failureが0件である
- **EXIT-FSMC-I0-003** — `config/fsmc-implementation-state.json`の`baselineSourceSha = 2eaba922816e8b263c6479e81ab9f265321654b2`、着手前に一度固定した`i0StartHeadSha`、`currentPhase = "FSMC-I0"`、`readiness = "contracts-only"`がschemaに合格する。`baselineSourceSha..i0StartHeadSha`の全変更file、契約影響、既実装FSMC範囲をinventoryへ記録し、I0実装commitを理由にbaselineまたは`i0StartHeadSha`を追更新しない。固定旧版Aとは混同せず、manifestの全hashが一致する
- **EXIT-FSMC-I0-004** — readinessは`contracts-only`で、production DB、runtime UI、business保存動作を変更せず、production artifactにQA override経路がない
- **EXIT-FSMC-I0-005** — 全schema／fixture／configがversion付きverifierに合格し、番号・CAS・control・identity・collision repair allowlist・fingerprint・retention・Backup・geometry、event-settings root／bridge、atomic `Vcap` bootstrap、3分岐snapshot、authority別candidate配列、root policy／total historical evidence／logical-root mutationとadministrative fence writeの分離、legacy core／shadow transition、destructive coverage closure、projection checkpoint全体digest、portable historical owner、WebKit safety、functional／CI prerequisite always-run result、shard reducer／required-results finalizerのnegative contract testが実行される
- **EXIT-FSMC-I0-006** — `releaseScope = future`のscenarioは`planned`か契約だけを固定した`contract-enforced`で担当phaseとtest IDを持つが、初版のselected／executed／failed集合、planned残存違反、`implementation-enforced`、成功済みへ混入していない。初版requirement／PD／DoDに紐づくentryは全て`initial-release`である
- **EXIT-FSMC-I0-007** — 固定旧版AのV1 unknown／anchor保持・欠落matrixと自己動作が実測済みで、旧版Aのhealthy legacy-mutable-core-only更新、candidateの正常吸収／追加と不正消失／差替え、anchor欠落／重複、衝突、fence／capability破損を区別するrebase fixtureと全barrierがI2／I11へ割り当て済みである。新版Bによるanchor保持、DB fallback、atomic command、Backup V2、UI、性能もI2～I11のExitへ割り当てる
- **EXIT-FSMC-I0-008** — FSMC性能configの全製品上限、62 scenario-profile key、最大54 shard、OFF pair同居順、300分静的実行上限、330分job timeout、runner provider／immutable image／calibration契約が非nullで、全shard bound検証、synthetic missing／duplicate／stale／別attempt resultを落とすreducer、実runnerのqualification-only calibrationが成功する。最大fixture manifestを再生成してpayload／topology／root hashが一致し、OFF／ONが同じ`dataTopologySha256`である
- **EXIT-FSMC-I0-009** — `config/fsmc-virtual-list.json`の全component、listbox pattern、focus model、row ID、scroll／mount契約がschema／negative fixtureに合格し、I0 production artifactにruntime UI変更がない
- **EXIT-FSMC-I0-010** — `config/fsmc-capability-adoption.json`がsource／fixture／legacy A／authoritative provenance manifestから`adopt-vcap`へ再計算され、commit `81795770cca30c68bb1526f989dcd7ab0af1edb4`の同名DB6／`memberRouteItems`を含むdistributed／unknown conflictが0件である。採択不能ならI0 Exitは失敗のまま代替ADRへ送る。固定旧版A archive、change-surface、quality／membership／coverage／architecture policyも全てgreenである
- **EXIT-FSMC-I0-011** — `fsmc-required-gate`がpre-release stateでは現在phaseまでを`phase-gate-passed`にできる一方で公開可能と表示せず、`release-ready` stateでは全I0～I11と`verify:fsmc:release-readiness`なしに成功しない。`fsmc-ci-prerequisites`のowner／checkedAt／read-only command、Actions、最小workflow permissions、GHCR exact digest pull、既存required終端context dependencyまたはone-time required設定が実在し、context名とbranch protectionをphase／findingごとに変えない
- **EXIT-FSMC-I0-012** — `PD-01`～`PD-18`、`RC-01`～`RC-23`、全DoD／Exit IDがrequirement catalog、traceability、test manifestで集合一致し、statement hash、owner phase、release scope、fixture、test、command、利用者文書または非対象理由へ追跡できる

### FSMC-I1: 共通ドメイン

実装:

- `spaceNumber.ts`
- `splitGeometry.ts`
- `EventEnablePreflightResult`のpure判定と、衝突一覧・原文・修正案を返す副作用なしvalidator。control／DB commandへの接続はI2が所有する
- `MapLocationIndex`、item resolver、空側対応hit-test、DOM列挙API
- 通常／集中モード共通viewport adapter
- `layoutMode`から独立した`isSmartphoneSelectionMode`判定と、`none | single | ambiguous`を入力別閾値へ結ぶinteraction policy
- mapped／mapless／legacy-unresolvedの`SpaceIdentity`、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、各canonical keyの型・正規化・生成契約
- 単一revisionの`VisitIdentityInputSnapshot`、`PhaseVisitProjectionSnapshot`、`buildProjectedPhaseVisits` app adapter契約、`planVisitIdentityTransitions(before, after)`。現行`NavigatorItem`を拡張せず、解決済みprojectionだけをspace-navigation consumerへ渡す
- `manualHallId`、hall definition／association／remap、mapped↔mapless、hall-unassigned↔resolvedを含むrekey triggerと、dangling manual hall／複数hall候補を推測解決しないexact reason
- exact番号grammar、巨大`BigInt`化前の桁数／辞書順safe integer検査、`mapped | mapless | legacy-unresolved | ambiguous` resolver
- 1-based `GridCellAddress`、整数`SubcellPathNode`、0-based連続`MapPoint`、結合セルbounds、routing adapter
- map-level authoritative fingerprint、entry-level block／location fingerprintと通常編集planner
- `SpaceSideIdentity`、`ResolvedRouteVisitPoint`、`SplitRouteSegment`、`RouteResolution`
- 分割線境界と低表示サイズ判定
- 表示用原文と識別用番号の分離
- 同一ブロック内の重複番号と重複物理`(row, col)`を配列順で解決せず対象外／`map-data-untrusted`にするvalidation
- 重複block ownership、merge越境、重複mergeを対象外にするvalidation

Exit:

- **EXIT-FSMC-I1-001** — 4方向、分割なし、全番号パターンのunit testが合格
- **EXIT-FSMC-I1-002** — 描画とhit-testが同じgeometry結果を使用する
- **EXIT-FSMC-I1-003** — 回転前後で同じ地図領域を示すproperty testが合格
- **EXIT-FSMC-I1-004** — preflight衝突0件では`01a`と`1a`が同じlocationへ解決され、衝突ありではpure `EventEnablePreflightResult`が`reject`と衝突原文・修正案を返してlegacy identityを維持する。I1ではruntime enable command成功／失敗を主張しない。`26c`／`26c2`と`26d`／`26ab`は相互に異なるidentityとなり、safe integer外や不正文法を数値化しない
- **EXIT-FSMC-I1-005** — 商品なしのa/b側をhit-testとDOM列挙の両方で解決でき、`whole`／unsupportedを「側未設定」と列挙し、重複番号・領域競合・merge越境を推測処理しない
- **EXIT-FSMC-I1-006** — maplessとlegacy-unresolvedを共有訪問projection用identityとして維持し、`MapLocationIndex`、geometry、hit-testへ架空のmap／block／cellを渡さない
- **EXIT-FSMC-I1-007** — `manualHallId` X→Y、X→未指定、未指定→X、hall削除、hall remap、mapped↔mapless、hall-unassigned↔resolvedが固定transitionへ一致する。stable hall IDの表示名変更では`LocationKey`、訪問順、route signatureを変更せず、dangling manual hallと複数候補を別hallへ推測接続しない
- **EXIT-FSMC-I1-008** — `ProjectedPhaseVisit`／`ProjectedVisitListRow`は同一`PhaseVisitProjectionSnapshot`から生成され、mapless／legacy-unresolvedを一覧から落とさず`canJumpToMap=false`とする。代表item、row／col、consumer独自番号parseからvisit IDを再構築しない
- **EXIT-FSMC-I1-009** — `VisitIdentityInputSnapshot`が単一event／day scope、items、重複なし`executionVisitOrder`、item ID順の追加phase tuple、明示3 fieldのsaved phase anchorのexact集合を満たす。currentはanchor nullでもphaseを保持し、event／day不一致、重複・未知・欠落・余分item、phase membership不一致はtyped error、projection 0件となる
- **EXIT-FSMC-I1-010** — 狭幅Desktop profileと`desktop-touch-context`は非スマートフォン規則、Mobile Chromium profileは全倍率pickerとなり、mouse／touchの閾値・曖昧帯の直前／一致／直後と0／45／90度のscreen空間順・DOM順・読み上げ順が固定期待値に一致する
- **EXIT-FSMC-I1-011** — `ProjectionDigestDescriptorV1`が実装の`PersistenceDigestDescriptor`と同じalgorithm／canonicalization／valueの3 fieldだけを持ち、checkpoint nullはabsent、presentは構造全体をdigestする。同committedRootでabsorbedCandidatesまたはupdatedAtだけが違うgolden、root順shuffle、不正descriptorをbuilder／schema／runtimeが同じ結果にする

### FSMC-I2: ローカル制御、DB capabilityと保存基盤

実装:

- I0の`config/fsmc-capability-adoption.json`がprovenanceから`adopt-vcap`へ再計算される場合だけ、DB5→採択済み`Vcap` bootstrap factory、3分岐preflight、repositoryを実装する。internal-testing production artifactは`databaseTargetMode = "core-current"`かつ`DB_VERSION = 5`を維持し、non-promotable QAだけが`fsmc-vcap-qa`を使う。既存profileではE0/E1と全非fence root／candidate selectorのH0/H1一致、導入trace 0件の場合だけ、4 payload root、total historical evidence、existing-profile actual participant集合、全baseline、5 capability rootのmetadata／checkpointを同一transactionで作る。fresh profileは全factory-written non-fence rootをparticipantにする。production `DB_VERSION = Vcap`のownerはI11 release-ready candidateであり、本phaseでは変更しない。adoptionがalternative-witness-requiredなら本phaseを開始しない
- canonical `event-settings`／`event-settings-bridge` migration、`fsmc.internal.reconcile-event-settings-shadow.v1`、pending→shadow→synced resumeを実装する。pending commitはcore／event-settings／bridgeの`logicalRootMutationTuples`をparticipantにし、shadowがbeforeまたはtargetのときだけ続行する。ack transactionはevent-settings payloadをbyte同値に保ちつつ専用ack revision／metadata／checkpointをexact 1段進め、bridgeをsyncedへ進める。両rootだけをparticipantにしてhistorical external digest／baselineをtargetへ揃え、fence payload／metadata／checkpointの物理writeは別の`administrativeFencePhysicalWrites`としてmanifest照合する。第三値はcanonical commitをrollbackせずconflictへ止める。generic fence classifierよりこのstate machineを先に実行し、任意commandのbyte同値participant paddingを禁止する
- split対象導入traceなしの`dbVersion < Vcap`だけを`core-only`、完全rootを`map-cell-split-v1`、`dbVersion >= Vcap`のstore／root欠落・非互換または`dbVersion < Vcap`のsplit対象導入traceありを`map-cell-split-recovery-required`とする3分岐capability fallback。通常core metadata／checkpoint／candidateだけをsplit導入traceへ数えない
- `MapCellSplitSettingsRoot`、別keyの`MapCellSplitControlRoot`、association registry、active／retained entry、schema validation
- `FsmcPersistenceSnapshot`の3分岐union、`(storeName, key)`ごとのfull observed root＋checkpoint＋authority別の型・配列へ分離したidentity／物理location／物理内容witness／absorption projection付きcandidate観測、root policy／lossless candidate vector付きtotal historical evidence／全historical row digest／participant digest／全governed root baseline付きexternal fence、inventory上の全potential candidate storeを空でも同一transactionへ含める専用atomic commandを持つrepository、facade、PersistenceCommandPort
- 固定旧版Aのcandidate／event-settings shadow差分をexact transition manifestへ対応付けるclassifierと、`rebaseParticipantRoots = sort(unique(changed legacy roots ∪ actualCapabilityWrites))`をtransaction instrumentation、置換historical row、participant digest対象へexact一致させるlegacy rebase／shadow reconcile writer
- 初期読込、autosave、再試行、更新ブロッカー
- recovery state、6.1.1のdiagnose／trusted-core export port／eligible atomic resetと、実profileの全object store／削除local keyを閉包検査する`DestructiveProfileCoverageV1`。各targetを`backup-covered | reconstructible-internal | uncovered`へexact 1件分類し、unknown／空だが未登録／schema drift／0件・複数coverageは`incomplete | indeterminate`として`unsupported-stop`、delete 0件にする。破壊直前もexclusive connection下でschema／record root／raw witness／inventory digestを再検査し、resume journalへcoverage manifest SHAとclosure digestを保存する。通常V2 restoreとresetを同じcommandにしない
- 現行CASへの参加と複数タブ競合表示
- `SplitMapLocalControlPort`、端末全体OFF、event別enabled、同一profile内のcontrol CAS。preview／enable／disableのpublic登録はQAとrelease-readyだけとし、pre-release productionは内部codeが存在してもpublic registry／UIを持たず直接dispatchをwrite 0件で拒否する
- I0の`NormalizationCollisionRepairPort` allowlist dispatcher。I6／I7がowner commandを`implementation-enforced`にするまでは対応command IDと通常identity writerを`repair-command-not-implemented`で明示拒否し、通常writerを修復経路として代用しない
- pure `classifyLegacyCoreTransitionV1`と、利用者向けrepair allowlistから独立した内部rebase／event-settings reconcileを実装する。全legacy-mutable core、inventory上の全potential candidate物理store、4 payload root、fenceを同一transactionでlock・再読込し、healthyな旧版差だけについてassociation／status／canonical event settingsとfence history／baselineを原子的に進める。authority正常な`rebase-required | pending`に限りdevice／event／readiness状態に依存せず実行し、完了までsplitをlegacy fallback／read-onlyとする。recovery-required安全モードでは実行しない
- 初回event enableに必要な既存event／day-map／block slotへのローカルinstance ID、empty-source metadata anchor、registry associationを一意なcurrent coreから同一transactionでbootstrapする最小経路。I3はこの共通APIを全event lifecycle writerへ拡張する
- DB／store／root／association authority不正は自動安全モード、個別binding不正はentry単位隔離とする。OFF時はsplit固有部分をlegacy resolver・保存・UI経路へ戻す。本phaseは`PD-14.C2`／`C3`用port／after-image hookと基準source挙動のnon-regressionだけを所有し、共有projection・挿入・経路conformanceの完成を主張しない
- QA database namespaceの初期controlはdevice OFFかつevent ID一覧空とし、readinessを`internal-testing`へ進める。productionはDB5・public command未登録を維持し、QA buildだけが後続testでONにできる
- 初期索引と15,000件schema validationのDesktop／Mobile性能scenarioを本phaseから強制する

Exit:

- **EXIT-FSMC-I2-001** — non-promotable QA artifact／integration harnessで、通常core traceだけのpre-`Vcap` profileは採択可能性を維持し、導入traceが1件でもあればwrite 0件で拒否する。採択時は既存store byte不変、4 payload root、total historical evidence、全row digest、profile別actual participant集合、全baseline付きinitial fence、5 capability rootのmetadata／checkpointが同じversionchange commitに存在する。existing profile participantは4 payload root、fresh profile participantはfactory-written全non-fence rootとactual write log／digest対象がexact一致する。E0/E1差は全abort、commit前は旧version／storeなし、commit後は採択済みVcap／全5 rootのどちらかだけとなる
- **EXIT-FSMC-I2-002** — non-promotable QA artifact／integration harnessのVcap profileを固定旧版Aが開き、従来データを読み書きできる
- **EXIT-FSMC-I2-003** — 固定旧版Aの実行中は新storeのchecksumが変わらず、新版Bへ戻した起動境界でだけroot policyに従うrebaseまたはrecovery判定が行われる
- **EXIT-FSMC-I2-004** — 固定旧版Aのanchor保持改名・通常状態更新は`rebase-required`となり、同じanchor／bindingの設定bytesとstored ONを維持したままfenceを更新してactiveへ復帰する。anchor消失はdormant、同anchor複数はquarantined、旧版編集で作られた衝突はstored ONを保つevent単位effective fallbackとなり、別ownerへの自動接続とdurable state削除が0件である
- **EXIT-FSMC-I2-005** — non-promotable QA artifact／integration harnessで、`Vcap <= dbVersion <= supportedMaximumVersion`の新store欠落・空store・片root／metadata／checkpoint欠落・非互換、fenceの埋込全historical row digest／participant digest／candidate vector自己不整合、root universe／capability-owned baseline不一致はsplit痕跡の有無にかかわらず`map-cell-split-recovery-required`となり、DBを変更せず従来機能、分割機能利用不可理由、6.1.1の復旧runbookを提供する。healthyなlegacy-mutable core差はこの不一致へ含めない。DBなし、または`dbVersion < Vcap`かつsplit対象導入traceなしだけを`core-only`とし、各snapshotで禁止fieldが存在しない
- **EXIT-FSMC-I2-006** — non-promotable QA artifact／integration harnessで、`Vcap - 1`、`Vcap`、supported上限の互換storeありは3 snapshotの該当分岐、`supportedMaximumVersion + 1`以上はsnapshotを構築しない`unsupported-database-version`としてconnection close・authority非採用・write 0件となる。現行5／6／7／8 fixtureはこの境界generatorの期待値と一致する
- **EXIT-FSMC-I2-007** — `dbVersion < Vcap`のcore-only profileは現行core autosave契約を維持してsplit commandを登録しない。QAのhealthy split-capable profileだけは制御commandを登録し、機能mutationをeffective ONで許可する。pre-release productionはDB5、public registration 0件、direct dispatch write 0件を維持する。地図・association・split binding・control・イベント復元は必要rootを原子的にcommitし、片方だけのcommitを起こさない
- **EXIT-FSMC-I2-008** — 新storeの保存失敗が未保存表示とPWA更新抑止へ反映される
- **EXIT-FSMC-I2-009** — 同時writerのstale保存が`PersistenceConflict`となり、部分commitとlast-write-winsが起きない
- **EXIT-FSMC-I2-010** — 既存fenceと全governed rootのexternal E0が不一致、またはraw string exact比較でE0→E1が変化した場合、差がhealthyなlegacy-mutable coreだけなら通常commandをwrite 0件で止めて`legacy-rebase-required`へ送り、それ以外は`PersistenceConflict`／recovery-requiredとする。IDB commit後・UI ack前のE1→E2差もlegacy-onlyなら全new IDB root＋fenceを維持した`committed-legacy-rebase-required`、それ以外は`committed-recovery-required`とする。IDB candidateは表示上のsourceや現在件数でscopeを決めず、inventory上の全potential物理storeを空でもtransactionへ含めて再読込する。pre-transaction canonical bytesとの同期exact比較でempty→insertとidentity／location／physical content／projectionのstaleを全abortし、transaction内で非同期hashを待たない。別scope commandで非参加historical row／baselineを失わず、未保存／rollbackと誤表示しない
- **EXIT-FSMC-I2-011** — DB契約、検証script、integration fixture、性能test configが同じversion契約を示す
- **EXIT-FSMC-I2-012** — `verify:architecture`が合格
- **EXIT-FSMC-I2-013** — 同一sourceの`internal-testing` production artifactはDB5のまま、capability store、split metadata／checkpoint／fenceへのopen／create／writeとpublic split command registrationが0件である。production／QA manifestの`databaseTargetMode`、origin、実open versionが一致し、取り違えをverifierが拒否する
- **EXIT-FSMC-I2-014** — DB capability正常、端末全体ON、対象event ON、自動安全モードなしに加え、`release-ready` production、または`internal-testing`かつcompile-time QA overrideを持つnon-promotable QA artifactの場合だけsplit mutationが成功する。`contracts-only`／`internal-testing` productionはcontrol rootがONでも拒否する。event OFF→ON preview／commandとOFF commandはOFF中にも利用できる
- **EXIT-FSMC-I2-015** — I1の`EventEnablePreflightResult`をevent OFF→ON transactionへ接続し、既存の通常eventとempty-source eventの両方で必要なinstance ID／anchor／associationをI2 bootstrapが原子的に作る。衝突ありではcontrolをONにせずcore、settings、association、metadata、checkpoint、物理location付きrecovery candidate vector、fence baselineを全て旧状態に保ち、衝突原文と修正案を表示する。preview後のroot変更も再検査してstaleなら全abortする
- **EXIT-FSMC-I2-016** — device OFF中にlegacy編集で一部enabled eventへ衝突を作った後にdevice ONへ戻すと、device ON自体は成功し、衝突eventだけがstored membershipを維持したeffective fallback、他のenabled eventがeffective ONになる。I2時点では未所有の3修正commandと通常identity writerを明示拒否し、syntheticな「修正成功」を主張しない
- **EXIT-FSMC-I2-017** — 端末全体OFF／event OFF、別タブによる制御revision変更、再起動、オフラインで固定期待値どおりになる。オフラインだけを理由にOFFへしない。authority正常なlegacy rebaseはdevice／event OFFとreadiness不足でも完了でき、recovery-required安全モードではwrite 0件で拒否される
- **EXIT-FSMC-I2-018** — payload／metadata／checkpoint／fallback／candidate vector、fence evidence／全row digest／participant／root universe／baselineの部分欠損・変化と、`dbVersion >= Vcap`の空storeを未初期化と誤認しない。全potential IDB storeを空でもtransactionへ含め、content-only／projection-only差はexact transitionだけをrebaseする。legacy rebase／shadow reconcileはactual write log、`rebaseParticipantRoots`、置換historical row、participant digest対象をexact一致させる。H0後のpayload／metadata／checkpoint／candidate／external差はfirst write前に全abortし、transaction内async hashを使わない。unknown store／local keyまたはcoverage不完全なguided deleteはconfirm／dispatch不能、write 0件とし、全profile消去だけをverified-complete closureからclean-startする
- **EXIT-FSMC-I2-019** — control変更中、QuotaExceeded、通常commandの各failure barrierのcommit前abortでは全root旧状態、commit後・UI通知前の終了では全root新状態となり、部分commitがない。legacy rebaseのR0→R1差はwrite 0件で再判定し、commit前abortではcurrent core＋rebase前fenceの`legacy-rebase-pending`、commit後終了ではcurrent core＋new fenceだけとなる。R1→R2の追加healthy legacy差は次のrebase、capability-owned／分類不能差はrecovery-requiredとなり、次回境界でも同じ決定結果になる
- **EXIT-FSMC-I2-020** — OFF時のsplit固有表示、番号identity、whole-cell位置解決、core保存結果は固定旧版Aに一致する。本phaseのQA artifactではDB version、capability store、read-only split payload、optional `EventMetadata.splitIdentityAnchor`、I0 inventoryで基準sourceに存在した`PD-14`差分、重複物理cellを新規作成するafter-image拒否、既存重複の`map-data-untrusted`判定だけをphase-aware許容差分とする。`PD-14.C2`／`C3`の新規差分を前倒ししない。production artifactはDB version／capability store差分も持たず、重複を作らない同一入力のcore保存結果、anchorだけを正規化除外したlegacy-core checksum、それ以外の全core field、raw item ID・番号原文を一致させる
- **EXIT-FSMC-I2-021** — `FSMC-I2-RECOVERY-RESET-ATOMIC`と`FSMC-I2-RECOVERY-INELIGIBLE-ZERO-WRITE`が、eligible resetの全旧／全新、store欠落・schema非互換・core不正のwrite 0件、reset後のhealthy再openまでを検証する。event-settings／bridgeまたは対応metadata／checkpoint／candidateの欠落・不正・pending／conflict・shadow不一致はin-place eligibilityを必ず閉じ、両rootがtrusted／syncedの場合だけbyte同値で保持する
- **EXIT-FSMC-I2-022** — 本phase担当のDesktop／Mobile性能上限を満たし、未担当scenarioを合格済みにしない
- **EXIT-FSMC-I2-023** — event-settings migration、IDB commit→shadow前、shadow→ack前の各crashがpendingから冪等再開し、before／target以外のshadowはcanonical rootをrollback・上書きせずconflictとなる。create／rename／delete用root adapterのschema、`logicalRootMutationTuples`、別管理のadministrative fence write集合、ack専用のbyte同値payload＋revision／metadata／checkpoint after-image、generic classifierよりbridgeを先に処理する順序がcontract testに合格する
- **EXIT-FSMC-I2-024** — destructive coverage snapshot→delete再検査間にunknown store／record／local key／schema driftを追加するfixtureはdelete 0件となり、既知target全件がbackup-coveredまたは証明済みreconstructible-internalのときだけguided resetを許す

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

- **EXIT-FSMC-I3-001** — 新版での作成・改名・削除がcore、canonical event settings、split／control／fenceのall-old／all-newとなり、legacy mirror失敗時はcanonical rootを戻さずpendingから再開する
- **EXIT-FSMC-I3-002** — イベント全体複製はsource全root不変、targetとのlocal ID交差0、全参照のgroup-preserving remap、destination OFF、route／hover／dialog等memory-only状態非複製を満たし、取消／stale／quota／重複名／retained／dangling hall fixtureが成功する。import競合`create-alias`をこのcommandとみなすproduction edgeは0件である
- **EXIT-FSMC-I3-003** — 旧版で改名、削除、同名再作成後に誤接続しない
- **EXIT-FSMC-I3-004** — 旧版がanchorを保持する操作ではIDを維持し、anchor欠落・重複時は名前や指紋だけで再接続しない
- **EXIT-FSMC-I3-005** — 安全に識別できない設定は地図へ表示せずretained entryとして保持し、I5の管理UIから理由を確認できるbackendを提供して既存dataを壊さない
- **EXIT-FSMC-I3-006** — 名前だけで再接続せず、端末内の手動再関連付けと明示削除が可能。設定単独出力の入口は初版に設けない
- **EXIT-FSMC-I3-007** — D+29は保持、trustedなD+30は対象だけ削除、31日offlineは正常削除、36日offline・rollback・session jumpは24時間確認後まで延期する。再関連付けと削除はCASで原子的に行い、設定単独出力は提供しない
- **EXIT-FSMC-I3-008** — source switch、bulk add、既存V1 full importがON中に新たな正規化衝突を作るfixtureで全root旧状態とONを維持し、未実装writer commandは明示拒否される

### FSMC-I4: イベント単位Backup V2とV1互換core

実装:

- イベント単位Backup V2
- V1 wire shapeの凍結、V2と同時出力するV1互換core、Backup V1／XLSX 2.2 full restoreの共通legacy restore plannerとdormant preview
- event `scope.references`とruntime snapshotから分離した明示core wire DTO、`snapshotToBackupWireV2`、`backupWireV2ToRestorePlan`。wire moduleから`AppData`／persistence型をimportしない
- 単一eventRef＋全mapRefs、map-level fingerprint、active／retained portable union、companion V1 hash
- canonical `eventSettings`をfull-split／core-mapではexact 1 event wire、item-onlyではtop-level `null`として同じreadonly IDB snapshotから出力し、full／core restoreは復元先event instanceへ同一commitで適用、item-onlyはdestination settings checksumを維持する
- retained priorOwner用にcurrent map／block refsとnamespaceを分けた`ownerMapRef = om-NNNNNN`／`ownerBlockRef = ob-NNNNNN`とhistorical owner tableを発行する。削除済みownerも同値関係を保持し、current linkは一意に解決できる場合だけ付け、importではowner refごとにfresh local IDを1回発行して外部ref文字列をruntimeへ保存しない
- UTF-8 fatal decode、duplicate-property scanner、非再帰depth／token scanner、same-origin module Worker、bounded slice／error、cancel cleanup、CSP／PWA offline asset検証
- 壊れた設定の原子的拒否
- イベント復元の全置換previewと、アイテムimport時の設定維持
- portable参照のローカルID remap、端末内ON／OFFの非収録、新規復元OFF、既存復元先状態維持
- 1主端末、復元先全置換、復元前退避案内、自動同期・自動merge禁止
- 32 MiB performance保証／file、V1／V2 JSON 64 MiB import hard limit／file、XLSX 2.2 compressed 32 MiB＋既存展開limit、V2 32 MiB・companion V1 32 MiB・pair合計64 MiB export generation limitと過大入力の原子的拒否。JSON import best effort、XLSX hard stop、export pair停止を形式／方向別command結果にする
- V1層別互換matrixを維持し、V2だけを全階層exact unknown-key rejectにする
- Backup V2 digestと未知version／未知scope拒否
- scope別exact core section tuple、`deriveEventBackupCountsV2`による実payload件数一致、retained `number`／`originalNumberToken`整合、active／retained owner overlap拒否
- event保証上限超過時は出力を停止し、読めないファイルやmultipartを初版で生成しない
- 全参加storeの単一readonly transactionから`SplitCapableEventExportSnapshot`を1回だけ作り、V2／V1を同じsnapshotから生成する。export途中のDB再読込、cross-revision pair、V1／V2 coreの不一致を拒否する
- `__proto__`／`constructor`／`prototype`を利用者名として安全にround-tripするdynamic key処理
- UIは`File.size`だけを検査して`File`をWorkerへ渡し、main threadで`file.arrayBuffer()`／`file.text()`を呼ばない。Workerは1 MiB sliceでstreaming decode／scanし、raw bytes、全文string、DTOの三重保持を避ける
- `classifySafeExternalUrl`とbranded `SafeExternalHref`をV1／V2／XLSX／CSV／通常編集、`CellItemsPopup`、`ShoppingItemCard`へ適用する。V2／CSV／新規編集のunsafe URLは全拒否、V1／XLSX 2.2／既存profileは`legacy-compat`でraw textを維持して非link表示にする。空文字、control／bidi code point全境界、strict／legacy policyのarchitecture testを持つ
- `PersistenceCommandPort`へasync readonly event export snapshot、atomic restore、recovery trusted-core exportを追加し、concrete IDB処理は`src/persistence`だけが所有する。`useEventTransferCommands`はportを呼び、`appOverlayState`をV1／V2／XLSX 2.2 preview unionとWorker lifecycleへ更新する
- Backup import／exportのDesktop／Mobile性能scenarioを本phaseから強制する
- event ON中のimport／restore after-imageが正規化衝突を新たに作る場合の`PD-16`全拒否

Exit:

- **EXIT-FSMC-I4-001** — V1、XLSX 2.2 full、地図を含むがsplitを含まないV2を読め、map置換では対象の既存split設定をpreview後にdormant化し、V1／XLSX 2.2 item-only importでは維持する
- **EXIT-FSMC-I4-002** — 複数地図eventのV2で4方向とactive／dormant／quarantinedを往復でき、V2がSHA-256で拘束したexact V1互換coreを固定旧版Aへ復元できる
- **EXIT-FSMC-I4-003** — 簡易XLSX・CSVに分割設定が含まれない
- **EXIT-FSMC-I4-004** — mapDataを置換する復元だけが設定を同時に置換またはdormant化し、item-only importでは設定checksumが不変
- **EXIT-FSMC-I4-005** — external refをローカルinstance ID／`priorOwner`として採用せず、未解決entryには新しい`dormantEntryId`を発行し、不正参照・hard limit超過をDB更新前に拒否する
- **EXIT-FSMC-I4-006** — 形式不正は全体拒否し、復元先不一致だけをdormant／quarantinedとして保持する
- **EXIT-FSMC-I4-007** — V2 digest不一致、未知version、未知scope、local ON／OFF fieldを拒否する
- **EXIT-FSMC-I4-008** — `full-split`／`core-map`で明示wire DTOの対象event全10 sectionとevent settingsを欠落なく往復し、`item-only`は`eventLists`以外のdata sectionを拒否する。runtime section追加は自動伝播させずadapter exhaustiveness testとschema version判断を要求する。3 scopeそれぞれでmaps／blocks／items／active／retained countを実payloadから再計算し、正しいdigestでも過少・過大自己申告、`scope.references`水増し／省略をDB更新前に全体拒否する。retained number／token不一致とactive／retained overlapも全体拒否する
- **EXIT-FSMC-I4-009** — full／coreのcanonical event settingsがexact round-tripし、item-onlyは既存destination checksum不変、新規destinationはdefaultとなる。V1 companionも同じIDB snapshotから生成し、bridge pending／conflict中はpair 0件である
- **EXIT-FSMC-I4-010** — deleted map、current map＋deleted block、同じmissing owner共有、見た目同一だが別owner、current-linked active overlapのfixtureでhistorical owner同値関係とinjective remapを往復し、owner tableのduplicate／orphan／multi-link、外部owner ref永続化を拒否する
- **EXIT-FSMC-I4-011** — 保証上限内の自アプリ出力をround-tripでき、超過時はファイルを生成せず理由を表示する
- **EXIT-FSMC-I4-012** — clean profileへの新規復元はOFF、既存イベントへの復元は復元先のローカル状態を維持し、両端末の変更をmergeせず選択したV2へ原子的に置換する
- **EXIT-FSMC-I4-013** — 本phase担当のDesktop／Mobile性能上限を満たし、pair片方のhandoff失敗を完了扱いにしない
- **EXIT-FSMC-I4-014** — ON中に衝突を作るimport／restoreはcore、settings、association、controlを一切変更せず、復元先eventをONのまま維持して衝突原文と修正方法を表示する
- **EXIT-FSMC-I4-015** — 同時writerを挟んでもV1とV2が同一snapshot revisionを表し、明示transform以外のcore差がなく、片方だけを別revisionから再生成しない
- **EXIT-FSMC-I4-016** — XLSX 2.2 full restoreはpreviewどおり既存activeだけを`legacy-full-restore-without-split-settings`でdormant化し、既存retainedのstatus／reason／evidence／IDをbyte同値で維持してcore／association／controlと同一commitになる。item-onlyではmap／split／control checksumが不変である。取消、stale、quota、commit前終了は全旧、commit後終了は全新だけとなる
- **EXIT-FSMC-I4-017** — `javascript:`、`data:`、`file:`、credential付きURL、control／bidi文字を含むV2／CSV／新規編集はcommit前に全拒否し、同じ値を含むV1／XLSX 2.2／既存profileはraw値を壊さず非linkになる。空文字はURLなしとなり、raw item URLからReact `href`への直接edgeが0件である
- **EXIT-FSMC-I4-018** — production CSPを`worker-src 'self'`のまま維持し、online／offlineで同一origin Backup Workerを起動できる。success／error／cancel／timeout後のWorker、reader、timer、transaction、Blob URL残留が0件である
- **EXIT-FSMC-I4-019** — `core-only`へsplit payloadを直接commitせず、独立したcapability bootstrapとhealthy再open後の別preview／別commandだけを許す。`recovery-required`では6.1.1のeligible resetとhealthy再open後、またはclean profileでだけ通常restoreへ進める

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
- **EXIT-FSMC-I5-007** — コピー先の同owner＋番号にretained履歴があれば両copy modeで除外理由を表示し、履歴と重なるactiveを作らない。明示再関連付けだけが選択retainedをactiveへ原子的に状態遷移し、取消・stale・失敗時は元retainedだけが残る
- **EXIT-FSMC-I5-008** — retained reconnectの0／1／2候補、target occupied、candidate stale、同時tabを検証し、1件だけが全旧／全新でactive化され、非選択retainedとhistorical owner evidenceはbyte同値である
- **EXIT-FSMC-I5-009** — 端末全体OFFではsplit管理導線を閉じる。device ON・event OFF・authority正常では有効化previewとretained再関連付け／削除だけを許可し、definition／copy mutationを拒否する。自動安全モードではread-only診断とBackup案内だけを許可し、UIからローカル制御gateを迂回して保存commandを呼べない
- **EXIT-FSMC-I5-010** — QA buildで全UI試験を完了するが、production navigationとenable commandはI11まで非公開のままである
- **EXIT-FSMC-I5-011** — 本phase担当のDesktop／Mobile p95、main-thread task、memory上限を満たす
- **EXIT-FSMC-I5-012** — `CellSplitDefinitionPanel`／retained管理の最大15,000行で検索、virtual scroll、先頭／末尾移動、filter後focus復元、dialog往復をkeyboardだけで完了でき、listbox／option、`aria-selected`、`aria-setsize`／`aria-posinset`／`aria-activedescendant`がfiltered集合と一致する。row内interactive descendant、grid role、roving focusとの混在が0件で、Tab後の固定toolbarがactive／selected IDだけをcommandへ渡す
- **EXIT-FSMC-I5-013** — I5が所有するannouncement dispatcherへsuccess、cancel、no-op、conflict、将来のglobal統合を表すsynthetic eventを渡すcontract testで、status通知がeventごとにexact 1回、rerenderで再通知0件となる。実際のglobal統合とのintegrationはI7 Exit、route挿入とのintegrationはI10 Exitが所有する。light／darkのtoken contrast verifierとforced-colors browser testが成功し、axeだけをCanvas contrastの証明にしない
- **EXIT-FSMC-I5-014** — recoveryの全reachable decision tupleがread-only export可否、eligible reset、guided profile reset、unsupported stopのexact 1分岐へ対応し、unsupported DB、別tab blocked、backup不足、取消時はprofileを変更しない
- **EXIT-FSMC-I5-015** — guided resetのdelete前、DB削除直後、local key削除途中、clean profile作成直後、restore plan record commit直後、journal plan CAS直後、restore commit直後、ack直前で再起動しても、surviving journal／control recordと実DB digestからexact 1 next actionを再計算する。journal／plan／remap／expected after-image／backup hash不一致と未知状態はwrite 0件、compatible build／migratorがなければ対応buildへ誘導し、成功ack後はresume artifact 0件、origin全消去は通常clean-startとなる
- **EXIT-FSMC-I5-016** — guided reset previewはruntime inventoryの全store／local keyとcoverage rowがbijectionし、未知・余分・欠落・重複・schema drift・snapshot後raceを全てwrite 0件にする。canonical event settingsをbackup／restore coverageへ含め、DB6 conflict fixtureの`memberRouteItems`等、lossless planがないstoreは明示unsupported-stopになる

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
- I1のpure `planVisitIdentityTransitions`をafter-imageへ適用し、I6 QA commandはdurable execution order／phase anchorsまでcore／splitと同一commitする。production公開と残る全writerの有効化はI7 Exitまで禁止するが、I6 editor／reimport自身を`visit-projection-owner-not-ready`で試験不能にしない
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
- **EXIT-FSMC-I6-011** — previewの`manualHallId`除去、hall remap、mapped／mapless遷移、split status、route invalidation件数がpure after-image planと一致する。I6 QA commandはI1のtransition applicatorでdurable visit状態まで単一commitし、I7は残る全writerのconformanceとproduction公開を所有する
- **EXIT-FSMC-I6-012** — 番号変更、merge／unmerge、lossy merge拒否、keyboard-only cell address／矩形選択／preview／取消を検証し、stale／quota／取消はwrite 0件、成功はmapData、association、evidence、entry status、durable visit stateを全旧／全新にする。逆操作も新しいpreviewを通り、隠れたdirect undo writerが0件である
- **EXIT-FSMC-I6-013** — 本phase担当のreimport preview／commit性能上限を満たす

### FSMC-I7: 既存データidentity migrationと共有訪問投影

実装:

- 基準source `2eaba92`に部分実装済みの`PD-14.C2`共有訪問projectionをconformance auditし、未適合writer／通常・集中画面／一覧／space-navigationを補完する。経路、hit-test、cache、route insertion anchorの`PD-14.C3`はI10が所有する。FSMC-I1で固定済みのmapped／mapless／legacy-unresolved `SpaceIdentity`、番号正規化、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、canonical key APIを全既存dataと利用箇所へ適用する
- `buildProjectedPhaseVisits`をapp composition rootへ実装し、`MapView`、`FocusModeContainer`、`FocusMode`、`MapVisitListPanel`、space-navigationへ同一`PhaseVisitProjectionSnapshot`を渡す。`NavigatorItem`、旧`buildVisitIdentity`、代表item、row／colからON時identityを再構築するconsumerを除去する
- 同一revisionのcanonical `SpaceIdentity`からだけ`ProjectedVisitResolutionSummary`を生成し、同一execution visit内の全memberでbyte一致を検査する。一致しなければ`inconsistent-resolution-summary`としてprojection全体を拒否し、代表member選択や配列順で解決結果を決めない
- raw実行商品ID配列をglobal sortせず、非連続な同一`ExecutionVisitIdentity`を配列全体で集約する。legacy初回はraw配列の最初の出現順から重複なし`executionVisitOrder`を生成し、以後はこのordered key arrayをbase訪問順authority、raw配列をmember順authorityにする。全nonempty execution visitとのexact bijectionを保つ
- 日程、ブロック、番号、side、優先度、`manualHallId`、hall definition／association／remap、mapped↔mapless編集でidentityが既存destinationへ変わる場合の、変更itemだけをdestination member末尾へ移す決定的rekey plannerと、item ID対応から現在・保存位置の`PhaseVisitIdentityKey`を再解決する処理
- normalは全実行商品、後回し・遅参は追加phaseとしてbase順から生成し、1商品が複数phaseへ属せる共有projectionを通常マップ、集中モード、`MapVisitListPanel`／`ProjectedVisitList`、space-navigationへ提供する。I10向けには同じsnapshotを入力portとして公開するが、本phaseでroute conformance成功を主張しない
- 通常の実行列・候補列と同じ優先度別グループ規則への統一
- 既存訪問順、後回し、遅参データをphase-major `normal → postponed → late`へ互換変換し、各phase内は同じbase `executionVisitOrder`をfilterする。全phase最大800を単一active routeへ混在させない
- 旧`phaseIndex`／`savedPhaseIndices`からrekey前にitem ID anchorを取得し、`current: { phase, anchorItemId }`とnormal／postponed／late別saved anchorへ決定的migrationする。anchor nullでもphaseを保持し、消失時は同phaseの旧位置以降、直前、先頭、nullの順で解決し、別phaseへfallbackしない。`isCompleted`は変更しない
- memory-only `FocusModeSessionState.lastPurchaseChangeAt`相当は商品IDから新`PhaseVisitIdentityKey`へexact 1件再解決できる場合は移し、0件または複数件なら`null`へして理由を利用者へ通知する。解決不能値を架空visitへ接続せず、再解決可能値を一律破棄しない
- unsupported番号tokenを含む既存訪問migration。item／row-col中心の経路点から`PhaseVisitIdentity`中心のroute型への変換はI10へ割り当て、I7では変換fixtureとinput portだけを固定する
- `ProjectedPhaseVisit`ではmember商品IDをpayloadとして保持し、代表item IDをvisit identity、route、hit-test、挿入anchorへ流用しない
- event ON中の商品編集・item import after-imageが新しい正規化衝突を作る場合の`PD-16`全拒否。自動OFF、部分適用、黙示skipを行わない
- `NormalizationCollisionRepairPort`の`fsmc.repair.item-numbers.v1`、`fsmc.repair.orphan-visit-state.v1`、I6の地図修正をまとめる衝突修復UI。孤立状態破棄は選択`PreZeroIdentityKey`のcurrent item参照0件をcommit内で再検証し、変更・破棄内容を明示previewする
- I6まで`visit-projection-owner-not-ready`だったmap／hall identity変更commandを同じpreview digestから有効化し、durable現在位置／保存位置／phase stateをcore／split planと同一commitで移送する。memory-only cacheはcommit成功後だけ破棄する
- 400 item rekey／projectionのDesktop／Mobile性能scenarioを本phaseから強制する

Exit:

- **EXIT-FSMC-I7-001** — preflight衝突0件の`01a`と`1a`だけが同じ半領域anchorへ解決され、衝突時は機能ONを拒否してlegacy identityを維持する
- **EXIT-FSMC-I7-002** — 同じ側・同じ優先度は1つの`ExecutionVisitIdentity`へglobal集約され、進行区分ごとに別`PhaseVisitIdentity`へ投影される
- **EXIT-FSMC-I7-003** — 同じ側でも優先度が異なれば別execution／phase訪問として維持される
- **EXIT-FSMC-I7-004** — raw `[A1, B, A2]`を並べ替えず、通常／集中／一覧／space-navigationではnormal `[A(A1,A2), B]`へ一致して投影する。I10 route fixtureも同じ期待snapshot IDを参照するが、本phaseの実行結果へ含めない
- **EXIT-FSMC-I7-005** — 新destinationでsourceにmemberが残る場合はsource直後、sourceが空ならsource slotを継承し、同じanchorへの複数destinationはbefore最小source order→canonical key順となる。既存destinationは位置維持、利用者insert anchorは新destinationだけに効き、全結果の`executionVisitOrder`がexact bijectionになる
- **EXIT-FSMC-I7-006** — A1を既存B identityへ変更した場合、B訪問位置と他itemの相対順を維持してA1だけをB member末尾へ移し、変更元visit、現在位置、保存位置、phase集合を新`PhaseVisitIdentityKey`へ決定的に再解決する。route anchorの移行はI10 Exitで同じfixtureへ追加する
- **EXIT-FSMC-I7-007** — 投影済みvisitの先頭memberを削除しても同じidentityのmemberが残る場合は、同じ`PhaseVisitIdentityKey`と訪問位置へ再解決する。座標、経路順、route cacheはI10 Exitで検証する
- **EXIT-FSMC-I7-008** — normal＋postponedへ属する同一item、3 phase別saved anchor、空phase current、anchor削除、`isCompleted=true`のfixtureがphaseを失わず決定規則へ一致する。runtime-only `lastPurchaseChangeAt`はexact 1 visitだけ移送し、0／複数はnull＋reason通知となる
- **EXIT-FSMC-I7-009** — callback中にpayload root、checkpoint absorbedCandidates、checkpoint updatedAtのいずれかだけが変化した場合もprojection revisionが変わり、stale mutationはwrite 0件となる
- **EXIT-FSMC-I7-010** — `01a`と`1a`の既存訪問が衝突0件で安全に統合できる場合も商品・raw順・後回し・遅参を失わない。item、保存済み訪問・順序・進行状態等のdurable stateは自動破棄0件とし、破棄できるのは`fsmc.repair.orphan-visit-state.v1`で利用者が選択しitem参照0件を再検証した対象だけとする。再計算で捨ててよい非永続状態は未commitのprojection、route cache、hover／tap candidate、未確定preview、および商品IDへ一意再解決できないmemory-only `lastPurchaseChangeAt`に限定する。`lastPurchaseChangeAt`は一意なら新`PhaseVisitIdentityKey`へ移し、不能／曖昧時だけ`null`と理由通知にする
- **EXIT-FSMC-I7-011** — FSMC-I8以降が確定済みidentity APIだけを利用できる
- **EXIT-FSMC-I7-012** — OFF切替でsplit identityをlegacy keyへ永続的に破壊変換せず、ON復帰時に商品ID・順序から決定的に再構築できる
- **EXIT-FSMC-I7-013** — mapped、mapless、legacy-unresolvedの訪問が通常／集中／一覧／space-navigationで失われず、mapped以外に架空の地図位置を与えない。I10のroute consumerはmapped以外を`no-routing-port`として扱う契約fixtureだけを参照する
- **EXIT-FSMC-I7-014** — event ON中の商品編集・item importが新しい正規化衝突を作る場合は全store書込み前に操作全体を拒否し、core、settings、association、metadata、checkpoint、control ONを旧状態に保って、衝突原文と修正方法を表示する
- **EXIT-FSMC-I7-015** — 3つのallowlist commandだけが衝突fallback画面から到達でき、全て同じ`ExpectedRootVector`、`previewDigest`、期待`C(before)`を再検査する。item修正、map修正、item参照0件の孤立訪問状態破棄の各fixtureでstrict decreaseだけが成功し、pair swap、同数置換、新規pair、stale、選択外変更は全root旧状態となる
- **EXIT-FSMC-I7-016** — 修正後もpairが残ればstored enabledを維持したeffective fallbackと残件表示を継続し、`C(after) = ∅`のcommit後だけ対象eventが自動でeffective ONへ復帰する。他eventのeffective状態、split設定、選択外item／訪問状態を変更しない
- **EXIT-FSMC-I7-017** — `manualHallId` X→Y、X→未指定、未指定→X、hall削除、hall remap、mapped↔maplessが決定済みafter-imageへ一致し、stable hall IDの表示名変更では訪問順とidentityを変えない。ON runtimeからlegacy `buildVisitIdentity(block, number)`へのproduction edgeが0件である
- **EXIT-FSMC-I7-018** — 実際の商品追加・rekeyによるglobal統合がI5のannouncement dispatcherへstable event IDを1回だけ発行し、通常マップ、集中モード、買い物一覧、`MapVisitListPanel`／`ProjectedVisitList`で同じstatus textをexact 1回通知する。rerenderやsnapshot再配布で再通知しない
- **EXIT-FSMC-I7-019** — member順shuffle、先頭member削除、destination統合でresolution summaryが不変かつsnapshot indexがexact bijectionであり、不一致fixtureはtyped error、projection 0件、write 0件、常設status通知となる

### FSMC-I8: 通常マップ

実装:

- locationKey単位の状態索引
- `MapView`を通常マップ側のconsumerとし、I7の`PhaseVisitProjectionSnapshot`を通常マップと`MapVisitListPanel`／`ProjectedVisitList`の唯一の訪問入力にする。panel内の商品再集約、番号parse、block検索、row／col dedupeを廃止する。route hit-testへの接続はI10が所有する
- 半領域描画、分割線、正立する条件付きラベル、`LocationPresentationState`
- スマートフォン常時picker、非スマートフォン入力別閾値direct hit、曖昧時no-op案内
- 狭幅PCを含む端末判定adapterと利用者override
- 共通Pointer gesture state machine
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
- **EXIT-FSMC-I8-006** — pan、pinch、pointer cancel、capture喪失、layout切替後にpopupを誤表示しない
- **EXIT-FSMC-I8-007** — 本phase担当のDesktop／Mobile p95、main-thread task、memory上限を満たす
- **EXIT-FSMC-I8-008** — normal Desktop direct 150 ms／Mobile picker 200 msの各scenario-profile keyがreduced resultにexact 1件あり、I9 focus scenarioを前倒し成功扱いにしない
- **EXIT-FSMC-I8-009** — `MapVisitListPanel` shellがopen／close、filter、focus restoreを維持し、pure `ProjectedVisitList`の選択／挿入callbackが`PhaseVisitIdentityKey`だけを渡す。row／col、代表item、stale location payloadへ縮退しない
- **EXIT-FSMC-I8-010** — Canvas semantic tokenのlight／dark contrast unit test、forced-colors固定screenshot、非色覚手掛かり、theme変更時再描画が成功し、DOM代替導線と表示状態が一致する

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
- I8と同じsemantic presentation tokenを`FocusModeMapCanvas`へ接続し、light／dark／forced-colors changeで再描画する。番号、a/b、状態、選択、現在ring、marker stackを色だけで区別しない
- DOM panelはrow／col callbackではなく同じsnapshotから作った`ProjectedVisitListRow[]`を入力し、`onSelectVisit(visitId)`で選択する。各行にpriority、phase、member件数、mapless／unresolved状態を文字で表示し、同じanchorの別visitを区別する
- 集中モードの最大fixture描画・操作scenarioを本phaseから強制する
- `FocusModeSessionState` adapterがcurrent phase付きanchor、phase別saved anchor、completion、runtime-only lastPurchase anchorを共有snapshotへ接続し、phase切替・空phase・rekey後もI7規則どおり復元する
- `split-direct-popup-focus-desktop`と`split-picker-popup-focus-mobile`を別scenario／単一profileで本phaseから強制する

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
- production bundleのreadinessを`release-ready`、`databaseTargetMode`を`fsmc-vcap-production`へ変更し、`DB_VERSION = Vcap`をproductionで初めて有効化する。I2の現行core DB version、`Vcap - 1`、`Vcap`、supported上限、上限＋1のmigration／partial-loss／A→B→A→B matrixを同じrelease-ready production artifactで全再実行し、QA override不在と端末／event有効化導線の初回公開を静的検証する
- WebKit advisory runnerが通常表示／a11y結果と安全性tag結果を分離し、`if: always()`相当で`fsmc-webkit-safety-observation.json`を出力する。常設`webkit-safety-promotion` jobもregisterに応じた結果artifactを必ず出力する。release-readiness jobは同一source SHA・production artifact SHA-256の両artifact upload完了をDAG dependencyとして待ち、hash検証後に取り込む

Exit:

- **EXIT-FSMC-I11-001** — Desktop／Mobile Chromiumの必須自動テストを通過
- **EXIT-FSMC-I11-002** — データ消失、a/b混同、誤経路が0件
- **EXIT-FSMC-I11-003** — 必須自動テストでCritical／High相当の既知失敗が0件
- **EXIT-FSMC-I11-004** — Backup V2＋V1互換core、V1／XLSX 2.2 full restore、機能OFF／安全モード→ONの復旧、新規復元OFF、既存復元先状態維持を確認
- **EXIT-FSMC-I11-005** — release-ready production artifactが`databaseTargetMode = fsmc-vcap-production`、実open version `Vcap`であり、I2のmigration／partial-loss／固定旧版A互換testを全て再実行する。DB5 production artifactやQA namespace resultの流用を拒否する
- **EXIT-FSMC-I11-006** — WebKit advisoryの通常表示／a11y失敗は必須Chromium jobと分離し、iPhone／ペン／OS・実機固有挙動を保証対象と表記しない。ただし同一candidateのWebKit safety observation欠落、hash不一致、`safety-failed`、`infrastructure-failed`、`requiredSafetyIds(state)`の現在必須ID未実行はrequired gateを失敗させる
- **EXIT-FSMC-I11-007** — 必須Chromiumと通常advisory WebKitが別job／別scriptで実行され、WebKit browser未導入は必須Chromium job自体を失敗させない。release gateはadvisory observationと常設promotion resultを必ず待つため、初回安全事故をregister追加前にすり抜けさせず、branch protectionのrequired contextを動的変更しない
- **EXIT-FSMC-I11-008** — 性能、PWA multiclient、backup、旧新版互換を通常のCI testとして実行し、外部receipt、実イベントpilot、managed-device artifactを要求しない
- **EXIT-FSMC-I11-009** — foundation quality、test membership、coverage policy、architecture policy、production／必要時QA manifest、functional result、performance reduced result、CI prerequisite resultのcurrent-run artifactとhashがrequired-resultsへ含まれ、いずれかの欠落・重複・stale・失敗ではsource固定readinessを変更せず、required gateを失敗させて配布を許可しない
- **EXIT-FSMC-I11-010** — 固定旧版Aのhealthy legacy-mutable-core-only更新は新版Bで自動rebaseして分割設定を正しいowner／statusへ復元し、capability-owned差、fence自己不整合、説明不能差はrebaseせず安全モードにする。rebaseのcommit前／後終了を含め、別ownerへの誤接続、durable state削除、部分commitが0件である
- **EXIT-FSMC-I11-011** — candidateのraw DOMString-only／IDB canonical record-content-only差を物理内容witnessで検出し、固定旧版Aのexact transitionに一致する場合だけrebaseする。manifest外、曖昧一致、projection-only改変はBackup案内付き安全モード、通常command中の差は全store write 0件のCAS abortとなる
- **EXIT-FSMC-I11-012** — `verify:fsmc:release-readiness`が、build前からsourceへ固定済みの`release-ready`と同一artifactについて、`releaseScope = initial-release`の全requirement、owner phase、required test、performance budget、failure barrier、利用者文書、production override不在を検証し、成功時だけ配布を許可する。verifierはreadinessを書き換えず、`future` entryの未実装は初版失敗にしないが、そのresult混入または初版entryのfuture誤分類は失敗にする
- **EXIT-FSMC-I11-013** — recoveryの全reachable decision tupleがexact 1 runbook actionを持ち、unsupported DBは常にwrite 0件のstop、全適格条件を満たすresetは全旧／全新、supportedだが不適格でbackup／connection前提を満たす場合だけguided reset、その他はwrite 0件となる。clean profile recoveryは再起動後の正常snapshotまで成功し、unsafe URLのclickable sink、Worker／reader／timer／Blob URL残留、untrusted split採用が0件である
- **EXIT-FSMC-I11-014** — advisory WebKitの通常の表示／a11y失敗自体はnonblockingである。ただし安全性tagがデータ消失、a/b混同、誤保存、誤復元を検出した現在candidateはobservationを`safety-failed`として必ずrelease停止し、次commitでstable finding IDを`config/fsmc-safety-findings.json`へ`status: "open"`で登録する。engine非依存に再現できる場合はunit／integration／Chromiumのrequired回帰testへ移し、WebKit固有で再現不能な場合はその最小WebKit回帰testをpromotion kind `webkit-temporary-required`へ昇格し、常設`webkit-safety-promotion` jobが実行する。`verify:fsmc:release-readiness`はcurrent-run observation異常、promotion result欠落／不一致／失敗、open finding、required command未実行、昇格test失敗のいずれかが1件でもあればrelease-readyを拒否し、修正・再現test成功・current-run observation成功・finding close後にだけ通常advisoryへ戻す

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

別fixtureとして、横長結合セル、縦長結合セル、非連続`cellGroups`、同形状ブロック、不一致ブロック、重複block ownership、merge越境、重複merge、同一`(row, col)`でvalue／backgroundが異なる物理セルを用意する。重複・競合は対応ケースではなく負例fixtureとし、保存・コピー・自動継承・経路生成から安全に除外されることを確認する。背景色だけの通行可否変更で`pathfindingGraphFingerprint`とroute cacheが変わる正例も固定する。

永続化・ファイルfixtureには、`EventMetadata`のないevent、複数map event、利用者名が`__proto__`／`constructor`／`prototype`のdata、V1層別unknown、XLSX 2.2 full／item-only、duplicate JSON property、invalid UTF-8、深さ境界、3 scopeのV2、全scope共通`scope.references`、実payload一致／不一致`counts`、V2＋hash拘束V1、32／64 MiB境界、unsafe URL scheme／control／bidi、Worker cancel／offline、payload／metadata／checkpoint／fallback／candidate identity・authority・physical location・physical content witness・absorption projection／fence historical evidence・全historical row digest・participant digest・全root baseline／storeの部分欠損、同じexternal keyのlone surrogateだけが異なるraw DOMString、historical candidate external digestとbaselineの不一致、通常core traceだけのDB5、split対象traceだけのDB5、`H0`後に旧tabがcore root／candidateを変更するDB5、origin全消去、eligible／ineligible recovery、delete前／後終了、イベント削除D+29／D+30／31日／36日、時計rollback／session jump／24時間再確認を含める。固定旧版A fixtureにはanchor保持改名・通常状態更新、候補の一意な正常吸収／追加、吸収証跡なし消失、同一absorption projectionでlocationが異なる曖昧候補、anchor欠落、同anchor複数化、衝突作成、capability-owned差、fence自己不整合、説明不能なcore差、device／event OFF中rebase、rebase commit前／後終了を含める。ローカル制御fixtureは端末全体OFF、event OFF／ON、自動安全モード、個別entry隔離、別tabによるcontrol revision変更、offline、新規復元OFF、既存復元先状態維持、Backup内の禁止ON／OFF fieldを含める。さらに3.13の保証規模を同時に満たす最大fixtureを用意する。

### 10.2 必須マトリクス

| 観点              | 必須ケース                                                                                                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分割              | なし、左a、右a、上a、下a                                                                                                                                                                                                                                                    |
| 番号identity      | 衝突なしpreflightで`01a`／`1a`／`０１ａ`が同一、衝突ありとOFFではlegacy維持、ON中の新規pair・同数pair swapは全拒否、厳密減少・完全解消、BigInt前safe integer／1 MiB境界、mapless／legacy-unresolved、unsupported分離、「側未設定」表示                                      |
| 訪問identity      | 非連続同一execution identityのglobal集約、同側異優先度、異側同優先度、normal＋後回し／遅参、最大400 execution／800 phase、raw手動順、既存identityへの挿入指定無視、manualHallId／hall定義・remap、mapped↔mapless、dangling／複数hall、stable hall表示名変更                 |
| 形状              | 通常、横長結合、縦長結合、非連続block、番号重複、重複block ownership、merge越境、重複merge、重複物理`(row, col)`                                                                                                                                                            |
| 回転              | 0°、15°、45°、90°、180°、270°、359°、screen空間・DOM・focus順、a/b・badge文字の正立                                                                                                                                                                                         |
| DPR               | 1、2、3                                                                                                                                                                                                                                                                     |
| 拡大・端末判定    | Mobile Chromiumは全倍率picker、狭幅Desktopは非スマートフォン、入力別閾値・曖昧帯の直前・一致・直後、空間順ラベル、利用者override、アプリ倍率、200%                                                                                                                          |
| 入力              | mouse、touch、長押し、drag、pinch後の片指継続、Canvas外pointerup、Pointer Cancel、lost capture、画面回転、layout切替                                                                                                                                                        |
| 状態              | 空、巡回対象外、未処理、処理済み、後回し、遅参、後回し＋遅参二重指定拒否／既存診断、優先度混在、同側複数件                                                                                                                                                                  |
| 集中追加          | 購入済、後回し、遅参、実行対象外のみ、空側                                                                                                                                                                                                                                  |
| 編集              | 単一、複数、一括解除、既定の追加・変更のみ、明示的完全同期、コピー先ID維持、retained overlap除外・手動再関連付け、履歴保護、解除preview、非連続block、manual改名・移動・同名置換、取消、保存失敗                                                                            |
| 再取込・通常編集  | 無関係変更、一意移動、欠落、重複、結合範囲変更、旧版変更検出、休眠・隔離、manualHallId除去／remap、mapped↔mapless、core／split複合digest、片側stale、取消                                                                                                                   |
| DB互換            | DBなし、現行core DB version、`Vcap - 1`／`Vcap`／supported上限のwitness・互換・partial-loss・不正store、supported上限＋1拒否、現行5／6／7／8 provenance fixture、fence不整合、legacy rebase、I2～I10 production current／write 0、QA Vcap分離origin、I11 production初回Vcap |
| ローカル制御      | code存在／public登録／到達／認可／commitのmatrix、端末・event ON／OFF、安全モード、一部event fallback、revision競合、commit直前OFF、再起動、オフライン、Backup非収録、新規復元OFF、既存復元先状態維持、pre-release direct dispatch write 0                                  |
| entry binding状態 | active、dormant、quarantined、同一map内の混在、number／original token整合・不一致、active／retained overlap拒否、地図では非表示・管理UIでは表示、端末内手動再関連付け、即時削除、retention、初版にportable単独出力なし                                                      |
| 複数タブ          | 同一root vector同時編集、先行commit、stale拒否、複合操作rollback、再読込後の再編集                                                                                                                                                                                          |
| PWA世代混在       | 旧SW＋旧tab、新SW waiting、新旧tab同時、versionchange blocked、update blocker、close／reopen                                                                                                                                                                                |
| 障害注入          | QuotaExceeded、通常commandとlegacy rebaseの全barrierのcommit前／後、browser終了、control変更、network切断、payload／metadata／checkpoint／candidate vector／store欠損・変化、origin／profile完全消去                                                                        |
| 復元              | V1／XLSX 2.2 fullとmapあり・splitなしV2の休眠preview、両legacy item-only時の設定維持、scope別exact core、references／counts、複数map V2、hash拘束V1、取消、新規／既存、全置換・merge禁止、external ID非採用                                                                 |
| 復旧              | open結果・canonical reasons・eligibility・backup・connection→runbook exact 1件、trusted-core export、eligible atomic reset、不適格write 0、別tab blocked、delete前／後終了、backup hash再選択、clean profileからV2／V1／XLSX 2.2復元、別origin非削除                        |
| 入力安全          | JSON import各fileの32／64 MiB境界、XLSX compressed 32 MiB＋展開／圧縮率境界、fatal UTF-8、duplicate property、非再帰depth／token、1 MiB数字、総entry、重複ref、retained不整合、未知version／scope／control、unsafe URL、same-origin Worker、cancel cleanup                  |
| 規模              | 15,000セル、最大8,192ブロック、15,000設定、30,000領域、400アイテム、400売場、400 execution訪問、最大800 phase投影、単一phase経路400、保証境界超過                                                                                                                           |
| ファイル総量      | performance保証32 MiB／file、JSON import hard 64 MiB／file、XLSX compressed hard 32 MiB＋展開limit、export V2 32 MiB・V1 32 MiB・pair 64 MiB、各境界直前／一致／+1、countとbyte境界の逆転、形式別stop／best effort、V2 digest、未知version拒否                              |
| 形式              | Backup V1/V2、初版legacy XLSX 2.2 full／item-only。XLSX 2.3、multipart、設定単独JSONが初版に露出しないarchitecture test                                                                                                                                                     |
| A11y／DOM         | 15,000行検索・virtualization・keyboard・focus復元、status exact 1回、light／dark token contrast、forced-colors、Canvas以外の全操作                                                                                                                                          |
| 品質統合          | test membership、coverage、architecture、foundation quality、required-results hashのcurrent-run成功。0 test、allow-empty、wire→runtime型、UI→persistence、raw URL→href、blob/data Worker edge拒否                                                                           |
| 互換              | 旧版A→新版B→旧版A→新版B、anchor保持時のfence rebase、anchor欠落時dormant、重複時quarantined、衝突時effective fallback、capability差の安全モード                                                                                                                             |
| 経路              | a/b別anchor、安全な同一セルa→b、main path／種別付きconnector、自セル領域内port、unsafe-connector、unroutable、同anchor別phase訪問、共有projection、PhaseVisitIdentityKey基準のhit-test／挿入、先頭member削除、pathfinding graph変更、重複物理cell拒否                       |
| アクセシビリティ  | DOM詳細、空側追加、同anchor候補、一時移動、Canvasなし経路挿入、DOM／Canvas別focus復帰、結果通知                                                                                                                                                                             |
| 自動テストprofile | Desktop／Mobile Chromiumの固定viewport、DPR、入力能力、retry 0、固定fixture                                                                                                                                                                                                 |

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
13. 採択済み`Vcap`以上かつsupported上限以下のprofileでnew store／必須5 capability rootが欠落・非互換なら、他の導入痕跡がなくてもpartial-loss安全モードで開き、DBを変更せず従来機能、分割機能利用不可理由、canonical runbookを表示する。DBなしまたはpre-`Vcap`かつ導入traceなしの`core-only`、pre-`Vcap`だが導入traceありのrecovery-requiredを区別し、supported rangeの`db-version` witnessはexact 1件・値一致、pre-`Vcap`は0件とする。supported上限超過はsnapshot外`unsupported-database-version`、write 0件とする
14. dormant／quarantined設定の端末内手動再関連付けと削除についてpreview取消・確定を確認する。同owner＋番号のretainedがある通常設定・copyは除外し、明示再関連付けだけが元retained除去＋active化を原子的に行い、設定単独portable出力の入口が初版にないことを確認する
15. Backup V2はpreview後に既存イベントを全置換し、自動mergeしない。新規復元はOFF、既存復元は復元先ON／OFFを維持し、Backup内のローカル制御fieldを拒否する
16. `26`または非対応番号だけが登録された分割セルで左右とも誤割当てせず、中央badge、DOM一覧、分割有効化previewへ「側未設定」と件数を表示する
17. `26c`／`26c2`は同じexecution訪問、`26d`／`26ab`は別訪問のまま中央anchorの件数badgeへ表示する
18. 同じanchorの異なる優先度・phaseを中立markerへ重ね、DOM候補一覧で別`PhaseVisitIdentity`として選択できる
19. 横長結合セルのrouting portと半領域anchorを自セル領域内の安全な点線connectorで接続する。領域外または障害物横断が必要なcaseは`unsafe-connector`で`unroutable`とし、同一セルa→bにも同じ規則を適用する
20. block改名・移動では設定を維持してevidenceとanchorを原子的に更新し、重複番号・merge越境では対象entryだけをquarantinedにする
21. pinch後の片指離し、Canvas外pointerup、lost capture、画面回転、layout切替後にpopupが誤って開かない
22. イベント削除画面の既定が「30日保持」で「今すぐ完全削除」が別選択であること、D+29の端末内再関連付け、正常時計のD+30対象限定cleanup、時計異常時の延期をfake clockで確認する
23. 旧版A tabと新版B、SW waiting、versionchange blocked、QuotaExceeded、transaction各段階abort、browser強制終了で部分commitがない
24. `__proto__`等の利用者名をV2で往復し、不正ref、未知version／scope、hard limit超過、unsafe URL scheme／制御文字／bidi spoofをV2／CSV／新規編集ではDB更新前に拒否する。V1／XLSX 2.2／既存profile由来の同じunsafe URL文字列は`legacy-compat`でraw値を保持してもlink化せず、全href sinkが`SafeExternalHref`以外を拒否する。空文字はURLなしとして受理する
25. 別日程・別地図コピー、XLSX 2.3、multipart、設定単独JSON、意図的再訪の初版UI・command・routeが存在しないことをarchitecture testで確認する
26. 日程、ブロック、番号、side、優先度、`manualHallId`、hall削除／remap、mapped↔maplessの編集でA1のexecution identityを既存Bへ変え、B訪問位置と他itemの相対順を維持してA1だけをB member末尾へ移す。変更元visit、現在位置、保存位置、後回し・遅参、routeの`PhaseVisitIdentityKey` anchorが全画面で同じ結果へ再解決される。dangling manual hallは`missing-manual-hall-reference`のlegacy-unresolved、複数hall候補は`multiple-hall-owners`のambiguousとして非routeableにし、異なるdangling `manualHallId`を統合せず、表示名変更だけではidentityを変えない
27. 同じphase visitの先頭memberを削除しても残存memberがある場合は、DOM panel、route、hit-test、挿入操作が同じ`PhaseVisitIdentityKey`へ再解決され、座標、順序、route cacheが変わらずmember件数だけが更新される。DOM panelの選択・挿入callbackがrow／colや代表item IDではなくvisit IDを渡すことも確認する
28. event ON中に商品編集、source switch、既存event bulk add、item import、V1 full import、legacy XLSX 2.2 full import、Backup V2復元、通常地図編集、地図再取込の各操作で`01a`／`1a`衝突を新規作成し、各操作が全store書込み前に拒否され、元data、settings、anchor、association、control ONが維持されることを確認する
29. mapped、mapless、legacy-unresolvedの商品を同じraw実行列へ置き、共有訪問projectionが全identityを保持する一方、mapless／unresolvedに架空のmap cell、marker、route anchorを作らないことを確認する
30. payload、metadata、checkpoint、runtime fallback、identity／authority／物理location／物理内容witness／absorption projection付きrecovery candidate vector、capability store、fence historical evidence／全historical row digest／全root baselineの各部分欠損・cross-invariant不一致では自動安全モードとなる。同じexternal key／identity／locationでraw DOMStringをlone surrogate間だけ変更した場合もUTF-16 code unit witness差として検出する。参加rootについてinventoryが列挙する`syncQueue`等の全potential IDB storeをsnapshot時emptyでも同transactionへ含め、別transactionやtransaction内WebCryptoを待たず、candidateのempty→insert、消滅、内容変更をCAS abortする。非参加rootを含むexternal candidateをcommit前またはIDB commit後・post-check前に変更した場合、healthyなlegacy-mutable coreだけならそれぞれwrite 0件の`legacy-rebase-required`または全new IDB rootを維持した`committed-legacy-rebase-required`とし、capability-ownedまたは分類不能な差ならそれぞれwrite 0件のrecovery-requiredまたは全new IDB root＋完全baseline fenceの`committed-recovery-required`とする。別scope commandでfenceを更新しても非参加historical row／baselineを消去せず、再起動でも同じ分類となる。origin／profile全消去では空profile、device OFF、enabled event ID 0件で開始し、消去dataの自動復旧や保持成功を表示しない
31. 複数map eventのV2とSHA-256で拘束されたV1を生成し、V2のfull core全sectionとV1 coreが明示transform以外で同値、V2は新版へ、exact V1 bytesは固定旧版Aへ復元できることを確認する。さらにlegacy XLSX 2.2 full／item-onlyをpreviewし、fullはevent coreを全置換してsplitをdormant化、item-onlyはmap／splitを維持し、いずれもstale／cancel／validation失敗でwrite 0件とする。片方のdownload handoff失敗を完了扱いにせず、再生成案内を表示する
32. 経路計算後に`backgroundColor`だけで通行可否を変え、`pathfindingGraphFingerprint`差により古いcacheを破棄して再計算する。同一`(row, col)`の重複cellを作るimport／通常編集はON／OFFとも原子的に拒否し、既存重複cellを並べ替えても一方を採用せず、当該mapの経路を安全に停止する
33. item-only V2は`eventLists`以外のdata sectionを含めず既存map／splitを維持する。全3 scopeで`scope.references`が実data slotと一対一で一致し、`deriveEventBackupCountsV2`の全5値が自己申告`counts`と一致する場合だけ受理する。full-split／core-mapでmetadata、実行順、day mode、route／hall／viewportのいずれかを欠落・余分にする、または正しいdigestのままcounts／referencesだけを水増し・省略するとpreview前に全体拒否する
34. device再ON後の衝突fallbackでitem番号修正、map identity修正、current item参照0件の孤立訪問状態破棄をそれぞれpreviewし、strict decreaseだけを原子的に確定する。pair swap、同数置換、新規pair、stale、通常writer経由は全拒否し、完全解消commit後だけ対象eventがeffective ONへ戻る
35. 通常core metadata／checkpoint／candidateだけのDB5は`core-only`のまま、split対象metadata／checkpoint／candidateだけのDB5は`map-cell-split-recovery-required`となる。導入trace 0件のDB5→`Vcap`では`after-vcap-history-source-preflight`後に旧tabが非fence rootのpayload／metadata／checkpoint／candidateを1件でも変更すると、versionchange内`H1`の同期byte比較で最初のwrite前に旧DBのままabortする。`after-vcap-history-source-reread-before-first-write`後のfault、external `E0/E1`差、transaction内split IDB traceも同じく全abortし、transaction内WebCrypto／別async taskを使わない。DB5→`Vcap`と新規DB 0→`Vcap`をversionchange commit直前でabortすると旧version／storeなし、commit直後から`onsuccess`前で終了すると`data`／`control`／`event-settings`／`event-settings-bridge`、lossless candidate vector付きtotal historical evidence／全historical row digest／participant digest／全governed root baselineを持つinitial fence、5 capability rootのmetadata／checkpointが全て存在する。既存DBのlegacy rowは`H1`、capability payload rowはfactoryが実際に書いたcanonical after-image、fence rootはhistorical rowなし／baselineのみであり、導入前のabsent capability payload rowを保存したfenceを拒否する。新規DBは全non-fence root writeとevidenceが同じfactory値で一致する。commit後終了は次回起動でinitial fenceと全rootを検証し、差なしは正常、healthy legacy-only差は全new DBからrebase、それ以外の差は全new DB＋fenceのrecovery-requiredとなる。採択済みVcap以上の運用後空store、fence欠落／埋込全historical row digest・participant digest・candidate vector・historical/baseline cross-invariant・root universe・capability-owned baseline不一致は再初期化せず`map-cell-split-recovery-required`となる。このmigration oracleはI2では`databaseTargetMode = fsmc-vcap-qa` artifactだけで実行し、同candidateのproduction artifactがDB5／公開command 0件を維持することも対で検証する。I11 release-readyでは初めて`fsmc-vcap-production` artifactへ同じoracleを再実行する existing profile participantは4 payload root、fresh profile participantはfactory-written全non-fence rootとactual write log／digest対象へexact一致し、bridge crashはpendingから再開する
36. 同じproduction artifactでWebKit safety testをpass、safety failure、browser install／起動失敗、observation欠落、source／artifact hash差替えにし、passだけがcurrent-run gateを通る。通常表示／a11yだけの失敗はobservationのsafety statusを偽装せずnonblockingとなる
37. WebKit observation、promotion result、required-resultsについて、`status = passed`なのにfailed resultあり、failed IDと結果集合の差、`requiredSafetyIds(state)`／selected ID未実行、selected外result混入、promotion／required-resultsの正しいIDへ別testのcommandまたは未登録commandのpassを付ける、infra併発、open findingありの`not-required`、分岐外fingerprintをそれぞれ投入し、schemaとrequired aggregatorが集合包含、ID→required command対応、statusを再計算して全て拒否する。pre-releaseへ`releaseScope = future && status = contract-enforced && artifactMode = pre-release-production-guard`のID、future planned、`qa-chromium-only` IDを混入する、現在phaseのinitial-release production guard IDを省略する、release-readyでinitial safetyを非`implementation-enforced`または`qa-chromium-only`のまま残す、full safety IDを省略する、selectionMode／readiness／manifest hashを差し替えるcaseも拒否する。production／QA build manifest、required-results、observation、promotionのいずれか1つだけを別run IDまたは別attemptにしたcaseもcurrent workflow runtimeとの不一致で拒否する。安全assert失敗とinfraが併発した場合は安全失敗を優先し、安全失敗0件で未実行またはinfraがある場合だけinfrastructure failureとなる
38. 新版Bのfence作成後に固定旧版Aでanchor保持改名・通常状態更新を行い、Bで`rebase-required`→`fsmc.internal.rebase-legacy-core.v1`となる。candidate消滅はcheckpoint descriptorとprevious rowの`absorptionMatchProjection`がexact 1件一致する場合だけ正常吸収とし、0件、null、または同一projectionでlocation違いの旧entryが複数ある場合はrecovery-requiredにする。同じidentity／locationのraw DOMString-only／IDB record-content-only変更はlegacy transition manifestのexact 1件へ一致する場合だけrebaseし、未列挙・曖昧・projection-only変更はrecovery-requiredにする。new fenceのparticipant tupleと置換historical rowは`sort(unique(changed legacy roots ∪ actualCapabilityWrites))`にexact一致し、通常core-only rebaseの`actualCapabilityWrites`だけが`{data, control}`、shadow reconcile併用時はack after-imageどおり`event-settings`／`event-settings-bridge`も含む。administrative fence writeは別manifestへexact一致し、非参加rowをbyte同値で維持する。device／event OFFとreadiness不足でもauthority正常ならrebaseし、authority不正では拒否する。R0→R1の追加変更はwrite 0件で最新snapshotから再試行し、rebase commit前終了はcurrent core＋rebase前fenceのpending、commit後・R2前終了はcurrent core＋new fenceとして再開する。R1→R2の追加healthy legacy差は次のrebaseへ送り、capability-owned／分類不能差は確定済みrootを維持して安全モードにする。anchor欠落／重複／衝突のstatus期待値を確認し、fence自己不整合と説明不能なcore差もrebaseせずBackup案内にする
39. recovery-required画面から診断`fsmc.recovery.diagnose.v1`を生成し、trusted coreだけをV1へ退避する。eligible caseは別tab／接続を閉じ、選択済みBackup hashを再照合してsplit stateだけを単一transactionでresetする。ineligible caseはwrite 0件のまま二段階確認付きclean-profile手順へ進み、delete前終了では元profile、delete後終了では空profileとして再開し、別originを削除しない
40. Backup workerはmain threadでwhole-file `arrayBuffer()`／`text()`を呼ばず、1 MiB以下のsliceでV1／V2 JSONの32 MiB保証境界と64 MiB hard limit、XLSX 2.2のcompressed 32 MiBと展開後limitの直前／一致／+1を判定する。cancel、timeout、malformed UTF-8、worker crash、offline PWA起動後の再実行でWorker、reader、timer、transactionを残さず、`worker-src 'self'`のままblob／data workerを作らない
41. `CellSplitDefinitionPanel`／retained管理の15,000行で検索、filter、virtualization、container focus＋`aria-activedescendant`によるkeyboard移動、選択、閉じて再表示したfocus復元を完了する。別fixtureの`MapVisitListPanel`／`ProjectedVisitList`は最大800 phase訪問で選択・挿入・focus復元を完了する。両方で処理結果ごとに常設`role=status`領域がexact 1回だけ更新され、light／dark／forced-colorsで非色覚手掛かりを維持する
42. test membership、coverage、architecture、foundation qualityの各verifierへ0 test、allow-empty、未登録command、wire→runtime型import、UI→persistence import、raw URL→href、blob／data Worker edge、別run／別artifact hashの偽装成功を投入し、個別testがpassedでもrequired gateが必ず拒否する

### 10.4 アクセシビリティ試験

キーボード・画面読み上げによるCanvas半セルの直接選択だけは対象外だが、非スマートフォンのmouse／touch直接選択、スマートフォンpicker、次のDOM代替導線は必須とする。mouseはDesktop既定context、非スマートフォンtouchは同じDesktop project内の`desktop-touch-context`、pickerはMobile projectで実ブラウザ入力まで検証する。

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

`config/fsmc-performance-budgets.json`へNode 24.19.0、npm 11.19.0、lockfileで解決した`@playwright/test` versionとChromium revision、workers 1、viewport、DPR、touch／mobile能力、`warmupRuns: 1`、`measuredRunSamples: 30`、run開始状態、run内aggregation、run間`nearest-rank-p95`、単位、timeout、`enforcedFromPhase`、`scenarioRole: "product" | "off-reference"`を記録し、verifierで実行環境と照合する。runner identityは別の`config/fsmc-performance-runner.json`へGitHub Actions、`ubuntu-24.04` runner class、owner `Repository Maintainer`、`infra/fsmc-perf-runner/Dockerfile`由来のrepo-owned GHCR image名とexact OCI digestとして固定し、budget変更とrunner変更を分離する。`samples`という曖昧fieldは設けない。各scenarioは`offComparison: { required: boolean, referenceScenarioId: string | null }`を必須とし、`required=true`なら同profile・同fixture・同candidate buildの一意な`off-reference` scenarioを参照し、falseなら`referenceScenarioId=null`とする。referenceは自分や別profileを参照せず、targetの直前に独立process／runSample集合で測る。通常マップと集中モードは別scenario ID・別runSample集合とし、同じ絶対上限を共有できるがobservation／runValueを混ぜない。既存の`config/performance-budgets.json`は別機能の外部証跡契約であり、FSMC scenarioを追加せず、同fileのpending状態をFSMC-I0 blockerにしない。

`ubuntu-24.04`の移動aliasだけでは性能判定に使わない。runner configへ`runnerProvider: "github-actions"`、runner label／class、`executionMode: "container"`、immutableなOCI digest、`architecture: "x64"`、OS／kernel、CPU model allowlist、logical CPU数、cgroup v2 CPU quota、memory limit、swap disabled、job isolation／co-tenancy契約を固定する。I0 Exitは実在digestをpullしてDockerfile source hashと対応付けるため、未解決placeholder、moving tagだけ、host直実行を受理しない。job開始時にprovider metadata、`/proc/cpuinfo`、`/proc/meminfo`、cgroup CPU／memory、swapを検証し、固定calibration fixtureを同じbrowserで測ってI0固定band内であることを確認する。環境field不一致、取得不能、calibration範囲外はinfrastructure failureとしてsampleを採用せず、製品性能の合否を出さない。上限値とrunner envelopeの変更は別々にdiff・reviewできるようにする。

5秒操作scenarioでは、連続する各pointer／wheel入力の受付から次のpaintまでを`inputObservation`とし、入力のないidle frameを加えない。各measured runはpan、zoom、rotationを各10 observation以上含み、そのrun内の全inputObservationを昇順にしたnearest-rank p95を`runInputLatencyP95`＝runValueとする。30個のrunInputLatencyP95から求めるscenarioP95が下表のinput-to-next-paint上限を満たし、さらに全30 runの全main-thread task observationが後述の絶対上限を満たす。入力不足を短い高速runとして採用しない。

各scenarioは、timed区間外でfixtureをseedした直後のroot hashを固定し、run後の期待root hashまたはwrite 0件を検証する。scenarioごとにbrowser processを再起動し、同一scenarioのwarmupと30 measured runだけでそのprocessを共有する。各runは新規BrowserContext／page／temporary originから開始し、HTTP cache、IndexedDB、service worker、PWA offline状態はscenario定義どおりにseedする。前runのindex、Worker、transaction、DOM、route cache、download object URLを持ち越した場合はcleanup失敗とする。

全scenarioに非nullの絶対上限を設定し、比較可能な既存操作だけは絶対上限に加えて、同じCI run・同じbuild・同じprofileで直前に測る機能OFF p95からの悪化10%以内も満たす。次の数値は暫定測定値ではなく`PD-17`の製品上限である。厳格化は通常reviewで行えるが、緩和は新しい製品判断ID、理由、影響、期限の有無を記録し、製品判断者の承認と通常code reviewを必須とする。

OFF比較はexactに、`map-first-render-normal → off-map-first-render-normal`、`map-first-render-focus → off-map-first-render-focus`、`map-interaction-normal → off-map-interaction-normal`、`map-interaction-focus → off-map-interaction-focus`の4組だけを`required=true`とする。referenceは同じ最大fixtureを端末全体OFF・event OFFで開き、targetは同fixtureをhealthy effective ONで開く。他のproduct scenarioと全off-reference自身は`required=false, referenceScenarioId=null`とする。4 referenceも下表の独立scenario、初版manifest entry、絶対上限、適用phaseを持ち、未実行、targetより後の実行、異なるbuild／profile／fixture hash、reference resultの再利用を失敗させる。

| scenario ID／対象                                                             | Desktop Chromium CI p95 | Mobile Chromium emulation CI p95 | 適用開始 |
| ----------------------------------------------------------------------------- | ----------------------: | -------------------------------: | -------- |
| `startup-preflight-index`：preflight＋初期索引＋15,000件validation            |                1,500 ms |                         3,000 ms | I2       |
| `local-control-toggle`：端末／event制御のpreview＋commit                      |                1,000 ms |                         2,000 ms | I2       |
| `legacy-rebase-commit`：最大fixtureのhealthy legacy差rebase                   |                2,500 ms |                         5,000 ms | I2       |
| `backup-v2-v1-export`：V2／V1各32 MiB以下・pair 64 MiB以下の生成／handoff     |                5,000 ms |                        10,000 ms | I4       |
| `backup-v2-parse-preview`：32 MiB以下のV2 worker parse＋validation＋preview   |                5,000 ms |                        10,000 ms | I4       |
| `backup-v2-restore-commit`：最大fixtureの全置換commit                         |                3,000 ms |                         6,000 ms | I4       |
| `xlsx22-full-restore`：legacy XLSX 2.2 full parse＋preview＋commit            |                7,500 ms |                        15,000 ms | I4       |
| `event-enable-preview`：15,000設定の有効化preview                             |                1,500 ms |                         3,000 ms | I5       |
| `event-enable-commit`：15,000設定の有効化commit                               |                2,500 ms |                         5,000 ms | I5       |
| `single-split-save`：単一分割設定のvalidation＋commit                         |                  250 ms |                           400 ms | I5       |
| `copy-preview`：15,000件の追加・変更／完全同期preview                         |                1,500 ms |                         3,000 ms | I5       |
| `copy-commit`：15,000件copyの原子的commit                                     |                2,500 ms |                         5,000 ms | I5       |
| `definition-list-first-render`：管理panelの15,000 active行初回virtualized表示 |                  750 ms |                         1,200 ms | I5       |
| `definition-list-filter-input`：active設定の検索入力から次paint               |                  100 ms |                           150 ms | I5       |
| `retained-list-first-render`：管理panelの15,000 retained行初回virtualized表示 |                  750 ms |                         1,200 ms | I5       |
| `retained-list-filter-input`：管理panelの検索入力から次paint                  |                  100 ms |                           150 ms | I5       |
| `map-reimport-commit`：最大fixtureの複合reimport plan＋commit                 |                3,000 ms |                         6,000 ms | I6       |
| `visit-rekey-projection`：400商品／最大800 phase投影のrekey＋snapshot再構築   |                  750 ms |                         1,500 ms | I7       |
| `off-map-first-render-normal`：最大fixtureの通常マップ初回描画、機能OFF       |                1,500 ms |                         2,500 ms | I8       |
| `map-first-render-normal`：最大fixtureの通常マップ初回描画                    |                1,500 ms |                         2,500 ms | I8       |
| `projected-visit-list-first-render`：最大800 phase訪問のDOM一覧初回表示       |                  500 ms |                           800 ms | I8       |
| `projected-visit-list-filter-input`：最大800 phase訪問の検索入力から次paint   |                  100 ms |                           150 ms | I8       |
| `off-map-first-render-focus`：最大fixtureの集中モード初回描画、機能OFF        |                1,500 ms |                         2,500 ms | I9       |
| `map-first-render-focus`：最大fixtureの集中モード初回描画                     |                1,500 ms |                         2,500 ms | I9       |
| `off-map-interaction-normal`：通常マップ5秒操作、機能OFF                      |                  100 ms |                           150 ms | I8       |
| `map-interaction-normal`：通常マップ5秒操作input-to-next-paint                |                  100 ms |                           150 ms | I8       |
| `off-map-interaction-focus`：集中モード5秒操作、機能OFF                       |                  100 ms |                           150 ms | I9       |
| `map-interaction-focus`：集中モード5秒操作input-to-next-paint                 |                  100 ms |                           150 ms | I9       |
| `split-direct-popup-normal-desktop`：direct half hit→popup paint              |                  150 ms |                                — | I8       |
| `split-picker-popup-normal-mobile`：cell tap→picker→side選択→popup paint      |                       — |                           200 ms | I8       |
| `split-direct-popup-focus-desktop`：direct half hit→popup paint               |                  150 ms |                                — | I9       |
| `split-picker-popup-focus-mobile`：cell tap→picker→side選択→popup paint       |                       — |                           200 ms | I9       |
| `route-recalculate`：単一phase 400訪問の経路再計算                            |                  750 ms |                         1,500 ms | I10      |

- main thread taskは全measured runで観測した各taskが200ms以下とし、p95へ隠さない。1秒を超える処理は進捗表示と取消を提供する
- memory metricは固定Ubuntu runner上で、browser-level CDP `SystemInfo.getProcessInfo`が返す同一candidate Chromiumのbrowser、renderer、Worker、utility、GPU各PIDを`memoryObservation`ごとに列挙し、各`/proc/<pid>/smaps_rollup`の`Pss`をbyteへ変換して合算する。各measured runの開始時に全discoverable page／Worker targetの`HeapProfiler.collectGarbage`後のbaselineを取り、scenario中100ms間隔の各PSS合計をmemoryObservationとする。そのrunの最大値との差を`runPeakDelta`、画面終了、Worker／Blob URL／timer／transaction cleanup、30秒待機、再GC後の1観測との差を`runResidualDelta`とする。終了したPIDは次observationで0、新規PIDはその時点から加算し、同じbrowser外のprocessを含めない。CDP field、PID、`smaps_rollup`、PSSのいずれかを取得不能ならRSSやrenderer heapへfallbackせず当該runとscenarioを失敗させる
- 30個の`runPeakDelta`と`runResidualDelta`をそれぞれ独立にnearest-rank p95へ集約する。peak scenarioP95はDesktop CIで256 MiB、Mobile emulation CIで192 MiB以下、residual scenarioP95は両profileで64 MiB以下とする。MobileはChromium emulation processの指標であり、特定スマートフォンの物理memory保証ではない
- timeout／cancel後にWorker、timer、Blob URL、transactionを残さない
- 描画ごとに全商品と全セルを総当たりせず、`MapLocationIndex`を再利用する
- V1／V2 JSON importは各fileが32 MiBのperformance保証上限を超え64 MiB hard limit以下なら警告付きbest effort、64 MiB超ならparse前に拒否する。XLSX 2.2は`config/xlsx-limits.json`のcompressed 32 MiBと全展開limitをhard stopとして優先し、64 MiB JSON帯を適用しない。exportはV2 32 MiB、companion V1 32 MiB、pair合計64 MiBのいずれかを超える見積り時点でpair生成を開始せず、best effortや片方だけの出力へ進めない。count／V2 byte／V1 byte／pair byte／JSON import byte／XLSX compressed・展開byteの各境界は直前／一致／+1で別testにする

上表のscenario ID、閾値、phase、profile、metricを削除・改名・`planned`へ戻す、または担当phaseより後へ延期する変更は、緩和と同じ`PD-17`変更手続を要する。各manifest entryは単一profileと単一`enforcedFromPhase`だけを持ち、Desktop directはhalf hit→popup paint、Mobile pickerはcell tap→picker paint→side selection→popup paintの固定action sequenceとする。I11で全`releaseScope = initial-release` scenarioをproduction artifactへ再実行し、表にない補助measurementやQAだけの結果で代用しない。

## 11. 自動テストゲート

### 必須CI

- `desktop-chromium-required`: Desktop Chromiumの全E2E。既定mouse contextに加え、同project内の`isMobile=false`／`hasTouch=true`固定`desktop-touch-context` testを必須manifestへ含める
- `mobile-chromium-required`: Android相当Mobile Chromiumのスマートフォン常時picker、縦横画面、空側追加、gesture
- `a11y-chromium-required` suite／tag: DOM代替導線、経路挿入、focus、axeをDesktop／Mobile両projectで実行する。独立した第3projectにはしない
- unit、integration、persistence、worker、encoding、architecture、coverage、FSMC compatibility、failure injection、legacy parity
- 必須projectのCanvas画像基準と論理座標assertion
- FSMC required configはworkers 1、retries 0、`failOnFlakyTests: true`、`fullyParallel: false`、`trace: "retain-on-failure"`を同時に固定し、flaky successを合格扱いにしない。一般testの既存retry方針を変更せずFSMC専用configで分離する
- `config/fsmc-test-manifest.json`が`releaseScope = initial-release`かつ現在phaseまでのrequired testだけを選び、選択0件、重複test ID、未登録test、required commandの0件／複数対応、initial-release entryの適用phase以後の`planned`残存を失敗させる。`future` entryは初版gateのselected／executed／failed集合とplanned残存判定へ入れず、scope不一致を失敗させる

常設`fsmc-required-gate`は既存branch-protected終端contextのdependency、またはI0 Exitまでのone-time required設定でmerge gateへ固定し、phaseやfindingに応じて外部設定を追加・削除しない。常設`webkit-safety-promotion` upstream jobはopen `webkit-temporary-required`が0件ならregister hash付き`not-required` resultだけを生成し、1件以上ならWebKitを明示installして全対象testを実行する。対象test 0件、未導入、未実行、失敗はresultを失敗状態にする。aggregatorはI0～I11の毎candidateでproduction build、現在phaseのChromium／phase結果、advisory observation、promotion resultの完了を`if: always()`相当で待ち、同じsource／production artifact／register hashへ拘束された成果物を必須入力にする。pre-release stateでは現在phaseまでの`verify:fsmc:phase-gate`、`release-ready` stateだけは全条件の`verify:fsmc:release-readiness`を実行する。job skip、artifact欠落、`safety-failed`、`infrastructure-failed`、promotion failure、現在phaseの未実行test、hash不一致ならmerge gateを閉じ、release modeでは`releaseScope = initial-release`の全required test未実行も閉じる。`future` entryの実行結果を初版gateへ混入した場合も閉じる。全jobはテストごとに再buildせず、同一CI runで作成したbuild artifactをhash検証後に再利用する。source-bound証跡bundleやmanaged-device receipt、継続的なbranch protection変更権限は作らない。

### advisory CI

- `webkit-advisory-smoke`
- `webkit-advisory-a11y`
- `webkit-advisory-safety-observer`

WebKitは必須Chromium jobと別のscript／jobで明示installし、通常の表示／a11y結果をnonblockingとする。advisory runnerは通常testとmanifestのsafety tagを分離集計し、test processの終了状態にかかわらず`if: always()`相当のreport stepで`fsmc-webkit-safety-observation.json`をuploadする。reportには同一`ciRun`のsource SHA、production artifact SHA-256、selectionMode、implementation-state／manifest SHAを入れ、`requiredSafetyIds(state)`が0件、同導出ID未実行、browser install／起動不能、report不能を`infrastructure-failed`、安全assert失敗を`safety-failed`にする。future scope／QA-only IDはpre-releaseの未実行扱いにせず、導出集合への混入自体をschema違反にする。required gateはこのartifactを待って検証するため、初回安全事故を人手で次commitへ登録するまでの間も公開できない。

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
- 同versionアプリが生成し、digest／companion hashが正しく、保証hard limit内にあるBackup V2を同versionへ復元できない、または同じpairのV1互換coreを固定旧版Aへ復元できない。破損、未知version／scope、上限超過を仕様どおり拒否した場合は停止理由にしない
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
- 問題発生前に作成済みのbackupを形式別に検証して優先する。V2はembedded digestと`companionCore.sha256`、同伴V1はそのSHA-256、standalone V1はschemaと選択時に計算したresume用SHA-256、legacy XLSX 2.2はZIP preflight／version／workbook構造と選択時SHA-256を検証する。選択時SHA-256をV1／XLSX内蔵digestと表現しない。recovery-required発生後に新しく退避できるのは6.1.1の診断がtrustedと分類したcoreから生成するV1だけで、untrusted split rootをBackupへ混入しない。診断情報は利用者が明示的に提供した範囲だけを扱う
- 再現fixtureを作成し、修正版が同じ失敗をretryなしの自動テストで防ぐまで再配布しない
- 影響、回避策、実際に確認できた保持状態、完全profile消去が疑われる場合は保証外であること、Backupからの復旧可否と見込みを推測せず正確に通知する
- 通常の停止・調査ではDB versionを下げたり、新storeや保存済み分割設定を削除したり、自動修復を実行したりしない。唯一の例外は、利用者が6.1.1の診断結果、退避Backup hash、影響scopeを確認して二段階承認したeligible in-place resetまたはguided clean-profile resetであり、対象外originを削除せず、削除と復元を一つの原子操作と表現しない

### 13.2 再開条件

- incident記録とroot cause reviewを完了し、事故を再現するfixtureとretryなしの自動回帰testを追加する
- 修正sourceで必須CI、旧新版同居、failure injection、性能、backup復元が再成功する
- 影響データの復旧または利用者向け処置を完了する
- 端末全体OFF、event OFF、制御変更mid-save、Backup新規／既存復元の自動回帰testが成功する
- 修正版も既存イベントOFFを既定として配布し、停止前のローカルON状態を自動復元しない

## 14. Definition of Done

次をすべて満たした時点で完全分割初版を完了とする。

- **DOD-FSMC-001** — `PD-01`～`PD-18`が`config/fsmc-traceability.json`で要件ID、owner phase、fixture、実装、自動test、利用者向け文書または非対象理由へ追跡可能で、全対象が`implementation-enforced`となり、初版の4方向、解除、同一地図内copy、再取込・通常編集が実装済み。さらに、イベント全体複製の全ID remap／source不変／destination OFF、番号セル・merge editorのpreview／validation／原子性、全RC／DoD／Exitの安定ID追跡がinitial-releaseで完了する
- **DOD-FSMC-002** — `C(S) = ∅`の場合だけ`01a`／`1a`／`０１ａ`が同じ売場へ解決され、衝突時はevent ONを拒否してlegacy identityを維持する。ON中の編集、import、restore、map変更で`C(after) \ C(before)`が非空となる操作は同数pair swapを含め全store書込み前に全拒否し、既存data、settings、control ON、表示原文を失わない。`fsmc.repair.item-numbers.v1`、`fsmc.repair.map-identity.v1`、`fsmc.repair.orphan-visit-state.v1`だけが既存pair集合を厳密減少でき、完全解消後だけ対象eventをeffective ONへ戻す。`26c`／`26c2`、`26d`、`26ab`は非対応番号同士で誤衝突せず、「側未設定」badge、DOM一覧、previewで識別表示される
- **DOD-FSMC-003** — exact番号grammarと巨大`BigInt`化前のsafe integer境界を満たし、mapped／mapless／legacy-unresolved `SpaceIdentity`を共有訪問projectionが保持する。legacy identityに原文／reasonを混入させず、mapless／unresolvedへ架空のmap／block／cell、marker、route anchorを与えない
- **DOD-FSMC-004** — 機能OFF時はsplit固有部分が固定した旧版Aと同じ番号identity、未分割表示、whole-cell位置解決、core保存結果になり、ON/OFFで商品番号原文やsplit設定を破壊変更しない。optional `EventMetadata.splitIdentityAnchor`だけを正規化除外したlegacy-core checksumと、それ以外の全core field・raw item原文が一致する。訪問・経路・位置指定の`PD-14`修正、重複物理cellを新規作成するimport／通常編集after-imageの原子的拒否、既存重複の`map-data-untrusted`判定／map単位route停止だけは常時適用する。重複を作らない入力では旧版Aと同じcore保存結果を維持する
- **DOD-FSMC-005** — item resolver、空側hit-test、DOM列挙が同じ`MapLocationIndex`、viewport adapter、geometryを使用する
- **DOD-FSMC-006** — 重複block ownership、番号重複、merge越境、重複mergeを配列順で推測せず影響領域を安全に除外・隔離する。重複物理`(row, col)`を新規作成するimport／通常編集は機能状態を問わず全store書込み前に拒否し、起動時から存在する重複は当該mapを`map-data-untrusted`としてsplit表示だけをlegacy whole-cellへ戻し、経路生成・cache再利用をmap単位で安全停止する
- **DOD-FSMC-007** — manual map／block editでmapData、association、binding evidence、entry statusが同じ原子的commitで更新され、commit成功後だけmemory-only route cacheを破棄し、無関係なentryを失効させない。`VisitIdentityInputSnapshot`は`manualHallId`、stable hall定義・所属・remap、map association、mapped↔maplessを単一revisionで読み、manual hall X→Y／未指定、hall削除／remap、dangling／ambiguous、表示名だけの変更を決定済み規則どおりrekeyする。番号セル変更、merge／unmergeは専用editorとpure previewを通り、duplicate cell、normalized collision、ownership／merge overlap、bounds／block越境、lossy mergeをfirst write前に拒否し、keyboardだけで取消まで完了できる
- **DOD-FSMC-008** — 地図再取込はcore map planとsplit reimport planを同一pre-command snapshotから合成し、双方のdigest、map／association revision、`ExpectedRootVector`を単一preview authorityにする。core／splitの片側だけがstale、取消、quota、commit前終了ではwrite 0件、成功時はmapData、association、binding／status、I7以降のdurable現在位置・保存位置・phase stateを同一commitで更新し、route cacheはcommit後だけ破棄する。reimportはsame-instance、raw block名＋番号、normalized token＋番号のtier順でexact 1件だけを採用し、複数候補をrow／colや配列順でtie-breakしない
- **DOD-FSMC-009** — コピーの既定「追加・変更のみ」は既存分割を解除せず、別操作の「完全同期（解除を含む）」だけが解除する。両方でmode、追加・変更・解除・維持・変更なし・除外のpreview、取消、stale時全abortが機能し、コピー先IDとdormant／quarantined履歴を維持する。同owner＋番号のretainedがあればcopyから除外して明示再関連付けへ送り、active／retained overlapを作らない
- **DOD-FSMC-010** — `layoutMode`とスマートフォン操作判定が分離され、Mobile Chromium profileでは全分割セルが空間順picker、狭幅Desktopと`desktop-touch-context`を含む`isMobile=false`ではmouse／touch別閾値に従い、閾値未満・曖昧時はno-op案内となる
- **DOD-FSMC-011** — 通常マップと集中モードが同じPointer gesture state machineを使用し、pan、pinch、cancel、capture喪失、layout切替後の誤tapがない
- **DOD-FSMC-012** — a/bの着色、ポップアップ、状態変更が独立し、集中モードの「購入済」と「後回し／遅参」の既存反映規則を維持する
- **DOD-FSMC-013** — raw実行商品ID配列を並べ替えず、非連続同一`ExecutionVisitIdentity`をglobal集約し、normalと後回し／遅参の`PhaseVisitIdentity`投影を通常マップ、集中モード、`MapVisitListPanel` shell＋pure `ProjectedVisitList`、space-navigation、route／hit-testで同じ`PhaseVisitProjectionSnapshot`から共有する。進行区分・優先度はexact union、1 itemの追加phaseは高々1個とし、既存identityへの位置指定追加はanchorを無視して統合通知し、訪問位置を動かさない。base順は重複なし`executionVisitOrder`、global順はnormal→postponed→lateとし、currentはphase付きitem anchor、saved位置は3 phase別anchor、空phaseと`isCompleted`を保持する
- **DOD-FSMC-014** — 商品編集でexecution identityが既存destinationへ変わる場合はdestination訪問位置を維持し、変更itemだけをmember末尾へ移して現在・保存位置を新しい`PhaseVisitIdentityKey`へ再解決し、全画面へ同じ結果を反映する。新destinationのsource残存／消滅、複数同anchor、既存destination、利用者insertの全rekey規則でdense ordered key arrayと変更外相対順を維持する
- **DOD-FSMC-015** — route、hit-test、挿入anchorとDOM panel callbackが`PhaseVisitIdentityKey`を使用し、member商品ID列はpayloadに限定される。先頭member削除後も残存memberがあれば同じvisit ID、座標、順序、route cacheへ再解決され、priority、phase、member件数をDOMで確認できる
- **DOD-FSMC-016** — main pathと種別付きconnectorが分離され、connectorは自セル・結合セル領域内で安全な場合だけ表示・hit-testできる。領域外または障害物横断が必要な場合は`unsafe-connector`で`unroutable`とし、同一セルa→bにも同じ規則を使う。route signatureは`pathfindingGraphFingerprint`を含み、value／背景色／map寸法／結合領域／algorithm・cost変更で古いcacheを破棄する。connectorの自owner領域mask exemptionをmain pathへ伝播させず、同anchor別visitはcost 0の`coincident-anchor`としてroute順を維持し、線hit targetを作らない
- **DOD-FSMC-017** — 同位置複数訪問が中立marker、訪問数badge、現在ringで表示され、番号・a/b・badge文字が全回転角で正立する。`LocationPresentationState` reducerは入力shuffleでbyte同値、mixed statusを代表色へ潰さず、selected／hover／temporary／currentを独立fieldとしてCanvas・DOM・forced-colorsで共有する
- **DOD-FSMC-018** — Canvasを使わずDOM訪問一覧から詳細、追加、状態変更、一時移動、経路挿入を完了でき、a11y試験が成功する
- **DOD-FSMC-019** — I2ではproduction artifactが`databaseTargetMode = core-current`／現行core DB version／FSMC公開command 0件を維持し、non-promotable QA artifactの`databaseTargetMode = fsmc-vcap-qa`だけが現行version→採択済み`Vcap`を試験する。I11 release-readyで初めてproduction artifactを`databaseTargetMode = fsmc-vcap-production`へ変え、同じmigration oracleを再実行する。起動preflight、`dbVersion`とexact一致するsplit対象rootへ閉じた`Vcap` witness、通常core traceだけの`dbVersion < Vcap`判定、採用直前のsplit導入trace再検証、全非fence root payload／metadata／checkpoint／全potential IDB candidate selectorの`H0/H1` byte-exact CAS、legacy rowを`H1`・new capability rowをfactory after-image・fenceをbaseline-onlyとする合成post-stateのtotal historical evidence／participant digest／全governed root baseline付きinitial fence、commit前／後crash oracle、`Vcap - 1`／`Vcap`／supported上限の空storeを含むpartial-loss安全分岐、supported上限＋1拒否、現行5／6／7／8 provenance fixture、固定manifestの旧版A→候補新版B→固定旧版A→候補新版Bの自動互換試験が成功し、端末情報を外部収集しない。healthy legacy-only差は原子的rebase、anchor欠落／重複／衝突は決定済みstatus、capability-owned差／fence自己不整合／説明不能差は安全モードとなる。採択versionは`coreDbVersion < Vcap <= supportedMaximumDbVersion`かつauthoritative release／artifact provenanceから`adopt-vcap`へ再計算され、unknown conflict 0件を要求する。bootstrapは4 payload root＋fenceを作り、canonical event settings／pending bridgeを含むprofile別actual participant集合と一致する
- **DOD-FSMC-020** — supported rangeでは`dbVersion >= Vcap` iff exact 1件の値一致`db-version` witness、`dbVersion === null || dbVersion < Vcap` iff 0件となり、`dbVersion > supportedMaximumVersion`はsnapshot外`unsupported-database-version`としてauthority非採用・write 0件で拒否される。現行のsupported上限7／DB8拒否は同じparameterized境界から導出する
- **DOD-FSMC-021** — `core-only`、`map-cell-split-recovery-required`、`map-cell-split-v1`のsnapshotを型で区別し、recovery-requiredではcoreだけを継続してuntrusted split rootを採用・黙示再初期化しない。open結果・canonical reasons・eligibility・backup被覆・connection状態→runbookをtotalかつ一意にし、unsupported DBの全write 0、trusted-core V1 export、eligible atomic split reset、不適格時write 0、別tab blocked、delete前／後再開、Backup hash再選択、二段階確認付きclean-profile reset、clean profileからV2／V1／XLSX 2.2復元、別origin非削除を自動試験する。正常時はempty-source metadataのanchor、registry token、event／map／block instance ID、active／retained entry、map-levelとentry-level binding evidenceを保持し、metadata全writerがI0 inventoryの発行／保持／remap／除去方針に適合する。guided profile resetは実profileの全object store／削除local keyのcoverage closureがverified-completeの場合だけ許可し、unknown／未被覆targetではconfirm不可・delete 0件とする
- **DOD-FSMC-022** — `(storeName, key)`別のfull `ObservedRevisionRoot`、構造化checkpoint、identity＋物理location＋物理内容witness＋absorption projectionを返すpure collectorの全出力、settings／control root、root policy、全非fence rootのtotal historical evidenceとその全行digest、participant digest、全`FSMC_GOVERNED_ROOTS_V1`のexternal baselineを持つfenceを含む`ExpectedRootVector`により、`syncQueue`のjournal／archiveとsnapshot時emptyの全potential storeを含むIDB candidateのstaleは同一transactionを全abortする。external raw DOMStringはlone surrogateも区別するlossless UTF-16 code unit witnessで拘束し、transaction内でWebCrypto／別async taskを待たない。candidate content-only／projection-only差は固定旧版Aのexact transition manifest外ならrecovery-requiredとし、legacy rebaseのparticipant tupleと置換historical rowは`sort(unique(changed legacy roots ∪ actualCapabilityWrites))`にexact一致させる。通常core-only rebaseだけは`actualCapabilityWrites = {data, control}`、shadow reconcile併用時は専用ack rootを加える。external差はhealthyなlegacy-mutable coreだけならcommit前はwrite 0件のrebase、commit後は全new IDB rootを維持したrebaseとし、capability-ownedまたは分類不能な差はcommit前recovery拒否、commit後`committed-recovery-required`として即時または再起動時に検出する。legacy rebaseも同一transactionで全旧fenceまたは全新fenceだけとなり、別scope commandでも非参加historical row／baselineを失わず、last-write-wins、部分IDB commit、黙示mergeがない。quota・abort・crash・OFF mid-save時も各commandのIDBは全旧または全新だけとなる。`ProjectionDigestDescriptorV1`は実装digestの3 fieldだけ、checkpointは構造全体digestとする。event-settings／bridgeを含む`logicalRootMutationTuples`、participant roots、置換historical row、digest対象集合をexact一致させ、fence payload／metadata／checkpointは別のadministrative write manifestへ一致させる
- **DOD-FSMC-023** — event削除画面は30日保持が既定、即時完全削除が別選択となる。D+29、trusted D+30、31日offline、36日offline、rollback、session jump、24時間再確認が固定clock契約どおりで、`event-deleted`対象以外を削除しない。設定単独出力は初版にない
- **DOD-FSMC-024** — dormant／quarantinedは地図に表示せず管理UIで理由を表示し、preview付き端末内再関連付けと明示削除が可能で、名前だけで別eventへ再接続しない。retained再関連付けは候補exact 1件、target未占有、trusted mapの場合だけ一段commitし、0／2件以上／staleでは非選択履歴を変更せずwrite 0件となる
- **DOD-FSMC-025** — Backup wire層は`AppBackupV2FullEventCoreWireV1`とscope別の明示section型だけを公開し、`Pick<AppData, ...>`、runtime domain型、persistence型をimportしない。V1層別互換matrix、event単位V2のcore／split分離、scope別exact全core section tuple、全scope共通`scope.references`、単一eventRef＋全mapRefs、実payload由来`counts`とのexact一致、map-level fingerprint、active／retained portable union、digest、V2からV1へのfileName／byteLength／SHA-256拘束が固定される。V2 full／coreはcanonical event settings exact 1件、item-onlyはnullを持ち、削除済みpriorOwnerはcurrent refと別namespaceのhistorical owner tableで同値関係をround-tripする
- **DOD-FSMC-026** — V1、legacy XLSX 2.2 full、地図を含むがsplitを含まないV2では既存split設定をpreview後にdormant化し、V1／XLSX 2.2 item-only importではmap／splitを維持する。event V2は原子的にround-tripし、全形式でcancel／stale／validation失敗はwrite 0件となる。full／core restoreはcanonical event settingsを復元先eventへ同一IDB commitで適用し、item-onlyはdestination settings checksumを維持する。bridge完了前は成功通知しない
- **DOD-FSMC-027** — importはsame-origin bundled module Workerが1 MiB以下のbounded sliceで処理し、main threadのwhole-file `arrayBuffer()`／`text()`、blob／data Workerを禁止する。PWA precacheと`worker-src 'self'`のoffline起動、cancel／timeout／worker crash cleanupを検証する。performance保証32 MiB／file、V1／V2 JSON import hard 64 MiB／file、XLSX 2.2 compressed hard 32 MiB＋既存展開limit、export V2 32 MiB・V1 32 MiB・pair合計64 MiB、fatal UTF-8、duplicate property、非再帰depth／token、V2 digest、未知version／scope、不正ref、1 MiB超番号tokenをDB更新前に判定し、長大数字を境界比較前に巨大`BigInt`化しない。V2のlocal control fieldも未知keyとして拒否する。V1で現行readerが受理する同名未知fieldは互換matrixどおり保持できるがcontrol authorityへ採用しない。V2／新規編集のunsafe URLは拒否し、V1／XLSX 2.2／既存profileのlegacy unsafe URLはraw保持しても非clickable、href sinkは`SafeExternalHref`だけを受理する。bounded errorとcancel cleanupを守り、`__proto__`等の利用者名を安全に自己round-tripする
- **DOD-FSMC-028** — 端末全体OFF、event OFF、自動安全モードでは`PD-04`で定義したsplit固有部分のlegacy動作（`PD-14`、重複物理cellの新規after-image拒否、`map-data-untrusted`安全判定の常時修正を含む）となり、オフラインだけではOFFにならない。authority正常なlegacy rebaseはdevice／event／readinessに依存せず完了し、recovery-required安全モードでは禁止する。device OFF中の編集後に再ONした場合は衝突eventだけをstored enabledのeffective fallback、他eventをONとし、修正完了したeventだけ復帰する。BackupはローカルON／OFFを含めず、新規復元OFF・既存復元先状態維持となる
- **DOD-FSMC-029** — 端末間同期・自動mergeを行わず、1イベント1主端末とpreview付き全置換、復元前退避案内が利用者向け文書と自動テストで固定される
- **DOD-FSMC-030** — source固定readinessがI0～I1 `contracts-only`、I2～I10とI11作業中`internal-testing`であり、I11最終candidate PRだけはbuild前に`release-ready`へ変更される。同一production artifactの全Exit／release gate成功後だけ配布でき、verifierはreadinessを書き換えない。production bundleにQA override、query、storage、remote迂回がなく、release-ready前のproductionでは有効化UI／commandへ到達できず、production／QA build manifestの`databaseTargetMode`、`buildPurpose`、readinessと実際のDB target／registryをverifierが一致させる
- **DOD-FSMC-031** — 必須Desktop／Mobile Chromium CIがworkers 1、retry 0、`failOnFlakyTests`で成功し、`desktop-touch-context`を含むsafety flakyが0件である。release-ready manifestでは全`releaseScope = initial-release` safetyが`implementation-enforced`であり、その集合内の`qa-chromium-only`が0件である。`releaseScope = future`は選択・実行・成功扱いにせず、初版DoDの0件判定へ混ぜない。WebKitの通常表示／a11y結果自体をDoDにしないが、同一`ciRun`／source／production artifactへhash拘束したrelease-ready `requiredSafetyIds(state)`の全ID実行・全結果passed・failed ID／infra error 0件からcurrent-run safety observationが`passed`へ再計算され、open safety findingは0件、promotion resultはregister 0件と集合一致する`not-required`である。open finding中のpromotion `passed`は修正確認の中間状態に限り、findingをclosedへ更新して`not-required`となるまで最終DoDを満たさない。overall statusの自己申告だけを信頼しない
- **DOD-FSMC-032** — Desktop／Mobile Chromiumの自動browser、PWA、性能テストが成功する。`CellSplitDefinitionPanel`／retained管理の15,000行と`ProjectedVisitList`の最大800行のDOM導線、常設`role=status`のexact 1回通知、light／dark contrast、forced-colors、200% zoom、container focus＋`aria-activedescendant`のfocus復元を含み、特定OS・端末を正式保証済みと表記しない。`MapVisitListPanel`はI8のshellとしてfilter／active／selected／stale／focus returnを所有し、injective row ID、filter 0件、opener消失、同文言別operation eventを正しく扱う
- **DOD-FSMC-033** — WebKitはadvisory自動test対象だが必須保証対象外であり、iPhone、ペン、OS／実機固有挙動は自動test対象外であることを利用者向け文書へ明記する
- **DOD-FSMC-034** — 15,000セル、最大8,192 block、15,000設定、30,000半領域、400商品、400売場、400 execution訪問、最大800 phase投影、単一phase経路400の条件を持つ`releaseScope = initial-release`の全performance scenarioが、検証済みrunner envelope上で専用`config/fsmc-performance-budgets.json`の製品上限を満たす。5秒操作中のinput-to-next-paint、全Chromium process PSS memory metric、memory解放条件も満たし、Mobile emulationを実機memory保証と表記しない。100×150のversion付きtopology manifestと同一OFF／ON topology hashを使い、全62 scenario-profile keyを最大54 shard、各300分以下／job 330分以下で実行し、reducerが欠落／重複／stale／別attemptを拒否する
- **DOD-FSMC-035** — PWA新旧世代、旧版／新版同時tab、versionchange blocked、QuotaExceeded、部分root／store欠損、強制終了の試験が成功する。6.1.1の明示reset以外はsplit stateを自動削除せず、origin／profile完全消去は空profile、device OFF、enabled event ID 0件のclean-startと事前Backup文書を確認し、消去dataの保持・自動復旧を要求しない。event-settingsのIDB commit→shadow前／shadow→ack前とcoverage snapshot→delete再検査前のcrash／raceも、canonical root rollbackや未知target削除なしに再開・停止する
- **DOD-FSMC-036** — test membership、coverage、architecture、dependency usage、foundation quality、functional result、CI prerequisite result、required-resultsの各verifierがcurrent source／artifact／run hashへ拘束され、0 test、allow-empty、未登録command、wire→runtime型、UI→persistence、raw URL→href、blob／data Worker、別run結果流用をnegative fixtureで拒否する。FSMC-I0着手前ゲートとI0～I11の各required gateはwaiver／skipなしで成功する。requirement catalog／traceability／test manifest、foundation result、production／必要時QA manifest、functional result、performance reduced result、CI prerequisite resultをfinalizerがcurrent runのhashで統合し、producerの失敗・起動前終了でもalways-run reporterがfailed／infrastructure-failed artifactを作る。pre-I0 quality graphとActions／GHCR／branch gate前提をwaiverなしで検証する
- **DOD-FSMC-037** — remote availability、署名receipt、外部metrics、実event pilot、managed-device収集、source-bound証跡bundleが実装・完了条件・標準commandに存在しない。source固定の`verify:fsmc:release-readiness`は公開安全gateとして必須とする
- **DOD-FSMC-038** — 完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図コピー、意図的再訪が後続版として初版のUI、command、test gateから分離される

## 15. 標準検証コマンド

リポジトリ指定のNode 24.19.0／npm 11.19.0を使用する。次のFSMC scriptはI0で`package.json`とCIへ追加し、manifestが選ぶtest 0件、`--passWithNoTests`、未実装testの仮成功を拒否する。

以下のphase別blockはjob内payloadの例であり、required workflowの唯一のauthorityは次のDAGとする。`foundation-quality → production／QA build`と常設`fsmc-ci-prerequisites`をcurrent runで開始し、build後にfunctional job、`performance-plan → performance-shard matrix → performance-reducer`、WebKit observation、WebKit promotionへ分岐する。foundation-quality、production／QA manifest、functional result、reduced performance result、CI prerequisite resultを`if: always()`で待つ`required-results-finalizer`だけが`fsmc-required-results.json`を生成し、その後に`fsmc-required-gate`を実行する。shard／functional／prerequisite jobからrequired-resultsを直接生成しない。reporter、全artifact upload、reducer、finalizer、gateは上流失敗時も動く独立した`if: always()` stepとし、hard-timeout shardやjob-level artifact欠落はdownstream verifierがinfrastructure failureへ再計算する。I2～I10とI11 internal-testingだけはnon-promotable QA artifactを機能／製品performanceへ使うが、production artifact、production guard、WebKit系、finalizerを省略しない。

常設CI prerequisite job:

```powershell
npm ci
npm run observe:fsmc:ci-prerequisites
# 以下3 stepはobserver結果にかかわらずworkflowのif: always()で実行
npm run finalize:fsmc:ci-prerequisites-result
npm run verify:fsmc:ci-prerequisites-result
npm run artifact:fsmc:upload:ci-prerequisites-result
```

I0で追加する`run:fsmc:foundation-quality`はcurrent sourceで既存`npm run quality`と同じ再帰展開graphを共通executorで省略なく実行し、graph SHA、各command／script hash、選択test ID／件数、exit、source／toolchain／`ciRun`をresultへ記録する。0 test、allow-empty、前run result、graph差替え、個別失敗をoverall passedにしない。performanceは`plan:fsmc:performance`、`verify:fsmc:performance-plan`、`verify:fsmc:performance-runner:shard`、`test:fsmc:performance:shard:*:prebuilt`、`reduce:fsmc:performance`、`verify:fsmc:performance-reduced-result`へ分離し、`finalize:fsmc:required-results`がfunctional／reduced結果を統合する。calibrationは各shardの製品sample直前に同じcontainer／browserで行い、別runから再利用しない。

FSMC-I0 production build job:

```powershell
npm ci
npm run run:fsmc:foundation-quality
npm run artifact:fsmc:upload:foundation-quality-result
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
npm exec -- playwright install --with-deps chromium
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
npm run run:fsmc:foundation-quality
npm run artifact:fsmc:upload:foundation-quality-result
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
npm exec -- playwright install --with-deps chromium
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
npm run run:fsmc:foundation-quality
npm run artifact:fsmc:upload:foundation-quality-result
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
npm exec -- playwright install --with-deps chromium
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
npm run run:fsmc:foundation-quality
npm run artifact:fsmc:upload:foundation-quality-result
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
npm exec -- playwright install --with-deps chromium
npm run test:fsmc:required:prebuilt
# 以下3 stepはtest結果にかかわらずworkflowのif: always()で実行
npm run finalize:fsmc:functional-result
npm run verify:fsmc:functional-result
npm run artifact:fsmc:upload:functional-result
```

performance系は上のfunctional jobへ混ぜず、全phaseで次の4段を使う。I0 planはqualification shardだけ、I1 planは期待shard 0件の`not-required`、I2以降は現在phaseまでのproduct keyを生成する。

```powershell
# performance-plan job
npm ci
npm run artifact:fsmc:download:release-and-qa-if-required
npm run plan:fsmc:performance
npm run verify:fsmc:performance-plan
npm run artifact:fsmc:upload:performance-plan

# performance-shard matrix job（matrix.shardIdごと、timeout-minutes <= 330）
npm ci
npm run artifact:fsmc:download:performance-plan-and-builds
npm run verify:fsmc:performance-runner:shard -- --shard-id $env:FSMC_SHARD_ID
npm run test:fsmc:performance:shard:prebuilt -- --shard-id $env:FSMC_SHARD_ID
npm run artifact:fsmc:upload:performance-shard-result -- --shard-id $env:FSMC_SHARD_ID

# reducer job（if: always()）
npm ci
npm run artifact:fsmc:download:performance-plan-and-all-shards
npm run reduce:fsmc:performance
npm run verify:fsmc:performance-reduced-result
npm run artifact:fsmc:upload:performance-reduced-result

# required-results-finalizer job（全入力producerをif: always()で待つ）
npm ci
# 各download／verifyと末尾3 stepは独立したworkflowのif: always() step。
# download不能時はcurrent-run missing sentinelを残し、finalizerがinfrastructure-failedへ再計算する
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
npm run finalize:fsmc:required-results
npm run verify:fsmc:required-results
npm run artifact:fsmc:upload:required-results
```

各shard uploadはtest失敗時も走り、job hard-timeoutでartifact自体がない場合はreducerがexpected shard欠落として失敗する。finalizerはfoundation-quality result、production／必要時QA manifest、functional result、performance reduced result、CI prerequisite resultのexact 5入力classをcurrent run／attemptから取得し、source／artifact purpose／readiness／phase／catalog／traceability／test manifest／topology hashを再検証する。class欠落、複数artifact、別run／attempt、producer失敗、hash差をinfrastructure failureへ再計算し、functional／shard／prerequisite側の自己申告passを採用しない。I0／I1／I11 release-readyではQA manifestを「不要であることを検証したnull」、I2～I10とI11 internal-testingではexact 1件として扱う。

次のadvisory WebKit jobはI11専用ではなく、I0～I11の毎candidateでproduction build jobを待ち、必須Chromium jobと分離する。pre-releaseでは`requiredSafetyIds(state)`の`pre-release-production-guard`だけ、release-readyでは全`releaseScope = initial-release` safetyが`implementation-enforced`かつその集合内の`qa-chromium-only`が0件であることを先に検証し、`release-production-full`を含む全導出IDをproduction artifact上で実行する。`releaseScope = future`は選択・実行・成功扱いにせず、初版の0件判定にも混ぜない。I2～I10およびI11作業中`internal-testing`の`qa-chromium-only`機能safetyを到達不能なproduction WebKitへ渡さない。

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm exec -- playwright install --with-deps webkit
npm run run:fsmc:webkit-advisory-observed:prebuilt
```

`run:fsmc:webkit-advisory-observed:prebuilt`は通常表示／a11yとsafety tagを分離して実行し、test／browser失敗時もCIの`if: always()` report stepからschema-valid observationをuploadする。scriptがprocess開始前に失敗してもCI wrapperが`infrastructure-failed` observationを作る。`fsmc-required-gate`はこのartifactがないrunを再実行推測や前run流用で補わない。

常設`webkit-safety-promotion` jobもI0～I11の毎candidateでproduction build jobを待つ。branch protectionのrequired context自体には追加せず、register 0件でもjobとresult artifactを省略しない。

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm run run:fsmc:webkit-safety-promotion:prebuilt
```

`run:fsmc:webkit-safety-promotion:prebuilt`はregister hashとopen `webkit-temporary-required`を検証する。0件ではWebKitをinstallせず`not-required` artifact、1件以上ではWebKitを明示installして選択testをretry 0で全件実行し、`if: always()` wrapperから`passed | failed | infrastructure-failed` artifactをuploadする。空testやjob skipを`not-required`へ偽装しない。

固定job／status `fsmc-required-gate` aggregatorはI0～I11の毎candidateでbuild、functional、performance reducer、required-results finalizer、advisory observation、promotionの全jobを`if: always()`相当で待つ。source stateが`contracts-only`／`internal-testing`なら`verify:fsmc:phase-gate`、`release-ready`なら`verify:fsmc:release-readiness`を内部で選び、どちらのmodeでも同じstatus名を出す。

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
npm run verify:fsmc:required-results
npm run artifact:fsmc:download:webkit-safety-observation
npm run verify:fsmc:webkit-safety-observation
npm run artifact:fsmc:download:webkit-promotion-result
npm run verify:fsmc:webkit-promotion-result
npm run verify:fsmc:safety-findings
npm run verify:fsmc:required-gate
```

`test:fsmc:required:qa-prebuilt`はI2～I10およびI11 internal-testingのQA artifactへ、`test:fsmc:required:prebuilt`はI11 release-ready production candidateへ、manifestどおりの機能testだけを実行し、performance sampleを同processへ混ぜない。performance planは同じsource／artifactと現在phaseの`initial-release && enforcedFromPhase <= currentPhase && status != planned`集合から独立に導出する。artifact verifierはproduction／QAのsource、purpose、readiness、DB target、`ciRun`を照合する。performance reduced verifierは期待shard、current attempt、plan／budget／runner／topology／catalog／traceability hashes、各sample、OFF pair順、欠落を再計算する。required-results verifierはfoundation、functional、reduced performance、CI prerequisite、catalog／traceabilityの各hash、selected／executed／satisfied／failed集合、ID→command、statusを再計算する。WebKit observation／promotionとrequired gateの既存安全判定は同じcurrent runへ拘束し、外部activation、実event pilot、実機収集、外部metrics、receipt builderを追加しない。
