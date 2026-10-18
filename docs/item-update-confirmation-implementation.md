# アイテム更新確認の実装・検証報告

作成日：2026-10-18（日本時間）
実装検証用ソース：`1d840d6f3aa3c0949ca7eadf1b16b5e9cbc375b4`
修正前の基準：`f15552dd999c6c1aab55a6b0ab9c2056bd0fa4ec`（`f15552d`）
品質検査・ロールバック検査は、上記の同じクリーンな実装ソースを対象とする。

ソース処理と買い物性能の計測ソースは `cb2b22b974a50a0e3cbaae979bfad8789533493c`。最終検証ソースとの差分はREADMEと更新計測ハーネスだけで、アプリのsrc tree・設定・依存・公開資産は同一。ビルドに埋め込むコミット情報は異なるため、distの全バイト同一は主張しない。[同一性の記録](../artifacts/item-update-confirmation/runtime-identity.txt)を参照。

## 実装内容と回帰検証

| ID  | 実装した動作                                                                                                                                                                                                           | 主な恒久テスト                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 元文字列によるタイトル込み／タイトル以外の全対応を固定した後、未対応分だけ前後空白を除いた同じ2段階で救済。正規化衝突と改題でも既存IDを再配分しない。                                                                  | `sheetMatching.test.ts` のA/B衝突・入力順違い・由来値・保存済み識別欄の維持、`updateFlow.test.ts` の適用結果                                     |
| 2   | 先行する未保存操作で確定が保留された場合は確認を保持し、先行操作の再試行・取消後の再確定を案内。再読込を要求しない。                                                                                                   | `useEventUpdateCommands.test.tsx` のID 2、保存取消・Quota後の確認保持                                                                            |
| 3   | 取得結果の受理・確定開始・保存再計画／再試行で捕捉済み入力の有効性を確認。無効な入力からの結果受理・確定・保存を止める。                                                                                               | `useEventUpdateCommands.test.tsx` のloading/confirmation/queued-retry、`eventUpdateInvalidation.integration.test.tsx` の補助確認再開時の入力変更 |
| 4   | 購入済み数量の変更が実購入数・支出集計にも反映されることを説明し、一括同意で確定。限数の扱いも併記。                                                                                                                   | `UpdateConfirmationModal.test.tsx` の両数量影響の説明・既定OFF・同意ON/OFF、既存数量適用テスト                                                   |
| 5   | 保存済みシート名を入力欄に表示し、空欄に変更した値もそのまま送信。名称優先、空欄ならgid、どちらもなければ先頭シートの扱いを説明。                                                                                      | `UrlUpdateDialog.test.tsx`、`AppOverlayLayer.sheetImport.integration.test.tsx`、`updateFlow.test.ts` の明示的空欄                                |
| 6   | 名称／gidの優先順位を実取得と揃えて更新元を判定。確認に使用したURL・シート名を品目・実行列と同じ一括保存で確定。                                                                                                       | `duplicateEvent.test.ts` のsource identity、`updateFlow.test.ts` のreviewed source、更新コマンドのcomposite commit                               |
| 7   | 照合済み行を登録後、未対応の追加候補だけ完全重複を除外。数量はrawQuantityを評価してキーに反映し、不正数量は登録しない。既存の別IDは統合しない。                                                                        | `updateDiff.test.ts` の空欄/1/2・不正数量・別ID・行減少・保護混在、反復更新の件数安定                                                            |
| 8   | 保存中・保存保留中は数量同意・二重確定・更新全体の取消を固定。補助確認と保存試行の取消は操作可能とし、保存試行の取消・既知の未保存失敗後に確認の編集へ戻す。保存結果不明・保存後の画面反映失敗は終了して再読込を案内。 | `useEventUpdateCommands.modal.integration.test.tsx`、`UpdateConfirmationModal.test.tsx`、実coordinatorの競合／日付統合integration                |
| 9   | 操作ID・取得世代・表示要求IDを分離。要求作成時の通知先だけを一度完了し、古い応答は後続操作に触れない。URL再入力は同じ操作で継続。                                                                                      | 更新コマンドのID 9、Appと共用する無効化境界integration、controllerのStrictMode・busy/stale・同一バッチ受付結果                                   |

Appの保存適用時・削除／改名後の無効化と実URL取消を共通終了処理へ接続した。
更新確認／URL表示は、controllerの純粋な遷移直後に要求別の受理・拒否を記録し、コミット後に一度通知する。
受付callbackはdispatch前に登録し、通知前に削除する。キューは消費したIDだけ除去し、同時追加分を保持する。
所有IDを指定したclose/confirmにより、旧操作の終了で後続の画面を閉じない。
保存中・CAS保留中の新しい更新・再取込は拒否し、その要求だけをinvalidatedで完了する。保存中の所有操作と通知先は維持する。

## 維持した仕様

- 自動照合と一括確認を継続し、品目ごとの選択は追加しない。通常更新・同一更新元の再取込・更新元切替で同じ規則を使う。
- 購入状態、IDごとの購入記録、利用者価格・メモ、保護設定、実行列の参照は既存の適用規則を維持する。
- 購入済み数量の同意OFFでは現在数量を保持し、ONでは説明した数量・集計変更を適用する。限数は既存の実購入数保護を維持する。
- 既存の別IDを自動統合しない。削除は従来の確認・保護規則に従う。
- 保存中の通常の買い物入力、実際の競合確認・日付統合確認、保存再試行・保存試行取消は既存の保存ガードに従う。
- 永続化のデータ形式・バージョンは変更せず、追加のシート照会APIや入力監視のポーリングは導入しない。
- 比較用キー以外の保存済み識別文字列を正規化しない。照合・重複判定は固定回数のMap/Set走査とし、通常の買い物操作へ全件照合を持ち込まない。

## 検証記録

| 対象                                   | ソース／条件                                          | 結果・証跡                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 関連回帰テスト・既存正常系             | 実装ソース `1d840d6f3aa3c0949ca7eadf1b16b5e9cbc375b4` | 修正前は指定9ファイル153件成功。修正後の関連15ファイル271件成功。全体では244ファイル2,871件成功、既存1ファイル88件skip。[修正前の関連テスト](../artifacts/item-update-confirmation/related-before.log)・[修正後の関連テスト](../artifacts/item-update-confirmation/related-after.log)の先頭に正確な対象ファイルとコマンドを記録。 |
| 型・書式・文字コード・品質検査         | 同ソースのクリーンなcheckout、`npm run quality`       | 終了コード0。[品質ログ](../artifacts/item-update-confirmation/quality-1d840d6.log)。                                                                                                                                                                                                                                              |
| ロールバック検査                       | 同じcheckout、`npm run test:release-a-rollback`       | 終了コード0。[ロールバックログ](../artifacts/item-update-confirmation/rollback-1d840d6.log)。                                                                                                                                                                                                                                     |
| 保存・再読込                           | ID・件数・購入記録・更新元・実行列                    | 最終版の150/500品目×3入力、各20回の計120回でID・件数・購入記録・利用者価格/メモ・更新元・実行列を検証し、全回で再読込後も一致。既存の取込ブラウザ22件とa11y2件も成功。[取込ログ](../artifacts/item-update-confirmation/sheet-import-regression-1d840d6.log)・[a11yログ](../artifacts/item-update-confirmation/a11y-1d840d6.log)。 |
| 更新処理の修正前後比較                 | 150/500品目、通常・正規化衝突＋改題・完全重複         | 同一環境・100サンプル／30回warmup。両checkoutは計測開始時clean。[全段階の結果](../artifacts/item-update-confirmation/source-performance.json)。差分作成の比較は下表。                                                                                                                                                             |
| ブラウザの買い物性能                   | 必須16条件と追加8条件、各6操作を個別判定              | 前後とも必須16条件96操作・追加8条件48操作が全て通過（各操作20サンプル以上）。最終版の最大中央値/95%点は必須32.8/37.3ms、追加45.9/50.1ms。[全条件表](../artifacts/item-update-confirmation/performance-tables.md)・[比較JSON](../artifacts/item-update-confirmation/comparison.json)。                                             |
| 更新確認の表示・数量チェック・保存完了 | 操作反応、取得待ち、保存完了を分離                    | 前後とも6条件×20回。最終版の6条件中最大中央値/95%点は、応答後の確認DOM16.4/17.6ms、確認paint28.7/33.3ms、数量チェック30.5/31.7ms、IDB保存完了60.5/62.3ms、保存画面paint96.6/97.6ms。取得は40ms遅延のローカル応答（実測待ち最大57.4/60.9ms）で、実ネットワークの速度は測定外。                                                     |

文字コードは既存ファイルのencoding・BOM・改行を維持する。
保存後の再読込、U+FFFD・不自然な疑問符増加・意図しないBOM変更・改行だけの大量差分を確認する。
日本語代表文字列「ユーザー登録」「エラーが発生しました」の確認結果：全体encoding検査成功。UTF-8/BOMなしを維持し、既存CRLF/LFの形式変更なし。U+FFFD・文字化け・不自然な疑問符なし。クリーンな最終ソースでは代表文字列をそれぞれ138箇所・51箇所、報告・入力計画を含む作業ツリーでは140箇所・53箇所検査。34件の変更/追加ソース・テスト・文書・Git属性について[encoding/BOM/改行の比較](../artifacts/item-update-confirmation/encoding-invariants.json)も保存。

証跡フォルダーはGit属性で自動改行変換を無効化し、保存したJSON・ログの元バイト列とSHA256をコミット後も維持する。

## 性能の判定条件と再現コマンド

必須は150/500品目の合計16条件×各6操作。既存の1500品目・追加8条件も削除・緩和しない。
各操作20サンプル以上、中央値55.0ms以下、95%点100ms以下で個別判定する。条件間の平均で代替しない。
保存完了時間は操作反応と別記する。過去の50ms基準の記録・当初の合否は変更せず、今回の基準による判定を区別する。
同じ環境の修正前／修正後で既存の1 worker測定を使い、診断用プロファイルの値を合否に混ぜない。

Node.js 24.19.0、npm 11.19.0を使用し、実装ソースをcheckoutしたクリーンな作業ディレクトリで実行する。
基準checkoutの例は `D:\ciub-1018`（HEADが上記 `f15552d` であることを確認）。
PowerShellはUTF-8ラッパを適用し、結果を保存する場合もencodingを明示する。

```powershell
npm run quality
npm run test:release-a-rollback
node scripts/measure-item-update-performance.mjs --baseline D:\ciub-1018 --samples 100 --warmup 30 | Set-Content -LiteralPath 'update-performance.json' -Encoding utf8
npm run test:shopping-performance
```

ソース計測は同じ入力・同じNode runtimeで、ローカルResponse読出し、CSV解析、URL補完、照合、差分作成、適用を分ける。
この取得計測は通信待ちを含まず、確認の描画・チェック反応・永続化完了はブラウザの証跡で別途判断する。
ブラウザ計測の各条件・各操作のサンプル数・中央値・95%点と保存完了の証跡：[比較JSON](../artifacts/item-update-confirmation/comparison.json)、[全条件表](../artifacts/item-update-confirmation/performance-tables.md)、shopping/およびupdates/配下の固定名raw JSON。更新のJSON reporter原本も[修正前](../artifacts/item-update-confirmation/update-before-report.json)・[修正後](../artifacts/item-update-confirmation/update-after-report.json)として保存。

GitHub Actionsの `foundation-quality`／`release-a-rollback` 自体は起動していない。
ローカルコマンドの結果とワークフロー全体の成功は区別する。Linux専用のdisposable DB検査は今回のWindows環境では未実施。
最終判定：9件の恒久回帰、既存正常系、保存・再読込、必須および追加の買い物性能をローカルで通過した。最終ソース1d840d6のqualityとrelease-a-rollbackは同じクリーンcheckoutで両方成功。GitHub Actions全体の成功およびLinux専用検査の達成は未確認とする。

更新ブラウザ比較では、同じ測定ハーネスを基準checkoutへコピーし、各checkoutで次を実行する。基準側の未追跡ハーネスは測定器であり、アプリの実装変更ではない。修正前の測定成功は測定成立を示し、不具合を正しい仕様として合格させるものではない。最終版では保存結果の期待値も検証する。

```powershell
$env:ITEM_UPDATE_BROWSER_PHASE = 'baseline' # 最終版checkoutでは 'current'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = 'D:/ciur-1018/update-before-report.json' # 最終版は update-after-report.json
node node_modules/@playwright/test/cli.js test tests/browser/item-update-confirmation.performance.spec.ts --grep '@item-update-performance' --workers=1 --reporter=line,json
Remove-Item Env:ITEM_UPDATE_BROWSER_PHASE, Env:PLAYWRIGHT_JSON_OUTPUT_FILE
```

保存ヘッダーと日別の実行列を既存デコーダーで展開し、復元直後・保存後・再読込後に確認する。計測の開始/終了位置は展開処理と分離する。旧プローブや同時検査中の診断結果は正式比較に含めない。集計の再現用[summarize-evidence.ps1](../artifacts/item-update-confirmation/summarize-evidence.ps1)を同梱し、summaryと生サンプルの再計算、条件の一意性、元byteのSHA256を照合する。

通常500品目の保存完了は中央値57.9→60.5ms、95%点60.8→62.3ms。重複500品目は従来1000件へ誤増加していたものを500件に維持するため、保存時間の短縮だけを同じ保存量の高速化とは扱わない。衝突・改題は従来半数のIDが新ID化していたものを、全ID維持へ修正した。

| 買い物の範囲              | 修正前 最大中央値/95%点ms |      修正後 | 各操作の判定         |
| ------------------------- | ------------------------: | ----------: | -------------------- |
| 必須150/500・16条件×6操作 |               43.6 / 49.1 | 32.8 / 37.3 | 前後とも全96操作通過 |
| 追加1500・8条件×6操作     |               51.7 / 63.5 | 45.9 / 50.1 | 前後とも全48操作通過 |

各条件間の最大値を示しており、全条件を混ぜた中央値ではない。測定変動を含むため、買い物操作そのものの高速化を断定しない。保存完了は別集計とし、過去の50ms基準の記録は変更していない。

## 差分作成の修正前後比較

単位ms。中央値／95%点。取得待ち・描画・永続化は含まない。

| 品目数 | 入力            |        修正前 |        修正後 |
| -----: | --------------- | ------------: | ------------: |
|    150 | normal          | 0.329 / 0.484 | 0.430 / 0.646 |
|    150 | collision-title | 0.572 / 0.988 | 0.926 / 1.408 |
|    150 | duplicates      | 0.587 / 0.660 | 0.706 / 0.749 |
|    500 | normal          | 1.124 / 1.704 | 1.382 / 2.291 |
|    500 | collision-title | 1.834 / 5.258 | 3.079 / 6.945 |
|    500 | duplicates      | 2.081 / 5.523 | 2.524 / 3.957 |

正規化衝突・改題のケースは従来の誤った削除・追加をなくすため照合時間が増える。完全重複は追加件数を抑止するため適用する仕事量が異なり、適用時間の短縮だけを同じ仕事量の高速化とは扱わない。

URL入力は操作IDをkeyにして初期化し、同一バッチで別操作へ置換した場合も前のURL・シート名を引き継がない。所有しない取消では一覧へ遷移しない。
