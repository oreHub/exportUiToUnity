# CLAUDE.md — buildUiToUnityPackage（Unity 取り込みツール）

このフォルダで作業するときの決まり。全体の決まりは直下の `CLAUDE.md` を先に読む。

## 何を作っているか

Photoshop プラグイン（`exportPsdToUnity_plugin/`）が書き出した `UIExport/<画面ID>/`（`layout.json` と `images/`）を読み、
uGUI の GameObject の階層と Prefab を組み立てる **Unity のエディタ拡張**。後で AE パネルが書き出す動きのデータも取り込む。

```
PSD ─[Photoshop プラグイン]→ <Unityプロジェクト>/UIExport/<画面ID>/
                               └→ このツール（Tools > Build UI To Unity）→ 画面の GameObject・Prefab
```

## 構成

| 場所 | 中身 | 配布 |
| --- | --- | --- |
| `package/` | **パッケージ本体**（UPM）。`package.json`、`Editor/` の C#、`README.md`、`CHANGELOG.md` | **配布するのはここだけ** |
| `docs/` | 準備の手順（`01_setup.md`）、取り込みの計画と残作業（`02_importer_plan.md`） | しない |
| `CLAUDE.md` | この決まり | しない |
| 直下の `dev_buildUiToUnity/` | テスト用の Unity 6 プロジェクト（Unity Hub で作る）。`package/` を `file:` で参照する | しない |
| 直下の `samples/UIExport/` | テスト用の書き出しデータ（`samples/Home.psd` の書き出し） | しない |

## 作業の決まり

- 対象は Unity 6 以降（開発環境は 6000.3.8f1）。TextMeshPro は uGUI（`com.unity.ugui` 2.0）に含まれる
- コードはすべて `package/Editor/` に置く（エディタ専用。ゲームのビルドに入らない）。
  `dev_buildUiToUnity/Assets/` にツールのコードを置かない
- パッケージ内の `.meta` ファイルも git に入れる（Unity が自動で作る）
- パッケージの版は `package/package.json` の `version` と `package/CHANGELOG.md` を同時に更新する
- 配布は UPM パッケージ（git の URL に `?path=/buildUiToUnityPackage/package` を付けて入れる）が基本。だめなら `.unitypackage` で配る
- **layout.json の形の正は直下の `docs/04_layout_format.md`**。形を変えたいときは、その資料と、書き出す側
  （`exportPsdToUnity_plugin/`）のコードも同時に直す
- C# はこの環境ではコンパイルできないことがある。Unity のコンソール（または Editor.log）でエラーを確かめてもらう。
  Editor.log の場所（Windows）: `%LOCALAPPDATA%\Unity\Editor\Editor.log`
- Unity の画面の確認はユーザーが行う。確認してほしい点と期待する結果を具体的に伝える
  （例: Home で 版 261017-1 / 1920 × 1080 / エラー 0 / 注意 1 / 提案 5 / 情報 6）

## 次にやること

1. ユーザーが Unity Hub で `dev_buildUiToUnity/` を作る（`docs/01_setup.md`）
2. `docs/02_importer_plan.md` の「段階 1」から
