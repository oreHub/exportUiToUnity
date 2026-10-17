# CLAUDE.md — exportAeToUnity_plugin（After Effects パネル・予定）

このフォルダで作業するときの決まり。全体の決まりは直下の `CLAUDE.md` を先に読む。

## 何を作るか（未着手）

After Effects のパネル。1 つのパネルで次の 2 つを行う。

1. **構築**: Photoshop プラグインが書き出した `UIExport/<画面ID>/`（layout.json・images）から、
   Unity と同じ親子関係の AE ファイルを作る
2. **解析・検査・修正・動きのデータの書き出し**: AE で付けた動きが Unity で再現できるかを確かめ、
   動きのデータを書き出す。Unity 取り込みツールが ID で部品に当てる

計画と未決定のことは `docs/01_plan.md`。

## 作業の決まり

- layout.json の形の正は直下の `docs/04_layout_format.md`。動きのデータの形は直下の `docs/05_motion_format.md`（未決定）
- 構造は AE で変えない。変えたいときは PSD に戻して直す
- 解析や照合の中身は、AE に依存しない部分（Node でテストできる）に分けて作る
- パネルの技術は作る時点で決める（AE の UXP が正式版なら UXP、そうでなければ ExtendScript など）
- AE の実機の確認はユーザーが行う。確認してほしい点と期待する結果を具体的に伝える

## 次にやること

まだ始めない。Photoshop プラグインの書き出しと、Unity 取り込みツールの段階 1 が先。
始めるときは、`docs/01_plan.md` の「未決定のこと」をユーザーと決めてから。
