const { createCanvas } = require('canvas')
const fs = require('fs')
const path = require('path')

function generateIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  // Fondo con esquinas redondeadas
  const radius = size * 0.15
  ctx.beginPath()
  ctx.moveTo(radius, 0)
  ctx.lineTo(size - radius, 0)
  ctx.quadraticCurveTo(size, 0, size, radius)
  ctx.lineTo(size, size - radius)
  ctx.quadraticCurveTo(size, size, size - radius, size)
  ctx.lineTo(radius, size)
  ctx.quadraticCurveTo(0, size, 0, size - radius)
  ctx.lineTo(0, radius)
  ctx.quadraticCurveTo(0, 0, radius, 0)
  ctx.closePath()
  ctx.fillStyle = '#111827'
  ctx.fill()

  // Letra F centrada
  ctx.fillStyle = '#22c55e'
  ctx.font = `bold ${size * 0.58}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('F', size / 2, size * 0.54)

  return canvas.toBuffer('image/png')
}

const outDir = path.join(__dirname, 'public')

fs.writeFileSync(path.join(outDir, 'icon-192.png'), generateIcon(192))
console.log('✓ icon-192.png')

fs.writeFileSync(path.join(outDir, 'icon-512.png'), generateIcon(512))
console.log('✓ icon-512.png')

console.log('Íconos generados en public/')
