import { supabase } from './supabase'
import { RUTAS } from './rutas'
import { sumarDias, DIAS_HASTA_ENTREGA } from './fechaEntrega'

// ════════════════════════════════════════════════════════════════
// TIPOS EXPORTADOS
// ════════════════════════════════════════════════════════════════

export type FilaDocumento = {
  key: string              // identidad ESTABLE de la fila (no depende del orden de la BD)
  cod: string              // celda COD ya formateada (ver formatearCod)
  codigoCliente: string
  // Números de animal TAL CUAL se guardaron ('0001' sigue siendo '0001'), ordenados por su
  // valor numérico y sin repetidos POR TEXTO. Son texto y no número porque el cero a la
  // izquierda es significativo: '0001' y '1' son dos rayas distintas y las dos tienen que
  // salir en el documento.
  animales: string[]
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
  // 'YYYY-MM-DD' — el día PARA EL QUE se entrega. Es LA identidad del documento y lo que
  // elige el selector de la pantalla: la "tabla del 8" es una sola, la hayan armado el 6,
  // el 7 o los dos. La fecha de despacho no participa de la agrupación.
  fechaEntrega: string
  bloques: BloqueRuta[]
  sinRuta: FilaDocumento[] // despachos de la entrega con ruta NULL
  avisos: string[]         // problemas de datos detectados
}

/**
 * Jornada CANÓNICA de una fecha de entrega: entrega − 1, siempre.
 *
 * Existe solo por `documentos_ruta`: su UNIQUE es (fecha, ruta, carro_id, fecha_entrega) e
 * incluye `fecha`, la jornada. Si cada encabezado se guardara con la jornada REAL en que se
 * escribió, la tabla del 8 tendría un encabezado por cada día en que Rafa le fue agregando
 * despachos. Escribiendo siempre esta fecha canónica, todas las escrituras de una entrega
 * chocan contra la MISMA fila y el encabezado queda uno solo.
 *
 * ⚠️ NO ES LA INVERSA de entregaPorDefecto() y no debe intentar serlo. Desde que el sábado
 *    entrega el lunes (+2), esa función dejó de ser invertible: sábado y domingo caen los
 *    dos en lunes, así que "la jornada de una entrega-lunes" es ambigua. Acá no importa:
 *    lo único que se necesita es un valor DETERMINISTA por fecha de entrega, y −1 lo es.
 *    Un despacho del sábado y otro del domingo, ambos para entregar el lunes, escriben el
 *    mismo `fecha` (domingo) y comparten el encabezado, que es lo correcto: es un camión.
 *
 * Además −1 es lo que hay guardado: el backfill de la migración puso
 * fecha_entrega = fecha + 1, o sea fecha = fecha_entrega − 1. Cambiarlo dejaría huérfano
 * cada encabezado ya existente.
 */
export function jornadaCanonica(fechaEntrega: string): string {
  return sumarDias(fechaEntrega, -DIAS_HASTA_ENTREGA)
}

export const UMBRAL_RANGO = 8

/**
 * Identidad de un bloque DENTRO de la jornada. Es la clave con la que se guardan y se
 * leen los datos manuales del encabezado (conductor/auxiliar/placa/hora/observación).
 *
 * Es por JORNADA, no por fecha de entrega: el documento de un día es uno solo, así que
 * una ruta con nombre tiene un encabezado y un carro externo el suyo, sin importar para
 * qué día se entregue cada fila.
 *
 * La usan la pantalla y el export, para que no puedan discrepar.
 */
export function claveBloque(b: { ruta: string; carroId: string | null }): string {
  return `${b.ruta}|${b.carroId ?? ''}`
}

// ════════════════════════════════════════════════════════════════
// PARTE PURA — FORMATO DE LA CELDA COD
// ════════════════════════════════════════════════════════════════

/**
 * Formatea la celda COD. `animales` se asume ordenado por valor numérico y sin repetidos
 * por texto (así lo entrega la agrupación), y se imprime TAL CUAL vino: los ceros a la
 * izquierda son parte del número de raya y no se normalizan.
 */
export function formatearCod(
  codigoCliente: string,
  animales: string[],
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
      // Consecutivos, sin huecos. La comprobación es NUMÉRICA pero los extremos se imprimen
      // con su texto original, así "0007..0014" sale "0007 AL 0014". Si hay dos rayas que
      // valen lo mismo ('0001' y '1'), la cuenta no cierra y cae solo al listado completo,
      // que es justo lo que corresponde: un rango se comería una de las dos.
      Number(animales[animales.length - 1]) - Number(animales[0]) === animales.length - 1
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
  // Jornada con la que se guardó la fila. NO agrupa nada —el documento es la entrega—, pero
  // entra en el UNIQUE de la tabla, así que sirve de desempate cuando una misma entrega
  // tiene encabezados guardados con jornadas distintas. Ver jornadaCanonica().
  fecha: string
  // A qué documento pertenece esta fila: es la fecha de entrega, la identidad del documento.
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

  // El orden entre filas sigue siendo por VALOR del primer animal (2 antes que 10), aunque
  // el arreglo guarde texto. Nunca es NaN: solo entran rayas con número finito.
  const primerA = a.animales.length > 0 ? Number(a.animales[0]) : Infinity
  const primerB = b.animales.length > 0 ? Number(b.animales[0]) : Infinity
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
  //
  // Map y no Set: la CLAVE es el número tal cual se guardó ('0001') y el VALOR su magnitud
  // (1). Con un Set<number> —como estaba— '0001' y '1' colapsaban en la misma entrada y el
  // documento perdía rayas: el código 102 con 0001/0002/1/2 salía como "102-1-2".
  animalesCanal: Map<string, number>
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
  // Orden por VALOR (2 antes que 10), con el texto de desempate para que dos rayas que
  // valen lo mismo ('0001' y '1') queden juntas y en un orden estable entre refrescos.
  const animales = [...g.animalesCanal.entries()]
    .sort(([textoA, valorA], [textoB, valorB]) =>
      valorA - valorB || (textoA < textoB ? -1 : textoA > textoB ? 1 : 0)
    )
    .map(([texto]) => texto)
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
 * Núcleo puro: recibe las filas ya consultadas y arma EL documento de una fecha de entrega.
 *
 * `fechaEntrega` es el ÚNICO criterio de qué entra: todo lo que se entrega ese día cae acá,
 * se haya despachado el día anterior o tres días antes. `despachos` y `manuales` tienen que
 * venir ya filtrados a esa entrega — de eso se encarga construirDocumentoDia().
 */
export function armarDocumento(
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
        animalesCanal: new Map(),
        cant: 0, vb: 0, vr: 0, cabeza: null, patas: null, despachoIds: [], despachoIdsCanal: [],
      }
      grupos.set(key, g)
    }

    g.despachoIds.push(d.id)

    // El número de animal se conserva como TEXTO (con sus ceros a la izquierda) y aparte se
    // calcula su valor, que solo se usa para ordenar. Convertirlo a número para guardarlo
    // era lo que hacía desaparecer rayas: Number('0001') === Number('1').
    const rawAnimal = rb.numero_animal
    const textoAnimal = rawAnimal == null ? '' : String(rawAnimal).trim()
    const numAnimal = textoAnimal === '' ? NaN : Number(textoAnimal)

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
      if (Number.isFinite(numAnimal)) g.animalesCanal.set(textoAnimal, numAnimal)
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

  // Datos manuales por (ruta + carro). `manuales` ya viene filtrado a ESTA fecha de entrega,
  // así que la clave no la lleva. Las rutas con nombre usan carro_id '' -> una sola fila por
  // ruta; cada carro externo tiene la suya.
  //
  // Puede haber más de una fila por ruta si alguna quedó guardada con una jornada distinta
  // de la canónica (el UNIQUE incluye `fecha`). Se ordena para que la de la jornada canónica
  // quede ÚLTIMA y gane el Map: es contra la que escribe la app, o sea la que Rafa edita.
  const claveManual = (ruta: string, carroId: string | null) => `${ruta}|${carroId ?? ''}`
  const manualPorClave = new Map<string, DatosManuales>()
  const jornada = jornadaCanonica(fechaEntrega)
  const manualesOrdenados = [...manuales].sort(
    (a, b) => (a.fecha === jornada ? 1 : 0) - (b.fecha === jornada ? 1 : 0)
  )
  for (const m of manualesOrdenados) {
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

  return { fechaEntrega, bloques, sinRuta, avisos }
}

// ════════════════════════════════════════════════════════════════
// PARTE QUE CONSULTA — DOS consultas por refresco, ni una más
// ════════════════════════════════════════════════════════════════

const SELECT_DESPACHOS =
  'id, registro_id, viscera_id, tipo_despacho, ruta, codigo_destino, cabeza, patas, es_desposte, fraccion, direccion, created_at, carro_id, fecha_entrega, ' +
  'registros_beneficio(codigo_cliente, numero_animal, tipo_carne), viscera:inventario_visceras(tipo)'

/**
 * Construye EL documento de una FECHA DE ENTREGA. `fechaEntrega` es un string 'YYYY-MM-DD'.
 *
 * La entrega es el ÚNICO criterio: todo lo que se entrega ese día entra, sin importar en
 * qué jornada se despachó. Lo cargado el 6 para entregar el 8 y lo cargado el 7 para
 * entregar el 8 son la MISMA tabla del 8.
 *
 * Si una consulta falla: console.error con prefijo [documentoRuta] y devuelve un
 * documento vacío pero válido (nunca lanza).
 */
export async function construirDocumentoDia(
  fechaEntrega: string,
  secuenciaDe?: ResolverSecuencia
): Promise<DocumentoDia> {
  const avisosConsulta: string[] = []
  const jornada = jornadaCanonica(fechaEntrega)

  // Consulta 1: despachos de ESTA entrega, con los joins anidados.
  //
  // El filtro va por fecha_entrega, NO por jornada. Son dos condiciones en OR porque la
  // columna es nullable:
  //   · fecha_entrega = la pedida            -> todo lo que eligió fecha al despachar
  //   · fecha_entrega IS NULL Y fecha_despacho = la pedida − 1
  //                                          -> el histórico anterior a la columna, que
  //                                             siempre se entregó al día siguiente
  // Sin la segunda condición, el histórico desaparecería de la pantalla.
  //
  // El −1 del histórico es FIJO y NO sigue la excepción del sábado: esas filas se armaron
  // cuando la regla era +1 a secas, así que un despacho viejo de sábado se siguió —y se
  // sigue— entregando el domingo a los ojos de la app. Aplicarles la regla nueva movería
  // documentos ya cerrados de una tabla a otra.
  const { data: despData, error: errDesp } = await supabase
    .from('despachos')
    .select(SELECT_DESPACHOS)
    .or(`fecha_entrega.eq.${fechaEntrega},and(fecha_entrega.is.null,fecha_despacho.eq.${jornada})`)
    // El ORDER BY es OBLIGATORIO: sin él Postgres devuelve las filas en orden físico, que
    // cambia cada vez que se hace UPDATE sobre una fila (editar cabeza/patas mueve el
    // registro al final del heap). Ese orden se filtraba al documento y las filas "se
    // revolvían" entre refrescos. Orden por created_at + id = el orden en que Rafa fue
    // despachando, que ahora además encadena bien varias jornadas: lo del 6 antes que lo
    // del 7 dentro de la misma tabla del 8.
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (errDesp) {
    console.error('[documentoRuta] Error consultando despachos:', errDesp)
    avisosConsulta.push('No se pudieron cargar los despachos de esta entrega.')
  }

  // Consulta 2: datos manuales de ESTA entrega. También por fecha_entrega y no por jornada:
  // si no, el encabezado de la tabla del 8 se duplicaría entre el 6 y el 7. La columna es
  // NOT NULL en esta tabla (la migración hizo backfill), así que acá alcanza un igual.
  const { data: manData, error: errMan } = await supabase
    .from('documentos_ruta')
    .select('fecha, ruta, carro_id, fecha_entrega, conductor, auxiliar, placa, hora_programada, observacion')
    .eq('fecha_entrega', fechaEntrega)

  if (errMan) {
    console.error('[documentoRuta] Error consultando documentos_ruta:', errMan)
    avisosConsulta.push('No se pudieron cargar los datos manuales de ruta.')
  }

  const doc = armarDocumento(
    fechaEntrega,
    (despData ?? []) as unknown as DespachoRow[],
    (manData ?? []) as unknown as ManualRow[],
    secuenciaDe
  )
  doc.avisos.unshift(...avisosConsulta)
  return doc
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
  fechaEntrega: string,
  ruta: string,
  datos: Partial<DatosManuales>,
  carroId: string | null = null
): Promise<ResultadoGuardado> {
  // El encabezado pertenece a la ENTREGA: una fila por ruta (y una por carro en Externo)
  // para la tabla del 8, la haya empezado Rafa el 6 o el 7. carro_id '' = ruta con nombre.
  //
  // `fecha` (la jornada) también está en el UNIQUE, así que hay que mandar algo: va SIEMPRE
  // la jornada canónica (entrega − 1). Es determinista, con lo que dos escrituras de la
  // misma entrega hechas en días distintos chocan contra la MISMA fila en vez de crear dos
  // encabezados. El onConflict tiene que nombrar las cuatro columnas del índice único.
  const fila: Record<string, string | null> = {
    fecha: jornadaCanonica(fechaEntrega), fecha_entrega: fechaEntrega, ruta, carro_id: carroId ?? '',
  }
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
