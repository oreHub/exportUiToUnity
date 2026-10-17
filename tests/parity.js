// JS 版解析と Python 版の結果を照合する
// 使い方: node parity.js <layers.json> <python_out.json>
const fs = require('fs');
const path = require('path');
const { analyze } = require(path.join(__dirname, '..', 'plugin', 'UIExport', 'core', 'analyze.js'));

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const py = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const js = JSON.parse(JSON.stringify(analyze(input)));
delete js.raw;

const IGNORE = new Set(['layer_id', 'source']);
const diffs = [];
function cmp(a, b, p) {
  if (diffs.length > 40) return;
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 1e-9) diffs.push(`${p}: py=${a} js=${b}`); return; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) diffs.push(`${p}: py=${JSON.stringify(a)} js=${JSON.stringify(b)}`); return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { diffs.push(`${p}: type`); return; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) diffs.push(`${p}: length py=${a.length} js=${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) cmp(a[i], b[i], `${p}[${i}]`);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (IGNORE.has(k)) continue;
    if (!(k in a)) diffs.push(`${p}.${k}: only in js`);
    else if (!(k in b)) diffs.push(`${p}.${k}: only in py`);
    else cmp(a[k], b[k], `${p}.${k}`);
  }
}
cmp(py, js, '');
const lv = {}; for (const i of js.issues) lv[i.level] = (lv[i.level] || 0) + 1;
console.log(`issues js: ${JSON.stringify(lv)}  layouts ${js.layouts.length} prefabs ${js.prefabs.length} spaces ${js.spaces.length}`);
if (diffs.length) { console.log('DIFF:'); diffs.forEach(d => console.log('  ' + d)); process.exit(1); }
console.log('一致');
