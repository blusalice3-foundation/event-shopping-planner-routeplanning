# Full Split Map Cell Implementation Plan

- 文書状態: 2026-08-22レビュー・Q1～Q15製品判断反映済み、条件付き承認（FSMC-I0のみ着手可。FSMC-I1以降はFSMC-I0ゲート通過後）
- 対象機能: 地図番号セルのa/b完全分割
- 対象ソース基準: `3db4be0`
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

2026-08-12の総合レビューと2026-08-22までのQ1～Q15回答で検出・確定した、識別子衝突、保存原子性、旧形式復元、経路表現、ローカル停止、試験範囲の不整合を本版で是正する。製品判断は次のとおり確定し、未回答の製品事項は残さない。FSMC-I0は契約とfixtureを固定するために着手できるが、いずれかのFSMC-I0 Exitが未達の場合はFSMC-I1以降へ進まない。

| 判断ID  | 確定内容                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PD-01` | 分割設定を含まない旧形式の完全復元では、対象範囲の既存分割設定を削除せず`dormant`へ移し、事前previewで件数・理由・復旧方法を表示する                                                                                                                                                                                                                                          |
| `PD-02` | `01a`、`1a`、`０１ａ`は端末内preflightで統合衝突が0件の場合だけ同じ売場へ正規化する。衝突があるイベントは分割機能をONにせずlegacy identityを維持し、利用者へ対象と解決方法を表示する。表示用原文は常に維持する                                                                                                                                                                |
| `PD-03` | 配布制御は外部serviceを使わず、端末全体のローカルOFF、イベント別のローカルON／OFF、DB・schema異常時の自動安全モードだけで構成する。既存イベントは初期OFFとする                                                                                                                                                                                                                |
| `PD-04` | 機能OFF／安全モードではsplit固有の表示、位置解決、保存、経路、操作を従来の未分割セル動作へ戻し、保存済み分割設定を通常操作で変更しない。ただし`PD-14`の共有訪問projectionと挿入規則は現行基盤の既知不整合修正としてON／OFFを問わず常時適用し、固定旧版Aとの明示的な許容差分とする。復旧用backupへのread-only収録と`PD-09`の期限到達cleanupは非表示のsidecar保守として許可する |
| `PD-05` | スマートフォンでは表示サイズにかかわらず必ずpickerを経由する。pickerはa/b順ではなく画面上の空間順に並べ、「左側 b」「右側 a」等、位置と文字を併記する                                                                                                                                                                                                                         |
| `PD-06` | ブロックコピーは解除しない「追加・変更のみ」を既定とし、「完全同期（解除を含む）」を別の明示操作として提供する。どちらも変更previewを必須とする                                                                                                                                                                                                                               |
| `PD-07` | 完了判定はunit、integration、browser、a11y、性能の自動テストで行い、外部証跡、実イベントpilot、managed device receiptは作らない。特定機種の正式保証は表記せず、自動テスト対象と対象外を明記する                                                                                                                                                                               |
| `PD-08` | 初版は原子的保存、通常・集中表示、経路、イベント単位Backup V2、V1互換core同時出力、旧版fallbackへ限定し、完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図コピーを後続版へ送る                                                                                                                                                                                 |
| `PD-09` | イベント削除時は「30日保持」を既定、「今すぐ完全削除」を明示選択とする。保持中は端末内で再関連付けでき、30日後に端末時計が正常な場合だけ対象設定を自動削除する。設定単独ファイル出力は後続版とする                                                                                                                                                                            |
| `PD-10` | 実機receiptや3実イベントpilotを完了条件にせず、fixtureを使うretryなしの自動テストをrelease gateとする                                                                                                                                                                                                                                                                         |
| `PD-11` | 分割セルに`whole`または非対応番号がある場合はa/bへ推測割当てせず、「側未設定」badge、一覧、分割有効化前previewで存在を知らせる                                                                                                                                                                                                                                                |
| `PD-12` | Backup V2の出力時は、分割設定を含まない旧版用V1互換core backupも同時に出力し、用途と失われる情報を表示する                                                                                                                                                                                                                                                                    |
| `PD-13` | 経路connectorは自セルまたは結合セル領域内で安全に接続できる場合だけ描画し、領域外や障害物横断が必要なら`unroutable`とする                                                                                                                                                                                                                                                     |
| `PD-14` | 同じ`ExecutionVisitIdentity`の商品追加は既存訪問へglobal統合し、raw訪問位置を動かさず、必要な`PhaseVisitIdentity`投影だけを追加して全画面へ同じ結果を反映・通知する。利用者が同じ売場を意図的に複数回訪れる機能は初版対象外とする                                                                                                                                             |
| `PD-15` | 1イベントにつき主に編集する端末は1台とし、端末間自動同期・自動mergeを行わない。Backupはpreview後の原子的置換であり、端末全体OFF・イベント別ON／OFFを収録せず、新規復元はOFF、既存イベントへの復元は復元先のローカル状態を維持する                                                                                                                                             |

FSMC-I0で次を契約・fixture・自動テストとして固定し、いずれかが未達の場合は該当フェーズへ進まない。

- DB5～DB8のfixtureと起動preflightを用意し、DB6／DB7に新storeがない環境を起動不能にしない
- store別root vector、ローカル発行ID、anchor token、active／dormant／quarantined、30日保持、revision競合の契約をADRとfixtureで固定する
- 15,000セル、15,000分割設定、30,000半領域、400アイテム、400売場、400訪問の最大fixtureと測定方法を固定する
- 旧版A→新版B→旧版A→新版B、旧形式完全復元の休眠化、Backup V2＋V1互換core、通常地図編集、地図再取込、複数タブ競合、ローカルOFF切替の受入手順を自動化する

DB6／DB7に`mapCellSplitSettings`がない、またはschemaが非互換なprofileでは、分割機能を利用不可のまま従来機能を継続できる安全モードへ入れる。DB8への更新、新store方式の変更、個別退避・再構築のいずれを採用するかは、fixtureと自動互換テストを添えて別ADRで決定し、推測でDBを変更しない。

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

番号は表示用原文と識別用正規値を分ける。表示、入力欄、バックアップ上のアイテム番号は可能な限り原文を維持する。地図照合、`SpaceIdentity`、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、索引、経路、再取込照合では、NFKC正規化、空白除去、小文字化を行う。数字部分の先頭ゼロ除去は、イベント内の地図、アイテム、保存済み訪問・順序・進行状態を端末内preflightで検査し、統合前後の異なるidentityが同時に存在しない場合だけ有効にする。`01a`と`1a`等が別identityとして共存する衝突を検出したイベントでは`localEnabled=true`への変更を拒否し、完全legacy identityを維持して対象件数、影響、解決方法を表示する。検査対象payloadや結果を外部送信しない。一方、a/b以外の非対応番号は、基準番号と正規化済み英字suffixをidentity tokenへ残し、`26c`、`26d`、`26ab`を互いに衝突させない。英字suffix後の商品枝番は既存規則を維持し、`26c2`は`26c`と同じunsupported token、`26d2`は`26d`と同じtokenへまとめる。正規化を理由に保存済みアイテム番号の原文を自動で書き換えない。

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
- 既定の「追加・変更のみ」はコピー元の分割ありだけをコピーし、コピー元が分割なしでもコピー先の既存分割を解除しない
- 別操作の「完全同期（解除を含む）」だけが、対応するコピー元が分割なしの場合にコピー先の既存分割を解除対象にする。選択時は解除を含むことを確認してからpreviewへ進む
- コピー元の番号がdormant／quarantined、物理領域競合、または曖昧である場合は「分割なし」と解釈せず除外し、コピー先を変更しない
- 両モードが変更するのは、安全に一意対応できたコピー先の`active`状態だけとする。コピー先の`dormant`／`quarantined`履歴は、別の明示削除操作なしに削除・上書きしない
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
- pickerの候補は地図上の左→右または上→下の空間順に並べ、`左側 b`／`右側 a`、`上側 a`／`下側 b`のように位置名とsideを併記する。地図回転後も画面上の見た目の空間順と読み上げ順を一致させ、単なるa→b順へ並べない
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

- `SpaceIdentity`は、イベント、地図インスタンス、安定ブロックID、先頭ゼロを除いた基準番号、`SpaceSideIdentity`から構成する。`SpaceSideIdentity`は`{ kind: "whole" }`、`{ kind: "split-side", side: "a" | "b" }`、`{ kind: "unsupported", normalizedSuffix: string }`の判別可能unionとし、非対応番号同士を単一の`unsupported`値へ潰さない
- `ExecutionVisitIdentity`は`SpaceIdentity`に優先度区分を加えて構成し、raw実行商品ID配列とbase訪問順を所有する唯一の位置単位とする
- `PhaseVisitIdentity`は進行区分と`ExecutionVisitIdentity`から構成し、通常マップ、集中モード、訪問一覧、経路の投影単位とする。進行状態・表示・経路上は別訪問だが、独立した手動順や挿入位置を所有しない
- raw実行商品ID配列では、同じ`ExecutionVisitIdentity`のアイテムが非連続でも配列全体で1訪問へ統合する。legacy dataからの初回投影では最初に現れる商品位置を訪問位置とし、以後はidentity単位の訪問位置を保持する。raw商品ID配列自体をglobal sortしない
- normal投影は全実行商品から作り、後回し・遅参はnormalとは別の追加投影として作る。同じ商品がnormalと後回し、またはnormalと遅参の複数`PhaseVisitIdentity`へ属し得る
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

- Desktop Chromium profileのGoogle Chrome相当とMicrosoft Edge相当
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
- 分割設定: 最大15,000件
- 分割後のa/b領域数: 最大30,000
- アイテム数: 400
- 異なる売場を表す`SpaceIdentity`: 400
- `ExecutionVisitIdentity`: 400、`PhaseVisitIdentity`: 400

「分割数30,000」は15,000セルをすべてa/b分割した結果の領域数を意味し、30,000件の分割設定を意味しない。これらは入力拒否の上限ではなく性能保証範囲であり、超過時はbest effortとする。

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

- `locationKey`は正規化済みの`SpaceIdentity`を表し、preflight通過後の機能ON時だけ`01a`と`1a`で同じ値になる
- `locationKey`は表示文字列の連結ではなく、`["map-location", 1, eventInstanceId, mapInstanceId, blockInstanceId, baseNumber, sideIdentity]`のversion付きtupleをcanonical JSON化して生成する。非対応番号ではtokenを必ずtupleへ含める
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
  localEnabled: boolean;
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

分割なしはentryを保存しない。非対応番号は分割entryにはならないが、`SpaceSideIdentity`のtokenを含む別の空間・訪問identityとして扱う。イベント、地図、ブロックの各instance IDはローカルで発行し、バックアップ内の外部IDをそのまま採用しない。表示名は診断と手動再関連付けにだけ使い、所有者判定には使わない。`localEnabled`は端末内だけの操作設定であり、Backup V2／V1のwire typeへ含めない。

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

指紋が一致しない場合、イベント名、日付、マップ名、ブロック名だけで自動接続しない。地図再取込と通常編集の継承previewを通して再対応付けし、確定時だけ既存のmap／block instance IDを引き継ぐ。改名・位置移動だけでinstance IDと正規化番号が維持され、一意に再解決できるentryはactiveのまま新しいevidenceへ更新する。番号欠落はdormant、重複・領域競合・結合矛盾はquarantinedとする。色・回転・zoomだけの変更ではstatusを変更しない。bounds／anchorまたは通行可否へ影響する地図内容が変化した場合は経路cacheを破棄し、正式現在位置はitem ID anchorから同じ`PhaseVisitIdentity`へ再解決する。新しいevent／map／block実体を複製作成する場合だけ新しいinstance IDを発行する。初版では既存の別日程・別地図・別ブロックへ設定をコピーしない。

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
type VisitPhase = string & { readonly __brand: "VisitPhase" };
type VisitPriorityLevel = string & { readonly __brand: "VisitPriorityLevel" };
type GridCell = { row: number; col: number };
type RoutePoint = { row: number; col: number };

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
  baseCell: GridCell;
  routingPort: RoutePoint;
  anchor: RoutePoint;
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
  path: RoutePoint[];
}

interface SplitRouteSegment {
  fromVisitId: PhaseVisitIdentityKey;
  toVisitId: PhaseVisitIdentityKey;
  insertionAfterVisitId: PhaseVisitIdentityKey;
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
      fromVisitId: PhaseVisitIdentityKey;
      toVisitId: PhaseVisitIdentityKey;
      reason: "no-routing-port" | "path-not-found" | "unsafe-connector";
    };
```

`markerStackKey`は浮動小数文字列の丸めではなく、map／block instance ID、基準番号、物理anchor種別を含むversion付きtupleから生成する。描画markerだけを同じ`markerStackKey`でまとめ、`PhaseVisitIdentity`、経路順、進行状態、hit-test候補を統合しない。route segment、hit-test、挿入anchorの参照は必ずphase visit IDとし、代表item IDや行・列だけへ戻さない。`memberItemIds`は表示・状態変更用payloadであってidentityではないため、先頭memberの削除後もmemberが残る限り同じvisit ID、座標、順序へ再解決する。

## 6. 保存と旧版互換

### 6.1 IndexedDBとDB6／DB7事前判定

初期案は`DB_VERSION`を5から6へ上げ、`mapCellSplitSettings` object storeを追加する。ただし、現行契約はDB5を現行、DB7を前方互換上限としており、DB7の実利用profileが存在しないことは証明されていない。DB7ではversion 6の`onupgradeneeded`が走らないため、新storeを無条件の必須storeにすると起動不能になる。

FSMC-I0でローカル起動preflightとDB capability fixtureを実装する。

- DBなし、DB5、DB6／DB7の互換storeあり・欠落・非互換、DB8のfixtureを自動テストする
- 新版の起動preflightは現在の端末内でDB versionとstore capabilityだけを判定し、結果やpayloadを外部収集しない
- capability判定結果は現在sessionの診断表示に使用できるが、外部送信、運用receipt、利用者追跡へ使用しない
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
- capability判定を無視してDB7以上へ飛ばさない
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

旧版操作によってIDが失われた場合、設定を名前だけで再接続せず休眠データにする。同じIDまたはanchorが複数イベントへ現れた場合は、`lastKnownEventName`や地図指紋が一致しても自動で一方を所有者に選ばず、関連entryをquarantinedへ移す。

各日程の地図へsidecar上の`mapInstanceId`、各論理ブロックへ`blockInstanceId`を付与する。

- 地図再取込で一意一致し、利用者がプレビューを確定した場合だけmap／block instance IDを維持する
- イベント全体の複製に伴う地図・ブロック実体の複製では新しいIDを発行し、参照をまとめてremapする。既存の別日程・別地図・別ブロックへの分割設定だけのコピーは後続版とする
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
- イベント削除retentionのcleanupは保存済み`purgeAfter`と端末時計を使用し、30日経過後の次回起動または保守処理で`event-deleted`理由の対象だけを単一commitで削除する。最後に観測した端末時刻より前へ戻る、保持開始直後に`purgeAfter`を越える等の不自然な変化を検出した場合は早期削除せずcleanupを延期して診断を表示する。D+29までは端末内再関連付け可能で、設定単独ファイル出力は後続版とする

### 6.3 アプリスナップショット

runtime snapshotと外部backup wire typeを分離したうえで、次を同時に対応させる。

- `CorePersistenceSnapshot`／`SplitCapablePersistenceSnapshot`。runtimeの`AppData`へsplit sectionを二重追加しない
- 初期読込
- 通常autosave
- 未保存表示と再試行
- PWA更新ブロッカー
- 原子的復元
- recovery candidateと復旧状態
- イベント作成、改名、削除、複製
- 地図再取込
- イベント単位Backup V2とV1互換core同時出力
- イベント単位`localEnabled`、端末全体のローカル安全モード、active／dormant／quarantined

UIやfeatureコードからIndexedDBを直接呼ばず、既存の`PersistenceCommandPort`と単一コミット経路を通す。

`mapCellSplitSettings` rootは、他のアプリpayloadと同じtransaction、metadata、checkpoint、recovery candidateへ参加させる。mapDataと設定を同時に変更する操作は`commitMapAndSplitAtomically(expectedRoots, mutation)`、イベントanchorを含む操作は`commitEventLifecycleAndSplitAtomically(expectedRoots, mutation)`、イベント単位復元は`restoreSplitCapableEventSnapshotAtomically(expectedRoots, snapshot)`という専用Port commandを通す。参加storeごとのroot vectorをtransaction内で検証し、片方だけを確定するfallbackを設けない。

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
- 初版では通常保存へ新しいタブ間Web Lock、BroadcastChannel同期、他タブの強制閲覧専用化を必須としない。正当性の境界は現行CASとする
- 地図再取込、イベント改名・削除、イベント単位復元等の複合操作も同じCASで全体をrollbackし、部分commitを起こさない

このCASは同じbrowser profile内の複数タブだけを保護する。PCとスマートフォン等の別端末間には共有revisionがないため、自動同期、自動merge、端末間競合解決を保証しない。初版は1イベントにつき主に編集する端末を1台とし、別端末へ移す場合は移動元でBackup V2を作成し、移動先の既存イベントをpreview後に原子的置換する。両端末で編集した差分を合成せず、復元前に復元先の退避backupを案内する。

### 6.6 ローカル制御と安全モード

端末全体のローカルOFF、イベント単位`localEnabled`、DB・schema・binding検証失敗時の自動安全モードを`SplitMapLocalControlPort`で一元判定する。優先順位は自動安全モード、端末全体OFF、`localEnabled=false`、ONの順とし、すべてのローカル条件を満たす場合だけ分割機能を有効にする。外部availability service、署名receipt、TTL、remote kill switch、外部metricsを導入しない。

- 既存イベントとBackupから新規復元したイベントの`localEnabled`は`false`を既定とし、利用者が当該端末でイベントごとに明示ONにする
- 端末全体OFFとイベント単位`localEnabled`はローカル設定storeで管理し、同じprofile内の複数タブではstore別revisionとCASを使う。別端末へ同期しない
- split commandは開始時とcommit直前にローカル制御revisionとDB capabilityを再検証し、途中でOFF、安全モード、staleへ変化した場合は全体をabortして中間状態を残さない
- `PD-04`に従い、OFF／安全モードではsplit固有部分に旧版と同じlegacy resolver、whole-cell geometry、番号identity、UI、core保存commandを使用し、split identity migrationや利用者操作による分割設定書込みを行わない。一方、`PD-14`の共有訪問projection、既存訪問へのglobal統合、位置指定挿入規則は機能状態に依存しない基盤修正として常時適用する。先頭ゼロ除去は機能ONかつ`PD-02` preflight通過時だけ適用する
- OFF／安全モードでもsplit storeとanchorを通常操作からread-onlyで保持し、再度ローカルONにした場合だけ現在の商品ID・順序からsplit identityを再構築する。期限到達済み`event-deleted` cleanupだけは例外として実行できる。原本の商品番号をON/OFF切替で書き換えない
- Backup V2／V1へ端末全体OFFと`localEnabled`を出力せず、復元入力に同名fieldがあっても未知keyとして拒否する。既存イベントへの復元では復元先のローカル状態を維持し、新規復元ではOFFとする
- オフラインは通常のローカル運用であり、それだけを理由に安全モードへ移行しない。重大障害時にインストール済み旧versionを遠隔停止できない制約を利用者向け文書へ明記し、端末全体OFFの案内と修正版配布で対処する

## 7. 初版バックアップと後続ファイル機能

### 7.1 イベント単位Backup V2とV1互換core

- 初版の分割対応backupをイベント単位V2として追加する
- schemaVersion、portable参照、active／dormant／quarantinedを含む`mapCellSplitSettings`セクションを追加する
- V1の`data` wire shapeは現行sectionだけを持つ`AppBackupV1Data`として凍結し、runtimeの`AppData`型を直接参照しない。V2を出力するたび、同じ対象eventのcore dataだけを収録した旧版用V1互換backupも別ファイルとして同時出力する。固定旧版Aが保存した`EventMetadata.splitIdentityAnchor`だけはoptionalな互換fieldとして新版V1 readerが受理し、その他の未知構造fieldは従来どおり拒否する
- 出力完了画面とファイル名で、V2は新版用で分割設定を含むこと、V1互換coreは旧版用で分割設定を含まないことを明示する。片方の生成または検証が失敗した場合は完了扱いにせず、利用者へ再実行を案内する
- V2の`data`もsplit設定を含まない`AppBackupV2CoreData`として固定し、split設定はtop-levelに一度だけ収録する
- V2 wire typeのtop-level必須keyは`kind`、`version: 2`、`exportedAt`、`scope`、`eventSettings`、`data`、`mapCellSplitSettings`、`digest`とし、未知keyを拒否する。`scope`は対象event、map、期待section、mapData／split設定の収録有無を明示し、`mapCellSplitSettings`はportable association manifestとentry配列を持つ。端末全体OFFとイベント単位`localEnabled`はどのsectionにも含めない
- V1は引き続き読み込む。アイテムimportでは設定を維持し、`PD-01`の完全復元では対象範囲の既存設定をpreview後に`legacy-full-restore-without-split-settings`でdormant化する
- ローカルrevision、checkpoint、`locationKey`、event／map／block instance IDをそのまま出力せず、ファイル内だけで有効なportable参照へ置換する
- `data.eventMetadata`の`splitIdentityAnchor`はV2 export時に除去し、manifestのportable event参照へ置換する。復元preview確定後に新しいローカルanchorを発行し、アイテムimportでは入力側anchorを無視して既存anchorを維持する
- 復元時はportable参照を新しいローカルIDへremapし、外部IDをそのまま採用しない
- 形式、値、portable参照、重複entry、status、schemaVersionが不正なファイルはDB更新前に全体を拒否する。構造的には正しいが復元先と安全に一致しないentryだけをdormant／quarantinedとして保持する
- イベント復元は確定前に復元先、置換、維持、休眠化、隔離、除外、ID remap、ローカルON／OFFを引き継がないことをプレビューする
- プレビュー確定時だけ、地図、アイテム、訪問順、分割設定を同じ原子的操作で置換する。取消、validation error、CAS競合時は全storeを旧状態のまま維持する
- 新しいイベントとして復元する場合は新しいローカルIDを発行して`localEnabled=false`とする。既存イベントへ復元する場合は復元先IDと復元先の`localEnabled`を維持し、内容だけを置換する
- Backupは端末間同期や差分mergeではない。復元元と復元先の双方に変更があっても自動合成せず、復元先の退避backupを案内したうえで選択したV2の内容へ原子的に置換する
- アイテムだけのimportは既存の地図、event／map instance ID、分割設定を維持する
- 一致しない旧version設定は削除せず、読み取れる範囲を`dormant`／`quarantined`として保持する
- 利用者は休眠・隔離設定を端末内で手動再関連付けまたは削除できる。設定単独JSON出力は後続版とする
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

初版の`scope`は`scopeKind: "event"`、単一の対象portable event／map参照、`includesMapData`、`includesSplitSettings`、`expectedSections`、各件数を持つexact schemaとする。宣言されたsectionが欠ける場合は破損として全体拒否し、宣言上含まれないsectionは意図的省略として扱う。top-levelの`mapCellSplitSettings` key自体は常に必須とし、`includesSplitSettings=false`のときだけ値を`null`、`true`のときだけmanifest＋entry objectとする。`full`と`multipart` scopeは後続versionで定義し、初版readerは未知scopeとしてDB更新前に拒否する。

- split-capable exporterが地図を含むevent scopeを出力する場合は`includesSplitSettings=true`を必須とし、分割設定を黙って省略しない
- core-only source等から`includesMapData=true`かつ`includesSplitSettings=false`のV2を復元する場合は、V1 fullと同じく影響範囲の既存split設定をpreview後に`legacy-full-restore-without-split-settings`でdormant化する
- `includesMapData=false`かつ`includesSplitSettings=false`のitem-only scopeは既存の地図・分割設定を維持する。map置換とitem-onlyを同じ「設定なし」として扱わない

- `dataEventKey`は同じV2のevent-scoped全sectionに存在するevent keyを指す
- `dataDayMapSlotKey`は参照eventの`data.mapData`にある日程・地図slotを指す
- `dataBlockSlotKey`は参照map内の論理block slotを指す
- portable entryのbinding evidenceはruntimeと同じ`algorithmVersion`、`mapStructureFingerprint`、`blockFingerprint`、`locationFingerprint`のexact field名を使う
- active entryはevent／map／block参照がmanifestで一意に解決し、同梱mapDataから再計算したmap／block／location binding evidenceが一致する場合だけ許可する
- dormant／quarantined entryは未解決参照を許すが、last-known表示情報、最後にactiveだったmap／block／location binding evidence、allowlist reasonを必須とする
- manifest、core data、preview inputから端末全体OFFまたは`localEnabled`を受け取らない。既存イベントでは復元先のローカル値を表示し、新規復元ではOFFになることを表示する
- 重複ref、存在しないactive参照、同じdata slotへの多重ref、manifest外の未知keyを全体拒否する

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

| 列            | 必須     | 内容                                        |
| ------------- | -------- | ------------------------------------------- |
| `kind`        | 必須     | `event`／`map`／`block`                     |
| `ref`         | 必須     | kind内で一意なportable参照                  |
| `parentRef`   | 状態依存 | mapはeventRef、blockはmapRef、eventは空     |
| `dataSlotKey` | 必須     | event key、day-map slot key、block slot key |

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

「セル分割参照」の`dataSlotKey`は同じworkbookの同梱mapDataへ一意に解決するものだけを許可する。active設定は3段階の参照解決とmap／block／location binding evidence一致を必須とし、dormant／quarantinedだけ未解決参照を許可する。端末全体OFFとイベント単位`localEnabled`はworkbookへ収録しない。

### 7.3 保証規模と入力安全制限

自動性能テストの保証規模と、攻撃・破損ファイルを拒否するhard resource limitを分ける。hard limitは3.13の保証規模以上とし、FSMC-I0の固定CI profileでの自動テスト後にversion付きconfigへ固定する。テスト前に推測値を設定しない。

- 保証規模超過かつhard limit以下は警告付きbest effortとし、自動削除・切捨て・設定解除を行わない
- hard limit超過はWorkerまたはvalidatorで`resource-limit`として拒否する
- backupは`JSON.parse`前のraw byte上限、nesting、総entry、文字列UTF-8 byte、duplicate ref、構造fieldのallowlist、validation error保持数を制限する。利用者入力値であるイベント名・日程名等が`__proto__`、`constructor`、`prototype`であること自体は拒否せず、動的keyは`Map`、null-prototype object、または安全なown-property APIで扱ってprototype chainへ代入しない
- 後続版のXLSXは既存limitに加えてsheet／row／cell数、設定row数、展開後XML byte、圧縮率、timeout、cancel、heartbeat、peak memoryを制限する
- アプリ自身が出力した保証規模内のV2を同version importerがresource limitで拒否しないgolden testを固定する

初版のevent export preflightで1イベント内地図数、entry数、推定byte数を検査する。FSMC-I0の自動テスト後に次を同じversion付きconfigへ固定する。

- イベント単位Backup V2とV1互換coreのmap／entry／raw byte保証上限
- 上限内での自己round-trip保証

初版のeventが保証上限を超える場合は、読めない単一ファイルや不完全ファイルを生成せず、出力を停止して対象eventの縮小方法を案内する。自動分割するmultipartは後続版とする。hard limit以下でも保証上限超過ならbest effort警告を出す。具体数値は最大fixtureの自動テストなしに推測せず、FSMC-I0 Exitで必ず確定する。

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

- 経路探索の基準セルは従来どおり整数の行・列
- 半領域中央を正確なfractional `anchor`として別フィールドに持つ
- 経路本体は既存3×3探索を利用し、結果を`mainPath`として保持する。`routingPort`はbaseCellまたは同じ結合セル領域内の通行可能点から上・左・右・下の固定順で決定する。安全なportがない、またはそこからanchorへ同じ物理セル領域内だけで接続できない場合は`unroutable: unsafe-connector`を返す。別セルまでBFSしてanchorへ直線を引く処理や、障害物を無視し得る直線／L字fallbackを使わない。`mainPath`の始終点はfrom／toの各`routingPort`と一致させる
- `routingPort`から半領域anchorへの`from-anchor`／`to-anchor` connectorは、線分全体が対象の自セルまたは結合セル領域内にあり、禁止領域を横断しないことをgeometryで検証した場合だけ`mainPath`と別配列で保持し、細い点線で描画する。connectorをpathfindingの通過コスト、重複penalty、sub-cell使用量へ混入させない
- 同一整数セルのa→bは、両anchor間が同じ物理セル領域内で安全な場合だけ`mainPath=[]`と`same-cell-direct` connectorを正式なvisit間segmentとして保持し、安全でなければ`unroutable`とする
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

本章の`FSMC-I0`～`FSMC-I11`はFull Split Map Cell初版固有の実装checkpointであり、リポジトリの正式release gateである`P0-RELEASE`～`P8-CLEAN`とは別物とする。文書、PR、issueでは`P0`等の省略名を使用しない。FSMC checkpoint自体を既存の`RELEASE_PHASE_GATES`へ追加せず、初版の全自動テストを既存release workflowの通常checkとして実行する。

各FSMC PRは、そのフェーズのunit、integration、browser、schema、fixture、CI設定を同じPRに含め、FSMC-I11まで試験を延期しない。各PRは端末全体OFFを既定として独立してmainへmerge・配布可能でなければならず、前フェーズの自動Exit testが未達のまま次フェーズを開始しない。外部証跡bundle、remote activation、実イベントpilotは作らない。

公開時も既存イベントは`localEnabled=false`を既定とし、利用者が端末内でイベントごとに有効化する。問題発生時は端末全体OFFで`PD-04`のsplit固有部分のlegacy動作（`PD-14`の常時修正を含む）へ戻し、インストール済みversionを遠隔停止できないことを前提に修正版を配布する。

### FSMC-I0: 契約・fixture・基準値

実装:

- 仕様ADRを作成する
- startup capability判定とDB5～DB8のfixtureを定義し、端末外へ情報を送らないpreflightを固定する
- DB5、DB6／DB7（新storeあり／なし／不正）、DB8の期待動作を固定する
- store別`ExpectedRootVector`、Core／Split snapshot、association registryのanchor token、instance ID、entry単位status、metadata revision／CAS、30日retention、手動再関連付けの契約を固定する
- DB5、バックアップV1、完全版XLSX 2.2のgolden fixtureを固定する
- A/B/A試験用の現行旧版ビルドを固定する
- 代表地図、ON／OFF別番号正規化、`01a`／`1a`衝突あり・なし、`26`／`26c`／`26d`／`26ab`／`26c2`、同名ブロック、一意番号、重複・領域競合・merge越境のfixtureを作る
- 15,000セル、15,000設定、30,000半領域、400アイテム、400 `SpaceIdentity`、400 `ExecutionVisitIdentity`、400 `PhaseVisitIdentity`の最大fixtureを作る
- 機能OFF時の描画・経路・性能基準を記録する
- 端末全体OFF、イベント単位`localEnabled`、自動安全モード、同一profile内の制御revision、split固有部分のlegacy経路を定義する。ただし、`PD-14`の共有訪問projection・挿入・経路修正は常時適用する
- BackupへローカルON／OFFを含めず、新規復元OFF・既存復元先状態維持・端末間同期なしを固定する
- `layoutMode`と`isSmartphoneSelectionMode`を分離し、Chromium mobile情報、入力能力、利用者override、狭幅PC、判定不能時の安全側動作を単一adapter契約へ固定する
- Critical／Highのseverity rubricとissue運用をADRへ固定する
- Backup V2とV1互換coreのresource limit、event／map／entry保証上限、自己round-trip条件を最大fixtureの自動テストから固定する
- V1 wire freeze、イベント単位Backup V2 scope／digest、未知version拒否、prototype-safe dynamic key、V2＋V1同時出力を固定する
- Desktop／Mobile Chromiumの自動テストprofileと、iPhone・ペン・OS／実機固有挙動の対象外境界をADRへ固定する
- 全性能scenarioの絶対上限を固定CI profile向けに`config/performance-budgets.json`へ非null値で固定する

Exit:

- まだDB・UI・本番動作を変更しない
- `26a`、`26a2`、`26b3`、`26A`、`２６ａ`、`01a`、`1a`、`26`、`26c`、`26c2`、`26d`、`26ab`のON／OFF別期待値が固定されている
- 旧版A→新版B→旧版A→新版Bの試験手順を自動化できる
- DB6／DB7で新storeなし・不正でも従来機能が起動し、分割機能だけが利用不可になる試験を自動化できる
- 非互換DB6／DB7検出時の安全な分岐条件がfixtureで自動テストされる
- 端末全体OFF、イベント別ON／OFF、制御変更mid-save、新規・既存復元のローカル状態が自動テストで固定される
- V1／イベント単位V2 wire type、通常地図編集の状態遷移、2-root以上のCAS擬似コードと障害表がレビュー済み
- performance budget、自動browser profile、severity基準、初版と後続版の境界にnull／pending／unconfiguredがない。FSMCと無関係な既存設定を本Exitへ混入させない

### FSMC-I1: 共通ドメイン

実装:

- `spaceNumber.ts`
- `splitGeometry.ts`
- `MapLocationIndex`、item resolver、空側対応hit-test、DOM列挙API
- 通常／集中モード共通viewport adapter
- `layoutMode`から独立した`isSmartphoneSelectionMode`判定と、`none | single | ambiguous`を入力別閾値へ結ぶinteraction policy
- `SpaceIdentity`、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、各canonical keyの型・正規化・生成契約
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
- preflight衝突0件では`01a`と`1a`が同じlocationへ解決され、衝突ありでは`localEnabled=true`を拒否してlegacy identityを維持する。`26c`／`26c2`と`26d`／`26ab`は相互に異なるidentityとなる
- 商品なしのa/b側をhit-testとDOM列挙の両方で解決でき、`whole`／unsupportedを「側未設定」と列挙し、重複番号・領域競合・merge越境を推測処理しない
- 狭幅Desktop profileは非スマートフォン規則、Mobile Chromium profileは全倍率pickerとなり、閾値・曖昧帯の直前／一致／直後と空間順ラベルが固定期待値に一致する

### FSMC-I2: ローカル制御、DB capabilityと保存基盤

実装:

- inventory gateを満たす範囲で`DB_VERSION=6`と新object storeを導入
- DB6／DB7新storeなし・非互換のcapability fallback
- `MapCellSplitSettingsRoot`、association registry、entry単位status、schema validation
- Core／Split snapshot union、store別root vector、専用atomic commandを持つrepository、facade、PersistenceCommandPort
- 初期読込、autosave、再試行、更新ブロッカー
- recovery state、atomic restore
- 現行CASへの参加と複数タブ競合表示
- `SplitMapLocalControlPort`、端末全体OFF、イベント単位`localEnabled`、自動安全モード、同一profile内の制御revision
- OFF／DB capability不正／binding不正時はsplit固有部分をlegacy resolver・保存・UI経路へ戻す。ただし、`PD-14`の共有訪問projection・挿入・経路修正は常時適用する
- 既存イベントは`localEnabled=false`のまま

Exit:

- DB5→6で既存storeの値とchecksumが不変
- 旧版がDB6を開いて従来データを読み書きできる
- 旧版操作で新storeのchecksumが変わらない
- DB6／DB7新storeなし・非互換でDBを変更せず、従来機能を利用でき、分割機能だけが有効化不能
- DB6／DB7互換storeありとDB8拒否が契約どおり
- core-only profileは現行core autosave契約を維持し、split commandを登録しない。split-capable profileの地図・association・split bindingを変更する複合commandとイベント単位復元だけは必要storeを原子的にcommitし、片方だけのcommitを起こさない
- 新storeの保存失敗が未保存表示とPWA更新抑止へ反映される
- 同時writerのstale保存が`PersistenceConflict`となり、部分commitとlast-write-winsが起きない
- DB契約、検証script、integration fixture、性能test configが同じversion契約を示す
- `verify:architecture`が合格
- DB capability正常、端末全体OFF=false、対象eventの`localEnabled=true`、自動安全モードなしをすべて満たす場合だけsplit commandが登録される
- 端末全体OFF／event OFF、別タブによる制御revision変更、再起動、オフラインで固定期待値どおりになる。オフラインだけを理由にOFFへしない
- ローカル制御変更中、QuotaExceeded、各transaction段階のabortで複合commitが全成功または全rollbackとなり、部分commitがない
- OFF時のsplit固有表示、番号identity、whole-cell位置解決、core保存結果とcore store checksumは固定した旧版Aに一致する。DB version、空の新store、read-only split payloadに加え、`PD-14`による共有訪問projection・挿入・経路の既知修正だけを許容差分とする。Q9 fixtureではraw商品IDとcore checksumを維持したまま、通常マップと集中モードが同じ訪問・経路結果になることを確認する

### FSMC-I3: イベントIDとライフサイクル

実装:

- 既存イベント、地図、ブロックへのローカルinstance ID付与
- 現行event／day-map／block slotとinstance IDを結ぶassociation registry
- URLなしイベントを含むempty-source `EventMetadata`、registry anchor tokenとの一致検証
- 作成、改名、削除、複製、復元
- ID衝突、ID欠落、active／dormant／quarantined処理
- 同名イベント再作成の誤接続防止
- 新しい実体の複製時だけの新ID発行。別日程・別地図・別ブロックへの設定コピーは初版commandへ含めない
- イベント削除時の「30日保持」既定、即時完全削除、端末時計異常時に延期する期限cleanup

Exit:

- 新版での作成・改名・複製・削除が原子的
- 旧版で改名、削除、同名再作成後に誤接続しない
- 旧版がanchorを保持する操作ではIDを維持し、anchor欠落・重複時は名前や指紋だけで再接続しない
- 安全に識別できない設定は表示せず、既存データを壊さない
- 名前だけで再接続せず、端末内の手動再関連付けと明示削除が可能。設定単独出力の入口は初版に設けない
- D+29までは削除イベントの設定を同じ端末の別イベントへ再関連付けでき、設定単独出力は提供しない。D+30以降は正常な端末時計に基づき`event-deleted`理由の対象だけを削除する。削除済みイベント本体の復元とは表示せず、時計異常時は早期削除しない

### FSMC-I4: イベント単位Backup V2とV1互換core

実装:

- イベント単位Backup V2
- V1 wire shapeの凍結、V2と同時出力するV1互換core、旧形式完全復元のdormant preview
- event scope manifestとruntime snapshotから分離したcore wire type
- Worker protocolと検証
- 壊れた設定の原子的拒否
- イベント復元の全置換previewと、アイテムimport時の設定維持
- portable参照のローカルID remap、端末内ON／OFFの非収録、新規復元OFF、既存復元先状態維持
- 1主端末、復元先全置換、復元前退避案内、自動同期・自動merge禁止
- resource limitと過大入力の原子的拒否
- file-size preflight、byte decode、Worker内depth scanner、cancel
- Backup V2 digestと未知version／未知scope拒否
- event保証上限超過時は出力を停止し、読めないファイルやmultipartを初版で生成しない
- `__proto__`／`constructor`／`prototype`を利用者名として安全にround-tripするdynamic key処理
- UIで`File.size`を検査してから全体読込を行い、`arrayBuffer`／UTF-8 byte decode後のBackup解析をWorkerへ移す

Exit:

- V1と地図を含むがsplitを含まないV2を読め、map置換では対象の既存split設定をpreview後にdormant化し、item-only importでは維持する
- V2で4方向とactive／dormant／quarantinedを往復でき、同時出力したV1互換coreを固定旧版Aへ復元できる
- 簡易XLSX・CSVに分割設定が含まれない
- mapDataを置換する復元だけが設定を同時に置換またはdormant化し、item-only importでは設定checksumが不変
- 外部IDをローカルIDとして採用せず、不正参照・hard limit超過をDB更新前に拒否する
- 形式不正は全体拒否し、復元先不一致だけをdormant／quarantinedとして保持する
- V2 digest不一致、未知version、未知scope、local ON／OFF fieldを拒否する
- 保証上限内の自アプリ出力をround-tripでき、超過時はファイルを生成せず理由を表示する
- clean profileへの新規復元はOFF、既存イベントへの復元は復元先のローカル状態を維持し、両端末の変更をmergeせず選択したV2へ原子的に置換する

このPRが完了するまで、利用者が分割設定を作成できるUIを公開しない。

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

Exit:

- preview取消で変更なし
- 部分不一致は適合箇所だけ適用
- 保存失敗時に全対象が旧状態へ戻る
- 分割解除でアイテム番号を変更しない
- 重複番号セルへ設定を保存できず、対象外理由を表示する
- 「追加・変更のみ」ではコピー元未分割・コピー先分割済みを維持し、「完全同期（解除を含む）」だけが「解除」と表示して確定時に解除する。dormant／quarantined元は解除に変換しない
- 端末全体OFF、event OFF、自動安全モードで設定UIへ到達できず、UIからローカル制御gateを迂回して保存commandを呼べない

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

### FSMC-I7: 既存データidentity migrationと共有訪問投影

実装:

- FSMC-I1で固定済みの番号正規化、`SpaceIdentity`、`ExecutionVisitIdentity`、`PhaseVisitIdentity`、canonical key APIを既存データと利用箇所へ適用
- raw実行商品ID配列をglobal sortせず、非連続な同一`ExecutionVisitIdentity`を配列全体で集約し、legacy dataの初回は最初の商品位置、以後はidentity単位で保持したorderをbase訪問位置にする共有projectionを実装
- 日程、ブロック、番号、side、優先度編集でidentityが既存destinationへ変わる場合の、変更itemだけをdestination member末尾へ移す決定的rekey plannerと、item ID対応から現在・保存位置の`PhaseVisitIdentityKey`を再解決する処理
- normalは全実行商品、後回し・遅参は追加phaseとしてbase順から生成し、1商品が複数phaseへ属せる共有projectionを通常マップ、集中モード、`MapVisitList`、経路へ提供
- 通常の実行列・候補列と同じ優先度別グループ規則への統一
- 既存訪問順、後回し、遅参データの互換変換
- item ID anchorによる現在位置、保存位置、execution／phase visit-key依存状態の決定的migration
- unsupported番号tokenを含む既存訪問migrationと、item／row-col中心の経路点から`PhaseVisitIdentity`中心のroute型への変換
- `ProjectedPhaseVisit`ではmember商品IDをpayloadとして保持し、代表item IDをvisit identity、route、hit-test、挿入anchorへ流用しない

Exit:

- preflight衝突0件の`01a`と`1a`だけが同じ半領域anchorへ解決され、衝突時は機能ONを拒否してlegacy identityを維持する
- 同じ側・同じ優先度は1つの`ExecutionVisitIdentity`へglobal集約され、進行区分ごとに別`PhaseVisitIdentity`へ投影される
- 同じ側でも優先度が異なれば別execution／phase訪問として維持される
- raw `[A1, B, A2]`を並べ替えず、全画面と経路ではnormal `[A(A1,A2), B]`へ一致して投影する
- A1を既存B identityへ変更した場合、B訪問位置と他itemの相対順を維持してA1だけをB member末尾へ移し、変更元visit、現在位置、保存位置、phase集合、経路の`PhaseVisitIdentityKey` anchorを決定的に再解決する
- 投影済みvisitの先頭memberを削除しても同じidentityのmemberが残る場合は、同じ`PhaseVisitIdentityKey`、訪問位置、座標、経路順へ再解決する
- `01a`と`1a`の既存訪問が安全に統合できる場合も商品・raw順・後回し・遅参を失わず、解決不能な一時状態だけを安全に破棄する
- FSMC-I8以降が確定済みidentity APIだけを利用できる
- OFF切替でsplit identityをlegacy keyへ永続的に破壊変換せず、ON復帰時に商品ID・順序から決定的に再構築できる

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

Exit:

- 26a操作で26bを開かない・変更しない
- 通常マップの既存色規則を維持
- 空側で正しい見出しと事前入力値を表示
- `26`／`26c`だけが存在しても左右クリックがアイテムなしになり、中央badgeとDOM一覧に「側未設定」が表示される
- スマートフォンは最大zoomでもpickerを使用し、非スマートフォンは閾値未満・曖昧帯で選択を変えない
- pan、pinch、pointer cancel、capture喪失、layout切替後にpopupを誤表示しない

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

### FSMC-I10: 経路と訪問集約

実装:

- `PhaseVisitIdentity`／`ResolvedRouteVisitPoint`単位の基準セル、routing port、anchor
- main pathと細い点線connector、同一セルa→b segmentの分離
- 自セル・結合セル領域内の決定的routing port、安全なconnector検証、`unroutable`、領域外BFS・未検証L字fallback禁止
- routable／unroutableの判別可能`RouteResolution`
- marker／main path／connectorのhit-test優先順位とvisit ID候補
- cache/signature更新
- I7の共有projectionを経路順の唯一の入力とし、同じexecution identityのglobal集約とphase別投影を維持
- route、marker／connector hit-test、挿入anchorを`PhaseVisitIdentityKey`で一貫して参照し、member商品ID列はpayloadとして扱う。座標・順序signatureへmemberの先頭IDや件数を混入させない
- 異なる優先度を別訪問として保持
- 手動順と、手動順がない場合だけのa→b自然順
- DOM訪問一覧は`ProjectedPhaseVisit[]`を受け取り、priority、phase、member件数を表示する。同anchorの別visit選択は`onSelectVisit(visitId, location)`、「この訪問の後へ挿入」は`onInsertAfterVisit(visitId)`で渡す。ただし追加対象の`ExecutionVisitIdentity`がraw配列全体に存在しない場合だけ位置指定を適用する。既存execution identityがある場合は対象phaseが未作成でもbase位置を維持し、新しいphase entryだけをbase execution順から派生させる

Exit:

- a/bが別終点・別マーカーになる
- 同じ側・同じ優先度の複数アイテムはraw配列で非連続でも1つの`ExecutionVisitIdentity`になり、phaseごとに投影される
- 同じ側でも優先度または進行区分が異なれば別訪問になる
- 同じanchorの複数訪問は件数badgeとDOM一覧で存在・優先度・進行区分を確認できる
- 手動b→aが維持され、自動時だけa→bになる。phase別訪問は独立manual順を持たずbase execution順から派生する。既存execution identityへの位置指定追加は対象phaseの有無を問わずanchorを無視して既存base訪問へ統合し、「指定位置に新規訪問は作成しませんでした」と通知する
- 同一anchorの別訪問が経路順・進行状態・挿入候補として失われず、中立marker・件数badge・現在ringで表示される
- 先頭memberを削除しても同identityのmemberが残る場合は、route、hit-test、挿入anchorが同じ`PhaseVisitIdentityKey`へ再解決され、座標、順序、route cacheを維持する。member payloadだけを更新する
- 同一セルa→bが安全な場合だけmain pathなしの点線segmentとして表示・hit-testでき、connector追加で3×3 pathfindingのcostや重複penaltyが変化しない。安全でなければ`unroutable`となる

### FSMC-I11: 横断E2E、性能、自動release gate

実装:

- Desktop Chromium、Mobile Chromiumの必須projectと、別job／別scriptで実行するWebKit advisory smoke project
- Canvasの論理座標assertionと必須projectの画像基準
- 端末全体OFF、event OFF、自動安全モード、ローカル制御変更mid-saveの横断検証
- DOM代替導線と公開上のアクセシビリティ制約
- PWA新旧世代、旧版A／新版B同時tab、failure injection、Backup置換、1主端末制約の横断検証

Exit:

- Desktop／Mobile Chromiumの必須自動テストを通過
- データ消失、a/b混同、誤経路が0件
- 必須自動テストでCritical／High相当の既知失敗が0件
- Backup V2＋V1互換core、機能OFF／安全モード→ONの復旧、新規復元OFF、既存復元先状態維持を確認
- WebKit advisoryの失敗は必須Chromium jobと分離し、iPhone／ペン／OS・実機固有挙動を保証対象と表記しない
- 必須Chromiumとadvisory WebKitが別job／別scriptで実行され、WebKit browser未導入が必須CIを失敗させない
- 性能、PWA multiclient、backup、旧新版互換を通常のCI testとして実行し、外部receipt、実イベントpilot、managed-device artifactを要求しない

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

先頭ゼロpreflightは2種類用意する。衝突なしfixtureでは`01a`、`1a`、`０１ａ`のうち単一のlegacy identityだけを保存して同じ売場へ正規化する。衝突ありfixtureでは`01a`と`1a`を別identity・別状態で共存させ、`localEnabled=true`を拒否してlegacy動作と解決案内へ戻す。同優先度の複数商品・異なる優先度の商品も配置する。

訪問fixtureにはraw実行商品ID順`[A1, B, A2]`を置く。raw順を変更せず、normal投影が`[A(A1,A2), B]`となること、A2を後回しにするとnormal Aの位置を維持したままpostponed Aがbase順で追加されること、通常マップ、集中モード、`MapVisitList`、routeが同じ共有projectionを使うことを固定する。

別fixtureとして、横長結合セル、縦長結合セル、非連続`cellGroups`、同形状ブロック、不一致ブロック、重複block ownership、merge越境、重複mergeを用意する。重複・競合は対応ケースではなく負例fixtureとし、保存・コピー・自動継承から安全に除外されることを確認する。

永続化・ファイルfixtureには、`EventMetadata`のないイベント、イベント名・日程名が`__proto__`／`constructor`／`prototype`のデータ、V1、イベント単位V2、V2＋V1互換core同時出力、イベント削除D+29／D+30、端末時計の正常経過・巻戻し・不自然な進みを含める。ローカル制御fixtureは端末全体OFF、event OFF／ON、自動安全モード、別タブによる制御revision変更、オフライン、新規復元OFF、既存復元先状態維持、Backup内の禁止ON／OFF fieldを含める。さらに3.13の保証規模を同時に満たす最大fixtureを用意する。

### 10.2 必須マトリクス

| 観点              | 必須ケース                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 分割              | なし、左a、右a、上a、下a                                                                                                                                                                                     |
| 番号identity      | 衝突なしpreflightで`01a`／`1a`／`０１ａ`が同一、衝突ありとOFFではlegacy維持、`26c`／`26c2`は同一、`26d`／`26ab`は別identity、「側未設定」表示                                                                |
| 訪問identity      | 非連続同一execution identityのglobal集約、同側異優先度、異側同優先度、normal＋後回し／遅参の追加phase、raw手動順、既存identityへの挿入指定無視                                                               |
| 形状              | 通常、横長結合、縦長結合、非連続block、番号重複、重複block ownership、merge越境、重複merge                                                                                                                   |
| 回転              | 0°、15°、90°、180°、270°、359°、a/b・badge文字の正立                                                                                                                                                         |
| DPR               | 1、2、3                                                                                                                                                                                                      |
| 拡大・端末判定    | Mobile Chromiumは全倍率picker、狭幅Desktopは非スマートフォン、入力別閾値・曖昧帯の直前・一致・直後、空間順ラベル、利用者override、アプリ倍率、200%                                                           |
| 入力              | mouse、touch、長押し、drag、pinch後の片指継続、Canvas外pointerup、Pointer Cancel、lost capture、画面回転、layout切替                                                                                         |
| 状態              | 空、巡回対象外、未処理、処理済み、後回し、遅参、優先度混在、同側複数件                                                                                                                                       |
| 集中追加          | 購入済、後回し、遅参、実行対象外のみ、空側                                                                                                                                                                   |
| 編集              | 単一、複数、一括解除、既定の追加・変更のみ、明示的完全同期、コピー先ID維持、履歴保護、解除preview、非連続block、manual改名・移動・同名置換、取消、保存失敗                                                   |
| 再取込・通常編集  | 無関係変更、一意移動、欠落、重複、結合範囲変更、旧版変更検出、休眠・隔離、取消                                                                                                                               |
| DB互換            | DBなし、DB5、DB6／DB7互換、DB6／DB7 store欠落、DB6／DB7不正store、DB8                                                                                                                                        |
| ローカル制御      | 端末全体ON／OFF、event ON／OFF、自動安全モード、制御revision競合、commit直前OFF、再起動、オフライン、Backup非収録、新規復元OFF、既存復元先状態維持                                                           |
| entry binding状態 | active、dormant、quarantined、同一map内の混在、端末内手動再関連付け、即時削除、正常／異常端末時計のD+29／D+30 cleanup、初版にportable出力なし                                                                |
| 複数タブ          | 同一root vector同時編集、先行commit、stale拒否、複合操作rollback、再読込後の再編集                                                                                                                           |
| PWA世代混在       | 旧SW＋旧tab、新SW waiting、新旧tab同時、versionchange blocked、update blocker、close／reopen                                                                                                                 |
| 障害注入          | QuotaExceeded、各transaction段階abort、browser終了、ローカル制御変更、network切断、storage eviction                                                                                                          |
| 復元              | V1とmapあり・splitなしV2の休眠preview、event V2、V2＋V1互換core同時出力、取消、item-only時の設定維持、新規／既存復元、全置換・merge禁止                                                                      |
| 入力安全          | raw byte、深さ、総entry、重複ref、未知version／scope／local control field、timeout、cancel                                                                                                                   |
| 規模              | 15,000セル、15,000設定、30,000領域、400アイテム、400売場、400訪問、保証境界超過                                                                                                                              |
| ファイル総量      | event内map／entry境界、上限超過時の出力停止、V2 digest、未知version拒否                                                                                                                                      |
| 形式              | Backup V1/V2。XLSX 2.3、multipart、設定単独JSONが初版に露出しないarchitecture test                                                                                                                           |
| 互換              | 旧版A→新版B→旧版A→新版B                                                                                                                                                                                      |
| 経路              | a/b別anchor、安全な同一セルa→b、main path／種別付きconnector、自セル領域内port、unsafe-connector、unroutable、同anchor別phase訪問、共有projection、PhaseVisitIdentityKey基準のhit-test／挿入、先頭member削除 |
| アクセシビリティ  | DOM詳細、空側追加、同anchor候補、一時移動、Canvasなし経路挿入、DOM／Canvas別focus復帰、結果通知                                                                                                              |
| 自動テストprofile | Desktop／Mobile Chromiumの固定viewport、DPR、入力能力、retry 0、固定fixture                                                                                                                                  |

必須マトリクスは全直積を意味しない。各行についてunit、integration、browser、a11y、性能の担当層をtraceability表へ記録する。a/b分離、原子保存、旧新版同居、ローカルOFF mid-save、Backup置換、訪問global集約はrisk-based必須組合せとし、その他はpairwiseを許可する。各ケースはrequirement ID、fixture、期待値、実行commandを持つ。データ安全性specはCI retryを0とし、初回失敗後のretry成功を合格扱いにしない。実機receiptや外部証跡は要求しない。

### 10.3 主要E2E

1. 左右分割で26a/26bを別々に開き、片側だけ状態更新する
2. 上下分割した結合セルを回転し、描画・タップ・経路を一致させる
3. Mobile Chromiumでpickerを開き、画面上の空間順と「左側 b／右側 a」等の表示・読み上げ順を一致させる。集中モードの空側から追加した結果も通常画面と一致させる
4. 同一地図内の複数セルを「追加・変更のみ」でコピーし、コピー元未分割に対応するコピー先既存設定が維持されることを確認する。別操作の「完全同期（解除を含む）」だけが解除preview・確定を行い、stale時は全abortする
5. 地図再取込後に設定を継承し、イベント単位Backup V2でround-tripする。同時出力したV1互換coreを固定旧版Aへ復元できる
6. 旧版へ戻して従来表示で操作し、新版で分割設定を復元する
7. 端末全体OFF／event OFF→`PD-04`で定義したsplit固有部分のlegacy動作（`PD-14`の常時修正を含む）→ONで設定が戻る。オフラインだけではOFFにならず、別タブがcommit直前にOFFへ変更した場合は全abortする
8. 先頭ゼロ衝突なしでは`01a`と`1a`を同じ半領域へ正規化し、衝突ありではevent ONを拒否してlegacy identityと原文を維持し、解決方法を案内する
9. raw実行商品ID順`[A1, B, A2]`を維持したまま、通常マップ、集中モード、`MapVisitList`、route／hit-testのnormal投影を`[A(A1,A2), B]`へ一致させる
10. raw `[A1, B]`へ後回しA2を追加し、base A位置を動かさずnormal Aへ統合すると同時にpostponed Aをbase順で追加投影する。現在位置・保存位置を動かさず統合通知を全画面で一致させる
11. 「Bの後へAを挿入」を指定してもAの`ExecutionVisitIdentity`が既に存在する場合は位置anchorを無視し、既存Aへ統合して「指定位置に新規訪問は作成しませんでした」と通知する。identity未存在時だけ指定位置へ新規訪問を作る
12. 2タブが同じroot vectorを読み、タブA保存後のタブB保存が`PersistenceConflict`となり、Aのpayload・metadata・checkpointが維持される。タブBは退避後に最新DBを明示再読込してから再編集する
13. DB6／DB7＋新store欠落・非互換profileを開き、DBを変更せず従来機能と分割機能利用不可理由を表示する
14. dormant／quarantined設定の端末内手動再関連付けと削除についてpreview取消・確定を確認し、設定単独portable出力の入口が初版にないことを確認する
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

### 10.4 アクセシビリティ試験

キーボード・画面読み上げによるCanvas半セルの直接選択だけは対象外だが、非スマートフォンのmouse／touch直接選択、スマートフォンpicker、次のDOM代替導線は必須とする。

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

3.13の最大条件を同時に満たすfixtureを使い、固定CI profileで1回warm-up後、30サンプルを計測する。外れ値を除外せずnearest-rank p95を使い、各scenarioを通常の自動テストとして合否判定する。外部性能証跡やmanaged-device sampleは保存しない。

5秒操作scenarioでは、連続する各pointer／wheel入力の受付から次のpaintまでをsampleとし、入力のないidle frameを成功sampleへ加えない。pan、zoom、rotationを各10回以上含め、下表のinput-to-next-paint p95とmain thread task上限を同時に満たす。

- 初回地図描画
- 5秒間のパン・ズーム・回転
- タップからpickerまたはポップアップ表示
- 経路再計算
- 大量セルの一括設定・コピーpreview
- Backup V2とV1互換coreの同時出力、V2入力
- peak memoryと画面終了後の解放
- 初期索引作成と15,000件のschema validation

全scenarioに非nullの絶対上限を設定し、比較可能な既存操作だけは絶対上限に加えて機能OFF比のp95悪化10%以内も満たす。FSMC-I0 Exit時点で`config/performance-budgets.json`とscenario定義へ次の固定CI profile用初期上限を登録する。テスト結果に基づき厳格化でき、緩和は通常のcode review対象とする。

| シナリオ                                        | Desktop Chromium CI p95 | Mobile Chromium emulation CI p95 |
| ----------------------------------------------- | ----------------------: | -------------------------------: |
| 最大fixture初回地図描画                         |                1,500 ms |                         2,500 ms |
| 5秒間のpan／zoom／rotation中input-to-next-paint |                  100 ms |                           150 ms |
| タップからpicker／popup                         |                  150 ms |                           200 ms |
| 400訪問の経路再計算                             |                  750 ms |                         1,500 ms |
| 15,000件の一括設定・copy preview                |                1,500 ms |                         3,000 ms |
| Backup V2 import／export                        |                5,000 ms |                        10,000 ms |
| 初期索引＋15,000件validation                    |                1,500 ms |                         3,000 ms |

- main thread taskは全sampleで200ms以下とし、1秒を超える処理は進捗表示と取消を提供する
- peak memory deltaはDesktop CIで256 MiB、Mobile emulation CIで192 MiB以下、画面終了30秒後の残留deltaは64 MiB以下とする
- timeout／cancel後にWorker、timer、Blob URL、transactionを残さない
- 描画ごとに全商品と全セルを総当たりせず、`MapLocationIndex`を再利用する
- 最大条件を超えるデータは初版の自動テスト保証外とし、hard limit以下では警告付きbest effortとする

## 11. 自動テストゲート

### 必須CI

- `desktop-chromium-required`: Desktop Chromiumの全E2E
- `mobile-chromium-required`: Android相当Mobile Chromiumのスマートフォン常時picker、縦横画面、空側追加、gesture
- `a11y-chromium-required`: DOM代替導線、経路挿入、focus、axe
- unit、integration、persistence、worker、encoding、architecture、coverage、FSMC compatibility、failure injection、legacy parity
- 必須projectのCanvas画像基準と論理座標assertion
- データ安全性specはretry 0または`failOnFlakyTests`を有効にし、flaky successを合格扱いにしない

必須jobはChromiumだけを明示installしてbranch protectionのrequired checkとする。テストごとに再buildせず、同一CI runで作成したbuildをbrowser／a11y試験で再利用する。source-bound証跡bundleやmanaged-device receiptは作らない。

### advisory CI

- `webkit-advisory-smoke`
- `webkit-advisory-a11y`

WebKitは必須jobと別のscript／jobで明示installし、結果をnonblockingとする。通常のtest logや失敗時traceはCIデバッグ用途に限り、製品完了の外部証跡や正式保証に使用しない。WebKit未installを理由に必須Chromium jobを失敗させない。

Windows、Android、Galaxy A57、iPhone、ペン等の実機確認は任意であり、機種別receipt、実イベント記録、OS build証跡を完了条件にしない。利用者向け文書は「Desktop Chromium／Mobile Chromium emulationで自動テスト済み」と表記し、特定OS・端末を正式保証済みと表記しない。任意確認で安全問題を発見した場合は再現fixtureとretryなしの自動回帰testを追加する。

## 12. ローカル公開と有効化

1. FSMC-I0～I11の必須自動テストと既存release gateが成功したbuildを配布する
2. 配布直後は端末全体設定をOFF、既存イベントを`localEnabled=false`とし、`PD-04`のsplit固有部分のlegacy動作（`PD-14`の常時修正を含む）を維持する
3. 利用者が端末全体設定をONにし、対象イベントの分割設定previewを確認してイベント単位で明示ONにする
4. 新規イベント、Backupから新規復元したイベントも初期OFFとする。既存イベントへの復元は復元先のローカルON／OFFを変えない
5. 問題発生時は端末全体OFFを最優先し、`PD-04`で定義したsplit固有部分のlegacy動作（`PD-14`の常時修正を含む）へ戻す。保存済み分割設定は削除しない

remote activation、段階flag、実イベントpilot、利用回数集計、外部metrics、署名receiptは使用しない。インストール済み旧versionを遠隔停止できないため、安全モードの場所、Backup作成、修正版への更新方法を利用者向け文書へ明記する。イベントを複数端末で同時編集せず、主端末を移す場合はBackup V2による全置換を使う。

## 13. 公開停止条件

severityはFSMC-I0 ADRの固定rubricで判定する。Criticalはデータ消失、a/b間またはイベント間の交差更新、誤復元、ローカル制御迂回等の安全事故またはその再現可能な危険、Highは必須自動テストprofileで主要flowが完了不能、再現可能なfreeze／crash、絶対性能上限超過等の重大な利用不能とする。issueで原因と再現fixtureを管理し、修正をretryなしの自動回帰testへ固定する。

次のいずれかが1件でも発生した場合は公開を停止する。

- 26aの操作で26bのアイテムまたは状態が変更される
- 分割設定、アイテム、訪問順のいずれかが失われる
- 回転後に描画・タップ・経路位置が一致しない
- Backup V2から復元できない、または同時出力したV1互換coreを固定旧版Aへ復元できない
- 地図再取込で誤った番号セルへ設定が継承される
- 同名の別イベントへ休眠設定が誤接続される
- 優先度が異なる訪問が黙って1訪問へ統合される
- 複数タブ競合が通知されず、後から保存した内容で既存設定が上書きされる
- DB6／DB7新storeなし・非互換のprofileを変更する、または従来機能まで起動不能にする
- 固定CI profileで性能基準を再現可能に超過する
- オフライン時にローカル安全モードで従来表示へ戻せない
- 再起動後に設定が消える
- 必須自動テストprofileで再現可能なフリーズまたはクラッシュが発生する
- 端末全体OFF、event OFF、自動安全モードのいずれかをsplit commandが迂回する
- Backup復元によって新規イベントが自動ONになる、既存イベントのローカルON／OFFが変わる、または別端末の変更を推測mergeする
- 同じexecution identityの商品追加で既存訪問位置が動く、非連続商品が画面ごとに別訪問になる、またはnormal／後回し／遅参の投影が画面と経路で食い違う
- connectorが自セル・結合セル領域外または障害物を横断する
- feature OFFでsplit固有のlegacy表示、番号identity、whole-cell位置解決、core store checksumが許容差分以外に変化する、または`PD-14`の既知修正が無効化されて通常マップと集中モードの訪問・経路不整合が再発する
- safety-critical testが初回失敗しretryだけで成功する

自動テスト対象外のOS・端末・ペン・WebKit固有の表示問題だけでは自動的な公開停止条件にしない。ただし、データ消失、a/b混同、誤保存、誤復元を再現できた場合は対象環境を問わず停止し、fixtureへ追加する。

### 13.1 停止手順

- 利用者へ端末全体OFFまたは対象event OFFで、`PD-04`で定義したsplit固有部分のlegacy動作（`PD-14`の常時修正を含む）へ戻すよう案内し、影響versionの配布を停止する。遠隔で既存端末をOFFにはできない
- 問題発生前に作成済みのBackup V2／V1互換coreと、利用者が明示的に提供した診断情報だけを使って復旧する
- 再現fixtureを作成し、修正版が同じ失敗をretryなしの自動テストで防ぐまで再配布しない
- 影響、回避策、設定が削除されていないこと、復旧見込みを対象利用者へ通知する
- DB versionを下げたり、新storeや保存済み分割設定を削除したり、自動修復を実行したりしない

### 13.2 再開条件

- incident記録とroot cause reviewを完了し、事故を再現するfixtureとretryなしの自動回帰testを追加する
- 修正sourceで必須CI、旧新版同居、failure injection、性能、backup復元が再成功する
- 影響データの復旧または利用者向け処置を完了する
- 端末全体OFF、event OFF、制御変更mid-save、Backup新規／既存復元の自動回帰testが成功する
- 修正版も既存イベントOFFを既定として配布し、停止前のローカルON状態を自動復元しない

## 14. Definition of Done

次をすべて満たした時点で完全分割初版を完了とする。

- `PD-01`～`PD-15`が要件ID、実装、自動テスト、利用者向け文書へ追跡可能で、初版の4方向、解除、同一地図内コピー、再取込・通常編集が実装済み
- preflight衝突0件の場合だけ`01a`／`1a`／`０１ａ`が同じ売場へ解決され、衝突時はevent ONを拒否してlegacy identityを維持し、いずれも表示原文を失わない。`26c`／`26c2`、`26d`、`26ab`は非対応番号同士で誤衝突せず、「側未設定」badge、DOM一覧、previewで識別表示される
- 機能OFF時はsplit固有部分が固定した旧版Aと同じ番号identity、未分割表示、whole-cell位置解決、core保存結果になり、ON/OFFで商品番号原文やsplit設定を破壊変更しない。訪問・経路・位置指定だけは`PD-14`の既知不整合修正を常時適用し、raw商品IDとcore checksumを変えず全画面で同じ結果にする
- item resolver、空側hit-test、DOM列挙が同じ`MapLocationIndex`、viewport adapter、geometryを使用する
- 重複block ownership、番号重複、merge越境、重複mergeを配列順で推測せず、影響する領域だけを安全に除外・隔離する
- manual map／block editでmapData、association、binding evidence、entry status、route cacheが同じ原子的commitで更新され、無関係なentryを失効させない
- コピーの既定「追加・変更のみ」は既存分割を解除せず、別操作の「完全同期（解除を含む）」だけが解除する。両方でmode、追加・変更・解除・維持・変更なし・除外のpreview、取消、stale時全abortが機能し、コピー先IDとdormant／quarantined履歴を維持する
- `layoutMode`とスマートフォン操作判定が分離され、Mobile Chromium profileでは全分割セルが空間順picker、狭幅Desktopを含む非スマートフォンでは入力別閾値に従い、閾値未満・曖昧時はno-op案内となる
- 通常マップと集中モードが同じPointer gesture state machineを使用し、pan、pinch、cancel、capture喪失、layout切替後の誤tapがない
- a/bの着色、ポップアップ、状態変更が独立し、集中モードの「購入済」と「後回し／遅参」の既存反映規則を維持する
- raw実行商品ID配列を並べ替えず、非連続同一`ExecutionVisitIdentity`をglobal集約し、normalと後回し／遅参の`PhaseVisitIdentity`投影を通常マップ、集中モード、`MapVisitList`、route／hit-testで共有する。既存identityへの位置指定追加はanchorを無視して統合通知し、訪問位置を動かさない
- 商品編集でexecution identityが既存destinationへ変わる場合はdestination訪問位置を維持し、変更itemだけをmember末尾へ移して現在・保存位置を新しい`PhaseVisitIdentityKey`へ再解決し、全画面へ同じ結果を反映する
- route、hit-test、挿入anchorとDOM panel callbackが`PhaseVisitIdentityKey`を使用し、member商品ID列はpayloadに限定される。先頭member削除後も残存memberがあれば同じvisit ID、座標、順序、route cacheへ再解決され、priority、phase、member件数をDOMで確認できる
- main pathと種別付きconnectorが分離され、connectorは自セル・結合セル領域内で安全な場合だけ表示・hit-testできる。領域外または障害物横断が必要な場合は`unsafe-connector`で`unroutable`とし、同一セルa→bにも同じ規則を使う
- 同位置複数訪問が中立marker、訪問数badge、現在ringで表示され、番号・a/b・badge文字が全回転角で正立する
- Canvasを使わずDOM訪問一覧から詳細、追加、状態変更、一時移動、経路挿入を完了でき、a11y試験が成功する
- 起動preflight、DB5→6、DB6／DB7安全分岐、DB8拒否、旧版A→新版B→旧版A→新版Bの自動互換試験が成功し、端末情報を外部収集しない
- Core／Split snapshotを区別し、empty-source metadataのanchor、registry token、event／map／block instance ID、entry status、binding evidenceを保持する
- store別`ExpectedRootVector`とローカル制御revisionのCASによりlast-write-wins、部分commit、黙示mergeがなく、quota・abort・crash・OFF mid-save時も全成功または全rollbackとなる
- イベント削除画面は30日保持が既定、即時完全削除が別選択となる。D+29までは同じ端末の別イベントへ再関連付けでき、D+30以降は正常な端末時計に基づき`event-deleted`理由の対象だけを削除し、時計異常時は延期する。設定単独出力は初版にない
- dormant／quarantinedのpreview付き端末内再関連付けと明示削除が可能で、名前だけで別イベントへ再接続しない
- V1 wire shape、イベント単位V2のcore／split分離、scope、digest、V2＋V1互換core同時出力が固定される
- V1と、地図を含むがsplitを含まないV2では既存split設定をpreview後にdormant化し、item-only importでは維持する。event V2は原子的にround-tripする
- hard limit、digest、未知version／scope、local control field、不正refをDB更新前に拒否し、`__proto__`等の利用者名を安全に自己round-tripする
- 端末全体OFF、event OFF、自動安全モードでは`PD-04`で定義したsplit固有部分のlegacy動作（`PD-14`の常時修正を含む）となり、オフラインだけではOFFにならない。BackupはローカルON／OFFを含めず、新規復元OFF・既存復元先状態維持となる
- 端末間同期・自動mergeを行わず、1イベント1主端末とpreview付き全置換、復元前退避案内が利用者向け文書と自動テストで固定される
- 必須Desktop／Mobile Chromium CIが成功し、safety flakyが0件で、WebKit advisoryの未review failureが0件である
- Desktop／Mobile Chromiumの自動browser、PWA、性能テストが成功する。特定OS・端末を正式保証済みと表記しない
- WebKit、iPhone、ペン、OS・実機固有挙動が自動テスト対象外であることを利用者向け文書へ明記する
- 15,000セル、15,000設定、30,000半領域、400商品、400売場、400訪問の全performance scenarioで非nullの絶対上限を満たし、5秒操作中のinput-to-next-paintとmemory解放条件も満たす
- PWA新旧世代、旧版／新版同時tab、versionchange blocked、QuotaExceeded、storage eviction、強制終了の試験が成功する
- remote availability、署名receipt、外部metrics、実イベントpilot、managed-device収集、source-bound証跡bundleが実装・完了条件・標準コマンドに存在しない
- 完全版XLSX 2.3、multipart、設定単独portable JSON、別日程・別地図コピー、意図的再訪が後続版として初版のUI、command、test gateから分離される

## 15. 標準検証コマンド

リポジトリ指定のNode 24.19.0／npm 11.19.0を使用する。次の自動テストscriptはFSMC-I0で`package.json`とCIへ追加し、存在しない間はFSMC-I0をExitできない。

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

通常CIでは同一runでbuildを1回作成し、browser／a11y／PWA自動テストへ再利用する。外部証跡bundle、clean-worktree receipt、managed-device artifactは作らない。

```powershell
npm ci
npm run quality
npm run test:qa-builds
npm run test:browser:required:prebuilt
npm run test:a11y:required:prebuilt
npm run test:fsmc:old-new
npm run test:fsmc:pwa-multiclient
npm run test:fsmc:local-control
npm run test:fsmc:visit-projection
npm run test:fsmc:backup-v1-v2
npm run test:fsmc:performance
npm run test:release-a-rollback
```

advisory WebKitは必須jobと分離する。

```powershell
npm exec -- playwright install webkit
npm run test:browser:webkit-advisory
npm run test:a11y:webkit-advisory
```

旧版互換、性能、ローカル制御、Backup、PWA世代混在は通常CIの自動テストとして合否判定する。実イベントpilot、実機収集、外部metrics、activation readiness、receipt builderのcommandは追加しない。
