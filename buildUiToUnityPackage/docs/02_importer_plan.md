# 02 取り込みの計画（残作業）

エディタ拡張（C#）。`UIExport/<画面ID>/` の `layout.json` と `images/` を読み、画面の GameObject を組み立てる。
エンジニアが手で並べる作業を無くすのが目的。layout.json は人が読むものではなく、このツールが読むもの。

読む項目と意味は、直下の `docs/04_layout_format.md`（layout.json の形の正）を見る。

## 今の状態（0.1.0）

- メニュー Tools > Build UI To Unity でウインドウを開く
- 書き出しフォルダ（UIExport）を選び、画面ごとに版・PSD・画面の大きさ・問題の件数を表示する
- 取り込みボタンは未実装

## 段階 1: 取り込み（新規）

1. 画像を `Assets/UI/<画面ID>/`（場所は設定で変えられるようにする）にコピーし、Sprite として設定する
   - 同じ絵（`shared: true`）は 1 枚を使い回す
2. Canvas（`root`）を作る。CanvasScaler の基準解像度は `canvas` の値
3. `tree` をたどって GameObject を作る
   - 名前は `unity.name`（印を外した名前）。RectTransform に `unity` の値（anchorMin / anchorMax / pivot / anchoredPosition / sizeDelta）を入れる
   - `image` → Image（Sprite を割り当て）、`base_image` → 親自身の Image、`group` → 空の GameObject
   - `text` → TextMeshProUGUI（文字・大きさ・色・揃え。フォントの割り当て方は要相談）
   - `layout` → Horizontal / VerticalLayoutGroup（間隔・余白は `layouts[]`。項目の大きさを子に任せるかは要確認）
4. `unity.prefab: explicit` の部品を Prefab にする（`Assets/UI/<画面ID>/Prefabs/` など。候補 `candidate` は作らない）。
   同じ Prefab のインスタンスは Prefab から置き直す
5. 取り込んだ結果を画面のシーンまたは Prefab として保存する（どちらにするかは要相談）
6. **エラーのある版は、取り込む前に「エラー N 件があります。取り込みますか？」と確認を求める**
   （書き出しは止めない決まりなので、最終決定の取り込みで止める）
7. 取り込みの記録（どの版を取り込んだか）を残す（段階 2 の照合に使う）
8. layout.json の形の版（`format_version`）を確かめ、知らない版なら止めて知らせる（書き出す側が足したあと。全体の残作業）

確認: `samples/UIExport/Home` を取り込み、`preview.png` と見比べて同じ見た目になるか。

## 段階 2: 再取り込み（更新）

ID（Unity での名前のパス）で、前回取り込んだ記録・新しい書き出し・今の Unity の状態の 3 つを比べる（直下の `docs/03_versioning.md`）。

| 持ち分 | 項目 | 再取り込みでの扱い |
| --- | --- | --- |
| デザイン | 位置・大きさ・画像・色・文字の見た目 | 新しい書き出しで上書き |
| エンジニア | スクリプト・イベント・エンジニアが追加した部品 | 残す |

- 構造（親子関係、部品の有無）をどちらの持ち分にするかは、この段階で決める
- 名前を変えた部品は、ID だけで比べると「削除＋追加」に見える。プラグインの書き出しには PSD のレイヤー ID（`layer_id`）が入っているので、それで照合する

## 段階 3 以降

- 効果を分けた画像（`_Fx`。Glow / Art / Stroke の入れ物）の組み立て（プラグイン側の書き出しが先）
- アニメーション（AE で付けた動きを ID で当てる）。動きのデータの形と Unity 側の形式は未決定（直下の `docs/05_motion_format.md`）
- `.unitypackage` での配布が必要になったら、その書き出しの仕組み

## 決まっていること

- Unity 6 以降。TextMeshPro は uGUI 2.0 に含まれる
- エディタ専用（ゲームのビルドに入らない）
- 書き出しフォルダは Unity プロジェクトの中、`Assets` の外
- 配布は UPM パッケージが基本、だめなら `.unitypackage`
