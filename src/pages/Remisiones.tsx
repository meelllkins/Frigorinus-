import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as EventoTeclado, ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  FileSignature,
  Info,
  Loader2,
  Plus,
  Printer,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import {
  actualizarRemision,
  contarFilasPorRemision,
  crearRemision,
  eliminarRemision,
  FILAS_POR_HOJA,
  listarRemisiones,
  obtenerRemision,
  proximoFolio,
  puedeEditarse,
  type Remision,
  type RemisionCompleta,
  type RemisionFilaEntrada,
} from '../lib/remisiones'

// ════════════════════════════════════════════════════════════════
// REMISIÓN DE SALIDA DE DESPACHOS — pantalla
// ════════════════════════════════════════════════════════════════
// La plantilla replica el papel que Rafa llena a mano por cada camión. Dos
// diferencias a propósito: el número lo asigna la app (salvo el primero, que es
// el folio de su talonario) y las firmas se hacen sobre el papel impreso — acá
// son campos de texto que salen en blanco si no se escriben.
//
// Todo lo de UI (avisos, botón ocupado, estado vacío) vive EN ESTE ARCHIVO a
// propósito: no hay módulo de UX compartido y no se va a crear uno acá.

const HOY = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const FILAS_INICIALES = 5

// Cuántas filas de datos entran por hoja impresa junto con el encabezado y el
// pie completos (ver la nota grande sobre `.hoja-impresion` más abajo, donde
// se arma cada bloque). Calculado con las medidas reales en @media print:
// hoja carta horizontal con margen 0.6cm da ~20.4cm útiles; el encabezado
// completo mide ~7.6cm y el pie (TOTAL + firmas) ~3.3cm, sobran ~9.5cm — un
// poco más de 6 filas a 1.2cm cada una. Se deja en 6 y no en el máximo
// (7.9) para tener margen si alguna celda envuelve a dos líneas.
//
// Vive en lib/remisiones.ts y se importa acá: es el MISMO número con el que se
// reserva el rango de folios al crear, así que no puede haber dos copias en el
// frontend. (La tercera copia inevitable está en el RPC, del lado de la base.)

/** Parte un array en bloques de a lo sumo `porBloque` elementos, para armar
 *  una hoja impresa por bloque. Nunca vacío: sin filas, igual hay que
 *  imprimir una hoja con el encabezado y el pie. */
function enBloques<T>(items: T[], porBloque: number): T[][] {
  const bloques: T[][] = []
  for (let i = 0; i < items.length; i += porBloque) bloques.push(items.slice(i, i + porBloque))
  return bloques.length > 0 ? bloques : [[]]
}

/** Las seis celdas de una fila del cuadro. Todo texto libre, como en el papel. */
interface Celdas {
  cliente: string
  producto: string
  und_kg: string
  canastillas: string
  destino: string
  firma_recibido: string
}

const celdasVacias = (): Celdas => ({
  cliente: '',
  producto: '',
  und_kg: '',
  canastillas: '',
  destino: '',
  firma_recibido: '',
})

// ── Total de Und/Kg ─────────────────────────────────────────────────────────
// Und/Kg es texto libre: Rafa escribe "4", "2 und" o "45,5" según le sirva. Para
// sumar la columna se sacan los números del texto y se ignora el resto.
//
// La coma es el separador DECIMAL, que es como se escribe acá. El punto se acepta
// como decimal también, porque es lo que sale de un teclado numérico. La contra es
// que "1.500" se lee como 1,5 y no como mil quinientos: no hay forma de distinguir
// los dos casos sin adivinar, y en una remisión las cantidades son chicas, así que
// se prefiere que el decimal ande.
const RE_NUMERO = /\d+(?:[.,]\d+)?/g

/** Suma TODOS los números que aparezcan en el texto. Sin números da 0. */
function sumarNumeros(texto: string): number {
  let suma = 0
  for (const m of texto.matchAll(RE_NUMERO)) suma += Number(m[0].replace(',', '.'))
  return suma
}

/**
 * Formatea el total para la celda: entero sin decimales (16, no 16,0) y decimal
 * con coma. Vacío cuando no hay nada que sumar — un formulario en blanco impreso
 * con un "0" en el TOTAL se ve mal y no dice nada.
 *
 * El redondeo a 3 decimales es contra el ruido del punto flotante: sin él,
 * 45,5 + 45,6 puede terminar en 91,10000000000001.
 */
function formatearTotal(n: number): string {
  if (!Number.isFinite(n) || n === 0) return ''
  const r = Math.round(n * 1000) / 1000
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',')
}

// ── Enter = pasar al campo siguiente ────────────────────────────────────────
/**
 * Se llena a mano, campo por campo, y con el talonario al lado: tabular entre
 * seis columnas con el mouse es lo que hace lenta la carga. Enter avanza al
 * input siguiente, que es como se llena una planilla.
 *
 * Va DELEGADO en el contenedor de la plantilla en vez de un handler por input:
 * las filas del cuadro son variables (Rafa agrega las que necesite), así que
 * mantener un ref por celda obligaría a un registro que se ensucia al agregar o
 * quitar filas. El orden del DOM ya es el orden visual pedido —fecha, conductor,
 * cédula, placa, y después el cuadro de izquierda a derecha y de arriba abajo—,
 * así que alcanza con preguntarle al DOM cuál es el que sigue.
 *
 * Se saltean los `readonly` (el TOTAL de Und/Kg, que lo calcula la app) y los
 * `disabled` (la remisión archivada, donde no hay nada que tipear).
 */
function enterAlSiguiente(e: EventoTeclado<HTMLDivElement>) {
  if (e.key !== 'Enter') return
  // Solo los inputs/textareas: sin esto el Enter sobre "Agregar fila" o
  // "Guardar" también caería acá con su preventDefault y el botón dejaría de
  // responder al teclado. Los textarea de las celdas de fila entran acá
  // también: sin este chequeo el Enter les metería un salto de línea en vez
  // de pasar al campo siguiente, como siempre se hizo con los inputs.
  const actual = e.target
  if (!(actual instanceof HTMLInputElement) && !(actual instanceof HTMLTextAreaElement)) return

  e.preventDefault()
  const campos = Array.from(
    e.currentTarget.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])'
    )
  )
  const i = campos.indexOf(actual)
  // En el último no pasa nada: el foco se queda ahí y NO se agregan filas solas.
  if (i >= 0 && i + 1 < campos.length) campos[i + 1].focus()
}

/** Lo que vuelve de la base: las mismas celdas pero nullable. */
type CeldasDeBase = { [K in keyof Celdas]?: string | null }

const aCeldas = (f: CeldasDeBase | null | undefined): Celdas => ({
  cliente: f?.cliente ?? '',
  producto: f?.producto ?? '',
  und_kg: f?.und_kg ?? '',
  canastillas: f?.canastillas ?? '',
  destino: f?.destino ?? '',
  firma_recibido: f?.firma_recibido ?? '',
})

// ── Avisos ──────────────────────────────────────────────────────────────────

type TipoAviso = 'exito' | 'error' | 'info'
interface Aviso { id: number; tipo: TipoAviso; texto: string }

const DURACION: Record<TipoAviso, number> = { exito: 3500, info: 5000, error: 6000 }
const ESTILO_AVISO: Record<TipoAviso, { icono: typeof CheckCircle; cls: string }> = {
  exito: { icono: CheckCircle, cls: 'border-green-300 bg-green-50 text-green-900' },
  error: { icono: XCircle, cls: 'border-red-300 bg-red-50 text-red-900' },
  info: { icono: Info, cls: 'border-blue-300 bg-blue-50 text-blue-900' },
}

/** Contador a nivel de módulo y no un useRef: leer un ref dentro del closure de
 *  un callback lo marca la regla react-hooks/refs. Solo se toca desde handlers. */
let ultimoIdAviso = 0

interface PropsTarjetaAviso {
  aviso: Aviso
  onCerrar: (id: number) => void
}

/** A nivel de módulo, no dentro del render de la página: un componente definido
 *  adentro de otro se re-crea en cada pasada y rompe las reglas del compiler. */
function TarjetaAviso({ aviso, onCerrar }: PropsTarjetaAviso) {
  useEffect(() => {
    const t = setTimeout(() => onCerrar(aviso.id), DURACION[aviso.tipo])
    return () => clearTimeout(t)
  }, [aviso.id, aviso.tipo, onCerrar])

  const { icono: Icono, cls } = ESTILO_AVISO[aviso.tipo]
  return (
    <div role="status" className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg animate-slideDown ${cls}`}>
      <Icono size={17} className="mt-0.5 shrink-0" />
      <p className="flex-1 text-sm font-medium break-words">{aviso.texto}</p>
      <button type="button" onClick={() => onCerrar(aviso.id)} aria-label="Cerrar aviso" className="shrink-0 opacity-60 hover:opacity-100">
        <X size={15} />
      </button>
    </div>
  )
}

// ── Botón que se bloquea mientras su acción corre ────────────────────────────

interface PropsBoton {
  onClick: () => void | Promise<void>
  children: ReactNode
  className?: string
  disabled?: boolean
  title?: string
}

/**
 * Si el onClick devuelve una promesa, el botón queda deshabilitado con spinner
 * hasta que resuelva. Sin esto, un doble click sobre "Guardar" crea la remisión
 * dos veces y quema un número del talonario.
 */
function BotonAccion({ onClick, children, className = '', disabled, title }: PropsBoton) {
  const [ocupado, setOcupado] = useState(false)
  return (
    <button
      type="button"
      title={title}
      disabled={disabled || ocupado}
      onClick={() => {
        if (ocupado) return
        const r = onClick()
        if (!(r instanceof Promise)) return
        setOcupado(true)
        r.catch(e => console.error('[Remisiones] La acción falló:', e)).finally(() => setOcupado(false))
      }}
      className={`inline-flex items-center justify-center gap-1.5 transition-all duration-200 active:scale-95 disabled:opacity-50 ${className}`}
    >
      {ocupado && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

// ── Modal de confirmación (para borrar) ──────────────────────────────────────

interface PropsConfirmar {
  titulo: string
  mensaje: string
  textoConfirmar: string
  onCancelar: () => void
  onConfirmar: () => void | Promise<void>
}

function ModalConfirmar({ titulo, mensaje, textoConfirmar, onCancelar, onConfirmar }: PropsConfirmar) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 animate-fadeIn"
      onClick={e => { if (e.target === e.currentTarget) onCancelar() }}
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl animate-scaleIn">
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle size={17} className="shrink-0 text-red-500" />
          <h3 className="text-base font-bold text-gray-900">{titulo}</h3>
        </div>
        <p className="mb-6 text-sm text-gray-600">{mensaje}</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancelar} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200">
            Cancelar
          </button>
          <BotonAccion onClick={onConfirmar} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500">
            {textoConfirmar}
          </BotonAccion>
        </div>
      </div>
    </div>
  )
}

// ── Plantilla (modal) ────────────────────────────────────────────────────────

const inputCelda =
  'w-full resize-none overflow-hidden border-0 bg-transparent px-1.5 py-1 text-sm leading-snug focus:outline-none focus:bg-yellow-50 disabled:bg-transparent'
const inputCampo =
  'w-full border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-green-700 disabled:bg-gray-50 disabled:text-gray-600'
// Los rótulos de columna van en peso medio y no en negrita: en el formato
// oficial son letra chica de planilla. El contraste lo da el gris 900, no el
// peso, para que no compitan con el título ni con las firmas.
const thCls =
  'border border-gray-800 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide leading-tight text-gray-900'
const tdCls = 'border border-gray-800 p-0 align-top'

/**
 * Celda de fila del cuadro: un <textarea> de una línea que crece con el
 * contenido en vez de tapar el texto (Rafa escribe cosas largas en
 * CANASTILLAS, tipo "V. Blancas 13 V. Rojas 13 Cabezas 13 Patas 42").
 *
 * El ajuste de alto es un efecto sobre el DOM (leer scrollHeight y escribir
 * height), no un setState en el render: no dispara re-render ni choca con el
 * React Compiler.
 */
function CeldaFila({
  value,
  onChange,
  disabled,
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={`${inputCelda} ${className}`}
    />
  )
}

interface PropsModal {
  /** null = remisión nueva. */
  existente: RemisionCompleta | null
  /** Solo para la nueva: folio con el que arrancaría, o null si es la primera
   *  de la historia y hay que pedírselo a Rafa. */
  folioSugerido: number | null
  onCerrar: () => void
  onGuardado: (texto: string) => void
  onError: (texto: string) => void
  onInfo: (texto: string) => void
}

function ModalRemision({ existente, folioSugerido, onCerrar, onGuardado, onError, onInfo }: PropsModal) {
  const filasExistentes = existente?.filas.filter(f => !f.es_total) ?? []
  const totalExistente = existente?.filas.find(f => f.es_total) ?? null

  const [folioTexto, setFolioTexto] = useState(
    existente ? String(existente.remision.folio_inicio) : folioSugerido != null ? String(folioSugerido) : ''
  )
  const [fecha, setFecha] = useState(existente?.remision.fecha ?? HOY())
  const [conductor, setConductor] = useState(existente?.remision.conductor ?? '')
  const [cedula, setCedula] = useState(existente?.remision.cedula ?? '')
  const [placa, setPlaca] = useState(existente?.remision.placa ?? '')
  const [firmaResponsable, setFirmaResponsable] = useState(existente?.remision.firma_responsable ?? '')
  const [firmaConductor, setFirmaConductor] = useState(existente?.remision.firma_conductor ?? '')
  const [filas, setFilas] = useState<Celdas[]>(
    filasExistentes.length > 0
      ? filasExistentes.map(aCeldas)
      : Array.from({ length: FILAS_INICIALES }, celdasVacias)
  )
  const [total, setTotal] = useState<Celdas>(aCeldas(totalExistente))
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false)

  // El candado de R1: una remisión solo se toca el mismo día. Una nueva siempre
  // es de hoy, así que siempre entra editable.
  const editable = existente ? puedeEditarse(existente.remision.fecha) : true
  // El folio solo se teclea en la PRIMERA remisión de la historia: ahí el
  // contador todavía no está sembrado, proximoFolio() devuelve null y el
  // número lo pone Rafa desde su talonario. El RPC siembra el contador con él.
  const folioEditable = !existente && folioSugerido == null

  // Al abrir una archivada, se explica por qué no se puede tocar. Se avisa una
  // sola vez, al montar.
  useEffect(() => {
    if (existente && !puedeEditarse(existente.remision.fecha)) {
      onInfo(
        `La remisión N° ${existente.remision.folio_inicio} es del ${existente.remision.fecha} y solo se podía modificar ese mismo día. Se puede ver e imprimir, pero no editar ni borrar.`
      )
    }
  }, [existente, onInfo])

  const setCelda = (i: number, campo: keyof Celdas, valor: string) =>
    setFilas(prev => prev.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)))

  // El total de Und/Kg se DERIVA de las filas en pleno render: no es estado, no hay
  // efecto que lo sincronice y no puede quedar desfasado de lo que se ve arriba. Por
  // eso se recalcula solo con cada tecla, sin que Rafa confirme nada.
  //
  // Canastillas NO se suma: ahí Rafa escribe cosas como "V. Blancas 3 V. Rojas 3",
  // que no son una cantidad.
  const totalUndKg = formatearTotal(filas.reduce((acc, f) => acc + sumarNumeros(f.und_kg), 0))

  // Una hoja impresa por bloque de filas: ver la nota sobre `.hoja-impresion`
  // más abajo, donde se explica por qué esto se arma a mano en vez de
  // confiarle la repetición del encabezado/pie a thead/tfoot.
  const bloquesImpresion = enBloques(filas, FILAS_POR_HOJA)

  function aEntradas(): RemisionFilaEntrada[] {
    return [
      ...filas.map(f => ({ ...f, es_total: false })),
      // El und_kg que se guarda es el calculado, no el que trajo la base: la celda
      // ya no se escribe a mano, así que lo que vale es lo que suman las filas.
      { ...total, und_kg: totalUndKg, es_total: true },
    ]
  }

  async function guardar() {
    if (!editable) return
    if (existente) {
      const r = await actualizarRemision(existente.remision.id, {
        fecha,
        conductor,
        cedula,
        placa,
        firma_responsable: firmaResponsable,
        firma_conductor: firmaConductor,
        filas: aEntradas(),
      })
      if (r.ok) onGuardado(`Remisión N° ${existente.remision.folio_inicio} guardada.`)
      else onError(r.mensaje)
      return
    }

    // Nueva. Con el campo editable (primera de la historia) el folio es
    // obligatorio: sin él el contador no tiene con qué sembrarse.
    let folioInicial: number | null = null
    if (folioEditable) {
      const n = Number(folioTexto.trim())
      if (!Number.isInteger(n) || n <= 0) {
        onError('Escribí el número de la remisión: es la primera y no hay correlativo anterior.')
        return
      }
      folioInicial = n
    }
    const r = await crearRemision({
      folio_inicial: folioInicial,
      fecha,
      conductor,
      cedula,
      placa,
      firma_responsable: firmaResponsable,
      firma_conductor: firmaConductor,
      filas: aEntradas(),
    })
    if (r.ok) onGuardado(`Remisión N° ${r.folio_inicio} creada.`)
    else onError(r.mensaje)
  }

  async function borrar() {
    if (!existente) return
    const r = await eliminarRemision(existente.remision.id)
    setConfirmandoBorrado(false)
    if (r.ok) onGuardado(`Remisión N° ${existente.remision.folio_inicio} eliminada.`)
    else onError(r.mensaje)
  }

  const folioMostrado = existente ? existente.remision.folio_inicio : folioSugerido

  // Folio de cada hoja impresa. En papel cada hoja que Rafa arranca del
  // talonario para una misma remisión larga es una hoja física distinta, con
  // el siguiente número — no el mismo repetido. Por eso la hoja N (0 = la
  // primera) lleva `folio_inicio + N`.
  //
  // Para una remisión GUARDADA el folio sale de la base, del rango que se le
  // reservó al crearla. Para una nueva todavía sin guardar es una vista previa
  // con el folio sugerido: la reserva real la hace el RPC recién al guardar, y
  // si en el medio entró otra remisión, el folio definitivo será otro.
  const folioBaseImpresion = folioEditable ? Number(folioTexto) || null : folioMostrado

  // Hojas efectivamente reservadas (null en una remisión nueva, que todavía no
  // tiene reserva). El candado de actualizarRemision() impide que las filas
  // crezcan más allá del rango, así que bloquesImpresion.length nunca debería
  // superarlo; si por algún camino lo hiciera, la hoja de más se imprime SIN
  // folio en vez de inventar uno que le pertenece a otra remisión.
  const hojasReservadas = existente?.remision.hojas_reservadas ?? null
  const folioDeHoja = (indice: number): number | null => {
    if (folioBaseImpresion == null) return null
    if (hojasReservadas != null && indice >= hojasReservadas) return null
    return folioBaseImpresion + indice
  }

  return (
    <div
      className="overlay-remision fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 animate-fadeIn"
      onClick={e => { if (e.target === e.currentTarget) onCerrar() }}
    >
      <div
        id="remision-imprimible"
        onKeyDown={enterAlSiguiente}
        className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-xl animate-scaleIn"
      >
        {/* ── Pantalla: la plantilla editable, tal cual la llena Rafa ──
               No va al papel — `no-imprimir` oculta TODO este bloque al
               imprimir. Lo impreso es el bloque `.solo-impresion` de más
               abajo, armado aparte (ver la nota grande ahí) para poder
               repetir encabezado y pie completos en cada hoja real. */}
        <div className="no-imprimir">
          {/* ── Encabezado: logo + datos de la empresa ──
                 Grilla de tres columnas con la tercera del mismo ancho que el
                 logo. Antes era un flex y los datos de la empresa, al ser
                 `flex-1 text-center`, se centraban en el espacio QUE SOBRABA a
                 la derecha del logo: quedaban corridos, y el título de abajo —
                 centrado en el espacio que sobraba a la izquierda del N° —
                 quedaba corrido para el otro lado. Con la columna espejo los
                 dos bloques comparten el eje real de la hoja. */}
          <div className="relative mb-5 grid grid-cols-1 items-center justify-items-center gap-3 sm:grid-cols-[9rem_1fr_9rem] sm:justify-items-stretch">
            <img src="/logo-frigorinus.jpg" alt="Frigorinus" className="h-auto w-36" />
            <div className="text-center text-[13px] leading-tight text-gray-800">
              <p className="font-bold">Frigorinus SAS.</p>
              <p>Nit.900909162-2</p>
              <p>Cgto San José del Nus</p>
              <p>Km 1 via Caracoli</p>
              <p>Tel:(4)855 6045</p>
              <p>info@frigorinus.com</p>
            </div>
            <div className="hidden sm:block" aria-hidden="true" />
            <button
              type="button"
              onClick={onCerrar}
              className="absolute right-0 top-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>

          {/* ── Título + número ── (misma grilla espejada que el encabezado) */}
          <div className="mb-5 grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_1fr_9rem]">
            <div className="hidden sm:block" aria-hidden="true" />
            <h2 className="text-center text-xl font-bold tracking-wide text-gray-900">
              REMISIÓN DE SALIDA DE DESPACHOS
            </h2>
            <div className="flex items-center justify-center gap-1.5 text-red-600 sm:justify-end">
              <span className="text-lg font-bold">N°</span>
              {folioEditable ? (
                <input
                  type="number"
                  min={1}
                  value={folioTexto}
                  onChange={e => setFolioTexto(e.target.value)}
                  placeholder="folio"
                  className="folio-remision w-24 rounded-lg border-2 border-red-300 px-2 py-1 text-lg text-red-600 focus:border-red-500 focus:outline-none"
                />
              ) : (
                <span className="folio-remision text-lg">{folioMostrado ?? '—'}</span>
              )}
            </div>
          </div>

          {/* ── Encabezado, en dos filas como el papel: la fecha sola arriba, y
                 debajo conductor / cédula / placa.

                 Es UNA sola grilla de tres columnas y no dos bloques apilados: la
                 fecha tenía su propio `max-w-[12rem]`, que no coincidía con el
                 tercio que mide Conductor, y el borde izquierdo de las dos filas
                 no alineaba. Acá la fecha ocupa la primera celda y una celda
                 muda tapa las otras dos. ── */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Fecha</span>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} disabled={!editable} className={inputCampo} />
            </label>
            <div className="hidden sm:col-span-2 sm:block" aria-hidden="true" />
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Conductor</span>
              <input type="text" value={conductor} onChange={e => setConductor(e.target.value)} disabled={!editable} className={inputCampo} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Cédula</span>
              <input type="text" value={cedula} onChange={e => setCedula(e.target.value)} disabled={!editable} className={inputCampo} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Placa vehículo</span>
              <input type="text" value={placa} onChange={e => setPlaca(e.target.value)} disabled={!editable} className={inputCampo} />
            </label>
          </div>

          {/* ── Cuadro ── */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-900">
                  <th className={thCls}>Cliente</th>
                  <th className={thCls}>Producto despachado</th>
                  <th className={thCls}>Und/Kg</th>
                  <th className={thCls}>Canastillas</th>
                  <th className={thCls}>Destino</th>
                  <th className={thCls}>Firma recibido cliente<br /><span className="font-normal normal-case">(A conformidad)</span></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i}>
                    {(['cliente', 'producto', 'und_kg', 'canastillas', 'destino', 'firma_recibido'] as const).map(campo => (
                      <td key={campo} className={tdCls}>
                        <CeldaFila value={f[campo]} onChange={v => setCelda(i, campo, v)} disabled={!editable} />
                      </td>
                    ))}
                  </tr>
                ))}
                {/* Pie del cuadro, calcado del papel: "TOTAL" abarca CLIENTE +
                    PRODUCTO, después las celdas bajo Und/Kg y CANASTILLAS, y el
                    aviso al conductor abarca DESTINO + FIRMA.
                    Se combina con colSpan real y no con un grid encima: así las
                    celdas las alinea el mismo motor de tabla que calcula los
                    anchos de las filas de arriba. */}
                <tr className="bg-gray-50 font-bold">
                  <td colSpan={2} className={`${tdCls} px-2 py-1.5 text-sm`}>TOTAL</td>
                  {/* Und/Kg: lo suma la app. `readOnly` y no `disabled` para que se
                      imprima y se vea igual que las demás celdas —`disabled` la
                      grisaría— y sin resaltado de foco, que ahí no significa nada. */}
                  <td className={tdCls}>
                    <input
                      type="text"
                      value={totalUndKg}
                      readOnly
                      title="Lo suma la app con los Und/Kg de las filas de arriba."
                      className="w-full border-0 bg-transparent px-1.5 py-1 text-sm font-bold focus:outline-none"
                    />
                  </td>
                  {/* Canastillas: texto libre, a mano, como en el papel. */}
                  <td className={tdCls}>
                    <input
                      type="text"
                      value={total.canastillas}
                      onChange={e => setTotal(prev => ({ ...prev, canastillas: e.target.value }))}
                      disabled={!editable}
                      className={`${inputCelda} font-bold`}
                    />
                  </td>
                  <td colSpan={2} className={`${tdCls} px-2 py-1.5`}>
                    <p className="text-[10px] font-normal leading-snug text-gray-800">
                      Señor conductor verifique la entrega de los productos relacionados, con la
                      firma de este soporte se recibe a entera satisfacción en cantidad y calidad.
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {editable && (
            <button
              type="button"
              onClick={() => setFilas(prev => [...prev, celdasVacias()])}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              <Plus size={13} /> Agregar fila
            </button>
          )}

          {/* ── Firmas: se hacen sobre el papel impreso ── */}
          <div className="mt-10 grid grid-cols-2 gap-10">
            {([
              ['FIRMA RESPONSABLE PLANTA', firmaResponsable, setFirmaResponsable],
              ['FIRMA CONDUCTOR', firmaConductor, setFirmaConductor],
            ] as const).map(([etiqueta, valor, set]) => (
              <div key={etiqueta}>
                <input type="text" value={valor} onChange={e => set(e.target.value)} disabled={!editable} className="w-full border-0 bg-transparent px-1 pb-1 text-sm focus:outline-none" />
                <div className="border-t border-gray-800" />
                <p className="mt-1 text-center text-[11px] font-bold uppercase tracking-wide text-gray-900">{etiqueta}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Impresión: una hoja por bloque de filas ──
               Chromium deja de repetir un <thead>/<tfoot> cuando el grupo
               repetido supera ~4cm de alto (medido armando la plantilla real
               en Edge headless e imprimiéndola a PDF): el encabezado completo
               —logo, datos de Frigorinus, título, N°, Fecha/Conductor/Cédula/
               Placa— mide ~7,6cm, muy por encima de ese límite, así que
               confiarle la repetición al motor de impresión (como se probó
               antes con thead/tfoot) no funciona por más que esté bien
               declarado: el navegador simplemente lo pinta una sola vez y
               sigue de largo.

               Por eso se arma A MANO: cada `.hoja-impresion` de acá abajo es
               un bloque completo e independiente —encabezado entero + hasta
               FILAS_POR_HOJA filas + TOTAL + firmas— con un salto
               de página forzado entre bloques (ver @media print en
               index.css). Así el encabezado y el pie SIEMPRE salen enteros en
               cada hoja real, sin depender de ningún límite del navegador.

               Es de solo lectura y no un segundo formulario: no tiene inputs
               (para no duplicar el estado controlado de la plantilla de
               arriba, lo que rompería la navegación con Enter y podría
               desincronizar valores) y lee las mismas variables de estado, así
               que lo impreso nunca puede quedar desactualizado respecto de lo
               que se ve en pantalla. */}
        <div className="solo-impresion">
          {bloquesImpresion.map((filasDeLaHoja, iHoja) => (
            <div key={iHoja} className="hoja-impresion">
              <div className="encabezado-logo-remision relative mb-5 grid grid-cols-1 items-center justify-items-center gap-3 sm:grid-cols-[9rem_1fr_9rem] sm:justify-items-stretch">
                <img src="/logo-frigorinus.jpg" alt="Frigorinus" className="logo-remision h-auto w-36" />
                <div className="text-center text-[13px] leading-tight text-gray-800">
                  <p className="font-bold">Frigorinus SAS.</p>
                  <p>Nit.900909162-2</p>
                  <p>Cgto San José del Nus</p>
                  <p>Km 1 via Caracoli</p>
                  <p>Tel:(4)855 6045</p>
                  <p>info@frigorinus.com</p>
                </div>
                <div className="hidden sm:block" aria-hidden="true" />
              </div>

              <div className="titulo-remision mb-5 grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_1fr_9rem]">
                <div className="hidden sm:block" aria-hidden="true" />
                <h2 className="text-center text-xl font-bold tracking-wide text-gray-900">
                  REMISIÓN DE SALIDA DE DESPACHOS
                </h2>
                <div className="flex items-center justify-center gap-1.5 text-red-600 sm:justify-end">
                  <span className="text-lg font-bold">N°</span>
                  <span className="folio-remision text-lg">
                    {folioDeHoja(iHoja) ?? '—'}
                  </span>
                </div>
              </div>

              <div className="campos-remision mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Fecha</span>
                  <div className="text-sm text-gray-900">{fecha}</div>
                </div>
                <div className="hidden sm:col-span-2 sm:block" aria-hidden="true" />
                <div>
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Conductor</span>
                  <div className="text-sm text-gray-900">{conductor}</div>
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Cédula</span>
                  <div className="text-sm text-gray-900">{cedula}</div>
                </div>
                <div>
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Placa vehículo</span>
                  <div className="text-sm text-gray-900">{placa}</div>
                </div>
              </div>

              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-900">
                    <th className={thCls}>Cliente</th>
                    <th className={thCls}>Producto despachado</th>
                    <th className={thCls}>Und/Kg</th>
                    <th className={thCls}>Canastillas</th>
                    <th className={thCls}>Destino</th>
                    <th className={thCls}>Firma recibido cliente<br /><span className="font-normal normal-case">(A conformidad)</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filasDeLaHoja.map((f, i) => (
                    <tr key={i}>
                      {(['cliente', 'producto', 'und_kg', 'canastillas', 'destino', 'firma_recibido'] as const).map(campo => (
                        <td key={campo} className={tdCls}>
                          <div className="celda-impresion px-1.5 py-1 text-sm leading-snug">{f[campo]}</div>
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td colSpan={2} className={`${tdCls} px-2 py-1.5 text-sm`}>TOTAL</td>
                    <td className={tdCls}>
                      <div className="px-1.5 py-1 text-sm font-bold">{totalUndKg}</div>
                    </td>
                    <td className={tdCls}>
                      <div className="px-1.5 py-1 text-sm font-bold">{total.canastillas}</div>
                    </td>
                    <td colSpan={2} className={`${tdCls} px-2 py-1.5`}>
                      <p className="text-[10px] font-normal leading-snug text-gray-800">
                        Señor conductor verifique la entrega de los productos relacionados, con la
                        firma de este soporte se recibe a entera satisfacción en cantidad y calidad.
                      </p>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="firmas-remision mt-10 grid grid-cols-2 gap-10">
                {([
                  ['FIRMA RESPONSABLE PLANTA', firmaResponsable],
                  ['FIRMA CONDUCTOR', firmaConductor],
                ] as const).map(([etiqueta, valor]) => (
                  <div key={etiqueta}>
                    <div className="min-h-[1.1em] w-full px-1 pb-1 text-sm">{valor}</div>
                    <div className="border-t border-gray-800" />
                    <p className="mt-1 text-center text-[11px] font-bold uppercase tracking-wide text-gray-900">{etiqueta}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Acciones ── */}
        <div className="no-imprimir mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 pt-4">
          {existente && editable && (
            <BotonAccion
              onClick={() => setConfirmandoBorrado(true)}
              className="mr-auto rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <Trash2 size={14} /> Eliminar
            </BotonAccion>
          )}
          <BotonAccion onClick={() => window.print()} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <Printer size={14} /> Imprimir
          </BotonAccion>
          <button type="button" onClick={onCerrar} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200">
            Cerrar
          </button>
          {editable && (
            <BotonAccion onClick={guardar} className="rounded-lg bg-green-800 px-5 py-2 text-sm font-bold text-white hover:bg-green-700">
              Guardar
            </BotonAccion>
          )}
        </div>
      </div>

      {confirmandoBorrado && existente && (
        <ModalConfirmar
          titulo={`¿Eliminar la remisión N° ${existente.remision.folio_inicio}?`}
          mensaje="Se borra el encabezado y todas sus filas. Esta acción no se puede deshacer."
          textoConfirmar="Sí, eliminar"
          onCancelar={() => setConfirmandoBorrado(false)}
          onConfirmar={borrar}
        />
      )}
    </div>
  )
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

export default function Remisiones() {
  const [lista, setLista] = useState<Remision[] | null>(null)
  const [conteos, setConteos] = useState<Record<string, number>>({})
  const [abierta, setAbierta] = useState<RemisionCompleta | null>(null)
  const [creando, setCreando] = useState(false)
  const [folioSugerido, setFolioSugerido] = useState<number | null>(null)
  const [avisos, setAvisos] = useState<Aviso[]>([])

  const cerrarAviso = useCallback((id: number) => {
    setAvisos(prev => prev.filter(a => a.id !== id))
  }, [])
  const avisar = useCallback((tipo: TipoAviso, texto: string) => {
    setAvisos(prev => [...prev, { id: ultimoIdAviso++, tipo, texto }])
  }, [])
  const avisoExito = useCallback((t: string) => avisar('exito', t), [avisar])
  const avisoError = useCallback((t: string) => avisar('error', t), [avisar])
  const avisoInfo = useCallback((t: string) => avisar('info', t), [avisar])

  /** Recarga la lista. Se llama desde handlers (después de guardar o borrar). */
  const cargar = useCallback(async () => {
    const rs = await listarRemisiones()
    const c = await contarFilasPorRemision(rs.map(r => r.id))
    setLista(rs)
    setConteos(c)
  }, [])

  // Carga inicial. El await va ANTES de cualquier setState y adentro de un IIFE,
  // igual que en DocumentoRuta: llamar a `cargar()` pelado desde el efecto lo
  // marca la regla set-state-in-effect por las cascadas de render.
  useEffect(() => {
    let vigente = true
    void (async () => {
      const rs = await listarRemisiones()
      const c = await contarFilasPorRemision(rs.map(r => r.id))
      if (!vigente) return
      setLista(rs)
      setConteos(c)
    })()
    return () => { vigente = false }
  }, [])

  async function abrirNueva() {
    // Se consulta al abrir y no al montar: entre que se cargó la lista y que
    // Rafa hace click pudo entrar otra remisión desde otro dispositivo.
    setFolioSugerido(await proximoFolio())
    setCreando(true)
  }

  async function abrir(id: string) {
    const r = await obtenerRemision(id)
    if (!r) {
      avisoError('No se pudo abrir la remisión. Probá de nuevo.')
      return
    }
    setAbierta(r)
  }

  async function imprimirDirecto(id: string) {
    const r = await obtenerRemision(id)
    if (!r) {
      avisoError('No se pudo abrir la remisión para imprimir.')
      return
    }
    setAbierta(r)
  }

  function cerrarModal() {
    setAbierta(null)
    setCreando(false)
  }

  async function trasGuardar(texto: string) {
    cerrarModal()
    avisoExito(texto)
    await cargar()
  }

  return (
    <div className="space-y-5">
      {/* Avisos: apilados arriba a la derecha. */}
      <div className="no-imprimir pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        {avisos.map(a => (
          <TarjetaAviso key={a.id} aviso={a} onCerrar={cerrarAviso} />
        ))}
      </div>

      {/* El título y la lista llevan `no-imprimir` porque al imprimir una
          remisión seguían reservando su alto en blanco arriba de la hoja
          (se ocultan con `visibility`, que no saca del flujo) y empujaban la
          plantilla a media hoja y a una segunda página. */}
      <div className="no-imprimir flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">Remisiones</h2>
        <BotonAccion
          onClick={abrirNueva}
          className="rounded-lg bg-green-800 px-4 py-2 text-sm font-bold text-white hover:bg-green-700"
        >
          <Plus size={15} /> Nueva remisión
        </BotonAccion>
      </div>

      <div className="no-imprimir">
        {lista === null ? (
          <p className="text-sm text-gray-400">Cargando remisiones...</p>
        ) : lista.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <FileSignature size={40} className="text-gray-300" />
              <p className="text-sm font-semibold text-gray-600">No hay remisiones registradas</p>
              <p className="max-w-sm text-sm text-gray-400">
                Cada camión que sale lleva una. La primera pide el número de tu talonario; de ahí en
                adelante la app lo asigna sola.
              </p>
              <BotonAccion
                onClick={abrirNueva}
                className="mt-3 rounded-lg bg-green-800 px-4 py-2 text-sm font-bold text-white hover:bg-green-700"
              >
                <Plus size={15} /> Crear la primera
              </BotonAccion>
            </div>
          </div>
        ) : (
          <div className="w-full overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">N°</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Fecha</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Conductor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Placa</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Filas</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lista.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}>
                    {/* El rango entero, no solo el primero: una remisión de
                        varias hojas se llevó varios folios del talonario y
                        desde la lista tiene que verse cuáles. */}
                    <td className="px-4 py-3 font-mono font-bold text-gray-900">
                      {r.hojas_reservadas > 1
                        ? `${r.folio_inicio}–${r.folio_inicio + r.hojas_reservadas - 1}`
                        : r.folio_inicio}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.fecha}</td>
                    <td className="px-4 py-3 text-gray-700">{r.conductor || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.placa || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{conteos[r.id] ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <BotonAccion
                          onClick={() => abrir(r.id)}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                        >
                          {puedeEditarse(r.fecha) ? 'Editar' : 'Ver'}
                        </BotonAccion>
                        <BotonAccion
                          onClick={() => imprimirDirecto(r.id)}
                          title="Abre la remisión para imprimirla"
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                        >
                          <Printer size={13} />
                        </BotonAccion>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(creando || abierta) && (
        <ModalRemision
          // `key` fuerza un estado limpio al pasar de una remisión a otra: sin
          // esto React reusa la instancia y quedan los campos de la anterior.
          key={abierta?.remision.id ?? 'nueva'}
          existente={abierta}
          folioSugerido={folioSugerido}
          onCerrar={cerrarModal}
          onGuardado={trasGuardar}
          onError={avisoError}
          onInfo={avisoInfo}
        />
      )}
    </div>
  )
}
