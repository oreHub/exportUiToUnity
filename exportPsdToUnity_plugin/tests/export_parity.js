// JS 版の書き出し（core/export.js）と Python 版（tools/export_ui.py）の結果を照合する
// 使い方: node export_parity.js <layers.json> <export_ref.py の出力> <other.py.json>
// 画像そのものは Photoshop が作るので、Python 版が切り出した範囲とハッシュを「仮の Photoshop」として渡す
const fs = require('fs');
const path = require('path');
const PLUGIN = path.join(__dirname, '..', 'plugin', 'UIExport');
const { analyze } = require(path.join(PLUGIN, 'core', 'analyze.js'));
const X = require(path.join(PLUGIN, 'core', 'export.js'));

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ref = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const other = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

function cmp(a, b, p, out, ignore = new Set()) {
  if (out.length > 40) return;
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 1e-9) out.push(`${p}: py=${a} js=${b}`); return; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${p}: py=${JSON.stringify(a)} js=${JSON.stringify(b)}`); return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${p}: type`); return; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${p}: length py=${a.length} js=${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) cmp(a[i], b[i], `${p}[${i}]`, out, ignore);
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (ignore.has(k)) continue;
    if (!(k in a)) out.push(`${p}.${k}: only in js`);
    else if (!(k in b)) out.push(`${p}.${k}: only in py`);
    else cmp(a[k], b[k], `${p}.${k}`, out, ignore);
  }
}

(async () => {
  // 1. 画像・layout.json・history.json
  (function addIds(ls, parent) { for (const l of ls) { l.layer_id = parent ? `${parent}/${l.name}` : l.name; addIds(l.children || [], l.layer_id); } })(input.layers, '');
  const a = analyze(input);
  const pyImages = [];
  (function walk(n) {
    if (n.role === 'image' && 'image' in n) pyImages.push(n.image);
    if (n.base_image && 'image' in n.base_image) pyImages.push(n.base_image.image);
    n.children.forEach(walk);
  })(ref.layout.tree);
  check(pyImages.length === ref.renders.length, `画像の数 py=${ref.renders.length} 記録=${pyImages.length}`);
  let k = 0;
  const render = async (lid, frame) => {
    const raw = ref.renders[k], img = pyImages[k]; k++;
    if (!raw) return null;
    const { rect, over } = frame ? X.fitFrame(raw, frame) : { rect: raw, over: null };
    return { png: Buffer.from(img.hash), rect, over };
  };
  const files = await X.exportImages(a.tree, a.issues, render, { hashOf: b => b.toString() });
  check(k === ref.renders.length, `画像を作った回数 py=${ref.renders.length} js=${k}`);
  const L = ref.layout;
  const layout = JSON.parse(JSON.stringify(X.buildLayout({ analysis: a, screen: L.screen, version: L.version, base: L.base_version,
    psdFile: L.psd_file, exportedAt: L.exported_at, toolVersion: L.tool_version, imageCount: files.size })));
  const d = [];
  cmp(L, layout, '', d, new Set(['layer_id']));
  check(!d.length, 'layout.json が違う:\n    ' + d.join('\n    '));
  const h = []; cmp(ref.history[ref.history.length - 1], JSON.parse(JSON.stringify(X.historyEntry(layout, null))), '', h);
  check(!h.length, 'history.json が違う:\n    ' + h.join('\n    '));

  // 2. レポート（ひな形にデータが入るか。$ を含む文字も壊れないか）
  const tpl = fs.readFileSync(path.join(PLUGIN, 'report_template.html'), 'utf8');
  const rep = X.buildReport(tpl, Object.assign({}, layout, { note: "$& $' </script>" }), null, ref.history);
  const m = rep.match(/const DATA = (.*);\n/);
  check(m && JSON.parse(m[1].replace(/<\\\//g, '</')).note === "$& $' </script>", 'レポートのデータの埋め込み');
  check(!rep.includes('__IMG__') && !rep.includes('/*__DATA__*/'), 'レポートの置き換え忘れ');

  // 3. XMP
  check(X.writeStamp(ref.xmp_in, 'Home', '261017-2') === ref.xmp_out, 'XMP の書き込みが Python 版と違う');
  check(X.writeStamp(X.writeStamp(ref.xmp_in, 'Home', '261017-1'), 'Shop', '261017-3') === ref.xmp_twice, 'XMP の 2 回目の書き込み');
  check(X.writeStamp('', 'Home', '261017-1') === ref.xmp_empty, 'XMP が空のとき');
  const st = X.readStamp(ref.xmp_twice);
  check(st.ScreenId === 'Shop' && st.BaseVersion === '261017-3', `XMP の読み取り ${JSON.stringify(st)}`);
  // Photoshop が要素の形に書き直した場合も、前の記録を消して読み直せる
  const clean = ref.xmp_in.replace(/\s*<rdf:Description rdf:about=""\s+xmlns:uiexp="[^"]*"[^>]*\/>/g, '');
  check(!clean.includes('uiexp:'), 'サンプルの XMP に想定外の形の記録がある');
  const elem = clean.replace('</rdf:RDF>', '<rdf:Description rdf:about="" xmlns:uiexp="x"><uiexp:ScreenId>Old</uiexp:ScreenId><uiexp:BaseVersion>1</uiexp:BaseVersion></rdf:Description></rdf:RDF>');
  check(X.readStamp(elem).ScreenId === 'Old', 'XMP（要素の形）の読み取り');
  const re = X.readStamp(X.writeStamp(elem, 'Home', '261017-5'));
  check(re.ScreenId === 'Home' && re.BaseVersion === '261017-5', `XMP（要素の形）の書き直し ${JSON.stringify(re)}`);

  // 4. 版の判定
  const H = [{ version: '261016-1' }, { version: '261017-1' }];
  check(!X.checkVersion({}, []).stop, '初回は止めない');
  check(!X.checkVersion({ BaseVersion: '261017-1' }, H).stop, '最新から書き出すときは止めない');
  check(X.checkVersion({}, H).stop, '記録の無い PSD は止める');
  check(X.checkVersion({ BaseVersion: '261016-1' }, H).stop, '古い PSD は止める');
  check(X.nextVersion(H, '261017') === '261017-2' && X.nextVersion(H, '261018') === '261018-1', '次の版の番号');

  // 5. 差分・ハッシュ
  const dd = []; cmp(ref.diff, X.diff(ref.layout.tree, other.tree), '', dd);
  check(!dd.length, '差分が違う:\n    ' + dd.join('\n    '));
  check(X.sha1Hex(Buffer.from('abc')) === ref.sha1.abc && X.sha1Hex(new Uint8Array(0)) === ref.sha1.empty, 'SHA-1');
  const pat = new Uint8Array(1280); for (let i = 0; i < pat.length; i++) pat[i] = i % 256;
  check(X.sha1Hex(pat) === ref.sha1.pattern, 'SHA-1（長いデータ）');
  const png = s => new Uint8Array(Buffer.from(ref.png[s], 'base64'));
  check(X.imageHash(png('a')) === X.imageHash(png('a_meta')), '同じ絵でメタデータが違う PNG は同じとみなす');
  check(X.imageHash(png('a')) !== X.imageHash(png('b')), '違う絵は別とみなす');

  console.log(`images ${files.size}  renders ${k}  issues ${JSON.stringify(X.issueCounts(layout.issues))}`);
  if (fails.length) { console.log('NG:'); fails.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log('一致');
})().catch(e => { console.log('NG: ' + (e && e.stack)); process.exit(1); });
