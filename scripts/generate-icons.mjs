import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { deflateSync } from 'node:zlib'

const run = promisify(execFile)
const outputDirectory = resolve('build', 'icon')
const sizes = [16, 32, 64, 128, 256, 512, 1024]
const pngs = new Map()

await mkdir(outputDirectory, { recursive: true })
for (const size of sizes) {
  const png = createPng(size)
  pngs.set(size, png)
  await writeFile(join(outputDirectory, `icon-${size}x${size}.png`), png)
}

await writeFile(resolve('build', 'icon.png'), pngs.get(512))
await writeFile(resolve('build', 'icon.ico'), createIco([16, 32, 64, 128, 256].map(size => pngs.get(size))))

if (process.platform === 'darwin') await createIcns()

async function createIcns () {
  const iconset = resolve('build', 'icon.iconset')
  await rm(iconset, { recursive: true, force: true })
  await mkdir(iconset, { recursive: true })
  const files = [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png']
  ]
  await Promise.all(files.map(([size, filename]) => writeFile(join(iconset, filename), pngs.get(size))))
  await run('iconutil', ['--convert', 'icns', '--output', resolve('build', 'icon.icns'), iconset])
  await rm(iconset, { recursive: true, force: true })
}

function createPng (size) {
  const pixels = Buffer.alloc(size * size * 4)
  const radius = size * 0.18
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4
      const inside = roundedRectContains(x, y, size, radius)
      const color = inside ? [13, 116, 108, 255] : [0, 0, 0, 0]
      pixels.set(color, offset)
    }
  }

  drawCircle(pixels, size, size * 0.5, size * 0.5, size * 0.085, [255, 255, 255, 255])
  drawArc(pixels, size, size * 0.5, size * 0.5, size * 0.22, size * 0.045)
  drawArc(pixels, size, size * 0.5, size * 0.5, size * 0.34, size * 0.04)

  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    pngSignature(),
    pngChunk('IHDR', uint32(size), uint32(size), Buffer.from([8, 6, 0, 0, 0])),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function roundedRectContains (x, y, size, radius) {
  const inset = size * 0.04
  if (x < inset || y < inset || x >= size - inset || y >= size - inset) return false
  const cx = Math.max(inset + radius, Math.min(x, size - inset - radius))
  const cy = Math.max(inset + radius, Math.min(y, size - inset - radius))
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function drawCircle (pixels, size, cx, cy, radius, color) {
  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(size, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(size, Math.ceil(cx + radius)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) pixels.set(color, (y * size + x) * 4)
    }
  }
}

function drawArc (pixels, size, cx, cy, radius, thickness) {
  const inner = radius - thickness / 2
  const outer = radius + thickness / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < inner || distance > outer || Math.abs(dx) < radius * 0.22) continue
      pixels.set([255, 255, 255, 255], (y * size + x) * 4)
    }
  }
}

function createIco (images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((image, index) => {
    const size = [16, 32, 64, 128, 256][index]
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header[entry + 2] = 0
    header[entry + 3] = 0
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(image.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += image.length
  })
  return Buffer.concat([header, ...images])
}

function pngSignature () {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
}

function uint32 (value) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

function pngChunk (type, ...parts) {
  const data = Buffer.concat(parts)
  const name = Buffer.from(type)
  return Buffer.concat([uint32(data.length), name, data, uint32(crc32(Buffer.concat([name, data])))])
}

function crc32 (buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
