# iOSファイル入出力修正後の正式性能測定（2026-11-09）

`npm run test:browser:completion` が終了コード0で完走し、性能4群の全144ケースが通過した。主530指標と保存補助46指標すべてに、各10回・計5,760サンプルがそろっている。欠測・性能の再試行・スキップ・基準超過は0件。4群の成果物検証と独立した読み取り専用の再検証もすべて通過した。

以前の[クロスプラットフォーム確認記録](ios-file-transfer-cross-platform-review-20261109.md)における「正式性能は未測定」は、そのレビュー時点の記録である。本記録がその後に実施した正式測定の結果を示す。

## 結果

| 群       | ケース | 主指標 | 群内最大の中央値 | 群内最大の95%点 | 基準（中央値／95%点） | 結果   |
| -------- | -----: | -----: | ---------------: | --------------: | --------------------- | ------ |
| shopping |     16 |    192 |          44.65ms |         57.00ms | 65／100ms以下         | 全通過 |
| range    |     20 |     80 |          50.90ms |         60.70ms | 160／160ms以下        | 全通過 |
| drag     |      8 |     60 |          68.45ms |         88.10ms | 160／160ms以下        | 全通過 |
| transfer |    100 |    198 |         102.31ms |        105.21ms | 160／160ms以下        | 全通過 |

数値は個別指標の中央値・95%点を群ごとに最大化した値で、全サンプルの混合集計ではない。中央値と95%点の最大値は別の指標に由来する場合がある。transferの保存完了46指標は操作反応と分離した補助指標であり、上表の主指標数・時間基準には混ぜていない。保存の原子性と整合性の検証も通過した。

同じ正式runner内の一般機能テストは531件成功・既存54件スキップ・失敗0・flaky0。一般機能の設定上の再試行上限は2だが、実際の再試行は0。性能4群は設定・実際ともworker 1、retry 0。

## 測定ソースと条件

- 測定コミット：`860731f96409b8c6c99792c986f29e50986773cd`。隔離worktreeのクリーンなソースからRelease Aをビルドした。
- 製品の `src`／`public` は、今回のファイル入出力レビュー完了時点 `132eb206075ddbf7eab8e705310bbc76e61319d9` と同一。GPU用の追加は測定設定・記録・検証・テスト・説明に限定した。
- profile：`completion`、各10回、sampling policy：`performance-samples-2026-10-26`。
- shopping基準：`shopping-operations-150-500-65-100-2026-10-25`。
- range／drag／transfer基準：`dnd-selection-rendering-160-160-2026-10-28`。
- 条件・fixture・地図と過去10,000品目の負荷・ウォームアップ・操作・計測終了点・フレーム比較・保存検証・時間基準は変更していない。1,500品目の任意診断は含めていない。
- Windows 11 Pro `10.0.26200` x64、Node `24.19.0`、bundled Chromium `151.0.7922.34`、headless、CI設定 `1`。
- 開始：2026-11-09 05:48:37 JST、終了：07:35:07 JST。runner約106.50分（ビルド時間は別）。run IDの日時はUTCである。

これは上記Windowsホスト上のChromiumによるPC・スマートフォン幅とタッチ入力条件の正式測定である。実Android／iPhone上での性能測定、Foundationの別契約である物理30サンプル測定、旧ソースとの速度差の検証には読み替えない。iPhoneでの482KB xlsx取込・xlsx出力・JSON保存3操作は、前回のユーザー実機確認として別に保持する。

## GPUの利用

NVIDIA GeForce RTX 5070 Ti（driver `32.0.16.1714`）のANGLE D3D11が、測定前後の実ブラウザ照会で確認できた。GPU合成とラスタライズは有効、Canvas2Dはソフトウェア処理である。

`PERFORMANCE_ENABLE_GPU=1` のときだけ共通helperが `--enable-gpu` と `--disable-accelerated-2d-canvas` を追加する。Canvas2Dの指定は解析専用ではなくアプリ全体にも適用される。GPU Canvas2Dで生じたキャッシュ有無による微小な画素比較差を、既存の比較式や検証条件を緩めずに避け、従来のソフトウェアCanvas2Dを維持した。正式設定のCSP・PWA・フレーム比較16件も事前に通過した。

共通helperをrunnerの環境採取とPlaywrightの実ブラウザ起動で共有し、runと全144添付に起動指定を記録した。成果物検証は両者の一致を要求し、前後比較では異なるGPU指定・引数・情報欠落を比較不可とする。既定の未指定／`0` は以前の起動を維持する。新しい測定設定関連のNodeテスト340件、型チェック・Lint・整形・文字コード検査が通過した。

再実行例（クリーンな測定ソース上で実行）：

```powershell
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$env:ESP_PERFORMANCE_PROFILE='completion'
$env:PERFORMANCE_ENABLE_GPU='1'
$env:PERFORMANCE_BROWSER_CHANNEL=$null
$env:PERFORMANCE_HEADED='0'
$env:CI='1'
npm run test:browser:completion
```

## 証拠と履歴

正式run ID：`2026-11-08T20-48-37-531Z-c6485703-45b0-4c95-8b2b-05ff2463b416`。

- [canonical結果](../artifacts/dnd-selection-rendering/after/2026-11-08T20-48-37-531Z-c6485703-45b0-4c95-8b2b-05ff2463b416/run-result.json)
- [独立再検証](../artifacts/dnd-selection-rendering/after/2026-11-08T20-48-37-531Z-c6485703-45b0-4c95-8b2b-05ff2463b416/independent-audit.json)
- [指標別集計](../artifacts/dnd-selection-rendering/after/2026-11-08T20-48-37-531Z-c6485703-45b0-4c95-8b2b-05ff2463b416/metric-summary.json)
- [GPU設定](../artifacts/dnd-selection-rendering/after/2026-11-08T20-48-37-531Z-c6485703-45b0-4c95-8b2b-05ff2463b416/gpu-measurement-configuration.json)、`gpu-system-info-before.json`／`gpu-system-info-after.json`。
- [ソースのコピー一致確認](../artifacts/dnd-selection-rendering/after/2026-11-08T20-48-37-531Z-c6485703-45b0-4c95-8b2b-05ff2463b416/source-file-hashes.json)。このセッションの30ソースファイルが測定コミットと一致する。本文は測定後に追加した記録であり測定ソースには含まれない。

rawのreport、添付、画像、フレーム判定、サンプル、元の絶対パスは変更せず保存する。隔離worktree `D:/esp-ios-xlsx-20261108` と作業ディレクトリに同じ証拠を保持する。

初回 `2026-11-08T20-14-59-691Z-c83b64fd-9cca-4626-9667-e71f4f112958` はfull Chromeに対するAdGuardのCSP変更・スクリプト注入とPWA条件の相違により、一般機能確認中に中断した。性能採取は0件で、canonicalの途中checkpointと `environment-interruption.json` を保持する。外部フィルタ設定・CSP・検証条件は変更せず、今回の新しい正式runとサンプルを混在させていない。中断を製品の性能失敗とも、正式完走とも扱わない。GPU構成の事前診断と過去artifactも独立した履歴として保持する。

文字コードはUTF-8・BOMなし・LFを維持した。製品ソースの日本語代表行に変化はない。
