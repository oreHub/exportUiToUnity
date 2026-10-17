# 05 Unity 取り込みツール（未着手）

エディタ拡張（C#）。`UIExport/<画面ID>/` の `layout.json` と `images/` を読み、画面の GameObject を組み立てる。
エンジニアが手で並べる作業を無くすのが目的。layout.json は人が読むものではなく、このツールが読むもの。

## 最初に作る範囲

1. images を `Assets` 内（例 `Assets/UI/<画面ID>/`）にコピーし、Sprite として設定する
2. layout.json の木をたどって GameObject の階層を作る
   - `unity.name`（印を外した名前）、`unity.anchorMin/anchorMax/pivot/anchoredPosition/sizeDelta` を RectTransform に
   - `role`: `image` → Image、`text` → TextMeshProUGUI（フォント・大きさ・色・揃え）、`group` → 空の GameObject
   - `base_image` → 親自身の Image
   - `layout` → Horizontal / VerticalLayoutGroup（間隔・余白は `layouts[]`）
   - `prefab` が `explicit` のもの → Prefab にする（候補 `candidate` は作らない）
3. **エラーのある版は、取り込む前に「エラー N 件があります」と確認を求める**（書き出しは止めない決まりなので、ここで止める）

## 次に作る範囲

- 再取り込み: ID で照合し、デザインの持ち分（位置・大きさ・画像・色）だけ更新し、エンジニアが足したもの（スクリプト・イベント・追加した部品）は残す（`03_versioning.md`）
- 名前の変更の追跡（PSD のレイヤー ID を layout.json に入れて照合する）
- 効果を分けた画像（`_Fx`）の組み立て（Glow / Art / Stroke の入れ物）

## layout.json の主な項目

`tools/export_ui.py` が書き出すもの（プラグインの段階 3 も同じ形にする）。
`samples/Home.psd` を Python 版で書き出すと実物が見られる。

| 項目 | 内容 |
| --- | --- |
| `screen` / `version` / `base_version` | 画面 ID、版、元にした版 |
| `canvas` | 画面の大きさ |
| `tree` | 部品の木。各部品に `role`・`rect`（PSD 上の位置）・`unity`（RectTransform の値と部品の種類）・`image`（書き出した画像） |
| `layouts` | 並び（向き・間隔・余白・項目） |
| `prefabs` | Prefab（明示と候補） |
| `spaces` | space_ の解釈 |
| `issues` | エラー・注意・提案・情報 |
| `fonts` | 使っているフォントと大きさ |
