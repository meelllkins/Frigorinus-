import * as XLSX from 'xlsx'
import type {
  DocumentoDia,
  BloqueRuta,
  SeccionDocumento,
  FilaDocumento,
  DatosManuales,
} from './documentoRuta'

// Mismo patrón de xlsx del resto del proyecto (Despachos/Inventario/etc.):
// aoa_to_sheet + !cols + book_append_sheet + writeFile. Sin estilos (`s`): la
// versión gratuita de SheetJS no los escribe. Sin librerías nuevas.

type Celda = string | number | null
type Matriz = Celda[][]

// Día de la semana en español + fecha, igual criterio que la pantalla.
function fechaLarga(fecha: string): string {
  const d = new Date(fecha + 'T00:00:00')
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// Filas de datos de una sección. Números como number (Excel los suma); COD como texto.
// cabeza/patas en null quedan como celda vacía (no 0) — aoa_to_sheet omite las celdas null.
function filasSeccion(seccion: SeccionDocumento, conCP: boolean): Matriz {
  return seccion.filas.map(f =>
    conCP ? [f.cod, f.cant, f.vb, f.vr, f.cabeza, f.patas] : [f.cod, f.cant, f.vb, f.vr]
  )
}

// Fila TOTAL: los totales de la sección van como números aunque la sección esté vacía (ceros).
function totalSeccion(seccion: SeccionDocumento, conCP: boolean): Celda[] {
  const t = seccion.totales
  return conCP ? ['TOTAL', t.cant, t.vb, t.vr, t.cabeza, t.patas] : ['TOTAL', t.cant, t.vb, t.vr]
}

/**
 * Matriz de UN bloque. Se mantiene separada de la función que apila: si algún día
 * los bloques van lado a lado en vez de uno debajo del otro, solo cambia el apilador.
 * `manual` es el estado EN PANTALLA (puede traer texto aún no guardado).
 */
export function bloqueAMatriz(bloque: BloqueRuta, fecha: string, manual: DatosManuales | null): Matriz {
  const m = manual
  const filas: Matriz = []

  filas.push([bloque.ruta])
  filas.push([fechaLarga(fecha)])
  filas.push(['CONDUCTOR', m?.conductor ?? null, 'AUXILIAR', m?.auxiliar ?? null])
  filas.push(['HORA PROGRAMADA', m?.horaProgramada ?? null, 'PLACA', m?.placa ?? null])
  filas.push([])

  filas.push(['BOVINOS'])
  filas.push(['COD', 'CANT', 'V/B', 'V/R', 'CABEZA', 'PATAS'])
  filas.push(...filasSeccion(bloque.bovinos, true))
  filas.push(totalSeccion(bloque.bovinos, true))
  filas.push([])

  filas.push(['PORCINOS'])
  filas.push(['COD', 'CANT', 'V/B', 'V/R'])
  filas.push(...filasSeccion(bloque.porcinos, false))
  filas.push(totalSeccion(bloque.porcinos, false))
  filas.push([])

  filas.push(['OBSERVACIÓN'])
  filas.push([m?.observacion ?? null])

  return filas
}

// Apila los bloques uno debajo del otro, separados por dos filas vacías.
function apilarBloques(matrices: Matriz[]): Matriz {
  const out: Matriz = []
  matrices.forEach((mat, i) => {
    if (i > 0) {
      out.push([])
      out.push([])
    }
    out.push(...mat)
  })
  return out
}

// Hoja aparte con los despachos sin ruta (misma forma que una sección de bovinos).
function hojaSinRuta(sinRuta: FilaDocumento[]): Matriz {
  const filas: Matriz = [['COD', 'CANT', 'V/B', 'V/R', 'CABEZA', 'PATAS']]
  for (const f of sinRuta) filas.push([f.cod, f.cant, f.vb, f.vr, f.cabeza, f.patas])
  return filas
}

// Ancho de columnas a partir del contenido (COD y textos manuales legibles sin estirar).
function anchosColumnas(matriz: Matriz): { wch: number }[] {
  const nCols = matriz.reduce((max, r) => Math.max(max, r.length), 0)
  const cols: { wch: number }[] = []
  for (let c = 0; c < nCols; c++) {
    let ancho = 10 // mínimo cómodo
    for (const r of matriz) {
      const v = r[c]
      const len = v == null ? 0 : String(v).length
      if (len + 2 > ancho) ancho = len + 2
    }
    cols.push({ wch: ancho })
  }
  return cols
}

/**
 * Exporta el documento del día a un .xlsx.
 * `manualEnPantalla` son los datos manuales tal como están en el estado local de la
 * pantalla (Map ruta -> DatosManuales): así se exporta lo que Rafa ve aunque no haya
 * sacado el foco de un campo. Sin estilos, sin librerías nuevas.
 */
export function exportarDocumentoRuta(doc: DocumentoDia, manualEnPantalla: Map<string, DatosManuales>): void {
  const wb = XLSX.utils.book_new()

  // Hoja principal: bloques apilados en el orden de doc.bloques ('Externo' ya viene de último).
  const matrices = doc.bloques.map(b =>
    bloqueAMatriz(b, doc.fecha, manualEnPantalla.get(b.ruta) ?? b.manual ?? null)
  )
  const principal = apilarBloques(matrices)
  const wsPrincipal = XLSX.utils.aoa_to_sheet(principal)
  wsPrincipal['!cols'] = anchosColumnas(principal)
  XLSX.utils.book_append_sheet(wb, wsPrincipal, doc.fecha)

  // Hoja "Sin ruta" solo si hay despachos sin ruta (van aparte, no son parte del documento que se entrega).
  if (doc.sinRuta.length > 0) {
    const matSin = hojaSinRuta(doc.sinRuta)
    const wsSin = XLSX.utils.aoa_to_sheet(matSin)
    wsSin['!cols'] = anchosColumnas(matSin)
    XLSX.utils.book_append_sheet(wb, wsSin, 'Sin ruta')
  }

  XLSX.writeFile(wb, `Documento de ruta ${doc.fecha}.xlsx`)
}
