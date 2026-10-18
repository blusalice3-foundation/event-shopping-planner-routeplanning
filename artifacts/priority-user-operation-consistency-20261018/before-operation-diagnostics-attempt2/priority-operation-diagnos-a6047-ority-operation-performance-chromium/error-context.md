# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-operation-diagnostics.spec.ts >> priority dialog and scope operations 500 @priority-operation-performance
- Location: tests\browser\priority-operation-diagnostics.spec.ts:221:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog', { name: '限数にしますか？', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('dialog', { name: '限数にしますか？', exact: true })

```

```yaml
- banner:
  - heading "追加操作性能診断" [level=1]
  - button "候補ブロックを番号で並べ替え":
    - img
  - button "ホール間移動順序":
    - img
  - button "マップ表示に切り替え":
    - img
  - button "表示項目の設定":
    - img
  - button "📝"
  - button "🏃‍♂️"
  - button "🔍"
  - button "イベント一覧"
  - button "1日目499"
  - button "2日目1"
  - button "アイテム追加"
  - textbox "検索..."
  - button "次を検索" [disabled]
- main:
  - heading "実行リストアイテム" [level=2]
  - button "スペース別"
  - paragraph: 実行対象として選択中のアイテムを管理します。
  - list "買い物リスト":
    - listitem "A1 診断サークル0 診断商品0":
      - checkbox "Select item 診断サークル0 - 診断商品0"
      - button "上に移動" [disabled]:
        - img
      - img
      - button "下に移動":
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-1
      - button "診断サークル0"
      - button "診断商品0"
      - textbox "利用者メモ": ユーザー登録
      - 'button "Current status: 未購入. Click to change."':
        - img
        - text: 未購入
      - text: 数量
      - combobox "購入予定数量":
        - option "1"
        - option "2"
        - option "3"
        - option "4"
        - option "5"
        - option "6" [selected]
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
      - text: 購入金額 ¥
      - combobox "購入金額":
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
    - listitem "A1 診断サークル1 診断商品1":
      - checkbox "Select item 診断サークル1 - 診断商品1"
      - button "上に移動":
        - img
      - img
      - button "下に移動":
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-1
      - button "診断サークル1"
      - button "診断商品1"
      - textbox "利用者メモ": ユーザー登録
      - 'button "Current status: 未購入. Click to change."':
        - img
        - text: 未購入
      - text: 数量
      - combobox "購入予定数量":
        - option "1"
        - option "2"
        - option "3"
        - option "4"
        - option "5" [selected]
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
      - text: 購入金額 ¥
      - combobox "購入金額":
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
    - listitem "A1 診断サークル2 診断商品2":
      - checkbox "Select item 診断サークル2 - 診断商品2"
      - button "上に移動":
        - img
      - img
      - button "下に移動":
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-1
      - button "診断サークル2"
      - button "診断商品2"
      - textbox "利用者メモ": ユーザー登録
      - 'button "Current status: 未購入. Click to change."':
        - img
        - text: 未購入
      - text: 数量
      - combobox "購入予定数量":
        - option "1"
        - option "2"
        - option "3"
        - option "4"
        - option "5" [selected]
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
      - text: 購入金額 ¥
      - combobox "購入金額":
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
    - listitem "A3 診断サークル3 診断商品3":
      - checkbox "Select item 診断サークル3 - 診断商品3"
      - button "上に移動":
        - img
      - img
      - button "下に移動":
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-3
      - button "診断サークル3"
      - button "診断商品3"
      - textbox "利用者メモ": ユーザー登録
      - 'button "Current status: 未購入. Click to change."':
        - img
        - text: 未購入
      - text: 数量
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
      - text: 購入金額 ¥
      - combobox "購入金額":
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
    - listitem "A4 診断サークル4 診断商品4":
      - checkbox "Select item 診断サークル4 - 診断商品4"
      - button "上に移動":
        - img
      - img
      - button "下に移動":
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-4
      - button "診断サークル4"
      - button "診断商品4"
      - textbox "利用者メモ": ユーザー登録
      - 'button "Current status: 未購入. Click to change."':
        - img
        - text: 未購入
      - text: 数量
      - combobox "購入予定数量":
        - option "1"
        - option "2"
        - option "3"
        - option "4"
        - option "5" [selected]
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
      - text: 購入金額 ¥
      - combobox "購入金額":
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
    - listitem "A5 診断サークル5 診断商品5":
      - checkbox "Select item 診断サークル5 - 診断商品5"
      - button "上に移動":
        - img
      - img
      - button "下に移動":
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-5
      - button "診断サークル5"
      - button "診断商品5"
      - textbox "利用者メモ": ユーザー登録
      - 'button "Current status: 未購入. Click to change."':
        - img
        - text: 未購入
      - text: 数量
      - combobox "購入予定数量":
        - option "1"
        - option "2"
        - option "3"
        - option "4"
        - option "5" [selected]
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
      - text: 購入金額 ¥
      - combobox "購入金額":
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
    - listitem "A6 診断サークル6 診断商品6":
      - checkbox "Select item 診断サークル6 - 診断商品6"
      - button "上に移動":
        - img
      - img
      - button "下に移動":
        - img
      - button "保護なし": 🔓
      - text: 1日目 A-6
      - button "診断サークル6"
      - button "診断商品6"
      - textbox "利用者メモ": ユーザー登録
      - 'button "Current status: 未購入. Click to change."':
        - img
        - text: 未購入
      - text: 数量
      - combobox "購入予定数量":
        - option "1"
        - option "2"
        - option "3"
        - option "4"
        - option "5" [selected]
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
      - text: 購入金額 ¥
      - combobox "購入金額":
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
    - listitem "A7 診断サークル7 診断商品7": A7 診断サークル7 診断商品7 ユーザー登録 500 5
    - listitem "A8 診断サークル8 診断商品8": A8 診断サークル8 診断商品8 ユーザー登録 500 5
    - listitem "A9 診断サークル9 診断商品9": A9 診断サークル9 診断商品9 ユーザー登録 500 5
    - listitem "A10 診断サークル10 診断商品10": A10 診断サークル10 診断商品10 ユーザー登録 500 5
    - listitem "A11 診断サークル11 診断商品11": A11 診断サークル11 診断商品11 ユーザー登録 500 5
    - listitem "A12 診断サークル12 診断商品12": A12 診断サークル12 診断商品12 ユーザー登録 500 5
    - listitem "A13 診断サークル13 診断商品13": A13 診断サークル13 診断商品13 ユーザー登録 500 5
    - listitem "A14 診断サークル14 診断商品14": A14 診断サークル14 診断商品14 ユーザー登録 500 5
    - listitem "A15 診断サークル15 診断商品15": A15 診断サークル15 診断商品15 ユーザー登録 500 5
    - listitem "A16 診断サークル16 診断商品16": A16 診断サークル16 診断商品16 ユーザー登録 500 5
    - listitem "A17 診断サークル17 診断商品17": A17 診断サークル17 診断商品17 ユーザー登録 500 5
    - listitem "A18 診断サークル18 診断商品18": A18 診断サークル18 診断商品18 ユーザー登録 500 5
    - listitem "A19 診断サークル19 診断商品19": A19 診断サークル19 診断商品19 ユーザー登録 500 5
    - listitem "A20 診断サークル20 診断商品20": A20 診断サークル20 診断商品20 ユーザー登録 500 5
    - listitem "A21 診断サークル21 診断商品21": A21 診断サークル21 診断商品21 ユーザー登録 500 5
    - listitem "A22 診断サークル22 診断商品22": A22 診断サークル22 診断商品22 ユーザー登録 500 5
    - listitem "A23 診断サークル23 診断商品23": A23 診断サークル23 診断商品23 ユーザー登録 500 5
    - listitem "A24 診断サークル24 診断商品24": A24 診断サークル24 診断商品24 ユーザー登録 500 5
    - listitem "A25 診断サークル25 診断商品25": A25 診断サークル25 診断商品25 ユーザー登録 500 5
    - listitem "A26 診断サークル26 診断商品26": A26 診断サークル26 診断商品26 ユーザー登録 500 5
    - listitem "A27 診断サークル27 診断商品27": A27 診断サークル27 診断商品27 ユーザー登録 500 5
    - listitem "A28 診断サークル28 診断商品28": A28 診断サークル28 診断商品28 ユーザー登録 500 5
    - listitem "A29 診断サークル29 診断商品29": A29 診断サークル29 診断商品29 ユーザー登録 500 5
    - listitem "A30 診断サークル30 診断商品30": A30 診断サークル30 診断商品30 ユーザー登録 500 5
    - listitem "A31 診断サークル31 診断商品31": A31 診断サークル31 診断商品31 ユーザー登録 500 5
    - listitem "A32 診断サークル32 診断商品32": A32 診断サークル32 診断商品32 ユーザー登録 500 5
    - listitem "A33 診断サークル33 診断商品33": A33 診断サークル33 診断商品33 ユーザー登録 500 5
    - listitem "A34 診断サークル34 診断商品34": A34 診断サークル34 診断商品34 ユーザー登録 500 5
    - listitem "A35 診断サークル35 診断商品35": A35 診断サークル35 診断商品35 ユーザー登録 500 5
    - listitem "A36 診断サークル36 診断商品36": A36 診断サークル36 診断商品36 ユーザー登録 500 5
    - listitem "A37 診断サークル37 診断商品37": A37 診断サークル37 診断商品37 ユーザー登録 500 5
    - listitem "A38 診断サークル38 診断商品38": A38 診断サークル38 診断商品38 ユーザー登録 500 5
    - listitem "A39 診断サークル39 診断商品39": A39 診断サークル39 診断商品39 ユーザー登録 500 5
    - listitem "A40 診断サークル40 診断商品40": A40 診断サークル40 診断商品40 ユーザー登録 500 5
    - listitem "A41 診断サークル41 診断商品41": A41 診断サークル41 診断商品41 ユーザー登録 500 5
    - listitem "A42 診断サークル42 診断商品42": A42 診断サークル42 診断商品42 ユーザー登録 500 5
    - listitem "A43 診断サークル43 診断商品43": A43 診断サークル43 診断商品43 ユーザー登録 500 5
    - listitem "A44 診断サークル44 診断商品44": A44 診断サークル44 診断商品44 ユーザー登録 500 5
    - listitem "A45 診断サークル45 診断商品45": A45 診断サークル45 診断商品45 ユーザー登録 500 5
    - listitem "A46 診断サークル46 診断商品46": A46 診断サークル46 診断商品46 ユーザー登録 500 5
    - listitem "A47 診断サークル47 診断商品47": A47 診断サークル47 診断商品47 ユーザー登録 500 5
    - listitem "A48 診断サークル48 診断商品48": A48 診断サークル48 診断商品48 ユーザー登録 500 5
    - listitem "A49 診断サークル49 診断商品49": A49 診断サークル49 診断商品49 ユーザー登録 500 5
    - listitem "A50 診断サークル50 診断商品50": A50 診断サークル50 診断商品50 ユーザー登録 500 5
    - listitem "A51 診断サークル51 診断商品51": A51 診断サークル51 診断商品51 ユーザー登録 500 5
    - listitem "A52 診断サークル52 診断商品52": A52 診断サークル52 診断商品52 ユーザー登録 500 5
    - listitem "A53 診断サークル53 診断商品53": A53 診断サークル53 診断商品53 ユーザー登録 500 5
    - listitem "A54 診断サークル54 診断商品54": A54 診断サークル54 診断商品54 ユーザー登録 500 5
    - listitem "A55 診断サークル55 診断商品55": A55 診断サークル55 診断商品55 ユーザー登録 500 5
    - listitem "A56 診断サークル56 診断商品56": A56 診断サークル56 診断商品56 ユーザー登録 500 5
    - listitem "A57 診断サークル57 診断商品57": A57 診断サークル57 診断商品57 ユーザー登録 500 5
    - listitem "A58 診断サークル58 診断商品58": A58 診断サークル58 診断商品58 ユーザー登録 500 5
    - listitem "A59 診断サークル59 診断商品59": A59 診断サークル59 診断商品59 ユーザー登録 500 5
    - listitem "A60 診断サークル60 診断商品60": A60 診断サークル60 診断商品60 ユーザー登録 500 5
    - listitem "A61 診断サークル61 診断商品61": A61 診断サークル61 診断商品61 ユーザー登録 500 5
    - listitem "A62 診断サークル62 診断商品62": A62 診断サークル62 診断商品62 ユーザー登録 500 5
    - listitem "A63 診断サークル63 診断商品63": A63 診断サークル63 診断商品63 ユーザー登録 500 5
    - listitem "A64 診断サークル64 診断商品64": A64 診断サークル64 診断商品64 ユーザー登録 500 5
    - listitem "A65 診断サークル65 診断商品65": A65 診断サークル65 診断商品65 ユーザー登録 500 5
    - listitem "A66 診断サークル66 診断商品66": A66 診断サークル66 診断商品66 ユーザー登録 500 5
    - listitem "A67 診断サークル67 診断商品67": A67 診断サークル67 診断商品67 ユーザー登録 500 5
    - listitem "A68 診断サークル68 診断商品68": A68 診断サークル68 診断商品68 ユーザー登録 500 5
    - listitem "A69 診断サークル69 診断商品69": A69 診断サークル69 診断商品69 ユーザー登録 500 5
    - listitem "A70 診断サークル70 診断商品70": A70 診断サークル70 診断商品70 ユーザー登録 500 5
    - listitem "A71 診断サークル71 診断商品71": A71 診断サークル71 診断商品71 ユーザー登録 500 5
    - listitem "A72 診断サークル72 診断商品72": A72 診断サークル72 診断商品72 ユーザー登録 500 5
    - listitem "A73 診断サークル73 診断商品73": A73 診断サークル73 診断商品73 ユーザー登録 500 5
    - listitem "A74 診断サークル74 診断商品74": A74 診断サークル74 診断商品74 ユーザー登録 500 5
    - listitem "A75 診断サークル75 診断商品75": A75 診断サークル75 診断商品75 ユーザー登録 500 5
    - listitem "A76 診断サークル76 診断商品76": A76 診断サークル76 診断商品76 ユーザー登録 500 5
    - listitem "A77 診断サークル77 診断商品77": A77 診断サークル77 診断商品77 ユーザー登録 500 5
    - listitem "A78 診断サークル78 診断商品78": A78 診断サークル78 診断商品78 ユーザー登録 500 5
    - listitem "A79 診断サークル79 診断商品79": A79 診断サークル79 診断商品79 ユーザー登録 500 5
    - listitem "A80 診断サークル80 診断商品80": A80 診断サークル80 診断商品80 ユーザー登録 500 5
    - listitem "A81 診断サークル81 診断商品81": A81 診断サークル81 診断商品81 ユーザー登録 500 5
    - listitem "A82 診断サークル82 診断商品82": A82 診断サークル82 診断商品82 ユーザー登録 500 5
    - listitem "A83 診断サークル83 診断商品83": A83 診断サークル83 診断商品83 ユーザー登録 500 5
    - listitem "A84 診断サークル84 診断商品84": A84 診断サークル84 診断商品84 ユーザー登録 500 5
    - listitem "A85 診断サークル85 診断商品85": A85 診断サークル85 診断商品85 ユーザー登録 500 5
    - listitem "A86 診断サークル86 診断商品86": A86 診断サークル86 診断商品86 ユーザー登録 500 5
    - listitem "A87 診断サークル87 診断商品87": A87 診断サークル87 診断商品87 ユーザー登録 500 5
    - listitem "A88 診断サークル88 診断商品88": A88 診断サークル88 診断商品88 ユーザー登録 500 5
    - listitem "A89 診断サークル89 診断商品89": A89 診断サークル89 診断商品89 ユーザー登録 500 5
    - listitem "A90 診断サークル90 診断商品90": A90 診断サークル90 診断商品90 ユーザー登録 500 5
    - listitem "A91 診断サークル91 診断商品91": A91 診断サークル91 診断商品91 ユーザー登録 500 5
    - listitem "A92 診断サークル92 診断商品92": A92 診断サークル92 診断商品92 ユーザー登録 500 5
    - listitem "A93 診断サークル93 診断商品93": A93 診断サークル93 診断商品93 ユーザー登録 500 5
    - listitem "A94 診断サークル94 診断商品94": A94 診断サークル94 診断商品94 ユーザー登録 500 5
    - listitem "A95 診断サークル95 診断商品95": A95 診断サークル95 診断商品95 ユーザー登録 500 5
    - listitem "A96 診断サークル96 診断商品96": A96 診断サークル96 診断商品96 ユーザー登録 500 5
    - listitem "A97 診断サークル97 診断商品97": A97 診断サークル97 診断商品97 ユーザー登録 500 5
    - listitem "A98 診断サークル98 診断商品98": A98 診断サークル98 診断商品98 ユーザー登録 500 5
    - listitem "A99 診断サークル99 診断商品99": A99 診断サークル99 診断商品99 ユーザー登録 500 5
    - listitem "A100 診断サークル100 診断商品100": A100 診断サークル100 診断商品100 ユーザー登録 500 5
    - listitem "A101 診断サークル101 診断商品101": A101 診断サークル101 診断商品101 ユーザー登録 500 5
    - listitem "A102 診断サークル102 診断商品102": A102 診断サークル102 診断商品102 ユーザー登録 500 5
    - listitem "A103 診断サークル103 診断商品103": A103 診断サークル103 診断商品103 ユーザー登録 500 5
    - listitem "A104 診断サークル104 診断商品104": A104 診断サークル104 診断商品104 ユーザー登録 500 5
    - listitem "A105 診断サークル105 診断商品105": A105 診断サークル105 診断商品105 ユーザー登録 500 5
    - listitem "A106 診断サークル106 診断商品106": A106 診断サークル106 診断商品106 ユーザー登録 500 5
    - listitem "A107 診断サークル107 診断商品107": A107 診断サークル107 診断商品107 ユーザー登録 500 5
    - listitem "A108 診断サークル108 診断商品108": A108 診断サークル108 診断商品108 ユーザー登録 500 5
    - listitem "A109 診断サークル109 診断商品109": A109 診断サークル109 診断商品109 ユーザー登録 500 5
    - listitem "A110 診断サークル110 診断商品110": A110 診断サークル110 診断商品110 ユーザー登録 500 5
    - listitem "A111 診断サークル111 診断商品111": A111 診断サークル111 診断商品111 ユーザー登録 500 5
    - listitem "A112 診断サークル112 診断商品112": A112 診断サークル112 診断商品112 ユーザー登録 500 5
    - listitem "A113 診断サークル113 診断商品113": A113 診断サークル113 診断商品113 ユーザー登録 500 5
    - listitem "A114 診断サークル114 診断商品114": A114 診断サークル114 診断商品114 ユーザー登録 500 5
    - listitem "A115 診断サークル115 診断商品115": A115 診断サークル115 診断商品115 ユーザー登録 500 5
    - listitem "A116 診断サークル116 診断商品116": A116 診断サークル116 診断商品116 ユーザー登録 500 5
    - listitem "A117 診断サークル117 診断商品117": A117 診断サークル117 診断商品117 ユーザー登録 500 5
    - listitem "A118 診断サークル118 診断商品118": A118 診断サークル118 診断商品118 ユーザー登録 500 5
    - listitem "A119 診断サークル119 診断商品119": A119 診断サークル119 診断商品119 ユーザー登録 500 5
    - listitem "A120 診断サークル120 診断商品120": A120 診断サークル120 診断商品120 ユーザー登録 500 5
    - listitem "A121 診断サークル121 診断商品121": A121 診断サークル121 診断商品121 ユーザー登録 500 5
    - listitem "A122 診断サークル122 診断商品122": A122 診断サークル122 診断商品122 ユーザー登録 500 5
    - listitem "A123 診断サークル123 診断商品123": A123 診断サークル123 診断商品123 ユーザー登録 500 5
    - listitem "A124 診断サークル124 診断商品124": A124 診断サークル124 診断商品124 ユーザー登録 500 5
    - listitem "A125 診断サークル125 診断商品125": A125 診断サークル125 診断商品125 ユーザー登録 500 5
    - listitem "A126 診断サークル126 診断商品126": A126 診断サークル126 診断商品126 ユーザー登録 500 5
    - listitem "A127 診断サークル127 診断商品127": A127 診断サークル127 診断商品127 ユーザー登録 500 5
    - listitem "A128 診断サークル128 診断商品128": A128 診断サークル128 診断商品128 ユーザー登録 500 5
    - listitem "A129 診断サークル129 診断商品129": A129 診断サークル129 診断商品129 ユーザー登録 500 5
    - listitem "A130 診断サークル130 診断商品130": A130 診断サークル130 診断商品130 ユーザー登録 500 5
    - listitem "A131 診断サークル131 診断商品131": A131 診断サークル131 診断商品131 ユーザー登録 500 5
    - listitem "A132 診断サークル132 診断商品132": A132 診断サークル132 診断商品132 ユーザー登録 500 5
    - listitem "A133 診断サークル133 診断商品133": A133 診断サークル133 診断商品133 ユーザー登録 500 5
    - listitem "A134 診断サークル134 診断商品134": A134 診断サークル134 診断商品134 ユーザー登録 500 5
    - listitem "A135 診断サークル135 診断商品135": A135 診断サークル135 診断商品135 ユーザー登録 500 5
    - listitem "A136 診断サークル136 診断商品136": A136 診断サークル136 診断商品136 ユーザー登録 500 5
    - listitem "A137 診断サークル137 診断商品137": A137 診断サークル137 診断商品137 ユーザー登録 500 5
    - listitem "A138 診断サークル138 診断商品138": A138 診断サークル138 診断商品138 ユーザー登録 500 5
    - listitem "A139 診断サークル139 診断商品139": A139 診断サークル139 診断商品139 ユーザー登録 500 5
    - listitem "A140 診断サークル140 診断商品140": A140 診断サークル140 診断商品140 ユーザー登録 500 5
    - listitem "A141 診断サークル141 診断商品141": A141 診断サークル141 診断商品141 ユーザー登録 500 5
    - listitem "A142 診断サークル142 診断商品142": A142 診断サークル142 診断商品142 ユーザー登録 500 5
    - listitem "A143 診断サークル143 診断商品143": A143 診断サークル143 診断商品143 ユーザー登録 500 5
    - listitem "A144 診断サークル144 診断商品144": A144 診断サークル144 診断商品144 ユーザー登録 500 5
    - listitem "A145 診断サークル145 診断商品145": A145 診断サークル145 診断商品145 ユーザー登録 500 5
    - listitem "A146 診断サークル146 診断商品146": A146 診断サークル146 診断商品146 ユーザー登録 500 5
    - listitem "A147 診断サークル147 診断商品147": A147 診断サークル147 診断商品147 ユーザー登録 500 5
    - listitem "A148 診断サークル148 診断商品148": A148 診断サークル148 診断商品148 ユーザー登録 500 5
    - listitem "A149 診断サークル149 診断商品149": A149 診断サークル149 診断商品149 ユーザー登録 500 5
    - listitem "A150 診断サークル150 診断商品150": A150 診断サークル150 診断商品150 ユーザー登録 500 5
    - listitem "A151 診断サークル151 診断商品151": A151 診断サークル151 診断商品151 ユーザー登録 500 5
    - listitem "A152 診断サークル152 診断商品152": A152 診断サークル152 診断商品152 ユーザー登録 500 5
    - listitem "A153 診断サークル153 診断商品153": A153 診断サークル153 診断商品153 ユーザー登録 500 5
    - listitem "A154 診断サークル154 診断商品154": A154 診断サークル154 診断商品154 ユーザー登録 500 5
    - listitem "A155 診断サークル155 診断商品155": A155 診断サークル155 診断商品155 ユーザー登録 500 5
    - listitem "A156 診断サークル156 診断商品156": A156 診断サークル156 診断商品156 ユーザー登録 500 5
    - listitem "A157 診断サークル157 診断商品157": A157 診断サークル157 診断商品157 ユーザー登録 500 5
    - listitem "A158 診断サークル158 診断商品158": A158 診断サークル158 診断商品158 ユーザー登録 500 5
    - listitem "A159 診断サークル159 診断商品159": A159 診断サークル159 診断商品159 ユーザー登録 500 5
    - listitem "A160 診断サークル160 診断商品160": A160 診断サークル160 診断商品160 ユーザー登録 500 5
    - listitem "A161 診断サークル161 診断商品161": A161 診断サークル161 診断商品161 ユーザー登録 500 5
    - listitem "A162 診断サークル162 診断商品162": A162 診断サークル162 診断商品162 ユーザー登録 500 5
    - listitem "A163 診断サークル163 診断商品163": A163 診断サークル163 診断商品163 ユーザー登録 500 5
    - listitem "A164 診断サークル164 診断商品164": A164 診断サークル164 診断商品164 ユーザー登録 500 5
    - listitem "A165 診断サークル165 診断商品165": A165 診断サークル165 診断商品165 ユーザー登録 500 5
    - listitem "A166 診断サークル166 診断商品166": A166 診断サークル166 診断商品166 ユーザー登録 500 5
    - listitem "A167 診断サークル167 診断商品167": A167 診断サークル167 診断商品167 ユーザー登録 500 5
    - listitem "A168 診断サークル168 診断商品168": A168 診断サークル168 診断商品168 ユーザー登録 500 5
    - listitem "A169 診断サークル169 診断商品169": A169 診断サークル169 診断商品169 ユーザー登録 500 5
    - listitem "A170 診断サークル170 診断商品170": A170 診断サークル170 診断商品170 ユーザー登録 500 5
    - listitem "A171 診断サークル171 診断商品171": A171 診断サークル171 診断商品171 ユーザー登録 500 5
    - listitem "A172 診断サークル172 診断商品172": A172 診断サークル172 診断商品172 ユーザー登録 500 5
    - listitem "A173 診断サークル173 診断商品173": A173 診断サークル173 診断商品173 ユーザー登録 500 5
    - listitem "A174 診断サークル174 診断商品174": A174 診断サークル174 診断商品174 ユーザー登録 500 5
    - listitem "A175 診断サークル175 診断商品175": A175 診断サークル175 診断商品175 ユーザー登録 500 5
    - listitem "A176 診断サークル176 診断商品176": A176 診断サークル176 診断商品176 ユーザー登録 500 5
    - listitem "A177 診断サークル177 診断商品177": A177 診断サークル177 診断商品177 ユーザー登録 500 5
    - listitem "A178 診断サークル178 診断商品178": A178 診断サークル178 診断商品178 ユーザー登録 500 5
    - listitem "A179 診断サークル179 診断商品179": A179 診断サークル179 診断商品179 ユーザー登録 500 5
    - listitem "A180 診断サークル180 診断商品180": A180 診断サークル180 診断商品180 ユーザー登録 500 5
    - listitem "A181 診断サークル181 診断商品181": A181 診断サークル181 診断商品181 ユーザー登録 500 5
    - listitem "A182 診断サークル182 診断商品182": A182 診断サークル182 診断商品182 ユーザー登録 500 5
    - listitem "A183 診断サークル183 診断商品183": A183 診断サークル183 診断商品183 ユーザー登録 500 5
    - listitem "A184 診断サークル184 診断商品184": A184 診断サークル184 診断商品184 ユーザー登録 500 5
    - listitem "A185 診断サークル185 診断商品185": A185 診断サークル185 診断商品185 ユーザー登録 500 5
    - listitem "A186 診断サークル186 診断商品186": A186 診断サークル186 診断商品186 ユーザー登録 500 5
    - listitem "A187 診断サークル187 診断商品187": A187 診断サークル187 診断商品187 ユーザー登録 500 5
    - listitem "A188 診断サークル188 診断商品188": A188 診断サークル188 診断商品188 ユーザー登録 500 5
    - listitem "A189 診断サークル189 診断商品189": A189 診断サークル189 診断商品189 ユーザー登録 500 5
    - listitem "A190 診断サークル190 診断商品190": A190 診断サークル190 診断商品190 ユーザー登録 500 5
    - listitem "A191 診断サークル191 診断商品191": A191 診断サークル191 診断商品191 ユーザー登録 500 5
    - listitem "A192 診断サークル192 診断商品192": A192 診断サークル192 診断商品192 ユーザー登録 500 5
    - listitem "A193 診断サークル193 診断商品193": A193 診断サークル193 診断商品193 ユーザー登録 500 5
    - listitem "A194 診断サークル194 診断商品194": A194 診断サークル194 診断商品194 ユーザー登録 500 5
    - listitem "A195 診断サークル195 診断商品195": A195 診断サークル195 診断商品195 ユーザー登録 500 5
    - listitem "A196 診断サークル196 診断商品196": A196 診断サークル196 診断商品196 ユーザー登録 500 5
    - listitem "A197 診断サークル197 診断商品197": A197 診断サークル197 診断商品197 ユーザー登録 500 5
    - listitem "A198 診断サークル198 診断商品198": A198 診断サークル198 診断商品198 ユーザー登録 500 5
    - listitem "A199 診断サークル199 診断商品199": A199 診断サークル199 診断商品199 ユーザー登録 500 5
    - listitem "A200 診断サークル200 診断商品200": A200 診断サークル200 診断商品200 ユーザー登録 500 5
    - listitem "A201 診断サークル201 診断商品201": A201 診断サークル201 診断商品201 ユーザー登録 500 5
    - listitem "A202 診断サークル202 診断商品202": A202 診断サークル202 診断商品202 ユーザー登録 500 5
    - listitem "A203 診断サークル203 診断商品203": A203 診断サークル203 診断商品203 ユーザー登録 500 5
    - listitem "A204 診断サークル204 診断商品204": A204 診断サークル204 診断商品204 ユーザー登録 500 5
    - listitem "A205 診断サークル205 診断商品205": A205 診断サークル205 診断商品205 ユーザー登録 500 5
    - listitem "A206 診断サークル206 診断商品206": A206 診断サークル206 診断商品206 ユーザー登録 500 5
    - listitem "A207 診断サークル207 診断商品207": A207 診断サークル207 診断商品207 ユーザー登録 500 5
    - listitem "A208 診断サークル208 診断商品208": A208 診断サークル208 診断商品208 ユーザー登録 500 5
    - listitem "A209 診断サークル209 診断商品209": A209 診断サークル209 診断商品209 ユーザー登録 500 5
    - listitem "A210 診断サークル210 診断商品210": A210 診断サークル210 診断商品210 ユーザー登録 500 5
    - listitem "A211 診断サークル211 診断商品211": A211 診断サークル211 診断商品211 ユーザー登録 500 5
    - listitem "A212 診断サークル212 診断商品212": A212 診断サークル212 診断商品212 ユーザー登録 500 5
    - listitem "A213 診断サークル213 診断商品213": A213 診断サークル213 診断商品213 ユーザー登録 500 5
    - listitem "A214 診断サークル214 診断商品214": A214 診断サークル214 診断商品214 ユーザー登録 500 5
    - listitem "A215 診断サークル215 診断商品215": A215 診断サークル215 診断商品215 ユーザー登録 500 5
    - listitem "A216 診断サークル216 診断商品216": A216 診断サークル216 診断商品216 ユーザー登録 500 5
    - listitem "A217 診断サークル217 診断商品217": A217 診断サークル217 診断商品217 ユーザー登録 500 5
    - listitem "A218 診断サークル218 診断商品218": A218 診断サークル218 診断商品218 ユーザー登録 500 5
    - listitem "A219 診断サークル219 診断商品219": A219 診断サークル219 診断商品219 ユーザー登録 500 5
    - listitem "A220 診断サークル220 診断商品220": A220 診断サークル220 診断商品220 ユーザー登録 500 5
    - listitem "A221 診断サークル221 診断商品221": A221 診断サークル221 診断商品221 ユーザー登録 500 5
    - listitem "A222 診断サークル222 診断商品222": A222 診断サークル222 診断商品222 ユーザー登録 500 5
    - listitem "A223 診断サークル223 診断商品223": A223 診断サークル223 診断商品223 ユーザー登録 500 5
    - listitem "A224 診断サークル224 診断商品224": A224 診断サークル224 診断商品224 ユーザー登録 500 5
    - listitem "A225 診断サークル225 診断商品225": A225 診断サークル225 診断商品225 ユーザー登録 500 5
    - listitem "A226 診断サークル226 診断商品226": A226 診断サークル226 診断商品226 ユーザー登録 500 5
    - listitem "A227 診断サークル227 診断商品227": A227 診断サークル227 診断商品227 ユーザー登録 500 5
    - listitem "A228 診断サークル228 診断商品228": A228 診断サークル228 診断商品228 ユーザー登録 500 5
    - listitem "A229 診断サークル229 診断商品229": A229 診断サークル229 診断商品229 ユーザー登録 500 5
    - listitem "A230 診断サークル230 診断商品230": A230 診断サークル230 診断商品230 ユーザー登録 500 5
    - listitem "A231 診断サークル231 診断商品231": A231 診断サークル231 診断商品231 ユーザー登録 500 5
    - listitem "A232 診断サークル232 診断商品232": A232 診断サークル232 診断商品232 ユーザー登録 500 5
    - listitem "A233 診断サークル233 診断商品233": A233 診断サークル233 診断商品233 ユーザー登録 500 5
    - listitem "A234 診断サークル234 診断商品234": A234 診断サークル234 診断商品234 ユーザー登録 500 5
    - listitem "A235 診断サークル235 診断商品235": A235 診断サークル235 診断商品235 ユーザー登録 500 5
    - listitem "A236 診断サークル236 診断商品236": A236 診断サークル236 診断商品236 ユーザー登録 500 5
    - listitem "A237 診断サークル237 診断商品237": A237 診断サークル237 診断商品237 ユーザー登録 500 5
    - listitem "A238 診断サークル238 診断商品238": A238 診断サークル238 診断商品238 ユーザー登録 500 5
    - listitem "A239 診断サークル239 診断商品239": A239 診断サークル239 診断商品239 ユーザー登録 500 5
    - listitem "A240 診断サークル240 診断商品240": A240 診断サークル240 診断商品240 ユーザー登録 500 5
    - listitem "A241 診断サークル241 診断商品241": A241 診断サークル241 診断商品241 ユーザー登録 500 5
    - listitem "A242 診断サークル242 診断商品242": A242 診断サークル242 診断商品242 ユーザー登録 500 5
    - listitem "A243 診断サークル243 診断商品243": A243 診断サークル243 診断商品243 ユーザー登録 500 5
    - listitem "A244 診断サークル244 診断商品244": A244 診断サークル244 診断商品244 ユーザー登録 500 5
    - listitem "A245 診断サークル245 診断商品245": A245 診断サークル245 診断商品245 ユーザー登録 500 5
    - listitem "A246 診断サークル246 診断商品246": A246 診断サークル246 診断商品246 ユーザー登録 500 5
    - listitem "A247 診断サークル247 診断商品247": A247 診断サークル247 診断商品247 ユーザー登録 500 5
    - listitem "A248 診断サークル248 診断商品248": A248 診断サークル248 診断商品248 ユーザー登録 500 5
    - listitem "A249 診断サークル249 診断商品249": A249 診断サークル249 診断商品249 ユーザー登録 500 5
    - listitem "A250 診断サークル250 診断商品250": A250 診断サークル250 診断商品250 ユーザー登録 500 5
    - listitem "A251 診断サークル251 診断商品251": A251 診断サークル251 診断商品251 ユーザー登録 500 5
    - listitem "A252 診断サークル252 診断商品252": A252 診断サークル252 診断商品252 ユーザー登録 500 5
    - listitem "A253 診断サークル253 診断商品253": A253 診断サークル253 診断商品253 ユーザー登録 500 5
    - listitem "A254 診断サークル254 診断商品254": A254 診断サークル254 診断商品254 ユーザー登録 500 5
    - listitem "A255 診断サークル255 診断商品255": A255 診断サークル255 診断商品255 ユーザー登録 500 5
    - listitem "A256 診断サークル256 診断商品256": A256 診断サークル256 診断商品256 ユーザー登録 500 5
    - listitem "A257 診断サークル257 診断商品257": A257 診断サークル257 診断商品257 ユーザー登録 500 5
    - listitem "A258 診断サークル258 診断商品258": A258 診断サークル258 診断商品258 ユーザー登録 500 5
    - listitem "A259 診断サークル259 診断商品259": A259 診断サークル259 診断商品259 ユーザー登録 500 5
    - listitem "A260 診断サークル260 診断商品260": A260 診断サークル260 診断商品260 ユーザー登録 500 5
    - listitem "A261 診断サークル261 診断商品261": A261 診断サークル261 診断商品261 ユーザー登録 500 5
    - listitem "A262 診断サークル262 診断商品262": A262 診断サークル262 診断商品262 ユーザー登録 500 5
    - listitem "A263 診断サークル263 診断商品263": A263 診断サークル263 診断商品263 ユーザー登録 500 5
    - listitem "A264 診断サークル264 診断商品264": A264 診断サークル264 診断商品264 ユーザー登録 500 5
    - listitem "A265 診断サークル265 診断商品265": A265 診断サークル265 診断商品265 ユーザー登録 500 5
    - listitem "A266 診断サークル266 診断商品266": A266 診断サークル266 診断商品266 ユーザー登録 500 5
    - listitem "A267 診断サークル267 診断商品267": A267 診断サークル267 診断商品267 ユーザー登録 500 5
    - listitem "A268 診断サークル268 診断商品268": A268 診断サークル268 診断商品268 ユーザー登録 500 5
    - listitem "A269 診断サークル269 診断商品269": A269 診断サークル269 診断商品269 ユーザー登録 500 5
    - listitem "A270 診断サークル270 診断商品270": A270 診断サークル270 診断商品270 ユーザー登録 500 5
    - listitem "A271 診断サークル271 診断商品271": A271 診断サークル271 診断商品271 ユーザー登録 500 5
    - listitem "A272 診断サークル272 診断商品272": A272 診断サークル272 診断商品272 ユーザー登録 500 5
    - listitem "A273 診断サークル273 診断商品273": A273 診断サークル273 診断商品273 ユーザー登録 500 5
    - listitem "A274 診断サークル274 診断商品274": A274 診断サークル274 診断商品274 ユーザー登録 500 5
    - listitem "A275 診断サークル275 診断商品275": A275 診断サークル275 診断商品275 ユーザー登録 500 5
    - listitem "A276 診断サークル276 診断商品276": A276 診断サークル276 診断商品276 ユーザー登録 500 5
    - listitem "A277 診断サークル277 診断商品277": A277 診断サークル277 診断商品277 ユーザー登録 500 5
    - listitem "A278 診断サークル278 診断商品278": A278 診断サークル278 診断商品278 ユーザー登録 500 5
    - listitem "A279 診断サークル279 診断商品279": A279 診断サークル279 診断商品279 ユーザー登録 500 5
    - listitem "A280 診断サークル280 診断商品280": A280 診断サークル280 診断商品280 ユーザー登録 500 5
    - listitem "A281 診断サークル281 診断商品281": A281 診断サークル281 診断商品281 ユーザー登録 500 5
    - listitem "A282 診断サークル282 診断商品282": A282 診断サークル282 診断商品282 ユーザー登録 500 5
    - listitem "A283 診断サークル283 診断商品283": A283 診断サークル283 診断商品283 ユーザー登録 500 5
    - listitem "A284 診断サークル284 診断商品284": A284 診断サークル284 診断商品284 ユーザー登録 500 5
    - listitem "A285 診断サークル285 診断商品285": A285 診断サークル285 診断商品285 ユーザー登録 500 5
    - listitem "A286 診断サークル286 診断商品286": A286 診断サークル286 診断商品286 ユーザー登録 500 5
    - listitem "A287 診断サークル287 診断商品287": A287 診断サークル287 診断商品287 ユーザー登録 500 5
    - listitem "A288 診断サークル288 診断商品288": A288 診断サークル288 診断商品288 ユーザー登録 500 5
    - listitem "A289 診断サークル289 診断商品289": A289 診断サークル289 診断商品289 ユーザー登録 500 5
    - listitem "A290 診断サークル290 診断商品290": A290 診断サークル290 診断商品290 ユーザー登録 500 5
    - listitem "A291 診断サークル291 診断商品291": A291 診断サークル291 診断商品291 ユーザー登録 500 5
    - listitem "A292 診断サークル292 診断商品292": A292 診断サークル292 診断商品292 ユーザー登録 500 5
    - listitem "A293 診断サークル293 診断商品293": A293 診断サークル293 診断商品293 ユーザー登録 500 5
    - listitem "A294 診断サークル294 診断商品294": A294 診断サークル294 診断商品294 ユーザー登録 500 5
    - listitem "A295 診断サークル295 診断商品295": A295 診断サークル295 診断商品295 ユーザー登録 500 5
    - listitem "A296 診断サークル296 診断商品296": A296 診断サークル296 診断商品296 ユーザー登録 500 5
    - listitem "A297 診断サークル297 診断商品297": A297 診断サークル297 診断商品297 ユーザー登録 500 5
    - listitem "A298 診断サークル298 診断商品298": A298 診断サークル298 診断商品298 ユーザー登録 500 5
    - listitem "A299 診断サークル299 診断商品299": A299 診断サークル299 診断商品299 ユーザー登録 500 5
    - listitem "A300 診断サークル300 診断商品300": A300 診断サークル300 診断商品300 ユーザー登録 500 5
    - listitem "A301 診断サークル301 診断商品301": A301 診断サークル301 診断商品301 ユーザー登録 500 5
    - listitem "A302 診断サークル302 診断商品302": A302 診断サークル302 診断商品302 ユーザー登録 500 5
    - listitem "A303 診断サークル303 診断商品303": A303 診断サークル303 診断商品303 ユーザー登録 500 5
    - listitem "A304 診断サークル304 診断商品304": A304 診断サークル304 診断商品304 ユーザー登録 500 5
    - listitem "A305 診断サークル305 診断商品305": A305 診断サークル305 診断商品305 ユーザー登録 500 5
    - listitem "A306 診断サークル306 診断商品306": A306 診断サークル306 診断商品306 ユーザー登録 500 5
    - listitem "A307 診断サークル307 診断商品307": A307 診断サークル307 診断商品307 ユーザー登録 500 5
    - listitem "A308 診断サークル308 診断商品308": A308 診断サークル308 診断商品308 ユーザー登録 500 5
    - listitem "A309 診断サークル309 診断商品309": A309 診断サークル309 診断商品309 ユーザー登録 500 5
    - listitem "A310 診断サークル310 診断商品310": A310 診断サークル310 診断商品310 ユーザー登録 500 5
    - listitem "A311 診断サークル311 診断商品311": A311 診断サークル311 診断商品311 ユーザー登録 500 5
    - listitem "A312 診断サークル312 診断商品312": A312 診断サークル312 診断商品312 ユーザー登録 500 5
    - listitem "A313 診断サークル313 診断商品313": A313 診断サークル313 診断商品313 ユーザー登録 500 5
    - listitem "A314 診断サークル314 診断商品314": A314 診断サークル314 診断商品314 ユーザー登録 500 5
    - listitem "A315 診断サークル315 診断商品315": A315 診断サークル315 診断商品315 ユーザー登録 500 5
    - listitem "A316 診断サークル316 診断商品316": A316 診断サークル316 診断商品316 ユーザー登録 500 5
    - listitem "A317 診断サークル317 診断商品317": A317 診断サークル317 診断商品317 ユーザー登録 500 5
    - listitem "A318 診断サークル318 診断商品318": A318 診断サークル318 診断商品318 ユーザー登録 500 5
    - listitem "A319 診断サークル319 診断商品319": A319 診断サークル319 診断商品319 ユーザー登録 500 5
    - listitem "A320 診断サークル320 診断商品320": A320 診断サークル320 診断商品320 ユーザー登録 500 5
    - listitem "A321 診断サークル321 診断商品321": A321 診断サークル321 診断商品321 ユーザー登録 500 5
    - listitem "A322 診断サークル322 診断商品322": A322 診断サークル322 診断商品322 ユーザー登録 500 5
    - listitem "A323 診断サークル323 診断商品323": A323 診断サークル323 診断商品323 ユーザー登録 500 5
    - listitem "A324 診断サークル324 診断商品324": A324 診断サークル324 診断商品324 ユーザー登録 500 5
    - listitem "A325 診断サークル325 診断商品325": A325 診断サークル325 診断商品325 ユーザー登録 500 5
    - listitem "A326 診断サークル326 診断商品326": A326 診断サークル326 診断商品326 ユーザー登録 500 5
    - listitem "A327 診断サークル327 診断商品327": A327 診断サークル327 診断商品327 ユーザー登録 500 5
    - listitem "A328 診断サークル328 診断商品328": A328 診断サークル328 診断商品328 ユーザー登録 500 5
    - listitem "A329 診断サークル329 診断商品329": A329 診断サークル329 診断商品329 ユーザー登録 500 5
    - listitem "A330 診断サークル330 診断商品330": A330 診断サークル330 診断商品330 ユーザー登録 500 5
    - listitem "A331 診断サークル331 診断商品331": A331 診断サークル331 診断商品331 ユーザー登録 500 5
    - listitem "A332 診断サークル332 診断商品332": A332 診断サークル332 診断商品332 ユーザー登録 500 5
    - listitem "A333 診断サークル333 診断商品333": A333 診断サークル333 診断商品333 ユーザー登録 500 5
    - listitem "A334 診断サークル334 診断商品334": A334 診断サークル334 診断商品334 ユーザー登録 500 5
    - listitem "A335 診断サークル335 診断商品335": A335 診断サークル335 診断商品335 ユーザー登録 500 5
    - listitem "A336 診断サークル336 診断商品336": A336 診断サークル336 診断商品336 ユーザー登録 500 5
    - listitem "A337 診断サークル337 診断商品337": A337 診断サークル337 診断商品337 ユーザー登録 500 5
    - listitem "A338 診断サークル338 診断商品338": A338 診断サークル338 診断商品338 ユーザー登録 500 5
    - listitem "A339 診断サークル339 診断商品339": A339 診断サークル339 診断商品339 ユーザー登録 500 5
    - listitem "A340 診断サークル340 診断商品340": A340 診断サークル340 診断商品340 ユーザー登録 500 5
    - listitem "A341 診断サークル341 診断商品341": A341 診断サークル341 診断商品341 ユーザー登録 500 5
    - listitem "A342 診断サークル342 診断商品342": A342 診断サークル342 診断商品342 ユーザー登録 500 5
    - listitem "A343 診断サークル343 診断商品343": A343 診断サークル343 診断商品343 ユーザー登録 500 5
    - listitem "A344 診断サークル344 診断商品344": A344 診断サークル344 診断商品344 ユーザー登録 500 5
    - listitem "A345 診断サークル345 診断商品345": A345 診断サークル345 診断商品345 ユーザー登録 500 5
    - listitem "A346 診断サークル346 診断商品346": A346 診断サークル346 診断商品346 ユーザー登録 500 5
    - listitem "A347 診断サークル347 診断商品347": A347 診断サークル347 診断商品347 ユーザー登録 500 5
    - listitem "A348 診断サークル348 診断商品348": A348 診断サークル348 診断商品348 ユーザー登録 500 5
    - listitem "A349 診断サークル349 診断商品349": A349 診断サークル349 診断商品349 ユーザー登録 500 5
    - listitem "A350 診断サークル350 診断商品350": A350 診断サークル350 診断商品350 ユーザー登録 500 5
    - listitem "A351 診断サークル351 診断商品351": A351 診断サークル351 診断商品351 ユーザー登録 500 5
    - listitem "A352 診断サークル352 診断商品352": A352 診断サークル352 診断商品352 ユーザー登録 500 5
    - listitem "A353 診断サークル353 診断商品353": A353 診断サークル353 診断商品353 ユーザー登録 500 5
    - listitem "A354 診断サークル354 診断商品354": A354 診断サークル354 診断商品354 ユーザー登録 500 5
    - listitem "A355 診断サークル355 診断商品355": A355 診断サークル355 診断商品355 ユーザー登録 500 5
    - listitem "A356 診断サークル356 診断商品356": A356 診断サークル356 診断商品356 ユーザー登録 500 5
    - listitem "A357 診断サークル357 診断商品357": A357 診断サークル357 診断商品357 ユーザー登録 500 5
    - listitem "A358 診断サークル358 診断商品358": A358 診断サークル358 診断商品358 ユーザー登録 500 5
    - listitem "A359 診断サークル359 診断商品359": A359 診断サークル359 診断商品359 ユーザー登録 500 5
    - listitem "A360 診断サークル360 診断商品360": A360 診断サークル360 診断商品360 ユーザー登録 500 5
    - listitem "A361 診断サークル361 診断商品361": A361 診断サークル361 診断商品361 ユーザー登録 500 5
    - listitem "A362 診断サークル362 診断商品362": A362 診断サークル362 診断商品362 ユーザー登録 500 5
    - listitem "A363 診断サークル363 診断商品363": A363 診断サークル363 診断商品363 ユーザー登録 500 5
    - listitem "A364 診断サークル364 診断商品364": A364 診断サークル364 診断商品364 ユーザー登録 500 5
    - listitem "A365 診断サークル365 診断商品365": A365 診断サークル365 診断商品365 ユーザー登録 500 5
    - listitem "A366 診断サークル366 診断商品366": A366 診断サークル366 診断商品366 ユーザー登録 500 5
    - listitem "A367 診断サークル367 診断商品367": A367 診断サークル367 診断商品367 ユーザー登録 500 5
    - listitem "A368 診断サークル368 診断商品368": A368 診断サークル368 診断商品368 ユーザー登録 500 5
    - listitem "A369 診断サークル369 診断商品369": A369 診断サークル369 診断商品369 ユーザー登録 500 5
    - listitem "A370 診断サークル370 診断商品370": A370 診断サークル370 診断商品370 ユーザー登録 500 5
    - listitem "A371 診断サークル371 診断商品371": A371 診断サークル371 診断商品371 ユーザー登録 500 5
    - listitem "A372 診断サークル372 診断商品372": A372 診断サークル372 診断商品372 ユーザー登録 500 5
    - listitem "A373 診断サークル373 診断商品373": A373 診断サークル373 診断商品373 ユーザー登録 500 5
    - listitem "A374 診断サークル374 診断商品374": A374 診断サークル374 診断商品374 ユーザー登録 500 5
    - listitem "A375 診断サークル375 診断商品375": A375 診断サークル375 診断商品375 ユーザー登録 500 5
    - listitem "A376 診断サークル376 診断商品376": A376 診断サークル376 診断商品376 ユーザー登録 500 5
    - listitem "A377 診断サークル377 診断商品377": A377 診断サークル377 診断商品377 ユーザー登録 500 5
    - listitem "A378 診断サークル378 診断商品378": A378 診断サークル378 診断商品378 ユーザー登録 500 5
    - listitem "A379 診断サークル379 診断商品379": A379 診断サークル379 診断商品379 ユーザー登録 500 5
    - listitem "A380 診断サークル380 診断商品380": A380 診断サークル380 診断商品380 ユーザー登録 500 5
    - listitem "A381 診断サークル381 診断商品381": A381 診断サークル381 診断商品381 ユーザー登録 500 5
    - listitem "A382 診断サークル382 診断商品382": A382 診断サークル382 診断商品382 ユーザー登録 500 5
    - listitem "A383 診断サークル383 診断商品383": A383 診断サークル383 診断商品383 ユーザー登録 500 5
    - listitem "A384 診断サークル384 診断商品384": A384 診断サークル384 診断商品384 ユーザー登録 500 5
    - listitem "A385 診断サークル385 診断商品385": A385 診断サークル385 診断商品385 ユーザー登録 500 5
    - listitem "A386 診断サークル386 診断商品386": A386 診断サークル386 診断商品386 ユーザー登録 500 5
    - listitem "A387 診断サークル387 診断商品387": A387 診断サークル387 診断商品387 ユーザー登録 500 5
    - listitem "A388 診断サークル388 診断商品388": A388 診断サークル388 診断商品388 ユーザー登録 500 5
    - listitem "A389 診断サークル389 診断商品389": A389 診断サークル389 診断商品389 ユーザー登録 500 5
    - listitem "A390 診断サークル390 診断商品390": A390 診断サークル390 診断商品390 ユーザー登録 500 5
    - listitem "A391 診断サークル391 診断商品391": A391 診断サークル391 診断商品391 ユーザー登録 500 5
    - listitem "A392 診断サークル392 診断商品392": A392 診断サークル392 診断商品392 ユーザー登録 500 5
    - listitem "A393 診断サークル393 診断商品393": A393 診断サークル393 診断商品393 ユーザー登録 500 5
    - listitem "A394 診断サークル394 診断商品394": A394 診断サークル394 診断商品394 ユーザー登録 500 5
    - listitem "A395 診断サークル395 診断商品395": A395 診断サークル395 診断商品395 ユーザー登録 500 5
    - listitem "A396 診断サークル396 診断商品396": A396 診断サークル396 診断商品396 ユーザー登録 500 5
    - listitem "A397 診断サークル397 診断商品397": A397 診断サークル397 診断商品397 ユーザー登録 500 5
    - listitem "A398 診断サークル398 診断商品398": A398 診断サークル398 診断商品398 ユーザー登録 500 5
    - listitem "A399 診断サークル399 診断商品399": A399 診断サークル399 診断商品399 ユーザー登録 500 5
    - listitem "A400 診断サークル400 診断商品400": A400 診断サークル400 診断商品400 ユーザー登録 500 5
    - listitem "A401 診断サークル401 診断商品401": A401 診断サークル401 診断商品401 ユーザー登録 500 5
    - listitem "A402 診断サークル402 診断商品402": A402 診断サークル402 診断商品402 ユーザー登録 500 5
    - listitem "A403 診断サークル403 診断商品403": A403 診断サークル403 診断商品403 ユーザー登録 500 5
    - listitem "A404 診断サークル404 診断商品404": A404 診断サークル404 診断商品404 ユーザー登録 500 5
    - listitem "A405 診断サークル405 診断商品405": A405 診断サークル405 診断商品405 ユーザー登録 500 5
    - listitem "A406 診断サークル406 診断商品406": A406 診断サークル406 診断商品406 ユーザー登録 500 5
    - listitem "A407 診断サークル407 診断商品407": A407 診断サークル407 診断商品407 ユーザー登録 500 5
    - listitem "A408 診断サークル408 診断商品408": A408 診断サークル408 診断商品408 ユーザー登録 500 5
    - listitem "A409 診断サークル409 診断商品409": A409 診断サークル409 診断商品409 ユーザー登録 500 5
    - listitem "A410 診断サークル410 診断商品410": A410 診断サークル410 診断商品410 ユーザー登録 500 5
    - listitem "A411 診断サークル411 診断商品411": A411 診断サークル411 診断商品411 ユーザー登録 500 5
    - listitem "A412 診断サークル412 診断商品412": A412 診断サークル412 診断商品412 ユーザー登録 500 5
    - listitem "A413 診断サークル413 診断商品413": A413 診断サークル413 診断商品413 ユーザー登録 500 5
    - listitem "A414 診断サークル414 診断商品414": A414 診断サークル414 診断商品414 ユーザー登録 500 5
    - listitem "A415 診断サークル415 診断商品415": A415 診断サークル415 診断商品415 ユーザー登録 500 5
    - listitem "A416 診断サークル416 診断商品416": A416 診断サークル416 診断商品416 ユーザー登録 500 5
    - listitem "A417 診断サークル417 診断商品417": A417 診断サークル417 診断商品417 ユーザー登録 500 5
    - listitem "A418 診断サークル418 診断商品418": A418 診断サークル418 診断商品418 ユーザー登録 500 5
    - listitem "A419 診断サークル419 診断商品419": A419 診断サークル419 診断商品419 ユーザー登録 500 5
    - listitem "A420 診断サークル420 診断商品420": A420 診断サークル420 診断商品420 ユーザー登録 500 5
    - listitem "A421 診断サークル421 診断商品421": A421 診断サークル421 診断商品421 ユーザー登録 500 5
    - listitem "A422 診断サークル422 診断商品422": A422 診断サークル422 診断商品422 ユーザー登録 500 5
    - listitem "A423 診断サークル423 診断商品423": A423 診断サークル423 診断商品423 ユーザー登録 500 5
    - listitem "A424 診断サークル424 診断商品424": A424 診断サークル424 診断商品424 ユーザー登録 500 5
    - listitem "A425 診断サークル425 診断商品425": A425 診断サークル425 診断商品425 ユーザー登録 500 5
    - listitem "A426 診断サークル426 診断商品426": A426 診断サークル426 診断商品426 ユーザー登録 500 5
    - listitem "A427 診断サークル427 診断商品427": A427 診断サークル427 診断商品427 ユーザー登録 500 5
    - listitem "A428 診断サークル428 診断商品428": A428 診断サークル428 診断商品428 ユーザー登録 500 5
    - listitem "A429 診断サークル429 診断商品429": A429 診断サークル429 診断商品429 ユーザー登録 500 5
    - listitem "A430 診断サークル430 診断商品430": A430 診断サークル430 診断商品430 ユーザー登録 500 5
    - listitem "A431 診断サークル431 診断商品431": A431 診断サークル431 診断商品431 ユーザー登録 500 5
    - listitem "A432 診断サークル432 診断商品432": A432 診断サークル432 診断商品432 ユーザー登録 500 5
    - listitem "A433 診断サークル433 診断商品433": A433 診断サークル433 診断商品433 ユーザー登録 500 5
    - listitem "A434 診断サークル434 診断商品434": A434 診断サークル434 診断商品434 ユーザー登録 500 5
    - listitem "A435 診断サークル435 診断商品435": A435 診断サークル435 診断商品435 ユーザー登録 500 5
    - listitem "A436 診断サークル436 診断商品436": A436 診断サークル436 診断商品436 ユーザー登録 500 5
    - listitem "A437 診断サークル437 診断商品437": A437 診断サークル437 診断商品437 ユーザー登録 500 5
    - listitem "A438 診断サークル438 診断商品438": A438 診断サークル438 診断商品438 ユーザー登録 500 5
    - listitem "A439 診断サークル439 診断商品439": A439 診断サークル439 診断商品439 ユーザー登録 500 5
    - listitem "A440 診断サークル440 診断商品440": A440 診断サークル440 診断商品440 ユーザー登録 500 5
    - listitem "A441 診断サークル441 診断商品441": A441 診断サークル441 診断商品441 ユーザー登録 500 5
    - listitem "A442 診断サークル442 診断商品442": A442 診断サークル442 診断商品442 ユーザー登録 500 5
    - listitem "A443 診断サークル443 診断商品443": A443 診断サークル443 診断商品443 ユーザー登録 500 5
    - listitem "A444 診断サークル444 診断商品444": A444 診断サークル444 診断商品444 ユーザー登録 500 5
    - listitem "A445 診断サークル445 診断商品445": A445 診断サークル445 診断商品445 ユーザー登録 500 5
    - listitem "A446 診断サークル446 診断商品446": A446 診断サークル446 診断商品446 ユーザー登録 500 5
    - listitem "A447 診断サークル447 診断商品447": A447 診断サークル447 診断商品447 ユーザー登録 500 5
    - listitem "A448 診断サークル448 診断商品448": A448 診断サークル448 診断商品448 ユーザー登録 500 5
    - listitem "A449 診断サークル449 診断商品449": A449 診断サークル449 診断商品449 ユーザー登録 500 5
    - listitem "A450 診断サークル450 診断商品450": A450 診断サークル450 診断商品450 ユーザー登録 500 5
    - listitem "A451 診断サークル451 診断商品451": A451 診断サークル451 診断商品451 ユーザー登録 500 5
    - listitem "A452 診断サークル452 診断商品452": A452 診断サークル452 診断商品452 ユーザー登録 500 5
    - listitem "A453 診断サークル453 診断商品453": A453 診断サークル453 診断商品453 ユーザー登録 500 5
    - listitem "A454 診断サークル454 診断商品454": A454 診断サークル454 診断商品454 ユーザー登録 500 5
    - listitem "A455 診断サークル455 診断商品455": A455 診断サークル455 診断商品455 ユーザー登録 500 5
    - listitem "A456 診断サークル456 診断商品456": A456 診断サークル456 診断商品456 ユーザー登録 500 5
    - listitem "A457 診断サークル457 診断商品457": A457 診断サークル457 診断商品457 ユーザー登録 500 5
    - listitem "A458 診断サークル458 診断商品458": A458 診断サークル458 診断商品458 ユーザー登録 500 5
    - listitem "A459 診断サークル459 診断商品459": A459 診断サークル459 診断商品459 ユーザー登録 500 5
    - listitem "A460 診断サークル460 診断商品460": A460 診断サークル460 診断商品460 ユーザー登録 500 5
    - listitem "A461 診断サークル461 診断商品461": A461 診断サークル461 診断商品461 ユーザー登録 500 5
    - listitem "A462 診断サークル462 診断商品462": A462 診断サークル462 診断商品462 ユーザー登録 500 5
    - listitem "A463 診断サークル463 診断商品463": A463 診断サークル463 診断商品463 ユーザー登録 500 5
    - listitem "A464 診断サークル464 診断商品464": A464 診断サークル464 診断商品464 ユーザー登録 500 5
    - listitem "A465 診断サークル465 診断商品465": A465 診断サークル465 診断商品465 ユーザー登録 500 5
    - listitem "A466 診断サークル466 診断商品466": A466 診断サークル466 診断商品466 ユーザー登録 500 5
    - listitem "A467 診断サークル467 診断商品467": A467 診断サークル467 診断商品467 ユーザー登録 500 5
    - listitem "A468 診断サークル468 診断商品468": A468 診断サークル468 診断商品468 ユーザー登録 500 5
    - listitem "A469 診断サークル469 診断商品469": A469 診断サークル469 診断商品469 ユーザー登録 500 5
    - listitem "A470 診断サークル470 診断商品470": A470 診断サークル470 診断商品470 ユーザー登録 500 5
    - listitem "A471 診断サークル471 診断商品471": A471 診断サークル471 診断商品471 ユーザー登録 500 5
    - listitem "A472 診断サークル472 診断商品472": A472 診断サークル472 診断商品472 ユーザー登録 500 5
    - listitem "A473 診断サークル473 診断商品473": A473 診断サークル473 診断商品473 ユーザー登録 500 5
    - listitem "A474 診断サークル474 診断商品474": A474 診断サークル474 診断商品474 ユーザー登録 500 5
    - listitem "A475 診断サークル475 診断商品475": A475 診断サークル475 診断商品475 ユーザー登録 500 5
    - listitem "A476 診断サークル476 診断商品476": A476 診断サークル476 診断商品476 ユーザー登録 500 5
    - listitem "A477 診断サークル477 診断商品477": A477 診断サークル477 診断商品477 ユーザー登録 500 5
    - listitem "A478 診断サークル478 診断商品478": A478 診断サークル478 診断商品478 ユーザー登録 500 5
    - listitem "A479 診断サークル479 診断商品479": A479 診断サークル479 診断商品479 ユーザー登録 500 5
    - listitem "A480 診断サークル480 診断商品480": A480 診断サークル480 診断商品480 ユーザー登録 500 5
    - listitem "A481 診断サークル481 診断商品481": A481 診断サークル481 診断商品481 ユーザー登録 500 5
    - listitem "A482 診断サークル482 診断商品482": A482 診断サークル482 診断商品482 ユーザー登録 500 5
    - listitem "A483 診断サークル483 診断商品483": A483 診断サークル483 診断商品483 ユーザー登録 500 5
    - listitem "A484 診断サークル484 診断商品484": A484 診断サークル484 診断商品484 ユーザー登録 500 5
    - listitem "A485 診断サークル485 診断商品485": A485 診断サークル485 診断商品485 ユーザー登録 500 5
    - listitem "A486 診断サークル486 診断商品486": A486 診断サークル486 診断商品486 ユーザー登録 500 5
    - listitem "A487 診断サークル487 診断商品487": A487 診断サークル487 診断商品487 ユーザー登録 500 5
    - listitem "A488 診断サークル488 診断商品488": A488 診断サークル488 診断商品488 ユーザー登録 500 5
    - listitem "A489 診断サークル489 診断商品489": A489 診断サークル489 診断商品489 ユーザー登録 500 5
    - listitem "A490 診断サークル490 診断商品490": A490 診断サークル490 診断商品490 ユーザー登録 500 5
    - listitem "A491 診断サークル491 診断商品491": A491 診断サークル491 診断商品491 ユーザー登録 500 5
    - listitem "A492 診断サークル492 診断商品492": A492 診断サークル492 診断商品492 ユーザー登録 500 5
    - listitem "A493 診断サークル493 診断商品493": A493 診断サークル493 診断商品493 ユーザー登録 500 5
    - listitem "A494 診断サークル494 診断商品494": A494 診断サークル494 診断商品494 ユーザー登録 500 5
    - listitem "A495 診断サークル495 診断商品495": A495 診断サークル495 診断商品495 ユーザー登録 500 5
    - listitem "A496 診断サークル496 診断商品496": A496 診断サークル496 診断商品496 ユーザー登録 500 5
    - listitem "A497 診断サークル497 診断商品497": A497 診断サークル497 診断商品497 ユーザー登録 500 5
    - listitem "A498 診断サークル498 診断商品498": A498 診断サークル498 診断商品498 ユーザー登録 500 5
  - heading "候補アイテム" [level=2]
  - paragraph: このリストから選択したアイテムを実行リストへ移動します。
  - list "買い物リスト"
- status "保存済み"
- dialog "限数購入の数量":
  - heading "限数購入の数量" [level=3]
  - paragraph: "対象: 診断商品3"
  - text: 実購入数
  - textbox "実購入数"
  - text: 購入予定量
  - textbox "購入予定量": "1"
  - paragraph: 限数として保存するには、購入予定数を2以上に変更してください。
  - button "この商品を後で入力"
  - button "キャンセル"
  - button "保存"
```

# Test source

```ts
  262 |           name: "実購入数",
  263 |           exact: true,
  264 |         });
  265 |         observations.radialInputFocused.push(
  266 |           await actual.evaluate((input) => document.activeElement === input),
  267 |         );
  268 |         if (phase === "after") await expect(actual).toBeFocused();
  269 |         add(
  270 |           timings,
  271 |           "limited-quantity-input",
  272 |           await inputResponse(
  273 |             main.getByRole("textbox", { name: "実購入数", exact: true }),
  274 |             "5",
  275 |           ),
  276 |         );
  277 |         add(
  278 |           timings,
  279 |           "limited-confirm-open",
  280 |           await clickResponse(
  281 |             main.getByRole("button", { name: "保存", exact: true }),
  282 |           ),
  283 |         );
  284 |         await expect(confirmation).toBeVisible();
  285 |         add(
  286 |           timings,
  287 |           "limited-confirm-return",
  288 |           await clickResponse(
  289 |             confirmation.getByRole("button", {
  290 |               name: "入力に戻る",
  291 |               exact: true,
  292 |             }),
  293 |           ),
  294 |         );
  295 |         await expect(confirmation).toBeHidden();
  296 |         add(
  297 |           timings,
  298 |           "limited-cancel",
  299 |           await clickResponse(
  300 |             main.getByRole("button", { name: "キャンセル", exact: true }),
  301 |           ),
  302 |         );
  303 |         await expect(main).toBeHidden();
  304 |       }
  305 |       // Model an already accepted same-screen quantity update arriving during confirmation.
  306 |       // The real card handler and persistence worker process the change; no app state is injected.
  307 |       for (let sample = 0; sample < 21; sample++) {
  308 |         await row
  309 |           .getByRole("combobox", { name: "購入予定数量", exact: true })
  310 |           .selectOption("5");
  311 |         await clickResponse(status);
  312 |         await clickResponse(radialLimited);
  313 |         await inputResponse(
  314 |           main.getByRole("textbox", { name: "実購入数", exact: true }),
  315 |           "5",
  316 |         );
  317 |         await main.getByRole("button", { name: "保存", exact: true }).click();
  318 |         await expect(confirmation).toBeVisible();
  319 |         const started = await page.evaluate(() => performance.now());
  320 |         add(
  321 |           timings,
  322 |           "same-screen-confirmation-invalidation",
  323 |           await changeQuantityResponse(
  324 |             row.getByRole("combobox", { name: "購入予定数量", exact: true }),
  325 |             "6",
  326 |           ),
  327 |         );
  328 |         await expect(confirmation).toBeHidden();
  329 |         const actual = main.getByRole("textbox", {
  330 |           name: "実購入数",
  331 |           exact: true,
  332 |         });
  333 |         observations.invalidationInputFocused.push(
  334 |           await actual.evaluate((input) => document.activeElement === input),
  335 |         );
  336 |         if (phase === "after") await expect(actual).toBeFocused();
  337 |         await expect
  338 |           .poll(async () => (await durableItem(page, "diagnostic-0")).quantity)
  339 |           .toBe(6);
  340 |         add(
  341 |           completion,
  342 |           "same-screen-quantity-save",
  343 |           (await page.evaluate(() => performance.now())) - started,
  344 |         );
  345 |         await main
  346 |           .getByRole("button", { name: "キャンセル", exact: true })
  347 |           .click();
  348 |       }
  349 |       const single = page.locator('[data-item-id="diagnostic-3"]');
  350 |       const choice = page.getByRole("dialog", {
  351 |         name: "限数にしますか？",
  352 |         exact: true,
  353 |       });
  354 |       for (let sample = 0; sample < 21; sample++) {
  355 |         await single.scrollIntoViewIfNeeded();
  356 |         await single.getByRole("button", { name: /Current status:/ }).click();
  357 |         add(
  358 |           timings,
  359 |           "radial-to-single-choice",
  360 |           await clickResponse(radialLimited),
  361 |         );
> 362 |         await expect(choice).toBeVisible();
      |                              ^ Error: expect(locator).toBeVisible() failed
  363 |         add(
  364 |           timings,
  365 |           "single-choice-to-limited",
  366 |           await clickResponse(
  367 |             choice.getByRole("button", { name: "限数", exact: true }),
  368 |           ),
  369 |         );
  370 |         await expect(main).toBeVisible();
  371 |         add(
  372 |           timings,
  373 |           "single-choice-limited-cancel",
  374 |           await clickResponse(
  375 |             main.getByRole("button", { name: "キャンセル", exact: true }),
  376 |           ),
  377 |         );
  378 |         await expect(main).toBeHidden();
  379 |       }
  380 |       await row
  381 |         .getByRole("combobox", { name: "購入予定数量", exact: true })
  382 |         .selectOption("5");
  383 |       await page.getByTitle("集中モード", { exact: true }).click();
  384 |       for (let sample = 0; sample < 21; sample++) {
  385 |         if (sample > 0) {
  386 |           await status.click();
  387 |           await page
  388 |             .getByRole("radio", { name: "Noneに変更", exact: true })
  389 |             .click();
  390 |           await expect
  391 |             .poll(
  392 |               async () =>
  393 |                 (await durableItem(page, "diagnostic-0")).purchaseStatus,
  394 |             )
  395 |             .toBe("None");
  396 |         }
  397 |         add(
  398 |           timings,
  399 |           "bulk-limited-open",
  400 |           await clickResponse(
  401 |             page.getByRole("button", { name: "全限数", exact: true }).first(),
  402 |           ),
  403 |         );
  404 |         await expect(main).toContainText("診断商品0");
  405 |         await inputResponse(
  406 |           main.getByRole("textbox", { name: "実購入数", exact: true }),
  407 |           "2",
  408 |         );
  409 |         const started = await page.evaluate(() => performance.now());
  410 |         add(
  411 |           timings,
  412 |           "bulk-limited-save-next",
  413 |           await clickResponse(
  414 |             main.getByRole("button", { name: "保存", exact: true }),
  415 |           ),
  416 |         );
  417 |         await expect(main).toContainText("診断商品1");
  418 |         const nextActual = main.getByRole("textbox", {
  419 |           name: "実購入数",
  420 |           exact: true,
  421 |         });
  422 |         observations.bulkNextInputFocused.push(
  423 |           await nextActual.evaluate(
  424 |             (input) => document.activeElement === input,
  425 |           ),
  426 |         );
  427 |         if (phase === "after") await expect(nextActual).toBeFocused();
  428 |         await expect
  429 |           .poll(
  430 |             async () =>
  431 |               (await durableItem(page, "diagnostic-0"))
  432 |                 .limitedPurchasedQuantity,
  433 |           )
  434 |           .toBe(2);
  435 |         add(
  436 |           completion,
  437 |           "bulk-limited-save",
  438 |           (await page.evaluate(() => performance.now())) - started,
  439 |         );
  440 |         await main
  441 |           .getByRole("button", { name: "キャンセル", exact: true })
  442 |           .click();
  443 |       }
  444 |       await page.getByTitle("編集モード", { exact: true }).click();
  445 |       await page.getByTitle("マップ表示に切り替え", { exact: true }).click();
  446 |       const popup = page.getByRole("dialog", {
  447 |         name: "A-1のアイテム一覧",
  448 |         exact: true,
  449 |       });
  450 |       for (let sample = 0; sample < 21; sample++) {
  451 |         await page.getByRole("button", { name: /^1日目/ }).click();
  452 |         await page.locator("canvas").click({ position: { x: 42, y: 42 } });
  453 |         await expect(popup).toBeVisible();
  454 |         add(
  455 |           timings,
  456 |           "day-switch-popup-invalidation",
  457 |           await clickResponse(page.getByRole("button", { name: /^2日目/ })),
  458 |         );
  459 |         const retained = await popup.isVisible();
  460 |         observations.popupRetainedAfterDaySwitch.push(retained);
  461 |         if (phase === "after") await expect(popup).toBeHidden();
  462 |         // The baseline may retain the old popup. Close it explicitly only for preparing the next sample.
```