# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: shopping-cross-column-drag.spec.ts >> OFF selection rejects reversed hall buckets before drop: touch
- Location: tests\browser\shopping-cross-column-drag.spec.ts:1005:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "rejected"
Received: "accepted"
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e7]:
          - heading "列間ドラッグ検証" [level=1] [ref=e8]
          - button "候補ブロックを番号で並べ替え" [ref=e9] [cursor=pointer]
          - button "ホール定義（ブロック割当）" [ref=e12] [cursor=pointer]
          - button "ホール間移動順序" [ref=e15] [cursor=pointer]
          - button "表示項目の設定" [ref=e19] [cursor=pointer]
          - generic [ref=e20]:
            - button "📝" [ref=e21] [cursor=pointer]
            - button "🏃‍♂️" [ref=e22] [cursor=pointer]
            - button "🔍" [ref=e23] [cursor=pointer]
        - generic [ref=e24]:
          - generic [ref=e25]:
            - button "ナンバーで昇順に並び替え" [ref=e26] [cursor=pointer]
            - button "選択を解除" [ref=e29] [cursor=pointer]
          - button "選択したアイテムを実行列に移動 (2件)" [ref=e32] [cursor=pointer]
      - generic [ref=e34]:
        - button "イベント一覧" [ref=e35] [cursor=pointer]
        - button "1日目4" [ref=e36] [cursor=pointer]
        - button "アイテム追加" [ref=e37] [cursor=pointer]
        - generic [ref=e38]:
          - textbox "検索..." [ref=e39]
          - button "次を検索" [disabled] [ref=e40]
    - main [ref=e41]:
      - generic [ref=e43]:
        - generic [ref=e44]:
          - generic [ref=e45]:
            - generic [ref=e46]:
              - heading "実行リストアイテム" [level=2] [ref=e47]
              - button "スペース別" [ref=e49] [cursor=pointer]
            - paragraph [ref=e50]: 実行対象として選択中のアイテムを管理します。
          - list "買い物リスト" [ref=e51]:
            - status: 表示した訪問境界へ移動します。
            - listitem "Aホール 1件" [ref=e53]:
              - generic [ref=e54]:
                - generic [ref=e55]:
                  - generic [ref=e58]: Aホール
                  - generic [ref=e59]: 1件
                - list "Aホールの項目" [ref=e60]:
                  - listitem "A01 a1 ユーザー登録" [ref=e62]:
                    - generic [ref=e64]:
                      - generic [ref=e65]:
                        - generic [ref=e66]: "1"
                        - checkbox "Select item a1 - ユーザー登録" [ref=e67]
                        - button "上に移動" [disabled] [ref=e68]
                        - button "下に移動" [ref=e78] [cursor=pointer]
                        - button "保護なし" [ref=e81] [cursor=pointer]: 🔓
                      - generic [ref=e82]:
                        - generic [ref=e83]:
                          - generic [ref=e84]: 1日目
                          - generic [ref=e85]: A-01
                          - button "a1" [ref=e86] [cursor=pointer]
                        - button "ユーザー登録" [ref=e89] [cursor=pointer]
                        - textbox "利用者メモ" [ref=e93]: エラーが発生しました
                      - generic [ref=e94]:
                        - 'button "Current status: 未購入. Click to change." [ref=e95] [cursor=pointer]':
                          - generic [ref=e98]: 未購入
                        - generic [ref=e99]:
                          - generic [ref=e100]: 数量
                          - combobox "購入予定数量" [ref=e101]:
                            - option "1" [selected]
                            - option "2"
                            - option "3"
                            - option "4"
                            - option "5"
                            - option "6"
                            - option "7"
                            - option "8"
                            - option "9"
                            - option "10"
                            - option "11"
                            - option "12"
                            - option "13"
                            - option "14"
                            - option "15"
                            - option "16"
                            - option "17"
                            - option "18"
                            - option "19"
                            - option "20"
                        - generic [ref=e102]:
                          - generic [ref=e103]: 購入金額
                          - generic [ref=e104]: ¥
                          - combobox "購入金額" [ref=e105]:
                            - option "価格未定"
                            - option "0"
                            - option "100"
                            - option "200"
                            - option "300"
                            - option "400"
                            - option "500" [selected]
                            - option "600"
                            - option "700"
                            - option "800"
                            - option "900"
                            - option "1,000"
                            - option "1,100"
                            - option "1,200"
                            - option "1,300"
                            - option "1,400"
                            - option "1,500"
                            - option "1,600"
                            - option "1,700"
                            - option "1,800"
                            - option "1,900"
                            - option "2,000"
                            - option "2,100"
                            - option "2,200"
                            - option "2,300"
                            - option "2,400"
                            - option "2,500"
                            - option "2,600"
                            - option "2,700"
                            - option "2,800"
                            - option "2,900"
                            - option "3,000"
                            - option "3,100"
                            - option "3,200"
                            - option "3,300"
                            - option "3,400"
                            - option "3,500"
                            - option "3,600"
                            - option "3,700"
                            - option "3,800"
                            - option "3,900"
                            - option "4,000"
                            - option "4,100"
                            - option "4,200"
                            - option "4,300"
                            - option "4,400"
                            - option "4,500"
                            - option "4,600"
                            - option "4,700"
                            - option "4,800"
                            - option "4,900"
                            - option "5,000"
                            - option "5,100"
                            - option "5,200"
                            - option "5,300"
                            - option "5,400"
                            - option "5,500"
                            - option "5,600"
                            - option "5,700"
                            - option "5,800"
                            - option "5,900"
                            - option "6,000"
                            - option "6,100"
                            - option "6,200"
                            - option "6,300"
                            - option "6,400"
                            - option "6,500"
                            - option "6,600"
                            - option "6,700"
                            - option "6,800"
                            - option "6,900"
                            - option "7,000"
                            - option "7,100"
                            - option "7,200"
                            - option "7,300"
                            - option "7,400"
                            - option "7,500"
                            - option "7,600"
                            - option "7,700"
                            - option "7,800"
                            - option "7,900"
                            - option "8,000"
                            - option "8,100"
                            - option "8,200"
                            - option "8,300"
                            - option "8,400"
                            - option "8,500"
                            - option "8,600"
                            - option "8,700"
                            - option "8,800"
                            - option "8,900"
                            - option "9,000"
                            - option "9,100"
                            - option "9,200"
                            - option "9,300"
                            - option "9,400"
                            - option "9,500"
                            - option "9,600"
                            - option "9,700"
                            - option "9,800"
                            - option "9,900"
                            - option "10,000"
            - listitem "Bホール 1件" [ref=e107]:
              - generic [ref=e108]:
                - generic [ref=e109]:
                  - generic [ref=e112]: Bホール
                  - generic [ref=e113]: 1件
                - list "Bホールの項目" [ref=e114]:
                  - listitem "B02 b1 ユーザー登録" [ref=e116]:
                    - generic [ref=e118]:
                      - generic [ref=e119]:
                        - generic [ref=e120]: "1"
                        - checkbox "Select item b1 - ユーザー登録" [ref=e121]
                        - button "上に移動" [ref=e122] [cursor=pointer]
                        - button "下に移動" [disabled] [ref=e132]
                        - button "保護なし" [ref=e135] [cursor=pointer]: 🔓
                      - generic [ref=e136]:
                        - generic [ref=e137]:
                          - generic [ref=e138]: 1日目
                          - generic [ref=e139]: B-02
                          - button "b1" [ref=e140] [cursor=pointer]
                        - button "ユーザー登録" [ref=e143] [cursor=pointer]
                        - textbox "利用者メモ" [ref=e147]: エラーが発生しました
                      - generic [ref=e148]:
                        - 'button "Current status: 未購入. Click to change." [ref=e149] [cursor=pointer]':
                          - generic [ref=e152]: 未購入
                        - generic [ref=e153]:
                          - generic [ref=e154]: 数量
                          - combobox "購入予定数量" [ref=e155]:
                            - option "1" [selected]
                            - option "2"
                            - option "3"
                            - option "4"
                            - option "5"
                            - option "6"
                            - option "7"
                            - option "8"
                            - option "9"
                            - option "10"
                            - option "11"
                            - option "12"
                            - option "13"
                            - option "14"
                            - option "15"
                            - option "16"
                            - option "17"
                            - option "18"
                            - option "19"
                            - option "20"
                        - generic [ref=e156]:
                          - generic [ref=e157]: 購入金額
                          - generic [ref=e158]: ¥
                          - combobox "購入金額" [ref=e159]:
                            - option "価格未定"
                            - option "0"
                            - option "100"
                            - option "200"
                            - option "300"
                            - option "400"
                            - option "500" [selected]
                            - option "600"
                            - option "700"
                            - option "800"
                            - option "900"
                            - option "1,000"
                            - option "1,100"
                            - option "1,200"
                            - option "1,300"
                            - option "1,400"
                            - option "1,500"
                            - option "1,600"
                            - option "1,700"
                            - option "1,800"
                            - option "1,900"
                            - option "2,000"
                            - option "2,100"
                            - option "2,200"
                            - option "2,300"
                            - option "2,400"
                            - option "2,500"
                            - option "2,600"
                            - option "2,700"
                            - option "2,800"
                            - option "2,900"
                            - option "3,000"
                            - option "3,100"
                            - option "3,200"
                            - option "3,300"
                            - option "3,400"
                            - option "3,500"
                            - option "3,600"
                            - option "3,700"
                            - option "3,800"
                            - option "3,900"
                            - option "4,000"
                            - option "4,100"
                            - option "4,200"
                            - option "4,300"
                            - option "4,400"
                            - option "4,500"
                            - option "4,600"
                            - option "4,700"
                            - option "4,800"
                            - option "4,900"
                            - option "5,000"
                            - option "5,100"
                            - option "5,200"
                            - option "5,300"
                            - option "5,400"
                            - option "5,500"
                            - option "5,600"
                            - option "5,700"
                            - option "5,800"
                            - option "5,900"
                            - option "6,000"
                            - option "6,100"
                            - option "6,200"
                            - option "6,300"
                            - option "6,400"
                            - option "6,500"
                            - option "6,600"
                            - option "6,700"
                            - option "6,800"
                            - option "6,900"
                            - option "7,000"
                            - option "7,100"
                            - option "7,200"
                            - option "7,300"
                            - option "7,400"
                            - option "7,500"
                            - option "7,600"
                            - option "7,700"
                            - option "7,800"
                            - option "7,900"
                            - option "8,000"
                            - option "8,100"
                            - option "8,200"
                            - option "8,300"
                            - option "8,400"
                            - option "8,500"
                            - option "8,600"
                            - option "8,700"
                            - option "8,800"
                            - option "8,900"
                            - option "9,000"
                            - option "9,100"
                            - option "9,200"
                            - option "9,300"
                            - option "9,400"
                            - option "9,500"
                            - option "9,600"
                            - option "9,700"
                            - option "9,800"
                            - option "9,900"
                            - option "10,000"
        - generic [ref=e160]:
          - generic [ref=e161]:
            - heading "候補アイテム" [level=2] [ref=e162]
            - paragraph [ref=e163]: このリストから選択したアイテムを実行リストへ移動します。
            - generic [ref=e164]:
              - generic [ref=e165]: "ブロックでフィルタ:"
              - generic [ref=e167]:
                - button "A" [ref=e168] [cursor=pointer]
                - button "B" [ref=e169] [cursor=pointer]
          - list "買い物リスト" [ref=e170]:
            - listitem "A04 y ユーザー登録" [ref=e172]:
              - generic [ref=e174]:
                - generic [ref=e176]:
                  - checkbox "Select item y - ユーザー登録" [checked] [ref=e177]
                  - button "上に移動" [disabled] [ref=e178]
                  - button "下に移動" [ref=e188] [cursor=pointer]
                  - button "保護なし" [ref=e191] [cursor=pointer]: 🔓
                - generic [ref=e192]:
                  - generic [ref=e193]:
                    - generic [ref=e194]: 1日目
                    - generic [ref=e195]: A-04
                    - button "y" [ref=e196] [cursor=pointer]
                  - button "ユーザー登録" [ref=e199] [cursor=pointer]
                  - textbox "利用者メモ" [ref=e203]: エラーが発生しました
                - generic [ref=e204]:
                  - 'button "Current status: 未購入. Click to change." [ref=e205] [cursor=pointer]':
                    - generic [ref=e208]: 未購入
                  - generic [ref=e209]:
                    - generic [ref=e210]: 数量
                    - combobox "購入予定数量" [ref=e211]:
                      - option "1" [selected]
                      - option "2"
                      - option "3"
                      - option "4"
                      - option "5"
                      - option "6"
                      - option "7"
                      - option "8"
                      - option "9"
                      - option "10"
                      - option "11"
                      - option "12"
                      - option "13"
                      - option "14"
                      - option "15"
                      - option "16"
                      - option "17"
                      - option "18"
                      - option "19"
                      - option "20"
                  - generic [ref=e212]:
                    - generic [ref=e213]: 購入金額
                    - generic [ref=e214]: ¥
                    - combobox "購入金額" [ref=e215]:
                      - option "価格未定"
                      - option "0"
                      - option "100"
                      - option "200"
                      - option "300"
                      - option "400"
                      - option "500" [selected]
                      - option "600"
                      - option "700"
                      - option "800"
                      - option "900"
                      - option "1,000"
                      - option "1,100"
                      - option "1,200"
                      - option "1,300"
                      - option "1,400"
                      - option "1,500"
                      - option "1,600"
                      - option "1,700"
                      - option "1,800"
                      - option "1,900"
                      - option "2,000"
                      - option "2,100"
                      - option "2,200"
                      - option "2,300"
                      - option "2,400"
                      - option "2,500"
                      - option "2,600"
                      - option "2,700"
                      - option "2,800"
                      - option "2,900"
                      - option "3,000"
                      - option "3,100"
                      - option "3,200"
                      - option "3,300"
                      - option "3,400"
                      - option "3,500"
                      - option "3,600"
                      - option "3,700"
                      - option "3,800"
                      - option "3,900"
                      - option "4,000"
                      - option "4,100"
                      - option "4,200"
                      - option "4,300"
                      - option "4,400"
                      - option "4,500"
                      - option "4,600"
                      - option "4,700"
                      - option "4,800"
                      - option "4,900"
                      - option "5,000"
                      - option "5,100"
                      - option "5,200"
                      - option "5,300"
                      - option "5,400"
                      - option "5,500"
                      - option "5,600"
                      - option "5,700"
                      - option "5,800"
                      - option "5,900"
                      - option "6,000"
                      - option "6,100"
                      - option "6,200"
                      - option "6,300"
                      - option "6,400"
                      - option "6,500"
                      - option "6,600"
                      - option "6,700"
                      - option "6,800"
                      - option "6,900"
                      - option "7,000"
                      - option "7,100"
                      - option "7,200"
                      - option "7,300"
                      - option "7,400"
                      - option "7,500"
                      - option "7,600"
                      - option "7,700"
                      - option "7,800"
                      - option "7,900"
                      - option "8,000"
                      - option "8,100"
                      - option "8,200"
                      - option "8,300"
                      - option "8,400"
                      - option "8,500"
                      - option "8,600"
                      - option "8,700"
                      - option "8,800"
                      - option "8,900"
                      - option "9,000"
                      - option "9,100"
                      - option "9,200"
                      - option "9,300"
                      - option "9,400"
                      - option "9,500"
                      - option "9,600"
                      - option "9,700"
                      - option "9,800"
                      - option "9,900"
                      - option "10,000"
            - listitem "B03 x ユーザー登録" [ref=e217]:
              - generic [ref=e219]:
                - generic [ref=e221]:
                  - checkbox "Select item x - ユーザー登録" [checked] [ref=e222]
                  - button "上に移動" [ref=e223] [cursor=pointer]
                  - button "下に移動" [disabled] [ref=e233]
                  - button "保護なし" [ref=e236] [cursor=pointer]: 🔓
                - generic [ref=e237]:
                  - generic [ref=e238]:
                    - generic [ref=e239]: 1日目
                    - generic [ref=e240]: B-03
                    - button "x" [ref=e241] [cursor=pointer]
                  - button "ユーザー登録" [ref=e244] [cursor=pointer]
                  - textbox "利用者メモ" [ref=e248]: エラーが発生しました
                - generic [ref=e249]:
                  - 'button "Current status: 未購入. Click to change." [ref=e250] [cursor=pointer]':
                    - generic [ref=e253]: 未購入
                  - generic [ref=e254]:
                    - generic [ref=e255]: 数量
                    - combobox "購入予定数量" [ref=e256]:
                      - option "1" [selected]
                      - option "2"
                      - option "3"
                      - option "4"
                      - option "5"
                      - option "6"
                      - option "7"
                      - option "8"
                      - option "9"
                      - option "10"
                      - option "11"
                      - option "12"
                      - option "13"
                      - option "14"
                      - option "15"
                      - option "16"
                      - option "17"
                      - option "18"
                      - option "19"
                      - option "20"
                  - generic [ref=e257]:
                    - generic [ref=e258]: 購入金額
                    - generic [ref=e259]: ¥
                    - combobox "購入金額" [ref=e260]:
                      - option "価格未定"
                      - option "0"
                      - option "100"
                      - option "200"
                      - option "300"
                      - option "400"
                      - option "500" [selected]
                      - option "600"
                      - option "700"
                      - option "800"
                      - option "900"
                      - option "1,000"
                      - option "1,100"
                      - option "1,200"
                      - option "1,300"
                      - option "1,400"
                      - option "1,500"
                      - option "1,600"
                      - option "1,700"
                      - option "1,800"
                      - option "1,900"
                      - option "2,000"
                      - option "2,100"
                      - option "2,200"
                      - option "2,300"
                      - option "2,400"
                      - option "2,500"
                      - option "2,600"
                      - option "2,700"
                      - option "2,800"
                      - option "2,900"
                      - option "3,000"
                      - option "3,100"
                      - option "3,200"
                      - option "3,300"
                      - option "3,400"
                      - option "3,500"
                      - option "3,600"
                      - option "3,700"
                      - option "3,800"
                      - option "3,900"
                      - option "4,000"
                      - option "4,100"
                      - option "4,200"
                      - option "4,300"
                      - option "4,400"
                      - option "4,500"
                      - option "4,600"
                      - option "4,700"
                      - option "4,800"
                      - option "4,900"
                      - option "5,000"
                      - option "5,100"
                      - option "5,200"
                      - option "5,300"
                      - option "5,400"
                      - option "5,500"
                      - option "5,600"
                      - option "5,700"
                      - option "5,800"
                      - option "5,900"
                      - option "6,000"
                      - option "6,100"
                      - option "6,200"
                      - option "6,300"
                      - option "6,400"
                      - option "6,500"
                      - option "6,600"
                      - option "6,700"
                      - option "6,800"
                      - option "6,900"
                      - option "7,000"
                      - option "7,100"
                      - option "7,200"
                      - option "7,300"
                      - option "7,400"
                      - option "7,500"
                      - option "7,600"
                      - option "7,700"
                      - option "7,800"
                      - option "7,900"
                      - option "8,000"
                      - option "8,100"
                      - option "8,200"
                      - option "8,300"
                      - option "8,400"
                      - option "8,500"
                      - option "8,600"
                      - option "8,700"
                      - option "8,800"
                      - option "8,900"
                      - option "9,000"
                      - option "9,100"
                      - option "9,200"
                      - option "9,300"
                      - option "9,400"
                      - option "9,500"
                      - option "9,600"
                      - option "9,700"
                      - option "9,800"
                      - option "9,900"
                      - option "10,000"
    - status "保存済み"
  - generic:
    - generic:
      - generic:
        - checkbox "Select item x - ユーザー登録" [checked]
        - button "上に移動"
        - button "下に移動" [disabled]
        - button "保護なし": 🔓
      - generic:
        - generic:
          - generic: 1日目
          - generic: B-03
          - button "x"
        - generic:
          - button "ユーザー登録"
        - generic:
          - generic:
            - textbox "利用者メモ": エラーが発生しました
      - generic:
        - 'button "Current status: 未購入. Click to change."':
          - generic: 未購入
        - generic:
          - generic: 数量
          - combobox "購入予定数量":
            - option "1" [selected]
            - option "2"
            - option "3"
            - option "4"
            - option "5"
            - option "6"
            - option "7"
            - option "8"
            - option "9"
            - option "10"
            - option "11"
            - option "12"
            - option "13"
            - option "14"
            - option "15"
            - option "16"
            - option "17"
            - option "18"
            - option "19"
            - option "20"
        - generic:
          - generic: 購入金額
          - generic: ¥
          - combobox "購入金額":
            - option "価格未定" [selected]
            - option "0"
            - option "100"
            - option "200"
            - option "300"
            - option "400"
            - option "500"
            - option "600"
            - option "700"
            - option "800"
            - option "900"
            - option "1,000"
            - option "1,100"
            - option "1,200"
            - option "1,300"
            - option "1,400"
            - option "1,500"
            - option "1,600"
            - option "1,700"
            - option "1,800"
            - option "1,900"
            - option "2,000"
            - option "2,100"
            - option "2,200"
            - option "2,300"
            - option "2,400"
            - option "2,500"
            - option "2,600"
            - option "2,700"
            - option "2,800"
            - option "2,900"
            - option "3,000"
            - option "3,100"
            - option "3,200"
            - option "3,300"
            - option "3,400"
            - option "3,500"
            - option "3,600"
            - option "3,700"
            - option "3,800"
            - option "3,900"
            - option "4,000"
            - option "4,100"
            - option "4,200"
            - option "4,300"
            - option "4,400"
            - option "4,500"
            - option "4,600"
            - option "4,700"
            - option "4,800"
            - option "4,900"
            - option "5,000"
            - option "5,100"
            - option "5,200"
            - option "5,300"
            - option "5,400"
            - option "5,500"
            - option "5,600"
            - option "5,700"
            - option "5,800"
            - option "5,900"
            - option "6,000"
            - option "6,100"
            - option "6,200"
            - option "6,300"
            - option "6,400"
            - option "6,500"
            - option "6,600"
            - option "6,700"
            - option "6,800"
            - option "6,900"
            - option "7,000"
            - option "7,100"
            - option "7,200"
            - option "7,300"
            - option "7,400"
            - option "7,500"
            - option "7,600"
            - option "7,700"
            - option "7,800"
            - option "7,900"
            - option "8,000"
            - option "8,100"
            - option "8,200"
            - option "8,300"
            - option "8,400"
            - option "8,500"
            - option "8,600"
            - option "8,700"
            - option "8,800"
            - option "8,900"
            - option "9,000"
            - option "9,100"
            - option "9,200"
            - option "9,300"
            - option "9,400"
            - option "9,500"
            - option "9,600"
            - option "9,700"
            - option "9,800"
            - option "9,900"
            - option "10,000"
```

# Test source

```ts
  921  |     }) => {
  922  |       await restore(page, fixture());
  923  |       await grouping(page, grouped);
  924  |       await select(page, ["merge-a", "merge-b", "new-x"]);
  925  |       await start(page, input, "merge-a");
  926  |       const result = await hover(page, input, "a1", "before", grouped);
  927  |       expect(
  928  |         result.guides.filter((line) => line.kind === "merge"),
  929  |       ).toHaveLength(2);
  930  |       expect(
  931  |         result.guides.filter((line) => line.kind === "insert"),
  932  |       ).toHaveLength(1);
  933  |       await finish(page, input, true);
  934  |       const expected = ["new-x", "a1", "a2", "merge-a", "b1", "merge-b"];
  935  |       await expect
  936  |         .poll(async () =>
  937  |           (
  938  |             (await stored(page, "executeModeItems"))[eventName] as Record<
  939  |               string,
  940  |               string[]
  941  |             >
  942  |           )[day].slice(0, 6),
  943  |         )
  944  |         .toEqual(expected);
  945  |       await reopen(page);
  946  |       await expect(page.locator(rowSelector("new-x"))).toBeVisible();
  947  |       expect((await ids(page, "execute")).slice(0, 6)).toEqual(expected);
  948  |     });
  949  |     test(`offscreen merge follows its own destination: ${input} grouping ${grouped}`, async ({
  950  |       page,
  951  |     }) => {
  952  |       await restore(page, fixture());
  953  |       await grouping(page, grouped);
  954  |       await select(page, ["merge-a", "merge-offscreen"]);
  955  |       await start(page, input, "merge-a");
  956  |       const result = await hover(page, input, "a1", "before", grouped);
  957  |       expect(
  958  |         result.guides.filter((line) => line.kind === "merge"),
  959  |       ).toHaveLength(2);
  960  |       expect(
  961  |         result.guides.filter((line) => line.kind === "insert"),
  962  |       ).toHaveLength(0);
  963  |       expect(result.text).toContain("画面外");
  964  |       await finish(page, input, true);
  965  |       await expect
  966  |         .poll(async () =>
  967  |           (
  968  |             (await stored(page, "executeModeItems"))[eventName] as Record<
  969  |               string,
  970  |               string[]
  971  |             >
  972  |           )[day].at(-1),
  973  |         )
  974  |         .toBe("merge-offscreen");
  975  |       await reopen(page);
  976  |       await expect
  977  |         .poll(() => ids(page, "candidate"))
  978  |         .not.toContain("merge-offscreen");
  979  |     });
  980  |   }
  981  | for (const input of ["native", "touch"] as const)
  982  |   test(`impossible OFF boundary rejects a mixed drop atomically: ${input}`, async ({
  983  |     page,
  984  |   }) => {
  985  |     await restore(page, fixture());
  986  |     await grouping(page, false);
  987  |     const before = (await stored(page, "executeModeItems"))[eventName];
  988  |     await select(page, ["merge-a", "bad-priority"]);
  989  |     await start(page, input, "merge-a");
  990  |     const result = await hover(page, input, "a1", "after", false);
  991  |     expect(result.status).toBe("rejected");
  992  |     expect(result.guides).toHaveLength(0);
  993  |     await finish(page, input, true);
  994  |     expect((await stored(page, "executeModeItems"))[eventName]).toEqual(before);
  995  |     expect(await ids(page, "candidate")).toContain("merge-a");
  996  |     expect(await ids(page, "candidate")).toContain("bad-priority");
  997  |     await expect(
  998  |       page.locator(rowSelector("merge-a")).getByRole("checkbox"),
  999  |     ).toBeChecked();
  1000 |     await expect(
  1001 |       page.locator(rowSelector("bad-priority")).getByRole("checkbox"),
  1002 |     ).toBeChecked();
  1003 |   });
  1004 | for (const input of ["native", "touch"] as const)
  1005 |   test(`OFF selection rejects reversed hall buckets before drop: ${input}`, async ({
  1006 |     page,
  1007 |   }) => {
  1008 |     const backup = fixture(4);
  1009 |     backup.data.eventLists[eventName] = [
  1010 |       makeItem("a1", "01", "A"),
  1011 |       makeItem("b1", "02", "B"),
  1012 |       makeItem("x", "03", "B"),
  1013 |       makeItem("y", "04", "A"),
  1014 |     ];
  1015 |     backup.data.executeModeItems[eventName][day] = ["a1", "b1"];
  1016 |     await restore(page, backup);
  1017 |     await grouping(page, false);
  1018 |     await select(page, ["x", "y"]);
  1019 |     await start(page, input, "x");
  1020 |     const guide = await hover(page, input, "a1", "after", false);
> 1021 |     expect(guide.status).toBe("rejected");
       |                          ^ Error: expect(received).toBe(expected) // Object.is equality
  1022 |     expect(guide.guides).toHaveLength(0);
  1023 |     await finish(page, input, true);
  1024 |     expect(
  1025 |       (
  1026 |         (await stored(page, "executeModeItems"))[eventName] as Record<
  1027 |           string,
  1028 |           string[]
  1029 |         >
  1030 |       )[day],
  1031 |     ).toEqual(["a1", "b1"]);
  1032 |     expect(await ids(page, "candidate")).toEqual(["y", "x"]);
  1033 |     for (const id of ["x", "y"])
  1034 |       await expect(
  1035 |         page.locator(rowSelector(id)).getByRole("checkbox"),
  1036 |       ).toBeChecked();
  1037 |   });
  1038 | for (const grouped of [true, false])
  1039 |   test(`actual Chromium native leave clears shared guides before release: grouping ${grouped}`, async ({
  1040 |     page,
  1041 |   }) => {
  1042 |     await restore(page, fixture());
  1043 |     await grouping(page, grouped);
  1044 |     const before = (await stored(page, "executeModeItems"))[eventName];
  1045 |     const source = await page.locator(rowSelector("new-x")).boundingBox();
  1046 |     const target = await page.locator(rowSelector("a1")).boundingBox();
  1047 |     expect(source).not.toBeNull();
  1048 |     expect(target).not.toBeNull();
  1049 |     await page.mouse.move(source!.x + 4, source!.y + 40);
  1050 |     await page.mouse.down();
  1051 |     try {
  1052 |       await page.mouse.move(target!.x + 4, target!.y + 30, { steps: 12 });
  1053 |       await page.mouse.move(target!.x + 6, target!.y + 32);
  1054 |       await expect(
  1055 |         page.locator('[data-shopping-drag-status="accepted"]'),
  1056 |       ).toBeVisible();
  1057 |       await expect(
  1058 |         page.locator('[data-shopping-drag-guide="insert"]'),
  1059 |       ).toBeVisible();
  1060 |       const header = await page
  1061 |         .getByRole("heading", { name: eventName, exact: true })
  1062 |         .boundingBox();
  1063 |       expect(header).not.toBeNull();
  1064 |       await page.mouse.move(header!.x + 6, header!.y + header!.height / 2, {
  1065 |         steps: 12,
  1066 |       });
  1067 |       await expect(page.locator("[data-shopping-drag-status]")).toHaveCount(0);
  1068 |       await expect(page.locator("[data-shopping-drag-guide]")).toHaveCount(0);
  1069 |     } finally {
  1070 |       await page.mouse.up();
  1071 |     }
  1072 |     expect((await stored(page, "executeModeItems"))[eventName]).toEqual(before);
  1073 |   });
  1074 | test("actual Chromium native drag uses the shared column owner", async ({
  1075 |   page,
  1076 | }) => {
  1077 |   await restore(page, fixture());
  1078 |   await grouping(page, true);
  1079 |   const source = page.locator(rowSelector("new-x")),
  1080 |     target = page.locator(rowSelector("a1"));
  1081 |   await source.dragTo(target, {
  1082 |     sourcePosition: { x: 4, y: 40 },
  1083 |     targetPosition: { x: 4, y: 30 },
  1084 |   });
  1085 |   await expect
  1086 |     .poll(async () =>
  1087 |       (
  1088 |         (await stored(page, "executeModeItems"))[eventName] as Record<
  1089 |           string,
  1090 |           string[]
  1091 |         >
  1092 |       )[day].slice(0, 3),
  1093 |     )
  1094 |     .toEqual(["new-x", "a1", "a2"]);
  1095 | });
  1096 | test("actual Chromium touch drag resolves the target column", async ({
  1097 |   page,
  1098 |   context,
  1099 | }) => {
  1100 |   await restore(page, fixture());
  1101 |   await grouping(page, true);
  1102 |   const session = await context.newCDPSession(page);
  1103 |   try {
  1104 |     await session.send("Emulation.setTouchEmulationEnabled", {
  1105 |       enabled: true,
  1106 |       maxTouchPoints: 1,
  1107 |     });
  1108 |     const source = await page.locator(rowSelector("new-x")).boundingBox();
  1109 |     expect(source).not.toBeNull();
  1110 |     await session.send("Input.dispatchTouchEvent", {
  1111 |       type: "touchStart",
  1112 |       touchPoints: [{ x: source!.x + 4, y: source!.y + 40, id: 1 }],
  1113 |     });
  1114 |     await expect(page.locator(".esp-shopping-touch-clone")).toBeVisible();
  1115 |     const target = await page.locator(rowSelector("a1")).boundingBox();
  1116 |     expect(target).not.toBeNull();
  1117 |     await session.send("Input.dispatchTouchEvent", {
  1118 |       type: "touchMove",
  1119 |       touchPoints: [{ x: target!.x + 4, y: target!.y + 30, id: 1 }],
  1120 |     });
  1121 |     await expect(
```