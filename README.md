# exportUiToUnity

ゲーム UI の PSD に付けた「印」から、Unity（uGUI）の UI 構造と画像を作る仕組み。
Photoshop・After Effects・Unity の 3 つのツールを、このリポジトリにまとめて置く。

| ツール | 場所 | 状態 |
| --- | --- | --- |
| Photoshop プラグイン（PSD を解析・修正し、UI の構造と画像を書き出す） | `exportPsdToUnity_plugin/` | 書き出しまで作成済み（実機の確認待ち） |
| After Effects パネル（AE ファイルの構築、動きの検査と書き出し） | `exportAeToUnity_plugin/` | 予定 |
| Unity 取り込みツール（uGUI の画面を組み立てる UPM パッケージ） | `buildUiToUnityPackage/` | シーンへの新規の取り込みまで |

## 資料

- 全体の流れ: `docs/01_overview.md`
- 印の規則: `docs/02_marks.md`
- 版の管理: `docs/03_versioning.md`
- layout.json の形（ツール間の約束ごと）: `docs/04_layout_format.md`
- AE から書き出す動きのデータの形（未決定）: `docs/05_motion_format.md`
- 決定の記録: `docs/06_decisions.md`
- 残作業: `docs/07_backlog.md`
- Claude Code 向けの引き継ぎメモ: `CLAUDE.md`（各ツールのフォルダにもある）

## 使い始め

- Photoshop プラグイン: `exportPsdToUnity_plugin/plugin/UIExport/README.md`（UXP Developer Tool で `manifest.json` を読み込む）
- Unity 取り込みツール（開発）: `buildUiToUnityPackage/docs/01_setup.md`
- Unity 取り込みツール（使う側）: `buildUiToUnityPackage/package/README.md`

## テスト（Photoshop が無くても動く）

`exportPsdToUnity_plugin` フォルダで実行する。

```
cd exportPsdToUnity_plugin\tools && setup.bat     (初回だけ。tools\.venv を作る)
cd ..\tests && npm install                        (初回だけ。jsdom)
cd .. && tools\.venv\Scripts\python.exe tests\run_all.py
```

Python 版と JS 版の解析・書き出しの一致、崩した PSD での一致、仮の Photoshop でのパネルの動作を確かめる。
