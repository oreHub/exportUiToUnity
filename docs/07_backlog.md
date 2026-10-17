# 07 残作業

## プラグイン（Claude Code で進める）

- [ ] **段階 3: 書き出し**（`tools/export_ui.py` と同じ出力）
  - 書き出し先フォルダの選択と記憶（UXP の `localFileSystem`、許可は最小に）
  - 画像: 部品ごとに area_ / space_ を隠して書き出し、絵の範囲で切り出す。同じ絵は 1 枚にまとめる
  - 枠（画像の area_、`_Img` の領域）がある画像は枠の大きさにし、周りを透明にする。はみ出したら注意を出す
  - layout.json / report.html（`tools/report_template.html`）/ history.json / preview.png
  - 版の判定と XMP（`uiexp:ScreenId` / `uiexp:BaseVersion`）、PSD の保存
  - Photoshop での画像の書き出し方法は要調査（複製して新しいドキュメントで書き出す、imaging API など）
- [ ] `_Fx` の印を解析で読む（今は `MARKS` に無いので名前に残ってしまう）。Python 版も同時に
- [ ] 効果の分割の書き出し（Glow / Art / Stroke、光彩は白で書き出し色を記録）
- [ ] 枠からのはみ出しを解析の時点でも出す（Photoshop の効果込みの範囲 `bounds` を使えば可能）
- [ ] 配布用の `.ccx` にまとめる手順
- [ ] 名前の変更の追跡用に、layout.json に PSD のレイヤー ID を入れる

## Unity 取り込みツール（Claude Code の IDE 拡張で、Unity プロジェクトの中で進める）

- [ ] `docs/05_unity_importer.md` の「最初に作る範囲」
- [ ] エラーのある版の確認
- [ ] 再取り込み（ID で照合、持ち分）

## その後

- [ ] AE ファイルの生成（確定した構造から）と、AE の動きを Unity に当てる仕組み。形式（AnimationClip / スクリプト）を決める
- [ ] 社内向け資料（スライド）を今の規則に合わせて更新
- [ ] 運用文書: 「修正と更新の流れ」「エンジニアが先に作る場合・同時に進める場合」
- [ ] XMP の名前空間を社内で決めたものにする

## メモ

- Python 版（`tools/`）は Python 3.10 で動作確認済み。Python 3.10 は 2026 年 10 月でサポート終了
- 依存は `psd-tools[composite]`（境界線の描画に scipy が要るため。`psd-tools` だけでは止まる）
