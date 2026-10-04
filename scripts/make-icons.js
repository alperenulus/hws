const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePng(width, height, pixelFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk('IHDR', ihdrData);

  const raw = Buffer.alloc(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

// Simple "Hot Wheels"-ish wheel icon: dark rounded-square background,
// orange ring, dark tire, light hub + 5 spokes.
function iconPixel(x, y, size) {
  const cx = size / 2, cy = size / 2;
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const R = size * 0.46;

  const bgCorner = size * 0.14;
  const inCornerCut = (x < bgCorner && y < bgCorner && (bgCorner - x) + (bgCorner - y) > bgCorner) ||
                       (x > size - bgCorner && y < bgCorner && (x - (size - bgCorner)) + (bgCorner - y) > bgCorner) ||
                       (x < bgCorner && y > size - bgCorner && (bgCorner - x) + (y - (size - bgCorner)) > bgCorner) ||
                       (x > size - bgCorner && y > size - bgCorner && (x - (size - bgCorner)) + (y - (size - bgCorner)) > bgCorner);
  if (inCornerCut) return [0, 0, 0, 0];

  if (dist > R) {
    return [0xE2, 0x23, 0x1A, 255]; // racing red background
  }
  if (dist > R * 0.82) {
    return [0xFF, 0xA0, 0x00, 255]; // orange ring
  }
  if (dist > R * 0.72) {
    return [0x18, 0x18, 0x18, 255]; // black tire
  }
  if (dist > R * 0.30) {
    // spokes zone: 5 spokes radiating from hub
    const angle = (Math.atan2(dy, dx) + Math.PI * 2) % Math.PI;
    const spokeAngle = (angle * 5) % Math.PI;
    const spokeWidth = 0.34;
    if (spokeAngle < spokeWidth || spokeAngle > Math.PI - spokeWidth) {
      return [0xEE, 0xEE, 0xEE, 255];
    }
    return [0x18, 0x18, 0x18, 255];
  }
  return [0xEE, 0xEE, 0xEE, 255]; // hub
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const sizes = [192, 512, 180];
for (const size of sizes) {
  const png = makePng(size, size, (x, y) => iconPixel(x, y, size));
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  fs.writeFileSync(path.join(outDir, name), png);
  console.log('wrote', name, png.length, 'bytes');
}
