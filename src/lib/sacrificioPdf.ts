import { supabase } from './supabase'

/**
 * Carga masiva de registros de beneficio desde el PDF del ERP externo
 * (VisualERP → "Informe de Sacrificio por Día (Detallado)"), SOLO BOVINOS.
 *
 * Del PDF se usan exactamente dos cosas:
 *   - Del ENCABEZADO: `Fecha Sacrificio: dd/mm/yyyy`, única para todo el archivo. No se lee
 *     fila por fila: la columna "Fecha Hora Sacrificio" de cada fila repite ese mismo día.
 *   - De cada FILA: la columna `Codigo Alterno` (`NNN-NN` o `NN-NN`), que se parte en el `-`:
 *     antes -> codigo_cliente, después -> numero_animal.
 *
 * OJO: el PDF trae ADEMÁS una columna "Numero Animal" con un id interno del ERP
 * (`2608029608`). NO es el número que usa la planta y se ignora por completo. El patrón
 * `\d{2,3}-\d{2}` no lo matchea, así que no hay forma de confundirlos.
 *
 * El resto de columnas (Tipo Animal, Peso En Pie, Peso Canal Cal, Rto. Canal Cal, horas,
 * Cliente, Procedencia) se descartan: `registros_beneficio` no tiene columnas equivalentes.
 *
 * Los cerdos vendrán después con otro informe y otro parser; esto no intenta generalizar.
 */

/** Una fila del cuadro del PDF, ya partida. `codigo_cliente`/`numero_animal` son TEXTO CRUDO. */
export interface FilaSacrificio {
  /** Tal cual salió del PDF: `258-07`. Es lo que se muestra en el preview. */
  codigoAlterno: string
  /** Parte antes del `-`. String, sin normalizar (ver nota de ceros a la izquierda). */
  codigo_cliente: string
  /** Parte después del `-`. String, SIEMPRE 2 dígitos, con su cero a la izquierda (`07`). */
  numero_animal: string
}

export interface ParseSacrificio {
  /** `dd/mm/yyyy`, para mostrar. */
  fechaTexto: string
  /** `yyyy-mm-dd`, lo que se escribe en `fecha_beneficio`. */
  fechaISO: string
  /** Filas en el orden en que aparecen en el PDF. */
  filas: FilaSacrificio[]
  /** Problemas no fatales (p. ej. renglones del cuadro que no se pudieron leer). */
  advertencias: string[]
}

/**
 * Error con mensaje ya redactado para mostrarle al usuario tal cual.
 *
 * `name` se fija a mano para que quien lo atrape pueda reconocerlo SIN importar esta clase
 * (un `import` normal metería este módulo —y su cadena— en el chunk de arranque, que es
 * justo lo que se evita con el dynamic import).
 */
export class SacrificioPdfError extends Error {
  name = 'SacrificioPdfError'
}

// ── Geometría del texto del PDF ──────────────────────────────────────────────
// pdf.js entrega cada trozo de texto suelto con su posición absoluta; el "cuadro" hay que
// reconstruirlo. Dos umbrales, en unidades del PDF (1/72"):
/** Dos trozos con `y` más cerca que esto son el mismo renglón. */
const TOLERANCIA_Y = 2.5
/**
 * Dos trozos separados por menos que esto son la misma celda (`258` + `-` + `07`).
 * Las columnas del informe están a 30-50 pt una de otra y un espacio ronda los 2-3 pt, así
 * que 5 separa columnas sin partir un rótulo de dos palabras ("Codigo Alterno").
 */
const UMBRAL_CELDA = 5
/**
 * Dentro de una celda, hueco a partir del cual hubo un espacio de verdad y no kerning.
 * Sin esto "Codigo" + "Alterno" se pegarían en "CodigoAlterno" y no matchearía el rótulo.
 */
const UMBRAL_ESPACIO = 1
/**
 * Cuánto se pueden separar en X dos PALABRAS para considerarlas de la misma columna. En el
 * informe real "Codigo" arranca en x=126.6 y "Alterno" en x=125.6: 1 pt. Las columnas están
 * a 30-50 pt entre sí, así que 15 (media columna) reconoce el rótulo apilado sin alcanzar
 * nunca a la columna vecina.
 */
const TOLERANCIA_COLUMNA = 15
/**
 * Cuántos renglones arriba/abajo se busca la otra mitad del rótulo. No alcanza con 1: los
 * rótulos de las distintas columnas tienen distinta cantidad de palabras, así que entre
 * "Codigo" (y=561.9) y "Alterno" (y=554.0) se cuela el renglón y=558 de otras columnas. En
 * el PDF real quedan a 2 líneas; 3 deja margen sin aflojar el criterio, porque el filtro que
 * de verdad discrimina es la coincidencia en X.
 */
const RENGLONES_ROTULO = 3

interface TrozoPdf { texto: string; x: number; xFin: number; y: number }
interface Celda { texto: string; centro: number }
/**
 * Trozo suelto del renglón, ANTES de fusionarse en celdas. Se conserva porque el encabezado
 * necesita posiciones a nivel de palabra: las celdas fusionan columnas vecinas (en el informe
 * real "Codigo" queda pegado a "Orden" y "Alterno" a "Prod. Animal"), y con el centro de esas
 * celdas el rótulo apilado no se puede reconocer. Ver ubicarEncabezado().
 */
interface Palabra { texto: string; x: number; xFin: number }
interface Linea { celdas: Celda[]; palabras: Palabra[]; texto: string; normalizado: string }

/** minúsculas y sin tildes, para comparar rótulos sin depender de cómo los escriba el ERP. */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Mismo `+2 días` que la carga manual de Beneficios.tsx (fecha_cobro_frio). */
function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(fechaISO + 'T00:00:00')
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Agrupa los trozos de una página en renglones (por `y`) y cada renglón en celdas (por `x`). */
function armarLineas(trozos: TrozoPdf[]): Linea[] {
  const ordenados = [...trozos].sort((a, b) => (b.y - a.y) || (a.x - b.x))
  const grupos: TrozoPdf[][] = []
  for (const t of ordenados) {
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && Math.abs(ultimo[0].y - t.y) <= TOLERANCIA_Y) ultimo.push(t)
    else grupos.push([t])
  }

  return grupos.flatMap(grupo => {
    // Los trozos en blanco NO son contenido: pdf.js los emite para separar columnas y ocupan
    // justo el hueco entre una y la siguiente. Si se los deja, el hueco desaparece y el
    // renglón entero termina en una sola celda (con eso se perdía la separación de columnas).
    const porX = grupo.filter(t => t.texto.trim() !== '').sort((a, b) => a.x - b.x)
    if (porX.length === 0) return []

    const celdas: Celda[] = []
    let acum = porX[0].texto
    let inicio = porX[0].x
    let fin = porX[0].xFin
    const cerrar = () => {
      const texto = acum.replace(/\s+/g, ' ').trim()
      if (texto !== '') celdas.push({ texto, centro: (inicio + fin) / 2 })
    }
    for (const t of porX.slice(1)) {
      const hueco = t.x - fin
      if (hueco > UMBRAL_CELDA) {
        cerrar()
        acum = t.texto
        inicio = t.x
        fin = t.xFin
      } else {
        acum += (hueco > UMBRAL_ESPACIO ? ' ' : '') + t.texto
        fin = Math.max(fin, t.xFin)
      }
    }
    cerrar()
    if (celdas.length === 0) return []
    const texto = celdas.map(c => c.texto).join(' ')
    const palabras = porX.map(t => ({ texto: t.texto, x: t.x, xFin: t.xFin }))
    return [{ celdas, palabras, texto, normalizado: normalizar(texto) }]
  })
}

// ── Reglas del cuadro ────────────────────────────────────────────────────────
/** `258-07`, `17-01`, `520-03`. El id interno (`2608029608`) no matchea: no tiene `-`. */
const RE_CODIGO_ALTERNO = /^(\d{2,3})-(\d{2})$/
const RE_FECHA = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g
/** Un renglón del cuadro tiene muchas columnas; los pies de página y totales, pocas. */
const CELDAS_MINIMAS_FILA = 4
/**
 * Id interno del ERP de la columna "Numero Animal" (`2608032810`). No se usa como dato —el
 * número de la planta sale del Codigo Alterno— pero sirve para reconocer una fila de verdad.
 */
const RE_ID_INTERNO = /^\d{8,}$/

/**
 * Saca el `Codigo Alterno` de un renglón.
 *
 * Si el renglón trae un solo token con esa forma, es ese y punto. Si trae varios (el ERP
 * podría repetir el patrón en otra columna), se queda con el que caiga más cerca del centro
 * de la columna "Codigo Alterno" del encabezado.
 */
function codigoAlternoDeLinea(linea: Linea, centroColumna: number): string | null {
  const candidatos: { texto: string; centro: number }[] = []
  for (const celda of linea.celdas) {
    for (const token of celda.texto.split(' ')) {
      if (RE_CODIGO_ALTERNO.test(token)) candidatos.push({ texto: token, centro: celda.centro })
    }
  }
  if (candidatos.length === 0) return null
  if (candidatos.length === 1) return candidatos[0].texto
  return candidatos.reduce((mejor, c) =>
    Math.abs(c.centro - centroColumna) < Math.abs(mejor.centro - centroColumna) ? c : mejor
  ).texto
}

/**
 * Ubica el encabezado del cuadro y el centro de la columna "Codigo Alterno".
 *
 * NO se busca la cadena contigua "codigo alterno": en el informe real el rótulo viene
 * APILADO en dos renglones físicos ("Codigo" en y=561.9, "Alterno" en y=554.0, Δy 7.9 pt)
 * porque la columna es angosta, y armarLineas —que une por Δy ≤ 2.5— los deja en líneas
 * distintas. Ese era el motivo de "No encontré la columna Codigo Alterno" con la columna
 * presente. Los PDFs sintéticos no lo reproducían porque metían el rótulo en una línea.
 *
 * El ancla es `alterno`, que solo existe en el informe DETALLADO: el resumido no lo trae y
 * se sigue rechazando. Y se exige `codigo` en la misma columna (misma línea, o la de arriba
 * o la de abajo dentro de media columna en X), así que un "Codigo" suelto tampoco alcanza.
 *
 * La fila del encabezado es la de `alterno`, que es de donde ya salía el centro de columna.
 */
function ubicarEncabezado(lineas: Linea[]): { indice: number; centro: number } | null {
  for (let i = 0; i < lineas.length; i++) {
    const alterno = lineas[i].palabras.find(p => normalizar(p.texto).includes('alterno'))
    if (!alterno) continue

    const desde = Math.max(0, i - RENGLONES_ROTULO)
    const hasta = Math.min(lineas.length - 1, i + RENGLONES_ROTULO)
    for (let j = desde; j <= hasta; j++) {
      const tieneCodigo = lineas[j].palabras.some(
        p =>
          normalizar(p.texto).includes('codigo') &&
          Math.abs(p.x - alterno.x) <= TOLERANCIA_COLUMNA
      )
      // El centro sale de la palabra "Alterno" y NO de su celda: la celda fusiona las columnas
      // vecinas ("Alterno Prod. Animal") y su centro cae corrido ~26 pt a la derecha, justo
      // donde no están los códigos de las filas.
      if (tieneCodigo) return { indice: i, centro: (alterno.x + alterno.xFin) / 2 }
    }
  }
  return null
}

/**
 * ¿El renglón tiene pinta de fila del cuadro? Se exige el id interno del ERP, que TODA fila
 * trae en la columna "Numero Animal".
 *
 * Sin ese requisito se contaban como ilegibles las CONTINUACIONES: cuando el nombre del
 * cliente o la procedencia no entran en su columna, el ERP los envuelve a un segundo renglón
 * ("51.40 SUPER LA 80 25 Ago 25 Ago"), que tiene 4+ celdas y dígitos pero no es una fila. En
 * el informe del 25/08 eso levantaba 4 falsas alarmas sobre un parseo perfecto de 120 filas.
 */
function pareceFilaDelCuadro(linea: Linea): boolean {
  return (
    linea.celdas.length >= CELDAS_MINIMAS_FILA &&
    linea.texto.split(/\s+/).some(t => RE_ID_INTERNO.test(t))
  )
}

/** ¿La línea es (parte de) el encabezado del cuadro? Se repite en cada página. */
function esLineaDeEncabezado(linea: Linea): boolean {
  return linea.palabras.some(p => normalizar(p.texto).includes('alterno'))
}

/** `dd/mm/yyyy` -> `yyyy-mm-dd`, validando que sea un día real. */
function aISO(dd: string, mm: string, yyyy: string): string | null {
  const d = Number(dd), m = Number(mm), y = Number(yyyy)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const fecha = new Date(y, m - 1, d)
  if (fecha.getFullYear() !== y || fecha.getMonth() !== m - 1 || fecha.getDate() !== d) return null
  return `${yyyy}-${mm}-${dd}`
}

function fechasDe(texto: string): string[] {
  const out: string[] = []
  for (const m of texto.matchAll(RE_FECHA)) {
    const iso = aISO(m[1], m[2], m[3])
    if (iso) out.push(iso)
  }
  return out
}

/**
 * La única fecha de sacrificio del encabezado.
 *
 * Se busca solo en los renglones ANTERIORES al encabezado del cuadro (el que dice "Codigo
 * Alterno"), y de esos, en los que hablan de sacrificio: así queda afuera la "Fecha de
 * impresión", que es otro día y si no haría fallar el chequeo de fecha única. El encabezado
 * se repite en cada página, pero todas traen el mismo día, así que el conjunto sigue siendo
 * de uno solo.
 */
function fechaSacrificioDelEncabezado(encabezados: Linea[]): string {
  const deSacrificio = encabezados.filter(l => l.normalizado.includes('sacrificio'))
  let candidatas = [...new Set(deSacrificio.flatMap(l => fechasDe(l.texto)))]

  if (candidatas.length === 0) {
    // El ERP podría poner el rótulo en un renglón y el valor en el de abajo. Ahí se toman
    // todas las fechas del encabezado menos las de impresión/emisión, que nunca son la del
    // sacrificio.
    const utiles = encabezados.filter(l =>
      !/impres|emiti|emisi|generad|usuario|pagina/.test(l.normalizado)
    )
    candidatas = [...new Set(utiles.flatMap(l => fechasDe(l.texto)))]
  }

  if (candidatas.length === 0) {
    throw new SacrificioPdfError(
      'No encontré la "Fecha Sacrificio" en el encabezado del PDF. Revisá que sea el informe completo.'
    )
  }
  if (candidatas.length > 1) {
    const legibles = candidatas.map(f => f.split('-').reverse().join('/')).join(' y ')
    throw new SacrificioPdfError(
      `El encabezado trae más de una fecha de sacrificio (${legibles}). Cargá un informe de un solo día.`
    )
  }
  return candidatas[0]
}

/**
 * Lee el PDF y devuelve la fecha de sacrificio y las filas.
 *
 * pdfjs-dist entra por DYNAMIC IMPORT a propósito: es la librería más pesada del proyecto y
 * no puede caer en el bundle inicial (ver el techo de precache en vite.config.ts). Este
 * módulo se importa también dinámicamente desde Beneficios.tsx para que ni la referencia
 * quede en el chunk de arranque.
 */
export async function parsearSacrificioPdf(file: File): Promise<ParseSacrificio> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).catch(() => {
    throw new SacrificioPdfError('No se pudo cargar el lector de PDF. Revisá la conexión y probá de nuevo.')
  })
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  const datos = new Uint8Array(await file.arrayBuffer())
  let doc
  try {
    // Solo interesa el texto: sin convertir fuentes se abre más rápido y no sale a buscar
    // recursos afuera (la app corre como PWA y esto puede pasar con red mala).
    doc = await pdfjs.getDocument({ data: datos, disableFontFace: true }).promise
  } catch {
    throw new SacrificioPdfError('No pude abrir el archivo: no parece un PDF válido o está dañado.')
  }

  const lineas: Linea[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n)
      const contenido = await pagina.getTextContent()
      const trozos: TrozoPdf[] = []
      for (const item of contenido.items) {
        // Los TextMarkedContent no traen texto ni posición; solo sirven los TextItem.
        if (!('str' in item)) continue
        if (item.str === '') continue
        const x = item.transform[4]
        trozos.push({ texto: item.str, x, xFin: x + (item.width ?? 0), y: item.transform[5] })
      }
      if (trozos.length > 0) lineas.push(...armarLineas(trozos))
    }
  } finally {
    void doc.destroy()
  }

  if (lineas.length === 0) {
    throw new SacrificioPdfError('El PDF no tiene texto legible (¿es un escaneo?). Descargalo de nuevo desde el ERP.')
  }

  const textoCompleto = lineas.map(l => l.normalizado).join(' | ')
  // Igual que el rótulo de la columna, un título puede quedar partido en dos renglones. Para
  // las frases se compara además contra cada PAR de líneas consecutivas, así "Informe de" +
  // "Sacrificio por Día" también matchea. (En el informe real de hoy el título viene entero
  // en un solo TextItem; esto es para que no se rompa si el ERP cambia el ancho.)
  const textoConVecinas = lineas
    .map((l, i) => (i + 1 < lineas.length ? `${l.normalizado} ${lineas[i + 1].normalizado}` : l.normalizado))
    .join(' | ')

  if (!textoConVecinas.includes('informe de sacrificio')) {
    throw new SacrificioPdfError(
      'Este PDF no es el "Informe de Sacrificio por Día" de VisualERP. Cargá ese informe.'
    )
  }
  // Solo bovinos por ahora. Se rechaza cuando el informe SE VE de porcinos (y no de bovinos),
  // no al revés: así un informe de bovinos nunca queda afuera por no repetir la palabra.
  if (/porcin|cerdo/.test(textoCompleto) && !textoCompleto.includes('bovin')) {
    throw new SacrificioPdfError(
      'Este es el informe de Porcinos. Por ahora solo se puede cargar el de Bovinos.'
    )
  }

  const encabezado = ubicarEncabezado(lineas)
  if (encabezado === null) {
    throw new SacrificioPdfError(
      'No encontré la columna "Codigo Alterno" en el PDF. Tiene que ser el informe DETALLADO.'
    )
  }
  const iEncabezado = encabezado.indice

  const filas: FilaSacrificio[] = []
  let ilegibles = 0
  // El encabezado se repite en cada página; se saltan sus renglones y los pies, que no traen
  // ningún token con forma de Codigo Alterno.
  for (const linea of lineas.slice(iEncabezado + 1)) {
    const codigoAlterno = codigoAlternoDeLinea(linea, encabezado.centro)
    if (!codigoAlterno) {
      // Renglón con pinta de fila del cuadro pero sin código legible: se avisa, no se inventa.
      // El encabezado se repite en cada página y se reconoce por 'alterno', no por la cadena
      // entera, por lo mismo que arriba: viene apilado en dos renglones.
      if (pareceFilaDelCuadro(linea) && !esLineaDeEncabezado(linea)) ilegibles++
      continue
    }
    const [, codigo, numero] = RE_CODIGO_ALTERNO.exec(codigoAlterno)!
    // Se guardan TAL CUAL: `07` es `07`, nunca 7. Ver nota de ceros a la izquierda abajo.
    filas.push({ codigoAlterno, codigo_cliente: codigo, numero_animal: numero })
  }

  if (filas.length === 0) {
    throw new SacrificioPdfError(
      'El PDF no trae ninguna fila con "Codigo Alterno" (formato 258-07). ¿Está vacío el informe?'
    )
  }

  const advertencias: string[] = []
  if (ilegibles > 0) {
    advertencias.push(
      `${ilegibles} ${ilegibles === 1 ? 'renglón del cuadro no se pudo leer' : 'renglones del cuadro no se pudieron leer'}. Compará el total con el del PDF antes de confirmar.`
    )
  }

  const fechaISO = fechaSacrificioDelEncabezado(lineas.slice(0, iEncabezado))
  return { fechaTexto: fechaISO.split('-').reverse().join('/'), fechaISO, filas, advertencias }
}

// ── Contra la base ───────────────────────────────────────────────────────────

/**
 * Clave de duplicado: (codigo, numero, fecha). La fecha ya está fijada para todo el PDF, así
 * que alcanza con las dos primeras.
 *
 * Se compara por TEXTO EXACTO, sin normalizar ceros a la izquierda. Es a propósito: la tabla
 * guarda `codigo_cliente`/`numero_animal` como texto y el resto de la app imprime el número
 * de raya tal cual vino (ver documentoRuta.ts). Normalizar acá para "emparejar" un `7` viejo
 * con el `07` del PDF sería justamente el bug de ceros que hay abierto.
 */
function clave(codigo: string, numero: string): string {
  return `${codigo}|${numero}`
}

export interface FilaClasificada extends FilaSacrificio {
  duplicada: boolean
}

export interface FilasClasificadas {
  /** Todas las filas, EN EL ORDEN DEL PDF, cada una marcada. Es lo que lista el preview. */
  todas: FilaClasificada[]
  nuevas: FilaSacrificio[]
  duplicadas: FilaSacrificio[]
}

/**
 * Parte las filas del PDF en nuevas y duplicadas contra lo que ya hay en la tabla para esa
 * fecha. Una sola consulta.
 *
 * No se filtra por `estado`: un animal ya despachado sigue ocupando su (codigo, numero,
 * fecha) y volver a insertarlo reventaría contra el UNIQUE.
 *
 * También cuentan como duplicadas las repeticiones DENTRO del mismo PDF: si el informe
 * trajera dos veces `258-07`, insertar las dos tumbaría el lote entero por el UNIQUE.
 */
export async function clasificarFilas(
  filas: FilaSacrificio[],
  fechaISO: string
): Promise<FilasClasificadas> {
  const { data, error } = await supabase
    .from('registros_beneficio')
    .select('codigo_cliente, numero_animal')
    .eq('fecha_beneficio', fechaISO)
    .eq('tipo_carne', 'res')

  if (error) {
    console.error('[clasificarFilas] Error consultando registros_beneficio:', error)
    throw new SacrificioPdfError('No pude consultar los registros existentes. Revisá la conexión y probá de nuevo.')
  }

  const yaEstan = new Set((data ?? []).map(r => clave(String(r.codigo_cliente), String(r.numero_animal))))
  const todas: FilaClasificada[] = []
  const nuevas: FilaSacrificio[] = []
  const duplicadas: FilaSacrificio[] = []
  const vistas = new Set<string>()
  for (const f of filas) {
    const k = clave(f.codigo_cliente, f.numero_animal)
    const duplicada = yaEstan.has(k) || vistas.has(k)
    todas.push({ ...f, duplicada })
    if (duplicada) {
      duplicadas.push(f)
      continue
    }
    vistas.add(k)
    nuevas.push(f)
  }
  return { todas, nuevas, duplicadas }
}

export interface ResultadoInsercion {
  insertados: number
  saltados: number
  advertencias: string[]
}

/**
 * Inserta las filas nuevas en UNA sola llamada. Los duplicados no se tocan (skip silencioso).
 *
 * `origen_carga` es opcional: si la migración no se corrió, PostgREST responde PGRST204
 * ("no existe la columna") y se reintenta sin ese campo. Así la funcionalidad no depende de
 * un .sql que puede no estar puesto todavía.
 */
export async function insertarFilas(
  clasificadas: FilasClasificadas,
  fechaISO: string
): Promise<ResultadoInsercion> {
  const saltados = clasificadas.duplicadas.length
  if (clasificadas.nuevas.length === 0) return { insertados: 0, saltados, advertencias: [] }

  const base = clasificadas.nuevas.map(f => ({
    codigo_cliente: f.codigo_cliente,
    numero_animal: f.numero_animal,
    tipo_carne: 'res' as const,
    fecha_beneficio: fechaISO,
    fecha_cobro_frio: sumarDias(fechaISO, 2),
    estado: 'activo' as const,
  }))

  let { data, error } = await supabase
    .from('registros_beneficio')
    .insert(base.map(r => ({ ...r, origen_carga: 'pdf' })))
    .select('id, codigo_cliente, numero_animal')

  if (error?.code === 'PGRST204') {
    ;({ data, error } = await supabase
      .from('registros_beneficio')
      .insert(base)
      .select('id, codigo_cliente, numero_animal'))
  }

  if (error || !data) {
    console.error('[insertarFilas] Error insertando registros_beneficio:', error)
    throw new SacrificioPdfError(
      error?.code === '23505'
        ? 'Alguno de esos animales ya estaba registrado con esa fecha. No se insertó nada; volvé a cargar el PDF.'
        : 'Error al guardar los registros. No se insertó nada; probá de nuevo.'
    )
  }

  const advertencias: string[] = []

  // Ceros a la izquierda: si la columna fuera numérica, `07` volvería como 7 y el registro
  // quedaría mal guardado. Se compara lo que devolvió la base contra lo que se mandó.
  const mandadas = new Set(base.map(r => clave(r.codigo_cliente, r.numero_animal)))
  const distintas = data.filter(r => !mandadas.has(clave(String(r.codigo_cliente), String(r.numero_animal))))
  if (distintas.length > 0) {
    advertencias.push(
      `${distintas.length} registros quedaron guardados distinto de como venían en el PDF (p. ej. ${distintas[0].codigo_cliente}-${distintas[0].numero_animal}). Avisá al administrador.`
    )
  }

  // Las vísceras (roja + blanca por res) las crea el trigger crear_viscera_automatica.
  // Mismo chequeo que hacen la carga individual y la de lote.
  const { data: visceras } = await supabase
    .from('inventario_visceras')
    .select('registro_id')
    .in('registro_id', data.map(r => r.id))
  const conVisceras = new Set((visceras ?? []).map(v => v.registro_id))
  const sinVisceras = data.filter(r => !conVisceras.has(r.id)).length
  if (sinVisceras > 0) {
    advertencias.push(
      `${sinVisceras} animales quedaron sin vísceras creadas. Contactá al administrador.`
    )
  }

  return { insertados: data.length, saltados, advertencias }
}
