# Performance evidence contract

## 2026-10-28の現行基準：対象3群160ms／160ms

ユーザー指定により `range`／`drag`／`transfer` は中央値160.0ms以下・95%点160.0ms以下とし、識別子 `dnd-selection-rendering-160-160-2026-10-28`、基準日2026-10-28を用いる。shopping65／100msと基準日、`performance-samples-2026-10-26`、PR2／completion10、全144条件・終了点・fixture・保存整合性・retry0は維持する。

正常500品目touch同列移動の中央値+1.95ms・95%点+4.90msは受容・追加修正対象外と記録し、解消済みへ変更しない。元150msのrun・raw・criteria ID・当初合否は不変で、新160msの再判定には元source／run・旧基準と新基準・新policy sourceを別記録する。旧基準の不合格・欠測・機能失敗を成功へ変換しない。その他の相対差の包括受容とも扱わない。

## 買い物・D&D計測器v4（2026-10-27）

`shopping-rendering-v4` は、前方向の複数・範囲移動の期待順序とDOM応答終了条件の不足を補正した計測器である。v4導入時は2026-10-26の時間基準等を維持した。その後、対象3群の時間上限だけを上記2026-10-28の160ms方針へ変更し、回数、対象144ケース、fixtureの値・件数・負荷条件、ジェスチャー、各終了点、保存の原子性・整合性、retry 0は維持する。

前方向（候補→実行）の移動では、移動前の全品目順・実行順・移動対象の凍結順・訪問単位・anchorから、保存後の完全な期待実行順と表示順を独立に作る。移動後の実配置や参照画像を期待値の根拠にしない。前方向の折り畳みヘッダーへのdropは参照訪問の後ろという既存動作を保持する。全品目の保存順、実行順、論理DOM順、mount済みの移動対象順、実フレームの可視ID順を期待値と照合する。共通検証器でも入力前の記録から期待順を再計算し、期待値と実測値の両方を書き換えた不正な証拠を拒否する。逆方向（実行→候補）は既存の候補順・保存・表示の検証を維持する。

DOM応答では、入力前に固定した必須移動先IDすべてについて、各カードとチェックボックスの存在、移動対象カードのDOM順がそろうことを要求する。主対象だけの出現では終了しない。既存の画面外統合シナリオの除外は、入力前に確認した対象IDと理由を明示し、共通検証器で根拠を照合した場合に限る。計測中の照合は移動対象に限定し、全DOM走査・layout取得や全品目のmountを追加しない。

v3とv4は終了条件の意味が異なるため、旧v3のrawをv4の正式受入へ付け替えない。現行の変更前後比較は、同じv4・fixture・completion profile・環境で新規採取したrunを使う。過去110→150msの再判定契約だけは固定した旧v3ソースと比較器で検証し、現行比較器はv3の記録やv3／v4の混在を受理しない。旧raw・元artifact・当初合否は保持する。

2026-10-27の追加修正 `7fd1c0c596e9eeafc186866afb655ebedf670df9` は、採取後に観測不能証拠を読むオフライン検証器とそのテストだけを変更する。v4で実際に出力された13項目について、入力前状態・source hit・相関ID・必要カード・独立した期待順序と結び付けて検証する。測定処理・終了点・fixture・元rawは変更しない。測定時のrun ID・ソース・instrument hashをそのまま保持し、読み直しには検証器のコミットとファイルhashを別記録として付ける。観測不能のraw配列と中央値・95%点は欠測のままとし、失敗したフレームへ時間やframeVerifiedを作らない。

全条件の受入は単一の独立runにそろった証拠から判定する。途中失敗したrunを、後続runの成功サンプルで補充しない。独立した確認runを行った場合も、初回の失敗・診断・確認runを分けて記録し、未解明の原因を解消済みに変更しない。

2026-10-28確認：製品ソース3e6cece・同じv4／fixture／completion10の独立した通常runは全144ケース・576指標が成立した。オフラインconsumer7fd1c0cの比較結果は、変更前4frameの真正未観測と旧機能失敗によりincompleteを維持する。絶対基準の通過と相対性能の解消を分け、正常操作で繰り返し残る増加を通過へ読み替えない。実行根拠・原失敗の保全・sourceの対応は[レビュー修正記録](dnd-selection-rendering-review-remediation-20261027.md)を参照する。

## 買い物ブラウザ性能の測定回数（2026-10-26）

`run-shopping-browser-evidence.mjs` が実行する4群は、PR確認 `pr` が各操作・指標2回、実装完了判定 `completion` が各操作・指標10回である。`ESP_PERFORMANCE_PROFILE` またはrunnerの `--profile` で選び、指定なしは `completion` とする。PR2回の `passed` は実装完了へ流用せず、完了の前後比較は同じ `completion` profileで採取する。

必須条件shopping16（150／500品目・各6操作）・range20・drag8・transfer100、時間基準shopping65／100ms・対象3群160／160ms（2026-10-28改訂、旧150msは履歴）、全操作、fixture、ウォームアップ、入力・DOM・実フレーム・次操作の終了点、保存・再読込・整合性検証、retry 0は維持する。通常一括実行は `npm run test:browser:pr`／`npm run test:browser:completion`。`.github/workflows/quality.yml` はPR eventで `pr`、非PRで `completion` を指定する。

runとartifactには `samplingPolicyId: "performance-samples-2026-10-26"` と `samplingProfile`（`id`、`sampleCount`、`policyDate`、`completionEligible`）を保存し、時間基準のcriteria IDとは分けて識別する。異なるprofileを合算したり、過去20回のrawを切り詰めたりしない。旧raw・当初合否・元artifactと中断runは履歴として保持し、新回数のrunは独立して保存する。詳細は[現行の性能基準](dnd-selection-rendering-performance-criteria-20261024.md)と[AGENTS.md](../AGENTS.md)を参照する。

以下のcanonical physical own-gateは別のscenario・authorityを持つ既存契約である。今回の買い物4群の回数変更を、その30 samples契約や `.github/workflows/performance-evidence.yml` へ広げない。

## 状態

`config/ui-scenarios.json` と `config/performance-budgets.json` は、Phase 0 の5シナリオに
加えて、Phase 3 の XLSX Worker 7シナリオと Phase 5 の list renderer
5シナリオを定義する。現時点の machine、Chromium version、30 samples、absolute ceiling、
regression ceiling は外部実測されていない。このため全シナリオの `pendingState` は
`external-blocked`、budget値は `null` のままであり、production exit は受理されていない。

この pending 状態は欠損値の代用品ではない。値を推測して埋めたり、ローカルの一回の実行を
30 samples として扱ったりしない。

## Canonical scenario

Phase 3 は次を個別に測定する。

- valid Worker import、export round trip
- corrupt archive、compressed input上限超過、ZIP compression-ratio超過の拒否
- progress後のcancel acknowledgement
- 30秒のrequest/Worker timeout acknowledgement
- UI heartbeat、peak memory、single terminal result、partial commit/downloadが0であること

Phase 5D は同じ10,000 row fixtureで full/virtual initial render、virtual scroll anchor、
keyboard focus restorationを測定する。Phase 5E は renderer selectorを測定し、drag中、
multiple columns、unsupported zoom、modal、unknown stateが必ずfullへ倒れることをassertionとして
記録する。startup recoveryではlist graph自体をmountせず、recovery screenだけが表示されることを
別の`disabled/no-list` caseとして観測する。

各 post-baseline fixture は `scripts/fixtures/performance/` にあり、
`fixtureSha256` はraw bytesへ結び付く。Phase 0 fixtureだけは
`measurementSourceSha=638dc0d2b05a09da9ea09e3f25e00bb36e1b2994` のGit objectから再検証する。
これにより後続phaseのシナリオ追加がPhase 0の証跡を上書きしない。

## Evidence collection

実測runnerはcanonical physical machineで、各scenarioをfresh browser contextにより30回実行
する。warm-upはsamplesへ含めず、outlierを除去しない。中央値は偶数個の中央2値の平均、
p95はnearest-rankで再計算する。evidence envelopeは
`config/performance-evidence.schema.json` に従い、次へsource-bindする。

- clean Git commitとsource closure SHA-256
- build artifact SHA-256とgateに対応するrelease variant
- machine CPU、memory、power mode
- exact Chromium version/channel
- UI scenario policy、performance budget contract、XLSX limit policy
- fixture hash、30件のraw samplesとそのcanonical SHA-256
- fixtureが要求するfunctional assertion
- 公開artifact surface adapter、生成payload/semantic digest、fault時の元/置換Worker digest
- export round tripだけは、計測外のschema-exact IndexedDB stage、DB version、単一transactionの
  store集合、別readonly readback、payload/semantic digest、確定revision

budget contract hashは循環参照を避けるため、各scenarioの `evidenceSha256` だけを `null` へ
射影して計算する。measurement、ceiling、pending state、blockerは射影から除外しない。

### Repo-side sample collector

正式なown-gate raw採取は`.github/workflows/performance-evidence.yml`だけが行う。このworkflowは
`[self-hosted, Windows, X64, foundation-performance]` runnerと`foundation-performance` protected
environmentを固定し、source SHA単位のconcurrency lockを持つ。dispatch inputはなく、callerはgate、
variant、archive、manifest、target URL、environment、adapter、evidence IDを指定できない。
collectorはGitHub OIDC tokenをissuerから検証し、workflow path、protected environment、repository、
source SHA、run IDを束縛したreceiptをPostgreSQL immutable evidence storeへ保存・readbackする。この
collector identityが欠けるraw artifactは、後続producerの入力にならない。
`performance:own-gate-samples:collect`がPostgreSQL Release Stateのcurrent headをreplayし、pending
standard acceptance requirements、standard binding、live archive/availability、manifest、deployment URLを
再解決する。clean `GITHUB_SHA`上のreview済みphysical machine/Chromium profileと一致した場合だけ、
下記low-level collectorへ内部temporary pathを渡す。採取後にも同じauthorityを再読込し、state、binding、
archive、manifestのいずれかがdriftした場合は最終raw fileを公開しない。

workflow artifactは`foundation-performance-raw-samples-${sourceSha}-${runAttempt}`という名前で、
`raw-performance-samples.json` 1ファイルだけをcreate-onlyでuploadする。同名artifactのupload producerは
このworkflowのexact 1箇所だけである。raw `evidenceId`はperformance gateとcollector workflow run IDから
決定し、後続own-gate producerがreviewed prior run ID/hashと一致しないrawを拒否する。

採取はclean checkoutと固定Nodeで次を実行する。`artifact.zip`は測定対象へdeployしたreview済み
archiveそのものであり、collectorがraw bytesのSHA-256を計算する。`environment.json`はevidence
schemaの`environment`と同じclosed shapeを使い、OS/CPU/物理memory、固定power mode、Chromium
version/channelを事前にreviewする。power modeは同じ値を`FOUNDATION_PERFORMANCE_POWER_MODE`へ設定し、
実host/Chromium検出値と一致しなければ採取を開始しない。

```powershell
$env:FOUNDATION_PERFORMANCE_POWER_MODE = "reviewed-fixed-performance-mode"
npm run performance:samples:collect -- -- `
  --gate P3-XLSX `
  --evidence-id perf-p3-canonical-run-001 `
  --artifact <artifact.zip> `
  --artifact-manifest <artifact-manifest.json> `
  --environment <environment.json> `
  --target-url <immutable-preview-url> `
  --output <raw-samples.json>
```

collectorは17 canonical scenarioをexplicit dispatchし、対象gateの各scenarioを1回warm-up後、
left-rotationで順序を固定しながら30 round実行する。各実行は新しいPlaywright browser contextを使い、
warm-up値をsampleへ含めない。fixture raw hash、clean commit、Git tree closure SHA-256、artifact hash、
release variant、stable release identity、machine/Chromium binding、telemetryのexact key、全functional
assertionを検証する。outlier除去、欠損sample補間、既存output上書きは行わない。

既定adapterはstandard artifactの公開UI、配信済みXLSX Worker protocol、IndexedDB/Web APIだけを
操作する。collectorはarchive manifestの全public assetを配信bytesへ照合し、fault scenarioではその
照合後にexact Worker URL 1本だけをtracked/hash-bound Workerへ置換する。production hook、runtime
script/style injection、Worker monkeypatch、Service Worker/cache lifecycle変更は使わない。別adapterを
使う場合もclean commitで追跡された`.mjs`だけを`--adapter-module`へ指定できるが、正式protected
workflowは既定public adapter以外を指定するsurfaceを持たない。17 scenarioのregistryが欠けていれば
採取前にfailする。raw scenarioは全31実行で不変な`executionBinding`を持ち、生成fixture
digestまたはfault digestがdriftすればfailする。このCLIやfixture testの成功をphysical 30-sample
evidenceの代用にしてはならない。

`xlsx-worker-export-roundtrip`の`executionBinding.setup`は、`eventLists`と`syncQueue`を使う
単一readwrite transactionのstage receiptをclosed shapeで保持する。stage後は別readonly
transactionでpayload、metadata、checkpoint、50,000件の全field semantic digestを再読込する。
このsetup時間は測定区間に含めない。他の16 scenarioは`setup: null`であり、export以外へstageを
流用したevidenceはfail closedとする。

### Repo-side evidence builder

canonical machineで採取したraw sampleは、次のCLIでevidence envelopeへ変換する。

```powershell
npm run performance:evidence:build -- -- --input <raw-samples.json> --output <evidence.json>
```

このCLIはscenarioを実行せず、sampleを生成・補間しない。入力はgateが要求するscenarioをexactに
含み、各primary/supplementary metricに30件のfinite nonnegative sampleと、fixtureが要求する
全outcome assertionの`true`を持つ必要がある。CLIはmedian/p95/maximum、sample hash、fixture/
policy binding、envelope hashだけを決定的に計算する。pending budget、未知field、29/31件のsample、
dirty tree、current commitと一致しない`source.gitCommitSha`はfail closedとする。outputは既存fileを
上書きしない。

raw inputのtop-levelは次のclosed shapeとする。`source`と`environment`はevidence schemaと同じ
shapeを使い、`supplementarySamples`のkeyは該当budgetの`supplementaryCeilings`とexact一致させる。

```json
{
  "schemaVersion": 1,
  "evidenceId": "perf-p3-canonical-run-001",
  "gate": "P3-XLSX",
  "collectedAtUtc": "2026-08-09T00:00:00.000Z",
  "source": {},
  "environment": {},
  "scenarios": [
    {
      "id": "xlsx-worker-import-valid",
      "samples": [],
      "supplementarySamples": {},
      "outcomeAssertions": {}
    }
  ]
}
```

### Authoritative own-gate producer

P0-RELEASE、P3-XLSX、P5-DUAL、P5-LISTの正式受理では、上記builderの3-key
envelopeを直接入力にできない。protected workflowのproducerがPostgreSQL Release Stateをreplayし、
pending standard acceptance requirementsからaccepted gate、performance gate、source SHA、pending
artifact archive SHA、CAS headを導出する。callerがgateやartifact SHAを指定する経路は持たない。

producerは別の先行workflow runで採取され、review済みSHA-256が指定されたraw samplesだけを読み、
30 samples、functional assertions、machine/Chromium、clean source closure、release variant、artifact
archiveをcanonical builder/verifierで再検証する。同一run、file-only envelope、P8 closureの流用は拒否する。
raw `evidenceId`に束縛されたcollector workflow run IDもreview済みrun IDとexact一致しなければならない。
collector実施者と後続reviewerは同じGitHub accountでよいが、先行run、後続review action、exact hashの
順序と分離は維持する。
さらにGitHub Run APIからcollector runのraw responseとcanonical projectionを取得してimmutable storeへ
保存・readbackし、`completed/success`、run attempt、head SHA、workflow path、artifact名/hashを検証する。
OIDC collector identityとworkflow run authorityの両方が一致しなければproducer receiptを生成しない。
正式artifactは`config/own-gate-performance-evidence.schema.json`のexact 4-key shapeである。

```powershell
npm run performance:own-gate-evidence:produce -- -- `
  --namespace <release-state-namespace> `
  --raw-samples <reviewed-raw-samples.json> `
  --raw-samples-sha256 <reviewed-sha256> `
  --raw-samples-run-id <prior-workflow-run-id> `
  --output performance-evidence.json `
  --receipt-output performance-evidence-producer-receipt.json
```

```json
{
  "schemaVersion": 1,
  "evidence": {},
  "evidenceSha256": "...",
  "producerReceipt": {
    "schemaVersion": 1,
    "receipt": {},
    "receiptSha256": "..."
  }
}
```

embedded receiptはaccepted/performance gate、source/source-closure、authoritative CAS head、requirements
hash、pending archive hash、raw artifact名/run/hash、producer run、output envelope/evidence hash、生成時刻を
不可分に束縛する。raw artifactにはcollector OIDC identityとGitHub workflow run authorityのimmutable
referenceも含み、producerとP8 closureの双方が参照bytesを再検証する。acceptanceの保存前とcommit直前に
pending bindingとlive archiveを再読込し、receiptを
同じperformance evidence objectとしてsubject、event evidence refs、terminal bundle/object setへ含める。
旧3-key envelopeはbuilder中間値としてのみ利用でき、新規formal acceptanceではfail closedする。

### P8 historical accepted-evidence closure

`P8-CLEAN`を単一のfinal artifactで採取してはならない。P0ではmain/full/full、P3では
worker/full/full、P5Dではworker/dual/full、P5Eではworker/dual/autoが要求されるため、final
worker/dual/auto artifactで17 scenarioを再実行すると導入時dimensionの証拠にならない。
`performance:samples:collect -- --gate P8-CLEAN`はbrowser contextを開く前に明示的に拒否する。

P8は次の4 own-gate envelopeを、それぞれを実際に受理したauthoritative `release-accepted`
eventから再解決して`performance-inherited-closure/v1`へ合成する。

- `P0-RELEASE` eventに結び付いた`P0-TOOLCHAIN` envelope
- `P3-XLSX` eventに結び付いた`P3-XLSX` envelope
- `P5-DUAL` eventに結び付いた`P5-DUAL` envelope
- `P5-LIST` eventに結び付いた`P5-LIST` envelope

production CLIはaccepted eventやsubjectのfile入力を受け付けない。PostgreSQL Release State
storeのcurrent headまでを全replayし、4 eventの実record、standard acceptance subject、performance
envelope、package index、artifact manifest、archive availability、三役分のrole-bound approvalとOIDC receipt、live
archive bytesをimmutable referenceから再読込する。eventがoff-chain、object/media type/hashが不一致、
必須role欠落、role-bound approval ID重複、archive欠落/tamper、source/variant/gateが不一致ならclosureを生成しない。
同一provider reviewerによる三役兼任は許可する。
各own-gate artifactのembedded producer receiptも再検証し、accepted event/subjectのgate、expected
state、source、package archive、acceptance workflow runより前のproducer run、output hashと一致しない
旧3-keyまたは自己申告receiptはclosureへ継承しない。

```powershell
npm run performance:inherited-closure:build -- -- `
  --namespace <release-state-namespace> `
  --closure-id perf-closure-p8-reviewed-001 `
  --p0-accepted-event-sha256 <release-accepted-event-sha256> `
  --p3-accepted-event-sha256 <release-accepted-event-sha256> `
  --p5d-accepted-event-sha256 <release-accepted-event-sha256> `
  --p5e-accepted-event-sha256 <release-accepted-event-sha256> `
  --output performance-evidence.json
```

CLIはNode/toolchain、clean `GITHUB_SHA`/Git tree closureを再計算し、作成時刻を実clockから設定する。
closureは`config/performance-inherited-closure.schema.json`のclosed shapeで、4 gate、distinct archive、
17 unique scenario、fixture/evidence/policy digestと、
`collectedAtUtc <= observedThrough <= closure.createdAtUtc`を検証する。実physical sampleやceilingを
生成・補間する機能は持たない。

standard acceptanceでperformance artifactを要求するのは、P0-RELEASE、P3-XLSX、P5-DUAL、
P5-LIST、P8-CLEANだけである。前4 gateは対応するown-gate envelope、P8はhistorical closureが
必須で、P1/P2/P4/P6/P7など他gateではperformance reference/bytes/hashはすべて`null`でなければ
ならない。別gateのenvelopeを流用したり、不要gateに任意artifactを添付したりするとfail closedする。

## Verification

policyとfixtureの整合だけを検証する。

```powershell
node scripts/verify-performance-policy.mjs
```

production exitを検証する場合はgateとevidenceを明示する。

```powershell
node scripts/verify-performance-policy.mjs --require-exit P3-XLSX --evidence <evidence.json>
node scripts/verify-performance-policy.mjs --require-exit P5-DUAL --evidence <evidence.json>
node scripts/verify-performance-policy.mjs --require-exit P5-LIST --evidence <evidence.json>
node scripts/verify-performance-policy.mjs --require-exit P8-CLEAN --evidence <evidence.json>
```

gate modeは、継承scenarioのpending、gate blocker、machine/browser binding欠損、
30 samples未満、統計不一致、fixture/policy/source/artifact hash不一致、functional assertion
未達、absolute/regression ceiling超過のいずれかで失敗する。P8だけはordinary performance
envelopeを拒否し、上記historical closureの4 accepted event/17 scenario/policy closureを再検証する。
`temporaryExceptions` が空でないpolicyは受け付けない。

外部実測後は、raw evidenceから計算したmeasurementとレビュー済みceilingをpolicyへ
commitし、該当pending blockerを削除してからevidence envelopeを生成する。最後にその
envelope digestを該当scenarioの `evidenceSha256` へ設定し、gate verifierを再実行する。
