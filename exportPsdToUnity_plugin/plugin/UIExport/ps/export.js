/* 書き出しのうち Photoshop とのやり取り（画像・プレビュー・XMP・保存）。判定や組み立ては core/export.js
 *
 * 画像は「部品のレイヤーを新しいドキュメントに複製 → area_ / space_ を隠す → 見えている物を 1 枚に統合 →
 * 枠に合わせて切り抜き → PNG で保存」で作る。元の PSD はレイヤーの選択が変わるだけで、中身は変えない。
 * どれも executeAsModal の中で呼ぶ。
 */
'use strict';
const { app, action, constants } = require('photoshop');
const { storage } = require('uxp');

const docRef = id => ({ _ref: 'document', _id: id });
function toArray(c) { if (!c) return []; const n = c.length || 0; const a = []; for (let i = 0; i < n; i++) a.push(c[i]); return a; }
function allLayers(layers, out = []) { for (const l of toArray(layers)) { out.push(l); if (l.layers) allLayers(l.layers, out); } return out; }
const isGuide = name => name.startsWith('area_') || name.startsWith('space_');

// ------------------------------------------------------------------ XMP（PSD の中の版情報）
async function readXmp(docId) {
  const [r] = await action.batchPlay([{ _obj: 'get', _target: [{ _property: 'XMPMetadataAsUTF8' }, docRef(docId)] }], {});
  return (r && r.XMPMetadataAsUTF8) || '';
}
async function writeXmp(docId, xmp) {
  await action.batchPlay([{
    _obj: 'set', _target: [{ _ref: 'property', _property: 'XMPMetadataAsUTF8' }, docRef(docId)],
    to: { _obj: 'document', XMPMetadataAsUTF8: xmp },
  }], {});
}

// ------------------------------------------------------------------ PNG
async function tempFile(name) {
  const t = await storage.localFileSystem.getTemporaryFolder();
  return t.createFile(name, { overwrite: true });
}
// RGB・8bit にそろえて、PNG のバイト列を返す
async function pngBytes(doc) {
  if (constants.DocumentMode && doc.mode !== constants.DocumentMode.RGB) await doc.changeMode(constants.ChangeMode.RGB);
  if (constants.BitsPerChannelType && doc.bitsPerChannel !== constants.BitsPerChannelType.EIGHT) doc.bitsPerChannel = constants.BitsPerChannelType.EIGHT;
  const f = await tempFile('uiexport_tmp.png');
  await doc.saveAs.png(f, { compression: 6 }, true);
  return new Uint8Array(await f.read({ format: storage.formats.binary }));
}

function boundsOf(l) {
  const b = l.bounds;
  return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) };
}

/* 1 つの部品の画像。plan(rect) で最終的な範囲（枠に合わせた範囲）を決める
 * 戻り値: { png, rect, over } / 絵が無ければ null */
async function renderLayer(src, layerId, frame, plan) {
  app.activeDocument = src;
  await action.batchPlay([
    { _obj: 'select', _target: [{ _ref: 'layer', _id: layerId }], makeVisible: false },
    { _obj: 'make', _target: [{ _ref: 'document' }], name: 'UIExport_tmp', using: { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' } },
  ], {});
  const tmp = app.activeDocument;
  if (tmp.id === src.id) throw new Error('部品を新しいドキュメントに複製できませんでした');
  try {
    // キャンバスの外にはみ出す絵（効果を含む）や枠も切れないように、周りを広げておく
    const top = tmp.layers[0];
    const b0 = boundsOf(top);
    const W = Math.round(Number(tmp.width)), H = Math.round(Number(tmp.height));
    let need = Math.max(0, -b0.left, -b0.top, b0.right - W, b0.bottom - H);
    if (frame) need = Math.max(need, -frame[0], -frame[1], frame[0] + frame[2] - W, frame[1] + frame[3] - H);
    let dx = 0, dy = 0;
    if (need > 0) {
      const P = need + 4;
      await tmp.resizeCanvas(W + 2 * P, H + 2 * P, constants.AnchorPosition.MIDDLECENTER);
      const b1 = boundsOf(tmp.layers[0]);
      dx = b1.left - b0.left; dy = b1.top - b0.top;
    }
    // area_ / space_ を隠して、見えている物を 1 枚にする（空のレイヤーを足して、統合が必ずできるようにする）
    for (const l of allLayers(tmp.layers)) if (isGuide(l.name) && l.visible) l.visible = false;
    await tmp.createLayer({ name: 'UIExport_empty' });
    await action.batchPlay([{ _obj: 'mergeVisible' }], {});
    const merged = (tmp.activeLayers && tmp.activeLayers[0]) || toArray(tmp.layers).find(l => l.visible);
    const b = merged ? boundsOf(merged) : null;
    if (!b || b.right <= b.left || b.bottom <= b.top) return null;
    for (const l of toArray(tmp.layers)) if (l.id !== merged.id) await l.delete();

    const content = [b.left - dx, b.top - dy, b.right - b.left, b.bottom - b.top];
    const { rect, over } = plan(content);
    await tmp.crop({ left: rect[0] + dx, top: rect[1] + dy, right: rect[0] + rect[2] + dx, bottom: rect[1] + rect[3] + dy });
    if (Math.round(Number(tmp.width)) !== rect[2] || Math.round(Number(tmp.height)) !== rect[3])
      throw new Error(`切り抜いた大きさが想定と違う（${tmp.width}×${tmp.height} / ${rect[2]}×${rect[3]}）`);
    return { png: await pngBytes(tmp), rect, over };
  } finally {
    await tmp.closeWithoutSaving();
    app.activeDocument = src;
  }
}

// 画面全体（area_ / space_ を除く）
async function renderPreview(src) {
  app.activeDocument = src;
  const d = await src.duplicate('UIExport_preview');
  try {
    for (const l of allLayers(d.layers)) if (isGuide(l.name) && l.visible) l.visible = false;
    await d.flatten();
    return await pngBytes(d);
  } finally {
    await d.closeWithoutSaving();
    app.activeDocument = src;
  }
}

// 書き出しの前に選んでいたレイヤーに戻す
function selectedIds(doc) { return toArray(doc.activeLayers).map(l => l.id); }
async function restoreSelection(doc, ids) {
  if (!ids.length) return;
  app.activeDocument = doc;
  await action.batchPlay(ids.map((id, k) => Object.assign(
    { _obj: 'select', _target: [{ _ref: 'layer', _id: id }], makeVisible: false },
    k ? { selectionModifier: { _enum: 'selectionModifierType', _value: 'addToSelection' } } : {})), {});
}

module.exports = { readXmp, writeXmp, renderLayer, renderPreview, selectedIds, restoreSelection };
