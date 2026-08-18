import { supabase } from './supabase'
import type { ResolverOrdenManual, ResultadoGuardado } from './documentoRuta'

// ════════════════════════════════════════════════════════════════
// ORDEN MANUAL DE LAS CUADRÍCULAS DEL DOCUMENTO DE RUTA
// ════════════════════════════════════════════════════════════════
// Rafa arrastra las filas con el mouse para acomodarlas como va a entregar.
// Este módulo es el ÚNICO que habla con `orden_documento_ruta`
// (ver migracion_orden_documento_ruta.sql).
//
// El override NO reemplaza el orden natural: lo pisa solo donde hay algo
// guardado. Quién ordena qué, en orden de prioridad:
//   1. este override, para las filas que Rafa movió en ESTE documento;
//   2. la secuencia de entrega del maestro (secuenciaEntrega.ts), en regionales;
//   3. compararFila() (documentoRuta.ts), como desempate determinista.
// Los escalones 2 y 3 siguen intactos: ver seccionDe() en documentoRuta.ts.
//
// El alcance es POR DOCUMENTO (fecha_entrega) y POR CUADRÍCULA
// (ruta + carro + tipo de carne). Reordenar la tabla del 8 no toca la del 9, y
// mover BOVINOS de un carro externo no mueve sus PORCINOS ni los otros carros.

/** Tipos de carne = las dos sub-tablas de cada bloque (BOVINOS / PORCINOS). */
export type TipoCarne = 'res' | 'cerdo'

/**
 * Identidad de una CUADRÍCULA. Es claveBloque() (ruta + carro) más el tipo de
 * carne, porque cada bloque dibuja DOS tablas y cada una se ordena por su lado.
 * La usan la lectura, la escritura y el indicador de "guardando" de la pantalla,
 * para que no puedan discrepar.
 */
export function claveSeccionOrden(ruta: string, carroId: string | null, tipoCarne: TipoCarne): string {
  return `${ruta}|${carroId ?? ''}|${tipoCarne}`
}

/** Una fila de `orden_documento_ruta` tal como vuelve de la consulta. */
export type OrdenRow = {
  ruta: string
  carro_id: string | null
  tipo_carne: TipoCarne
  fila_key: string
  posicion: number
}

/**
 * Indexa las filas guardadas por cuadrícula y devuelve el resolver que consume
 * armarDocumento(). Parte PURA (sin Supabase) para poder probarla, igual que
 * crearResolverSecuencia() en secuenciaEntrega.ts.
 */
export function crearResolverOrden(filas: OrdenRow[]): ResolverOrdenManual {
  // cuadrícula -> (fila_key -> posición). Se arma UNA vez y seccionDe() pide su
  // mapa entero de un saque, así que ordenar una sección no recorre el resto.
  const porSeccion = new Map<string, Map<string, number>>()
  for (const r of filas) {
    const clave = claveSeccionOrden(r.ruta, r.carro_id ?? '', r.tipo_carne)
    let mapa = porSeccion.get(clave)
    if (!mapa) {
      mapa = new Map()
      porSeccion.set(clave, mapa)
    }
    mapa.set(r.fila_key, r.posicion)
  }
  return (ruta, carroId, tipoCarne) =>
    // ruta null = el balde de "sin ruta asignada", que no se reordena.
    ruta == null ? null : porSeccion.get(claveSeccionOrden(ruta, carroId, tipoCarne)) ?? null
}

/**
 * Lo que devuelve la lectura. `resolver` es lo que consume armarDocumento();
 * `error` es el mensaje del motor cuando la consulta falla —típicamente porque
 * la migración no se corrió—, para que la pantalla lo pueda avisar en vez de
 * quedarse en silencio sin reordenar.
 */
export type OrdenManualCargado = { resolver: ResolverOrdenManual; error: string | null }

/** Resolver que no reordena nada: TODAS las cuadrículas caen a su orden natural. */
const SIN_ORDEN: ResolverOrdenManual = () => null

/**
 * Trae el orden manual de UN documento (una consulta por refresco) y lo deja
 * indexado por cuadrícula.
 *
 * Nunca lanza: si la tabla no existe o la consulta falla, devuelve el resolver
 * vacío y el mensaje. El documento se arma igual, con su orden de siempre.
 *
 * Un resultado VACÍO no es un error y no avisa nada: es el caso normal —un
 * documento que Rafa todavía no reordenó—. Por eso la distinción entre "vacío"
 * y "falló" viaja en `error` y no en el tamaño del resultado.
 */
export async function fetchOrdenManual(fechaEntrega: string): Promise<OrdenManualCargado> {
  const { data, error } = await supabase
    .from('orden_documento_ruta')
    .select('ruta, carro_id, tipo_carne, fila_key, posicion')
    .eq('fecha_entrega', fechaEntrega)

  if (error) {
    console.error('[ordenDocumento] Error consultando orden_documento_ruta:', error)
    return { resolver: SIN_ORDEN, error: error.message }
  }

  return { resolver: crearResolverOrden((data ?? []) as OrdenRow[]), error: null }
}

/**
 * Guarda el orden de UNA cuadrícula. `filaKeys` es la cuadrícula COMPLETA ya
 * reordenada, y se escribe con posiciones 0..n-1.
 *
 * Se reescribe entera y no solo las filas que se movieron, por dos motivos:
 *   · un solo upsert por soltada (un viaje a la base, no uno por fila movida);
 *   · después del primer arrastre TODAS las filas de esa cuadrícula tienen
 *     posición, así que un código despachado más tarde —que no la tiene— cae
 *     al final sin ambigüedad, que es justo la regla que pidió Rafa.
 *
 * Nunca lanza: el fallo vuelve en el resultado para que la pantalla lo muestre.
 */
export async function guardarOrdenSeccion(
  fechaEntrega: string,
  ruta: string,
  carroId: string | null,
  tipoCarne: TipoCarne,
  filaKeys: string[]
): Promise<ResultadoGuardado> {
  if (filaKeys.length === 0) return { ok: true }

  const filas = filaKeys.map((fila_key, posicion) => ({
    fecha_entrega: fechaEntrega,
    ruta,
    carro_id: carroId ?? '', // '' y no NULL: entra en el UNIQUE del onConflict
    tipo_carne: tipoCarne,
    fila_key,
    posicion,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('orden_documento_ruta')
    .upsert(filas, { onConflict: 'fecha_entrega,ruta,carro_id,tipo_carne,fila_key' })

  if (error) {
    console.error('[ordenDocumento] Error guardando el orden de la cuadrícula:', error)
    return { ok: false, mensaje: error.message }
  }
  return { ok: true }
}
