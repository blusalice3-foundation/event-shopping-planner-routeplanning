# 実行列の配置ルール統一・実装記録

- 作業日: 2026-11-01（日本時間）
- 依頼プラン: D:/esp-placement-plan-20261101/docs/execution-placement-rules-remediation-plan-20261101.md
- 変更前の製品source: 19c7541175b2a60076807dd17469127d67f8407d
- 実装作業ツリー: D:/esp-placement-implementation-20261101
- 最新の製品修正: 7b26f135b78d2c8de285a38d366c3be63f810ff7。文書だけの後続コミット、製品・計測器・採取HEADを区別する。
- 最新の計測器修正: 7b26f135b78d2c8de285a38d366c3be63f810ff7。承認済み対象変更、文書座標の2stableと実hit、時計後の補正可視性確認、および失敗時または明示診断時だけの描画・座標記録を含む。製品修正のsourceと区別する。
- 状態: 製品実装、単体・統合試験、重点PWA確認を実施。標準completion全機能・全144性能条件、同条件の変更前後比較は未完了。保存測定位置の限定的な追加変更はユーザーが明示承認し、a861b39で計測器へ実装した。計画の完了判定、元作業ツリーへの反映はまだ行っていない。

## 実装した動作

| 決定    | 実装                                                                                                                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01/D07 | 確定所属・日付・優先度・正規化スペースによる共通の表示投影を、上流selector、リスト、範囲選択、地図、実行ナビ、Focusの実行順に接続した。確定未所属と所属確認待ちを区別する。                                                                                            |
| D02/D03 | 同スペース内は明示した本だけを並べ替える。実行列の別スペースへのD&Dは、移動元の同所属・同優先度・同日のスペース全体を移動する。候補内は既存の本単位操作を保つ。                                                                                                        |
| D04     | 合流する本は既存スペースの末尾へ追加し、元の訪問位置・本順を保つ。                                                                                                                                                                                                     |
| D05     | 異なるグループの位置からは正しい合流先またはグループ末尾へ案内する。有効位置へ操作して離すまで保存しない。スクロールだけで静止ポインター下へ案内先が来ても受理へ変えず、drop時も再hit-testする。新しい実入力では必要な同先再案内を行い、可視案内への重複要求を抑える。 |
| D06     | 移動元・日付で絞った実際の対象全員の所属・優先度を検証する。見出しの外部選択は集合で照合する。異所属・異優先度の列移動ボタンや購入操作を一律禁止しない。                                                                                                               |
| D08/D09 | PC/スマートフォンの＋から優先度を継承する。候補の混在時は明示選択を必須にし、他の入力を保つ。変更後のブロック・番号、選択優先度から保存先を計算する。                                                                                                                  |
| D10     | D&D・上下・列移動を凍結した配置計画と保存直前検証に接続した。関係する所属・訪問・境界の変更は該当移動を中止し、理由を上部に残す。古い配置案をI/O再試行へ送らない。                                                                                                     |
| D11     | 数量・価格・メモ、無関係な品目や遠いグループの変更で不要な中止をしない。最新内容、独立した移動、後続の選択操作を保つ。                                                                                                                                                 |
| D12     | 承認された異所属成功操作の一部だけを同所属の画面外スペースへ変更し、旧操作の混在拒否を機能試験に残した。保存測定位置の追加変更も明示承認後にa861b39で適用し、旧操作のafter専用拒否8件を追加した。                                                                      |

表示・再読込だけで保存配列を正規化しない。既存の訪問ID・保存形式・購入記録・履歴の現在値保護を維持する。Focusの保存済み訪問/再開キーも変更しない。同日・同地図セルまたは同スペースの所属共有・競合確認は既存resolverを使い、生のmanualHallIdから確定所属を推測しない。

## 既存動作と反応時間への配慮

- executionPlacement.tsに表示投影・配置境界・訪問内スロット操作をまとめた。内容だけの編集では準備済み順序を再利用する。
- hoverは準備済みグループ境界・案内先キャッシュを使う。論理行参照は既存の行モデルから必要時だけ用意し、余白の周辺行は実際の矩形を二分探索する。通常の買い物操作へ新しい全行割当を加えない。
- キャッシュに古い全品目・地図・履歴配列を保持しない。変更のないイベントでは過去10,000品目の配列コピーを避ける。
- 本の上下は本、見出しの上下はスペースを対象とする。本順は元のrawスロットへ適用し、先頭本を動かしても別訪問へ基本位置を譲らない。
- 実行列の未指定hitは、実際の行/見出し/内部余白と確認済み列空白を区別する。列空白は正規の列末尾、候補列の未指定hitは従来のENDとし、候補の本単位ソートを保つ。
- 案内線の位置基準は専用属性と低優先度CSSで保持する。Reactの遅延class更新で基準を失わず、解除時は以前の属性・別所有者を保つ。この位置基準の保持ではポインターごとのstyle/矩形読取を増やさない。
- ShoppingMoveReceiptで受付と保存完了を分ける。committed時だけ、その後の選択・範囲・日付/モード変更を照合して解除する。blocked/no-op/aborted/cancelledでは選択・範囲・ソートを消さない。
- 初めから存在する日付統合確認と、受付後に新たに変わった配置を区別する。ユーザーの取消はcancelled、確認token期限切れは中立な理由、実際の配置変更はabortedとし、誤った配置変更バナーを出さない。
- I/O失敗はreceiptを未確定のまま保留し、再試行成功はcommitted、破棄はcancelledとする。終端エラーの固有理由、実際のD10中止、世代失効を維持する。

## 最新の確認結果

補助関数・jsdom/保存hook・通常PWAを区別する。重点PWAは通常起動、公開UIによるバックアップ復元、公開画面操作、実IndexedDB確認を使う。合成D&D/touchイベントを物理端末の実機確認と読み替えない。

| 確認                                 | 結果・source・限界                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全Vitest                             | 2d08eef、3,784件通過・88件スキップ。280ファイル通過・1ファイルスキップ、85.22秒、exit 0。                                                                                     |
| 型・lint・依存構造・文字コード・書式 | 2d08eefですべて通過。文字コード1,171テキストはUTF-8/BOMなし、置換文字・文字化け・不自然な疑問符なし。                                                                         |
| 保存境界の重点確認                   | 4cb9926、関連5 suites 209件通過。取消/期限切れ、I/O再試行/破棄、部分中止、後続選択、最新内容保持を含む。                                                                      |
| 最新のブラウザー重点55件             | 4423f18、55通過・スキップ0・retry 0。held cleanup 3件、observer 39件、配置9件、＋4件。observerは計測器DOM/helperの試験で、全55件を通常PWAフローとは記載しない。               |
| 列空白・候補・混在拒否               | 後述の個別診断で列空白24件、候補ソート6件、実際の混在拒否4件の選択保持・raw/保存0・reloadを確認。別sourceの部分結果を単一全体runへ集計しない。                                |
| shopping独立診断                     | 4423f18、16条件・192主指標が各10回、公式verifier通過、65/100ms違反0。最悪中央値37.00ms・95%点45.40ms（500集中/地図/PC・back UI）。全144条件の完了や前後比較には使わない。     |
| range独立診断                        | 4423f18、20条件・80主指標が各10回、公式verifier通過、160/160ms違反0。最悪中央値51.05ms・95%点52.20ms（500 PC/full/long selectRange）。全144条件の完了や前後比較には使わない。 |
| 性能証拠の契約試験                   | 379件通過。証拠の検証器の確認であり、製品の全144条件の通過ではない。                                                                                                          |

shopping/range診断時の製品src/publicは8f8b0f1で、HEAD4423f18の後半は試験・文書のみだった。4cb9926の取消結果通知修正はその後のため、診断を最新sourceの新規採取へ読み替えない。ce007ccの全機能一括診断は4件目開始時にユーザー回答が到着し、条件確定の切替のため中断した。最終JSONはなく、観測した失敗header/retryは0。進捗から通過件数を作らない。382a7feの新計測器を固定し、標準runnerで全機能・全性能を独立実行する。

## 修正と診断の履歴

各runの元raw・当初合否・中断理由を保持する。部分結果や進捗行から全条件の成功を作らない。

| source/run           | 結果と後続対応                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ca6a094 functional   | 520件登録・83件目開始時にD11レビュー修正のため中断。最終JSONなし。確定通過件数は記載しない。                                                |
| 4b81082 functional   | 342通過・54スキップ・1失敗・123未実行。列の外側余白を先頭行と誤認した問題をa28478dで修正。                                                  |
| 79241f9 affected139  | 36通過・1失敗・102未実行。候補の未指定hitを近い行と解釈した問題を8f8b0f1で実行列だけへ限定。列空白24件は通過。                              |
| 8f8b0f1 affected139  | 45通過・1失敗・93未実行。選択を検証する行が画面外で未mountだったため、ddcfce2で同じ公開行を表示してから元のassertを行う試験準備だけを修正。 |
| ddcfce2 remaining115 | 60通過・1失敗・54未実行。no-opでも範囲解除を要求する旧期待を、計画6.4.2/6.4.7の保持契約へ4423f18で修正。beforeは元の期待を維持。            |
| 4423f18 remaining55  | 前記55件通過。過去prefixと足して520件の一括通過とは扱わない。                                                                               |

### 旧操作8条件の入力準備の診断

- 8900675の旧priority-after機能8件は4通過/4失敗、retry 0。ONの4件は正しい所属末尾・offset 0px・new-0の選択保持・mutation/readwrite/complete各0・raw/再読込不変を確認した。OFFの4件は60RAF内に入力点を画面内へ置けず、hover時計・D05入力・保存検証へ進めなかった。失敗を保存し、後段のdrag性能8件は開始しなかった。
- da7b2e9で失敗時だけの数値診断を追加し、150/native/OFFの1件を別runで再現した。1失敗/retry 0、最後の2frameはpoint (132, 1136.84375)、実card rect 971.84375〜1191.84375、viewport 1440×1000で同じだった。初回のretained slotはdetach、現在のcardはconnected。scrollY 16856/max 17096で240pxの余地があり、振動ではなく画面外で安定した状態だった。入力・時計開始前であることも記録した。
- e4065e0では既存60RAF内で元の入力点が画面外の時だけ、現在の同ID公開slot/targetを再取得してcenterへ表示する。古いdetach済みslotを再利用せず、画面内では追加scrollしない。上限60RAF・2stable・対象ID/edge・point式・dispatch・時計・終了点は維持する。強制mountや別対象への入力は追加しない。
- 外部の独立DOM検証は元8件を保持し、placeholder detach→実cardの位置変化の1件を追加して9件通過。旧da7は元8件通過後に新しい9件目だけ同60frame失敗を再現した。実PWA8件とdrag8件の修正後再測定は、固定sourceのbuild後に実施する。
- 上記の元report/画像/数値・rawのSHAと当初結果は別runとして保全する。補助検証通過を実PWA全8件や性能全144件の成功へ読み替えない。

### OFFの案内・連続入力の診断と修正

- 42a1809で旧priority-afterの機能8件は全通過（30.422秒、skip/retry/global error 0）。同sourceのdrag診断8件はON4通過/OFF4失敗、retry 0だった。inline正式response4件の28主指標は各10回・閾値超過0だが、32指標が欠けるため公式verifierは群失敗のまま保全した。inlineから保存した同bytes JSONは派生資料として原reportと対応付けた。
- bb7d993の部分数値診断は150/native/OFFとtouch/OFFの2失敗、18.266秒、retry/global error 0、通常timing証拠0。nativeの正対照priority-afterはY=944.84375/高さ1000でaccepted、その後a1-afterのY=625.84375はrejectedで正しいpriority/after案内だったが、ownerは17827.84375〜18047.84375・window scroll 0の画面外に残った。失敗後3RAF（44.3ms）も同じで、計測直後の単純な遅延だけではなかった。
- touchの直前正対照もY=944.84375で、端領域（高さ1000の下端100px）に入っていた。次の準備ではviewport点が105.84375→85.84375と動き、失敗後もwindow scroll 540→560→580→600が約16msごとに続いた。既存touchmoveの20px/16msスクロールは次の実入力/解除まで継続し、プログラムによる表示準備では止まらないことと整合した。元raw16ファイル・当初2失敗・失敗時contextを別runとして保持した。
- 86944f7では新しい実ポインター移動後に同じ案内先も再要求できるよう修正し、実ShoppingList Harnessのnative/touch2件で修正前のreveal1回/期待2回の失敗を再現してから通過した。静止・scroll/layout refresh・drop refreshでは再案内や自動受理をしない。
- 9d0351eでは、既に可視の同じ案内への連続入力で全行検索・request state更新を重ねないよう、実入力移動後の再拒否・同じ案内先に限って、対応する既存suggestion lineの接続/矩形を1回確認する。可視ならcacheを保ち、画面外・header/footer遮蔽・切断/不明なら再案内する。初回/別先/静止/refresh/acceptedでは追加矩形読取をしない。DOM参照は装飾解除時に解放し、大きいindexや全行検索を追加しない。
- 可視時の重複要求は旧869で2回期待/実4回の負対照2失敗を確認した。修正後は関連132件と全Vitest3,772件を通過した。これは要求回数と機能の確認であり、製品の速度改善・全性能合格を未測定で主張しない。
- 382a7feの準備では同frameのwindow scrollを加えた文書座標を2frame比較し、layout/mount移動とwindowだけの移動を区別する。最新viewport点が同owner/card/publicslotに実hitすることを確認し、既存a1-afterのa2までのspanを許容する。遮蔽/画面外は同IDの現在行へ表示し直す。上限60RAF・2stable・元point式・元event1回・時計を維持し、中間touchmoveやintervalの手動停止を追加しない。
- native等の生response（ms/status/guide/scroll）は書き換えない。新D05の最終案内は時計後の別correctiveVisibility観測（最大60RAF、読取だけ）でexact identity/offset/可視性と必要方向のscrollを検証する。元endpointで既に可視なら不要なscroll増加を要求しない。主指標数・終了点・保存/原子性・locality基準を維持する。
- 外部actual-callback検証は準備14件・時計後観測4件を通過した。旧bb7でactive-scroll/headerの負対照2失敗を保全している。現在の製品2d08eefと計測器382a7feでのPWA8件/drag8件の再採取、標準全5群、変更前後比較はこれからで、補助検証をその代用にしない。

### 遅延スクロールの取消と既表示行の保持

- 案内発行直後の保留RAF前に終了/取消する追加回帰で、native/touch2件とも、案内・clone・body lock解放と保存0・pin解放は成立していたが、80ms進行後にexact priority rowへのscrollIntoViewが1回走る失敗を再現した。
- f354794は補正reveal専有のAbortControllerを使い、終了/取消/leave/所有list登録解除、新しいreveal、accepted hoverで古い補正要求だけを取り消す。既存controllerのUI一時ScrollRequestにoptional signalを渡し、通常/retained/virtualの消費側で発行前/最終scroll前の確認と保留RAF取消・ID一致consume・listener解放を行う。普通navigationや新しい要求を古いabortで消さない3controlを含む関連164件が通過した。保存schema/workerは変更せず、ViewportContentのpin解除2RAFも維持する。
- source676e4c2のdrag診断はON4通過/OFF4失敗で、最後のrejected場面の更新countsは0だったが、開始時mountedにも存在した12keyの再mountで元locality条件に失敗した。前6場面は通過し、rejectedの後続mount全体/IOdelta/drop-saveは未到達だった。28利用可能主指標は各10回・閾値超過0、32指標欠測でverifierは群失敗を保全した。利用可能分の最大中央値59.10ms/95%点74.60msは部分診断であり、訂正sidecarと元値を保持して全群合格へ使わない。
- このprobeは初回hoverと2RAF後のcurrent React rootからmountedを採り、以後10回の正対照priority-after・a1-after・表示準備・時計後可視性観測までを数える。knownは履歴だがmountedは現在のfiberであり、今回の12keyを単なるknown履歴とは扱わない。個別のunmount時系列は元rawに無いため、全12件の経過を再現済みとは記載しない。
- 2d08eefは既存ViewportContent registryに最大2list-rootのgesture leaseを追加した。開始時に実activeな行と、その後visible/reveal等で実際にactivateした親group/子itemだけを操作中保持する。未表示行を強制activateせず、pointerごとの全subscriber走査や大きいindexを追加しない。開始/解除時のregistry走査と通常visibility更新の小さいflagで管理する。
- accepted hover/leaveで案内要求を取り消しても、行保持はgesture寿命まで続ける。clear/drop/cancel/source登録解除で全leaseを、target登録解除ではそのrootだけを解除し、focus/dialog/data-retain/requestedKeys/他leaseを再評価して通常の退避へ戻す。temporary pin解除2RAFとAbortSignalは別所有のまま保つ。
- 旧f354で既表示a2が最初の画面外IOで消えるnative/touch2失敗を確認し、修正後は同じcard参照・新訪問両列保持・未表示inactive・終了解除を検証した。Workspace4件とregistry3件の計7新回帰、関連6群248件を通過し、取消の2回帰も再確認した。独立read-onlyレビューでも具体的な寿命の欠陥は見つからなかった。
- 最新製品2d08eefは全Vitest3,784件/88スキップ、型・lint・architecture（361製品ファイル/1,804辺/例外0）・encoding・書式を通過した。実PWAのlocality/性能はこれから再採取する。元条件や計測器のnomount期待を緩めて成功を作らない。

追加レビューでは、無関係な別ホールの最後の品目の削除による不要な中止（499c9e2）、単独グループを元の有効境界へ戻すpreview/commandの不一致（e91675b）、既存グループの位置判定で実行中品目の有無へ過剰依存する問題（79241f9）も修正した。新規グループは現在の挿入境界、既存の位置指定は設定順上の関係、純粋合流・本順は実際の訪問構成を検証する。新しい所属競合や関係する設定順変更の中止は維持する。

## T01〜T18の確認対応

全組合せの物理端末試験ではない。通常PWA全体runや個別sourceの確認範囲、未実施を区別する。

| 対象     | 補助関数・jsdom/保存hookと通常PWA                                                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01/T02  | 境界・異所属/異優先度・静止案内gateを検証。PC/スマートフォン、ON/OFFの通常PWA案内・混在4件通過。                                                                                                                                 |
| T03/T04  | 明示本順、別訪問への全冊移動、分断rawスロットを検証。通常PWA本/スペース4件通過。                                                                                                                                                 |
| T05/T06  | 既存末尾・外部選択・候補明示対象を検証。個別PWAで一括合流、フィルター、折りたたみ、異所属拒否・選択保持を確認。                                                                                                                  |
| T07      | raw所属共有セル/同スペース/競合、確認待ちの編集接続を検証。PWA所属投影4件を確認。新D&D確認待ちの全PWA組合せは未実施。                                                                                                            |
| T08      | 有効末尾/次グループ直前、無効境界、本/スペース上下、no-opの選択/範囲/ソート保持を検証。列空白PWA24件と関連既存並べ替えを確認。                                                                                                   |
| T09/T10  | 画面外/保持行、最終hit、取消/日付/モード/世代/lock解放を検証。重点案内4件、既存PWAのleave/touchcancel/held cleanupを確認。                                                                                                       |
| T11〜T13 | planner/依存/保存hook/commandの部分中止・最新数量・後続選択・取消/期限切れ・非再試行を検証。既存PWAの保存失敗・日付統合確認も個別runで通過。新D10の全競合組合せを通常PWAで実施したとは記録しない。                               |
| T14/T15  | 優先度3種、混在選択、入力保持、文脈失効を検証。PC/スマートフォンPWA4件で同じ生成IDによる公開再試行・1件保存・最終入力・既存本不変を確認。                                                                                        |
| T16      | 地図通常/前後/batch、優先度・所属・日付編集、bulk/列ボタンの原子性を検証。既存PWAの関連編集/購入は途中runで通過。全PWA組合せは未実施。                                                                                           |
| T17      | 削除、現在値を保つUndo/Redo、訪問取消、新規/削除/日付移動本、ホール順を検証。既存PWAのOP08/09・削除・ホール順保存を途中runで通過。                                                                                               |
| T18      | 共通selector/route/navと保存ID不変を検証。通常PWA1件でlist・地図の訪問list・navigator順/IDと物理eventLists/execute/checkpoint不変・reloadを確認。canvasの画素上の描線順は公開DOMから直接確認できず、route helper試験と区別する。 |

## 性能条件と明示承認された追加変更

[fixture変更一覧](execution-placement-fixture-changes-20261101.md)に旧条件・新条件・負荷・期待動作の対応を記録した。

- 必須144ケース・530主指標・46保存補助、completion各10回/pr各2回、performance-samples-2026-10-26を維持する。
- shoppingは150/500品目16条件・各6操作、中央値65ms/95%点100ms。range20・drag8・transfer100は中央値/95%点160ms、dnd-selection-rendering-160-160-2026-10-28を維持する。
- 地図/過去10,000品目、入力/DOM/実フレーム/次操作、ウォームアップ、性能retry 0、保存原子性/整合性を維持する。1,500品目shoppingは任意診断のままとする。
- 追加変更案は、drag8条件の保存測定を「通常Aのnew-iをpriorityの直後」から有効な「通常Aのa1の直前」へ変更するもの。旧操作は正しいD05拒否となるため、旧操作の拒否・保存0・配列/選択保持を8条件の機能試験に残す。品目数・負荷・回数・時計・終了点・閾値は維持し、同じ新計測器で変更前後を再採取する。
- 計画9.2の「それ以外の条件へ例外を広げない」に関わるため待機し、ユーザーの明示回答「有効な同グループ位置で測り直す（推奨）」を受けてa861b39で適用した。承認sourceはrequest_user_input_async call_ffc847ef15264588957ed8343692485d。経過時間や初期選択は承認扱いにしていない。
- before準備ツリーはD:/esp-placement-before-20261101。src/publicを19cのまま保ち、382a7feのspec/fixture文書だけを同期・buildした（準備HEAD958379b8ff7e75fb94247a0cb467adca6aa5ffa7）。公式25ファイルのinstrumentPatchと18ファイルのfixtureSourcesの全file/aggregate hashが同じであることを確認してから独立採取する。準備用checkout HEADと製品src/publicの不変証明を別に記録する。
- 最初のbefore並列起動失敗と、別before標準run（2026-10-31T18-33-58-753Z-b46d408b-e5a8-4325-b3e8-14062608196d）の中断を保持する。後者の機能453通過/54スキップ、shopping正式JSON6件は別build重複を排除できない診断であり、比較/完了証拠に使わない。
- 初回after標準runの旧カード上下fixture失敗、drag4d4f791/e65602a/0e0e8cb各8件、695756d/b0759d4各1件の診断失敗を保持する。正式drag timing JSONは0件で、部分成功から全8/144条件成功を作らない。
- 画面外のY約19,060pxへの旧入力は、同じ公開対象を時計開始前に表示する測定準備へ修正した。表示後も旧priority直後はD05拒否となる。この旧操作をafter専用機能8件として保全し、新成功操作の時計・元の保存pollを終了した後で独立raw期待も検証する。OFFの旧拒否操作も、beforeのguideなしとafterの正しい末尾案内を区別する。そこで見つかった案内線3,800pxのずれはd42482bの製品修正により実座標offset 0pxを確認し、成功位置変更とは区別した。
- 旧raw・当初合否・中断runを書き換えず、成功分だけの補充・profile混在を行わない。2026-10-28の500touch同列移動75.65/77.50ms→77.60/82.40msの受容も保持し、今回や他の相対差の受容へ拡張しない。

## 証拠・文字コード・元作業の保全

- 実装/重点PWA/診断: D:/esp-placement-feature-evidence-20261101
- before中断/準備: D:/esp-placement-before-evidence-20261101
- after build/標準run/作業状態: D:/esp-placement-after-evidence-20261101
- 元の証拠索引とsource別の補遺は、参照raw/ログのSHA不変を確認して別ファイルに保存した。元索引を新しい成功へ上書きしない。
- shopping診断: shopping-completion-diagnostic-4423f18-attempt1、run ID placement-shopping-diagnostic-20261101-4423f18-attempt1。range診断: range-completion-diagnostic-4423f18-attempt1、run ID placement-range-diagnostic-20261101-4423f18-attempt1。どちらも外側の分類はdiagnosticOnly: true / acceptanceMeasurement: false。
- 元作業ツリーは19cのまま、既存の未追跡資料を保護した。独立したクリーンな作業ツリーで実装した。
- 既存ファイルのUTF-8/BOM/改行を確認して保存し、日本語代表行を再読込した。2d08eefの全体encoding検査は1,171テキスト、LF 1,167/CRLF 3/改行なし1、代表文字列「ユーザー登録」182件・「エラーが発生しました」74件、異常0。
- 既存724ファイルの事前manifestと2d08eefを再読込比較し、BOM/改行種別/U+FFFDの異常0。疑問符数が変わった29ファイルについて、日本語を含む追加行6行はすべてTypeScriptのoptional/conditional演算子で、文字化けはなかった。対象724ファイル内の代表文字列は167/69件で、全1,171ファイルの182/74件とは対象範囲を区別する。最終反映前にも必要な再確認を行う。元作業ツリー反映・全性能受入・同条件前後比較は未完了。

## 標準採取の中断・失敗と下端スクロールの追加確認

- ec6b362の標準attempt1（run ID 2026-11-01T01-36-59-490Z-cba85cae-0db1-48b5-b78a-7c17574e0e33）は機能474通過/54スキップ後、shopping採取中の全機能report解析が測定へ重なった可能性を排除できず中断した。製品失敗や時間超過とは区別し、元raw・checkpointを保持した。以後の採取中監視はstdoutと小さい公式checkpointだけに限定し、report解析・hash照合は全採取終了後に行う。
- 同sourceの独立attempt2（run ID 2026-11-01T02-17-58-647Z-907a45f9-896f-4d96-a85b-31ffd684abed）は機能473通過/1flaky/54スキップ、shopping16通過、range20通過、drag7通過/1失敗、transfer未実行で終了した。flakyは初回page.gotoのERR_NO_BUFFER_SPACEでUI前に失敗し、既存CIの機能retryで通過したもの。性能retryは0である。全144条件の完了として扱わない。
- 失敗は500品目/native/grouping OFFの拒否hoverにおける新規3行のmount検出であり、D05拒否・正しい案内・offset・最終可視性・方向、既存行の再描画/再mountなしは通過した。probeの各2件は外側と内側のFiberが同一品目keyに対応し得るため、DOMの二重mountとは断定しない。243元ファイルのhashと未変更を外部outcomeに保全した。
- a96cfedの明示診断1条件は11.011秒で通過したが、該当3行が開始時からmount済みであり、元の間欠失敗の解消証拠にはしない。10回すべての有効位置への入力がY約945〜953px（画面高1,000px）となり、nativeの下端帯で毎回20pxスクロールした。案内線は約994〜1,000px、最終スクロール位置から上限まで48pxあった。diagnosticOnly: true / acceptanceMeasurement: falseの独立記録として保持した。
- この実数を受け443f873では、D05の補正案内専用callbackの整列をnearestからcenterへ変更した。通常の検索・フォーカス移動、対象ID/edge、入力点の75%式、gesture、fixture、時計、終了点、閾値、10回、描画局所性の期待は変更していない。関連82試験・型検査・lint・文字コード・formatは通過した。画面末尾の上限を含めた実際の配置、全8条件の局所性、transfer100、標準全条件と同条件before比較は引き続き実測待ちである。
- 外部証拠はD:/esp-placement-after-evidence-20261101/standard-completion-ec6b362-attempt2-outcome.json、同raw-hashes.json、D:/esp-placement-feature-evidence-20261101/locality-context-diagnostic-a96cfed-500-native-off/diagnostic-outcome.jsonおよびgeometry-summary.jsonを参照する。既存runの成否・基準・rawを上書きしていない。

## 表示通知の反映タイミングの追加修正

- 製品443f873の候補c4a7a34では、全単体3,784通過/88スキップ、全静的・文字コード・書式・release-aビルド・配信cap一致を確認した。通常フラグのdrag8診断は全件通過、60主指標各10回・時間超過0、52区間の描画/IO局所性と保存の独立期待も通過した。最大中央値64.40ms/95%点81.70msであり、全144条件の完了証拠とは区別する。
- 直後の独立した明示座標診断500/native/OFFは新規4行のmount検証で失敗した。初回有効位置への入力はY904.84375で8pxスクロールして上限58404に達し、後続9回はY896.84375でスクロール0だった。center単独で間欠問題を解消したとは扱わない。初期reset時は4行ともmounted=false/known=trueだが、その時の座標・active・接続は未記録のため8pxを行高の変化と断定しない。
- 診断フラグの追加DOM読取は10標本とmount snapshotの取得後だけであり、その後段読取が失敗済みsnapshotへmountを追加したとは説明できない。フラグ追加前のec6の失敗も独立した記録として保持する。
- ViewportContentの既存IO callbackは表示範囲へ入った行のsetActivatedを非同期enqueueするため、補正スクロール後の通知から実commitが後続操作へ遅れる経路があった。7534b793ではgesture lease中に届いたIO entriesだけを既存flushSyncで1batch同期反映する。通常scrollは従来enqueue、未交差行の強制描画・全registryの座標走査・追加RAF・consume時刻・入力/測定条件の変更はない。document共通registryのため、同時に存在する未lease列のentriesも同batchのcommit timingに含まれ得る。
- lease中の通知直後DOM期待は旧c4で失敗し、修正後は通過した。leaseなしの従来非同期対照、未交差行の非表示、lease解放後の復帰も確認し、関連6suite250件・型・lint・encoding・formatを通過した。IO通知自体の配送遅れまでは保証しない。実ブラウザーの間欠局所性、全性能群と前後比較は引き続き採取待ちであり、transferは開始していない。
- 外部証拠はD:/esp-placement-feature-evidence-20261101/drag-completion-diagnostic-c4a7a34-center-attempt1およびlocality-context-diagnostic-c4a7a34-center-500-native-off。双方ともdiagnosticOnly: true / acceptanceMeasurement: falseで元rawとhashを保持し、部分成功を完了へ合算しない。比較用ツリー2349a585ではa96の計測器25/fixture18の全file/aggregate hash一致と製品src/public対19c差分0を確認した。新beforeの採取は全after成功後に行う。

## 移動後の選択解除とドラッグ開始時の不要案内の修正

- 7534b793の候補4db1383は全単体3,786通過/88スキップ、全静的・文字コード・書式・release-aビルド・配信cap一致を確認した。通常フラグのdrag8診断を独立2runで各全件通過し、各60主指標10回・基準超過0、52局所性区間・8保存配列も通過した。別の500/native/OFF座標診断も通過し、既知3行は開始時mount済みだった。同診断では初回8pxの端スクロールが残り、後続9回は0だったため完全な消失とは書かない。成功診断を全144条件へ合算しない。
- 同sourceのtransfer100診断は100登録・5開始後、3件の失敗headerを確認して04:50:47.922UTCまでにowned processを停止し、子process0を確認した。1件は失敗headerなしで次caseへ進行、1件中断、95件未開始である。最終report/HTMLは生成されず、厳密な最終passed/failed/global/retry集計はunknownとして保持した（設定retry0、観測retry header0）。123元ファイルのSHA再照合と別中断sidecarを保存し、元wrapperのrunning状態を書き換えていない。
- candidate→execute responseでは配置・content・durable保存・順序は全10回通過したが、時計後の独立5秒pollでも移動済みc1/c2の選択が残った。drop後、保存を待たず実checkboxのe0を操作する元の次操作検証が、whole-selection revisionを変え、commit後の選択解除全体を止めていた。receipt settleとtransferred IDsの戻り値欠落は今回原因ではなかった。
- execute→candidate response/frameの失敗は、frame本測定や保存後ではなく共通warmupのdrop前prepareNextInputで固定c0が画面外になったものだった。元source e0自身へのhoverでは、移動品目を除いたlayoutにe0が存在せず、無効境界としてD05が実行列末尾を案内し得た。d910603では実際の移動対象自身へのhoverだけをprivate noopで扱い、所有する案内を取消し、selfdropはmove portも誤拒否表示も出さない。非移動の同スペースbookへのD02は維持した。旧4dbでnative/touch×grouping ON/OFFの4回帰がscroll1/期待0で失敗し、修正後は新6件を含む関連144件と静的検査を通過した。
- 131e1c4bではuseListInteractionStateに、受理時のselected∩moved IDsだけを追跡する小さい消費ownerを追加した。ユーザーがそのIDを後から操作すると消費権を外すため、別IDのe0操作はc1/c2解除を妨げず、c1のoff→on再選択は保護する。committedで未操作IDだけを最新Setから消費し、abort/cancel/context失効では解除せず追跡を解放する。unmountではlayout cleanupで全ownerを無効化する。pendingなしは即returnし、恒久的なID履歴mapは追加していない。
- Appからcommandへのoptional構造portだけを追加し、range/sortの既存whole revision guardとportなしfallbackは維持した。drag/列移動ボタンそれぞれの後続別ID・ABA・abort・cancel・context・unmount、およびhookの全選択入口・並行owner・二重解放を19新ケースで検証した。旧d910 consumerの実hook負controlはc1/c2/e0残留で失敗し、修正後はe0だけを残した。関連7suite309件・型・lint・architecture・encoding・formatを通過し、独立レビューでも具体的な問題はなかった。
- 計測器a96cfedの25/18ファイル、fixture、入力gesture、時計・終了点、回数、閾値、保存schema・receipt形式は今回変更していない。外部証拠はD:/esp-placement-feature-evidence-20261101/drag-completion-diagnostic-4db1383-iosync-attempt1、同attempt2、locality-context-diagnostic-4db1383-iosync-500-native-off、transfer-completion-diagnostic-4db1383-attempt1。修正後の元失敗3条件、transfer100全条件、標準全群と同条件before比較は引き続き未完了である。

## 候補列の保存配列の配置枠を維持する修正

- 製品131e1c4の候補ead931eでは全単体3,811通過/88スキップ、全静的・encoding・format・release-aビルド・配信cap一致を確認した。元失敗3条件を同じ公式spec/tagからexact3登録で選んだ独立completion診断は1通過/2失敗、retry0/global0、30.545秒で完走し子process0だった。candidate→execute responseは10回すべて選択の独立postconditionを通過し、旧c1/c2残留は再発しなかった。
- execute→candidate response/frameは旧warmupの画面外c0を越え、保存後の全raw順の独立期待で失敗した。候補内の相対順とexecute順が同じでも、既存契約は移動元枠と候補枠へ候補順を再充填し、他日・残存executeのraw位置を保つ。期待prefixはc0/e0/e3…、実際はe3…e249/c0/e0/e1/e2…だった。partial7主/2保存のうち3主/1保存だけが各10回記録され、逆方向4主/1保存は後段検証でappend前に止まり欠測である。34元rawをSHA保全し、全100条件の成功へ流用していない。
- computeMoveItemの候補側提案自体は既存slot契約どおりだったが、保存plannerのplacementBaseline経路がeffective IDsだけを全rawから抜差しし、提案に含まれる他の候補IDの枠移動を再現しなかった。変更がないbaselineでも起きるため、D11を理由に提案の既存意味を捨てる根拠にはならない。reverse期待の関連3fileは元19cと完全一致し、D12のfixture変更許可対象でもない。
- 71bd5f54ではtarget=candidateかつplacementBaselineのeventList再適用だけを、最新の当日candidate∪moving subsequenceへ既存effective-order replayを適用し、その結果を最新rawの同じ対象枠へ充填する処理にした。既存sameDay・最新execute所属を使い、長さ・一意性・ID集合を検証する。古いsnapshotの内容/全順序は採用せず、他日・残存execute枠、無関係な最新insert/delete/order/content/列所属を保持する。実行列のreplay、配置依存guard、receiptは変更していない。
- 旧ead/131eの実行→候補と候補内のraw枠2回帰は失敗し、修正後は通過した。追加2件で最新の無関係変更も確認し、関連7suite313件と型・lint・architecture・encoding・formatを通過した。root/saveの独立レビューに具体的な問題はなかった。実装2fileはUTF-8/BOMなし/LF/U+FFFDなしを維持した。計測器・fixture・gesture・時計・終了点・閾値・回数・独立期待は変更していない。全検査後の元3条件再診断、transfer100、標準全群・同条件before比較は引き続き未完了である。
- 部分診断の外部証拠はD:/esp-placement-feature-evidence-20261101/transfer-failed-three-diagnostic-ead931e-attempt1。元の成否・欠測・元rawを保全し、修正後の別runでのみ再確認する。

## 有効な同順D&D終了時の範囲表示と既存試験の整合

- 製品71bd5f54の候補4f4d0e5は全単体3,815通過/88スキップ、全静的・文字コード・書式・release-aビルド・配信cap一致を確認した。元失敗3条件の独立再診断は全件通過、7主/2保存が各10回、逆raw配置枠と選択postcondition・旧warmup位置・実frameを通過した。この部分成功を全100条件へ流用していない。
- 同候補のtransfer全100診断は96通過/4失敗、skip/notrun/retry/globalはいずれも0、31分32.354秒で完走し子process0だった。100keysを照合し、198主のうち192が各10回・6欠測、46保存補助はすべて各10回だった。収集238系列の中央値/95%点をrawから再計算して一致し、主指標の基準超過は0、最大中央値98.75ms・最大95%点112.24msだった。4欠測caseが残るため公式verifierはFAILとして保持した。5,658元ファイルのSHAを保全し、96成功を全100/144成功へ変更していない。
- 失敗はterminal native/touch noop response/frameの4条件だった。これはselftargetではなく、選択e0/e1/e2を隣接する非移動e3の直前へ戻す合法な同順序dropである。元順・3checked・guide/clone消失は成立したが、range endpointsが5個残り、元の終了条件0個を満たさず15秒で失敗した。bodylock/sourceInteractiveは失敗記録に無くunknownとし、資源解放不良とは断定していない。
- 4423f18では、計画6.4.2の保存前中止の範囲保全と6.4.7のボタン無操作保護を合法な同順D&D完了にも広げて解釈し、held touch機能3件をafterのみ範囲保持へ変更していた。同じ操作に対し元の性能終了条件0個と矛盾し、range保持を要求するユーザー明示仕様も確認されなかったため、この解釈を訂正した。チェック選択を保持しrange表示だけ終了する元19cの正常動作へそろえ、4423の過去変更・rawは保持する。
- 7b26f135ではhandleMoveItemの有効D&D receipt.noop分岐だけclearRangeSelectionして終了する。checkbox/Set identity・順序・sort・data・保存・owner・非同期completionは変更しない。blocked/no result/private自己hover/ボタンNoOpは従来の保護を保つ。旧4f実hookは合法e3-beforeでrange残留の負controlが失敗し、修正後はrange null/3checked/sortとdata不変を通過した。合法同順単体3件のrange期待だけを合わせ、関連8suite315件と全静的検査・独立reviewを通過した。
- held touch機能3layoutは両phaseとも元のrange0へ戻し、4423で強化した全5品目のチェック一致・CDP入力・clone消失時opacity/操作可能性・保存順は維持する。性能loop・gesture・fixture・時計・終了点・基準・回数・terminal期待には差分がない。whole specが公式hash対象のため、25instrument aggregateは2b63bdbcbcc75580aa7b2447f4c395d6e0eef46838d7111fe9eee73497533dd1、18fixture aggregateは0c7e4de08d3b1fb40ee190e94c85a90cf5e1c4d75cee40d4788e1da76c23b8c6へ変わる。同じspec/fixture文書を比較用へexact同期し、元製品src/public19c不変を再確認してから新しい前後採取に用いる。
- 外部証拠はD:/esp-placement-feature-evidence-20261101/transfer-failed-three-diagnostic-4f4d0e5-attempt1、transfer-completion-diagnostic-4f4d0e5-attempt1、valid-dnd-noop-range-4f4d0e5。全検査後、held機能3件とterminal noop4件を独立診断し、その後に新sourceの通常全5群・144条件を採取する。旧96成功と新4成功を合算しない。前後比較・元作業ツリー反映を含む完了判定は引き続き未実施である。
