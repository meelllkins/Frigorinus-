import { supabase } from './supabase'

// ════════════════════════════════════════════════════════════════
// REMISIÓN DE SALIDA DE DESPACHOS
// ════════════════════════════════════════════════════════════════
// El formato de papel que Rafa llena a mano, guardado en Supabase para archivo
// permanente. Este módulo es el ÚNICO que habla con `remisiones` y
// `remisiones_filas` (ver SQL's/migracion_remisiones.sql).
//
// Es una sección APARTE: nada de acá lee despachos ni documentos_ruta, y nada
// se auto-llena. Rafa escribe las celdas de cero, tal como las escribe en el
// papel, y por eso TODA celda de fila es string libre (`canastillas` trae cosas
// como "V. Blancas 3 V. Rojas 3 Cabezas 3"). Ninguna se parsea como número.
//
// Dos reglas de negocio viven acá y no en la base:
//   · el correlativo (ver proximoFolio / crearRemision);
//   · el candado de edición: solo se puede tocar la remisión de HOY
//     (ver puedeEditarse). Es lo único en este módulo que impide escribir.

/** Encabezado de una remisión, tal como vuelve de la consulta. */
export type Remision = {
  id: string
  /**
   * PRIMER folio del rango que ocupa esta remisión. La hoja N impresa lleva
   * `folio_inicio + N`, y el rango entero es
   * [folio_inicio, folio_inicio + hojas_reservadas - 1].
   */
  folio_inicio: number
  /** Cuántas hojas se le reservaron al crearla. No se recalcula nunca. */
  hojas_reservadas: number
  fecha: string // YYYY-MM-DD
  conductor: string | null
  /** Cédula del conductor. TEXT: en el papel es un renglón a mano. */
  cedula: string | null
  placa: string | null
  firma_responsable: string | null
  firma_conductor: string | null
  created_at?: string
}

/**
 * Una fila de la tabla de la remisión. Todas las celdas son string a propósito:
 * son texto libre en el papel (ver el comentario de cabecera y la migración).
 * `es_total` marca la fila TOTAL del pie, que en el papel también se escribe a
 * mano y por eso es una fila más y no una columna calculada.
 */
export type RemisionFila = {
  id: string
  remision_id: string
  orden: number
  cliente: string | null
  producto: string | null
  und_kg: string | null
  canastillas: string | null
  destino: string | null
  firma_recibido: string | null
  es_total: boolean
}

/** Lo que escribe la pantalla: una fila sin los campos que pone la base. */
export type RemisionFilaEntrada = {
  cliente?: string | null
  producto?: string | null
  und_kg?: string | null
  canastillas?: string | null
  destino?: string | null
  firma_recibido?: string | null
  es_total?: boolean
}

/**
 * Lo que escribe la pantalla para el encabezado + sus filas.
 *
 * `folio_inicial` solo se usa en la PRIMERA remisión de la historia, cuando
 * todavía no hay contador y Rafa teclea el folio de su talonario. De ahí en
 * adelante va null y el folio lo asigna el contador del lado de la base — la
 * pantalla ya no elige número.
 */
export type RemisionEntrada = {
  folio_inicial: number | null
  fecha: string // YYYY-MM-DD
  conductor?: string | null
  cedula?: string | null
  placa?: string | null
  firma_responsable?: string | null
  firma_conductor?: string | null
  filas: RemisionFilaEntrada[]
}

/** Encabezado + filas ya ordenadas, lo que devuelve obtenerRemision(). */
export type RemisionCompleta = { remision: Remision; filas: RemisionFila[] }

/**
 * Resultado de una escritura. Mismo tipo que ResultadoGuardado en
 * documentoRuta.ts: en el fallo viaja el mensaje, que es lo único que distingue
 * "no hay red" de "la migración no se corrió" o "la remisión no es de hoy".
 */
export type ResultadoRemision = { ok: true } | { ok: false; mensaje: string }

const COLS_ENCABEZADO =
  'id, folio_inicio, hojas_reservadas, fecha, conductor, cedula, placa, firma_responsable, firma_conductor, created_at'
const COLS_FILA =
  'id, remision_id, orden, cliente, producto, und_kg, canastillas, destino, firma_recibido, es_total'

/**
 * Cuántas filas de datos entran en una hoja impresa junto con el encabezado y
 * el pie completos. La plantilla parte las filas en bloques de este tamaño —un
 * bloque = una hoja— y la reserva de folios cuenta las hojas con el mismo
 * número.
 *
 * Medido sobre la hoja carta VERTICAL con márgenes de 0.6cm (26.74cm útiles de
 * alto), imprimiendo la plantilla real a PDF con Edge headless. El peor caso
 * es el que manda: las 6 columnas envolviendo a dos líneas en TODAS las filas,
 * que es lo que sale cuando Rafa escribe nombres de cliente y productos largos.
 *
 * Pasó de 8 a 10 al apretar el espaciado del cuadro (ver la nota grande en
 * index.css, dentro de @media print). El tamaño de fuente NO se tocó: lo que
 * se achicó es padding de celda (0.25 -> 0.15rem), line-height (1.375 -> 1.25)
 * y los márgenes entre encabezado, cuadro y firmas.
 *   · antes:   8 filas = 25.29cm -> sobraban 1.44cm  (9 se pasaban por 0.30cm)
 *   · ahora:  10 filas = 25.56cm -> sobran  1.18cm  (11 se pasan por 0.35cm)
 * Con celdas de una línea entrarían bastantes más, pero ese número solo aguanta
 * mientras nada envuelva; el colchón de 1.18cm son ~2 líneas extra, para que
 * una celda que envuelva a TRES siga entrando.
 *
 * No se estira a 11 a propósito: ahí el sobrante cae a 0.02cm, y si un bloque
 * no entra en su hoja el navegador lo parte al medio — esa hoja física de más
 * NO tiene folio reservado y el número impreso deja de corresponder al papel.
 * Ese riesgo es peor que dejar unos centímetros en blanco.
 *
 * ⚠️ Está DUPLICADO en remision_crear_con_folio() (el valor vigente lo deja
 * SQL's/migracion_filas_por_hoja_10.sql), que es quien reserva el rango del
 * lado de la base. Si cambia el alto del encabezado o del pie y entra otra
 * cantidad de filas por hoja, hay que cambiarlo en los dos lados o la reserva
 * deja de coincidir con lo que sale en papel.
 */
export const FILAS_POR_HOJA = 10

/**
 * Cuántas hojas ocupa una remisión con esa cantidad de filas de CLIENTE (la
 * fila TOTAL no cuenta: va en el pie, que se repite entero en cada hoja).
 *
 * Nunca menos de 1: una remisión sin filas igual se imprime, con su encabezado
 * y sus firmas.
 */
export function hojasNecesarias(filasDeCliente: number): number {
  return Math.max(1, Math.ceil(filasDeCliente / FILAS_POR_HOJA))
}

/** Las filas de cliente de un arreglo de entrada (sin la fila TOTAL). */
function contarFilasDeCliente(filas: RemisionFilaEntrada[]): number {
  return filas.filter(f => !f.es_total).length
}

/**
 * "Hoy" en fecha LOCAL, como YYYY-MM-DD. Misma función que usan Beneficios,
 * Despachos y CobrosFrio: se compara contra `remisiones.fecha`, que es DATE y
 * vuelve con ese mismo formato. No usar `new Date()` pelado ni toISOString()
 * —eso da UTC y de noche cambia de día antes que el calendario de Rafa—.
 */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * El candado de edición: una remisión se puede corregir o borrar SOLO el mismo
 * día en que se hizo. Después queda archivada tal cual, que es el punto de
 * guardarla (el papel tampoco se reescribe una semana después).
 *
 * Pura y exportada para que R2 pueda decidir si muestra los botones de editar y
 * borrar sin tener que intentar la escritura y comerse el error.
 */
export function puedeEditarse(fecha: string): boolean {
  return fecha === localToday()
}

/** El mensaje del candado. Uno solo, para que la pantalla y el log no discrepen. */
function mensajeCandado(fecha: string): string {
  return `Esta remisión es del ${fecha} y solo se puede modificar el mismo día en que se hizo (hoy es ${localToday()}).`
}

/**
 * El folio con el que arrancaría la próxima remisión, o null si el contador
 * todavía no está sembrado (no se creó ninguna remisión nunca).
 *
 * El null es información, no un fallo: le dice a la pantalla que esta es la
 * PRIMERÍSIMA remisión y que tiene que pedirle a Rafa el folio de su talonario
 * de papel. De ahí en adelante el contador ya existe, el campo va de solo
 * lectura y el número lo asigna la base. Ningún folio inicial está hardcodeado
 * ni acá ni en la migración: el primero lo pone Rafa.
 *
 * Es solo para MOSTRAR. El folio de verdad lo reserva el RPC al crear, sobre
 * la fila del contador bloqueada — entre que esto se consulta y que se guarda,
 * otra remisión pudo llevarse el rango, y en ese caso lo que se guarda es el
 * folio correcto, no este.
 *
 * Si la consulta falla también devuelve null: la pantalla pide el número a
 * mano en vez de mostrar uno inventado. El fallo queda en el log.
 */
export async function proximoFolio(): Promise<number | null> {
  const { data, error } = await supabase
    .from('contador_folios')
    .select('siguiente_folio')
    .maybeSingle()

  if (error) {
    console.error('[remisiones] Error consultando el contador de folios:', error)
    return null
  }

  return (data as { siguiente_folio: number } | null)?.siguiente_folio ?? null
}

/**
 * Lista de encabezados (sin filas) ordenada por folio DESC, para la vista
 * lista/archivo de R2/R3. El filtro de fechas es inclusivo en los dos extremos
 * y cada extremo es opcional: sin filtro trae todo el archivo.
 *
 * Nunca lanza: si falla devuelve [] y lo deja en el log. La pantalla muestra la
 * lista vacía, que es lo mismo que ve cuando de verdad no hay remisiones — la
 * diferencia entre "vacío" y "falló" no le cambia nada a R2 en una vista de
 * solo lectura.
 */
export async function listarRemisiones(
  filtro?: { desde?: string; hasta?: string }
): Promise<Remision[]> {
  let q = supabase.from('remisiones').select(COLS_ENCABEZADO)
  if (filtro?.desde) q = q.gte('fecha', filtro.desde)
  if (filtro?.hasta) q = q.lte('fecha', filtro.hasta)

  const { data, error } = await q.order('folio_inicio', { ascending: false })

  if (error) {
    console.error('[remisiones] Error listando remisiones:', error)
    return []
  }
  return (data ?? []) as Remision[]
}

/**
 * Cuántas filas de CLIENTE tiene cada remisión, por id. La fila TOTAL no cuenta:
 * es el pie del cuadro, no un despacho.
 *
 * Existe para que la lista pueda mostrar ese número sin abrir cada remisión (una
 * consulta para todas, no una por fila) y sin que la pantalla toque
 * `remisiones_filas` por su cuenta — este módulo sigue siendo el único que habla
 * con esas tablas.
 *
 * Si falla devuelve un mapa vacío: la lista muestra 0 y se sigue viendo. Nunca lanza.
 */
export async function contarFilasPorRemision(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {}

  const { data, error } = await supabase
    .from('remisiones_filas')
    .select('remision_id')
    .in('remision_id', ids)
    .eq('es_total', false)

  if (error) {
    console.error('[remisiones] Error contando filas:', error)
    return {}
  }

  const conteo: Record<string, number> = {}
  for (const f of (data ?? []) as { remision_id: string }[]) {
    conteo[f.remision_id] = (conteo[f.remision_id] ?? 0) + 1
  }
  return conteo
}

/**
 * Una remisión con sus filas ordenadas por `orden`. null si no existe o si la
 * consulta falla; el log distingue los dos casos. Nunca lanza.
 *
 * Dos consultas y no un select anidado: el anidado de PostgREST no garantiza el
 * orden de las filas hijas, y acá el orden ES el dato (la fila TOTAL va última).
 */
export async function obtenerRemision(id: string): Promise<RemisionCompleta | null> {
  const { data: cab, error: errCab } = await supabase
    .from('remisiones')
    .select(COLS_ENCABEZADO)
    .eq('id', id)
    .maybeSingle()

  if (errCab) {
    console.error('[remisiones] Error consultando la remisión:', errCab)
    return null
  }
  if (!cab) return null

  const { data: filas, error: errFilas } = await supabase
    .from('remisiones_filas')
    .select(COLS_FILA)
    .eq('remision_id', id)
    .order('orden', { ascending: true })

  if (errFilas) {
    console.error('[remisiones] Error consultando las filas de la remisión:', errFilas)
    return null
  }

  return { remision: cab as Remision, filas: (filas ?? []) as RemisionFila[] }
}

/** Normaliza las celdas de entrada a las columnas de la tabla. '' -> null. */
function celdasFila(f: RemisionFilaEntrada, orden: number) {
  return {
    orden, // la posición en el arreglo ES el orden; la pantalla no lo manda
    cliente: f.cliente || null,
    producto: f.producto || null,
    und_kg: f.und_kg || null,
    canastillas: f.canastillas || null,
    destino: f.destino || null,
    firma_recibido: f.firma_recibido || null,
    es_total: f.es_total ?? false,
  }
}

/**
 * Reemplaza TODAS las filas de una remisión ya creada, en una sola
 * transacción del lado de Postgres (RPC `remision_reemplazar_filas`, ver
 * SQL's/migracion_remisiones_reemplazar_filas.sql).
 *
 * Por qué RPC y no un delete()+insert() desde acá: supabase-js no expone
 * BEGIN/COMMIT al cliente, cada llamada es su propia transacción. Si el
 * borrado entrara y el insert fallara a mitad de camino en dos llamadas
 * separadas, la remisión quedaría sin filas. Empaquetado en una función, si
 * el INSERT lanza excepción Postgres deshace también el DELETE: no se pierde
 * lo que ya estaba.
 */
async function reemplazarFilas(
  remisionId: string,
  filas: RemisionFilaEntrada[]
): Promise<string | null> {
  const { error } = await supabase.rpc('remision_reemplazar_filas', {
    p_remision_id: remisionId,
    p_filas: filas.map((f, orden) => celdasFila(f, orden)),
  })
  if (error) {
    console.error('[remisiones] Error reemplazando las filas:', error)
    return error.message
  }
  return null
}

/**
 * Crea una remisión —encabezado, filas y reserva del rango de folios— en UNA
 * sola transacción del lado de Postgres (RPC `remision_crear_con_folio`, ver
 * SQL's/migracion_folios_remision.sql).
 *
 * EL RANGO DE FOLIOS: la remisión no ocupa un número sino un tramo, porque en
 * papel cada hoja que Rafa arranca del talonario es un folio distinto. El RPC
 * cuenta las filas de cliente, calcula las hojas con el mismo criterio que
 * hojasNecesarias() de acá arriba, y avanza el contador ese tanto — todo con
 * la fila del contador bloqueada (FOR UPDATE), así que dos creaciones
 * simultáneas no pueden llevarse el mismo tramo.
 *
 * Por eso ya no hay MAX+1 ni reintento por choque de UNIQUE: no hay carrera
 * que perder. Y tampoco hay rollback manual del encabezado —como cuando esto
 * eran dos llamadas separadas—, porque si las filas fallan Postgres deshace la
 * transacción entera, incluido el avance del contador.
 *
 * El folio inicial solo viaja en la PRIMERA remisión de la historia, cuando el
 * contador todavía no está sembrado; el RPC lo usa para sembrarlo. De ahí en
 * adelante `datos.folio_inicial` va null y el número lo decide la base.
 *
 * No lanza: el fallo vuelve en el resultado.
 */
export async function crearRemision(
  datos: RemisionEntrada
): Promise<
  | { ok: true; id: string; folio_inicio: number; hojas_reservadas: number }
  | { ok: false; mensaje: string }
> {
  const { data, error } = await supabase.rpc('remision_crear_con_folio', {
    p_fecha: datos.fecha,
    p_filas: datos.filas.map((f, orden) => celdasFila(f, orden)),
    p_conductor: datos.conductor || null,
    p_cedula: datos.cedula || null,
    p_placa: datos.placa || null,
    p_firma_responsable: datos.firma_responsable || null,
    p_firma_conductor: datos.firma_conductor || null,
    p_folio_inicial: datos.folio_inicial ?? null,
  })

  if (error) {
    console.error('[remisiones] Error creando la remisión:', error)
    return { ok: false, mensaje: error.message }
  }

  const creada = data as { id: string; folio_inicio: number; hojas_reservadas: number }
  return {
    ok: true,
    id: creada.id,
    folio_inicio: creada.folio_inicio,
    hojas_reservadas: creada.hojas_reservadas,
  }
}

/**
 * Corrige una remisión: encabezado + reemplazo completo de las filas.
 *
 * CANDADO: solo si la remisión es de HOY (puedeEditarse). Si no, rechaza y NO
 * escribe nada — es el único caso de este módulo en que la función impide
 * escribir en vez de solo reportar. La fecha se lee de la BASE y no de `datos`:
 * mandar una fecha vieja no puede saltarse el candado, y cambiarla tampoco lo
 * reabre (se valida contra la fecha guardada antes de tocar nada).
 *
 * Las filas se reemplazan (borrar + insertar, ver reemplazarFilas) y no se
 * hace diff: son texto libre sin identidad propia —una celda corregida y una
 * fila nueva son lo mismo— y el orden se recalcula entero. El reemplazo pasa
 * entero por una función de Postgres (RPC) para que sea una sola transacción:
 * si el insert de las filas nuevas fallara, el delete de las viejas también
 * se deshace, y no puede quedar a medias de forma inconsistente.
 *
 * `folio_inicio` y `hojas_reservadas` no se tocan NUNCA: el rango se reservó
 * al crear y los folios ya podrían estar impresos en papel.
 *
 * EL SEGUNDO CANDADO: si las filas nuevas necesitaran más hojas de las
 * reservadas, se rechaza. No se amplía el rango porque los folios que siguen
 * ya se los llevó otra remisión —el contador avanzó— y estirarlo pisaría hojas
 * ajenas. Quitar filas sí se permite: deja hojas reservadas sin usar, que es el
 * precio aceptado de reservar por adelantado.
 */
export async function actualizarRemision(
  id: string,
  datos: Omit<RemisionEntrada, 'folio_inicial'>
): Promise<ResultadoRemision> {
  const { data: actual, error: errLectura } = await supabase
    .from('remisiones')
    .select('fecha, hojas_reservadas')
    .eq('id', id)
    .maybeSingle()

  if (errLectura) {
    console.error('[remisiones] Error leyendo la remisión antes de actualizar:', errLectura)
    return { ok: false, mensaje: errLectura.message }
  }
  if (!actual) return { ok: false, mensaje: 'La remisión ya no existe.' }

  const guardada = actual as { fecha: string; hojas_reservadas: number }
  if (!puedeEditarse(guardada.fecha)) {
    // Rechazo, no error de sistema: es la regla funcionando. Sale como warn
    // para que no se confunda con un fallo en el log.
    console.warn('[remisiones] Edición bloqueada por fecha:', id, guardada.fecha)
    return { ok: false, mensaje: mensajeCandado(guardada.fecha) }
  }

  const hojas = hojasNecesarias(contarFilasDeCliente(datos.filas))
  if (hojas > guardada.hojas_reservadas) {
    console.warn(
      '[remisiones] Edición bloqueada por hojas:', id,
      'necesita', hojas, 'reservadas', guardada.hojas_reservadas
    )
    return {
      ok: false,
      mensaje: `Esta remisión ya tiene ${guardada.hojas_reservadas} ${guardada.hojas_reservadas === 1 ? 'hoja reservada' : 'hojas reservadas'} — para más filas, creá una remisión nueva.`,
    }
  }

  const { error: errCab } = await supabase
    .from('remisiones')
    .update({
      fecha: datos.fecha,
      conductor: datos.conductor || null,
      cedula: datos.cedula || null,
      placa: datos.placa || null,
      firma_responsable: datos.firma_responsable || null,
      firma_conductor: datos.firma_conductor || null,
    })
    .eq('id', id)

  if (errCab) {
    console.error('[remisiones] Error actualizando el encabezado:', errCab)
    return { ok: false, mensaje: errCab.message }
  }

  const errFilas = await reemplazarFilas(id, datos.filas)
  if (errFilas) return { ok: false, mensaje: errFilas }

  return { ok: true }
}

/**
 * Borra una remisión. Mismo candado de fecha que actualizarRemision: solo la
 * de hoy, leyendo la fecha de la base.
 *
 * Borra SOLO el encabezado: las filas se van por ON DELETE CASCADE (ver la
 * migración). Si la FK alguna vez perdiera el CASCADE, esto dejaría filas
 * huérfanas — el TESTQA de la migración lo verifica.
 */
export async function eliminarRemision(id: string): Promise<ResultadoRemision> {
  const { data: actual, error: errLectura } = await supabase
    .from('remisiones')
    .select('fecha')
    .eq('id', id)
    .maybeSingle()

  if (errLectura) {
    console.error('[remisiones] Error leyendo la remisión antes de eliminar:', errLectura)
    return { ok: false, mensaje: errLectura.message }
  }
  if (!actual) return { ok: true } // ya no está: el objetivo se cumplió

  const fechaGuardada = (actual as { fecha: string }).fecha
  if (!puedeEditarse(fechaGuardada)) {
    console.warn('[remisiones] Borrado bloqueado por fecha:', id, fechaGuardada)
    return { ok: false, mensaje: mensajeCandado(fechaGuardada) }
  }

  const { error } = await supabase.from('remisiones').delete().eq('id', id)
  if (error) {
    console.error('[remisiones] Error eliminando la remisión:', error)
    return { ok: false, mensaje: error.message }
  }
  return { ok: true }
}
