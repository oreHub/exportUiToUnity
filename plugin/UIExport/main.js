/* UI Export パネル（段階 3: 解析と表示、レイヤー名で直せる提案の適用、書き出し） */
'use strict';
const { app, core, action } = require('photoshop');
const { storage } = require('uxp');
const { readDocument, readDocumentFast, readDocumentSlow, compareReads } = require('./ps/read.js');
const { analyze } = require('./core/analyze.js');
const { computeFixes, revealInfo } = require('./core/fixes.js');
const X = require('./core/export.js');
const PX = require('./ps/export.js');

const PLUGIN_VERSION = '0.3.0';
const LEVELS = [['error', 'エラー'], ['warn', '注意'], ['suggest', '提案'], ['info', '情報']];
const LEVEL_LABEL = Object.fromEntries(LEVELS);
// 項目の見出し（問題の種類の短い説明）
const TITLE = {
  base_multi: '_Base の重複', id_chars: '使えない文字', dup_sibling: '名前の重複',
  area_conflict: 'area_ の重複', text_overflow: '文字のはみ出し', space_unused: 'space_ が使われていない',
  space_mismatch: 'space_ と実際の距離の違い', space_axis: 'space_ の向き', mark_on_layer: '印の付け先',
  mark_conflict: '印の組み合わせ', base_group: '_Base の付け方', list_text: '並びの中の文字', list_short: '並びの項目不足',
  list_not_aligned: '並びが揃っていない', list_outsider: '並びから外れた項目', spacing: '間隔の不揃い',
  prefab_mismatch: 'Prefab の構成違い', typo: '綴りの揺れ', borrowed_name: '名前の流用', dup_nested: '入れ子での名前の重複',
  area_outside: 'area_ の置き場所', area_order: 'area_ の並べ忘れ', frame_overflow: '枠からのはみ出し',
  slot_area: '項目の大きさ', prefab_variant: 'Prefab の違い', prefab_candidate: 'Prefab 候補',
  need_grp: 'グループ指定', need_grp_merged: 'グループ指定（まとめた画像）', need_base: '_Base 候補', need_list: '並び（_List）候補',
  hidden: '非表示のレイヤー', img_text: '画像に焼き込む文字', area_dropped: '使われない area_', no_text_box: '文字枠なし',
  size_mismatch: '大きさの小さな差', auto_merged: '自動でまとめた画像', default_name: '既定の名前', typo_text: '仮テキストの綴り',
  layer_fx: 'レイヤースタイル',
};
const shown = { error: true, warn: true, suggest: true, info: false };
let state = null;   // { input, result, pathToId, docId }

const $ = id => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}
function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }

function showMessage(text, detail, kind) {
  const m = $('msg'); clear(m);
  if (!text) { m.classList.add('hidden'); return; }
  if (kind === 'ok') m.classList.add('ok'); else m.classList.remove('ok');
  m.appendChild(el('div', null, text));
  if (detail) {
    const ta = document.createElement('textarea');
    ta.value = detail; ta.readOnly = true;
    m.appendChild(ta);
  }
  m.classList.remove('hidden');
}

// ------------------------------------------------------------------ 解析
// 成功したら true
async function runAnalyze() {
  showMessage(null);
  const btn = $('btnAnalyze');
  btn.setAttribute('disabled', '');
  $('docInfo').textContent = '読み取り中…';
  try {
    if (!app.activeDocument) { $('docInfo').textContent = 'PSD を開いて「解析」'; showMessage('ドキュメントが開かれていません。'); return false; }
    const t0 = Date.now();
    const input = await readDocument();
    const t1 = Date.now();
    const result = analyze(input);
    const t2 = Date.now();
    const pathToId = new Map();
    (function walk(n) { for (const c of n.children || []) { if (!pathToId.has(c.path) && c.layer_id !== undefined) pathToId.set(c.path, c.layer_id); walk(c); } })(result.raw);
    state = { input, result, pathToId, docId: input.doc_id, fixes: computeFixes(result) };
    try { state.stamp = X.readStamp(await PX.readXmp(input.doc_id)); } catch (e) { state.stamp = {}; }
    prefillScreen();
    const sec = ms => (ms / 1000).toFixed(1);
    const info = $('docInfo'); clear(info);
    info.appendChild(el('div', null, `${input.source}  ${input.canvas[0]}×${input.canvas[1]}`));
    info.appendChild(el('div', 'sub', `${sec(t2 - t0)} 秒（読み取り ${sec(t1 - t0)}・解析 ${sec(t2 - t1)}）`));
    $('docInfo').title = input.reader === 'fast' ? '読み取り: まとめて取る方式' : '読み取り: レイヤーごとに問い合わせる方式';
    render();
    if (input.fast_error)
      showMessage('速い読み取りができなかったので、標準の読み取りで解析しました（結果は正しいです）。下の内容を送ってもらえれば直します。', input.fast_error);
    return true;
  } catch (e) {
    $('docInfo').textContent = '解析できませんでした';
    showMessage('解析中にエラーが出ました。下の内容をそのまま送ってください。', `${e && e.message}\n\n${e && e.stack}`);
    return false;
  } finally {
    btn.removeAttribute('disabled');
  }
}

// ------------------------------------------------------------------ レイヤーの選択
async function selectLayer(path) {
  if (!state) return;
  const id = state.pathToId.get(path);
  if (id === undefined) { showMessage(`対応するレイヤーが見つかりません: ${path}`); return; }
  const doc = app.activeDocument;
  if (!doc || doc.id !== state.docId) { showMessage('解析したときと別のドキュメントが表示されています。もう一度「解析」してください。'); return; }
  try {
    const sel = lid => ({ _obj: 'select', _target: [{ _ref: 'layer', _id: lid }], makeVisible: false, layerID: [lid] });
    // グループを選ぶだけでは親のグループが開かないので、先に中のレイヤーを選んで開かせてから、グループを選び直す
    const { leaf } = revealInfo(state.result, id);
    await core.executeAsModal(async () => {
      if (leaf !== null) await action.batchPlay([sel(leaf)], {});
      await action.batchPlay([sel(id)], {});
    }, { commandName: 'レイヤーを選択' });
    showMessage(null);
  } catch (e) {
    showMessage('レイヤーを選択できませんでした（消したり名前を変えたりした場合は、もう一度「解析」してください）。', `${e && e.message}`);
  }
}

// 名前の表示（押すとそのレイヤーを選ぶ）。withPath のときだけ 親 / 親 / 名前 の形にする
function refChip(path, withPath) {
  const a = el('span', 'ref');
  const parts = path.split('/');
  if (withPath) {
    parts.forEach((p, k) => {
      if (k) a.appendChild(el('span', 'sep', ' / '));
      a.appendChild(el('span', k === parts.length - 1 ? 'leaf' : 'anc', p));
    });
  } else {
    a.appendChild(el('span', 'leaf', parts[parts.length - 1]));
  }
  a.title = path;
  a.addEventListener('click', ev => { if (ev && ev.stopPropagation) ev.stopPropagation(); selectLayer(path); });
  return a;
}

// 説明文の中のレイヤー名を、階層つきの名前に置き換える
function nameIndex() {
  if (state.names) return state.names;
  const byName = new Map();
  (function walk(n) { for (const c of n.children || []) { if (c.layer_id !== undefined) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c.path); } walk(c); } })(state.result.raw);
  const names = [...byName.keys()].filter(n => n.length >= 2).sort((a, b) => b.length - a.length);
  state.names = { byName, names };
  return state.names;
}
function resolvePath(name, issue) {
  const cands = nameIndex().byName.get(name) || [];
  const ps = issue.paths;
  return cands.find(p => ps.includes(p))
    || cands.find(p => ps.some(q => q && p.startsWith(q + '/')))
    || cands.find(p => ps.some(q => q && q.startsWith(p + '/')))
    || cands.find(p => ps.some(q => q && p.split('/').slice(0, -1).join('/') === q.split('/').slice(0, -1).join('/')))
    || cands[0];
}
const WORD = /[A-Za-z0-9_]/;
function linkifyMessage(msg, issue) {
  const frag = el('div', 'text');
  const { names } = nameIndex();
  const used = new Set();
  let i = 0, buf = '';
  const flush = () => { if (buf) { frag.appendChild(document.createTextNode(buf)); buf = ''; } };
  while (i < msg.length) {
    let hit = null;
    if (!(i > 0 && WORD.test(msg[i - 1]) && WORD.test(msg[i]))) {
      for (const n of names) {
        if (msg.startsWith(n, i) && !(WORD.test(n[n.length - 1]) && i + n.length < msg.length && WORD.test(msg[i + n.length]))) { hit = n; break; }
      }
    }
    if (hit) {
      const p = resolvePath(hit, issue);
      flush(); frag.appendChild(refChip(p)); used.add(p); i += hit.length;
    } else { buf += msg[i]; i += 1; }
  }
  flush();
  return { node: frag, used };
}

// ------------------------------------------------------------------ 修正（レイヤー名だけを変える）
async function applyFix(opt) {
  if (!state) return;
  const doc = app.activeDocument;
  if (!doc || doc.id !== state.docId) { showMessage('解析したときと別のドキュメントが表示されています。もう一度「解析」してください。'); return; }
  const docRef = { _ref: 'document', _id: doc.id };
  let changed = [];
  try {
    await core.executeAsModal(async (ctx) => {
      // 解析した後に名前が変わっていないか確かめる
      const cur = await action.batchPlay(opt.renames.map(r => ({ _obj: 'get', _target: [{ _property: 'name' }, { _ref: 'layer', _id: r.id }, docRef] })), {});
      const stale = opt.renames.filter((r, k) => !cur[k] || cur[k].name !== r.from);
      if (stale.length) throw new Error(`解析した後に名前が変わっています: ${stale.map(r => r.from).join('、')}`);
      let hid = null;
      try { hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: `UI Export: ${opt.label}` }); } catch (e) { hid = null; }
      await action.batchPlay(opt.renames.map(r => ({ _obj: 'set', _target: [{ _ref: 'layer', _id: r.id }], to: { _obj: 'layer', name: r.to } })), {});
      if (hid !== null) await ctx.hostControl.resumeHistory(hid);
      changed = opt.renames;
    }, { commandName: `UI Export: ${opt.label}` });
  } catch (e) {
    showMessage('名前を変えられませんでした。もう一度「解析」してから試してください。', `${e && e.message}`);
    return;
  }
  await runAnalyze();
  showMessage(`${changed.length} 件の名前を変えて、解析し直しました（取り消すときは Photoshop の取り消し）: ` +
    changed.map(r => `${r.from} → ${r.to}`).join('、'), null, 'ok');
}

// ------------------------------------------------------------------ 表示
function render() {
  const { result } = state;
  // 件数（クリックで絞り込み）
  const counts = $('counts'); clear(counts);
  for (const [lv, label] of LEVELS) {
    const n = result.issues.filter(i => i.level === lv).length;
    const b = el('div', 'count' + (shown[lv] ? ' on' : ''));
    b.appendChild(el('span', `dot c-${lv}`, '●'));
    b.appendChild(el('span', null, `${label} ${n}`));
    b.addEventListener('click', () => { shown[lv] = !shown[lv]; render(); });
    counts.appendChild(b);
  }
  counts.classList.remove('hidden');
  $('tabs').classList.remove('hidden');
  renderIssues();
  renderTree();
}

function renderIssues() {
  const pane = $('pane-issues'); clear(pane);
  const list = state.result.issues.filter(i => shown[i.level]);
  if (!list.length) {
    pane.appendChild(el('div', 'empty', state.result.issues.length ? '表示中の種類には問題がありません（上の件数を押すと表示を切り替えられます）。' : '問題は見つかりませんでした。'));
    return;
  }
  for (const i of list) {
    const idx = state.result.issues.indexOf(i);
    const row = el('div', 'issue');
    row.appendChild(el('div', `bar lv-${i.level}`));
    const body = el('div', 'body');
    body.appendChild(el('div', `lv c-${i.level}`, `${LEVEL_LABEL[i.level]}：${TITLE[i.code] || i.code}`));
    const { node: text, used } = linkifyMessage(i.message, i);
    body.appendChild(text);
    let rest = i.paths.filter(p => p && !used.has(p));
    if (i.code === 'dup_sibling') {        // 重複しているレイヤーをすべて対象に出す
      const m = i.message.match(/: (.+)$/);
      const all = (m && nameIndex().byName.get(m[1])) || [];
      rest = rest.concat(all.filter(p => !used.has(p) && !rest.includes(p)));
    }
    if (rest.length) {
      const ps = el('div', 'paths');
      ps.appendChild(el('div', 'muted', '対象:'));
      // 本文に出てこない対象。同じ名前が複数あるときだけ、区別できるように階層つきで出す
      const counts = new Map(); for (const p of rest) { const nm = p.split('/').pop(); counts.set(nm, (counts.get(nm) || 0) + 1); }
      for (const p of rest.slice(0, 12)) {            // 1 件ずつ改行
        const line = el('div', 'pline');
        line.appendChild(refChip(p, counts.get(p.split('/').pop()) > 1 || used.has(p)));
        ps.appendChild(line);
      }
      if (rest.length > 12) ps.appendChild(el('div', 'pline muted', `ほか ${rest.length - 12} 件`));
      body.appendChild(ps);
    }
    for (const opt of state.fixes.get(idx) || []) {
      const box = el('div', 'fix');
      const b = el('div', 'fbtn', opt.label);          // 背景色を指定するため、標準の sp-button ではなく自前のボタン
      b.addEventListener('click', () => applyFix(opt));
      box.appendChild(b);
      const pv = el('div', 'fixpv muted');                 // 名前の変更は 1 件ずつ改行して出す
      for (const r of opt.renames.slice(0, 8)) pv.appendChild(el('div', null, `${r.from} → ${r.to}`));
      if (opt.renames.length > 8) pv.appendChild(el('div', null, `ほか ${opt.renames.length - 8} 件`));
      box.appendChild(pv);
      body.appendChild(box);
    }
    row.appendChild(body);
    pane.appendChild(row);
  }
}

const SIDE = { left: '左', right: '右', top: '上', bottom: '下' };
function nodeTag(n, result) {
  if (n.role === 'root') return ['Canvas', 't-grp'];
  if (n.role === 'text') return ['Text', 't-text'];
  if (n.role === 'image') return [n.merged ? 'Img*' : 'Img', 't-img'];
  if (n.layout !== undefined && n.layout !== null) return ['List', 't-list'];
  if (n.prefab && n.prefab.kind === 'explicit') return ['Prefab', 't-prefab'];
  return ['Grp', 't-grp'];
}
function nodeInfo(n, result) {
  const parts = [];
  if (n.role === 'root') parts.push(`${n.rect[2]}×${n.rect[3]}`);
  if (n.role === 'text') parts.push(`「${(n.text.content || '').replace(/\n/g, ' ')}」` + (n.text.size ? ` ${n.text.size}px` : ''));
  if (n.role === 'image' && n.merged) parts.push(n.merged === 'img' ? `_Img（${n.merged_count} 枚を 1 枚に）` : `自動で 1 枚に（${n.merged_count} 枚）`);
  if (n.layout !== undefined && n.layout !== null) {
    const l = result.layouts[n.layout];
    parts.push(`${l.axis === 'horizontal' ? '横' : '縦'} 間隔 ${l.spacing}`);
  }
  if (n.prefab) parts.push(n.prefab.kind === 'explicit' ? (n.prefab.variant ? 'Prefab（違いあり）' : '') : 'Prefab 候補');
  if (n.role === 'image' && n.frame_from) parts.push(`枠: ${n.frame_from}`);
  if (n.role === 'text' && n.text_box_from) parts.push(`枠: ${n.text_box_from}`);
  if (n.group_area_from) parts.push(`領域: ${n.group_area_from}`);
  if (n.base_image) parts.push(`Base: ${n.base_image.name}`);
  if (n.anchor) for (const k of ['h', 'v']) if (n.anchor[k]) parts.push(`${SIDE[n.anchor[k].side]}端 ${n.anchor[k].offset}`);
  if (n.role !== 'root' && n.role !== 'text') parts.push(`${n.rect[2]}×${n.rect[3]}`);
  return parts.filter(Boolean).join('　');
}

function renderTree() {
  const pane = $('pane-tree'); clear(pane);
  const r = state.result;
  pane.appendChild(el('div', 'legend muted', `並び ${r.layouts.length}・Prefab ${r.prefabs.filter(p => p.explicit).length}（候補 ${r.prefabs.filter(p => !p.explicit).length}）・space_ ${r.spaces.length}　Img* は自動でまとめた画像`));
  (function rec(n, depth) {
    const row = el('div', 'node');
    row.style.paddingLeft = (4 + depth * 14) + 'px';
    const [tag, cls] = nodeTag(n, r);
    row.appendChild(el('span', `tag ${cls}`, tag));
    row.appendChild(el('span', 'name', n.role === 'root' ? (state.input.source || 'Canvas') : n.unity.name));
    row.appendChild(el('span', 'info', nodeInfo(n, r)));
    if (n.path) { row.title = n.path; row.addEventListener('click', () => selectLayer(n.path)); }
    pane.appendChild(row);
    for (const c of n.children) rec(c, depth + 1);
  })(r.tree, 0);
}

// ------------------------------------------------------------------ 書き出し
// 書き出し先は Unity プロジェクトの UIExport フォルダ。選んだフォルダだけに許可をもらい、次回も使えるように記録する
let outFolder = null;
let lastDocId = null;

function showOutFolder() {
  $('outPath').textContent = outFolder ? (outFolder.nativePath || outFolder.name) : '未選択';
}
async function restoreOutFolder() {
  try {
    const t = localStorage.getItem('uiexport.outToken');
    if (t) outFolder = await storage.localFileSystem.getEntryForPersistentToken(t);
  } catch (e) { outFolder = null; }
  showOutFolder();
}
async function pickOutFolder() {
  try {
    const f = await storage.localFileSystem.getFolder();
    if (!f) return false;
    outFolder = f;
    try { localStorage.setItem('uiexport.outToken', await storage.localFileSystem.createPersistentToken(f)); } catch (e) { /* 次回また選ぶ */ }
    showOutFolder();
    return true;
  } catch (e) {
    exportMessage('フォルダを選べませんでした。', 'error', [], `${e && e.message}`);
    return false;
  }
}

// 画面 ID: PSD に記録があればそれを、無ければファイル名から
function prefillScreen() {
  if (state.docId === lastDocId) return;
  lastDocId = state.docId;
  $('screenId').value = state.stamp.ScreenId || (state.input.source || '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_');
}

// 書き出しの結果・確認の表示。buttons: [[ラベル, 押したときの処理]]
function exportMessage(text, kind, buttons, detail) {
  const m = $('exportMsg'); clear(m);
  if (!text) return;
  const box = el('div', `xmsg ${kind || ''}`);
  for (const line of String(text).split('\n')) box.appendChild(el('div', null, line));
  if (detail) { const ta = document.createElement('textarea'); ta.value = detail; ta.readOnly = true; box.appendChild(ta); }
  if (buttons && buttons.length) {
    const row = el('div', 'xbtns');
    for (const [label, fn] of buttons) { const b = el('div', 'fbtn', label); b.addEventListener('click', fn); row.appendChild(b); }
    box.appendChild(row);
  }
  m.appendChild(box);
}

async function getChild(folder, name) { try { return await folder.getEntry(name); } catch (e) { return null; } }
async function readJson(folder, name) {
  const f = await getChild(folder, name);
  return f ? JSON.parse(await f.read({ format: storage.formats.utf8 })) : null;
}
async function writeText(folder, name, text) {
  const f = await folder.createFile(name, { overwrite: true });
  await f.write(text, { format: storage.formats.utf8 });
}
async function writeBinary(folder, name, bytes) {
  const f = await folder.createFile(name, { overwrite: true });
  await f.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { format: storage.formats.binary });
}
async function removeEntry(e) {
  if (e.isFolder) for (const c of await e.getEntries()) await removeEntry(c);
  await e.delete();
}

let exporting = false;
async function runExport(force) {
  if (exporting) return;
  exportMessage(null);
  const doc = app.activeDocument;
  if (!doc) { exportMessage('ドキュメントが開かれていません。', 'error'); return; }
  let psdPath = '';
  try { psdPath = doc.path || ''; } catch (e) { psdPath = ''; }
  if (!psdPath) { exportMessage('先に PSD を保存してください（書き出しと同時に、PSD に版を書き込んで保存するため）。', 'error'); return; }
  const screen = $('screenId').value.trim();
  if (!X.SCREEN_ID.test(screen)) { exportMessage('画面 ID は半角の英数字と _ - だけにしてください（例: Home）。', 'error'); return; }
  if (!outFolder && !(await pickOutFolder())) return;

  exporting = true;
  const btn = $('btnExport'); btn.classList.add('busy'); btn.textContent = '書き出し中…';
  try {
    // 最新の状態で解析し直してから書き出す
    if (!(await runAnalyze()) || state.docId !== doc.id) { exportMessage('解析できなかったので、書き出しを止めました。', 'error'); return; }
    const a = state.result;
    const stamp = state.stamp;
    const dir = await getChild(outFolder, screen);
    const history = (dir && await readJson(dir, 'history.json')) || [];
    const prev = dir && await readJson(dir, 'layout.json');
    const chk = X.checkVersion(stamp, history);
    if (chk.stop && !force) {
      exportMessage(`書き出しを止めました: ${chk.message}\n上書きしてよい場合は「上書きして書き出す」。別案として残すなら、画面 ID を変えて書き出してください。`, 'warn',
        [['上書きして書き出す', () => runExport(true)], ['やめる', () => exportMessage(null)]]);
      return;
    }
    const notes = [];
    if (stamp.ScreenId && stamp.ScreenId !== screen) notes.push(`注意: この PSD は画面「${stamp.ScreenId}」として書き出されたものです。「${screen}」として書き出しました。`);
    const pluginFolder = await storage.localFileSystem.getPluginFolder();
    const template = await (await pluginFolder.getEntry('report_template.html')).read({ format: storage.formats.utf8 });

    let out = null;
    const before = PX.selectedIds(doc);
    await core.executeAsModal(async (ctx) => {
      try {
        const progress = (i, n, name) => {
          if (ctx.isCancelled) throw new Error('書き出しを取り消しました');
          try { ctx.reportProgress({ value: n ? i / n : 0, commandName: `画像を書き出し中 ${i + 1}/${n}: ${name}` }); } catch (e) { /* 表示できなくても続ける */ }
        };
        const render = (lid, frame) => PX.renderLayer(doc, lid, frame, rect => (frame ? X.fitFrame(rect, frame) : { rect, over: null }));
        const files = await X.exportImages(a.tree, a.issues, render, { progress });
        const changes = prev ? X.diff(prev.tree, a.tree) : null;
        if (changes && X.isEmptyDiff(changes)) {
          // 変わっていなければ版を増やさない。PSD の記録が最新の版と違えば、最新の版に合わせておく
          if (stamp.ScreenId !== screen || stamp.BaseVersion !== chk.latest) {
            await PX.writeXmp(doc.id, X.writeStamp(await PX.readXmp(doc.id), screen, chk.latest));
            await doc.save();
          }
          out = { nochange: true };
          return;
        }
        try { ctx.reportProgress({ value: 1, commandName: '画面全体の画像を作成中' }); } catch (e) { /* 続ける */ }
        const preview = await PX.renderPreview(doc);

        const now = new Date();
        const version = X.nextVersion(history, X.today(now));
        const layout = X.buildLayout({ analysis: a, screen, version, base: chk.latest, psdFile: doc.name,
          exportedAt: X.isoLocal(now), toolVersion: PLUGIN_VERSION, imageCount: files.size });
        const entry = X.historyEntry(layout, changes);
        history.push(entry);

        // 全部そろってから書き込む（images は前の版を消してから置く）
        const d = dir || await outFolder.createFolder(screen);
        const old = await getChild(d, 'images');
        if (old) await removeEntry(old);
        const imgDir = await d.createFolder('images');
        for (const [name, png] of files) await writeBinary(imgDir, name.slice('images/'.length), png);
        await writeText(d, 'layout.json', JSON.stringify(layout, null, 1));
        await writeText(d, 'history.json', JSON.stringify(history, null, 1));
        await writeBinary(d, 'preview.png', preview);
        await writeText(d, 'report.html', X.buildReport(template, layout, changes, history));

        // PSD に「画面 ID」と「元にした版」を書き込んで保存
        await PX.writeXmp(doc.id, X.writeStamp(await PX.readXmp(doc.id), screen, version));
        const back = X.readStamp(await PX.readXmp(doc.id));
        const stamped = back.ScreenId === screen && back.BaseVersion === version;
        if (stamped) await doc.save();
        out = { version, entry, changes, stamped, path: d.nativePath || d.name };
      } finally {
        try { await PX.restoreSelection(doc, before); } catch (e) { /* 選択が戻らなくても書き出しは済んでいる */ }
      }
    }, { commandName: 'UI Export: 書き出し' });

    state.fixes = computeFixes(state.result);     // 枠からのはみ出しが増えることがあるので表示を作り直す
    render();
    if (out.nochange) {
      exportMessage(notes.concat([`前の版 ${chk.latest} から変更がありません。版は増やさずに終わりました。`]).join('\n'), 'ok');
      return;
    }
    const lv = out.entry.issues, c = out.changes;
    const lines = [`書き出しました: 版 ${out.version}（元にした版 ${chk.latest || 'なし（初回）'}）`, out.path,
      `画像 ${out.entry.images} 枚 / エラー ${lv.error} 注意 ${lv.warn} 提案 ${lv.suggest} 情報 ${lv.info}`];
    if (c) lines.push(`前の版から: 追加 ${c.added.length} / 削除 ${c.removed.length} / 変更 ${c.changed.length}`);
    if (!out.stamped) lines.push('PSD に版を書き込めなかったので、PSD は保存していません。次の書き出しで「記録がありません」と止まります。この内容を知らせてください。');
    exportMessage(notes.concat(lines).join('\n'), out.stamped ? 'ok' : 'warn');
  } catch (e) {
    exportMessage('書き出し中にエラーが出ました。下の内容をそのまま送ってください。', 'error', [], `${e && e.message}\n\n${e && e.stack}`);
  } finally {
    exporting = false;
    btn.classList.remove('busy'); btn.textContent = '書き出し';
  }
}

// ------------------------------------------------------------------ 確認用の保存
async function saveJson() {
  if (!state) { $('saveMsg').textContent = '先に「解析」してください。'; return; }
  try {
    const { storage } = require('uxp');
    const base = (state.input.source || 'document').replace(/\.[^.]+$/, '');
    const file = await storage.localFileSystem.getFileForSaving(`${base}_analysis.json`, { types: ['json'] });
    if (!file) return;
    const out = Object.assign({}, state.result);
    delete out.raw;
    await file.write(JSON.stringify({ plugin: PLUGIN_VERSION, input: state.input, result: out }, null, 1), { format: storage.formats.utf8 });
    $('saveMsg').textContent = `保存しました: ${file.name}`;
  } catch (e) {
    $('saveMsg').textContent = `保存できませんでした: ${e && e.message}`;
  }
}

// ------------------------------------------------------------------ 読み取りの比較（確認用）
async function compareReaders() {
  const out = $('cmpMsg');
  const show = lines => { clear(out); for (const t of lines) out.appendChild(el('div', 'cmpline', t)); };
  show(['比較中…']);
  try {
    if (!app.activeDocument) { show(['ドキュメントが開かれていません。']); return; }
    const t0 = Date.now(); const fast = await readDocumentFast();
    const t1 = Date.now(); const slow = await readDocumentSlow();
    const t2 = Date.now();
    const diffs = compareReads(fast, slow);
    let n = 0; (function c(ls) { for (const l of ls) { n++; c(l.children); } })(slow.layers);
    const lines = [`まとめて取る方式 ${((t1 - t0) / 1000).toFixed(1)} 秒 / レイヤーごとの方式 ${((t2 - t1) / 1000).toFixed(1)} 秒（${n} レイヤー）`];
    if (diffs.length) { lines.push(`違い ${diffs.length} 件:`); lines.push(...diffs.slice(0, 40)); }
    else lines.push('読み取り結果は一致しました。');
    show(lines);
  } catch (e) {
    show([`比較できませんでした: ${e && e.message}`]);
  }
}

// ------------------------------------------------------------------ タブとボタン
for (const t of document.querySelectorAll('.tab')) {
  t.addEventListener('click', () => {
    const tab = t.getAttribute('data-tab');
    for (const x of document.querySelectorAll('.tab')) { if (x === t) x.classList.add('on'); else x.classList.remove('on'); }
    for (const name of ['issues', 'tree', 'export', 'debug']) {
      if (name === tab) $('pane-' + name).classList.remove('hidden'); else $('pane-' + name).classList.add('hidden');
    }
  });
}
$('btnAnalyze').addEventListener('click', runAnalyze);

// 文字の大きさ（次回も同じ大きさにする）
let fontPx = 18;
try { const v = parseInt(localStorage.getItem('uiexport.fontPx'), 10); if (v >= 10 && v <= 32) fontPx = v; } catch (e) { /* 使えなければ既定 */ }
function applyFont() { document.body.style.fontSize = fontPx + 'px'; try { localStorage.setItem('uiexport.fontPx', String(fontPx)); } catch (e) { /* 無視 */ } }
$('zOut').addEventListener('click', () => { fontPx = Math.max(10, fontPx - 2); applyFont(); });
$('zIn').addEventListener('click', () => { fontPx = Math.min(32, fontPx + 2); applyFont(); });
applyFont();
$('btnSave').addEventListener('click', saveJson);
$('btnCompare').addEventListener('click', compareReaders);
$('btnPickOut').addEventListener('click', pickOutFolder);
$('btnExport').addEventListener('click', () => runExport(false));
restoreOutFolder();
