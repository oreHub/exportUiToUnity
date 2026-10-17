"""Python 版の書き出し（tools/export_ui.py）の結果を、JS 版との照合用に出す

使い方: python export_ref.py <input.psd> <other.py.json> <作業フォルダ> <out.json>
  - PSD を作業フォルダに複製して書き出す（サンプルの PSD は書き換えない）
  - 画像を切り出した範囲（枠に合わせる前）を、作った順に記録する
  - XMP の書き込み、差分、ハッシュの計算も同じ入力で出す
"""
import base64, hashlib, io, json, os, shutil, sys

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
import export_ui as E                      # noqa: E402
from PIL import Image, PngImagePlugin      # noqa: E402


def main(src, other, work, out):
    if os.path.exists(work): shutil.rmtree(work)
    os.makedirs(work)
    psd_path = os.path.join(work, os.path.basename(src))
    shutil.copy(src, psd_path)
    xmp_in = E.PSDImage.open(psd_path).image_resources.get_data(E.Resource.XMP_METADATA).decode('utf-8')

    renders = []
    orig = E.render
    def rec(layer):
        im, rect = orig(layer)
        renders.append(rect)
        return im, rect
    E.render = rec
    sys.argv = ['export_ui.py', psd_path, os.path.join(work, 'UIExport'), '--screen', 'Home', '--date', '261017']
    E.main()
    E.render = orig
    d = os.path.join(work, 'UIExport', 'Home')
    layout = json.load(open(os.path.join(d, 'layout.json'), encoding='utf-8'))
    history = json.load(open(os.path.join(d, 'history.json'), encoding='utf-8'))

    # 同じ絵を別のメタデータで保存した PNG（画素の部分だけで比べれば同じになる）
    def png(color, text=None):
        im = Image.new('RGBA', (5, 3), color); buf = io.BytesIO()
        info = PngImagePlugin.PngInfo()
        if text: info.add_text('Comment', text)
        im.save(buf, 'PNG', pnginfo=info); return base64.b64encode(buf.getvalue()).decode()

    tree_b = json.load(open(other, encoding='utf-8'))['tree']
    pattern = bytes(range(256)) * 5
    json.dump({
        'renders': renders, 'layout': layout, 'history': history,
        'xmp_in': xmp_in, 'xmp_out': E.stamp_xmp(xmp_in, 'Home', '261017-2'),
        'xmp_twice': E.stamp_xmp(E.stamp_xmp(xmp_in, 'Home', '261017-1'), 'Shop', '261017-3'),
        'xmp_empty': E.stamp_xmp('', 'Home', '261017-1'),
        'diff': E.diff(layout['tree'], tree_b),
        'sha1': {'abc': hashlib.sha1(b'abc').hexdigest(), 'pattern': hashlib.sha1(pattern).hexdigest(), 'empty': hashlib.sha1(b'').hexdigest()},
        'png': {'a': png((255, 0, 0, 255)), 'a_meta': png((255, 0, 0, 255), 'other metadata'), 'b': png((0, 0, 255, 128))},
    }, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'renders {len(renders)}  images {layout["images"]["count"]}  issues {history[-1]["issues"]}')


if __name__ == '__main__':
    main(*sys.argv[1:5])
