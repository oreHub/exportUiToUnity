"""PSD -> Unity UI 構造（中間 JSON）

PSD のレイヤー名に付けた印から、Unity(uGUI) の階層・位置とサイズ・LayoutGroup・Prefab・
テキスト枠を組み立て、印の抜けや食い違いを「提案」として一覧にする。Unity や AE は不要。

印（名前の末尾。重ねて付けられる。Unity 上の名前からは外す）
  _Grp     グループ   ゲームオブジェクトとして残す（大きな親も、ボタンやバッジなどの小さな部品も）
  _List    グループ   レイアウトグループ。直下の子は印が無くても並びの項目になる。向きと間隔は位置から判定
  _Prefab  グループ   Prefab にする（_Grp / _List に重ねる。単独なら _Grp_Prefab とみなす。_Pf も可）
  _Img     グループ   中身ごと 1 枚の画像にする（文字やレイヤースタイルも焼き込む）
  _Base    レイヤー / _Img グループ   親（_Grp / _List）自身の Image になる。子としては作らない
  area_*   レイヤー（先頭）  領域の指定。対応付けは次の順
             1. 名前がそれを含むグループの ID と同じ（area_PlayerLv -> PlayerLv_Grp）: そのグループの領域
             2. 名前が同じ階層の画像レイヤーと同じ（area_Icon_A -> Icon_A）: その画像の枠
             3. 文字レイヤーのすぐ下にある: その文字の枠
             4. それ以外: それを含むグループの領域
           画像の枠・_Img の領域が決まっている画像は、枠の大きさで書き出す（絵の周りは透明）
  space_*  レイヤー（先頭）  間隔（_List の項目の間）・内側の余白（容器の端）・画面端からの距離
           area_ と space_ は表示・非表示に関係なく構造の情報としてだけ使い、画像にはしない

印の無いグループ
  画像だけ          -> 自動で 1 枚の画像にまとめる（レポートで確認できる）
  文字や印付きを含む -> グループを外し、中身を一番近い印付きの親に入れる

使い方
  python psd_to_layout.py <input.psd> <output.json>
依存: psd-tools
"""
import json, re, sys, os, statistics, math
from collections import Counter, defaultdict
from psd_tools import PSDImage

TOL = 3
MARKS = (('_Grp', 'grp'), ('_List', 'list'), ('_Prefab', 'prefab'), ('_Pf', 'prefab'),
         ('_Img', 'img'), ('_Base', 'base'))
DEFAULT_NAME = re.compile(
    r'^(長方形|楕円|多角形|シェイプ|レイヤー|べた塗り|グラデーション|パス|線|グループ|'
    r'Rectangle|Ellipse|Polygon|Shape|Layer|Group|Color Fill|Path)\s*\d*'
    r'(\s*のコピー(\s*\d+)?|\s*copy(\s*\d+)?)?$', re.I)
ID_CHARS = re.compile(r'^[A-Za-z0-9_\-]+$')
NUMERIC_TEXT = re.compile(r'^[\d,.\s:/%+\-]+$')
DICTIONARY = {'Prefab', 'List', 'Footer', 'Header', 'Button', 'Btn', 'Icon', 'Menu', 'area', 'Banner',
              'Present', 'Event', 'Quest', 'Shop', 'Item', 'Image', 'Gauge', 'Carousel', 'Name', 'Mark',
              'Attention', 'Battle', 'Card', 'Deck', 'Guild', 'Chara', 'Gacha', 'Base', 'Fill'}
GENERIC_TOKENS = {'grp', 'list', 'prefab', 'pf', 'img', 'base', 'area', 'btn', 'button', 'icon', 'image',
                  'name', 'menu', 'item', 'banner', 'mark', 'gauge', 'header', 'footer', 'bg', 'ui', 'on',
                  'off', 'info', 'fill'}
LEVEL_ORDER = {'error': 0, 'warn': 1, 'suggest': 2, 'info': 3}


# ------------------------------------------------------------------ helpers
def rect_of(b):
    l, t, r, btm = b
    return [l, t, r - l, btm - t]

def layer_rect(layer, W, H):
    """レイヤーの位置と大きさ。シェイプはベクトルの範囲（Photoshop の属性パネルと同じ値。
    ピクセルの範囲はアンチエイリアスで 1〜2px 大きくなる）"""
    if layer.kind == 'shape':
        vm = getattr(layer, 'vector_mask', None)
        try:
            l, t, r, b = vm.bbox
            l, t, r, b = l * W, t * H, r * W, b * H
            st = getattr(layer, 'stroke', None)      # シェイプの線（レイヤースタイルではない）は範囲に含める
            if st is not None and st.enabled:
                al = str(getattr(st, 'line_alignment', 'center')).lower()
                e = 0 if ('inside' in al or 'inner' in al) else (st.line_width if ('outside' in al or 'outer' in al) else st.line_width / 2)
                l, t, r, b = l - e, t - e, r + e, b + e
            L, T, R, B = math.floor(l + 0.01), math.floor(t + 0.01), math.ceil(r - 0.01), math.ceil(b - 0.01)
            if R > L and B > T: return [L, T, R - L, B - T]
        except Exception:
            pass
    return rect_of(layer.bbox)

def group_rect(children, fallback):
    """グループの範囲 = 表示されている中身（area_ / space_ を除く）の範囲"""
    return union([c['bbox'] for c in children if c['visible'] and c['kind'] not in ('area', 'space')]) or fallback

def union(rects):
    rects = [r for r in rects if r and r[2] > 0 and r[3] > 0]
    if not rects: return None
    l = min(r[0] for r in rects); t = min(r[1] for r in rects)
    return [l, t, max(r[0] + r[2] for r in rects) - l, max(r[1] + r[3] for r in rects) - t]

def center(r): return (r[0] + r[2] / 2, r[1] + r[3] / 2)

def contains(outer, inner, tol=0):
    return (inner[0] >= outer[0] - tol and inner[1] >= outer[1] - tol and
            inner[0] + inner[2] <= outer[0] + outer[2] + tol and inner[1] + inner[3] <= outer[1] + outer[3] + tol)

def point_in(r, p, tol=TOL):
    return r[0] - tol <= p[0] <= r[0] + r[2] + tol and r[1] - tol <= p[1] <= r[1] + r[3] + tol

def overlap(a, b):
    w = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]); h = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return max(w, 0) * max(h, 0)

def area(r): return r[2] * r[3]

def tokens(name): return [t for t in re.split(r'[_\s\-?]+', name) if t]

def lev(a, b):
    a, b = a.lower(), b.lower()
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def parse_marks(name):
    marks, base = set(), name
    changed = True
    while changed:
        changed = False
        for suf, key in MARKS:
            if base.endswith(suf) and len(base) > len(suf):
                base = base[:-len(suf)]; marks.add(key); changed = True
    return base, marks

def common_prefix(names):
    if not names: return ''
    return os.path.commonprefix(names).rstrip('_-') or names[0]

def text_info(layer):
    info = {'content': None, 'font': None, 'size': None, 'color': None, 'align': None}
    try:
        info['content'] = layer.text.replace('\r', '\n').strip()
        ed, rd = layer.engine_dict, layer.resource_dict
        ss = ed['StyleRun']['RunArray'][0]['StyleSheet']['StyleSheetData']
        ps = ed['ParagraphRun']['RunArray'][0]['ParagraphSheet']['Properties']
        scale = abs(layer.transform[3]) if layer.transform else 1.0
        if 'FontSize' in ss: info['size'] = round(float(ss['FontSize']) * scale, 1)
        if 'Font' in ss: info['font'] = str(rd['FontSet'][int(ss['Font'])]['Name']).strip("'")
        fc = ss.get('FillColor')
        if fc:
            a, r, g, b = [float(v) for v in fc['Values']]
            info['color'] = '#%02X%02X%02X' % (round(r * 255), round(g * 255), round(b * 255))
        info['align'] = {0: 'left', 1: 'right', 2: 'center'}.get(int(ps.get('Justification', 0)), 'left')
    except Exception:
        pass
    return info


class Builder:
    def __init__(self, psd):
        self.psd = psd
        self.W, self.H = psd.width, psd.height
        self.issues, self.layouts, self.prefabs, self.flattened, self.spaces = [], [], [], [], []
        self.uid = 0

    def issue(self, level, code, msg, path=None, key=None, **kw):
        key = key or (code, msg)
        for i in self.issues:
            if i.get('_key') == key:
                if path and path not in i['paths']: i['paths'].append(path)
                return
        self.issues.append({'level': level, 'code': code, 'message': msg, 'paths': [path] if path else [],
                            '_key': key, **kw})

    # ------------------------------------------------------------------ 1. PSD を読む
    def raw(self, layer, parent_path):
        self.uid += 1
        name = layer.name
        path = f'{parent_path}/{name}' if parent_path else name
        nid, marks = parse_marks(name)
        n = {'uid': self.uid, 'name': name, 'id': nid, 'marks': sorted(marks), 'path': path,
             'psd_kind': layer.kind, 'visible': bool(layer.visible), 'opacity': round(layer.opacity / 255, 3),
             'has_fx': bool(layer.has_effects()) if hasattr(layer, 'has_effects') else False,
             'bbox': layer_rect(layer, self.W, self.H), 'children': []}
        if layer.is_group():
            n['kind'] = 'group'
            n['children'] = [self.raw(c, path) for c in layer]
            n['bbox'] = group_rect(n['children'], n['bbox'])
        elif name.startswith('area_'):
            n['kind'] = 'area'
        elif name.startswith('space_'):
            n['kind'] = 'space'
        elif layer.kind == 'type':
            n['kind'] = 'text'; n['text'] = text_info(layer)
        else:
            n['kind'] = 'image'
        return n

    # ------------------------------------------------------------------ 2. 構造を決める
    def build(self):
        root = {'uid': 0, 'name': 'Canvas', 'id': 'Canvas', 'marks': ['grp'], 'path': '', 'kind': 'group',
                'psd_kind': 'document', 'visible': True, 'opacity': 1, 'has_fx': False,
                'bbox': [0, 0, self.W, self.H], 'children': [self.raw(l, '') for l in self.psd]}
        self.raw_root = json.loads(json.dumps(root))
        root = self.container(root, is_root=True)
        root['rect'] = [0, 0, self.W, self.H]; root['rect_source'] = 'canvas'
        self.prefab_classes(root)
        self.to_unity(root, None)
        return root

    @staticmethod
    def descendants(n):
        for c in n['children']:
            yield c
            yield from Builder.descendants(c)

    def has_structure(self, g):
        for d in self.descendants(g):
            if d['kind'] == 'space': return True
            if not d['visible'] and d['kind'] != 'area': continue
            if d['kind'] == 'text': return True
            if d['kind'] == 'group' and set(d['marks']) & {'grp', 'list', 'prefab', 'base'}: return True
            if d['kind'] == 'image' and 'base' in d['marks']: return True
        return False

    @staticmethod
    def above(kids, a):
        i = next(i for i, x in enumerate(kids) if x is a)
        return kids[i + 1] if i + 1 < len(kids) else None

    def merged_frame(self, g):
        """1 枚にまとめるグループの領域（中の area_）。文字のすぐ下の area_ は文字枠なので除く"""
        kids = g['children']
        areas = [c for c in kids if c['kind'] == 'area']
        named = [a for a in areas if a['name'][5:].lower() == g['id'].lower()]
        if named: return named[0]
        free = [a for a in areas if not ((self.above(kids, a) or {}).get('kind') == 'text')]
        if len(free) > 1:
            self.issue('warn', 'area_conflict', f'{g["name"]}: 範囲を決める area_ が複数ある（{"・".join(a["name"] for a in free)}）。'
                       f'area_{g["id"]} の名前で 1 つに決める', g['path'])
        return free[0] if free else None

    def as_image(self, g, how):
        vis = [d for d in self.descendants(g) if d['visible'] and d['kind'] not in ('group', 'area', 'space')]
        n = dict(g)
        n.update({'role': 'image', 'merged': how, 'merged_count': len(vis),
                  'merged_text': [d['text']['content'] for d in vis if d['kind'] == 'text'],
                  'children': [], 'rect': g['bbox'], 'rect_source': 'merged'})
        fr = self.merged_frame(g)
        if fr:
            n.update({'frame': fr['bbox'], 'frame_from': fr['name'], 'rect': fr['bbox'], 'rect_source': 'area'})
        return n

    def leaf(self, c):
        if c['kind'] == 'text': c['role'] = 'text'
        elif c['kind'] == 'area': c['role'] = 'area'
        elif c['kind'] == 'space':
            c['role'] = 'space'; c['rect'] = c['bbox']
        else:
            c['role'] = 'image'
            if c.get('frame'):
                c['rect'] = c['frame']; c['rect_source'] = 'area'
            else:
                c['rect'] = c['bbox']; c['rect_source'] = 'layer'
        return c

    def assign_areas(self, scope_kids, owner):
        """area_ の対応付け（名前 -> 文字のすぐ下 -> グループ）。グループの領域 (矩形, 名前) を返す"""
        group_area, fallback = None, []
        for a in [c for c in scope_kids if c['kind'] == 'area']:
            ar, key = a['bbox'], a['name'][5:].lower()
            up = self.above(scope_kids, a)
            img = next((c for c in scope_kids if c['kind'] == 'image' and key in (c['name'].lower(), c['id'].lower())), None)
            sib = next((c for c in scope_kids if c['kind'] == 'group' and c['id'].lower() == key), None)
            if key == owner['id'].lower():
                how = 'group'
            elif img is not None:
                how = 'image'
            elif sib is not None:
                self.issue('warn', 'area_outside', f'{a["name"]}: {sib["name"]} と同じ名前だが、そのグループの外にある。{sib["name"]} の領域にするなら中に入れる', a['path'])
                continue
            elif up is not None and up['kind'] == 'text':
                how = 'text'
            else:
                fallback.append(a); continue
            if how == 'text':
                up['text_box'] = ar; up['text_box_from'] = a['name']
                if up['visible'] and not contains(ar, up['bbox'], tol=1):
                    self.issue('warn', 'text_overflow', f'文字が枠からはみ出している: 「{up["text"]["content"]}」（{a["name"]}）', up['path'])
            elif how == 'image':
                if img.get('frame'):
                    self.issue('warn', 'area_conflict', f'{img["name"]}: 枠の area_ が複数ある（{img["frame_from"]}・{a["name"]}）', a['path'])
                    continue
                img['frame'] = ar; img['frame_from'] = a['name']
            else:
                if group_area:
                    self.issue('warn', 'area_conflict', f'{owner["name"]}: 範囲を決める area_ が複数ある（{group_area[1]}・{a["name"]}）。'
                               f'area_{owner["id"]} の名前で 1 つに決める', a['path'])
                    continue
                group_area = (ar, a['name'])
        # 名前でも並びでも決まらない area_ はグループの領域。ただし枠の無い文字 1 つだけを囲むものは並べ忘れとみなし、使わない
        for a in fallback:
            ar = a['bbox']
            inside = [c for c in scope_kids if c['visible'] and c['kind'] in ('text', 'image', 'group') and point_in(ar, center(c['bbox']))]
            if len(inside) == 1 and inside[0]['kind'] == 'text' and not inside[0].get('text_box'):
                t = inside[0]
                self.issue('warn', 'area_order', f'{a["name"]}: 文字「{t["text"]["content"]}」だけを囲んでいるが、文字レイヤーのすぐ下に無い。'
                           f'文字の枠なら文字のすぐ下に移す。{owner["name"]} の領域なら名前を area_{owner["id"]} にする（今はどちらにも使っていない）', a['path'])
                continue
            if group_area:
                self.issue('warn', 'area_conflict', f'{owner["name"]}: 範囲を決める area_ が複数ある（{group_area[1]}・{a["name"]}）。'
                           f'area_{owner["id"]} の名前で 1 つに決める', a['path'])
                continue
            group_area = (ar, a['name'])
        return group_area

    def container(self, g, is_root=False, auto_item=False):
        g['role'] = 'root' if is_root else 'group'
        g['auto_item'] = auto_item
        marks = set(g['marks'])
        if 'prefab' in marks and not marks & {'grp', 'list'}: marks.add('grp')
        g['is_list'] = 'list' in marks
        g['is_prefab'] = 'prefab' in marks
        group_area = self.assign_areas(g['children'], g)
        kids = []
        for c in g['children']:
            kids += self.place(c, g)
        if group_area:
            g['group_area'], g['group_area_from'] = group_area
        bases = [c for c in kids if 'base' in c.get('marks', []) and c['role'] == 'image']
        if len(bases) > 1:
            self.issue('error', 'base_multi', f'{g["name"]}: _Base が {len(bases)} 個ある（親の画像は 1 つだけ）', g['path'])
        if bases:
            b = bases[0]
            g['base_image'] = {'name': b['name'], 'id': b['id'], 'rect': b['rect'], 'merged': b.get('merged'),
                               'frame': b.get('frame'), 'frame_from': b.get('frame_from'), 'opacity': b['opacity'], 'has_fx': b['has_fx'], 'path': b['path']}
            kids = [c for c in kids if c is not b]
        for c in kids:
            if c['role'] == 'text':
                if c.get('text_box'):
                    c['rect'] = c['text_box']; c['rect_source'] = 'area'
                else:
                    c['rect'] = c['bbox']; c['rect_source'] = 'glyphs'
                    self.issue('info', 'no_text_box', f'文字の枠（area_）が無いので、文字の外接矩形を使う: 「{c["text"]["content"]}」', c['path'])
        spaces = [c for c in kids if c['role'] == 'space']
        g['children'] = [c for c in kids if c['role'] not in ('area', 'space')]
        if is_root:
            g['rect'] = [0, 0, self.W, self.H]
        elif g.get('group_area'): g['rect'], g['rect_source'] = g['group_area'], 'area'
        elif g.get('base_image'): g['rect'], g['rect_source'] = g['base_image']['rect'], 'base'
        else:
            # 内側の余白（space_）も容器の範囲に含める
            g['rect'] = union([c['rect'] for c in g['children']] + [sp['rect'] for sp in spaces]) or g['bbox']
            g['rect_source'] = 'union'
        if g['is_list']:
            self.detect_list(g)
        self.apply_spaces(g, spaces)
        return g

    # --- space_: 間隔・内側の余白・画面端からの距離
    def apply_spaces(self, g, spaces):
        if not spaces: return
        near = lambda a, b: abs(a - b) <= TOL
        span = lambda a0, a1, b0, b1: min(a1, b1) - max(a0, b0) > 0
        gr = g['rect']; GL, GT, GR, GB = gr[0], gr[1], gr[0] + gr[2], gr[1] + gr[3]
        kids = [c for c in g['children'] if c.get('rect')]
        lay = self.layouts[g['layout']] if g.get('layout') is not None else None
        is_root = g['role'] == 'root'
        for sp in spaces:
            r = sp['rect']; L, T, R, B = r[0], r[1], r[0] + r[2], r[1] + r[3]
            hit = None
            for a in kids:
                ar = a['rect']
                for b in kids:
                    if a is b: continue
                    br = b['rect']
                    if near(L, ar[0] + ar[2]) and near(R, br[0]) and span(T, B, ar[1], ar[1] + ar[3]) and span(T, B, br[1], br[1] + br[3]):
                        hit = ('between', 'horizontal', a, b, r[2])
                    elif near(T, ar[1] + ar[3]) and near(B, br[1]) and span(L, R, ar[0], ar[0] + ar[2]) and span(L, R, br[0], br[0] + br[2]):
                        hit = ('between', 'vertical', a, b, r[3])
                    if hit: break
                if hit: break
            if not hit:
                # 片側だけ部品に接している = 間隔の指定だが、実際の間隔と違う
                for a in kids:
                    ar = a['rect']
                    if near(L, ar[0] + ar[2]) and span(T, B, ar[1], ar[1] + ar[3]):
                        nxt = [b for b in kids if b is not a and b['rect'][0] >= ar[0] + ar[2] - TOL and span(T, B, b['rect'][1], b['rect'][1] + b['rect'][3])]
                        if nxt:
                            b = min(nxt, key=lambda b: b['rect'][0])
                            hit = ('between', 'horizontal', a, b, r[2], b['rect'][0] - ar[0] - ar[2])
                    elif near(T, ar[1] + ar[3]) and span(L, R, ar[0], ar[0] + ar[2]):
                        nxt = [b for b in kids if b is not a and b['rect'][1] >= ar[1] + ar[3] - TOL and span(L, R, b['rect'][0], b['rect'][0] + b['rect'][2])]
                        if nxt:
                            b = min(nxt, key=lambda b: b['rect'][1])
                            hit = ('between', 'vertical', a, b, r[3], b['rect'][1] - ar[1] - ar[3])
                    if hit: break
            if not hit:
                for c in kids:
                    cr = c['rect']; CL, CT, CR, CB = cr[0], cr[1], cr[0] + cr[2], cr[1] + cr[3]
                    if near(L, GL) and near(R, CL) and span(T, B, CT, CB): hit = ('edge', 'left', c, CL - GL, r[2])
                    elif near(R, GR) and near(L, CR) and span(T, B, CT, CB): hit = ('edge', 'right', c, GR - CR, r[2])
                    elif near(T, GT) and near(B, CT) and span(L, R, CL, CR): hit = ('edge', 'top', c, CT - GT, r[3])
                    elif near(B, GB) and near(T, CB) and span(L, R, CL, CR): hit = ('edge', 'bottom', c, GB - CB, r[3])
                    if hit: break
            rec = {'name': sp['name'], 'path': sp['path'], 'rect': r, 'owner': g['name']}
            if not hit:
                rec['meaning'] = 'unused'
                self.issue('warn', 'space_unused', f'{sp["name"]}: どの部品にも、{g["name"]} の端にも接していない（許容差 {TOL}px）', sp['path'])
            elif hit[0] == 'between':
                _, axis, a, b, val = hit[:5]
                rec.update({'meaning': 'spacing' if lay else 'margin', 'value': val, 'axis': axis, 'between': [a['name'], b['name']]})
                if len(hit) > 5:
                    self.issue('warn', 'space_mismatch', f'{sp["name"]}: space_ の幅 {val}px と、{a["name"]} と {b["name"]} の実際の間隔 {hit[5]}px が違う', sp['path'])
                if lay and lay['axis'] == axis:
                    if val != lay['spacing'] and len(hit) == 5:
                        self.issue('warn', 'space_mismatch', f'{g["name"]}: {sp["name"]} の間隔 {val}px と、位置から計算した間隔 {lay["spacing"]}px が違う（space_ を優先）', sp['path'])
                    lay['spacing'] = val; lay['spacing_source'] = sp['name']
                elif lay:
                    self.issue('warn', 'space_axis', f'{sp["name"]}: 並びの向きと違う向きの間隔になっている', sp['path'])
            else:
                _, side, c, actual, val = hit
                if lay:
                    i = ['left', 'right', 'top', 'bottom'].index(side)
                    rec.update({'meaning': 'padding', 'side': side, 'value': val})
                    lay['padding_lrtb'][i] = val; lay.setdefault('padding_source', {})[side] = sp['name']
                else:
                    rec.update({'meaning': 'anchor', 'side': side, 'value': val, 'target': c['name']})
                    c.setdefault('anchor', {})['h' if side in ('left', 'right') else 'v'] = {'side': side, 'offset': val, 'from': sp['name']}
                if actual != val:
                    self.issue('warn', 'space_mismatch', f'{sp["name"]}: space_ の幅 {val}px と、実際の距離 {actual}px が違う（space_ を優先）', sp['path'])
            self.spaces.append(rec)
            g.setdefault('spaces', []).append(len(self.spaces) - 1)

    def place(self, c, parent):
        if not c['visible'] and c['kind'] not in ('area', 'space'):
            self.issue('info', 'hidden', f'非表示のため変換しない: {c["name"]}', c['path'])
            return []
        if c['kind'] != 'group':
            if set(c['marks']) - {'base'}:
                self.issue('warn', 'mark_on_layer', f'{c["name"]}: グループ用の印がレイヤーに付いている', c['path'])
            return [self.leaf(c)]
        marks = set(c['marks'])
        if 'img' in marks:
            if marks & {'grp', 'list', 'prefab'}:
                self.issue('warn', 'mark_conflict', f'{c["name"]}: _Img と _Grp/_List/_Prefab は同時に使えない（_Img を優先）', c['path'])
            n = self.as_image(c, 'img')
            if n['merged_text']:
                self.issue('info', 'img_text', f'{c["name"]}: 文字「{" / ".join(n["merged_text"])}」も画像に焼き込む', c['path'])
            return [n]
        if marks & {'grp', 'list', 'prefab'}:
            return [self.container(c)]
        if parent.get('is_list') or 'list' in parent.get('marks', []):
            return [self.container(c, auto_item=True)]
        if 'base' in marks:
            self.issue('warn', 'base_group', f'{c["name"]}: グループを親の画像にするときは _Img と一緒に付ける（例: {c["id"]}_Img_Base）', c['path'])
        if not self.has_structure(c):
            n = self.as_image(c, 'auto')
            self.flattened.append({'name': c['name'], 'path': c['path'], 'how': 'merged', 'count': n['merged_count']})
            return [n]
        ga = self.assign_areas(c['children'], c)
        self.flattened.append({'name': c['name'], 'path': c['path'], 'how': 'dissolved',
                               'children': [x['name'] for x in c['children'] if x['visible'] and x['kind'] not in ('area', 'space')]})
        if ga:
            self.issue('info', 'area_dropped', f'印の無いグループ {c["name"]} の範囲指定 {ga[1]} は使われない', c['path'])
        out = []
        for x in c['children']:
            if x['kind'] == 'area': continue
            for y in self.place(x, parent):
                y.setdefault('from_dissolved', c['name'])
                out.append(y)
        return out

    # ------------------------------------------------------------------ 3. 並び（_List）
    def key_rect(self, item):
        if item['role'] == 'group':
            if item.get('group_area'): return item['group_area'], item['group_area_from']
            if item.get('base_image'): return item['base_image']['rect'], item['base_image']['name']
            imgs = [c for c in item['children'] if c['role'] == 'image']
            if imgs:
                big = max(imgs, key=lambda c: area(c['rect']))
                return big['rect'], big['name']
        return item['rect'], item['name']

    def find_runs(self, items):
        keyed = [(c, *self.key_rect(c)) for c in items]
        used, runs = set(), []
        for axis in ('horizontal', 'vertical'):
            k = 0 if axis == 'horizontal' else 1
            groups = []
            for c, kr, kn in keyed:
                if c['uid'] in used: continue
                for grp in groups:
                    r0 = grp[0][1]
                    same = abs(r0[2] - kr[2]) <= TOL and abs(r0[3] - kr[3]) <= TOL
                    aligned = abs(r0[1] - kr[1]) <= TOL if axis == 'horizontal' else abs(r0[0] - kr[0]) <= TOL
                    if same and aligned: grp.append((c, kr, kn)); break
                else:
                    groups.append([(c, kr, kn)])
            for grp in groups:
                if len(grp) < 2: continue
                grp.sort(key=lambda e: e[1][k])
                starts = [e[1][k] for e in grp]
                pitches = [b - a for a, b in zip(starts, starts[1:])]
                if min(pitches) < grp[0][1][2 + k] - TOL: continue
                for e in grp: used.add(e[0]['uid'])
                runs.append((axis, grp, pitches))
        return runs

    def detect_list(self, g):
        items = [c for c in g['children'] if c['role'] in ('group', 'image')]
        for t in [c for c in g['children'] if c['role'] == 'text']:
            self.issue('warn', 'list_text', f'{g["name"]}: 並びの中に文字「{t["text"]["content"]}」が直接入っている。項目のグループの中に入れる', t['path'])
        if len(items) < 2:
            self.issue('warn', 'list_short', f'{g["name"]}: _List なのに項目が {len(items)} 個しかない', g['path']); return
        runs = self.find_runs(items)
        if not runs:
            self.issue('warn', 'list_not_aligned', f'{g["name"]}: _List だが、同じ大きさの項目が一列に並んでいない', g['path']); return
        axis, grp, pitches = max(runs, key=lambda r: len(r[1]))
        k = 0 if axis == 'horizontal' else 1
        ids = {e[0]['uid'] for e in grp}
        outside = [c for c in items if c['uid'] not in ids]
        if outside:
            self.issue('warn', 'list_outsider',
                       f'{g["name"]}: {"・".join(c["name"] for c in outside)} が並びに入っていない（大きさか位置が他の項目と違う）。並びの外に出すか、大きさをそろえる', g['path'])
        cnt = Counter(pitches)
        mode, mode_n = cnt.most_common(1)[0]
        uniform = len(cnt) == 1
        no_mode = not uniform and mode_n == 1
        if no_mode: mode = round(statistics.median(pitches))
        dev = []
        if not uniform and not no_mode:
            for i, p in enumerate(pitches):
                if p != mode:
                    dev.append({'between': [grp[i][0]['name'], grp[i + 1][0]['name']], 'pitch': p, 'expected': mode, 'diff': p - mode})
                    self.issue('warn', 'spacing', f'{g["name"]}: {grp[i][0]["name"]} と {grp[i + 1][0]["name"]} の間隔が {p}px（他は {mode}px、差 {p - mode:+d}px）', g['path'])
        if no_mode:
            self.issue('warn', 'spacing', f'{g["name"]}: 間隔が揃っていない（{" / ".join(str(x) for x in pitches)}px）', g['path'])
        offs = [(e[0]['rect'][0] - e[1][0], e[0]['rect'][1] - e[1][1], e[0]['rect'][2], e[0]['rect'][3]) for e in grp]
        slot = Counter(offs).most_common(1)[0][0]
        for e, o in zip(grp, offs):
            if o == slot: continue
            if max(abs(a - b) for a, b in zip(o, slot)) <= TOL:
                self.issue('info', 'size_mismatch', f'{g["name"]}: 項目の大きさが少し違う（{e[0]["name"]} {o[2]}×{o[3]} / 他 {slot[2]}×{slot[3]}）。中の area_ の大きさをそろえると良い', e[0]['path'], key=('size_mismatch', g['uid']))
                continue
            it = e[0]
            it['rect_original'] = it['rect']
            it['rect'] = [e[1][0] + slot[0], e[1][1] + slot[1], slot[2], slot[3]]
            it['rect_source'] = 'slot'
            self.issue('suggest', 'slot_area', f'{it["name"]}: 中身のはみ出し（バッジ等）で他の項目より大きい（{o[2]}×{o[3]} / 他 {slot[2]}×{slot[3]}）。枠は他にそろえた。項目全体の area_ を置くと確実', it['path'])
        order = {e[0]['uid']: i for i, e in enumerate(grp)}
        psd_order = [c['name'] for c in g['children'] if c['uid'] in order]
        g['children'].sort(key=lambda c: order.get(c['uid'], 999))
        for e in grp: e[0]['layout_item'] = True
        first, last, gr = grp[0][0]['rect'], grp[-1][0]['rect'], g['rect']
        self.layouts.append({
            'group': g['name'], 'group_path': g['path'], 'axis': axis, 'items': [e[0]['name'] for e in grp],
            'basis': [e[2] for e in grp], 'pitch': mode, 'pitches': pitches, 'spacing': mode - slot[2 + k],
            'item_size': [slot[2], slot[3]],
            'padding_lrtb': [first[0] - gr[0], gr[0] + gr[2] - last[0] - last[2], first[1] - gr[1], gr[1] + gr[3] - last[1] - last[3]],
            'uniform': uniform, 'deviations': dev, 'outside': [c['name'] for c in outside],
            'reordered': psd_order != [e[0]['name'] for e in grp],
            'confidence': 'high' if (len(grp) >= 3 and uniform and not outside) else ('check' if (not uniform or outside) else 'medium')})
        g['layout'] = len(self.layouts) - 1

    # ------------------------------------------------------------------ 4. Prefab
    def sig(self, n):
        r = n['role']
        if r == 'text': return ('T',)
        if r == 'image':
            q = lambda v: int(round(v / 4.0))
            return ('M' if n.get('merged') else 'I', q(n['rect'][2]), q(n['rect'][3]))
        return ('G', bool(n.get('base_image')), tuple(self.sig(c) for c in n['children']))

    def leaves(self, n):
        out = []
        for c in n['children']:
            out += self.leaves(c) if c['role'] == 'group' else [c]
        return out

    def diffs(self, members):
        out = []
        lv = [self.leaves(g) for g in members]
        if not lv or not all(lv): return out
        for j in range(min(len(x) for x in lv)):
            col = [x[j] for x in lv]
            if col[0]['role'] == 'text':
                vals = [c['text']['content'] for c in col]
                if len(set(vals)) > 1: out.append({'kind': 'text', 'label': '文字', 'values': vals})
                elif NUMERIC_TEXT.match(vals[0] or ''): out.append({'kind': 'runtime', 'label': '数字（実行時）', 'values': vals})
            else:
                vals = [c['name'] for c in col]
                if len(set(vals)) > 1: out.append({'kind': 'image', 'label': common_prefix(vals) + '*', 'values': vals})
        return out

    @staticmethod
    def ancestors(n, parent):
        out = []
        while n['uid'] in parent:
            n = parent[n['uid']]; out.append(n)
        return out

    def prefab_classes(self, root):
        conts, parent = [], {}
        def walk_(n):
            for c in n['children']:
                if c['role'] == 'group':
                    parent[c['uid']] = n; conts.append(c); walk_(c)
        walk_(root)

        by_parent = defaultdict(list)
        for c in conts:
            if c['is_prefab']: by_parent[parent[c['uid']]['uid']].append(c)
        for pid, members in by_parent.items():
            sigs = Counter(self.sig(m) for m in members)
            main_sig = sigs.most_common(1)[0][0]
            base_members = [m for m in members if self.sig(m) == main_sig]
            odd = [m for m in members if self.sig(m) != main_sig]
            name = common_prefix([m['id'] for m in members]) if len(members) > 1 else members[0]['id']
            variants = []
            for m in odd:
                base_kids = Counter(self.sig(c) for c in base_members[0]['children'])
                kc = Counter(self.sig(c) for c in m['children'])
                extra_sigs = kc - base_kids
                extra = [c['name'] for c in m['children'] if extra_sigs.get(self.sig(c))]
                missing = sum((base_kids - kc).values())
                variants.append({'name': m['name'], 'path': m['path'], 'extra': extra, 'missing': missing})
                if extra and not missing:
                    self.issue('suggest', 'prefab_variant',
                               f'Prefab「{name}」: {m["name"]} だけ {"・".join(extra)} が多い。同じ Prefab の中で表示を切り替えるか、別の Prefab にするかを決める', m['path'])
                else:
                    self.issue('warn', 'prefab_mismatch', f'Prefab「{name}」: {m["name"]} の中の構成が他のインスタンスと違う', m['path'])
            self.prefabs.append({'name': name, 'explicit': True, 'members': [m['name'] for m in members],
                                 'paths': [m['path'] for m in members], 'parent': parent[members[0]['uid']]['name'],
                                 'variants': variants, 'diffs': self.diffs(base_members) if len(base_members) > 1 else []})
            for m in members: m['prefab'] = {'kind': 'explicit', 'index': len(self.prefabs) - 1, 'variant': m in odd}

        by_sig = defaultdict(list)
        for c in conts:
            if c['is_prefab'] or len(c['children']) < 2: continue
            by_sig[(parent[c['uid']]['uid'], self.sig(c))].append(c)
        for (pid, _), members in by_sig.items():
            if len(members) < 2: continue
            inside = [a for a in self.ancestors(members[0], parent) if a.get('is_prefab') or a.get('prefab')]
            name = common_prefix([m['id'] for m in members])
            pf = {'name': name, 'explicit': False, 'members': [m['name'] for m in members], 'paths': [m['path'] for m in members],
                  'parent': parent[members[0]['uid']]['name'], 'variants': [], 'diffs': self.diffs(members),
                  'inside_prefab': inside[0]['id'] if inside else None}
            self.prefabs.append(pf)
            for m in members: m['prefab'] = {'kind': 'candidate', 'index': len(self.prefabs) - 1}
            if not inside:
                d = '、'.join(x['label'] for x in pf['diffs']) or 'なし'
                self.issue('suggest', 'prefab_candidate',
                           f'{"・".join(m["name"] for m in members)} は同じ構造（違いは {d}）。Prefab「{name}」にするなら _Prefab を付ける', members[0]['path'])

    # ------------------------------------------------------------------ 5. Unity の値
    def to_unity(self, n, parent):
        if parent is not None:
            pc, c = center(parent['rect']), center(n['rect'])
            u = {'anchorMin': [0.5, 0.5], 'anchorMax': [0.5, 0.5], 'pivot': [0.5, 0.5],
                 'anchoredPosition': [round(c[0] - pc[0], 2), round(pc[1] - c[1], 2)],
                 'sizeDelta': [n['rect'][2], n['rect'][3]]}
            # space_ で画面端（親の端）からの距離が決まっているものは、その端に固定する
            a = n.get('anchor', {})
            if 'h' in a:
                k = 0 if a['h']['side'] == 'left' else 1
                u['anchorMin'][0] = u['anchorMax'][0] = u['pivot'][0] = k
                u['anchoredPosition'][0] = a['h']['offset'] if k == 0 else -a['h']['offset']
            if 'v' in a:
                k = 1 if a['v']['side'] == 'top' else 0      # Unity は上が 1
                u['anchorMin'][1] = u['anchorMax'][1] = u['pivot'][1] = k
                u['anchoredPosition'][1] = -a['v']['offset'] if k == 1 else a['v']['offset']
            n['unity'] = u
        else:
            n['unity'] = {'anchorMin': [0.5, 0.5], 'anchorMax': [0.5, 0.5], 'pivot': [0.5, 0.5],
                          'anchoredPosition': [0, 0], 'sizeDelta': [self.W, self.H]}
        r = n['role']
        comps = []
        if r == 'root': comps = ['Canvas', 'CanvasScaler']
        elif r == 'group':
            comps = ['RectTransform']
            if n.get('base_image'): comps.append('Image')
            if n.get('layout') is not None:
                comps.append('HorizontalLayoutGroup' if self.layouts[n['layout']]['axis'] == 'horizontal' else 'VerticalLayoutGroup')
            if re.match(r'^(Btn|Button)_', n['id']): comps.append('Button?')
        elif r == 'image': comps = ['Image']
        elif r == 'text': comps = ['TextMeshProUGUI']
        n['unity'].update({'name': n['id'], 'components': comps})
        if n.get('prefab'): n['unity']['prefab'] = n['prefab']['kind']
        for c in n['children']: self.to_unity(c, n)


# ------------------------------------------------------------------ 6. 検査と提案
def walk(n, parents=()):
    yield n, parents
    for c in n['children']:
        yield from walk(c, parents + (n,))

def raw_find(n, path):
    if n.get('path') == path: return n
    for c in n.get('children', []):
        r = raw_find(c, path)
        if r: return r
    return None

def run_checks(root, b):
    nodes = list(walk(root))
    real = [(n, p) for n, p in nodes if n['role'] != 'root']

    # --- 印の抜け: 外したグループ
    for f in b.flattened:
        if f['how'] != 'dissolved': continue
        g = raw_find(b.raw_root, f['path'])
        if not g: continue
        kids = [c for c in g['children'] if c['visible'] and c['kind'] != 'area']
        texts = [c for c in kids if c['kind'] == 'text']
        why = []
        if re.match(r'^(Btn|Button)_', g['id']): why.append('名前がボタン')
        if any(NUMERIC_TEXT.match(t['text']['content'] or '') for t in texts): why.append('実行時に変わる数字を含む')
        if texts and any(c['kind'] != 'text' for c in kids): why.append('画像と文字の組み合わせ')
        if '/' not in g['path']: why.append('画面の大きな区画')
        if why:
            b.issue('suggest', 'need_grp', f'{g["name"]}: 印が無いのでグループを外した（{"・".join(why)}）。1 つの部品として残すなら _Grp を付ける', g['path'])

    # --- 印の抜け: 自動で 1 枚にまとめたグループ
    def raw_run(g):
        imgs = [d['bbox'] for d in Builder.descendants(g) if d['visible'] and d['kind'] == 'image' and not DEFAULT_NAME.match(d['name'])]
        for k in (0, 1):
            rows = defaultdict(list)
            for r in imgs:
                rows[(round(r[1 - k] / TOL), round(r[2] / TOL), round(r[3] / TOL))].append(r)
            for rs in rows.values():
                if len(rs) < 3: continue
                st = sorted(r[k] for r in rs)
                ps = [b2 - a for a, b2 in zip(st, st[1:])]
                if max(ps) - min(ps) <= TOL and min(ps) >= rs[0][2 + k] - TOL: return len(rs)
        return 0
    for f in b.flattened:
        if f['how'] != 'merged': continue
        g = raw_find(b.raw_root, f['path'])
        if not g: continue
        why = []
        if re.match(r'^(Btn|Button)_', g['id']): why.append('名前がボタン')
        k = raw_run(g)
        if k: why.append(f'同じ大きさの画像が {k} 個等間隔に並ぶ')
        if '/' not in g['path']: why.append('画面の大きな区画')
        if why:
            b.issue('suggest', 'need_grp_merged', f'{g["name"]}: 画像だけなので 1 枚にまとめた（{"・".join(why)}）。部品に分けるなら _Grp や _List を付ける', g['path'])

    for n, p in real:
        if n['role'] != 'group': continue
        # --- _Base の提案
        if not n.get('base_image') and n['children']:
            bottom = n['children'][0]
            others = n['children'][1:]
            if bottom['role'] == 'image' and others and not n.get('layout') is not None:
                if area(bottom['rect']) >= 0.85 * area(n['rect']) and all(overlap(bottom['rect'], o['rect']) > 0.5 * area(o['rect']) for o in others):
                    b.issue('suggest', 'need_base', f'{n["name"]}: 一番下の {bottom["name"]} がグループとほぼ同じ大きさ。親自身の画像にするなら _Base を付ける', bottom['path'])
        # --- _List の提案
        if n.get('layout') is None:
            items = [c for c in n['children'] if c['role'] in ('group', 'image')]
            for axis, grp, pitches in b.find_runs(items):
                if len(grp) >= 3 and max(pitches) - min(pitches) <= TOL:
                    names = [e[0]['name'] for e in grp]
                    rest = [c['name'] for c in items if c['uid'] not in {e[0]['uid'] for e in grp}]
                    msg = f'{n["name"]}: {"・".join(names)} が{"横" if axis == "horizontal" else "縦"}に等間隔で並んでいる（{" / ".join(map(str, pitches))}px）。'
                    msg += (f'この並びを新しいグループで包んで _List を付ける（{"・".join(rest)} は外に）' if rest else 'このグループに _List を付ける')
                    b.issue('suggest', 'need_list', msg, n['path'])

    # --- 自動でまとめた画像
    merged = [f for f in b.flattened if f['how'] == 'merged']
    if merged:
        cnt = Counter((f['name'], f['count']) for f in merged)
        b.issue('info', 'auto_merged', '印の無い画像だけのグループを 1 枚にまとめた: ' +
                '、'.join(f'{nm}（{c} 枚）' + (f' × {k}' if k > 1 else '') for (nm, c), k in cnt.items()), merged[0]['path'])
        for f in merged[1:]: b.issues[-1]['paths'].append(f['path'])

    # --- 名前の検査
    for n, p in real:
        if n['role'] == 'text' or n.get('merged') == 'auto': continue
        if DEFAULT_NAME.match(n['name']):
            b.issue('info', 'default_name', f'既定名のまま: {n["name"]}（ID が要らない装飾なら問題なし）', n['path']); continue
        if not ID_CHARS.match(n['name']):
            b.issue('error', 'id_chars', f'ID に使えない文字・空白を含む: {n["name"]!r}', n['path'])
    for n, p in nodes:
        cnt = Counter(c['unity']['name'] for c in n['children'])
        for nm, k in cnt.items():
            if k > 1: b.issue('error', 'dup_sibling', f'{n["name"]} の中に同じ名前が {k} 個: {nm}', n['path'])

    vocab = Counter()
    for n, p in real:
        if n['role'] == 'text':
            for t in tokens(n['text']['content'] or ''): vocab[t] += 0.5
        else:
            for t in tokens(n['id']): vocab[t] += 1
    def raw_names(n):
        for c in n.get('children', []):
            if c['kind'] in ('area', 'space'):
                yield parse_marks(c['name'])[0]
            yield from raw_names(c)
    for nm in raw_names(b.raw_root):
        for t in tokens(nm): vocab[t] += 1
    for w in DICTIONARY: vocab[w] += 1000
    flagged = set()
    for n, p in real:
        if n['role'] == 'text' or DEFAULT_NAME.match(n['name']): continue
        for t in tokens(n['id']):
            if len(t) < 4 or t in flagged or t in DICTIONARY: continue
            for w, k in vocab.items():
                if w == t or len(w) < 4 or k < vocab[t] or w.lower() == t.lower(): continue
                if w.lower().startswith(t.lower()) or t.lower().startswith(w.lower()) or w[:-1].lower() == t[:-1].lower(): continue
                if lev(t, w) == 1:
                    flagged.add(t)
                    b.issue('warn', 'typo', f'綴りの揺れの可能性: {t} → {w}?', n['path'], key=('typo', t)); break
    for n, p in real:
        if n['role'] != 'text': continue
        c = n['text']['content'] or ''
        if c in flagged or len(c) < 4 or c in DICTIONARY: continue
        for w, k in vocab.items():
            if w in flagged or w.replace(' ', '') == c.replace(' ', ''): continue
            if w != c and len(w) >= 4 and lev(c, w) == 1 and w[:-1] != c[:-1]:
                b.issue('info', 'typo_text', f'仮テキストの綴り: 「{c}」 → {w}?', n['path']); break

    group_tokens = Counter(t for n, p in real if n['role'] == 'group' for t in tokens(n['id']))
    for n, p in real:
        if n['role'] in ('group', 'text') or DEFAULT_NAME.match(n['name']): continue
        anc = set(t for x in p for t in tokens(x['id']))
        hit = None
        for t in tokens(n['id']):
            if t.lower() in GENERIC_TOKENS: continue
            for g in group_tokens:
                if len(g) < 4 or g.lower() in GENERIC_TOKENS: continue
                if (t == g or (t.startswith(g) and len(t) > len(g) and t[len(g)].isupper())) and g not in anc:
                    hit = g; break
            if hit: break
        if hit:
            b.issue('warn', 'borrowed_name', f'{n["name"]} の「{hit}」が、置かれている場所と合っていない（別の場所の名前の流用？）', n['path'], key=('borrowed', n['name'], hit))

    by_name = defaultdict(list)
    for n, p in real: by_name[n['id']].append((n, p))
    for nm, occ in by_name.items():
        for a, pa in occ:
            for c, pc in occ:
                if a is not c and pa and pc and pa[-1] in pc[:-1]:
                    b.issue('warn', 'dup_nested', f'同じ名前が入れ子の中で別の部品にも使われている: {nm}', a['path'], key=('dup_nested', nm))

    fx = [n['path'] for n, p in real if n.get('has_fx')] + [n['base_image']['path'] for n, p in real if n.get('base_image', {}).get('has_fx')]
    if fx: b.issue('info', 'layer_fx', f'レイヤースタイル付きが {len(fx)} 個。画像に書き出すときに焼き込む', None)
    for n, p in real:
        if n['role'] == 'text' and NUMERIC_TEXT.match(n['text']['content'] or ''):
            n['hint_dynamic'] = True


def main(src, dst):
    psd = PSDImage.open(src)
    b = Builder(psd)
    root = b.build()
    run_checks(root, b)
    b.issues.sort(key=lambda i: LEVEL_ORDER[i['level']])
    for i in b.issues: i.pop('_key', None)
    out = {'source': os.path.basename(src), 'canvas': [psd.width, psd.height],
           'rules': {'marks': {'_Grp': 'ゲームオブジェクト', '_List': 'レイアウトグループ', '_Prefab': 'Prefab',
                               '_Img': '1 枚の画像', '_Base': '親自身の画像'}, 'area_prefix': 'area_', 'space_prefix': 'space_', 'tolerance_px': TOL},
           'tree': root, 'layouts': b.layouts, 'prefabs': b.prefabs, 'spaces': b.spaces, 'flattened': b.flattened, 'issues': b.issues}
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    c = Counter(i['level'] for i in b.issues)
    print(f'nodes={sum(1 for _ in walk(root))} lists={len(b.layouts)} prefabs={len(b.prefabs)} spaces={len(b.spaces)} '
          f'error={c["error"]} warn={c["warn"]} suggest={c["suggest"]} info={c["info"]} -> {dst}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
