# Build UI To Unity

PSD から書き出した UI 構造を取り込み、uGUI の画面を組み立てるエディタ拡張（Unity 6 以降）。

## 入れ方

Package Manager の「＋」→「Install package from git URL…」に、次の URL を入れる。

```
https://github.com/oreHub/exportUiToUnity.git?path=/buildUiToUnityPackage/package
```

- `?path=` は、リポジトリの中のパッケージの場所（このフォルダ）を指す
- 版を固定するときは、末尾に `#<タグ名かコミット>` を付ける（例 `…/package#v0.1.0`）
- 社内の git に移したら、URL の前半をその場所に変える

## 使い方

1. 書き出しフォルダ `UIExport/<画面ID>/` を、プロジェクトの `Assets` の外（プロジェクトの直下など）に置く
2. メニューの Tools > Build UI To Unity を開く
3. 書き出しフォルダを選び、画面の版と問題の件数を確かめる
4. 「今のシーンに取り込む」か「新しいシーンに取り込む…」（保存先を選ぶ）を押す
   - 画像と Prefab は「取り込み先」（既定 `Assets/UI`）の `<画面ID>/` の下に置かれる
   - 文字は TextMeshPro の既定のフォントになる（先に Window > TextMeshPro > Import TMP Essential Resources が要る）
5. PSD を直して書き出し直したら、取り込んだシーンを開いて「反映（更新）…」を押す
   - これから行う変更の一覧が出る。エンジニアが変えた所と PSD が違う所は、どちらにするかを選んでから「確定」
   - エンジニアが足したスクリプト・部品は残る。Ctrl+Z 1 回で戻せる
