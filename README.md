# UI Export（PSD → Unity UI）

ゲーム UI の PSD に付けた「印」から、Unity（uGUI）の UI 構造と画像を作る仕組み。

- 全体の流れ: `docs/01_overview.md`
- 印の規則: `docs/02_marks.md`
- Photoshop プラグイン: `plugin/UIExport/`（読み込み方は `plugin/UIExport/README.md`）
- Python 版（検証用・書き出しの手本）: `tools/`（準備は `tools/README.md`）
- 残作業: `docs/07_backlog.md`
- Claude Code 向けの引き継ぎメモ: `CLAUDE.md`

## テスト（Photoshop が無くても動く）

```
cd tools && setup.bat            (初回だけ。tools\.venv を作る)
cd ..\tests && npm install       (初回だけ。jsdom)
cd .. && tools\.venv\Scripts\python.exe tests\run_all.py
```

Python 版と JS 版の解析の一致、崩した PSD での一致、仮の Photoshop でのパネルの動作を確かめる。
