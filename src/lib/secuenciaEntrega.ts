import * as XLSX from 'xlsx-js-style'
import { supabase } from './supabase'
import type { DocumentoDia, FilaDocumento } from './documentoRuta'

// ════════════════════════════════════════════════════════════════
// Pieza G — SECUENCIA DE ENTREGA
// ════════════════════════════════════════════════════════════════
// Reordena los códigos despachados según el orden de entrega de cada ruta.
// En el Excel de Rafa esto son dos bloques lado a lado por hoja:
//   · maestro (CIUDAD | CODIGO | SECUENCIA) -> orden fijo de la ruta
//   · captura (COD | SECUENCIA | NOTA | CANT×5) -> lo despachado ese día
// y la secuencia sale de =IFERROR(VLOOKUP(COD; maestro; 2; 0); ""), ordenando
// después por esa columna. Acá el VLOOKUP y el orden se hacen EN CÓDIGO: el
// Excel generado lleva valores, no fórmulas.
//
// Las filas salen de armarDocumento() (documentoRuta.ts), así que la secuencia
// y el Documento de ruta no pueden discrepar: es el mismo cálculo.

/**
 * Rutas que se REORDENAN por secuencia. Las demás (Puerto Berrío, Cisneros/San
 * Roque, Don Matías, Nacional, Barbosa) las ordena el cliente, así que salen en
 * el orden en que vienen.
 *
 * ⚠️ A CONFIRMAR CON RAFA: el Excel tiene maestro poblado también en BERRIO,
 * CISNEROS SAN ROQUE y DON MATIAS. Se cargaron a la tabla, pero acá NO se
 * reordenan. Para activarlas, basta agregarlas a esta lista.
 */
export const RUTAS_CON_SECUENCIA: readonly string[] = [
  'Remedios/Segovia',
  'Cimitarra',
  'Yalí/Vegachí',
  'San José/Maceo',
  'Caracolí/Cristales',
  'Yolombó',
]

/** Rutas cuyo orden de entrega cambia según el día (hoy solo Cimitarra). */
export const RUTAS_CON_DIA: readonly string[] = ['Cimitarra']

export type MaestroRow = {
  ruta: string
  ciudad: string | null
  dia: string | null // NULL = sirve cualquier día
  codigo: string
  secuencia: number
}

export type FilaSecuencia = {
  cod: string              // código por el que se busca la secuencia (destino si lo hay)
  secuencia: number | null // null = el código no está en el maestro
  nota: string             // mismo texto que la celda COD del Documento de ruta
  canal: number            // CANT 1 — puede ser 0.5 (media canal)
  roja: number             // CANT 2
  blanca: number           // CANT 3
  cabeza: number           // CANT 4
  patas: number            // CANT 5
}

export type HojaSecuencia = {
  ruta: string
  dia: string | null       // día de entrega usado para elegir el maestro (solo rutas con día)
  reordena: boolean
  maestro: MaestroRow[]
  filas: FilaSecuencia[]
}

export type SecuenciaDia = {
  fecha: string            // fecha de DESPACHO (la que se elige en pantalla)
  diaEntrega: string       // 'LUNES', 'MARTES'... del día de ENTREGA
  hojas: HojaSecuencia[]
  avisos: string[]
}

// ── Utilidades de texto/fecha (mismo criterio que exportarDocumentoRuta) ──────
function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Día de la ENTREGA en mayúscula ('LUNES'). Se usa la fecha de despacho + 1
 * porque lo despachado un día se entrega al siguiente, y los días del maestro
 * de Cimitarra (LUNES/JUEVES) son días de ENTREGA, no de despacho.
 * ⚠️ A CONFIRMAR CON RAFA: si el maestro se refiere al día en que se DESPACHA,
 * hay que quitar el +1 de acá.
 */
export function diaEntregaDe(fecha: string): string {
  const d = new Date(fecha + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return sinTildes(d.toLocaleDateString('es', { weekday: 'long' })).toUpperCase()
}

/**
 * Código por el que se busca la secuencia. Si el despacho va a otro código
 * ("... PARA COD 154"), manda el DESTINO: es a ese cliente al que se le entrega.
 * Rafa hace justo esto a mano en su archivo (pisa la celda COD con el destino).
 */
export function codigoDeEntrega(f: FilaDocumento): string {
  const destino = (f.codigoDestino ?? '').trim()
  return destino !== '' ? destino : f.codigoCliente
}

/** Comparación de códigos tolerante: '04' y '4' son el mismo cliente. */
function mismoCodigo(a: string, b: string): boolean {
  const na = a.trim(), nb = b.trim()
  if (na === nb) return true
  const numA = Number(na), numB = Number(nb)
  return Number.isFinite(numA) && Number.isFinite(numB) && numA === numB
}

// ── Parte pura: armar las hojas ──────────────────────────────────────────────

/**
 * Convierte el documento del día en hojas de secuencia. `doc` ya trae todo
 * agregado (una fila por código/destino), así que acá solo se busca la
 * secuencia y se ordena.
 */
export function armarSecuencia(doc: DocumentoDia, maestro: MaestroRow[], diaEntrega: string): SecuenciaDia {
  const avisos: string[] = []
  const hojas: HojaSecuencia[] = []

  for (const bloque of doc.bloques) {
    // Externo no tiene secuencia: cada código es un carro aparte que arma el cliente.
    if (bloque.ruta === 'Externo') continue

    const reordena = RUTAS_CON_SECUENCIA.includes(bloque.ruta)
    const usaDia = RUTAS_CON_DIA.includes(bloque.ruta)
    const dia = usaDia ? diaEntrega : null

    // Maestro de la ruta: si la ruta usa día, solo las filas de ESE día
    // (más las de día NULL, que valen para cualquiera).
    const maestroRuta = maestro
      .filter(m => m.ruta === bloque.ruta && (!usaDia || m.dia == null || m.dia === diaEntrega))
      .sort((a, b) => a.secuencia - b.secuencia)

    const filasDoc = [...bloque.bovinos.filas, ...bloque.porcinos.filas]
    if (filasDoc.length === 0) continue // sin despachos ese día -> no se genera la hoja

    const filas: FilaSecuencia[] = filasDoc.map(f => {
      const cod = codigoDeEntrega(f)
      const enMaestro = maestroRuta.find(m => mismoCodigo(m.codigo, cod))
      if (reordena && !enMaestro) {
        avisos.push(
          `${bloque.ruta}: el código ${cod} (${f.cod}) no está en el maestro de secuencia${usaDia ? ` de ${diaEntrega}` : ''}; queda al final.`
        )
      }
      return {
        cod,
        secuencia: enMaestro ? enMaestro.secuencia : null,
        nota: f.cod,
        // Orden de las 5 columnas CANT confirmado contra el archivo de Rafa:
        // canal, víscera roja, víscera blanca, cabeza, patas.
        canal: f.cant,
        roja: f.vr,
        blanca: f.vb,
        cabeza: f.cabeza ?? 0,
        patas: f.patas ?? 0,
      }
    })

    // El entregable sale ordenado por SECUENCIA de menor a mayor. Los códigos sin
    // secuencia van al final (no se pierden). Las rutas que no reordenan quedan
    // como vienen: ahí el orden lo pone el cliente.
    if (reordena) {
      filas.sort((a, b) => {
        const sa = a.secuencia ?? Number.POSITIVE_INFINITY
        const sb = b.secuencia ?? Number.POSITIVE_INFINITY
        if (sa !== sb) return sa - sb
        return a.nota < b.nota ? -1 : a.nota > b.nota ? 1 : 0 // desempate estable
      })
    }

    if (reordena && maestroRuta.length === 0) {
      avisos.push(`${bloque.ruta}: no hay maestro de secuencia cargado${usaDia ? ` para ${diaEntrega}` : ''}; la hoja sale sin ordenar.`)
    }

    hojas.push({ ruta: bloque.ruta, dia, reordena, maestro: maestroRuta, filas })
  }

  return { fecha: doc.fecha, diaEntrega, hojas, avisos }
}

// ── Consulta del maestro ─────────────────────────────────────────────────────

/** Trae el maestro completo. Nunca lanza: si falla devuelve [] y lo avisa. */
export async function fetchMaestroSecuencia(): Promise<MaestroRow[]> {
  const { data, error } = await supabase
    .from('secuencia_entrega')
    .select('ruta, ciudad, dia, codigo, secuencia')
    .order('ruta', { ascending: true })
    .order('secuencia', { ascending: true })

  if (error) {
    console.error('[secuenciaEntrega] Error consultando secuencia_entrega:', error)
    return []
  }
  return (data ?? []) as MaestroRow[]
}

// ── Excel ────────────────────────────────────────────────────────────────────

const BORDE = { style: 'thin', color: { rgb: '000000' } }
const BORDES = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE }
const cabecera = (fill: string) => ({
  font: { name: 'Calibri', sz: 11, bold: true },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDES,
  fill: { patternType: 'solid', fgColor: { rgb: fill } },
})
const S = {
  encMaestro: cabecera('C8C8C8'),
  encCaptura: cabecera('FFFF00'),
  celda: { font: { name: 'Calibri', sz: 11 }, alignment: { vertical: 'center' }, border: BORDES },
  celdaNum: { font: { name: 'Calibri', sz: 11 }, alignment: { horizontal: 'center', vertical: 'center' }, border: BORDES },
}

/**
 * Nombre de hoja válido para Excel: sin / \ ? * [ ] : y máximo 31 caracteres.
 * Las rutas llevan "/" ('Remedios/Segovia'), que Excel NO acepta en el nombre.
 */
export function nombreHojaValido(ruta: string): string {
  return sinTildes(ruta).replace(/[/\\?*[\]:]/g, '-').slice(0, 31)
}

type Celda = { v: string | number; t: 's' | 'n'; s?: unknown }

function hojaAWorksheet(h: HojaSecuencia): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  const bag = ws as Record<string, unknown>
  let maxR = 0
  const put = (r: number, c: number, celda: Celda) => {
    bag[XLSX.utils.encode_cell({ r, c })] = celda
    if (r > maxR) maxR = r
  }
  const txt = (v: string, s: unknown = S.celda): Celda => ({ v, t: 's', s })
  const num = (v: number, s: unknown = S.celdaNum): Celda => ({ v, t: 'n', s })

  // ── Bloque maestro (izquierda). Con columna DIA solo si la ruta la usa. ──
  const conDia = h.dia != null
  const encMaestro = conDia ? ['CIUDAD', 'DIA', 'CODIGO', 'SECUENCIA'] : ['CIUDAD', 'CODIGO', 'SECUENCIA']
  encMaestro.forEach((t, i) => put(0, i, txt(t, S.encMaestro)))
  h.maestro.forEach((m, i) => {
    const r = i + 1
    let c = 0
    put(r, c++, txt(m.ciudad ?? ''))
    if (conDia) put(r, c++, txt(m.dia ?? ''))
    put(r, c++, txt(m.codigo))
    put(r, c, num(m.secuencia))
  })

  // ── Bloque captura (derecha), separado por una columna vacía ──
  const c0 = encMaestro.length + 1
  const encCaptura = ['COD', 'SECUENCIA', 'NOTA', 'CANT', 'CANT', 'CANT', 'CANT', 'CANT']
  encCaptura.forEach((t, i) => put(0, c0 + i, txt(t, S.encCaptura)))
  h.filas.forEach((f, i) => {
    const r = i + 1
    put(r, c0 + 0, txt(f.cod))
    // Sin secuencia -> celda vacía, igual que el IFERROR(...;"") del archivo de Rafa.
    put(r, c0 + 1, f.secuencia == null ? txt('') : num(f.secuencia))
    put(r, c0 + 2, txt(f.nota))
    put(r, c0 + 3, num(f.canal))
    put(r, c0 + 4, num(f.roja))
    put(r, c0 + 5, num(f.blanca))
    put(r, c0 + 6, num(f.cabeza))
    put(r, c0 + 7, num(f.patas))
  })

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: c0 + 7 } })
  const cols = conDia
    ? [{ wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 3 }]
    : [{ wch: 18 }, { wch: 10 }, { wch: 11 }, { wch: 3 }]
  ws['!cols'] = [...cols, { wch: 10 }, { wch: 11 }, { wch: 38 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }]
  return ws
}

/**
 * Genera el .xlsx de secuencia: una hoja por ruta, con el bloque de captura ya
 * ordenado. El nombre del archivo usa la fecha de DESPACHO (la que se eligió en
 * pantalla), igual que el Documento de ruta.
 */
export function exportarSecuenciaEntrega(sec: SecuenciaDia): void {
  const wb = XLSX.utils.book_new()
  for (const h of sec.hojas) {
    XLSX.utils.book_append_sheet(wb, hojaAWorksheet(h), nombreHojaValido(h.ruta))
  }
  if (sec.hojas.length === 0) {
    // Un libro sin hojas revienta al escribir: se deja una hoja explicativa.
    const ws = XLSX.utils.aoa_to_sheet([['Sin despachos con secuencia para esta fecha']])
    XLSX.utils.book_append_sheet(wb, ws, 'Sin datos')
  }
  XLSX.writeFile(wb, `Secuencia de entrega ${sec.fecha}.xlsx`)
}
