測定比較。反応時間の各欄は n、中央値/95%点（ms）。保存完了時間は反応の合否判定へ含めない。

修正前: `f15552dd999c6c1aab55a6b0ab9c2056bd0fa4ec`。買い物・ソース処理の実装計測: `cb2b22b974a50a0e3cbaae979bfad8789533493c`。更新ブラウザ・最終品質・ロールバック・ビルド: `1d840d6f3aa3c0949ca7eadf1b16b5e9cbc375b4`。全条件の生データ・保存結果・診断別の保存完了時間は comparison.json と固定名raw JSONへ保存。

計測版と最終検証版はsrc treeが一致し、READMEと測定harness以外のgit diff --exit-code終了0を確認。アプリ実装の同一性を示すもので、dist全byte同一を主張しない。source-performance.jsonは静穏時100samplesの記録を変更せず採用。
ブラウザの基準checkoutはf15552dのまま、共通の測定harnessだけを未追跡ファイルとしてコピーしている。実際のgit statusはcomparison.jsonに保存する。CPU/source計測時のclean状態の証跡とは区別する。

| 範囲 | 版 | 条件数 | 操作条件数 | 最少n | 最大中央値ms | 最大95%点ms | 個別判定 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| mandatory-150-500 | before | 16 | 96 | 20 | 43.600 | 49.100 | 全操作通過 |
| mandatory-150-500 | after | 16 | 96 | 20 | 32.800 | 37.300 | 全操作通過 |
| additional-1500 | before | 8 | 48 | 20 | 51.700 | 63.500 | 全操作通過 |
| additional-1500 | after | 8 | 48 | 20 | 45.900 | 50.100 | 全操作通過 |

| 条件tuple | 範囲 | 操作 | 修正前 n;中央値/95%点 | 実装 n;中央値/95%点 | 中央値差ms | 95%点差ms | 前/後判定 |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| n0150__pc__concentrated-0__map-0 | mandatory-150-500 | execute | n=20; 14.500/19.600 | n=20; 13.400/16.000 | -1.100 | -3.600 | 通過/通過 |
| n0150__pc__concentrated-0__map-0 | mandatory-150-500 | executeRecord | n=20; 9.900/11.300 | n=20; 9.600/11.800 | -0.300 | 0.500 | 通過/通過 |
| n0150__pc__concentrated-0__map-0 | mandatory-150-500 | focus | n=22; 12.700/14.500 | n=22; 12.800/14.000 | 0.100 | -0.500 | 通過/通過 |
| n0150__pc__concentrated-0__map-0 | mandatory-150-500 | record | n=20; 10.500/11.500 | n=20; 10.200/11.200 | -0.300 | -0.300 | 通過/通過 |
| n0150__pc__concentrated-0__map-0 | mandatory-150-500 | next | n=41; 12.300/13.600 | n=41; 12.200/13.400 | -0.100 | -0.200 | 通過/通過 |
| n0150__pc__concentrated-0__map-0 | mandatory-150-500 | back | n=20; 12.700/13.900 | n=20; 12.800/14.000 | 0.100 | 0.100 | 通過/通過 |
| n0150__pc__concentrated-0__map-1 | mandatory-150-500 | execute | n=20; 14.000/16.600 | n=20; 13.700/17.100 | -0.300 | 0.500 | 通過/通過 |
| n0150__pc__concentrated-0__map-1 | mandatory-150-500 | executeRecord | n=20; 10.700/12.200 | n=20; 10.000/11.200 | -0.700 | -1.000 | 通過/通過 |
| n0150__pc__concentrated-0__map-1 | mandatory-150-500 | focus | n=22; 15.700/16.900 | n=22; 15.200/16.800 | -0.500 | -0.100 | 通過/通過 |
| n0150__pc__concentrated-0__map-1 | mandatory-150-500 | record | n=20; 12.400/13.900 | n=20; 12.000/13.500 | -0.400 | -0.400 | 通過/通過 |
| n0150__pc__concentrated-0__map-1 | mandatory-150-500 | next | n=41; 16.600/21.300 | n=41; 16.000/18.400 | -0.600 | -2.900 | 通過/通過 |
| n0150__pc__concentrated-0__map-1 | mandatory-150-500 | back | n=20; 16.100/18.000 | n=20; 15.900/18.400 | -0.200 | 0.400 | 通過/通過 |
| n0150__pc__concentrated-1__map-0 | mandatory-150-500 | execute | n=20; 12.100/16.300 | n=20; 12.400/14.800 | 0.300 | -1.500 | 通過/通過 |
| n0150__pc__concentrated-1__map-0 | mandatory-150-500 | executeRecord | n=20; 10.600/11.200 | n=20; 10.200/10.900 | -0.400 | -0.300 | 通過/通過 |
| n0150__pc__concentrated-1__map-0 | mandatory-150-500 | focus | n=21; 12.100/13.200 | n=21; 12.500/14.200 | 0.400 | 1.000 | 通過/通過 |
| n0150__pc__concentrated-1__map-0 | mandatory-150-500 | record | n=20; 9.200/10.000 | n=20; 10.100/11.300 | 0.900 | 1.300 | 通過/通過 |
| n0150__pc__concentrated-1__map-0 | mandatory-150-500 | next | n=21; 11.900/12.700 | n=21; 12.300/14.000 | 0.400 | 1.300 | 通過/通過 |
| n0150__pc__concentrated-1__map-0 | mandatory-150-500 | back | n=20; 15.700/17.200 | n=20; 16.300/17.600 | 0.600 | 0.400 | 通過/通過 |
| n0150__pc__concentrated-1__map-1 | mandatory-150-500 | execute | n=20; 12.300/13.900 | n=20; 12.300/14.000 | 0.000 | 0.100 | 通過/通過 |
| n0150__pc__concentrated-1__map-1 | mandatory-150-500 | executeRecord | n=20; 10.700/11.600 | n=20; 10.100/12.000 | -0.600 | 0.400 | 通過/通過 |
| n0150__pc__concentrated-1__map-1 | mandatory-150-500 | focus | n=21; 14.300/16.200 | n=21; 14.100/15.700 | -0.200 | -0.500 | 通過/通過 |
| n0150__pc__concentrated-1__map-1 | mandatory-150-500 | record | n=20; 12.600/13.200 | n=20; 11.600/12.500 | -1.000 | -0.700 | 通過/通過 |
| n0150__pc__concentrated-1__map-1 | mandatory-150-500 | next | n=21; 24.200/29.900 | n=21; 20.800/25.700 | -3.400 | -4.200 | 通過/通過 |
| n0150__pc__concentrated-1__map-1 | mandatory-150-500 | back | n=20; 18.100/21.200 | n=20; 17.100/18.000 | -1.000 | -3.200 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-0 | mandatory-150-500 | execute | n=20; 14.600/17.500 | n=20; 14.000/17.500 | -0.600 | 0.000 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-0 | mandatory-150-500 | executeRecord | n=20; 10.600/12.400 | n=20; 9.100/10.000 | -1.500 | -2.400 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-0 | mandatory-150-500 | focus | n=22; 12.400/13.900 | n=22; 12.200/13.600 | -0.200 | -0.300 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-0 | mandatory-150-500 | record | n=20; 10.500/11.400 | n=20; 10.000/12.200 | -0.500 | 0.800 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-0 | mandatory-150-500 | next | n=41; 10.800/12.100 | n=41; 10.400/11.900 | -0.400 | -0.200 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-0 | mandatory-150-500 | back | n=20; 10.500/11.300 | n=20; 11.200/13.300 | 0.700 | 2.000 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-1 | mandatory-150-500 | execute | n=20; 14.300/16.600 | n=20; 14.000/15.800 | -0.300 | -0.800 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-1 | mandatory-150-500 | executeRecord | n=20; 10.600/12.900 | n=20; 10.100/12.100 | -0.500 | -0.800 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-1 | mandatory-150-500 | focus | n=22; 13.700/16.600 | n=22; 14.500/16.100 | 0.800 | -0.500 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-1 | mandatory-150-500 | record | n=20; 10.900/12.300 | n=20; 11.500/13.300 | 0.600 | 1.000 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-1 | mandatory-150-500 | next | n=41; 16.600/18.400 | n=41; 12.900/19.800 | -3.700 | 1.400 | 通過/通過 |
| n0150__smartphone__concentrated-0__map-1 | mandatory-150-500 | back | n=20; 16.300/19.100 | n=20; 13.000/17.900 | -3.300 | -1.200 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-0 | mandatory-150-500 | execute | n=20; 12.500/14.400 | n=20; 12.900/15.800 | 0.400 | 1.400 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-0 | mandatory-150-500 | executeRecord | n=20; 11.000/12.000 | n=20; 9.600/10.300 | -1.400 | -1.700 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-0 | mandatory-150-500 | focus | n=21; 11.500/12.900 | n=21; 11.800/13.600 | 0.300 | 0.700 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-0 | mandatory-150-500 | record | n=20; 8.900/10.700 | n=20; 10.300/11.100 | 1.400 | 0.400 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-0 | mandatory-150-500 | next | n=21; 10.800/12.600 | n=21; 13.300/15.000 | 2.500 | 2.400 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-0 | mandatory-150-500 | back | n=20; 12.700/19.600 | n=20; 14.600/19.700 | 1.900 | 0.100 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-1 | mandatory-150-500 | execute | n=20; 12.400/14.200 | n=20; 12.800/14.500 | 0.400 | 0.300 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-1 | mandatory-150-500 | executeRecord | n=20; 10.900/13.000 | n=20; 9.800/10.600 | -1.100 | -2.400 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-1 | mandatory-150-500 | focus | n=21; 13.300/14.800 | n=21; 13.200/15.600 | -0.100 | 0.800 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-1 | mandatory-150-500 | record | n=20; 10.400/11.700 | n=20; 12.000/13.600 | 1.600 | 1.900 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-1 | mandatory-150-500 | next | n=21; 21.000/27.400 | n=21; 16.100/22.300 | -4.900 | -5.100 | 通過/通過 |
| n0150__smartphone__concentrated-1__map-1 | mandatory-150-500 | back | n=20; 18.400/24.100 | n=20; 17.700/21.000 | -0.700 | -3.100 | 通過/通過 |
| n0500__pc__concentrated-0__map-0 | mandatory-150-500 | execute | n=20; 23.600/25.400 | n=20; 17.100/25.100 | -6.500 | -0.300 | 通過/通過 |
| n0500__pc__concentrated-0__map-0 | mandatory-150-500 | executeRecord | n=20; 17.700/21.300 | n=20; 14.200/16.900 | -3.500 | -4.400 | 通過/通過 |
| n0500__pc__concentrated-0__map-0 | mandatory-150-500 | focus | n=22; 12.700/15.800 | n=22; 13.600/15.500 | 0.900 | -0.300 | 通過/通過 |
| n0500__pc__concentrated-0__map-0 | mandatory-150-500 | record | n=20; 10.300/11.800 | n=20; 11.200/12.200 | 0.900 | 0.400 | 通過/通過 |
| n0500__pc__concentrated-0__map-0 | mandatory-150-500 | next | n=41; 12.500/14.300 | n=41; 13.000/14.600 | 0.500 | 0.300 | 通過/通過 |
| n0500__pc__concentrated-0__map-0 | mandatory-150-500 | back | n=20; 12.100/13.400 | n=20; 13.700/15.000 | 1.600 | 1.600 | 通過/通過 |
| n0500__pc__concentrated-0__map-1 | mandatory-150-500 | execute | n=20; 21.100/25.400 | n=20; 17.600/25.200 | -3.500 | -0.200 | 通過/通過 |
| n0500__pc__concentrated-0__map-1 | mandatory-150-500 | executeRecord | n=20; 15.700/18.300 | n=20; 14.300/16.200 | -1.400 | -2.100 | 通過/通過 |
| n0500__pc__concentrated-0__map-1 | mandatory-150-500 | focus | n=22; 17.100/19.700 | n=22; 16.100/18.000 | -1.000 | -1.700 | 通過/通過 |
| n0500__pc__concentrated-0__map-1 | mandatory-150-500 | record | n=20; 13.500/14.300 | n=20; 13.200/14.800 | -0.300 | 0.500 | 通過/通過 |
| n0500__pc__concentrated-0__map-1 | mandatory-150-500 | next | n=41; 21.700/25.800 | n=41; 18.300/21.300 | -3.400 | -4.500 | 通過/通過 |
| n0500__pc__concentrated-0__map-1 | mandatory-150-500 | back | n=20; 19.300/27.300 | n=20; 17.600/19.300 | -1.700 | -8.000 | 通過/通過 |
| n0500__pc__concentrated-1__map-0 | mandatory-150-500 | execute | n=20; 20.200/22.900 | n=20; 16.100/17.600 | -4.100 | -5.300 | 通過/通過 |
| n0500__pc__concentrated-1__map-0 | mandatory-150-500 | executeRecord | n=20; 16.400/22.000 | n=20; 14.500/17.500 | -1.900 | -4.500 | 通過/通過 |
| n0500__pc__concentrated-1__map-0 | mandatory-150-500 | focus | n=21; 13.800/14.900 | n=21; 12.800/14.300 | -1.000 | -0.600 | 通過/通過 |
| n0500__pc__concentrated-1__map-0 | mandatory-150-500 | record | n=20; 11.100/12.900 | n=20; 10.200/13.000 | -0.900 | 0.100 | 通過/通過 |
| n0500__pc__concentrated-1__map-0 | mandatory-150-500 | next | n=21; 13.000/16.000 | n=21; 12.000/13.300 | -1.000 | -2.700 | 通過/通過 |
| n0500__pc__concentrated-1__map-0 | mandatory-150-500 | back | n=20; 22.400/27.800 | n=20; 20.400/21.300 | -2.000 | -6.500 | 通過/通過 |
| n0500__pc__concentrated-1__map-1 | mandatory-150-500 | execute | n=20; 21.400/23.800 | n=20; 14.700/16.000 | -6.700 | -7.800 | 通過/通過 |
| n0500__pc__concentrated-1__map-1 | mandatory-150-500 | executeRecord | n=20; 18.600/20.200 | n=20; 13.300/15.000 | -5.300 | -5.200 | 通過/通過 |
| n0500__pc__concentrated-1__map-1 | mandatory-150-500 | focus | n=21; 17.800/20.800 | n=21; 14.800/19.200 | -3.000 | -1.600 | 通過/通過 |
| n0500__pc__concentrated-1__map-1 | mandatory-150-500 | record | n=20; 16.300/17.800 | n=20; 12.000/13.600 | -4.300 | -4.200 | 通過/通過 |
| n0500__pc__concentrated-1__map-1 | mandatory-150-500 | next | n=21; 43.600/49.100 | n=21; 32.800/37.300 | -10.800 | -11.800 | 通過/通過 |
| n0500__pc__concentrated-1__map-1 | mandatory-150-500 | back | n=20; 27.400/32.900 | n=20; 22.900/27.500 | -4.500 | -5.400 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-0 | mandatory-150-500 | execute | n=20; 21.300/25.300 | n=20; 17.600/20.000 | -3.700 | -5.300 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-0 | mandatory-150-500 | executeRecord | n=20; 15.700/19.300 | n=20; 14.500/16.500 | -1.200 | -2.800 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-0 | mandatory-150-500 | focus | n=22; 12.500/13.800 | n=22; 12.400/13.900 | -0.100 | 0.100 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-0 | mandatory-150-500 | record | n=20; 10.000/12.100 | n=20; 10.800/12.100 | 0.800 | 0.000 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-0 | mandatory-150-500 | next | n=41; 10.800/13.300 | n=41; 10.700/12.200 | -0.100 | -1.100 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-0 | mandatory-150-500 | back | n=20; 10.600/15.200 | n=20; 10.700/11.800 | 0.100 | -3.400 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-1 | mandatory-150-500 | execute | n=20; 21.600/24.800 | n=20; 17.700/20.900 | -3.900 | -3.900 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-1 | mandatory-150-500 | executeRecord | n=20; 16.200/20.600 | n=20; 13.800/16.100 | -2.400 | -4.500 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-1 | mandatory-150-500 | focus | n=22; 15.100/16.600 | n=22; 13.800/17.300 | -1.300 | 0.700 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-1 | mandatory-150-500 | record | n=20; 12.200/13.600 | n=20; 11.800/13.000 | -0.400 | -0.600 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-1 | mandatory-150-500 | next | n=41; 16.400/21.200 | n=41; 16.000/20.400 | -0.400 | -0.800 | 通過/通過 |
| n0500__smartphone__concentrated-0__map-1 | mandatory-150-500 | back | n=20; 15.700/19.700 | n=20; 15.400/20.000 | -0.300 | 0.300 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-0 | mandatory-150-500 | execute | n=20; 20.600/23.700 | n=20; 16.000/18.500 | -4.600 | -5.200 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-0 | mandatory-150-500 | executeRecord | n=20; 16.500/21.100 | n=20; 14.700/16.900 | -1.800 | -4.200 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-0 | mandatory-150-500 | focus | n=21; 13.200/15.100 | n=21; 12.200/14.400 | -1.000 | -0.700 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-0 | mandatory-150-500 | record | n=20; 9.900/12.100 | n=20; 9.400/10.600 | -0.500 | -1.500 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-0 | mandatory-150-500 | next | n=21; 12.800/16.700 | n=21; 10.200/19.300 | -2.600 | 2.600 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-0 | mandatory-150-500 | back | n=20; 20.000/27.500 | n=20; 16.900/25.700 | -3.100 | -1.800 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-1 | mandatory-150-500 | execute | n=20; 19.500/22.500 | n=20; 15.900/17.800 | -3.600 | -4.700 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-1 | mandatory-150-500 | executeRecord | n=20; 18.200/20.300 | n=20; 14.400/17.900 | -3.800 | -2.400 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-1 | mandatory-150-500 | focus | n=21; 15.300/17.500 | n=21; 14.200/15.600 | -1.100 | -1.900 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-1 | mandatory-150-500 | record | n=20; 14.600/16.000 | n=20; 10.800/12.300 | -3.800 | -3.700 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-1 | mandatory-150-500 | next | n=21; 23.600/30.800 | n=21; 20.900/23.600 | -2.700 | -7.200 | 通過/通過 |
| n0500__smartphone__concentrated-1__map-1 | mandatory-150-500 | back | n=20; 28.000/30.700 | n=20; 21.900/30.000 | -6.100 | -0.700 | 通過/通過 |
| n1500__pc__concentrated-0__map-0 | additional-1500 | execute | n=20; 47.200/63.500 | n=20; 38.200/42.000 | -9.000 | -21.500 | 通過/通過 |
| n1500__pc__concentrated-0__map-0 | additional-1500 | executeRecord | n=20; 34.300/40.000 | n=20; 27.600/32.300 | -6.700 | -7.700 | 通過/通過 |
| n1500__pc__concentrated-0__map-0 | additional-1500 | focus | n=22; 15.100/17.900 | n=22; 15.100/17.200 | -0.000 | -0.700 | 通過/通過 |
| n1500__pc__concentrated-0__map-0 | additional-1500 | record | n=20; 12.500/16.400 | n=20; 12.000/13.700 | -0.500 | -2.700 | 通過/通過 |
| n1500__pc__concentrated-0__map-0 | additional-1500 | next | n=41; 16.500/21.200 | n=41; 15.300/17.100 | -1.200 | -4.100 | 通過/通過 |
| n1500__pc__concentrated-0__map-0 | additional-1500 | back | n=20; 16.300/19.900 | n=20; 14.400/15.600 | -1.900 | -4.300 | 通過/通過 |
| n1500__pc__concentrated-0__map-1 | additional-1500 | execute | n=20; 50.500/62.400 | n=20; 38.600/44.500 | -11.900 | -17.900 | 通過/通過 |
| n1500__pc__concentrated-0__map-1 | additional-1500 | executeRecord | n=20; 34.200/41.500 | n=20; 29.000/34.200 | -5.200 | -7.300 | 通過/通過 |
| n1500__pc__concentrated-0__map-1 | additional-1500 | focus | n=22; 24.000/26.800 | n=22; 19.500/21.000 | -4.500 | -5.800 | 通過/通過 |
| n1500__pc__concentrated-0__map-1 | additional-1500 | record | n=20; 19.600/20.600 | n=20; 14.900/15.600 | -4.700 | -5.000 | 通過/通過 |
| n1500__pc__concentrated-0__map-1 | additional-1500 | next | n=41; 27.100/34.200 | n=41; 25.300/28.300 | -1.800 | -5.900 | 通過/通過 |
| n1500__pc__concentrated-0__map-1 | additional-1500 | back | n=20; 26.200/28.700 | n=20; 25.200/28.300 | -1.000 | -0.400 | 通過/通過 |
| n1500__pc__concentrated-1__map-0 | additional-1500 | execute | n=20; 35.500/49.000 | n=20; 35.700/40.500 | 0.200 | -8.500 | 通過/通過 |
| n1500__pc__concentrated-1__map-0 | additional-1500 | executeRecord | n=20; 31.100/37.500 | n=20; 32.000/35.900 | 0.900 | -1.600 | 通過/通過 |
| n1500__pc__concentrated-1__map-0 | additional-1500 | focus | n=21; 17.400/20.300 | n=21; 19.700/21.500 | 2.300 | 1.200 | 通過/通過 |
| n1500__pc__concentrated-1__map-0 | additional-1500 | record | n=20; 15.400/17.200 | n=20; 15.500/16.600 | 0.100 | -0.600 | 通過/通過 |
| n1500__pc__concentrated-1__map-0 | additional-1500 | next | n=21; 16.700/20.400 | n=21; 16.800/19.000 | 0.100 | -1.400 | 通過/通過 |
| n1500__pc__concentrated-1__map-0 | additional-1500 | back | n=20; 37.300/38.900 | n=20; 37.500/41.100 | 0.200 | 2.200 | 通過/通過 |
| n1500__pc__concentrated-1__map-1 | additional-1500 | execute | n=20; 33.400/45.800 | n=20; 32.900/42.400 | -0.500 | -3.400 | 通過/通過 |
| n1500__pc__concentrated-1__map-1 | additional-1500 | executeRecord | n=20; 31.900/37.700 | n=20; 29.200/35.500 | -2.700 | -2.200 | 通過/通過 |
| n1500__pc__concentrated-1__map-1 | additional-1500 | focus | n=21; 20.600/23.700 | n=21; 22.400/26.400 | 1.800 | 2.700 | 通過/通過 |
| n1500__pc__concentrated-1__map-1 | additional-1500 | record | n=20; 18.000/19.600 | n=20; 19.000/19.700 | 1.000 | 0.100 | 通過/通過 |
| n1500__pc__concentrated-1__map-1 | additional-1500 | next | n=21; 25.700/28.900 | n=21; 25.900/28.800 | 0.200 | -0.100 | 通過/通過 |
| n1500__pc__concentrated-1__map-1 | additional-1500 | back | n=20; 45.000/50.200 | n=20; 45.900/50.100 | 0.900 | -0.100 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-0 | additional-1500 | execute | n=20; 46.500/59.300 | n=20; 37.200/43.800 | -9.300 | -15.500 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-0 | additional-1500 | executeRecord | n=20; 32.200/42.700 | n=20; 27.400/31.500 | -4.800 | -11.200 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-0 | additional-1500 | focus | n=22; 15.100/16.900 | n=22; 14.300/15.400 | -0.800 | -1.500 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-0 | additional-1500 | record | n=20; 13.600/16.400 | n=20; 11.500/13.400 | -2.100 | -3.000 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-0 | additional-1500 | next | n=41; 14.800/21.000 | n=41; 14.800/17.800 | -0.000 | -3.200 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-0 | additional-1500 | back | n=20; 14.000/20.400 | n=20; 14.900/19.700 | 0.900 | -0.700 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-1 | additional-1500 | execute | n=20; 51.700/57.900 | n=20; 34.200/46.800 | -17.500 | -11.100 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-1 | additional-1500 | executeRecord | n=20; 34.900/46.200 | n=20; 26.300/28.200 | -8.600 | -18.000 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-1 | additional-1500 | focus | n=22; 21.100/24.600 | n=22; 18.400/20.500 | -2.700 | -4.100 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-1 | additional-1500 | record | n=20; 15.900/20.000 | n=20; 13.600/16.000 | -2.300 | -4.000 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-1 | additional-1500 | next | n=41; 22.800/29.100 | n=41; 20.000/25.400 | -2.800 | -3.700 | 通過/通過 |
| n1500__smartphone__concentrated-0__map-1 | additional-1500 | back | n=20; 21.500/28.300 | n=20; 19.900/22.300 | -1.600 | -6.000 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-0 | additional-1500 | execute | n=20; 35.400/39.200 | n=20; 35.600/39.900 | 0.200 | 0.700 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-0 | additional-1500 | executeRecord | n=20; 31.700/37.600 | n=20; 32.000/37.400 | 0.300 | -0.200 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-0 | additional-1500 | focus | n=21; 17.200/18.800 | n=21; 17.200/19.900 | 0.000 | 1.100 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-0 | additional-1500 | record | n=20; 15.500/16.600 | n=20; 15.400/16.500 | -0.100 | -0.100 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-0 | additional-1500 | next | n=21; 16.900/20.900 | n=21; 15.900/19.500 | -1.000 | -1.400 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-0 | additional-1500 | back | n=20; 37.300/39.800 | n=20; 37.200/41.400 | -0.100 | 1.600 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-1 | additional-1500 | execute | n=20; 35.600/46.400 | n=20; 35.600/41.500 | 0.000 | -4.900 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-1 | additional-1500 | executeRecord | n=20; 31.200/36.700 | n=20; 32.800/36.200 | 1.600 | -0.500 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-1 | additional-1500 | focus | n=21; 20.200/24.300 | n=21; 20.300/22.500 | 0.100 | -1.800 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-1 | additional-1500 | record | n=20; 18.000/20.600 | n=20; 17.700/18.500 | -0.300 | -2.100 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-1 | additional-1500 | next | n=21; 22.400/27.700 | n=21; 21.400/25.600 | -1.000 | -2.100 | 通過/通過 |
| n1500__smartphone__concentrated-1__map-1 | additional-1500 | back | n=20; 41.200/46.800 | n=20; 41.900/48.200 | 0.700 | 1.400 | 通過/通過 |

保存完了の診断は各条件の saveCompletion に diagnostic / executionDiagnostic / executionRecordDiagnostic を分けて記録。反応時間の55/100ms基準は適用しない。

| 更新条件 | 入口 | 修正前の6段階（n;中央値/95%点ms） | 実装の6段階（n;中央値/95%点ms） | 保存件数 前→後 | 再読込確認 前/後 |
| --- | --- | --- | --- | --- | --- |
| n0150__collision-title | source-switch | controlledFetchWaitMs: n=20; 51.100/59.100<br>responseTextToConfirmationDomMs: n=20; 6.900/8.300<br>responseTextToConfirmationPaintMs: n=20; 26.500/32.200<br>checkboxReactionMs: n=20; 29.300/30.500<br>saveDurabilityMs: n=20; 84.600/89.700<br>saveScreenPaintMs: n=20; 113.400/128.600 | controlledFetchWaitMs: n=20; 50.400/56.600<br>responseTextToConfirmationDomMs: n=20; 8.700/9.700<br>responseTextToConfirmationPaintMs: n=20; 27.600/32.200<br>checkboxReactionMs: n=20; 30.000/30.900<br>saveDurabilityMs: n=20; 32.000/33.700<br>saveScreenPaintMs: n=20; 62.800/63.600 | 150〜150 → 150〜150 | 20/20・20/20 |
| n0150__duplicates | source-switch | controlledFetchWaitMs: n=20; 51.300/56.500<br>responseTextToConfirmationDomMs: n=20; 8.300/9.200<br>responseTextToConfirmationPaintMs: n=20; 27.100/30.800<br>checkboxReactionMs: n=20; 29.900/30.700<br>saveDurabilityMs: n=20; 224.400/227.900<br>saveScreenPaintMs: n=20; 246.600/262.600 | controlledFetchWaitMs: n=20; 52.900/56.900<br>responseTextToConfirmationDomMs: n=20; 9.000/10.000<br>responseTextToConfirmationPaintMs: n=20; 25.100/31.900<br>checkboxReactionMs: n=20; 30.500/31.200<br>saveDurabilityMs: n=20; 32.800/35.300<br>saveScreenPaintMs: n=20; 62.500/63.800 | 300〜300 → 150〜150 | 20/20・20/20 |
| n0150__normal | items-only | controlledFetchWaitMs: n=20; 46.300/55.600<br>responseTextToConfirmationDomMs: n=20; 6.200/7.600<br>responseTextToConfirmationPaintMs: n=20; 31.700/35.100<br>checkboxReactionMs: n=20; 30.000/30.900<br>saveDurabilityMs: n=20; 33.600/35.000<br>saveScreenPaintMs: n=20; 63.200/64.200 | controlledFetchWaitMs: n=20; 53.100/57.700<br>responseTextToConfirmationDomMs: n=20; 7.000/8.300<br>responseTextToConfirmationPaintMs: n=20; 25.900/33.300<br>checkboxReactionMs: n=20; 30.400/31.200<br>saveDurabilityMs: n=20; 34.400/36.500<br>saveScreenPaintMs: n=20; 62.600/63.600 | 150〜150 → 150〜150 | 20/20・20/20 |
| n0500__collision-title | source-switch | controlledFetchWaitMs: n=20; 51.800/59.800<br>responseTextToConfirmationDomMs: n=20; 12.500/13.900<br>responseTextToConfirmationPaintMs: n=20; 24.500/30.000<br>checkboxReactionMs: n=20; 29.700/31.300<br>saveDurabilityMs: n=20; 626.900/651.000<br>saveScreenPaintMs: n=20; 645.100/677.800 | controlledFetchWaitMs: n=20; 52.200/59.600<br>responseTextToConfirmationDomMs: n=20; 16.400/17.600<br>responseTextToConfirmationPaintMs: n=20; 27.900/32.700<br>checkboxReactionMs: n=20; 30.200/31.400<br>saveDurabilityMs: n=20; 55.200/58.900<br>saveScreenPaintMs: n=20; 96.300/97.600 | 500〜500 → 500〜500 | 20/20・20/20 |
| n0500__duplicates | source-switch | controlledFetchWaitMs: n=20; 53.500/59.600<br>responseTextToConfirmationDomMs: n=20; 15.100/16.500<br>responseTextToConfirmationPaintMs: n=20; 25.400/28.300<br>checkboxReactionMs: n=20; 30.000/31.200<br>saveDurabilityMs: n=20; 2181.600/2414.300<br>saveScreenPaintMs: n=20; 2212.000/2447.500 | controlledFetchWaitMs: n=20; 57.400/60.900<br>responseTextToConfirmationDomMs: n=20; 16.300/17.200<br>responseTextToConfirmationPaintMs: n=20; 27.100/31.400<br>checkboxReactionMs: n=20; 29.900/31.100<br>saveDurabilityMs: n=20; 54.300/56.100<br>saveScreenPaintMs: n=20; 96.600/97.500 | 1000〜1000 → 500〜500 | 20/20・20/20 |
| n0500__normal | items-only | controlledFetchWaitMs: n=20; 50.900/55.400<br>responseTextToConfirmationDomMs: n=20; 12.200/13.400<br>responseTextToConfirmationPaintMs: n=20; 27.600/33.800<br>checkboxReactionMs: n=20; 29.900/31.200<br>saveDurabilityMs: n=20; 57.900/60.800<br>saveScreenPaintMs: n=20; 96.200/97.500 | controlledFetchWaitMs: n=20; 50.600/58.800<br>responseTextToConfirmationDomMs: n=20; 13.800/17.300<br>responseTextToConfirmationPaintMs: n=20; 28.700/31.400<br>checkboxReactionMs: n=20; 30.500/31.700<br>saveDurabilityMs: n=20; 60.500/62.300<br>saveScreenPaintMs: n=20; 96.300/97.400 | 500〜500 → 500〜500 | 20/20・20/20 |
