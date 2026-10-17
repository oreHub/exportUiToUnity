"""PSD -> プラグインと同じ形のレイヤー情報（JS 版解析の照合用）

使い方: python dump_layers.py <input.psd> <layers.json>
"""
import json, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
from psd_tools import PSDImage
from psd_to_layout import layer_rect, text_info


def node(l, W, H):
    n = {'name': l.name, 'group': l.is_group(), 'text': l.kind == 'type', 'psd_kind': l.kind,
         'visible': bool(l.visible), 'opacity': round(l.opacity / 255, 3),
         'has_fx': bool(l.has_effects()) if hasattr(l, 'has_effects') else False,
         'bbox': layer_rect(l, W, H), 'children': []}
    if l.is_group():
        n['children'] = [node(c, W, H) for c in l]
    elif l.kind == 'type' and not l.name.startswith(('area_', 'space_')):
        n['text_info'] = text_info(l)
    return n


def main(src, dst):
    psd = PSDImage.open(src)
    json.dump({'source': os.path.basename(src), 'canvas': [psd.width, psd.height],
               'layers': [node(l, psd.width, psd.height) for l in psd]}, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
