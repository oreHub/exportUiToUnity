# 05 AE から書き出す動きのデータの形（未決定）

**まだ決まっていない。** layout.json（`04_layout_format.md`）と並ぶ、ツール間の約束ごとになる予定の章。
After Effects パネル（`exportAeToUnity_plugin/`）が書き出し、Unity 取り込みツール（`buildUiToUnityPackage/`）が読む。
形を決めたら、この章を正にし、書き出す側と読む側を同時に作る。

## 前提（決まっていること）

- 動きは部品の **ID**（layout.json の `unity.name` を親から `/` でつないだパス。root は含めない。`04_layout_format.md`）で Unity の部品に当てる
- 構造（親子関係・部品の有無）は AE で変えない。変えたいときは PSD に戻して直し、書き出し直す
- どの版の layout.json から作った AE ファイルかを記録する（版の食い違いを検出するため）
- 対象の動きは、Unity で再現できるもの（位置・拡大・回転・不透明度など）。AE パネルの検査で確かめてから書き出す

## 決めること

| 項目 | 候補・論点 |
| --- | --- |
| Unity 側の形式 | AnimationClip にする / DOTween のようなスクリプトで再生する |
| 置き場所 | `UIExport/<画面ID>/` の中（例 `motion/<動きの名前>.json`）か、別の場所か |
| 1 ファイルの単位 | 1 つの動き（開く・閉じる・ループなど）ごとか、1 画面にまとめるか |
| 値の表し方 | AE の座標（左上が原点・下が +）を Unity の座標（anchoredPosition・上が +）に直してから書くか、そのまま書いて読む側で直すか |
| キーフレーム | 時間（秒かフレームか）、値、イージング（ベジェの制御点をそのまま持つか、Unity の接線に直すか） |
| 焼き付け | エクスプレッションやタイムリマップを、フレームごとの値に焼き付けて書くか |
| 版 | 形の版（`format_version`）、元にした layout.json の版（`layout_version`） |

## 形の案（たたき台。決定ではない）

```json
{
  "format_version": 1,
  "screen": "Home",
  "layout_version": "261017-1",
  "name": "Open",
  "duration": 0.5,
  "tracks": [
    { "id": "Header_Info/Btn_Menu", "property": "anchoredPosition",
      "keys": [ { "t": 0.0, "v": [0, -40], "ease": [0.33, 0, 0.67, 1] }, { "t": 0.5, "v": [0, 0] } ] }
  ]
}
```
