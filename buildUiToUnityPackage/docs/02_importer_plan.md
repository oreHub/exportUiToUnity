# 02 取り込みの計画（残作業）

エディタ拡張（C#）。`UIExport/<画面ID>/` の `layout.json` と `images/` を読み、画面の GameObject を組み立てる。
エンジニアが手で並べる作業を無くすのが目的。layout.json は人が読むものではなく、このツールが読むもの。

読む項目と意味は、直下の `docs/04_layout_format.md`（layout.json の形の正）を見る。

## 今の状態（0.2.0。2026-10-18 に Home 261017-3 で実機の確認済み）

- メニュー Tools > Build UI To Unity でウインドウを開く。書き出しフォルダ（UIExport）の画面ごとに、版・PSD・画面の大きさ・問題の件数を表示する
- 「今のシーンに取り込む」「新しいシーンに取り込む…」で段階 1 の取り込みを行う（コードは `package/Editor/UiBuilder.cs`）

## 段階 1 で決めたこと（2026-10-17）

| 項目 | 決めたこと |
| --- | --- |
| 置き先 | シーンの Canvas（Canvas を置かないとレイアウトした意味が無いため）。**今のシーンに追加**するか、**保存先を選んで新しいシーンを作る**か |
| 同じ名前の画面がシーンにあるとき | 置き換える / 並べて追加 / やめる を選ぶ（再取り込みでの更新は段階 2） |
| 画像・Prefab の置き場 | 取り込み先（既定 `Assets/UI`）の `<画面ID>/Images/`・`<画面ID>/Prefabs/`。ウインドウで変えられる |
| 画像の設定 | Sprite、ミップマップ無し、圧縮しない（デザインの確認用に色を変えない） |
| 文字 | TextMeshProUGUI。フォントは既定のもの。折り返さず、枠からはみ出して見せる。不透明度は文字の色に当てる |
| Canvas | Screen Space - Overlay。CanvasScaler は Scale With Screen Size、基準解像度は `canvas`、Match 0.5 |
| 並び | Horizontal / VerticalLayoutGroup。`spacing`（外形同士のすき間）と `padding_lrtb`。子の大きさは子に任せる。子は `items` の順に並べ、項目でない子は LayoutElement で外す |
| グループの不透明度 | CanvasGroup の alpha（画像には焼き込み済みなので、画像には当てない） |
| 絵が枠からはみ出した画像 | 部品の大きさは枠のまま、絵は子の `Image` に置く |
| Prefab | `_Prefab` の型ごとに 1 つ作る。基準は違いの無いインスタンス。ほかのインスタンスは Prefab から置き直し、位置・画像・文字などを差し替える。Prefab に無い部品は追加、インスタンスに無い部品は非表示。入れ子の Prefab に備えて深いものから作る |
| Button | 付けない（`Button?` は確認用の印） |
| EventSystem | シーンに無ければ作る（Input System があればその入力モジュール） |
| 取り込みの記録 | `<画面ID>/BuildUiToUnity_record.json`（画面・版・PSD・日時・シーン） |

## 段階 1: 取り込み（新規）

1. 画像を `Assets/UI/<画面ID>/`（場所は設定で変えられるようにする）にコピーし、Sprite として設定する
   - 同じ絵（`shared: true`）は 1 枚を使い回す
2. Canvas（`root`）を作る。CanvasScaler の基準解像度は `canvas` の値
3. `tree` をたどって GameObject を作る
   - 名前は `unity.name`（印を外した名前）。RectTransform に `unity` の値（anchorMin / anchorMax / pivot / anchoredPosition / sizeDelta）を入れる
   - `image` → Image（Sprite を割り当て）、`base_image` → 親自身の Image、`group` → 空の GameObject
   - `text` → TextMeshProUGUI（文字・大きさ・色・揃え。フォントは今は既定のもの。PSD のフォントとの対応は後で）
   - `layout` → Horizontal / VerticalLayoutGroup（間隔・余白は `layouts[]`。項目の大きさを子に任せるかは要確認）
4. `unity.prefab: explicit` の部品を Prefab にする（`Assets/UI/<画面ID>/Prefabs/` など。候補 `candidate` は作らない）。
   同じ Prefab のインスタンスは Prefab から置き直す
5. 取り込んだ結果をシーンに置く（今のシーンに追加 / 新しいシーンを作る）
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
