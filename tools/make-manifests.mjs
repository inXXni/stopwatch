// 生成三份 manifest：普通 / 停表变绿 / PK。PK 模式不区分停表变绿（红蓝是阵营色）。
// 用法：npm run manifests
//
// 为什么要按参数各一份：安装到桌面的图标总是打开 manifest 里写的 start_url，
// 只有一份的话，从 ?pk 页面装出来的图标打开的也是普通模式，参数会丢；
// 而且 id 默认取 start_url，几种参数会被当成同一个应用，只能装一个。
//
// 为什么不干脆省略 start_url 让它跟随安装时的地址：Chrome 要求 manifest
// 显式写出 start_url 才允许安装，省略会报 start-url-not-valid。

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const BASE = {
  scope: './',
  display: 'fullscreen',
  display_override: ['fullscreen', 'standalone'],
  orientation: 'landscape',
  background_color: '#000000',
  theme_color: '#000000',
  icons: [
    { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

// 文件名规则与 index.html 里选用 manifest 的那段脚本一致：manifest[-green].json，PK 一律 manifest-pk.json
// short_name 显示在桌面图标下面，也与 index.html 里给 iPhone 设的名字一致。
export const VARIANTS = [
  {
    file: 'manifest.json',
    start_url: './',
    name: '手拍秒表',
    short_name: '秒表',
    description: '魔方速拧比赛现场用的全屏大字手拍秒表',
  },
  {
    file: 'manifest-green.json',
    start_url: './?green',
    name: '手拍秒表（停表变绿）',
    short_name: '秒表 绿',
    description: '魔方速拧比赛现场用的全屏大字手拍秒表，停表后数字变绿',
  },
  {
    file: 'manifest-pk.json',
    start_url: './?pk',
    name: 'PK 秒表',
    short_name: 'PK 秒表',
    description: '双人 PK 模式：上下两格依次计时，并排比对成绩',
  },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { file, ...fields } of VARIANTS) {
    const manifest = { ...fields, ...BASE };
    writeFileSync(join(OUT_DIR, file), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`wrote ${file}  start_url=${fields.start_url}  short_name=${fields.short_name}`);
  }
}
