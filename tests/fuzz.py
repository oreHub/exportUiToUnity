"""layers.json を少しずつ崩した版を作り、Python 版と JS 版の結果を照合する
使い方: python fuzz.py <layers.json> <回数>
"""
import json, random, subprocess, sys, os, copy
H = os.path.dirname(os.path.abspath(__file__))
MARKS = ['_Grp', '_List', '_Prefab', '_Img', '_Base', '_Pf', '']


def nodes(ls, out):
    for l in ls:
        out.append(l)
        if l['group']: nodes(l['children'], out)
    return out


def mutate(d, rnd):
    all_ = nodes(d['layers'], [])
    for _ in range(rnd.randint(1, 6)):
        n = rnd.choice(all_)
        op = rnd.randint(0, 8)
        if op == 0: n['visible'] = not n['visible']
        elif op == 1:
            base = n['name']
            for m in MARKS[:-1]:
                if base.endswith(m): base = base[:-len(m)]
            n['name'] = base + rnd.choice(MARKS)
        elif op == 2:
            n['bbox'][0] += rnd.choice([-5, -2, 1, 3, 7]); n['bbox'][2] += rnd.choice([0, 2, -2, 6])
        elif op == 3 and n.get('group') and n['children']:
            rnd.shuffle(n['children'])
        elif op == 4: n['name'] = rnd.choice(['Layer 3', 'Btn_Foo', 'Buttton_x', 'area_Text', 'space_x', 'Icon Img', n['name'] + '_Grp'])
        elif op == 5 and n.get('group') and n['children']:
            c = copy.deepcopy(rnd.choice(n['children'])); n['children'].append(c)
        elif op == 6: n['has_fx'] = not n['has_fx']
        elif op in (7, 8):
            par = rnd.choice([x for x in all_ if x['group'] and x['children']] or [None])
            if par is None: continue
            sib = rnd.choice(par['children'])
            base = par['name']
            for m in MARKS[:-1]:
                if base.endswith(m): base = base[:-len(m)]
            nm = rnd.choice(['area_' + base, 'area_' + sib['name'], 'area_x', 'area_' + base.upper()])
            b = list(sib['bbox']); b = [b[0] - rnd.choice([0, 2, 10]), b[1] - rnd.choice([0, 3]), b[2] + rnd.choice([0, 4, 20]), b[3] + rnd.choice([0, 6])]
            a = {'name': nm, 'group': False, 'text': False, 'psd_kind': 'shape', 'visible': rnd.random() < 0.5, 'opacity': 1,
                 'has_fx': False, 'bbox': b, 'children': []}
            par['children'].insert(rnd.randint(0, len(par['children'])), a)


def main(src, count):
    base = json.load(open(src, encoding='utf-8'))
    fails = 0
    for i in range(count):
        rnd = random.Random(i)
        d = copy.deepcopy(base); mutate(d, rnd)
        import tempfile; td = tempfile.gettempdir(); lj, pj = os.path.join(td, f'fz_{os.getpid()}_l.json'), os.path.join(td, f'fz_{os.getpid()}_p.json')
        json.dump(d, open(lj, 'w', encoding='utf-8'), ensure_ascii=False)
        r = subprocess.run([sys.executable, os.path.join(H, 'py_from_layers.py'), lj, pj], capture_output=True, text=True)
        if r.returncode:
            print(i, 'PY ERROR', r.stderr.strip().splitlines()[-1]); continue
        r = subprocess.run(['node', os.path.join(H, 'parity.js'), lj, pj], capture_output=True, text=True)
        if r.returncode:
            fails += 1
            print(i, 'DIFF'); print('\n'.join(r.stdout.splitlines()[1:8]))
            os.makedirs(f'{H}/out', exist_ok=True); os.replace(lj, f'{H}/out/fail_{i}.json')
    print(f'{count} cases, {fails} diffs')


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]))
