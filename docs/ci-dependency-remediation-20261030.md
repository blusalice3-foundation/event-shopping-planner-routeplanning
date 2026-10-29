# PR #26の依存検査・脆弱性監査の是正（2026-10-30）

依存使用検査のPlaywright起動元を、標準browser runnerが実際に呼ぶtest:shopping-performance:runへ接続した。CLI所有権、起動文字列、既定configの固定bindingは維持し、Nodeラッパーだから無条件に許可する処理は加えない。

Viteは8.2.0から修正版8.2.4へ更新し、必要なPostCSSを8.5.26へ揃えた。既存Undici overrideは6.29.1／7.30.1／8.12.2へ更新し、Zod4は4.6.6へ限定更新した。React・アプリ本体・並べ替え仕様・性能閾値とサンプル数は変更しない。

修正版の根拠は[ViteのWindows問題](https://github.com/advisories/GHSA-587h-7wmj-h5pm)、[Undiciの修正版](https://github.com/advisories/GHSA-xjj6-f33q-929c)、[Zodのアドバイザリー](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。Vercel CLIを最新版65.7.0へ上げても、backend／Python解析等がZod3.22.4を固定するため解消しない。CLI58.5.1を維持し、Zod3を互換性未確認のZod4へ強制置換しない。

## 修正できていないZod3と期限付き例外

GHSA-mrhx-c7xc-m3w5のZod3問題は未修正であり、無害とは扱わない。CLIのPython manifestやbackend introspectionの配列解析では問題の処理へ到達し得る。一方、本アプリのHTTP入力から直接使われる依存ではなく、通常のPR品質検証は実Vercel deploy／dev／buildを実行しない。

config/audit-waivers.jsonの例外VERCEL-ZOD3-2026-10-30は、Build/Quality所有、2026-11-13T00:00:00Z失効とする。Vercel58.5.1、実際の15依存配置とバージョン、開発用属性、当該GHSAだけに固定する。12件のHigh表示は同じZod問題の依存先への伝播を含むもので、12種類の修正済み問題という意味ではない。

例外は「全Highを許可する」ものにしない。別GHSA、別version/path、未解決の依存グラフ、期限切れ、criticalへの変化を拒否する。本番依存のhigh／criticalは例外にかかわらず失敗させる。通常品質検証でVercel deployを起動せず、信頼できないリポジトリに対してVercel dev/buildを実行しない。上流の互換修正版、依存変更、または期限到来時に再確認する。

旧353f84fのCI失敗run40917253182と元監査は保持する。新しいPRチェックの通過を、Zod3自体の脆弱性修正や計画全体の性能完了へ読み替えない。

## coverage付き500群の機能比較

run40923269884では通常Vitestの500placeholder同値テストは5,724msで通ったが、coverage付きでは22,747msとなり15,000msの実行待ち時間を超えた。coverage率の不足ではなく、この1テストのタイムアウトである。

全行のARIA属性を完全な配列として一括比較し、約2,000回の個別matcher呼び出しを避ける。500件、全HTML一致、metadata consumer1回／body0回、挿入・反転・削除、全行のARIA位置・総数の検証は維持する。単独のcoverage付き診断では対象テストが11,367msで通過したが、1件だけの実行なので全体coverageの合格証拠にはしない。

この機能比較テストだけ完走待ち時間を30,000msへ変更する。実際の操作応答時間をassertする性能試験ではないため、shopping65／100ms、range／drag／transfer160／160ms、coverage率、PR各2回／completion各10回は変更しない。製品のrendererコードは変更しない。

## 列間移動のフレーム性能

run40927291107はcoverageを含む先行検査を通過したが、transferの範囲選択500品目・light条件でframe p95が160.623779296875／161.573974609375／168.171875msとなり失敗した。原run・raw・当初の失敗を保持する。実採取sourceはcleanなPR merge152a4eaで、関連HEAD e0bfec2とtreeは一致する。144ケース・576指標（530主指標と46保存補助）・PR各2回のrawを確認し、欠測や算術不整合はなく、超過はこの3件だった。

この範囲選択条件は総500品目から3品目を移動する。移動後に変わる縞模様とブロック背景色が、非移動カードの重い内容のmemoも無効化していた。両方の装飾情報をカードごとの安定したContextへ分離し、既存の外枠とPC情報背景だけで反映する。外側のmemoは両値を引き続き比較し、品目内容や移動ボタンの可否などの変更は本文の更新対象に残す。

ブロック色の適用可否は本文が保持する現在の購入状態から渡す。楽観的更新・保存待ち中の状態、選択色の優先、dark色、従来の背景指定fallback、既存DOMとrefを維持する。同一ブロックの2列から3品目を移す回帰テストで、非対象本文の再描画を省きながら背景・ARIA位置・総数・入力ref・フォーカスが更新されることを確認する。

手元Windowsの4条件・completion各10回は部分診断として独立保存し、Linux CIの合格や全144条件の実装完了へ流用しない。修正後のPR可否はGitHub上の全チェックで確認する。測定終了点・fixture・ウォームアップ・保存整合性・retry 0・既存性能基準は変更しない。

原transfer／dragのPlaywright reportには、表示用metadata.gitDiffとproject側の同じ表示欄だけに既存U+FFFDがあった。元ZIPと展開bytesは一致し、元reportは加工保存しない。独立raw・traceと該当6サンプルの30証拠ファイルは文字コード・ハッシュ・時刻計算を確認し、この表示用metadataの問題を測定値や製品ソースの文字化けへ読み替えない。
