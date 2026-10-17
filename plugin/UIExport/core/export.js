/* 書き出しのうち Photoshop に依存しない部分（tools/export_ui.py と同じ結果にする）
 *
 * 版の判定、XMP の版情報、画像の名前と枠、前の版との差分、layout.json / history.json / report.html の組み立て。
 * 画像そのものは Photoshop 側（ps/export.js）が作り、render(layerId, frame) で受け取る。
 * UXP ではモジュールから別モジュールを相対パスで require できないので、必要なものはここに持つ。
 */
'use strict';

const NS = 'http://example.com/ns/uiexport/1.0/';     // 社内で決めた名前空間に置き換える（tools/export_ui.py と同時に）
const LEVEL_ORDER = { error: 0, warn: 1, suggest: 2, info: 3 };
const SCREEN_ID = /^[A-Za-z0-9_-]+$/;

// ------------------------------------------------------------------ PSD の中の版情報（XMP）
function readStamp(xmp) {
  const out = {};
  if (!xmp) return out;
  for (const k of ['ScreenId', 'BaseVersion']) {
    const m = xmp.match(new RegExp(`uiexp:${k}="([^"]*)"`)) || xmp.match(new RegExp(`<uiexp:${k}>([^<]*)</uiexp:${k}>`));
    if (m) out[k] = m[1];
  }
  return out;
}

const EMPTY_XMP = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
  '   <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n   </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>';

function writeStamp(xmp, screen, version) {
  let x = xmp || '';
  // 前の記録を消す（自分で足した行、Photoshop が書き直した属性の形・要素の形）
  x = x.replace(/\s*<rdf:Description rdf:about=""\s+xmlns:uiexp="[^"]*"[^>]*\/>/g, '');
  x = x.replace(/\s+uiexp:(ScreenId|BaseVersion)="[^"]*"/g, '');
  x = x.replace(/\s*<uiexp:(ScreenId|BaseVersion)>[^<]*<\/uiexp:\1>/g, '');
  if (!x.includes('</rdf:RDF>')) x = EMPTY_XMP;
  const desc = `\n      <rdf:Description rdf:about="" xmlns:uiexp="${NS}" uiexp:ScreenId="${screen}" uiexp:BaseVersion="${version}"/>`;
  return x.replace('</rdf:RDF>', () => desc + '\n   </rdf:RDF>');
}

// ------------------------------------------------------------------ 版の照合
function checkVersion(stamp, history) {
  const latest = history.length ? history[history.length - 1].version : null;
  const base = stamp.BaseVersion === undefined ? null : stamp.BaseVersion;
  if (!latest || base === latest) return { stop: false, latest, base };
  let message;
  if (base === null) message = 'この PSD には書き出しの記録がありません（新しく作り直した PSD など）。';
  else if (base < latest) message = `この PSD は版 ${base} を元にしていますが、フォルダには新しい版 ${latest} があります（古いバックアップや別案の可能性）。`;
  else message = `この PSD の元にした版 ${base} が、フォルダの最新 ${latest} より新しくなっています。`;
  return { stop: true, latest, base, message };
}

function nextVersion(history, today) {
  const n = history.filter(h => h.version.startsWith(today + '-')).length + 1;
  return `${today}-${n}`;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function today(d) { return pad2(d.getFullYear() % 100) + pad2(d.getMonth() + 1) + pad2(d.getDate()); }
function isoLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// ------------------------------------------------------------------ 画像
function imageName(unityPath) { return 'images/' + unityPath.replace(/[^A-Za-z0-9_.\-]/g, '_') + '.png'; }

// 枠（area_）の大きさにする。絵は PSD の位置のまま、周りは透明。はみ出す場合は切らずに広げ、はみ出した量を返す
function fitFrame(rect, frame) {
  const [fl, ft, fw, fh] = frame;
  const L = Math.min(fl, rect[0]), T = Math.min(ft, rect[1]);
  const R = Math.max(fl + fw, rect[0] + rect[2]), B = Math.max(ft + fh, rect[1] + rect[3]);
  return { rect: [L, T, R - L, B - T], over: [fl - L, ft - T, R - fl - fw, B - ft - fh] };
}

// 同じ絵かどうかは PNG の画素の部分（IHDR・PLTE・tRNS・IDAT）で比べる。日時などのメタデータは含めない
const PIXEL_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT']);
function pngPixelBytes(png) {
  const parts = []; let size = 0, p = 8;
  while (p + 8 <= png.length) {
    const len = ((png[p] << 24) >>> 0) + (png[p + 1] << 16) + (png[p + 2] << 8) + png[p + 3];
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    if (PIXEL_CHUNKS.has(type)) { const c = png.subarray(p + 4, p + 8 + len); parts.push(c); size += c.length; }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const out = new Uint8Array(size); let o = 0;
  for (const c of parts) { out.set(c, o); o += c.length; }
  return out;
}

function sha1Hex(bytes) {
  const ml = bytes.length, total = ((ml + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total); m.set(bytes); m[ml] = 0x80;
  const bits = ml * 8;
  m[total - 4] = (bits >>> 24) & 255; m[total - 3] = (bits >>> 16) & 255; m[total - 2] = (bits >>> 8) & 255; m[total - 1] = bits & 255;
  m[total - 8] = Math.floor(bits / 2 ** 32) & 255;
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Int32Array(80);
  for (let i = 0; i < total; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = (m[i + j * 4] << 24) | (m[i + j * 4 + 1] << 16) | (m[i + j * 4 + 2] << 8) | m[i + j * 4 + 3];
    for (let j = 16; j < 80; j++) { const x = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]; w[j] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      const f = j < 20 ? ((b & c) | (~b & d)) + 0x5A827999 : j < 40 ? (b ^ c ^ d) + 0x6ED9EBA1
        : j < 60 ? ((b & c) | (b & d) | (c & d)) + 0x8F1BBCDC : (b ^ c ^ d) + 0xCA62C1D6;
      const t = (((a << 5) | (a >>> 27)) + f + e + w[j]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

function imageHash(png) { return sha1Hex(pngPixelBytes(png)).slice(0, 12); }

// 問題を足す（解析と同じく、同じ種類・同じ文の問題は対象だけを足す）
function addIssue(issues, level, code, msg, path) {
  const same = issues.find(i => i.code === code && i.message === msg);
  if (same) { if (path && !same.paths.includes(path)) same.paths.push(path); return; }
  issues.push({ level, code, message: msg, paths: path ? [path] : [] });
}
function sortIssues(issues) { issues.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]); }

/* 部品ごとの画像を作り、tree の image / base_image.image に記録する。同じ絵は 1 つのファイルを共有する。
 * render(layerId, frame) -> { png: Uint8Array, rect: [x, y, w, h], over: [左, 上, 右, 下] | null } | null（絵が無い）
 * 戻り値: Map（ファイル名 -> PNG） */
async function exportImages(tree, issues, render, opts = {}) {
  const hashOf = opts.hashOf || imageHash;
  const progress = opts.progress || (() => {});
  const seen = new Map(), files = new Map();
  let total = 0, done = 0;
  (function count(n) { if (n.role === 'image' && n.layer_id !== undefined) total++; if (n.base_image && n.base_image.layer_id !== undefined) total++; n.children.forEach(count); })(tree);

  async function save(layerId, unityPath, frame, frameFrom, name, path) {
    progress(done++, total, name);
    const r = await render(layerId, frame || null);
    if (!r) return null;
    if (frame && r.over && r.over.some(v => v))
      addIssue(issues, 'warn', 'frame_overflow', `${name}: 絵（レイヤースタイル込み）が枠 ${frameFrom} の外にはみ出している` +
        `（左 ${r.over[0]} 上 ${r.over[1]} 右 ${r.over[2]} 下 ${r.over[3]}px）。枠を広げるか、_Fx で効果を分ける`, path);
    const h = hashOf(r.png);
    if (seen.has(h)) return { file: seen.get(h), hash: h, rect: r.rect, shared: true };
    const file = imageName(unityPath);
    seen.set(h, file); files.set(file, r.png);
    return { file, hash: h, rect: r.rect, shared: false };
  }

  async function walk(n, upath) {
    let up = upath ? `${upath}.${n.unity.name}` : n.unity.name;
    if (n.role === 'root') up = '';
    if (n.role === 'image' && n.layer_id !== undefined)
      n.image = await save(n.layer_id, up, n.frame, n.frame_from, n.name, n.path);
    if (n.base_image && n.base_image.layer_id !== undefined) {
      const bi = n.base_image;
      bi.image = await save(bi.layer_id, up + '.Base', bi.frame, bi.frame_from, bi.name, bi.path);
    }
    for (const c of n.children) await walk(c, up);
  }
  await walk(tree, '');
  sortIssues(issues);
  return files;
}

// ------------------------------------------------------------------ 前の版との差分
function flatten(tree) {
  const out = new Map();
  const nz = v => (v === undefined ? null : v);
  (function walk(n, up) {
    let p = up ? `${up}/${n.unity.name}` : n.unity.name;
    if (n.role === 'root') p = '';
    else out.set(p, {
      role: nz(n.role), rect: nz(n.rect), image: nz((n.image || {}).hash),
      base: nz(((n.base_image || {}).image || {}).hash), text: nz((n.text || {}).content),
      components: nz(n.unity.components),
    });
    for (const c of n.children) walk(c, p);
  })(tree, '');
  return out;
}

const LABEL = { role: '種類', rect: '位置・大きさ', image: '画像', base: '自身の画像', text: '文字', components: 'コンポーネント' };
const byCode = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

function diff(prev, cur) {
  const a = flatten(prev), b = flatten(cur);
  const added = [...b.keys()].filter(k => !a.has(k)).sort(byCode);
  const removed = [...a.keys()].filter(k => !b.has(k)).sort(byCode);
  const changed = [];
  for (const k of [...a.keys()].filter(k => b.has(k)).sort(byCode)) {
    const f = Object.keys(LABEL).filter(x => JSON.stringify(a.get(k)[x]) !== JSON.stringify(b.get(k)[x])).map(x => LABEL[x]);
    if (f.length) changed.push({ path: k, fields: f });
  }
  return { added, removed, changed };
}
function isEmptyDiff(c) { return !(c.added.length || c.removed.length || c.changed.length); }

// ------------------------------------------------------------------ layout.json / history.json
function fontList(tree) {
  const keys = new Map();
  (function walk(n) {
    if (n.role === 'text' && n.text) {
      const f = n.text.font === undefined ? null : n.text.font, s = n.text.size === undefined ? null : n.text.size;
      keys.set(JSON.stringify([f, s]), [f, s]);
    }
    n.children.forEach(walk);
  })(tree);
  const str = v => (v === null ? 'None' : String(v));
  return [...keys.values()]
    .sort((x, y) => byCode(str(x[0]), str(y[0])) || ((x[1] || 0) - (y[1] || 0)))
    .map(([font, size]) => ({ font, size }));
}

function buildLayout({ analysis, screen, version, base, psdFile, exportedAt, toolVersion, imageCount }) {
  return {
    screen, version, base_version: base, psd_file: psdFile, exported_at: exportedAt, tool_version: toolVersion,
    source: psdFile, canvas: analysis.canvas, rules: analysis.rules, fonts: fontList(analysis.tree),
    images: { count: imageCount },
    tree: analysis.tree, layouts: analysis.layouts, prefabs: analysis.prefabs, spaces: analysis.spaces,
    flattened: analysis.flattened, issues: analysis.issues,
  };
}

function issueCounts(issues) {
  const lv = { error: 0, warn: 0, suggest: 0, info: 0 };
  for (const i of issues) lv[i.level] += 1;
  return lv;
}

function historyEntry(layout, changes) {
  return {
    version: layout.version, exported_at: layout.exported_at, psd_file: layout.psd_file, base_version: layout.base_version,
    issues: issueCounts(layout.issues), images: layout.images.count,
    changes: changes === null ? null : { added: changes.added.length, removed: changes.removed.length, changed: changes.changed.length },
  };
}

// ------------------------------------------------------------------ レポート（ひな形にデータを埋め込む）
function buildReport(template, layout, changes, history) {
  const dump = x => JSON.stringify(x).replace(/<\//g, '<\\/');
  return template
    .replace('/*__DATA__*/null', () => dump(layout))
    .replace('/*__CHANGES__*/null', () => dump(changes))
    .replace('/*__HISTORY__*/null', () => dump(history))
    .split('__IMG__').join('preview.png');
}

module.exports = {
  NS, SCREEN_ID, readStamp, writeStamp, checkVersion, nextVersion, today, isoLocal,
  imageName, fitFrame, pngPixelBytes, sha1Hex, imageHash, exportImages, addIssue,
  flatten, diff, isEmptyDiff, fontList, buildLayout, issueCounts, historyEntry, buildReport,
};
