# 04 layout.json の形（ツール間の約束ごと）

**layout.json の形の正はこの資料。** Photoshop プラグイン（書き出す側）、Unity 取り込みツールと AE パネル（読む側）は、
すべてこれに合わせる。形を変えるときは、この資料と、書き出す側・読む側のコードを同時に直す。

- 書き出すコード: `exportPsdToUnity_plugin/plugin/UIExport/core/export.js`（Python 版 `exportPsdToUnity_plugin/tools/export_ui.py` も同じ形。違いは `layer_id` が無いことだけ）
- 実物: `samples/UIExport/Home/layout.json`（`samples/Home.psd` の書き出し）

> 今の layout.json には「形の版」（`format_version`）が無い。互いの食い違いを検出できるように、
> 書き出す側で `format_version` を足し、読む側で確かめるようにする（`07_backlog.md`）。

## フォルダ

```
<Unityプロジェクト>/UIExport/<画面ID>/     （Assets の外。git で共有する）
 ├ layout.json     構造データ（ツールが読むもの）
 ├ images/         部品ごとの画像（PNG）。同じ絵は 1 枚を共有
 ├ preview.png     画面全体の見本（area_ / space_ は除く）
 ├ report.html     人が見るレポート
 └ history.json    書き出しの記録（版ごとに 1 行）
```

ファイル名は版ごとに変えない（Unity が同じ名前で読むため）。過去の版は git の履歴で見る。

## 最上位の項目

| 項目 | 内容 |
| --- | --- |
| `screen` | 画面 ID（例 `Home`） |
| `version` / `base_version` | 版（`YYMMDD-n`）、元にした版（初回は null）。`03_versioning.md` |
| `psd_file` / `source` | 元の PSD のファイル名 |
| `exported_at` / `tool_version` | 書き出した日時（ローカル時刻、秒まで）、書き出したツールの版 |
| `canvas` | 画面の大きさ `[幅, 高さ]`（px） |
| `rules` | 書き出したときの印の規則（印の一覧、`area_` / `space_` の接頭辞、許容差 px） |
| `fonts` | 使っているフォントと大きさの一覧 `{ font, size }`（読めなかったものは null） |
| `images` | `{ count }`（画像ファイルの数） |
| `tree` | 部品の木（下記） |
| `layouts` | 並び（LayoutGroup）の詳細 |
| `prefabs` | Prefab（明示 `explicit: true` と候補 `false`） |
| `spaces` | space_ の解釈 |
| `flattened` | 印が無いので外したグループ・1 枚にまとめたグループ |
| `issues` | エラー・注意・提案・情報 `{ level, code, message, paths }`。`level` は `error` / `warn` / `suggest` / `info` |

## 部品（`tree` の各要素）

| 項目 | 内容 |
| --- | --- |
| `role` | `root`（画面全体。1 つだけ） / `group` / `image` / `text` |
| `name` / `id` / `path` | PSD のレイヤー名（印つき） / 印を外した名前 / PSD 上のパス（印つきの名前を `/` でつなぐ。root は空） |
| `layer_id` | PSD のレイヤー ID（プラグインの書き出しだけ。Python 版には無い。root には無い） |
| `unity.name` | Unity での名前（印を外したもの）。root は `Canvas` |
| `unity.anchorMin` / `anchorMax` / `pivot` | RectTransform の値。画面端に固定されたものは 0 か 1 |
| `unity.anchoredPosition` / `sizeDelta` | RectTransform の値（Unity の座標。上が +） |
| `unity.components` | 付ける部品の種類（`RectTransform`, `Image`, `TextMeshProUGUI`, `HorizontalLayoutGroup`, `VerticalLayoutGroup`, `Canvas`, `CanvasScaler`, `Button?`） |
| `unity.prefab` | `explicit`（Prefab にする） / `candidate`（候補。作らない）。Prefab でない部品には無い |
| `prefab` | （Prefab の部品）`{ kind, index, variant }`。`kind` は `unity.prefab` と同じ、`index` は `prefabs[]` の番号、`variant` は他のインスタンスと違いがあるか（`variant` は `explicit` のときだけ付く） |
| `rect` / `rect_source` | PSD 上の位置と大きさ `[左, 上, 幅, 高さ]`（px、左上が原点） / その決め方（`area`・`layer`・`union`・`base`・`merged`・`glyphs`・`slot`・`canvas`） |
| `opacity` / `has_fx` | 不透明度（0〜1）、レイヤースタイルの有無。**画像（`image` と `base_image`）には焼き込み済み**。文字とグループの不透明度は焼き込まれていないので、読む側で当てる |
| `children` | 子の部品（並びは下から上。Unity の Hierarchy でも同じ順に並べると、後のものが前に描かれる） |
| `image` | （`role: image`）書き出した画像 `{ file, hash, rect, shared }`。絵が無い（すべて透明）ときは null |
| `base_image` | （`role: group`）親自身の画像になるレイヤー `{ name, id, path, layer_id, rect, opacity, has_fx, merged, frame, frame_from, image }`。`image` は上と同じ形 |
| `text` | （`role: text`）`{ content, font, size, color, align }`。`size` は px、`color` は `#RRGGBB`、`align` は `left` / `center` / `right`。読めなかった項目は null |
| `text_box` / `text_box_from` | （`role: text`）文字の枠（area_）の範囲と、その area_ の名前。無いときは文字の外接矩形が `rect` になる |
| `layout` | （並びのグループ）`layouts[]` の番号 |
| `layout_item` | 並びの項目として扱われている（`true`） |
| `group_area` / `group_area_from` | （`role: group`）グループの領域（area_）の範囲と、その area_ の名前 |
| `spaces` | （`role: group` と root）そのグループに置かれた space_ の、`spaces[]` での番号 |
| `anchor` | 画面端（親の端）への固定 `{ h, v }`。それぞれ `{ side, offset, from }`（`side` は `left` / `right` / `top` / `bottom`、`offset` は px、`from` は元の space_ の名前）。`unity` の値に反映済み |
| `frame` / `frame_from` | （`role: image`）画像の枠（area_）の範囲と、その area_ の名前。枠がある画像にだけ付く。画像はこの大きさで書き出してある（絵の周りは透明） |
| `merged` / `merged_count` / `merged_text` | `img`（`_Img` で 1 枚にした） / `auto`（自動でまとめた）、まとめた枚数、焼き込んだ文字 |
| `hint_dynamic` | （`role: text`）数字を含むので、実行時に変わる文字の可能性がある（`true`） |

**部品の ID**: root を除き、`unity.name` を親から `/` でつないだパス（例 `Header_Info/Btn_Menu`）。ツールの間ではこれで部品を照合する。
`path` は PSD 上のパス（印つきの名前）なので ID には使わない。

**画像の情報**（`image` と `base_image.image`）:

| 項目 | 内容 |
| --- | --- |
| `file` | `UIExport/<画面ID>/` からの相対パス（`images/<ID の / を . にした名前>.png`。`base_image` は末尾に `.Base` が付く。英数字と `_ . -` 以外は `_` になる） |
| `hash` | 画像の中身から作った値。同じ値なら同じ絵 |
| `rect` | 書き出した PNG の PSD 上の範囲 `[左, 上, 幅, 高さ]`。枠があれば枠の範囲。絵が枠からはみ出した場合は、はみ出した分だけ大きい（`issues` に `frame_overflow` が出る） |
| `shared` | `true` なら、前に出てきた部品と同じ絵で、`file` はその部品のファイルを指す（ファイルは 1 つだけ） |

`Button?` は「名前がボタンなので、Button を付けるか確認する」という意味（自動では付けない予定）。

## 並び（`layouts` の各要素）

| 項目 | 内容 |
| --- | --- |
| `group` / `group_path` | 対象のグループ（PSD のレイヤー名 / PSD 上のパス） |
| `axis` | `horizontal` / `vertical` |
| `spacing` | 間隔（px） |
| `padding_lrtb` | 内側の余白 `[左, 右, 上, 下]` |
| `item_size` | 項目の大きさ `[幅, 高さ]` |
| `items` | 項目の名前（並び順） |

## Prefab（`prefabs` の各要素）

| 項目 | 内容 |
| --- | --- |
| `name` | Prefab の名前 |
| `explicit` | `true`: `_Prefab` が付いている（作る） / `false`: 同じ構造なので候補として出しただけ（作らない） |
| `members` / `paths` | インスタンスの PSD のレイヤー名 / PSD 上のパス（印つき。部品の ID ではない） |
| `parent` | インスタンスが置かれている親（PSD のレイヤー名） |
| `variants` / `diffs` | インスタンスごとの違い |
| `inside_prefab` | （候補 `explicit: false` だけ）候補が別の Prefab の中にあるとき、その Prefab の名前（印を外した名前）。無ければ null |

## space_（`spaces` の各要素）

| 項目 | 内容 |
| --- | --- |
| `name` / `path` / `rect` / `layer_id` | space_ のレイヤー名、PSD 上のパス、範囲、PSD のレイヤー ID（プラグインの書き出しだけ） |
| `owner` | space_ が置かれているグループ（root なら `Canvas`） |
| `meaning` | `spacing`（並びの間隔） / `margin`（部品の間の距離） / `padding`（内側の余白） / `anchor`（画面端からの距離） / `unused`（使われていない） |
| `value` / `axis` / `side` / `between` / `target` | 値（px）、向き、端、間にある 2 つの部品、端に固定される部品（`meaning` によって付くものが違う） |

## まとめたグループ（`flattened` の各要素）

| 項目 | 内容 |
| --- | --- |
| `name` / `path` | グループのレイヤー名、PSD 上のパス |
| `how` | `merged`（1 枚の画像にまとめた） / `dissolved`（印が無いのでグループを外し、中身を親に入れた） |
| `count` | （`merged`）まとめた枚数 |
| `children` | （`dissolved`）外したグループの中身のレイヤー名（表示しているもの。area_ / space_ を除く） |

## 読む側が使わない項目

表に無い項目（部品の `uid`・`kind`・`psd_kind`・`visible`・`marks`・`bbox`・`rect_original`・`is_list`・`is_prefab`・`auto_item`・`from_dissolved`、
`layouts[]` の `basis`・`pitch`・`pitches`・`uniform`・`deviations`・`outside`・`reordered`・`confidence`・`spacing_source`・`padding_source` など）は、
解析の途中の情報やレポート用の情報。読む側は使わない（予告なく変わることがある）。

## history.json（各行）

| 項目 | 内容 |
| --- | --- |
| `version` / `base_version` / `exported_at` / `psd_file` | layout.json と同じ |
| `issues` | 件数 `{ error, warn, suggest, info }` |
| `images` | 画像ファイルの数 |
| `changes` | 前の版からの変更の件数 `{ added, removed, changed }`（初回は null） |
