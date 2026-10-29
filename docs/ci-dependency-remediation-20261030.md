# PR #26の依存検査・脆弱性監査の是正（2026-10-30）

依存使用検査のPlaywright起動元を、標準browser runnerが実際に呼ぶtest:shopping-performance:runへ接続した。CLI所有権、起動文字列、既定configの固定bindingは維持し、Nodeラッパーだから無条件に許可する処理は加えない。

Viteは8.2.0から修正版8.2.4へ更新し、必要なPostCSSを8.5.26へ揃えた。既存Undici overrideは6.29.1／7.30.1／8.12.2へ更新し、Zod4は4.6.6へ限定更新した。React・アプリ本体・並べ替え仕様・性能閾値とサンプル数は変更しない。

修正版の根拠は[ViteのWindows問題](https://github.com/advisories/GHSA-587h-7wmj-h5pm)、[Undiciの修正版](https://github.com/advisories/GHSA-xjj6-f33q-929c)、[Zodのアドバイザリー](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。Vercel CLIを最新版65.7.0へ上げても、backend／Python解析等がZod3.22.4を固定するため解消しない。CLI58.5.1を維持し、Zod3を互換性未確認のZod4へ強制置換しない。

## 修正できていないZod3と期限付き例外

GHSA-mrhx-c7xc-m3w5のZod3問題は未修正であり、無害とは扱わない。CLIのPython manifestやbackend introspectionの配列解析では問題の処理へ到達し得る。一方、本アプリのHTTP入力から直接使われる依存ではなく、通常のPR品質検証は実Vercel deploy／dev／buildを実行しない。

config/audit-waivers.jsonの例外VERCEL-ZOD3-2026-10-30は、Build/Quality所有、2026-11-13T00:00:00Z失効とする。Vercel58.5.1、実際の15依存配置とバージョン、開発用属性、当該GHSAだけに固定する。12件のHigh表示は同じZod問題の依存先への伝播を含むもので、12種類の修正済み問題という意味ではない。

例外は「全Highを許可する」ものにしない。別GHSA、別version/path、未解決の依存グラフ、期限切れ、criticalへの変化を拒否する。本番依存のhigh／criticalは例外にかかわらず失敗させる。通常品質検証でVercel deployを起動せず、信頼できないリポジトリに対してVercel dev/buildを実行しない。上流の互換修正版、依存変更、または期限到来時に再確認する。

旧353f84fのCI失敗run40917253182と元監査は保持する。新しいPRチェックの通過を、Zod3自体の脆弱性修正や計画全体の性能完了へ読み替えない。
