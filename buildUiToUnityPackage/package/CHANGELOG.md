# 更新履歴

## 0.2.0
- 取り込み（段階 1）。「今のシーンに取り込む」「新しいシーンに取り込む…」で、layout.json から Canvas の下に画面を組み立てる
  - 画像を `Assets/UI/<画面ID>/Images/` にコピーして Sprite にする（取り込み先は変えられる）
  - Image / TextMeshProUGUI（既定のフォント）/ Horizontal・VerticalLayoutGroup / CanvasGroup（グループの不透明度）
  - `_Prefab` の型ごとに Prefab を 1 つ作り、ほかのインスタンスは画像・文字・位置などを差し替える（`Assets/UI/<画面ID>/Prefabs/`）
  - エラーのある版は、取り込む前に確認を出す
  - 取り込みの記録 `Assets/UI/<画面ID>/BuildUiToUnity_record.json`

## 0.1.0
- 最初の骨組み。書き出しフォルダの画面を一覧し、版・問題の件数を表示するウインドウ（取り込みは未実装）
