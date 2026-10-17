# 01 開発の準備

開発には、リポジトリの直下に置くテスト用の Unity プロジェクト `dev_buildUiToUnity/` を使う。
このプロジェクトは自動生成のファイルが多いので、git には一部だけ入れる（`.gitignore` で除いている）。

```
exportUiToUnity/
 ├ buildUiToUnityPackage/
 │   └ package/              ← パッケージ本体（ここを参照する）
 ├ samples/UIExport/Home/    ← テスト用の書き出しデータ（正）
 └ dev_buildUiToUnity/       ← テスト用の Unity プロジェクト（Unity Hub で作る）
     ├ Assets/
     ├ Packages/manifest.json
     ├ ProjectSettings/
     └ UIExport/Home/        ← samples からコピー（git には入れない）
```

## 1. テスト用の Unity プロジェクトを作る

1. Unity Hub で「New project」→ Editor Version は **6000.3.8f1**
2. テンプレートは「Universal 2D」など、uGUI が使えるもの（2D / 3D どちらでもよい）
3. 場所（Location）は **リポジトリの直下**（`exportUiToUnity` フォルダ）、名前（Project name）は **`dev_buildUiToUnity`**
   → `exportUiToUnity/dev_buildUiToUnity/` ができる

## 2. パッケージを参照させる

`dev_buildUiToUnity/Packages/manifest.json` の `dependencies` に、次の 1 行を足す（ほかの行は残す）。

```json
"com.company.builduitounity": "file:../../buildUiToUnityPackage/package",
```

`../../` は `dev_buildUiToUnity/Packages/` から 2 つ上がってリポジトリの直下に出る、という意味。
保存して Unity に戻ると、Package Manager の一覧に「Build UI To Unity」が出る。

- パッケージのコードを直すと、そのまま Unity に反映される（元のフォルダを直接見ているため）
- パッケージの中に Unity が `.meta` ファイルを作る。これも git に入れる
- 本番では git の URL から入れる（`package/README.md`）。指定した版のコピーが入る

## 3. テスト用の書き出しデータを置く

`samples/UIExport/` を `dev_buildUiToUnity/UIExport/` にコピーする（**Assets の外**。本番と同じ置き方）。
`dev_buildUiToUnity/UIExport/` は git に入れない（正は `samples/UIExport/` と、プラグインの書き出し）。

Photoshop プラグインで試すときは、書き出し先にこの `dev_buildUiToUnity/UIExport/` を選ぶ。

## 4. 動作確認

メニューの **Tools > Build UI To Unity** を開く。次のように出れば準備完了。

| 項目 | 期待する表示 |
| --- | --- |
| 書き出しフォルダ | `…/dev_buildUiToUnity/UIExport` |
| 画面 | `Home` |
| 版 | `261017-1（元にした版 なし（初回））` |
| 画面 | `1920 × 1080` |
| 問題 | エラー 0 / 注意 1 / 提案 5 / 情報 6 |

コンソールにコンパイルエラーが出た場合は、その内容を Claude Code に伝える。
Editor.log の場所（Windows）: `%LOCALAPPDATA%\Unity\Editor\Editor.log`
