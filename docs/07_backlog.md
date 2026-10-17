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
- [x] テスト用の Unity プロジェクト `dev_buildUiToUnity/` を Unity Hub で作る（2026-10-17。Tools > Build UI To Unity で版 261017-3 の表示を確認）

## ブラッシュアップ（後で。今は Unity への取り込みまでを優先する）

2026-10-17、Home の実機の書き出しで見つかった課題。どれも layout.json の形と Unity 取り込みツールにかかわる。

- [ ] **Prefab の中の非表示レイヤー**: 今は非表示のレイヤーを構造から外している（「非表示のため変換しない」）。
      そのため、バッジ（`Mark_Attention_Grp`）を全インスタンスに入れて、使わないものを非表示にしても、
      「Present だけ多い」（`prefab_variant`）のまま変わらない。
      Prefab の中の非表示レイヤーは「初期状態では非表示の部品」として残し（Unity では `SetActive(false)`）、
      インスタンスごとの表示・非表示を差分として扱う案。layout.json に表示・非表示の項目を足す必要がある
- [ ] **Prefab のまとめ方を分かりやすくする**: 同じ親の中で `_Prefab` が付いた同じ構造のグループは、すでに 1 つの Prefab
      （例 `Btn_Footer`）とそのインスタンスとして出力し、違い（画像・文字）は `prefabs[].diffs` に入る。
      Unity では Prefab を 1 つ作り、インスタンスで差し替える計画（`buildUiToUnityPackage/docs/02_importer_plan.md`）。
      残る課題: 親が違う場所の同じ型をまとめる、Prefab の名前を決められるようにする（今は ID の共通の頭）、
      パネルとレポートで「1 つの Prefab＋差し替え」と分かるように見せる
- [ ] **部品の基準の範囲とデザインの指針**: 例 `Btn_MenuR_*_Prefab` の位置・大きさ・間隔は、デザイン上はアイコン
      （`Icon_MenuR_*`）で決まり、バッジは付属物。今はバッジも含めた範囲で間隔を測るので、提案（`slot_area`）が出る。
      今の応急の手段は、アイコンと同じ大きさの `area_<グループの ID>` を置くこと（1 つずつ手で置く）。
      「どのレイヤーが基準か」「付属物は範囲に含めない」などの指針を、印や規則として仕組みに取り入れる方法を考える

## 資料

- [ ] 社内向け資料（スライド）を今の規則に合わせて更新
- [ ] 運用文書: 「修正と更新の流れ」「エンジニアが先に作る場合・同時に進める場合」
