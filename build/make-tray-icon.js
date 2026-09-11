#!/usr/bin/env node
/* ============================================================
 * build/make-tray-icon.js · 生成 macOS 菜单栏模板图标
 * ------------------------------------------------------------
 * macOS 的菜单栏图标必须是**单色模板图**：系统只看 alpha 通道当形状，
 * 再按浅色/深色菜单栏自动反色（nativeImage.setTemplateImage(true)）。
 * 直接把 assets/icon.png 那张彩色应用图标缩到 16px 塞进菜单栏，
 * 在深色模式下观感是错的，Retina 下也会糊。
 *
 * 这里按应用图标的造型（三根圆头竖条，中间最高）重绘成纯黑 + alpha 的形状，
 * 用 8 倍超采样再盒式降采样得到抗锯齿边缘，产出：
 *   assets/trayTemplate.png      16×16
 *   assets/trayTemplate@2x.png   32×32   （Electron 会按文件名自动配对 @2x）
 *
 * 用法：node build/make-tray-icon.js
 * 零依赖：PNG 编码只用 Node 内置 zlib，不需要任何图形库。
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSETS = path.join(__dirname, '..', 'assets');

/* 造型取自 assets/icon.png：三根圆头竖条，间距均匀，
   左短而偏下、中间最高、右中等偏高。坐标都是画布尺寸的比例。
   16px 下每根条只有 3px 宽，所以宽度取统一值，靠高度与垂直位置区分。 */
const BARS = [
  { cx: 0.28, w: 0.17, h: 0.30, cy: 0.570 },  // 左：最短，位置偏下
  { cx: 0.50, w: 0.17, h: 0.57, cy: 0.520 },  // 中：最高
  { cx: 0.72, w: 0.17, h: 0.38, cy: 0.490 }   // 右：中等
];

const SUPERSAMPLE = 8;   // 超采样倍数：8×8 盒式降采样 → 每像素 65 级覆盖率

/* ---------------- 光栅化 ---------------- */
// 圆角矩形的有符号距离场：<=0 表示点在形状内
function sdRoundedRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/* 返回 size×size 的 alpha 数组（0–255）。RGB 恒为 0（模板图只看 alpha）。 */
function renderAlpha(size) {
  const S = size * SUPERSAMPLE;
  const acc = new Float64Array(size * size);
  // 每根条的半宽/半高/圆角半径（超采样坐标系）
  const bars = BARS.map((b) => {
    const hw = (b.w * S) / 2;
    const hh = (b.h * S) / 2;
    return {
      cx: b.cx * S,
      cy: b.cy * S,
      hw: hw,
      hh: hh,
      r: Math.min(hw, hh)   // 圆角取满 → 圆头（胶囊）
    };
  });

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 点在形状内（任一根条覆盖即可）
      let inside = false;
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        if (sdRoundedRect(x + 0.5, y + 0.5, b.cx, b.cy, b.hw, b.hh, b.r) <= 0) { inside = true; break; }
      }
      if (!inside) continue;
      const ox = (x / SUPERSAMPLE) | 0;
      const oy = (y / SUPERSAMPLE) | 0;
      acc[oy * size + ox] += 1;
    }
  }

  const per = SUPERSAMPLE * SUPERSAMPLE;
  const out = Buffer.alloc(size * size);
  for (let i = 0; i < acc.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round((acc[i] / per) * 255)));
  }
  return out;
}

/* ---------------- PNG 编码（RGBA8，无第三方库） ---------------- */
const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, alpha) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type: RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace

  // 每行前置一个 filter 字节（0 = None），模板图只有 alpha 有意义，无需滤波
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      raw[o++] = 0;                             // R
      raw[o++] = 0;                             // G
      raw[o++] = 0;                             // B
      raw[o++] = alpha[y * size + x];           // A
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 输出 ---------------- */
const TARGETS = [
  { size: 16, file: 'trayTemplate.png' },
  { size: 32, file: 'trayTemplate@2x.png' }
];

TARGETS.forEach(function (t) {
  const png = encodePng(t.size, renderAlpha(t.size));
  const dest = path.join(ASSETS, t.file);
  fs.writeFileSync(dest, png);
  console.log('已生成 ' + path.relative(path.join(__dirname, '..'), dest) + ' · ' + t.size + '×' + t.size + ' · ' + png.length + ' 字节');
});

console.log('提示：模板图只有 alpha 有意义，宿主系统会按菜单栏深浅自动反色。');
