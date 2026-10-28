import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIANTS } from '../tools/make-manifests.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const manifests = VARIANTS.map((v) => ({ ...v, json: JSON.parse(read(v.file)) }));

test('manifest: 磁盘上的文件与生成脚本一致', () => {
  // 改了 tools/make-manifests.mjs 却忘了跑 npm run manifests，这里会失败
  for (const { file, json, ...fields } of manifests) {
    for (const [k, v] of Object.entries(fields)) {
      assert.equal(json[k], v, `${file} 的 ${k} 与生成脚本不一致，请运行 npm run manifests`);
    }
  }
});

test('manifest: 每份都显式写了 start_url', () => {
  // Chrome 要求显式写 start_url 才允许安装，省略会报 start-url-not-valid
  for (const { file, json } of manifests) {
    assert.equal(typeof json.start_url, 'string', `${file} 必须写 start_url`);
  }
});

test('manifest: 文件名与 start_url 的参数一一对应', () => {
  // index.html 按 manifest[-pk][-green].json 的规则选文件，start_url 必须带着同样的参数
  for (const { file, json } of manifests) {
    const q = new URLSearchParams(json.start_url.split('?')[1] || '');
    const expected = 'manifest' + (q.has('pk') ? '-pk' : '') + (q.has('green') ? '-green' : '') + '.json';
    assert.equal(file, expected);
  }
});

test('manifest: 四种组合的 start_url 与名字各不相同，可以在桌面上并存', () => {
  const uniq = (key) => new Set(manifests.map((m) => m.json[key])).size;
  assert.equal(uniq('start_url'), manifests.length);
  assert.equal(uniq('short_name'), manifests.length);
  for (const { file, json } of manifests) {
    assert.equal('id' in json, false, `${file} 不写 id，让它默认取各自的 start_url`);
  }
});

test('manifest: 安装后全屏且固定横屏，其余字段四份一致', () => {
  const strip = ({ name, short_name, description, start_url, ...rest }) => rest;
  const first = strip(manifests[0].json);
  for (const { file, json } of manifests) {
    assert.equal(json.display, 'fullscreen');
    assert.equal(json.orientation, 'landscape');
    assert.deepEqual(strip(json), first, `${file} 的公共字段与其他几份不一致`);
  }
});

test('Service Worker: 缓存清单包含全部 manifest，且每个文件都存在', () => {
  // cache.addAll 是原子的，任何一项取不到，整个 Service Worker 就装不上，离线彻底失效
  const block = read('sw.js').match(/const ASSETS = \[([\s\S]*?)\];/);
  assert.ok(block, '没能从 sw.js 解析出 ASSETS');
  const assets = block[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  for (const { file } of manifests) {
    assert.ok(assets.includes('./' + file), `缓存清单漏了 ${file}`);
  }
  for (const a of assets) {
    if (a === './') continue;
    assert.ok(existsSync(join(ROOT, a)), `缓存清单里的 ${a} 不存在`);
  }
});

test('Service Worker: 查缓存时忽略地址参数', () => {
  // 不忽略的话，?pk、?green 在缓存里查不到，断网时打不开
  assert.match(read('sw.js'), /caches\.match\([^)]*ignoreSearch:\s*true/);
});
