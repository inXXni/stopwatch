import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
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

// 把 index.html 头部那段选 manifest 的内联脚本取出来，在隔离的上下文里配上假的
// location 与 document 执行，直接验证页面实际使用的规则，而不是在测试里再抄一遍
function runHeadScript(search) {
  const src = read('index.html').match(/<script>([\s\S]*?)<\/script>/)[1];
  const link = { href: './manifest.json' };
  const meta = { content: '秒表' };
  const document = { querySelector: (sel) => (sel.startsWith('link') ? link : meta) };
  runInNewContext(src, { location: { search }, document, URLSearchParams });
  return { manifest: link.href, title: meta.content };
}

test('index.html: 按地址参数选 manifest，PK 模式忽略 green', () => {
  assert.deepEqual(runHeadScript(''), { manifest: './manifest.json', title: '秒表' });
  assert.deepEqual(runHeadScript('?green'), { manifest: './manifest-green.json', title: '秒表 绿' });
  assert.deepEqual(runHeadScript('?pk'), { manifest: './manifest-pk.json', title: 'PK 秒表' });
  assert.deepEqual(runHeadScript('?pk&green'), { manifest: './manifest-pk.json', title: 'PK 秒表' });
});

test('manifest: 从每份的 start_url 打开，页面选回的正是这一份，iPhone 名字与图标名一致', () => {
  for (const { file, json } of manifests) {
    const search = json.start_url.includes('?') ? '?' + json.start_url.split('?')[1] : '';
    const { manifest, title } = runHeadScript(search);
    assert.equal(manifest, './' + file, `${json.start_url} 选到了 ${manifest}`);
    assert.equal(title, json.short_name);
  }
});

test('manifest: PK 模式不再有停表变绿的变体', () => {
  assert.equal(existsSync(join(ROOT, 'manifest-pk-green.json')), false);
});

test('manifest: 各组合的 start_url 与名字各不相同，可以在桌面上并存', () => {
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
  const manifestAssets = assets.filter((a) => /manifest.*\.json$/.test(a)).sort();
  assert.deepEqual(manifestAssets, manifests.map((m) => './' + m.file).sort(),
    '缓存清单里的 manifest 与生成脚本不一致，删掉的变体要从 sw.js 里一起去掉');
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
