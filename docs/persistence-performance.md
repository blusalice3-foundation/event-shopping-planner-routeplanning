# 保存処理の追加高速化

SHA-256 と同期ハッシュの検証で、同じ保存データの文字列化・UTF-8 変換を共有する。通常編集では、内部で保持した検証済みマップと呼び出し元のマップが一致し、保存用変換をしても内容が変わらない場合だけ、マップの全体コピーと再変換を省く。

復元・移行・変更されたマップ・旧形式のマップは従来の全面的な準備を通す。保存を確定する処理は共通で、全11領域の現在データ・世代情報・checkpoint・移行記録を同じトランザクション内で検査する。保存形式、ハッシュ値、破損検知、他タブとの競合検知、保存失敗時のロールバックと再試行を維持する。

## 保存確定までの計測

Windows 11、Node 24.19.0、Playwright 1.62.1 の headless Chromium。通常の HTTP 配信で計測ページを開き、新しいブラウザーの独立した IndexedDB を使い、150アイテム、1イベント、値の入った1万セルまたは4万セルのマップを用意した。修正前は `92420a7`、修正後は今回の変更を含むソースから、同じ方法で保存 API のブラウザー用バンドルを作った。修正前→修正後の順で実行し、テスト・ビルドとの同時実行は避けた。

各ケースは2回ウォームアップして9回測定する。1アイテムの数量を変更し、保存 API の Promise が完了するまでを測る。各保存後に別の読み込みで値が確定していることも確認する。この確認の時間は表に含めない。

単位は ms、各列は独立した中央値。

| マップ  | 処理                     | 修正前 | 修正後 | 短縮率 |
| ------- | ------------------------ | -----: | -----: | -----: |
| 1万セル | 読み込み                 |   90.1 |   64.1 |  28.9% |
| 1万セル | 更新準備と保存確定       |  104.5 |   74.3 |  28.9% |
| 1万セル | 読み込みから保存確定まで |  194.6 |  136.8 |  29.7% |
| 4万セル | 読み込み                 |  388.7 |  268.9 |  30.8% |
| 4万セル | 更新準備と保存確定       |  468.3 |  311.0 |  33.6% |
| 4万セル | 読み込みから保存確定まで |  861.4 |  579.3 |  32.7% |

[実測サンプル](persistence-performance.samples.json) に保存した。これはネイティブ IndexedDB 上の保存処理のローカル診断であり、画面描画、アプリの変更計画・確認ダイアログ、保存キューの待ち時間を含まない。全操作・全データ量・全端末の短縮率を保証する値や、正式なリリース性能承認の証跡としては使用しない。

## 保持する条件

- ハッシュの共有は同じ読み込みで得た固定データ内に限定する。保存確定時の現在データの検査は別に実行し、以前の計算結果で省略しない。
- マップの再利用にはアプリが発行した読み込みハンドルを使う。検証済みの基準データは WeakMap 内で保持し、呼び出し元へ返すスナップショット・診断用の世代情報は分離する。
- 呼び出し元の変更対象データは最初の await 前にコピーする。保存中に呼び出し元が変更しても、確定する内容が混ざらない。
- 旧形式の空セル、白色・空文字の色情報などが変換で整えられる場合は、準備を省略しない。ブロック番号・名前・結合アンカーに必要な空セルは保持する。
- 無変更の確定操作でも軽量な領域への書き込みを維持し、保存失敗・再試行の動作を保つ。

## 回帰検証

SHA-256 と同期ハッシュの個別不一致、共通エンコード、呼び出し元の変更との分離、変更マップと全面復元、metadataを更新しないマップ改変、保存失敗・再試行、旧形式のマップ変換、ブロック番号・名前・結合アンカーを検証する。既存の整合性・復旧・他タブ競合・アプリ操作のテストも継続して実行する。

## 再計測

PowerShell で `AGENTS.md` の UTF-8 コンソールラッパーを適用する。バンドルを一時ディレクトリに作成する。

```powershell
$benchmarkRoot = Join-Path $env:TEMP 'esp-save-benchmark'
New-Item -ItemType Directory -Path $benchmarkRoot -Force | Out-Null
$projectRoot = (Get-Location).Path.Replace([char]92, [char]47)
$entry = "export { readApplicationSnapshot, commitApplicationSnapshotAtomically } from '$projectRoot/src/persistence/db/atomicRestoreTransaction.ts';`nexport { createEventConsistency } from '$projectRoot/src/types/consistency.ts';"
$entry | Set-Content -LiteralPath (Join-Path $benchmarkRoot 'entry.ts') -Encoding utf8
node node_modules/esbuild/bin/esbuild "$benchmarkRoot\entry.ts" --bundle --platform=browser --format=iife --global-name=SaveBenchmark "--outfile=$benchmarkRoot\save.js"
Get-Content -LiteralPath "$benchmarkRoot\save.js" -Raw -Encoding utf8 | node scripts/performance/persistenceLatency.mjs
```

比較する各コミットで同じコマンドを使う。出力にはケースごとの中央値と、36件の比較元・比較後サンプルの元になる各実行18件の値が含まれる。別のテスト・ビルド処理との同時実行は避ける。
