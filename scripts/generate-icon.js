/**
 * 生成 TextReader 应用图标 (icon.png)
 * 纯 Node.js 实现，无外部依赖，输出 256×256 RGBA PNG。
 *
 * 用法：node scripts/generate-icon.js
 * 输出：icon.png（项目根目录）
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 256;

// ---- 颜色定义 (RGBA) ----
const BG_COLOR    = [44, 62, 80, 255];   // #2c3e50 深蓝灰背景
const BOOK_COLOR  = [236, 240, 241, 255]; // #ecf0f1 书页白
const COVER_COLOR = [52, 152, 219, 255];  // #3498db 封面蓝
const LINE_COLOR  = [189, 195, 199, 255]; // #bdc3c7 文字线条灰

// ---- 像素缓冲区 ----
// 每行: 1 字节 filter(0x00) + SIZE*4 字节 RGBA
const rowSize = 1 + SIZE * 4;
const rawData = Buffer.alloc(SIZE * rowSize);

function setPixel(x, y, [r, g, b, a]) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const offset = y * rowSize + 1 + x * 4;
  rawData[offset]     = r;
  rawData[offset + 1] = g;
  rawData[offset + 2] = b;
  rawData[offset + 3] = a;
}

function fillRect(x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(x + dx, y + dy, color);
    }
  }
}

// ---- 圆角矩形背景 ----
function drawRoundedRect(cx, cy, rw, rh, radius, color) {
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      let inside = true;
      // 检查四个角
      if (x < radius && y < radius) {
        const dx = radius - x - 1;
        const dy = radius - y - 1;
        inside = (dx * dx + dy * dy) <= (radius * radius);
      } else if (x >= rw - radius && y < radius) {
        const dx = x - (rw - radius);
        const dy = radius - y - 1;
        inside = (dx * dx + dy * dy) <= (radius * radius);
      } else if (x < radius && y >= rh - radius) {
        const dx = radius - x - 1;
        const dy = y - (rh - radius);
        inside = (dx * dx + dy * dy) <= (radius * radius);
      } else if (x >= rw - radius && y >= rh - radius) {
        const dx = x - (rw - radius);
        const dy = y - (rh - radius);
        inside = (dx * dx + dy * dy) <= (radius * radius);
      }
      if (inside) {
        setPixel(cx + x, cy + y, color);
      }
    }
  }
}

// ---- 绘制 ----

// 1. 透明背景
fillRect(0, 0, SIZE, SIZE, [0, 0, 0, 0]);

// 2. 圆角矩形背景
const margin = 16;
drawRoundedRect(margin, margin, SIZE - margin * 2, SIZE - margin * 2, 32, BG_COLOR);

// 3. 打开的书本图标（居中）
const cx = SIZE / 2;
const cy = SIZE / 2;

// 书本尺寸
const bookW = 120;
const bookH = 90;
const bookX = cx - bookW / 2;
const bookY = cy - bookH / 2;

// 左页（微弧）
fillRect(bookX, bookY, bookW / 2, bookH, BOOK_COLOR);
// 右页
fillRect(bookX + bookW / 2, bookY, bookW / 2, bookH, BOOK_COLOR);

// 书脊（中缝阴影）
fillRect(cx - 2, bookY, 4, bookH, [180, 190, 200, 255]);

// 封面边框（底部和侧边）
fillRect(bookX - 4, bookY + bookH - 8, bookW + 8, 8, COVER_COLOR);   // 底边
fillRect(bookX - 4, bookY, 8, bookH, COVER_COLOR);                    // 左边
fillRect(bookX + bookW - 4, bookY, 8, bookH, COVER_COLOR);            // 右边

// 4. 页面上的 "文字线条"
const lineColor = LINE_COLOR;
const lineY1 = bookY + 20;
const lineY2 = bookY + 35;
const lineY3 = bookY + 50;
const lineY4 = bookY + 65;

// 左页文字
fillRect(bookX + 12, lineY1, 38, 3, lineColor);
fillRect(bookX + 12, lineY2, 42, 3, lineColor);
fillRect(bookX + 12, lineY3, 35, 3, lineColor);
fillRect(bookX + 12, lineY4, 40, 3, lineColor);

// 右页文字
fillRect(bookX + bookW / 2 + 8, lineY1, 38, 3, lineColor);
fillRect(bookX + bookW / 2 + 8, lineY2, 42, 3, lineColor);
fillRect(bookX + bookW / 2 + 8, lineY3, 35, 3, lineColor);
fillRect(bookX + bookW / 2 + 8, lineY4, 40, 3, lineColor);

// ---- PNG 编码 ----

function crc32(buf) {
  // CRC-32 查表法
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuffer, data]);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

// IHDR
const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(SIZE, 0);   // width
ihdrData.writeUInt32BE(SIZE, 4);   // height
ihdrData[8] = 8;                    // bit depth
ihdrData[9] = 6;                    // color type: RGBA
ihdrData[10] = 0;                   // compression
ihdrData[11] = 0;                   // filter
ihdrData[12] = 0;                   // interlace

// IDAT (compress raw pixel data)
const compressed = zlib.deflateSync(rawData);

// 构建 PNG
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdrChunk = createChunk('IHDR', ihdrData);
const idatChunk = createChunk('IDAT', compressed);
const iendChunk = createChunk('IEND', Buffer.alloc(0));

const pngBuffer = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);

// 写入文件
const outPath = path.join(__dirname, '..', 'icon.png');
fs.writeFileSync(outPath, pngBuffer);
console.log(`✅ Icon generated: ${outPath} (${SIZE}x${SIZE} PNG, ${(pngBuffer.length / 1024).toFixed(1)} KB)`);
