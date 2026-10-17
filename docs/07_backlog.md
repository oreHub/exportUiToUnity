# 07 残作業（全体）

ツールごとの細かい残作業は、それぞれの docs にある。

| ツール | 残作業 |
| --- | --- |
| Photoshop プラグイン | `exportPsdToUnity_plugin/docs/02_backlog.md` |
| Unity 取り込みツール | `buildUiToUnityPackage/docs/02_importer_plan.md` |
| After Effects パネル | `exportAeToUnity_plugin/docs/01_plan.md` |

## ツールをまたぐもの

- [ ] **layout.json に形の版（`format_version`）を足し、読む側で確かめる**
  - 書き出す側（プラグインと Python 版）で `format_version` を書く。形を変えたら番号を上げる
  - 読む側（Unity 取り込みツール、AE パネル）は、知らない番号なら止めて知らせる
  - `04_layout_format.md` に番号ごとの違いを書く
- [ ] AE から書き出す動きのデータの形を決める（`05_motion_format.md`）。Unity 側の形式（AnimationClip / スクリプト）も同時に
- [ ] 名前の変更の追跡: プラグインの書き出しは layout.json に PSD のレイヤー ID（`layer_id`）を入れている（Python 版は入れていない）。
      Unity の再取り込みで、ID が変わった部品をレイヤー ID で照合する
- [ ] XMP の名前空間を社内で決めたものにする（プラグインと Python 版を同時に）
- [ ] テスト用の Unity プロジェクト `dev_buildUiToUnity/` を Unity Hub で作る（`buildUiToUnityPackage/docs/01_setup.md`）

## 資料

- [ ] 社内向け資料（スライド）を今の規則に合わせて更新
- [ ] 運用文書: 「修正と更新の流れ」「エンジニアが先に作る場合・同時に進める場合」
