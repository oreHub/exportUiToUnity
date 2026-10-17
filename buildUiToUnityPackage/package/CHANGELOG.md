# 更新履歴

## 0.3.0
- 反映（段階 2）。「反映（更新）…」で、エンジニアの作業を残したまま、今のシーンの画面を新しい版に更新する
  - 部品の照合: ID → レイヤー ID（名前の変更・移動）→ 人が対応付ける
  - 値ごとに「前に取り込んだ値・今の Unity の値・新しい PSD の値」を比べ、エンジニアが変えた所と PSD が違えば必ず選んでもらう
  - 確定の前に「これから行う変更の一覧」を出す。Ctrl+Z 1 回で戻せる
  - PSD から消えた部品は、エンジニアの作業が無ければ削除、あれば非表示で残す
  - 「Unity の値を残す」を選んだものを PSD に戻す候補として記録（`<画面ID>/BuildUiToUnity_keep.json`）
- 取り込みと反映のたびに、取り込んだ layout.json の写し（`<画面ID>/BuildUiToUnity_layout.json`）を残す
- 直したこと: Prefab のインスタンスで差し替えた画像・文字などが、シーンを開き直すと Prefab の値に戻っていた

## 0.2.0
- 取り込み（段階 1）。「今のシーンに取り込む」「新しいシーンに取り込む…」で、layout.json から Canvas の下に画面を組み立てる
  - 画像を `Assets/UI/<画面ID>/Images/` にコピーして Sprite にする（取り込み先は変えられる）
  - Image / TextMeshProUGUI（既定のフォント）/ Horizontal・VerticalLayoutGroup / CanvasGroup（グループの不透明度）
  - `_Prefab` の型ごとに Prefab を 1 つ作り、ほかのインスタンスは画像・文字・位置などを差し替える（`Assets/UI/<画面ID>/Prefabs/`）
  - エラーのある版は、取り込む前に確認を出す
  - 取り込みの記録 `Assets/UI/<画面ID>/BuildUiToUnity_record.json`

## 0.1.0
- 最初の骨組み。書き出しフォルダの画面を一覧し、版・問題の件数を表示するウインドウ（取り込みは未実装）
