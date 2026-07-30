import * as XLSX from 'xlsx-js-style'
import type {
  DocumentoDia,
  BloqueRuta,
  SeccionDocumento,
  FilaDocumento,
  DatosManuales,
} from './documentoRuta'

// Exportación que imita la "alineación" real de Rafa: bloques de ruta lado a lado,
// celdas combinadas, estilos y fórmulas SUM reales. Usa xlsx-js-style (fork de xlsx
// con la MISMA API que sí escribe estilos). Los demás export del proyecto siguen con 'xlsx'.

// ── Utilidades de texto ────────────────────────────────────────────
function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// La fecha que se MUESTRA/nombra en el documento es la de ENTREGA: lo despachado un día
// se entrega al siguiente (despacho + 1). El filtro por fecha de despacho y el nombre del
// archivo descargado NO cambian; solo cambia lo que se imprime dentro del Excel.
function fechaEntrega(fecha: string): Date {
  const d = new Date(fecha + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d
}

// "MIERCOLES 22 JULIO": día de semana en MAYÚSCULA sin tildes, día, mes en mayúscula.
function lineaFecha(fecha: string): string {
  const d = fechaEntrega(fecha)
  const dia = sinTildes(d.toLocaleDateString('es', { weekday: 'long' })).toUpperCase()
  const mes = sinTildes(d.toLocaleDateString('es', { month: 'long' })).toUpperCase()
  return `${dia} ${d.getDate()} ${mes}`
}

// "22 JULIO": nombre de hoja como lo nombra Rafa (día y mes en mayúscula) — fecha de ENTREGA.
function nombreHoja(fecha: string): string {
  const d = fechaEntrega(fecha)
  const mes = sinTildes(d.toLocaleDateString('es', { month: 'long' })).toUpperCase()
  return `${d.getDate()} ${mes}`
}

// ── Estilos (bordes finos + centrado por defecto; colores sin "#") ──
const BORDE = { style: 'thin', color: { rgb: '000000' } }
const BORDES = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE }
const CENTRO = { horizontal: 'center', vertical: 'center', wrapText: true }

type OpcEstilo = { name?: string; sz: number; bold?: boolean; fill?: string; color?: string }
function estilo(o: OpcEstilo): Record<string, unknown> {
  const s: Record<string, unknown> = {
    font: { name: o.name ?? 'Calibri', sz: o.sz, bold: !!o.bold, color: { rgb: o.color ?? '000000' } },
    alignment: CENTRO,
    border: BORDES,
  }
  if (o.fill) s.fill = { patternType: 'solid', fgColor: { rgb: o.fill } }
  return s
}

const S = {
  fecha: estilo({ sz: 16, bold: true, fill: 'E2EFD9' }),
  ruta: estilo({ name: 'Arial Black', sz: 11, bold: false, fill: 'E2EFD9' }),
  etiqueta: estilo({ sz: 11, bold: true }),
  valor: estilo({ sz: 16, bold: true }),
  tituloBovinos: estilo({ sz: 16, bold: true, fill: 'C8C8C8' }),
  encBovinos: estilo({ sz: 14, bold: true, fill: 'FFFF00' }),
  tituloPorcinos: estilo({ sz: 16, bold: true, fill: 'FFE598' }),
  encPorcinos: estilo({ sz: 14, bold: true, fill: 'C8C8C8' }), // grises, no amarillos
  datos: estilo({ sz: 11, bold: false }),
  total: estilo({ sz: 14, bold: false, color: '9C0006', fill: 'FFC7CE' }),
  tituloObs: estilo({ sz: 16, bold: true, fill: 'E478C8' }),
}
type SetEstilos = typeof S

// Variante para el bloque 'Externo': mismo todo (fuente/tamaño/negrita/borde y colores de
// letra, incluido el 9C0006 del total), pero el relleno de TODA celda pasa a rojo puro.
const ROJO_EXTERNO = 'FF0000'
function tintarRojo(base: Record<string, unknown>): Record<string, unknown> {
  return { ...base, fill: { patternType: 'solid', fgColor: { rgb: ROJO_EXTERNO } } }
}
const S_ROJO = Object.fromEntries(
  Object.entries(S).map(([k, v]) => [k, tintarRojo(v)]),
) as SetEstilos
// Las líneas de observación normalmente van sin estilo; en Externo solo llevan el relleno rojo.
const RELLENO_OBS_ROJO = { fill: { patternType: 'solid', fgColor: { rgb: ROJO_EXTERNO } } }

// ── Anchos de columna ───────────────────────────────────────────────
// SheetJS le suma ~0.83 (medio carácter de gutter) al convertir wch -> width del XML.
// Restamos ese margen para que el width final coincida con la hoja real de Rafa.
const GUTTER_WCH = 0.83
const ANCHOS_BLOQUE = [26.29, 7.29, 5.86, 6.57, 7.14, 6.0].map(w => w - GUTTER_WCH)
const ANCHO_SEP = 1.14 - GUTTER_WCH // columna A (margen) y separadoras entre bloques

// ── Construcción de la hoja celda por celda (bloques lado a lado, combinaciones) ──
type Celda = { v: string | number; t: 's' | 'n'; f?: string; s?: unknown }

class Hoja {
  private cells: Record<string, Celda> = {}
  private merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
  private maxR = 0
  private maxC = 0

  celda(r: number, c: number, celda: Celda): void {
    this.cells[XLSX.utils.encode_cell({ r, c })] = celda
    if (r > this.maxR) this.maxR = r
    if (c > this.maxC) this.maxC = c
  }

  // Fila combinada c0..c1: valor+estilo en la primera celda; el resto vacías con el
  // mismo estilo, para que el borde (y el relleno) cubran TODO el rango combinado.
  combinada(r: number, c0: number, c1: number, celda: Celda): void {
    this.celda(r, c0, celda)
    for (let c = c0 + 1; c <= c1; c++) this.celda(r, c, { v: '', t: 's', s: celda.s })
    if (c1 > c0) this.merges.push({ s: { r, c: c0 }, e: { r, c: c1 } })
  }

  toSheet(cols: { wch: number }[]): XLSX.WorkSheet {
    const ws: XLSX.WorkSheet = {}
    const bag = ws as Record<string, unknown>
    for (const [addr, cell] of Object.entries(this.cells)) bag[addr] = cell
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: this.maxR, c: this.maxC } })
    if (this.merges.length) ws['!merges'] = this.merges
    ws['!cols'] = cols
    return ws
  }
}

function celdaNum(n: number | null, ss: SetEstilos): Celda {
  // cabeza/patas en null → celda vacía (no 0), pero con estilo/borde de datos.
  return n == null ? { v: '', t: 's', s: ss.datos } : { v: n, t: 'n', s: ss.datos }
}

// Celda TOTAL: fórmula SUM real sobre las filas de datos (para que siga sumando si
// Rafa agrega filas). Sección vacía → 0 literal (sin fórmula), como pide la spec.
function celdaTotal(col: number, first: number, last: number, cache: number, nFilas: number, ss: SetEstilos): Celda {
  if (nFilas === 0) return { v: 0, t: 'n', s: ss.total }
  const a = XLSX.utils.encode_cell({ r: first, c: col })
  const b = XLSX.utils.encode_cell({ r: last, c: col })
  return { v: cache, t: 'n', f: `SUM(${a}:${b})`, s: ss.total }
}

// Bovinos: encabezados de 1 columna, CABEZA/PATAS incluidas.
function escribirBovinos(h: Hoja, sec: SeccionDocumento, c: number, cEnd: number, rIni: number, ss: SetEstilos): number {
  let r = rIni
  const hayDesp = sec.filas.some(f => f.esDesposte)
  h.combinada(r++, c, cEnd, { v: hayDesp ? 'BOVINOS/DESPOSTE' : 'BOVINOS', t: 's', s: ss.tituloBovinos })

  const heads = ['COD', 'CANT', 'V/B', 'V/R', 'CABEZA', 'PATAS']
  heads.forEach((t, i) => h.celda(r, c + i, { v: t, t: 's', s: ss.encBovinos }))
  r++

  const first = r
  for (const f of sec.filas) {
    h.celda(r, c, { v: f.cod, t: 's', s: ss.datos })
    h.celda(r, c + 1, { v: f.cant, t: 'n', s: ss.datos })
    h.celda(r, c + 2, { v: f.vb, t: 'n', s: ss.datos })
    h.celda(r, c + 3, { v: f.vr, t: 'n', s: ss.datos })
    h.celda(r, c + 4, celdaNum(f.cabeza, ss))
    h.celda(r, c + 5, celdaNum(f.patas, ss))
    r++
  }
  const last = r - 1

  h.celda(r, c, { v: 'total', t: 's', s: ss.total })
  const totales = [sec.totales.cant, sec.totales.vb, sec.totales.vr, sec.totales.cabeza, sec.totales.patas]
  totales.forEach((cache, i) => h.celda(r, c + 1 + i, celdaTotal(c + 1 + i, first, last, cache, sec.filas.length, ss)))
  return r + 1
}

// Porcinos: COD combinado en 3 columnas (c..c+2) y solo CANT/V/B/V/R.
function escribirPorcinos(h: Hoja, sec: SeccionDocumento, c: number, cEnd: number, rIni: number, ss: SetEstilos): number {
  let r = rIni
  const hayDesp = sec.filas.some(f => f.esDesposte)
  h.combinada(r++, c, cEnd, { v: hayDesp ? 'PORCINOS/ DESPOSTE' : 'PORCINOS ', t: 's', s: ss.tituloPorcinos })

  h.combinada(r, c, c + 2, { v: 'COD', t: 's', s: ss.encPorcinos })
  h.celda(r, c + 3, { v: 'CANT', t: 's', s: ss.encPorcinos })
  h.celda(r, c + 4, { v: 'V/B', t: 's', s: ss.encPorcinos })
  h.celda(r, c + 5, { v: 'V/R', t: 's', s: ss.encPorcinos })
  r++

  const first = r
  for (const f of sec.filas) {
    h.combinada(r, c, c + 2, { v: f.cod, t: 's', s: ss.datos })
    h.celda(r, c + 3, { v: f.cant, t: 'n', s: ss.datos })
    h.celda(r, c + 4, { v: f.vb, t: 'n', s: ss.datos })
    h.celda(r, c + 5, { v: f.vr, t: 'n', s: ss.datos })
    r++
  }
  const last = r - 1

  h.combinada(r, c, c + 2, { v: 'total', t: 's', s: ss.total })
  const totales = [sec.totales.cant, sec.totales.vb, sec.totales.vr]
  totales.forEach((cache, i) => h.celda(r, c + 3 + i, celdaTotal(c + 3 + i, first, last, cache, sec.filas.length, ss)))
  return r + 1
}

// Un bloque completo, arrancando en la columna `c` (6 columnas de ancho).
// `rojo` = bloque 'Externo': toda celda se pinta de rojo (variante de estilo, misma función).
function escribirBloque(h: Hoja, b: BloqueRuta, c: number, fecha: string, manual: DatosManuales | null, rojo: boolean): void {
  const cEnd = c + 5
  const ss = rojo ? S_ROJO : S
  let r = 0

  h.combinada(r++, c, cEnd, { v: lineaFecha(fecha), t: 's', s: ss.fecha })
  h.combinada(r++, c, cEnd, { v: sinTildes(b.ruta).toUpperCase(), t: 's', s: ss.ruta })

  const filaLabel = (label: string, valor: string | null) => {
    h.celda(r, c, { v: label, t: 's', s: ss.etiqueta })
    h.combinada(r, c + 1, cEnd, { v: valor ?? '', t: 's', s: ss.valor })
    r++
  }
  filaLabel('CONDUCTOR', manual?.conductor ?? null)
  filaLabel('AUXILIAR', manual?.auxiliar ?? null)
  filaLabel('HORA PROGRAMADA: ', manual?.horaProgramada ?? null)
  filaLabel('PLACA', manual?.placa ?? null)

  r = escribirBovinos(h, b.bovinos, c, cEnd, r, ss)
  r = escribirPorcinos(h, b.porcinos, c, cEnd, r, ss)

  h.combinada(r++, c, cEnd, { v: 'OBSERVACIÓN ', t: 's', s: ss.tituloObs })
  const obs = manual?.observacion ?? ''
  if (obs.trim() !== '') {
    for (const linea of obs.split('\n')) {
      // Normal: sin estilo y sin borde. Externo: solo relleno rojo (para no dejar franja blanca).
      h.combinada(r++, c, cEnd, { v: linea, t: 's', s: rojo ? RELLENO_OBS_ROJO : undefined })
    }
  }
}

// ── Hoja plana "Sin ruta" (queda como estaba) ──────────────────────
type MatrizPlana = (string | number | null)[][]

function anchosColumnas(matriz: MatrizPlana): { wch: number }[] {
  const nCols = matriz.reduce((max, r) => Math.max(max, r.length), 0)
  const cols: { wch: number }[] = []
  for (let c = 0; c < nCols; c++) {
    let ancho = 10
    for (const r of matriz) {
      const v = r[c]
      const len = v == null ? 0 : String(v).length
      if (len + 2 > ancho) ancho = len + 2
    }
    cols.push({ wch: ancho })
  }
  return cols
}

function hojaSinRuta(sinRuta: FilaDocumento[]): MatrizPlana {
  const filas: MatrizPlana = [['COD', 'CANT', 'V/B', 'V/R', 'CABEZA', 'PATAS']]
  for (const f of sinRuta) filas.push([f.cod, f.cant, f.vb, f.vr, f.cabeza, f.patas])
  return filas
}

/**
 * Exporta el documento del día a un .xlsx con el formato de Rafa.
 * `manualEnPantalla` = datos manuales del estado local de la pantalla (lo que Rafa ve,
 * aunque no haya sacado el foco de un campo).
 */
export function exportarDocumentoRuta(doc: DocumentoDia, manualEnPantalla: Map<string, DatosManuales>): void {
  const wb = XLSX.utils.book_new()
  const h = new Hoja()

  // Bloques lado a lado: bloque i arranca en la columna 1 + i*7 (A queda de margen).
  doc.bloques.forEach((b, i) => {
    const c = 1 + i * 7
    escribirBloque(h, b, c, doc.fecha, manualEnPantalla.get(b.ruta) ?? b.manual ?? null, b.ruta === 'Externo')
  })

  // Anchos: A margen; por bloque las 6 columnas + 1 columna de separación.
  const cols: { wch: number }[] = [{ wch: ANCHO_SEP }]
  for (let i = 0; i < doc.bloques.length; i++) {
    for (const w of ANCHOS_BLOQUE) cols.push({ wch: w })
    cols.push({ wch: ANCHO_SEP })
  }

  XLSX.utils.book_append_sheet(wb, h.toSheet(cols), nombreHoja(doc.fecha))

  if (doc.sinRuta.length > 0) {
    const matSin = hojaSinRuta(doc.sinRuta)
    const wsSin = XLSX.utils.aoa_to_sheet(matSin)
    wsSin['!cols'] = anchosColumnas(matSin)
    XLSX.utils.book_append_sheet(wb, wsSin, 'Sin ruta')
  }

  XLSX.writeFile(wb, `Documento de ruta ${doc.fecha}.xlsx`)
}
