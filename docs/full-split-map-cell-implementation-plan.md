# Full Split Map Cell Implementation Plan

- 文書状態: 2026-08-12レビュー・製品判断反映済み、条件付き承認（FSMC-I0のみ着手可。FSMC-I1以降はFSMC-I0ゲート通過後）
- 対象機能: 地図番号セルのa/b完全分割
- 対象ソース基準: `f8bb6d4`
- 作成日: 2026-08-12
- 想定規模: 中～大規模、11～15個の論理PR

## 1. 目的

地図上の1つの番号セルを、a側とb側の独立した地図領域として扱えるようにする。

例として、Aブロックの26番を「左がa・右がb」に設定した場合、次を実現する。

- 26aと26bを別々に着色する
- 26aと26bへ別々のアイテムを関連付ける
- 片側を選択したとき、その側のアイテムだけを表示する
- 購入・巡回状態の変更を反対側へ波及させない
- 経路と番号マーカーを各側の中央へ接続する
- 通常マップと集中モードの両方で同じ位置解決を使用する
- 地図再取込、完全バックアップ、完全版XLSXでも設定を維持する
- 問題発生時は旧版アプリへ戻し、従来の未分割セルとして開けるようにする

### 1.1 レビュー結論と確定判断

2026-08-12の総合レビューで検出した識別子衝突、保存原子性、旧形式復元、経路表現、緊急停止、試験・release gateの不整合を本版で是正する。製品判断は次のとおり確定し、未回答の製品事項は残さない。FSMC-I0は契約・fixture・証跡を固定するために着手できるが、いずれかのFSMC-I0 Exitが未達の場合はFSMC-I1以降へ進まない。

| 判断ID  | 確定内容                                                                                                                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PD-01` | 分割設定を含まない旧形式の完全復元では、対象範囲の既存分割設定を削除せず`dormant`へ移し、事前previewで件数・理由・復旧方法を表示する                                                                                                          |
| `PD-02` | 分割機能ON時は`01a`、`1a`、`０１ａ`を同じ売場とし、表示用原文だけを維持する。OFF／安全モード時だけは`PD-04`を優先して旧版の識別結果へ戻す                                                                                                     |
| `PD-03` | 検証済みavailability flagのオフライン有効期間は取得成功から最大12時間とし、期限後は自動的に安全モードへ入る                                                                                                                                   |
| `PD-04` | 機能OFF／安全モードでは表示だけでなく、位置解決、保存、経路、操作を従来の未分割セル動作へ完全に戻す。保存済み分割設定は通常操作で変更しない。ただし復旧用backupへのread-only収録と`PD-09`の期限到達cleanupは非表示のsidecar保守として許可する |
| `PD-05` | スマートフォンでは表示サイズにかかわらず必ずa/b pickerを経由し、それ以外の端末だけ直接選択を許可する                                                                                                                                          |
| `PD-06` | ブロックコピーは「分割なし」を含む設定全体の同期とし、コピー先の解除も変更previewへ明示する                                                                                                                                                   |
| `PD-07` | 正式保証PCはサポート中のWindows 11とする。Windows 10 22H2は有効なESU環境を互換検証対象、非ESU環境をbest effortとする                                                                                                                          |
| `PD-08` | XLSX 2.3のセル分割専用sheetは機械管理用とし、保護・警告を付け、人による列追加、並べ替え、数式入力を対応対象にしない                                                                                                                           |
| `PD-09` | イベント削除後の分割設定だけを30日間`dormant`として再関連付け・出力可能にし、期限後に自動削除する。削除済みイベント本体を復元する保証ではない。即時削除も明示選択できる                                                                       |
| `PD-10` | pilotは3実イベントに加え、端末、観測期間、利用者session、操作回数、保存・復元・オフライン復帰の数値条件を満たした場合だけ完了とする                                                                                                           |

FSMC-I0で次を証跡化し、いずれかが未達の場合は該当フェーズへ進まない。

- 実利用profileに存在し得るIndexedDB 5～7のversion・store構成をpayload非収集で棚卸しし、DB6／DB7に新storeがない環境を起動不能にしない
- store別root vector、ローカル発行ID、anchor token、active／dormant／quarantined、30日保持、revision競合の契約をADRとfixtureで固定する
- 15,000セル、15,000分割設定、30,000半領域、400アイテム、400売場、400訪問の最大fixtureと測定方法を固定する
- 旧版A→新版B→旧版A→新版B、旧形式完全復元の休眠化、完全バックアップ、完全版XLSX、通常地図編集、地図再取込、複数タブ競合、flag期限切れの受入手順を自動化可能にする

DB6／DB7に`mapCellSplitSettings`がない、またはschemaが非互換なprofileを1件でも検出した場合、分割機能を利用不可のまま従来機能を継続できる安全モードへ入れる。DB8への更新、新store方式の変更、個別退避・再構築のいずれを採用するかは、その実測証跡を添えて別ADRで決定し、推測でDBを変更しない。

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

| 入力例                | 分割セルでの扱い                            |
| --------------------- | ------------------------------------------- |
| `26a`                 | a側                                         |
| `26a2`                | a側                                         |
| `26b3`                | b側                                         |
| `26A`                 | a側へ正規化                                 |
| `２６ａ`              | a側へ正規化                                 |
| `01a`、`1a`、`０１ａ` | 同じ1a売場。表示用原文は維持                |
| `01b`、`1b`、`０１ｂ` | 同じ1b売場。表示用原文は維持                |
| `26`                  | a/bのどちらにも関連付けない。着色・警告なし |
| `26c`、`26d`、`26ab`  | 初版の半セル対象外。a/bへ誤変換しない       |

番号は表示用原文と識別用正規値を分ける。表示、入力欄、バックアップ上のアイテム番号は可能な限り原文を維持する。地図照合、`SpaceIdentity`、`VisitIdentity`、索引、経路、再取込照合では、NFKC正規化、空白除去、小文字化を行い、数字部分の先頭ゼロを除いた値を使用する。`PD-02`により機能ON時の`01a`と`1a`は同じ識別値へ統合する。一方、a/b以外の非対応番号は、基準番号と正規化済み英字suffixをidentity tokenへ残し、`26c`、`26d`、`26ab`を互いに衝突させない。英字suffix後の商品枝番は既存規則を維持し、`26c2`は`26c`と同じunsupported token、`26d2`は`26d`と同じtokenへまとめる。正規化を理由に保存済みアイテム番号の原文を自動で書き換えない。

`26`単体と`26c`などの非対応番号は、片側のポップアップ、着色、状態へ混入させない。分割有効時に左右どちらを押しても該当アイテムが見つからない状態を正常系として許容し、警告や推測によるa/b割当てを行わない。これらが既存の訪問対象に残る場合、一覧からは失わず、経路は従来のセル中央へ接続する。`26`は`whole`、`26c`等は基準番号と正規化suffixを持つ別々の`unsupported` identityとし、互いのアイテム、訪問状態、順序を統合しない。

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
- 1つの地図内で論理ブロック名は、NFKC、前後空白除去、大小文字を無視した照合キーで一意とする。手動の同名追加は既存ブロックの置換previewを経由する。XLSX上の完全に同じ名前の複数領域は現行仕様どおり1つの論理ブロック・複数`cellGroups`として同じ`blockInstanceId`へまとめるが、原文が異なるのに照合キーだけが衝突するブロックはcore map import結果を変えず、分割機能では影響する番号を対象外または`quarantined`として理由を表示する
- 同じ論理ブロック内に正規化後の同一番号セルが複数ある場合、その重複番号だけを初版対象外とし、同じ地図内の一意な他番号は利用可能とする
- 重複番号を検出した場合はセル選択画面を設けず、保存・コピー・自動継承から除外して理由を表示し、いずれかを推測で選ばない
- 同じ物理番号領域が複数ブロックに属する、番号領域同士が重なる、または結合セルがブロック境界をまたぐ場合も、影響する領域を保存・コピー・自動継承から除外し、既存entryは`quarantined`へ移す。配列順の先頭ブロックを暗黙に選ばない
- ブロック追加、削除、改名、移動、番号セル変更、結合・結合解除を含む通常の地図編集でも、地図再取込と同じ再関連付けplanとpreviewを通し、地図と分割設定を同じ原子的commitで確定する
- 解除しても26a/26bのアイテム番号は変更しない
- 再設定すると、既存番号から元のa/b側へ戻る

既存の`BlockDefinitionPanel`は肥大化しているため、分割設定を直書きせず、新しい小型コンポーネントとして実装する。

### 3.4 同形状ブロックへのコピー

- コピー元とコピー先のブロックを利用者が選択する
- 番号ではなく、ブロック内の相対的な行・列位置で対応させる
- 自動回転、自動左右反転、自動上下反転は行わない
- `PD-06`に従い、コピー元の分割あり／分割なしを含む完全な状態をコピー先へ同期する。対応するコピー元が分割なしなら、コピー先の既存分割を解除対象にする
- コピー元の番号がdormant／quarantined、物理領域競合、または曖昧である場合は「分割なし」と解釈せず除外し、コピー先を変更しない
- 完全状態同期が変更するのは、安全に一意対応できたコピー先の`active`状態だけとする。コピー先の`dormant`／`quarantined`履歴は、別の明示削除操作なしに削除・上書きしない
- 適用前に「追加」「変更」「解除」「変更なし」「除外」と件数・対象・理由を表示する
- 結合範囲や対応セルが一致しない箇所は変更しない
- 一部不一致でも、適合する箇所だけを適用できる
- プレビューを取り消した場合は画面状態・保存状態とも変更しない
- 対応はブロックの正規化済み占有mask、相対行列、番号領域、結合範囲で行う。穴のある形状や非連続形状もmaskを維持し、コピー元に対応領域がないコピー先セルは変更しない
- preview作成時のコピー元・コピー先root vectorを確定時に再検証し、stale、保存失敗、CAS競合では対象全体を変更しない
- 分割設定は1イベント内の1地図インスタンスに属し、同じレイアウトや同じ地図名でも別日程へ自動共有しない
- 別日程・別地図インスタンスへのコピーは、コピー元・コピー先を明示して差分プレビューを確認した場合だけ実行する

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

- `PD-05`に従い、表示用の`layoutMode`と操作用の`isSmartphoneSelectionMode`を分離する。viewport幅だけ、またはUser-Agent文字列だけでスマートフォンと判定しない。正式対応Chromiumのmobile情報、主要pointerの入力能力、利用者overrideから単一の判定関数を構成し、PCは狭幅表示でも非スマートフォン規則を使う。利用者overrideはPCをpickerへ倒す安全側強制または判定不能時の補助に限り、`mobile=true`を非スマートフォンへ上書きできない。スマートフォンでは表示サイズにかかわらず必ずa/b選択画面を開き、半セルを直接確定しない
- `isSmartphoneSelectionMode=false`では、片側の表示上の最短辺が入力種別ごとの閾値以上で、分割線の曖昧帯外にある場合だけ選択した側を直接開く
- スマートフォン以外の初期閾値は、マウスでは片側の最短辺12 CSS px、タッチ・ペンでは44 CSS pxとする
- 閾値と完全一致する場合は直接選択する。スマートフォン以外で閾値未満、分割線の曖昧帯、または候補が複数の場合は選択を変更せず、「拡大してa側またはb側の中央付近を選択してください」と案内する。スマートフォン専用pickerを開かない
- 閾値と曖昧帯の半幅は入力別CSS px定数としてFSMC-I0で固定し、直前・一致・直後を実機試験する
- 正式対応Chromiumでmobile情報が取得不能または入力能力と矛盾し、利用者overrideもない判定不能状態はpickerへ倒して誤選択を防ぎ、診断理由を表示する。mobile情報が`false`の正式PCは、touchscreenや狭いviewportだけを理由にpickerへ切り替えない
- スマートフォンのa/b選択ボタンは最低44×44 CSS pxとする
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
- 「後回し」または「遅参」で追加した商品は現行動作どおり該当日の実行リスト末尾へ追加する。訪問列または経路座標signatureが変化した場合だけ経路を再計算し、同じ`VisitIdentity`の既存訪問へ商品が加わるだけならcacheを維持する
- 「今回の巡回へ追加」専用操作や自動的な現在位置変更は追加しない

### 3.8 売場、訪問、優先度

空間上の同一性と巡回上の同一性を分ける。

- `SpaceIdentity`は、イベント、地図インスタンス、安定ブロックID、先頭ゼロを除いた基準番号、`SpaceSideIdentity`から構成する。`SpaceSideIdentity`は`{ kind: "whole" }`、`{ kind: "split-side", side: "a" | "b" }`、`{ kind: "unsupported", normalizedSuffix: string }`の判別可能unionとし、非対応番号同士を単一の`unsupported`値へ潰さない
- `VisitIdentity`は、`SpaceIdentity`に進行区分と優先度区分を加えて構成する
- 同じ側、同じ進行区分、同じ優先度のアイテムだけを1訪問へまとめる
- 同じ側でも優先度が異なるアイテムは、通常の実行列・候補列と同じ規則で別グループ・別訪問として表示する
- 異なる優先度を最高優先度へ代表集約しない
- 後回し、遅参など進行区分が異なる場合も別訪問として扱う
- 利用者が指定した訪問順を優先する
- 手動順がない場合だけ、同じ優先度・同じ進行区分内でa→bを自然順とする
- `01a`と`1a`の表記差は同じ`SpaceIdentity`へ正規化するが、表示用番号は各アイテムの原文を維持する

既存データで表記差が同一`VisitIdentity`へ衝突する場合、商品IDと既存の実行列順を正とする。

- 実行列の商品ID配列は並べ替えず、最初に現れる商品位置を統合後訪問の位置とし、訪問内の商品順も維持する
- 正式現在位置と各進行区分の保存位置は、旧訪問の先頭にある有効な商品IDをanchorとして新訪問へ再解決する
- anchor商品がない場合は旧位置以降の最初の生存訪問、次に直前の生存訪問、いずれもなければ先頭へ戻す
- 後回し・遅参の商品ID集合は維持して欠損IDだけを除去し、visit-key依存集合は商品ごとに新keyへ再配置して衝突時は和集合にする
- 安全に商品IDへ解決できない購入変更位置は破棄する
- 一時移動、inspect、return history、経路cache、座標signatureはidentity変更時に破棄し、変換済みの正式現在位置へ戻す。実行中なら一時移動を終了した理由を通知する

### 3.9 経路

- 26aと26bの経路終点と番号マーカーを各半領域の中央へ置く
- 同じセル内の26a→26bでも、両中心間の短い線を表示する
- 経路挿入と経路ヒットテストもa/bを区別する
- 同じ側、同じ進行区分、同じ優先度に属する複数アイテムだけを1訪問・1マーカーへまとめる
- 同じ側でも優先度または進行区分が異なる訪問を重複除去しない
- 異なる訪問が同じ半領域anchorを共有しても、訪問順、進行状態、一覧表示は別々に維持する
- 26aと26b、および同一側の異なる`VisitIdentity`を行・列や`locationKey`だけで重複除去しない
- 同じanchorを共有する複数訪問は、Canvas上では件数badge付きの1つの位置markerとして描画し、選択後のDOM一覧で優先度・進行区分ごとの別訪問として表示する。現在訪問だけは最前面の状態ringで示し、後描画で他訪問の存在を隠さない
- 同じanchorを共有する位置marker本体は特定訪問の色で代表させず中立色とし、件数badgeと現在訪問ringを独立layerで描画する
- DOM訪問一覧の各`VisitIdentity`に「この訪問の後へ挿入」を設け、選択中の追加対象をその訪問の直後へ挿入する。成功・取消・競合を通知し、操作元へfocusを戻す

### 3.10 地図再取込と通常編集

- ブロック名と番号が新旧地図で一意に一致する場合は分割設定を継承する
- 行・列が移動しても一意であれば継承する
- 完全一致がない場合、大小文字差を補正した候補が1件だけなら一致候補にする
- 0件または複数候補なら継承しない
- 新旧いずれかの地図で同じ論理ブロック内に同じ正規化番号が複数ある場合は、その番号を自動継承しない
- 確定前に継承件数、除外件数、除外理由をプレビューする
- 地図と分割設定は同じ原子的コミットで確定する
- 一致しない設定は削除せず`dormant`、曖昧・不正な設定は`quarantined`として保持し、誤った地図へ自動接続しない
- `dormant`／`quarantined`は、内容と理由を確認して手動再関連付け、設定だけのJSON出力、削除を選べるようにする
- 通常の地図編集でも変更前後のブロック・番号領域を照合する。同じ`blockInstanceId`と正規化番号が一意でgeometry不変ならactiveを維持し、対象番号の移動・結合変更はpreview付きで再関連付けし、曖昧・重複・境界横断だけを`quarantined`にする
- 無関係な別ブロックの追加・削除だけを理由に、影響を受けないentryを一括して休眠・隔離しない

### 3.11 ファイルへの収録

- アプリ完全バックアップへ収録する
- 完全版XLSXへ収録する
- 簡易XLSXへは収録しない
- CSVへは収録しない
- 簡易XLSXとCSVでも、アイテム番号文字列の26a/26b自体は維持する
- 完全バックアップの全体復元は、事前プレビューで置換範囲、休眠化、除外理由を表示したうえで、復元対象イベントの地図と分割設定をまとめて置換する
- `PD-01`に従い、分割設定を収録しないBackup V1またはXLSX 2.2を完全復元する場合、対象範囲の既存分割設定は削除・active維持せず、`legacy-full-restore-without-split-settings`理由で`dormant`へ移す。取消時は何も変更しない
- アイテムだけのインポートは既存の地図・分割設定を維持し、暗黙に削除・置換しない
- 完全版XLSXからの復元も、地図を含む完全取込時だけ分割設定を適用し、アイテム取込では維持する

### 3.12 対象端末とアクセシビリティ境界

`PD-07`に従い、正式保証する環境:

- サポート中のWindows 11リリースにおける、公開時点の最新安定版Google ChromeおよびMicrosoft Edge
- Galaxy A57上のAndroid版Chromeの公開時点の最新安定版
- 数値によるブラウザ下限は固定せず、各証跡へWindows edition／build、ESU状態、ブラウザ、端末の正確なversionを記録する

必須の互換検証環境。ただしOS自体を正式サポート対象とは表記しない:

- Windows 10 22H2かつ有効なExtended Security Updates（ESU）を適用したPCの、公開時点の最新安定版ChromeおよびEdge

best effortとする環境・入力:

- iPhone SafariおよびiPhone PWA
- ペン入力
- Windows 10 22H2でESUが無効または確認できないPC
- 表示・操作上の端末固有問題だけを理由に正式対応完了を妨げないが、データ消失、a/b混同、誤保存、プライバシー侵害はbest effort環境でも公開停止対象とする

保証対象外:

- macOS、iPadOS、Firefox
- 公開時点の最新安定版より古いブラウザ、およびWindows 10 22H2以外のWindows 10

非スマートフォンではマウスと通常touchによる半セルのCanvas直接選択を正式保証し、スマートフォンtouchではセル選択後に必ずpickerを経由する。ペンはbest effortとする。キーボード・画面読み上げによるCanvas半セルの直接選択だけを初版対象外とし、DOM代替導線は必須とする。

Canvasを操作できない利用者向けに、DOMで構成した次の代替導線を必須とする。

- セル分割設定画面のブロック・番号一覧から26a/26bの設定と詳細を開ける
- 買い物一覧と訪問一覧から該当する26a/26bの詳細を開ける
- 一覧または通常のアイテム追加画面から、Canvasを使わず26a/26bのアイテムを追加・編集できる
- アイテム状態と訪問状態をCanvasの色だけでなく文字でも確認・変更できる
- 訪問一覧の各`VisitIdentity`から「この訪問の後へ挿入」を選び、選択中の追加対象をその訪問の直後へ経路挿入できる

a/b選択画面、番号一覧、設定画面、ポップアップ、新規追加画面には通常のフォーカス管理、読み上げ名、Escape閉鎖を実装する。DOMから開いた場合は呼出ボタンへ、Canvas操作から開いた場合は地図ツールバー内の固定focus対象へ戻し、`body`やfocus不能なCanvasへ戻さない。Canvasへ見せかけの`role="button"`は付けず、本機能を完全なWCAG対応とは表記しない。

### 3.13 保証規模

受入試験では、1イベントの1地図に次の最大条件が同時に存在するfixtureを使用する。

- 地図の論理セル数: 15,000
- 分割設定: 最大15,000件
- 分割後のa/b領域数: 最大30,000
- アイテム数: 400
- 異なる売場を表す`SpaceIdentity`: 400
- 優先度・進行区分による分離後の`VisitIdentity`: 400

「分割数30,000」は15,000セルをすべてa/b分割した結果の領域数を意味し、30,000件の分割設定を意味しない。これらは入力拒否の上限ではなく性能保証範囲であり、超過時はbest effortとする。

## 4. 非対象

初版では次を実装しない。

- c/dを含む3分割以上
- 任意個数の領域分割
- 同形状コピー時の自動回転・自動反転
- 簡易XLSX・CSVによる分割設定の持ち運び
- 旧版アプリからの分割設定編集
- Canvas半セルのキーボード・画面読み上げによる直接選択。ただしDOM一覧による代替操作は必須
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

1. `resolveItemMapLocation(item, context)`: 商品番号から`whole`、a/b、または個別の非対応番号identityを解決する
2. `hitTestMapLocation(mapPoint, context)`: pointer位置から、商品が0件の側を含む`none | single | ambiguous`候補を解決する。スマートフォン／直接選択の可否はgeometryではなくinteraction policyが判断する
3. `listMapCellLocations(blockInstanceId, baseNumber, context)`: 設定画面、picker、DOM代替導線用にCanvasを使わず候補を列挙する

各APIは地図と分割設定から一度構築した`MapLocationIndex`を共有する。描画、pointer move、経路計算ごとに全セル・全商品を総当たりしない。商品一覧の取得は`locationKey`索引へ分離し、位置解決自体へ優先度、進行区分、購入状態を混入させない。

共通の返却値:

```text
lookupCell       番号セルのcanonical parent
baseCell         経路探索へ渡す整数の行・列
baseNumber       先頭ゼロを除いた識別用番号
displayNumber    地図セル由来の標準売場表記
sideIdentity     whole / a / b / unsupported:<正規化済みsuffix>
locationKey      安定したSpaceIdentity
markerStackKey   同じ物理anchorの表示集約キー
bounds           地図grid座標上の半開矩形
anchor           半領域またはwhole領域の中心
```

grid座標は列1左端・行1上端を0とし、`bounds`はleft／topを含みright／bottomを含まない半開矩形とする。結合セルはcanonical parentと結合範囲全体へ正規化する。client座標、アプリ倍率、地図zoom、回転、DPRは通常マップと集中モードで共有するviewport adapterが処理し、`projectedSideMinCssPx`と`projectedDistanceToSplitCssPx`を返す。interaction policyだけが端末判定、入力別閾値、曖昧帯を評価し、CSS px閾値やDPRをdomain geometryへ混入させない。

- `locationKey`は正規化済みの`SpaceIdentity`を表し、機能ON時の`01a`と`1a`で同じ値になる
- `locationKey`は表示文字列の連結ではなく、`["map-location", 1, eventInstanceId, mapInstanceId, blockInstanceId, baseNumber, sideIdentity]`のversion付きtupleをcanonical JSON化して生成する。非対応番号ではtokenを必ずtupleへ含める
- `VisitIdentity`はspace-navigation側で`locationKey + 進行区分 + 優先度区分`から構築する
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

type MapCellSplit =
  | { direction: "left-right"; aSide: "left" | "right" }
  | { direction: "top-bottom"; aSide: "top" | "bottom" };

interface SplitBindingEvidenceV1 {
  algorithmVersion: 1;
  mapStructureFingerprint: string;
  blockFingerprint: string;
  locationFingerprint: string;
}

interface MapCellSplitEntry {
  blockInstanceId: string;
  lastKnownBlockName: string;
  number: number;
  split: MapCellSplit;
  bindingEvidenceAtLastActive: SplitBindingEvidenceV1;
  status: SplitBindingStatus;
  statusReason?: string;
}

type SplitBindingStatus = "active" | "dormant" | "quarantined";

interface MapSplitBinding {
  mapInstanceId: string;
  lastKnownDayKey: string;
  lastKnownMapName?: string;
  mapStructureFingerprint: string;
  entries: MapCellSplitEntry[];
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

interface EventMapCellSplitSettings {
  eventInstanceId: string;
  lastKnownEventName: string;
  enabled: boolean;
  maps: MapSplitBinding[];
  deletionRetention?: {
    reason: "event-deleted";
    dormantSince: string;
    purgeAfter: string;
  };
}

interface MapCellSplitSettingsRoot {
  schemaVersion: 1;
  associations: MapCellSplitAssociationRegistry;
  events: EventMapCellSplitSettings[];
}
```

分割なしはentryを保存しない。非対応番号は分割entryにはならないが、`SpaceSideIdentity`のtokenを含む別の空間・訪問identityとして扱う。イベント、地図、ブロックの各instance IDはローカルで発行し、バックアップやXLSX内の外部IDをそのまま採用しない。表示名は診断と手動再関連付けにだけ使い、所有者判定には使わない。

entryの保存・コピー・再関連付け・再取込時に、対象ブロック内の正規化番号が一意であることを検証する。行・列は地図指紋と再取込照合の証拠には含めるが、利用者が選択して保存する識別子にはしない。同一ブロック内の重複番号へentryを新規保存せず、同じ地図内の一意な他番号は処理を継続する。

`active`は現在の地図と安全に結び付いたentry、`dormant`は地図欠落・旧版操作・旧形式完全復元・一致なし等で未接続のentry、`quarantined`は不正値・曖昧一致・物理領域競合・指紋矛盾等のentryを表す。statusはentry単位で保持し、同じ地図内で安全に一致したentryだけをactiveにできる。`PD-09`のイベント削除retentionを除いて時間経過だけで自動削除しない。

active entryでは`bindingEvidenceAtLastActive`のblock／location evidenceが現在の物理番号領域と一致し、`statusReason`は存在しない。dormant／quarantined entryでは最後にactiveだったevidenceを維持し、FSMC-I0 ADRで固定したallowlistの`statusReason`を必須とする。地図再取込または通常編集で安全に一意継承できたentryだけ、単一commit内でevidenceを更新する。無関係な別ブロックの変更によるmap fingerprint差だけで全entryを非active化しない。

association registryは、現行のイベントkey、日程内のmap slot、map内のblock slotと各opaque instance IDを結び、再読込後の現在データを解決する。current key／slotは既存データを参照するsidecar内部キーであり、表示名を所有者判定へ使用しない。イベント・地図・ブロックの作成、改名、移動、削除、複製、再取込と同じtransactionでregistryを更新し、参照先不在や多重対応は該当entryをdormant／quarantinedにして自動修復しない。

active entryへ至るevent／map／block associationでは`currentEventKey`、`currentDayMapSlotKey`、`currentBlockSlotKey`をすべて非空かつ一意解決可能とする。dormant／quarantinedでは欠落したslotを未設定にできるが、架空slotや表示名で補完しない。

root payload内に独自の数値revisionを持たせない。CAS authorityは現行のstore別metadataが持つopaqueな文字列revision、baseRevision、checkpointとし、複合commandは参加storeすべての期待rootを`ExpectedRootVector`として保持する。分割設定rootもこのvectorへ参加させ、単一の架空rootへ置き換えない。

### 5.3 地図指紋とentry binding evidence

分割設定を誤った地図へ適用しないため、地図全体の`mapStructureFingerprint`と、entryごとの`blockFingerprint`／`locationFingerprint`を分けて保存する。

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

指紋が一致しない場合、イベント名、日付、マップ名、ブロック名だけで自動接続しない。地図再取込と通常編集の継承previewを通して再対応付けし、確定時だけ既存のmap／block instance IDを引き継ぐ。改名・位置移動だけでinstance IDと正規化番号が維持され、一意に再解決できるentryはactiveのまま新しいevidenceへ更新する。番号欠落はdormant、重複・領域競合・結合矛盾はquarantinedとする。色・回転・zoomだけの変更ではstatusを変更しない。bounds／anchorが変化した場合だけ経路cacheを破棄し、正式現在位置はitem ID anchorから同じ`VisitIdentity`へ再解決する。新しいevent／map／block実体を複製作成する場合だけ新しいinstance IDを発行する。既存の別日程・別地図・別ブロックへ設定をコピーする場合はコピー先IDを維持し、生成entryへコピー先のevent／map／block IDと正規化番号を記録して、コピー元ID・番号を複写しない。

### 5.4 経路・訪問ドメイン

経路の論理単位は商品や行・列ではなく`VisitIdentity`とする。

```ts
type VisitIdentityKey = string & { readonly __brand: "VisitIdentityKey" };
type LocationKey = string & { readonly __brand: "LocationKey" };
type MarkerStackKey = string & { readonly __brand: "MarkerStackKey" };
type VisitPhase = string & { readonly __brand: "VisitPhase" };
type VisitPriorityLevel = string & { readonly __brand: "VisitPriorityLevel" };
type GridCell = { row: number; col: number };
type RoutePoint = { row: number; col: number };

interface VisitIdentity {
  locationKey: LocationKey;
  phase: VisitPhase;
  priorityLevel: VisitPriorityLevel;
}

interface ResolvedRouteVisitPoint {
  identity: VisitIdentity;
  visitId: VisitIdentityKey;
  locationKey: LocationKey;
  markerStackKey: MarkerStackKey;
  baseCell: GridCell;
  routingPort: RoutePoint;
  anchor: RoutePoint;
  displayNumber: string;
  order: number;
  itemIds: string[];
}

type SplitRouteConnectorKind = "from-anchor" | "to-anchor" | "same-cell-direct";

interface SplitRouteConnector {
  kind: SplitRouteConnectorKind;
  path: RoutePoint[];
}

interface SplitRouteSegment {
  fromVisitId: VisitIdentityKey;
  toVisitId: VisitIdentityKey;
  insertionAfterVisitId: VisitIdentityKey;
  mainPath: RoutePoint[];
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
      fromVisitId: VisitIdentityKey;
      toVisitId: VisitIdentityKey;
      reason: "no-routing-port" | "path-not-found";
    };
```

`markerStackKey`は浮動小数文字列の丸めではなく、map／block instance ID、基準番号、物理anchor種別を含むversion付きtupleから生成する。描画markerだけを同じ`markerStackKey`でまとめ、`visitId`、経路順、進行状態、hit-test候補を統合しない。route segmentの参照は必ずfrom／toのvisit IDとし、item IDや行・列だけへ戻さない。

## 6. 保存と旧版互換

### 6.1 IndexedDBとDB6／DB7事前判定

初期案は`DB_VERSION`を5から6へ上げ、`mapCellSplitSettings` object storeを追加する。ただし、現行契約はDB5を現行、DB7を前方互換上限としており、DB7の実利用profileが存在しないことは証明されていない。DB7ではversion 6の`onupgradeneeded`が走らないため、新storeを無条件の必須storeにすると起動不能になる。

FSMC-I0で`FSMC-DB-CAPABILITY-INVENTORY-v1`を実施する。

- 配布対象として把握できるorigin／browser profileについて、DB versionとobject store名のfingerprintだけをread-only収集する
- イベント名、商品、地図、設定payloadは収集しない
- 網羅できないprofileは新版の起動preflightで同じcapability判定を行う
- receiptにはorigin区分、profile区分、DB version、store fingerprint、採取時刻、probe versionを記録する
- DB5はDB6へupgradeして新storeを作成する
- DB6またはDB7でschema互換な新storeが存在する場合は、DB versionを変更せず通常経路を使用する
- DB6／DB7で新storeがない、またはstore shape・root schemaが非互換な場合はDBを変更せず、分割機能を利用不可にして従来機能を継続する。アプリ全体を起動不能にしない
- DB8以上は現行前方互換上限外として、データを変更せず既存ポリシーどおり拒否する
- DB6／DB7かつ新storeなしで分割機能を提供する必要が生じた場合だけ、DB8、store方式変更、個別退避・再構築を別ADRで判断する

新storeの初期契約:

- `keyPath`: なし
- `autoIncrement`: false
- 通常レコードキー: `data`
- payload: `MapCellSplitSettingsRoot`
- `mapData`本体へ分割項目を追加しない
- capability判定前に新storeをcoreの無条件必須store一覧へ追加しない
- inventory結果を無視してDB7以上へ飛ばさない
- 旧版へ戻すときもDB版を下げず、storeを削除しない

store集合を次の2層へ分ける。

- core stores: 現行の従来機能が必須とするstore。全profileで従来どおり検証する
- capability store: `mapCellSplitSettings`。preflightが互換と判定した場合だけsnapshot型、load／save、atomic transaction、recovery、checksum対象へ加える

snapshot型も次の判別可能unionへ分け、runtimeの`AppData`へ設定を無条件に追加しない。

```ts
type ExpectedStoreRoot =
  | { state: "uninitialized" }
  | {
      state: "present";
      revision: string;
      baseRevision: string | null;
      checkpoint: string | null;
    };

type ExpectedRootVector = ReadonlyArray<{
  storeName: string;
  root: ExpectedStoreRoot;
}>;

type PersistenceSnapshot =
  | { capability: "core-only"; core: CorePersistenceSnapshot }
  | {
      capability: "map-cell-split-v1";
      core: CorePersistenceSnapshot;
      split: MapCellSplitSettingsRoot;
      expectedRoots: ExpectedRootVector;
    };
```

root vectorはstore名で安定sortし、参加storeの重複・欠落を拒否する。DB5→6で作成直後の空storeは`uninitialized`として表す互換状態とし、最初のsplit commandはtransaction内でpayload、metadata、checkpointがすべて不在であることを再確認してrootを原子的に初期化する。不在状態を空文字revision等へ偽装しない。DB6／DB7でstore、schema、serializerのいずれかが欠ける場合は`core-only`として開き、split rootを暗黙作成しない。split payloadを含む復元を`core-only` profileへ行う場合は、coreを変更する前に全体を拒否する。

capability storeが利用できないprofileでは分割設定を読書きするcommandを登録せず、従来snapshotと現行のcore autosave規則で保存・復元を継続する。利用できるprofileでは、地図・association・split bindingを変更する複合操作に必要なstoreを同一transactionへ必ず参加させ、設定storeだけを後から別保存しない。複合commandはtransaction開始後に参加storeのpayload、metadata、checkpointを再読込し、`ExpectedRootVector`の全要素が一致した場合だけ既存のstore別metadata契約に従って同一transactionで確定する。1要素でも不一致なら全体をabortする。既存metadataへ未知の共通commit fieldを追加する場合は固定旧版Aの読込互換をFSMC-I0で証明し、証明できなければ追加しない。この2経路を型とintegration fixtureで分離し、「必須storeへ入れて起動不能」と「transactionから外れて部分commit」の両方を防ぐ。

`config/db-compatibility-contract.json`、契約検証script、integration fixture、性能証跡schema、復旧runbookを同じPRで更新する。現行旧版がDB6・7を前方互換として開き、未知の追加storeを無視できる性質は、固定した旧版ビルドとの実試験で証明してから採用する。

### 6.2 イベント所有者ID

イベント名だけを所有者にすると、旧版で削除後に同名イベントを作成した場合に古い設定が誤接続される。

各イベントへ`eventInstanceId`を付与し、設定をIDで所有させる。

- 新規作成: 新しいID
- 新版で改名: ID維持
- 新版で複製: 新しいIDを発行し、分割設定を複製
- 新版で削除: 現行データと同じ論理commit内で設定を`dormant`へ移し、成功した削除commitの信頼済みUTC時刻を`dormantSince`、そこから`30 * 24`時間後を`purgeAfter`として記録する。期間内は別の現存イベントへのpreview付き再関連付け・設定出力・即時削除ができるが、削除済みイベント本体を復元する操作とは表記しない。期限後は`event-deleted`理由の設定とassociationだけを自動削除する
- 既存イベントへの復元: 復元先IDを維持し、内容だけ置換
- 新しいイベント名への復元: 新しいID
- 外部バックアップのIDをそのまま採用しない

旧版操作によってIDが失われた場合、設定を名前だけで再接続せず休眠データにする。同じIDまたはanchorが複数イベントへ現れた場合は、`lastKnownEventName`や地図指紋が一致しても自動で一方を所有者に選ばず、関連entryをquarantinedへ移す。

各日程の地図へsidecar上の`mapInstanceId`、各論理ブロックへ`blockInstanceId`を付与する。

- 地図再取込で一意一致し、利用者がプレビューを確定した場合だけmap／block instance IDを維持する
- 地図・イベント・ブロック実体の複製作成では新しいIDを発行し、参照をまとめてremapする。既存の別日程・別地図・別ブロックへの分割設定コピーではコピー先の既存IDを維持し、コピー元IDを採用しない
- 表示名の改名だけではIDを変更しない
- 地図削除や旧版操作で所有先を確認できない設定は`dormant`、ID衝突・曖昧一致・不正値は`quarantined`へ移す
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
- イベント削除retentionのcleanupは保存済み`purgeAfter`と、検証済みavailability receiptまたは専用署名時刻receiptから得た現在UTC時刻をauthorityとする。信頼済み現在時刻がない場合は削除を延期する。D+29では再関連付け・出力可能、D+30到達後は`event-deleted`理由の対象だけを単一commitで削除する。端末時計の進み・巻戻し、不正timestampでは早期削除せずcleanupを停止して診断を表示する

### 6.3 アプリスナップショット

runtime snapshotと外部backup wire typeを分離したうえで、次を同時に対応させる。

- `CorePersistenceSnapshot`／`SplitCapablePersistenceSnapshot`。runtimeの`AppData`へsplit sectionを二重追加しない
- 初期読込
- 通常autosave
- 未保存表示と再試行
- PWA更新ブロッカー
- 原子的復元
- recovery candidateと復旧証跡
- イベント作成、改名、削除、複製
- 地図再取込
- 完全バックアップ
- 完全版XLSX
- イベント単位`enabled`、ローカル安全モード、active／dormant／quarantined

UIやfeatureコードからIndexedDBを直接呼ばず、既存の`PersistenceCommandPort`と単一コミット経路を通す。

`mapCellSplitSettings` rootは、他のアプリpayloadと同じtransaction、metadata、checkpoint、recovery candidateへ参加させる。mapDataと設定を同時に変更する操作は`commitMapAndSplitAtomically(expectedRoots, mutation)`、イベントanchorを含む操作は`commitEventLifecycleAndSplitAtomically(expectedRoots, mutation)`、完全復元は`restoreSplitCapableSnapshotAtomically(expectedRoots, snapshot)`という専用Port commandを通す。参加storeごとのroot vectorをtransaction内で検証し、片方だけを確定するfallbackを設けない。

### 6.4 旧版互換の保証範囲

保証するもの:

- 同じブラウザデータを新版で開いた後、旧版へ戻して起動できる
- 旧版では26a/26bを従来どおり1つの番号セルとして表示する
- 旧版は新しいobject storeを変更しない
- FSMC-I0でanchor保持を確認済みの旧版操作では、`splitIdentityAnchor`、association registry、instance ID、binding evidenceがすべて一致する分割設定が新版で復元される。いずれかが欠ける場合はdormantとし、自動接続しない
- 不一致設定を別イベントへ誤適用しない
- DB6／DB7で新storeなし・非互換のprofileでも従来機能を起動でき、分割機能が利用不可である理由を表示する

保証しないもの:

- 旧版アプリから分割設定を表示・編集すること
- 新形式の完全バックアップを旧版へ直接復元すること
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
- 初版では通常保存へ新しいタブ間Web Lock、BroadcastChannel同期、他タブの強制閲覧専用化を必須としない。正当性の境界は現行CASとする
- 地図再取込、イベント改名・削除、完全復元等の複合操作も同じCASで全体をrollbackし、部分commitを起こさない

### 6.6 安全モードと匿名計測

全体availability flag、イベント単位availability、イベント単位`enabled`、利用者が即時選択できるローカル安全モードを`SplitMapAvailabilityPort`で一元判定する。優先順位はローカル安全モード、全体OFF、イベントavailability OFF、`enabled=false`、ONの順とし、すべてがONの場合だけ分割機能を有効にする。

- availability authorityは同一originから取得する署名付きreceiptとし、schema version、revision、値、対象scope、`issuedAt`、`expiresAt`、署名を検証する。有効期限は`expiresAt`と取得成功時刻＋12時間の早い方とし、古いrevisionのreplay、署名不正、未来時刻、時計巻戻しをfail closedで拒否する
- availability endpointはService Workerのprecache／runtime cache対象外とし、clientは`cache: "no-store"`で取得し、応答も`Cache-Control: no-store`を必須とする。network取得に失敗した場合だけ、最後に検証成功したlocal receiptをその有効期限まで使用する。Service WorkerまたはHTTP cacheから古いONを返すfallbackを設けない
- オンライン時は5分以内に再検証し、OFF receipt受信後は新規split commandを即時抑止する。実行中transactionは開始時とcommit直前にavailabilityを検証し、原子的に完了または全abortして中間状態を残さない
- `PD-03`に従い、オフラインでは最後に検証成功したON receiptを、`expiresAt`が先に到達しない限り取得時点から11時間59分59秒まで利用できる。`expiresAt`または取得成功から12時間の早い方に到達した時点で、設定を保持したまま自動で安全モードへ移る。receipt不在・不正・期限切れ時の既定値はOFFとする
- `PD-04`に従い、OFF／安全モードでは旧版と同じlegacy resolver、geometry、番号identity、訪問集約、経路、UI、core保存commandを使用し、split identity migrationや利用者操作による分割設定書込みを行わない。`PD-02`による先頭ゼロ統合は機能ON時だけ適用し、OFF時は固定した旧版Aの結果へ一致させる。例外は復旧用backupへのread-only収録と、期限到達済み`event-deleted`データだけを削除する`PD-09` cleanupに限る
- OFF／安全モードでもsplit storeとanchorを通常操作からread-onlyで保持し、再度有効なON receiptを取得した場合だけ現在の商品ID・順序からsplit identityを再構築する。期限到達済み`event-deleted` cleanupだけは前項の例外として実行できる。原本の商品番号をON/OFF切替で書き換えない
- receipt取得元、署名鍵管理、rotation、発行・取消権限、監査receipt、応答SLAをFSMC-I0 ADRと停止runbookへ固定し、authority未設定のままFSMC-I0をExitしない

段階公開では、次の匿名・集計可能な情報だけを計測する。

- 機能ON／OFF／安全モードの回数、成功・失敗件数、error code
- 描画、タップ応答、経路再計算、保存、復元の所要時間bucket
- 分割設定数、半領域数、アイテム数、訪問数の粗いbucket
- OS／browser／PWA区分とアプリversion
- availability revision、期限切れ・署名拒否・手動安全モードの粗い件数

イベント名、日付、サークル名、商品名・メモ・URL、地図内容・座標、セル番号、バックアップ内容、ローカルinstance ID、安定した利用者・端末識別子、raw error／stack traceは送信しない。外部collectorを利用できない環境では、同じschemaのローカルreceiptと実イベント記録を使用し、未観測をPASSにしない。

FSMCの外部metricsはversion管理された`config/metrics-retention-policy.json`へ登録し、raw保持を30日以内とする。削除owner、検証workflow、直近成功時刻、backup retention owner、FSMC collectorのactivation statusが検証可能になるまでactivationを進めない。保存済みのsource-bound release／pilot receiptは運用証跡としてmetrics payloadと分離し、FSMC-I0で保持期間、削除owner、backup ownerを非nullにした別の承認済み保持契約を適用する。

## 7. バックアップとXLSX

### 7.1 完全バックアップ

- バックアップ形式をV2へ上げる
- schemaVersion、portable参照、active／dormant／quarantinedを含む`mapCellSplitSettings`セクションを追加する
- V1の`data` wire shapeは現行sectionだけを持つ`AppBackupV1Data`として凍結し、runtimeの`AppData`型を直接参照しない。新アプリはV1を新規exportしない。固定旧版Aが保存した`EventMetadata.splitIdentityAnchor`だけはoptionalな互換fieldとして新版V1 readerが受理し、その他の未知構造fieldは従来どおり拒否する
- V2の`data`もsplit設定を含まない`AppBackupV2CoreData`として固定し、split設定はtop-levelに一度だけ収録する
- V2 wire typeのtop-level必須keyは`kind`、`version: 2`、`exportedAt`、`scope`、`eventSettings`、`data`、`mapCellSplitSettings`、`digest`とし、未知keyを拒否する。`scope`は対象event、map、期待section、mapData／split設定の収録有無を明示し、`mapCellSplitSettings`はportable association manifestとentry配列を持つ
- V1は引き続き読み込む。アイテムimportでは設定を維持し、`PD-01`の完全復元では対象範囲の既存設定をpreview後に`legacy-full-restore-without-split-settings`でdormant化する
- ローカルrevision、checkpoint、`locationKey`、event／map／block instance IDをそのまま出力せず、ファイル内だけで有効なportable参照へ置換する
- `data.eventMetadata`の`splitIdentityAnchor`はV2 export時に除去し、manifestのportable event参照へ置換する。復元preview確定後に新しいローカルanchorを発行し、アイテムimportでは入力側anchorを無視して既存anchorを維持する
- 復元時はportable参照を新しいローカルIDへremapし、外部IDをそのまま採用しない
- 形式、値、portable参照、重複entry、status、schemaVersionが不正なファイルはDB更新前に全体を拒否する。構造的には正しいが復元先と安全に一致しないentryだけをdormant／quarantinedとして保持する
- 完全復元は確定前に置換、維持、休眠化、隔離、除外、ID remapをプレビューする
- プレビュー確定時だけ、地図、アイテム、訪問順、分割設定を同じ原子的操作で置換する。取消、validation error、CAS競合時は全storeを旧状態のまま維持する
- アイテムだけのimportは既存の地図、event／map instance ID、分割設定を維持する
- 一致しない旧version設定は削除せず、読み取れる範囲を`dormant`／`quarantined`として保持する
- 利用者は休眠・隔離設定を手動再関連付け、設定JSONとして出力、削除できる
- JSONのraw byte数、nesting、event／map／entry数、文字列長をparse・commit前に検証する。1地図15,000 entryを保証境界とし、hard limitは最大fixture実測値に安全余裕を加えてFSMC-I0 ADRで固定する
- 上限超過、parse error、digest不一致では既存DBを一切変更せず、理由と退避方法を表示する

V2はtop-levelに`digest`を持ち、`digest`自身を除くV2 objectをキー順序固定の`esp-json-v1` canonical JSONへ変換したUTF-8 bytesに対するSHA-256を保存する。export直後、parse直後、preview確定直前に検証する。これは破損検出であり、発行者の真正性や改ざん耐性を保証する署名ではない。V1にはdigestを追加せず、V1の読込互換を維持する。

V2のportable association manifestを次のexact schemaで固定する。

```ts
interface PortableSplitManifestV1 {
  schemaVersion: 1;
  events: Array<{
    eventRef: string;
    dataEventKey: string;
    enabled: boolean;
  }>;
  maps: Array<{
    mapRef: string;
    eventRef: string;
    dataDayMapSlotKey: string;
  }>;
  blocks: Array<{
    blockRef: string;
    mapRef: string;
    dataBlockSlotKey: string;
  }>;
}
```

`scope`は`scopeKind: "full" | "event" | "multipart"`、対象portable event／map参照、`includesMapData`、`includesSplitSettings`、`expectedSections`、各件数を持つexact schemaとする。宣言されたsectionが欠ける場合は破損として全体拒否し、宣言上含まれないsectionは意図的省略として扱う。top-levelの`mapCellSplitSettings` key自体は常に必須とし、`includesSplitSettings=false`のときだけ値を`null`、`true`のときだけmanifest＋entry objectとする。

- split-capable exporterが地図を含むfull／event scopeを出力する場合は`includesSplitSettings=true`を必須とし、分割設定を黙って省略しない
- core-only source等から`includesMapData=true`かつ`includesSplitSettings=false`のV2を復元する場合は、V1 fullと同じく影響範囲の既存split設定をpreview後に`legacy-full-restore-without-split-settings`でdormant化する
- `includesMapData=false`かつ`includesSplitSettings=false`のitem-only scopeは既存の地図・分割設定を維持する。map置換とitem-onlyを同じ「設定なし」として扱わない

- `dataEventKey`は同じV2のevent-scoped全sectionに存在するevent keyを指す
- `dataDayMapSlotKey`は参照eventの`data.mapData`にある日程・地図slotを指す
- `dataBlockSlotKey`は参照map内の論理block slotを指す
- portable entryのbinding evidenceはruntimeと同じ`algorithmVersion`、`mapStructureFingerprint`、`blockFingerprint`、`locationFingerprint`のexact field名を使う
- active entryはevent／map／block参照がmanifestで一意に解決し、同梱mapDataから再計算したmap／block／location binding evidenceが一致する場合だけ許可する
- dormant／quarantined entryは未解決参照を許すが、last-known表示情報、最後にactiveだったmap／block／location binding evidence、allowlist reasonを必須とする
- `enabled`はpreviewへ表示する。既存イベントへの復元では既存値を既定、新規・全体置換では`false`を既定とし、利用者がpreviewで明示確認した場合だけ入力値を採用する
- 重複ref、存在しないactive参照、同じdata slotへの多重ref、manifest外の未知keyを全体拒否する

### 7.2 完全版XLSX

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
- `PD-08`に従い、専用sheetへ「アプリ管理・直接編集不可」の説明、worksheet protection、必要に応じた非表示設定を付ける。保護はsecurity boundaryとせず、import時の厳格検証を省略しない
- セル分割専用sheetとそのscope metadataはexact headerとscalar cellだけを許可し、formula、error cell、rich text、external linkを拒否する。既存の商品sheetにおけるformula結果の扱いは従来仕様を維持し、本制限を誤って拡大しない
- sheet行数、cell数、shared string、ZIP展開後byte数、entry数、文字列長、Worker時間・memoryを検証し、zip bombや過大workbookをDB更新前に原子的に拒否する

version dispatchは`2.2`以下を分割設定なしのlegacy、`2.3`をこのschemaで厳格読込、`2.3`より大きい未知versionを全体拒否とする。将来versionをlegacy相当として読み、分割設定を黙って落とさない。XLSX 2.3のexport画面、ファイル名、説明へ「旧版アプリでは専用sheetが無視され、分割設定を復元できない」旨を表示する。

「セル分割参照」はportable association manifestを表し、exact headerを次とする。

| 列            | 必須      | 内容                                        |
| ------------- | --------- | ------------------------------------------- |
| `kind`        | 必須      | `event`／`map`／`block`                     |
| `ref`         | 必須      | kind内で一意なportable参照                  |
| `parentRef`   | 状態依存  | mapはeventRef、blockはmapRef、eventは空     |
| `dataSlotKey` | 必須      | event key、day-map slot key、block slot key |
| `enabled`     | eventのみ | `true`／`false`、他kindは空                 |

「セル分割設定」の物理schemaをFSMC-I0 ADRとgolden fixtureへ固定する。初期列は次のexact headerとする。

| 列                        | 必須     | 内容                                 |
| ------------------------- | -------- | ------------------------------------ |
| `eventRef`                | 列必須   | activeは非空。その他は未解決時に空可 |
| `mapRef`                  | 列必須   | activeは非空。その他は未解決時に空可 |
| `blockRef`                | 列必須   | activeは非空。その他は未解決時に空可 |
| `entryRef`                | 必須     | ファイル内で一意なentry参照          |
| `lastKnownEventName`      | 必須     | preview表示用                        |
| `lastKnownDayKey`         | 必須     | preview表示用                        |
| `lastKnownMapName`        | 任意     | preview表示用                        |
| `lastKnownBlockName`      | 必須     | preview表示用                        |
| `number`                  | 必須     | 先頭ゼロ除去済みsafe integer         |
| `direction`               | 必須     | `left-right`／`top-bottom`           |
| `aSide`                   | 必須     | directionと整合する側                |
| `status`                  | 必須     | `active`／`dormant`／`quarantined`   |
| `reason`                  | 状態依存 | activeでは空、その他はallowlist code |
| `mapStructureFingerprint` | 必須     | 地図構造evidence                     |
| `blockFingerprint`        | 必須     | 論理ブロックevidence                 |
| `locationFingerprint`     | 必須     | 物理番号領域evidence                 |

全列headerは必須とする。active行はevent／map／block参照cellがすべて非空で同じworkbook内へ解決することを必須とし、dormant／quarantined行だけ未解決の参照cellを空にできる。その場合もlast-known情報とreasonを必須とする。重複ref、未知列、欠落列、余分な非空cellは拒否する。

「セル分割参照」の`dataSlotKey`は同じworkbookの同梱mapDataへ一意に解決するものだけを許可する。active設定は3段階の参照解決とmap／block／location binding evidence一致を必須とし、dormant／quarantinedだけ未解決参照を許可する。eventの`enabled`はBackup V2と同じpreview既定値・明示確認規則を使用する。

### 7.3 保証規模と入力安全制限

性能保証規模と、攻撃・破損ファイルを拒否するhard resource limitを分ける。hard limitは3.13の保証規模以上とし、FSMC-I0の固定端末・Worker実測後にversion付きconfigへ固定する。実測前に推測値を設定しない。

- 保証規模超過かつhard limit以下は警告付きbest effortとし、自動削除・切捨て・設定解除を行わない
- hard limit超過はWorkerまたはvalidatorで`resource-limit`として拒否する
- backupは`JSON.parse`前のraw byte上限、nesting、総entry、文字列UTF-8 byte、duplicate ref、構造fieldのallowlist、validation error保持数を制限する。利用者入力値であるイベント名・日程名等が`__proto__`、`constructor`、`prototype`であること自体は拒否せず、動的keyは`Map`、null-prototype object、または安全なown-property APIで扱ってprototype chainへ代入しない
- XLSXは既存limitに加えてsheet／row／cell数、設定row数、展開後XML byte、圧縮率、timeout、cancel、heartbeat、peak memoryを制限する
- アプリ自身が出力した保証規模内のV2／2.3を同version importerがresource limitで拒否しないgolden testを固定する

1イベント・1地図の保証規模だけではファイル全体の有限hard limitを保証できないため、export preflightで全イベント数、1イベント内地図数、全entry数、推定byte数を検査する。FSMC-I0実測後に次を同じversion付きconfigへ固定する。

- アプリ完全バックアップ1ファイルの総event／map／entry／raw byte保証上限
- 完全版XLSX 1 workbookの総map／entry／展開後byte保証上限
- 上限内での自己round-trip保証

総保証上限を超える場合、単一ファイルを生成して後で読めなくするのではなく、まずevent境界でmultipartへ分割して出力する。単一eventだけでpart上限を超える場合は、同じmultipart setのmanifestが指定するmapまたはsection境界でだけ分割を許可し、単独復元可能な地図backupとして扱わない。各partは別`kind`と、`setId`、`partIndex`、`partCount`、event／map／section scope、`partDigest`、全partから計算した`setDigest`を持つ。復元時は全partを同時選択し、欠番、重複、別set混入、scopeの欠落・重複、各digestをWorkerで検証して1つのsnapshotへ再構成した後、1回のpreviewと1回の原子的commitで反映する。partを順番に完全復元したり、一部地図だけを独立した完全backupとして復元したりしない。hard limit以下でも保証上限超過ならbest effort警告を出す。具体数値は最大fixtureと現行利用状況の実測なしに推測せず、FSMC-I0 Exitで必ず確定する。

### 7.4 設定単独portable JSON

dormant／quarantined管理画面から出力する設定単独ファイルは、完全バックアップV2と混同しない別形式とする。

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

- 経路探索の基準セルは従来どおり整数の行・列
- 半領域中央を正確なfractional `anchor`として別フィールドに持つ
- 経路本体は既存3×3探索を利用し、結果を`mainPath`として保持する。`routingPort`はbaseCell内の通行可能点、なければ地図範囲内を上・左・右・下の固定順で探索する決定的BFSが見つけた最寄り通行可能点とする。到達不能なら`unroutable`を返し、障害物を無視し得る未検証の直線／L字fallbackで接続しない。`mainPath`の始終点はfrom／toの各`routingPort`と一致させる
- `routingPort`から半領域anchorへの`from-anchor`／`to-anchor` connectorを`mainPath`と別配列で保持し、細い点線で描画する。connectorをpathfindingの通過コスト、重複penalty、sub-cell使用量へ混入させない
- 同一整数セルのa→bは`mainPath=[]`と両anchor間の`same-cell-direct` connectorを正式なvisit間segmentとして保持する
- hit-testの優先順位はmarker、main path、connectorとし、同順位に複数visitがある場合はDOM候補一覧を表示する
- 経路cacheとsignatureには順序付き`visitId`、`locationKey`、baseCell、anchor、split binding evidenceを含める。描画pxやDPR値をsnapshotへ保存しない

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

本章の`FSMC-I0`～`FSMC-I11`はFull Split Map Cell固有の実装checkpointであり、リポジトリの正式release gateである`P0-RELEASE`～`P8-CLEAN`とは別物とする。文書、PR、issue、証跡では`P0`等の省略名を使用しない。FSMC checkpoint自体を既存の`RELEASE_PHASE_GATES`へ追加せず、FSMCを含むartifactの配布またはactivation変更時に、既存release workflowへsource-boundなFSMC exit bundleを追加入力する。

各FSMC PRは、そのフェーズのunit、integration、browser、schema、fixture、CI設定を同じPRに含め、FSMC-I11まで試験を延期しない。各PRはglobal OFFで独立してmainへmerge・配布可能でなければならず、前フェーズExitのreceiptなしに次フェーズを開始しない。

機能公開状態は実装checkpointと分離し、`FSMC-A0-OFF`、`FSMC-A1-TEST`、`FSMC-A2-PILOT`、`FSMC-A3-DEFAULT`を使用する。各activation receiptはsource SHA、artifact SHA-256、flag revision、fixture checksum、必要なFSMC exit bundleと既存release gate run IDを参照する。証跡不足時は既存正式gateが成功済みでもactivationを変更できない。

activationとpilotを循環依存にしないため、必要証跡を次で固定する。

| activation        | 変更前に必要なsource-bound証跡                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FSMC-A0-OFF`     | pilotを除く必須CI、性能、正式実機、PWA、新旧版互換、backup復元と既存release gateを束ねた`FSMC-I11 engineering-ready receipt`                        |
| `FSMC-A1-TEST`    | engineering-ready receiptに加え、A0の24時間legacy parity観測成功receipt                                                                             |
| `FSMC-A2-PILOT`   | A1検証用イベントの数値条件、停止drill、Backup V2のclean profile復元、`expiresAt`先行と12時間capの両expiry試験を束ねた`FSMC-I11 pilot-ready receipt` |
| `FSMC-A3-DEFAULT` | 3実イベント、各終了後24時間観測、停止条件0件を束ねた`FSMC-I11 pilot-complete receipt`                                                               |

### FSMC-I0: 契約・fixture・基準値

実装:

- 仕様ADRを作成する
- `FSMC-DB-CAPABILITY-INVENTORY-v1`用probe、receipt schema、startup capability判定を定義し、既知origin／profileをread-only棚卸しする
- DB5、DB6／DB7（新storeあり／なし／不正）、DB8の期待動作を固定する
- store別`ExpectedRootVector`、Core／Split snapshot、association registryのanchor token、instance ID、entry単位status、metadata revision／CAS、30日retention、手動再関連付けの契約を固定する
- DB5、バックアップV1、完全版XLSX 2.2のgolden fixtureを固定する
- A/B/A試験用の現行旧版ビルドを固定する
- 代表地図、ON／OFF別番号正規化、`26c`／`26d`／`26ab`／`26c2`、同名ブロック、一意番号、重複・領域競合・merge越境のfixtureを作る
- 15,000セル、15,000設定、30,000半領域、400アイテム、400 `SpaceIdentity`、400 `VisitIdentity`の最大fixtureを作る
- 機能OFF時の描画・経路・性能基準を記録する
- 署名付き全体・イベント単位availability receipt、12時間TTL、ローカル安全モード、完全legacy経路、匿名metrics、停止・再開authorityの契約を定義する
- availability endpointのService Worker／HTTP cache除外、`no-store`、network失敗時だけのlocal receipt利用を固定する
- `layoutMode`と`isSmartphoneSelectionMode`を分離し、Chromium mobile情報、入力能力、利用者override、狭幅PC、判定不能時の安全側動作を単一adapter契約へ固定する
- Critical／Highのseverity rubric、triage責任者、issue query、再分類時の技術・製品承認receiptをADRへ固定する
- FSMC metricsのschema、30日以内のraw retention、削除・検証・backup owner、collector activationを`config/metrics-retention-policy.json`へ統合する
- Backup JSONとXLSXのresource limitを最大fixtureの実測値から固定する
- 完全バックアップとworkbookの総event／map／entry保証上限、multipart、自己round-trip条件を固定する
- V1 wire freeze、Backup V2 scope／digest、XLSX 2.3 machine-managed sheet／scope manifest、未知version拒否、prototype-safe dynamic keyを固定する
- Windows 11正式保証、Windows 10 22H2＋ESU互換検証、非ESU best effort、Galaxy A57、iPhone・ペン・対象外境界をADRへ固定する
- 全性能scenarioの絶対上限を`config/performance-budgets.json`へ非null値で固定し、定量pilot receipt schemaを確定する
- dirty worktreeを失敗終了させ、artifactを1回だけbuild・package化・SHA-256検証し、同じpackageをprebuilt試験へ渡すFSMC証跡scriptを定義する

Exit:

- まだDB・UI・本番動作を変更しない
- `26a`、`26a2`、`26b3`、`26A`、`２６ａ`、`01a`、`1a`、`26`、`26c`、`26c2`、`26d`、`26ab`のON／OFF別期待値が固定されている
- 旧版A→新版B→旧版A→新版Bの試験手順を自動化できる
- DB6／DB7で新storeなし・不正でも従来機能が起動し、分割機能だけが利用不可になる試験を自動化できる
- payloadを含まないinventory receiptと、非互換DB6／DB7検出時の安全な分岐条件がレビュー済み
- availabilityの発行元、署名鍵、取消権限、5分更新、12時間TTL、停止SLAと外部実機authorityが設定済みで、未設定値がない
- V1／V2／XLSX／multipart wire type、通常地図編集の状態遷移、2-root以上のCAS擬似コードと障害表がレビュー済み
- FSMCに関係するperformance budget、実機profile、severity authority、metrics retention、pilot最低件数、FSMC証跡と既存release gateの対応表にnull／pending／unconfiguredがない。FSMCと無関係な既存設定を本Exitへ混入させない

### FSMC-I1: 共通ドメイン

実装:

- `spaceNumber.ts`
- `splitGeometry.ts`
- `MapLocationIndex`、item resolver、空側対応hit-test、DOM列挙API
- 通常／集中モード共通viewport adapter
- `layoutMode`から独立した`isSmartphoneSelectionMode`判定と、`none | single | ambiguous`を入力別閾値へ結ぶinteraction policy
- `SpaceIdentity`、`VisitIdentity`、各canonical keyの型・正規化・生成契約
- 結合セルbounds
- map／block／location fingerprintと通常編集planner
- `SpaceSideIdentity`、`ResolvedRouteVisitPoint`、`SplitRouteSegment`、`RouteResolution`
- 分割線境界と低表示サイズ判定
- 表示用原文と識別用番号の分離
- 同一ブロック内の重複番号を対象外にするvalidation
- 重複block ownership、merge越境、重複mergeを対象外にするvalidation

Exit:

- 4方向、分割なし、全番号パターンのunit testが合格
- 描画とhit-testが同じgeometry結果を使用する
- 回転前後で同じ地図領域を示すproperty testが合格
- 機能ONでは`01a`と`1a`が同じlocationへ解決され、`26c`／`26c2`と`26d`／`26ab`は相互に異なるidentityとなる
- 商品なしのa/b側をhit-testとDOM列挙の両方で解決でき、重複番号・領域競合・merge越境を推測処理しない
- 狭幅PCは非スマートフォン規則、Galaxy A57は全倍率pickerとなり、閾値・曖昧帯の直前／一致／直後が固定期待値に一致する

### FSMC-I2: 配布制御、DB capabilityと保存基盤

実装:

- inventory gateを満たす範囲で`DB_VERSION=6`と新object storeを導入
- DB6／DB7新storeなし・非互換のcapability fallback
- `MapCellSplitSettingsRoot`、association registry、entry単位status、schema validation
- Core／Split snapshot union、store別root vector、専用atomic commandを持つrepository、facade、PersistenceCommandPort
- 初期読込、autosave、再試行、更新ブロッカー
- recovery evidence、atomic restore
- 現行CASへの参加と複数タブ競合表示
- `SplitMapAvailabilityPort`、署名付きreceipt検証、5分更新、replay拒否、12時間TTL、手動安全モード
- availability endpointのSW／HTTP cache除外と`no-store`取得、stale cached ON拒否
- OFF／unknown／署名不正／期限切れ時の完全legacy resolver・保存・経路・UI経路
- featureはOFFのまま

Exit:

- DB5→6で既存storeの値とchecksumが不変
- 旧版がDB6を開いて従来データを読み書きできる
- 旧版操作で新storeのchecksumが変わらない
- DB6／DB7新storeなし・非互換でDBを変更せず、従来機能を利用でき、分割機能だけが有効化不能
- DB6／DB7互換storeありとDB8拒否が契約どおり
- core-only profileは現行core autosave契約を維持し、split commandを登録しない。split-capable profileの地図・association・split bindingを変更する複合commandと完全復元だけは必要storeを原子的にcommitし、片方だけのcommitを起こさない
- 新storeの保存失敗が未保存表示とPWA更新抑止へ反映される
- 同時writerのstale保存が`PersistenceConflict`となり、部分commitとlast-write-winsが起きない
- DB契約、検証script、integration fixture、性能証跡schemaが同じversion契約を示す
- `verify:architecture`が合格
- 有効なON receipt、対象event availability、`enabled=true`、手動安全モードOFFをすべて満たす場合だけsplit commandが登録される
- `expiresAt=取得+30分`と`expiresAt=取得+24時間`のfixtureで、それぞれ早い方の直前はON、一致・直後は設定を保持したlegacy安全モードとなる。sleep復帰、未取得、署名不正、replay、時計巻戻しもfail closedする
- flag変更中、QuotaExceeded、各transaction段階のabortで複合commitが全成功または全rollbackとなり、部分commitがない
- OFF時の利用者向け結果とcore store checksumが固定した旧版Aに一致する。DB version、空の新store、read-only split payloadだけを許容差分とする

### FSMC-I3: イベントIDとライフサイクル

実装:

- 既存イベント、地図、ブロックへのローカルinstance ID付与
- 現行event／day-map／block slotとinstance IDを結ぶassociation registry
- URLなしイベントを含むempty-source `EventMetadata`、registry anchor tokenとの一致検証
- 作成、改名、削除、複製、復元
- ID衝突、ID欠落、active／dormant／quarantined処理
- 同名イベント再作成の誤接続防止
- 新しい実体の複製時だけの新ID発行と、既存の別日程・別地図・別ブロックへの設定コピー時のコピー先ID維持
- イベント削除時のD+30 retention、即時削除、期限cleanup

Exit:

- 新版での作成・改名・複製・削除が原子的
- 旧版で改名、削除、同名再作成後に誤接続しない
- 旧版がanchorを保持する操作ではIDを維持し、anchor欠落・重複時は名前や指紋だけで再接続しない
- 安全に識別できない設定は表示せず、既存データを壊さない
- 名前だけで再接続せず、手動再関連付け・出力・削除が可能
- D+29までは削除イベントの設定を別イベントへ再関連付け・出力でき、D+30以降は信頼済みUTC時刻に基づき`event-deleted`理由の対象だけを削除する。削除済みイベント本体の復元とは表示せず、信頼済み時刻不在・時計異常時は早期削除しない

### FSMC-I4: バックアップと完全版XLSX

実装:

- バックアップV2
- V1 wire shapeの凍結と旧形式完全復元のdormant preview
- V2 scope manifestとruntime snapshotから分離したcore wire type
- 完全版XLSX 2.3のscope manifest、保護した機械管理用参照・設定sheet
- Worker protocolと検証
- 壊れた設定の原子的拒否
- 全体復元の置換previewと、アイテムimport時の設定維持
- portable参照のローカルID remap
- resource limitと過大入力の原子的拒否
- file-size preflight、byte decode、Worker内depth scanner、cancel
- Backup V2 digest、設定単独portable JSON、XLSX 2.3 exact schemaと未知version拒否
- 総保証上限超過時にevent境界を優先し、単一event超過時だけmanifest管理下のmap／section境界を使うmultipartと一括assemble
- 単一eventがpart上限を超える場合のmanifest管理下map／section境界multipart
- `__proto__`／`constructor`／`prototype`を利用者名として安全にround-tripするdynamic key処理
- UIで`File.size`を検査してから全体読込を行い、`arrayBuffer`／UTF-8 byte decode後のBackup解析をWorkerへ移す

Exit:

- V1、XLSX 2.2、地図を含むがsplitを含まないV2／XLSX 2.3を読め、map置換では対象の既存split設定をpreview後にdormant化し、item-only importでは維持する
- V2とXLSX 2.3で4方向とactive／dormant／quarantinedを往復できる
- 簡易XLSX・CSVに分割設定が含まれない
- mapDataを置換する復元だけが設定を同時に置換またはdormant化し、item-only importでは設定checksumが不変
- 外部IDをローカルIDとして採用せず、不正参照・split専用sheetのformula・hard limit超過をDB更新前に拒否し、既存商品sheetのlegacy formula規則を維持する
- 形式不正は全体拒否し、復元先不一致だけをdormant／quarantinedとして保持する
- V2 digest不一致、XLSX 2.4以上、設定単独JSONの自動active化を拒否する
- 保証総上限内の自アプリ出力をround-tripでき、超過時は読めない単一ファイルを生成せずmultipartへ案内する。全partが揃わない場合はDBを変更しない

このPRが完了するまで、利用者が分割設定を作成できるUIを公開しない。

### FSMC-I5: 分割設定UIとブロックコピー

実装:

- 独立した`CellSplitDefinitionPanel`
- 単数・複数選択
- 4方向と解除
- ブロック名一意と重複番号対象外のvalidation
- 相対位置コピーのpreview planner
- 分割なしを含む完全状態同期と、追加・変更・解除・変更なし・除外の表示
- 非連続`cellGroups`、相対merge形状、stale previewのvalidation
- 別日程コピーの明示的なコピー元・コピー先とpreview

Exit:

- preview取消で変更なし
- 部分不一致は適合箇所だけ適用
- 保存失敗時に全対象が旧状態へ戻る
- 分割解除でアイテム番号を変更しない
- 重複番号セルへ設定を保存できず、対象外理由を表示する
- コピー元未分割・コピー先分割済みの対応位置が「解除」と表示され、確定時だけ解除される。dormant／quarantined元は解除に変換しない
- global／event OFF、手動安全モード、期限切れ状態で設定UIへ到達できず、UIからavailability gateを迂回して保存commandを呼べない

### FSMC-I6: 地図再取込と通常地図編集

実装:

- 分割継承plan
- 一意一致と除外理由
- 確定前プレビュー
- mapDataと分割設定の単一commit
- ブロック改名・移動・`cellGroups`・番号・merge変更・同名置換のmanual edit plan

Exit:

- セル移動後もブロック名＋番号が一意なら継承
- 重複・欠落・曖昧候補は継承しない
- 取消・例外時は地図と分割設定がともに旧状態
- 除外設定は削除せずdormant／quarantinedに保持し、誤接続しない
- 無関係な地図変更では影響外entryをactiveのまま維持し、一意移動はevidenceとanchorを更新、欠落はdormant、曖昧・領域競合は対象entryだけをquarantinedにする
- 旧版による地図変更を新版起動時に検出した場合は名前だけで自動rebindせずpreviewを要求する

### FSMC-I7: 既存データidentity migrationと利用箇所置換

実装:

- FSMC-I1で固定済みの番号正規化、`SpaceIdentity`、`VisitIdentity`、canonical key APIを既存データと利用箇所へ適用
- 通常の実行列・候補列と同じ優先度別グループ規則への統一
- 既存訪問順、後回し、遅参データの互換変換
- item ID anchorによる現在位置、保存位置、visit-key依存状態の決定的migration
- unsupported番号tokenを含む既存訪問migrationと、item／row-col中心の経路点から`VisitIdentity`中心のroute型への変換

Exit:

- `01a`と`1a`が同じ半領域anchorへ解決される
- 同じ側・同じ進行区分・同じ優先度だけが1訪問になる
- 同じ側でも優先度が異なれば別訪問として維持される
- `01a`と`1a`の既存訪問が衝突しても商品・順序・後回し・遅参を失わず、解決不能な一時状態だけを安全に破棄する
- FSMC-I8以降が確定済みidentity APIだけを利用できる
- OFF切替でsplit identityをlegacy keyへ永続的に破壊変換せず、ON復帰時に商品ID・順序から決定的に再構築できる

### FSMC-I8: 通常マップ

実装:

- locationKey単位の状態索引
- 半領域描画、分割線、正立する条件付きラベル、`LocationPresentationState`
- スマートフォン常時picker、非スマートフォン入力別閾値direct hit、曖昧時no-op案内
- 狭幅PCを含む端末判定adapterと利用者override
- 共通Pointer gesture state machine
- 側別ポップアップと追加処理
- 地図訪問一覧のa/b対応
- 選択、候補、現在位置等の全overlayを共通geometryへ移行

Exit:

- 26a操作で26bを開かない・変更しない
- 通常マップの既存色規則を維持
- 空側で正しい見出しと事前入力値を表示
- `26`／`26c`だけが存在しても左右クリックがアイテムなしになる
- スマートフォンは最大zoomでもpickerを使用し、非スマートフォンは閾値未満・曖昧帯で選択を変えない
- pan、pinch、pointer cancel、capture喪失、layout切替後にpopupを誤表示しない

### FSMC-I9: 集中モード

実装:

- 共有`MapLocationIndex`、位置API、viewport adapterへの置換
- a/b別の購入状態・現在位置・次・前・一時位置
- 選択側へ絞った後、既存の参加日・実行リスト絞込みを行う側別ポップアップ
- 既存のセルポップアップ外枠、追加ダイアログ、`onAddItem`、`computeAddItemFromFocusMode`の流用
- 一時移動targetは既存の`SpaceIdentity`だけの集約を流用せず`VisitIdentity`単位で生成し、同じ側の異なる優先度・進行区分を別ボタン／別訪問として表示
- 現行どおりの「購入済」「後回し」「遅参」追加規則
- 実行リストが変化した場合だけ既存signatureで訪問・経路を再計算
- 通常マップと同じviewport adapter、hit-test、pointer state machine、中立marker・訪問数badge・現在ring

Exit:

- a側の購入更新でb側の色・件数が変わらない
- 実行リスト外の商品だけが存在する側も「今回の巡回対象なし」と表示する
- 追加画面に正しい日付・ブロック・`26a`または`26b`が入る
- 「購入済」の追加では実行リスト・正式現在地・経路が変わらない
- 「後回し」「遅参」の追加では該当日の実行リストへ入り、訪問列または座標signatureが変わった場合だけ経路が再計算される
- 同じ側の異なる優先度・進行区分が一時移動targetでも別訪問になる
- 同じanchorの訪問をDOM一覧から別々に選択し、Canvasなしで一時移動・詳細確認できる

### FSMC-I10: 経路と訪問集約

実装:

- `ResolvedRouteVisitPoint`単位の基準セル、routing port、anchor
- main pathと細い点線connector、同一セルa→b segmentの分離
- 地図範囲内の決定的routing-port BFS、`unroutable`、未検証L字fallback禁止
- routable／unroutableの判別可能`RouteResolution`
- marker／main path／connectorのhit-test優先順位とvisit ID候補
- cache/signature更新
- 同じ側・同じ進行区分・同じ優先度の集約
- 異なる優先度を別訪問として保持
- 手動順と、手動順がない場合だけのa→b自然順
- DOM訪問一覧から「この訪問の後へ挿入」するキーボード操作

Exit:

- a/bが別終点・別マーカーになる
- 同じ側・同じ進行区分・同じ優先度の複数アイテムは1訪問になる
- 同じ側でも優先度または進行区分が異なれば別訪問になる
- 同じanchorの複数訪問は件数badgeとDOM一覧で存在・優先度・進行区分を確認できる
- 手動b→aが維持され、自動時だけa→bになる
- 同一anchorの別訪問が経路順・進行状態・挿入候補として失われず、中立marker・件数badge・現在ringで表示される
- 同一セルa→bがmain pathなしの点線segmentとして表示・hit-testでき、connector追加で3×3 pathfindingのcostや重複penaltyが変化しない

### FSMC-I11: 横断E2E、性能、段階公開証跡

実装:

- Desktop Chromium、Mobile Chromiumの必須projectと、別job／別scriptで実行するWebKit advisory smoke project
- Canvasの論理座標assertionと必須projectの画像基準
- 実機試験runbook
- FSMC-I2で実装済みのavailability、12時間TTL、停止・再開手順、匿名metricsの横断検証
- DOM代替導線と公開上のアクセシビリティ制約
- PWA新旧世代、旧版A／新版B同時tab、failure injection、停止drill、source-bound activation package

Engineering-ready Exit（pilot前）:

- Desktop／Mobile Chromium、Windows 11 Chrome／Edge、Galaxy A57の正式必須ゲートとWindows 10 22H2＋ESUの互換ゲートを通過
- データ消失、a/b混同、誤経路が0件
- 正式保証環境のCritical／High不具合が0件で、engineering-ready試験中に観測した全環境のデータ整合性・プライバシー安全問題が0件
- 完全バックアップと機能OFF／安全モード→ONの復旧を確認
- WebKit／iPhone／ペンの非安全問題は記録するが、best effortとして必須完了判定から除外する
- 必須Chromiumとadvisory WebKitが別job／別scriptで実行され、WebKit browser未導入が必須CIを失敗させない
- 性能、実機、PWA multiclient、backup、旧新版互換のreceiptが同じsource SHA・artifact SHA-256へ結合され、各実行時の承認済みflag revisionを記録して既存正式release gateから参照できる

Pilot-ready receipt（`FSMC-A2-PILOT`前）:

- A1検証用イベントの数値条件、停止drill、clean profile復元、`expiresAt`先行と12時間capの両expiry試験が同じsource SHA・artifact SHA-256で成功し、各実行時のflag revisionが承認済みの単調増加chainを構成する

Pilot-complete Exit（`FSMC-A3-DEFAULT`前）:

- 3実イベントの各最低量と各終了後24時間観測を満たし、正式保証環境のCritical／High不具合と全観測環境のデータ整合性・privacy安全問題が0件である
- pilot-complete receiptは既存正式release gate run IDを一方向参照し、その後のpromotion runが既存gateとpilot-complete receiptの両方を入力として記録する。完了済みrunへ後発receiptの参照を書き戻さない

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

同じ番号セルへ`01a`、`1a`、`０１ａ`と、同優先度の複数商品・異なる優先度の商品を配置する。表記差は同じ売場へ解決し、同じ優先度だけを集約して異なる優先度は別訪問になることを固定する。

別fixtureとして、横長結合セル、縦長結合セル、非連続`cellGroups`、同形状ブロック、不一致ブロック、重複block ownership、merge越境、重複mergeを用意する。重複・競合は対応ケースではなく負例fixtureとし、保存・コピー・自動継承から安全に除外されることを確認する。

永続化・ファイルfixtureには、`EventMetadata`のないイベント、イベント名・日程名が`__proto__`／`constructor`／`prototype`のデータ、V1 full、XLSX 2.2 full、V2／XLSX 2.3の各scope、単一event内分割を含むmultipartの欠番・重複・別set混入、イベント削除D+29／D+30を含める。availability fixtureは未取得、署名不正、replay、`expiresAt=取得+30分`、`expiresAt=取得+24時間`、各有効期限の直前・一致・直後、sleep復帰、時計巻戻し、SW／HTTP cache上のstale ONを含める。さらに3.13の保証規模を同時に満たす最大fixtureを用意する。

### 10.2 必須マトリクス

| 観点              | 必須ケース                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分割              | なし、左a、右a、上a、下a                                                                                                                                      |
| 番号identity      | ONでは`01a`／`1a`／`０１ａ`が同一、OFFではlegacy一致、`26c`／`26c2`は同一、`26d`／`26ab`は別identityで中央anchor、標準表示は`26c`／`26d`／`26ab`              |
| 訪問identity      | 同側同優先度、同側異優先度、異側同優先度、進行区分違い、手動順                                                                                                |
| 形状              | 通常、横長結合、縦長結合、非連続block、番号重複、重複block ownership、merge越境、重複merge                                                                    |
| 回転              | 0°、15°、90°、180°、270°、359°、a/b・badge文字の正立                                                                                                          |
| DPR               | 1、2、3                                                                                                                                                       |
| 拡大・端末判定    | スマートフォンは全倍率picker、狭幅PCは非スマートフォン、入力別閾値・曖昧帯の直前・一致・直後、利用者override、アプリ倍率、ブラウザ200%                        |
| 入力              | mouse、touch、長押し、drag、pinch後の片指継続、Canvas外pointerup、Pointer Cancel、lost capture、画面回転、layout切替                                          |
| 状態              | 空、巡回対象外、未処理、処理済み、後回し、遅参、優先度混在、同側複数件                                                                                        |
| 集中追加          | 購入済、後回し、遅参、実行対象外のみ、空側                                                                                                                    |
| 編集              | 単一、複数、一括解除、完全状態同期copy、コピー先ID維持、履歴保護、解除preview、非連続block、manual改名・移動・同名置換、取消、保存失敗                        |
| 再取込・通常編集  | 無関係変更、一意移動、欠落、重複、結合範囲変更、旧版変更検出、休眠・隔離、取消                                                                                |
| DB互換            | DBなし、DB5、DB6／DB7互換、DB6／DB7 store欠落、DB6／DB7不正store、DB8                                                                                         |
| availability      | valid ON、online OFF、event OFF、未取得、署名不正、replay、30分expiry、24時間expiryの12時間cap、各境界直前・一致・直後、sleep復帰、時計巻戻し、手動安全モード |
| entry binding状態 | active、dormant、quarantined、同一map内の混在、手動再関連付け、出力、即時削除、信頼済み時刻あり／なしのD+29／D+30 cleanup                                     |
| 複数タブ          | 同一root vector同時編集、先行commit、stale拒否、複合操作rollback、再読込後の再編集                                                                            |
| PWA世代混在       | 旧SW＋旧tab、新SW waiting、新旧tab同時、versionchange blocked、update blocker、close／reopen、availability cache除外                                          |
| 障害注入          | QuotaExceeded、各transaction段階abort、browser終了、flag変更、network切断、storage eviction、SW／HTTP stale ON                                                |
| 復元              | V1／2.2 fullとmapあり・splitなしV2／2.3の休眠preview、V2／2.3 full、各scope、単一event内分割multipart、取消、item-only時の設定維持                            |
| 入力安全          | raw byte、深さ、総entry、重複ref、formula、row／cell、圧縮率、timeout、cancel                                                                                 |
| 規模              | 15,000セル、15,000設定、30,000領域、400アイテム、400売場、400訪問、保証境界超過                                                                               |
| ファイル総量      | 総event／map／entry境界、multipart、V2 digest、2.4以上拒否、設定単独JSON                                                                                      |
| 形式              | Backup V1/V2、XLSX 2.2/2.3、簡易XLSX、CSV                                                                                                                     |
| 互換              | 旧版A→新版B→旧版A→新版B                                                                                                                                       |
| 経路              | a/b別anchor、同一セルa→b、main path／種別付きconnector、routing-port BFS、unroutable、同anchor別訪問、marker／line／connector hit-test                        |
| アクセシビリティ  | DOM詳細、空側追加、同anchor候補、一時移動、Canvasなし経路挿入、DOM／Canvas別focus復帰、結果通知                                                               |
| 証跡identity      | source SHA、artifact SHA-256、flag revision、fixture checksum、browser／OS exact version                                                                      |

必須マトリクスは全直積を意味しない。各行についてunit、integration、browser、実機の担当層をtraceability表へ記録する。a/b分離、原子保存、旧新版同居、flag期限切れはrisk-based必須組合せとし、その他はpairwiseを許可する。各ケースはrequirement ID、fixture、期待値、実行command、receipt pathを持つ。データ安全性specはCI retryを0とし、初回失敗後のretry成功を合格扱いにしない。

### 10.3 主要E2E

1. 左右分割で26a/26bを別々に開き、片側だけ状態更新する
2. 上下分割した結合セルを回転し、描画・タップ・経路を一致させる
3. スマートフォンでa/b pickerを開き、集中モードの空側から26bを追加する。「購入済」では巡回・経路が変わらず、「後回し」「遅参」では該当日の実行リストへ入り、signatureが変わった場合だけ経路へ反映されることを確認する
4. 複数セル設定を同形状ブロックと別日程へ完全状態同期し、解除をpreviewし、不一致を除外する
5. 地図再取込後に設定を継承し、Backup V2とXLSX 2.3で往復する
6. 旧版へ戻して従来表示で操作し、新版で分割設定を復元する
7. 機能OFF／オフライン12時間期限切れ→完全legacy動作→ONで設定が戻る
8. `01a`と`1a`が同じ半領域へ表示され、同じ優先度なら集約、異なる優先度なら別訪問になることを確認する
   - 同一訪問へ統合される既存状態では、実行列順と商品IDを基準に現在位置・保存位置・延期状態が移行され、一時移動とcacheだけが安全に破棄されることを確認する
   - 同じanchorの異なる優先度は件数badgeを表示し、DOM一覧・一時移動targetで別訪問として選択できることを確認する
9. 2タブが同じroot vectorを読み、タブA保存後のタブB保存が`PersistenceConflict`となり、Aのpayload・metadata・checkpointが維持されることを確認する。タブBはJSON退避後に最新DBを明示再読込し、新root vectorからの再編集だけを保存できることまで確認する
10. DB6／DB7＋新store欠落・非互換profileを開き、DBを変更せず従来機能と分割機能利用不可理由を表示する
11. dormant／quarantined設定の手動再関連付け、portable出力、削除についてpreview取消と確定を確認する
12. Backup V2／XLSX 2.3の完全復元はpreview後に置換し、同じファイルのアイテム取込では既存設定を維持する
13. `26`または非対応番号だけが登録された分割セルの左右を押し、どちらもアイテムなしとなり誤割当てしないことを確認する
14. スマートフォンでは最大zoomの分割セルでも必ずpickerを開き、狭幅PCを含む非スマートフォンでは閾値以上を直接選択し、閾値未満・曖昧帯ではno-op案内になる。既知スマートフォンを利用者overrideでdirect選択へ変更できない
15. コピー元未分割・コピー先分割済みを同期し、「解除」previewの取消と確定、stale previewの全abortを確認する
16. `26c`／`26c2`は同じ訪問、`26d`／`26ab`は別訪問のまま中央anchorの件数badgeへ表示される
17. 同じ26aの通常・最高優先・遅参を中立markerへ重ね、DOM候補一覧で別訪問として選択できる
18. 横長結合セルのmain pathと半領域anchorを点線connectorで接続し、同一セルa→bも表示・hit-testする
19. キーボードだけで訪問一覧から「この訪問の後へ挿入」を実行し、結果通知とfocus復帰を確認する
20. block改名・移動では設定を維持してevidenceとanchorを原子的に更新し、重複番号・merge越境では対象entryだけをquarantinedにする
21. pinch後の片指離し、Canvas外pointerup、lost capture、画面回転、layout切替後にpopupが誤って開かない
22. V1／XLSX 2.2 fullの休眠previewを取消・確定し、D+29の設定再関連付け・出力、信頼済み時刻によるD+30対象限定cleanup、信頼済み時刻不在時の延期をfake clockで確認する
23. 旧版A tabと新版B、SW waiting、versionchange blocked、QuotaExceeded、transaction各段階abort、browser強制終了で部分commitがない
24. `expiresAt=取得+30分`と`expiresAt=取得+24時間`の両方で、有効期限の直前／一致／直後とsleep復帰を確認し、署名不正、replay、時計巻戻し、flag OFF mid-saveでfail closedする
25. `__proto__`等の利用者名をV2／2.3で往復し、managed sheet欠落・改変、multipart欠番・重複・別set混入をDB更新前に拒否する
26. 既存の別日程・別地図・別ブロックへの設定コピーでコピー先instance IDを維持し、コピー元ID・番号を採用せず、コピー先のdormant／quarantined履歴を変更しない
27. 地図を含むがsplitを含まないV2／2.3では既存splitをpreview後にdormant化し、同じcore dataのitem-only importでは維持する
28. 旧Service WorkerやHTTP cacheにON応答が残っていてもavailability取得がcacheを迂回し、online OFFを15分以内に反映する
29. routing-port BFSが到達不能な地図で`unroutable`を返し、障害物を横断する直線／L字fallbackを描画しない

### 10.4 アクセシビリティ試験

キーボード・画面読み上げによるCanvas半セルの直接選択だけは対象外だが、非スマートフォンのmouse／touch直接選択、スマートフォンpicker、次のDOM代替導線は必須とする。

- pickerとポップアップに適切なdialog名
- 初期フォーカス、focus trap、Escape、DOM起点では呼出ボタン、Canvas起点では地図ツールバー内の固定focus対象への復帰。`body`やfocus不能なCanvasへの復帰は禁止する
- `A-26a`、`A-26b`を読み上げ可能
- 状態をポップアップ内の文字でも確認可能
- キーボードだけで分割設定画面のブロック・番号一覧へ到達できる
- Canvasを使わず26a/26bの詳細表示、アイテム追加・編集、状態確認・変更ができる
- 買い物一覧・訪問一覧から対応する側の詳細へ移動できる
- 空の側も番号一覧から選択してアイテム追加へ進める
- 同じanchorの各`VisitIdentity`を別候補として選び、Canvasを使わず経路挿入・一時移動を完了できる
- 経路挿入、取消、成功、競合を文字または`aria-live`で通知し、DOM起点では呼出ボタン、Canvas起点では地図ツールバー内の固定focus対象へ戻す
- 画面読み上げでブロック、番号、側、状態、操作結果を区別できる
- ライト・ダークのコントラスト
- 200%拡大で欠けない
- axeのmoderate/serious/critical違反0件

axe合格をCanvasのキーボード対応や完全なWCAG適合の根拠にはしない。

### 10.5 性能試験

3.13の最大条件を同時に満たすfixtureを使い、固定環境で1回warm-up後、30サンプルを計測する。外れ値を除外せずnearest-rank p95を使い、raw sample、median、p95、source SHA、artifact SHA-256、flag revision、端末、OS build、browser exact version、fixture checksumを証跡へ保存する。

5秒操作scenarioでは、連続する各pointer／wheel入力の受付から次のpaintまでをsampleとし、入力のないidle frameを成功sampleへ加えない。pan、zoom、rotationを各10回以上含め、下表のinput-to-next-paint p95とmain thread task上限を同時に満たす。

- 初回地図描画
- 5秒間のパン・ズーム・回転
- タップからpickerまたはポップアップ表示
- 経路再計算
- 大量セルの一括設定・コピーpreview
- Backup V2とXLSX 2.3の入出力
- peak memoryと画面終了後の解放
- 初期索引作成と15,000件のschema validation

全scenarioに非nullの絶対上限を設定し、比較可能な既存操作だけは絶対上限に加えて機能OFF比のp95悪化10%以内も満たす。FSMC-I0 Exit時点で`config/performance-budgets.json`とscenario定義へ次の初期上限を登録する。実測により厳格化できるが、緩和には製品責任者の承認receiptを必要とする。

| シナリオ                                        | Windows 11 Chrome／Edge p95 | Galaxy A57 Chrome p95 |
| ----------------------------------------------- | --------------------------: | --------------------: |
| 最大fixture初回地図描画                         |                    1,500 ms |              2,500 ms |
| 5秒間のpan／zoom／rotation中input-to-next-paint |                      100 ms |                150 ms |
| タップからpicker／popup                         |                      150 ms |                200 ms |
| 400訪問の経路再計算                             |                      750 ms |              1,500 ms |
| 15,000件の一括設定・copy preview                |                    1,500 ms |              3,000 ms |
| Backup V2 import／export                        |                    5,000 ms |             10,000 ms |
| XLSX 2.3 import／export                         |                   10,000 ms |             20,000 ms |
| 初期索引＋15,000件validation                    |                    1,500 ms |              3,000 ms |

- main thread taskは全sampleで200ms以下とし、1秒を超える処理は進捗表示と取消を提供する
- peak memory deltaはWindows 11で256 MiB、Galaxy A57で192 MiB以下、画面終了30秒後の残留deltaは64 MiB以下とする
- timeout／cancel後にWorker、timer、Blob URL、transactionを残さない
- 描画ごとに全商品と全セルを総当たりせず、`MapLocationIndex`を再利用する
- Windows 10 22H2＋ESUでは同scenarioを互換測定して記録し、データ安全性または操作不能を検出した場合は公開を停止する
- 最大条件を超えるデータは参考値として記録し、保証値には含めない

## 11. CIと実機ゲート

### 必須CI

- `desktop-chromium-required`: Desktop Chromiumの全E2E
- `mobile-chromium-required`: Android相当Mobile Chromiumのスマートフォン常時picker、縦横画面、空側追加、gesture
- `a11y-chromium-required`: DOM代替導線、経路挿入、focus、axe
- unit、integration、persistence、worker、encoding、architecture、coverage、FSMC compatibility、failure injection、legacy parity
- 必須projectのCanvas画像基準と論理座標assertion
- データ安全性specはretry 0または`failOnFlakyTests`を有効にし、flaky successを合格扱いにしない

必須jobはChromiumだけを明示installしてbranch protectionのrequired checkとする。テストごとに再buildせず、clean commitから作成した同一immutable artifactをbrowser／a11y試験で再利用する。

### advisory CI

- `webkit-advisory-smoke`
- `webkit-advisory-a11y`

WebKitは必須jobと別のscript／jobで明示installし、通常の表示・操作差はnonblockingとする。ただしtrace、screenshot、論理座標、結果artifactを常に保存する。失敗がある場合、FSMC activationには「データ整合性・privacyへの影響なし」のreview receiptまたは修正版の成功receiptを必須とする。WebKit未installを理由に必須Chromium jobを失敗させない。

### 実機

| 区分           | 対象                                             | 確認内容                                                    |
| -------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| 正式保証・必須 | サポート中のWindows 11、最新安定Chrome／Edge     | マウス、DOM代替導線、100%・200%、回転、PWA、backup、性能    |
| 正式保証・必須 | Galaxy A57、最新安定Android Chrome               | 常時picker、縦横、sleep復帰、PWA、offline TTL、backup、性能 |
| 必須互換検証   | Windows 10 22H2＋有効なESU、最新安定Chrome／Edge | 主要機能、保存、backup、PWA、legacy fallback                |
| best effort    | Windows 10 22H2非ESU                             | 回帰を記録し、安全事故だけを停止条件とする                  |
| best effort    | iPhone Safari／PWA                               | タッチ、縦横、再起動、ファイル入出力                        |
| best effort    | ペン対応端末                                     | 直接選択、drag誤認防止                                      |

Mac、iPad、Firefoxは試験・保証対象外とする。Playwright WebKitだけでiPhone対応を保証しない。任意試験でもデータ消失、a/b混同、誤保存、プライバシー侵害を検出した場合は公開停止条件を適用する。

実機receiptはOS family／release／build、ESU状態、browser family／channel／exact version、device model、Android security patch、source SHA、artifact SHA-256、install mode、flag revision、fixture checksum、scenario結果、実行時刻、runner authority、review署名を必須とする。現行の単一Windows 11／Chromium authorityを上表の必須profileへ拡張し、未設定のままFSMC-I0をExitしない。

## 12. 段階公開

1. `FSMC-I11 engineering-ready receipt`と既存release gateの成功後、`FSMC-A0-OFF`としてglobal OFFで基盤だけを配布し、24時間のlegacy parity・通常機能回帰を観測する
2. A0観測成功receipt後、`FSMC-A1-TEST`として検証用イベントだけでWindows 11 Chrome／EdgeとGalaxy A57を有効化する
3. 検証用イベントの数値条件、停止drill、Backup V2のclean profile復元、30分`expiresAt`先行と12時間capの両expiryに成功し、`FSMC-I11 pilot-ready receipt`を発行してから`FSMC-A2-PILOT`へ進む
4. 3つの実イベントを1件ずつ順次有効化し、各イベント終了後24時間の観測と証跡承認まで次を有効化しない
5. 3件完了後に`FSMC-I11 pilot-complete receipt`を発行し、`FSMC-A3-DEFAULT`として新規イベントの標準機能へ変更する
6. 既存イベントは引き続き利用者が明示的にopt-inする

iPhoneとペンの確認は段階公開の必須ゲートにせず、可能な範囲で並行実施する。

`PD-10`に従い、検証用イベントでは、半領域open 100回（a/b各40回以上）、状態変更60回（a/b各20回以上）、保存・再読込20回、offline／onlineまたはsleep復帰5回、完全backupとclean profile復元を各2回、global OFF、event OFF、手動安全モード、30分`expiresAt`先行、12時間capを各1回実施する。kill switch発行からonline端末のlegacy復帰確認までは15分以内とする。

3実イベントpilotでは各イベントについて、準備、イベント当日、終了後24時間まで観測し、次の最低量を満たす。

- Windows 11 PCとGalaxy A57を各1 session以上、合計2 operator session以上
- 半領域open 50回以上、a/b各20回以上
- 状態変更30回以上、a/b各10回以上
- 保存・再読込10回以上
- offline／onlineまたはsleep復帰3回以上
- 開始前完全backup 1回、開催中または終了後完全backup 1回、clean検証profileへの復元1回

pilot回数と完了判定は利用者payloadを含まないoperator署名receiptで記録する。上記の各実イベント最低量は検証用イベントで補完できず、pilot集計へ算入しない。障害注入や停止drill等、実イベントで安全上実施できない追加試験だけを同じsource・artifact・地図の検証用イベントで別証跡として補完し、未実施を成功扱いにしない。

pilot完了条件:

- 3イベントすべてで公開停止条件の発生0件
- 正式保証環境のCritical／High不具合0件
- iPhone等のbest effort環境を含め、試験・観測した環境およびpilot中に報告された環境で、データ消失、a/b混同、誤保存・誤復元、プライバシー侵害0件
- 3イベント合計で半領域open 150回以上、状態変更90回以上、各イベントの保存・再読込10回以上
- Windows 11 ChromeとEdgeをそれぞれ1イベント以上で使用し、Galaxy A57を3イベントすべてで使用
- safety-critical flaky test 0件で、全receiptが同じ承認済みsource SHAとartifact SHA-256へ結合されている。flagは逐次event有効化に伴う承認済みの単調増加revision chainとし、各receiptは実行時のrevisionを参照し、欠番・巻戻し・未承認revisionを許可しない

iPhone利用は機能pilot固有の必須完了条件に加えない。リポジトリ全体のproduction acceptance gateが別途適用される配布では、その既存条件も独立して満たす。

activation変更は全体availability、イベントavailability、イベント単位`enabled`の順に狭める方向だけを許可し、手動安全モードを最優先する。OFF／安全モードは`PD-04`の完全legacy動作とし、通常操作では保存済み分割設定を削除しない。期限到達済み`event-deleted`設定だけは`PD-09`のsidecar cleanup対象とする。

## 13. 公開停止条件

severityはFSMC-I0 ADRの固定rubricで判定する。Criticalはデータ消失、a/b間またはイベント間の交差更新、誤復元、privacy侵害、許可外activation等の安全事故またはその再現可能な危険、Highは正式保証環境で主要flowが完了不能、再現可能なfreeze／crash、絶対性能上限超過等の重大な利用不能とする。技術責任者が固定issue queryに基づきtriageし、Critical／Highからの引下げには技術責任者と製品責任者の署名receiptを必要とする。

次のいずれかが1件でも発生した場合は公開を停止する。

- 26aの操作で26bのアイテムまたは状態が変更される
- 分割設定、アイテム、訪問順のいずれかが失われる
- 回転後に描画・タップ・経路位置が一致しない
- Backup V2またはXLSX 2.3から復元できない
- 地図再取込で誤った番号セルへ設定が継承される
- 同名の別イベントへ休眠設定が誤接続される
- 優先度が異なる訪問が黙って1訪問へ統合される
- 複数タブ競合が通知されず、後から保存した内容で既存設定が上書きされる
- DB6／DB7新storeなし・非互換のprofileを変更する、または従来機能まで起動不能にする
- 正式保証環境で性能基準を再現可能に超過する
- オフライン時にローカル安全モードで従来表示へ戻せない
- 匿名計測へイベント名、商品内容、地図内容、ローカルID等の禁止payloadが含まれる
- iPhone等のbest effort環境を含め、再起動後に設定が消える
- 正式保証環境で再現可能なフリーズまたはクラッシュが発生する
- best effort環境でデータ整合性またはプライバシー安全事故を伴うフリーズ・クラッシュが発生する
- global OFFがonline端末へ15分以内に反映されない
- 非pilotイベントが誤ってenabledになる
- receipt期限後もoffline端末でsplit commandを実行できる
- feature OFFでlegacyの表示、訪問、経路、core store checksumが許容差分以外に変化する
- safety-critical testが初回失敗しretryだけで成功する

表示崩れ、ペン固有操作、iPhone固有操作などbest effort環境だけの非安全問題は、自動的な全体公開停止条件にはしない。ただし、データ消失、a/b混同、誤保存、誤復元、プライバシー侵害は発生環境を問わず停止対象とする。

### 13.1 停止手順

- data integrity、誤保存、誤復元、privacy事故は確認から15分以内にglobal OFFを発行する。単一イベントだけに限定できる非横断障害は5分以内にevent OFFとし、promotionと次pilotを凍結する
- online端末2台以上でflag revisionと完全legacy復帰を確認する。オフライン端末には手動安全モードを案内し、未操作でも最後の有効receipt取得から12時間以内に自動安全モードへ移る
- pilot開始前backup、事故時点のbackup、DB evidence、source／artifact identity、flag receipt、禁止payloadを含まない診断ログを保全する
- 技術責任者、製品責任者、flag操作責任者、利用者連絡責任者と連絡SLAをpilot前runbookへ実名またはauthority IDで登録する
- 影響、回避策、設定が削除されていないこと、復旧見込みを対象利用者へ通知する
- DB versionを下げたり、新storeや保存済み分割設定を削除したり、自動修復を実行したりしない

### 13.2 再開条件

- incident記録とroot cause reviewを完了し、事故を再現するfixtureとretryなしの自動回帰testを追加する
- 修正sourceで必須CI、旧新版同居、failure injection、実機、性能、backup復元が再成功する
- 影響データの復旧または利用者向け処置を完了する
- 検証用イベントで24時間の再soakと停止drillを完了する
- 技術責任者と製品責任者がsource-bound再開receiptを承認する
- 最後に成功したactivation stageから明示的に再開し、停止前stageを自動復元しない

## 14. Definition of Done

次をすべて満たした時点で完全分割版を完了とする。

- `PD-01`～`PD-10`が要件ID、実装、試験、利用者向け文書へ追跡可能で、確定仕様の4方向、解除、コピー、再取込・通常編集が実装済み
- 機能ON時の`01a`／`1a`／`０１ａ`が同じ売場へ解決され、表示原文を失わない。`26c`／`26c2`、`26d`、`26ab`は非対応番号同士で誤衝突せず、DOMとmarkerで`26c`／`26d`／`26ab`と識別表示される
- 機能OFF時は固定した旧版Aと同じ番号identity、表示、訪問、経路、core保存結果になり、ON/OFFで商品番号原文やsplit設定を破壊変更しない
- item resolver、空側hit-test、DOM列挙が同じ`MapLocationIndex`、viewport adapter、geometryを使用する
- 重複block ownership、番号重複、merge越境、重複mergeを配列順で推測せず、影響する領域だけを安全に除外・隔離する
- manual map／block editでmapData、association、binding evidence、entry status、route cacheが同じ原子的commitで更新され、無関係なentryを失効させない
- コピーが「分割なし」を含む完全状態同期となり、追加・変更・解除・変更なし・除外のpreview、取消、stale時全abortが機能する。既存コピー先のinstance IDとdormant／quarantined履歴を維持し、コピー元ID・番号を採用しない
- `layoutMode`とスマートフォン操作判定が分離され、Galaxy A57では全分割セルが常時picker、狭幅PCを含む非スマートフォンでは入力別閾値に従い、閾値未満・曖昧時はno-op案内となる
- 通常マップと集中モードが同じPointer gesture state machineを使用し、pan、pinch、cancel、capture喪失、layout切替後の誤tapがない
- a/bの着色、ポップアップ、状態変更が独立し、集中モードの「購入済」と「後回し／遅参」の既存反映規則を維持する
- 経路が`VisitIdentity`単位で生成され、marker集約によって訪問順、状態、挿入候補を失わない。main pathと種別付きconnectorが分離され、同一セルa→bも表示・hit-testできる。routing-port BFSが到達不能時に`unroutable`を返し、障害物を横断するfallbackを使わない
- 同位置複数訪問が中立marker、訪問数badge、現在ringで表示され、番号・a/b・badge文字が全回転角で正立する
- Canvasを使わずDOM訪問一覧から詳細、追加、状態変更、一時移動、経路挿入を完了でき、a11y試験が成功する
- `FSMC-DB-CAPABILITY-INVENTORY-v1`、起動preflight、DB5→6、DB6／DB7安全分岐、DB8拒否、旧版A→新版B→旧版A→新版B互換試験が成功する
- Core／Split snapshotを区別し、empty-source metadataのanchor、registry token、event／map／block instance ID、entry status、binding evidenceを保持する
- store別`ExpectedRootVector`のCASによりlast-write-wins、部分commit、黙示mergeがなく、quota・abort・crash・flag変更時も全成功または全rollbackとなる
- イベント削除後D+29までは設定を別の現存イベントへ再関連付け・出力でき、D+30以降は信頼済みUTC時刻に基づき`event-deleted`理由の対象だけを削除する。削除済みイベント本体の復元とは表示せず、即時削除と信頼済み時刻不在・時計異常時の安全側延期も機能する
- dormant／quarantinedのpreview付き再関連付け、portable出力、明示削除が可能で、名前だけで別イベントへ再接続しない
- V1 wire shape、V2 core／split分離とscope、XLSX 2.3 machine-managed sheet／scope manifest、設定単独JSON、multipartが固定される
- Backup V1／XLSX 2.2 fullと、地図を含むがsplitを含まないV2／2.3では既存split設定をpreview後にdormant化し、item-only importでは維持する。単一event内分割を含むV2／2.3／multipartは全part一括で原子的にround-tripする
- hard limit、digest、未知version、managed sheet欠落・改変、不正ref、multipart欠番をDB更新前に拒否し、`__proto__`等の利用者名を安全に自己round-tripする
- global／event OFF、manual safe mode、unknown、invalid、expired receiptで完全legacy動作となり、offline receiptは`expiresAt`と取得＋12時間の早い方で自動安全モードへ移る
- availabilityがSW／HTTP cacheを迂回し、flag service停止、stale cached ON、30分`expiresAt`先行、12時間cap、署名不正、replay、時計巻戻し、OFF mid-saveの試験と、online端末15分以内・offline端末期限内の停止drillが成功する
- 必須Desktop／Mobile Chromium CIが成功し、safety flakyが0件で、WebKit advisoryの未review failureが0件である
- Windows 11 Chrome／EdgeとGalaxy A57の正式実機・PWA・性能ゲート、Windows 10 22H2＋ESUの必須互換ゲートが成功する
- 非ESU Windows 10、iPhone、ペンがbest effort、Mac、iPad、Firefox、旧browserが対象外であることを利用者向け文書へ明記する
- 15,000セル、15,000設定、30,000半領域、400商品、400売場、400訪問の全performance scenarioで非nullの絶対上限を満たし、5秒操作中のinput-to-next-paintとmemory解放条件も満たす
- PWA新旧世代、旧版／新版同時tab、versionchange blocked、QuotaExceeded、storage eviction、強制終了の試験が成功する
- 匿名metricsへ利用者payload、ローカルID、raw errorを送らず、30日以内のraw retentionと削除・検証・backup ownerが設定済みで、定量pilotはpayloadを含まない署名receiptで証明する
- engineering-ready、pilot-ready、pilot-completeの各receiptが循環なく発行され、3実イベントの各最低量と24時間後観測、停止・再開runbook、既存release gateへのsource-bound証跡連携が成功する
- 固定severity rubricと承認authorityにより正式保証環境のCritical／High不具合が0件で、試験・観測した環境およびpilot中に報告された全環境のデータ整合性・privacy安全問題が0件である

## 15. 標準検証コマンド

リポジトリ指定のNode 24.19.0／npm 11.19.0を使用する。次の新scriptと証跡builderはFSMC-I0で`package.json`とCIへ追加し、存在しない間はFSMC-I0をExitできない。

初回またはlockfile更新後:

```powershell
npm ci
npm run verify:toolchain
npm exec -- playwright install chromium
```

未commitの作業中にも実行できるローカル検証:

```powershell
npm run test:encoding
npm run format:check
npm run typecheck
npm run lint
npm run verify:test-project-membership
npm run verify:architecture
npm run test:unit
npm run test:integration
npm run test:worker
npm run test:fsmc:compat
npm run test:fsmc:failure-injection
npm run test:browser:required:qa
npm run test:a11y:required:qa
```

clean commitと同一immutable artifactに対する権威検証。`build:fsmc:immutable-artifact`はrelease buildを1回だけ作成して配布packageとmanifestへ封入し、`verify:fsmc:immutable-artifact`はpackage SHA-256とsource SHAを検証する。以後のprebuilt試験はmanifestが指す同じpackageだけを使用し、再buildを禁止する。

```powershell
$dirty = @(git status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw "production evidence requires a clean worktree" }
npm ci
npm run quality
npm run test:qa-builds
npm run verify:fsmc:clean-worktree
npm run build:fsmc:immutable-artifact
npm run verify:fsmc:immutable-artifact
npm run test:browser:required:prebuilt
npm run test:a11y:required:prebuilt
npm run test:fsmc:old-new
npm run test:fsmc:pwa-multiclient
npm run test:release-a-rollback
```

advisory WebKitは必須jobと分離する。

```powershell
npm exec -- playwright install webkit
npm run test:browser:webkit-advisory
npm run test:a11y:webkit-advisory
```

外部性能・実機・activation証跡:

```powershell
npm run performance:fsmc:samples:collect -- --profile windows11-chrome
npm run performance:fsmc:samples:collect -- --profile windows11-edge
npm run performance:fsmc:samples:collect -- --profile win10-22h2-esu-chrome
npm run performance:fsmc:samples:collect -- --profile win10-22h2-esu-edge
npm run performance:fsmc:samples:collect -- --profile galaxy-a57-chrome
npm run performance:fsmc:evidence:build
npm run verify:fsmc:performance
npm run browser:fsmc:managed-device:collect -- --profile windows11-chrome
npm run browser:fsmc:managed-device:collect -- --profile windows11-edge
npm run browser:fsmc:managed-device:collect -- --profile win10-22h2-esu-chrome
npm run browser:fsmc:managed-device:collect -- --profile win10-22h2-esu-edge
npm run browser:fsmc:managed-device:collect -- --profile galaxy-a57-chrome
npm run verify:metrics-retention
npm run fsmc:stop-drill:collect
npm run verify:fsmc:stop-drill
npm run verify:fsmc:restart-readiness
npm run fsmc:exit-bundle:build -- --stage engineering-ready
npm run verify:fsmc:exit-bundle -- --stage engineering-ready
npm run verify:fsmc:activation-readiness -- --stage FSMC-A0-OFF
npm run verify:fsmc:activation-readiness -- --stage FSMC-A1-TEST
npm run fsmc:exit-bundle:build -- --stage pilot-ready
npm run verify:fsmc:exit-bundle -- --stage pilot-ready
npm run verify:fsmc:activation-readiness -- --stage FSMC-A2-PILOT
npm run verify:fsmc:pilot-evidence
npm run fsmc:exit-bundle:build -- --stage pilot-complete
npm run verify:fsmc:exit-bundle -- --stage pilot-complete
npm run verify:fsmc:activation-readiness -- --stage FSMC-A3-DEFAULT
```

旧版互換、実機、性能、pilot、停止drillは通常CIと別のsource-bound証跡として保存し、実測前に完了扱いにしない。`test:browser:required:prebuilt`と`test:a11y:required:prebuilt`は同一artifactを再利用し、試験ごとの再buildを禁止する。
