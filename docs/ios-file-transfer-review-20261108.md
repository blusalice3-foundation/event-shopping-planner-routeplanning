# iOS Safari の xlsx / JSON ファイル入出力確認（2026-11-08）

## 報告された条件と判断範囲

- ユーザー報告: iOS 27.2。482KB のイベント xlsx 選択時にページが再読み込みされる。27KB の xlsx と JSON の取込みは可能。
- 報告された実ファイルと実機はこの環境にないため、原因の確定および実機での解消確認はしていない。
- 圧縮後サイズだけでは展開後の XML・マップオブジェクト・ExcelJS の使用メモリは分からない。xlsx 復元時の余分な全体コピーを確認した。
- xlsx の入力・出力は共通の ZIP 事前検証を通る。既存処理は native `DecompressionStream` を使用し得る。WebKit には stream 終了時の invalid free / crash の修正記録があるが、報告端末の原因とは断定しない。
  参照: https://github.com/WebKit/WebKit/commit/43a1b0bafb0c4d47208338c97756cfcb9304fa1f

## 修正

1. ZIP 検証を既存 zip.js の JavaScript inflater へ切替。native codec と WASM への依存を避け、依存パッケージ追加・CSP 緩和は行わない。CRC、ZIP ヘッダー照合、危険 XML の拒否、容量・展開率・時間上限と中断は維持する。イベントと地図の xlsx 取込み、および xlsx 出力検証へ共通適用される。
2. イベント xlsx は `File.arrayBuffer()` の前に既存の 32 MiB 上限を確認し、上限超過時に全体を読み込まない。482KB の報告ファイルをこの上限で拒否する変更ではない。
3. 復元候補作成時に生成済みのバックアップを再利用し、マップ全体の余分な JSON stringify / parse を 1 回削減する。`parseAppBackup` による構造・参照整合性検証と移行通知は維持する。
4. xlsx と JSON の保存を共通化。ダウンロード直後の Blob URL 即時解放をやめ、正常開始時は 60 秒後に解放する。開始例外時は即時解放する。xlsx 保存時の余分な ArrayBuffer 全体コピーも削減する。

JSON バックアップのスナップショット内容・構造・参照整合性検証に、今回の調査で破損につながる不具合は見つからなかった。保存開始時の URL 解放問題は JSON にも適用されるため修正した。

## 検証

- 関連 Vitest 8 ファイル・167 テスト成功。イベント取込み、簡易・地図付き xlsx の復元、関連設定、JSON バックアップ、ZIP セキュリティ、Worker、Blob URL の寿命を確認した。
- 別の関連実行で Worker adapter と復旧用 JSON 出力を含む 174 テスト成功。上記とは重複するため合算しない。
- 既存 iOS 関連 36 ケースと、大きな地図へ変更した新規ファイル入出力 6 ケースが 3 browser projects ですべて成功（計 42 ケース）。新規ケースの小さい fixture での先行実行と、metadata 保存用の再実行は合算しない。2026-11-09 に実行対象を再照合して件数の説明を訂正した。
- browser projects: desktop Chromium、Android Chromium、mobile WebKit。実際の xlsx Worker を使用し、native `CompressionStream` / `DecompressionStream` を例外に置き換えても処理が成功することを確認した。
- 大きい取込み fixture: 500 品目、50,000 マップセル、圧縮 807,454 bytes、展開 11,521,487 bytes。人工的な混合負荷であり、報告されたファイルと同一ではない。取込み後の JSON バックアップに品目、日本語、地図寸法が保存されることを確認した。
- xlsx の実出力を ExcelJS で読み戻し、画面から別イベントとして再取込みし、JSON バックアップに両イベントの日本語・数量・状態が保持されることを確認した。クラッシュ、意図しないページ再読み込み、pageerror はなかった。
- TypeScript、変更対象 ESLint / Prettier、architecture、test-project-membership、dependency-usage、CSP policy、文字コード検査が成功。
- UTF-8 BOM なし・各既存ファイルの LF を維持。U+FFFD、文字化け、不自然な `?` 増加なし。「ユーザー登録」「エラーが発生しました」の保存・再読込を確認した。

ブラウザの検証はデスクトップ上の互換試験であり、iOS の実メモリ上限、OS のファイル選択、PWA と Safari のダウンロード画面までを証明しない。反映後に報告された 482KB ファイルを実機で再確認する必要がある。

性能 4 群の測定は実行しておらず、性能の合格判定には使用しない。基準値・過去 artifact は変更していない。

2026-11-09 の全体レビューでは Windows / Android の native 解凍経路を維持するよう適用範囲を絞った。上記は初回修正時の検証記録であり、以後の判断・測定・残る制限は [追加レビュー](ios-file-transfer-cross-platform-review-20261109.md) を参照する。
