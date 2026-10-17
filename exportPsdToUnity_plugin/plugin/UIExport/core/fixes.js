/* 問題の一覧から、レイヤー名を変えるだけで直せるものの「修正案」を作る（Photoshop に依存しない）
 *
 * 返す値: Map(問題の番号 -> [{ label, renames: [{ id, path, from, to }] }])
 *   1 つの問題に修正案が複数あることもある（例: _Grp を付ける / _List を付ける）
 * 位置や並び、グループの作り直しが要るものは対象にしない（レイヤーを選んで手で直す）
 */
'use strict';

// 印（名前の末尾）を外す。analyze.js と同じ規則（UXP の require は入れ子の相対パスの扱いが環境で違うので、ここに持つ）
const MARKS = ['_Grp', '_List', '_Prefab', '_Pf', '_Img', '_Base'];
function parseMarks(name) {
  let base = name, changed = true;
  while (changed) {
    changed = false;
    for (const suf of MARKS) if (base.endsWith(suf) && base.length > suf.length) { base = base.slice(0, -suf.length); changed = true; }
  }
  return [base];
}

function splitName(name) {               // 'Item_Coin_Grp_Prefab' -> ['Item_Coin', '_Grp_Prefab']
  const [base] = parseMarks(name);
  return [base, name.slice(base.length)];
}

function buildIndex(result) {
  const byPath = new Map(), byId = new Map();
  (function walk(n) {
    for (const c of n.children || []) {
      if (!byPath.has(c.path)) byPath.set(c.path, c);
      if (c.layer_id !== undefined) byId.set(c.layer_id, c);
      walk(c);
    }
  })(result.raw);
  return { byPath, byId };
}

function treeFind(n, path) {
  if ((n.path || '') === path) return n;
  for (const c of n.children || []) { const r = treeFind(c, path); if (r) return r; }
  return null;
}

function computeFixes(result) {
  const { byPath } = buildIndex(result);
  const out = new Map();
  const ren = (path, to) => {
    const n = byPath.get(path);
    if (!n || n.layer_id === undefined || !to || to === n.name) return null;
    return { id: n.layer_id, path, from: n.name, to };
  };
  const option = (label, renames) => {
    renames = renames.filter(Boolean);
    return renames.length ? { label, renames } : null;
  };

  result.issues.forEach((iss, idx) => {
    const p0 = iss.paths[0];
    const opts = [];
    const nameOf = p => (byPath.get(p) || {}).name || '';
    switch (iss.code) {
      case 'prefab_candidate': {
        const pf = result.prefabs.find(x => !x.explicit && x.paths[0] === p0);
        if (pf) opts.push(option(`_Prefab を付ける（${pf.paths.length} 個）`, pf.paths.map(p => ren(p, nameOf(p) + '_Prefab'))));
        break;
      }
      case 'need_grp':
        opts.push(option('_Grp を付ける', [ren(p0, nameOf(p0) + '_Grp')]));
        break;
      case 'need_grp_merged':
        opts.push(option('_Grp を付ける', [ren(p0, nameOf(p0) + '_Grp')]));
        opts.push(option('_List を付ける', [ren(p0, nameOf(p0) + '_List')]));
        break;
      case 'need_base':
        opts.push(option('_Base を付ける', [ren(p0, nameOf(p0) + '_Base')]));
        break;
      case 'need_list': {
        if (!iss.message.includes('このグループに _List を付ける')) break;   // 新しいグループで包む必要があるものは手で
        const [base, suf] = splitName(nameOf(p0));
        const to = suf.includes('_Grp') ? base + suf.replace('_Grp', '_List') : base + suf + '_List';
        opts.push(option('_List にする', [ren(p0, to)]));
        break;
      }
      case 'typo': {
        const m = iss.message.match(/綴りの揺れの可能性: (\S+) → (\S+)\?$/);
        if (!m) break;
        const [, t, w] = m;
        // 同じ綴りを含むレイヤー（文字レイヤー以外）をすべて直す
        const hits = [...byPath.values()].filter(n => n.kind !== 'text' && n.name.split(/[_\s\-?]+/).includes(t)).map(n => n.path);
        opts.push(option(`${t} を ${w} に直す（${hits.length} 個）`, hits.map(p => ren(p, nameOf(p).split(/([_\s\-?]+)/).map(x => (x === t ? w : x)).join('')))));
        break;
      }
      case 'id_chars': {
        const to = nameOf(p0).replace(/[^A-Za-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, '');
        if (/[A-Za-z0-9]/.test(to)) opts.push(option('使えない文字を _ にする', [ren(p0, to)]));
        break;
      }
      case 'dup_sibling': {
        const m = iss.message.match(/の中に同じ名前が \d+ 個: (.+)$/);
        const owner = m && treeFind(result.tree, p0 || '');
        if (!owner) break;
        const dups = owner.children.filter(c => c.unity && c.unity.name === m[1] && c.layer_id !== undefined)
          .sort((a, b) => (a.rect[0] - b.rect[0]) || (a.rect[1] - b.rect[1]));
        // 印の無いグループを外した結果として重なったものは、親に _Grp を付ける方が正しいので連番は出さない
        if (dups.some(c => c.from_dissolved)) break;
        const renames = dups.map((c, k) => {
          const [base, suf] = splitName(c.name);
          return c.name === `${base}_${k + 1}${suf}` ? null : { id: c.layer_id, path: c.path, from: c.name, to: `${base}_${k + 1}${suf}` };
        });
        opts.push(option(`左から _1〜_${dups.length} の連番を付ける`, renames));
        break;
      }
      case 'area_order': {
        const m = iss.message.match(/名前を (area_\S+) にする/);
        if (m) opts.push(option(`グループの領域にする（名前を ${m[1]} に）`, [ren(p0, m[1])]));
        break;
      }
      default:
        break;
    }
    const ok = opts.filter(Boolean);
    if (ok.length) out.set(idx, ok);
  });
  return out;
}

// レイヤーを選ぶときの補助: グループなら中のレイヤー（親を開かせるため）と、親のグループの ID
function revealInfo(result, id) {
  const { byId } = buildIndex(result);
  const n = byId.get(id);
  if (!n) return { leaf: null };
  let leaf = null;
  if (n.kind === 'group') {
    (function find(x) { for (const c of x.children || []) { if (leaf !== null) return; if (c.kind !== 'group' && c.layer_id !== undefined) leaf = c.layer_id; else find(c); } })(n);
  }
  return { leaf };
}

module.exports = { computeFixes, revealInfo };
