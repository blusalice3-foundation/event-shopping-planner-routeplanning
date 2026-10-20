# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: priority-operation-diagnostics.spec.ts >> priority dialog and scope operations 150 @priority-operation-performance
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
  - button "1日目149"
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