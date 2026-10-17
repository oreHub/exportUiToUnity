# CLAUDE.md — exportPsdToUnity_plugin（Photoshop プラグイン）

このフォルダで作業するときの決まり。全体の決まりは直下の `CLAUDE.md` を先に読む。

## 何を作っているか

Photoshop の UXP プラグイン（パネル）。PSD のレイヤー名の印を解析し、問題を一覧して名前で直せるものを直し、
`<Unityプロジェクト>/UIExport/<画面ID>/` に UI の構造（layout.json）と画像を書き出す。

## 構成

| 場所 | 中身 | 状態 |
| --- | --- | --- |
| `plugin/UIExport/` | UXP プラグイン（パネル）。UXP Developer Tool で `plugin/UIExport/manifest.json` を読み込む | 段階 1（解析・表示）と段階 2（名前の修正）まで完成。段階 3（書き出し）は作成済みで実機の確認待ち |
| `tools/` | Python 版（解析 `psd_to_layout.py`、書き出し `export_ui.py`） | 書き出しまで動く検証版。プラグインの書き出しの手本 |
| `tests/` | Photoshop が無くても動くテスト | `tools\.venv\Scripts\python.exe tests\run_all.py`（このフォルダで） |
| `docs/` | プラグインの資料（`01_plugin.md`）、残作業（`02_backlog.md`） | |

試験データ（PSD）は直下の `samples/`（`Home.psd` が現在の正、`home_unmarked.psd` は印を付ける前）。
共通の仕様（印の規則・版の管理・layout.json の形）は直下の `docs/`。

## 作業の決まり

- **解析の判定は JS 版（`plugin/UIExport/core/analyze.js`）と Python 版（`tools/psd_to_layout.py`）で同じにする。**
  片方を変えたらもう片方も同じように変え、`tests/run_all.py` で一致を確かめる（照合・fuzz・仮の Photoshop）。
  書き出し（`core/export.js` と `tools/export_ui.py`）も同じ。
- `core/` は Photoshop に依存しない（Node でも動く）。Photoshop とのやり取りは `ps/` と `main.js` に置く。
- UXP の注意点（実機で確かめたもの）は `docs/01_plugin.md` の「UXP で分かったこと」を読む。
  特に: モジュールの中から別モジュールを相対パスで `require` しない（`core/fixes.js` は `parseMarks` を自前で持つ）。
- プラグインの版は `manifest.json` の `version` と `main.js` の `PLUGIN_VERSION` を同時に上げる。
- layout.json の形を変えるときは、直下の `docs/04_layout_format.md` と、読む側（`buildUiToUnityPackage/`）も同時に直す。
- レポートのひな形 `plugin/UIExport/report_template.html` は Python 版も使う（1 か所だけに置く）。

## 次にやること（詳細は `docs/02_backlog.md`）

1. 段階 3: 書き出しの実機確認と修正
2. layout.json に `format_version` を書く（Python 版も同時に）
3. `_Fx`（効果を別画像に分ける）の印の読み取りと書き出し
