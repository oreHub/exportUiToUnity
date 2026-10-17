# UI 書き出しツール（検証版 261016-4）

PSD のレイヤー名の印から Unity 用の構造データを作り、`UIExport/<画面ID>/` に書き出す。
本番では Photoshop の UXP プラグインが同じ処理を行う。これは流れを確かめるための Python 版。

## 準備（最初の 1 回）

1. Python 3.10 を入れる（python.org の Windows installer 64-bit。「Install launcher for all users」は付けたまま）
2. この tools フォルダの `setup.bat` をダブルクリックする
   - tools の中に `.venv`（このツール専用の Python 環境）を作り、`requirements.txt` のライブラリを入れる

手で行う場合は、tools フォルダで次を実行する。

```
py -3.10 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

入るライブラリは `psd-tools[composite]`。`[composite]` は、レイヤー効果（境界線など）を描くための追加ライブラリ（scipy、aggdraw など）をまとめて入れる指定。`psd-tools` だけでは境界線のある PSD で止まる。

## 使い方

tools フォルダで実行する。

```
.venv\Scripts\python.exe export_ui.py <PSD> <Unityプロジェクト>/UIExport --screen Home
```

- 初回だけ `--screen` で画面 ID を指定する。2 回目以降は PSD の中に記録された画面 ID を使う
- 書き出すと、PSD に「画面 ID」と「元にした版」を書き込んで保存する
- 版は `YYMMDD-n`（例: 261016-1）。同じ日の 2 回目は 261016-2
- 止まる場合
  - PSD が古い版を元にしている、または書き出しの記録が無い → `--force` で上書き、別案なら `--screen` で別の画面 ID
  - 前の版から変更が無い → 版は増やさずに終わる

## 書き出されるもの

| ファイル | 内容 |
| --- | --- |
| `images/` | 部品ごとの画像。同じ絵は 1 枚にまとめて共有する |
| `layout.json` | 構造データ（版の情報つき） |
| `preview.png` | 画面全体（area_ / space_ は除く） |
| `report.html` | 構造レポート。ブラウザで開く |
| `history.json` | 書き出しの記録 |

ファイル名は版ごとに変えない（Unity が同じ名前で読むため）。版は `layout.json` と `history.json` に記録し、過去の版は git の履歴で見る。

## ファイル

- `export_ui.py` 書き出し本体
- `psd_to_layout.py` 解析（印の読み取り、構造の組み立て、検査と提案）
- レポートのひな形は、プラグインと共用の `../plugin/UIExport/report_template.html` を使う
- `requirements.txt` 必要なライブラリの一覧
- `setup.bat` 準備用（.venv 作成とライブラリのインストール）

解析だけを確かめるときは `.venv\Scripts\python.exe psd_to_layout.py <PSD> <出力.json>`。

## 動作確認済みの環境

Python 3.10 / psd-tools 1.24.0 / scipy 1.15.3 / aggdraw 1.3.19 / numpy 2.2.6 / Pillow 12.3.0
