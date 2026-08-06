import { supabase } from './supabase'
import { RUTAS } from './rutas'
import { fechaEntregaDe } from './fechaEntrega'

// ════════════════════════════════════════════════════════════════
// TIPOS EXPORTADOS
// ════════════════════════════════════════════════════════════════

export type FilaDocumento = {
  key: string              // identidad ESTABLE de la fila (no depende del orden de la BD)
  cod: string              // celda COD ya formateada (ver formatearCod)
  codigoCliente: string
  animales: number[]       // ordenados de menor a mayor, sin repetidos
  cant: number             // suma de fracciones de canal: 0, 0.5 (media canal), 1, 2...
  vb: number               // vísceras blancas
  vr: number               // vísceras rojas
  cabeza: number | null    // solo bovinos
  patas: number | null     // solo bovinos
  esDesposte: boolean
  esMediaCanal: boolean    // el canal salió partido en mitades (0.5)
  codigoDestino: string | null
  despachoIds: string[]      // ids de TODAS las filas de `despachos` del grupo
  despachoIdsCanal: string[] // ids de las filas de CANAL del grupo, ordenados (para corregir cabeza/patas)
  direccion: string | null   // solo ruta Nacional: punto de entrega elegido al despachar
  // Orden de entrega resuelto contra el maestro. null = la ruta no usa secuencia, o el
  // código todavía no tiene orden asignado (esas filas caen al final del bloque).
  secuencia: number | null
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
  // Identidad del carro (solo Externo). Es lo que separa los datos manuales de un carro
  // de los de otro. null en rutas con nombre.
  carroId: string | null
  bovinos: SeccionDocumento
  porcinos: SeccionDocumento
  manual: DatosManuales | null
}

export type DocumentoDia = {
  fecha: string            // 'YYYY-MM-DD' — fecha de DESPACHO (la jornada, la del selector)
  // Fecha PARA LA QUE se entrega este documento. Es lo que lo identifica: una misma
  // jornada puede producir VARIOS DocumentoDia, uno por fecha de entrega, y cada uno
  // lleva su propio encabezado (conductor/placa) y su propio día de Cimitarra.
  fechaEntrega: string     // 'YYYY-MM-DD'
  bloques: BloqueRuta[]
  sinRuta: FilaDocumento[] // despachos del día con ruta NULL
  avisos: string[]         // problemas de datos detectados
}

export const UMBRAL_RANGO = 8

/**
 * Identidad de un bloque DENTRO de la jornada. Es la clave con la que se guardan y se
 * leen los datos manuales del encabezado (conductor/auxiliar/placa/hora/observación).
 *
 * Lleva la fecha de entrega porque una jornada puede producir varios documentos: sin
 * ella, la Cimitarra que se entrega mañana y la que se entrega pasado —las dos con
 * carroId null— colapsarían en la misma clave y compartirían conductor y placa.
 *
 * La usan la pantalla y el export, para que no puedan discrepar.
 */
export function claveBloque(fechaEntrega: string, b: { ruta: string; carroId: string | null }): string {
  return `${fechaEntrega}|${b.ruta}|${b.carroId ?? ''}`
}

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
  esDesposte: boolean,
  esMediaCanal = false,
  tipoCarne: 'res' | 'cerdo' = 'res'
): string {
  // Convención real de Rafa:
  //  - DESPOSTE: se escribe el código SIN números de animal ("530 DESPOSTE").
  //  - No desposte: código + lista/rango de animales.
  //  - MEDIA CANAL: conserva el número de animal y agrega la leyenda, ANTES del
  //    destino -> "155-2 MEDIA CANAL DE RES PARA COD 154".
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

  if (esMediaCanal) base += ` MEDIA CANAL DE ${tipoCarne === 'res' ? 'RES' : 'CERDO'}`

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
  // Cuánto del canal salió en ESTE despacho: 1 = entero, 0.5 = media canal.
  // Las filas de víscera siempre traen 1 (la fracción describe el canal, no la víscera).
  fraccion: number | string | null
  // Dirección de entrega. Solo la llevan los despachos a 'Nacional'.
  direccion: string | null
  // Día PARA EL QUE se entrega esta fila, distinto de fecha_despacho. Es lo que separa
  // los documentos de una misma jornada. NULL en las filas anteriores a la migración:
  // ahí se cae al default de siempre (despacho + 1). Ver fechaEntrega.ts.
  fecha_entrega: string | null
  // Marca del acto de despacho. Todas las filas insertadas en la MISMA sentencia comparten
  // este valor (Postgres usa la hora de la transacción), así que sirve para identificar
  // "este carro" en Externo. Ver eventoExternoDe().
  created_at: string | null
  // Identificador EXPLÍCITO del carro externo, generado por el frontend al despachar.
  // NULL en rutas con nombre y en los despachos viejos (ahí se cae a la inferencia).
  carro_id: string | null
  // FK directa (registro_id) -> registros_beneficio. Se usa también para vísceras.
  registros_beneficio: { codigo_cliente: string | null; numero_animal: number | string | null; tipo_carne: 'res' | 'cerdo' } | null
  // FK (viscera_id) -> inventario_visceras. Solo para saber roja/blanca.
  viscera: { tipo: 'roja' | 'blanca' | null } | null
}

export type ManualRow = {
  ruta: string
  carro_id: string // '' para rutas con nombre; el id del carro en Externo
  // A qué documento pertenece esta fila. Sin esto, dos documentos de la MISMA jornada y
  // la MISMA ruta con nombre (carro_id '') compartirían conductor y placa. NULL en las
  // filas anteriores a la migración -> se resuelve al default (despacho + 1).
  fecha_entrega: string | null
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
  esMediaCanal: boolean
  // Dirección de las rayas de este grupo (solo Nacional). Entra en la clave, así que
  // todas las filas del grupo comparten exactamente esta dirección.
  direccion: string | null
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
  evento: string,
  esMediaCanal: boolean,
  direccion: string | null
): string {
  return [
    ruta ?? ' SIN_RUTA', tipoCarne, codigoCliente,
    esDesposte ? '1' : '0', codigoDestino ?? '', evento,
    esMediaCanal ? 'M' : 'E', // media canal nunca se mezcla con canal entero del mismo código
    // DIRECCION POR RAYA (solo Nacional): el codigo 355 reparte sus rayas entre varias
    // direcciones, y cada una tiene que salir en su propia linea del documento. Como
    // `despachos` YA es una fila por raya, basta con que la direccion entre en la clave:
    // rayas del mismo codigo con direcciones distintas dejan de agruparse.
    // Sin direccion (todo lo que no es Nacional) la clave no cambia -> igual que antes.
    direccion ?? '',
  ].join('|')
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
    key: claveGrupo(g.ruta, g.tipoCarne, g.codigoCliente, g.esDesposte, g.codigoDestino, g.evento, g.esMediaCanal, g.direccion),
    cod: formatearCod(g.codigoCliente, animales, g.codigoDestino, g.esDesposte, g.esMediaCanal, g.tipoCarne),
    codigoCliente: g.codigoCliente,
    animales,
    cant: g.cant,
    vb: g.vb,
    vr: g.vr,
    cabeza: esBovino ? g.cabeza : null, // porcinos: siempre null
    patas: esBovino ? g.patas : null,
    esDesposte: g.esDesposte,
    esMediaCanal: g.esMediaCanal,
    codigoDestino: g.codigoDestino,
    despachoIds: g.despachoIds,
    despachoIdsCanal: [...g.despachoIdsCanal].sort(), // ordenado por id -> estable entre refrescos
    direccion: g.direccion,
    secuencia: null, // la resuelve seccionDe(), que es quien tiene el maestro
  }
}

/**
 * Devuelve la secuencia de entrega de una fila (o null si esa ruta no se ordena por
 * secuencia, o el código no está en el maestro). La arma el llamador —ver
 * crearResolverSecuencia() en secuenciaEntrega.ts— para que este módulo no dependa
 * del maestro ni de Supabase.
 */
export type ResolverSecuencia = (ruta: string, fila: FilaDocumento) => number | null

function seccionDe(filas: FilaDocumento[], ruta: string | null, secuenciaDe?: ResolverSecuencia): SeccionDocumento {
  // Orden de ENTREGA: las rutas regionales con maestro se ordenan por secuencia de
  // menor a mayor (el 1 se entrega primero). Si no hay resolver, o la ruta no lleva
  // secuencia, o el código no está en el maestro, la secuencia es null -> todas quedan
  // "empatadas" y manda compararFila, o sea el orden de siempre.
  // La secuencia se guarda EN la fila: la usan el orden, el separador "sin orden asignado"
  // de la pantalla y del Excel, y el control para asignarla. Así nadie la recalcula aparte.
  const ordenadas = filas
    .map(f => ({ ...f, secuencia: ruta != null && secuenciaDe ? secuenciaDe(ruta, f) : null }))
    .sort((a, b) => {
      const sa = a.secuencia ?? Number.POSITIVE_INFINITY
      const sb = b.secuencia ?? Number.POSITIVE_INFINITY
      if (sa !== sb) return sa - sb
      return compararFila(a, b) // desempate determinista (incluye códigos sin secuencia)
    })
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

/**
 * Núcleo puro: recibe las filas ya consultadas y arma UN documento completo.
 *
 * `fecha` es la jornada (fecha de despacho) y `fechaEntrega` el día para el que se
 * entrega ESTE documento. `despachos` y `manuales` tienen que venir ya filtrados a esa
 * fecha de entrega — de eso se encarga construirDocumentosDia(), que es quien parte la
 * jornada en documentos.
 */
export function armarDocumento(
  fecha: string,
  fechaEntrega: string,
  despachos: DespachoRow[],
  manuales: ManualRow[],
  secuenciaDe?: ResolverSecuencia
): DocumentoDia {
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

  // Fracción del despacho: 1 = canal entero, 0.5 = media canal. Sin columna (dato viejo o
  // migración sin correr) se asume 1. Number() porque PostgREST puede entregar NUMERIC
  // como string.
  const fraccionDe = (d: DespachoRow): number => {
    if (d.fraccion == null) return 1
    const n = Number(d.fraccion)
    return Number.isFinite(n) && n > 0 ? n : 1
  }

  // Las vísceras NO se parten: viajan completas con UNA de las dos mitades. Para que caigan
  // en la MISMA fila que esa mitad, heredan la marca de media canal del animal (igual que
  // heredan el desposte). Cuál de las dos mitades les toca lo decide su propio
  // codigo_destino, que ya las separa por grupo.
  const mediaCanalPorRegistro = new Map<string, boolean>()
  for (const d of despachos) {
    if (d.tipo_despacho === 'canal' && d.registro_id != null && fraccionDe(d) < 1) {
      mediaCanalPorRegistro.set(d.registro_id, true)
    }
  }

  // La dirección se captura en el CANAL (las vísceras se insertan aparte y van con null).
  // Como la dirección entra en la clave de grupo, sin esto una víscera se separaría de su
  // canal y el código saldría en dos líneas. Igual que el desposte y la media canal: la
  // víscera hereda la dirección del canal de SU animal.
  const direccionPorRegistro = new Map<string, string>()
  for (const d of despachos) {
    if (d.tipo_despacho === 'canal' && d.registro_id != null && d.direccion != null && d.direccion.trim() !== '') {
      direccionPorRegistro.set(d.registro_id, d.direccion.trim())
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
      carroDelCanalExterno.set(d.registro_id, d.carro_id ?? d.created_at ?? d.id)
    }
  }
  // TRANSICIÓN: manda el carro_id explícito; si no lo hay (despachos viejos), se cae a la
  // inferencia por created_at de siempre. Así lo viejo sigue agrupándose igual que antes.
  const eventoExternoDe = (d: DespachoRow): string => {
    if (d.ruta !== 'Externo') return '' // rutas con nombre: sin evento, se agrupan como siempre
    if (d.carro_id != null) return d.carro_id
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

    const fraccion = fraccionDe(d)
    const esMediaCanal =
      d.tipo_despacho === 'canal'
        ? fraccion < 1
        : d.registro_id != null
          ? mediaCanalPorRegistro.get(d.registro_id) ?? false
          : false

    const evento = eventoExternoDe(d)
    // Dirección de ESTA raya. La del canal manda; la víscera hereda la de su animal.
    const direccionPropia = d.direccion != null && d.direccion.trim() !== '' ? d.direccion.trim() : null
    const direccionFila =
      direccionPropia ??
      (d.tipo_despacho !== 'canal' && d.registro_id != null
        ? direccionPorRegistro.get(d.registro_id) ?? null
        : null)
    const key = claveGrupo(ruta, tipoCarne, codigoCliente, esDesposte, codigoDestino, evento, esMediaCanal, direccionFila)
    let g = grupos.get(key)
    if (!g) {
      g = {
        ruta, tipoCarne, codigoCliente, esDesposte, codigoDestino, evento, esMediaCanal,
        direccion: direccionFila,
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
      // Suma la FRACCIÓN, no las filas: media canal aporta 0.5. 0.5+0.5 da 1 exacto
      // (es una fracción binaria), así que no hay deriva de coma flotante.
      g.cant += fraccion
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

  // Datos manuales por (ruta + carro). Las rutas con nombre usan carro_id '' -> una sola
  // fila por ruta, igual que antes. Cada carro externo tiene la suya.
  const claveManual = (ruta: string, carroId: string | null) => `${ruta}|${carroId ?? ''}`
  const manualPorClave = new Map<string, DatosManuales>()
  for (const m of manuales) {
    manualPorClave.set(claveManual(m.ruta, m.carro_id ?? ''), {
      conductor: m.conductor ?? null,
      auxiliar: m.auxiliar ?? null,
      placa: m.placa ?? null,
      horaProgramada: m.hora_programada ?? null,
      observacion: m.observacion ?? null,
    })
  }

  // Un bloque por ruta con filas, a partir de un subconjunto de `items` ya elegido
  // por el llamador (todos los de esa ruta, o solo los de UN carro de Externo).
  const armarBloque = (ruta: string, itemsDelBloque: typeof items, carroId: string | null = null): BloqueRuta => ({
    ruta,
    carroId,
    bovinos: seccionDe(itemsDelBloque.filter(it => it.tipoCarne === 'res').map(it => it.fila), ruta, secuenciaDe),
    porcinos: seccionDe(itemsDelBloque.filter(it => it.tipoCarne === 'cerdo').map(it => it.fila), ruta, secuenciaDe),
    manual: manualPorClave.get(claveManual(ruta, carroId)) ?? null,
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
  // La clave incluye tipoCarne: un carro externo lleva UN SOLO tipo de carne. Sin esto, si
  // dos actos de despacho distintos (uno de res, uno de cerdo) cayeran en la misma marca de
  // tiempo, se fusionaban en un bloque con BOVINOS y PORCINOS juntos. Es raro (hace falta
  // colisión de microsegundos), pero el invariante "un carro = un tipo" queda garantizado acá
  // en vez de depender de la precisión del reloj.
  const carrosExterno = new Map<string, typeof items>()
  for (const it of items) {
    if (it.ruta !== 'Externo') continue
    const claveCarro = `${it.evento}|${it.tipoCarne}`
    const lista = carrosExterno.get(claveCarro)
    if (lista) lista.push(it)
    else carrosExterno.set(claveCarro, [it])
  }
  const carrosOrdenados = [...carrosExterno.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  for (const [claveCarro, itemsDelCarro] of carrosOrdenados) {
    // La clave lleva el sufijo |tipoCarne para no mezclar res y cerdo en un carro, pero la
    // IDENTIDAD del carro (con la que se guardan conductor/placa) es solo el evento.
    const carroId = claveCarro.slice(0, claveCarro.lastIndexOf('|'))
    bloques.push(armarBloque('Externo', itemsDelCarro, carroId))
  }

  // Despachos con ruta NULL: no se descartan, van en sinRuta (lista plana).
  const sinRuta = items
    .filter(it => it.ruta === null)
    .map(it => it.fila)
    .sort(compararFila)

  return { fecha, fechaEntrega, bloques, sinRuta, avisos }
}

// ════════════════════════════════════════════════════════════════
// PARTE QUE CONSULTA — DOS consultas por refresco, ni una más
// ════════════════════════════════════════════════════════════════

const SELECT_DESPACHOS =
  'id, registro_id, viscera_id, tipo_despacho, ruta, codigo_destino, cabeza, patas, es_desposte, fraccion, direccion, created_at, carro_id, fecha_entrega, ' +
  'registros_beneficio(codigo_cliente, numero_animal, tipo_carne), viscera:inventario_visceras(tipo)'

/**
 * El resolver de secuencia depende del DÍA DE ENTREGA (Cimitarra tiene un maestro para
 * LUNES y otro para JUEVES), y una jornada puede producir documentos para días distintos.
 * Por eso el llamador no pasa UN resolver sino una función que devuelve el resolver de la
 * fecha de entrega que se le pida. Ver crearResolverSecuencia() en secuenciaEntrega.ts.
 */
export type ResolverPorEntrega = (fechaEntrega: string) => ResolverSecuencia | undefined

/**
 * Construye los documentos de una JORNADA. `fecha` es un string 'YYYY-MM-DD'
 * (fecha_despacho es DATE, se compara directo).
 *
 * Devuelve UN documento por fecha de entrega presente en la jornada, ordenados de la
 * entrega más próxima a la más lejana. En el día normal eso es un solo documento, exacto
 * como antes; en víspera de festivo salen dos, cada uno con sus propios bloques,
 * encabezados y orden de entrega.
 *
 * Si una consulta falla: console.error con prefijo [documentoRuta] y devuelve un
 * documento vacío pero válido (nunca lanza).
 */
export async function construirDocumentosDia(
  fecha: string,
  resolverPara?: ResolverPorEntrega
): Promise<DocumentoDia[]> {
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
    .select('ruta, carro_id, fecha_entrega, conductor, auxiliar, placa, hora_programada, observacion')
    .eq('fecha', fecha)

  if (errMan) {
    console.error('[documentoRuta] Error consultando documentos_ruta:', errMan)
    avisosConsulta.push('No se pudieron cargar los datos manuales de ruta.')
  }

  const despachos = (despData ?? []) as unknown as DespachoRow[]
  const manuales = (manData ?? []) as unknown as ManualRow[]

  // ── PARTIR LA JORNADA POR FECHA DE ENTREGA ──────────────────────────────────
  // Todo lo de abajo (agrupación, bloques, carros, secuencia) sigue igual que siempre:
  // lo único nuevo es que corre una vez POR fecha de entrega en vez de una vez por día.
  const porEntrega = new Map<string, DespachoRow[]>()
  for (const d of despachos) {
    const fe = fechaEntregaDe(d.fecha_entrega, fecha)
    const lista = porEntrega.get(fe)
    if (lista) lista.push(d)
    else porEntrega.set(fe, [d])
  }

  // Sin despachos igual se devuelve UN documento (vacío pero válido) para la entrega por
  // defecto: la pantalla necesita algo que dibujar y los avisos de consulta tienen que
  // llegar a alguna parte. Es el comportamiento de antes cuando el día no tenía nada.
  if (porEntrega.size === 0) {
    const doc = armarDocumento(fecha, fechaEntregaDe(null, fecha), [], manuales, undefined)
    doc.avisos.unshift(...avisosConsulta)
    return [doc]
  }

  // Orden cronológico: primero lo que se entrega antes. Como son 'YYYY-MM-DD', el orden
  // alfabético YA es el cronológico.
  const fechasEntrega = [...porEntrega.keys()].sort()

  return fechasEntrega.map((fe, i) => {
    // Los datos manuales viejos vienen con fecha_entrega NULL: se resuelven al default,
    // así siguen apareciendo en el documento de siempre y no se pierden.
    const manualesDeEntrega = manuales.filter(m => fechaEntregaDe(m.fecha_entrega, fecha) === fe)
    const doc = armarDocumento(fecha, fe, porEntrega.get(fe) ?? [], manualesDeEntrega, resolverPara?.(fe))
    // Los avisos de consulta son de la jornada entera, no de un documento: se ponen solo
    // en el primero para no repetirlos N veces en pantalla.
    if (i === 0) doc.avisos.unshift(...avisosConsulta)
    return doc
  })
}

/**
 * Resultado de un guardado. En el fallo viaja el mensaje del motor: es lo único que
 * distingue "no hay red" de "la columna o el UNIQUE no existen en la tabla".
 */
export type ResultadoGuardado = { ok: true } | { ok: false; mensaje: string }

/**
 * Upsert de los datos manuales de una ruta en `documentos_ruta`
 * (onConflict fecha,ruta,carro_id,fecha_entrega).
 * `datos` es parcial: solo se escriben las columnas presentes. OJO con el nombre:
 * en la BD es `hora_programada`, en DatosManuales es `horaProgramada`.
 * Nunca lanza: el fallo vuelve en el resultado para que la pantalla pueda mostrarlo.
 */
export async function guardarDatosManuales(
  fecha: string,
  fechaEntrega: string,
  ruta: string,
  datos: Partial<DatosManuales>,
  carroId: string | null = null
): Promise<ResultadoGuardado> {
  // carro_id '' = ruta con nombre. fecha_entrega es lo que separa dos documentos de la
  // MISMA jornada: sin ella, la Cimitarra de mañana y la de pasado compartirían conductor
  // y placa (Externo ya se separaba por carro_id, las rutas con nombre no).
  // En una jornada normal hay una sola fecha de entrega -> una fila por ruta, como siempre.
  const fila: Record<string, string | null> = { fecha, fecha_entrega: fechaEntrega, ruta, carro_id: carroId ?? '' }
  if ('conductor' in datos) fila.conductor = datos.conductor ?? null
  if ('auxiliar' in datos) fila.auxiliar = datos.auxiliar ?? null
  if ('placa' in datos) fila.placa = datos.placa ?? null
  if ('horaProgramada' in datos) fila.hora_programada = datos.horaProgramada ?? null
  if ('observacion' in datos) fila.observacion = datos.observacion ?? null

  const { error } = await supabase
    .from('documentos_ruta')
    .upsert(fila, { onConflict: 'fecha,ruta,carro_id,fecha_entrega' })

  if (error) {
    console.error('[documentoRuta] Error guardando datos manuales:', error)
    return { ok: false, mensaje: error.message }
  }
  return { ok: true }
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
