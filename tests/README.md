# テスト

| ファイル | 内容 |
| --- | --- |
| `run_all.py` | 全部まとめて実行 |
| `dump_layers.py` | PSD → プラグインと同じ形のレイヤー情報（psd-tools で読む） |
| `py_from_layers.py` | レイヤー情報を Python 版の解析にかける（fuzz 用） |
| `parity.js` | JS 版の解析結果と Python 版の結果を照合 |
| `fuzz.py` | レイヤー情報をランダムに崩して照合（名前・表示・位置・並び・area_ の追加など） |
| `mock_panel.js` | 仮の Photoshop（`photoshop` / `uxp` モジュールの代わり）でパネルを動かす |
| `scen.js` | area_ の対応付けの個別のケース（PlayerLv_Grp、画像の枠、並べ忘れなど） |

仮の Photoshop は、モジュールの相対 `require` をプラグインの直下から解決する（UXP で一番厳しい場合に合わせている）。
