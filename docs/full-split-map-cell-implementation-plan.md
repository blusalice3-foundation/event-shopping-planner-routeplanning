# Full Split Map Cell Implementation Plan

- 文書状態: 2026-08-25 無課金優先・短時間検証版。実装開始判定はNo-Goであり、既存`docs/各フェーズのFormal Exit達成.md`のPrettier不一致を修正したclean candidateで章15のpre-I0 baseline全commandが成功した時点だけFSMC-I0をGoへ変更できる。既知障害waiverやI0で初めて作るFSMC testによる代替合格は認めない。AWS、GHCR、Protected Environments、GitHub Actions Artifacts、有料ブラウザ／実機サービスはEntry、Exit、公開、事故復旧、Definition of Doneの前提にしない。GitHub Actionsは公開リポジトリの標準runnerを無課金で利用できる間だけ任意の再確認に使い、課金または容量超過の可能性があればローカル検証へ切り替える
- 対象機能: 地図番号セルのa/b完全分割
- 対象ソース基準: `2eaba922816e8b263c6479e81ab9f265321654b2`（短縮: `2eaba92`、実装code基準。後続のplan-only commitはpre-I0 inventoryで追跡）
- 固定旧版Aのソース基準: `3db4be011d0f4123aa3953b559280c58f33d026a`（互換試験専用。現行実装の基準に使用しない）
- 作成日: 2026-08-12、最終判断反映日: 2026-08-25
- 想定規模: 大規模。I0～I11の責務境界は維持し、I0／I2／I4は後述の依存順3 PR、I11は2 PR、その他phaseは原則1 PRとする19個の論理PRを基準にする。件数自体はExit条件にせず、各分割PRを独立にtest可能にして途中PRからproduction public edgeへ到達させない。生成WBS、外部observer、証跡registry用の専用PRは作らない

## 0. 以後の計画編集に対する固定方針

> **編集前提（本書内で最優先）** — 本書を追加・修正・レビューする者は、FSMCの実装、検証、公開、証跡、復旧を「新たな課金サービスなし、短時間中心だが必要な網羅・重層確認を残すテスト」で完了できる状態を維持する。費用・時間を減らすために安全上必要な組合せや意図的な重複確認を削ってはならない。後続章にこれと矛盾する記述がある場合は、後続章を正当化して残すのではなく、同じ変更でこの固定方針へ揃える。

### 0.1 課金サービスを使用しない

- AWS S3／KMS／CloudTrail等のcloud resource、有料の地図・経路API、BrowserStack等の有料browser／実機farm、有料npm製品、Actions Artifactsやpackage storageの有料枠、有料supportをEntry、Exit、Definition of Doneまたは推奨経路へ追加しない
- free tier、trial、credit、既存の共通課金基盤、支払方法登録を「実質無料」とみなして前提にしない。超過、失効、private化等で請求の可能性が生じる仕組みは使用せず、repository内fixtureとlocal commandへ切り替える
- GitHub Actions等は、利用時点で追加請求0円と確認できる場合の任意再確認に限る。利用不能、quota不明、billing要求時は実行せず、未実施をphase完了のblockerにしない
- credential、cloud account、予算申請、課金上限承認、外部artifact upload、長期保存を実装開始や事故復旧の条件にしない。候補者SHA、command、exit code、所要時間を小さなlocal textで記録すればよい

### 0.2 堅牢性を維持しながら煩雑・長時間化を避ける

- 全組合せtestと重複testを一律に排除しない。保存原子性、stale時write 0、identity正規化、migration／restore、recovery decision、Pointer FSM等の有限で安全上重要な論理分岐は、高速なunit／integrationのtable-driven testで到達可能な全組合せを確認する。到達不能な組合せは理由をcontractへ固定し、未検証のまま省略しない
- a/b混同防止、all-old／all-new、OFF／safe mode、Backup互換、rollbackは、owner phaseのunit／integration、利用者導線のbrowser smoke、I11 release buildのうち意味の異なる層で意図的に重ねて確認してよい。単に同じbinary、fixture、assertionを同じ環境で再実行するだけの重複と、安全網として別層から同じ不変条件を確認する重複を区別する
- browserはChromiumの代表journeyをbaselineにし、pairwise／境界代表から始める。ただしbrowser engine、viewport、回転、DPR、状態、入力、障害点の組合せに固有の故障riskがある場合は、そのriskに対応する組合せを既存journey内のparameterまたは無課金local engineの対象smokeとして残す。根拠なく全軸を直積化しない一方、単一engineや8 journeyという目安だけを理由に必要なcaseを削らない
- 1 command 10分以内、通常PR全体20分以内、performance smoke 5分以内、I11のrelease aggregate 20分以内という章10／15の上限を維持する。optional ActionsのI11 jobだけは`npm ci`を含む外枠25分で停止する。必要な網羅性が収まらない場合はtestを削らず、pure logic化、fixture共有、table-driven化、fake clock／fake sink化で短縮し、それでも収まらなければ0.3に従って利用者へ判断を求める
- 実32～64 MiB file、300秒の実待機、最大fixtureのbrowser展開、30回反復、memory polling、multi-browser、shard、全phaseの無条件再実行は既定の必須経路にしない。上限とtimeoutは小さな注入可能limit、fake clock、fake sink、generatorのcount／hashで全境界分岐を確認し、実環境でしか検出できないriskがある変更だけ対象を限定した実測を加える
- 新しいrequired testを加える場合はowner、対象risk、組合せ範囲、既存testと重ねる理由、上限時間を同じ変更で明記する。既存journeyへの統合はcoverageを失わない場合だけ行い、異なる層で独立したfailure signalを持つ重複testは維持する。詳細測定や問題再現を任意確認へ下げるだけで安全上のExitを満たしたことにしない

### 0.3 この方針を変更できる条件

一般的な機能追加、review指摘、将来の編集だけでは0.1／0.2を緩和できない。課金または長時間検証が本当に避けられないと判断した場合、編集者は計画へ黙って追加せず作業を止め、「例: 月額料金が発生するcloud保存が必要」「例: PRごとに30分増える全browser試験が必要」のように非エンジニアにも分かる費用・時間と無課金／短時間の代替案を提示し、利用者からこの固定方針を変更する明示指示を得る。明示指示がない限り、その要件は任意または対象外とし、本節と矛盾する本文、test、Exit、DoDを追加しない。

保存前に、(1) 新規課金resource 0件、(2) required testが既存timebox内、(3) 到達可能な安全分岐の全組合せcoverageを維持、(4) 重要不変条件の意図的な重層確認を維持、(5) 根拠のない直積matrix／同一実行の反復／実時間待機を追加していない、(6) 任意確認だけで安全上の完了条件を代替していないことを確認する。本節の変更または削除も、利用者による明示指示がある場合だけ行う。

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

初版は、原子的保存、通常マップ、集中モード、経路、7.1で定義するhealthy V2 snapshotから必ず生成できるイベント単位Backup V2、lossless representabilityを満たす場合に同時出力する旧版用V1互換core backup、旧版fallbackを主機能とする。イベントをeffective ONにする前とON中writerのafter-imageで同じV2 representability preflightを必須にし、healthyでないeventはwrite 0件でON／変更を拒否して修復導線を表示する。これらを安全に成立させるための同一地図内copy、event／map／hall lifecycle、地図再取込・通常編集、dormant／quarantined管理UI、共有訪問projection、ローカル有効化・復旧導線も初版の必須support scopeに含める。完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図への設定コピー、意図的な同一売場再訪は後続版とし、初版のExitやDefinition of Doneへ含めない。

### 1.1 レビュー結論と確定判断

2026-08-12以降のレビューで確定した製品仕様は維持しつつ、本版では実装開始条件と検証方法を無課金・短時間へ改める。FSMC-I0は契約、代表fixture、短時間test commandを用意する最初の実装フェーズであり、clean worktreeのローカル基準検証が成功すれば開始できる。外部account、cloud resource、package公開、課金承認は開始条件にしない。各phaseは直前phaseの小さなExitを満たしてから進める。

| 判断ID  | 確定内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PD-01` | 分割設定を含まない旧形式の完全復元では、対象範囲の既存分割設定を削除せず`dormant`へ移し、事前previewで件数・理由・復旧方法を表示する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `PD-02` | `01a`、`1a`、`０１ａ`は端末内preflightで統合衝突が0件の場合だけ同じ売場へ正規化する。衝突があるeventは分割機能をONにせずlegacy identityを維持し、利用者へ対象と解決方法を表示する。表示用原文は常に維持する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `PD-03` | 配布制御は外部serviceを使わず、端末全体のローカルOFF、イベント別のローカルON／OFF、DB・schema異常時の自動安全モードだけで構成する。既存イベントは初期OFFとする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PD-04` | 機能OFF／安全モードではsplit固有の表示、位置解決、保存、経路、操作を従来の未分割セル動作へ戻し、保存済み分割設定を通常操作で変更しない。`PD-14.C2`はI7以降、`PD-14.C3`はI10以降のnon-promotable QA artifactだけで先行してON／OFF共通不変条件として検証し、I10以前のproduction artifactでは基準source挙動とpublic edge 0件を維持する。I11のproduction `Vcap` migrationとdurable visit初期化が`ready`になったrelease-ready artifactで初めてC2／C3をON／OFFにかかわらず常時適用する。重複物理`(row, col)`を新規作成するimport・通常編集after-imageの原子的拒否、および既存重複を配列順で選ばず当該mapの経路生成・cache再利用を停止する`map-data-untrusted`安全判定は各該当commandの導入時から常時適用し、固定旧版Aとのphase-awareな許容差分とする。復旧用backupへのread-only収録、authority正常時の内部legacy rebase、`PD-09`の期限到達cleanupは非表示のsidecar保守として許可する |
| `PD-05` | スマートフォンでは表示サイズにかかわらず必ずpickerを経由する。pickerはa/b順ではなく画面上の空間順に並べ、「左側 b」「右側 a」等、位置と文字を併記する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PD-06` | ブロックコピーは解除しない「追加・変更のみ」を既定とし、「完全同期（解除を含む）」を別の明示操作として提供する。どちらも変更previewを必須とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PD-07` | 完了判定は変更箇所のunit／integration、有限な安全decisionの到達可能な全組合せ、Chromium baselineと既知engine固有riskに対する無課金local対象regression、最小a11y確認、短時間performance smokeで行う。a/b identity、原子性、stale write 0、OFF／safe mode、Backup／rollbackは異なるtest層で意図的に重ねて確認する。証跡はcommit SHA、実行command、exit code、所要時間のテキスト記録で十分とし、外部registry、cloud保存、複数role approval、利用metrics、第三者receipt、実イベントpilot、managed device receiptを要求しない。特定機種の正式保証は表記せず、対象と対象外を明記する                                                                                                                                                                                                                                                                                                 |
| `PD-08` | 初版の主機能は原子的保存、通常・集中表示、経路、章7.1のV2 eligibilityをeffective ON前／ON中に維持して必ず生成可能にするイベント単位Backup V2、losslessな場合だけのV1互換core同時出力、条件付き旧版fallbackとし、安全上不可分な同一地図内copy、lifecycle、再取込・通常編集、retained管理、共有訪問projection、ローカル制御・復旧導線も必須support scopeへ含める。完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図コピー、意図的再訪は後続版へ送る                                                                                                                                                                                                                                                                                                                                                                                                               |
| `PD-09` | イベント削除時は「30日保持」を既定、「今すぐ完全削除」を明示選択とする。保持中は端末内で再関連付けでき、30日後に端末時計が正常な場合だけ対象設定を自動削除する。設定単独ファイル出力は後続版とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PD-10` | fixtureを使うretryなしの短時間自動テストをrelease判定にする。有限な安全decisionは高速unit／integrationで到達可能な全組合せを確認し、重要不変条件はowner phaseとI11 releaseで異なる層から重ねて確認する。実機receiptや3実イベントpilot、risk根拠のない全軸browser直積、最大サイズ実fileの反復生成は完了条件にしない。browser固有riskの組合せtestは対象を絞って残す。明白なrunner障害だけ、人が確認して失敗jobまたは同じlocal commandを1回再実行できる                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `PD-11` | 分割セルに`whole`または非対応番号がある場合はa/bへ推測割当てせず、「側未設定」badge、一覧、分割有効化前previewで存在を知らせる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PD-12` | 健全なV2 snapshotは章7.1の`V2SnapshotHealthDecisionV1.kind = "healthy"`であり、companion V1のlossless representabilityにかかわらずBackup V2を必ず生成可能にする。effective ON前とON中writer after-imageで同じhealth oracleを通し、不適格eventはwrite 0件でON／変更を拒否して修復導線を返す。V1互換coreをlosslessに生成できる場合は同じsnapshotから同時出力し、構造上losslessでない場合は理由・旧版fallback不可・V2保管必須を確認させた`structural-v2-only-prepared`、V1／pairのresource上限だけを超える場合は同じ確認を持つ`resource-v2-only-prepared`として出力する。V1のためにV2まで禁止したり、値をdrop／正規化してV1を捏造したりしない                                                                                                                                                                                                                                     |
| `PD-13` | 経路connectorは自セルまたは結合セル領域内で安全に接続できる場合だけ描画し、領域外や障害物横断が必要なら`unroutable`とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `PD-14` | 同じ`ExecutionVisitIdentity`の商品追加は既存訪問へglobal統合し、raw訪問位置を動かさず、必要な`PhaseVisitIdentity`投影だけを追加して全画面へ同じ結果を反映・通知する。利用者が同じ売場を意図的に複数回訪れる機能は初版対象外とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PD-15` | 1イベントにつき主に編集する端末は1台とし、端末間自動同期・自動mergeを行わない。Backupはpreview後の原子的置換であり、端末全体OFF・イベント別ON／OFFを収録せず、新規復元はOFF、既存イベントへの復元は復元先のローカル状態を維持する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PD-16` | 分割ON中の編集、取込、復元、地図変更が`01a`／`1a`等の正規化衝突を新たに作る場合、その操作全体をstore書込み前に原子的に拒否する。既存data、分割設定、ローカルONは維持し、自動OFFや部分取込を行わず、衝突した原文と修正方法を表示する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PD-17` | 3.13の件数は安全に扱うための設計上限であり、日常CIの速度保証ではない。必須性能確認は代表fixtureでwarm-up 1回＋計測3回、全体5分以内の退行検知とする。最大fixtureの実測は性能関連変更または公開候補で必要性を判断して手動1回だけ実施し、未実施なら最大規模の応答時間を対外保証しない。多時間matrix、memory polling、30回反復は行わない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `PD-18` | browser／OS／profileによる保存領域の完全消去はアプリが新規installと区別できないためデータ保持保証の対象外とする。部分破損、payload／metadata／checkpoint不整合、store欠落、quota、abortは検出して誤接続・部分commitを防ぎ、安全モードとBackup復旧案内を提供する。完全消去はclean-startと事前Backup案内を試験する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

FSMC-I0では、後続phaseが共有する契約、代表fixture、短時間test scriptを固定する。未実装featureを成功扱いにするstub、空test、`--passWithNoTests`は置かない一方、全機能の巨大fixtureやbrowser matrixをI0で先行作成しない。

- DBなし、現行core DB version、`Vcap - 1`、`Vcap`、`supportedMaximumVersion`、`supportedMaximumVersion + 1`を重複排除した境界集合、`Vcap`更新commit直前／直後の終了、運用後に全recordだけを失った空storeのfixture、capability decision table、preflight harnessを用意し、I2で実装する各分岐の期待結果を固定する。現行値5／候補6／supported上限7／拒否境界8はprovenance fixtureの具体例として残すが、期待分岐をliteralへ結び付けない。I0自身はproduction DB versionやruntime保存経路を変更しない
- full observed root、checkpoint、candidateの物理locationをIDB transaction内／localStorage externalへ分けたroot別観測vector、全governed rootのbaselineを保持するexternal durable fenceを持つ`(storeName, key)`単位のCAS契約、`onupgradeneeded`内の初期root原子作成、partial-loss snapshot、ローカル発行ID、anchor token、active／dormant／quarantined、30日保持と時計異常、control root、`durable-visit-state` root、衝突時全拒否を固定する。さらに、現行localStorageの`blockDetectionSettings`をcanonical IDB `eventSettings` rootへ移す旧版互換bridge journal、全削除対象のcoverage closure、unknown store／keyのlossless退避不能時stopをexact schema・ADR・golden fixtureへ含める
- 3.13の最大値を生成できるdeterministic fixture generatorと、小さな日常fixture（300セル、20 block、50分割設定、100 item、100 visit）を分ける。I0必須はgeneratorの件数／hash検証と小fixtureのquick smokeだけとし、最大fixture、shard、calibration、reducerは必須にしない
- 固定旧版A→候補新版B、旧形式復元、Backup V2＋代表V1互換、通常地図編集、地図再取込、2 tab競合、ローカルOFF切替の代表fixtureを登録する。分岐表と異常境界は高速なunit／integrationへ置き、browserでは章10の代表journeyだけを実行する
- Playwrightは単一のChromium installを共有するが、Desktop mouse／Desktop touch／Mobile touchをviewportだけの切替ではない別contextにする。Mobile contextは`viewport = 390x844`、`hasTouch = true`、`isMobile = true`、`deviceScaleFactor = 3`を固定し、対象操作をtrusted touch inputで送り`pointerType = "touch"`をassertする。Desktop mouseは`hasTouch = false`、`isMobile = false`、DPR 1、Desktop touchは`hasTouch = true`、`isMobile = false`、DPR 2とする。代表smokeは合計8件を基準とし、安全性とa11yをsmokeまたはcomponent testへ含める。Firefox／WebKitは通常は任意だが、support対象engine固有の既知不具合、標準API差または変更riskを章10.4へ名前付きで登録したcaseだけは該当phaseのrequired gateとし、任意確認へ降格しない。実機、BrowserStack等はExitへ要求しない

基準source `2eaba92`にある`PD-14`の共有訪問projectionは、C0（I0: inventory／fixture）、C1（I1: pure identity／projection契約）、C2（I7: global projection／挿入／通知）、C3（I10: route／hit-test／cache）へ分ける。固定旧版Aはrepository内の小さなfixtureとmanifestで再現し、候補新版Bと必要時のQA buildは同じsourceからローカルで各1回buildする。GitHub Actions artifactへのupload／downloadやrun attempt間の受け渡しは前提にしない。

I0でFSMC専用の一方向導入version `FSMC_CAPABILITY_DB_VERSION`（`Vcap`）を固定する。採択はrepository内のmigration、local history、commit済みrelease metadataだけで保守的に行い、外部providerや配布registryの照会を必須にしない。既存versionの再利用を安全に否定できなければ、未使用の単調増加versionまたは別DB方式をADRで選ぶ。I2は同じcontractをintegration harness／非公開QA namespaceで検証し、I2～I10のproductionは現行DB versionを維持する。I11のrelease-ready buildだけが、代表migration、安全拒否、partial-loss testに成功した後で`Vcap`を有効化する。`dbVersion >= Vcap`で必須rootが欠ける場合は自動安全モードとBackup復旧案内にし、自動修復やDB downgradeを行わない。

本書の`true fresh`は、main DBがabsent、`LEGACY_MIGRATION_TARGETS`の10 core external sourceが全absent、固定`localStorage["syncQueue"]`もabsentの3条件を同一pre-open inventoryで満たすprofileだけを指す。以下の短縮表現「legacy external coreも空／ないtrue fresh」は必ずこの定義を参照し、syncQueue-only profileを含めない。syncQueue-onlyはarchive-only current-version commit後のpresent pre-`Vcap` profileである。

### 1.2 実装開始可否レビューの是正決定

次の`RC-*`は本計画のnormativeな是正決定である。本文と矛盾した場合は同じPRで本文とtestを揃える。巨大なmachine-readable索引や外部証跡を作らず、章9のPhase／Requirement traceability表と章14のDoD checklistで追跡する。

| 決定ID  | 確定内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RC-01` | 最初のI0変更前にclean worktreeで`git diff --check`、`npm run test:encoding`、`npm run format:check`、`npm run typecheck`、`npm run lint`、既存unit／integration／Workerを各1回、unit→integration→Workerの順で実行する。全commandのexit code 0だけを合格とし、既知障害waiverや将来のFSMC対象testで代替しない。合計20分を超えた場合は停止し、遅い箇所を分離してからclean candidateで全列を再開する。外部前提を含む`npm run quality`全graphの完走や外部credentialをI0開始条件にしない                                                                                                                                                                                                          |
| `RC-02` | `PD-14.C0` inventoryはI0、C1 pure契約はI1、C2 projection／挿入／通知はI7、C3 route／hit-test／cacheはI10が所有する。I2～I6はport／hookと基準挙動のnon-regressionだけを所有し、後続ownerのconformanceを前phase Exitへ要求しない                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RC-03` | 初版support scopeに同一地図内copy、lifecycle、再取込・通常編集、retained管理、共有訪問projection、ローカル制御・復旧導線を含め、主機能だけを列挙した短いscope文から必須作業を除外しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `RC-04` | I2～I10のproduction artifactは現行DB5のままとし、採択済み`Vcap`へのmigrationはQA namespace／integration harnessだけで検証する。production `DB_VERSION`を採択済み`Vcap`へ進めるのはI11 release-ready candidateだけとする                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `RC-05` | 現行`NavigatorItem`へevent／map／hall責務を混入させず、runtime snapshotから解決済み`ProjectedPhaseVisit`を作るadapterを正式境界にする。`ResolvedMapLocation`、`MapLocationIndex`、projection revision vectorとassociation／hall／split input DTOはI1前にexact readonly型、revision、cardinality、canonical順、mapless／ambiguous表現まで固定する                                                                                                                                                                                                                                                                                                                                            |
| `RC-06` | 新しい3×3経路型は`SubcellPathNode`とし、既存`PathNode`と同名にしない。実production導線である`AppHeaderShell → AppOverlayLayer → src/components/VisitListPanel.tsx`を唯一の訪問一覧shellとし、I8でpure `ProjectedVisitList`を内包する構造へ移行する。到達不能で同じ番号parse／row-col解決を重複する`src/components/map/MapVisitListPanel.tsx`と`MapView`内のdead open state／render／exportはI8で廃止し、callbackは最新projectionを`PhaseVisitIdentityKey`で再解決する                                                                                                                                                                                                                       |
| `RC-07` | Backup V2 wire DTOをruntime `AppData`／persistence型から独立させる。V1とXLSX 2.2 full restoreをI4の初版compat ownerへ割り当て、URLは共通safe-link policyを通す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RC-08` | `recovery-required`は行き止まりにせず、trusted core read-only export、診断、in-place reset可能条件、profile reset＋検証済みbackup再取込の明示runbookを提供する。untrusted split rootを自動採用・自動修復しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RC-09` | Backupの入力安全上限、import拒否境界、export生成上限を方向別に固定し、UI main threadで全file `arrayBuffer`を作らない。同一origin module Worker、bounded slice、CSP／PWA asset、cancel cleanupを初版要件にする。上限testは注入可能な小limitで行い、実MiB fileの反復を必須にしない                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RC-10` | 性能確認は開発PCまたは無課金で使える標準runner上の既存Node／単一Chromiumで行い、repo-owned OCI image、container publication、digest pull、cgroup観測を要求しない。代表6 scenarioをwarm-up 1回＋計測3回、合計5分以内で実行し、詳細profileは性能退行を検出した場合だけ手動で採取する                                                                                                                                                                                                                                                                                                                                                                                                          |
| `RC-11` | 固定旧版A artifactの保管・取得・hash・license・serve方法と、既存test membership／coverage／architecture／quality workflowの更新をI0成果物にする。`ApplicationSnapshotCommitPort`と全caller、Backup Worker entry／server／client、`useCanvasViewport.ts`とCanvas callerもchange-surfaceへ列挙し、transitive dependencyを直接importしない                                                                                                                                                                                                                                                                                                                                                     |
| `RC-12` | readinessを「code存在・public到達・dispatch認可・commit可能」に分け、future profileを初版gateから分離する。DOM代替は検索・絞込み・virtualization・stable focus keyによるfocus復元を持つ。FSMC通知はtop-level app rootの`[data-fsmc-announcement-scope="v1"]`内に常設するoperation `role=status`と即時失敗用`role=alert`のexact pairへ集約し、他機能のlive-regionを禁止するのではなくFSMC eventによるmutationを禁止する。Canvasは数値化したlabel size／contrast、200% page zoom、縦横画面、forced-colors試験を持つ。画面読み上げ要件はversion付きAT代替oracleでrole、name、description、state、順序、focus、live-region発火を自動検証する                                                    |
| `RC-13` | V2の`eventSettings` authorityはcapability store内のgoverned IDB rootとし、現行localStorage `blockDetectionSettings`は固定旧版A互換projectionへ降格する。移行・旧版書込み取込・mirrorはdurable bridge journalとbefore／after witnessで再開可能にし、補償rollbackをcommit authorityにしない                                                                                                                                                                                                                                                                                                                                                                                                   |
| `RC-14` | `Vcap`はrepository内のmigration履歴、local tag、commit済みrelease manifestを入力にする。外部配布artifactやprovider receiptがなくても停止せず、再利用を否定できないversionは選ばず新しい単調増加versionまたは別DBを選ぶ。guided resetは既知store／local keyだけを対象にし、未知対象を安全に退避できなければ`unsupported-stop`とする                                                                                                                                                                                                                                                                                                                                                          |
| `RC-15` | durable visit stateはgoverned IDB key `durable-visit-state`の`DurableVisitStateRootV1`を唯一のauthorityとし、現在phase＋anchor、phase別保存anchor、完了状態、購入変更anchorを表現する。item IDだけからphase visitを推測せず、base visit順はdenseな`executionVisitOrder`、全phaseはnormal→postponed→late、各phase内はbase順へ固定する                                                                                                                                                                                                                                                                                                                                                        |
| `RC-16` | active `(eventInstanceId, mapInstanceId, blockInstanceId, number)`をexact uniqueとし、runtime／全writer／startup／V2で同じinvariantを使う。stable instance IDと可変core slot locatorを分離し、event／day-map／blockのcurrent slot keyはversion付きdomain、lossless own-keyまたは0-based block index、親instance IDからcanonical SHA-256で導出する。既存optional `BlockDefinition.id`はlossless legacy payloadとして維持するがFSMC identity／bootstrap／matching authorityに使わない。bootstrap、rename、reorder、同名block、delete＋同名再作成、複製、再取込の遷移表とidentity token、tuple、`ReadonlyMap`、checkpoint digestをversion付きbyte canonical contract／golden fixtureへ固定する |
| `RC-17` | 現行のimport競合`create-alias`をイベント全体複製とみなさない。初版のイベント全体複製はI3の新command／UIとして全core、eventSettings、map／block／item／visit／split IDをgroup-preserving remapする。通常セル編集と実導線`VisitListPanel` shellのprojection化をI6／I8の新規scopeとして見積もり、到達不能`MapVisitListPanel`の廃止を独立change-surfaceとして追跡する                                                                                                                                                                                                                                                                                                                           |
| `RC-18` | retained再関連付けは候補exact 1件、target未占有、trusted authority、commit直前も同じ候補集合の場合だけ許可し、2件以上からの利用者選択によるactive化は初版に設けない。rekey／挿入、同anchor遷移、connector mask、hit-test、表示競合もpureな決定表へ固定し、自owner番号領域だけをconnector maskで許可する                                                                                                                                                                                                                                                                                                                                                                                     |
| `RC-19` | 必須performance gateは単一processの短時間smokeとし、startup、split save、map render、interaction、route、backupの代表6 scenarioをbaselineにする。性能riskのある変更では対象parameter、境界、比較oracleを5分枠内へ追加し、6件だけという理由で回帰caseを削らない。CI jobを増殖させる軸直積matrix、shard、reducer、Jobs API観測、300分／330分timeoutは設けない。各scenario 45秒、全体5分を超えたら失敗として停止する                                                                                                                                                                                                                                                                           |
| `RC-20` | normative IDは`PD-*`、`RC-*`、`DOD-FSMC-*`、`EXIT-FSMC-*`を維持するが、生成execution index、document registry、artifact class graph、逆index verifierは必須にしない。章9のphase表でowner／Exit／代表commandを直接対応付け、参照切れはMarkdown linkとreviewで確認する                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `RC-21` | 最大fixture generatorは100×150 grid等の件数とseedを決定的に再現できるようにする。日常のrequired testは小fixtureを使い、最大fixtureはgenerator count／hashのunit testと、必要時の手動1回だけにする。最大fixtureのbrowser反復やDesktop／Mobile二重測定を要求しない                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RC-22` | 外部serviceをFSMCの前提から外す。AWS S3／KMS／CloudTrail／Budgets、GHCR、Protected Environments、Actions Artifacts、package公開、fork token、repository admin API、外部browser／device farmはpre-I0、I0 Exit、I11、公開、事故復旧のいずれにも要求しない。GitHub Actionsはpublic標準runnerを無課金で利用できる場合の任意再確認に限定し、利用不能・有料化・非公開化時は同じlocal commandの記録で代替する                                                                                                                                                                                                                                                                                      |
| `RC-23` | `split-picker-popup`を通常マップI8／集中モードI9とDesktop direct-hit／Mobile pickerの4 scenarioへ分割し、各entryに単一profileと単一値の`enforcedFromPhase`を持たせる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `RC-24` | 重複物理`(row, col)`だけをmap-wide fatalな`map-data-untrusted`とする。重複番号、複数block owner、番号領域重複、merge越境は`ready-with-exclusions`として正規化済み影響領域だけを除外し、無関係なlocation、描画、訪問、経路を継続する。fatalと局所除外を同じresult branchへ潰さない                                                                                                                                                                                                                                                                                                                                                                                                           |
| `RC-25` | map上の一意な物理geometry slotと、whole／a／b／unsupported suffixごとの論理locationを分離する。`26c`／`26d`／`26ab`はitem snapshot由来のcanonical suffix request集合からpure APIで別々の`LocationKey`へ導出し、同じwhole-cell中心へ接続する。lookupの最大2 location前提を廃止し、suffix、item association revision、logical location集合をindex revisionへ拘束する                                                                                                                                                                                                                                                                                                                          |
| `RC-26` | 新route inputへ選択hall identity、map identity、canonical polygon、polygon fingerprintを持つdata-only `RoutePathConstraintV1`を追加し、main path、simplification後segment、routing port、全connector、same-cell directを同じinclusive polygon内へ閉じる。constraint fingerprintをcache signatureへ含め、whole-map／別hall／stale polygon間でcacheを再利用しない                                                                                                                                                                                                                                                                                                                             |
| `RC-27` | I7で`executionVisitOrder`を唯一のbase順authorityとする共通reorder planner／atomic commandへ、`useMapRouteCommands`のhall順reorderと`useMapVisitListCommands`の手動reorderを移す。I7はheadless planner／draft model／atomic command、I8は`VisitListPanel`のpointer／keyboard UIを所有する。normal/base rowだけをreorder可能にし、postponed／lateはbase順から派生する。raw item ID配列を並べ替えず、hall route settingsとdurable orderを同じ`ExpectedRootVector`・transactionで確定し、UIのdraft／cancel／close／staleは永続rootを変更しない                                                                                                                                                  |
| `RC-28` | Backup V2は主端末移行と完全復旧の必須artifactであり、章7.1でhealthy／blocked／operational failureを分離する。effective ON前とON中writer after-imageは同じrepresentability preflightを通し、blocked sourceをONにしない。healthy V2 snapshotのcompanion V1不能はV2生成blockerにせず、lossless V1がある場合はpair、ない場合は理由digestと旧版fallback不可表示を持つV2-only handoffとし、両分岐でV2 bytes、source SHA、snapshot revision、handoff receiptを再検証する                                                                                                                                                                                                                           |
| `RC-29` | `forcedPickerOverride`は端末全体・全event・通常／集中共通のboolean設定とし、canonical `control` rootへ保存する。既定false、authority不明時のeffective値true、入口は設定のアクセシビリティ「常にセル側選択ダイアログを表示」、解除は利用者の明示OFFまたはprofile resetだけとし、viewport／UA変化やevent切替で自動解除せずBackupへ収録しない                                                                                                                                                                                                                                                                                                                                                  |
| `RC-30` | pre-I0ではlocal quick baselineと章15のverification record様式だけを用意する。GitHub／AWS observer、credential、API allowlist、外部result schema、resource intent approval、billing approvalは作らない。local commandが同じcandidate SHAで成功すればI0を開始できる                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `RC-31` | baselineのPlaywright Chromiumが未導入の場合だけ`npx playwright install chromium`（Linux CIでOS依存packageも必要な場合は`npx playwright install --with-deps chromium`）を1回実行する。browser installを各job／各phaseで繰り返さない。support対象engine固有の既知不具合または変更riskがある場合は、無課金でlocal実行できるFirefox／WebKitの該当engineだけを1回installして対象regressionをrequiredにできるが、全journey×全engineへ展開しない                                                                                                                                                                                                                                                   |
| `RC-32` | requirement追跡は章9のphase表にowner、代表test、Exitを1行で記す。fixture／testを複数IDへ再利用でき、巨大なcatalog、generated document、双方向集合一致、artifact hash連鎖を完成条件にしない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `RC-33` | 初版は19論理PRを基準とし、I0／I2／I4を依存順の3 PR、I11を2 PR、その他phaseを原則1 PRとする。件数自体をExit条件にせず、各PRは変更対象のunit／integration／Workerと必要なbrowser smokeを同梱し、前半PRはproduction public edgeを増やさない。さらに分割が必要なら責務境界と追加理由をPR前に記録するが、9 WBS bundle、37～47 PR、専用evidence PRは作らない                                                                                                                                                                                                                                                                                                                                      |
| `RC-34` | 通常PRのrequired testは最大並列2、CI jobの軸直積matrixなし、1 command 10分以下、全体20分以下とする。test data内の有限な安全decision全組合せと、異なる層による重要不変条件の重層確認は維持する。I11だけは既出commandの同一実行を足し直さず、production build、browser／performance、feature-disabled build／smokeを束ねる`test:fsmc:release:quick` 1 commandを20分上限とする。このaggregate内でrelease artifactから重要不変条件を再確認することは意図した防御層であり削らない。自動retryは0、明白なrunner障害だけ人手で同じcommandを1回再実行できる。runner分／billing／capacity approvalは不要とする                                                                                        |
| `RC-35` | Backup V2 embedded digestは`digest` fieldを除くexact validated objectを`{ domain: "fsmc-app-backup-v2-v1", backupWithoutDigest }`として`esp-json-v1` canonical serializeしたUTF-8 bytesのSHA-256とする。schema／duplicate-property／未知key検証後に計算し、`scope.companionCore`のincluded／unavailable分岐を含む全field mutationを検出する                                                                                                                                                                                                                                                                                                                                                 |
| `RC-36` | build artifact全体hashはmanifest自身を含むarchive byte hashではなく、manifestを除外したcanonical file-tree digestとする。POSIX `/`相対path、全regular fileのbyte SHA-256／length、UTF-16 code-unit path順を固定する。nested directoryは許すがdirectory entry自体は列挙せず、symlink／junction／reparse point／device fileを禁止する。manifestはそのtree digestと自身のschema versionを持つ。別root／timezoneで同値、path／byte差で不一致をI0 fixtureにする                                                                                                                                                                                                                                  |
| `RC-37` | Pointer FSMはvalid state／registryから到達可能な`(state, normalizedInput)`のexact集合をtotal transition tableへ固定し、table-driven unit testで全reachable rowを実行する。到達不能な全state×全eventの直積は作らず、unreachable理由をcontractへ固定する。capture失敗、non-primary、ID再利用、multi-pointer drain、unmount、lost capture、synthetic click、viewport revision差は全reachable rowに加えて固定seed・最大100 caseのbounded event-sequence property testで重ねて確認する。全terminalはpointer registry／timer／captureを空にして`idle`へ戻し、未定義reachable eventやcleanup漏れを拒否する                                                                                         |
| `RC-38` | FSMC専用branch protection、dynamic required context、protected environmentは作らない。repository既存のquality checkを変更せず、FSMCは`fsmc-quick`という単一の短時間checkまたは同じlocal command記録を追加する。外部設定権限がないことを実装blockerにしない                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `RC-39` | 同一candidateでは同じcommand／binary／fixture／assertionの無目的な再実行を避ける一方、typecheck、unit／integration、build、browser smokeが別々のfailure signalを持つ重層確認は維持する。安全上重要な同じ不変条件を各層で再確認してよい。buildをjob間でActions artifactとして受け渡さず、同一job内でbuild後すぐsmokeする。結果はconsole summaryとverification recordだけに残す                                                                                                                                                                                                                                                                                                               |
| `RC-40` | optional GitHub Actionsを使う場合も標準runner上の単一jobを基本とし、最大並列2、通常PRはtimeout 20分、I11だけは`npm ci`込み25分とする。CI jobを増殖させる軸直積matrix、container、Jobs API／Artifacts API、resource-control、rerun-preflight、ledger、reducer、finalizerを追加しない。単一job内のtable-driven全組合せ、risk-based parameter、異なるtest層の重層確認は維持する。`upload-artifact`／`download-artifact`は通常経路で使用せず、失敗traceはlocal再現時だけ保存する                                                                                                                                                                                                                |
| `RC-41` | 事故証跡はrepository commit／issueまたは利用者が選ぶlocal directoryに、candidate SHA、発生時刻、再現手順、Backup SHA-256、対応結果を小さなtext／JSONで残す。AWS S3、Versioning、Object Lock、KMS、OIDC、CloudTrail、365～400日保持、live qualification、budget approvalを要求しない。個人情報やcredentialは記録しない                                                                                                                                                                                                                                                                                                                                                                       |
| `RC-42` | full persistence `ExpectedRootVector`／projection revisionはCAS・stale検出に維持する一方、`MapLocationIndexSemanticRevision`とroute semantic revisionは位置・順序へ影響するcanonical field／導出requestだけから計算する。価格、数量、メモ、購入状態だけの変更で位置索引を再構築せず、semantic revision一致を保存authorityとして再利用しない                                                                                                                                                                                                                                                                                                                                                 |
| `RC-43` | I11でproduction `Vcap` migrationとFSMC公開を同じrelease-ready buildへ入れるリスクは、代表migration、安全拒否、Backup、feature-disabled rollback buildのlocal smokeで確認する。rollbackはDB downgradeを行わず、split UI／mutationを停止してBackup復旧導線を残す。GHCR publication、anonymous pull、3 role approval、168時間receiptは要求しない                                                                                                                                                                                                                                                                                                                                               |

現時点の実行可否は次のとおりである。

| 対象                                                       | 判定                                      |
| ---------------------------------------------------------- | ----------------------------------------- |
| 計画書修正                                                 | Go                                        |
| pre-I0 local quick baseline                                | 診断実行Go。全列成功までExit未達          |
| FSMC-I0                                                    | **No-Go**。format是正・全列再成功後だけGo |
| FSMC-I1以降                                                | 直前phaseの小さなExit達成後Go             |
| AWS／GHCR／Protected Environments／Actions Artifactsの準備 | 不要                                      |

pre-I0はclean worktreeで`git diff --check`、`npm run test:encoding`、`npm run format:check`、`npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run test:integration`、`npm run test:worker`を各1回実行し、candidate SHA、exit code、所要時間を章15の様式で記録する。Vitest worker起動競合を避けるためunit／integration／Workerは同じaggregate内でもこの順に直列実行する。全commandのexit code 0が同じclean candidateで揃うことだけを合格とし、既知障害waiver、対象commandの省略、I0で初めて作るtestによる代替を認めない。合計20分を超えた場合は待ち続けず停止し、遅いsuiteを変更対象testへ分けたうえで全列を最初から再実行する。外部credentialやread-only API観測がなくても失敗にしない。

2026-08-25診断ではclean worktree、`git diff --check`、encoding、typecheck、lint、unit（149 files／1,207 tests）、integration（28 files／409 tests）は成功し、`npm run format:check`だけが既存`docs/各フェーズのFormal Exit達成.md`のPrettier不一致で失敗した。したがって現判定はNo-Goである。対象Markdownを専用hygiene commitで整形し、cleanになった次candidateで上記全command（Workerを含む）を再実行して初めてpre-I0 Exitを記録する。診断時にunitとintegrationを並列実行してVitest worker起動が競合した事実は製品failureへ数えないが、直列再実行結果だけをbaseline記録へ採用する。

### 1.3 実行順と記録の境界

実行順のauthorityは章9のPhase一覧とsub-PR表、requirement完了のauthorityは同章のRequirement traceability表とする。別のgenerated execution index、document registry、WBS JSON、artifact class catalogは作らない。各PR本文にphase／sub-PR、対応Requirement ID、主な変更、実行したcommand、所要時間、結果を記録すればよい。

| 実行単位 | Entry                    | 主成果物                                        | 完了確認                           |
| -------- | ------------------------ | ----------------------------------------------- | ---------------------------------- |
| pre-I0   | 計画採択、clean worktree | quick baseline記録                              | 章15のlocal command成功            |
| I0       | pre-I0成功               | 契約、代表fixture、`fsmc-quick` scripts         | `EXIT-FSMC-I0-001`                 |
| I1～I4   | 直前Exit                 | domain、保存、lifecycle、Backup                 | 各phaseの代表unit／integration     |
| I5～I7   | 直前Exit                 | 設定UI、再取込、訪問projection                  | 変更対象test＋必要なChromium smoke |
| I8～I10  | 直前Exit                 | 通常map、集中mode、route                        | 代表browser smoke＋短時間性能smoke |
| I11      | I10 Exit                 | release build、local rollback build、利用者文書 | `fsmc-release-quick`成功           |

ADRとrunbookは判断または手順が本文だけでは不明になる場合だけ追加する。自動生成、hash連鎖、外部approval、sourceへcandidate hashを書き戻す仕組みは不要である。

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
- 実際の地図訪問一覧導線: `src/features/app-shell/components/AppHeaderShell.tsx` → `src/App.tsx`／`src/app/commands/useMapVisitListCommands.ts` → `src/app/state/appOverlayState.ts`／`src/app/state/useAppUiState.ts` → `src/features/app-shell/components/AppOverlayLayer.tsx` → `src/components/VisitListPanel.tsx`
- 実訪問一覧のselector／現行test: `src/app/selectors/appListViewSelectors.ts`、`src/components/VisitListPanel.touchCancel.test.tsx`。I0 inventoryは`AppHeaderShell`／`AppOverlayLayer`／`VisitListPanel`の実在testを`rg --files`とtest import graphからexact pathで列挙し、globや存在しない`__tests__` pathをauthorityへ保存しない
- 到達不能な重複訪問一覧surface: `src/components/map/MapVisitListPanel.tsx`、`src/components/map/MapVisitListPanel.integration.test.tsx`、`src/components/map/MapView.tsx`内の`isVisitListOpen`／`handleJumpToCell`／render、`src/components/map/index.ts`のexport。I8で全て削除し、source／build／productionのimport／caller／JSX／test edgeを0件にする
- block legacy payload／生成／編集面: optional `BlockDefinition.id`を持つ`src/types/map.ts`、IDを発行しない`src/xlsx/engine/mapWorkbookEngine.ts`、編集時にIDをauthority化しない`src/components/map/BlockDefinitionPanel.tsx`。いずれもsidecar identityのchange-surfaceへ含める
- 通常マップ経路adapter: `src/components/map/mapViewRouteCalculations.ts`
- 集中モードcomposition: `src/features/map/components/FocusModeContainer.tsx`
- space-navigation: `src/features/space-navigation/types.ts`、`src/features/space-navigation/domain/buildNavigatorEntries.ts`、`src/features/space-navigation/domain/visitIdentity.ts`
- 経路hit-test／描画: `src/utils/mapRouteHitTest.ts`、`src/utils/routeRendering.ts`、`src/utils/focusRouteCalculation.ts`
- 地図再取込command／overlay: `src/features/map/domain/mapImportFlow.ts`、`src/app/commands/useMapImportCommands.ts`、`src/app/state/appOverlayState.ts`
- Backup command／overlay: `src/app/commands/useEventTransferCommands.ts`、`src/app/state/appOverlayState.ts`
- Canvas gesture authority／DOM終端: `src/features/map/canvas/useCanvasViewport.ts`、`src/components/map/MapCanvas.tsx`、`src/components/map/MapCanvasPresentation.tsx`、`src/components/FocusModeMapCanvas.tsx`
- Worker参照実装: `src/xlsx/worker/xlsx.worker.ts`、`src/xlsx/worker/workerServer.ts`、`src/xlsx/adapters/workerXlsxExecutionPort.ts`
- FSMC QA profileの閉じたallowlist面: `scripts/build-release-vite.mjs`、`scripts/verify-release-a-build.mjs`、`vite.config.ts`、`scripts/lib/release-build-input.mjs`／`.d.mts`、`scripts/build-pwa-recovery-agent.mjs`、`scripts/release-policy.test.mjs`、`scripts/build-pwa-recovery-agent.test.mjs`。`qa-fsmc`は全境界でstandard role／non-promotableに限定し、未知profile拒否を弱めない
- event rename／delete writerの実authority: `src/app/commands/useEventLifecycleCommands.ts`とtest → `PersistenceCommandPort.ts` → `indexedDbPersistenceCommandAdapter.ts` → `indexedDbPersistence.ts` → `atomicRestoreTransaction.ts`、および`applicationSnapshotOps.ts`。I3でsplit／control／durable visit／event settings／V2 health participant外のwriter edgeを0件にする
- capability object storeの閉じた変更面: `constants.ts`、`openDatabase.ts`、`transactionCoordinator.ts`、各repository、`atomicRestoreTransaction.ts`、`legacyMigration.ts`、`recoveryAdoption.ts`、`recoverySourceEvidence.ts`、`recoveryRepository.ts`、`persistenceResilience.ts`、facade／adapter／Port、`useIndexedDbPersistence.ts`、`appRuntime.ts`、DB compatibility contractと対応test。`constants.ts`だけを変更面とみなさない
- FSMC policy面: test project membership、Vitest unit／integration／Worker、architecture policy／baseline、coverage policy／verifier／policy test、`package.json`の`quality`／`quality:local`。`src/features/map-cell-split/`を未分類subsystemにしない

FSMCの地図描画と経路探索はローカルCanvasと`src/utils/pathfinding.ts`の3×3 A\*を使用し、Mapbox、Google Maps、MapLibre、Leaflet等の外部地図・経路APIやAPI keyを追加しない。実装、テスト、公開、事故復旧はAWS、GHCR、外部browser／device farmへ依存しない。必要な検証はrepository内fixtureとローカルNodeを基本に、Chromium baseline、および既知engine固有riskがある場合の無課金local Firefox／WebKit対象regressionで完結させる。

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
- a/b文字は各側の投影後短辺`projectedSideMinCssPx >= 20`（等号は表示）で両側とも表示し、`< 20`では両側とも非表示にする。fontは`700 12 CSS px / 16 CSS px`、label plate paddingは各辺2 CSS px、glyphはscreen上で正立、DPRを二重適用しない。unit testは19.99／20／20.01 CSS px×canonical回転0°／90°／180°／270°×DPR 1／2／3をtable-drivenで全件確認し、その他の有限角度は固定seed・最大100 caseのproperty testで重ねる。browserは20 CSS px境界の代表画面をbaselineとし、描画riskが判明した回転／DPR組合せを対象snapshotへ追加する。根拠のない全角度×全DPR画像生成は行わない
- 通常マップは現在の「巡回リストへの追加状態・優先度」の色規則を維持する
- 集中モードは現在の購入状態・進行状態の色規則を維持する
- 状態集計はa/bごとに独立させる
- 空の側は着色しない
- 結合セルは結合された長方形全体を半分にする
- 分割方向は地図座標で保存し、地図の回転と一緒に見た目も回転する

### 3.6 クリック・タップ

- `PD-05`に従い、表示用`layoutMode`と操作用`isSmartphoneSelectionMode`を分離する。pure `resolveSmartphoneSelectionModeV1`は`forcedPickerOverride`、`mobileCapability: true | false | "unknown"`、primary pointer／touch capabilityを入力にする。優先順位と安全側pickerへのfallbackはdecision tableの高速unit testで全reachable input classを確認し、browserはDesktop direct、Mobile picker、overrideの代表3ケースをbaselineにする。viewport、UA、touchのraw直積のうち同じnormalized inputへ畳まれる組合せは反復せず、実browserで別挙動になるrisk組合せは対象regressionとして残す。
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
- 「後回し」または「遅参」で追加した商品は現行規則に従って該当日のraw実行商品ID配列へ追加する。同じ`ExecutionVisitIdentity`の既存訪問が配列内のどこかにある場合は非連続でもその訪問へglobal統合し、raw訪問位置、現在位置、保存位置を動かさず、normal投影へ統合すると同時に必要な後回し／遅参`PhaseVisitIdentity`だけをbase順で追加する。通常マップ、集中モード、買い物一覧、`VisitListPanel` shell／`ProjectedVisitList`、routeへ同じ結果を反映して「既存のA-26a訪問へ追加しました」と通知する。既存execution identityがない場合だけ実行リスト末尾に新しいbase訪問を作る。共有投影または経路座標semantic signatureが変化した場合だけ経路を再計算する
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
- DOM訪問一覧の各`PhaseVisitIdentity`に「この訪問の後へ挿入」を設ける。追加対象の`ExecutionVisitIdentity`が存在しない場合だけ、anchor phase visitからbase execution visitを求め、denseな`executionVisitOrder`でその直後へ新identityを挿入して後続orderを1ずつ進める。raw商品IDは既存member相対順を維持して追加し、`[A1, B, A2]`のような非連続memberの「最後のraw index」をbase順authorityにしない。既存execution identityがある場合は、追加対象phaseがまだ存在しなくても指定anchorを無視し、商品を既存base訪問へglobal統合して必要な新phase entryをbase位置へ追加する。「既存訪問へ統合したため、指定位置に新規訪問は作成しませんでした」と通知する。例としてnormalが`A→B`のときに後回しAを「Bの後」へ指定しても、後回しAはnormal Aとは別のphase訪問としてbase A位置へ投影し、Bの後には置かない。成功は`visit-inserted`または`visit-selected`、取消は`visit-insert-cancelled`、競合は`operation-stale`のstable operation event ID付きで通知し、操作元へfocusを戻す
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

### 3.13 設計上限と短時間検証

次の値は入力安全設計とfixture generatorが扱う上限であり、日常CIにおける応答時間保証ではない。

- 地図の論理セル数: 15,000
- 論理ブロック数: 最大8,192
- 分割設定: 最大15,000件（分割後のa/b領域は最大30,000）
- アイテム数、`SpaceIdentity`、`ExecutionVisitIdentity`: 各400
- `PhaseVisitIdentity`: 最大800。ただし単一phaseのroute入力は最大400
- active＋retained設定: export対象は合計20,000件以下。file byte上限は7.3を優先する

必須のquick testは300セル、20 block、50分割設定、100 item、100 visitの代表fixtureを使う。最大fixtureはgeneratorのcount／hashを高速unit testで確認し、性能関連変更または公開候補で必要性がある場合だけローカルで1回実測する。最大fixtureを実測していないreleaseでは「上限まで保存形式上扱える」とだけ説明し、最大規模の描画・経路・export時間を保証しない。

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

座標契約を混在させない。`GridCellAddress`は1-based整数の`row`／`col`、geometryの`MapPoint`は列1左端・行1上端を`(0, 0)`とする0-based連続`x`／`y`である。単一セル`(row, col)`のboundsは`[col - 1, col) × [row - 1, row)`、whole中心は`(col - 0.5, row - 0.5)`とする。`startRow..endRow`、`startCol..endCol`の結合領域は`[startCol - 1, endCol) × [startRow - 1, endRow)`へ正規化し、そのboundsをa/bへ二分する。pathfindingは`SUB_CELL_RESOLUTION = 3`の0-based整数`SubcellPathNode { subRow, subCol }`を使い、1-basedセル`(row, col)`は`subRow = (row - 1) * 3 .. row * 3 - 1`、`subCol = (col - 1) * 3 .. col * 3 - 1`を所有する。`pathNodeToMapPoint`は`x = (subCol + 0.5) / 3`、`y = (subRow + 0.5) / 3`とし、routing adapter以外で相互変換しない。client座標、アプリ倍率、地図zoom、任意回転、DPRは通常マップと集中モードで共有するviewport adapterが処理する。各half polygonをmap→client CSS変換した丸め前の連続頂点列`p[0..n-1]`について`sideMinCssPx = min_i hypot(p[(i+1) mod n].x - p[i].x, p[(i+1) mod n].y - p[i].y)`、`projectedSideMinCssPx = min(sideMinCssPx(a), sideMinCssPx(b))`とし、DPR変換前・paint pixel snap前に評価する。split線への距離も同じclient CSS spaceで`projectedDistanceToSplitCssPx`として返す。interaction policyだけが端末判定、入力別閾値、曖昧帯を評価し、CSS px閾値やDPRをdomain geometryへ混入させない。`config/fsmc-visual-contract.json`はこの式、font／padding／contrast／20 CSS px境界をschema化し、15°／359°の境界代表と、`[0, 360)`から固定seedで最大100 caseを選ぶbounded property testにより回転不変性とDPR非二重適用を検証する。全有限角度の列挙は行わない。

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
type EventInstanceIdV1 = string & { readonly __brand: "EventInstanceIdV1" };
type MapInstanceIdV1 = string & { readonly __brand: "MapInstanceIdV1" };
type BlockInstanceIdV1 = string & { readonly __brand: "BlockInstanceIdV1" };
type SplitIdentityAnchorTokenV1 = string & {
  readonly __brand: "SplitIdentityAnchorTokenV1";
};
type LocationKey = string & { readonly __brand: "LocationKey" };
type MarkerStackKey = string & { readonly __brand: "MarkerStackKey" };
type MapLocationIndexSemanticRevision = string & {
  readonly __brand: "MapLocationIndexSemanticRevisionSha256";
};
type LogicalLocationRequestDigestV1 = string & {
  readonly __brand: "LogicalLocationRequestDigestV1Sha256";
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
      eventInstanceId: EventInstanceIdV1;
      mapInstanceId: MapInstanceIdV1;
      blockInstanceId: BlockInstanceIdV1;
      baseNumber: number;
      sideIdentity: SpaceSideIdentity;
    }
  | {
      kind: "mapless";
      eventInstanceId: EventInstanceIdV1;
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
  blockInstanceIds: readonly BlockInstanceIdV1[];
  mergedBounds: MapBoundsV1 | null;
}

interface MapLocationLogicalRequestV1 {
  blockInstanceId: BlockInstanceIdV1;
  baseNumber: number;
  normalizedUnsupportedSuffixes: readonly string[];
}

type MapLocationLogicalSourceItemV1 =
  | {
      itemId: string;
      resolution: "mapped-to-target-map";
      blockInstanceId: BlockInstanceIdV1;
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
  eventInstanceId: EventInstanceIdV1;
  targetMapInstanceId: MapInstanceIdV1;
  sourceReadWitness: ExpectedRootVector;
  eventItemIds: readonly string[];
  items: readonly MapLocationLogicalSourceItemV1[];
  itemSetDigest: string;
  logicalLocationRequestDigest: LogicalLocationRequestDigestV1;
  snapshotDigest: string;
}

// `eventItemIds`は重複なしのECMAScript UTF-16 code-unit順、`items`も同じ比較による`itemId`順とし、両配列のIDは同じindexで一致するexact bijectionでなければならない。source item／association入力のshuffleでも両配列、`itemSetDigest`、`snapshotDigest`、index revision、論理location集合をbyte同値にする。BMP／astral文字を混在させたopaque item IDの全shuffleをgoldenにし、Unicode code point順やlocale順への差替えを拒否する。

interface MapLocationIndexSplitInputV1 {
  blockInstanceId: BlockInstanceIdV1;
  baseNumber: number;
  split: MapCellSplit;
}

interface MapLocationIndexBuildInputV1 {
  schemaVersion: 1;
  eventInstanceId: EventInstanceIdV1;
  mapInstanceId: MapInstanceIdV1;
  mapStructureFingerprint: string;
  casReadWitness: ExpectedRootVector;
  cells: readonly MapLocationIndexCellInputV1[];
  activeSplits: readonly MapLocationIndexSplitInputV1[];
  logicalLocationSourceSnapshot: Readonly<LogicalLocationSourceSnapshotV1>;
}

interface MapLocationGeometrySlotV1 {
  physicalSlotKey: MapLocationPhysicalSlotKey;
  eventInstanceId: EventInstanceIdV1;
  mapInstanceId: MapInstanceIdV1;
  blockInstanceId: BlockInstanceIdV1;
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
  blockInstanceIds: readonly BlockInstanceIdV1[];
  baseNumbers: readonly number[];
  lookupCells: readonly [GridCellAddress, ...GridCellAddress[]];
}

interface MapLocationIndex<
  TExclusions extends readonly MapLocationExclusionV1[] =
    readonly MapLocationExclusionV1[],
> {
  schemaVersion: 1;
  eventInstanceId: EventInstanceIdV1;
  mapInstanceId: MapInstanceIdV1;
  semanticRevision: MapLocationIndexSemanticRevision;
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
  blockInstanceId: BlockInstanceIdV1;
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
    | { mapInstanceId: MapInstanceIdV1; blockInstanceId?: never }
    | {
        mapInstanceId: MapInstanceIdV1;
        blockInstanceId: BlockInstanceIdV1;
      };
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
  mapInstanceId: MapInstanceIdV1;
  lastKnownDayKey: string;
  lastKnownMapName?: string;
  mapStructureFingerprint: string;
  entries: ActiveMapCellSplitEntry[];
}

interface SplitIdentityAnchorV1 {
  schemaVersion: 1;
  token: SplitIdentityAnchorTokenV1;
}

type CurrentEventSlotKeyV1 = string & {
  readonly __brand: "CurrentEventSlotKeyV1Sha256";
};
type CurrentDayMapSlotKeyV1 = string & {
  readonly __brand: "CurrentDayMapSlotKeyV1Sha256";
};
type CurrentBlockSlotKeyV1 = string & {
  readonly __brand: "CurrentBlockSlotKeyV1Sha256";
};

type CurrentSlotBindingV1<TSlotKey extends string> =
  | { bindingState: "current"; currentSlotKey: TSlotKey }
  | { bindingState: "unbound"; currentSlotKey?: never };

interface MapCellSplitAssociationRegistry {
  eventAssociations: Array<
    {
      eventInstanceId: EventInstanceIdV1;
      anchorToken: SplitIdentityAnchorTokenV1;
    } & CurrentSlotBindingV1<CurrentEventSlotKeyV1>
  >;
  mapAssociations: Array<
    {
      eventInstanceId: EventInstanceIdV1;
      mapInstanceId: MapInstanceIdV1;
    } & CurrentSlotBindingV1<CurrentDayMapSlotKeyV1>
  >;
  blockAssociations: Array<
    {
      mapInstanceId: MapInstanceIdV1;
      blockInstanceId: BlockInstanceIdV1;
    } & CurrentSlotBindingV1<CurrentBlockSlotKeyV1>
  >;
}

type PersistentIdentityRefV1 =
  | { entityKind: "event"; instanceId: EventInstanceIdV1 }
  | { entityKind: "map"; instanceId: MapInstanceIdV1 }
  | { entityKind: "block"; instanceId: BlockInstanceIdV1 };

type PersistentIdentityOperationV1 =
  | { kind: "legacy-bootstrap" }
  | { kind: "rename"; target: PersistentIdentityRefV1 }
  | {
      kind: "reorder-blocks";
      mapInstanceId: MapInstanceIdV1;
      orderedBlockInstanceIds: readonly BlockInstanceIdV1[];
    }
  | { kind: "create"; entityKind: "event" | "map" | "block" }
  | { kind: "delete"; target: PersistentIdentityRefV1 }
  | { kind: "delete-and-recreate"; deleted: PersistentIdentityRefV1 }
  | { kind: "whole-event-duplicate"; sourceEventId: EventInstanceIdV1 }
  | {
      kind: "reimport-confirmed";
      mapInstanceId: MapInstanceIdV1;
      previewDigest: string;
    };

interface PersistentIdentityTransitionPlanV1 {
  schemaVersion: 1;
  operation: PersistentIdentityOperationV1;
  beforeAssociations: Readonly<MapCellSplitAssociationRegistry>;
  afterAssociations: Readonly<MapCellSplitAssociationRegistry>;
  preservedIds: readonly PersistentIdentityRefV1[];
  issuedIds: readonly PersistentIdentityRefV1[];
  unboundIds: readonly PersistentIdentityRefV1[];
  entryTransitions: readonly {
    entryId: string;
    beforeStatus: "absent" | "active" | "dormant" | "quarantined";
    afterStatus: "absent" | "active" | "dormant" | "quarantined";
    ownerBefore: PersistentIdentityRefV1 | null;
    ownerAfter: PersistentIdentityRefV1 | null;
  }[];
  expectedAtE0: ExpectedRootVector;
  expectedAtE1: ExpectedRootVector;
  planDigest: string;
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
  eventInstanceId: EventInstanceIdV1;
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
  forcedPickerOverride: boolean;
  enabledEventInstanceIds: EventInstanceIdV1[];
}

type SplitImplementationReadiness =
  | "contracts-only"
  | "internal-testing"
  | "release-ready";
```

current slot keyはstable identityでも可逆locatorでもなく、losslessに読み取った現在coreの物理slot descriptorから作るsidecar digestである。`CurrentEventSlotKeyV1 = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-event-core-slot-v1", rawEventOwnKey })))`、`CurrentDayMapSlotKeyV1 = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-day-map-core-slot-v1", eventInstanceId, rawDayMapOwnKey })))`、`CurrentBlockSlotKeyV1 = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-block-core-slot-v1", mapInstanceId, blockArrayIndex })))`をliteral式とする。raw own-keyは正規化せずlossless own-property走査で取得し、`blockArrayIndex`は`DayMapData.blocks`の0-based safe integerである。各digestはlowercase 64桁hexのbranded valueとし、表示名、geometry、optional `BlockDefinition.id`、array内容hashをslot keyへ混入させない。loaderはcurrent coreの全descriptorからdigestを再導出し、同じentity classでdigest→physical slot exact 1、physical slot→current association exact 1の双方向bijectionを要求する。0件／複数、別namespace ID代入、digestだけの差替えは自動修復せず該当associationをunboundまたはroot-untrustedへ写す。legacy coreに同名block slotが既存なら各slotへ別sidecar IDを発行できるが`normalized-block-name-collision`でquarantineし、通常commandによる新規同名block追加は拒否する。

stable UUIDとanchor tokenはwire上でvalidated lowercase UUIDv4 stringだが、domain／runtimeでは`EventInstanceIdV1`、`MapInstanceIdV1`、`BlockInstanceIdV1`、`SplitIdentityAnchorTokenV1`の別brandとして扱い、cross-namespace代入をstrict compile fixtureで拒否する。この章のdomain interfaceに現れるinstance IDは全てbrand済み値であり、JSON Schema側のwire DTOだけがplain stringを持つ。wire reader／legacy adapterだけがstringからbrandへ変換でき、domain writer、`SpaceIdentity`、association、slot式へbare stringを渡さない。

`PersistentIdentityTransitionPlanV1.planDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-persistent-identity-transition-plan-v1", planWithoutPlanDigest })))`とする。before／after associationは各々schema-valid、`preservedIds`／`issuedIds`／`unboundIds`はcanonical順・相互排他、before→afterの全IDがexact 1集合へ分類され、entry transitionは影響entryとのexact bijectionでなければならない。`expectedAtE0`とfresh `expectedAtE1`は同じroot universeを持ち、共通row byte一致かつoperation target／core after-image／association after-imageを全て拘束する。E1差、plan digest差、before／after row欠落・余分、ID集合差、entry transition差ではfirst write 0件とし、成功receiptは同じplan digestとcommitted root vectorをechoする。

`buildMapLocationIndexV1`は最初に物理cell重複を全mapで検査し、1件でもあれば他の診断を局所除外へ偽装せず`map-data-untrusted`だけを返す。物理cellが一意なら、番号region／owner／overlap／merge関係を配列順に依存しないconnected componentへ正規化し、各不正componentをexact 1 `MapLocationExclusionV1`、残りを`MapLocationGeometrySlotV1`へ写す。各componentの`reasons`は該当する全原因を`duplicate-number-region → multiple-block-owners → overlapping-number-regions → merge-crosses-block`の固定enum順で重複なく保持し、先頭reasonや走査順で1件へ縮退させない。exclusion keyは全reasonsとregion／block／number／lookup cellを拘束し、各配列はcanonical順・重複なし、同じ不正入力とreason発見順のshuffleでbyte同値にする。exclusion 0件だけが`ready`、1件以上は同じindexとbyte一致するnonempty exclusionsを持つ`ready-with-exclusions`である。影響外の`resolveItemMapLocation`、hit-test、list、描画、訪問projection、routeは継続し、除外領域へ解決し得るitemだけをambiguous／unroutable診断へ送る。

`collectLogicalLocationSourceSnapshotV1`は対象eventの全item rootと全map associationを同じread boundaryで読み、`eventItemIds`と`items`をexact bijectionにした`LogicalLocationSourceSnapshotV1`を作る唯一のconstructorである。`mapped-to-target-map`だけがblock／parsed numberを持ち、other-map／mapless／legacy-unresolved／associationなしは明示ignored branchとしてsnapshot completenessへ残す。`eventItemIds`は重複なしの3.3と同じECMAScript UTF-16 code-unit順とし、`itemSetDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-logical-location-item-set-v1", eventInstanceId, eventItemIds })))`、`snapshotDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-logical-location-source-snapshot-v1", snapshotWithoutSnapshotDigest })))`のliteral式で自身以外の全fieldを拘束する。builder callerがpartial item列、独自filter、suffix配列を渡すedgeをarchitecture testで0件にする。

`deriveMapLocationLogicalRequestsV1(sourceSnapshot)`はevent item ID順にtotal走査し、target mapのunsupported分岐だけを`(blockInstanceId, baseNumber)`ごとのcanonical suffix集合へ集約する。requestは`blockInstanceId`、正のsafe-integer `baseNumber`、ECMAScript UTF-16 code-unit順・重複なしの`normalizedUnsupportedSuffixes`で構成し、配列は`[blockInstanceId, baseNumber]`順とする。`logicalLocationRequestDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-logical-location-requests-v1", eventInstanceId, targetMapInstanceId, requests })))`をliteral式とし、snapshotの同fieldへbyte一致させる。source item／`eventItemIds`の欠落・余分・重複、event／map不一致、digest差、mapped targetのblock解決不能、非canonical parser結果、`a | b`をunsupported suffixへ混入した入力はindex 0件のtyped rejectとする。mapless／legacy-unresolved／other-mapをtarget map errorにせず、明示ignored branchとしてsnapshot completenessへ保持する。

`sourceReadWitness`はitem payload／item membership／map association rootだけのcanonical exact subset、`casReadWitness`はその全rowにtarget map geometry／split settings rootを加えたexact supersetとする。共通rowはstore／key／payload digest／metadata revision／checkpoint digestがbyte一致し、両witnessは同じevent／map read boundaryへ拘束する。missing／extra共通row、scope差、同名別revision、subsetでない入力を拒否する。両full witnessはstale検出だけに使用し、`MapLocationIndex` object、semantic revision、route cache keyへ保持しない。builderはfresh full witnessを検証してよいが、再利用したindexから保存用witnessを復元できない型にする。

`deriveLogicalMapLocationsV1(slot, split, normalizedUnsupportedSuffixes)`は全slotでwholeを必ず生成し、splitありの場合だけa／bを追加し、その後にcanonical unsupported suffixごとのlocationを加える。したがってsplit済み物理slotでも`26`、`26a`、`26b`、`26c`、`26d`、`26ab`は相異なる論理`LocationKey`になり、whole／unsupportedは同じ`wholeBounds`／`wholeAnchor`を共有する。`byBlockNumberKey`／`byLookupCellKey`は論理location配列ではなく一意な物理slotを返し、`byLocationKey`だけが可変個数の論理locationを扱う。`MapLocationIndexSemanticRevision = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-map-location-index-semantic-revision-v1", eventInstanceId, mapInstanceId, physicalSlots, exclusions, activeSplits, logicalLocationRequestDigest })))`をliteral式とし、各配列は出力indexと同じcanonical順、`physicalSlots`／`exclusions`／`activeSplits`はsemantic DTOだけを使ってdigest自身、full witness、snapshot digest、表示fieldを含めない。item ID、full root／checkpoint revision、価格、数量、メモ、購入状態、表示色だけの差はsemantic revisionを変えず、number／block association／map geometry／merge／split／最後のunsupported requestの追加・消失は変える。`26c → 26c2`や同suffix member追加はrequest集合が同じならindexを再利用する。builderはindex返却前にrevisionを再計算し、配列shuffle、digest-only差、full witness／snapshot digest混入をgolden fixtureで拒否する。

分割なしはentryを保存しない。非対応番号は分割entryにはならないが、`SpaceSideIdentity`のtokenを含む別の空間・訪問identityとして扱う。maplessは既存の`MAPLESS_HALL_KEY`、日程、一意に解決したhall ID（manual指定または既存hall resolver）もしくは未割当て、block、番号のcanonical tokenから構成し、mapped用の架空IDを発行しない。legacy-unresolvedの`SpaceIdentity`は`canonicalLegacyToken`だけをidentity payloadに持ち、原文と`LegacyResolutionReason`／`AmbiguousResolutionReason`は`ItemSpaceResolution`の表示・診断payloadで維持する。reasonや原文の違いだけで同じ`LocationKey`に複数のstructural identityを作らず、mappedまたはmaplessへ推測変換しない。ただし`missing-manual-hall-reference`では、異なるdangling manual hallを統合しないためvalidated opaque `manualHallId`をowner evidenceとしてcanonical keyへ含める。`canonicalLegacyToken`は`esp-json-v1`で直列化した`["legacy-space-token", 1, eventInstanceId, normalizedDayKey, ["block", normalizedBlockToken] | ["block-missing"] | ["dangling-manual-hall", manualHallId, normalizedBlockToken], ["number", normalizedNumberTokenPreservingLeadingZeros]]`とする。番号tokenはNFKC、Unicode空白除去、ASCII小文字化後も先頭ゼロを維持し、表示原文とhall表示名はcanonical keyへ直接入れない。別blockまたは別dangling `manualHallId`の同じ不正番号を統合せず、`ambiguous`でも候補を選ばずこのlegacy identityを共有訪問projectionへ残す。各unionはそれぞれ`["mapped-space", 1, ...]`、`["mapless-space", 1, ...]`、`["legacy-space", 1, canonicalLegacyToken]`のcanonical JSON tupleから`LocationKey`を生成し、`SpaceIdentity`と`LocationKey`を一対一にする。

`normalizeFsmcDayKeyV1`はNFKC後にUnicode `White_Space`の連続をU+0020へ畳み、前後U+0020を除去するがcase foldせず、空結果を拒否する。`normalizeFsmcBlockTokenV1`は同じ空白処理後にASCII `A-Z`だけを小文字化し、locale依存case foldを使わず、空結果を拒否する。`normalizeFsmcNumberTokenV1`は3.1のparser前処理そのもので、NFKC、全Unicode空白除去、ASCII小文字化を行い、先頭ゼロはparser分岐が明示的に除去するまで維持する。欠損値を空文字、`undefined`文字列、表示名で代用せず、tupleの`["day-missing"]`、`["block-missing"]`等のtagged branchで表す。現行`normalizeExecutionVisitDay`、`normalizeSpaceBlock`、`normalizeBlockName`の相違はI1 adapterでこの3関数へ集約し、旧関数をcanonical authorityとして混在させない。

identity、fingerprint、projection revisionのtupleはlength-prefix付きUTF-8 `esp-json-v1` canonical bytesでhashし、区切り文字連結、`JSON.stringify(Map)`、object挿入順、locale sortを使わない。`ReadonlyMap`はkeyをcanonical UTF-16 code-unit比較でsortした`[[key, value], ...]`へ、`ReadonlySet`はsort済み配列へ変換する。day／block／numberの全角、空白、ASCII大小文字、leading zero、missing、mapless、dangling hallと、同値Mapの挿入順shuffleをI0 goldenへ固定する。

イベント、地図、ブロック、active entry、retained entry、anchor tokenのローカルopaque IDは、小文字canonical UUIDv4を`crypto.randomUUID()`で発行する。発行transaction内の全namespaceと既存rootを照合し、衝突時は最大3回まで再発行し、3回とも衝突またはAPI利用不能なら操作全体をabortする。バックアップ内の外部IDを採用せず、表示名は診断と手動再関連付けだけに使う。canonical配列順は`a === b ? 0 : a < b ? -1 : 1`というECMAScript UTF-16 code-unit比較に固定し、`localeCompare`、OS locale、大小文字の暗黙変換を使わない。

activeと保持中entryの型を分け、activeだけが現在の`mapInstanceId`／`blockInstanceId`を必須参照できる。retained entryは`number`または`originalNumberToken`の少なくとも一方を必須とし、`blockInstanceId`があれば親`mapInstanceId`も必須とする。最後にactiveだったentryは`evidenceOrigin: "last-active"`とevidenceを必須にし、evidenceを持たずportable fileから初めて保持したentryは`portable-unresolved-reference`かつ`evidenceOrigin: "portable-never-active"`に限定する。portable fileから未解決entryを取り込む場合は、新しいローカル`dormantEntryId`を発行して`retainedEntries`へ置き、外部refをruntime必須ID欄へ代入しない。map全体の現在authorityは`MapSplitBinding.mapStructureFingerprint`だけとし、active entryはblock／location evidenceだけを持つ。保持entryの旧map fingerprintは診断・preview用であり、自動再接続のauthorityにしない。地図の無関係なblock変更ではmap-level fingerprintと該当map bindingを更新する一方、block／location evidenceが一致する他entryはactiveのまま維持する。

`RetainedNumberIdentity`で`number`と`originalNumberToken`を両方持つ場合、I0のexact番号parserでtokenが`split-side | whole | unsupported`のいずれかへ解決し、その`baseNumber`が`number`と一致することをsemantic invariantにする。先頭ゼロやsuffixの原文は一致時だけ保持できる。不一致またはtokenがunresolvedなのに`number`もあるruntime entryは、`evidenceOrigin: "last-active"`なら`invalid-value`としてquarantinedにして再関連付け候補へ使わない。`portable-never-active`にはlast-active evidenceを捏造してquarantinedへ変換せず、root-untrusted安全モードとBackup復旧案内にする。V2入力はどちらもDB更新前にfile全体を拒否する。`originalNumberToken`だけのentryは未解決のまま保持し、数値を推測しない。

端末全体とevent別ON／OFF、および端末全体の`forcedPickerOverride`はsettings payloadから分離し、同じcapability storeのキー`control`に`MapCellSplitControlRoot`として保存する。factory defaultは`deviceEnabled = false`、`forcedPickerOverride = false`、enabled event 0件とする。`enabledEventInstanceIds`は重複なしで上記canonical比較順とし、未掲載eventはOFFとする。event削除時は同じcommitでIDを除去するが、device preferenceである`forcedPickerOverride`は維持する。control rootがuntrusted／未読の場合、split mutationは既存規則どおり停止し、表示済みsplitへのselection policyだけは`forcedPickerOverride = true`相当へ倒す。Backup V1／V2へcontrol rootを含めない。`setForcedPickerOverrideAtomically`はhealthy capabilityでdevice／event OFF中にも利用でき、最新control revisionを再検証してtoggleだけを変更する。旧名`forceSplitPicker`と旧setter名はschema、runtime、fixture、command registryのいずれでもaliasとして受理せず、I0のnegative goldenで未知field／未知commandとして拒否する。`SplitImplementationReadiness`はbuild sourceに固定する静的gateであり、永続化、外部service、利用者設定から変更できない。I11最終release candidate PRだけがsource固定値をbuild前に`release-ready`へ変更し、その同一production artifactで章10の代表release quickとI11 Exitを検証する。前phaseの詳細分岐はowner phaseのunit／integration結果を維持し、I11で全件再実行しない。gate成功までは配布不能で、verifierがreadinessを実行後に書き換えることも、検証済みsourceから別artifactを作り直すことも禁止する。QA buildだけが明示的なtest overrideを持て、production bundleにoverride command、query parameter、storage keyを含めない。

entryの保存・コピー・再関連付け・再取込時に、対象ブロック内の正規化番号が一意であることを検証する。行・列は地図指紋と再取込照合の証拠には含めるが、利用者が選択して保存する識別子にはしない。同一ブロック内の重複番号へentryを新規保存せず、同じ地図内の一意な他番号は処理を継続する。

`active`は現在の地図と安全に結び付いたentry、`dormant`は地図欠落・旧版操作・旧形式完全復元・一致なし等で未接続のentry、`quarantined`は不正値・曖昧一致・物理領域競合・指紋矛盾等のentryを表す。statusはentry単位で保持し、同じ地図内で安全に一致したentryだけをactiveにできる。dormant／quarantinedは地図に描画せず、I5の管理UIで理由、last-known情報、preview付き再関連付け、明示削除を提供する。`PD-09`のイベント削除retentionを除いて時間経過だけで自動削除しない。

active entryでは`bindingEvidenceAtLastActive`のblock／location evidenceが現在の物理番号領域と一致し、`statusReason`は存在しない。dormant／quarantined entryでは最後にactiveだったevidenceを維持し、FSMC-I0 ADRで固定したallowlistの`statusReason`を必須とする。唯一の例外は一度もactiveでない`portable-unresolved-reference`で、`portable-never-active`としてevidenceなしを明示する。地図再取込または通常編集で安全に一意継承できたentryだけ、単一commit内でevidenceを更新する。無関係な別ブロックの変更によるmap fingerprint差だけで全entryを非active化しない。

association registryは、現行のイベントslot、日程内のmap slot、map内のblock slotと各opaque instance IDを結び、再読込後の現在データを解決する。current slotは既存データを参照するsidecar内部locatorであり、表示名、geometry、optional `BlockDefinition.id`を所有者判定へ使用しない。イベント・地図・ブロックの作成、改名、移動、削除、複製、再取込と同じtransactionでregistryを更新し、参照先不在や多重対応は該当entryをdormant／quarantinedにして自動修復しない。

| operation                                                       | stable instance ID                                                         | current slot                             | entry transition                                                                                                                                                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| legacy bootstrap                                                | authority closure検証後、event→map→blockのcanonical順でUUIDをexact 1回発行 | current core after-imageから3式を導出    | registry／anchor／settingsを単一CAS transactionで一括保存し、partial bootstrap 0件。missing／duplicate／arbitrary `BlockDefinition.id`は結果へ影響させない                                                  |
| event／day-map rename、block geometry edit、block array reorder | 明示対象のIDを維持                                                         | after-image own-key／indexから更新       | old→new exact permutation／target IDをcommand authorityとし、名前や配列先頭から対象を推測しない                                                                                                             |
| 新規、delete後の同名再作成、whole duplicate                     | fresh ID                                                                   | fresh slot                               | 旧ID再利用0件。外部backup IDを採用しない                                                                                                                                                                    |
| 同名block edit／replace                                         | commandがtarget `blockInstanceId`を明示した場合だけ維持                    | after-image indexへ更新                  | targetなしaddはnormalized-name非衝突の場合だけfresh ID。既存名との衝突はrejectし、legacy重複slotは別IDのままquarantineする。名前一致だけのreplaceは拒否                                                     |
| reimport                                                        | 対象map IDを維持し、global total／injective 1:1 matchだけblock ID維持      | matched／new after-image indexから再導出 | matchedだけactive再評価。unmatched／ambiguous newはpreview上fresh、oldはunbound＋retainedへ固定し、confirm時だけ一括commit、cancel／staleはwrite 0。row／index／name／`BlockDefinition.id`でtie-breakしない |

block reorderやrenameはstable IDを変えない一方、slot key更新とentry evidence再検査を同一transactionへ含める。E0→E1で配列、own-key、target ID、match集合が変化した場合は全writeをabortし、同名・同payload blockも別slot／別instanceのまま維持する。

settings／association配列は上記canonical比較順で保存する。sort keyはevent associationとevent settingsが`[eventInstanceId]`、map associationとmap bindingが`[eventInstanceId, mapInstanceId]`、block associationが`[mapInstanceId, blockInstanceId]`、active entryが`[mapInstanceId, blockInstanceId, number, entryId]`、retained entryが`[dormantEntryId]`、enabled IDが`[eventInstanceId]`とし、tuple要素を左から比較する。sort用`entryId`は同owner tupleの重複を許可するtie-breakerではない。同じevent内のactive `(mapInstanceId, blockInstanceId, number)`はexact 1件を必須とし、directionやentry IDが異なっても重複違反とする。event／map／block／active entry／retained entryのprimary ID、同一`eventInstanceId`のsettings、registry内の親子refをschema不変条件とする。primary ID重複、同一event settings複数、active owner tuple重複、親不在、active entryの親不整合、配列重複・非canonical順はroot-untrustedとして当該capability root全体を自動安全モードにし、読込時に並べ替え・片方採用・自動修復しない。このsemantic validatorをstartup、全mutation after-image、reimport、restore、duplicate、V2 read／writeで共用し、wireだけ厳格またはruntimeだけ寛容な分岐を作らない。一方、root構造とIDは正常だがcore側のanchor、event key、map slot、block slotが0件または複数候補へ解決する場合は、影響するassociation classとそのentryだけをdormant／quarantinedにし、無関係なeventを止めない。control rootの重複enabled IDまたは未知IDもcontrol-untrustedとしてsplit commandを拒否し、core機能は継続する。

同じeventのactive `(mapInstanceId, blockInstanceId, number)`と、同じ`priorOwner`＋`number`を持つretained entryのoverlapもruntime semantic invariant違反とする。通常設定・copy・importは作成前に全拒否し、明示的な再関連付けだけが元retainedを除去してactiveへ一段で状態遷移できる。保存済みrootにoverlapがある場合は片方を採用せずroot-untrusted安全モードとBackup復旧案内にし、V2 exportを成功扱いにしない。V2 inputはpreview前にfile全体を拒否する。`priorOwner`なしまたはtoken-onlyで番号未解決のretainedを名前や原文だけでoverlap判定・自動接続しない。

active entryへ至るevent／map／block associationでは3 associationの`bindingState = "current"`とbranded `currentSlotKey`をすべて必須かつ一意解決可能とする。dormant／quarantined entryは最初に解決不能となったassociationとその子だけを`bindingState = "unbound"`としてslotを禁止し、解決済みancestorや同じparentを使う影響外active entryのcurrent bindingを巻き添えで外さない。optional string、架空slot、表示名で補完しない。

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
      eventInstanceId: EventInstanceIdV1;
      mapInstanceId: MapInstanceIdV1;
      constraintFingerprint: RoutePathConstraintFingerprint;
    }
  | {
      kind: "selected-hall-polygon";
      eventInstanceId: EventInstanceIdV1;
      mapInstanceId: MapInstanceIdV1;
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
  eventInstanceId: EventInstanceIdV1;
  normalizedDayKey: NormalizedDayKeyV1;
  mapInstanceId: MapInstanceIdV1;
  mapStructureFingerprint: string;
  mapLocationIndexRevision: MapLocationIndexSemanticRevision;
  blocks: readonly Readonly<{
    blockInstanceId: BlockInstanceIdV1;
    normalizedBlockToken: NormalizedBlockTokenV1;
  }>[];
}

interface HallDefinitionIdentityInputV1 {
  eventInstanceId: EventInstanceIdV1;
  hallId: string;
}

interface HallAssociationIdentityInputV1 {
  eventInstanceId: EventInstanceIdV1;
  normalizedDayKey: NormalizedDayKeyV1;
  normalizedBlockToken: NormalizedBlockTokenV1;
  hallId: string;
}

interface HallRemapIdentityInputV1 {
  eventInstanceId: EventInstanceIdV1;
  fromHallId: string;
  toHallId: string | null;
}

interface MapCellSplitSettingsIdentityInputV1 {
  eventInstanceId: EventInstanceIdV1;
  maps: readonly Readonly<{
    mapInstanceId: MapInstanceIdV1;
    mapStructureFingerprint: string;
    entries: readonly Readonly<{
      blockInstanceId: BlockInstanceIdV1;
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
  eventInstanceId: EventInstanceIdV1;
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
  eventInstanceId: EventInstanceIdV1;
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
  eventInstanceId: EventInstanceIdV1;
  coreAnchorToken: SplitIdentityAnchorTokenV1;
}

interface ResolvedEventAuthorityEntryV1 {
  eventName: string;
  eventInstanceId: EventInstanceIdV1;
  coreAnchorToken: SplitIdentityAnchorTokenV1;
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
  eventInstanceId: EventInstanceIdV1;
  coreAnchorToken: SplitIdentityAnchorTokenV1;
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
      eventInstanceId: EventInstanceIdV1;
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
  eventInstanceId: EventInstanceIdV1;
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
          priorEventInstanceId: EventInstanceIdV1;
          retainedEntryCount: number;
        }
    );

interface DurableVisitRetiredEventPartitionV1 {
  reason: "legacy-core-event-disappeared";
  eventNameAtBasis: string;
  eventInstanceId: EventInstanceIdV1;
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
    eventInstanceId: EventInstanceIdV1;
    normalizedDayKey: NormalizedDayKeyV1;
    metadataRevision: string;
  }>;
  items: readonly Readonly<{
    itemId: string;
    eventInstanceId: EventInstanceIdV1;
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
    eventInstanceId: EventInstanceIdV1;
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
  eventInstanceId: EventInstanceIdV1;
  scopes: readonly VisitIdentityCoreBasisScopeInputV1[];
}

declare function deriveVisitIdentityCoreBasisInputV1(input: {
  eventInstanceId: EventInstanceIdV1;
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

interface ProjectedVisitListRowBase {
  visitId: PhaseVisitIdentityKey;
  executionVisitId: ExecutionVisitIdentityKey;
  locationKey: LocationKey;
  resolutionKind: ProjectedVisitResolutionKind;
  canJumpToMap: boolean;
  displayNumber: string;
  blockLabel: string;
  resolutionReason: ProjectedVisitResolutionSummary["reason"];
  priorityLevel: VisitPriorityLevel;
  memberItemIds: readonly string[];
  memberCount: number;
  statusText: string;
}

type ProjectedVisitListRow = ProjectedVisitListRowBase &
  (
    | {
        phase: "normal";
        isBaseOrderReorderable: true;
        reorderDisabledReason: null;
      }
    | {
        phase: "normal";
        isBaseOrderReorderable: false;
        reorderDisabledReason: "single-base-row" | "read-only" | "stale";
      }
    | {
        phase: "postponed" | "late";
        isBaseOrderReorderable: false;
        reorderDisabledReason: "derived-phase";
      }
  );

interface ResolvedRouteVisitPoint {
  identity: PhaseVisitIdentity;
  visitId: PhaseVisitIdentityKey;
  locationKey: LocationKey;
  mapInstanceId: MapInstanceIdV1;
  routeConstraintFingerprint: RoutePathConstraintFingerprint;
  markerStackKey: MarkerStackKey;
  baseCell: GridCellAddress;
  routingPort: RoutingPort;
  anchor: MapPoint;
  displayNumber: string;
  order: number;
  memberItemIds: string[];
}

type ProjectedVisitReorderIntentV1 = Readonly<{
  renderedProjectionRevision: PhaseVisitProjectionRevision;
  sourceExecutionVisitId: ExecutionVisitIdentityKey;
  targetExecutionVisitId: ExecutionVisitIdentityKey;
  placement: "before" | "after";
  inputMethod: "pointer" | "keyboard";
}>;

type ExecutionVisitOrderDraftIdV1 = string & {
  readonly __brand: "ExecutionVisitOrderDraftIdV1Uuid";
};
type ExecutionVisitOrderDraftDigestV1 = string & {
  readonly __brand: "ExecutionVisitOrderDraftDigestV1Sha256";
};
type ProjectedVisitRowsDigestV1 = string & {
  readonly __brand: "ProjectedVisitRowsDigestV1Sha256";
};

interface ProjectedExecutionVisitOrderDraftV1 {
  schemaVersion: 1;
  draftId: ExecutionVisitOrderDraftIdV1;
  basisProjectionRevision: PhaseVisitProjectionRevision;
  beforeExecutionVisitOrder: readonly ExecutionVisitIdentityKey[];
  afterExecutionVisitOrder: readonly ExecutionVisitIdentityKey[];
  activeExecutionVisitId: ExecutionVisitIdentityKey;
  projectedRowsDigest: ProjectedVisitRowsDigestV1;
  draftDigest: ExecutionVisitOrderDraftDigestV1;
}

type ProjectedVisitReorderPresentationStateV1 =
  | { kind: "idle"; draft: null; canCommit: false }
  | {
      kind: "draft";
      draft: Readonly<ProjectedExecutionVisitOrderDraftV1>;
      canCommit: true;
    }
  | {
      kind: "saving";
      draft: Readonly<ProjectedExecutionVisitOrderDraftV1>;
      canCommit: false;
    };

interface ProjectedVisitListProps {
  projectionRevision: PhaseVisitProjectionRevision;
  rows: readonly ProjectedVisitListRow[];
  rowsDigest: ProjectedVisitRowsDigestV1;
  selectedVisitId: PhaseVisitIdentityKey | null;
  reorderState: ProjectedVisitReorderPresentationStateV1;
  onSelectVisit: (visitId: PhaseVisitIdentityKey) => void;
  onInsertAfterVisit: (visitId: PhaseVisitIdentityKey) => void;
  onRequestReorder: (intent: ProjectedVisitReorderIntentV1) => void;
  onCommitReorderDraft: (
    draftId: ExecutionVisitOrderDraftIdV1,
    draftDigest: ExecutionVisitOrderDraftDigestV1,
  ) => void;
  onCancelReorderDraft: (draftId: ExecutionVisitOrderDraftIdV1) => void;
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

type RouteVisitSemanticRevisionV1 = string & {
  readonly __brand: "RouteVisitSemanticRevisionV1Sha256";
};

interface SplitRouteBuildInputV1 {
  projection: PhaseVisitProjectionSnapshot;
  routeVisitSemanticRevision: RouteVisitSemanticRevisionV1;
  mapLocationIndexRevision: MapLocationIndexSemanticRevision;
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
  eventInstanceId: EventInstanceIdV1;
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
  eventInstanceId: EventInstanceIdV1;
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

`RoutePathConstraintV1`はfunctionを持たないdata-only DTOとし、hall定義の1-based `{ row, col }`頂点をpure adapter `hallVertexToMapPointV1({ row, col }) = { x: col - 0.5, y: row - 0.5 }`で5.1の0-based連続`MapPoint`へexact 1回だけ変換する。直値利用、二重offset、x／y逆転、非finite座標を拒否し、既存Canvas描画と同じ中心座標にする。version付きpure `validateHallPolygonContractV1`をhall editor、import、Backup reader、route DTO生成の唯一のerror-level validity authorityとし、現行`src/utils/polygonValidation.ts`のproduction defaultを固定値で移植する。4頂点以上、末尾の先頭点重複なし、連続重複頂点なし、自己交差なしに加え、1-based頂点へshoelace式`abs(sum) / 2`を適用した有限面積が`area >= 4`であること、`row = 1..maxRow`／`col = 1..maxCol`の各整数cell centerを共有inclusive point predicateへ通してin-bounds covered cellが1件以上あることを必須にする。`minArea` production overrideを廃止し、overlap warningは保存UIへ返すがroute validity errorにはしない。3頂点、面積`< 4`、covered cell 0件をroute層だけで受理せず、全surfaceで同じerror code集合へ写す。頂点数を`N`とし、全`N`個のforward rotationと全`N`個のreverse rotationの計`2N`候補をそれぞれ`esp-json-v1([[x,y], ...])`へserializeし、その文字列をECMAScript UTF-16 code-unit順で比較して最小の候補を唯一のcanonical polygonとする。同じ最小座標が複数ある場合も座標1個だけでtie-breakせず列全体を比較するため、同じpolygonの開始点／向きだけの差は同一になる。`RoutePolygonFingerprint`はこのcanonical polygonを用いて3.3のdomain-separated式から再計算する。凹形状を凸包へ変換しない。`constraintFingerprint`は自身を除くconstraint全fieldを`{ domain: "fsmc-route-path-constraint-v1", constraint }`としてcanonical SHA-256化する。`whole-map`も固定tag、event、mapを含むnon-null fingerprintを持つ。route cache signatureは`RouteVisitSemanticRevisionV1`、`MapLocationIndexSemanticRevision`、`pathfindingGraphFingerprint`、constraint fingerprintを含め、constraintまたはroute意味入力が異なるcacheを再利用しない。開始点／向きの全variant、同じ最小座標が複数ある形、座標`2`対`10`、面積境界`3.999…`／`4`、covered cell 0／1件をgolden fixtureに固定し、文字列化前の数値比較やlocale比較、surface別validatorによる別canonical化／別validityを拒否する。

選択hall routeでは、全routing port／anchorがinclusive polygon内、`mainPath`の各subcell node中心と隣接node間線分、simplification後の各線分、全connectorと`same-cell-direct`の全線分がpolygon内であることを同じpure predicateで検証する。端点だけが内側でも凹部を横切る線、別hall、削除／変更済みhall revision、map不一致は失敗とする。display routeとinsert previewへ同じconstraint objectを渡し、片方だけ無制約にしない。constraint付きrouteもfingerprint込みでcache可能だが、predicateやpolygonをsignature外のclosureとして渡さない。

`PhaseVisitProjectionRevision`はwall clockや配列object identityではなく、app層が同一read snapshotから作る`ProjectionInputRevisionVectorV1`の`esp-json-v1` canonical SHA-256とする。vectorの`rootRevisions`はitem payload／実行順／`durable-visit-state`、event metadata、map association、hall definition／association／remap、split settingsについて、`ExpectedRootVector` subsetの`(storeName, key, payloadDigest descriptor, metadataRevision, checkpointDigest)`をcanonical順で持ち、未commit after-imageを投影する場合だけ`uncommittedAfterImageDigest`をnon-nullにする。`payloadDigest`は現行`PersistenceDigestDescriptor`と同じalgorithm／canonicalization／valueの3 fieldだけを投影し、別型`PersistenceSynchronousFingerprint`の`canonicalLength`を混入させない。valueはlowercase 64桁hexとする。checkpointはnullだけを`absent`、validated checkpoint全体（kind／version／storeName／key／committedRoot／absorbedCandidates／updatedAt）のcanonical SHA-256を`present`へ写す。存在しない`checkpointRevision`文字列や`committedRoot.revision`だけへ縮退せず、同じcommitted rootでも`absorbedCandidates`／`updatedAt`だけが異なるfixtureでrevision差を必須にする。pure `toProjectionInputRootRevisionV1`はobserved rootとcheckpointが同じread boundaryの場合だけ受理する。consumerはsnapshotとrevisionを一体で受け、UI callbackはvisit IDだけを返す。shellは最新snapshotでvisit IDを再解決し、revisionが変わってvisitが消えた場合はmutationを呼ばず`operation-stale`を常設alertだけへ通知する。保存commandは最新`ExpectedRootVector`を再検査し、stale projectionをwrite authorityにしない。I0でabsent／present、checkpoint field単独差、root順shuffle、不正descriptorのgoldenを固定し、I1でbuilder／schema／runtime exact一致、I7で同revision同値・1 root差・callback中rekeyのstale testを固定する。

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

集約後の`ProjectedVisitResolutionSummary`は代表memberや元itemのraw fieldから選ばず、canonical `SpaceIdentity`と同じ`VisitIdentityInputRevision`のresolver結果だけから導出する。同じ`ExecutionVisitIdentity`へ属する全memberはbyte-identicalなsummaryを生成しなければならず、1件でも異なる場合はbuilder全体をtyped `inconsistent-resolution-summary`で拒否してprojectionを返さず、mutationはwrite 0件、UIは`operation-failed`を常設alertだけへ表示する。member順shuffle、先頭member削除、destination統合でもsummaryが不変であるproperty testをI1で固定し、I7 Exitで実data adapterに対して再実行する。

`PhaseVisitProjectionSnapshot`は、`visits`の`visitId`が重複なし、`order`が配列indexと一致する`0..n-1`、各`memberItemIds`がnonempty・重複なし・raw実行順、`byVisitId`が`visits`とのexact bijection、`phaseVisitIdsByItemId`のkey集合が全member item IDのexact集合で、各valueが`visits`を順に走査して当該itemを含むvisit IDを得た重複なし配列とする。存在しないvisit／item、余分・欠落index、別object内容、非canonical順をbuilderのunit／property testで拒否する。I1はinvariant contract、I7 Exitは100 visit以下の日常fixtureとrekey／member削除after-imageで同じinvariantを実行し、consumerは独自indexを作らない。最大800投影は3.13どおりgeneratorのcount／hashだけを高速unit testで確認し、I7 Exitで実data adapterやbrowserへ展開しない。

`deriveRouteVisitSemanticRevisionV1(projection, index)`はprojection順の全visitを`{ kind: "routable", visitId, locationKey, mapInstanceId, baseCell, routingPort, anchor } | { kind: "unroutable", visitId, locationKey, resolutionKind }`へtotal解決し、`RouteVisitSemanticRevisionV1 = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-route-visit-semantic-revision-v1", orderedRouteVisits })))`を返す唯一のconstructorとする。route cacheはfull `PhaseVisitProjectionRevision`ではなくこのrevision、`MapLocationIndexSemanticRevision`、`pathfindingGraphFingerprint`、`RoutePathConstraintFingerprint`をkeyにする。価格、数量、メモ、購入状態、表示文言、同じvisit内のmember差だけではrouteを失効させず、順序付きvisit ID、location、routable branch、base cell、routing port、anchorの差は必ず失効させる。route build時は受け取ったrevisionを同じprojection／indexから再計算し、self-asserted一致を採用しない。full projection revisionはUI callback stale検出、full `ExpectedRootVector`は保存CASに残し、route semantic一致をUI／保存authorityへ転用しない。

`SubcellPathNode`は新しい公開route DTOであり、現行`src/types/map.ts`のA\*探索用`PathNode`とは別型である。I10で既存型を`AStarSearchNode`へ改名してpathfinding module内部へ閉じ、`findPath`、現行`RouteSegment`、`MapRoutePoint`、`mapViewRouteCalculations`、`mapRouteHitTest`、`focusRouteCalculation`、route cache signatureを同じmigration PRで`SubcellPathNode`／`SplitRouteSegment`へ接続する。I10までは現行route modelを独立維持し、未定義のroute型やproduction compat変換を追加しない。I10の同一PRで全callerを新型へ直接置換し、逆変換、row／colの小数pathを新APIへ渡すこと、両`PathNode`名の同時export、旧`RouteSegment`のproduction caller残存をarchitecture testで拒否する。

`ProjectedVisitRowsDigestV1 = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-projected-visit-list-rows-v1", projectionRevision, rows })))`、`ExecutionVisitOrderDraftDigestV1 = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-execution-visit-order-draft-v1", draftWithoutDraftDigest })))`とする。draft IDはattempt内で非再利用のUUIDv4、before／after orderは同じ重複なしexecution ID集合のexact permutation、active IDはafter集合のmember、`projectedRowsDigest`はdraft orderから再投影したrowsとpropsの`rowsDigest`へbyte一致させる。presentation stateはshell所有のcontrolled stateで、commitは同じdraft ID＋digest、cancelは同じdraft IDだけを受理する。unknown／replayed ID、digest差、basis revision差、rows差、illegal phase／reorder flag組合せをstrict compile／semantic fixtureで拒否する。

実production導線の`VisitListPanel`は既存のopen／close、unsaved draft、save／cancel、priority、map highlight、opener復帰を維持しつつ、I8でprojection内製、独自番号parse、block検索、row／col callbackを除去してpure `ProjectedVisitList`を内包するcanonical shellへ移行する。`ProjectedVisitList`は上記propsだけを受け、選択／挿入は`PhaseVisitIdentityKey`だけ、reorder intentはnormal base rowから得たsource／target `ExecutionVisitIdentityKey`とrendered projection revisionを返す。select／insertはshellが最新snapshotでIDを再解決するためcallback payloadへrevision、row／col、代表item、raw payloadを持たせない。reorder可能なのは`phase = normal`かつ`isBaseOrderReorderable = true`のrowだけで、postponed／lateは同じ`executionVisitId`のbase順から派生し独立移動できない。shellは最新snapshotでsource／target execution visitを再解決して`ExecutionVisitIdentityKey[]`のexact permutationとcontrolled draftを作る。revision差またはrow消失はdraft破棄／write 0件で`operation-stale`をalertだけ、normal以外の不正intentは`operation-failed`をalertだけへ通知し、同一source／targetはno-opとしてoperation eventも両channel mutationも0件にする。`MapVisitListPanel.tsx`、その旧direct test、`MapView`のdead state／render／jump handler、map index exportはI8で削除し、source／build／production import／caller／JSX／test edgeを0件にする。

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
7. recovery decisionの全分岐はpure decision tableとintegrationで確認する。browserは章10.4 journey 7の「正常reset」と「不適格時write 0」の代表2件だけとし、in-place reset、stale、quota、別tab blocked、各journal中断点、hash／plan不一致、compatible build有無、V1／XLSX復元、backup不足、unsupported DBをDesktop／Mobile双方で直積E2E化しない。どの層でもuntrusted split採用、自動merge、別origin削除、成功の虚偽表示を0件とする

上記の代表2件はbrowser baselineであり、全recovery decision／journal中断点はunit／integrationで全reachable branchを網羅する。browser、storage lifecycle、page再起動に固有の不具合が見つかった組合せは対象E2Eを追加し、2件という数だけを理由に削らない。

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
    eventInstanceId: EventInstanceIdV1;
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

I0のfailure injection stage IDは`after-snapshot-read`、`after-external-baseline-e0-check`、`after-transaction-open`、`after-idb-candidate-reread-before-first-write`、`after-external-e1-recheck-before-first-write`、`after-control-reread`、`after-core-write`、`after-settings-write`、`after-control-write`、`after-metadata-checkpoint-write`、`before-commit`、`after-idb-commit-before-external-postcheck`、`after-external-postcheck-before-ui-ack`、`after-legacy-rebase-r0-read`、`after-legacy-rebase-r1-before-first-write`、`before-legacy-rebase-commit`、`after-legacy-rebase-commit-before-r2`、`after-legacy-rebase-r2-before-ui`とする。通常commandのcommit前stageのexception、abort、QuotaExceeded、強制終了では全参加IDB rootを旧状態、commit後では全参加IDB rootとfenceを新状態として再起動時に読めることをoracleにし、いかなるstageでもIDB新旧混在を許さない。commit後のexternal差が説明可能なlegacy-mutable coreだけなら`committed-legacy-rebase-required`としてrollbackせずrebaseし、capability-ownedまたは分類不能な差だけを`committed-recovery-required`とする。legacy rebaseのR0→R1差はwrite 0件、commit前失敗は固定旧版Aが既に確定したcurrent core＋rebase前fenceを維持して`legacy-rebase-pending`から再試行、commit後失敗はcurrent core＋new fenceと必要なstatus変更が全て確定済みとして再開する。R1→R2の追加legacy差は次rebase、それ以外はrecovery-requiredとする。control revision変更はCAS拒否またはtransaction lock順の先行commitとして線形化する。network切断はIndexedDB atomicity faultへ混ぜずoffline matrixで扱う。I2でcore／settings／control／legacy rebase command、I4でBackup置換を実commandへ接続する。I11はatomicity、stale時write 0、代表Backup置換だけをrelease quickで再確認し、全failure stageを横断再実行しない。

### 6.6 ローカル制御と安全モード

端末全体のローカルOFF、イベント単位enabled、build固定の`SplitImplementationReadiness`、DB／root schema／association authority検証失敗時の自動安全モードを`SplitMapLocalControlPort`で一元判定する。優先順位は自動安全モード、readiness不足、端末全体OFF、event OFF、ONの順とし、すべての条件を満たす場合だけsplit mutationを許可する。readinessを満たすのは`release-ready` production、または`internal-testing`かつcompile-time overrideを持つnon-promotable QA artifactだけで、`contracts-only`と`internal-testing` productionは不足とする。外部availability service、署名receipt、TTL、remote kill switch、外部metricsを導入しない。

eventのeffective ON判定には章7.1の`V2SnapshotHealthDecisionV1.kind = "healthy"`も必須入力とする。I0は`V2EnablementEligibilityPort`、result union、issue digestを固定し、I2では実Backup Workerが未接続ならcontract fakeだけで分岐を検証してruntime adapter未登録を`unavailable`／write 0件にする。I4で実Workerを接続した後だけQA eventをeffective ONにできる。device OFF中のlegacy writerは許可するが次回ONでfresh preflightし、effective ON中に外部旧版writeを検出した場合はstored membershipを変えず`v2-backup-repair-required`のevent単位legacy fallbackへ移す。`setSplitDeviceEnabledAtomically(true)`は保存済みenabled eventを全件再監査し、unhealthy eventだけをfallbackにしてdevice flag自体は既存collision契約と同様に確定できる。

- 既存イベントとBackupから新規復元したイベントのcontrol entryは`enabled=false`を既定とし、利用者が当該端末でイベントごとに明示ONにする。event setting payloadへenabledを重複保存しない
- 端末全体とevent別状態は`mapCellSplitSettings` storeの`control` rootで管理し、同じprofile内の複数tabではfull observed rootとcheckpointのCASを使う。別端末へ同期せず、Backupにも収録しない
- registryはartifact purpose、readiness、open result、initializationでexactに分ける。`contracts-only` productionは全FSMC command 0件、`internal-testing` productionはcode存在を許すがpublic registration 0件、non-promotable QAはhealthy QA rootでinternal registryへ`readSplitControl`、`previewSplitEnablement`、`enableSplitForEventAtomically`、`disableSplitForEventAtomically`、`setSplitDeviceEnabledAtomically`、`setForcedPickerOverrideAtomically`を登録できる。release-ready productionの`capability-adoption-blocked`ではtrusted core V1退避、collision診断、`fsmc.repair.legacy-focus-day-scope.v1`だけを登録し、capability DB open／createと通常app writeを0件にする。`migrating`ではmigration診断／V1退避／`fsmc.migrate.durable-visits.v1`だけ、healthy `ready`で初めて通常control 6 commandをpublic registryへ登録する。readyかつOFF中は端末switch、event preview、disable、picker preference変更へ到達できるが、セル分割設定・描画・経路等のmutation commandはeffective ONの場合だけ利用できる。`missing`／`repair-required`は6.1 recovery registryだけとする
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

- 本書の`healthy V2 snapshot`は、単一readonly transaction boundaryで同一revisionに凍結した対象eventのcore、association、event settings、split settings、durable visit state、metadata／checkpoint／fenceがtrustedで相互一致し、event settings bridge journal完了、`DurableVisitInitializationStateV1 = ready`であり、participant root／slice digestを再検証したsnapshotだけを候補にする。その候補を`auditV2CoreRepresentabilityV1`が未知保持extension、unsafe URL、strict scalar、owner relation、参照、順序、件数、byte hard limitを含む全slotについてtotal走査してissue 0件を返すことまで必須とする。`V2SnapshotHealthDecisionV1`は`{ kind: "healthy"; sourceSnapshotDigest; v2ObjectDigest; canonicalByteLength } | { kind: "v2-representability-repair-required"; sourceSnapshotDigest; issues; issuesDigest; repairActions }`のexact unionとし、companion V1の不能は後者へ入れない。`healthy` receiptは同じserializerをbounded discard sinkへ通してschema、embedded digest、current reader、source projection、再parse、byte lengthまで自己検証して初めて発行し、単なるruntime rootのschema-validをhealthyと呼ばない
- enablement用の`V2EnablementEligibilityResultV1`は`{ kind: "eligible"; health: Extract<V2SnapshotHealthDecisionV1, { kind: "healthy" }>; eligibilityDigest } | { kind: "blocked"; health: Extract<V2SnapshotHealthDecisionV1, { kind: "v2-representability-repair-required" }>; eligibilityDigest } | { kind: "unavailable"; reason: "authority-not-ready" | "adapter-not-registered" | "snapshot-read-failed" | "preflight-timeout" | "cancelled" | "stale" }`のexact unionとする。semantic／hard-limit issueだけを`blocked`、snapshotを評価できないoperational状態を`unavailable`へ写し、後者へ架空issue／repair actionを付けない。preview resultは表示用でありcommit authorityにしない
- `previewSplitEnablement`と`enableSplitForEventAtomically`はI0で固定する同じ`evaluateV2EnablementEligibilityV1`を使う。event effective ON前にfresh full snapshotから`eligible` receiptを作り、commit直前に全root revisionと`sourceSnapshotDigest`を再検証する。`blocked`はcanonical issue一覧と修復導線、`unavailable`はreason別の待機／再試行案内を返し、どちらもcontrol、core、settings、durable rootを含むwriteを0件にしてeventをeffective ONにしない。`setSplitDeviceEnabledAtomically(true)`もstored enabled eventごとに同じ判定を行い、不適格eventはstored membershipを勝手に削除せずevent単位legacy fallbackへ置く。これにより「healthy V2は必ず生成可能」と`v2-unrepresentable`は、前者がON可能なsource invariant、後者が既存OFF／legacy sourceの診断分岐として両立する
- effective ON中にcore、item、URL、hall、map、association、event settings、split settings、durable visit stateを変更する全writerは、after-imageの同じhealth decisionとroot vectorをfirst write前に検証する。healthyを壊すafter-imageは操作全体を拒否し、旧状態とstored ONを維持する。event rename／delete／duplicateの実authorityである`useEventLifecycleCommands.ts`、通常編集、CSV／XLSX import、V1／V2 restore、地図再取込、normalization repairを例外にせず、各command plannerのparticipant manifestとarchitecture testで漏れ0件にする。deleteは対象eventを同commitで消すため削除後の残存event集合、duplicate／restoreは新eventのafter-imageを検証する
- 修復導線はissue kindから固定する。unsafe URLはsafe-link policyを通る利用者明示編集、normalization／map／hall／orphan visit問題は`NormalizationCollisionRepairPort`または該当I5～I7 preview command、未知保持extension／strict legacy shapeはraw値をdropせずtrusted V1退避、対応versionでの再取込またはguided profile reset eligibility診断へ送る。自動削除、unsafe URLの空文字化、unknown extensionのopaque捨て、V2を捏造するnormalizationを禁止する。I0 goldenはhealthy pair、healthy V2-only、未知extension、unsafe URL、object／array `undefined`、sparse hole、`-0`、nonfinite／unsafe integer、owner relation、hard-limit直前／一致／+1、issue順shuffle、旧名fieldをnegativeにし、明示DTOでlosslessな`legacy-optional-shape`をpositiveに固定する。I2のON preflightとI4のWorker exporterが同じdecision／digestを返すことをcontract testする
- 「V2を必ず生成可能」はhealthy snapshotからcanonical V2 object／bytesを決定的に生成できる意味であり、利用者取消、sink I/O、端末容量、Worker強制終了等のoperational handoff failureを成功扱いにする意味ではない。これらは`v2-export-failed`／incomplete receiptとしてartifact完了通知を禁止し、sourceをunhealthyへ再分類しない。反対に`v2-unrepresentable`はoperational failureへ丸めず、effective ONを許さない上記repair-required decisionと同じissue digestを返す
- handoff resultの`expectedArtifactIds`はcanonical role順・重複なしとし、全completed branchは`handedOffArtifactIds = expectedArtifactIds`／`failedArtifactIds = []`、全incomplete branchは両配列が相互排他的なexact partitionでなければならない。V2-onlyの`companionIssuesDigest`はscope、export、prepared artifact、verificationからcompleted／incomplete resultまでbyte一致させる。disposeもpairの2 handle対V2-only／standaloneの1 handleを判別unionで固定し、null digest＋2 handleやnon-null digest＋1 handleを表現不能にする
- unavailable companionの`issues`は各issueの`esp-json-v1` canonical bytes順、重複なしのnonempty配列とする。`issueKinds`はTypeScript unionの宣言順へ依存せず、version付きliteral `COMPANION_V1_ISSUE_KIND_ORDER_V1`のrank順で`issues[].kind`を重複除去したexact projectionとする。tuple、TypeScript kind union、JSON Schema enumはexact bijectionかつ順序一致でなければならず、新kind追加時のtuple／schema未更新をbuildで拒否する。`issuesDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-companion-v1-issues-v1", reason, issues })))`をscope、export result、prepared artifact、verification、handoffへbyte一致で伝播する。構造reasonへresource issue、resource reasonへ構造issueまたは2件以上のresource issue、issue／kind／reason／digestの単独差を拒否する。issue入力順shuffle、同一kind重複、nested 3 kindの順序、tuple欠落／余分／入替えをI0 goldenへ固定する
- 初版の分割対応backupをイベント単位V2として追加する
- schemaVersion、portable参照、active／dormant／quarantinedを含む`mapCellSplitSettings`セクションと、実行訪問順・phase別anchor・completion・購入変更anchorを持つ`durableVisitState`セクションを追加する
- V1の`data` wire shapeは現行sectionを基準に`AppBackupV1Data`として凍結し、runtimeの`AppData`型を直接参照しない。V1 readerは現行どおり既知必須fieldの型と参照を検証し、現行が受理・保持する未知optional fieldを新たに削除・拒否しない。top-level、data section、eventSettings、`EventMetadata`、item、各nested objectごとの「必須検証／未知保持／未知拒否／export保持」を`config/fsmc-v1-compatibility-matrix.json`と固定旧版A goldenで固定する。`EventMetadata.splitIdentityAnchor`はoptional opaque fieldとして検証するが、他の未知fieldを一律拒否する例外理由にはしない。V2だけが全階層exact schemaと未知key拒否を採用する。対象eventにmatrix上保持必須だが明示V2 DTOへ写せない未知extensionが1件でもあれば`legacy-v1-extension-unrepresentable`、unsafe external URLなら`unsafe-external-url-unrepresentable`、V1が受理し得る非finite／unsafe integer／byte上限超過／shape差なら`v2-strict-scalar-unrepresentable`としてV2／pair生成を停止する。V2 adapterは値を削除・丸め・safe URLへ置換せず、V2へopaque extension bagを捏造しない。同じreadonly snapshotから凍結V1 writerがlegacy core projectionだけをlosslessに証明できる場合に限り、split-capable event全体のbackupではない`trusted-core-only` fallbackとして案内する
- V2を出力するたび、同じ対象eventのcore dataだけを収録した旧版用V1互換backupのlossless生成を試みる。成功時はV1のfileName、byteLength、SHA-256をV2 `scope.companionCore.status = "included"`へ入れ、V2／V1を同じnon-null pair digestのrole別immutable handleとしてstageする。構造上lossless変換不能なら`reason = "not-losslessly-representable"`とresource-limit以外のcanonical issue kind集合、V1 bytesまで生成できたがV1／pair上限だけを超えるなら`reason = "companion-v1-resource-limit"`とexact 1 issue kindを`scope.companionCore.status = "unavailable"`へ入れる。前者は`preparationKind = "structural-v2-only"`、後者は`preparationKind = "resource-v2-only"`の全issue digest付きV2を`pairDigest = null`のsole immutable handleとしてstageし、scope→export→prepared→verification→handoffで同じreason discriminantを保持する。両reason／issueKindsの混在、representability failure後の架空byte見積り、resource-limit branchの構造issueを拒否する。V2 bytesとembedded digestは全分岐で自己parse・再hashし、companion不能をV2生成失敗へ変換しない。各prepared artifactの`selfValidationEvidence`はrole／file metadata／source binding、role別exact parser tuple（V2はcurrent V2 reader、V1はcurrent V1 reader→固定旧版A）、schema receipt、canonical projection receipt tupleを持ち、evidenceのmetadataはartifact common fieldとbyte一致させる。`selfValidationDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-prepared-backup-artifact-self-validation-v1", selfValidationEvidence })))`として自身を除外し、parser／projection順、receipt、source binding、digest-only差を拒否する。handoff直前にregistryがexpected 1件または2件のexact bytes、metadata、role、preparation kind、pair／issues digest、source SHA、source snapshot revision／root vector／snapshot digestを再検証し、`PreparedBackupImmutableBytesWitnessV1`へcanonical role順のartifact ID／handle／declared・recomputed length／SHA／self-validation digest、source binding、pair／issues／warning acknowledgement digestをexactに記録する。`immutableBytesWitnessDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-prepared-backup-immutable-bytes-witness-v1", immutableBytesWitness })))`とし、declaredとrecomputed値、prepared artifact、verification input／resultの全fieldを一致させ、artifact 1件／2件、role順、handle replay、digest-only差を拒否する。unknown／finalized handle、bytes差、role差、reason差はhandoff attempt 0件とする。handle ledgerは`active → consumed | disposed`の一方向とし、expected setを一組でfinalizeする。pairでは片方だけのhandoffを完了扱いにせず同じpair再生成を案内する。V2-onlyではV2 receiptが得られた場合だけreason別の`structural-v2-only-completed | resource-v2-only-completed`とし、旧版fallback不可とV2保管必須の確認を出力前後に表示する。handoff前の`V2OnlyLegacyFallbackWarningAcknowledgementV1`はpreparation kind／reason、V2 artifact ID／SHA、issues digest、固定warning codeをexactに持ち、`acknowledgementDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-v2-only-warning-acknowledgement-v1", acknowledgementWithoutDigest })))`とする。verificationはartifact registryとscopeの実値へ再拘束し、未確認、別artifact／issuesへのack replay、field／digest差を`v2-only-warning-not-acknowledged`／handoff attempt 0件として拒否し、verified／completed／incompleteへ同ack digestをechoする。`BackupArtifactHandoffReceiptV1`はsource binding、preparation kind、pair／issues／warning acknowledgement digest、artifact ID／role／SHA、downstream receipt digestをexactに持ち、`receiptDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-backup-artifact-handoff-receipt-v1", receiptWithoutDigest })))`とする。completed／incomplete resultの`handoffReceipts`はcanonical role順かつ`handedOffArtifactIds`とexact bijection、failed IDsとdisjointにし、pair片側成功はexact 1 receipt、成功0件はempty、completedはexpected全件のreceiptを必須にする。pairDigest nullもtagged値として含め、receipt field／順序／ID partition／digest-only差を拒否する。固定旧版A試験は`included`分岐だけでV2が指すexact V1 bytesを復元する
- export開始時にcore、event metadata、map、association、split settings、durable visit state、canonical `eventSettings`の全参加storeを1個のreadonly IndexedDB transactionで読み、各full root、checkpoint、対象event sliceを含むimmutableな`SplitCapableEventExportSnapshotV1`を1回だけ作る。`participantRoots`は全参加rootの`rootKey = [storeName, key]`、observed revision root、checkpoint、payload digestを持つnonempty exact集合とし、`esp-json-v1(rootKey)`のECMAScript UTF-16 code-unit順へsortして重複を拒否する。`sourceRootVectorDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-split-capable-event-export-root-vector-v1", participantRoots })))`、`sourceSnapshotRevision = sourceRootVectorDigest`とする。7 source slice digestはraw structured-clone値をundefined／hole／-0等のtag付きlossless encoderでfield別domain hashし、`sourceSnapshotDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-split-capable-event-export-snapshot-v1", snapshotSchemaVersion, sourceSha, sourceEventInstanceId, participantRoots, sourceRootVectorDigest, sourceSnapshotRevision, sourceSliceDigests, bridgeJournalDigest, externalProjectionWitnessDigest })))`とする。transaction中は値と同期digest材料だけをcopyし、完了後にhashしてDBを再読込しない。source SHAはproduction build manifestのfull commit SHAへ一致させ、4 source binding fieldはwire payloadへ収録せずinternal prepared artifact registryだけへ保持する。全prepared role、verification input／result、handoff result／receiptは同じbindingをechoし、pair両role差、root順shuffle、root欠落／重複、BMP／astral key順差、slice 1件だけ別snapshot、digestだけの差替えをhandoff attempt 0件で拒否する。transaction開始前後にbridge journalが完了済みであることとlocalStorage互換projection witnessを検査するが、external projectionをbackup payload authorityにしない。V2 objectとV1 core bytesはIDB snapshotだけから生成し、途中でUI state、cache、DB、localStorageを再読込しない。V2変換前に`auditV2CoreRepresentabilityV1`がV1 compatibility matrix上の全保持field、V2 strict scalar／URL／structural rule、全10 section slotをtotal走査する。未知保持extension、unsafe URL、V2 strict scalar違反に加え、duplicate physical cell／ref、cross-section ref不正、order-bearing shape不正、owner relation不正を上記typed issueへ写す。manual hall／hall groupのambiguous ownerは`v2-strict-structural-unrepresentable`の`owner-relation-invalid`とし、候補を補完・統合しない。historical owner tableはmap／blockの親子relationだけを持ち、各retained entryのoptional `lastKnownMapName`を含む`lastKnown*`診断値はentry側でabsent／presentと値をexact保持するため、同owner内の診断差やmap名欠落自体をblockerにしない。rotation／route／viewportのkeyはmapData slotへexact解決できなければ`orphan-map-section-slot`とする。hall definitions／hall routeのkeyは、mapData slotへexact解決できる場合を`owner.kind = "map"`、current `getMaplessKey(rawDayKey)`へexact 1 semantic raw dayから再構成できる場合を`owner.kind = "mapless"`へ写し、どちらでもないorphan keyは`orphan-map-section-slot`、raw `MAPLESS_HALL_KEY`等のevent-wide unscoped ownerが残る場合は`legacy-unscoped-hall-owner-unrepresentable`とする。各issueはfield／section、source path／slot key、payload digest付きcanonical nonempty集合でV2とpairを0件にする。mapless hallをmapData orphanと誤分類せず、orphan／unscoped rowをdrop、synthetic mapData／mapRefへ補完、表示名一致で接続しない。representableな場合だけV1 coreとV2 coreがportable ref化、anchor除去、V1互換matrixが要求する明示transform以外で同値であることをself-testする。readonly transaction失敗、bridge pending／conflict、snapshot内参照不整合では両fileを生成しない。V2 blocker時のstandalone V1 eligibilityは全issue kind／section／violation別に`config/fsmc-v1-fallback-eligibility.json`へ固定し、orphan map sectionは既定でunavailableとする。eligible候補も同snapshotからsource保持必須projection→凍結V1 serialize→current V1 reader→固定旧版A parserを実行し、3 projection digestがbyte一致し、V1 self-validationとresource limitを満たす場合だけ`role = "standalone-v1"`／`pairDigest = null`のimmutable handleを返す。unknown extension、unsafe URL、strict scalar／structural blockerも実際にV1でlossless保持できた場合だけfallback可能で、unsafe URLはraw非clickableのままにする。orphan rotation／viewport等のdrop、正規化、parser差、検証失敗はtyped blocker付き`unavailable`／artifact 0件とし、schema-validというだけでlosslessとみなさない
- `auditV2CoreRepresentabilityV1`は明示DTOへのcopyや`JSON.stringify`より前のraw structured-clone snapshotを、own enumerable keyと全array indexについてcycle-safe／boundedに走査する。objectのown-property値`undefined`はJSONでkey消失するため`v2-strict-scalar-unrepresentable`／`invalid-scalar-shape`、arrayのown `undefined`とsparse holeは`null`化を防ぐため前者を同scalar issue、後者を`v2-strict-structural-unrepresentable`／`order-bearing-shape-invalid`、`Object.is(value, -0)`は`0`化を防ぐため`invalid-scalar-shape`へ写す。`Object.hasOwn`とindex presenceを使い、adapter後の欠落やschema-validな`null`／`0`を原値の代用にしない。issueの`rawWitness`はexact tagged unionとし、object own undefinedはproperty key、array own undefined／holeはindex＋array length、negative zeroは専用tag、NaN／±Infinity、unsafe integer、cycle、非JSON structured-clone kindも各専用tag、通常値だけはstrict finite／non-negative-zeroな`json-value` branchへ写す。`valueDigest`はexact `{ domain: "fsmc-v2-raw-representability-witness-v1", issueKind, violation, sourcePath, rawWitness }`を`esp-json-v1` canonical serializeしたlowercase SHA-256とし、raw `undefined`／hole／`-0`自体をJSONへ渡さない。同じpathのobject undefined、array undefined、hole、negative zero、null、0は全て異なるdigestとなり、tag／index／length／path／digest差をschema・semantic検査で拒否する。top-levelから全10 section、settings、split、durableの保持対象leafまでsource pathとlossless raw witnessを持つcanonical issue集合にし、own `undefined`、array `undefined`、hole、`-0`、通常のabsent optional key、explicit `null`、`0`を独立fixtureにする
- V2 representabilityが成功した後、artifact bytesをstageする前にpure `auditCompanionV1RepresentabilityV1`が同じsnapshotを凍結V1 writer→current V1 reader→固定旧版A parserへ通し、source保持必須projectionのacceptanceと同値性をtotal検査する。`hallVisitLists[].hallId`がresolved normal base以外のpriority／highest／unassigned／unresolved／malformed group tokenである場合と、item `manualHallId`がdanglingである場合はV2 wireでは表現可能でも固定旧版A向けcompanionではlosslessでないため、対応する`CompanionV1RepresentabilityIssueV1`をcanonical nonempty集合で返す。issue 0件だけを`pair-prepared`、1件以上を`structural-v2-only-prepared`とし、後者も自己検証済みV2 object／artifactを返す。hall groupのbase化、dangling manual hallのdrop、synthetic hall definition追加はどちらでも禁止する。reader／固定旧版A validation由来の4 issue kindはkind別`CompanionV1ValidationFailureWitnessV1`にcandidate実byteLength／SHA、source／reader／fixed-A projection、matrix／archive／backup-limits SHA、bounded failure codeまたはoversize capをexactに保持する。oversize branchは`candidateByteLength > temporarySpoolMaxRawBytes`、他branchは実行したreader／parser結果との一致を必須にし、`witnessDigest = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-companion-v1-validation-failure-witness-v1", kind, witness })))`として自身を除外する。kind／witness分岐差、unknown key、path／digest／config SHAの単独差をschema／semantic fixtureで拒否する。resolved normalのpair positive、priority／highest／unassigned／dangling／malformed HallVisitListとdangling manual hallのV2-only positive、issue順shuffle／digest差negative fixtureをI0で固定し、I4で実Workerへ接続する
- resource判定はestimateでなくcanonical UTF-8 streamの実byteLengthとSHA-256をauthorityにする。Workerはbounded chunkとtemporary spoolを使い、V2／V1各32 MiB、pair 48 MiB、spool 64 MiB、generation timeout 300,000 msの製品上限を維持する。ただしrequired testはlimit値、clock、sinkを注入し、KiB単位の縮小fixtureで直前／一致／+1、timeout、cancel、cleanupを再現する。32～64 MiB実fileの生成や300秒待機は日常CIで行わず、stream実装変更時に限り手動で代表1回確認する。
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

V1 full restoreと完全版XLSX 2.2 full restoreはI4の初版legacy restore ownerとする。UI command種別をauthorityにしてitem-onlyとfullを推測で切り替えず、XLSX 2.2は現行Worker／parserが返すmap同梱scopeをversion dispatchで明示判定する。full restoreは、対象event、置換core、既存activeを`legacy-full-restore-without-split-settings`のdormantへ移す件数、既存retainedを元の`dormant | quarantined` status、reason、evidence、`dormantEntryId`のまま維持する件数、ローカルON維持、新規event OFFをpreviewし、core、association、active→retained遷移、既存retained、durable visit state、control、fenceを同じ`ExpectedRootVector`で原子的に確定する。旧形式はdurable visit sectionを持たないため、既存eventでは現在のdurable entryをafter-image itemへtransition plannerで移送し、一意に解決できないentry／anchorを自動削除・`null`化せず要修復としてcommitを止める。新規eventだけはcore実行順の初出順からexecution visit orderを作り、`current = { phase: "normal", anchorItemId: null }`、phase別saved anchorを全null、additional phaseを全null、`isCompleted = false`、`lastPurchaseChangeAt = null`の決定的defaultを作る。既存retainedのreasonを一括上書きしたりactiveへ戻したりせず、新しいcoreとのowner衝突が生じる場合は元statusを保ったまま別の除外reasonをpreviewへ表示してcommit全体を拒否する。取消、parse error、unsupported workbook、stale、quotaではwrite 0件とする。I0はV1／XLSX 2.2の分岐fixtureを登録し、schema、item-only／full、既存retained、durable state移送、取消、破損は高速unit／integrationで確認する。I4 quickではV1 fullとXLSX fullのsmall fixtureを代表各1件だけ実行し、独立したbrowser journeyを追加しない。I11は章10の代表V1 pairだけを確認し、同じrestore matrixを反復しない。

ここでいう「代表各1件」はrestore decisionのcoverage上限ではない。schema、destination種別、retained状態、stale、cancel、破損、write 0の全reachable branchをtable-driven unit／integrationで確認し、V1／XLSX固有adapterを各small integrationで通す。I11ではV1 pairとrestore原子性をrelease artifactから重ねて確認し、restore pathへ変更riskがある場合は対応するV1／XLSX regressionもtimebox内へ追加する。

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
  sourceEventInstanceId: EventInstanceIdV1;
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
  destinationEventInstanceId: EventInstanceIdV1;
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

このmarker範囲は後続版ADRへ渡す非規範の設計メモであり、初版の実装phase、test、Exit、Definition of Doneへ含めない。以下の「必須」「exact」「拒否」は将来ADRが採否・変更できる候補であり、本計画上の実装契約ではない。後続版を開始するPRは専用ADR、新しいstable requirement ID、代表fixtureを追加し、このmarkerを除去してから実装する。初版で規範となるのは章4と`DOD-FSMC-014`の「当該機能を初版から分離する」境界だけである。

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

### 7.3 入力安全上限と短時間検証

import拒否境界とexport生成境界を形式・file単位、V2＋V1 pair単位に分ける。I0で`config/fsmc-backup-limits.json` schema version 1へ、JSON import警告境界32 MiB、`jsonImportHardRawBytesPerFile = 64 * 1024 * 1024`、`v2ExportMaxRawBytes = 32 * 1024 * 1024`、`companionV1ExportMaxRawBytes = 32 * 1024 * 1024`、`pairTotalExportMaxRawBytes = 48 * 1024 * 1024`、`temporarySpoolMaxRawBytes = 64 * 1024 * 1024`、`exportGenerationTimeoutMs = 300_000`、`workerSliceBytes = 1 * 1024 * 1024`と、既存のnesting／token／count／文字列／error上限を固定する。XLSX 2.2は既存`config/xlsx-limits.json`を参照して値を複製しない。これらはproductの安全境界であり、required testで同サイズfileや実timeoutを生成する指示ではない。incremental sink、resource issue、`v2-export-failed`はconfig SHAへ拘束し、testではlimit、clock、sinkを注入したKiB単位fixtureで直前／一致／+1、timeout、cancel、cleanupを確認する。実上限のround-tripはstream／limit実装変更時だけ手動1回とする。

- V1／V2 JSON importは選択した各fileが警告境界32 MiBを超え、64 MiB以下かつ他の全hard limit以下の場合だけ警告付きbest effortでpreviewまで進める。XLSX 2.2にはこの64 MiB best-effort帯を適用せず、compressed 32 MiB以下かつ既存の展開後／entry／sheet／row／cell／圧縮率／時間上限を満たす場合だけpreviewへ進める。複数fileを黙示pairとして合算せず、自動削除・切捨て・設定解除を行わない
- V1／V2 JSONの単一fileが64 MiBを超える、XLSX 2.2のcompressed fileが32 MiBを超える、またはいずれかの形式固有hard limitを超える場合はWorkerまたはvalidatorで`resource-limit`として拒否する。境界は各形式で`<=`を受理、該当limitの`+1 byte`／`+1 count`を拒否とする
- exportは保証countを1件でも超える場合はV2生成・downloadを停止してevent縮小とtrusted core退避を案内し、incremental sinkで測った最終V2 canonical bytesが32 MiBを超える場合、generation timeout、spool cap実装違反、cancel、sink errorはreason別witness付き`v2-export-failed`／prepared artifact 0件とする。V2が両条件内でcompanion V1 bytesの32 MiBまたは2 file raw byteLength合計48 MiBだけを超える場合は、V1／pairを0件、`companion-v1-resource-limit`のexact issue／digestを持つverified V2-onlyをexact 1件生成する。失敗したpairの片方をV2-onlyへ偽装せず、不完全fileを完了扱いにしない
- `FSMC_NUMBER_TOKEN_MAX_UTF8_BYTES = 1 MiB`をI0 ADRへ固定し、UI、CSV、XLSX、V1／V2の全番号取込で`BigInt`化前に適用する。新規入力・file after-imageの超過は全commit前に`resource-limit`として拒否し、既存永続dataの超過tokenは原文を変更せず`legacy-unresolved / unsafe-base-number`として診断し、経路や自動再関連付けへ使わない
- backupは`JSON.parse`前のraw byte上限、nesting、総entry、文字列UTF-8 byte、duplicate ref、構造fieldのallowlist、validation error保持数を制限する。利用者入力値であるイベント名・日程名等が`__proto__`、`constructor`、`prototype`であること自体は拒否せず、動的keyは`Map`、null-prototype object、または安全なown-property APIで扱ってprototype chainへ代入しない
- 初版XLSX 2.2は既存`config/xlsx-limits.json`のcompressed／entry／展開後XML byte、sheet／row／cell数、圧縮率、wall／CPU timeとI4のcancel／heartbeat／peak memoryをすべて適用する。後続XLSX versionも少なくとも同じ制限を継承し、緩和にはversion付き判断を要求する
- アプリ自身が出力した小fixtureのV2を同version importerが拒否しないround-tripをrequired testにする。実32 MiB境界は注入した縮小limitで同じ分岐を確認する

初版のevent export preflightで1イベント内地図数、entry数、推定byte数を検査する。I0では上記3種類の境界と3.13の保証件数を固定し、I4で実canonical export bytesを使って次を実装・強制する。

- イベント単位Backup V2とV1互換coreのmap／entry、V2各32 MiB、V1各32 MiB、pair raw byteLength合計48 MiBのexport generation上限
- 上限内での自己round-trip保証

初版のeventがcount／byte上限を超える場合は不完全fileを生成せず、対象eventの縮小方法を案内する。V2 32 MiB、companion V1 32 MiB、pair 48 MiB、temporary spool 64 MiB、JSON import 64 MiB、XLSX既存limit、generation timeout 300,000 msの判定は維持する。I4 required testは注入可能な小さなlimitとfake clockで各branch、round-trip、cleanupを確認し、実32～64 MiB file、300秒待機、全format境界の直積は実行しない。実上限でのself round-tripはstream／limit実装変更時の任意手動testとする。

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
- 経路cacheとsignatureには順序付きvisit／location／baseCell／routingPort／anchorから再計算した`RouteVisitSemanticRevisionV1`、`MapLocationIndexSemanticRevision`、`pathfindingGraphFingerprint`、non-null `RoutePathConstraintFingerprint`を含める。full `PhaseVisitProjectionRevision`、full root／checkpoint revision、価格／数量／メモ／購入状態だけをcache keyにする旧edgeはI10で0件にする。whole-map、別hall、polygon／hall revision差のcacheを再利用しない。`DayMapData.cells`の`value`／`backgroundColor`、map寸法、結合領域、passability rule、3×3解像度、cost定数のいずれかが変われば古い経路を再利用しない。描画px、font色、回転、zoom、pan、DPR値をsnapshotへ保存しない

### 8.3 描画overlayの統合

通常マップと集中モードに重なる選択、hover、現在・次・前・一時位置、購入状態、候補状態、番号マーカー、経路、クリック領域は、共有`MapLocationIndex`と位置APIが返す`bounds`、`anchor`、`locationKey`を使用する。`LocationPresentationState`は既存の通常／集中モード別state reducerを`locationKey`ごとに一度集計して生成し、描画順が後のvisitで先の状態を上書きする「last drawn wins」を禁止する。

- 半領域に属するoverlayを行・列だけのcacheやdedupeへ戻さない
- ベースセル罫線、結合セル外枠などセル全体のoverlayと、a/b別overlayを明示的に分ける
- Canvas描画、DOM popupの見出し、訪問一覧、経路markerが同じ`displayNumber`と`locationKey`を参照する
- 回転、DPR、pan／zoom後も描画位置とhit-testの逆変換を同じgeometryで行う
- feature OFF／安全モードでは従来のwhole-cell overlayだけを使用し、保存済みentryを変更しない

同じboundsへ複数状態を順番に上書き描画せず、物理位置ごとに`LocationPresentationState`へ集約する。layer順は、ベースfill・罫線、a/b別状態fill、分割線、選択等のoutline、main path、点線connector、中立marker・訪問数badge、現在訪問ring、正立した番号・a/b・状態文字とする。単一訪問だけは既存の優先度色markerを維持し、複数訪問markerを特定優先度の代表色にしない。

pure `reduceLocationPresentationStateV1(mode, locationKey, visitStates)`は入力順を前提にせずexact 1結果を作る。current／next／temporary、normal／postponed／late、priorityのdecision branchはunit testで確認し、重なりはpairwise代表と固定seedのbounded shuffle property testで検証する。全状態の直積browser matrixは作らない。

unit testではfiniteなmode／phase／priority／empty・single・overlapの全reachable decision classをtable-drivenで確認する。browserはpairwiseをbaselineとし、Canvas合成、DOM代替、focus、announcementに固有の状態組合せriskがある場合は対象caseを追加する。

```ts
type FsmcOperationMessageCodeV1 =
  | "visit-selected"
  | "visit-inserted"
  | "visit-insert-cancelled"
  | "visit-reorder-saved"
  | "visit-reorder-cancelled"
  | "split-picker-setting-saving"
  | "split-picker-setting-saved"
  | "operation-stale"
  | "operation-failed";

type FsmcOperationEventIdV1 = string & {
  readonly __brand: "FsmcOperationEventIdV1";
};

interface FsmcOperationAnnouncementEventV1 {
  schemaVersion: 1;
  operationEventId: FsmcOperationEventIdV1;
  messageCode: FsmcOperationMessageCodeV1;
  subjectVisitId: PhaseVisitIdentityKey | null;
}
```

panel／picker／popupは明示的な`role="dialog"`または`role="region"`と一意なaccessible nameを持ち、icon-only close buttonは表示文言と一致する`aria-label`を持つ。top-level app rootに`[data-fsmc-announcement-scope="v1"]`をexact 1件、同scope内に`[data-fsmc-operation-status="v1"][role="status"]`と`[data-fsmc-operation-alert="v1"][role="alert"]`をpanel／dialog外へ常設exact 1件ずつ置く。状態通知は上記exact eventをpure reducerへ渡し、same IDはdedupe、新IDは同じ文言でもstatus node自体をremountせず、visible message textと`aria-hidden="true"`のevent ID digest markerを1回の`replaceChildren`で置換してsingle `childList` mutationを発生させる。accessible textはmarkerを除いたlocalized messageだけとする。同じoperation event IDを全surfaceでdocument全体exact 1 mutationとしてこのnodeへ反映し、他機能のstatus nodeは存在できるがFSMC operation eventによるmutation 0件、即時失敗だけをalert nodeへ同じevent dedupe規則で写す。rerender、同eventの再配送、panel mount／unmountでは両nodeを再mount・再通知しない。

message-code routingは`visit-selected`／`visit-inserted`／`visit-insert-cancelled`／`visit-reorder-saved`／`visit-reorder-cancelled`／`split-picker-setting-saving`／`split-picker-setting-saved`をstatus、`operation-stale`／`operation-failed`をalertへ固定し、1 eventを両nodeへ配送しない。oracleはこのpartitionの全9 codeと未知code拒否を検証する。

### 8.4 Pointer gesture state machine

Canvas入力のauthorityはPointer Eventsへ統一し、native TouchEventとReact PointerEventで別々のgesture状態を管理しない。現行のnative touch処理を持つ`src/features/map/canvas/useCanvasViewport.ts`を唯一のstate-machine migration targetとし、通常Canvasの実DOM listener／style終端`src/components/map/MapCanvasPresentation.tsx`、consumer `MapCanvas.tsx`、`FocusModeMapCanvas.tsx`は同hook／adapterから同じgesture snapshotを受ける。永続する状態は`idle`、`tapCandidate`、`dragging`、`multiPointer`のexact unionとし、cancelを脱出不能なstateとして保持しない。TouchEvent listener、React touch handler、component-local pointer mapの並行authorityはmigration完了時に0件とする。

```ts
type CanvasTargetInstanceIdV1 = string & {
  readonly __brand: "CanvasTargetInstanceIdV1";
};

interface ViewportInteractionFrameV1 {
  schemaVersion: 1;
  canvasTargetInstanceId: CanvasTargetInstanceIdV1;
  canvasRectCssPx: { left: number; top: number; width: number; height: number };
  canvasBackingStorePx: { width: number; height: number };
  viewportMeasurementSource: "visual-viewport" | "document-root-fallback";
  orientationBasisCssPx: { width: number; height: number };
  devicePixelRatio: number;
  appScale: number;
  focusSplitRatioPercent: number | null;
  layoutMode: LayoutMode;
  orientation: "portrait" | "landscape" | "square";
  normalizedRotationAngle: number;
}

type ViewportInteractionRevision = string & {
  readonly __brand: "ViewportInteractionRevisionSha256";
};
```

frameの全数値はfinite、`-0`は`0`、rect／orientation basis width／height、DPR、appScaleは`> 0`、backing width／heightは正のsafe integerとする。orientation basisは`window.visualViewport`が存在してfinite正値ならそのCSS width／heightとsource `visual-viewport`、存在しない場合だけ`document.documentElement.clientWidth/clientHeight`とsource `document-root-fallback`を使い、width > heightをlandscape、width < heightをportrait、等値をsquareへtotal導出する。`canvasTargetInstanceId`はCanvas mountごとにprocess session内で単調safe ordinalから発行し、unmount後も再利用しない。通常mapのsplit比はnull、Focusは`20 <= focusSplitRatioPercent <= 80`とし、`ViewportInteractionRevision = SHA-256(UTF8(esp-json-v1({ domain: "fsmc-viewport-interaction-frame-v1", frame })))`をliteral式とする。pointerdown capture成功時に保存し、tracked move／up、2本目down、tap／drag／viewport transform dispatch直前にfresh frameを再取得する。DOMRect、backing size、orientation basis／source、DPR、appScale、Focus split比、layout、orientation、rotationの1 fieldでも差があれば`viewport-interaction-revision-changed`へ写し、tap／drag／transform 0件で全capture／registry／release witness／timer／synthetic-click guard／pending effectを解放して即時idleへ戻す。reducer自身が同じeventで更新するpan／zoom offsetはframeへ含めない。shared hookが`ResizeObserver`、`visualViewport.resize`、orientation、layout、appScale、Focus splitter signalをmount時にexact 1 listenerずつattachし、target差替え／unmountで全てremoveして早期cancelを発行するが、各pointer eventのfresh比較を最終防壁とする。

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
- `pointercancel`、active captureの予期しない`lostpointercapture`、`viewport-interaction-revision-changed`、画面回転、layout切替、visibility喪失はnormalized global cancelへ写し、同じreduce内で全resourceを解放して`idle`へ戻す。正常`pointerup`後にrelease-request witnessと一致する`lostpointercapture`はcapture bookkeepingだけをclearしてtap／synthetic-click guardを維持し、別ID／別targetのstale lostはdispatch 0件のno-opとする
- tap確定は単一pointerの`tapCandidate`が同じpointer IDの`pointerup`を受けた場合だけ行い、後続synthetic clickで重複実行しない
- route insert、block selection等の編集modeを先に判定し、通常セルpopupとの優先順位を固定する

I0の`config/fsmc-pointer-transition-table.json`は、各validなstate／active-registry invariantからpure `deriveReachablePointerInputDomainV1`が導くexact reachable `(state, normalizedInput)`集合とexact bijectionのrowを持つ。全stateと全tokenの直積は作らず、到達不能row 0件、reachable pairの欠落／重複0件とする。raw downの正規化優先順位は、(1)既にtrackedのIDなら`duplicate-pointer-id-down`、(2)active pointerが1件以上なら`additional-pointer-down-capture-succeeded | failed`、(3)active 0件かつ`isPrimary=true`なら`primary-pointer-down-capture-succeeded | failed`、(4)それ以外は`non-primary-down-without-active`であり、2本目touchをprimaryと重複分類しない。raw moveは、(1)untracked IDを`non-active-pointer-move`、(2)`multiPointer`かつactive 2件以上でcapture順先頭2 IDのowner pairを動かす入力を`multi-pointer-owner-move`、(3)同状態のowner外IDを`multi-pointer-nonowner-move`、(4)`multiPointer`かつactive exact 1件を`multi-pointer-single-remnant-move`、(5)それ以外のtracked IDを`active-pointer-move-below-threshold | active-pointer-move-over-threshold`へこの順で排他的に写す。raw upは、(1)untracked IDを`non-active-pointer-up`、(2)`multiPointer`で除去後active 0件を`multi-pointer-up-drained`、(3)同exact 1件を`multi-pointer-up-single-remnant`、(4)同2件以上かつ離脱IDがowner pair内なら`multi-pointer-owner-up-rebase`、(5)同2件以上のowner外なら`multi-pointer-nonowner-up`、(6)それ以外のtracked IDを`active-pointer-up`へこの順で排他的に写す。残りのdisjoint inputは`pointer-cancel`、`expected-lost-pointer-capture-after-release`、`unexpected-active-lost-pointer-capture`、`stale-nonactive-lost-pointer-capture`、`visibility-or-layout-cancel`、`viewport-interaction-revision-changed`、`synthetic-click-matching | nonmatching`、`unmount`とする。revision-changedはactive 3 stateだけでreachable、idleではemitしない。release witnessはexact `{ state: "release-requested", pointerId, captureOrdinal, sequenceOrdinal, canvasTargetInstanceId }`で、normal `pointerup`の`release-capture` effectと同時に1件作る。lost eventが同target／IDのwitnessに一致しcurrent Canvasの`hasPointerCapture(pointerId) = false`ならexpected、active registryの同IDまたはcapture保持中ならunexpected、どちらにも該当しない別ID／別targetならstaleへ排他的に正規化する。normalizerは各valid snapshotの全raw inputをreachable token exact 1件へ写す。state／registry invariant自体が不正ならtableへ入れずpre-table corruption guardが全capture／registry／timer／guardをfail-closed cleanupし、invalid invariantを通常transition rowとして水増ししない。非active moveは座標、threshold、gesture stateを変更しない自己遷移に固定する。unknown raw event、非finite座標、owner pairの旧／新距離を安全に算出できない入力は受け口で`visibility-or-layout-cancel`と同じ即時cleanupへ写し、暗黙defaultを持たない。

`idle`の`primary-pointer-down-capture-succeeded`だけが`tapCandidate`へ入り、primary／additionalのcapture failed、duplicate IDはdispatch 0件で即時`idle` cleanupする。active 0件のnon-primary downとnon-active move／upは唯一の`ignored` branchでregistryを変更しない。`tapCandidate`のthreshold超過は`dragging`、additional capture成功は`multiPointer`、同一ID upだけがtapをexact 1回dispatchする。`dragging`はtapをdispatchしない。DOM `PointerEvent.pointerId`はnormalizer入口から非負safe-integer `number`のまま保持し、文字列化やlexicographic比較をしない。active registryはcapture成功ごとに単調増加する非負safe-integer `captureOrdinal`をexact 1件割り当て、entryを数値tuple `(captureOrdinal, pointerId)`の昇順へ正規化する。`multiPointer`のowner pairはその先頭2件で固定し、同じpointer IDの再登録は`duplicate-pointer-id-down`、ordinal重複／overflow／負数／非整数IDはpre-table corruption guardからfail-closed cleanupする。owner moveは旧／新centroid差と正の有限な旧／新distance比をexact `{ translateCssPx, scaleFactor, centroidCssPx }`へしてviewport transformを1回dispatchする。owner外moveはregistryだけを更新する。`multi-pointer-owner-up-rebase`は残存先頭2件をowner pairへ、`multi-pointer-up-single-remnant`は残存1件をpan baselineへeffect 1回でrebaseし、どちらもtransform 0件、`multi-pointer-nonowner-up`はregistry除去だけ、`multi-pointer-up-drained`だけは`idle` cleanupとする。single-remnant moveはpanをdispatchするがtap候補へ戻さない。pointer cancel、unexpected active lost capture、visibility／layout cancel、`viewport-interaction-revision-changed`、unmountはactive stateを問わずdispatch 0件で全capture／release witness／registry／timer／synthetic-click guard／pending effectを解放し、drainを待たず即時`idle`へcleanupする。normal up後のexpected lostは`clear-release-witness`だけでguardを維持し、stale nonactive lostはstate／registry／guard不変とする。新しいprimary downはcapture前に古いrelease witnessをclearし、同pointer ID再利用でも新capture ordinal／sequence ordinalを発行する。pointer ID `2`／`10`、duplicate、up後のID再利用をowner選択goldenへ固定し、decimal文字列順の`10 < 2`を拒否する。

effectは`capture | record-release-request | release-capture | clear-release-witness | start-drag | dispatch-tap | dispatch-drag | dispatch-viewport-transform | rebase-multi-pointer-owners | suppress-synthetic-click | clear-synthetic-click-guard | clear-registry | clear-timers | clear-pending-effects`の重複なし順序付き列として固定し、各table rowへexact 1列を記録する。`dispatch-viewport-transform`は同一rowの正規化済みtranslation／scale／centroidだけを使い、viewport reducerの固定zoom上下限を1回適用する。tapを所有するCanvasでは後続`click`を同じpointer sequenceのone-shot guardでdispatch 0件にする。`SyntheticClickGuardV1`はexact `{ state: "awaiting-matching-click", sequenceOrdinal, canvasTargetInstanceId, sourcePointerId, sourcePointerType, sourceButton: 0, upClientCssPx: { x, y }, upEventTimeStampMs }`を持ち、全数値はfinite、ordinal／IDは非負safe integer、`-0`は`0`へcanonical化する。raw clickはrequired Chromiumで`PointerEvent`、`isTrusted = true`、`detail = 1`、`button = 0`、guardと同じmounted canvas target／pointer ID／pointer type、各client座標差が0.5 CSS px以下、`0 <= click.timeStamp - upEventTimeStampMs <= 1000`、registry empty、guard ordinalがlast completed sequence ordinalと一致する場合だけ`synthetic-click-matching`とする。keyboard activation（`detail = 0`／pointer ID `-1`）、別target、別button／type／ID、非finite／逆行／1000ms超過、同座標でも別sequenceは`synthetic-click-nonmatching`とする。matching clickは`suppress-synthetic-click, clear-synthetic-click-guard`、nonmatching clickはdispatchせずguard不変、次のprimary downではordinal更新前・capture前にguard clear、unexpected lostを含む全global cancel／unmountでもclearとする一方、expected lost／stale lostではclearしない。合法列`down → up(dispatch tap＋guard＋release witness) → expected lost(clear witness only) → matching click(suppress＋clear guard)`はtap exact 1回／click dispatch 0件とする。timer expiryは使わないためtransition domainへ隠れたtimer inputを追加しない。`idle`へ戻る全terminalはactive pointer registry、capture、timer、pending tap／drag／viewport transformが空であり、normal release直後だけrelease witness exact 1件、guardは`dispatch-tap`直後の`awaiting-matching-click`かemptyの直交exact unionを許す。expected lostはwitnessだけを0件にし、matching clickとの到着順が逆でもtapを再dispatchしない。次のpointer sequence開始前またはunmount後はguardも必ずemptyとし、property testは任意event列の後にglobal cancelまたはunmountを与えて全fieldが即時emptyへ収束することを検証する。

## 9. 実装フェーズとPR境界

I0～I11の責務境界は、DB移行や公開時期を安全に管理するため維持する。ただし、各phaseを巨大なCI DAG、artifact upload、外部approvalへ結び付けない。I0／I2／I4は下表の依存順3 PR、I11は2 PR、その他phaseは原則1 PRとする19論理PRを基準にし、件数自体ではなく全sub-PRの結合gate成功後にだけphase Exitを記録する。

全phaseに共通する規則は次のとおりである。

- 各PRは変更対象のunit／integrationを追加し、UI導線を変更した場合だけChromium smokeを追加する
- `npm run quality`全graph、全browser、最大fixture、全phase testの再実行を毎PRへ要求しない
- product build、QA build、rollback buildはlocal directoryで扱い、GitHub Actions artifactやGHCRへuploadしない
- split機能はI11までproductionで既定OFFとし、I2～I10の確認はlocal QA build／test harnessで行う
- Exit証跡はPR本文またはlocal verification recordのcandidate SHA、command、exit code、durationだけでよい
- 通常PRは1 command 10分、全体20分を超えた場合に停止する。I11は既出commandの同一実行を足し直さず全automated gateとproduction／feature-disabled buildを束ねたrelease quick 1 commandを20分、同じ結果を使うmanual checkを追加5分までとする。重要不変条件をunit／integration／release artifactから重ねて確認することは維持する
- 既存機能のデータ消失、a/b混同、部分commit、安全モード不成立を検出した場合は時間短縮を理由にtestを削除しない

| Phase | PR-A（production public edge 0件）                                             | PR-B                                                             | PR-C／phase Exitの結合条件                                                                    |
| ----- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| I0    | I0-A: change-surface、membership／architecture／coverage、QA allowlist closure | I0-B: type／schema、golden fixture                               | I0-C: quick／Worker／browser-context／performance runner。A/B contractを検証して全I0 gate成功 |
| I2    | I2-A: `Vcap` preflight、open progress、`onblocked`／versionchange              | I2-B: QA store manifest、repository、CAS transaction             | I2-C: local control、V2 enablement Port、recovery／2-tab。DB matrixとfallback成功             |
| I4    | I4-A: V2／V1 DTO、representability、serializer／reader                         | I4-B: Worker、limit、CSP／PWA、handoff                           | I4-C: atomic restore、V1／XLSX compatibility、cleanup／UI。全I4 gate成功                      |
| I11   | I11-A: durable visit freeze／migration、全writer cutover、release rehearsal    | I11-B: production `Vcap`／readiness公開、rollback build／runbook | 同じcandidate sourceからrelease quickとmanual check成功                                       |

各先行PRは後続PR用の型または内部adapterを追加できるが、未実装を成功扱いにするstub、production query flag、storage override、公開commandを置かない。sub-PRをさらに分ける場合は変更面、依存、単独test、production非到達性をPR作成前に本節へ追記する。

### FSMC-I0着手前ゲート（phase外）

章15のpre-I0 commandをclean worktreeで各1回実行し、同じcandidate SHAで全exit code 0の場合だけI0へ進む。既知のrepository全体問題、FSMCと無関係なfailure、reviewer承認、I0で初めて作るFSMC対象testのいずれもwaiverにしない。2026-08-25時点では`npm run format:check`が既存`docs/各フェーズのFormal Exit達成.md`で失敗しているためNo-Goであり、同fileの整形後にunit→integration→Workerを含む全baselineを直列で再実行する。AWS、GitHub admin API、package registry、billing情報、credentialは観測しない。

### Phase一覧

| Phase | 主な実装                                                                           | 必須の短時間確認                                                                                        | Exit                |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------- |
| I0    | domain／control／V2 health契約、代表fixture、change-surface、test script、Vcap判断 | encoding、typecheck、unit／integration／Worker、membership／architecture／coverage policy、QA allowlist | `EXIT-FSMC-I0-001`  |
| I1    | identity、geometry、位置index、pointer／visit pure reducer                         | changed-area unit、bounded property test                                                                | `EXIT-FSMC-I1-001`  |
| I2    | DB capability、new store、CAS、local control、V2 ON preflight、安全mode            | DB／`onblocked` integration、fake eligibility decision、runtime ON 0、stale時write 0                    | `EXIT-FSMC-I2-001`  |
| I3    | event／map／hall lifecycle、whole-event duplicate、writer participant化            | create／rename／delete／duplicate、V2 after-image guard                                                 | `EXIT-FSMC-I3-001`  |
| I4    | Backup V2、V1互換core、Worker、CSP／PWA、restore                                   | `test:worker`、small V2／V1／XLSX、limit／timeout、atomic restore                                       | `EXIT-FSMC-I4-001`  |
| I5    | split設定UI、copy、preview、guided profile reset                                   | true touch context、reset eligible／blocked、stale時write 0                                             | `EXIT-FSMC-I5-001`  |
| I6    | 地図再取込、通常編集、retained管理、map identity repair                            | 一意継承、曖昧隔離、repair、V2 guard、stale時write 0                                                    | `EXIT-FSMC-I6-001`  |
| I7    | shared visit projection、reorder、notification、item／orphan repair                | projection unit、atomic reorder／repair integration                                                     | `EXIT-FSMC-I7-001`  |
| I8    | 通常map shell、hit-test、DOM代替、通常Canvas Pointer authority                     | true touch、200% zoom／forced-colors、architecture、a11y                                                | `EXIT-FSMC-I8-001`  |
| I9    | 集中mode、Focus Canvas Pointer authority                                           | 集中mode touch／pointer cancel、legacy Touch authority 0件                                              | `EXIT-FSMC-I9-001`  |
| I10   | route、connector、cache                                                            | route correctness＋relative／absolute performance sentinel                                              | `EXIT-FSMC-I10-001` |
| I11   | durable visit migration、production Vcap、公開、local rollback                     | `fsmc-release-quick`、blocked upgrade、rollback-disabled smoke                                          | `EXIT-FSMC-I11-001` |

### Requirement ID → Phase／test／Exit traceability

この表を`RC-*`の実行authorityとする。`Q` = `npm run test:fsmc:quick`、`B` = `npm run test:fsmc:browser:smoke`、`P` = `npm run test:fsmc:performance:smoke`、`R` = `npm run test:fsmc:release:quick`、`W` = FSMC Worker project、`POL` = `verify:test-project-membership`＋`verify:architecture`＋`verify:coverage-policy`＋`test:coverage-policy`である。Formal Exit欄の`I<n>`は必ず同じ番号の`EXIT-FSMC-I<n>-001`を意味し、「各owner Exit」もowner欄に列挙した全phaseの同名Exitを指す。複数phaseのrequirementは最初のphaseがcontract owner、後続phaseがruntime ownerであり、表の全Exitを満たすまでrequirement完了にしない。

| Requirement | owner phase        | 変更面／成果物                                                                | 代表test                                                         | Formal Exit        |
| ----------- | ------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------ |
| `RC-01`     | pre-I0             | clean baseline、waiver禁止、直列pool、verification record                     | diff／encoding／format／typecheck／lint／unit→integration→Worker | pre-I0 gate        |
| `RC-02`     | I0／I1／I7／I10    | PD-14 C0 inventory／C1 pure契約／C2 projection・通知／C3 route・cache         | 各phase Q、I10 P                                                 | I0／I1／I7／I10    |
| `RC-03`     | I0、I2～I10        | local control、lifecycle、Backup、copy、reimport、retained、visit、map、route | 各owner Q、UI B、route P                                         | I2～I10            |
| `RC-04`     | I2／I11            | QA `Vcap` migrationとI11だけのproduction DB version更新                       | DB version matrix、R                                             | I2／I11            |
| `RC-05`     | I0／I1／I7         | readonly DTO、location index、projection adapter／revision                    | schema negative、pure／projection unit                           | I0／I1／I7         |
| `RC-06`     | I1／I8／I10        | `SubcellPathNode`、実VisitList shell、dead shell廃止、route型                 | Q、B、route unit／P                                              | I1／I8／I10        |
| `RC-07`     | I0／I4             | 独立V2 wire DTO、V1／XLSX restore、safe-link                                  | schema、round-trip、unsafe URL                                   | I0／I4             |
| `RC-08`     | I2／I5／I11        | recovery診断、in-place／guided profile reset、runbook                         | recovery integration、B journey 7、R                             | I2／I5／I11        |
| `RC-09`     | I0／I4／I11        | input／output limit、Worker、bounded slice、CSP／PWA、cancel                  | W、limit Q、CSP verifier、release smoke                          | I0／I4／I11        |
| `RC-10`     | I0／I10／I11       | performance harnessと6 scenario                                               | Pのrelative＋absolute sentinel、R                                | I0／I10／I11       |
| `RC-11`     | I0                 | 固定旧版A、全change-surface、QA allowlist、membership／coverage／architecture | Q＋W＋POL＋QA build verifier                                     | I0                 |
| `RC-12`     | I0／I8／I9／I11    | readiness、DOM代替、status／alert、AT oracle、Canvas a11y                     | Q、200%／forced-colors B、R                                      | I0／I8／I9／I11    |
| `RC-13`     | I2／I3／I4         | canonical eventSettings、bridge journal、lifecycle／Backup participant        | bridge crash、writer mapping、Backup integration                 | I2／I3／I4         |
| `RC-14`     | I0／I2／I5／I11    | `Vcap`採択、coverage-verified reset、production migration                     | DB compatibility、reset integration／B、R                        | I0／I2／I5／I11    |
| `RC-15`     | I0／I2／I7／I11    | durable root／store、projection／reorder、durable migration                   | schema、DB、atomic reorder、R migration                          | I0／I2／I7／I11    |
| `RC-16`     | I0／I1／I3／I4／I6 | stable ID／slot locator、全writer、V2、reimport transition                    | canonical golden、lifecycle／restore／reimport                   | 各owner Exit       |
| `RC-17`     | I3／I6／I8         | whole-event duplicate、通常地図編集、VisitList shell移行                      | duplicate／edit integration、B                                   | I3／I6／I8         |
| `RC-18`     | I1／I5～I8／I10    | retained再関連付け、rekey／insert、hit-test、connector                        | decision table、reimport、B、route Q／P                          | 各owner Exit       |
| `RC-19`     | I0／I10／I11       | 6 scenario、timeout、比較／絶対sentinel                                       | P、R                                                             | I0／I10／I11       |
| `RC-20`     | plan／全phase      | 本traceability表と参照review                                                  | Markdown review＋各phase command                                 | 各phase Exit       |
| `RC-21`     | I0                 | deterministic最大generatorとsmall fixture                                     | count／seed／hash unit                                           | I0                 |
| `RC-22`     | I0／I11            | 外部service非依存、local-only gate／rollback                                  | Q構成test、R                                                     | I0／I11            |
| `RC-23`     | I0／I8／I9         | 通常／集中×Desktop direct／Mobile pickerの4 manifest row                      | Bの4 named scenario                                              | I0／I8／I9         |
| `RC-24`     | I1／I6／I8／I10    | fatal physical duplicateと局所exclusion分離                                   | geometry unit、4 reimport、B、route                              | I1／I6／I8／I10    |
| `RC-25`     | I1／I7／I8／I10    | physical slotとwhole／a／b／unsupported location、revision                    | 26c／d／ab、projection、B、route                                 | I1／I7／I8／I10    |
| `RC-26`     | I1／I10            | `RoutePathConstraintV1`、polygon-bound path／cache                            | constraint unit、route correctness／P                            | I1／I10            |
| `RC-27`     | I7／I8             | 共通reorder planner／atomic command、pointer／keyboard UI                     | planner／stale integration、B                                    | I7／I8             |
| `RC-28`     | I0／I2／I4         | healthy V2、ON preflight、pair／2種V2-only、receipt                           | health golden、fake enable integration、W／handoff mutation      | I0／I2／I4         |
| `RC-29`     | I0／I2／I5／I8／I9 | `forcedPickerOverride` schema／control／UI／両map                             | schema negative、toggle reload、3 selection B                    | I0／I2／I5／I8／I9 |
| `RC-30`     | pre-I0／I0         | local baselineとverification recordだけ                                       | pre-I0 command、runner unit                                      | pre-I0／I0         |
| `RC-31`     | I0＋risk owner     | Chromium共有install、名前付きrequired engine regression                       | config unit、対象B                                               | I0＋対象phase      |
| `RC-32`     | plan／全phase      | 本表の1行1Requirement追跡                                                     | Markdown review                                                  | 各phase Exit       |
| `RC-33`     | 全phase            | 19 PR基準、I0／I2／I4の依存順3 PR、I11の2 PR                                  | 各PR Q＋UI／browser影響時B＋性能影響時P                          | 各phase Exit       |
| `RC-34`     | I0／I11            | quick／release aggregate、直列pool、timeout、retry 0                          | orchestration unit、R                                            | I0／I11            |
| `RC-35`     | I0／I4             | V2 digest schema／canonical bytes                                             | field mutation／digest negative                                  | I0／I4             |
| `RC-36`     | I0／I11            | manifest除外canonical file-tree digest                                        | root／timezone同値、path／byte差、reparse拒否                    | I0／I11            |
| `RC-37`     | I0／I1／I8／I9     | Pointer table／reducer、通常／Focus DOM authority                             | table＋bounded property、true-touch B、architecture              | I0／I1／I8／I9     |
| `RC-38`     | I0                 | local `fsmc-quick`と任意single CI check                                       | Q、workflowを置く場合のstatic test                               | I0                 |
| `RC-39`     | I0／I11            | suite重複防止、同一job build→smoke、record                                    | runner unit、R                                                   | I0／I11            |
| `RC-40`     | I0／I11            | 任意CI single job／timeout／matrixなし                                        | workflow static testまたはlocal record、R                        | I0／I11            |
| `RC-41`     | I11                | 小さな事故記録、停止／再開runbook                                             | failure drill、5分manual、R                                      | I11                |
| `RC-42`     | I1／I2／I10        | semantic revision、CAS非代用、cache signature                                 | non-location edit unit、stale integration、route cache           | I1／I2／I10        |
| `RC-43`     | I11                | production migration、Backup、feature-disabled rollback                       | R＋rollback-disabled smoke                                       | I11                |

#### Product decision traceability

| Requirement | owner phase            | supporting RC              | 変更面／成果物                                              | 代表test                                           | Formal Exit            |
| ----------- | ---------------------- | -------------------------- | ----------------------------------------------------------- | -------------------------------------------------- | ---------------------- |
| `PD-01`     | I4                     | RC-07／RC-08               | legacy full restore時のactive→dormant、preview              | V1／XLSX full restore integration                  | I4                     |
| `PD-02`     | I0／I1／I2／I6／I7     | RC-16／RC-28               | 番号正規化、ON preflight、map／item／orphan repair          | collision golden、enable／repair integration       | I0／I1／I2／I6／I7     |
| `PD-03`     | I2／I11                | RC-03／RC-04／RC-22        | local control、安全mode、production公開                     | control／DB integration、R                         | I2／I11                |
| `PD-04`     | I2／I7／I10／I11       | RC-02／RC-04／RC-43        | OFF fallback、C2／C3、release-ready registration            | phase-aware Q、route P、R                          | I2／I7／I10／I11       |
| `PD-05`     | I1／I8／I9             | RC-23／RC-29／RC-37        | selection resolver、通常／集中picker                        | resolver table、3 context B                        | I1／I8／I9             |
| `PD-06`     | I5                     | RC-03／RC-18               | additive／full-sync copy planner、preview                   | copy unit／integration／B                          | I5                     |
| `PD-07`     | I0／各変更phase／I11   | RC-10／RC-19／RC-31／RC-34 | test policy、risk gate、verification record                 | Q／W／POL／B／P／R                                 | I0～I11                |
| `PD-08`     | I2～I10／I11           | RC-03／RC-07／RC-28        | 初版主機能＋不可分support scope                             | 各owner Q、UI B、Backup W、route P、R              | I2～I11                |
| `PD-09`     | I3／I6                 | RC-03／RC-16               | event delete retention、retained管理／再関連付け            | clock／delete／relink integration                  | I3／I6                 |
| `PD-10`     | I0／I11                | RC-01／RC-34／RC-39        | retryなしquick／release aggregate                           | runner orchestration unit、Q、R                    | I0／I11                |
| `PD-11`     | I1／I5／I8／I9         | RC-18／RC-25               | whole／unsupported identity、preview、badge／list           | identity unit、UI B                                | I1／I5／I8／I9         |
| `PD-12`     | I0／I2／I4             | RC-28／RC-35               | V2 health／eligibility、pair／V2-only、digest               | health golden、fake enable、W／handoff             | I0／I2／I4             |
| `PD-13`     | I1／I10                | RC-18／RC-26               | connector mask、polygon-bound route                         | connector decision table、route correctness        | I1／I10                |
| `PD-14`     | I0／I1／I7／I10        | RC-02／RC-05／RC-27／RC-42 | C0 inventory、C1 identity、C2 projection、C3 route／cache   | inventory／pure／projection／cache Q、P            | I0／I1／I7／I10        |
| `PD-15`     | I2／I4                 | RC-13／RC-29               | local controlのBackup除外、restore先local state維持         | schema negative、restore integration               | I2／I4                 |
| `PD-16`     | I0／I2／I3／I4／I6／I7 | RC-16／RC-17／RC-18／RC-28 | collision oracle、全identity writer guard、3 repair command | pair-set unit、writer／restore／repair integration | I0／I2／I3／I4／I6／I7 |
| `PD-17`     | I0／I10／I11           | RC-10／RC-19／RC-21        | performance fixture、relative／absolute sentinel            | generator unit、P、R                               | I0／I10／I11           |
| `PD-18`     | I2／I5／I11            | RC-08／RC-14／RC-43        | corruption recovery、guided reset、停止／復旧runbook        | recovery integration、reset B、R                   | I2／I5／I11            |

特にguided profile resetはI5、`fsmc.repair.map-identity.v1`はI6、`fsmc.repair.item-numbers.v1`／`fsmc.repair.orphan-visit-state.v1`はI7、durable visit migrationはI11、Pointer Eventsのpure contract／通常Canvas／Focus CanvasはI1／I8／I9、event lifecycle writer participant化はI3のFormal Exitに必ず現れるため、短いPhase表だけを根拠に省略しない。

### FSMC-I0: 契約・fixture・短時間test基盤

- FSMCの型、schema、stable ID、Vcap decisionをrepository内で固定する
- `MapCellSplitControlRoot.forcedPickerOverride`、`V2SnapshotHealthDecisionV1`、`V2EnablementEligibilityPort`、issue→repair option、旧field拒否をtype／JSON Schema／goldenで固定する。I2はfake Port、I4は実Worker adapterを所有し、未登録adapterを成功扱いにしない
- non-promotableな`build:qa:fsmc`と、`test:fsmc:quick`、`test:fsmc:browser:smoke`、`test:fsmc:performance:smoke`、`test:fsmc:release:quick`を追加する。I0では4 test scriptの構文、対象0件拒否、引数伝播を静的／unitで検証し、release-ready production buildを必要とする`test:fsmc:release:quick`自体は実行しない
- quick scriptはmanifestのunit→integration→Worker projectを同一process poolで並列起動せず、この順に各1回実行する。各required projectの対象testが0件なら失敗し、`--passWithNoTests`を付けない。unitとintegrationが同じ重要不変条件を異なるfailure signalで確認する重層testは維持する
- 日常fixtureと最大fixture generatorを分け、required testは日常fixtureだけを展開する
- PlaywrightはChromium 1 installを共有するが、Desktop mouse／Desktop touch／Mobile touchを別contextにし、Mobileは`hasTouch = true`、`isMobile = true`、DPR 3、trusted touch入力と`pointerType = "touch"` assertionを固定する。viewportだけの切替をMobile証跡にしない

I0-Aは次のchange-surface inventoryをpath単位でfixture化し、実装中にpath追加・renameがあれば同じPRで更新する。

| 面                               | I0で固定するrepo-relative path（存在区分もfixture field）                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | owner／必須確認                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--qa-profile fsmc`              | `scripts/build-release-vite.mjs`、`scripts/verify-release-a-build.mjs`、`vite.config.ts`、`scripts/lib/release-build-input.mjs`、`scripts/lib/release-build-input.d.mts`、`scripts/build-pwa-recovery-agent.mjs`、`scripts/release-policy.test.mjs`、`scripts/build-pwa-recovery-agent.test.mjs`                                                                                                                                                                                                                            | I0-A。5拒否境界のallowlist、`qa-fsmc` non-promotable identity、production拒否をunit＋build verifierで確認                         |
| new object store／DB open        | `src/persistence/db/constants.ts`、`src/persistence/db/openDatabase.ts`、`src/persistence/db/transactionCoordinator.ts`、`src/persistence/repositories/recordRepository.ts`、`src/persistence/repositories/controlRepository.ts`、`src/persistence/repositories/applicationDataRepository.ts`、`src/persistence/repositories/mapRepository.ts`                                                                                                                                                                              | I2-A/B。DB5 productionで未作成、QA／I11 `Vcap`でだけ作成、`onblocked`／versionchange／all-old-or-all-new integration              |
| repository／DB compatibility     | `src/persistence/repositories/eventRepository.ts`、`src/persistence/repositories/settingsRepository.ts`、`src/persistence/repositories/syncQueueRepository.ts`、`src/persistence/repositories/repositoryContracts.test.ts`、`config/db-compatibility-contract.json`、`scripts/verify-db-compatibility-contract.mjs`、`scripts/lib/db-compatibility-authority.mjs`、`src/utils/indexedDB.versionCompatibility.integration.test.ts`                                                                                           | I0-Aで全pathを分類し、I2／I11でstore参加有無、DB5／`Vcap`、upgrade／downgrade／unknown-futureを検証                               |
| transaction／migration／recovery | `src/persistence/db/atomicRestoreTransaction.ts`、`src/persistence/migration/legacyMigration.ts`、`src/persistence/recovery/recoveryAdoption.ts`、`src/persistence/recovery/recoverySourceEvidence.ts`、`src/persistence/recovery/recoveryRepository.ts`、`src/utils/persistenceResilience.ts`、`src/persistence/facade/indexedDbPersistence.ts`、`src/persistence/adapters/indexedDbPersistenceCommandAdapter.ts`、`src/hooks/useIndexedDbPersistence.ts`、`src/app/composition/appRuntime.ts`                             | I2／I4／I11。participant manifest、crash／stale／quota、recovery coverage                                                         |
| lifecycle writer                 | `src/app/commands/useEventLifecycleCommands.ts`、`src/app/commands/useEventLifecycleCommands.test.tsx`、`src/app/commands/useEventUpdateCommands.ts`、`src/app/commands/useEventUpdateCommands.test.tsx`、`src/app/ports/PersistenceCommandPort.ts`、`src/persistence/adapters/indexedDbPersistenceCommandAdapter.ts`、`src/persistence/facade/indexedDbPersistence.ts`、`src/persistence/db/atomicRestoreTransaction.ts`、`src/persistence/repositories/applicationSnapshotOps.ts`、`src/App.tsx`                          | I3。rename／delete／create／update／duplicateでassociation、control、event settings、durable、V2 healthを同一commit participant化 |
| Backup Worker                    | `src/features/map-cell-split/backup/fsmcBackup.worker.ts`（new）、`src/features/map-cell-split/backup/fsmcBackupWorkerServer.ts`（new）、`src/features/map-cell-split/backup/fsmcBackupWorkerClient.ts`（new）、`src/features/map-cell-split/backup/fsmcBackupWorkerServer.worker.test.ts`（new）、`vite.config.ts`、`scripts/build-pwa-recovery-agent.mjs`                                                                                                                                                                 | I0 contract／I4実装。Worker project、CSP verifier、PWA precache／offline build smoke                                              |
| Canvas input                     | `src/features/map/canvas/useCanvasViewport.ts`、`src/components/map/MapCanvasPresentation.tsx`、`src/components/map/MapCanvas.tsx`、`src/components/FocusModeMapCanvas.tsx`                                                                                                                                                                                                                                                                                                                                                 | I1 reducer、I8通常、I9集中。Pointer Events authorityとlegacy touch handler 0件architecture test                                   |
| policy／coverage                 | `config/test-project-membership.json`、`vitest.unit.config.ts`、`vitest.integration.config.ts`、`vitest.worker.config.ts`、`config/architecture-policy.json`、`config/architecture-baseline.json`、`config/coverage-policy.json`、`scripts/verify-test-project-membership.mjs`、`scripts/verify-architecture.mjs`、`scripts/verify-coverage-policy.mjs`、`scripts/coverage-policy/coverage-policy.test.mjs`、`package.json`                                                                                                 | I0-A。`src/features/map-cell-split/`を専用subsystemへ登録し、membership／architecture／coverage policyの4 verifierをquickで実行   |
| FSMC runner／browser registry    | `scripts/fsmc/run-quick.mjs`（new）、`scripts/fsmc/run-quick.test.mjs`（new）、`scripts/fsmc/run-browser-smoke.mjs`（new）、`scripts/fsmc/run-browser-smoke.test.mjs`（new）、`scripts/fsmc/run-performance-smoke.mjs`（new）、`scripts/fsmc/run-performance-smoke.test.mjs`（new）、`scripts/fsmc/run-release-quick.mjs`（new）、`scripts/fsmc/run-release-quick.test.mjs`（new）、`playwright.fsmc.config.ts`（new）、`config/fsmc-browser-risk-regressions.json`（new）、`config/fsmc-performance-sentinels.json`（new） | I0-C。直列lane、3 context、required engine case閉包、sentinel、timeout／失敗伝播をrunner unitで固定                               |

capability storeはI2～I10 productionの無条件`Object.values(STORES)`集合へ追加しない。QA namespace用store manifest、DB version別required-store manifest、recovery participant manifestを分離し、I11のproduction `DB_VERSION = Vcap`と同じ最終candidateで初めてproduction required-store集合へ加える。上表とDB compatibility contractの各repo-relative pathを`existing | new`と`change | test-only | proven-unaffected`のexact 1分類へ置き、filesystem存在状態と宣言が一致しないpath、basename、glob、未分類をI0 Exitで拒否する。これにより定数追加だけでDB5にstore作成／必須検査が波及したり、新storeがrecovery対象へ暗黙追加される一方でatomic restore participantから漏れたりする状態を禁止する。

`config/coverage-policy.json`には`id = "map-cell-split"`、`vitestGlobs = ["src/features/map-cell-split/**/*.{ts,tsx}"]`、`changedScope.prefixes = ["src/features/map-cell-split/"]`、subsystem branches 75／functions 80／lines 85／statements 85、changed-code branches 80／lines 85、`requiredFromExit = "EXIT-FSMC-I0-001"`をI0で追加する。Worker側scriptはnode coverageまたは既存Worker coverage laneへ明示列挙し、未計測にしない。`scripts/verify-coverage-policy.mjs`のmandatory subsystem集合とpolicy testも同時更新する。新規FSMC testがunit／integration／Workerのexact 1 project membershipを持つこと、architecture allowlistとbaseline更新が同じchangeを説明すること、`quality`／`quality:local`からpolicy verifierが外れないことを静的testする。

**EXIT-FSMC-I0-001** — repository内だけでtype／schema／golden、change-surface inventory、4本のtest script、QA build profileの5拒否境界、unit／integration／Worker membership、architecture、`map-cell-split` coverage policyを検証できる。`test:fsmc:quick`はunit→integration→Workerと4 policy verifierを直列で各1回実行し、各lane 0件を拒否して10分以内、Desktop mouse／Desktop touch／Mobile touchの3独立context（各hasTouch、isMobile、DPR、touch入力時の受信pointerTypeをassert）を含むI0確認全体が20分以内に完了する。`test:fsmc:release:quick`の実行成功はI11だけの条件とし、外部service、credential、artifact uploadを0件とする。

### FSMC-I1: 共通domain

- parser、`LocationKey`、geometry、split orientation、semantic revisionをpure moduleとして実装する
- decision tableはunit test、順序不変性は固定seed・最大100 caseのbounded property testで確認する
- 回転、DPR、状態の全reachable logicはunitで確認し、browserはpairwiseをbaselineに固有riskのある組合せを追加する。raw全軸の無条件直積を既定にしない
- Pointer Eventsのnormalized input、`idle | tapCandidate | dragging | multiPointer` reducer、capture／cancel／lost capture／multi-pointer drainのtotal transition tableをpure contractとして実装する。I1はDOM listenerを切り替えず、通常Canvas移行をI8、Focus Canvas移行と旧TouchEvent authority 0件確認をI9が所有する

**EXIT-FSMC-I1-001** — whole／a／b／unsupported、衝突、回転代表、Pointer FSMの全reachable row／cancel／capture failure、visit集約が高速unit testで成功し、既存whole-cell動作が変わらない。DOM authority移行はI8／I9 Exitまで未達として明記する。

### FSMC-I2: 保存基盤とlocal control

- `Vcap` preflight、governed root、CAS、local OFF／event ON、automatic safe modeを実装する
- 現行`DATABASE_OPEN_BLOCKED_TIMEOUT_MS`／`IndexedDBOpenBlockedError`を成功可否のauthorityから外し、既存`indexedDB.resilience.integration.test.ts`のtimeout期待をpending progress／same-request resume期待へ更新する。旧error classを診断互換で残す場合も新FSMC open pathからの生成0件をarchitecture testする
- DBなし、現行version、`Vcap - 1`、`Vcap`、supported超過、partial lossをintegrationで確認する
- 2 tabは「先行commit成功、後行write 0」の代表1ケースをbrowserまたはintegrationで確認する
- `openDatabase.ts`の`onblocked`と既存connectionの`versionchange`を明示progress stateとして実装する。`onblocked`は5秒等のterminal rejectへ変換せず同じopen request／Promiseをpendingに保ち、別request、transaction、repair write、成功UIを開始しない。blocking tabを閉じる案内を出し、blocker close後に同じrequestが`onupgradeneeded`／`onsuccess`へ進むこと、`onerror`とversionchange `onabort`の連続通知をattempt ledgerでterminal exact 1件へdedupeすることを2 connection fake-IDB integrationで確認する。page離脱時は後着resultを無視してconnectionを閉じるが、自動DB deleteや偽cancel成功を表示しない
- `V2EnablementEligibilityPort`のfake adapterでhealthy、unknown extension、unsafe URL、strict scalar、limit、unavailable、staleを確認し、eligibleだけevent effective ON、blocked／unavailableは全root write 0、device ONでは該当eventだけlegacy fallbackとする。実Worker接続前のQA runtimeはevent ON不可とする

**EXIT-FSMC-I2-001** — all-old／all-new、`onblocked`中pending／write 0／request 1件、blocker close後の同request resume、error／abort terminal dedupe、stale時write 0、unsupported DBの安全拒否、OFF時のlegacy動作が代表fixtureで成功する。V2 enablementはcontract fake harness内のdecision／commit simulationに限り、eligibleだけmembership追加をsimulateし、unknown extension／unsafe URL／strict scalar／limit／adapter unavailableは全root write 0、複数enabled eventでは不適格eventだけのfallbackを確認する。I2 production／通常QA runtimeはeligibility adapter未登録、effective ON 0件をarchitecture／build testで固定し、実Worker接続後のruntime ONはI4 Exitが所有する。

### FSMC-I3: lifecycle

- event／map／hall／blockのstable identityと、create／rename／delete／duplicateのatomic commandを実装する
- `config/fsmc-command-participants.json`へ`useEventLifecycleCommands.ts`のrename／delete連鎖、create／update／importの`useEventUpdateCommands.ts`とpatch caller、whole-event duplicateを別writer IDで列挙し、現行import `create-alias`をwhole-event duplicateへ誤分類しない。manifest row欠落、余分、旧signature callerをarchitecture testで拒否する
- 全writer種別から共通plannerへのmappingと全reachable after-image branchはtable-driven unit testで網羅する。物理store pathが同じwriterは代表commandのintegrationを共有し、異なるtransaction／bridge／recovery pathは各1件以上のintegrationを残す。writer名×同一障害点の無差別直積は作らない
- rename／deleteの実authorityである`useEventLifecycleCommands.ts`をwriter inventoryへ含め、`PersistenceCommandPort`、indexed DB adapter／facade、application snapshot operationまで同じplanner receiptを伝播する。ready profileではcore、association、control membership、event settings、durable visit、metadata／checkpoint／fence、V2 after-image healthを同じparticipant manifestへ含め、旧signatureからの直接writeをarchitecture testで0件にする
- I3のV2 after-image participant integrationはI2のcontract fakeでeligible／blocked／unavailableを注入し、production／通常QA runtimeのeligibility adapter未登録を維持する。I4の実Worker接続前にeventをeffective ONへするtest overrideやpublic edgeを追加しない

**EXIT-FSMC-I3-001** — rename、delete＋retained、whole-event duplicate、失敗時write 0が成功し、別eventへ設定を誤接続しない。`useEventLifecycleCommands.ts`を含む全lifecycle writerがparticipant manifestへ列挙され、V2-unhealthy after-image、durable participant欠落、旧direct writeを拒否する。

### FSMC-I4: Backup V2／V1互換

- `V2SnapshotHealthDecisionV1.kind = "healthy"`のsnapshotからV2を必ず生成し、companion V1不能だけではV2を停止しない。OFF／legacyのunhealthy snapshotは同じissue digestを持つ`v2-unrepresentable`と修復導線を返し、effective ON eventで同分岐へ到達した場合はinvariant breachとして安全fallbackにする
- byte上限、timeout、spool、cancelは注入可能なlimit／fake clock／fake sinkで小さく再現する
- 実32～64 MiB fileや300秒待機はrequired testにしない
- Backup Workerを同一origin module assetとしてVite graphとPWA precacheへ登録し、CSP `worker-src 'self'`で起動できること、offline precacheからreaderを開始できること、cancel／timeoutでWorker・reader・timer・Blob URL 0件になることをWorker testとprebuilt browser smokeで確認する。`blob:`／`data:`／remote Workerは拒否する
- artifact verifierはhashed Worker asset URLがVite manifestと`dist/sw.js`のprecache manifestにexact 1件存在すること、online load後にcontextをofflineへして同assetからWorkerを起動できることを検証する。I4変更時の`test:fsmc:quick`は`npm run verify:csp-policy`と対象PWA／Worker artifact verifierも1回実行する

**EXIT-FSMC-I4-001** — `test:worker`、small healthy V2 round-trip、代表V1 pair、companion不能でも成功するV2-only、V1／XLSX 2.2 full restoreのsmall fixture各1件、unknown extension／unsafe URL／strict scalar／byte境界のV2-ineligible negative、invalid UTF-8、restore原子性、cleanupが10分以内に成功する。QA buildでWorker URLがmanifest／PWA precacheに存在し、CSP下・offlineで起動し、cancel後resource 0件である。

### FSMC-I5: split設定UIとcopy

- 単一編集、追加・変更のみcopy、明示的完全同期、preview、retained除外を実装する
- browserはDesktop direct、Mobile picker、copy preview、保存reloadの4 journeyをbaselineにし、copy／保存／staleのbrowser固有risk組合せは10分枠内のparameter caseとして残す
- I2 recovery eligibilityを利用するguided profile reset UIを実装し、known store／localStorage coverage closure、選択Backup hash、全tab／Worker／DB connection close、resume journal、二段階確認、復元結果を表示する。unknown store／key、被覆不足、blocked connection、staleではdelete 0件とし、profile reset完了後の`forcedPickerOverride`はfactory default falseに戻す
- ON blocker UIはunknown extension、unsafe URL、strict scalar、owner／ref、count／byte limitをnon-clickable source pathとissue digestで表示し、remain OFF、trusted V1退避、owner別repair、eligible再preflightの選択肢を示す。自動drop／clearを選ばない

**EXIT-FSMC-I5-001** — a/bを別々に保存でき、copy先identityを維持し、Desktop directと別Mobile touch contextのpickerが成功し、取消／stale／保存失敗時にwrite 0となる。guided profile resetはcoverage-complete＋unblockedだけ完了し、unknown target／被覆不足／blocked／取消はdelete 0件、resume後restoreとcontrol defaultを確認する。V2 blockerはunsafe URLをclickableにせずremain OFF／退避／修復へ到達できる。

### FSMC-I6: 地図再取込と通常編集

- 一意継承だけactiveを維持し、欠落／曖昧はdormant／quarantinedへ移す
- 正常、一意移動、曖昧、duplicate physical cellの4代表をintegrationで確認する
- `fsmc.repair.map-identity.v1`を`NormalizationCollisionRepairPort`の唯一のmap修復入口として実装し、preview済みblock ownership／番号cell／merge、association、settings、durable visit、route cache、V2 after-image healthを同一commitへ含める。通常edit／reimportもhealthyを壊すafter-imageをfirst write前に拒否し、取消／stale／quotaでは全rootを旧状態に保つ

**EXIT-FSMC-I6-001** — 無関係な変更で設定を失わず、危険なmapだけを安全停止し、影響外mapの利用を継続できる。map identity repairはallowlisted commandだけ成功し、修復後V2 preflightがhealthyになったeventだけeffective ONへ復帰し、取消／stale／unhealthy after-imageはwrite 0となる。

### FSMC-I7: visit projectionとreorder

- `ExecutionVisitIdentity`のglobal集約、phase projection、headless reorder、atomic commitを実装する
- raw item順shuffle、既存visitへの挿入、stale callbackをunit／integrationで確認する
- `fsmc.repair.item-numbers.v1`と`fsmc.repair.orphan-visit-state.v1`を同じ`NormalizationCollisionRepairPort`へ接続し、前者はitem番号と全導出identity／order／progress、後者はcurrent item参照0件を再検証した選択済みorphan stateだけを変更する。repair after-imageもdurable rootとV2 healthを同一commitで検証する

**EXIT-FSMC-I7-001** — 通常／postponed／lateが同じprojectionを使い、item-number／orphan-visit repairがallowlist、参照0件、V2 healthyを満たす場合だけ原子的に成功し、取消／stale／quota／不適格時にdurable orderと全rootを変更しない。

### FSMC-I8: 通常map

- 共通位置indexで描画、hit-test、popup、DOM代替、訪問一覧を接続する
- Chromium Desktop 1件、Mobile picker 1件、keyboard／focus 1件、axe 1件を代表smokeにする
- `useCanvasViewport.ts`と`MapCanvasPresentation.tsx`／`MapCanvas.tsx`をI1のPointer reducerへ移し、通常Canvasのnative TouchEvent／React touch handler／component-local pointer mapを0件にする。Mobile smokeはtrue-touch contextと`pointerType = "touch"`でtap、drag、multi-pointer、cancelを確認する
- 200% page zoomと`forced-colors: active`を名前付きrequired a11y caseにし、a/b label、分割境界、selected／visited stateが色だけに依存せず、DOM代替のrole／name／description／focus順とCanvas hit-testが一致することを確認する

**EXIT-FSMC-I8-001** — a/b片側更新、true-touch Mobile picker、Pointer cancel／multi-pointer、DOM代替、role／name／focus、200% zoom、forced-colors、OFF fallbackが代表smokeで成功する。architecture testで通常Canvasの並行TouchEvent authority 0件を確認する。

### FSMC-I9: 集中mode

- I8と同じ位置解決、picker、announcement、訪問projectionを集中modeへ接続する
- I8と同じbinary／fixture／assertionをそのまま再実行するだけのjourneyは共有するが、集中mode固有surfaceからa/b identity、picker、announcement、追加を独立確認するtestは重複に見えても残す。固有baselineは2件とし、回帰riskがあれば対象caseを追加する
- `FocusModeMapCanvas.tsx`を同じPointer reducer／gesture snapshotへ移し、Focus固有split pane、rotation、unmount／lost captureを確認する。I9完了時点で通常／集中のnative TouchEvent、React touch handler、component-local pointer authorityをrepository全体で0件にする

**EXIT-FSMC-I9-001** — 集中modeでa/bを混同せず、true-touch picker、空側追加、既存visit集約、rotation中cancelが成功し、architecture testで全Canvasの並行TouchEvent authority 0件を確認する。

### FSMC-I10: routeとvisit集約

- 3×3 subcell route、polygon constraint、connector、cache signatureを実装する
- correctnessは小fixture、性能は100 visitまでの代表fixtureで確認する
- 400 visit最大routeは必要時の手動1回とし、毎PR／Desktop／Mobile二重測定を行わない
- performance smokeはtimeoutだけを合格条件にせず、章10.5の同一invocation base/candidate比較とabsolute median／max sentinelを全6 scenarioで満たすことを要求する

**EXIT-FSMC-I10-001** — a/b anchor、same-cell、障害物、unroutable、cache invalidationが成功し、代表performance smoke全体が5分以内に終わるだけでなく、6 scenarioすべてでrelative limitとabsolute median／max sentinelを満たす。

### FSMC-I11: release-readyとlocal rollback

- `fsmc.migrate.durable-visits.v1`でlegacy focus registryをfreeze／captureし、全resolved scope、default／loss確認、event basis、settings／control／metadata／checkpoint／fenceを1 commitで`ready`へ移す。取消、stale、scope collision、token replay、quotaでは`migrating`を維持してwrite 0件とし、ready後に全lifecycle／item／import／restore writerがdurable root participantであることをarchitecture testする
- production buildで`Vcap` migrationとsplit公開edgeを初めて有効にする
- representative A→B migration、durable visit migration、`onblocked` upgrade、unsupported version安全拒否、V2-ineligible eventがeffective ONにならないこと、Backup round-trip、OFF fallbackをrelease quickへ含める
- `npm run build:containment`等のfeature-disabled buildをlocalで作り、既移行profileを開いてsplit mutationが公開されないことを1 smokeで確認する
- GHCR、AWS registry、anonymous pull、protected approval、168時間観測を要求しない

**EXIT-FSMC-I11-001** — durable visit freeze／全scope migrationとready witness、`onblocked`中all-old、unblock後all-new、`test:fsmc:release:quick`、production build、V2-ineligible ON拒否、feature-disabled rollback smokeが合計20分以内に成功し、利用者向けBackup／停止／復旧手順が更新される。rollbackはDB downgradeを行わず、durable rootを保持する。

## 10. テスト計画

5～8章の「全分岐を確認する」は、pure decision tableまたは高速unit／integrationで到達可能な論理分岐の全組合せを確認する意味とする。全組合せや重複testを一律削除せず、安全decisionは網羅し、重要不変条件は異なるtest層で重ねる。browser、実file、性能測定ではriskに対応する組合せだけを選び、根拠なく全軸を直積実行しない。競合する表現が残る場合は、本章のrisk-based選択、網羅性、timeboxを同時に満たすよう本文を直す。

### 10.1 必須test層と時間上限

| 層                         | 実行時期                      | 内容                                              | 目標／上限 |
| -------------------------- | ----------------------------- | ------------------------------------------------- | ---------- |
| changed-area unit          | 各PR                          | pure logic、schema、全reachable decision row      | 3分／5分   |
| representative integration | 保存・DB・Backup・route変更PR | all-old／all-new、stale write 0、small round-trip | 5分／10分  |
| Worker project             | I0、Backup Worker変更PR、I4   | protocol、UTF-8 fatal、limit、cancel／cleanup     | 3分／5分   |
| policy verifier            | I0、inventory／policy変更PR   | membership、architecture、coverage config／test   | 2分／5分   |
| browser smoke              | UI変更PR、I11                 | Chromium基本8件＋engine／状態risk対象case         | 5分／10分  |
| performance smoke          | 性能影響PR、I10、I11          | 6 scenario、warm-up 1＋計測3                      | 3分／5分   |
| release quick              | I11だけ                       | 上記の代表集合＋build／rollback smoke             | 15分／20分 |

上限を超えたcommandは待ち続けず失敗として停止する。必要なcoverageを削らず、pure logicへの移動、table-driven化、fixture共有、対象commandの責務分離で短縮し、上限自体を多時間へ広げない。

### 10.2 代表fixture

必須fixtureは次の6 familyへまとめる。

1. A-26を左a／右bにし、26a未処理、26a2処理済み、26b処理済み、26 whole、26c／26d unsupportedを持つ基本fixture
2. `01a`／`1a`／`０１ａ`の衝突なしと衝突あり、ON中編集で新規衝突を作るatomic拒否fixture
3. 横長結合、縦長結合、代表回転、障害物、duplicate physical cellを持つgeometry fixture
4. DBなし、現行、pre-`Vcap`、`Vcap`、unsupported、partial-lossを持つpersistence fixture
5. small V2、lossless V1 pair、V1／XLSX 2.2 full restoreのsmall input、V2-only、invalid UTF-8、unsafe URL、cancelを持つBackup fixture
6. normal／postponed／late、mapped／mapless、same-cell／unroutableを持つvisit／route fixture

日常fixtureは300セル、20 block、50分割、100 item、100 visit以下にする。最大fixtureは同じseedからgeneratorで作れることとcount／hashをrequired baselineにし、通常browserでは展開しない。scale固有のbrowser riskがある変更だけ、対象caseを10分枠内または明記したlocal手動確認で実測する。

### 10.3 ケース選択規則

- 有限な安全decision tableと到達可能なFSM transitionは高速unit／integrationで全組合せを確認する。browserはequivalence class、境界代表、pairwiseから始め、回転×DPR×端末×入力×状態のうちbrowser固有riskがある軸の組合せだけを追加する
- product上限の直前／一致／+1はlimit値を注入した小fixtureで確認し、MiB実dataや300秒実待機を行わない
- failure injectionは共通transaction／sink／plannerのunit testへ置き、各UI journeyで全中断点を繰り返さない
- property testは固定seed、最大100 case、1 test 2秒以内を既定とする
- browser journeyは1 journeyで保存、reload、表示、片側更新まで確認し、細かいassertごとにpageを作り直さない
- snapshot画像はpixel regressionが必要な分割線／label代表2枚をbaselineとし、描画固有riskの名前付きsnapshotは10分枠内で追加する。根拠のない回転／DPR大量goldenは作らない

### 10.4 Chromium／a11y smoke

必須browserのbaselineはローカルChromium 1 installを共有するが、viewport変更だけで端末能力を表現せず、少なくとも次の独立BrowserContextを固定する。Desktop mouseは1280×720、DPR 1、`isMobile = false`、`hasTouch = false`、Desktop touchは1280×720、DPR 2、`isMobile = false`、`hasTouch = true`、Mobile touchは390×844、DPR 3、`isMobile = true`、`hasTouch = true`とする。touch journeyは`page.touchscreen.tap()`または同等のtrusted touch inputを使い、app側test traceで受信`PointerEvent.pointerType === "touch"`をassertする。Mobile pickerをviewport幅だけで成功扱いにせず、Desktop touchが自動的にMobile pickerへ誤分類されないこともselection resolverの代表caseにする。次の8 journeyを基本集合とし、browser固有の安全riskが見つかった場合は既存journeyのparameter化または10分上限内の対象smokeとして組合せcaseを追加できる。件数目安だけを理由に必要なcaseを削らない。

1. Desktopでa/bを別々に開き、aだけ更新する
2. Mobile pickerで空間順ラベルからbを選ぶ
3. 保存→reload→端末OFF／ONで設定とlegacy表示を維持する
4. copyまたはreimport正常1件と、同じfixtureを使う2 tab CAS／stale時write 0
5. Backup V2 small round-tripと代表V1 pair
6. supported migration成功とunsupported version安全拒否
7. recovery正常resetと不適格時write 0を、同じsetupを再利用する代表2件で確認する
8. route正常とunroutable、DOM代替のkeyboard／focus／axe critical・serious 0

I8の200% zoomはDPR変更で代用せず、page-scale harnessがeffective scale 2.0をassertしてからCanvas label／境界、picker、DOM代替、focusを確認する。forced colorsは`page.emulateMedia({ forcedColors: "active" })`相当で有効化し、色以外のlabel／境界／state表現をassertする。portrait／landscapeは該当risk journeyだけ別contextにし、全journeyとの直積にしない。

通常変更ではChromium以外を無条件に全journeyへ掛けない。一方、support対象engineの既知不具合、標準API差、変更箇所に固有のriskがある場合は、engine、unique case ID、risk固有test tag、risk、owner phase、削除条件を`config/fsmc-browser-risk-regressions.json`へ同じPRで登録し、無課金でlocal実行できるFirefox／WebKitの該当caseだけをrequired gateへ昇格する。全required caseのtitleは共通`@fsmc-smoke`とregistryのrisk固有tagを両方持つ。`run-browser-smoke.mjs`は実行前のPlaywright list結果についてactive registry entryと`(engine, case ID, risk tag)`がexact bijectionであること、実行後のmachine-readable resultについて各entryがexact 1回passedであることを検証し、grep除外、重複、未install、skip、結果欠落、unexpected projectを失敗させる。entry 0件なら追加engineをinstallしない。名前付きcase成功は当該riskだけの確認でありengine全体の正式保証ではない。全engine matrixではなくriskとcaseを1対1で記録し、同じ10分枠へ収める。iPhone実機、BrowserStack、有料実機farmは要求しない。

### 10.5 短時間performance smoke

測定対象はstartup、single split save、map first render、map interaction、100 visit route、small Backupの6件をbaselineとする。`config/fsmc-performance-sentinels.json`はscenarioごとにfixture／action digest、feature-disabledまたはwhole-cellのcontrol case、absolute median／max ceiling、`candidateMedian / controlMedian` ceiling、jitter allowanceを必須にし、欠落、0、非finite、未知scenario、candidate測定後の閾値緩和をverifierで拒否する。runnerは同一machine／browser install／process orchestratorでcontrolとcandidateを各warm-up 1回後に交互に3回だけ測定し、中央値と最大値、environment digestをconsoleへ出す。candidateは(1) `candidateMedian <= max(controlMedian * 1.25, controlMedian + jitterAllowance)`、(2) absolute median以下、(3) candidate maxがabsolute max以下、の3条件をすべて満たす。45秒／5分はhang停止用であり、時間内終了だけを性能成功にしない。

初期sentinelは次を上限とし、I0でschema／missing拒否、各scenario owner PRの変更前にcontrol測定とcalibration recordをcommitする。閾値は同じcandidate結果を見て緩めず、環境差で成立しない場合はfixture／timer boundaryを先に直す。

| scenario          | absolute median | absolute max | ratio | jitter allowance |
| ----------------- | --------------- | ------------ | ----- | ---------------- |
| startup           | 8,000 ms        | 12,000 ms    | 1.25  | 150 ms           |
| single split save | 1,000 ms        | 2,000 ms     | 1.25  | 30 ms            |
| map first render  | 3,000 ms        | 5,000 ms     | 1.25  | 75 ms            |
| map interaction   | 300 ms          | 600 ms       | 1.25  | 15 ms            |
| 100 visit route   | 4,000 ms        | 7,000 ms     | 1.25  | 75 ms            |
| small Backup      | 6,000 ms        | 10,000 ms    | 1.25  | 150 ms           |

性能riskのある変更は対象parameterまたは比較oracleを5分枠へ追加し、6件という数だけを理由に回帰caseを削らない。精密な機種間比較や正式SLAではなく、同じ開発環境で明らかな退行を検出するためのsentinelである。

- 各scenario 45秒、全体5分でtimeoutする
- timeout前でもrelative／absolute sentinelのいずれか1件を超えたら失敗し、warningだけで成功にしない
- memory PSS polling、100ms sampling、30秒cleanup待機、browser processの毎回再起動を行わない
- 最大fixture、400 visit、32 MiB Backupは性能関連変更または公開候補で必要な場合だけlocal手動1回とする
- 手動最大測定をしていない場合、最大規模の応答時間を対外保証しない
- timing揺れだけで失敗した場合は環境負荷を確認し、同じcommandを人手で1回だけ再実行できる

### 10.6 5分manual check

I11のmanual checkは章12の公開手順と同じ1回だけ実施し、その記録を再利用する。通常map、集中mode、Mobile picker、Backup作成、端末OFF、rollback-disabled build起動を合計5分で確認し、同じcandidateで二度繰り返さない。実イベント3件、複数端末、168時間観測は不要である。

## 11. 自動test gate

### 必須local gate

I0～I10の通常PRは変更面に応じて次を実行する。`test:fsmc:quick`がmanifest列挙したFSMC対象fileのPrettier／ESLintとunit／integrationをまとめるため、repository全体のformat／lintはpre-I0以外で反復しない。

```powershell
npm run test:encoding
npm run typecheck
npm run test:fsmc:quick
# UIを変更した場合だけ
npm run test:fsmc:browser:smoke
# 性能へ影響する場合だけ
npm run test:fsmc:performance:smoke
```

I11は上記commandを個別に足して同一suiteを二重実行せず、production build、browser／performance、feature-disabled build／smokeを束ねた次のaggregateへ置き換える。aggregate内では重要不変条件をunit／integrationとrelease artifactの異なる層から再確認する。

```powershell
npm run test:fsmc:release:quick
```

既存`npm run quality`はrepository全体release手続で別途必要な場合に1回実行できるが、FSMCの各phaseで繰り返す必須条件にはしない。

### optional GitHub Actions

GitHub Actionsを使う場合は、public repositoryの標準runnerが無課金で使えることをrepository ownerが通常画面で確認できる場合だけ、次の小さな構成にする。

- 単一jobを基本とし、必要でも並列2以下、CI jobを増殖させる軸直積matrixなし、通常PRは`timeout-minutes: 20`、I11は`npm ci`を含め25分で停止する。単一job内のtable-driven全組合せやrisk-based parameter testは維持する
- checkout、Node setup、`npm ci`、章15のquick commandを同一jobで順に実行する
- `upload-artifact`、`download-artifact`、GHCR、container、environment approval、AWS OIDCを使わない
- screenshot、trace、video、coverage HTML、build directoryをuploadせず、console summaryだけを残す
- repositoryがprivateになった、free quotaが不明、billingを要求された、またはrunnerを利用できない場合はworkflowを起動せずlocal gateで代替する

### 任意確認

一般的な全journey WebKit smoke、最大fixture、実32～64 MiB Backup、400 visit route、詳細profileは問題再現または性能関連releaseで必要な場合だけ手動実行する。これらの未実施は通常PRをblockしない。ただし章10.4でriskと結び付けたFirefox／WebKitの名前付きregressionは任意確認へ降格せずrequiredとして扱う。

## 12. ローカル公開と有効化

初版公開は外部feature flagやremote serviceを使わず、端末全体OFF、event別OFF、automatic safe modeを維持する。

1. production buildを1回だけ内包する`test:fsmc:release:quick`をlocalで成功させる
2. Backup V2を作り、PowerShell `Get-FileHash -Algorithm SHA256`でhashを記録する
3. 新規または代表event 1件でlocal ONにし、a/b、保存、reload、routeを5分以内で確認する
4. 問題がなければ利用者自身が対象eventを明示ONにする

配布する場合は既存の配布経路を使うが、その利用や有料tierはFSMCのExit／DoDに含めない。FSMC専用GHCR package、S3 upload、immutable registryを追加しない。rollback-disabled buildは公開前のlocal確認用であり、package registryへのpublicationを必須にしない。

## 13. 公開停止条件

次のいずれかを検出した場合は対象端末またはeventをOFFにし、split固有mutationを停止する。

- a/bの誤関連付け、反対側への状態波及
- 保存、migration、restoreの部分commitまたはdata loss
- stale／2 tab競合で後行writeが行われる
- Backup V2を作れない、またはrestore検証に失敗する
- unsupported DB／破損rootで安全modeへ入らない
- keyboard／Mobile pickerの主要導線が操作不能
- required local gateまたはrelease quickが失敗する

### 13.1 停止手順

1. 端末全体または対象eventをOFFにする
2. 作成可能ならBackup V2をlocalに保存しSHA-256を記録する
3. candidate SHA、発生時刻、再現手順、期待／実結果、個人情報を除いたerror codeを小さなMarkdownまたはJSONへ記録する
4. 原因を再現する最小unit／integration testを追加する
5. 必要ならfeature-disabled rollback buildを使い、DB versionを下げずにlegacy表示とBackup導線を維持する

証跡の保存先はrepository issue／commitまたは利用者が選ぶlocal directoryとする。AWS S3、KMS、CloudTrail、Object Lock、365～400日保持、別key receiptを要求しない。保存期間は通常30日を目安とし、未解決issueに必要なtextだけrepositoryに残す。credential、個人情報、実データ本体をissueへ添付しない。

### 13.2 再開条件

- 原因の最小reproduction testが修正前に失敗し、修正後に成功する
- `test:fsmc:quick`と影響面のintegration／browser smokeが成功する
- data影響がある場合はsmall Backup round-tripとrollback-disabled smokeが成功する
- 同じ不具合を再現しないことを5分manual checkで確認する

全phase、全browser、最大fixture、全failure injection、長時間performanceを無条件に再実行する必要はない。ただし、修正対象の失敗組合せと隣接境界はunit／integrationで再実行し、a/b identity、原子性、stale write 0、OFF／safe mode、Backup／rollbackに影響する修正は対応するrelease smokeでも重ねて確認する。

## 14. Definition of Done

- **DOD-FSMC-001** — whole／a／b／unsupported identityが共通位置indexで一貫し、a/bを混同しない
- **DOD-FSMC-002** — 保存、event lifecycle、durable visit migration、restore、copy、reimport、normalization repairが全participantでall-old／all-newとなり、`onblocked`／stale／cancel／quota時write 0となる
- **DOD-FSMC-003** — OFF／safe modeでlegacy動作へ戻り、保存済みsplit設定を壊さない
- **DOD-FSMC-004** — effective ON前／ON中のV2 health preflight、healthy V2 small round-trip、lossless時の代表V1 pair、V2-only、V1／XLSX 2.2 full restoreのsmall fixture各1件が成功する。unknown extension／unsafe URL／strict scalar／limitはwrite 0でONを拒否し、Workerがsame-origin CSP／PWA precache／offline起動／cancel cleanupを満たす
- **DOD-FSMC-005** — 通常map、集中mode、route、Desktop mouse／Desktop touch／Mobile true-touch picker、DOM代替が代表fixtureで動作し、全Canvasの旧TouchEvent並行authorityが0件である
- **DOD-FSMC-006** — keyboard、role、name、focus、status／alert、200% page zoom、forced-colors、axe critical・serious 0を代表画面で確認する
- **DOD-FSMC-007** — changed-area unit／integration／Workerで到達可能な安全decisionの全組合せが成功し、membership／architecture／coverage policyも成功する。a/b identity、原子性、stale write 0、OFF／safe mode、Backup／rollbackを必要な異種test層で重ねて確認したうえで、Chromium baseline、registry上requiredなengine固有regression、6 scenarioのrelative／absolute performance sentinelが章10のtimebox内で成功する
- **DOD-FSMC-008** — 最大値は設計上限として記載し、未測定の最大規模応答時間を保証しない
- **DOD-FSMC-009** — durable visit migration ready、production `Vcap` buildとfeature-disabled rollback buildをlocalで起動確認でき、rollbackはDB downgradeせずsplit mutationを停止してBackup／復旧導線を残す
- **DOD-FSMC-010** — FSMCのためにAWS、S3、KMS、CloudTrail、Budgets、GHCR、Protected Environments、Actions Artifacts、有料browser／device serviceを新規契約・作成・live qualificationした件数が0件であり、既存外部基盤の有料tierを新たに要求しない
- **DOD-FSMC-011** — verification recordにcandidate SHA、command、exit code、durationがあり、外部証跡hash連鎖や複数role approvalを要求しない
- **DOD-FSMC-012** — 利用者向けにBackup、local ON／OFF、V2 blocker別修復、guided profile reset、停止、復旧、保証対象外を説明する
- **DOD-FSMC-013** — UTF-8（BOMなし）と既存LFを維持し、U+FFFD、意図しない`?`増加、改行だけの大量差分がない
- **DOD-FSMC-014** — 完全版XLSX 2.3、multipart、設定単独portable JSON等の後続版予約を初版phase、test、Exitへ混入させない

## 15. 標準検証command

I0で次のFSMC専用scriptを`package.json`へ追加する。各scriptは対象test 0件を成功扱いにしない。

```json
{
  "scripts": {
    "build:qa:fsmc": "node scripts/build-release-vite.mjs --qa-profile fsmc && node scripts/verify-release-a-build.mjs --allow-nonpromotable-qa",
    "test:fsmc:quick": "node scripts/fsmc/run-quick.mjs --timeout-ms 600000",
    "test:fsmc:browser:smoke": "npm run build:qa:fsmc && node scripts/fsmc/run-browser-smoke.mjs --grep-tag @fsmc-smoke --workers 1 --retries 0",
    "test:fsmc:performance:smoke": "node scripts/fsmc/run-performance-smoke.mjs --samples 3 --timeout-ms 300000",
    "test:fsmc:release:quick": "node scripts/fsmc/run-release-quick.mjs --timeout-ms 1200000"
  }
}
```

I0でFSMC manifestへ対象style、unit、integration、`.worker.test.ts`を明示し、第四の重複Vitest projectを作らず既存unit／integration／Worker projectへ各testをexact 1回所属させる。`run-quick.mjs`は対象fileのPrettier／ESLint、`verify:test-project-membership`、`verify:architecture`、`verify:coverage-policy`、`test:coverage-policy`、対象unit→integration→Workerをこの順で各1回実行し、Vitest poolを相互に並列起動しない。各required laneの対象0件を失敗させ、`--passWithNoTests`を付けない。現行`test:worker`の`--passWithNoTests`とWorker projectのempty許可もI0-Cで廃止する。

`build:qa:fsmc`はI2～I10のproduction public edgeを変えず、FSMC導線だけをlocal test harnessへ公開するnon-promotable QA buildとする。I0-Aは`build-release-vite.mjs`、`verify-release-a-build.mjs`、`vite.config.ts`、`release-build-input.mjs`／`.d.mts`、`build-pwa-recovery-agent.mjs`の全allowlistと`release-policy.test.mjs`／`build-pwa-recovery-agent.test.mjs`を同時更新し、未知profile拒否を弱めない。artifactから`qa-fsmc`、standard role、non-promotable、production public edge 0件を再検証する。

`playwright.fsmc.config.ts`は既定で単一Chromium install、Desktop mouse／Desktop touch／Mobile touchの独立context、`workers = 1`、`retries = 0`、local outputだけを固定する。touch testはtrusted inputと受信`pointerType`をassertする。`run-browser-smoke.mjs`は共通`@fsmc-smoke`を外さず、章10.4のactive registry entryが存在する場合だけrisk固有tagと該当Firefox／WebKit projectを追加してlist／resultのbijectionを検証し、required caseをgrep外へ置けないようにする。既定の全journey matrixへ追加engineを含めない。通常のbrowser smokeはQA buildを1回作ってVite previewへ渡す。`run-release-quick.mjs`だけはencoding、typecheck、quick test、release-ready production build 1回、prebuilt browser smoke、performance smoke、feature-disabled build／smokeを20分deadline内で各1回実行し、別commandの結果を足し直さない。I0は両runnerのregistry closure、構文、command順、timeout伝播、子process失敗伝播をunit testし、production buildを含むaggregate実行はI11まで行わない。

### pre-I0

```powershell
$fsmcWorktreeStatus = git status --porcelain=v1 --untracked-files=all
if ($LASTEXITCODE -ne 0 -or $fsmcWorktreeStatus) { throw "pre-I0 requires a clean worktree" }
git diff --check
npm run test:encoding
npm run format:check
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:worker
```

unit→integration→Workerは上記順で直列実行し、同時にVitest poolを起動しない。合計20分を超えたら停止し、遅いsuite名と経過時間を記録したうえで、分離後のclean candidateに対して全列を最初から再実行する。外部observerやcredential確認は行わない。既知failureのwaiverや将来追加するFSMC testによる代替合格は認めない。

### 通常PR

```powershell
npm run test:encoding
npm run typecheck
npm run test:fsmc:quick
```

UI変更時だけ:

```powershell
npm run test:fsmc:browser:smoke
```

性能影響時だけ:

```powershell
npm run test:fsmc:performance:smoke
```

### I11 release候補

```powershell
npm run test:fsmc:release:quick
```

### verification record

PR本文またはlocal Markdownへ次だけを記録する。raw log、screenshot、trace、build directory、Backup実データはuploadしない。

```text
Candidate SHA: <full SHA>
Phase: <FSMC-I0 ... FSMC-I11>
Command: <実行command>
Exit code: <0 / non-zero>
Duration: <mm:ss>
Result: <passed / failed / stopped-by-timebox>
Notes: <失敗箇所または省略理由。credentialや個人情報は書かない>
```

### 無課金確認checklist

- AWS account／S3／KMS／CloudTrail／BudgetsをFSMC用に作成・使用していない
- GitHub Actionsで`upload-artifact`／`download-artifact`、GHCR、paid runner、Protected EnvironmentをFSMC用に使っていない
- public標準runnerの無課金利用が不明な場合はCIを起動せずlocal commandで代替した
- BrowserStack、実機farm、Mapbox／Google Maps等の有料API、有料npm製品を追加していない
- required testはPR 20分、performance 5分、release quick 20分の上限内である
