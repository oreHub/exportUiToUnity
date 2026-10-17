/* PSD のレイヤー情報 -> Unity UI 構造（解析・検査・提案）
 *
 * Python 版 psd_to_layout.py と同じ判定をする。Photoshop に依存しない（入力はレイヤー情報の木）。
 * Photoshop のプラグインからも、Node での照合テストからも同じものを使う。
 *
 * 入力 layers: 下のレイヤーから順の配列。各要素
 *   { name, group: bool, text: bool, psd_kind, visible, opacity (0-1), has_fx,
 *     bbox: [left, top, width, height], text_info: {content, font, size, color, align}, children, layer_id? }
 */
'use strict';

const TOL = 3;
const MARKS = [['_Grp', 'grp'], ['_List', 'list'], ['_Prefab', 'prefab'], ['_Pf', 'prefab'],
  ['_Img', 'img'], ['_Base', 'base']];
const DIG = '[0-9\\uFF10-\\uFF19]';
const DEFAULT_NAME = new RegExp(
  '^(長方形|楕円|多角形|シェイプ|レイヤー|べた塗り|グラデーション|パス|線|グループ|' +
  'Rectangle|Ellipse|Polygon|Shape|Layer|Group|Color Fill|Path)\\s*' + DIG + '*' +
  '(\\s*のコピー(\\s*' + DIG + '+)?|\\s*copy(\\s*' + DIG + '+)?)?$', 'i');
const ID_CHARS = /^[A-Za-z0-9_\-]+$/;
const NUMERIC_TEXT = new RegExp('^(' + DIG + '|[,.\\s:/%+\\-])+$');
const DICTIONARY = ['Prefab', 'List', 'Footer', 'Header', 'Button', 'Btn', 'Icon', 'Menu', 'area', 'Banner',
  'Present', 'Event', 'Quest', 'Shop', 'Item', 'Image', 'Gauge', 'Carousel', 'Name', 'Mark',
  'Attention', 'Battle', 'Card', 'Deck', 'Guild', 'Chara', 'Gacha', 'Base', 'Fill'];
const DICT_SET = new Set(DICTIONARY);
const GENERIC_TOKENS = new Set(['grp', 'list', 'prefab', 'pf', 'img', 'base', 'area', 'btn', 'button', 'icon', 'image',
  'name', 'menu', 'item', 'banner', 'mark', 'gauge', 'header', 'footer', 'bg', 'ui', 'on', 'off', 'info', 'fill']);
const LEVEL_ORDER = { error: 0, warn: 1, suggest: 2, info: 3 };

// ------------------------------------------------------------------ helpers
function pyRound(x) {                    // Python の round()（偶数丸め）
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
function round2(x) { return Math.round(x * 100) / 100; }
function union(rects) {
  rects = rects.filter(r => r && r[2] > 0 && r[3] > 0);
  if (!rects.length) return null;
  const l = Math.min(...rects.map(r => r[0])), t = Math.min(...rects.map(r => r[1]));
  return [l, t, Math.max(...rects.map(r => r[0] + r[2])) - l, Math.max(...rects.map(r => r[1] + r[3])) - t];
}
function center(r) { return [r[0] + r[2] / 2, r[1] + r[3] / 2]; }
function contains(o, i, tol = 0) {
  return i[0] >= o[0] - tol && i[1] >= o[1] - tol && i[0] + i[2] <= o[0] + o[2] + tol && i[1] + i[3] <= o[1] + o[3] + tol;
}
function pointIn(r, p, tol = TOL) {
  return r[0] - tol <= p[0] && p[0] <= r[0] + r[2] + tol && r[1] - tol <= p[1] && p[1] <= r[1] + r[3] + tol;
}
function overlap(a, b) {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return Math.max(w, 0) * Math.max(h, 0);
}
function area(r) { return r[2] * r[3]; }
function tokens(name) { return name.split(/[_\s\-?]+/).filter(Boolean); }
function lev(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
    prev = cur;
  }
  return prev[prev.length - 1];
}
function parseMarks(name) {
  const marks = new Set(); let base = name, changed = true;
  while (changed) {
    changed = false;
    for (const [suf, key] of MARKS) {
      if (base.endsWith(suf) && base.length > suf.length) { base = base.slice(0, -suf.length); marks.add(key); changed = true; }
    }
  }
  return [base, marks];
}
function rstripChars(s, chars) { let e = s.length; while (e > 0 && chars.includes(s[e - 1])) e--; return s.slice(0, e); }
function commonPrefix(names) {
  if (!names.length) return '';
  let p = names[0];
  for (const n of names) { let i = 0; while (i < p.length && i < n.length && p[i] === n[i]) i++; p = p.slice(0, i); }
  return rstripChars(p, '_-') || names[0];
}
function maxBy(arr, f) { let best, bv; for (const x of arr) { const v = f(x); if (best === undefined || v > bv) { best = x; bv = v; } } return best; }
function minBy(arr, f) { let best, bv; for (const x of arr) { const v = f(x); if (best === undefined || v < bv) { best = x; bv = v; } } return best; }
function median(xs) { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function isUpper(ch) { return !!ch && ch !== ch.toLowerCase() && ch === ch.toUpperCase(); }
function pyRepr(s) { return s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`; }
function signed(d) { return (d >= 0 ? '+' : '') + d; }

class Counter {                          // Python の Counter（挿入順を保つ）
  constructor(items) { this.m = new Map(); if (items) for (const x of items) this.add(x, 1); }
  static key(x) { return typeof x === 'string' ? 's:' + x : JSON.stringify(x); }
  add(x, n = 1) { const k = Counter.key(x); const e = this.m.get(k); if (e) e[1] += n; else this.m.set(k, [x, n]); }
  get(x) { const e = this.m.get(Counter.key(x)); return e ? e[1] : 0; }
  get size() { return this.m.size; }
  entries() { return [...this.m.values()]; }
  keys() { return this.entries().map(e => e[0]); }
  mostCommon() { let best = null; for (const e of this.m.values()) if (!best || e[1] > best[1]) best = e; return best; }
  minus(o) { const c = new Counter(); for (const [x, n] of this.entries()) { const r = n - o.get(x); if (r > 0) c.add(x, r); } return c; }
  total() { let t = 0; for (const e of this.m.values()) t += e[1]; return t; }
}

function descendants(n) { const out = []; (function rec(x) { for (const c of x.children) { out.push(c); rec(c); } })(n); return out; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ------------------------------------------------------------------ Builder
class Builder {
  constructor(W, H, layers) {
    this.W = W; this.H = H; this.layers = layers;
    this.issues = []; this.layouts = []; this.prefabs = []; this.flattened = []; this.spaces = [];
    this.uid = 0;
  }

  issue(level, code, msg, path = null, key = null) {
    const k = JSON.stringify(key || [code, msg]);
    for (const i of this.issues) {
      if (i._key === k) { if (path && !i.paths.includes(path)) i.paths.push(path); return; }
    }
    this.issues.push({ level, code, message: msg, paths: path ? [path] : [], _key: k });
  }

  // 1. レイヤーを読む
  raw(layer, parentPath) {
    this.uid += 1;
    const name = layer.name;
    const path = parentPath ? `${parentPath}/${name}` : name;
    const [nid, marks] = parseMarks(name);
    const n = { uid: this.uid, name, id: nid, marks: [...marks].sort(), path, psd_kind: layer.psd_kind,
      visible: !!layer.visible, opacity: layer.opacity, has_fx: !!layer.has_fx, bbox: layer.bbox.slice(), children: [] };
    if (layer.layer_id !== undefined) n.layer_id = layer.layer_id;
    if (layer.group) {
      n.kind = 'group'; n.children = layer.children.map(c => this.raw(c, path));
      // グループの範囲 = 表示されている中身（area_ / space_ を除く）の範囲
      n.bbox = union(n.children.filter(c => c.visible && c.kind !== 'area' && c.kind !== 'space').map(c => c.bbox)) || n.bbox;
    }
    else if (name.startsWith('area_')) n.kind = 'area';
    else if (name.startsWith('space_')) n.kind = 'space';
    else if (layer.text) { n.kind = 'text'; n.text = Object.assign({ content: null, font: null, size: null, color: null, align: null }, layer.text_info || {}); }
    else n.kind = 'image';
    return n;
  }

  // 2. 構造を決める
  build() {
    let root = { uid: 0, name: 'Canvas', id: 'Canvas', marks: ['grp'], path: '', kind: 'group', psd_kind: 'document',
      visible: true, opacity: 1, has_fx: false, bbox: [0, 0, this.W, this.H], children: this.layers.map(l => this.raw(l, '')) };
    this.raw_root = clone(root);
    root = this.container(root, true);
    root.rect = [0, 0, this.W, this.H]; root.rect_source = 'canvas';
    this.prefabClasses(root);
    this.toUnity(root, null);
    return root;
  }

  hasStructure(g) {
    for (const d of descendants(g)) {
      if (d.kind === 'space') return true;
      if (!d.visible && d.kind !== 'area') continue;
      if (d.kind === 'text') return true;
      if (d.kind === 'group' && d.marks.some(m => ['grp', 'list', 'prefab', 'base'].includes(m))) return true;
      if (d.kind === 'image' && d.marks.includes('base')) return true;
    }
    return false;
  }

  static above(kids, a) { const i = kids.indexOf(a); return i + 1 < kids.length ? kids[i + 1] : null; }

  // 1 枚にまとめるグループの領域（中の area_）。文字のすぐ下の area_ は文字枠なので除く
  mergedFrame(g) {
    const kids = g.children;
    const areas = kids.filter(c => c.kind === 'area');
    const named = areas.filter(a => a.name.slice(5).toLowerCase() === g.id.toLowerCase());
    if (named.length) return named[0];
    const free = areas.filter(a => !((Builder.above(kids, a) || {}).kind === 'text'));
    if (free.length > 1)
      this.issue('warn', 'area_conflict', `${g.name}: 範囲を決める area_ が複数ある（${free.map(a => a.name).join('・')}）。area_${g.id} の名前で 1 つに決める`, g.path);
    return free.length ? free[0] : null;
  }

  asImage(g, how) {
    const vis = descendants(g).filter(d => d.visible && !['group', 'area', 'space'].includes(d.kind));
    const n = Object.assign({}, g, { role: 'image', merged: how, merged_count: vis.length,
      merged_text: vis.filter(d => d.kind === 'text').map(d => d.text.content),
      children: [], rect: g.bbox, rect_source: 'merged' });
    const fr = this.mergedFrame(g);
    if (fr) Object.assign(n, { frame: fr.bbox, frame_from: fr.name, rect: fr.bbox, rect_source: 'area' });
    return n;
  }

  leaf(c) {
    if (c.kind === 'text') c.role = 'text';
    else if (c.kind === 'area') c.role = 'area';
    else if (c.kind === 'space') { c.role = 'space'; c.rect = c.bbox; }
    else {
      c.role = 'image';
      if (c.frame) { c.rect = c.frame; c.rect_source = 'area'; }
      else { c.rect = c.bbox; c.rect_source = 'layer'; }
    }
    return c;
  }

  // area_ の対応付け（名前 -> 文字のすぐ下 -> グループ）。グループの領域 [矩形, 名前] を返す
  assignAreas(scopeKids, owner) {
    let groupArea = null; const fallback = [];
    for (const a of scopeKids.filter(c => c.kind === 'area')) {
      const ar = a.bbox, key = a.name.slice(5).toLowerCase();
      const up = Builder.above(scopeKids, a);
      const img = scopeKids.find(c => c.kind === 'image' && (c.name.toLowerCase() === key || c.id.toLowerCase() === key));
      const sib = scopeKids.find(c => c.kind === 'group' && c.id.toLowerCase() === key);
      let how;
      if (key === owner.id.toLowerCase()) how = 'group';
      else if (img) how = 'image';
      else if (sib) {
        this.issue('warn', 'area_outside', `${a.name}: ${sib.name} と同じ名前だが、そのグループの外にある。${sib.name} の領域にするなら中に入れる`, a.path);
        continue;
      } else if (up && up.kind === 'text') how = 'text';
      else { fallback.push(a); continue; }
      if (how === 'text') {
        up.text_box = ar; up.text_box_from = a.name;
        if (up.visible && !contains(ar, up.bbox, 1))
          this.issue('warn', 'text_overflow', `文字が枠からはみ出している: 「${up.text.content}」（${a.name}）`, up.path);
      } else if (how === 'image') {
        if (img.frame) { this.issue('warn', 'area_conflict', `${img.name}: 枠の area_ が複数ある（${img.frame_from}・${a.name}）`, a.path); continue; }
        img.frame = ar; img.frame_from = a.name;
      } else {
        if (groupArea) {
          this.issue('warn', 'area_conflict', `${owner.name}: 範囲を決める area_ が複数ある（${groupArea[1]}・${a.name}）。area_${owner.id} の名前で 1 つに決める`, a.path);
          continue;
        }
        groupArea = [ar, a.name];
      }
    }
    // 名前でも並びでも決まらない area_ はグループの領域。ただし枠の無い文字 1 つだけを囲むものは並べ忘れとみなし、使わない
    for (const a of fallback) {
      const ar = a.bbox;
      const inside = scopeKids.filter(c => c.visible && ['text', 'image', 'group'].includes(c.kind) && pointIn(ar, center(c.bbox)));
      if (inside.length === 1 && inside[0].kind === 'text' && !inside[0].text_box) {
        const t = inside[0];
        this.issue('warn', 'area_order', `${a.name}: 文字「${t.text.content}」だけを囲んでいるが、文字レイヤーのすぐ下に無い。` +
          `文字の枠なら文字のすぐ下に移す。${owner.name} の領域なら名前を area_${owner.id} にする（今はどちらにも使っていない）`, a.path);
        continue;
      }
      if (groupArea) {
        this.issue('warn', 'area_conflict', `${owner.name}: 範囲を決める area_ が複数ある（${groupArea[1]}・${a.name}）。area_${owner.id} の名前で 1 つに決める`, a.path);
        continue;
      }
      groupArea = [ar, a.name];
    }
    return groupArea;
  }

  container(g, isRoot = false, autoItem = false) {
    g.role = isRoot ? 'root' : 'group';
    g.auto_item = autoItem;
    const marks = new Set(g.marks);
    if (marks.has('prefab') && !marks.has('grp') && !marks.has('list')) marks.add('grp');
    g.is_list = marks.has('list');
    g.is_prefab = marks.has('prefab');
    const groupArea = this.assignAreas(g.children, g);
    let kids = [];
    for (const c of g.children) kids = kids.concat(this.place(c, g));
    if (groupArea) { g.group_area = groupArea[0]; g.group_area_from = groupArea[1]; }
    const bases = kids.filter(c => (c.marks || []).includes('base') && c.role === 'image');
    if (bases.length > 1) this.issue('error', 'base_multi', `${g.name}: _Base が ${bases.length} 個ある（親の画像は 1 つだけ）`, g.path);
    if (bases.length) {
      const b = bases[0];
      g.base_image = { name: b.name, id: b.id, rect: b.rect, merged: b.merged === undefined ? null : b.merged,
        frame: b.frame === undefined ? null : b.frame, frame_from: b.frame_from === undefined ? null : b.frame_from, opacity: b.opacity, has_fx: b.has_fx, path: b.path };
      if (b.layer_id !== undefined) g.base_image.layer_id = b.layer_id;
      kids = kids.filter(c => c !== b);
    }
    for (const c of kids) {
      if (c.role === 'text') {
        if (c.text_box) { c.rect = c.text_box; c.rect_source = 'area'; }
        else {
          c.rect = c.bbox; c.rect_source = 'glyphs';
          this.issue('info', 'no_text_box', `文字の枠（area_）が無いので、文字の外接矩形を使う: 「${c.text.content}」`, c.path);
        }
      }
    }
    const spaces = kids.filter(c => c.role === 'space');
    g.children = kids.filter(c => c.role !== 'area' && c.role !== 'space');
    if (isRoot) g.rect = [0, 0, this.W, this.H];
    else if (g.group_area) { g.rect = g.group_area; g.rect_source = 'area'; }
    else if (g.base_image) { g.rect = g.base_image.rect; g.rect_source = 'base'; }
    else {
      g.rect = union(g.children.map(c => c.rect).concat(spaces.map(s => s.rect))) || g.bbox;
      g.rect_source = 'union';
    }
    if (g.is_list) this.detectList(g);
    this.applySpaces(g, spaces);
    return g;
  }

  // space_: 間隔・内側の余白・画面端からの距離
  applySpaces(g, spaces) {
    if (!spaces.length) return;
    const near = (a, b) => Math.abs(a - b) <= TOL;
    const span = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0;
    const gr = g.rect; const GL = gr[0], GT = gr[1], GR = gr[0] + gr[2], GB = gr[1] + gr[3];
    const kids = g.children.filter(c => c.rect);
    const lay = (g.layout !== undefined && g.layout !== null) ? this.layouts[g.layout] : null;
    for (const sp of spaces) {
      const r = sp.rect; const L = r[0], T = r[1], R = r[0] + r[2], B = r[1] + r[3];
      let hit = null;
      outer: for (const a of kids) {
        const ar = a.rect;
        for (const b of kids) {
          if (a === b) continue;
          const br = b.rect;
          if (near(L, ar[0] + ar[2]) && near(R, br[0]) && span(T, B, ar[1], ar[1] + ar[3]) && span(T, B, br[1], br[1] + br[3]))
            hit = ['between', 'horizontal', a, b, r[2]];
          else if (near(T, ar[1] + ar[3]) && near(B, br[1]) && span(L, R, ar[0], ar[0] + ar[2]) && span(L, R, br[0], br[0] + br[2]))
            hit = ['between', 'vertical', a, b, r[3]];
          if (hit) break outer;
        }
      }
      if (!hit) {
        // 片側だけ部品に接している = 間隔の指定だが、実際の間隔と違う
        for (const a of kids) {
          const ar = a.rect;
          if (near(L, ar[0] + ar[2]) && span(T, B, ar[1], ar[1] + ar[3])) {
            const nxt = kids.filter(b => b !== a && b.rect[0] >= ar[0] + ar[2] - TOL && span(T, B, b.rect[1], b.rect[1] + b.rect[3]));
            if (nxt.length) { const b = minBy(nxt, b => b.rect[0]); hit = ['between', 'horizontal', a, b, r[2], b.rect[0] - ar[0] - ar[2]]; }
          } else if (near(T, ar[1] + ar[3]) && span(L, R, ar[0], ar[0] + ar[2])) {
            const nxt = kids.filter(b => b !== a && b.rect[1] >= ar[1] + ar[3] - TOL && span(L, R, b.rect[0], b.rect[0] + b.rect[2]));
            if (nxt.length) { const b = minBy(nxt, b => b.rect[1]); hit = ['between', 'vertical', a, b, r[3], b.rect[1] - ar[1] - ar[3]]; }
          }
          if (hit) break;
        }
      }
      if (!hit) {
        for (const c of kids) {
          const cr = c.rect; const CL = cr[0], CT = cr[1], CR = cr[0] + cr[2], CB = cr[1] + cr[3];
          if (near(L, GL) && near(R, CL) && span(T, B, CT, CB)) hit = ['edge', 'left', c, CL - GL, r[2]];
          else if (near(R, GR) && near(L, CR) && span(T, B, CT, CB)) hit = ['edge', 'right', c, GR - CR, r[2]];
          else if (near(T, GT) && near(B, CT) && span(L, R, CL, CR)) hit = ['edge', 'top', c, CT - GT, r[3]];
          else if (near(B, GB) && near(T, CB) && span(L, R, CL, CR)) hit = ['edge', 'bottom', c, GB - CB, r[3]];
          if (hit) break;
        }
      }
      const rec = { name: sp.name, path: sp.path, rect: r, owner: g.name };
      if (sp.layer_id !== undefined) rec.layer_id = sp.layer_id;
      if (!hit) {
        rec.meaning = 'unused';
        this.issue('warn', 'space_unused', `${sp.name}: どの部品にも、${g.name} の端にも接していない（許容差 ${TOL}px）`, sp.path);
      } else if (hit[0] === 'between') {
        const [, axis, a, b, val] = hit;
        Object.assign(rec, { meaning: lay ? 'spacing' : 'margin', value: val, axis, between: [a.name, b.name] });
        if (hit.length > 5)
          this.issue('warn', 'space_mismatch', `${sp.name}: space_ の幅 ${val}px と、${a.name} と ${b.name} の実際の間隔 ${hit[5]}px が違う`, sp.path);
        if (lay && lay.axis === axis) {
          if (val !== lay.spacing && hit.length === 5)
            this.issue('warn', 'space_mismatch', `${g.name}: ${sp.name} の間隔 ${val}px と、位置から計算した間隔 ${lay.spacing}px が違う（space_ を優先）`, sp.path);
          lay.spacing = val; lay.spacing_source = sp.name;
        } else if (lay) {
          this.issue('warn', 'space_axis', `${sp.name}: 並びの向きと違う向きの間隔になっている`, sp.path);
        }
      } else {
        const [, side, c, actual, val] = hit;
        if (lay) {
          const i = ['left', 'right', 'top', 'bottom'].indexOf(side);
          Object.assign(rec, { meaning: 'padding', side, value: val });
          lay.padding_lrtb[i] = val; (lay.padding_source = lay.padding_source || {})[side] = sp.name;
        } else {
          Object.assign(rec, { meaning: 'anchor', side, value: val, target: c.name });
          (c.anchor = c.anchor || {})[side === 'left' || side === 'right' ? 'h' : 'v'] = { side, offset: val, from: sp.name };
        }
        if (actual !== val)
          this.issue('warn', 'space_mismatch', `${sp.name}: space_ の幅 ${val}px と、実際の距離 ${actual}px が違う（space_ を優先）`, sp.path);
      }
      this.spaces.push(rec);
      (g.spaces = g.spaces || []).push(this.spaces.length - 1);
    }
  }

  place(c, parent) {
    if (!c.visible && c.kind !== 'area' && c.kind !== 'space') {
      this.issue('info', 'hidden', `非表示のため変換しない: ${c.name}`, c.path);
      return [];
    }
    if (c.kind !== 'group') {
      if (c.marks.some(m => m !== 'base')) this.issue('warn', 'mark_on_layer', `${c.name}: グループ用の印がレイヤーに付いている`, c.path);
      return [this.leaf(c)];
    }
    const marks = new Set(c.marks);
    const structural = marks.has('grp') || marks.has('list') || marks.has('prefab');
    if (marks.has('img')) {
      if (structural) this.issue('warn', 'mark_conflict', `${c.name}: _Img と _Grp/_List/_Prefab は同時に使えない（_Img を優先）`, c.path);
      const n = this.asImage(c, 'img');
      if (n.merged_text.length) this.issue('info', 'img_text', `${c.name}: 文字「${n.merged_text.join(' / ')}」も画像に焼き込む`, c.path);
      return [n];
    }
    if (structural) return [this.container(c)];
    if (parent.is_list || (parent.marks || []).includes('list')) return [this.container(c, false, true)];
    if (marks.has('base'))
      this.issue('warn', 'base_group', `${c.name}: グループを親の画像にするときは _Img と一緒に付ける（例: ${c.id}_Img_Base）`, c.path);
    if (!this.hasStructure(c)) {
      const n = this.asImage(c, 'auto');
      this.flattened.push({ name: c.name, path: c.path, how: 'merged', count: n.merged_count });
      return [n];
    }
    const ga = this.assignAreas(c.children, c);
    this.flattened.push({ name: c.name, path: c.path, how: 'dissolved',
      children: c.children.filter(x => x.visible && x.kind !== 'area' && x.kind !== 'space').map(x => x.name) });
    if (ga) this.issue('info', 'area_dropped', `印の無いグループ ${c.name} の範囲指定 ${ga[1]} は使われない`, c.path);
    const out = [];
    for (const x of c.children) {
      if (x.kind === 'area') continue;
      for (const y of this.place(x, parent)) {
        if (!('from_dissolved' in y)) y.from_dissolved = c.name;
        out.push(y);
      }
    }
    return out;
  }

  // 3. 並び（_List）
  keyRect(item) {
    if (item.role === 'group') {
      if (item.group_area) return [item.group_area, item.group_area_from];
      if (item.base_image) return [item.base_image.rect, item.base_image.name];
      const imgs = item.children.filter(c => c.role === 'image');
      if (imgs.length) { const big = maxBy(imgs, c => area(c.rect)); return [big.rect, big.name]; }
    }
    return [item.rect, item.name];
  }

  findRuns(items) {
    const keyed = items.map(c => [c, ...this.keyRect(c)]);
    const used = new Set(), runs = [];
    for (const axis of ['horizontal', 'vertical']) {
      const k = axis === 'horizontal' ? 0 : 1;
      const groups = [];
      for (const e of keyed) {
        const [c, kr] = e;
        if (used.has(c.uid)) continue;
        let placed = false;
        for (const grp of groups) {
          const r0 = grp[0][1];
          const same = Math.abs(r0[2] - kr[2]) <= TOL && Math.abs(r0[3] - kr[3]) <= TOL;
          const aligned = axis === 'horizontal' ? Math.abs(r0[1] - kr[1]) <= TOL : Math.abs(r0[0] - kr[0]) <= TOL;
          if (same && aligned) { grp.push(e); placed = true; break; }
        }
        if (!placed) groups.push([e]);
      }
      for (const grp of groups) {
        if (grp.length < 2) continue;
        grp.sort((a, b) => a[1][k] - b[1][k]);
        const starts = grp.map(e => e[1][k]);
        const pitches = starts.slice(1).map((s, i) => s - starts[i]);
        if (Math.min(...pitches) < grp[0][1][2 + k] - TOL) continue;
        for (const e of grp) used.add(e[0].uid);
        runs.push([axis, grp, pitches]);
      }
    }
    return runs;
  }

  detectList(g) {
    const items = g.children.filter(c => c.role === 'group' || c.role === 'image');
    for (const t of g.children.filter(c => c.role === 'text'))
      this.issue('warn', 'list_text', `${g.name}: 並びの中に文字「${t.text.content}」が直接入っている。項目のグループの中に入れる`, t.path);
    if (items.length < 2) { this.issue('warn', 'list_short', `${g.name}: _List なのに項目が ${items.length} 個しかない`, g.path); return; }
    const runs = this.findRuns(items);
    if (!runs.length) { this.issue('warn', 'list_not_aligned', `${g.name}: _List だが、同じ大きさの項目が一列に並んでいない`, g.path); return; }
    const [axis, grp, pitches] = maxBy(runs, r => r[1].length);
    const k = axis === 'horizontal' ? 0 : 1;
    const ids = new Set(grp.map(e => e[0].uid));
    const outside = items.filter(c => !ids.has(c.uid));
    if (outside.length)
      this.issue('warn', 'list_outsider', `${g.name}: ${outside.map(c => c.name).join('・')} が並びに入っていない（大きさか位置が他の項目と違う）。並びの外に出すか、大きさをそろえる`, g.path);
    const cnt = new Counter(pitches);
    let [mode, modeN] = cnt.mostCommon();
    const uniform = cnt.size === 1;
    const noMode = !uniform && modeN === 1;
    if (noMode) mode = pyRound(median(pitches));
    const dev = [];
    if (!uniform && !noMode) {
      pitches.forEach((p, i) => {
        if (p !== mode) {
          dev.push({ between: [grp[i][0].name, grp[i + 1][0].name], pitch: p, expected: mode, diff: p - mode });
          this.issue('warn', 'spacing', `${g.name}: ${grp[i][0].name} と ${grp[i + 1][0].name} の間隔が ${p}px（他は ${mode}px、差 ${signed(p - mode)}px）`, g.path);
        }
      });
    }
    if (noMode) this.issue('warn', 'spacing', `${g.name}: 間隔が揃っていない（${pitches.join(' / ')}px）`, g.path);
    const offs = grp.map(e => [e[0].rect[0] - e[1][0], e[0].rect[1] - e[1][1], e[0].rect[2], e[0].rect[3]]);
    const slot = new Counter(offs).mostCommon()[0];
    grp.forEach((e, idx) => {
      const o = offs[idx];
      if (o.every((v, i) => v === slot[i])) return;
      if (Math.max(...o.map((v, i) => Math.abs(v - slot[i]))) <= TOL) {
        this.issue('info', 'size_mismatch', `${g.name}: 項目の大きさが少し違う（${e[0].name} ${o[2]}×${o[3]} / 他 ${slot[2]}×${slot[3]}）。中の area_ の大きさをそろえると良い`, e[0].path, ['size_mismatch', g.uid]);
        return;
      }
      const it = e[0];
      it.rect_original = it.rect;
      it.rect = [e[1][0] + slot[0], e[1][1] + slot[1], slot[2], slot[3]];
      it.rect_source = 'slot';
      this.issue('suggest', 'slot_area', `${it.name}: 中身のはみ出し（バッジ等）で他の項目より大きい（${o[2]}×${o[3]} / 他 ${slot[2]}×${slot[3]}）。枠は他にそろえた。項目全体の area_ を置くと確実`, it.path);
    });
    const order = new Map(grp.map((e, i) => [e[0].uid, i]));
    const psdOrder = g.children.filter(c => order.has(c.uid)).map(c => c.name);
    g.children.sort((a, b) => (order.has(a.uid) ? order.get(a.uid) : 999) - (order.has(b.uid) ? order.get(b.uid) : 999));
    for (const e of grp) e[0].layout_item = true;
    const first = grp[0][0].rect, last = grp[grp.length - 1][0].rect, gr = g.rect;
    this.layouts.push({
      group: g.name, group_path: g.path, axis, items: grp.map(e => e[0].name),
      basis: grp.map(e => e[2]), pitch: mode, pitches, spacing: mode - slot[2 + k],
      item_size: [slot[2], slot[3]],
      padding_lrtb: [first[0] - gr[0], gr[0] + gr[2] - last[0] - last[2], first[1] - gr[1], gr[1] + gr[3] - last[1] - last[3]],
      uniform, deviations: dev, outside: outside.map(c => c.name),
      reordered: psdOrder.join('\u0000') !== grp.map(e => e[0].name).join('\u0000'),
      confidence: (grp.length >= 3 && uniform && !outside.length) ? 'high' : ((!uniform || outside.length) ? 'check' : 'medium') });
    g.layout = this.layouts.length - 1;
  }

  // 4. Prefab
  sig(n) {
    const r = n.role;
    if (r === 'text') return ['T'];
    if (r === 'image') { const q = v => pyRound(v / 4.0); return [n.merged ? 'M' : 'I', q(n.rect[2]), q(n.rect[3])]; }
    return ['G', !!n.base_image, n.children.map(c => this.sig(c))];
  }
  sigKey(n) { return JSON.stringify(this.sig(n)); }

  leaves(n) { let out = []; for (const c of n.children) out = out.concat(c.role === 'group' ? this.leaves(c) : [c]); return out; }

  diffs(members) {
    const out = [];
    const lv = members.map(g => this.leaves(g));
    if (!lv.length || !lv.every(x => x.length)) return out;
    const m = Math.min(...lv.map(x => x.length));
    for (let j = 0; j < m; j++) {
      const col = lv.map(x => x[j]);
      if (col[0].role === 'text') {
        const vals = col.map(c => c.text.content);
        if (new Set(vals).size > 1) out.push({ kind: 'text', label: '文字', values: vals });
        else if (NUMERIC_TEXT.test(vals[0] || '')) out.push({ kind: 'runtime', label: '数字（実行時）', values: vals });
      } else {
        const vals = col.map(c => c.name);
        if (new Set(vals).size > 1) out.push({ kind: 'image', label: commonPrefix(vals) + '*', values: vals });
      }
    }
    return out;
  }

  static ancestors(n, parent) { const out = []; while (parent.has(n.uid)) { n = parent.get(n.uid); out.push(n); } return out; }

  prefabClasses(root) {
    const conts = [], parent = new Map();
    (function walk_(n) { for (const c of n.children) if (c.role === 'group') { parent.set(c.uid, n); conts.push(c); walk_(c); } })(root);

    const byParent = new Map();
    for (const c of conts) if (c.is_prefab) {
      const pid = parent.get(c.uid).uid;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(c);
    }
    for (const members of byParent.values()) {
      const sigs = new Counter(members.map(m => this.sigKey(m)));
      const mainSig = sigs.mostCommon()[0];
      const baseMembers = members.filter(m => this.sigKey(m) === mainSig);
      const odd = members.filter(m => this.sigKey(m) !== mainSig);
      const name = members.length > 1 ? commonPrefix(members.map(m => m.id)) : members[0].id;
      const variants = [];
      for (const m of odd) {
        const baseKids = new Counter(baseMembers[0].children.map(c => this.sigKey(c)));
        const kc = new Counter(m.children.map(c => this.sigKey(c)));
        const extraSigs = kc.minus(baseKids);
        const extra = m.children.filter(c => extraSigs.get(this.sigKey(c))).map(c => c.name);
        const missing = baseKids.minus(kc).total();
        variants.push({ name: m.name, path: m.path, extra, missing });
        if (extra.length && !missing)
          this.issue('suggest', 'prefab_variant', `Prefab「${name}」: ${m.name} だけ ${extra.join('・')} が多い。同じ Prefab の中で表示を切り替えるか、別の Prefab にするかを決める`, m.path);
        else
          this.issue('warn', 'prefab_mismatch', `Prefab「${name}」: ${m.name} の中の構成が他のインスタンスと違う`, m.path);
      }
      this.prefabs.push({ name, explicit: true, members: members.map(m => m.name), paths: members.map(m => m.path),
        parent: parent.get(members[0].uid).name, variants, diffs: baseMembers.length > 1 ? this.diffs(baseMembers) : [] });
      for (const m of members) m.prefab = { kind: 'explicit', index: this.prefabs.length - 1, variant: odd.includes(m) };
    }

    const bySig = new Map();
    for (const c of conts) {
      if (c.is_prefab || c.children.length < 2) continue;
      const key = JSON.stringify([parent.get(c.uid).uid, this.sig(c)]);
      if (!bySig.has(key)) bySig.set(key, []);
      bySig.get(key).push(c);
    }
    for (const members of bySig.values()) {
      if (members.length < 2) continue;
      const inside = Builder.ancestors(members[0], parent).filter(a => a.is_prefab || a.prefab);
      const name = commonPrefix(members.map(m => m.id));
      const pf = { name, explicit: false, members: members.map(m => m.name), paths: members.map(m => m.path),
        parent: parent.get(members[0].uid).name, variants: [], diffs: this.diffs(members),
        inside_prefab: inside.length ? inside[0].id : null };
      this.prefabs.push(pf);
      for (const m of members) m.prefab = { kind: 'candidate', index: this.prefabs.length - 1 };
      if (!inside.length) {
        const d = pf.diffs.map(x => x.label).join('、') || 'なし';
        this.issue('suggest', 'prefab_candidate', `${members.map(m => m.name).join('・')} は同じ構造（違いは ${d}）。Prefab「${name}」にするなら _Prefab を付ける`, members[0].path);
      }
    }
  }

  // 5. Unity の値
  toUnity(n, parent) {
    if (parent) {
      const pc = center(parent.rect), c = center(n.rect);
      const u = { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5],
        anchoredPosition: [round2(c[0] - pc[0]), round2(pc[1] - c[1])], sizeDelta: [n.rect[2], n.rect[3]] };
      // space_ で画面端（親の端）からの距離が決まっているものは、その端に固定する
      const a = n.anchor || {};
      if (a.h) {
        const k = a.h.side === 'left' ? 0 : 1;
        u.anchorMin[0] = u.anchorMax[0] = u.pivot[0] = k;
        u.anchoredPosition[0] = k === 0 ? a.h.offset : -a.h.offset;
      }
      if (a.v) {
        const k = a.v.side === 'top' ? 1 : 0;           // Unity は上が 1
        u.anchorMin[1] = u.anchorMax[1] = u.pivot[1] = k;
        u.anchoredPosition[1] = k === 1 ? -a.v.offset : a.v.offset;
      }
      n.unity = u;
    } else {
      n.unity = { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [this.W, this.H] };
    }
    const r = n.role; let comps = [];
    if (r === 'root') comps = ['Canvas', 'CanvasScaler'];
    else if (r === 'group') {
      comps = ['RectTransform'];
      if (n.base_image) comps.push('Image');
      if (n.layout !== undefined && n.layout !== null)
        comps.push(this.layouts[n.layout].axis === 'horizontal' ? 'HorizontalLayoutGroup' : 'VerticalLayoutGroup');
      if (/^(Btn|Button)_/.test(n.id)) comps.push('Button?');
    } else if (r === 'image') comps = ['Image'];
    else if (r === 'text') comps = ['TextMeshProUGUI'];
    n.unity.name = n.id; n.unity.components = comps;
    if (n.prefab) n.unity.prefab = n.prefab.kind;
    for (const c of n.children) this.toUnity(c, n);
  }
}

// ------------------------------------------------------------------ 6. 検査と提案
function walk(n, parents = []) {
  const out = [[n, parents]];
  for (const c of n.children) out.push(...walk(c, parents.concat([n])));
  return out;
}
function rawFind(n, path) {
  if (n.path === path) return n;
  for (const c of n.children || []) { const r = rawFind(c, path); if (r) return r; }
  return null;
}

function runChecks(root, b) {
  const nodes = walk(root);
  const real = nodes.filter(([n]) => n.role !== 'root');
  const isBtn = id => /^(Btn|Button)_/.test(id);

  // 印の抜け: 外したグループ
  for (const f of b.flattened) {
    if (f.how !== 'dissolved') continue;
    const g = rawFind(b.raw_root, f.path);
    if (!g) continue;
    const kids = g.children.filter(c => c.visible && c.kind !== 'area');
    const texts = kids.filter(c => c.kind === 'text');
    const why = [];
    if (isBtn(g.id)) why.push('名前がボタン');
    if (texts.some(t => NUMERIC_TEXT.test(t.text.content || ''))) why.push('実行時に変わる数字を含む');
    if (texts.length && kids.some(c => c.kind !== 'text')) why.push('画像と文字の組み合わせ');
    if (!g.path.includes('/')) why.push('画面の大きな区画');
    if (why.length) b.issue('suggest', 'need_grp', `${g.name}: 印が無いのでグループを外した（${why.join('・')}）。1 つの部品として残すなら _Grp を付ける`, g.path);
  }

  // 印の抜け: 自動で 1 枚にまとめたグループ
  const rawRun = g => {
    const imgs = descendants(g).filter(d => d.visible && d.kind === 'image' && !DEFAULT_NAME.test(d.name)).map(d => d.bbox);
    for (const k of [0, 1]) {
      const rows = new Map();
      for (const r of imgs) {
        const key = [pyRound(r[1 - k] / TOL), pyRound(r[2] / TOL), pyRound(r[3] / TOL)].join(',');
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(r);
      }
      for (const rs of rows.values()) {
        if (rs.length < 3) continue;
        const st = rs.map(r => r[k]).sort((a, b2) => a - b2);
        const ps = st.slice(1).map((v, i) => v - st[i]);
        if (Math.max(...ps) - Math.min(...ps) <= TOL && Math.min(...ps) >= rs[0][2 + k] - TOL) return rs.length;
      }
    }
    return 0;
  };
  for (const f of b.flattened) {
    if (f.how !== 'merged') continue;
    const g = rawFind(b.raw_root, f.path);
    if (!g) continue;
    const why = [];
    if (isBtn(g.id)) why.push('名前がボタン');
    const k = rawRun(g);
    if (k) why.push(`同じ大きさの画像が ${k} 個等間隔に並ぶ`);
    if (!g.path.includes('/')) why.push('画面の大きな区画');
    if (why.length) b.issue('suggest', 'need_grp_merged', `${g.name}: 画像だけなので 1 枚にまとめた（${why.join('・')}）。部品に分けるなら _Grp や _List を付ける`, g.path);
  }

  for (const [n] of real) {
    if (n.role !== 'group') continue;
    const hasLayout = n.layout !== undefined && n.layout !== null;
    // _Base の提案
    if (!n.base_image && n.children.length) {
      const bottom = n.children[0], others = n.children.slice(1);
      if (bottom.role === 'image' && others.length && !hasLayout) {
        if (area(bottom.rect) >= 0.85 * area(n.rect) && others.every(o => overlap(bottom.rect, o.rect) > 0.5 * area(o.rect)))
          b.issue('suggest', 'need_base', `${n.name}: 一番下の ${bottom.name} がグループとほぼ同じ大きさ。親自身の画像にするなら _Base を付ける`, bottom.path);
      }
    }
    // _List の提案
    if (!hasLayout) {
      const items = n.children.filter(c => c.role === 'group' || c.role === 'image');
      for (const [axis, grp, pitches] of b.findRuns(items)) {
        if (grp.length >= 3 && Math.max(...pitches) - Math.min(...pitches) <= TOL) {
          const names = grp.map(e => e[0].name);
          const inRun = new Set(grp.map(e => e[0].uid));
          const rest = items.filter(c => !inRun.has(c.uid)).map(c => c.name);
          let msg = `${n.name}: ${names.join('・')} が${axis === 'horizontal' ? '横' : '縦'}に等間隔で並んでいる（${pitches.join(' / ')}px）。`;
          msg += rest.length ? `この並びを新しいグループで包んで _List を付ける（${rest.join('・')} は外に）` : 'このグループに _List を付ける';
          b.issue('suggest', 'need_list', msg, n.path);
        }
      }
    }
  }

  // 自動でまとめた画像
  const merged = b.flattened.filter(f => f.how === 'merged');
  if (merged.length) {
    const cnt = new Counter(merged.map(f => [f.name, f.count]));
    b.issue('info', 'auto_merged', '印の無い画像だけのグループを 1 枚にまとめた: ' +
      cnt.entries().map(([[nm, c], k]) => `${nm}（${c} 枚）` + (k > 1 ? ` × ${k}` : '')).join('、'), merged[0].path);
    for (const f of merged.slice(1)) b.issues[b.issues.length - 1].paths.push(f.path);
  }

  // 名前の検査
  for (const [n] of real) {
    if (n.role === 'text' || n.merged === 'auto') continue;
    if (DEFAULT_NAME.test(n.name)) { b.issue('info', 'default_name', `既定名のまま: ${n.name}（ID が要らない装飾なら問題なし）`, n.path); continue; }
    if (!ID_CHARS.test(n.name)) b.issue('error', 'id_chars', `ID に使えない文字・空白を含む: ${pyRepr(n.name)}`, n.path);
  }
  for (const [n] of nodes) {
    const cnt = new Counter(n.children.map(c => c.unity.name));
    for (const [nm, k] of cnt.entries())
      if (k > 1) b.issue('error', 'dup_sibling', `${n.name} の中に同じ名前が ${k} 個: ${nm}`, n.path);
  }

  const vocab = new Counter();
  for (const [n] of real) {
    if (n.role === 'text') { for (const t of tokens(n.text.content || '')) vocab.add(t, 0.5); }
    else for (const t of tokens(n.id)) vocab.add(t, 1);
  }
  (function rawNames(n) {
    for (const c of n.children || []) {
      if (c.kind === 'area' || c.kind === 'space') for (const t of tokens(parseMarks(c.name)[0])) vocab.add(t, 1);
      rawNames(c);
    }
  })(b.raw_root);
  for (const w of DICTIONARY) vocab.add(w, 1000);
  const flagged = new Set();
  for (const [n] of real) {
    if (n.role === 'text' || DEFAULT_NAME.test(n.name)) continue;
    for (const t of tokens(n.id)) {
      if (t.length < 4 || flagged.has(t) || DICT_SET.has(t)) continue;
      for (const [w, k] of vocab.entries()) {
        if (w === t || w.length < 4 || k < vocab.get(t) || w.toLowerCase() === t.toLowerCase()) continue;
        const wl = w.toLowerCase(), tl = t.toLowerCase();
        if (wl.startsWith(tl) || tl.startsWith(wl) || wl.slice(0, -1) === tl.slice(0, -1)) continue;
        if (lev(t, w) === 1) {
          flagged.add(t);
          b.issue('warn', 'typo', `綴りの揺れの可能性: ${t} → ${w}?`, n.path, ['typo', t]);
          break;
        }
      }
    }
  }
  for (const [n] of real) {
    if (n.role !== 'text') continue;
    const c = n.text.content || '';
    if (flagged.has(c) || c.length < 4 || DICT_SET.has(c)) continue;
    for (const [w] of vocab.entries()) {
      if (flagged.has(w) || w.split(' ').join('') === c.split(' ').join('')) continue;
      if (w !== c && w.length >= 4 && lev(c, w) === 1 && w.slice(0, -1) !== c.slice(0, -1)) {
        b.issue('info', 'typo_text', `仮テキストの綴り: 「${c}」 → ${w}?`, n.path);
        break;
      }
    }
  }

  const groupTokens = new Counter();
  for (const [n] of real) if (n.role === 'group') for (const t of tokens(n.id)) groupTokens.add(t);
  for (const [n, p] of real) {
    if (n.role === 'group' || n.role === 'text' || DEFAULT_NAME.test(n.name)) continue;
    const anc = new Set(p.flatMap(x => tokens(x.id)));
    let hit = null;
    for (const t of tokens(n.id)) {
      if (GENERIC_TOKENS.has(t.toLowerCase())) continue;
      for (const g of groupTokens.keys()) {
        if (g.length < 4 || GENERIC_TOKENS.has(g.toLowerCase())) continue;
        if ((t === g || (t.startsWith(g) && t.length > g.length && isUpper(t[g.length]))) && !anc.has(g)) { hit = g; break; }
      }
      if (hit) break;
    }
    if (hit) b.issue('warn', 'borrowed_name', `${n.name} の「${hit}」が、置かれている場所と合っていない（別の場所の名前の流用？）`, n.path, ['borrowed', n.name, hit]);
  }

  const byName = new Map();
  for (const [n, p] of real) { if (!byName.has(n.id)) byName.set(n.id, []); byName.get(n.id).push([n, p]); }
  for (const [nm, occ] of byName) {
    for (const [a, pa] of occ) for (const [c, pc] of occ) {
      if (a !== c && pa.length && pc.length && pc.slice(0, -1).includes(pa[pa.length - 1]))
        b.issue('warn', 'dup_nested', `同じ名前が入れ子の中で別の部品にも使われている: ${nm}`, a.path, ['dup_nested', nm]);
    }
  }

  const fx = real.filter(([n]) => n.has_fx).map(([n]) => n.path)
    .concat(real.filter(([n]) => n.base_image && n.base_image.has_fx).map(([n]) => n.base_image.path));
  if (fx.length) b.issue('info', 'layer_fx', `レイヤースタイル付きが ${fx.length} 個。画像に書き出すときに焼き込む`, null);
  for (const [n] of real) if (n.role === 'text' && NUMERIC_TEXT.test(n.text.content || '')) n.hint_dynamic = true;
}

// ------------------------------------------------------------------ 入口
function analyze(input) {
  const b = new Builder(input.canvas[0], input.canvas[1], input.layers);
  const root = b.build();
  runChecks(root, b);
  b.issues.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]);
  for (const i of b.issues) delete i._key;
  return {
    source: input.source || '', canvas: [b.W, b.H],
    rules: { marks: { _Grp: 'ゲームオブジェクト', _List: 'レイアウトグループ', _Prefab: 'Prefab', _Img: '1 枚の画像', _Base: '親自身の画像' },
      area_prefix: 'area_', space_prefix: 'space_', tolerance_px: TOL },
    tree: root, layouts: b.layouts, prefabs: b.prefabs, spaces: b.spaces, flattened: b.flattened, issues: b.issues,
    raw: b.raw_root,
  };
}

module.exports = { analyze, parseMarks, TOL, LEVEL_ORDER };
