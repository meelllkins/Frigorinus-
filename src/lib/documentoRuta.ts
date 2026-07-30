import { supabase } from './supabase'
import { RUTAS } from './rutas'

// ════════════════════════════════════════════════════════════════
// TIPOS EXPORTADOS
// ════════════════════════════════════════════════════════════════

export type FilaDocumento = {
  key: string              // identidad ESTABLE de la fila (no depende del orden de la BD)
  cod: string              // celda COD ya formateada (ver formatearCod)
  codigoCliente: string
  animales: number[]       // ordenados de menor a mayor, sin repetidos
  cant: number             // canales despachados (puede ser 0)
  vb: number               // vísceras blancas
  vr: number               // vísceras rojas
  cabeza: number | null    // solo bovinos
  patas: number | null     // solo bovinos
  esDesposte: boolean
  codigoDestino: string | null
  despachoIds: string[]      // ids de TODAS las filas de `despachos` del grupo
  despachoIdsCanal: string[] // ids de las filas de CANAL del grupo, ordenados (para corregir cabeza/patas)
}

export type SeccionDocumento = {
  filas: FilaDocumento[]
  totales: { cant: number; vb: number; vr: number; cabeza: number; patas: number }
}

export type DatosManuales = {
  conductor: string | null
  auxiliar: string | null
  placa: string | null
  horaProgramada: string | null
  observacion: string | null
}

export type BloqueRuta = {
  ruta: string
  bovinos: SeccionDocumento
  porcinos: SeccionDocumento
  manual: DatosManuales | null
}

export type DocumentoDia = {
  fecha: string            // 'YYYY-MM-DD'
  bloques: BloqueRuta[]
  sinRuta: FilaDocumento[] // despachos del día con ruta NULL
  avisos: string[]         // problemas de datos detectados
}

export const UMBRAL_RANGO = 8

// ════════════════════════════════════════════════════════════════
// PARTE PURA — FORMATO DE LA CELDA COD
// ════════════════════════════════════════════════════════════════

/**
 * Formatea la celda COD. `animales` se asume ordenado de menor a mayor y sin
 * repetidos (así lo entrega la agrupación).
 */
export function formatearCod(
  codigoCliente: string,
  animales: number[],
  codigoDestino: string | null,
  esDesposte: boolean
): string {
  // Convención real de Rafa:
  //  - DESPOSTE: se escribe el código SIN números de animal ("530 DESPOSTE").
  //  - No desposte: código + lista/rango de animales.
  //  - Destino: sufijo "PARA COD X" (sin el "EL").
  let base: string
  if (esDesposte) {
    base = `${codigoCliente} DESPOSTE`
  } else {
    let listaAnimales: string
    if (animales.length === 0) {
      listaAnimales = ''
    } else if (
      animales.length >= UMBRAL_RANGO &&
      animales[animales.length - 1] - animales[0] === animales.length - 1 // consecutivos, sin huecos
    ) {
      listaAnimales = `${animales[0]} AL ${animales[animales.length - 1]}`
    } else {
      listaAnimales = animales.join('-')
    }
    base = listaAnimales === '' ? codigoCliente : `${codigoCliente}-${listaAnimales}`
  }

  const destino = (codigoDestino ?? '').trim()
  if (destino !== '') base += ` PARA COD ${destino}`
  return base
}

// ════════════════════════════════════════════════════════════════
// TIPOS DE LAS FILAS CRUDAS DE SUPABASE
// ════════════════════════════════════════════════════════════════

export type DespachoRow = {
  id: string
  registro_id: string | null
  viscera_id: string | null
  tipo_despacho: 'canal' | 'viscera'
  ruta: string | null
  codigo_destino: string | null
  cabeza: number | null
  patas: number | null
  es_desposte: boolean | null
  // Marca del acto de despacho. Todas las filas insertadas en la MISMA sentencia comparten
  // este valor (Postgres usa la hora de la transacción), así que sirve para identificar
  // "este carro" en Externo. Ver eventoExternoDe().
  created_at: string | null
  // FK directa (registro_id) -> registros_beneficio. Se usa también para vísceras.
  registros_beneficio: { codigo_cliente: string | null; numero_animal: number | string | null; tipo_carne: 'res' | 'cerdo' } | null
  // FK (viscera_id) -> inventario_visceras. Solo para saber roja/blanca.
  viscera: { tipo: 'roja' | 'blanca' | null } | null
}

export type ManualRow = {
  ruta: string
  conductor: string | null
  auxiliar: string | null
  placa: string | null
  hora_programada: string | null
  observacion: string | null
}

// ════════════════════════════════════════════════════════════════
// PARTE PURA — AGRUPAR + ARMAR EL DOCUMENTO (sin Supabase)
// ════════════════════════════════════════════════════════════════

/** Orden natural: "60" antes que "589", y estable para códigos alfanuméricos ("23-1"). */
function compararCodigo(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })
}

/**
 * Orden TOTALMENTE determinista de filas (no depende del orden en que lleguen
 * de la BD), en cascada:
 *   1. codigoCliente (natural)
 *   2. primer animal ascendente; arreglo vacío queda de último dentro del cliente
 *   3. esDesposte: false antes que true
 *   4. codigoDestino: null antes que con valor; entre dos con valor, natural
 */
function compararFila(a: FilaDocumento, b: FilaDocumento): number {
  const porCodigo = compararCodigo(a.codigoCliente, b.codigoCliente)
  if (porCodigo !== 0) return porCodigo

  const primerA = a.animales.length > 0 ? a.animales[0] : Infinity
  const primerB = b.animales.length > 0 ? b.animales[0] : Infinity
  if (primerA !== primerB) return primerA - primerB

  const despA = a.esDesposte ? 1 : 0
  const despB = b.esDesposte ? 1 : 0
  if (despA !== despB) return despA - despB

  if (a.codigoDestino !== b.codigoDestino) {
    if (a.codigoDestino == null) return -1
    if (b.codigoDestino == null) return 1
    const porDestino = compararCodigo(a.codigoDestino, b.codigoDestino)
    if (porDestino !== 0) return porDestino
  }

  // Desempate FINAL, exacto y byte a byte. Sin esto el comparador puede devolver 0
  // para filas DISTINTAS —compararCodigo() usa numeric+sensitivity:'base', así que
  // '32', '032' y '32 ' le empatan— y ahí el sort estable conserva el orden de
  // llegada de la BD, que no es determinista. Con esto, dos filas distintas nunca empatan.
  if (a.codigoCliente !== b.codigoCliente) return a.codigoCliente < b.codigoCliente ? -1 : 1
  const destA = a.codigoDestino ?? ''
  const destB = b.codigoDestino ?? ''
  if (destA !== destB) return destA < destB ? -1 : 1
  if (a.key !== b.key) return a.key < b.key ? -1 : 1
  return 0
}

type Grupo = {
  ruta: string | null
  tipoCarne: 'res' | 'cerdo'
  codigoCliente: string
  esDesposte: boolean
  codigoDestino: string | null
  // Identifica el CARRO en Externo (un acto de despacho). Vacío en rutas con nombre.
  evento: string
  // SOLO animales con canal despachada: es la fuente del texto COD (ver grupoAFila).
  // Los animales que solo aportaron víscera adelantada NO entran acá a propósito.
  animalesCanal: Set<number>
  cant: number
  vb: number
  vr: number
  cabeza: number | null
  patas: number | null
  despachoIds: string[]
  despachoIdsCanal: string[]
}

/**
 * Clave de agrupación = identidad de la fila. Es la MISMA que usa el Map de grupos,
 * así que identifica una fila sin depender del orden en que lleguen los despachos.
 * Sirve de key de React y de clave del estado de edición de cabeza/patas.
 */
function claveGrupo(
  ruta: string | null,
  tipoCarne: 'res' | 'cerdo',
  codigoCliente: string,
  esDesposte: boolean,
  codigoDestino: string | null,
  evento: string
): string {
  return [ruta ?? ' SIN_RUTA', tipoCarne, codigoCliente, esDesposte ? '1' : '0', codigoDestino ?? '', evento].join('|')
}

function grupoAFila(g: Grupo): FilaDocumento {
  // REGLA DE NEGOCIO (Rafa, inquebrantable): por el "adelanto de vísceras", un código puede
  // tener MÁS vísceras despachadas que canales. COD y CANT cuentan SOLO canales; V/B, V/R,
  // CABEZA y PATAS suman todo lo del grupo, lleve canal o no.
  //   Ej. código 13, animales 1/2/3/4, canales de 1 y 2, vísceras de los 4:
  //       COD = "13-1-2"  CANT = 2  V/B = V/R = 4
  // Si NO hay ninguna canal (solo adelanto), la lista queda vacía y formatearCod devuelve
  // el código pelado: "13" (no "13-", ni "13-0", ni vacío).
  const animales = [...g.animalesCanal].sort((a, b) => a - b)
  const esBovino = g.tipoCarne === 'res'
  return {
    key: claveGrupo(g.ruta, g.tipoCarne, g.codigoCliente, g.esDesposte, g.codigoDestino, g.evento),
    cod: formatearCod(g.codigoCliente, animales, g.codigoDestino, g.esDesposte),
    codigoCliente: g.codigoCliente,
    animales,
    cant: g.cant,
    vb: g.vb,
    vr: g.vr,
    cabeza: esBovino ? g.cabeza : null, // porcinos: siempre null
    patas: esBovino ? g.patas : null,
    esDesposte: g.esDesposte,
    codigoDestino: g.codigoDestino,
    despachoIds: g.despachoIds,
    despachoIdsCanal: [...g.despachoIdsCanal].sort(), // ordenado por id -> estable entre refrescos
  }
}

function seccionDe(filas: FilaDocumento[]): SeccionDocumento {
  const ordenadas = [...filas].sort(compararFila)
  const totales = { cant: 0, vb: 0, vr: 0, cabeza: 0, patas: 0 }
  for (const f of ordenadas) {
    totales.cant += f.cant
    totales.vb += f.vb
    totales.vr += f.vr
    totales.cabeza += f.cabeza ?? 0
    totales.patas += f.patas ?? 0
  }
  return { filas: ordenadas, totales }
}

/** Núcleo puro: recibe las filas ya consultadas y arma el documento completo. */
export function armarDocumento(fecha: string, despachos: DespachoRow[], manuales: ManualRow[]): DocumentoDia {
  const avisos: string[] = []
  const grupos = new Map<string, Grupo>()

  // es_desposte solo se captura en el CANAL (Inventario no tiene esa casilla).
  // Mapeamos registro_id -> desposte del canal para que las vísceras del mismo
  // animal hereden la marca y caigan en la MISMA fila del documento.
  const despostePorRegistro = new Map<string, boolean>()
  for (const d of despachos) {
    if (d.tipo_despacho === 'canal' && d.registro_id != null) {
      despostePorRegistro.set(d.registro_id, !!d.es_desposte)
    }
  }

  // ── CARRO de Externo ────────────────────────────────────────────────────────
  // 'Externo' no es una ruta: cada ACTO de despachar a Externo es un carro propio,
  // independiente de los demás aunque coincidan cliente y destino. No existe hoy una
  // columna que identifique el carro, así que se usa `created_at`: todas las filas
  // insertadas en la misma sentencia comparten esa marca (Postgres usa la hora de la
  // transacción), o sea que un despacho múltiple de 50 cerdos = un solo carro, y dos
  // despachos separados del mismo código = dos carros.
  //
  // Las vísceras se insertan en una sentencia aparte del canal (otro created_at), así que
  // heredan el carro del canal del mismo animal; si no hay canal (víscera adelantada sola),
  // valen por su propia marca.
  // Sin created_at (dato viejo/raro) se cae al id de la fila: así cada despacho queda como
  // su PROPIO carro. Es el lado seguro del error — mejor separar de más que fusionar carros
  // que no tienen nada que ver.
  const carroDelCanalExterno = new Map<string, string>()
  for (const d of despachos) {
    if (d.ruta === 'Externo' && d.tipo_despacho === 'canal' && d.registro_id != null) {
      carroDelCanalExterno.set(d.registro_id, d.created_at ?? d.id)
    }
  }
  const eventoExternoDe = (d: DespachoRow): string => {
    if (d.ruta !== 'Externo') return '' // rutas con nombre: sin evento, se agrupan como siempre
    if (d.tipo_despacho !== 'canal' && d.registro_id != null) {
      const carroCanal = carroDelCanalExterno.get(d.registro_id)
      if (carroCanal != null) return carroCanal
    }
    return d.created_at ?? d.id
  }

  for (const d of despachos) {
    const rb = d.registros_beneficio
    if (!rb || rb.codigo_cliente == null) {
      avisos.push(`Despacho ${d.id}: sin registro de beneficio asociado; se omite de las secciones.`)
      continue
    }

    const tipoCarne = rb.tipo_carne
    const codigoCliente = rb.codigo_cliente
    const ruta = d.ruta
    // La víscera hereda el desposte del canal del mismo animal (codigo_destino NO se hereda:
    // ese sí se captura de verdad en las filas de víscera).
    const esDesposte =
      d.tipo_despacho === 'canal'
        ? !!d.es_desposte
        : d.registro_id != null
          ? despostePorRegistro.get(d.registro_id) ?? false
          : false
    const destinoTrim = (d.codigo_destino ?? '').trim()
    const codigoDestino = destinoTrim === '' ? null : destinoTrim // null y '' se tratan igual
    const etiquetaAnimal = `${codigoCliente}-${rb.numero_animal ?? '?'}`

    const evento = eventoExternoDe(d)
    const key = claveGrupo(ruta, tipoCarne, codigoCliente, esDesposte, codigoDestino, evento)
    let g = grupos.get(key)
    if (!g) {
      g = {
        ruta, tipoCarne, codigoCliente, esDesposte, codigoDestino, evento,
        animalesCanal: new Set(),
        cant: 0, vb: 0, vr: 0, cabeza: null, patas: null, despachoIds: [], despachoIdsCanal: [],
      }
      grupos.set(key, g)
    }

    g.despachoIds.push(d.id)

    const rawAnimal = rb.numero_animal
    const numAnimal = rawAnimal == null || rawAnimal === '' ? NaN : Number(rawAnimal)

    // CABEZA/PATAS suman TODO el grupo, venga la fila de canal o de víscera (regla de Rafa:
    // estas columnas incluyen todo lo asociado al código). En la práctica solo las filas de
    // canal traen valor —las vísceras se guardan con NULL—, así que el resultado es el mismo;
    // se hace acá afuera para que la regla no dependa del tipo de despacho.
    if (tipoCarne === 'res') {
      if (d.cabeza != null) g.cabeza = (g.cabeza ?? 0) + d.cabeza
      if (d.patas != null) g.patas = (g.patas ?? 0) + d.patas
    }

    if (d.tipo_despacho === 'canal') {
      // COD y CANT son estrictamente de CANAL. Dos motivos, los dos reportados por Rafa:
      //  1. El modal "Vísceras disponibles" de Beneficios trae vísceras de OTROS animales del
      //     mismo código (consulta por codigo_cliente), y esas "prestadas" caían en el mismo
      //     grupo colando su número en el COD ("32-1-2" con un solo canal despachado).
      //  2. El "adelanto de vísceras": se mandan antes las vísceras de animales cuya canal
      //     todavía no salió. Esos animales NO deben aparecer en el COD ni sumar a CANT.
      if (Number.isFinite(numAnimal)) g.animalesCanal.add(numAnimal)
      g.cant++
      g.despachoIdsCanal.push(d.id)
    } else {
      // víscera: suma a V/B o V/R, pero nunca al COD ni a CANT.
      if (d.viscera_id == null) {
        avisos.push(`Despacho ${d.id} (${etiquetaAnimal}): víscera sin viscera_id (dato viejo); no se cuenta en VB/VR.`)
      } else {
        const tipoV = d.viscera?.tipo ?? null
        if (tipoV === 'blanca') g.vb++
        else if (tipoV === 'roja') g.vr++
        else avisos.push(`Despacho ${d.id} (${etiquetaAnimal}): víscera con tipo nulo en inventario_visceras; no se cuenta en VB/VR.`)
      }
    }
  }

  // Ítems con su ruta/tipoCarne para poder distribuirlos en bloques/secciones.
  const items = [...grupos.values()].map(g => ({ ruta: g.ruta, tipoCarne: g.tipoCarne, evento: g.evento, fila: grupoAFila(g) }))

  // Datos manuales por ruta (UNIQUE fecha+ruta -> a lo sumo uno por ruta).
  const manualPorRuta = new Map<string, DatosManuales>()
  for (const m of manuales) {
    manualPorRuta.set(m.ruta, {
      conductor: m.conductor ?? null,
      auxiliar: m.auxiliar ?? null,
      placa: m.placa ?? null,
      horaProgramada: m.hora_programada ?? null,
      observacion: m.observacion ?? null,
    })
  }

  // Un bloque por ruta con filas, a partir de un subconjunto de `items` ya elegido
  // por el llamador (todos los de esa ruta, o solo los de UN carro de Externo).
  const armarBloque = (ruta: string, itemsDelBloque: typeof items): BloqueRuta => ({
    ruta,
    bovinos: seccionDe(itemsDelBloque.filter(it => it.tipoCarne === 'res').map(it => it.fila)),
    porcinos: seccionDe(itemsDelBloque.filter(it => it.tipoCarne === 'cerdo').map(it => it.fila)),
    manual: manualPorRuta.get(ruta) ?? null,
  })

  const bloques: BloqueRuta[] = []
  for (const ruta of RUTAS) {
    if (ruta === 'Externo') continue
    const bloque = armarBloque(ruta, items.filter(it => it.ruta === ruta))
    if (bloque.bovinos.filas.length > 0 || bloque.porcinos.filas.length > 0) {
      bloques.push(bloque)
    }
  }

  // 'Externo' NO es una ruta más: cada ACTO de despachar a Externo es un carro propio, y
  // dos externos NUNCA se juntan aunque compartan cliente y destino (confirmado por Rafa).
  // Por eso el carro se identifica por el acto de despacho (`evento`, ver eventoExternoDe)
  // y NO por combinación de campos de negocio: agrupar por cliente/destino fue justamente
  // el error del intento anterior. Los carros van al final, en orden cronológico.
  const carrosExterno = new Map<string, typeof items>()
  for (const it of items) {
    if (it.ruta !== 'Externo') continue
    const lista = carrosExterno.get(it.evento)
    if (lista) lista.push(it)
    else carrosExterno.set(it.evento, [it])
  }
  const carrosOrdenados = [...carrosExterno.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  for (const [, itemsDelCarro] of carrosOrdenados) {
    bloques.push(armarBloque('Externo', itemsDelCarro))
  }

  // Despachos con ruta NULL: no se descartan, van en sinRuta (lista plana).
  const sinRuta = items
    .filter(it => it.ruta === null)
    .map(it => it.fila)
    .sort(compararFila)

  return { fecha, bloques, sinRuta, avisos }
}

// ════════════════════════════════════════════════════════════════
// PARTE QUE CONSULTA — DOS consultas por refresco, ni una más
// ════════════════════════════════════════════════════════════════

const SELECT_DESPACHOS =
  'id, registro_id, viscera_id, tipo_despacho, ruta, codigo_destino, cabeza, patas, es_desposte, created_at, ' +
  'registros_beneficio(codigo_cliente, numero_animal, tipo_carne), viscera:inventario_visceras(tipo)'

/**
 * Construye el documento del día. `fecha` es un string 'YYYY-MM-DD' (fecha_despacho
 * es DATE, se compara directo). Si una consulta falla: console.error con prefijo
 * [documentoRuta] y devuelve un documento vacío pero válido (nunca lanza).
 */
export async function construirDocumentoDia(fecha: string): Promise<DocumentoDia> {
  const avisosConsulta: string[] = []

  // Consulta 1: despachos del día con los joins anidados.
  // El ORDER BY es OBLIGATORIO: sin él Postgres devuelve las filas en orden físico,
  // que cambia cada vez que se hace UPDATE sobre una fila (editar cabeza/patas mueve
  // el registro al final del heap). Ese orden se filtraba al documento y las filas
  // "se revolvían" entre refrescos. Orden por created_at + id = el orden en que Rafa
  // fue despachando, siempre igual.
  const { data: despData, error: errDesp } = await supabase
    .from('despachos')
    .select(SELECT_DESPACHOS)
    .eq('fecha_despacho', fecha)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (errDesp) {
    console.error('[documentoRuta] Error consultando despachos:', errDesp)
    avisosConsulta.push('No se pudieron cargar los despachos del día.')
  }

  // Consulta 2: datos manuales de ruta del día.
  const { data: manData, error: errMan } = await supabase
    .from('documentos_ruta')
    .select('ruta, conductor, auxiliar, placa, hora_programada, observacion')
    .eq('fecha', fecha)

  if (errMan) {
    console.error('[documentoRuta] Error consultando documentos_ruta:', errMan)
    avisosConsulta.push('No se pudieron cargar los datos manuales de ruta.')
  }

  const doc = armarDocumento(
    fecha,
    (despData ?? []) as unknown as DespachoRow[],
    (manData ?? []) as unknown as ManualRow[]
  )
  doc.avisos.unshift(...avisosConsulta)
  return doc
}

/**
 * Upsert de los datos manuales de una ruta en `documentos_ruta` (onConflict fecha,ruta).
 * `datos` es parcial: solo se escriben las columnas presentes. OJO con el nombre:
 * en la BD es `hora_programada`, en DatosManuales es `horaProgramada`.
 * Devuelve true/false; nunca lanza.
 */
export async function guardarDatosManuales(
  fecha: string,
  ruta: string,
  datos: Partial<DatosManuales>
): Promise<boolean> {
  const fila: Record<string, string | null> = { fecha, ruta }
  if ('conductor' in datos) fila.conductor = datos.conductor ?? null
  if ('auxiliar' in datos) fila.auxiliar = datos.auxiliar ?? null
  if ('placa' in datos) fila.placa = datos.placa ?? null
  if ('horaProgramada' in datos) fila.hora_programada = datos.horaProgramada ?? null
  if ('observacion' in datos) fila.observacion = datos.observacion ?? null

  const { error } = await supabase
    .from('documentos_ruta')
    .upsert(fila, { onConflict: 'fecha,ruta' })

  if (error) {
    console.error('[documentoRuta] Error guardando datos manuales:', error)
    return false
  }
  return true
}

/**
 * Corrige cabeza/patas de un grupo: escribe los valores en el PRIMER id de canal
 * y pone AMBAS en null en el resto (para que la suma del grupo no se duplique).
 * Dos updates. Arreglo vacío -> no hace nada y devuelve false. Nunca lanza.
 */
export async function actualizarCabezaPatas(
  despachoIdsCanal: string[],
  cabeza: number | null,
  patas: number | null
): Promise<boolean> {
  if (despachoIdsCanal.length === 0) return false

  const [primero, ...resto] = despachoIdsCanal

  const { error: errPrimero } = await supabase
    .from('despachos')
    .update({ cabeza, patas })
    .eq('id', primero)

  if (errPrimero) {
    console.error('[documentoRuta] Error actualizando cabeza/patas (primera fila):', errPrimero)
    return false
  }

  if (resto.length > 0) {
    const { error: errResto } = await supabase
      .from('despachos')
      .update({ cabeza: null, patas: null })
      .in('id', resto)

    if (errResto) {
      console.error('[documentoRuta] Error limpiando cabeza/patas (resto):', errResto)
      return false
    }
  }
  return true
}
