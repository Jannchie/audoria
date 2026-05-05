/**
 * Generate PWA icons from the source SVG.
 *
 * Run: node scripts/generate-icons.mjs
 * Requires: sharp (installed as transitive dependency of lightningcss)
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { dirname, resolve } = path

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const sharpModule = await import('sharp')
const sharp = sharpModule.default

const svgPath = resolve(root, 'public/audoria.svg')
const outDir = resolve(root, 'public')

const sizes = [48, 72, 96, 128, 144, 150, 152, 192, 256, 384, 512]

const svgContent = readFileSync(svgPath, 'utf8')

for (const size of sizes) {
  await sharp(Buffer.from(svgContent))
    .resize(size, size)
    .png()
    .toFile(resolve(outDir, `icon-${size}x${size}.png`))
  console.log(`✓ icon-${size}x${size}.png`)
}

// Maskable version: full-bleed background (no rounded corners), content shrunk to 80% safe zone
const maskableSvg = svgContent
  .replace('rx="120"', '') // remove rounded corners so background fills entire canvas
  .replace(
    '<rect x="112"',
    '<g transform="translate(51.2, 51.2) scale(0.8)">\n    <rect x="112"',
  )
  .replace('</svg>', '</g>\n</svg>')

await sharp(Buffer.from(maskableSvg))
  .resize(512, 512)
  .png()
  .toFile(resolve(outDir, 'icon-512x512.maskable.png'))
console.log('✓ icon-512x512.maskable.png')

await sharp(Buffer.from(maskableSvg))
  .resize(192, 192)
  .png()
  .toFile(resolve(outDir, 'icon-192x192.maskable.png'))
console.log('✓ icon-192x192.maskable.png')
