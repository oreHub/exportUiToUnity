// 仮の Photoshop（layers.json から作る）でパネルを動かす
// 使い方: node mock_panel.js <layers.json>
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { JSDOM } = require('jsdom');

const PLUGIN = path.join(__dirname, '..', 'plugin', 'UIExport');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// layers.json -> Photoshop DOM 風（layers は上から順、bounds、opacity 0-100）
let nextId = 1;
const descs = new Map();
function fake(n) {
  const id = nextId++;
  const [l, t, w, h] = n.bbox;
  const kind = n.group ? 'group' : n.text ? 'text' : 'pixel';
  const layer = { id, name: n.name, kind, visible: n.visible, opacity: Math.round(n.opacity * 100),
    boundsNoEffects: { left: l, top: t, right: l + w, bottom: t + h } };
  if (n.group) {
    const kids = n.children.map(fake).reverse();
    layer.layers = { length: kids.length }; kids.forEach((k, i) => { layer.layers[i] = k; });
  }
  const d = {};
  if (n.has_fx) { d.layerEffects = { dropShadow: {} }; d.layerFXVisible = true; }
  if (n.text && n.text_info) {
    const ti = n.text_info, c = ti.color || '#FFFFFF';
    d.textKey = { textKey: (ti.content || '').replace(/\n/g, '\r'),
      textStyleRange: [{ textStyle: { size: { _unit: 'pointsUnit', _value: ti.size || 12 }, fontPostScriptName: ti.font,
        color: { red: parseInt(c.slice(1, 3), 16), grain: parseInt(c.slice(3, 5), 16), blue: parseInt(c.slice(5, 7), 16) } } }],
      paragraphStyleRange: [{ paragraphStyle: { align: { _value: ti.align || 'left' } } }] };
  }
  descs.set(id, d);
  flatInfo.push({ n, id, kids: layer.layers, layer });
  return layer;
}
const flatInfo = [];
const top = data.layers.map(fake).reverse();
const doc = { id: 99, name: data.source || 'mock.psd', width: data.canvas[0], height: data.canvas[1], resolution: 72, layers: { length: top.length } };
top.forEach((k, i) => { doc.layers[i] = k; });
const selected = []; const renamed = [];
// multiGet: 下から順の一覧（グループは始まり（上）と終わり（下）の印）
function multiList() {
  const out = [];
  function emit(n, layer) {           // 上から順に出してから最後に反転
    const d = descs.get(layer.id) || {};
    const [l, t, w, h] = n.bbox;
    const item = Object.assign({ name: n.name, layerID: layer.id, visible: n.visible, opacity: Math.round(n.opacity * 255),
      boundsNoEffects: { left: { _value: l }, top: { _value: t }, right: { _value: l + w }, bottom: { _value: t + h } },
      layerKind: n.group ? 7 : n.text ? 3 : 4 }, d);
    if (n.group) {
      item.layerSection = { _value: 'layerSectionStart' };
      out.push(item);
      const kids = []; for (let i = 0; i < layer.layers.length; i++) kids.push(layer.layers[i]);
      kids.forEach((k, i) => emit(n.children[n.children.length - 1 - i], k));
      out.push({ name: '</Layer group>', layerSection: { _value: 'layerSectionEnd' } });
    } else { item.layerSection = { _value: 'layerSectionContent' }; out.push(item); }
  }
  for (let i = 0; i < top.length; i++) emit(data.layers[data.layers.length - 1 - i], top[i]);
  return out.reverse();
}
const photoshop = {
  app: { activeDocument: doc },
  constants: { LayerKind: { GROUP: 'group', TEXT: 'text' } },
  action: { batchPlay: async (cmds) => cmds.map(c => {
    if (c._obj === 'get' && c._target[0]._property === 'hasBackgroundLayer') return { hasBackgroundLayer: false };
    if (c._obj === 'get' && c._target[0]._property === 'name') { const f = flatInfo.find(x => x.id === c._target[1]._id); return { name: f.n.name }; }
    if (c._obj === 'set' && c.to && c.to.name) { const f = flatInfo.find(x => x.id === c._target[0]._id); renamed.push([f.n.name, c.to.name]); f.n.name = c.to.name; f.layer.name = c.to.name; return {}; }
    if (c._obj === 'get' && c._target[0]._property === 'boundsNoEffects') {
      const f = flatInfo.find(x => x.id === c._target[1]._id); const [l, t, w, h] = f.n.bbox;
      return { boundsNoEffects: { left: { _value: l }, top: { _value: t }, right: { _value: l + w }, bottom: { _value: t + h } } };
    }
    if (c._obj === 'multiGet') { if (process.env.NO_MULTIGET) throw new Error('multiGet unsupported (mock)'); return { list: multiList() }; }
    if (c._obj === 'get') return descs.get(c._target[0]._id);
    if (c._obj === 'select') { selected.push(c._target[0]._id); return {}; }
    return {};
  }) },
  core: { executeAsModal: async (fn) => fn({ hostControl: { suspendHistory: async () => 1, resumeHistory: async () => {} } }) },
};

const html = fs.readFileSync(path.join(PLUGIN, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/, '');
const dom = new JSDOM(html);
global.document = dom.window.document;
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'photoshop') return photoshop;
  if (req === 'uxp') return { storage: {} };
  if (req.startsWith('./')) return origLoad(path.join(PLUGIN, req), parent, isMain);
  return origLoad(req, parent, isMain);
};
require(path.join(PLUGIN, 'main.js'));

(async () => {
  document.getElementById('btnAnalyze').dispatchEvent(new dom.window.Event('click'));
  await new Promise(r => setTimeout(r, 200));
  const $ = id => document.getElementById(id);
  console.log('docInfo:', $('docInfo').textContent, '|', $('docInfo').title);
  console.log('msg:', $('msg').className, $('msg').textContent.slice(0, 300));
  console.log('counts:', [...$('counts').children].map(c => c.textContent).join(' | '));
  const issues = $('pane-issues').querySelectorAll('.issue');
  console.log('issues shown:', issues.length);
  issues.forEach(i => {
    const t = i.querySelector('.text').cloneNode(true);
    t.querySelectorAll('.ref').forEach(r => r.replaceWith(dom.window.document.createTextNode('[' + r.textContent + ']')));
    const pth = i.querySelector('.paths');
    console.log('  -', i.querySelector('.lv').textContent, '|', t.textContent.slice(0, 200), pth ? ' || ' + pth.textContent : '');
  });
  const nodes = $('pane-tree').querySelectorAll('.node');
  console.log('tree rows:', nodes.length);
  [...nodes].slice(0, 60).forEach(n => console.log('  ' + ' '.repeat((parseInt(n.style.paddingLeft) - 4) / 7) + n.textContent));
  // クリックで選択
  document.querySelector('#pane-issues .ref').dispatchEvent(new dom.window.Event('click'));
  nodes[3].dispatchEvent(new dom.window.Event('click'));
  await new Promise(r => setTimeout(r, 50));
  console.log('selected ids:', selected, 'msg:', $('msg').textContent);
  // 絞り込みとタブ
  $('counts').children[3].dispatchEvent(new dom.window.Event('click'));
  console.log('after info toggle:', $('pane-issues').querySelectorAll('.issue').length);
  document.querySelector('.tab[data-tab="tree"]').dispatchEvent(new dom.window.Event('click'));
  console.log('tree hidden?', $('pane-tree').className, 'issues', $('pane-issues').className);
  $('btnCompare').dispatchEvent(new dom.window.Event('click'));
  await new Promise(r => setTimeout(r, 100));
  console.log('compare:', $('cmpMsg').textContent.slice(0, 120));
  // 修正ボタン
  const btns = [...document.querySelectorAll('#pane-issues .fbtn')];
  console.log('fix buttons:', btns.length, btns.slice(0, 4).map(b => b.textContent));
  if (btns.length) {
    btns[0].dispatchEvent(new dom.window.Event('click'));
    await new Promise(r => setTimeout(r, 200));
    console.log('renamed:', JSON.stringify(renamed));
    console.log('after fix msg:', $('msg').className, $('msg').textContent.slice(0, 150));
    console.log('counts:', [...$('counts').children].map(c => c.textContent).join(' | '));
    console.log('fix buttons now:', document.querySelectorAll('#pane-issues .fbtn').length);
  }
})();
