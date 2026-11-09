# zip.js JS inflateの限定補正

対象は `@zip.js/zip.js@2.8.34`。依存全体を更新せず、履歴バッファを折り返すコピーの末尾を正しいバッファから読む分岐だけを追加する。既存デコーダへの追加は50バイトで、実行時の文字列置換や追加の解凍は行わない。

- 上流修正: <https://github.com/gildas-lormeau/zlib-streams-ts/commit/6c859810aadd52b7036f7e34bf2dbd411f9b12fb>
- 適用・検査: `scripts/patch-zipjs-inflate.mjs`
- 対象: `lib/core/streams/zlib-js/zlib-streams.min.js`
- 補正前SHA-256: `bde6b11d9332b355ab68556f164932c11e08f6a29b89e0de232483ec7ad625a8`
- 補正後SHA-256: `d0c477ce6f1d2b1d7e262088a57d7fd908bedde6cd325ed5d411a48be3c2a3a9`

製品の `zipPreflight.ts` から依存を解決し、`zip-core-native.js` → `zip-module-native.js` → 上記デコーダの参照を検査する。未知のバージョン・モジュール経路・内容は停止する。`apply` は既知の補正前バイトと置換1箇所を確認して適用し、補正後のハッシュを保存前後に検証する。適用済みなら書き換えない。`verify` は読み取り専用であり、未適用でも依存を変更しない。元のUTF-8・BOMなし・改行なしを維持する。

通常の `npm ci` はpostinstallで適用する。`--ignore-scripts` を使用した場合は、開発・ビルド・解凍試験の前に `npm run patch:zipjs-inflate` と `npm run verify:zipjs-inflate` を実行する。ビルドとVitestは開始前に検査し、未適用なら停止する。Foundation専用workflowの契約は変更しない。

既存の依存へ明示適用するときは開発サーバーを停止し、適用・検査後に `npm run dev -- --force` で起動してViteの依存を再最適化する。変換・結合後の配信モジュールのハッシュに元デコーダと同じ値は要求しない。PWAキャッシュや利用者の保存データの削除は不要で、Service Workerの自然activation契約を維持する。

Windows・Androidのネイティブ優先と、Apple WebKitのJS解凍選択を維持する。CRC照合・ZIP構造検証・リソース制限・中断・Workerへの入力transfer・バッファの再利用は変更しない。PC互換試験はiPhoneやAndroid実機での解消確認と区別し、未測定の性能・メモリは未確認として扱う。

補正を含む上流版へ更新するときは、固定再現データ・破損拒否・実Worker・PWA・各OS互換・性能を別途検証してから本補正を撤去する。先にバージョンやハッシュだけを書き換えて未知の実装を受け入れない。撤去時はpostinstall・開発／ビルド／試験前検査とビルド入力closureの明示リストも整合させる。

## ライセンス

zip.jsパッケージはBSD-3-Clauseで配布され、元のLICENSEと通知を保持する。追加した上流分岐と、`src/xlsx/fixtures/inflateWindowWrap.ts`・`inflate-window-wrap-tail.v1.json` の合成コーパス（同じ上流コミットの `CODE_FRAGMENTS` と決定的な生成方法を利用）はzlib-streams-tsのMITライセンスに基づく。固定した圧縮データは合成データであり、利用者の原本は含まない。以下は上流コミットの [LICENSE.md](https://github.com/gildas-lormeau/zlib-streams-ts/blob/6c859810aadd52b7036f7e34bf2dbd411f9b12fb/LICENSE.md) の通知である。

Copyright (C) 2025 - Gildas Lormeau
Copyright (C) 1995-2024 Jean-loup Gailly and Mark Adler (zlib)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
