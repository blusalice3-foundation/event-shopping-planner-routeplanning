# xlsx / JSON 入出力修正の全体整合性レビュー（2026-11-09）

確認した範囲で、今回の修正による機能・データ整合性の回帰は見つからなかった。Windows / Android の既存解凍経路への影響を減らす追加調整と、復元・連続保存の回帰テストを加えた。

製品コードは元のソース `3209a80` と比べて 5 ファイルが対象であり、本レビューでの追加の製品修正は `zipPreflight.ts` に限る。実装・テストを固定した検証用スナップショットは `7fcc595167cf4d2a8acc7b8b12408d262045c1d6`。初回修正と実機確認の対象は `3ef64fbc3e771c6fbeb387a5bf8524d65e597a4b` と区別する。

## 適用範囲と処理負荷

| 経路                       | 確認と調整                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| xlsx の ZIP 事前検証       | Windows / Android は native inflater を優先し、API が使えないときは同じライブラリの JavaScript fallback を使う。iPhone / iPad の Apple WebKit は JavaScript を使用する。判定は Worker 内でファイルごとに 1 回。                      |
| iPad のデスクトップ形式 UA | Worker の UA / platform で判定する。Mac 形式 UA の iPad を取りこぼさない保守的な扱いのため、AppleWebKit を名乗る macOS の Safari / Chromium も JavaScript 経路となる。macOS の速度不変を証明したものではない。                       |
| xlsx 復元                  | `File.arrayBuffer()` の前の 32 MiB 確認と、生成済みバックアップの再利用を維持。全データの余分な JSON 複製を 1 回削減しつつ、構造・参照検証、旧形式移行、設定、任意項目、移行通知を保持する。                                         |
| xlsx / JSON 保存           | 同じ Blob 保存処理を使用する。通常の ArrayBuffer の余分なコピーを減らし、部分範囲だけを保存する。SharedArrayBuffer の経路は必要なコピーで安全に扱う。                                                                                |
| URL の解放                 | 保存開始後に 60 秒の解放タイマーを 1 件だけ設定する。開始例外時は即時解放する。連続保存と途中失敗でも URL が独立して解放される。背景でタイマーが停止すると解放も遅れるため、直近の保存データを一時保持するというトレードオフはある。 |

通常画面に常時動く処理・定期走査・新しい React state/effect は追加していない。xlsx の変換は操作単位の Worker にあり、容量・ZIP ヘッダー・CRC・危険 XML・展開率・時間上限と中断処理を引き続き通す。`config/xlsx-limits.json` は元ソースと同じ blob `27da62804648058b5c4033f434c8de51cb0fb8b3` である。

保存形式、Worker protocol、DB schema、通常の数量編集・選択・D&D の実装を変更する修正ではない。既存の読み取り所有権・古い結果の無視・保存整合性は、関連単体テストと通常ブラウザ回帰でも確認した。

## 自動検証

| 実行                                                       | 結果                                                                                                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest 全プロジェクト                                      | 296 ファイル成功、計測用 1 ファイルを既定条件でスキップ。4,109 テスト成功・88 スキップ・失敗 0。                                                                            |
| 通常ブラウザ機能 selection                                 | 585 件の選択に対し 531 成功・54 既定スキップ・失敗 0・flaky 0。retries 0。通常 runner と同じ `@shopping-performance` / `@shopping-large-list-diagnostic` の除外条件を使用。 |
| Windows Chromium / Android 相当 Chromium / iOS 相当 WebKit | 各 14 件、計 42 件すべて成功。retries 0。実機 Android の確認ではない。                                                                                                      |
| TypeScript / 全体 Lint                                     | 成功。                                                                                                                                                                      |
| architecture / test-project-membership / dependency-usage  | 成功。追加の architecture 例外なし。                                                                                                                                        |
| CSP policy / 本番ビルド / PWA 成果物                       | 成功。クリーンな検証用作業ツリーで release-a を検証。                                                                                                                       |
| 文字コード / 差分                                          | UTF-8 BOM なし・既存 LF を維持。U+FFFD、文字化け、不自然な `?` 増加、改行だけの大量差分なし。「ユーザー登録」「エラーが発生しました」を再読込で確認。                       |

各実行には重複する確認があるため、テスト数を合算した総合件数は作らない。Vitest の 88 スキップは `sheetImportOptionalUrl.measurement.integration.test.tsx` の明示測定条件がないため。ブラウザの 54 スキップも既存の item update / sheet optional URL 計測の環境条件によるもので、未実行を成功へ読み替えない。

通常ブラウザ確認には、保存失敗・再試行、IndexedDB 障害時の JSON 退避、xlsx 復元、設定・数量・配置の保持、Undo / Redo、地図同期、範囲選択、PC / touch の D&D、オフライン、PWA、CSP、アクセシビリティを含む。通常 runner に元から含まれる応答・DOM 診断も通過したが、下記の性能受入とは区別する。テスト全体の所要時間を、単一操作の応答時間としては扱わない。

大きい xlsx fixture は 500 品目・50,000 マップセル、圧縮 807,454〜807,455 bytes、展開 11,521,487 bytes。通常の platform codec を使う取込みと、native API の失敗を注入した出力・再取込み・JSON 内容照合を別に確認した。Worker テストは Windows / Android で native が実際に呼ばれること、iPhone / iPad（Mac 形式 UA を含む）では呼ばれないこと、fallback と破損拒否を確認する。

復元の追加テストは、legacy / v2 の旧経路と新経路の値・通知・設定の同値性を照合し、候補内の品目・地図・設定を変更しても元データと別候補が変わらないことを確認する。保存の追加テストは、連続する 2 件の成功と後続 1 件の失敗で URL の解放時刻が互いに干渉しないこと、および SharedArrayBuffer の部分範囲を確認する。

## 実機の結果と性能確認の限界

2026-11-09、ユーザーから iOS 27.2 での 482KB xlsx 取込・xlsx 出力・JSON バックアップ保存の 3 操作すべてが正常だったと回答を得た。これは初回修正 `3ef64fb` を通常の Safari タブで確認した結果として記録する。本レビューの追加調整でも、その iPhone の JavaScript 解凍経路を維持している。

Safari の自動操作タブでは OS のファイル選択画面が抑止されるため、ブラウザ自動テストの `setInputFiles()` だけで実機のファイル選択 UI を証明しない。実機 Android、iOS ホーム画面 PWA の OS 保存画面、および全入力サイズの端末メモリ上限は、この確認で網羅したものではない。

`shopping` / `range` / `drag` / `transfer` の全 144 ケース・completion 各 10 回の canonical 性能測定は未実行。65/100ms・160/160ms の性能合格や、Foundation の物理性能 30 サンプル契約の受理に、この機能テスト結果を流用しない。基準値・profile・fixture・retry 条件や過去 artifact を変更していない。

Node 上の補助的な codec 比較はウォームアップ中に既存の時間上限で中断し、比較統計が得られなかった。`diagnosticOnly: true` / `acceptanceMeasurement: false` として別保存し、速度改善・速度不変・製品性能合格の根拠には使用していない。保存先は `D:/esp-ios-device-tools-20261108/results/xlsx-codec-diagnostic-failed-20261109/`。診断用ファイルが最初の Lint 対象に入ったため、その資料をソース作業ツリー外へ保全した後、全体 Lint を再実行して成功している。

## 記録

[検証成果物](../artifacts/ios-compatibility/cross-platform-review-20261109/) に `vitest-result.json`、`functional-result.json`、`ios-result.json`、`completed-checks.json` とビルドの capabilities を保存した。元ディレクトリへはファイル単位の SHA-256 を照合して差分を反映し、既存の未追跡資料を保持する。
