import * as XLSX from 'xlsx-js-style'
import { claveBloque } from './documentoRuta'
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

// La fecha que se MUESTRA/nombra en el documento es la de ENTREGA. Antes se deducía acá
// como despacho + 1; ahora viene resuelta en `doc.fechaEntrega` y esto solo la convierte a
// Date para formatearla. El filtro por fecha de despacho y el nombre del archivo descargado
// NO cambian; solo cambia de dónde sale lo que se imprime dentro del Excel.
function comoFecha(fecha: string): Date {
  return new Date(fecha + 'T00:00:00')
}

// "JUEVES 30 JULIO": día de semana + día + mes, MAYÚSCULA sin tildes, desde una fecha ya resuelta.
function textoLineaFecha(d: Date): string {
  const dia = sinTildes(d.toLocaleDateString('es', { weekday: 'long' })).toUpperCase()
  const mes = sinTildes(d.toLocaleDateString('es', { month: 'long' })).toUpperCase()
  return `${dia} ${d.getDate()} ${mes}`
}

// "30 JULIO": nombre de hoja como lo nombra Rafa (día y mes), desde una fecha ya resuelta.
function textoNombreHoja(d: Date): string {
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

/**
 * Columna separadora entre rutas: negro sólido, como en el maestro ALINEACIÓN_2026.
 *
 * No pasa por estilo(): no lleva borde (sobre negro no se vería) ni fuente, porque la celda
 * va siempre vacía. El color es FF0C0C0C y NO 000000 puro — es el del maestro.
 */
const S_SEPARADOR = { fill: { patternType: 'solid', fgColor: { rgb: 'FF0C0C0C' } } }

// TODOS los bloques usan el mismo juego de estilos `S`, Externo incluido: no hay
// excepción de color por ruta. Lo único propio de Externo es que sus secciones no
// llevan fila de total (cada código es un cargue distinto y no se puede sumar entre carros).

// ── Anchos de columna ───────────────────────────────────────────────
// SheetJS le suma ~0.83 (medio carácter de gutter) al convertir wch -> width del XML.
// Restamos ese margen para que el width final coincida con la hoja real de Rafa.
const GUTTER_WCH = 0.83
const ANCHOS_BLOQUE = [26.29, 7.29, 5.86, 6.57, 7.14, 6.0].map(w => w - GUTTER_WCH)
/** Columnas de la tabla del bloque: COD | CANT | V/B | V/R | CABEZA | PATAS. */
const COLS_TABLA = 6
/** Columna extra de DIRECCION, a la derecha (solo la usa Nacional). */
const ANCHO_DIRECCION = 42 - GUTTER_WCH
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

  /**
   * Última fila escrita (0-indexada). La necesitan las columnas separadoras: se pintan
   * recién cuando ya están todos los bloques, para llegar hasta abajo del más largo y no
   * cortarse a media tabla.
   */
  get ultimaFila(): number {
    return this.maxR
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
// TODOS los bloques llevan fila de total, Externo incluido: Rafa quiere ver el total de cada
// carro. (Antes se omitía en Externo; esa regla quedó sin efecto.)
function escribirBovinos(h: Hoja, sec: SeccionDocumento, c: number, cEnd: number, rIni: number, ss: SetEstilos, colDireccion: number | null = null): number {
  let r = rIni
  const hayDesp = sec.filas.some(f => f.esDesposte)
  h.combinada(r++, c, cEnd, { v: hayDesp ? 'BOVINOS/DESPOSTE' : 'BOVINOS', t: 's', s: ss.tituloBovinos })

  const heads = ['COD', 'CANT', 'V/B', 'V/R', 'CABEZA', 'PATAS']
  heads.forEach((t, i) => h.celda(r, c + i, { v: t, t: 's', s: ss.encBovinos }))
  if (colDireccion != null) h.celda(r, colDireccion, { v: 'DIRECCION', t: 's', s: ss.encBovinos })
  r++

  const first = r
  // Los códigos sin orden de entrega igual salen al final (los ordena seccionDe), pero en el
  // Excel van SIN separador ni aviso: Rafa lo quiere limpio. El aviso queda solo en pantalla.
  for (const f of sec.filas) {
    h.celda(r, c, { v: f.cod, t: 's', s: ss.datos })
    h.celda(r, c + 1, { v: f.cant, t: 'n', s: ss.datos })
    h.celda(r, c + 2, { v: f.vb, t: 'n', s: ss.datos })
    h.celda(r, c + 3, { v: f.vr, t: 'n', s: ss.datos })
    h.celda(r, c + 4, celdaNum(f.cabeza, ss))
    h.celda(r, c + 5, celdaNum(f.patas, ss))
    // Direccion AL LADO del codigo, en su misma fila (solo Nacional).
    if (colDireccion != null) h.celda(r, colDireccion, { v: f.direccion ?? '', t: 's', s: ss.datos })
    r++
  }
  const last = r - 1

  h.celda(r, c, { v: 'total', t: 's', s: ss.total })
  const totales = [sec.totales.cant, sec.totales.vb, sec.totales.vr, sec.totales.cabeza, sec.totales.patas]
  totales.forEach((cache, i) => h.celda(r, c + 1 + i, celdaTotal(c + 1 + i, first, last, cache, sec.filas.length, ss)))
  return r + 1
}

// Porcinos: COD combinado en 3 columnas (c..c+2) y solo CANT/V/B/V/R.
function escribirPorcinos(h: Hoja, sec: SeccionDocumento, c: number, cEnd: number, rIni: number, ss: SetEstilos, colDireccion: number | null = null): number {
  let r = rIni
  const hayDesp = sec.filas.some(f => f.esDesposte)
  h.combinada(r++, c, cEnd, { v: hayDesp ? 'PORCINOS/ DESPOSTE' : 'PORCINOS ', t: 's', s: ss.tituloPorcinos })

  h.combinada(r, c, c + 2, { v: 'COD', t: 's', s: ss.encPorcinos })
  h.celda(r, c + 3, { v: 'CANT', t: 's', s: ss.encPorcinos })
  h.celda(r, c + 4, { v: 'V/B', t: 's', s: ss.encPorcinos })
  h.celda(r, c + 5, { v: 'V/R', t: 's', s: ss.encPorcinos })
  if (colDireccion != null) h.celda(r, colDireccion, { v: 'DIRECCION', t: 's', s: ss.encPorcinos })
  r++

  const first = r
  for (const f of sec.filas) {
    h.combinada(r, c, c + 2, { v: f.cod, t: 's', s: ss.datos })
    h.celda(r, c + 3, { v: f.cant, t: 'n', s: ss.datos })
    h.celda(r, c + 4, { v: f.vb, t: 'n', s: ss.datos })
    h.celda(r, c + 5, { v: f.vr, t: 'n', s: ss.datos })
    if (colDireccion != null) h.celda(r, colDireccion, { v: f.direccion ?? '', t: 's', s: ss.datos })
    r++
  }
  const last = r - 1

  h.combinada(r, c, c + 2, { v: 'total', t: 's', s: ss.total })
  const totales = [sec.totales.cant, sec.totales.vb, sec.totales.vr]
  totales.forEach((cache, i) => h.celda(r, c + 3 + i, celdaTotal(c + 3 + i, first, last, cache, sec.filas.length, ss)))
  return r + 1
}

// Un bloque completo, arrancando en la columna `c` (6 columnas de ancho).
// `textoFecha` = línea de fecha de ENTREGA ya formateada (la misma para todos los bloques).
// `esExterno`: mismos colores que cualquier otra ruta; lo único distinto es que sus
// secciones NO llevan fila de total (cada código es un cargue aparte, no se suma entre carros).
function escribirBloque(
  h: Hoja,
  b: BloqueRuta,
  c: number,
  textoFecha: string,
  manual: DatosManuales | null,
  esExterno: boolean,
  ancho: number
): void {
  const cEnd = c + ancho - 1
  // Columna extra a la DERECHA para la dirección (solo Nacional). Rafa las quiere al lado
  // del código, en la misma fila —así están en sus alineaciones—, no en filas debajo.
  const colDireccion = ancho > COLS_TABLA ? c + COLS_TABLA : null
  const ss = S
  let r = 0

  h.combinada(r++, c, cEnd, { v: textoFecha, t: 's', s: ss.fecha })
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

  // Un carro externo lleva UN SOLO tipo de carne: se escribe solo la sección con filas, para
  // que no salga la vacía al lado (eso se veía como "res y cerdo mezclados"). BOVINOS vacío
  // se sigue escribiendo en las rutas con nombre, que es como Rafa arma sus alineaciones.
  if (!esExterno || b.bovinos.filas.length > 0) {
    r = escribirBovinos(h, b.bovinos, c, cEnd, r, ss, colDireccion)
  }
  // PORCINOS vacío NO se escribe en ninguna ruta, tampoco en las que tienen nombre: quedaba
  // el título y los encabezados sin una sola fila debajo (lo reportó Rafa).
  //
  // Omitirlo no deja hueco. `r` es el cursor de fila DENTRO del bloque: si no se llama, no
  // avanza y la OBSERVACIÓN sube sola. El bloque termina más corto que sus vecinos, que es lo
  // que ya pasa entre rutas con distinta cantidad de códigos.
  if (b.porcinos.filas.length > 0) {
    r = escribirPorcinos(h, b.porcinos, c, cEnd, r, ss, colDireccion)
  }

  h.combinada(r++, c, cEnd, { v: 'OBSERVACIÓN ', t: 's', s: ss.tituloObs })
  const obs = manual?.observacion ?? ''
  if (obs.trim() !== '') {
    for (const linea of obs.split('\n')) {
      h.combinada(r++, c, cEnd, { v: linea, t: 's' }) // sin estilo y sin borde
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

/** Escribe el documento de la fecha de entrega como la hoja del libro. */
function agregarHojaDocumento(
  wb: XLSX.WorkBook,
  doc: DocumentoDia,
  manualEnPantalla: Map<string, DatosManuales>
): void {
  const h = new Hoja()

  // Fecha de ENTREGA del documento, formateada UNA sola vez; el mismo texto va a todos los
  // bloques y al nombre de hoja. Todo lo que hay adentro se entrega ese día, se haya
  // despachado en la jornada que se haya despachado.
  const entrega = comoFecha(doc.fechaEntrega)
  const textoFecha = textoLineaFecha(entrega)

  // Bloques lado a lado con ANCHO VARIABLE: el de Nacional lleva una columna extra a la
  // derecha para las direcciones, así que el offset se acumula en vez de ser 1 + i*7 fijo.
  // A y la que sigue a cada bloque son columnas separadoras: van en negro y cierran la hoja
  // por los dos lados, igual que en el maestro.
  const cols: { wch: number }[] = [{ wch: ANCHO_SEP }]
  // Columnas que hay que pintar de negro. Se anotan acá y se pintan al final: recién cuando
  // están todos los bloques se sabe hasta qué fila llega el más largo.
  // La columna A también va en negro: en el maestro la banda cierra la hoja por los dos
  // lados, no solo entre rutas.
  const colsSeparadoras: number[] = [0]
  let c = 1
  for (const b of doc.bloques) {
    const llevaDireccion = [...b.bovinos.filas, ...b.porcinos.filas].some(f => f.direccion)
    const ancho = llevaDireccion ? COLS_TABLA + 1 : COLS_TABLA

    escribirBloque(h, b, c, textoFecha, manualEnPantalla.get(claveBloque(b)) ?? b.manual ?? null, b.ruta === 'Externo', ancho)

    for (const w of ANCHOS_BLOQUE) cols.push({ wch: w })
    if (llevaDireccion) cols.push({ wch: ANCHO_DIRECCION })
    cols.push({ wch: ANCHO_SEP })
    // TODAS las columnas que siguen a un bloque van en negro, la del último incluida: esa es
    // la que cierra la hoja por la derecha.
    colsSeparadoras.push(c + ancho)
    c += ancho + 1
  }

  // Negro de punta a punta: de la primera fila a la última con contenido de CUALQUIER bloque,
  // así la banda no queda cortada al lado de una ruta con menos filas que su vecina.
  // Sin bloques no se pinta nada: si no, un día sin despachos saldría con una sola celda
  // negra suelta en A1.
  if (doc.bloques.length > 0) {
    const ultima = h.ultimaFila
    for (const col of colsSeparadoras) {
      for (let r = 0; r <= ultima; r++) h.celda(r, col, { v: '', t: 's', s: S_SEPARADOR })
    }
  }

  XLSX.utils.book_append_sheet(wb, h.toSheet(cols), textoNombreHoja(entrega))
}

/**
 * Exporta la tabla de una FECHA DE ENTREGA a un .xlsx con el formato de Rafa: UNA hoja con
 * todo lo que se entrega ese día, sin importar en qué jornada se cargó cada despacho.
 *
 * `manualEnPantalla` = datos manuales del estado local de la pantalla (lo que Rafa ve,
 * aunque no haya sacado el foco de un campo), por clave de bloque (ver claveBloque).
 */
export function exportarDocumentoRuta(doc: DocumentoDia, manualEnPantalla: Map<string, DatosManuales>): void {
  const wb = XLSX.utils.book_new()

  agregarHojaDocumento(wb, doc, manualEnPantalla)

  if (doc.sinRuta.length > 0) {
    const matSin = hojaSinRuta(doc.sinRuta)
    const wsSin = XLSX.utils.aoa_to_sheet(matSin)
    wsSin['!cols'] = anchosColumnas(matSin)
    XLSX.utils.book_append_sheet(wb, wsSin, 'Sin ruta')
  }

  // El nombre del archivo es el de la ENTREGA (la fecha del selector, y la identidad del
  // documento). Antes era la jornada; con la agrupación por entrega, dos exports del mismo
  // día de entrega hechos en jornadas distintas tienen que llamarse igual.
  XLSX.writeFile(wb, `Documento de ruta ${doc.fechaEntrega}.xlsx`)
}
