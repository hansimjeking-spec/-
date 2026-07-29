import { deflateSync } from "node:zlib";

const WIDTH = 1200;
const HEIGHT = 630;
let cachedImage;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, checksum]);
}

function createImage() {
  const stride = WIDTH * 4 + 1;
  const raw = Buffer.alloc(stride * HEIGHT);
  const put = (x, y, color) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const at = y * stride + 1 + x * 4;
    raw[at] = color[0]; raw[at + 1] = color[1]; raw[at + 2] = color[2]; raw[at + 3] = 255;
  };
  const rect = (x, y, w, h, color) => {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) put(xx, yy, color);
  };
  const circle = (cx, cy, r, color) => {
    for (let y = cy - r; y <= cy + r; y += 1) for (let x = cx - r; x <= cx + r; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) put(x, y, color);
    }
  };
  const blue = [28, 92, 130], cyan = [117, 194, 211], mint = [178, 226, 198], white = [250, 253, 255], ink = [31, 70, 96];
  rect(0, 0, WIDTH, HEIGHT, blue);
  rect(0, 0, WIDTH, 92, [43, 117, 156]);
  rect(90, 148, 558, 324, white);
  rect(90, 148, 558, 18, mint);
  rect(140, 216, 260, 28, blue);
  rect(140, 276, 360, 16, [126, 172, 193]);
  rect(140, 318, 295, 16, [188, 214, 224]);
  rect(140, 370, 170, 36, mint);
  circle(868, 263, 90, cyan); circle(1022, 370, 76, mint); circle(893, 262, 38, white); circle(1047, 370, 31, white);
  rect(849, 339, 190, 12, white); rect(924, 292, 12, 74, white); rect(994, 345, 12, 82, white);
  rect(105, 514, 404, 12, white); rect(750, 514, 315, 12, white); rect(0, 548, WIDTH, 82, ink);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

export default function handler(request, response) {
  if (!cachedImage) cachedImage = createImage();
  response.setHeader("Content-Type", "image/png");
  response.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
  response.status(200).send(cachedImage);
}
