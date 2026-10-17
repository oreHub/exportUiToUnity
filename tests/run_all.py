"""テスト一式（Photoshop が無くても動く）

1. サンプル PSD を psd-tools で読み、プラグインと同じ形のレイヤー情報（fixtures/*.layers.json）にする
2. Python 版（tools/psd_to_layout.py）と JS 版（plugin/UIExport/core/analyze.js）の解析結果が一致するか
3. レイヤー情報をランダムに崩した版でも一致するか（fuzz）
4. 仮の Photoshop（mock_panel.js）でパネルを動かし、件数・修正ボタンの動作を確かめる

使い方（リポジトリの直下で）:
  tools\\.venv\\Scripts\\python.exe tests\\run_all.py [--fuzz 100]
準備: tools の venv（tools/setup.bat）と、tests で `npm install`（jsdom）
"""
import argparse, os, subprocess, sys

H = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(H)
SAMPLES = ['Home', 'home_unmarked', 'space_test']
EXPECT_HOME = '●エラー 0 | ●注意 1 | ●提案 5 | ●情報 6'


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', **kw)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fuzz', type=int, default=100)
    a = ap.parse_args()
    fx = os.path.join(H, 'fixtures')
    os.makedirs(fx, exist_ok=True)
    ok = True

    print('== 1-2. サンプルの読み取りと Python / JS の照合')
    for s in SAMPLES:
        psd = os.path.join(ROOT, 'samples', s + '.psd')
        lj, pj = os.path.join(fx, s + '.layers.json'), os.path.join(fx, s + '.py.json')
        c1, o1 = run([sys.executable, os.path.join(H, 'dump_layers.py'), psd, lj])
        c2, o2 = run([sys.executable, os.path.join(ROOT, 'tools', 'psd_to_layout.py'), psd, pj])
        c3, o3 = run(['node', os.path.join(H, 'parity.js'), lj, pj])
        good = c1 == 0 and c2 == 0 and c3 == 0
        ok &= good
        print(f'  {s}: {"一致" if good else "NG"}  {o3.strip().splitlines()[0] if o3.strip() else ""}')
        if not good: print(o1, o2, o3)

    print(f'== 3. 崩した版での照合（各 {a.fuzz} 通り）')
    for s in ['Home', 'home_unmarked']:
        c, o = run([sys.executable, os.path.join(H, 'fuzz.py'), os.path.join(fx, s + '.layers.json'), str(a.fuzz)])
        last = o.strip().splitlines()[-1] if o.strip() else ''
        good = c == 0 and ' 0 diffs' in last
        ok &= good
        print(f'  {s}: {last}')
        if not good: print(o[-2000:])

    print('== 4. 仮の Photoshop でパネルを動かす')
    c, o = run(['node', os.path.join(H, 'mock_panel.js'), os.path.join(fx, 'Home.layers.json')])
    good = c == 0 and EXPECT_HOME in o and 'renamed:' in o
    ok &= good
    for line in o.splitlines():
        if line.startswith(('counts', 'fix buttons', 'renamed', 'after fix')): print('  ' + line[:160])
    if not good: print(o[-3000:])

    print('\n結果:', 'すべて OK' if ok else '失敗あり')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
