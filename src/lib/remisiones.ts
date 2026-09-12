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
//   · el correlativo (ver proximoNumero / crearRemision);
//   · el candado de edición: solo se puede tocar la remisión de HOY
//     (ver puedeEditarse). Es lo único en este módulo que impide escribir.

/** Encabezado de una remisión, tal como vuelve de la consulta. */
export type Remision = {
  id: string
  numero: number
  fecha: string // YYYY-MM-DD
  conductor: string | null
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
 * `numero` null = "asignalo vos": crearRemision() lo resuelve con
 * proximoNumero() justo antes de insertar. Con un número puesto, se respeta
 * (es el caso del arranque del talonario, donde Rafa teclea el folio).
 */
export type RemisionEntrada = {
  numero: number | null
  fecha: string // YYYY-MM-DD
  conductor?: string | null
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
  'id, numero, fecha, conductor, placa, firma_responsable, firma_conductor, created_at'
const COLS_FILA =
  'id, remision_id, orden, cliente, producto, und_kg, canastillas, destino, firma_recibido, es_total'

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
 * El siguiente número del talonario, o null si todavía no hay ninguna remisión.
 *
 * El null es información, no un fallo: le dice a R2 que esta es la PRIMERÍSIMA
 * remisión y que tiene que mostrar el campo del número editable para que Rafa
 * teclee el folio donde va su talonario de papel. De ahí en adelante devuelve
 * MAX+1 y el campo va de solo lectura. Ningún número inicial está hardcodeado
 * ni acá ni en la base: el primero lo pone Rafa.
 *
 * Si la consulta FALLA también devuelve null, y eso es deliberado: es el
 * comportamiento seguro. Con null, R2 pide el número a mano en vez de asignar
 * uno inventado que podría pisar el correlativo real. El fallo queda en el log.
 */
export async function proximoNumero(): Promise<number | null> {
  // order + limit 1 en vez de un MAX() agregado: PostgREST no expone agregados
  // sin una vista o RPC, y el UNIQUE de `numero` ya tiene el índice que hace
  // esta consulta instantánea.
  const { data, error } = await supabase
    .from('remisiones')
    .select('numero')
    .order('numero', { ascending: false })
    .limit(1)

  if (error) {
    console.error('[remisiones] Error consultando el último número:', error)
    return null
  }

  const ultimo = data?.[0]?.numero
  return typeof ultimo === 'number' ? ultimo + 1 : null
}

/**
 * Lista de encabezados (sin filas) ordenada por numero DESC, para la vista
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

  const { data, error } = await q.order('numero', { ascending: false })

  if (error) {
    console.error('[remisiones] Error listando remisiones:', error)
    return []
  }
  return (data ?? []) as Remision[]
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
function filasParaInsertar(remisionId: string, filas: RemisionFilaEntrada[]) {
  return filas.map((f, orden) => ({
    remision_id: remisionId,
    orden, // la posición en el arreglo ES el orden; la pantalla no lo manda
    cliente: f.cliente || null,
    producto: f.producto || null,
    und_kg: f.und_kg || null,
    canastillas: f.canastillas || null,
    destino: f.destino || null,
    firma_recibido: f.firma_recibido || null,
    es_total: f.es_total ?? false,
  }))
}

/** Inserta las filas de una remisión ya creada. Devuelve el mensaje si falla. */
async function insertarFilas(
  remisionId: string,
  filas: RemisionFilaEntrada[]
): Promise<string | null> {
  if (filas.length === 0) return null
  const { error } = await supabase
    .from('remisiones_filas')
    .insert(filasParaInsertar(remisionId, filas))
  if (error) {
    console.error('[remisiones] Error insertando las filas:', error)
    return error.message
  }
  return null
}

/** Código de Postgres para violación de UNIQUE — el choque del correlativo. */
const COD_UNIQUE_VIOLADO = '23505'

/**
 * Crea una remisión: encabezado + filas.
 *
 * El correlativo: si `numero` viene null se resuelve con proximoNumero() justo
 * antes de insertar (no antes, para que la ventana sea lo más corta posible).
 * Si la tabla está vacía y además viene null, no hay de dónde sacarlo y se
 * rechaza pidiendo el número a mano — es el caso del arranque del talonario, y
 * R2 no debería llegar acá porque proximoNumero() ya le dijo que lo pregunte.
 *
 * LA CARRERA DEL CORRELATIVO: MAX+1 se lee y después se inserta, así que dos
 * guardados casi simultáneos pueden calcular el mismo número. El UNIQUE de la
 * base es el árbitro —el segundo INSERT falla con 23505 en vez de duplicar— y
 * acá se reintenta UNA vez recalculando. Con un solo usuario (Rafa, una
 * remisión a la vez, un dispositivo) la ventana real es de milisegundos y solo
 * se abriría con dos pestañas guardando juntas; el reintento la absorbe sin que
 * él vea nada. Si hiciera falta más, el paso sería una SEQUENCE o un RPC que
 * inserte con el MAX+1 calculado del lado del servidor.
 *
 * Si el encabezado entra y las filas fallan, se borra el encabezado: una
 * remisión sin filas es un número quemado del talonario y un documento vacío en
 * el archivo. Mejor que el guardado falle entero y Rafa lo repita.
 *
 * No lanza: el fallo vuelve en el resultado.
 */
export async function crearRemision(
  datos: RemisionEntrada
): Promise<{ ok: true; id: string; numero: number } | { ok: false; mensaje: string }> {
  const base = {
    fecha: datos.fecha,
    conductor: datos.conductor || null,
    placa: datos.placa || null,
    firma_responsable: datos.firma_responsable || null,
    firma_conductor: datos.firma_conductor || null,
  }

  // Dos intentos: el segundo es para el choque de UNIQUE descrito arriba.
  for (let intento = 0; intento < 2; intento++) {
    let numero = datos.numero
    if (numero == null) {
      numero = await proximoNumero()
      if (numero == null) {
        return {
          ok: false,
          mensaje:
            'No hay remisiones anteriores de donde sacar el número. Escribí el número de la primera remisión del talonario.',
        }
      }
    }

    const { data, error } = await supabase
      .from('remisiones')
      .insert({ ...base, numero })
      .select('id, numero')
      .single()

    if (error) {
      // Solo reintentar si el número lo puso la app: si Rafa lo tecleó y ya
      // existe, reintentar le cambiaría el folio por debajo sin avisarle.
      const choque = error.code === COD_UNIQUE_VIOLADO
      if (choque && datos.numero == null && intento === 0) {
        console.warn('[remisiones] El número', numero, 'ya existía; recalculando y reintentando.')
        continue
      }
      console.error('[remisiones] Error creando la remisión:', error)
      return {
        ok: false,
        mensaje: choque
          ? `La remisión número ${numero} ya existe.`
          : error.message,
      }
    }

    const creada = data as { id: string; numero: number }
    const errFilas = await insertarFilas(creada.id, datos.filas)
    if (errFilas) {
      // Rollback manual: las filas que hayan entrado se van por CASCADE.
      const { error: errLimpieza } = await supabase.from('remisiones').delete().eq('id', creada.id)
      if (errLimpieza) {
        console.error(
          '[remisiones] Las filas fallaron y tampoco se pudo deshacer el encabezado',
          creada.numero,
          errLimpieza
        )
      }
      return { ok: false, mensaje: errFilas }
    }

    return { ok: true, id: creada.id, numero: creada.numero }
  }

  return {
    ok: false,
    mensaje: 'No se pudo asignar un número libre para la remisión. Volvé a intentar.',
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
 * Las filas se reemplazan (borrar + insertar) y no se hace diff: son texto
 * libre sin identidad propia —una celda corregida y una fila nueva son lo
 * mismo— y el orden se recalcula entero. Es la misma decisión que
 * guardarOrdenSeccion() en ordenDocumento.ts: reescribir todo es una sola
 * escritura y no puede quedar a medias de forma inconsistente.
 *
 * `numero` no se toca nunca: el folio ya está escrito en el papel.
 */
export async function actualizarRemision(
  id: string,
  datos: Omit<RemisionEntrada, 'numero'>
): Promise<ResultadoRemision> {
  const { data: actual, error: errLectura } = await supabase
    .from('remisiones')
    .select('fecha')
    .eq('id', id)
    .maybeSingle()

  if (errLectura) {
    console.error('[remisiones] Error leyendo la remisión antes de actualizar:', errLectura)
    return { ok: false, mensaje: errLectura.message }
  }
  if (!actual) return { ok: false, mensaje: 'La remisión ya no existe.' }

  const fechaGuardada = (actual as { fecha: string }).fecha
  if (!puedeEditarse(fechaGuardada)) {
    // Rechazo, no error de sistema: es la regla funcionando. Sale como warn
    // para que no se confunda con un fallo en el log.
    console.warn('[remisiones] Edición bloqueada por fecha:', id, fechaGuardada)
    return { ok: false, mensaje: mensajeCandado(fechaGuardada) }
  }

  const { error: errCab } = await supabase
    .from('remisiones')
    .update({
      fecha: datos.fecha,
      conductor: datos.conductor || null,
      placa: datos.placa || null,
      firma_responsable: datos.firma_responsable || null,
      firma_conductor: datos.firma_conductor || null,
    })
    .eq('id', id)

  if (errCab) {
    console.error('[remisiones] Error actualizando el encabezado:', errCab)
    return { ok: false, mensaje: errCab.message }
  }

  const { error: errBorrado } = await supabase
    .from('remisiones_filas')
    .delete()
    .eq('remision_id', id)

  if (errBorrado) {
    // Se corta acá: seguir con el insert duplicaría las filas en pantalla.
    console.error('[remisiones] Error borrando las filas viejas:', errBorrado)
    return { ok: false, mensaje: errBorrado.message }
  }

  const errFilas = await insertarFilas(id, datos.filas)
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
