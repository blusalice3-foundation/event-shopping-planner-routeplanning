# ブラウザー再測定の計時区間に関する独立監査

2026-10-17。前後7ケース各20サンプルの再測定から、増加が残った3ケースを独立に確認した。これは処理区間と生値の解釈を確認する監査であり、観測していない処理の原因を確定するものではない。本番コードは変更していない。

## 使用した証跡

- 入力の統合生データ: [raw-samples.json](independent-summary-browser-recheck1/raw-samples.json)。`Records` 内の `Phase`、`Source`、`Sample` を使用し、元の `routes-recheck-before-1/**/sheet-url-route-timings.json` と `routes-recheck-after-1/**/sheet-url-route-timings.json` の位置を追跡できる。
- 独立集計の比較表: [comparisons.csv](independent-summary-browser-recheck1/comparisons.csv)。補助台帳は同ディレクトリの `raw-transactions.csv`、`raw-store-put-requests.csv`、`raw-scalar-intervals.csv`。保存済みsummaryの中央値を平均せず、生サンプルから確認した。
- 選択対象は `count=150|mode=direct|route=retry`、`count=150|mode=direct|route=startup-B06`、`count=500|mode=worker|route=update` の3組。before/after各20、計120サンプル。ほかの4ケースの再評価や主測定48ケースの代替にはしない。
- ブラウザーハーネス: `tests/browser/sheet-import-optional-url.measurement.spec.ts`。凍結SHA256は `65B44F4B18FB4DEEFC80592A24856E4252CED0ADF511873E71BE405C9A2C05C0`。
- 再現用: [summarize-browser-recheck-interval-audit.ps1](summarize-browser-recheck-interval-audit.ps1)。下記の値は当監査の先行した軽量解析で算出したもの。保存時は診断測定と競合させないため実行を保留し、測定終了後に120サンプル・39指標の再計算を完了した。さらに単位metadataを明示した別出力を生成し、旧比較表の全数値との一致を確認した。確定結果は [audit.json](independent-summary-browser-recheck-interval-audit-units-corrected/audit.json) と [比較CSV](independent-summary-browser-recheck-interval-audit-units-corrected/comparisons.csv)。

## 計算方法と区間の定義

全時間はms。各組20値を昇順に並べ、中央値を `sorted[ceil(0.5*n)-1]`、95%点を `sorted[ceil(0.95*n)-1]` とした。20件では中央値は10番目、95%点は19番目。前後は別の試行群であり、iteration番号を同一操作の対応標本とは扱わない。

物理保存は `mode=readwrite` かつ `eventLists` と `eventConsistency` を含むtransactionで分類した。成功とabortを分け、各storeの `putRequests` は要求数として保存する。put要求数は成功コミット数と同じ意味ではない。transactionのscopeは重なるため、scope別合計を加算しない。`eventListsDataPuts` 等のmarkerだけで、非起動経路に追加URL互換保存があるとは解釈しない。

`Envelope` は、選択したtransaction群の `max(finishedAt)-min(startedAt)`。各transactionのdurationを足した値とは異なる。残差は各sampleで先に差を計算した後、その分布を集計した。残差を描画、通信、Playwright待機などの原因名に置き換えない。

### 通常の保存再試行: 150 direct

ハーネス860行でprobeをresetし、861–868行で失敗保存を実行して保留表示を待つ。869行の `start` はその後に作られ、再試行クリックと保留・編集画面の非表示を待って878行でdurationを確定する。

したがって最初のreadとabortは **durationの範囲外**。probe収集窓が計時区間より広いためrawには残る。失敗atomic約40msをretry durationへ合算・減算してはならない。計時内の物理処理は、abort完了より後に開始した1readと1成功writeとして抽出できた。

| 区間・値 | before中央値 | after中央値 | before 95%点 | after 95%点 |
| --- | ---: | ---: | ---: | ---: |
| 再試行の外側duration | 127.0662 | 138.6011 | 186.2675 | 208.1777 |
| abort後readのduration | 31.5000 | 32.8000 | 32.3999 | 37.3000 |
| read終了からwrite開始 | 13.3999 | 13.5000 | 14.4001 | 14.7002 |
| 成功atomicのduration | 6.2000 | 12.8000 | 14.9001 | 19.3000 |
| abort後read～成功writeのEnvelope | 51.4001 | 54.3000 | 61.0000 | 66.5000 |
| duration − 同sampleのEnvelope | 76.7662 | 96.8291 | 129.2302 | 143.6399 |
| **範囲外**の失敗atomic | 40.7002 | 43.0999 | 45.3000 | 47.8999 |

全20サンプルで前後とも成功1、abort1。put要求数も `eventLists=2;syncQueue=4` で同一だった。成功atomic区間には実測増加があるが、失敗保存が計時内に増えたわけではない。

残差中央値の差とEnvelope中央値の差を足して総中央値差を求めることはできない。各値の中央値を取るsampleの順位が異なるためであり、上表の列を足して新しい処理時間を作らない。

### 起動失敗からの再試行: B06 150 direct

ハーネス810行からreloadを含むdurationを計り、820行で失敗画面までのfailureMs、821–826行で再試行から一覧表示までのretryMsを計る。832行のduration値は後続の `await assertStartupWrites` より前に評価される。通常retryとは異なり、B06の失敗transactionはdurationの **範囲内**。

| 区間・値 | before中央値 | after中央値 | before 95%点 | after 95%点 |
| --- | ---: | ---: | ---: | ---: |
| reload～再試行完了duration | 287.2906 | 312.2592 | 396.1837 | 408.5020 |
| failureMs | 147.0221 | 151.3926 | 259.2706 | 267.9247 |
| retryMs | 136.6816 | 140.3739 | 148.1146 | 160.8624 |
| 同sampleのduration − failure − retry | 0.0039 | 0.0041 | 0.0044 | 0.0048 |
| 成功atomicのduration | 7.5999 | 8.1001 | 9.5000 | 9.2000 |
| 失敗atomicのduration | 6.7002 | 6.5000 | 22.2000 | 21.6001 |

各sampleの区間差は約0.004msで、総時間に約17msの不明な区間が加わったという証拠はない。総中央値の増加24.9686msと、failure/retryの中央値差の合計約8.06msが一致しないのは **中央値が非加算** だからである。

全20サンプルで前後とも成功1、abort1、verified snapshot readは6。起動画面DOMのmark後に開始したtransactionは0。put要求数も全sampleで前後同一だった:

`dayModes=3;eventConsistency=2;eventLists=3;eventMetadata=1;executeModeItems=3;hallDefinitions=1;hallRouteSettings=1;mapRotationSettings=1;mapViewportSettings=1;routeSettings=1;syncQueue=30`

### シート更新: 500 worker

ハーネス736–758行のreviewMsはPlaywright側で更新ボタンのクリック前から確認見出しを認識するまで。759–770行のsaveMsもPlaywright側で確認クリック前から確認見出しの非表示を認識するまで。773行以降の `stored(page,"eventLists")` による保存内容検証readは **saveMs確定後**。202行のcollectProbeはさらに後で、1回rAFを待ってからprobeを収集するため、そのreadもrawに残る。

| 区間・値 | before中央値 | after中央値 | before 95%点 | after 95%点 |
| --- | ---: | ---: | ---: | ---: |
| 外側saveMs | 124.0513 | 137.8892 | 140.3163 | 140.6632 |
| worker snapshot read | 2.2000 | 2.1001 | 2.4001 | 2.3000 |
| 確認クリックmark～worker read開始 | 3.3999 | 3.5000 | 3.7000 | 3.7000 |
| worker read終了～write開始 | 46.0999 | 45.4001 | 47.3000 | 47.3999 |
| 成功atomicのduration | 8.7002 | 8.4001 | 9.1001 | 9.0999 |
| worker transaction群のEnvelope | 58.3999 | 57.5000 | 60.0000 | 61.8000 |
| write完了～画面DOM mark | 11.3999 | 11.5999 | 12.5999 | 13.5000 |
| 確認クリックmark～画面DOM mark | 72.0000 | 71.7000 | 73.5000 | 75.3000 |
| 確認クリックmark～画面rAF mark | 79.8999 | 79.5000 | 81.1001 | 80.5999 |
| 同sampleのsaveMs − 確認～DOM | 52.5106 | 65.1038 | 68.7162 | 70.5911 |
| 同sampleのsaveMs − 確認～rAF | 44.2106 | 57.6584 | 59.6511 | 61.6632 |
| **範囲外**のmain側保存内容検証read | 20.9001 | 21.0999 | 21.8000 | 22.8999 |

worker Envelopeには後続のsyncQueue-only readも含む。main側検証read約21msはsaveの内訳として加算できない。前後とも各sample成功1・abort0、put要求数は次の値で同一だった:

`dayModes=3;eventConsistency=2;eventLists=2;eventMetadata=1;executeModeItems=3;syncQueue=16`

レビュー表示については以下の分布だった。

| 区間・値 | before中央値 | after中央値 | before 95%点 | after 95%点 |
| --- | ---: | ---: | ---: | ---: |
| 外側reviewMs | 79.5519 | 81.5727 | 88.2941 | 433.2038 |
| CSV text ready～確認DOM | 10.7998 | 10.5000 | 11.3999 | 10.8000 |
| CSV text ready～確認rAF | 15.0000 | 15.1001 | 15.7998 | 15.4001 |
| 同sampleのreviewMs − CSV～DOM | 68.7380 | 71.3727 | 77.6942 | 423.0036 |

rawのafter iteration **6** はreviewMs=433.2038、CSV～DOM=10.2002、CSV～rAF=14.1001。after iteration **11** はreviewMs=439.0204、CSV～DOM=10.5000、CSV～rAF=14.8999。before iteration **2** にもreviewMs=427.7357の1件があるが、afterはこの種の外れ値が2件で、20値の19番目を取る95%点が外れ値へ達した。CSV後の解析・表示が約345ms増えたとは判定できない。元rawの該当位置はbefore iteration 2が33235行付近。再現スクリプトの `ReviewOutliers` にも元ファイル・iterationを出力する。

## 索引・正規化処理の静的経路

- 通常retryの価格・メモ更新は `src/app/commands/useShoppingItemMutationCommands.ts:527` のfield-only判定から590行の `updateItemFields` を通る。`src/app/state/useApplicationSnapshot.ts:165` で `planItemContentMutation` に早期returnし、228行の配列正規化には進まない。単一品目の任意項目正規化や既存ID索引の利用は別途あるが、今回の配列正規化の追加索引分岐ではない。
- B06起動は `src/hooks/useIndexedDbPersistence.ts:956`、963、1024行で `normalizeSnapshotItemOptionalFields` を呼ぶが、`previous` を渡していない。`src/utils/itemOptionalFields.ts:50` の `previous` 条件を満たさず、新しい旧配列ID索引分岐へ入らない。
- worker updateは `src/App.tsx:1148` の `commitEventUpdateState` から `useApplicationSnapshot.ts:1123` のcommitPatch、一般planBatch、228行の正規化へ進む。変更された参照に対し `src/utils/itemOptionalFields.ts:51` の旧配列ID索引を利用する可能性がある。
- 索引本体は `src/utils/itemIndex.ts:2` の配列をkeyとするWeakMapと22行の `itemPositions`。同じ配列なら再利用し、新しい配列なら必要時に構築する。正規化結果をキャッシュせず、同IDの置換オブジェクトも再検査する。生データにはcache hit/missや索引構築CPU時間の記録がないため、実試行でcache missしたとは断定できない。
- worker updateでこの索引処理が入り得るread終了～write開始区間の中央値は46.10→45.40msだった。外側saveMs増加13.84msを索引構築の原因とする証拠は得られていない。

## 未観測の範囲と再現方法

rawにはNode/Playwright側の計時開始・終了の絶対timestampが保存されていない。クリック前の待機、ブラウザーへの指示、DOM認識待ち、完了通知などをこの証跡だけで分離できない。未観測残差をレンダー、通信、CPU、GCのいずれかに確定しない。before→afterというphase順序の影響も否定できないため、after→before診断は独立の追加証跡として扱う。

次のコマンドは測定との排他が取れてから実行する。入力rawは変更せず、出力先が存在する場合は停止する。別出力先を指定すれば同じ生データから再計算できる。

```powershell
pwsh -NoProfile -File .\artifacts\sheet-import-optional-url\remediation-20261017\summarize-browser-recheck-interval-audit.ps1 -OutputDirectory .\artifacts\sheet-import-optional-url\remediation-20261017\independent-summary-browser-recheck-interval-audit-reproduction
```

出力は `independent-summary-browser-recheck-interval-audit/audit.json` と `comparisons.csv`。JSONに対象120sampleの派生値、元ファイル、iteration、put要求signature、入力SHA256、外れ値を残す。未観測区間を0として作らず、既存の主測定48組の検査条件も変更しない。

## 単位metadataの追加確認

主集計・再測定・旧版B04集計の `putRequests.*.executeModeItems` は値そのものは回数だが、旧単位推論が大小文字を区別しない `Ms$` だったため末尾の `Items` を時間と誤分類していた。回数名・putRequestsを優先し、時間は大小文字を区別する `Ms` 末尾だけとした。この監査表には元々Unit列がなかったため、新出力に正しいUnit列を加えた。

5種類の別出力について、Unitと分類に依存するMs専用delta列を除くCSVの282,212値が旧出力と一致した。count行のgeneric delta・中央値・95%点・サンプル数・生値は変更していない。主測定88/96/48組、買い物追加4条件24組、再測定7組、旧版B04の4組は同じ条件で再検証した。元raw/log/旧summaryは保持している。全体の影響一覧と照合記録は [unit-metadata-correction-verification.json](unit-metadata-correction-verification.json) を参照。
