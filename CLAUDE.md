# CLAUDE.md — exportUiToUnity（全体）

このファイルは Claude Code が最初に読む引き継ぎメモ。リポジトリ全体の決まりを書く。
ツールごとの決まりは、それぞれのフォルダの `CLAUDE.md` にある（作業するツールのものも必ず読む）。

## 何を作っているか

ゲーム UI のデザイン（Photoshop の PSD）から、Unity（uGUI）の UI 構造と画像を作る仕組み。
デザイナーが PSD のレイヤー名に「印」を付け、Photoshop のプラグインで検査・修正・書き出しを行い、
Unity 側の取り込みツールで GameObject の階層を組み立てる。アニメーションが要る画面は、確定した構造から
After Effects のファイルを作り、AE で付けた動きを ID で Unity に当てる（後の段階）。

```
PSD（印つき） ─[exportPsdToUnity_plugin]→ <Unityプロジェクト>/UIExport/<画面ID>/（Assets の外。layout.json・images・report.html・history.json）
                                              ├─[buildUiToUnityPackage]→ 画面の GameObject・Prefab
                                              └─[exportAeToUnity_plugin]→ AE ファイル → 動きのデータ ─→ buildUiToUnityPackage が ID で当てる
```

## リポジトリの構成

| 場所 | 中身 | 状態 |
| --- | --- | --- |
| `CLAUDE.md` / `README.md` | 全体の決まり / 入口 | |
| `docs/` | 全ツール共通の仕様（流れ、印の規則、版の管理、layout.json の形、動きのデータの形、決定の記録、全体の残作業） | |
| `samples/` | 共通の試験データ（PSD、`UIExport/` の書き出し結果、後で AE ファイル） | |
| `exportPsdToUnity_plugin/` | Photoshop プラグイン（PSD を解析・修正し、UI の構造と画像を書き出す）。`plugin/`（UXP）、`tools/`（Python 版）、`tests/` | 段階 1・2 完成。段階 3（書き出し）は実機でおおむね確認済み（残りは `exportPsdToUnity_plugin/docs/02_backlog.md`） |
| `exportAeToUnity_plugin/` | After Effects パネル（予定）。`CLAUDE.md` と `docs/` だけ | 未着手 |
| `buildUiToUnityPackage/` | Unity 取り込みツール。`package/`（UPM パッケージ本体。配布するのはここだけ）、`CLAUDE.md`・`docs/`（開発用） | 0.3.0（段階 1: 新規の取り込みと Prefab、段階 2: エンジニアの作業を残した反映。どちらも実機で確認済み） |
| `dev_buildUiToUnity/` | 共通のテスト用 Unity 6 プロジェクト（自動生成物は git に入れない）。パッケージを `file:../../buildUiToUnityPackage/package` で参照 | 作成済み（2026-10-17） |

## 命名の決まり

- **`export〜` は Adobe 側で動いて書き出すツール、`build〜` は Unity 側で組み立てるもの**
- **末尾は最終の形**: `_plugin` = Adobe アプリのパネル、`Package` = Unity パッケージ
- テスト用のプロジェクトは `dev_` を頭に付ける（`dev_buildUiToUnity` = buildUiToUnity を試すためのもの）

## ツールの間の約束ごと

- **layout.json の形の正は `docs/04_layout_format.md`。** 書き出す側（Photoshop プラグイン）と読む側（Unity 取り込みツール、AE パネル）は、
  これに合わせる。形を変えるときは、この資料と、書く側・読む側のコードを同時に直す
- 動きのデータの形は `docs/05_motion_format.md`（未決定）
- 版の管理は `docs/03_versioning.md`
- 部品の ID は layout.json の `unity.name` を親から `/` でつないだパス（root の `Canvas` は含めない）。ツールの間ではこの ID で部品を照合する
- **直すのは PSD だけ。** report.html・AE・Unity で構造を直さない（`docs/06_decisions.md`）

## 共通の作業ルール

- 各ツールの中で、アプリに依存しない部分（解析・照合・組み立て）は分けて作り、アプリが無くてもテストできるようにする
- 実機（Photoshop・After Effects・Unity）の動作確認はユーザーが行う。画面を操作できないので、確認してほしい点と期待する結果
  （例: Home.psd で エラー 0 / 注意 1 / 提案 5 / 情報 6）を具体的に伝える
- 出力ファイル（配布用 zip など）には日付の連番を付ける: `名前_YYMMDD-n`（例 `UIExport_plugin_261017-1.zip`）
- 社内資料・コード・コメントに、ほかのプロジェクトの固有名を入れない
- ファイルを移すときは `git mv` を使い、履歴を残す
- リポジトリ名は `exportUiToUnity`（GitHub: `oreHub/exportUiToUnity`）。ローカルのフォルダ名は変更前のまま（`exportPsd_plugin`）のことがある

## ユーザーとのやり取り

- ユーザーは日本語で話すゲーム UI デザイナー。説明は日本語で、専門用語には短い説明を添える。
- 新しい話題を持ち出すときは、まず前提（それが何で、なぜ要るか）を説明してから提案する。
- 見た目の調整はユーザーの指定（色・大きさ）をそのまま反映する。迷うときは見本画像を出して比べてもらう。
- PC のフォルダへのアクセスを求めるときは、必要な範囲を最小にする。**作業フォルダ（このリポジトリ）の外にアクセスするときは、
  読むだけでも必ず先に確認を取る**（🔴 と太字で目立たせ、場所・目的・すること（読むだけか書くか）を日本語で書く）。
  場所が分からないファイルは自分で探さず、場所を聞く。

## 次にやること（詳細は `docs/07_backlog.md` と各ツールの docs）

1. Photoshop プラグイン段階 3: 残りの確認（report.html、記録の無い PSD、上書き、枠からのはみ出し）と、見つかった課題の修正
2. 提案資料の作成（claude.ai。共有用の文書は `docs/handoff/`）。段階 1・2 は済み（2026-10-18）
3. layout.json に `format_version` を足し、読む側で確かめる
4. `_Fx`（効果を別画像に分ける）の印の読み取りと書き出し
