"""layers.json（プラグインと同じ形）を Python 版の解析にかける（照合用）
使い方: python py_from_layers.py <layers.json> <out.json>
"""
import json, sys, os
from collections import Counter
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
import psd_to_layout as P


class FakeLayer:
    def __init__(self, d):
        self.d = d; self.name = d['name']; self.kind = 'type' if d['text'] else ('group' if d['group'] else d.get('psd_kind', 'pixel'))
        self.visible = d['visible']; self.opacity = d['opacity'] * 255
        l, t, w, h = d['bbox']; self.bbox = (l, t, l + w, t + h)
    def is_group(self): return self.d['group']
    def has_effects(self): return self.d['has_fx']
    def __iter__(self): return iter([FakeLayer(c) for c in self.d['children']])


class FakePSD:
    def __init__(self, d): self.d = d; self.width, self.height = d['canvas']
    def __iter__(self): return iter([FakeLayer(c) for c in self.d['layers']])


P.text_info = lambda layer: dict(layer.d.get('text_info') or {'content': None, 'font': None, 'size': None, 'color': None, 'align': None})
_raw = P.Builder.raw
def raw(self, layer, parent_path):
    n = _raw(self, layer, parent_path)
    n['opacity'] = layer.d['opacity']
    return n
P.Builder.raw = raw


def main(src, dst):
    d = json.load(open(src, encoding='utf-8'))
    b = P.Builder(FakePSD(d))
    root = b.build()
    P.run_checks(root, b)
    b.issues.sort(key=lambda i: P.LEVEL_ORDER[i['level']])
    for i in b.issues: i.pop('_key', None)
    out = {'source': d.get('source', ''), 'canvas': d['canvas'],
           'rules': {'marks': {'_Grp': 'ゲームオブジェクト', '_List': 'レイアウトグループ', '_Prefab': 'Prefab',
                               '_Img': '1 枚の画像', '_Base': '親自身の画像'}, 'area_prefix': 'area_', 'space_prefix': 'space_', 'tolerance_px': P.TOL},
           'tree': root, 'layouts': b.layouts, 'prefabs': b.prefabs, 'spaces': b.spaces, 'flattened': b.flattened, 'issues': b.issues}
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
