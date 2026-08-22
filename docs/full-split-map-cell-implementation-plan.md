# Full Split Map Cell Implementation Plan

- 文書状態: 2026-08-22総合レビュー・Q1～Q18製品判断反映済み、実装開始可（FSMC-I0から開始し、FSMC-I1以降はFSMC-I0ゲート通過後）
- 対象機能: 地図番号セルのa/b完全分割
- 対象ソース基準: `2eaba922816e8b263c6479e81ab9f265321654b2`（短縮: `2eaba92`）
- 固定旧版Aのソース基準: `3db4be011d0f4123aa3953b559280c58f33d026a`（互換試験専用。現行実装の基準に使用しない）
- 作成日: 2026-08-12、最終判断反映日: 2026-08-22
- 想定規模: 中～大規模、初版11～15個の論理PRと後続版

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

初版は、原子的保存、通常マップ、集中モード、経路、イベント単位Backup V2、同時出力する旧版用V1互換core backup、旧版fallbackに絞る。完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図への設定コピーは後続版とし、初版のExitやDefinition of Doneへ含めない。

### 1.1 レビュー結論と確定判断

2026-08-12の総合レビューと2026-08-22までのQ1～Q18回答で検出・確定した、基準source、識別子衝突、保存原子性、旧形式復元、経路表現、ローカル停止、性能測定、試験範囲の不整合を本版で是正する。製品判断は次のとおり確定し、未回答の製品事項は残さない。FSMC-I0は契約、fixture、固定旧版A、試験projectを用意する実装フェーズとして着手できるが、機能本体を実装済みと仮定するExitは置かない。機械判定可能なFSMC-I0 Exitが未達の場合はFSMC-I1以降へ進まない。

| 判断ID  | 確定内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PD-01` | 分割設定を含まない旧形式の完全復元では、対象範囲の既存分割設定を削除せず`dormant`へ移し、事前previewで件数・理由・復旧方法を表示する                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `PD-02` | `01a`、`1a`、`０１ａ`は端末内preflightで統合衝突が0件の場合だけ同じ売場へ正規化する。衝突があるeventは分割機能をONにせずlegacy identityを維持し、利用者へ対象と解決方法を表示する。表示用原文は常に維持する                                                                                                                                                                                                                                                                                                                                                        |
| `PD-03` | 配布制御は外部serviceを使わず、端末全体のローカルOFF、イベント別のローカルON／OFF、DB・schema異常時の自動安全モードだけで構成する。既存イベントは初期OFFとする                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PD-04` | 機能OFF／安全モードではsplit固有の表示、位置解決、保存、経路、操作を従来の未分割セル動作へ戻し、保存済み分割設定を通常操作で変更しない。ただし`PD-14`の共有訪問projectionと挿入規則、重複物理`(row, col)`を新規作成するimport・通常編集after-imageの原子的拒否、および既存重複を配列順で選ばず当該mapの経路生成・cache再利用を停止する`map-data-untrusted`安全判定はON／OFFを問わず常時適用し、固定旧版Aとの明示的な許容差分とする。復旧用backupへのread-only収録、authority正常時の内部legacy rebase、`PD-09`の期限到達cleanupは非表示のsidecar保守として許可する |
| `PD-05` | スマートフォンでは表示サイズにかかわらず必ずpickerを経由する。pickerはa/b順ではなく画面上の空間順に並べ、「左側 b」「右側 a」等、位置と文字を併記する                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PD-06` | ブロックコピーは解除しない「追加・変更のみ」を既定とし、「完全同期（解除を含む）」を別の明示操作として提供する。どちらも変更previewを必須とする                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `PD-07` | 完了判定はunit、integration、browser、a11y、性能の自動テストで行い、外部証跡、実イベントpilot、managed device receiptは作らない。特定機種の正式保証は表記せず、自動テスト対象と対象外を明記する                                                                                                                                                                                                                                                                                                                                                                    |
| `PD-08` | 初版は原子的保存、通常・集中表示、経路、イベント単位Backup V2、V1互換core同時出力、旧版fallbackへ限定し、完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図コピーを後続版へ送る                                                                                                                                                                                                                                                                                                                                                                      |
| `PD-09` | イベント削除時は「30日保持」を既定、「今すぐ完全削除」を明示選択とする。保持中は端末内で再関連付けでき、30日後に端末時計が正常な場合だけ対象設定を自動削除する。設定単独ファイル出力は後続版とする                                                                                                                                                                                                                                                                                                                                                                 |
| `PD-10` | 実機receiptや3実イベントpilotを完了条件にせず、fixtureを使うretryなしの自動テストをrelease gateとする                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PD-11` | 分割セルに`whole`または非対応番号がある場合はa/bへ推測割当てせず、「側未設定」badge、一覧、分割有効化前previewで存在を知らせる                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PD-12` | Backup V2の出力時は、分割設定を含まない旧版用V1互換core backupも同時に出力し、用途と失われる情報を表示する                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `PD-13` | 経路connectorは自セルまたは結合セル領域内で安全に接続できる場合だけ描画し、領域外や障害物横断が必要なら`unroutable`とする                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PD-14` | 同じ`ExecutionVisitIdentity`の商品追加は既存訪問へglobal統合し、raw訪問位置を動かさず、必要な`PhaseVisitIdentity`投影だけを追加して全画面へ同じ結果を反映・通知する。利用者が同じ売場を意図的に複数回訪れる機能は初版対象外とする                                                                                                                                                                                                                                                                                                                                  |
| `PD-15` | 1イベントにつき主に編集する端末は1台とし、端末間自動同期・自動mergeを行わない。Backupはpreview後の原子的置換であり、端末全体OFF・イベント別ON／OFFを収録せず、新規復元はOFF、既存イベントへの復元は復元先のローカル状態を維持する                                                                                                                                                                                                                                                                                                                                  |
| `PD-16` | 分割ON中の編集、取込、復元、地図変更が`01a`／`1a`等の正規化衝突を新たに作る場合、その操作全体をstore書込み前に原子的に拒否する。既存data、分割設定、ローカルONは維持し、自動OFFや部分取込を行わず、衝突した原文と修正方法を表示する                                                                                                                                                                                                                                                                                                                                |
| `PD-17` | 3.13および10.5の性能数値は製品要件としてI0で固定する。I0ではprofile、測定法、config、未実装scenarioの適用開始phaseを検証し、実測合格は各機能の実装phaseとI11で要求する。上限緩和は製品判断IDの追加と通常reviewを必須とする                                                                                                                                                                                                                                                                                                                                         |
| `PD-18` | browser／OS／profileによる保存領域の完全消去はアプリが新規installと区別できないためデータ保持保証の対象外とする。部分破損、payload／metadata／checkpoint不整合、store欠落、quota、abortは検出して誤接続・部分commitを防ぎ、安全モードとBackup復旧案内を提供する。完全消去はclean-startと事前Backup案内を試験する                                                                                                                                                                                                                                                   |

FSMC-I0で次を契約・fixture・実行可能な自動検証として固定し、いずれかが未達の場合はFSMC-I1へ進まない。後続phaseで実装する振る舞いはgolden input／expected resultとphase manifestへ登録し、I0で未実装featureを成功扱いにするstub、空test、`--passWithNoTests`は置かない。

- DBなし、DB5～DB8、`Vcap`更新commit直前／直後の終了、運用後に全recordだけを失った空storeのfixture、capability decision table、preflight harnessを用意し、I2で実装する各分岐の期待結果を固定する。I0自身はproduction DB versionやruntime保存経路を変更しない
- full observed root、checkpoint、candidateの物理locationをIDB transaction内／localStorage externalへ分けたroot別観測vector、全governed rootのbaselineを保持するexternal durable fenceを持つ`(storeName, key)`単位のCAS契約、`onupgradeneeded`内の初期root原子作成、partial-loss snapshot、ローカル発行ID、anchor token、active／dormant／quarantined、30日保持と時計異常、制御root、衝突時全拒否のexact schema・ADR・golden fixtureを固定する
- 15,000セル、最大8,192論理ブロック、15,000分割設定、30,000半領域、400アイテム、400売場、400 `ExecutionVisitIdentity`、最大800 `PhaseVisitIdentity`（単一phaseの経路は最大400）の最大fixture、固定CI profile、製品上限、測定法、各scenarioの`enforcedFromPhase`を`config/fsmc-performance-budgets.json`へ固定する。I0ではconfig検証とsynthetic sampleによる統計計算だけを実行し、実性能測定は各担当phaseから行う
- 固定旧版A→候補新版B→固定旧版A→候補新版B、旧形式完全復元、Backup V2＋V1互換core、通常地図編集、地図再取込、複数tab競合、ローカルOFF切替について、fixture・期待値・失敗注入stageを登録する。実装前scenarioは担当phaseのExitで初めて必須実行に昇格する
- Desktop／Mobile Chromiumの必須2 project、両projectへ属するretry 0の安全性／a11y suite tag、WebKit advisory project、同一candidateにhash拘束したWebKit safety observation、traceability verifier、I0専用verification commandを作成し、project／suite membership、observation欠落・未分類と「該当test 0件」を機械的に失敗させる

基準source `2eaba92`には`PD-14`の共有訪問projectionが一部実装済みである。I0でwriter／reader／画面／経路の適合表と現行testを棚卸しし、I7は新規実装だけでなく未適合箇所のconformanceを完了させる。固定旧版Aは完全SHA `3db4be011d0f4123aa3953b559280c58f33d026a`のsource、lockfile、Node/npm version、build command、起動command、生成artifactのSHA-256を`tests/fixtures/fsmc/legacy-a/manifest.json`へ記録し、artifactをCIで再生成せず固定入力として検証する。候補新版Bは各CI runの対象commitから一度だけbuildする。

I0でFSMC専用の一方向導入証跡`FSMC_CAPABILITY_DB_VERSION`（以下`Vcap`）をsourceとdecision tableへ固定し、そのversionを他用途へ再利用しない。I0の固定旧版A試験と「正当な既存DB6／DB7 profileを部分欠損と誤判定しない」証明がDB5→6方式を許可した場合だけ`Vcap = 6`としてI2で`DB_VERSION=6`を採用する。この場合、DBなし、またはDB5でnew storeもsplit対象rootのmetadata／checkpoint／candidate／fence traceもない場合だけ未導入の`core-only`であり、通常core traceはこの判定を変えない。DB6／DB7はversion自体が導入済みのdurable witnessなので、`mapCellSplitSettings`が欠ければsplit痕跡の有無にかかわらず部分欠損の自動安全モードとBackup復旧案内にする。許可しない場合はI2を開始せず、別の衝突しない一方向導入証跡、新store方式、個別退避・再構築を別ADRで決め、同じ欠損判定を全fixtureへ反映するまでproduction DBを変更しない。

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

`PreZeroIdentityKey`は、itemと保存済み訪問・順序・進行状態に存在する独立したlegacy identity bucketを、`["pre-zero-space", 1, eventInstanceId, ownerContext, normalizedNumberTokenPreservingLeadingZeros, sideToken]`で表す。`ownerContext`は`["mapped-owner", mapInstanceId, blockInstanceId]`、`["mapless-owner", normalizedDayKey, ["hall", hallId] | ["hall-unassigned"], normalizedBlockToken]`、`["legacy-owner", normalizedDayKey, ["block", normalizedBlockToken] | ["block-missing"]]`のexact union、`sideToken`は`["whole"]`、`["split-side", "a" | "b"]`、`["unsupported", normalizedSuffix]`、`["unresolved"]`のexact unionとする。同じbucketへの重複参照は1件へ畳み、map／association／settingsはbucket数を増やす入力ではなく`ownerContext`とafter-imageの解決根拠にする。`PostZeroLocationKey`は同じbucketを先頭ゼロ除去後の`SpaceIdentity`へ写したkeyとする。異なる2個の`PreZeroIdentityKey`が同じ`PostZeroLocationKey`へ写るとき、2 keyをUTF-16 code-unit順に並べた`["normalization-collision", 1, postZeroLocationKey, lowerPreKey, higherPreKey]`を1衝突ペアとする。snapshot `S`の全ペア集合を`C(S)`とし、event有効化は`C(after) = ∅`の場合だけ成功する。

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
- 選択したcurrent owner＋番号にretained履歴がある場合、通常の新規設定としてactiveを追加せず「保持履歴の再関連付けが必要」と表示してI5の明示previewへ送る。再関連付け確定は選択したretainedを同一transactionでactiveへ状態遷移させ、active／retained overlapを作らない
- 1つの地図内で論理ブロック名は、NFKC、前後空白除去、大小文字を無視した照合キーで一意とする。手動の同名追加は既存ブロックの置換previewを経由する。XLSX上の完全に同じ名前の複数領域は現行仕様どおり1つの論理ブロック・複数`cellGroups`として同じ`blockInstanceId`へまとめるが、原文が異なるのに照合キーだけが衝突するブロックはcore map import結果を変えず、分割機能では影響する番号を対象外または`quarantined`として理由を表示する
- 同じ論理ブロック内に正規化後の同一番号セルが複数ある場合、その重複番号だけを初版対象外とし、同じ地図内の一意な他番号は利用可能とする
- 重複番号を検出した場合はセル選択画面を設けず、保存・コピー・自動継承から除外して理由を表示し、いずれかを推測で選ばない
- 同じ物理番号領域が複数ブロックに属する、番号領域同士が重なる、または結合セルがブロック境界をまたぐ場合も、影響する領域を保存・コピー・自動継承から除外し、既存entryは`quarantined`へ移す。配列順の先頭ブロックを暗黙に選ばない
- `DayMapData.cells`に同じ`(row, col)`の物理セルが複数ある場合は配列の先頭／末尾を採用せず、機能状態を問わず、その重複を新規作成するimport・通常編集のafter-imageを全store書込み前に原子的に拒否する。起動時から存在する場合は当該mapをFSMC上`map-data-untrusted`とし、split表示だけをlegacy whole-cell fallbackへ戻す一方、当該mapの経路は生成もcache再利用もせず安全停止し、影響entryを`quarantined`へ移す。異なる`value`／`backgroundColor`を持つ重複セルの並べ替えで表示・経路結果が変わる状態を許さない
- ブロック追加、削除、改名、移動、番号セル変更、結合・結合解除を含む通常の地図編集でも、地図再取込と同じ再関連付けplanとpreviewを通し、地図と分割設定を同じ原子的commitで確定する
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
- コピー先の同じcurrent owner＋番号を指すretained履歴が1件でもある場合は、通常の追加・変更・完全同期から`除外（履歴あり・手動再関連付けが必要）`とし、新activeとretainedを重ねない。I5の明示的な再関連付けだけが、選択したretainedを同一transactionでactiveへ状態遷移させ、元retainedを除去できる。複数候補を自動選択せず、copyが履歴を削除することもない
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

- `PD-05`に従い、表示用の`layoutMode`と操作用の`isSmartphoneSelectionMode`を分離する。viewport幅だけ、またはUser-Agent文字列だけでスマートフォンと判定しない。テスト対象Chromiumのmobile情報、主要pointerの入力能力、利用者overrideから単一の判定関数を構成し、PCは狭幅表示でも非スマートフォン規則を使う。利用者overrideはPCをpickerへ倒す安全側強制または判定不能時の補助に限り、`mobile=true`を非スマートフォンへ上書きできない。スマートフォンでは表示サイズにかかわらず必ずa/b選択画面を開き、半セルを直接確定しない
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
- 「後回し」または「遅参」で追加した商品は現行規則に従って該当日のraw実行商品ID配列へ追加する。同じ`ExecutionVisitIdentity`の既存訪問が配列内のどこかにある場合は非連続でもその訪問へglobal統合し、raw訪問位置、現在位置、保存位置を動かさず、normal投影へ統合すると同時に必要な後回し／遅参`PhaseVisitIdentity`だけをbase順で追加する。通常マップ、集中モード、買い物一覧、`MapVisitList`、routeへ同じ結果を反映して「既存のA-26a訪問へ追加しました」と通知する。既存execution identityがない場合だけ実行リスト末尾に新しいbase訪問を作る。共有投影または経路座標signatureが変化した場合だけ経路を再計算する
- 既存商品の日程、ブロック、番号、side、優先度を編集して`ExecutionVisitIdentity`が変わり、変更先identityがすでに存在する場合も、変更先訪問の位置を維持する。変更item IDだけを旧membershipから外して変更先訪問のmember末尾へ再配置し、他の商品IDの相対順を変えない。変更元訪問が空になれば除去し、現在位置、保存位置、後回し・遅参をitem ID対応から新しい`PhaseVisitIdentityKey`へ再解決する。経路anchorは再解決後のphase visit IDを参照し、全画面へ同じ結果を通知する
- 「今回の巡回へ追加」専用操作や自動的な現在位置変更は追加しない

### 3.8 売場、訪問、優先度

空間上の同一性と巡回上の同一性を分ける。

- `SpaceIdentity`は`mapped`、`mapless`、`legacy-unresolved`の判別可能unionとする。`mapped`だけがevent／map／block instance ID、先頭ゼロを除いた基準番号、`SpaceSideIdentity`を持つ。`mapless`はevent、day、hall、block、番号のcanonical tokenを持ち、`legacy-unresolved` identityは候補を選ばないcanonical legacy tokenだけを持つ。原文と解決reasonは`ItemSpaceResolution`の診断payloadに置き、structural identityへ混入させない。3種とも`ExecutionVisitIdentity`を形成できるが、map geometry、marker、route anchorへ入れるのは`mapped`だけとする。`SpaceSideIdentity`は`{ kind: "whole" }`、`{ kind: "split-side", side: "a" | "b" }`、`{ kind: "unsupported", normalizedSuffix: string }`の判別可能unionとし、非対応番号同士を単一の`unsupported`値へ潰さない
- `ExecutionVisitIdentity`は`SpaceIdentity`に優先度区分を加えて構成し、raw実行商品ID配列とbase訪問順を所有する唯一の位置単位とする
- `PhaseVisitIdentity`は進行区分と`ExecutionVisitIdentity`から構成し、通常マップ、集中モード、訪問一覧、経路の投影単位とする。進行状態・表示・経路上は別訪問だが、独立した手動順や挿入位置を所有しない
- raw実行商品ID配列では、同じ`ExecutionVisitIdentity`のアイテムが非連続でも配列全体で1訪問へ統合する。legacy dataからの初回投影では最初に現れる商品位置を訪問位置とし、以後はidentity単位の訪問位置を保持する。raw商品ID配列自体をglobal sortしない
- normal投影は全実行商品から作り、後回し・遅参はnormalとは別の追加投影として作る。同じ商品がnormalと後回し、またはnormalと遅参の複数`PhaseVisitIdentity`へ属し得る
- 進行区分は`"normal" | "postponed" | "late"`、優先度は`"none" | "priority" | "highest"`のexact unionとする。全実行商品はnormalへ属し、同じ商品が追加で属せるのはpostponedまたはlateのどちらか一方だけとする。import／restoreのafter-imageが両方を主張する場合はcommit前に拒否し、既存の矛盾dataはnormalだけを維持して追加phaseを作らず診断表示する。配列順で一方を採用しない
- 同じ側でも優先度が異なるアイテムは、通常の実行列・候補列と同じ規則で別`ExecutionVisitIdentity`・別訪問として表示する
- 異なる優先度を最高優先度へ代表集約しない
- 後回し、遅参など進行区分が異なる場合は別`PhaseVisitIdentity`として扱うが、「別訪問」は「別のbase挿入位置」を意味しない。各phase内の順序はbase execution順から決定的に派生し、基礎となる`ExecutionVisitIdentity`のraw位置を動かさない
- 利用者が指定したraw実行商品順をbase execution順として優先し、phase別の独立した手動順は初版で保存しない
- base executionの手動順がない場合だけ、同じ優先度内でa→bを自然順とし、各phase投影もその順序を使用する
- 同じ`ExecutionVisitIdentity`を意図的に複数の別訪問として作る「再訪」は初版対象外とし、商品追加・編集・復元・経路挿入の全経路で既存訪問へのglobal統合を優先する
- identity変更を伴う商品編集だけは、変更item IDを変更先identityの既存member末尾へ決定的に移す。変更先の最初のmember位置は動かさず、変更item以外のraw順を維持する
- 投影済み訪問のroute、hit-test、挿入位置は代表商品IDやmember配列の先頭ではなく`PhaseVisitIdentityKey`で参照する。memberの商品ID列は訪問payloadとし、identityには含めない
- 同じ`PhaseVisitIdentityKey`にmemberが残る状態で先頭memberを削除・変更した場合は、同じ訪問へ再解決して訪問位置、座標、経路順、挿入anchorを維持する。member列だけが変わりidentity・座標・順序signatureが同じならroute cacheを破棄しない
- preflight衝突0件の場合だけ`01a`と`1a`の表記差を同じ`SpaceIdentity`へ正規化し、表示用番号は各アイテムの原文を維持する。衝突時はイベントをONにしない

既存データで表記差が同一`ExecutionVisitIdentity`へ衝突する場合、商品IDと既存のraw実行列順を正とする。

- migration初回は実行列の商品ID配列を並べ替えず、非連続な同一identityもglobalに集約し、最初に現れる商品位置を統合後訪問の初期位置とする。以後はidentity単位の訪問位置と訪問内の商品順を維持し、先頭memberの変更だけで別訪問の前後へ移動させない
- 正式現在位置と各進行区分の保存位置は、旧訪問の先頭にある有効な商品IDをanchorとして新訪問へ再解決する
- anchor商品がない場合は旧位置以降の最初の生存訪問、次に直前の生存訪問、いずれもなければ先頭へ戻す
- 後回し・遅参の商品ID集合は維持して欠損IDだけを除去し、normalに加える追加phase投影としてbase訪問順から決定的に生成する。visit-key依存集合は商品ごとに新keyへ再配置して衝突時は和集合にする
- 安全に商品IDへ解決できない購入変更位置は破棄する
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
- DOM訪問一覧の各`PhaseVisitIdentity`に「この訪問の後へ挿入」を設ける。ただし、追加対象の`ExecutionVisitIdentity`がraw実行商品ID配列全体に存在しない場合だけ、そのphase訪問に対応するbase訪問の直後へ新規訪問を挿入する。既存execution identityがある場合は、追加対象phaseがまだ存在しなくても指定anchorを無視し、商品を既存base訪問へglobal統合して必要な新phase entryをbase位置へ追加する。「既存訪問へ統合したため、指定位置に新規訪問は作成しませんでした」と通知する。例としてnormalが`A→B`のときに後回しAを「Bの後」へ指定しても、後回しAはnormal Aとは別のphase訪問としてbase A位置へ投影し、Bの後には置かない。成功・取消・競合を通知し、操作元へfocusを戻す

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

既存の「イベント全体を複製」操作は、イベントに属する地図・商品・分割設定を一体として新しい各instance IDへremapするライフサイクル操作であり、初版対象とする。上記の延期対象は、既存の別日程・別地図へ分割設定だけをコピーする専用操作であり、イベント全体複製とは区別する。

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
  persistence/
    validation.ts
  components/
    CellSplitDefinitionPanel.tsx
    CellSidePickerDialog.tsx
```

公開API:

1. `resolveItemMapLocation(item, context)`: `mapped | mapless | legacy-unresolved | ambiguous`の判別可能unionを返す。mappedだけが物理地図位置を持ち、商品番号から`whole`、a/b、または個別の非対応番号identityを解決する
2. `hitTestMapLocation(mapPoint, context)`: pointer位置から、商品が0件の側を含む`none | single | ambiguous`候補を解決する。スマートフォン／直接選択の可否はgeometryではなくinteraction policyが判断する
3. `listMapCellLocations(blockInstanceId, baseNumber, context)`: 設定画面、picker、DOM代替導線用にCanvasを使わず候補を列挙する

各APIは地図と分割設定から一度構築した`MapLocationIndex`を共有する。描画、pointer move、経路計算ごとに全セル・全商品を総当たりしない。商品一覧の取得は`locationKey`索引へ分離し、位置解決自体へ優先度、進行区分、購入状態を混入させない。

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

座標契約を混在させない。`GridCellAddress`は1-based整数の`row`／`col`、geometryの`MapPoint`は列1左端・行1上端を`(0, 0)`とする0-based連続`x`／`y`である。単一セル`(row, col)`のboundsは`[col - 1, col) × [row - 1, row)`、whole中心は`(col - 0.5, row - 0.5)`とする。`startRow..endRow`、`startCol..endCol`の結合領域は`[startCol - 1, endCol) × [startRow - 1, endRow)`へ正規化し、そのboundsをa/bへ二分する。pathfindingは`SUB_CELL_RESOLUTION = 3`の0-based整数`PathNode { subRow, subCol }`を使い、1-basedセル`(row, col)`は`subRow = (row - 1) * 3 .. row * 3 - 1`、`subCol = (col - 1) * 3 .. col * 3 - 1`を所有する。`pathNodeToMapPoint`は`x = (subCol + 0.5) / 3`、`y = (subRow + 0.5) / 3`とし、routing adapter以外で相互変換しない。client座標、アプリ倍率、地図zoom、任意回転、DPRは通常マップと集中モードで共有するviewport adapterが処理し、`projectedSideMinCssPx`と`projectedDistanceToSplitCssPx`を返す。interaction policyだけが端末判定、入力別閾値、曖昧帯を評価し、CSS px閾値やDPRをdomain geometryへ混入させない。

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
      normalizedDayKey: string;
      hallIdentity:
        | { kind: "assigned"; hallId: string }
        | { kind: "unassigned" };
      normalizedBlockToken: string;
      normalizedNumberToken: string;
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
  | "normalization-collision";

type AmbiguousResolutionReason =
  | "multiple-map-slots"
  | "multiple-block-owners"
  | "duplicate-number-regions"
  | "overlapping-number-regions";

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
      candidates: ReadonlyArray<Extract<SpaceIdentity, { kind: "mapped" }>>;
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
  | "normalization-collision";

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

分割なしはentryを保存しない。非対応番号は分割entryにはならないが、`SpaceSideIdentity`のtokenを含む別の空間・訪問identityとして扱う。maplessは既存の`MAPLESS_HALL_KEY`、日程、一意に解決したhall ID（manual指定または既存hall resolver）もしくは未割当て、block、番号のcanonical tokenから構成し、mapped用の架空IDを発行しない。legacy-unresolvedの`SpaceIdentity`は`canonicalLegacyToken`だけをidentity payloadに持ち、原文と`LegacyResolutionReason`／`AmbiguousResolutionReason`は`ItemSpaceResolution`の表示・診断payloadで維持する。reasonや原文の違いで同じ`LocationKey`に複数のstructural identityを作らず、mappedまたはmaplessへ推測変換しない。`canonicalLegacyToken`は`esp-json-v1`で直列化した`["legacy-space-token", 1, eventInstanceId, normalizedDayKey, ["block", normalizedBlockToken] | ["block-missing"], ["number", normalizedNumberTokenPreservingLeadingZeros]]`とする。番号tokenはNFKC、Unicode空白除去、ASCII小文字化後も先頭ゼロを維持し、原文は表示専用でcanonical keyへ直接入れない。別blockの同じ不正番号を統合せず、`ambiguous`でも候補を選ばずこのlegacy identityを共有訪問projectionへ残す。各unionはそれぞれ`["mapped-space", 1, ...]`、`["mapless-space", 1, ...]`、`["legacy-space", 1, canonicalLegacyToken]`のcanonical JSON tupleから`LocationKey`を生成し、`SpaceIdentity`と`LocationKey`を一対一にする。

イベント、地図、ブロック、active entry、retained entry、anchor tokenのローカルopaque IDは、小文字canonical UUIDv4を`crypto.randomUUID()`で発行する。発行transaction内の全namespaceと既存rootを照合し、衝突時は最大3回まで再発行し、3回とも衝突またはAPI利用不能なら操作全体をabortする。バックアップ内の外部IDを採用せず、表示名は診断と手動再関連付けだけに使う。canonical配列順は`a === b ? 0 : a < b ? -1 : 1`というECMAScript UTF-16 code-unit比較に固定し、`localeCompare`、OS locale、大小文字の暗黙変換を使わない。

activeと保持中entryの型を分け、activeだけが現在の`mapInstanceId`／`blockInstanceId`を必須参照できる。retained entryは`number`または`originalNumberToken`の少なくとも一方を必須とし、`blockInstanceId`があれば親`mapInstanceId`も必須とする。最後にactiveだったentryは`evidenceOrigin: "last-active"`とevidenceを必須にし、evidenceを持たずportable fileから初めて保持したentryは`portable-unresolved-reference`かつ`evidenceOrigin: "portable-never-active"`に限定する。portable fileから未解決entryを取り込む場合は、新しいローカル`dormantEntryId`を発行して`retainedEntries`へ置き、外部refをruntime必須ID欄へ代入しない。map全体の現在authorityは`MapSplitBinding.mapStructureFingerprint`だけとし、active entryはblock／location evidenceだけを持つ。保持entryの旧map fingerprintは診断・preview用であり、自動再接続のauthorityにしない。地図の無関係なblock変更ではmap-level fingerprintと該当map bindingを更新する一方、block／location evidenceが一致する他entryはactiveのまま維持する。

`RetainedNumberIdentity`で`number`と`originalNumberToken`を両方持つ場合、I0のexact番号parserでtokenが`split-side | whole | unsupported`のいずれかへ解決し、その`baseNumber`が`number`と一致することをsemantic invariantにする。先頭ゼロやsuffixの原文は一致時だけ保持できる。不一致またはtokenがunresolvedなのに`number`もあるruntime entryは、`evidenceOrigin: "last-active"`なら`invalid-value`としてquarantinedにして再関連付け候補へ使わない。`portable-never-active`にはlast-active evidenceを捏造してquarantinedへ変換せず、root-untrusted安全モードとBackup復旧案内にする。V2入力はどちらもDB更新前にfile全体を拒否する。`originalNumberToken`だけのentryは未解決のまま保持し、数値を推測しない。

端末全体とevent別ON／OFFはsettings payloadから分離し、同じcapability storeのキー`control`に`MapCellSplitControlRoot`として保存する。`enabledEventInstanceIds`は重複なしで上記canonical比較順とし、未掲載eventはOFFとする。event削除時は同じcommitでIDを除去する。Backup V1／V2へ含めない。`SplitImplementationReadiness`はbuild sourceに固定する静的gateであり、永続化、外部service、利用者設定から変更できない。production buildで`release-ready`になるのはI11 Exit後だけとし、QA buildだけが明示的なtest overrideを持てる。production bundleにoverride command、query parameter、storage keyを含めない。

entryの保存・コピー・再関連付け・再取込時に、対象ブロック内の正規化番号が一意であることを検証する。行・列は地図指紋と再取込照合の証拠には含めるが、利用者が選択して保存する識別子にはしない。同一ブロック内の重複番号へentryを新規保存せず、同じ地図内の一意な他番号は処理を継続する。

`active`は現在の地図と安全に結び付いたentry、`dormant`は地図欠落・旧版操作・旧形式完全復元・一致なし等で未接続のentry、`quarantined`は不正値・曖昧一致・物理領域競合・指紋矛盾等のentryを表す。statusはentry単位で保持し、同じ地図内で安全に一致したentryだけをactiveにできる。dormant／quarantinedは地図に描画せず、I5の管理UIで理由、last-known情報、preview付き再関連付け、明示削除を提供する。`PD-09`のイベント削除retentionを除いて時間経過だけで自動削除しない。

active entryでは`bindingEvidenceAtLastActive`のblock／location evidenceが現在の物理番号領域と一致し、`statusReason`は存在しない。dormant／quarantined entryでは最後にactiveだったevidenceを維持し、FSMC-I0 ADRで固定したallowlistの`statusReason`を必須とする。唯一の例外は一度もactiveでない`portable-unresolved-reference`で、`portable-never-active`としてevidenceなしを明示する。地図再取込または通常編集で安全に一意継承できたentryだけ、単一commit内でevidenceを更新する。無関係な別ブロックの変更によるmap fingerprint差だけで全entryを非active化しない。

association registryは、現行のイベントkey、日程内のmap slot、map内のblock slotと各opaque instance IDを結び、再読込後の現在データを解決する。current key／slotは既存データを参照するsidecar内部キーであり、表示名を所有者判定へ使用しない。イベント・地図・ブロックの作成、改名、移動、削除、複製、再取込と同じtransactionでregistryを更新し、参照先不在や多重対応は該当entryをdormant／quarantinedにして自動修復しない。

settings／association配列は上記canonical比較順で保存する。sort keyはevent associationとevent settingsが`[eventInstanceId]`、map associationとmap bindingが`[eventInstanceId, mapInstanceId]`、block associationが`[mapInstanceId, blockInstanceId]`、active entryが`[mapInstanceId, blockInstanceId, number, entryId]`、retained entryが`[dormantEntryId]`、enabled IDが`[eventInstanceId]`とし、tuple要素を左から比較する。event／map／block／active entry／retained entryのprimary ID、同一`eventInstanceId`のsettings、registry内の親子refをschema不変条件とする。primary ID重複、同一event settings複数、親不在、active entryの親不整合、配列重複・非canonical順はroot-untrustedとして当該capability root全体を自動安全モードにし、読込時に並べ替え・片方採用・自動修復しない。一方、root構造とIDは正常だがcore側のanchor、event key、map slot、block slotが0件または複数候補へ解決する場合は、影響するassociation classとそのentryだけをdormant／quarantinedにし、無関係なeventを止めない。control rootの重複enabled IDまたは未知IDもcontrol-untrustedとしてsplit commandを拒否し、core機能は継続する。

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
type VisitPriorityLevel = "none" | "priority" | "highest";
type GridCellAddress = {
  row: number;
  col: number;
  readonly __brand: "GridCellAddress1BasedInteger";
};
type PathNode = {
  subRow: number;
  subCol: number;
  readonly __brand: "PathNode0BasedSubcellInteger";
};
type MapPoint = {
  x: number;
  y: number;
  readonly __brand: "MapPoint0BasedContinuous";
};
interface RoutingPort {
  node: PathNode;
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

interface ProjectedPhaseVisit {
  identity: PhaseVisitIdentity;
  visitId: PhaseVisitIdentityKey;
  location: LocationKey;
  order: number;
  memberItemIds: string[];
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

interface MapVisitListProps {
  visits: ProjectedPhaseVisit[];
  onSelectVisit: (
    visitId: PhaseVisitIdentityKey,
    location: LocationKey,
  ) => void;
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
  mainPath: PathNode[];
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

共有projectionは各`ExecutionVisitIdentity`にnormalを必ず1件作り、postponed／lateは該当memberが1件以上ある場合だけ追加する。1 itemは追加phaseを高々1個しか増やさないため、3.13の400 item／400 execution visit fixtureでは全phase合計最大800、各phase最大400となる。異なるmemberにより同じexecution identityへpostponedとlateの両方が生じることは許すが、1 itemを両方へ二重投影しない。

## 6. 保存と旧版互換

### 6.1 IndexedDBとDB6／DB7事前判定

初期案は`DB_VERSION`を5から6へ上げ、`mapCellSplitSettings` object storeを追加する。ただし、現行契約はDB5を現行、DB7を前方互換上限としており、DB7の実利用profileが存在しないことは証明されていない。DB7ではversion 6の`onupgradeneeded`が走らないため、新storeを無条件の必須storeにすると起動不能になる。

FSMC-I0ではproduction起動経路を変えず、DB capability decision table、fixture、pure preflight harnessを実装する。I2で同じcontractをruntime起動preflightへ接続する。

- DBなし、DB5、DB6／DB7の互換storeあり・欠落・非互換、DB8のfixtureを自動テストする
- 新版の起動preflightは現在の端末内でDB versionとstore capabilityだけを判定し、結果やpayloadを外部収集しない
- capability判定結果は現在sessionの診断表示に使用できるが、外部送信、運用receipt、利用者追跡へ使用しない
- I0はまず`Vcap`の排他性を証明して固定する。I0 verifierがDB5→6の採用条件を機械的に証明した場合は`Vcap = 6`とし、split対象の導入traceが外部precheckとversionchange transaction内再検証の両方で0件の場合に限り、DB5からDB6への`onupgradeneeded`が新store、`data`／`control`の初期payload、全非fence governed rootの候補vectorを含むhistorical evidence、その全行digest、data／control participant digest、全governed rootのexternal baselineを持つinitial fence、3 rootそれぞれのmetadata／checkpointを原子的に作成する。新規DBの0→`Vcap`も同じbootstrap factoryを使う
- DBなし、または`dbVersion < Vcap`で新storeもsplit recovery traceもないprofileは未導入の`core-only`として従来機能を継続する。`Vcap = 6`案ではDB5までがこの分岐である
- `Vcap <= dbVersion`かつschema互換な新storeが存在する場合は、supported上限内でDB versionを変更せず通常経路を使用する
- `Vcap <= dbVersion`なのに新storeが欠落する場合は、DB version自体をdurable introduction witnessとして、split用metadata、checkpoint、fallback candidate、metadata anchorが一切なくても部分欠損の自動安全モードとBackup復旧案内へ進む。未導入profileとみなして空storeを再作成しない。store shape・root schemaが非互換な場合も同じ安全境界にする
- `Vcap = 6`案ではDB6／DB7を上記2分岐、DB8以上を現行前方互換上限外としてデータを変更せず拒否する。DB6案を承認できない場合はI2を停止し、別ADRで新しい一方向導入証跡とsupported上限を決めてからこの表・fixture・復旧手順を一括更新する

新storeの初期契約:

- `keyPath`: なし
- `autoIncrement`: false
- payloadレコードキー: `data`（空のassociation／event配列を持つ`MapCellSplitSettingsRoot`）と`control`（device OFF、enabled event ID 0件の`MapCellSplitControlRoot`）。内部key `FSMC_EXTERNAL_CANDIDATE_FENCE_KEY`にはbootstrap時の候補vector付きtotal historical evidence、その全行digest、data／control participant digest、root別external digestを持つinitial fenceを保存する。3 keyと各metadata／checkpointはstore作成と同じversionchange transactionで必ず初期化し、fenceを利用者payloadやBackupへ含めない
- 既存永続化契約に従うmetadata／checkpoint／recovery candidateは`(storeName, key)`ごとに管理し、payload objectへ埋め込まない
- `mapData`本体へ分割項目を追加しない
- capability判定前に新storeをcoreの無条件必須store一覧へ追加しない
- capability判定を無視してDB7以上へ飛ばさない
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
      key: "data" | "control";
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
      expectedRoots?: never;
    }
  | {
      capability: "map-cell-split-v1";
      dbVersion: number;
      introductionWitness: { kind: "db-version"; observedVersion: number };
      core: CorePersistenceSnapshot;
      split: MapCellSplitSettingsRoot;
      control: MapCellSplitControlRoot;
      expectedRoots: ExpectedRootVector;
    };

type FsmcDatabaseOpenResult =
  | { kind: "snapshot"; snapshot: FsmcPersistenceSnapshot }
  | {
      kind: "unsupported-database-version";
      observedVersion: number;
      supportedMaximumVersion: 7;
      diagnosticMode: "read-only";
      databaseWritesAllowed: false;
      databaseAuthorityAdopted: false;
      backupGuidanceRequired: true;
    };
```

`ObservedRevisionRoot`は現行`persistenceCore.ts`のexact field、すなわち`storeName`、`key`、`revision`、`baseRevision`、`payloadDigest`、`payloadFingerprint`、`writerId`、`committedAt`、optionalな`synthetic`、`missing`、`runtimeFallback`を失わず保持する。`PersistenceCheckpoint`もkind／version、storeName／key、committedRoot、absorbedCandidates、updatedAtを含む構造全体を保持し、固定旧版Aが書かないfieldを`absorbedCandidates`へ追加しない。`FsmcRecoveryCandidateIdentity`は現行`StartupRecoveryCandidateIdentity`の`source`、`role`、optional storeName／sourceKey／targetKey／revision／digest／digestAlgorithm／digestCanonicalization／digestCanonicalLength／migrationConflictをexactに保持し、payloadと`rawValue`本体はdurable CAS vectorへ複製しない。代わりにpre-transaction collectorは物理recordを必ず読み、IndexedDBはI0固定のlossless／injectiveな`fsmc-idb-candidate-record-v1` canonical bytes全体、localStorageは`getItem(storageKey)`が返すraw DOMStringのUTF-16 code unit列全体から、長さとSHA-256を持つauthority対応`physicalContentWitness`をtransaction外で生成し、そのcommand attempt中だけ比較用canonical bytes／raw stringをmemoryへ保持する。localStorageのdigest入力はASCII `fsmc-local-storage-raw-utf16-code-units-v1`＋NUL、big-endian uint64のcode unit数、各code unitのbig-endian uint16をこの順に連結したbytesとし、lone surrogateをU+FFFDへ置換しないlossless／injective形式へ固定する。canonicalizerが未対応値を同じbytesへ畳み込むことを禁止し、対応subset外、証明不能、読込不能、authorityとwitness kind不一致はrecovery-requiredとする。既存identity digestが物理内容全体を拘束するとfixtureで証明できるsourceも必須witness fieldへ同じ検証済み値を投影する。各candidate recordから既存`PersistenceCheckpointAbsorbedCandidate`と共通の6 fieldだけを`CandidateAbsorptionMatchProjectionV1`として導出できない場合はnullにし、吸収済み消滅の根拠へ使わない。CASはobserved root、checkpoint、candidate identity、物理location、物理内容witness、absorption match projectionをversion付きcanonical形式で比較し、revisionだけ、checkpointの文字列化だけ、candidateの件数だけ、物理recordを読まない比較へ縮退しない。

candidateのauthority classは`source`名ではなく、I0で全生成・読込箇所を列挙する`config/fsmc-recovery-candidate-locations.json`とpure `collectRecoveryCandidateObservationsForRoot(storeName, key)`が返す物理locationだけで決める。inventoryはroot tupleごとに、現在候補の有無とは独立した全potential IndexedDB store／record selectorと全external key selectorを列挙する。現行の`source: "indexedDB"`に加え、`syncQueue`の`LEGACY_MIGRATION_JOURNAL_KEY`、`LEGACY_MIGRATION_ARCHIVE_KEY_PREFIX`、recovery adoption／retention recordから導く`source: "migration-journal"`は、exactな`recordKey`を持つ`indexeddb-transactional`である。`legacy-localStorage`と、現行`readRuntimeCandidateSnapshots`が`localStorage`から読む`runtime-fallback`だけを、exactな`storageKey`を持つ`external-fenced`とする。同じ`source`でも物理locationとinventoryが一致しないcandidate、未知媒体、memoryにしか残らず元recordへ再解決できないcandidateは分類を推測せずrecovery-requiredとし、通常commandへ参加させない。

rootごとの観測は上記collectorの全出力とし、そのrootを変更し得るunscoped candidateは該当する各rootへ同じidentity／physical location／physical content witness／absorption match projectionのまま含める。root／authority class内の重複は拒否するが、別rootへの決定的な重複帰属を省略しない。`indexedDbTransactional`配列は`authority: "indexeddb-transactional"`＋`kind: "indexeddb-canonical-record"`だけ、`external`配列は`authority: "external-fenced"`＋`kind: "local-storage-raw-utf16-code-units"`だけを型とJSON Schemaの両方で許可し、逆配列への混入、unionへの型拡張、inventoryと異なる媒体／witnessを拒否する。前者の全`storeName`はcommand transaction scope、後者の全`storageKey`はexternal inventoryとexact一致させ、両authority配列の交差混入をnegative compile-time fixtureとschema fixtureで検出する。全physical content witnessのSHA-256 `digest`はlowercase 64桁hex、IDB witnessの`digestCanonicalLength`は正のsafe integer、external witnessの`codeUnitLength`は0を許す非負safe integerとし、それぞれinventoryで固定したhard limit以下をJSON Schemaとsemantic verifierで強制する。`externalDigest`はphysical content witnessを含むexternal全entryのcanonical JSON UTF-8 SHA-256であり、空vectorにも固定digestを持つ。同じstorage key／identity／locationのままrawValueが1 code unitでも変わる場合はlone surrogate同士の差を含めdigestが必ず変わる。`objectStoreSchemaFingerprint`はkeyPath、autoIncrement、index名／keyPath／unique／multiEntryをcanonical順でhashする。正常`map-cell-split-v1`は`introductionWitness.observedVersion === dbVersion`かつ両方`>= Vcap`、recovery-requiredで`dbVersion`がnon-nullの`db-version` witnessも`observedVersion === dbVersion`かつ`>= Vcap`をschema／semantic invariantにし、同snapshot内の`db-version` witness重複を拒否する。`dbVersion < Vcap`でstoreだけ、`data`／`control` payloadだけ、fenceだけが存在しても、それぞれ`capability-store`、`required-payload-root`、`external-candidate-fence` witnessによりnonempty recovery-required分岐を構築する。

`db-version` witnessはさらに必要十分条件へ固定する。supported range内のrecovery-requiredでは`dbVersion !== null && dbVersion >= Vcap`の場合に限りexact 1件を必須とし`observedVersion === dbVersion`、`dbVersion === null || dbVersion < Vcap`なら0件とする。正常snapshotは単一witnessと`Vcap <= dbVersion <= supportedMaximumVersion`、`core-only`は`dbVersion === null || dbVersion < Vcap`だけを許す。phantom witness、必須witness欠落、重複、値ずれをJSON Schema／semantic verifierのnegative fixtureで拒否する。`dbVersion > supportedMaximumVersion`は`FsmcPersistenceSnapshot`を構築せず`FsmcDatabaseOpenResult.kind = "unsupported-database-version"`としてconnectionを閉じ、core／split authorityを採用せずwrite 0件で専用案内へ送る。

`recovery-trace` witnessはcapability storeの`data`／`control`／fence rootだけへ閉じる。metadata／checkpointの`recordKey`は`createPersistenceMetadataKey("mapCellSplitSettings", rootKey)`または`createPersistenceCheckpointKey(...)`の戻り値とexact一致し、candidateは同じtarget tupleへI0 inventoryで一意帰属する場合だけ許可する。通常core storeのmetadata、checkpoint、candidateはsplit導入witnessではなく、split traceがない健全なDB5はそれらが存在しても`core-only`である。任意store／key、表示上の`source`、候補件数だけからsplit導入を推測しない。

root vectorは`(storeName, key)`で安定sortし、同じtupleの重複、command参加rootの欠落、vector外rootへの書込み、observed rootとcheckpointのstoreName／key不一致を拒否する。各authority classはidentity全field、physical location、physical content witness、absorption match projectionのcanonical JSONで安定sortし、同一entry重複を拒否し、optional fieldの欠落と明示値を区別する。各参加rootについてlocation inventoryが列挙する全potential IndexedDB storeの和集合を、snapshot時のcandidateが0件のstoreも含めてcommandの同じreadwrite transaction scopeへ加える。最初のwriteをqueueする前に同transaction上のIDB requestで全selectorを再読込し、結果を同期canonical encodeしてpre-transactionの一時bytesとbyte-exact比較する。transaction内でWebCrypto SHA-256や別async taskをawaitせず、empty→insertを含む追加、消滅、identity／location／content／projection変更が1件でもあれば全CASをabortする。一致時はtransaction外で計算済みのdurable witnessを再利用する。別`openDB()`、別readonly transaction、`readInternalControlRecord`をtransaction内からawaitしてはならない。`mapData`は物理event／day recordが複数でも現行の論理aggregate root `(mapData, "data")`とpayload fingerprintで全体を拘束する。capability storeでは`(mapCellSplitSettings, "data")`と`(mapCellSplitSettings, "control")`を別rootとして必ず参加させる。

IndexedDB transactionでロックできないexternal candidateには、存在しない原子CASを主張せず次のfence protocolを使う。I0のcommand participant manifestの和集合とcapabilityの`data`／`control`／fenceから、canonicalで重複のない全root universe `FSMC_GOVERNED_ROOTS_V1`を`config/fsmc-governed-roots.json`へ固定する。同configは各tupleを`capability-owned`または`legacy-mutable-core`へexact分類し、`data`／`control`は前者、固定旧版Aが書けるcore rootは後者、fence自身は専用`fence` policyとする。未知policy、未分類root、同一tupleの複数policyを拒否し、config SHA-256をfenceへ保存する。

`FSMC_EXTERNAL_CANDIDATE_FENCE_KEY = "__esp_internal__:fsmc-external-candidate-fence:v1"`をcapability storeの内部recordとし、schemaVersion、command ID、config SHA-256、fence以外の参加root tuple、全非fence governed rootにexact 1件ずつ対応する`historicalRootEvidenceByRoot`、`historicalEvidenceDigest`、`committedParticipantDigest`、全governed rootにexact 1件ずつ対応する`externalBaselineByRoot`、writerId、committedAtを持たせ、fence自身も外側の`ExpectedRootVector`へ参加させる。historical evidence rowはcanonical `(storeName, key, observed root, checkpoint, ExpectedRecoveryCandidateObservation)`全体であり、payload digestのauthorityは`observed.payloadDigest`だけとする。候補はIDB／external双方のidentity全field、物理location、物理内容witness、absorption match projection、externalDigestをlosslessに保持する。全rowをroot tupleで安定sortしたUTF-8 SHA-256を`historicalEvidenceDigest`、participant tupleが指すrowだけを同じ規則でhashした値を`committedParticipantDigest`とする。readerはfenceに埋め込まれたhistorical rowから両digestを再計算して自己整合を検証し、live core rootから過去digestを再計算しない。さらに全非fence rootで`historicalRootEvidenceByRoot[root].recoveryCandidates.externalDigest === externalBaselineByRoot[root]`を必須にし、fence rootだけはhistorical rowなしでbaselineのみを持つ。自己参照hash、参加row／非参加historical rowの欠落・改変、未知・重複root、候補vector／物理location／content witness／projectionの欠落、historical／baseline external digest不一致、件数だけのdigestを拒否する。

通常FSMC commandは、同transactionで再読込した参加rootの候補vector付きhistorical rowだけをnew evidenceへ置換し、非参加rootのhistorical rowは前fenceからbyte同値で維持する。`data`／`control`は全fence writerへ必ず参加させる。全rowの`historicalEvidenceDigest`と参加rowの`committedParticipantDigest`を毎回再計算する。external baselineは毎commandで全governed rootを再観測して完全置換し、空vectorにも固定digestを保存する。E0→E1不変と前fenceのcross-invariantを検証したうえで、全非fence historical rowの`externalDigest`とnew baselineが一致する場合だけcommitする。historical／externalのどちらも、非参加rootを前回値ごと落とす疎な上書きを禁止する。通常FSMC commandはexternal candidateを作成・変更・削除しない。

固定旧版Aは正常なcore rootを更新できるが、capability rootとfenceを更新できない。この正当な差を破損へ誤分類しないため、I0でpure `classifyLegacyCoreTransitionV1(previousFence, currentSnapshot)`と内部command `fsmc.internal.rebase-legacy-core.v1`を固定する。classifierは`unchanged | rebase-required | recovery-required`のexact unionを返し、次をすべて満たす場合だけ`rebase-required`にできる。

- fence schema、config SHA、埋込`historicalEvidenceDigest`と`committedParticipantDigest`、全非fence historical candidate `externalDigest`と同root baselineのcross-invariantが自己整合し、live `data`／`control` rootとcapability-owned external baselineがhistorical evidence／fenceから変化していない
- 差分tupleが`legacy-mutable-core`だけのnonempty集合であり、current coreのpayload digest／fingerprint、metadata、checkpoint、IDB candidate、external candidate lineageが既存core load契約でrootごとに完全整合する。I0は固定旧版Aの全candidate writer／cleanup pathから、root policy、authority、物理selector、old／new canonical record shape、必須root／checkpoint関係、許可する`created | absorbed | replaced`をwildcardなしで列挙した`config/fsmc-legacy-candidate-transitions.json`を作る。classifierはprevious historical rowのlossless candidate vectorとcurrent vectorの差を、同manifestのtransition instanceへ重複なく全件対応できる場合だけ説明済みとする。同じidentity／locationのまま`physicalContentWitness`または`absorptionMatchProjection`だけが変わるcaseを自動的な「旧entry消滅＋new追加」とみなさず、old／new canonical recordとroot／checkpoint transitionがexact 1件の`replaced`定義に一致する場合だけ許す。manifest外、0件・複数件一致、1 entry／descriptorの再利用はrecovery-requiredとする。`absorbed`はcurrent checkpointの各`absorbedCandidates` descriptorと旧entryのnon-null `absorptionMatchProjection`がexact一致し、そのdescriptorに一致する旧entryがroot内でちょうど1件の場合だけ、identity／locationを旧rowから一意に確定してroot payload transitionへの吸収とみなす。checkpoint自体がidentity／locationを持つとは仮定しない。同一projectionの旧entryが物理location違いで複数ある、0件、nullの場合はrecovery-requiredとする。`created`もinventory、digest、対象root、checkpointとの対応が一意な既存core recovery契約とmanifestのnew shapeに合う場合だけ許す。過去vectorを復元できない、吸収証跡がない、physical content witness／projectionだけの説明不能な変更、external差をprevious row＋inventory＋current logical root／checkpointのallowlist transitionで一意に説明できない場合もrecovery-requiredとする
- 現在のanchor、association、map／block binding、番号衝突をI0固定after-image validatorで再計算できる。完全一致entryはactiveを維持し、owner消失はdormant、曖昧・競合はquarantined、旧版編集で生じた`C(S) != ∅`はstored ONを変更せずevent単位effective fallbackにでき、別ownerへの自動接続とdurable state削除が0件である

capability-owned rootのlive差、fenceの自己不整合、core rootのpayload／metadata／checkpoint／candidate不整合、policy外root差、説明できないexternal差は`legacy-core-transition-unclassifiable`を含むrecovery-requiredとする。writerIdや`source`名だけで旧版writeと推測しない。逆に、healthyなlegacy-mutable core差そのものは`external-candidate-fence-inconsistent`にしない。

`fsmc.internal.rebase-legacy-core.v1`は利用者向けcollision repair allowlistとは別のI2所有maintenance commandであり、split mutationや番号修正の入口にしない。全legacy-mutable core store、inventoryが列挙するcandidate用の全potential物理IDB store、settings、control、fenceを単一readwrite transactionでlockし、同transaction内でclassifier入力を再読込する。staleならwrite 0件で再判定する。一致時の`rebaseParticipantRoots`は、previous historical rowとcurrent rowのobserved root／checkpoint／candidate vectorのいずれかが異なる全legacy-mutable-core tupleと、capabilityの`data`／`control` tupleの和集合をroot順にsortしたexact集合とする。fence fieldが自己参照しないようfence tuple自身は含めない。historical rowの置換集合は`rebaseParticipantRoots`とexact一致させ、`data`は決定的なassociation／entry status変更があればafter-image、変更がなければbyte同値row、`control`はstored enabled membershipを変えないbyte同値rowを入れ、その他の非参加rowは前fenceからbyte同値で維持する。`committedParticipantDigest`はこのexact集合だけ、`historicalEvidenceDigest`は全rowから再計算し、全external baselineも現在値へ完全置換したfenceを同じtransactionでcommitする。participant tupleの欠落・余分・重複、changed rowとの不一致はschema／runtimeで拒否する。anchor／bindingが完全一致する場合はsettings payloadをbyte同値で維持し、changed legacy rows＋data／controlをparticipantとするfenceだけをrebaseできる。

rebase自身もexternal candidateをlockできないため、通常commandと別名のvector `R0`／`R1`／`R2`で同じ安全境界を持つ。transaction開始前に全governed rootのexternal `R0`とraw stringを読み、全IDB rootをlock・同期byte比較した後、最初のwrite前にexternal `R1`を同期再読込して`R0`のraw stringとexact比較する。`R1 != R0`ならwrite 0件でtransactionをabortし、追加差もhealthy legacy-onlyなら最新snapshotからrebaseを再試行、capability-ownedまたは分類不能ならrecovery-requiredとする。`R1 = R0`かつclassifier再検証成功時だけ、transaction外で計算済みの`externalBaselineByRoot = digest(R1)`を持つnew fenceと必要なstatus変更をcommitする。`transaction.oncomplete`後・split再開前に`R2`を同期再読込し、`R2 = R1`なら完了、追加差がhealthy legacy-onlyなら確定済みrebaseをrollbackせず非durableな`legacy-rebase-pending`から次のrebaseを行い、それ以外は確定済みrootを維持してrecovery-requiredにする。rebaseはexternal candidateを変更・cleanupせず、IDB transaction内で非同期hashを待たない。

commit前終了・quota・abortでは固定旧版Aが既に確定したcurrent legacy core＋rebase前fenceを維持し、その組合せから導出する非durableな`legacy-rebase-pending`として次回境界で安全に再試行する。未保存rollbackや破損とは表示しない。splitはrebase完了までlegacy fallback／read-onlyとし、利用者commandのpreviewは完了後に最新rootから作り直す。

通常commandの境界protocolは次とする。

1. preview／command開始時にlive governed root、external vector `E0`、durable fenceを読み、fence自己整合とroot policyを検査する。差がlegacy-mutable coreだけなら先にclassifier／rebaseへ送り、capability-owned差または分類不能差ならwrite 0件のrecovery-requiredとする
2. command参加rootと、location inventoryが各rootへ列挙する全potential IndexedDB storeを、現在candidateが0件でも含めた単一readwrite transactionを開く。最初のwrite前に同transactionのIDB requestでroot／checkpoint／`indexedDbTransactional` selectorを再読込し、同期canonical bytesをpre-transaction bytesとexact比較してCASする。transaction内で非同期hashや別transactionを待たない
3. 同じ最初のwrite前境界で`localStorage`から全governed rootのexternal raw stringを`E1`として同期再読込し、`E0`のraw stringとexact比較する。`E1 != E0`がlegacy-mutable coreだけならwrite 0件の`legacy-rebase-required`、それ以外はwrite 0件のconflict／recovery-requiredとする。一致時だけtransaction外で計算済みのSHA-256 witness／digestを再利用する
4. IDB内candidateと全rootのCAS成功時だけ、new participant historical evidence、全rowのnew `historicalEvidenceDigest`、new `committedParticipantDigest`、`digest(E1)`の完全`externalBaselineByRoot`を持つfenceを同じtransactionでcommitする
5. `transaction.oncomplete`後かつUI成功通知前に全governed rootの`E2`を再観測する。`E2 = E1`なら成功とする。差がlegacy-mutable coreだけなら全new IDB rootを維持して`committed-legacy-rebase-required`とし、classifier／rebase完了まで成功UIを保留する。それ以外は全new IDB rootのまま`committed-recovery-required`としてsplitを即時read-only安全モードにし、Backup復旧案内を出す。いずれもrollback、旧状態表示、自動merge、未保存扱いをしない

commit後・post-check前の終了は、次回起動時にlive root／全external vectorとdurable fenceを比較し、差なしはcommitted stateを正常採用、legacy-mutable coreだけの説明可能な差はrebase、capability-ownedまたは分類不能な差はrecovery-requiredへ入る。別tabの`storage` event、`focus`／`visibilitychange`、split read／mutation前にも全rootを再比較し、分類完了前に新しいauthorityを自動採用しない。post-check後に起きた変更も次の通知または境界checkで検出する。Web Lockは旧版や外部storage writerを拘束できないため正当性の前提にせず、IDB原子commit、root policy、legacy rebase oracleを境界にする。

`Vcap`導入は、既存core preflightが正常で、I0 decision tableが「capability store／split payload／split rootのmetadata・checkpoint・candidate／fenceの導入traceなし」と判定した`dbVersion < Vcap`だけに許す。既存DBのopen request前に、全非fence governed rootのpayload、metadata、checkpointと、`config/fsmc-recovery-candidate-locations.json`が列挙する全potential IndexedDB store／record selector（現在0件のselectorと明示absenceを含む）を同一preflight snapshot `H0`として読み、lossless canonical bytesとtransaction外で計算した物理内容witnessをcommand attempt中だけ保持する。同じ境界で全governed rootのexternal raw DOMStringを`E0`として観測し、split対象3 rootのexternal vectorが空であることを要求する。

versionchange transactionはupgrade開始時点で存在する全storeと、新設するcapability storeをscopeにし、最初のwriteをqueueする前に次を順序固定で行う。まず`syncQueue`内journal／archiveを含むsplit対象IDB trace皆無を同transactionのrequestで再検証する。これはbootstrap source CASと別の判定であり、stableなcandidate-only／metadata-only／checkpoint-onlyを「変化なし」としてupgradeしてはならない。次に全非fence rootのpayload、metadata、checkpointと全potential candidate selectorを同transactionで`H1`として再読込し、同期lossless canonical encodeしたbytesを`H0`の値またはabsence sentinelとbyte-exact比較する。transaction内でWebCrypto、別transaction、別async taskをawaitせず、`H1 != H0`ならupgrade transaction全体をabortして旧DB version／旧store／旧dataを維持する。同じ最初のwrite前境界でexternal `E1`を同期再読込し、`E1`のraw DOMStringが`E0`とexact一致する場合だけ`H0`で計算済みのwitnessを`H1`へ再利用できる。`E1 != E0`も全abortとする。

既存DBのbootstrapは`H1 = H0`かつ`E1 = E0`の場合だけ実行する。initial historical evidenceのsourceをroot policyごとに分け、全`legacy-mutable-core` rowは`H1`のexact payload／metadata／checkpoint／candidate観測、new capability `data`／`control` rowはI0固定の単一factoryが同じversionchange transactionで実際に書くpost-bootstrap payload／metadata／checkpoint、空IDB candidate vector、`E1`のexact external vector／digest（導入条件によりsplit対象は空）を一度だけ生成したcanonical after-imageとする。fence root自身にはhistorical rowを作らず、`externalBaselineByRoot`だけを持たせる。この合成post-stateに全非fence governed rootがexact 1 rowずつ存在することを検証してから、その全行`historicalEvidenceDigest`、participant tupleをdata／controlだけとする`committedParticipantDigest`、全`FSMC_GOVERNED_ROOTS_V1`の`externalBaselineByRoot = digest(E1)`を計算する。new store、空settings、初期OFF control、合成post-state付きinitial fence、3 rootのmetadata／checkpointは同じfactory／versionchange transactionでcommitし、導入前にabsentだったdata／controlを`H1` rowのまま保存しない。新規profileの0→`Vcap`ではpre-openの不在を旧data snapshotとして流用せず、同じfactoryが生成するempty coreとcapability rootのexact canonical値をroot writeとhistorical evidenceの両方へ供給し、fenceを除く全rowをfactory post-stateから作る。`onsuccess`後のUI開始前に全governed rootの`E2`を観測し、`E2 = E1`なら正常開始、差がlegacy-mutable coreだけならrebase、capability-ownedまたは分類不能な差なら完全な新DBのまま`committed-recovery-required`とする。通常起動後のlazy初期化commandは設けず、旧版正常write後のI2 maintenance rebaseだけを許す。commit前のabort／強制終了は旧DB version・storeなし、commit後から`onsuccess`前の終了は`Vcap`・3 root完全初期化のどちらかだけを許し、次回起動はinitial fenceとroot policyで全差を分類する。

したがって`ExpectedStoreRoot`は正常snapshotで`present`だけを表す。`dbVersion < Vcap`かつ新store、`data`／`control` payload、fence、split対象3 rootのmetadata、checkpoint、recovery candidate導入traceが全てない場合だけ`core-only`とする。通常core rootだけのtraceはこの判定へ混入させない。`dbVersion >= Vcap`でstore、`data`／`control`、fence、いずれかのmetadata／checkpointが欠ける状態、fence schema／config SHA／埋込historical全行digest／participant digest／candidate vector／root coverageの自己不整合、capability-owned root差、分類不能なlegacy core差、schema非互換、運用後に全recordだけが消えた空store、または`dbVersion < Vcap`でもstore／payload／fence／split対象recovery traceのいずれかがある状態は`map-cell-split-recovery-required`とし、従来coreだけを継続してsplit／control rootをruntime authorityへ採用しない。fence欠落は`external-candidate-fence-missing`、fence自己不整合またはcapability-owned差は`external-candidate-fence-inconsistent`、分類不能core差は`legacy-core-transition-unclassifiable`へ一意に対応させる。healthyなlegacy-mutable core差はrebase前の一時preflight状態であり、recovery-required snapshotを構築しない。reasonとwitnessの許可対応、必須組合せ、I0 enum順、重複禁止をJSON Schemaへ固定する。read-only診断とBackup復旧案内だけを提供し、空root／fence再作成、候補上書き、split exportを行わない。serializerの欠落はprofile状態ではなくbuild／architecture verifier失敗としてreleaseを拒否する。split payloadを含む復元を`core-only`または`map-cell-split-recovery-required` profileへ行う場合は、coreを変更する前に全体を拒否する。

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

### 6.4 旧版互換の保証範囲

保証するもの:

- 同じブラウザデータを新版で開いた後、旧版へ戻して起動できる
- 旧版では26a/26bを従来どおり1つの番号セルとして表示する
- 旧版は新しいobject storeを変更しない
- FSMC-I0でanchor保持を確認済みの旧版操作では、`splitIdentityAnchor`、association registry、instance ID、binding evidenceがすべて一致する分割設定が新版で復元される。いずれかが欠ける場合はdormantとし、自動接続しない
- 固定旧版Aがcoreだけを正常に改名・状態更新した後は、新版Bが`classifyLegacyCoreTransitionV1`で`legacy-mutable-core`だけの説明可能な差と検証し、分割機能を再開する前に`fsmc.internal.rebase-legacy-core.v1`でfenceのhistorical evidenceと全root baselineを現在値へ原子的に進める。anchor／bindingが一致すれば設定payloadを変更せずactiveを維持し、owner消失はdormant、曖昧・競合はquarantinedとし、別ownerへの自動接続やdurable state削除を行わない
- capability-owned rootの差、fenceの自己不整合、説明不能なcore差は旧版更新と推測せず、安全モードとBackup復旧案内へ送る。正常な旧版core差だけを理由に破損扱いしない
- 不一致設定を別イベントへ誤適用しない
- `Vcap = 6`の場合、DB6／DB7で新storeなし・非互換のprofileはpartial-loss安全モードで従来機能を起動でき、分割機能が利用不可である理由とBackup復旧案内を表示する。DBなし／DB5の未導入profileだけをcore-onlyとする

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
- `PD-04`に従い、OFF／安全モードではsplit固有部分に旧版と同じlegacy resolver、whole-cell geometry、番号identity、UI、core保存commandを使用し、上記authority rebaseを除くsplit identity migrationや利用者操作による分割設定書込みを行わない。一方、`PD-14`の共有訪問projection、既存訪問へのglobal統合、位置指定挿入規則、重複物理cellを新規作成するimport・通常編集after-imageの原子的拒否、既存重複の`map-data-untrusted`判定／map単位route停止は機能状態に依存しない安全修正として常時適用する。先頭ゼロ除去は機能ONかつ`PD-02` preflight通過時だけ適用する
- OFF／安全モードでもsplit storeとanchorを通常のdefinition／copy操作からread-onlyで保持する。authority正常な内部legacy rebaseは前項どおり制御状態に依存せず許可し、それ以外ではauthority正常、device ON、event OFFの場合だけ専用CAS recovery commandによるretained entryの再関連付け／明示削除を許可する。自動安全モードではread-only診断とBackup案内に限定する。再度ローカルONにした場合だけ現在の商品ID・順序からsplit identityを再構築する。期限到達済み`event-deleted` cleanupはsettings rootとretention authorityが信頼できる場合に限り、端末／event制御状態によらず時計契約どおり実行できる。原本の商品番号をON／OFF切替で書き換えない
- Backup V2／V1へ端末全体OFFとevent enabledを出力せず、V2復元入力に`localEnabled`、`deviceEnabled`、`control`等のfieldがあれば未知keyとして拒否する。V1は7.1の互換matrixに従って未知fieldを扱うがcontrol authorityとして採用しない。既存イベントへの復元では復元先のローカル状態を維持し、新規復元ではOFFとする
- オフラインは通常のローカル運用であり、それだけを理由に安全モードへ移行しない。重大障害時にインストール済み旧versionを遠隔停止できない制約を利用者向け文書へ明記し、端末全体OFFの案内と修正版配布で対処する

## 7. 初版バックアップと後続ファイル機能

### 7.1 イベント単位Backup V2とV1互換core

- 初版の分割対応backupをイベント単位V2として追加する
- schemaVersion、portable参照、active／dormant／quarantinedを含む`mapCellSplitSettings`セクションを追加する
- V1の`data` wire shapeは現行sectionを基準に`AppBackupV1Data`として凍結し、runtimeの`AppData`型を直接参照しない。V1 readerは現行どおり既知必須fieldの型と参照を検証し、現行が受理・保持する未知optional fieldを新たに削除・拒否しない。top-level、data section、eventSettings、`EventMetadata`、item、各nested objectごとの「必須検証／未知保持／未知拒否／export保持」を`config/fsmc-v1-compatibility-matrix.json`と固定旧版A goldenで固定する。`EventMetadata.splitIdentityAnchor`はoptional opaque fieldとして検証するが、他の未知fieldを一律拒否する例外理由にはしない。V2だけが全階層exact schemaと未知key拒否を採用する
- V2を出力するたび、同じ対象eventのcore dataだけを収録した旧版用V1互換backupも生成する。両bytesを先に自己parse・検証し、V1のfileName、byteLength、SHA-256をV2 `scope.companionCore`へ入れてV2 digestで拘束した後にだけdownloadへ渡す。出力画面とファイル名で、V2は新版用で分割設定を含むこと、V1互換coreは旧版用で分割設定を含まないことを明示する。片方の生成・検証・download handoffが失敗した場合は完了扱いにせず、すでに保存された片方をアプリから撤回できないことと同じpairの再生成を案内する。固定旧版A試験はV2が指すexact V1 bytesを復元する
- export開始時にcore、event metadata、map、訪問anchor、association、settingsの全参加storeを1個のreadonly IndexedDB transactionで読み、各full root、checkpoint、対象event sliceを含むimmutableな`SplitCapableEventExportSnapshot`を1回だけ作る。V2 objectとV1 core bytesはこのsnapshotだけから生成し、途中でUI state、cache、DBを再読込しない。V1 coreとV2 coreはportable ref化、anchor除去、V1互換matrixが要求する明示transform以外で同値であることをself-testし、readonly transaction失敗またはsnapshot内参照不整合では両fileを生成しない
- V2の`data`はscope別exact core unionとして固定し、`full-split`／`core-map`は対象event sliceの`eventLists`、`eventMetadata`、`executeModeItems`、`dayModes`、`mapData`、`mapRotationSettings`、`routeSettings`、`hallDefinitions`、`hallRouteSettings`、`mapViewportSettings`をすべて持つ。`item-only`は`eventLists`だけを持ち、他のdata keyを未知keyとして拒否する。split設定はtop-levelに一度だけ収録する
- V2 wire typeのtop-level必須keyは`kind`、`version: 2`、`exportedAt`、`scope`、`eventSettings`、`data`、`mapCellSplitSettings`、`digest`とし、全階層で未知keyを拒否する。`scope`は単一`eventRef`、そのeventに属する全地図の`mapRefs`、portable core reference table `references`、期待section、mapData／split設定の収録有無、件数、`companionCore`を明示する。`mapCellSplitSettings`はfull-split時だけactive／retained entryの判別可能unionを持ち、portable refのdata slot対応を重複保存しない。端末全体OFFとevent enabledはどのsectionにも含めない
- top-level scalarは`kind = "event-shopping-planner-backup"`、`version = 2`、`exportedAt`は`new Date(value).toISOString() === value`となるUTC millisecond ISO文字列、`digest`は64文字lowercase hexとする。`kind`をV1と共通にしてversionでdispatchし、未知kind／versionと非canonical日時を拒否する。端末時計の未来／過去は表示上警告できるが、日時だけを理由に正しいdigestのfileを拒否しない
- V1は引き続き読み込む。利用者が選んだUI command種別をauthorityとし、アイテムimportでは設定を維持し、`PD-01`の完全復元では対象範囲の既存設定をpreview後に`legacy-full-restore-without-split-settings`でdormant化する。V1内のmap key欠落や空配列からitem-onlyを推測しない
- ローカルrevision、checkpoint、`locationKey`、event／map／block instance IDをそのまま出力せず、ファイル内だけで有効なportable参照へ置換する
- `data.eventMetadata`の`splitIdentityAnchor`はV2 export時に除去し、`scope.references`のportable event参照へ置換する。V2を新規eventへ復元するときは復元transactionで新しいローカルanchorを発行し、既存eventへの復元では復元先anchorを維持する。V1を新規eventへ復元するときは入力anchorを除去してOFFとし、最初のenableでローカルanchorを発行する。V1の既存event復元とitem importは入力anchorで復元先anchorを上書きせず、現在profileの既存sidecarと一意一致する場合も候補説明にだけ使い、`PD-01`のpreviewと明示確定を迂回してactive化しない
- 復元時はportable参照を新しいローカルIDへremapし、外部IDをそのまま採用しない
- 形式、値、portable参照、重複entry、status、schemaVersionが不正なファイルはDB更新前に全体を拒否する。構造的には正しいが復元先と安全に一致しないretained entryだけに新しいローカル`dormantEntryId`を発行し、dormant／quarantinedとして保持する。外部event／map／block／entry refをruntimeのinstance IDまたは`priorOwner`へ採用しない
- イベント復元は確定前に復元先、置換、維持、休眠化、隔離、除外、ID remap、ローカルON／OFFを引き継がないことをプレビューする
- プレビュー確定時だけ、地図、アイテム、訪問順、分割設定を同じ原子的操作で置換する。取消、validation error、CAS競合時は全storeを旧状態のまま維持する
- 新しいeventとして復元する場合は新しいローカルIDを発行し、controlのenabled ID一覧へ追加しない。既存eventへ復元する場合は復元先IDとcontrol一覧上のmembershipを維持し、内容だけを置換する
- Backupは端末間同期や差分mergeではない。復元元と復元先の双方に変更があっても自動合成せず、復元先の退避backupを案内したうえで選択したV2の内容へ原子的に置換する
- アイテムだけのimportは既存の地図、event／map instance ID、分割設定を維持する
- 一致しない旧version設定は削除せず、読み取れる範囲を`dormant`／`quarantined`として保持する
- 利用者は休眠・隔離設定を端末内で手動再関連付けまたは削除できる。設定単独JSON出力は後続版とする
- JSONのraw byte数、nesting、token数、event／map／entry数、文字列長、error保持数をparse・commit前に検証する。UIで`File.size`を先に検査し、`arrayBuffer`をWorkerへtransferし、`TextDecoder("utf-8", { fatal: true })`、JSON.parse前のduplicate-property scanner、再帰を使わないdepth／token scanner、exact schema validatorの順で処理する。error件数と1件の表示長を上限で切り、cancel／timeoutではWorker、timer、Blob URL、未開始または進行中transactionを残さない。1地図15,000 entryを保証境界とし、hard limitは保証境界以上の値をI0 ADRへ固定する
- 上限超過、parse error、digest不一致では既存DBを一切変更せず、理由と退避方法を表示する

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
  | "normalization-collision";

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
  | { mapRef?: never; blockRef?: never }
  | { mapRef: string; blockRef?: never }
  | { mapRef: string; blockRef: string };

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
  items: number;
  activeSplitEntries: number;
  retainedSplitEntries: number;
};

type AppBackupV2FullEventCoreData = Pick<
  AppData,
  | "eventLists"
  | "eventMetadata"
  | "executeModeItems"
  | "dayModes"
  | "mapData"
  | "mapRotationSettings"
  | "routeSettings"
  | "hallDefinitions"
  | "hallRouteSettings"
  | "mapViewportSettings"
>;

type AppBackupV2ItemOnlyCoreData = Pick<AppData, "eventLists">;

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

type V2ItemOnlySections = ["eventSettings", "data.eventLists"];

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
          items: number;
          activeSplitEntries: 0;
          retainedSplitEntries: 0;
        };
      }
  );
```

初版の`scope`は上記3分岐だけを許すexact unionとし、`includesMapData=false, includesSplitSettings=true`や未知`contentKind`はDB更新前に全体拒否する。`expectedSections`は上記の現行V1／`AppData` inventoryから導いた「非`null` sectionだけ」のexact tupleであり、重複、順序違い、宣言した非`null` sectionの欠落、宣言外の非`null` sectionを拒否する。`full-split`／`core-map`の`data`は`AppBackupV2FullEventCoreData`の全10 keyを対象event sliceとして必須保持し、metadata、実行順、day mode、route／hall／viewportを落とさない。`item-only`の`data`は`AppBackupV2ItemOnlyCoreData`だけを許す。top-levelの`mapCellSplitSettings` key自体はenvelopeの不在sentinelとして常に必須とし、`full-split`だけがentry objectを持って`expectedSections`へ列挙する。`core-map`と`item-only`は`mapCellSplitSettings: null`を必須とするが、`null`はsection不在を表すため`expectedSections`へ列挙せず、宣言外section違反にも数えない。これ以外の`null` sentinelや宣言外keyは許可しない。

`scope.references.events`は全scopeで1件だけとし、`scope.eventRef`と同じ`eventRef`から`dataEventKey`へ対応させる。`full-split`／`core-map`は`scope.mapRefs = scope.references.maps = data.mapData`の全day-map slotが集合、canonical順、件数で一致し、`scope.references.blocks`も同梱全mapの全論理block slotと一対一で一致する。`item-only`は`mapRefs=[]`、referencesのmaps／blocks空、map／block／active／retained件数0、`data.mapData`を含む他の9 data keyなしとする。したがってsplit設定が`null`でも`eventRef`／`mapRef`をcore data slotへ一意に解決でき、表示名やobject列挙順を代用しない。複数地図eventのgolden fixtureを必須にし、地図同梱scopeを単一`mapRef`へ縮退させない。`full`と`multipart` scopeは後続versionで定義し、初版readerは未知scopeとして拒否する。

`counts`は表示用自己申告として信頼せず、export直前とreaderのschema検証後にI0固定pure `deriveEventBackupCountsV2`で実payloadから再計算して全5 fieldのexact一致を必須にする。`items`は`scope.references.events[0].dataEventKey`の`data.eventLists`配列要素数、`maps`は対象eventの`data.mapData` day-map slot総数、`blocks`はその全mapをcanonical走査した論理block slot総数、`activeSplitEntries`／`retainedSplitEntries`はportable entryのstatus別件数とする。`full-split`／`core-map`のreferences maps／blocksはこの全map／全block slot集合と一対一で一致し、`core-map`はsplit 2値を0、`item-only`はitems以外を0とする。負数・非safe integer、自己申告と実数の差、`scope.references`だけの水増し／省略はdigestが正しくてもcommit前に全体拒否する。raw scannerのhard limitは自己申告countを使わず、実token／entry数を数える。

- split-capable exporterが地図を含むevent scopeを出力する場合は`includesSplitSettings=true`を必須とし、分割設定を黙って省略しない
- core-only source等から`includesMapData=true`かつ`includesSplitSettings=false`のV2を復元する場合は、V1 fullと同じく影響範囲の既存split設定をpreview後に`legacy-full-restore-without-split-settings`でdormant化する
- `includesMapData=false`かつ`includesSplitSettings=false`のitem-only scopeは既存の地図・分割設定を維持する。map置換とitem-onlyを同じ「設定なし」として扱わない

- `scope.references.events[0].dataEventKey`は同じV2のevent-scoped全sectionに存在する唯一のevent keyを指す
- `dataDayMapSlotKey`は参照eventの`data.mapData`にある日程・地図slotを指す
- `dataBlockSlotKey`は参照map内の論理block slotを指す
- `scope.references`のportable map rowはruntimeと同じ`algorithmVersion`とauthoritativeな`mapStructureFingerprint`を持ち、portable active entryは`blockFingerprint`と`locationFingerprint`だけを持つ。entryへ現在map fingerprintを重複させない
- active entryはevent／map／block参照をすべて必須とし、`scope.references`で一意に解決し、同梱mapDataから再計算したmap／block／location evidenceが一致する場合だけ許可する
- 全entryの`eventRef`はscopeのsole `eventRef`と一致させる。retained entryは`blockRef`があれば`mapRef`も必須とし、そのblockの親mapと一致させる。存在する`mapRef`は`scope.mapRefs`、存在する`blockRef`は`scope.references`へ解決する。最後にactiveだったentryはportable block／location evidenceを必須とし、never-activeは`portable-unresolved-reference`だけに限定する。旧map fingerprintは診断fieldとしてだけ受理する
- `scope.references`、core data、preview inputから端末全体OFFまたは`localEnabled`を受け取らない。既存イベントでは復元先のローカル値を表示し、新規復元ではOFFになることを表示する
- portable refはkind別に`^e-[0-9]{6}$`、`^m-[0-9]{6}$`、`^b-[0-9]{6}$`、`^s-[0-9]{6}$`とし、export snapshotをcanonical順に走査して連番発行する。`mapRefs`、`references`の各配列、entry配列は上記canonical比較順とし、ref文字列は64 code unit以下、利用者表示文字列はI0 hard limit以下とする。`companionCore.fileName`は`^[A-Za-z0-9._-]{1,128}$`、`sha256`は64文字のlowercase hex、全countは0以上、`byteLength`は1以上かつ各々safe integer・hard limit以下をexact schemaで検証する
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

自動性能テストの保証規模と、攻撃・破損ファイルを拒否するhard resource limitを分ける。I0で`config/fsmc-backup-limits.json` schema version 1へ、raw file 256 MiB、nesting 64、JSON token 5,000,000、event 1、map 256、block 8,192、split entry 20,000、item 100,000、1文字列1 MiB（UTF-8）、validation error 100件、1 error 512 Unicode scalar、Worker validation timeout 30秒、cancel確認間隔1秒を固定する。これらは3.13の保証規模を包含する拒否境界であり、10.5の性能上限とは別契約とする。値を変える場合はconfig schema version、golden境界fixture、互換影響を同じPRで更新する。

- 保証規模超過かつhard limit以下は警告付きbest effortとし、自動削除・切捨て・設定解除を行わない
- hard limit超過はWorkerまたはvalidatorで`resource-limit`として拒否する
- `FSMC_NUMBER_TOKEN_MAX_UTF8_BYTES = 1 MiB`をI0 ADRへ固定し、UI、CSV、XLSX、V1／V2の全番号取込で`BigInt`化前に適用する。新規入力・file after-imageの超過は全commit前に`resource-limit`として拒否し、既存永続dataの超過tokenは原文を変更せず`legacy-unresolved / unsafe-base-number`として診断し、経路や自動再関連付けへ使わない
- backupは`JSON.parse`前のraw byte上限、nesting、総entry、文字列UTF-8 byte、duplicate ref、構造fieldのallowlist、validation error保持数を制限する。利用者入力値であるイベント名・日程名等が`__proto__`、`constructor`、`prototype`であること自体は拒否せず、動的keyは`Map`、null-prototype object、または安全なown-property APIで扱ってprototype chainへ代入しない
- 後続版のXLSXは既存limitに加えてsheet／row／cell数、設定row数、展開後XML byte、圧縮率、timeout、cancel、heartbeat、peak memoryを制限する
- アプリ自身が出力した保証規模内のV2を同version importerがresource limitで拒否しないgolden testを固定する

初版のevent export preflightで1イベント内地図数、entry数、推定byte数を検査する。I0では上記hard limitと3.13の保証件数を固定し、I4で実export bytesを使って次を実装・強制する。

- イベント単位Backup V2とV1互換coreのmap／entry／raw byte保証上限
- 上限内での自己round-trip保証

初版のeventが保証上限を超える場合は、読めない単一ファイルや不完全ファイルを生成せず、出力を停止して対象eventの縮小方法を案内する。自動分割するmultipartは後続版とする。hard limit以下でも保証上限超過ならbest effort警告を出す。I4では最大fixtureのself round-tripが上記limitで拒否されないことと、境界直前／一致／直後を自動テストする。

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

- 経路探索の基準セルは1-based整数の`GridCellAddress`、探索内部は整数`PathNode`、描画geometryは0-based連続`MapPoint`とする
- 半領域中央を正確な`MapPoint anchor`として別fieldに持ち、既存のfractional row／col shapeをsplit domainへ流さない
- 経路本体は既存3×3探索を利用し、結果の`PathNode[]`を`mainPath`として保持する。共有adapter `pathNodeToMapPoint({ subRow, subCol }) = { x: (subCol + 0.5) / 3, y: (subRow + 0.5) / 3 }`だけが描画・hit-test用の連続点へ変換する。単一セルまたは結合セルの物理領域を0-based subcell集合`R`へ変換し、`R`の境界nodeのうち、4近傍に`R`外の通常通過可能nodeが1個以上あり、anchorからそのnodeへの線分が`R`内かつ禁止領域非横断となるものだけをrouting port候補にする。候補は外向き方向rankを上、左、右、下、次にbase cell中央nodeからのManhattan距離、`subRow`、`subCol`の昇順で並べ、角は最初の外向き方向だけに重複排除する。from／to候補pairを各indexの辞書順で評価し、経路が得られる最初のpairを採用する。start／goal passability例外は選択したport nodeそのものだけに許可し、fromの次nodeとtoの直前nodeは`R`外でなければならない。これによりmain pathが番号・結合領域内を通過することを禁止する。安全な候補pairがない場合は`unroutable: unsafe-connector`を返す。別セルまでBFSしてanchorへ直線を引く処理や、障害物を無視し得る直線／L字fallbackを使わない。`mainPath`の始終nodeはfrom／toの各`routingPort.node`と一致させる
- `routingPort.point`から半領域anchorへの`from-anchor`／`to-anchor` connectorは、線分全体が対象の自セルまたは結合セル領域内にあり、禁止領域を横断しないことをgeometryで検証した場合だけ`mainPath`と別の`MapPoint[]`で保持し、細い点線で描画する。connectorをpathfindingの通過cost、重複penalty、sub-cell使用量へ混入させない
- 同一整数セルのa→bは、両anchor間が同じ物理セル領域内で安全な場合だけ`mainPath=[]`と`same-cell-direct` connectorを正式なvisit間segmentとして保持し、安全でなければ`unroutable`とする
- hit-testの優先順位はmarker、main path、connectorとし、同順位に複数visitがある場合はDOM候補一覧を表示する
- 経路cacheとsignatureには順序付き`visitId`、`locationKey`、baseCell、anchor、split binding evidence、`pathfindingGraphFingerprint`を含める。`DayMapData.cells`の`value`／`backgroundColor`、map寸法、結合領域、passability rule、3×3解像度、cost定数のいずれかが変われば古い経路を再利用しない。描画px、font色、回転、zoom、pan、DPR値をsnapshotへ保存しない

### 8.3 描画overlayの統合

通常マップと集中モードに重なる選択、hover、現在・次・前・一時位置、購入状態、候補状態、番号マーカー、経路、クリック領域は、共有`MapLocationIndex`と位置APIが返す`bounds`、`anchor`、`locationKey`を使用する。`LocationPresentationState`は既存の通常／集中モード別state reducerを`locationKey`ごとに一度集計して生成し、描画順が後のvisitで先の状態を上書きする「last drawn wins」を禁止する。

- 半領域に属するoverlayを行・列だけのcacheやdedupeへ戻さない
- ベースセル罫線、結合セル外枠などセル全体のoverlayと、a/b別overlayを明示的に分ける
- Canvas描画、DOM popupの見出し、訪問一覧、経路markerが同じ`displayNumber`と`locationKey`を参照する
- 回転、DPR、pan／zoom後も描画位置とhit-testの逆変換を同じgeometryで行う
- feature OFF／安全モードでは従来のwhole-cell overlayだけを使用し、保存済みentryを変更しない

同じboundsへ複数状態を順番に上書き描画せず、物理位置ごとに`LocationPresentationState`へ集約する。layer順は、ベースfill・罫線、a/b別状態fill、分割線、選択等のoutline、main path、点線connector、中立marker・訪問数badge、現在訪問ring、正立した番号・a/b・状態文字とする。単一訪問だけは既存の優先度色markerを維持し、複数訪問markerを特定優先度の代表色にしない。

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

readinessと公開境界を次に固定する。

| phase              | build固定readiness | productionでの状態                                                                     |
| ------------------ | ------------------ | -------------------------------------------------------------------------------------- |
| I0～I1             | `contracts-only`   | capability store、event有効化UI、split mutationなし                                    |
| I2～I10／I11作業中 | `internal-testing` | 有効化UIをnavigationから隠し、productionのenable commandは拒否。隔離QA buildだけ試験可 |
| I11 Exit後         | `release-ready`    | productionで端末全体switchとevent有効化previewを初めて公開                             |

readinessはsourceに固定し、storage、query parameter、URL、remote responseから変更しない。QA overrideはnon-promotable QA artifactだけにcompileし、production bundle verifierがoverride symbol、command、query、storage keyの混入を拒否する。I5でUIを実装してもI11まではproduction navigationへ露出させない。release-ready公開時も端末全体OFF、既存event OFFを既定とし、問題発生時は端末全体OFFで`PD-04`のsplit固有部分のlegacy動作（`PD-14`、重複物理cellの新規after-image拒否、`map-data-untrusted`安全判定の常時修正を含む）へ戻す。

`currentPhase`は着手した最も後ろのphaseを表す`FSMC-I0`～`FSMC-I11`の列挙値とし、直前phaseのExit verifier成功後にだけ次値へ1段進め、skip、逆行、複数authorityを禁止する。`currentPhase`がI0／I1なら`contracts-only`、I2～I10なら`internal-testing`、I11の作業中candidateは`internal-testing`を許す。I11最終release candidate PRだけがsourceを`release-ready`へ変更して同じproduction artifactを全Exit testへ掛け、そのrunが完了するまでは配布不能とする。したがって「`release-ready`を試験する前にExit成功が必要」という循環も、未試験artifactの配布も許さない。`config/fsmc-implementation-state.json`、build constant、traceability、test manifestの組合せを各PRで相互検証する。

FSMCのCI job ID／status名はI0で`fsmc-required-gate`へ固定し、その後phaseやfindingに応じて追加・削除しない。I0は既存branch protectionでrequiredな終端contextをread-only inventoryし、そのworkflow終端jobを`if: always()`＋`needs: [fsmc-required-gate]`相当へ変更して、FSMC jobが成功しない限り既存required contextも成功しない構成を第一選択とする。これならbranch protection外部設定を変更しない。既存required終端contextを機械的に証明できない場合だけ、`config/fsmc-ci-gate.json`にowner `Repository Maintainer`、対象branch、固定context名、one-time setup手順、read-only確認commandを記録し、Repository Maintainerが`fsmc-required-gate`を一度required化するまでI0 Exitを失敗させる。その後の動的変更権限やfinding別contextは作らない。

aggregatorはsource固定implementation stateからmodeを再計算する。`contracts-only`／`internal-testing`では`verify:fsmc:phase-gate`を実行し、現在phaseまでのExit、同phaseまでに`enforcedFromPhase`へ到達した`initial-release` test、production artifactのreadiness一致、早期公開経路なし、current-run WebKit safety artifactを検証して`phase-gate-passed`にできるが、`releaseScope = future`のtestや`release-ready`を要求せず公開可能とは表示しない。`release-ready` candidateだけは同じjob内で`verify:fsmc:release-readiness`を実行し、I0～I11の全Exitと初版公開条件を要求する。modeの自己申告、workflow input、branch名、query／storageで分岐せず、state／artifact不一致、skip、選択test 0件を失敗させる。

### FSMC-I0: 契約・fixture・基準値

実装:

- 仕様ADRとversion付きJSON Schemaを作成し、bounded番号grammar、`C(S)`衝突pair集合、mapped／mapless／legacy-unresolved identity、active／retained entry、map／entry／pathfinding graph fingerprint、settings／control root、authority別の型と配列へ分離したfull observed root＋checkpoint＋物理location付きIDB／external recovery candidate観測、全`FSMC_GOVERNED_ROOTS_V1`のroot policy、全非fence rootのlossless candidate vector付きhistorical evidence、その全行digest、participant digest、全root baselineを持つexternal fence protocol、retention clock、座標変換、picker順、Backup V1／V2をexact fixtureで固定する
- DBなし、健全なcore metadata／checkpoint／candidateだけを持つDB5、DB5＋capability storeだけ／空store／`data`だけ／`control`だけ／fenceだけ／split対象metadataだけ／checkpointだけ／candidateだけ、DB6／DB7（完全初期3 rootあり／storeなし／空store／data・control・fenceの各欠落／participant digest・root universe・全root baselineの各不一致／不正）、DB8、`Vcap` versionchange commit直前abort／直後・`onsuccess`前終了のfixtureとcapability decision tableを作る。`Vcap`の排他性、split rootへ閉じた全introduction witness、`db-version` witnessと`dbVersion`のexact一致・重複禁止、reason対応、外部`E0/E1`、既存全core source／potential IDB candidate selectorの`H0/H1` byte-exact CAS、legacy rowは`H1`・new data／control rowはfactory canonical after-image・fenceはbaselineのみとするinitial evidence合成、versionchange transaction内split導入trace 0件となるDB5→6採用条件、通常core traceだけの`core-only`、`map-cell-split-v1`、reason付き`map-cell-split-recovery-required`の3 snapshot分岐をschema verifierで固定するが、I0ではproduction DB versionや起動経路を変更しない。`H0`後に旧tabがpayload／metadata／checkpoint／candidateを変更する各race、導入前absentのdata／control rowをinitial fenceへ保存するnegative fixture、lone surrogateだけが異なるexternal raw DOMString、物理location inventory、同一transaction内IDB journal読込、全root fence baseline、DB6案のいずれかを証明できなければI2を停止する
- `dbVersion >= Vcap` iff exact 1件の値一致`db-version` witness、`dbVersion === null || dbVersion < Vcap` iff witness 0件をschema／fixtureへ固定する。DB8以上は3 snapshotのreasonへ流用せず、`unsupported-database-version`、connection close、authority非採用、write 0件を検証する
- `config/fsmc-governed-roots.json`へ全root tupleと`capability-owned | legacy-mutable-core | fence`のexact policyを重複なく固定し、config hash、物理内容witnessとabsorption projectionを含むlossless candidate vector付きtotal historical evidence、全historical row digest、埋込rowから再計算するparticipant digest、完全external baselineをschemaで拘束する。pure `classifyLegacyCoreTransitionV1`の`unchanged | rebase-required | recovery-required`と内部command `fsmc.internal.rebase-legacy-core.v1`のlock scope、after-image validator、原子性、制御状態非依存のauthority保守条件をcontract fixtureへ固定する。固定旧版Aによるanchor保持改名・通常状態更新、同じstorage key／identityでrawValueだけを変えるcandidate、IDB record内容だけの変更、candidateの正常吸収・追加、吸収証跡なし消失・物理location差替え、同一absorption projectionでlocationが異なる複数旧candidate、snapshot時empty storeへのtransaction中candidate追加、非参加historical row改変、device／event OFF中rebase、recovery-required時rebase拒否、anchor欠落、anchor重複、衝突作成、capability root変更、fence自己不整合、説明不能なcore差、rebase commit前／後終了を別fixtureにし、healthyなlegacy-only差と破損を同じ期待値にしない。transaction内でWebCrypto Promise、別transaction、別async taskを待たず、pre-transaction bytesとの同期exact比較後にfirst writeへ進むことをarchitecture testで強制する
- `config/fsmc-legacy-candidate-transitions.json`へ固定旧版Aの全candidate writer／cleanup path、transition ID、root policy、authority、物理selector、old／new canonical shape、必須root／checkpoint関係、`created | absorbed | replaced`をwildcardなしで固定する。同じidentity／locationでraw DOMStringまたはIDB canonical record内容だけを変えるfixtureは、manifestのexact 1 transitionへ一致するpositive caseだけ`rebase-required`、manifest外・0件・複数件一致・projection-only改変を`recovery-required`とする。`rebaseParticipantRoots = sort(unique(changed legacy roots ∪ {data, control}))`、historical row置換集合とのexact一致、participant digest対象集合、非参加row byte同値をschema／fixtureへ固定する
- `config/fsmc-event-metadata-writers.json`へ全writerと旧版A／新版Bのanchor方針を列挙し、source switch、bulk add、item-only／full import、V1／V2 restore、XLSX、改名、複製、削除・同名再作成を漏れ検出するarchitecture testを作る
- `config/fsmc-implementation-state.json`を追加し、`schemaVersion`、`baselineSourceSha`、`i0StartHeadSha`、`currentPhase`、`readiness`を固定する。`i0StartHeadSha`は最初のI0実装変更前に一度だけ記録し、`baselineSourceSha..i0StartHeadSha`だけをpre-I0 inventory対象とする。I0自身のcommitはこのrangeにも基準SHA更新条件にも含めず、Exitでは`i0StartHeadSha`がbaselineの子孫であること、inventory完備、現在HEADが`i0StartHeadSha`の子孫であることを検証する。`currentPhase`はこのfileだけをauthorityとし、test manifest、traceability、source readinessとの不一致を失敗させる
- DB5、V1、完全版XLSX 2.2、複数地図event、`full-split`／`core-map`／`item-only` Backup V2、部分root欠損、完全profile消去、D+29／D+30／31日／36日／rollbackのgolden fixtureを固定する。V2 fixtureは全scope共通`scope.references`、実payloadと一致する全`counts`、正しいdigestだがcountsだけ過少／過大、referenceの水増し／省略を含める。V1層別互換matrixと固定旧版Aの自己動作だけをI0で実行し、新版Bの後続挙動は担当phaseへ登録する
- 固定旧版Aの完全source SHA `3db4be011d0f4123aa3953b559280c58f33d026a`、artifact SHA-256、lockfile／toolchain hash、Node／npm、build／起動commandを`tests/fixtures/fsmc/legacy-a/manifest.json`へ固定し、起動smokeとhash検証を作る。候補新版Bは固定artifactにせずCI対象sourceから一度buildする
- 代表地図、ON／OFF別番号正規化、`01a`／`1a`衝突あり・なし、衝突pair swap／厳密減少／完全解消、safe integer境界、1 MiB数字列を巨大`BigInt`化しない境界、mapless、unresolved、`26`／`26c`／`26d`／`26ab`／`26c2`、retained number／token一致・不一致、active／retained owner overlap、同名block、一意番号、重複・領域競合・merge越境、重複物理`(row, col)`、背景色だけで変わるpathfinding graph、0／45／90度pickerのfixtureを作る
- 15,000セル、最大8,192 logical block、15,000設定、30,000半領域、400 item、400 `SpaceIdentity`、400 `ExecutionVisitIdentity`、最大800 `PhaseVisitIdentity`（各phase最大400）の決定的最大fixture generatorを作る。生成hashを固定し、I0では生成・schema検証だけを行う
- `config/fsmc-performance-budgets.json`を既存`config/performance-budgets.json`から分離し、`PD-17`の全製品上限、profile、測定法、`enforcedFromPhase`、scenario別`offComparison`、`runSample`／`inputObservation`／`memoryObservation`の別、run内集約と30 run間nearest-rank p95、全Chromium process PSS、immutable runner image、CPU／memory／cgroup／swap／isolation、calibration bandの取得契約を非nullで固定する。I0では実機能の性能合格を測らず、config schemaとsynthetic observation→run value→scenario p95計算・PSS集計・environment verifierだけを検証する
- `config/fsmc-failure-injection.json`へbarrier ID、対象command、fault、commit前後のoracle、owner phaseを、`config/fsmc-test-manifest.json`の全test／scenario entryへtest ID、project、層、`requiredCommand`、`enforcedFromPhase`、`releaseScope: "initial-release" | "future"`を固定する。各test IDはexact 1件の`requiredCommand`を持ち、複数IDが同じsuite commandを共有することは許すが、1 IDの0件／複数command対応、result側だけのcommand、traceabilityの`commands`にない対応を拒否する。traceabilityのrequirement scopeとtest scopeをexact一致させ、初版PD／DoDに必要なtestを`future`へ移す変更を拒否する。failure barrierには`after-vcap-history-source-preflight`、`after-vcap-history-source-reread-before-first-write`、`before-vcap-versionchange-commit`、`after-vcap-versionchange-commit-before-open-success`、`after-legacy-rebase-r0-read`、`after-legacy-rebase-r1-before-first-write`、`before-legacy-rebase-commit`、`after-legacy-rebase-commit-before-r2`、`after-legacy-rebase-r2-before-ui`を含める。`config/fsmc-collision-repair-commands.json`へ利用者向け3 command ID、変更可能範囲、owner phase、UI owner、strict-reduction verifierを固定し、内部`fsmc.internal.rebase-legacy-core.v1`がそのallowlistへ入らないことも検証する。future testは`planned`または契約だけを固定した`contract-enforced`であって、初版の選択集合、成功済み、`implementation-enforced`へ入れない
- `config/fsmc-safety-findings.json`は`findingId`、source job／engine、`severity: "Critical" | "High"`、`status: "open" | "closed"`、opened／closed commit、`promotion.kind: "engine-agnostic-required" | "webkit-temporary-required"`、test ID、required command、closure test IDをexactに持ち、test ID／required commandをtest manifestの一意な対応と一致させる。test manifestのsafety entryには`enforcedFromPhase`、`status: "planned" | "contract-enforced" | "implementation-enforced"`、`releaseScope: "initial-release" | "future"`、`artifactMode: "pre-release-production-guard" | "release-production-full" | "qa-chromium-only"`を必須にし、初版traceability／DoDに属するIDを`initial-release`、後続版だけのIDを`future`へexact分類する。`requiredSafetyIds(state)`は、pre-releaseなら`releaseScope = initial-release && enforcedFromPhase <= currentPhase && status != planned && artifactMode = pre-release-production-guard`の全ID、release-readyなら`initial-release`かつ`implementation-enforced`の`release-production-full`と`pre-release-production-guard`の全IDを返す。`release-ready`は、全`initial-release` safety entryが`implementation-enforced`で、manifest全体の`qa-chromium-only`が0件の場合に限りschema-validとする。I11最終candidateではinternal-testing中のQA-only safetyを同じtest IDの`release-production-full`へ移し、`future` scopeは全readinessのWebKit集合へ入れない。pre-release production guardは選択0件を禁止し、I2～I10およびI11作業中`internal-testing`のsplit機能safetyはnon-promotable QA artifact上の必須Chromiumへ割り当て、到達不能なproduction WebKit testを成功扱いにしない
- `config/fsmc-webkit-safety-observation.schema.json`は`ciRun`、source SHA、production artifact SHA-256、`selectionMode: "pre-release-production-guard" | "release-production-full"`、implementation-state SHA、test-manifest SHA、Playwright／WebKit version、`requiredSafetyIds(state)`から導出した`manifestSafetyTestIds`、`executedSafetyTestIds`、`{ testId, result: "passed" | "failed" }`のexact結果、`failedSafetyTestIds`、`infrastructureErrors`を共通fieldとしてcanonical unique配列で持つ。全status分岐でresultのtest IDを重複禁止とし、`executedSafetyTestIds = result test IDs ⊆ manifestSafetyTestIds = requiredSafetyIds(state)`、`failedSafetyTestIds = result = "failed"のID集合`を必須にする。future scope／QA-only／未選択IDのresult混入、現在必要IDの欠落、selectionMode／readiness／`ciRun`不一致をschemaとaggregatorで拒否する
- observationのstatusは結果から再計算する。失敗結果が1件以上なら、未実行やinfra errorも併発していても`safety-failed`を最優先し、nonempty `failedSafetyTestIds`と全失敗要因から作る`stableFailureFingerprint`を必須にする。失敗結果0件かつ未実行IDまたはinfra errorが1件以上なら`infrastructure-failed`とし、nonempty `infrastructureErrors`（未実行IDも正規化したerrorとして列挙）とfingerprintを必須にする。全manifest IDを実行し、全結果passed、infra error 0件の場合だけ`passed`とし、failed IDsは空、fingerprintは禁止する。この3分岐以外、矛盾するoverall status、分岐外fieldをschemaとverifierで拒否する。通常表示／a11y失敗は別fieldへ記録し、このstatus unionへ混入させない
- `config/fsmc-webkit-promotion-result.schema.json`は`ciRun`、source／artifact SHA、safety-findings file SHA-256、選択finding／test ID／required command、実行済みID、`{ testId, command, result }`、failed IDs、infra errorsと`status: "not-required" | "passed" | "failed" | "infrastructure-failed"`のexact unionを持つ。open `webkit-temporary-required`が0件の場合だけselected／executed／results／failed／infraをすべて空、fingerprintなしの`not-required`にできる。1件以上ならselected IDsと各required commandをopen findingおよびtest manifestからexact導出し、全status分岐でresult IDを重複禁止、`executed IDs = result IDs ⊆ selected IDs`、各`result.command = manifest.requiredCommand`、failed IDs＝失敗結果IDsを必須にする。失敗結果ありは`failed`を最優先、失敗結果なしで未実行またはinfraありは`infrastructure-failed`、全selected実行・全pass・infraなしだけ`passed`とし、失敗2分岐だけfingerprintを必須にする。常設`webkit-safety-promotion` jobは0件ならWebKitをinstallせず`not-required`、1件以上なら全昇格testを実行して結果を`if: always()`相当で出力する。schema verifierとrelease aggregatorはstatus／commandを信頼せず集合、manifest mapping、優先順位を再計算し、advisoryで安全事故を検出した現在candidateの結果受渡し、次commitでのrequired昇格、release blockingをこの3契約へ固定する
- `infrastructureErrors`は`{ code, stage, testId: string | null }`のexact objectだけを許し、version付きJSON Schemaが`code`／`stage` enumを列挙し、message、stack、path、時刻を入れず`(code, stage, testId)`で重複排除・Unicode code point順sortする。`stableFailureFingerprint`はlowercase 64桁hexで、固定property順・空白なしの`{"schemaVersion":1,"artifactKind":...,"status":...,"failedSafetyTestIds":[...],"infrastructureErrors":[...]}`をUTF-8 encodeしたSHA-256とする。failed IDsもUnicode code point順のunique配列とし、observation／promotionで同じ`serializeFailureFingerprintV1` fixtureを共有する。fingerprintは診断上の同一失敗group化だけに使い、release可否、finding close、結果集合の代替authorityにしない
- FSMC専用required Playwright configにDesktop／Mobile Chromiumの2 projectを、別advisory configにWebKitを作る。requiredはUbuntu 24.04、Node 24.19.0、npm 11.19.0、lockfileのPlaywright／Chromium、workers 1、retries 0、`failOnFlakyTests: true`、`fullyParallel: false`、`trace: "retain-on-failure"`を固定する。Desktopの既定contextは1440×900・DPR 1・`isMobile=false`・mouse・touchなし、Mobileは390×844・DPR 3・`isMobile=true`・touchありとする。さらにDesktop project内の必須manifest testだけが`browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: true })`という固定`desktop-touch-context`を作り、`touchscreen.tap`で非スマートフォンtouch直接選択を検証する。第3 projectや別性能profileにはせず、default Desktop／Mobileとこの追加contextで選択test 0件を失敗させる
- 全jobの共通setupは`npm ci`とし、Chromium test runnerだけは加えて`npm exec -- playwright install --with-deps chromium`を必須にする。WebKit jobは11章と15章の専用install契約に従い、build／artifact verifier／aggregatorへ不要なbrowser installを要求しない。run-bound成果物は共通definitionのexact object `ciRun: { runId: decimal-string, runAttempt: integer >= 1 }`を必須にし、production／QA build manifest、required-results、WebKit observation、promotion resultの全てで、workflow runtimeが与えるcurrent run ID／attemptとのexact一致をaggregatorまで再検証する。`config/fsmc-build-artifact-manifest.schema.json`は`schemaVersion`、`ciRun`、`buildPurpose: production | qa`、完全source SHA、lockfile SHA-256、readiness、相対output path、canonicalな全file path＋byte SHA-256、artifact全体SHA-256を必須にする。build jobはproduction／QAを別directoryへ1回だけ生成してmanifestと共にcurrent runへuploadし、別jobはcurrent runだけからdownload後に全hash、`ciRun`、source SHA、`buildPurpose`、期待readinessを検証してから`*:prebuilt`を実行する。欠落、上書き、別run／別attempt／別source／別purpose artifactの取り違えを失敗させる
- `config/fsmc-required-results.schema.json`は`ciRun`、source SHA、implementation-state／test-manifest SHA、currentPhase、readiness、production artifact SHA-256、`qaArtifactSha256: string | null`、manifestから導出したartifact purpose別selected test／scenario ID、実行済みID、`{ id, command, artifactPurpose: "production" | "qa", result: "passed" | "failed" }`、failed ID、infrastructure error、`status: "passed" | "failed" | "infrastructure-failed"`をexactに持つ。I0／I1／release-ready I11はQA hashをnullかつ全result purposeをproduction、I2～I10と`currentPhase = I11 && readiness = internal-testing`はQA hashを必須にし、production guardはproduction、機能／性能testはQAへexact分類する。selected IDsはtest manifestの`releaseScope = initial-release && enforcedFromPhase <= currentPhase && status != planned`を満たす該当purpose集合とし、全status分岐でresult IDを重複禁止、`executed IDs = result IDs ⊆ selected IDs`、各`result.command = selected manifest entry.requiredCommand`、failed IDs＝failed result IDsを必須にする。失敗resultありを`failed`、失敗0件で未実行またはinfraありを`infrastructure-failed`、全selected実行・全pass・infra 0件だけを`passed`と再計算し、選択0件、future scope／planned／未選択IDのresult混入、IDに対するcommand欠落／差替え／曖昧対応、自己申告status矛盾を拒否する。各resultが参照するartifact hash、buildPurpose、source、readiness、phase、`ciRun`、`requiredCommand`をdownload済みmanifestとcurrent workflow runtimeから再計算し、別run／別attempt、stale QA、production／QA取り違え、resultだけのhash／run／command自己申告を拒否する
- `config/fsmc-traceability.json`と`verify:fsmc:i0`を実装し、schema、fixture hash、fixed A、test membership、phase ownership、readiness、production override不在を一括検証する。該当test 0件、重複ID、owner不在、`--passWithNoTests`相当を失敗させる
- 固定job／status `fsmc-required-gate`と`verify:fsmc:phase-gate`を実装し、`contracts-only`／`internal-testing`のmerge判定と`release-ready`の`verify:fsmc:release-readiness`呼出しをsource stateだけで切り替える。既存branch-protected終端contextの`needs`へ接続するか、証明不能時は`config/fsmc-ci-gate.json`のRepository Maintainer one-time setupをI0 Exitまでに完了する。全readiness値、phase境界、state／artifact不一致、`releaseScope = future`のtestをpre-release／release candidateで省略するcaseと、そのresultを初版gateへ混入するnegative caseをcontract testにする
- Critical／High severity、初版／後続版、外部証跡なし、`PD-18`の部分欠損と完全消去の保証境界、advisoryで見つかった安全事故のrequired昇格・解消手順をADRと利用者文書雛形へ固定する

Exit:

- `npm run verify:fsmc:i0`、production artifact作成後の`npm run verify:fsmc:i0:prebuilt`、`npm run test:fsmc:i0:prebuilt`、固定旧版A hash／起動smokeが成功し、Desktop／Mobile各projectの選択test数が1件以上である
- `config/fsmc-implementation-state.json`の`baselineSourceSha = 2eaba922816e8b263c6479e81ab9f265321654b2`、着手前に一度固定した`i0StartHeadSha`、`currentPhase = "FSMC-I0"`、`readiness = "contracts-only"`がschemaに合格する。`baselineSourceSha..i0StartHeadSha`の全変更file、契約影響、既実装FSMC範囲をinventoryへ記録し、I0実装commitを理由にbaselineまたは`i0StartHeadSha`を追更新しない。固定旧版Aとは混同せず、manifestの全hashが一致する
- readinessは`contracts-only`で、production DB、runtime UI、business保存動作を変更せず、production artifactにQA override経路がない
- 全schema／fixture／configがversion付きverifierに合格し、番号・CAS・control・identity・collision repair allowlist・fingerprint・retention・Backup・geometry、atomic `Vcap` bootstrap、3分岐snapshot、authority別candidate配列、物理内容witness、absorption projection、root policy／lossless candidate vector付きhistorical evidence／全historical row digest／participant digest／全root baseline、legacy candidate transition manifest、exact rebase participant集合、legacy core transition classifier、transaction内async hash禁止、WebKit safety observation／promotion／required-resultsの選択集合包含・ID→required command一意照合・status再計算・current `ciRun`一致、release-readyでinitial safety未実装またはQA-only残存を拒否するcontract testが実行される
- `releaseScope = future`のscenarioは`planned`か契約だけを固定した`contract-enforced`で担当phaseとtest IDを持つが、初版のselected／executed／failed集合、planned残存違反、`implementation-enforced`、成功済みへ混入していない。初版requirement／PD／DoDに紐づくentryは全て`initial-release`である
- 固定旧版AのV1 unknown／anchor保持・欠落matrixと自己動作が実測済みで、旧版Aのhealthy legacy-mutable-core-only更新、candidateの正常吸収／追加と不正消失／差替え、anchor欠落／重複、衝突、fence／capability破損を区別するrebase fixtureと全barrierがI2／I11へ割り当て済みである。新版Bによるanchor保持、DB fallback、atomic command、Backup V2、UI、性能もI2～I11のExitへ割り当てる
- FSMC性能configの全製品上限、profile、測定法、適用phase、runner provider／class、immutable image、architecture、kernel、CPU allowlist、logical CPU／cgroup quota、memory／swap、isolation、calibration fixture／許容bandが非nullで、環境不一致を製品性能失敗と混同せずinfrastructure failureにするverifierが合格する。既存の外部証跡用`config/performance-budgets.json`を変更・参照しない
- `fsmc-required-gate`がpre-release stateでは現在phaseまでを`phase-gate-passed`にできる一方で公開可能と表示せず、`release-ready` stateでは全I0～I11と`verify:fsmc:release-readiness`なしに成功しない。既存required終端contextとのdependencyまたはone-time required設定をread-only commandで確認し、context名とbranch protectionをphase／findingごとに変えない
- `PD-01`～`PD-18`の全行がtraceability verifierでowner phase、fixture、test、利用者文書または非対象理由へ追跡できる

### FSMC-I1: 共通ドメイン

実装:

- `spaceNumber.ts`
- `splitGeometry.ts`
- `EventEnablePreflightResult`のpure判定と、衝突一覧・原文・修正案を返す副作用なしvalidator。control／DB commandへの接続はI2が所有する
- `MapLocationIndex`、item resolver、空側対応hit-test、DOM列挙API
- 通常／集中モード共通viewport adapter
- `layoutMode`から独立した`isSmartphoneSelectionMode`判定と、`none | single | ambiguous`を入力別閾値へ結ぶinteraction policy
- mapped／mapless／legacy-unresolvedの`SpaceIdentity`、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、各canonical keyの型・正規化・生成契約
- exact番号grammar、巨大`BigInt`化前の桁数／辞書順safe integer検査、`mapped | mapless | legacy-unresolved | ambiguous` resolver
- 1-based `GridCellAddress`、整数`PathNode`、0-based連続`MapPoint`、結合セルbounds、routing adapter
- map-level authoritative fingerprint、entry-level block／location fingerprintと通常編集planner
- `SpaceSideIdentity`、`ResolvedRouteVisitPoint`、`SplitRouteSegment`、`RouteResolution`
- 分割線境界と低表示サイズ判定
- 表示用原文と識別用番号の分離
- 同一ブロック内の重複番号と重複物理`(row, col)`を配列順で解決せず対象外／`map-data-untrusted`にするvalidation
- 重複block ownership、merge越境、重複mergeを対象外にするvalidation

Exit:

- 4方向、分割なし、全番号パターンのunit testが合格
- 描画とhit-testが同じgeometry結果を使用する
- 回転前後で同じ地図領域を示すproperty testが合格
- preflight衝突0件では`01a`と`1a`が同じlocationへ解決され、衝突ありではpure `EventEnablePreflightResult`が`reject`と衝突原文・修正案を返してlegacy identityを維持する。I1ではruntime enable command成功／失敗を主張しない。`26c`／`26c2`と`26d`／`26ab`は相互に異なるidentityとなり、safe integer外や不正文法を数値化しない
- 商品なしのa/b側をhit-testとDOM列挙の両方で解決でき、`whole`／unsupportedを「側未設定」と列挙し、重複番号・領域競合・merge越境を推測処理しない
- maplessとlegacy-unresolvedを共有訪問projection用identityとして維持し、`MapLocationIndex`、geometry、hit-testへ架空のmap／block／cellを渡さない
- 狭幅Desktop profileと`desktop-touch-context`は非スマートフォン規則、Mobile Chromium profileは全倍率pickerとなり、mouse／touchの閾値・曖昧帯の直前／一致／直後と0／45／90度のscreen空間順・DOM順・読み上げ順が固定期待値に一致する

### FSMC-I2: ローカル制御、DB capabilityと保存基盤

実装:

- I0のcapability decision tableと固定旧版A試験が`Vcap = 6`を許可し、既存DBでは外部`E0/E1`と全非fence root payload／metadata／checkpoint／全potential IDB candidate selectorの`H0/H1`がexact一致し、versionchange transaction内でもsplit対象導入trace 0件の場合だけ`DB_VERSION=6`を採用する。新object store、`data`／`control`初期payload、legacy-mutable-coreは`H1`・new data／controlは同一factoryのcanonical after-image・fenceはhistorical rowなしとする合成post-state、その全行digest、data／control participant digest、全`FSMC_GOVERNED_ROOTS_V1`のexternal baselineを持つinitial fence、3 rootのmetadata／checkpointを同じ`onupgradeneeded` versionchange transactionで作成する。新規DBは同transactionの単一factoryが全non-fence root writeとevidenceへ同じcanonical値を供給する。許可しない場合は本phaseを停止して別の一方向導入証跡をDB方式ADRへ固定する
- split対象導入traceなしの`dbVersion < Vcap`だけを`core-only`、完全rootを`map-cell-split-v1`、`dbVersion >= Vcap`のstore／root欠落・非互換または`dbVersion < Vcap`のsplit対象導入traceありを`map-cell-split-recovery-required`とする3分岐capability fallback。通常core metadata／checkpoint／candidateだけをsplit導入traceへ数えない
- `MapCellSplitSettingsRoot`、別keyの`MapCellSplitControlRoot`、association registry、active／retained entry、schema validation
- `FsmcPersistenceSnapshot`の3分岐union、`(storeName, key)`ごとのfull observed root＋checkpoint＋authority別の型・配列へ分離したidentity／物理location／物理内容witness／absorption projection付きcandidate観測、root policy／lossless candidate vector付きtotal historical evidence／全historical row digest／participant digest／全governed root baseline付きexternal fence、inventory上の全potential candidate storeを空でも同一transactionへ含める専用atomic commandを持つrepository、facade、PersistenceCommandPort
- 固定旧版Aのcandidate差分を`config/fsmc-legacy-candidate-transitions.json`のexact state transitionへ対応付けるclassifierと、`rebaseParticipantRoots = sort(unique(changed legacy roots ∪ {data, control}))`だけをparticipant digestへ入れ、同じ集合のhistorical rowだけを置換するlegacy rebase writer
- 初期読込、autosave、再試行、更新ブロッカー
- recovery state、atomic restore
- 現行CASへの参加と複数タブ競合表示
- `SplitMapLocalControlPort`、端末全体OFF、event別enabled、常時利用可能なpreview／enable／disable command、同一profile内のcontrol CAS
- I0の`NormalizationCollisionRepairPort` allowlist dispatcher。I6／I7がowner commandを`implementation-enforced`にするまでは対応command IDと通常identity writerを`repair-command-not-implemented`で明示拒否し、通常writerを修復経路として代用しない
- pure `classifyLegacyCoreTransitionV1`と、利用者向けrepair allowlistから独立した内部`fsmc.internal.rebase-legacy-core.v1`を実装する。全legacy-mutable core、inventory上の全potential candidate物理store、settings、control、fenceを同一transactionでlock・再読込し、healthyな旧版差だけについてassociation／statusとfence history／baselineを原子的に進める。coreとstored enabled membershipを変更せず、authority正常な`rebase-required/pending`に限りdevice／event／readiness状態に依存せず実行し、完了までsplitをlegacy fallback／read-onlyとする。recovery-required安全モードでは実行しない
- 初回event enableに必要な既存event／day-map／block slotへのローカルinstance ID、empty-source metadata anchor、registry associationを一意なcurrent coreから同一transactionでbootstrapする最小経路。I3はこの共通APIを全event lifecycle writerへ拡張する
- DB／store／root／association authority不正は自動安全モード、個別binding不正はentry単位隔離とする。OFF時はsplit固有部分をlegacy resolver・保存・UI経路へ戻すが、`PD-14`の共有訪問projection・挿入・経路修正は常時適用する
- 初期controlはdevice OFFかつevent ID一覧空とし、readinessを`internal-testing`へ進める。production enableを拒否し、QA buildだけが後続testでONにできる
- 初期索引と15,000件schema validationのDesktop／Mobile性能scenarioを本phaseから強制する

Exit:

- `Vcap = 6`採用時、通常core traceだけのDB5は採用可能性を維持する一方、split対象traceが外部precheckまたはversionchange transaction内で1件でもあればwrite 0件でupgradeを拒否する。採用時は既存storeの値とchecksumが不変で、新storeの`data`／`control`、lossless candidate vector付きtotal historical evidence、全historical row digest、participant digest、全governed root baseline付きinitial fence、3 rootのmetadata／checkpointが同じversionchange commitに存在する。external `E0/E1`差はupgradeをwrite 0件でabortし、commit直前abortはDB5・storeなし、commit直後から`onsuccess`前の終了はDB6・全初期3 rootありとなる。`E2`差がhealthyなlegacy-mutable coreだけなら全new DBからrebaseし、それ以外は全new DBの`committed-recovery-required`となる。通常起動で空store／fenceなしを作らない
- `Vcap = 6`採用時、旧版がDB6を開いて従来データを読み書きできる
- 固定旧版Aの実行中は新storeのchecksumが変わらず、新版Bへ戻した起動境界でだけroot policyに従うrebaseまたはrecovery判定が行われる
- 固定旧版Aのanchor保持改名・通常状態更新は`rebase-required`となり、同じanchor／bindingの設定bytesとstored ONを維持したままfenceを更新してactiveへ復帰する。anchor消失はdormant、同anchor複数はquarantined、旧版編集で作られた衝突はstored ONを保つevent単位effective fallbackとなり、別ownerへの自動接続とdurable state削除が0件である
- `Vcap = 6`採用時、DB6／DB7の新store欠落・空store・片root／metadata／checkpoint欠落・非互換、fenceの埋込全historical row digest／participant digest／candidate vector自己不整合、root universe／capability-owned baseline不一致はsplit痕跡の有無にかかわらず`map-cell-split-recovery-required`となり、DBを変更せず従来機能、分割機能利用不可理由、Backup復旧案内を提供する。healthyなlegacy-mutable core差はこの不一致へ含めない。DBなし／DB5かつsplit対象導入traceなしだけを`core-only`とし、各snapshotで禁止fieldが存在しない
- `Vcap = 6`採用時、DB6／DB7互換storeありは3 snapshotの該当分岐、DB8以上はsnapshotを構築しない`unsupported-database-version`としてconnection close・authority非採用・write 0件となる
- `dbVersion < Vcap`のcore-only profileは現行core autosave契約を維持してsplit commandを登録しない。split-capable profileは制御commandを常時登録し、機能mutationだけをeffective ONで許可する。地図・association・split binding・control・イベント復元は必要rootを原子的にcommitし、片方だけのcommitを起こさない
- 新storeの保存失敗が未保存表示とPWA更新抑止へ反映される
- 同時writerのstale保存が`PersistenceConflict`となり、部分commitとlast-write-winsが起きない
- 既存fenceと全governed rootのexternal E0が不一致、またはraw string exact比較でE0→E1が変化した場合、差がhealthyなlegacy-mutable coreだけなら通常commandをwrite 0件で止めて`legacy-rebase-required`へ送り、それ以外は`PersistenceConflict`／recovery-requiredとする。IDB commit後・UI ack前のE1→E2差もlegacy-onlyなら全new IDB root＋fenceを維持した`committed-legacy-rebase-required`、それ以外は`committed-recovery-required`とする。IDB candidateは表示上のsourceや現在件数でscopeを決めず、inventory上の全potential物理storeを空でもtransactionへ含めて再読込する。pre-transaction canonical bytesとの同期exact比較でempty→insertとidentity／location／physical content／projectionのstaleを全abortし、transaction内で非同期hashを待たない。別scope commandで非参加historical row／baselineを失わず、未保存／rollbackと誤表示しない
- DB契約、検証script、integration fixture、性能test configが同じversion契約を示す
- `verify:architecture`が合格
- DB capability正常、端末全体ON、対象event ON、自動安全モードなしに加え、`release-ready` production、または`internal-testing`かつcompile-time QA overrideを持つnon-promotable QA artifactの場合だけsplit mutationが成功する。`contracts-only`／`internal-testing` productionはcontrol rootがONでも拒否する。event OFF→ON preview／commandとOFF commandはOFF中にも利用できる
- I1の`EventEnablePreflightResult`をevent OFF→ON transactionへ接続し、既存の通常eventとempty-source eventの両方で必要なinstance ID／anchor／associationをI2 bootstrapが原子的に作る。衝突ありではcontrolをONにせずcore、settings、association、metadata、checkpoint、物理location付きrecovery candidate vector、fence baselineを全て旧状態に保ち、衝突原文と修正案を表示する。preview後のroot変更も再検査してstaleなら全abortする
- device OFF中にlegacy編集で一部enabled eventへ衝突を作った後にdevice ONへ戻すと、device ON自体は成功し、衝突eventだけがstored membershipを維持したeffective fallback、他のenabled eventがeffective ONになる。I2時点では未所有の3修正commandと通常identity writerを明示拒否し、syntheticな「修正成功」を主張しない
- 端末全体OFF／event OFF、別タブによる制御revision変更、再起動、オフラインで固定期待値どおりになる。オフラインだけを理由にOFFへしない。authority正常なlegacy rebaseはdevice／event OFFとreadiness不足でも完了でき、recovery-required安全モードではwrite 0件で拒否される
- payload／metadata／checkpoint／fallback／物理location・物理内容witness・absorption projection付きrecovery candidate vector、fenceのhistorical evidence／全historical row digest／participant digest／root universe／capability-owned baselineの部分欠損・変化と、`dbVersion >= Vcap`の全record削除済み空storeを未初期化と誤認せず、`map-cell-split-recovery-required`またはCAS abort、誤接続なし、Backup案内となる。`migration-journal`／archiveを含むinventory上の全potential IDB storeは現在空でも同一transactionで再読込し、empty→insertとexternal差を全governed rootで検出する。同じidentity／locationのraw DOMString-only／IDB record-content-only変更はmanifestのexact transitionだけをrebaseし、未列挙・曖昧・projection-only改変はrecovery-requiredとなる。legacy rebase fenceはexact `rebaseParticipantRoots`と同じhistorical rowを置換し、data／controlを常に含め、余分・欠落・重複participantを拒否する。DB5→`Vcap`では`H0`後に旧tabがpayload／metadata／checkpoint／candidateのいずれかを変えれば`H1`不一致で最初のwrite前に全abortし、transaction内async hashを使わない。healthyなlegacy-only差はrebaseへ限定し、空rootやfenceを再作成しない。全profile消去だけは新規の空profileとしてversionchange内に完全初期rootを作り、device OFF、enabled event ID 0件でclean-startする
- control変更中、QuotaExceeded、通常commandの各failure barrierのcommit前abortでは全root旧状態、commit後・UI通知前の終了では全root新状態となり、部分commitがない。legacy rebaseのR0→R1差はwrite 0件で再判定し、commit前abortではcurrent core＋rebase前fenceの`legacy-rebase-pending`、commit後終了ではcurrent core＋new fenceだけとなる。R1→R2の追加healthy legacy差は次のrebase、capability-owned／分類不能差はrecovery-requiredとなり、次回境界でも同じ決定結果になる
- OFF時のsplit固有表示、番号identity、whole-cell位置解決、core保存結果は固定旧版Aに一致する。DB version、capability store、read-only split payload、optional `EventMetadata.splitIdentityAnchor`、`PD-14`の共有訪問projection・挿入・経路、重複物理cellを新規作成するimport／通常編集after-imageの原子的拒否、既存重複の`map-data-untrusted`判定／map単位route停止だけを許容差分とする。重複を作らない同一入力のcore保存結果と、anchorだけを正規化除外したlegacy-core checksum、それ以外の全core field、raw item ID・番号原文は一致させる
- 本phase担当のDesktop／Mobile性能上限を満たし、未担当scenarioを合格済みにしない

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
- イベント削除時の「30日保持」既定、即時完全削除、35日超の未観測進み・rollback・session内jumpで24時間確認を要求する期限cleanup

Exit:

- 新版での作成・改名・複製・削除が原子的
- 旧版で改名、削除、同名再作成後に誤接続しない
- 旧版がanchorを保持する操作ではIDを維持し、anchor欠落・重複時は名前や指紋だけで再接続しない
- 安全に識別できない設定は地図へ表示せずretained entryとして保持し、I5の管理UIから理由を確認できるbackendを提供して既存dataを壊さない
- 名前だけで再接続せず、端末内の手動再関連付けと明示削除が可能。設定単独出力の入口は初版に設けない
- D+29は保持、trustedなD+30は対象だけ削除、31日offlineは正常削除、36日offline・rollback・session jumpは24時間確認後まで延期する。再関連付けと削除はCASで原子的に行い、設定単独出力は提供しない
- source switch、bulk add、既存V1 full importがON中に新たな正規化衝突を作るfixtureで全root旧状態とONを維持し、未実装writer commandは明示拒否される

### FSMC-I4: イベント単位Backup V2とV1互換core

実装:

- イベント単位Backup V2
- V1 wire shapeの凍結、V2と同時出力するV1互換core、旧形式完全復元のdormant preview
- event `scope.references`とruntime snapshotから分離したcore wire type
- 単一eventRef＋全mapRefs、map-level fingerprint、active／retained portable union、companion V1 hash
- UTF-8 fatal decode、duplicate-property scanner、非再帰depth／token scanner、transferable Worker、bounded error、cancel cleanup
- 壊れた設定の原子的拒否
- イベント復元の全置換previewと、アイテムimport時の設定維持
- portable参照のローカルID remap、端末内ON／OFFの非収録、新規復元OFF、既存復元先状態維持
- 1主端末、復元先全置換、復元前退避案内、自動同期・自動merge禁止
- resource limitと過大入力の原子的拒否
- V1層別互換matrixを維持し、V2だけを全階層exact unknown-key rejectにする
- Backup V2 digestと未知version／未知scope拒否
- scope別exact core section tuple、`deriveEventBackupCountsV2`による実payload件数一致、retained `number`／`originalNumberToken`整合、active／retained owner overlap拒否
- event保証上限超過時は出力を停止し、読めないファイルやmultipartを初版で生成しない
- 全参加storeの単一readonly transactionから`SplitCapableEventExportSnapshot`を1回だけ作り、V2／V1を同じsnapshotから生成する。export途中のDB再読込、cross-revision pair、V1／V2 coreの不一致を拒否する
- `__proto__`／`constructor`／`prototype`を利用者名として安全にround-tripするdynamic key処理
- UIで`File.size`を検査してから全体読込を行い、`arrayBuffer`／UTF-8 byte decode後のBackup解析をWorkerへ移す
- Backup import／exportのDesktop／Mobile性能scenarioを本phaseから強制する
- event ON中のimport／restore after-imageが正規化衝突を新たに作る場合の`PD-16`全拒否

Exit:

- V1と地図を含むがsplitを含まないV2を読め、map置換では対象の既存split設定をpreview後にdormant化し、item-only importでは維持する
- 複数地図eventのV2で4方向とactive／dormant／quarantinedを往復でき、V2がSHA-256で拘束したexact V1互換coreを固定旧版Aへ復元できる
- 簡易XLSX・CSVに分割設定が含まれない
- mapDataを置換する復元だけが設定を同時に置換またはdormant化し、item-only importでは設定checksumが不変
- external refをローカルinstance ID／`priorOwner`として採用せず、未解決entryには新しい`dormantEntryId`を発行し、不正参照・hard limit超過をDB更新前に拒否する
- 形式不正は全体拒否し、復元先不一致だけをdormant／quarantinedとして保持する
- V2 digest不一致、未知version、未知scope、local ON／OFF fieldを拒否する
- `full-split`／`core-map`で現行`AppData`の対象event全10 sectionとevent settingsを欠落なく往復し、`item-only`は`eventLists`以外のdata sectionを拒否する。3 scopeそれぞれでmaps／blocks／items／active／retained countを実payloadから再計算し、正しいdigestでも過少・過大自己申告、`scope.references`水増し／省略をDB更新前に全体拒否する。retained number／token不一致とactive／retained overlapも全体拒否する
- 保証上限内の自アプリ出力をround-tripでき、超過時はファイルを生成せず理由を表示する
- clean profileへの新規復元はOFF、既存イベントへの復元は復元先のローカル状態を維持し、両端末の変更をmergeせず選択したV2へ原子的に置換する
- 本phase担当のDesktop／Mobile性能上限を満たし、pair片方のhandoff失敗を完了扱いにしない
- ON中に衝突を作るimport／restoreはcore、settings、association、controlを一切変更せず、復元先eventをONのまま維持して衝突原文と修正方法を表示する
- 同時writerを挟んでもV1とV2が同一snapshot revisionを表し、明示transform以外のcore差がなく、片方だけを別revisionから再生成しない

I11でreadinessが`release-ready`になるまで、production利用者が分割設定を作成できるUIとenable commandを公開しない。

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
- current owner＋番号のretained履歴を通常設定・copyから除外し、選択したretainedを元entry除去と新active作成の単一commitで再関連付けするplanner
- `CellSplitDefinitionPanel`の作成・解除・copy mutationはevent OFF／安全モードで到達不能とする。一方、DB／root authorityが信頼でき、device ONかつevent OFFの場合は、有効化previewと専用CAS commandによるretained entryの再関連付け／明示削除へ到達できる。association／root authorityを信頼できない自動安全モードでは管理画面をread-onlyにしてBackup復旧だけを案内する。recovery commandは通常split mutation gateと分離し、productionでは`release-ready`まで全導線を非公開にする
- 一括設定・copy previewのDesktop／Mobile性能scenarioを本phaseから強制する

Exit:

- preview取消で変更なし
- 部分不一致は適合箇所だけ適用
- 保存失敗時に全対象が旧状態へ戻る
- 分割解除でアイテム番号を変更しない
- 重複番号セルへ設定を保存できず、対象外理由を表示する
- 「追加・変更のみ」ではコピー元未分割・コピー先分割済みを維持し、「完全同期（解除を含む）」だけが「解除」と表示して確定時に解除する。dormant／quarantined元は解除に変換しない
- コピー先の同owner＋番号にretained履歴があれば両copy modeで除外理由を表示し、履歴と重なるactiveを作らない。明示再関連付けだけが選択retainedをactiveへ原子的に状態遷移し、取消・stale・失敗時は元retainedだけが残る
- 端末全体OFFではsplit管理導線を閉じる。device ON・event OFF・authority正常では有効化previewとretained再関連付け／削除だけを許可し、definition／copy mutationを拒否する。自動安全モードではread-only診断とBackup案内だけを許可し、UIからローカル制御gateを迂回して保存commandを呼べない
- QA buildで全UI試験を完了するが、production navigationとenable commandはI11まで非公開のままである
- 本phase担当のDesktop／Mobile p95、main-thread task、memory上限を満たす

### FSMC-I6: 地図再取込と通常地図編集

実装:

- 分割継承plan
- 一意一致と除外理由
- 確定前プレビュー
- mapDataと分割設定の単一commit
- ブロック改名・移動・`cellGroups`・番号・merge変更・同名置換のmanual edit plan
- event ON中の通常編集・再取込after-imageへ番号衝突が生じる場合の`PD-16`全拒否
- `NormalizationCollisionRepairPort`の`fsmc.repair.map-identity.v1` adapter。衝突fallback中は通常地図編集commandを開かず、同じmanual edit planを明示repair previewからだけ渡す

Exit:

- セル移動後もブロック名＋番号が一意なら継承
- 重複・欠落・曖昧候補は継承しない
- 取消・例外時は地図と分割設定がともに旧状態
- 除外設定は削除せずdormant／quarantinedに保持し、誤接続しない
- 無関係な地図変更では影響外entryをactiveのまま維持し、一意移動はevidenceとanchorを更新、欠落はdormant、曖昧・領域競合は対象entryだけをquarantinedにする
- 旧版による地図変更を新版起動時に検出した場合は、I2のlegacy core classifier／rebaseでanchor、binding、衝突を先に再検証する。強いevidenceで同一ownerへ一意一致するentryだけを決定規則どおり維持し、名前だけの自動rebindは行わない。dormant／quarantinedから別ownerへ再関連付けする場合だけpreviewを要求する
- ON中に衝突を作る編集・再取込はmapData、settings、association、controlを一切変更せず拒否し、eventはONのまま、衝突原文と修正方法を表示する
- `fsmc.repair.map-identity.v1`はlatest rootの`C(after) ⊂ C(before)`だけを原子的に確定し、pair swap、同数置換、新規pair、選択外変更、stale previewを全拒否する。完全解消時は同じcommit後に対象eventだけがeffective ONへ戻り、未解消ならstrictに減ったpairを表示してfallbackを継続する

### FSMC-I7: 既存データidentity migrationと共有訪問投影

実装:

- 基準source `2eaba92`に部分実装済みの`PD-14`共有訪問projectionをconformance auditし、未適合writer／画面／経路を補完する。FSMC-I1で固定済みのmapped／mapless／legacy-unresolved `SpaceIdentity`、番号正規化、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、canonical key APIを全既存dataと利用箇所へ適用する
- raw実行商品ID配列をglobal sortせず、非連続な同一`ExecutionVisitIdentity`を配列全体で集約し、legacy dataの初回は最初の商品位置、以後はidentity単位で保持したorderをbase訪問位置にする共有projectionを実装
- 日程、ブロック、番号、side、優先度編集でidentityが既存destinationへ変わる場合の、変更itemだけをdestination member末尾へ移す決定的rekey plannerと、item ID対応から現在・保存位置の`PhaseVisitIdentityKey`を再解決する処理
- normalは全実行商品、後回し・遅参は追加phaseとしてbase順から生成し、1商品が複数phaseへ属せる共有projectionを通常マップ、集中モード、`MapVisitList`、経路へ提供
- 通常の実行列・候補列と同じ優先度別グループ規則への統一
- 既存訪問順、後回し、遅参データの互換変換
- item ID anchorによる現在位置、保存位置、execution／phase visit-key依存状態の決定的migration
- memory-only `FocusModeSessionState.lastPurchaseChangeAt`相当は商品IDから新`PhaseVisitIdentityKey`へexact 1件再解決できる場合は移し、0件または複数件なら`null`へして理由を利用者へ通知する。解決不能値を架空visitへ接続せず、再解決可能値を一律破棄しない
- unsupported番号tokenを含む既存訪問migrationと、item／row-col中心の経路点から`PhaseVisitIdentity`中心のroute型への変換
- `ProjectedPhaseVisit`ではmember商品IDをpayloadとして保持し、代表item IDをvisit identity、route、hit-test、挿入anchorへ流用しない
- event ON中の商品編集・item import after-imageが新しい正規化衝突を作る場合の`PD-16`全拒否。自動OFF、部分適用、黙示skipを行わない
- `NormalizationCollisionRepairPort`の`fsmc.repair.item-numbers.v1`、`fsmc.repair.orphan-visit-state.v1`、I6の地図修正をまとめる衝突修復UI。孤立状態破棄は選択`PreZeroIdentityKey`のcurrent item参照0件をcommit内で再検証し、変更・破棄内容を明示previewする

Exit:

- preflight衝突0件の`01a`と`1a`だけが同じ半領域anchorへ解決され、衝突時は機能ONを拒否してlegacy identityを維持する
- 同じ側・同じ優先度は1つの`ExecutionVisitIdentity`へglobal集約され、進行区分ごとに別`PhaseVisitIdentity`へ投影される
- 同じ側でも優先度が異なれば別execution／phase訪問として維持される
- raw `[A1, B, A2]`を並べ替えず、全画面と経路ではnormal `[A(A1,A2), B]`へ一致して投影する
- A1を既存B identityへ変更した場合、B訪問位置と他itemの相対順を維持してA1だけをB member末尾へ移し、変更元visit、現在位置、保存位置、phase集合、経路の`PhaseVisitIdentityKey` anchorを決定的に再解決する
- 投影済みvisitの先頭memberを削除しても同じidentityのmemberが残る場合は、同じ`PhaseVisitIdentityKey`、訪問位置、座標、経路順へ再解決する
- `01a`と`1a`の既存訪問が衝突0件で安全に統合できる場合も商品・raw順・後回し・遅参を失わない。item、保存済み訪問・順序・進行状態等のdurable stateは自動破棄0件とし、破棄できるのは`fsmc.repair.orphan-visit-state.v1`で利用者が選択しitem参照0件を再検証した対象だけとする。再計算で捨ててよい非永続状態は未commitのprojection、route cache、hover／tap candidate、未確定preview、および商品IDへ一意再解決できないmemory-only `lastPurchaseChangeAt`に限定する。`lastPurchaseChangeAt`は一意なら新`PhaseVisitIdentityKey`へ移し、不能／曖昧時だけ`null`と理由通知にする
- FSMC-I8以降が確定済みidentity APIだけを利用できる
- OFF切替でsplit identityをlegacy keyへ永続的に破壊変換せず、ON復帰時に商品ID・順序から決定的に再構築できる
- mapped、mapless、legacy-unresolvedの訪問が通常／集中／一覧／routeで失われず、mapped以外に架空の地図位置を与えない
- event ON中の商品編集・item importが新しい正規化衝突を作る場合は全store書込み前に操作全体を拒否し、core、settings、association、metadata、checkpoint、control ONを旧状態に保って、衝突原文と修正方法を表示する
- 3つのallowlist commandだけが衝突fallback画面から到達でき、全て同じ`ExpectedRootVector`、`previewDigest`、期待`C(before)`を再検査する。item修正、map修正、item参照0件の孤立訪問状態破棄の各fixtureでstrict decreaseだけが成功し、pair swap、同数置換、新規pair、stale、選択外変更は全root旧状態となる
- 修正後もpairが残ればstored enabledを維持したeffective fallbackと残件表示を継続し、`C(after) = ∅`のcommit後だけ対象eventが自動でeffective ONへ復帰する。他eventのeffective状態、split設定、選択外item／訪問状態を変更しない

### FSMC-I8: 通常マップ

実装:

- locationKey単位の状態索引
- I7の共有`PhaseVisitProjection`を通常マップ、route hit-test、`MapVisitList`の唯一の訪問入力にする
- 半領域描画、分割線、正立する条件付きラベル、`LocationPresentationState`
- スマートフォン常時picker、非スマートフォン入力別閾値direct hit、曖昧時no-op案内
- 狭幅PCを含む端末判定adapterと利用者override
- 共通Pointer gesture state machine
- 側別ポップアップと追加処理
- `whole`／unsupportedの「側未設定」中央badge、一覧、編集導線
- 地図訪問一覧のa/b対応
- 選択、候補、現在位置等の全overlayを共通geometryへ移行
- 最大fixture初回描画、5秒pan／zoom／rotation、tap→picker／popupのDesktop／Mobile性能scenarioを本phaseから強制する

Exit:

- 26a操作で26bを開かない・変更しない
- 通常マップの既存色規則を維持
- 空側で正しい見出しと事前入力値を表示
- `26`／`26c`だけが存在しても左右クリックがアイテムなしになり、中央badgeとDOM一覧に「側未設定」が表示される
- スマートフォンは最大zoomでもpickerを使用し、非スマートフォンは閾値未満・曖昧帯で選択を変えない
- pan、pinch、pointer cancel、capture喪失、layout切替後にpopupを誤表示しない
- 本phase担当のDesktop／Mobile p95、main-thread task、memory上限を満たす

### FSMC-I9: 集中モード

実装:

- 共有`MapLocationIndex`、位置API、viewport adapterへの置換
- I7の共有`PhaseVisitProjection`への置換
- a/b別の購入状態・現在位置・次・前・一時位置
- 選択側へ絞った後、既存の参加日・実行リスト絞込みを行う側別ポップアップ
- 既存のセルポップアップ外枠、追加ダイアログ、`onAddItem`、`computeAddItemFromFocusMode`の流用
- 一時移動targetは既存の`SpaceIdentity`だけの集約を流用せず`PhaseVisitIdentity`単位で生成し、同じ側の異なる優先度・進行区分を別ボタン／別訪問として表示
- 現行どおりの「購入済」「後回し」「遅参」追加規則
- 実行リストまたはphase集合が変化した場合だけ共有projectionから訪問・経路を再計算
- 通常マップと同じviewport adapter、hit-test、pointer state machine、中立marker・訪問数badge・現在ring
- DOM panelはrow／col callbackではなく`ProjectedPhaseVisit[]`を入力し、`onSelectVisit(visitId, location)`で選択する。各行にpriority、phase、member件数を文字で表示し、同じanchorの別visitを区別する
- 集中モードの最大fixture描画・操作scenarioを本phaseから強制する

Exit:

- a側の購入更新でb側の色・件数が変わらない
- 実行リスト外の商品だけが存在する側も「今回の巡回対象なし」と表示する
- 追加画面に正しい日付・ブロック・`26a`または`26b`が入る
- 「購入済」の追加では実行リスト・正式現在地・経路が変わらない
- 「後回し」「遅参」の追加では該当日の実行リストへ入り、訪問列または座標signatureが変わった場合だけ経路が再計算される
- 既存A訪問へ後回しA2を追加してもrawの最初のA位置とnormal A位置は動かず、normal Aへ統合すると同時にpostponed Aをbase順で追加投影し、全画面で同じ通知を表示する
- 同じ側の異なる優先度・進行区分が一時移動targetでも別訪問になる
- 同じanchorの訪問をDOM一覧から別々に選択し、Canvasなしで一時移動・詳細確認できる
- 日程、ブロック、番号、side、優先度編集による既存destinationへの統合が通常マップ、集中モード、買い物一覧、`MapVisitList`、routeで同一結果となり、変更先訪問を移動せず通知する
- DOM panelの選択callbackが`PhaseVisitIdentityKey`とlocationを渡し、row／colや代表item IDへ縮退しない。priority、phase、member件数を読み上げられる
- 本phase担当のDesktop／Mobile p95、main-thread task、memory上限を満たす

### FSMC-I10: 経路と訪問集約

実装:

- `PhaseVisitIdentity`／`ResolvedRouteVisitPoint`単位の基準セル、routing port、anchor
- main pathと細い点線connector、同一セルa→b segmentの分離
- 自セル・結合セル領域内の決定的routing port、安全なconnector検証、`unroutable`、領域外BFS・未検証L字fallback禁止
- routable／unroutableの判別可能`RouteResolution`
- marker／main path／connectorのhit-test優先順位とvisit ID候補
- `pathfindingGraphFingerprint`を含むcache／signature更新
- I7の共有projectionを経路順の唯一の入力とし、同じexecution identityのglobal集約とphase別投影を維持
- route、marker／connector hit-test、挿入anchorを`PhaseVisitIdentityKey`で一貫して参照し、member商品ID列はpayloadとして扱う。座標・順序signatureへmemberの先頭IDや件数を混入させない
- 異なる優先度を別訪問として保持
- 手動順と、手動順がない場合だけのa→b自然順
- DOM訪問一覧は`ProjectedPhaseVisit[]`を受け取り、priority、phase、member件数を表示する。同anchorの別visit選択は`onSelectVisit(visitId, location)`、「この訪問の後へ挿入」は`onInsertAfterVisit(visitId)`で渡す。ただし追加対象の`ExecutionVisitIdentity`がraw配列全体に存在しない場合だけ位置指定を適用する。既存execution identityがある場合は対象phaseが未作成でもbase位置を維持し、新しいphase entryだけをbase execution順から派生させる
- 単一active phaseあたり最大400訪問の経路再計算Desktop／Mobile性能scenarioを本phaseから強制する。全phase投影最大800を1本のrouteへ混在させない

Exit:

- a/bが別終点・別マーカーになる
- 同じ側・同じ優先度の複数アイテムはraw配列で非連続でも1つの`ExecutionVisitIdentity`になり、phaseごとに投影される
- 同じ側でも優先度または進行区分が異なれば別訪問になる
- 同じanchorの複数訪問は件数badgeとDOM一覧で存在・優先度・進行区分を確認できる
- 手動b→aが維持され、自動時だけa→bになる。phase別訪問は独立manual順を持たずbase execution順から派生する。既存execution identityへの位置指定追加は対象phaseの有無を問わずanchorを無視して既存base訪問へ統合し、「指定位置に新規訪問は作成しませんでした」と通知する
- 同一anchorの別訪問が経路順・進行状態・挿入候補として失われず、中立marker・件数badge・現在ringで表示される
- 先頭memberを削除しても同identityのmemberが残る場合は、route、hit-test、挿入anchorが同じ`PhaseVisitIdentityKey`へ再解決され、座標、順序、route cacheを維持する。member payloadだけを更新する
- 同一セルa→bが安全な場合だけmain pathなしの点線segmentとして表示・hit-testでき、connector追加で3×3 pathfindingのcostや重複penaltyが変化しない。安全でなければ`unroutable`となる
- `value`、`backgroundColor`、map寸法、結合領域、passability rule、解像度、cost定数の変更で`pathfindingGraphFingerprint`が変わり、古いroute cacheを再利用しない。重複物理`(row, col)`は配列順で解決せず経路を生成しない
- 本phase担当のDesktop／Mobile p95、main-thread task、memory上限を満たす

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
- `releaseScope = initial-release`の全performance scenarioを同一candidate buildのDesktop／Mobile profileで再実行し、対応traceabilityをすべて`implementation-enforced`へする。`future` scenarioは初版結果へ混入させない
- production bundleのreadinessを`release-ready`へ変更し、QA override不在と端末／event有効化導線の初回公開を静的検証する
- WebKit advisory runnerが通常表示／a11y結果と安全性tag結果を分離し、`if: always()`相当で`fsmc-webkit-safety-observation.json`を出力する。常設`webkit-safety-promotion` jobもregisterに応じた結果artifactを必ず出力する。release-readiness jobは同一source SHA・production artifact SHA-256の両artifact upload完了をDAG dependencyとして待ち、hash検証後に取り込む

Exit:

- Desktop／Mobile Chromiumの必須自動テストを通過
- データ消失、a/b混同、誤経路が0件
- 必須自動テストでCritical／High相当の既知失敗が0件
- Backup V2＋V1互換core、機能OFF／安全モード→ONの復旧、新規復元OFF、既存復元先状態維持を確認
- WebKit advisoryの通常表示／a11y失敗は必須Chromium jobと分離し、iPhone／ペン／OS・実機固有挙動を保証対象と表記しない。ただし同一candidateのWebKit safety observation欠落、hash不一致、`safety-failed`、`infrastructure-failed`、`requiredSafetyIds(state)`の現在必須ID未実行はrequired gateを失敗させる
- 必須Chromiumと通常advisory WebKitが別job／別scriptで実行され、WebKit browser未導入は必須Chromium job自体を失敗させない。release gateはadvisory observationと常設promotion resultを必ず待つため、初回安全事故をregister追加前にすり抜けさせず、branch protectionのrequired contextを動的変更しない
- 性能、PWA multiclient、backup、旧新版互換を通常のCI testとして実行し、外部receipt、実イベントpilot、managed-device artifactを要求しない
- 固定旧版Aのhealthy legacy-mutable-core-only更新は新版Bで自動rebaseして分割設定を正しいowner／statusへ復元し、capability-owned差、fence自己不整合、説明不能差はrebaseせず安全モードにする。rebaseのcommit前／後終了を含め、別ownerへの誤接続、durable state削除、部分commitが0件である
- candidateのraw DOMString-only／IDB canonical record-content-only差を物理内容witnessで検出し、固定旧版Aのexact transitionに一致する場合だけrebaseする。manifest外、曖昧一致、projection-only改変はBackup案内付き安全モード、通常command中の差は全store write 0件のCAS abortとなる
- `verify:fsmc:release-readiness`が`releaseScope = initial-release`の全requirement、owner phase、required test、performance budget、failure barrier、利用者文書と、production override不在を検証し、readinessが`release-ready`になる。`future` entryの未実装は初版失敗にせず、そのresult混入または初版entryのfuture誤分類は失敗にする
- advisory WebKitの通常の表示／a11y失敗自体はnonblockingである。ただし安全性tagがデータ消失、a/b混同、誤保存、誤復元を検出した現在candidateはobservationを`safety-failed`として必ずrelease停止し、次commitでstable finding IDを`config/fsmc-safety-findings.json`へ`status: "open"`で登録する。engine非依存に再現できる場合はunit／integration／Chromiumのrequired回帰testへ移し、WebKit固有で再現不能な場合はその最小WebKit回帰testをpromotion kind `webkit-temporary-required`へ昇格し、常設`webkit-safety-promotion` jobが実行する。`verify:fsmc:release-readiness`はcurrent-run observation異常、promotion result欠落／不一致／失敗、open finding、required command未実行、昇格test失敗のいずれかが1件でもあればrelease-readyを拒否し、修正・再現test成功・current-run observation成功・finding close後にだけ通常advisoryへ戻す

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

訪問fixtureにはraw実行商品ID順`[A1, B, A2]`を置く。raw順を変更せず、normal投影が`[A(A1,A2), B]`となること、A2を後回しにするとnormal Aの位置を維持したままpostponed Aがbase順で追加されること、通常マップ、集中モード、`MapVisitList`、routeが同じ共有projectionを使うことを固定する。

別fixtureとして、横長結合セル、縦長結合セル、非連続`cellGroups`、同形状ブロック、不一致ブロック、重複block ownership、merge越境、重複merge、同一`(row, col)`でvalue／backgroundが異なる物理セルを用意する。重複・競合は対応ケースではなく負例fixtureとし、保存・コピー・自動継承・経路生成から安全に除外されることを確認する。背景色だけの通行可否変更で`pathfindingGraphFingerprint`とroute cacheが変わる正例も固定する。

永続化・ファイルfixtureには、`EventMetadata`のないevent、複数map event、利用者名が`__proto__`／`constructor`／`prototype`のdata、V1層別unknown、duplicate JSON property、invalid UTF-8、深さ境界、3 scopeのV2、全scope共通`scope.references`、実payload一致／不一致`counts`、V2＋hash拘束V1、payload／metadata／checkpoint／fallback／candidate identity・authority・physical location・physical content witness・absorption projection／fence historical evidence・全historical row digest・participant digest・全root baseline／storeの部分欠損、同じexternal keyのlone surrogateだけが異なるraw DOMString、historical candidate external digestとbaselineの不一致、通常core traceだけのDB5、split対象traceだけのDB5、`H0`後に旧tabがcore root／candidateを変更するDB5、origin全消去、イベント削除D+29／D+30／31日／36日、時計rollback／session jump／24時間再確認を含める。固定旧版A fixtureにはanchor保持改名・通常状態更新、候補の一意な正常吸収／追加、吸収証跡なし消失、同一absorption projectionでlocationが異なる曖昧候補、anchor欠落、同anchor複数化、衝突作成、capability-owned差、fence自己不整合、説明不能なcore差、device／event OFF中rebase、rebase commit前／後終了を含める。ローカル制御fixtureは端末全体OFF、event OFF／ON、自動安全モード、個別entry隔離、別tabによるcontrol revision変更、offline、新規復元OFF、既存復元先状態維持、Backup内の禁止ON／OFF fieldを含める。さらに3.13の保証規模を同時に満たす最大fixtureを用意する。

### 10.2 必須マトリクス

| 観点              | 必須ケース                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分割              | なし、左a、右a、上a、下a                                                                                                                                                                                                                              |
| 番号identity      | 衝突なしpreflightで`01a`／`1a`／`０１ａ`が同一、衝突ありとOFFではlegacy維持、ON中の新規pair・同数pair swapは全拒否、厳密減少・完全解消、BigInt前safe integer／1 MiB境界、mapless／legacy-unresolved、unsupported分離、「側未設定」表示                |
| 訪問identity      | 非連続同一execution identityのglobal集約、同側異優先度、異側同優先度、normal＋後回し／遅参の追加phase、1 itemの追加phase高々1、最大400 execution／800 phase、raw手動順、既存identityへの挿入指定無視                                                  |
| 形状              | 通常、横長結合、縦長結合、非連続block、番号重複、重複block ownership、merge越境、重複merge、重複物理`(row, col)`                                                                                                                                      |
| 回転              | 0°、15°、45°、90°、180°、270°、359°、screen空間・DOM・focus順、a/b・badge文字の正立                                                                                                                                                                   |
| DPR               | 1、2、3                                                                                                                                                                                                                                               |
| 拡大・端末判定    | Mobile Chromiumは全倍率picker、狭幅Desktopは非スマートフォン、入力別閾値・曖昧帯の直前・一致・直後、空間順ラベル、利用者override、アプリ倍率、200%                                                                                                    |
| 入力              | mouse、touch、長押し、drag、pinch後の片指継続、Canvas外pointerup、Pointer Cancel、lost capture、画面回転、layout切替                                                                                                                                  |
| 状態              | 空、巡回対象外、未処理、処理済み、後回し、遅参、後回し＋遅参二重指定拒否／既存診断、優先度混在、同側複数件                                                                                                                                            |
| 集中追加          | 購入済、後回し、遅参、実行対象外のみ、空側                                                                                                                                                                                                            |
| 編集              | 単一、複数、一括解除、既定の追加・変更のみ、明示的完全同期、コピー先ID維持、retained overlap除外・手動再関連付け、履歴保護、解除preview、非連続block、manual改名・移動・同名置換、取消、保存失敗                                                      |
| 再取込・通常編集  | 無関係変更、一意移動、欠落、重複、結合範囲変更、旧版変更検出、休眠・隔離、取消                                                                                                                                                                        |
| DB互換            | DBなし、DB5、`Vcap` witness、DB6／DB7互換、DB6／DB7 store欠落・痕跡なしでもpartial-loss、DB6／DB7不正store、DB8、fence自己不整合、capability-owned差、healthy legacy-mutable core差のrebase                                                           |
| ローカル制御      | 端末全体ON／OFF、event ON／OFF、自動安全モード、device OFF編集後の一部event fallback、制御revision競合、commit直前OFF、再起動、オフライン、Backup非収録、新規復元OFF、既存復元先状態維持                                                              |
| entry binding状態 | active、dormant、quarantined、同一map内の混在、number／original token整合・不一致、active／retained overlap拒否、地図では非表示・管理UIでは表示、端末内手動再関連付け、即時削除、retention、初版にportable単独出力なし                                |
| 複数タブ          | 同一root vector同時編集、先行commit、stale拒否、複合操作rollback、再読込後の再編集                                                                                                                                                                    |
| PWA世代混在       | 旧SW＋旧tab、新SW waiting、新旧tab同時、versionchange blocked、update blocker、close／reopen                                                                                                                                                          |
| 障害注入          | QuotaExceeded、通常commandとlegacy rebaseの全barrierのcommit前／後、browser終了、control変更、network切断、payload／metadata／checkpoint／candidate vector／store欠損・変化、origin／profile完全消去                                                  |
| 復元              | V1とmapあり・splitなしV2の休眠preview、scope別exact core section、全scope共通references、実payload由来countsとのexact一致、複数map event V2、V2＋SHA-256拘束V1、取消、item-only時の設定維持、新規／既存復元、全置換・merge禁止、external ID非採用     |
| 入力安全          | raw byte、fatal UTF-8、duplicate property、非再帰depth／token、1 MiB数字、総entry、重複ref、retained番号不一致／owner overlap、未知version／scope／local control field、bounded error、timeout、cancel cleanup                                        |
| 規模              | 15,000セル、最大8,192ブロック、15,000設定、30,000領域、400アイテム、400売場、400 execution訪問、最大800 phase投影、単一phase経路400、保証境界超過                                                                                                     |
| ファイル総量      | event内map／entry境界、上限超過時の出力停止、V2 digest、未知version拒否                                                                                                                                                                               |
| 形式              | Backup V1/V2。XLSX 2.3、multipart、設定単独JSONが初版に露出しないarchitecture test                                                                                                                                                                    |
| 互換              | 旧版A→新版B→旧版A→新版B、anchor保持時のfence rebase、anchor欠落時dormant、重複時quarantined、衝突時effective fallback、capability差の安全モード                                                                                                       |
| 経路              | a/b別anchor、安全な同一セルa→b、main path／種別付きconnector、自セル領域内port、unsafe-connector、unroutable、同anchor別phase訪問、共有projection、PhaseVisitIdentityKey基準のhit-test／挿入、先頭member削除、pathfinding graph変更、重複物理cell拒否 |
| アクセシビリティ  | DOM詳細、空側追加、同anchor候補、一時移動、Canvasなし経路挿入、DOM／Canvas別focus復帰、結果通知                                                                                                                                                       |
| 自動テストprofile | Desktop／Mobile Chromiumの固定viewport、DPR、入力能力、retry 0、固定fixture                                                                                                                                                                           |

必須マトリクスは全直積を意味しない。各行についてunit、integration、browser、a11y、性能の担当層をtraceability表へ記録する。a/b分離、原子保存、旧新版同居、ローカルOFF mid-save、Backup置換、訪問global集約はrisk-based必須組合せとし、その他はpairwiseを許可する。各ケースはrequirement ID、fixture、期待値、実行commandを持つ。データ安全性specはCI retryを0とし、初回失敗後のretry成功を合格扱いにしない。実機receiptや外部証跡は要求しない。

### 10.3 主要E2E

1. 左右分割で26a/26bを別々に開き、片側だけ状態更新する
2. 上下分割した結合セルを回転し、描画・タップ・経路を一致させる
3. Mobile Chromiumでpickerを開き、画面上の空間順と「左側 b／右側 a」等の表示・読み上げ順を一致させる。集中モードの空側から追加した結果も通常画面と一致させる
4. 同一地図内の複数セルを「追加・変更のみ」でコピーし、コピー元未分割に対応するコピー先既存設定が維持されることを確認する。別操作の「完全同期（解除を含む）」だけが解除preview・確定を行い、stale時は全abortする
5. 地図再取込後に設定を継承し、イベント単位Backup V2でround-tripする。同時出力したV1互換coreを固定旧版Aへ復元できる
6. 固定旧版Aへ戻してanchorを保持する改名・通常状態更新を従来表示で行い、新版Bでhealthy legacy-only差としてfenceを原子的にrebaseし、同じ分割設定とstored ONを復元する。anchor欠落はdormant、同anchor複数はquarantined、衝突はevent単位effective fallbackとし、別ownerへ自動接続しない
7. 端末全体OFF／event OFF→`PD-04`で定義したsplit固有部分のlegacy動作（`PD-14`、重複物理cellを新規作成するafter-image拒否、`map-data-untrusted`安全判定の常時修正を含む）→ONで設定が戻る。OFF中のimport／通常編集でも新規重複は全store書込み前に拒否し、重複を作らない入力のcore保存結果は固定旧版Aと一致する。オフラインだけではOFFにならず、別タブがcommit直前にOFFへ変更した場合は全abortする
8. 先頭ゼロ衝突なしでは`01a`と`1a`を同じ半領域へ正規化し、衝突ありではevent ONを拒否してlegacy identityと原文を維持し、解決方法を案内する
9. raw実行商品ID順`[A1, B, A2]`を維持したまま、通常マップ、集中モード、`MapVisitList`、route／hit-testのnormal投影を`[A(A1,A2), B]`へ一致させる
10. raw `[A1, B]`へ後回しA2を追加し、base A位置を動かさずnormal Aへ統合すると同時にpostponed Aをbase順で追加投影する。現在位置・保存位置を動かさず統合通知を全画面で一致させる
11. 「Bの後へAを挿入」を指定してもAの`ExecutionVisitIdentity`が既に存在する場合は位置anchorを無視し、既存Aへ統合して「指定位置に新規訪問は作成しませんでした」と通知する。identity未存在時だけ指定位置へ新規訪問を作る
12. 2タブが同じroot vectorを読み、タブA保存後のタブB保存が`PersistenceConflict`となり、Aのpayload・metadata・checkpointが維持される。タブBは退避後に最新DBを明示再読込してから再編集する
13. `Vcap = 6`のDB6／DB7＋新store欠落・非互換profileを、他のsplit痕跡がなくてもpartial-loss安全モードで開き、DBを変更せず従来機能、分割機能利用不可理由、Backup復旧案内を表示する。DBなし、またはsplit対象導入traceがないDB5の`core-only`と、split対象traceだけがあるDB5のrecovery-requiredを区別する。recovery-requiredの`db-version` witnessはDB6／DB7ならexact 1件・値一致、DBなし／DB5なら0件とし、phantom・欠落・重複を拒否する。DB8以上は3 snapshotへ入れず`unsupported-database-version`でwrite 0件とする
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
24. `__proto__`等の利用者名をV2で往復し、不正ref、未知version／scope、hard limit超過をDB更新前に拒否する
25. 別日程・別地図コピー、XLSX 2.3、multipart、設定単独JSON、意図的再訪の初版UI・command・routeが存在しないことをarchitecture testで確認する
26. 日程、ブロック、番号、side、優先度の編集でA1のexecution identityを既存Bへ変え、B訪問位置と他itemの相対順を維持してA1だけをB member末尾へ移す。変更元visit、現在位置、保存位置、後回し・遅参、routeの`PhaseVisitIdentityKey` anchorが全画面で同じ結果へ再解決される
27. 同じphase visitの先頭memberを削除しても残存memberがある場合は、DOM panel、route、hit-test、挿入操作が同じ`PhaseVisitIdentityKey`へ再解決され、座標、順序、route cacheが変わらずmember件数だけが更新される。DOM panelの選択・挿入callbackがrow／colや代表item IDではなくvisit IDを渡すことも確認する
28. event ON中に商品編集、source switch、既存event bulk add、item import、V1 full import、Backup V2復元、通常地図編集、地図再取込の各操作で`01a`／`1a`衝突を新規作成し、各操作が全store書込み前に拒否され、元data、settings、anchor、association、control ONが維持されることを確認する
29. mapped、mapless、legacy-unresolvedの商品を同じraw実行列へ置き、共有訪問projectionが全identityを保持する一方、mapless／unresolvedに架空のmap cell、marker、route anchorを作らないことを確認する
30. payload、metadata、checkpoint、runtime fallback、identity／authority／物理location／物理内容witness／absorption projection付きrecovery candidate vector、capability store、fence historical evidence／全historical row digest／全root baselineの各部分欠損・cross-invariant不一致では自動安全モードとなる。同じexternal key／identity／locationでraw DOMStringをlone surrogate間だけ変更した場合もUTF-16 code unit witness差として検出する。参加rootについてinventoryが列挙する`syncQueue`等の全potential IDB storeをsnapshot時emptyでも同transactionへ含め、別transactionやtransaction内WebCryptoを待たず、candidateのempty→insert、消滅、内容変更をCAS abortする。非参加rootを含むexternal candidateをcommit前またはIDB commit後・post-check前に変更した場合、healthyなlegacy-mutable coreだけならそれぞれwrite 0件の`legacy-rebase-required`または全new IDB rootを維持した`committed-legacy-rebase-required`とし、capability-ownedまたは分類不能な差ならそれぞれwrite 0件のrecovery-requiredまたは全new IDB root＋完全baseline fenceの`committed-recovery-required`とする。別scope commandでfenceを更新しても非参加historical row／baselineを消去せず、再起動でも同じ分類となる。origin／profile全消去では空profile、device OFF、enabled event ID 0件で開始し、消去dataの自動復旧や保持成功を表示しない
31. 複数map eventのV2とSHA-256で拘束されたV1を生成し、V2のfull core全sectionとV1 coreが明示transform以外で同値、V2は新版へ、exact V1 bytesは固定旧版Aへ復元できることを確認する。片方のdownload handoff失敗を完了扱いにせず、再生成案内を表示する
32. 経路計算後に`backgroundColor`だけで通行可否を変え、`pathfindingGraphFingerprint`差により古いcacheを破棄して再計算する。同一`(row, col)`の重複cellを作るimport／通常編集はON／OFFとも原子的に拒否し、既存重複cellを並べ替えても一方を採用せず、当該mapの経路を安全に停止する
33. item-only V2は`eventLists`以外のdata sectionを含めず既存map／splitを維持する。全3 scopeで`scope.references`が実data slotと一対一で一致し、`deriveEventBackupCountsV2`の全5値が自己申告`counts`と一致する場合だけ受理する。full-split／core-mapでmetadata、実行順、day mode、route／hall／viewportのいずれかを欠落・余分にする、または正しいdigestのままcounts／referencesだけを水増し・省略するとpreview前に全体拒否する
34. device再ON後の衝突fallbackでitem番号修正、map identity修正、current item参照0件の孤立訪問状態破棄をそれぞれpreviewし、strict decreaseだけを原子的に確定する。pair swap、同数置換、新規pair、stale、通常writer経由は全拒否し、完全解消commit後だけ対象eventがeffective ONへ戻る
35. 通常core metadata／checkpoint／candidateだけのDB5は`core-only`のまま、split対象metadata／checkpoint／candidateだけのDB5は`map-cell-split-recovery-required`となる。導入trace 0件のDB5→`Vcap`では`after-vcap-history-source-preflight`後に旧tabが非fence rootのpayload／metadata／checkpoint／candidateを1件でも変更すると、versionchange内`H1`の同期byte比較で最初のwrite前に旧DBのままabortする。`after-vcap-history-source-reread-before-first-write`後のfault、external `E0/E1`差、transaction内split IDB traceも同じく全abortし、transaction内WebCrypto／別async taskを使わない。DB5→`Vcap`と新規DB 0→`Vcap`をversionchange commit直前でabortすると旧version／storeなし、commit直後から`onsuccess`前で終了すると`data`／`control`、lossless candidate vector付きtotal historical evidence／全historical row digest／participant digest／全governed root baselineを持つinitial fence、3 rootのmetadata／checkpointが全て存在する。既存DBのlegacy rowは`H1`、data／control rowはfactoryが実際に書いたcanonical after-image、fence rootはhistorical rowなし／baselineのみであり、導入前のabsent data／control rowを保存したfenceを拒否する。新規DBは全non-fence root writeとevidenceが同じfactory値で一致する。commit後終了は次回起動でinitial fenceと全rootを検証し、差なしは正常、healthy legacy-only差は全new DBからrebase、それ以外の差は全new DB＋fenceのrecovery-requiredとなる。DB6／DB7の運用後空store、fence欠落／埋込全historical row digest・participant digest・candidate vector・historical/baseline cross-invariant・root universe・capability-owned baseline不一致は再初期化せず`map-cell-split-recovery-required`となる
36. 同じproduction artifactでWebKit safety testをpass、safety failure、browser install／起動失敗、observation欠落、source／artifact hash差替えにし、passだけがcurrent-run gateを通る。通常表示／a11yだけの失敗はobservationのsafety statusを偽装せずnonblockingとなる
37. WebKit observation、promotion result、required-resultsについて、`status = passed`なのにfailed resultあり、failed IDと結果集合の差、`requiredSafetyIds(state)`／selected ID未実行、selected外result混入、promotion／required-resultsの正しいIDへ別testのcommandまたは未登録commandのpassを付ける、infra併発、open findingありの`not-required`、分岐外fingerprintをそれぞれ投入し、schemaとrequired aggregatorが集合包含、ID→required command対応、statusを再計算して全て拒否する。pre-releaseへ`releaseScope = future && status = contract-enforced && artifactMode = pre-release-production-guard`のID、future planned、`qa-chromium-only` IDを混入する、現在phaseのinitial-release production guard IDを省略する、release-readyでinitial safetyを非`implementation-enforced`または`qa-chromium-only`のまま残す、full safety IDを省略する、selectionMode／readiness／manifest hashを差し替えるcaseも拒否する。production／QA build manifest、required-results、observation、promotionのいずれか1つだけを別run IDまたは別attemptにしたcaseもcurrent workflow runtimeとの不一致で拒否する。安全assert失敗とinfraが併発した場合は安全失敗を優先し、安全失敗0件で未実行またはinfraがある場合だけinfrastructure failureとなる
38. 新版Bのfence作成後に固定旧版Aでanchor保持改名・通常状態更新を行い、Bで`rebase-required`→`fsmc.internal.rebase-legacy-core.v1`となる。candidate消滅はcheckpoint descriptorとprevious rowの`absorptionMatchProjection`がexact 1件一致する場合だけ正常吸収とし、0件、null、または同一projectionでlocation違いの旧entryが複数ある場合はrecovery-requiredにする。同じidentity／locationのraw DOMString-only／IDB record-content-only変更はlegacy transition manifestのexact 1件へ一致する場合だけrebaseし、未列挙・曖昧・projection-only変更はrecovery-requiredにする。new fenceのparticipant tupleと置換historical rowは`sort(unique(changed legacy roots ∪ {data, control}))`にexact一致し、非参加rowをbyte同値で維持する。device／event OFFとreadiness不足でもauthority正常ならrebaseし、authority不正では拒否する。R0→R1の追加変更はwrite 0件で最新snapshotから再試行し、rebase commit前終了はcurrent core＋rebase前fenceのpending、commit後・R2前終了はcurrent core＋new fenceとして再開する。R1→R2の追加healthy legacy差は次のrebaseへ送り、capability-owned／分類不能差は確定済みrootを維持して安全モードにする。anchor欠落／重複／衝突のstatus期待値を確認し、fence自己不整合と説明不能なcore差もrebaseせずBackup案内にする

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
- 経路挿入、取消、成功、競合を文字または`aria-live`で通知し、DOM起点では呼出ボタン、Canvas起点では地図ツールバー内の固定focus対象へ戻す
- 画面読み上げでブロック、番号、側、状態、操作結果を区別できる
- ライト・ダークのコントラスト
- 200%拡大で欠けない
- axeのmoderate/serious/critical違反0件

axe合格をCanvasのキーボード対応や完全なWCAG適合の根拠にはしない。

### 10.5 性能試験

3.13の最大条件を同時に満たすfixtureと同一candidate buildを使う。用語上の`runSample`は、scenarioの固定開始状態へresetしてから終了条件までを1回実行し、他runのmeasurementを再利用しない独立runを指す。profile／scenarioごとに`warmupRun`を1回実行して値を捨て、その後30個の`measuredRunSample`を完走させる。通常のduration scenarioは各runのelapsedを1個の`runValue`とし、interactionはrun内input observationsからlatency metric 1個、memoryはrun内memory observationsからpeak／residualの各metricにつき1個のrunValueへ集約する。最終`scenarioP95`はmetricごとに30 runValueを昇順にした29番目のnearest-rank p95とする。timeout、assert失敗、必要observation不足、cleanup失敗が1 runでもあれば数値へ置換せずscenario全体を失敗させ、外れ値を除外しない。I0では値を製品要件として固定し、各scenarioは下表の適用phaseから通常の自動テストとして合否判定する。外部性能証跡やmanaged-device sampleは保存しない。

`config/fsmc-performance-budgets.json`へrunner image `ubuntu-24.04`、Node 24.19.0、npm 11.19.0、lockfileで解決した`@playwright/test` versionとChromium revision、workers 1、viewport、DPR、touch／mobile能力、`warmupRuns: 1`、`measuredRunSamples: 30`、run開始状態、run内aggregation、run間`nearest-rank-p95`、単位、timeout、`enforcedFromPhase`を記録し、verifierで実行環境と照合する。`samples`という曖昧fieldは設けない。各scenarioは`offComparison: { required: boolean, referenceScenarioId: string | null }`を必須とし、`required=true`なら同profileの一意なOFF scenarioを参照し、falseなら`referenceScenarioId=null`とする。通常マップと集中モードは別scenario ID・別runSample集合とし、同じ絶対上限を共有できるがobservation／runValueを混ぜない。既存の`config/performance-budgets.json`は別機能の外部証跡契約であり、FSMC scenarioを追加せず、同fileのpending状態をFSMC-I0 blockerにしない。

`ubuntu-24.04`の移動aliasだけでは性能判定に使わない。同configへ`runnerProvider`、runner label／class、immutableな`runnerImageVersion`、`architecture: "x64"`、OS／kernel、CPU model allowlist、logical CPU数、cgroup CPU quota、memory limit、swap設定、job isolation／co-tenancy契約を固定する。containerを使う場合はimage digestを必須、host直実行なら`executionMode: "host"`としてcontainer digestを禁止するexact unionにする。job開始時にprovider metadata、`/proc/cpuinfo`、`/proc/meminfo`、cgroup CPU／memory、swapを検証し、固定calibration fixtureを同じbrowserで測ってI0固定band内であることを確認する。環境field不一致、取得不能、calibration範囲外はinfrastructure failureとしてsampleを採用せず、製品性能の合否を出さない。上限値とrunner envelopeの変更は別々にdiff・reviewできるようにする。

5秒操作scenarioでは、連続する各pointer／wheel入力の受付から次のpaintまでを`inputObservation`とし、入力のないidle frameを加えない。各measured runはpan、zoom、rotationを各10 observation以上含み、そのrun内の全inputObservationを昇順にしたnearest-rank p95を`runInputLatencyP95`＝runValueとする。30個のrunInputLatencyP95から求めるscenarioP95が下表のinput-to-next-paint上限を満たし、さらに全30 runの全main-thread task observationが後述の絶対上限を満たす。入力不足を短い高速runとして採用しない。

- 初回地図描画
- 5秒間のパン・ズーム・回転
- タップからpickerまたはポップアップ表示
- 経路再計算
- 大量セルの一括設定・コピーpreview
- Backup V2とV1互換coreの同時出力、V2入力
- peak memoryと画面終了後の解放
- 初期索引作成と15,000件のschema validation

全scenarioに非nullの絶対上限を設定し、比較可能な既存操作だけは絶対上限に加えて、同じCI run・同じbuild・同じprofileで直前に測る機能OFF p95からの悪化10%以内も満たす。次の数値は暫定測定値ではなく`PD-17`の製品上限である。厳格化は通常reviewで行えるが、緩和は新しい製品判断ID、理由、影響、期限の有無を記録し、製品判断者の承認と通常code reviewを必須とする。

| シナリオ                                        | Desktop Chromium CI p95 | Mobile Chromium emulation CI p95 | 適用開始 |
| ----------------------------------------------- | ----------------------: | -------------------------------: | -------- |
| 最大fixture初回地図描画（通常／集中を各々測定） |                1,500 ms |                         2,500 ms | I8／I9   |
| 5秒間のpan／zoom／rotation中input-to-next-paint |                  100 ms |                           150 ms | I8／I9   |
| タップからpicker／popup                         |                  150 ms |                           200 ms | I8／I9   |
| 単一phase 400訪問の経路再計算                   |                  750 ms |                         1,500 ms | I10      |
| 15,000件の一括設定・copy preview                |                1,500 ms |                         3,000 ms | I5       |
| Backup V2 import／export                        |                5,000 ms |                        10,000 ms | I4       |
| 初期索引＋15,000件validation                    |                1,500 ms |                         3,000 ms | I2       |

- main thread taskは全measured runで観測した各taskが200ms以下とし、p95へ隠さない。1秒を超える処理は進捗表示と取消を提供する
- memory metricは固定Ubuntu runner上で、browser-level CDP `SystemInfo.getProcessInfo`が返す同一candidate Chromiumのbrowser、renderer、Worker、utility、GPU各PIDを`memoryObservation`ごとに列挙し、各`/proc/<pid>/smaps_rollup`の`Pss`をbyteへ変換して合算する。各measured runの開始時に全discoverable page／Worker targetの`HeapProfiler.collectGarbage`後のbaselineを取り、scenario中100ms間隔の各PSS合計をmemoryObservationとする。そのrunの最大値との差を`runPeakDelta`、画面終了、Worker／Blob URL／timer／transaction cleanup、30秒待機、再GC後の1観測との差を`runResidualDelta`とする。終了したPIDは次observationで0、新規PIDはその時点から加算し、同じbrowser外のprocessを含めない。CDP field、PID、`smaps_rollup`、PSSのいずれかを取得不能ならRSSやrenderer heapへfallbackせず当該runとscenarioを失敗させる
- 30個の`runPeakDelta`と`runResidualDelta`をそれぞれ独立にnearest-rank p95へ集約する。peak scenarioP95はDesktop CIで256 MiB、Mobile emulation CIで192 MiB以下、residual scenarioP95は両profileで64 MiB以下とする。MobileはChromium emulation processの指標であり、特定スマートフォンの物理memory保証ではない
- timeout／cancel後にWorker、timer、Blob URL、transactionを残さない
- 描画ごとに全商品と全セルを総当たりせず、`MapLocationIndex`を再利用する
- 最大条件を超えるデータは初版の自動テスト保証外とし、hard limit以下では警告付きbest effortとする

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
- `Vcap = 6`のDB6／DB7新storeなし・非互換profileを未導入扱いで変更する、空storeを再作成する、または従来機能まで起動不能にする
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

- 利用者へ端末全体OFFまたは対象event OFFで、`PD-04`で定義したsplit固有部分のlegacy動作（`PD-14`、重複物理cellの新規after-image拒否、`map-data-untrusted`安全判定の常時修正を含む）へ戻すよう案内し、影響versionの配布を停止する。遠隔で既存端末をOFFにはできない
- 問題発生前に作成済みのBackup V2／V1互換coreと、利用者が明示的に提供した診断情報だけを使って復旧する
- 再現fixtureを作成し、修正版が同じ失敗をretryなしの自動テストで防ぐまで再配布しない
- 影響、回避策、実際に確認できた保持状態、完全profile消去が疑われる場合は保証外であること、Backupからの復旧可否と見込みを推測せず正確に通知する
- DB versionを下げたり、新storeや保存済み分割設定を削除したり、自動修復を実行したりしない

### 13.2 再開条件

- incident記録とroot cause reviewを完了し、事故を再現するfixtureとretryなしの自動回帰testを追加する
- 修正sourceで必須CI、旧新版同居、failure injection、性能、backup復元が再成功する
- 影響データの復旧または利用者向け処置を完了する
- 端末全体OFF、event OFF、制御変更mid-save、Backup新規／既存復元の自動回帰testが成功する
- 修正版も既存イベントOFFを既定として配布し、停止前のローカルON状態を自動復元しない

## 14. Definition of Done

次をすべて満たした時点で完全分割初版を完了とする。

- `PD-01`～`PD-18`が`config/fsmc-traceability.json`で要件ID、owner phase、fixture、実装、自動test、利用者向け文書または非対象理由へ追跡可能で、全対象が`implementation-enforced`となり、初版の4方向、解除、同一地図内copy、再取込・通常編集が実装済み
- `C(S) = ∅`の場合だけ`01a`／`1a`／`０１ａ`が同じ売場へ解決され、衝突時はevent ONを拒否してlegacy identityを維持する。ON中の編集、import、restore、map変更で`C(after) \ C(before)`が非空となる操作は同数pair swapを含め全store書込み前に全拒否し、既存data、settings、control ON、表示原文を失わない。`fsmc.repair.item-numbers.v1`、`fsmc.repair.map-identity.v1`、`fsmc.repair.orphan-visit-state.v1`だけが既存pair集合を厳密減少でき、完全解消後だけ対象eventをeffective ONへ戻す。`26c`／`26c2`、`26d`、`26ab`は非対応番号同士で誤衝突せず、「側未設定」badge、DOM一覧、previewで識別表示される
- exact番号grammarと巨大`BigInt`化前のsafe integer境界を満たし、mapped／mapless／legacy-unresolved `SpaceIdentity`を共有訪問projectionが保持する。legacy identityに原文／reasonを混入させず、mapless／unresolvedへ架空のmap／block／cell、marker、route anchorを与えない
- 機能OFF時はsplit固有部分が固定した旧版Aと同じ番号identity、未分割表示、whole-cell位置解決、core保存結果になり、ON/OFFで商品番号原文やsplit設定を破壊変更しない。optional `EventMetadata.splitIdentityAnchor`だけを正規化除外したlegacy-core checksumと、それ以外の全core field・raw item原文が一致する。訪問・経路・位置指定の`PD-14`修正、重複物理cellを新規作成するimport／通常編集after-imageの原子的拒否、既存重複の`map-data-untrusted`判定／map単位route停止だけは常時適用する。重複を作らない入力では旧版Aと同じcore保存結果を維持する
- item resolver、空側hit-test、DOM列挙が同じ`MapLocationIndex`、viewport adapter、geometryを使用する
- 重複block ownership、番号重複、merge越境、重複mergeを配列順で推測せず影響領域を安全に除外・隔離する。重複物理`(row, col)`を新規作成するimport／通常編集は機能状態を問わず全store書込み前に拒否し、起動時から存在する重複は当該mapを`map-data-untrusted`としてsplit表示だけをlegacy whole-cellへ戻し、経路生成・cache再利用をmap単位で安全停止する
- manual map／block editでmapData、association、binding evidence、entry status、route cacheが同じ原子的commitで更新され、無関係なentryを失効させない
- コピーの既定「追加・変更のみ」は既存分割を解除せず、別操作の「完全同期（解除を含む）」だけが解除する。両方でmode、追加・変更・解除・維持・変更なし・除外のpreview、取消、stale時全abortが機能し、コピー先IDとdormant／quarantined履歴を維持する。同owner＋番号のretainedがあればcopyから除外して明示再関連付けへ送り、active／retained overlapを作らない
- `layoutMode`とスマートフォン操作判定が分離され、Mobile Chromium profileでは全分割セルが空間順picker、狭幅Desktopと`desktop-touch-context`を含む`isMobile=false`ではmouse／touch別閾値に従い、閾値未満・曖昧時はno-op案内となる
- 通常マップと集中モードが同じPointer gesture state machineを使用し、pan、pinch、cancel、capture喪失、layout切替後の誤tapがない
- a/bの着色、ポップアップ、状態変更が独立し、集中モードの「購入済」と「後回し／遅参」の既存反映規則を維持する
- raw実行商品ID配列を並べ替えず、非連続同一`ExecutionVisitIdentity`をglobal集約し、normalと後回し／遅参の`PhaseVisitIdentity`投影を通常マップ、集中モード、`MapVisitList`、route／hit-testで共有する。進行区分・優先度はexact union、1 itemの追加phaseは高々1個とし、既存identityへの位置指定追加はanchorを無視して統合通知し、訪問位置を動かさない
- 商品編集でexecution identityが既存destinationへ変わる場合はdestination訪問位置を維持し、変更itemだけをmember末尾へ移して現在・保存位置を新しい`PhaseVisitIdentityKey`へ再解決し、全画面へ同じ結果を反映する
- route、hit-test、挿入anchorとDOM panel callbackが`PhaseVisitIdentityKey`を使用し、member商品ID列はpayloadに限定される。先頭member削除後も残存memberがあれば同じvisit ID、座標、順序、route cacheへ再解決され、priority、phase、member件数をDOMで確認できる
- main pathと種別付きconnectorが分離され、connectorは自セル・結合セル領域内で安全な場合だけ表示・hit-testできる。領域外または障害物横断が必要な場合は`unsafe-connector`で`unroutable`とし、同一セルa→bにも同じ規則を使う。route signatureは`pathfindingGraphFingerprint`を含み、value／背景色／map寸法／結合領域／algorithm・cost変更で古いcacheを破棄する
- 同位置複数訪問が中立marker、訪問数badge、現在ringで表示され、番号・a/b・badge文字が全回転角で正立する
- Canvasを使わずDOM訪問一覧から詳細、追加、状態変更、一時移動、経路挿入を完了でき、a11y試験が成功する
- 起動preflight、`dbVersion`とexact一致するsplit対象rootへ閉じた`Vcap` witness、通常core traceだけのDB5判定、採用直前のsplit導入trace再検証、全非fence root payload／metadata／checkpoint／全potential IDB candidate selectorの`H0/H1` byte-exact CAS、legacy rowを`H1`・new capability rowをfactory after-image・fenceをbaseline-onlyとする合成post-stateのtotal historical evidence／participant digest／全governed root baseline付きinitial fenceを含むDB5→6原子bootstrap、commit前／後crash oracle、DB6／DB7の空storeを含むpartial-loss安全分岐、DB8拒否、固定manifestの旧版A→候補新版B→固定旧版A→候補新版Bの自動互換試験が成功し、端末情報を外部収集しない。healthy legacy-only差は原子的rebase、anchor欠落／重複／衝突は決定済みstatus、capability-owned差／fence自己不整合／説明不能差は安全モードとなる
- supported rangeでは`dbVersion >= Vcap` iff exact 1件の値一致`db-version` witness、`dbVersion === null || dbVersion < Vcap` iff 0件となり、DB8以上はsnapshot外`unsupported-database-version`としてauthority非採用・write 0件で拒否される
- `core-only`、`map-cell-split-recovery-required`、`map-cell-split-v1`のsnapshotを型で区別し、recovery-requiredではcoreだけを継続してuntrusted split rootを採用・再初期化しない。正常時はempty-source metadataのanchor、registry token、event／map／block instance ID、active／retained entry、map-levelとentry-level binding evidenceを保持し、metadata全writerがI0 inventoryの発行／保持／remap／除去方針に適合する
- `(storeName, key)`別のfull `ObservedRevisionRoot`、構造化checkpoint、identity＋物理location＋物理内容witness＋absorption projectionを返すpure collectorの全出力、settings／control root、root policy、全非fence rootのtotal historical evidenceとその全行digest、participant digest、全`FSMC_GOVERNED_ROOTS_V1`のexternal baselineを持つfenceを含む`ExpectedRootVector`により、`syncQueue`のjournal／archiveとsnapshot時emptyの全potential storeを含むIDB candidateのstaleは同一transactionを全abortする。external raw DOMStringはlone surrogateも区別するlossless UTF-16 code unit witnessで拘束し、transaction内でWebCrypto／別async taskを待たない。candidate content-only／projection-only差は固定旧版Aのexact transition manifest外ならrecovery-requiredとし、legacy rebaseのparticipant tupleと置換historical rowは`sort(unique(changed legacy roots ∪ {data, control}))`にexact一致させる。external差はhealthyなlegacy-mutable coreだけならcommit前はwrite 0件のrebase、commit後は全new IDB rootを維持したrebaseとし、capability-ownedまたは分類不能な差はcommit前recovery拒否、commit後`committed-recovery-required`として即時または再起動時に検出する。legacy rebaseも同一transactionで全旧fenceまたは全新fenceだけとなり、別scope commandでも非参加historical row／baselineを失わず、last-write-wins、部分IDB commit、黙示mergeがない。quota・abort・crash・OFF mid-save時も各commandのIDBは全旧または全新だけとなる
- event削除画面は30日保持が既定、即時完全削除が別選択となる。D+29、trusted D+30、31日offline、36日offline、rollback、session jump、24時間再確認が固定clock契約どおりで、`event-deleted`対象以外を削除しない。設定単独出力は初版にない
- dormant／quarantinedは地図に表示せず管理UIで理由を表示し、preview付き端末内再関連付けと明示削除が可能で、名前だけで別eventへ再接続しない
- V1層別互換matrix、event単位V2のcore／split分離、scope別exact全core section tuple、全scope共通`scope.references`、単一eventRef＋全mapRefs、実payload由来`counts`とのexact一致、map-level fingerprint、active／retained portable union、digest、V2からV1へのfileName／byteLength／SHA-256拘束が固定される
- V1と、地図を含むがsplitを含まないV2では既存split設定をpreview後にdormant化し、item-only importでは維持する。event V2は原子的にround-tripする
- hard limit、fatal UTF-8、duplicate property、非再帰depth／token、digest、未知version／scope、不正ref、1 MiB超番号tokenをDB更新前に拒否し、長大数字を境界比較前に巨大`BigInt`化しない。V2のlocal control fieldも未知keyとして拒否する。V1で現行readerが受理する同名未知fieldは互換matrixどおり保持できるがcontrol authorityへ採用しない。bounded errorとcancel cleanupを守り、`__proto__`等の利用者名を安全に自己round-tripする
- 端末全体OFF、event OFF、自動安全モードでは`PD-04`で定義したsplit固有部分のlegacy動作（`PD-14`、重複物理cellの新規after-image拒否、`map-data-untrusted`安全判定の常時修正を含む）となり、オフラインだけではOFFにならない。authority正常なlegacy rebaseはdevice／event／readinessに依存せず完了し、recovery-required安全モードでは禁止する。device OFF中の編集後に再ONした場合は衝突eventだけをstored enabledのeffective fallback、他eventをONとし、修正完了したeventだけ復帰する。BackupはローカルON／OFFを含めず、新規復元OFF・既存復元先状態維持となる
- 端末間同期・自動mergeを行わず、1イベント1主端末とpreview付き全置換、復元前退避案内が利用者向け文書と自動テストで固定される
- source固定readinessがI0～I1 `contracts-only`、I2～I10とI11作業中`internal-testing`、I11最終candidateの全Exit成功後だけ`release-ready`となり、production bundleにQA override、query、storage、remote迂回がない。release-ready前のproductionでは有効化UI／commandへ到達できない
- 必須Desktop／Mobile Chromium CIがworkers 1、retry 0、`failOnFlakyTests`で成功し、`desktop-touch-context`を含むsafety flakyが0件である。release-ready manifestでは全`initial-release` safetyが`implementation-enforced`、`qa-chromium-only`が全体で0件である。WebKitの通常表示／a11y結果自体をDoDにしないが、同一`ciRun`／source／production artifactへhash拘束したrelease-ready `requiredSafetyIds(state)`の全ID実行・全結果passed・failed ID／infra error 0件からcurrent-run safety observationが`passed`へ再計算され、open safety findingは0件、promotion resultはregister 0件と集合一致する`not-required`である。open finding中のpromotion `passed`は修正確認の中間状態に限り、findingをclosedへ更新して`not-required`となるまで最終DoDを満たさない。overall statusの自己申告だけを信頼しない
- Desktop／Mobile Chromiumの自動browser、PWA、性能テストが成功する。特定OS・端末を正式保証済みと表記しない
- WebKitはadvisory自動test対象だが必須保証対象外であり、iPhone、ペン、OS／実機固有挙動は自動test対象外であることを利用者向け文書へ明記する
- 15,000セル、最大8,192 block、15,000設定、30,000半領域、400商品、400売場、400 execution訪問、最大800 phase投影、単一phase経路400の条件を持つ`releaseScope = initial-release`の全performance scenarioが、検証済みrunner envelope上で専用`config/fsmc-performance-budgets.json`の製品上限を満たす。5秒操作中のinput-to-next-paint、全Chromium process PSS memory metric、memory解放条件も満たし、Mobile emulationを実機memory保証と表記しない
- PWA新旧世代、旧版／新版同時tab、versionchange blocked、QuotaExceeded、部分root／store欠損、強制終了の試験が成功する。origin／profile完全消去は空profile、device OFF、enabled event ID 0件のclean-startと事前Backup文書を確認し、消去dataの保持・自動復旧を要求しない
- remote availability、署名receipt、外部metrics、実event pilot、managed-device収集、source-bound証跡bundleが実装・完了条件・標準commandに存在しない。source固定の`verify:fsmc:release-readiness`は公開安全gateとして必須とする
- 完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図コピー、意図的再訪が後続版として初版のUI、command、test gateから分離される

## 15. 標準検証コマンド

リポジトリ指定のNode 24.19.0／npm 11.19.0を使用する。次のFSMC scriptはI0で`package.json`とCIへ追加し、manifestが選ぶtest 0件、`--passWithNoTests`、未実装testの仮成功を拒否する。

以下のphase別blockは単独の全CIではなく、I0～I11の毎candidateで実行する同一required DAGのbuild／phase-test payloadである。DAGは常に、(1) production artifactを1回build・upload、(2) 現在phaseのChromium／schema／phase testを実行してsource・implementation-state／manifest・production artifact・該当時QA artifactの各hash付きrequired-results artifactを`if: always()`でupload、(3) 同じproduction artifactに対するWebKit observation、(4) 同artifactに対するpromotion result、(5) 全upstreamを`if: always()`で待つ`fsmc-required-gate`、の5系統を持つ。I2～I10と`currentPhase = I11 && readiness = internal-testing`だけは別のnon-promotable QA artifactを追加し、機能testへ使うが、production artifact／WebKit／aggregatorを省略しない。各block末尾のartifact uploadはCI wrapperのalways stepで実行し、先行test失敗を理由にresult artifactを欠落させない。

FSMC-I0 production build job:

```powershell
npm ci
npm run test:encoding
npm run format:check
npm run verify:toolchain
npm run verify:fsmc:i0
npm run build:release-a
npm run artifact:fsmc:upload:release
```

FSMC-I0 phase-test job:

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm exec -- playwright install --with-deps chromium
npm run verify:fsmc:i0:prebuilt
npm run test:fsmc:i0:prebuilt
npm run artifact:fsmc:upload:required-results
```

I1以降は`releaseScope = initial-release`の全`contract-enforced` testを常時再実行し、同scopeで現在phase以下の`implementation-enforced` testを加える。`planned`は選択せず、initial-release entryだけは`enforcedFromPhase`到達後に`planned`が残れば失敗させる。`future` entryは初版gateの実行・planned残存判定から除外する。I1はproduction guardとpure domain testを実行する。

FSMC-I1 production build job:

```powershell
npm ci
npm run test:encoding
npm run format:check
npm run typecheck
npm run lint
npm run verify:architecture
npm run verify:fsmc:phase
npm run build:release-a
npm run artifact:fsmc:upload:release
```

FSMC-I1 phase-test job:

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm exec -- playwright install --with-deps chromium
npm run test:fsmc:production-guard:prebuilt
npm run test:fsmc:domain
npm run artifact:fsmc:upload:required-results
```

I2～I10と`currentPhase = I11 && readiness = internal-testing`は同じsourceからproduction artifactとnon-promotable QA artifactを別outputへ各1回buildする。production artifactではsource readiness、QA override不在、FSMC導線非公開、legacy smokeだけを検証し、QA artifactだけで当該phaseまでの機能testを実行する。両artifactは`buildPurpose`、source SHA、output pathをmanifestで区別し、上書き・取り違えを失敗させる。

FSMC-I2～I10およびI11作業中`internal-testing` build job:

```powershell
npm ci
npm run test:encoding
npm run format:check
npm run typecheck
npm run lint
npm run verify:architecture
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
npm run artifact:fsmc:download:qa
npm run verify:fsmc:artifact:qa
npm exec -- playwright install --with-deps chromium
npm run test:fsmc:production-guard:prebuilt
npm run test:fsmc:required:qa-prebuilt
npm run test:fsmc:performance:qa-prebuilt
npm run artifact:fsmc:upload:required-results
```

I11のrelease candidateは上記と同じDAGを`release-ready` modeで実行する。同一runのbuild jobでproduction artifactを1回だけ作ってuploadし、browser、a11y、PWA、performance、旧新版互換、WebKit observation／promotionへ再利用する。QA buildをrelease判定へ流用しない。

I11 production build job:

```powershell
npm ci
npm run quality
npm run verify:fsmc:phase
npm run build:release-a
npm run artifact:fsmc:upload:release
```

Chromium／performance required jobはbuild jobを待つ。

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm exec -- playwright install --with-deps chromium
npm run test:fsmc:required:prebuilt
npm run test:fsmc:performance:prebuilt
npm run artifact:fsmc:upload:required-results
```

次のadvisory WebKit jobはI11専用ではなく、I0～I11の毎candidateでproduction build jobを待ち、必須Chromium jobと分離する。pre-releaseでは`requiredSafetyIds(state)`の`pre-release-production-guard`だけ、release-readyでは全`initial-release` safetyが`implementation-enforced`かつmanifest全体の`qa-chromium-only`が0件であることを先に検証し、`release-production-full`を含む全導出IDをproduction artifact上で実行する。I2～I10およびI11作業中`internal-testing`の`qa-chromium-only`機能safetyを到達不能なproduction WebKitへ渡さない。

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

固定job／status `fsmc-required-gate` aggregatorはI0～I11の毎candidateでbuild、現在phaseのrequired-results、advisory observation、promotionの全jobを`if: always()`相当で待つ。source stateが`contracts-only`／`internal-testing`なら`verify:fsmc:phase-gate`、`release-ready`なら`verify:fsmc:release-readiness`を内部で選び、どちらのmodeでも同じstatus名を出す。

```powershell
npm ci
npm run artifact:fsmc:download:release
npm run verify:fsmc:artifact:production
npm run artifact:fsmc:download:qa-if-required
npm run verify:fsmc:artifact:qa-if-required
npm run artifact:fsmc:download:required-results
npm run verify:fsmc:required-results
npm run artifact:fsmc:download:webkit-safety-observation
npm run verify:fsmc:webkit-safety-observation
npm run artifact:fsmc:download:webkit-promotion-result
npm run verify:fsmc:webkit-promotion-result
npm run verify:fsmc:safety-findings
npm run verify:fsmc:required-gate
```

`test:fsmc:required:qa-prebuilt`はI2～I10およびI11作業中`internal-testing`のQA artifactへ、`test:fsmc:required:prebuilt`はI11 `release-ready` production candidateへ、unit、integration、worker、Desktop／Mobile browser、`desktop-touch-context`、a11y suite、PWA multiclient、local control、collision repair、legacy core classifier／rebase、visit projection、Backup V1／V2、固定旧版A/B/A/B、failure injection、partial-lossをmanifestどおり実行する。performanceも`releaseScope = initial-release && enforcedFromPhase <= currentPhase && status != planned`を満たすscenarioだけを同じartifactへ別commandで実行する。`artifact:fsmc:download:qa-if-required`と`verify:fsmc:artifact:qa-if-required`はsource stateからQA必須性を再計算し、I2～I10／I11 internal-testingではQA manifest・全file hash・source・buildPurpose・readiness・`ciRun`を検証し、それ以外ではQA hash／result混入を拒否する。`verify:fsmc:required-results`はproduction／QA両manifestとresultごとのartifactPurpose／requiredCommandを照合し、selected／executed／result／failed集合の包含、ID→command対応、statusを再計算する。`verify:fsmc:webkit-safety-observation`はsource stateから`requiredSafetyIds(state)`を再導出し、current workflow runtimeと全成果物の`ciRun`、source／production artifact hash、selectionMode、manifest／実行／結果／failed ID集合、infra error、status優先順位を再計算する。`verify:fsmc:webkit-promotion-result`は同じ`ciRun`／hash、register hash、open finding由来selected ID／required command／実行／結果／failed ID集合、infra error、`not-required`条件とstatus優先順位を再計算する。`verify:fsmc:safety-findings`はfindingとpromotion test／commandの一意対応を検証する。`verify:fsmc:required-gate`は自己申告mode／statusを信頼せず、pre-releaseでは現在phaseの全upstreamとproduction誤公開防止を`verify:fsmc:phase-gate`へ、release-readyでは全I0～I11を`verify:fsmc:release-readiness`へ渡す固定aggregatorであり、branch protectionを動的変更しない。いずれも外部activationではない。実event pilot、実機収集、外部metrics、remote activation、receipt builderのcommandは追加しない。
