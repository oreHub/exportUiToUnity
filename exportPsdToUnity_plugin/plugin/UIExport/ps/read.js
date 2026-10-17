/* Photoshop の開いているドキュメントから、解析用のレイヤー情報を読む（読むだけ。PSD は変えない） */
'use strict';
const { app, action, constants } = require('photoshop');

const KIND = (constants && constants.LayerKind) || {};
const GROUP = KIND.GROUP || 'group';
const TEXT = KIND.TEXT || 'text';

function toArray(c) { if (!c) return []; const n = c.length || 0; const a = []; for (let i = 0; i < n; i++) a.push(c[i]); return a; }

function isGroup(l) { return l.kind === GROUP || l.kind === 'group' || l.kind === 'LayerKind.GROUP'; }
function isText(l) { return l.kind === TEXT || l.kind === 'text' || l.kind === 'LayerKind.TEXT'; }

function psdKind(l) {
  if (isGroup(l)) return 'group';
  if (isText(l)) return 'type';
  return String(l.kind || 'pixel').replace(/^LayerKind\./, '').toLowerCase();
}

function bboxOf(l) {
  const b = l.boundsNoEffects || l.bounds;
  if (!b) return [0, 0, 0, 0];
  const L = Math.round(b.left), T = Math.round(b.top), R = Math.round(b.right), B = Math.round(b.bottom);
  if (R <= L || B <= T) return [0, 0, 0, 0];
  return [L, T, R - L, B - T];
}

function unitValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v._value === 'number') return v._value;
  return null;
}

function hex2(n) { const s = Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase(); return s.length < 2 ? '0' + s : s; }

function textInfo(desc, resolution) {
  const info = { content: null, font: null, size: null, color: null, align: null };
  try {
    const tk = desc.textKey;
    if (!tk) return info;
    info.content = String(tk.textKey || '').replace(/\r/g, '\n').trim();
    const st = tk.textStyleRange && tk.textStyleRange[0] && tk.textStyleRange[0].textStyle;
    if (st) {
      let size = unitValue(st.size);
      const tr = tk.transform;
      if (size !== null && tr && typeof tr.yy === 'number') size *= Math.abs(tr.yy);
      else if (unitValue(st.impliedFontSize) !== null) size = unitValue(st.impliedFontSize);
      if (size !== null) info.size = Math.round(size * (resolution || 72) / 72 * 10) / 10;
      info.font = st.fontPostScriptName || st.fontName || null;
      const c = st.color;
      if (c && typeof c.red === 'number') info.color = '#' + hex2(c.red) + hex2(c.grain !== undefined ? c.grain : c.green) + hex2(c.blue);
    }
    const ps = tk.paragraphStyleRange && tk.paragraphStyleRange[0] && tk.paragraphStyleRange[0].paragraphStyle;
    const al = ps && ps.align && ps.align._value;
    info.align = al === 'center' ? 'center' : al === 'right' ? 'right' : 'left';
  } catch (e) { /* 読めない項目は空のまま */ }
  return info;
}

// ------------------------------------------------------------------ 標準の読み方（レイヤーごとに問い合わせる。遅いが確実）
async function readDocumentSlow() {
  const doc = app.activeDocument;
  if (!doc) throw new Error('ドキュメントが開かれていません');

  const flat = [];
  (function collect(layers) { for (const l of toArray(layers)) { flat.push(l); if (isGroup(l)) collect(l.layers); } })(doc.layers);

  // レイヤースタイルと文字の情報は batchPlay でまとめて読む
  const cmds = flat.map(l => ({ _obj: 'get', _target: [{ _ref: 'layer', _id: l.id }, { _ref: 'document', _id: doc.id }] }));
  const descs = cmds.length ? await action.batchPlay(cmds, {}) : [];
  const byId = new Map();
  flat.forEach((l, i) => byId.set(l.id, descs[i] || {}));

  const resolution = doc.resolution || 72;
  function node(l) {
    const d = byId.get(l.id) || {};
    const n = {
      name: l.name, group: isGroup(l), text: isText(l), psd_kind: psdKind(l),
      visible: !!l.visible, opacity: Math.round((typeof l.opacity === 'number' ? l.opacity : 100) / 100 * 1000) / 1000,
      has_fx: !!d.layerEffects && d.layerFXVisible !== false,
      bbox: bboxOf(l), children: [], layer_id: l.id,
    };
    if (n.group) n.children = toArray(l.layers).reverse().map(node);
    else if (n.text && !l.name.startsWith('area_') && !l.name.startsWith('space_')) n.text_info = textInfo(d, resolution);
    return n;
  }
  return {
    source: doc.name, doc_id: doc.id, reader: 'standard',
    canvas: [Math.round(Number(doc.width)), Math.round(Number(doc.height))], resolution,
    layers: toArray(doc.layers).reverse().map(node),
  };
}

// ------------------------------------------------------------------ 速い読み方（全レイヤーの必要な項目を 1 回でまとめて取る）
const LAYER_KIND = { 1: 'pixel', 2: 'adjustment', 3: 'type', 4: 'shape', 5: 'smartobject', 6: 'video', 7: 'group',
  8: '3d', 9: 'gradientfill', 10: 'patternfill', 11: 'solidcolor', 12: 'pixel' };

function rectOf(b) {
  if (!b) return [0, 0, 0, 0];
  const L = Math.round(unitValue(b.left)), T = Math.round(unitValue(b.top));
  const R = Math.round(unitValue(b.right)), B = Math.round(unitValue(b.bottom));
  if (!(R > L && B > T)) return [0, 0, 0, 0];
  if (Math.abs(L) > 1e6 || Math.abs(T) > 1e6 || R - L > 1e6 || B - T > 1e6) return [0, 0, 0, 0];   // 空のグループなど
  return [L, T, R - L, B - T];
}

async function readDocumentFast() {
  const doc = app.activeDocument;
  if (!doc) throw new Error('ドキュメントが開かれていません');
  const docRef = { _ref: 'document', _id: doc.id };
  const [bg] = await action.batchPlay([{ _obj: 'get', _target: [{ _property: 'hasBackgroundLayer' }, docRef] }], {});
  const start = bg && bg.hasBackgroundLayer ? 0 : 1;
  const props = ['name', 'layerID', 'layerKind', 'layerSection', 'visible', 'opacity', 'boundsNoEffects',
    'layerEffects', 'layerFXVisible', 'textKey'];
  const [res] = await action.batchPlay([{
    _obj: 'multiGet', _target: { _ref: [docRef] },
    extendedReference: [props, { _obj: 'layer', index: start, count: -1 }],
    options: { failOnMissingProperty: false, failOnMissingElement: false },
  }], {});
  const list = res && res.list;
  if (!Array.isArray(list)) throw new Error('multiGet の結果が想定と違う: ' + JSON.stringify(res).slice(0, 300));

  const resolution = doc.resolution || 72;
  // list は下から順。上から順にたどり、グループの始まりと終わりの印で入れ子を作る
  const root = { children: [] }, stack = [root];
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i] || {};
    const sec = d.layerSection && d.layerSection._value;
    if (sec === 'layerSectionEnd') { if (stack.length > 1) stack.pop(); continue; }
    const isGrp = sec === 'layerSectionStart';
    const isTxt = !isGrp && (d.layerKind === 3 || !!d.textKey);
    const name = String(d.name || '');
    const n = {
      name, group: isGrp, text: isTxt, psd_kind: isGrp ? 'group' : (LAYER_KIND[d.layerKind] || 'pixel'),
      visible: d.visible !== false,
      opacity: Math.round((typeof d.opacity === 'number' ? d.opacity : 255) / 255 * 1000) / 1000,
      has_fx: !!d.layerEffects && d.layerFXVisible !== false,
      bbox: rectOf(d.boundsNoEffects), children: [], layer_id: d.layerID,
    };
    if (isTxt && !name.startsWith('area_') && !name.startsWith('space_')) n.text_info = textInfo(d, resolution);
    stack[stack.length - 1].children.push(n);
    if (isGrp) stack.push(n);
  }
  // 上から順に積んだので、下から順（Python 版と同じ並び）に直す
  (function rev(n) { n.children.reverse(); n.children.forEach(rev); })(root);
  return {
    source: doc.name, doc_id: doc.id, reader: 'fast',
    canvas: [Math.round(Number(doc.width)), Math.round(Number(doc.height))], resolution,
    layers: root.children,
  };
}

// 速い読み方を使い、失敗したら標準の読み方に切り替える
async function readDocument() {
  try {
    return await readDocumentFast();
  } catch (e) {
    const r = await readDocumentSlow();
    r.fast_error = String(e && e.message || e);
    return r;
  }
}

// 2 つの読み方の結果を比べる（確認用）
function compareReads(a, b) {
  const diffs = [];
  const KEYS = ['name', 'group', 'text', 'visible', 'opacity', 'has_fx', 'bbox', 'layer_id', 'text_info'];
  (function cmp(x, y, path) {
    if (x.length !== y.length) diffs.push(`${path || '(最上位)'}: レイヤー数 ${x.length} / ${y.length}`);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const p = `${path}/${x[i].name}`;
      for (const k of KEYS) {
        if (k === 'bbox' && x[i].group) continue;   // グループの範囲は解析で中身から計算し直すので比べない
        const u = JSON.stringify(x[i][k]), v = JSON.stringify(y[i][k]);
        if (u !== v) diffs.push(`${p} の ${k}: ${u} / ${v}`);
      }
      cmp(x[i].children, y[i].children, p);
    }
  })(a.layers, b.layers, '');
  return diffs;
}

module.exports = { readDocument, readDocumentFast, readDocumentSlow, compareReads };
