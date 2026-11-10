# Block editing attachment fixture

`block-edit-115-map.json.gz` contains only the complete first-day map, including all 115 block definitions and 36,385 cells. It contains no shopping list, event metadata, or user preferences.

The map was extracted on 2026-11-10 through the existing production XLSX import, persistence Worker, and JSON export using baseline build `12925f1f47d6b1a331d13c8c06aed0937de5fe04`. The original attachment and audit artifacts were retained outside the repository. Gzip decompression was compared with the exact UTF-8 JSON bytes before the uncompressed generated copy was removed.

- Original attachment SHA-256: `9DD25435C0F9275DF6ED66A0A1B697473261769F8ABC25C9187085D9F5F0E702`
- Gzip fixture SHA-256: `4C670DEBAA7B56C75EB05EE9F915F5EE217AF0BF14935A06429EB7B3C7CC788F`
- Source copy: `D:/esp-c108-block-edit-20261110-ce1908ec/input-copy.xlsx`
- Extraction record: `D:/esp-integrated-remediation-evidence-20261110/original-fixture-extraction.json`

The regression independently expects only the exact lowercase `b` definition to be renamed. Uppercase `B`, `ヤ`, and every other definition retain their complete original content. Original audit observations are not used as the post-fix expected result.
