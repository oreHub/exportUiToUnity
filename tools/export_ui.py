"""PSD -> UIExport 書き出し（Photoshop プラグインの動作を Python で再現した検証版）

本番では同じ処理を Photoshop の UXP プラグインが行う。ここでは流れを確かめるために、
PSD を外から読んで同じ形の書き出しを作る。

書き出し先: <UIExport>/<画面ID>/
  images/        部品ごとの画像（同じ絵は 1 枚にまとめて共有）
  layout.json    構造データ（版の情報つき）
  preview.png    画面全体（area_ / space_ は除く）
  report.html    構造レポート（ブラウザで開く）
  history.json   書き出しの記録（版ごとに 1 行）

版（バージョン）
  書き出すたびに YYMMDD-n（例: 261016-1）を付ける。同じ日の 2 回目は 261016-2。
  PSD の中（XMP）に「画面 ID」と「元にした版」を書き込んで保存する。
  - PSD の「元にした版」 = フォルダの最新の版 -> そのまま書き出す
  - PSD の方が古い / 書かれていない（2 回目以降）-> 止めて知らせる（--force で続行）
  - 前の版から何も変わっていない -> 版を増やさずに終わる

使い方
  python export_ui.py <input.psd> <UIExport フォルダ> [--screen Home] [--date 261016] [--force]
依存: psd-tools, Pillow（図形レイヤーの描画に aggdraw）
"""
import argparse, datetime, hashlib, io, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import psd_to_layout as P                      # noqa: E402
from psd_tools import PSDImage                 # noqa: E402
from PIL import Image                          # noqa: E402
from psd_tools.constants import Resource       # noqa: E402

TOOL_VERSION = '261016-4'
NS = 'http://example.com/ns/uiexport/1.0/'     # 社内で決めた名前空間に置き換える
HERE = os.path.dirname(os.path.abspath(__file__))


# ------------------------------------------------------------------ PSD の中の版情報（XMP）
def read_stamp(psd):
    try:
        x = psd.image_resources.get_data(Resource.XMP_METADATA).decode('utf-8')
    except Exception:
        return {}
    out = {}
    for k in ('ScreenId', 'BaseVersion'):
        m = re.search(r'uiexp:%s="([^"]*)"' % k, x) or re.search(r'<uiexp:%s>([^<]*)</uiexp:%s>' % (k, k), x)
        if m: out[k] = m.group(1)
    return out

def write_stamp(psd, screen, version):
    x = psd.image_resources.get_data(Resource.XMP_METADATA).decode('utf-8')
    x = re.sub(r'\s*<rdf:Description rdf:about=""\s+xmlns:uiexp="[^"]*"[^>]*/>', '', x)
    desc = f'\n      <rdf:Description rdf:about="" xmlns:uiexp="{NS}" uiexp:ScreenId="{screen}" uiexp:BaseVersion="{version}"/>'
    x = x.replace('</rdf:RDF>', desc + '\n   </rdf:RDF>', 1)
    psd.image_resources[Resource.XMP_METADATA].data = x.encode('utf-8')


# ------------------------------------------------------------------ 画像
def layers_by_path(psd):
    out = {}
    def walk(g, prefix):
        for l in g:
            p = f'{prefix}/{l.name}' if prefix else l.name
            out.setdefault(p, l)
            if l.is_group(): walk(l, p)
    walk(psd, '')
    return out

def render(layer):
    """レイヤー（グループなら中身ごと）を、絵の範囲で切り出して PNG にする。area_ / space_ は描かない。"""
    hidden = []
    if layer.is_group():
        for d in layer.descendants():
            if d.name.startswith(('area_', 'space_')) and d.visible:
                d.visible = False; hidden.append(d)
    try:
        im = layer.composite()
    finally:
        for d in hidden: d.visible = True
    if im is None: return None, None
    im = im.convert('RGBA')
    box = im.getbbox()
    if box is None: return None, None
    l, t = layer.bbox[0], layer.bbox[1]
    rect = [l + box[0], t + box[1], box[2] - box[0], box[3] - box[1]]
    return im.crop(box), rect


def fit_frame(im, rect, frame):
    """枠（area_）の大きさの PNG にする。絵は PSD の位置のまま置き、周りは透明。
    絵が枠からはみ出す場合は切らずに広げる（はみ出した量を返す）"""
    fl, ft, fw, fh = frame
    L, T = min(fl, rect[0]), min(ft, rect[1])
    R, B = max(fl + fw, rect[0] + rect[2]), max(ft + fh, rect[1] + rect[3])
    canvas = Image.new('RGBA', (R - L, B - T), (0, 0, 0, 0))
    canvas.paste(im, (rect[0] - L, rect[1] - T))
    over = (fl - L, ft - T, R - fl - fw, B - ft - fh)
    return canvas, [L, T, R - L, B - T], over


def export_images(tree, psd, out_dir, issue=None):
    by_path = layers_by_path(psd)
    os.makedirs(os.path.join(out_dir, 'images'), exist_ok=True)
    seen, files = {}, {}

    def save(layer, unity_path, frame=None, frame_from=None, name=None, path=None):
        im, rect = render(layer)
        if im is None: return None
        if frame:
            im, rect, over = fit_frame(im, rect, frame)
            if any(over) and issue:
                issue('warn', 'frame_overflow', f'{name}: 絵（レイヤースタイル込み）が枠 {frame_from} の外にはみ出している'
                      f'（左 {over[0]} 上 {over[1]} 右 {over[2]} 下 {over[3]}px）。枠を広げるか、_Fx で効果を分ける', path)
        buf = io.BytesIO(); im.save(buf, 'PNG')
        data = buf.getvalue(); h = hashlib.sha1(data).hexdigest()[:12]
        if h in seen:                       # 同じ絵はファイルを共有する
            return {'file': seen[h], 'hash': h, 'rect': rect, 'shared': True}
        name = 'images/' + re.sub(r'[^A-Za-z0-9_.\-]', '_', unity_path) + '.png'
        with open(os.path.join(out_dir, name), 'wb') as f: f.write(data)
        seen[h] = name; files[name] = h
        return {'file': name, 'hash': h, 'rect': rect, 'shared': False}

    def walk(n, upath):
        up = n['unity']['name'] if not upath else f'{upath}.{n["unity"]["name"]}'
        if n['role'] == 'root': up = ''
        if n['role'] == 'image':
            lay = by_path.get(n['path'])
            if lay is not None:
                n['image'] = save(lay, up, n.get('frame'), n.get('frame_from'), n['name'], n['path'])
        if n.get('base_image'):
            lay = by_path.get(n['base_image']['path'])
            if lay is not None:
                bi = n['base_image']
                bi['image'] = save(lay, up + '.Base', bi.get('frame'), bi.get('frame_from'), bi['name'], bi['path'])
        for c in n['children']: walk(c, up)
    walk(tree, '')
    return files


# ------------------------------------------------------------------ 前の版との差分
def flatten(tree):
    out = {}
    def walk(n, up):
        p = n['unity']['name'] if not up else f'{up}/{n["unity"]["name"]}'
        if n['role'] == 'root': p = ''
        if n['role'] != 'root':
            out[p] = {'role': n['role'], 'rect': n.get('rect'),
                      'image': (n.get('image') or {}).get('hash'),
                      'base': ((n.get('base_image') or {}).get('image') or {}).get('hash'),
                      'text': (n.get('text') or {}).get('content'),
                      'components': n['unity'].get('components')}
        for c in n['children']: walk(c, p)
    walk(tree, '')
    return out

LABEL = {'role': '種類', 'rect': '位置・大きさ', 'image': '画像', 'base': '自身の画像', 'text': '文字', 'components': 'コンポーネント'}

def diff(prev, cur):
    a, b = flatten(prev), flatten(cur)
    added = sorted(set(b) - set(a)); removed = sorted(set(a) - set(b))
    changed = []
    for k in sorted(set(a) & set(b)):
        f = [LABEL[x] for x in LABEL if a[k].get(x) != b[k].get(x)]
        if f: changed.append({'path': k, 'fields': f})
    return {'added': added, 'removed': removed, 'changed': changed}


# ------------------------------------------------------------------ レポート
def build_report(layout, changes, history, out_path):
    t = open(os.path.join(HERE, 'report_template.html'), encoding='utf-8').read()
    dump = lambda x: json.dumps(x, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    t = (t.replace('/*__DATA__*/null', dump(layout)).replace('/*__CHANGES__*/null', dump(changes))
          .replace('/*__HISTORY__*/null', dump(history)).replace('__IMG__', 'preview.png'))
    open(out_path, 'w', encoding='utf-8').write(t)


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('psd'); ap.add_argument('uiexport')
    ap.add_argument('--screen'); ap.add_argument('--date'); ap.add_argument('--force', action='store_true')
    a = ap.parse_args()

    psd = PSDImage.open(a.psd)
    stamp = read_stamp(psd)
    screen = a.screen or stamp.get('ScreenId')
    if not screen:
        sys.exit('画面 ID がわかりません。初回は --screen で指定してください（例: --screen Home）')
    if stamp.get('ScreenId') and a.screen and stamp['ScreenId'] != a.screen:
        print(f'注意: この PSD は画面「{stamp["ScreenId"]}」として書き出されたものです。「{a.screen}」として書き出します。')
    out_dir = os.path.join(a.uiexport, screen)
    os.makedirs(out_dir, exist_ok=True)
    hist_path = os.path.join(out_dir, 'history.json')
    history = json.load(open(hist_path, encoding='utf-8')) if os.path.exists(hist_path) else []
    latest = history[-1]['version'] if history else None
    base = stamp.get('BaseVersion')

    # 版の照合
    if latest and base != latest and not a.force:
        if base is None:
            msg = 'この PSD には書き出しの記録がありません（新しく作り直した PSD など）。'
        elif base < latest:
            msg = f'この PSD は版 {base} を元にしていますが、フォルダには新しい版 {latest} があります（古いバックアップや別案の可能性）。'
        else:
            msg = f'この PSD の元にした版 {base} が、フォルダの最新 {latest} より新しくなっています。'
        sys.exit(f'書き出しを止めました: {msg}\n上書きしてよい場合は --force を付けてください。別案なら --screen で別の画面 ID を指定してください。')

    # 解析
    b = P.Builder(psd)
    tree = b.build()
    P.run_checks(tree, b)

    # 画像（いったん一時フォルダに出して、変更があるか確かめてから入れ替える）
    tmp = out_dir + '.__new'
    if os.path.exists(tmp):
        import shutil; shutil.rmtree(tmp)
    os.makedirs(tmp)
    files = export_images(tree, psd, tmp, b.issue)
    b.issues.sort(key=lambda i: P.LEVEL_ORDER[i['level']])
    for i in b.issues: i.pop('_key', None)

    prev_layout_path = os.path.join(out_dir, 'layout.json')
    prev = json.load(open(prev_layout_path, encoding='utf-8')) if os.path.exists(prev_layout_path) else None
    changes = diff(prev['tree'], tree) if prev else None
    if changes is not None and not (changes['added'] or changes['removed'] or changes['changed']) and not a.force:
        import shutil; shutil.rmtree(tmp)
        print(f'前の版 {latest} から変更がありません。版は増やさずに終わります。')
        return

    today = a.date or datetime.date.today().strftime('%y%m%d')
    n = sum(1 for h in history if h['version'].startswith(today + '-')) + 1
    version = f'{today}-{n}'

    fonts = sorted({(x['text'].get('font'), x['text'].get('size')) for x, _ in P.walk(tree) if x['role'] == 'text' and x.get('text')},
                   key=lambda f: (str(f[0]), f[1] or 0))
    layout = {'screen': screen, 'version': version, 'base_version': latest, 'psd_file': os.path.basename(a.psd),
              'exported_at': datetime.datetime.now().isoformat(timespec='seconds'), 'tool_version': TOOL_VERSION,
              'source': os.path.basename(a.psd), 'canvas': [psd.width, psd.height],
              'rules': {'marks': {'_Grp': 'ゲームオブジェクト', '_List': 'レイアウトグループ', '_Prefab': 'Prefab',
                                  '_Img': '1 枚の画像', '_Base': '親自身の画像'},
                        'area_prefix': 'area_', 'space_prefix': 'space_', 'tolerance_px': P.TOL},
              'fonts': [{'font': f, 'size': s} for f, s in fonts],
              'images': {'count': len(files)},
              'tree': tree, 'layouts': b.layouts, 'prefabs': b.prefabs, 'spaces': b.spaces,
              'flattened': b.flattened, 'issues': b.issues}

    # プレビュー（area_ / space_ を除く）
    hidden = [d for d in psd.descendants() if d.name.startswith(('area_', 'space_')) and d.visible]
    for d in hidden: d.visible = False
    psd.composite().convert('RGB').save(os.path.join(tmp, 'preview.png'))
    for d in hidden: d.visible = True

    lv = {k: sum(1 for i in b.issues if i['level'] == k) for k in ('error', 'warn', 'suggest', 'info')}
    entry = {'version': version, 'exported_at': layout['exported_at'], 'psd_file': layout['psd_file'],
             'base_version': latest, 'issues': lv, 'images': len(files),
             'changes': None if changes is None else {k: len(v) for k, v in changes.items()}}
    history.append(entry)

    json.dump(layout, open(os.path.join(tmp, 'layout.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(history, open(os.path.join(tmp, 'history.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    build_report(layout, changes, history, os.path.join(tmp, 'report.html'))

    # 入れ替え（images は前の版を消してから置く）
    import shutil
    for name in ('images', 'layout.json', 'history.json', 'preview.png', 'report.html'):
        dst = os.path.join(out_dir, name)
        if os.path.isdir(dst): shutil.rmtree(dst)
        elif os.path.exists(dst): os.remove(dst)
        shutil.move(os.path.join(tmp, name), dst)
    shutil.rmtree(tmp)

    # PSD に「画面 ID」と「元にした版」を書き込んで保存（プラグインは書き出しと同時に保存する）
    write_stamp(psd, screen, version)
    psd.save(a.psd)

    print(f'書き出し: {out_dir}  版 {version}（元にした版 {latest or "なし（初回）"}）')
    print(f'  画像 {len(files)} 枚 / エラー {lv["error"]} 注意 {lv["warn"]} 提案 {lv["suggest"]} 情報 {lv["info"]}')
    if changes:
        print(f'  前の版から: 追加 {len(changes["added"])} / 削除 {len(changes["removed"])} / 変更 {len(changes["changed"])}')


if __name__ == '__main__':
    main()
