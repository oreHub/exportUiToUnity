# CLAUDE.md — UI Export（PSD → Unity UI）

このファイルは Claude Code が最初に読む引き継ぎメモ。詳しい仕様は `docs/` にある。

## 何を作っているか

ゲーム UI のデザイン（Photoshop の PSD）から、Unity（uGUI）の UI 構造と画像を作る仕組み。
デザイナーが PSD のレイヤー名に「印」を付け、Photoshop のプラグインで検査・修正・書き出しを行い、
Unity 側の取り込みツールで GameObject の階層を組み立てる。アニメーションが要る画面は、確定した構造から
After Effects のファイルを作り、AE で付けた動きを ID で Unity に当てる（後の段階）。

```
PSD（印つき） ─ Photoshop プラグイン（解析・修正・書き出し）
             └→ <Unityプロジェクト>/UIExport/<画面ID>/ （Assets の外。layout.json・images・report.html・history.json）
                 └→ git → Unity 取り込みツール（エディタ拡張）→ 画面の GameObject・Prefab
```

## リポジトリの構成

| 場所 | 中身 | 状態 |
| --- | --- | --- |
| `plugin/UIExport/` | Photoshop UXP プラグイン（パネル） | 段階 1（解析・表示）と段階 2（名前の修正）まで完成。段階 3（書き出し）は作成済みで実機の確認待ち |
| `tools/` | Python 版（解析 `psd_to_layout.py`、書き出し `export_ui.py`、レポートのひな形） | 書き出しまで動く検証版。プラグインの書き出しの手本 |
| `tests/` | Photoshop が無くても動くテスト | `python tests/run_all.py` |
| `samples/` | サンプル PSD（`Home.psd` が現在の正、`home_unmarked.psd` は印を付ける前） | |
| `docs/` | 仕様・決定事項・残作業 | |

## 作業の決まり

- **解析の判定は JS 版（`plugin/UIExport/core/analyze.js`）と Python 版（`tools/psd_to_layout.py`）で同じにする。**
  片方を変えたらもう片方も同じように変え、`tests/run_all.py` で一致を確かめる（照合・fuzz・仮の Photoshop）。
- `core/` は Photoshop に依存しない（Node でも動く）。Photoshop とのやり取りは `ps/` と `main.js` に置く。
- UXP の注意点（実機で確かめたもの）は `docs/04_plugin.md` の「UXP で分かったこと」を読む。
  特に: モジュールの中から別モジュールを相対パスで `require` しない（`core/fixes.js` は `parseMarks` を自前で持つ）。
- プラグインの版は `manifest.json` の `version` と `main.js` の `PLUGIN_VERSION` を同時に上げる。
- 実機（Photoshop・Unity）の動作確認はユーザーが行う。画面を操作できないので、確認してほしい点と期待する結果
  （例: Home.psd で エラー 0 / 注意 1 / 提案 5 / 情報 6）を具体的に伝える。
- 出力ファイル（配布用 zip など）には日付の連番を付ける: `名前_YYMMDD-n`（例 `UIExport_plugin_261017-1.zip`）。
- 社内資料・コード・コメントに、ほかのプロジェクトの固有名を入れない。

## ユーザーとのやり取り

- ユーザーは日本語で話すゲーム UI デザイナー。説明は日本語で、専門用語には短い説明を添える。
- 新しい話題を持ち出すときは、まず前提（それが何で、なぜ要るか）を説明してから提案する。
- 見た目の調整はユーザーの指定（色・大きさ）をそのまま反映する。迷うときは見本画像を出して比べてもらう。
- PC のフォルダへのアクセスを求めるときは、必要な範囲を最小にする。

## 次にやること（詳細は `docs/07_backlog.md`）

1. プラグイン段階 3: 書き出しの実機確認と修正（`tools/export_ui.py` と同じ出力を Photoshop の中で作る）
2. `_Fx`（効果を別画像に分ける）の印の読み取りと書き出し
3. Unity 取り込みツール（`docs/05_unity_importer.md`）
