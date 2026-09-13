import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
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
  listarRemisiones,
  obtenerRemision,
  proximoNumero,
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
  'w-full border-0 bg-transparent px-1.5 py-1 text-sm focus:outline-none focus:bg-yellow-50 disabled:bg-transparent'
const inputCampo =
  'w-full border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-green-700 disabled:bg-gray-50 disabled:text-gray-600'
const thCls = 'border border-gray-800 px-2 py-1.5 text-[11px] font-bold uppercase leading-tight'
const tdCls = 'border border-gray-800 p-0'

interface PropsModal {
  /** null = remisión nueva. */
  existente: RemisionCompleta | null
  /** Solo para la nueva: número sugerido, o null si es la primera del talonario. */
  numeroSugerido: number | null
  onCerrar: () => void
  onGuardado: (texto: string) => void
  onError: (texto: string) => void
  onInfo: (texto: string) => void
}

function ModalRemision({ existente, numeroSugerido, onCerrar, onGuardado, onError, onInfo }: PropsModal) {
  const filasExistentes = existente?.filas.filter(f => !f.es_total) ?? []
  const totalExistente = existente?.filas.find(f => f.es_total) ?? null

  const [numeroTexto, setNumeroTexto] = useState(
    existente ? String(existente.remision.numero) : numeroSugerido != null ? String(numeroSugerido) : ''
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
  // El número solo se teclea en la PRIMERA remisión de la historia: ahí
  // proximoNumero() devuelve null y el folio lo pone Rafa desde su talonario.
  const numeroEditable = !existente && numeroSugerido == null

  // Al abrir una archivada, se explica por qué no se puede tocar. Se avisa una
  // sola vez, al montar.
  useEffect(() => {
    if (existente && !puedeEditarse(existente.remision.fecha)) {
      onInfo(
        `La remisión N° ${existente.remision.numero} es del ${existente.remision.fecha} y solo se podía modificar ese mismo día. Se puede ver e imprimir, pero no editar ni borrar.`
      )
    }
  }, [existente, onInfo])

  const setCelda = (i: number, campo: keyof Celdas, valor: string) =>
    setFilas(prev => prev.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)))

  function aEntradas(): RemisionFilaEntrada[] {
    return [
      ...filas.map(f => ({ ...f, es_total: false })),
      { ...total, es_total: true },
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
      if (r.ok) onGuardado(`Remisión N° ${existente.remision.numero} guardada.`)
      else onError(r.mensaje)
      return
    }

    // Nueva. Con el campo editable (primera del talonario) el número es
    // obligatorio: sin él no hay de dónde sacar el correlativo.
    let numero: number | null = null
    if (numeroEditable) {
      const n = Number(numeroTexto.trim())
      if (!Number.isInteger(n) || n <= 0) {
        onError('Escribí el número de la remisión: es la primera y no hay correlativo anterior.')
        return
      }
      numero = n
    }
    const r = await crearRemision({
      numero,
      fecha,
      conductor,
      cedula,
      placa,
      firma_responsable: firmaResponsable,
      firma_conductor: firmaConductor,
      filas: aEntradas(),
    })
    if (r.ok) onGuardado(`Remisión N° ${r.numero} creada.`)
    else onError(r.mensaje)
  }

  async function borrar() {
    if (!existente) return
    const r = await eliminarRemision(existente.remision.id)
    setConfirmandoBorrado(false)
    if (r.ok) onGuardado(`Remisión N° ${existente.remision.numero} eliminada.`)
    else onError(r.mensaje)
  }

  const numeroMostrado = existente ? existente.remision.numero : numeroSugerido

  return (
    <div
      className="overlay-remision fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 animate-fadeIn"
      onClick={e => { if (e.target === e.currentTarget) onCerrar() }}
    >
      <div id="remision-imprimible" className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-xl animate-scaleIn">
        {/* ── Encabezado: logo + datos de la empresa ── */}
        <div className="relative mb-4 flex items-start gap-4">
          {/* TODO: el logo va acá. El archivo todavía no está en public/; queda
              el espacio reservado con la misma caja que va a ocupar. */}
          <div className="h-20 w-28 shrink-0 rounded border border-dashed border-gray-300" aria-hidden="true" />
          <div className="flex-1 text-center text-[13px] leading-tight text-gray-800">
            <p className="font-bold">Frigorinus SAS.</p>
            <p>Nit.900909162-2</p>
            <p>Cgto San José del Nus</p>
            <p>Km 1 via Caracoli</p>
            <p>Tel:(4)855 6045</p>
            <p>info@frigorinus.com</p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="no-imprimir absolute right-0 top-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Título + número ── */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="flex-1 text-center text-xl font-extrabold tracking-wide text-gray-900">
            REMISIÓN DE SALIDA DE DESPACHOS
          </h2>
          <div className="flex shrink-0 items-center gap-1.5 text-red-600">
            <span className="text-lg font-bold">N°</span>
            {numeroEditable ? (
              <input
                type="number"
                min={1}
                value={numeroTexto}
                onChange={e => setNumeroTexto(e.target.value)}
                placeholder="folio"
                className="w-28 rounded-lg border-2 border-red-300 px-2 py-1 text-lg font-bold text-red-600 focus:border-red-500 focus:outline-none"
              />
            ) : (
              <span className="text-lg font-bold">{numeroMostrado ?? '—'}</span>
            )}
          </div>
        </div>

        {/* ── Encabezado, en dos filas como el papel: la fecha sola arriba, y
               debajo conductor / cédula / placa. ── */}
        <div className="mb-4 space-y-3">
          <label className="block sm:max-w-[12rem]">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha</span>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} disabled={!editable} className={inputCampo} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Conductor</span>
              <input type="text" value={conductor} onChange={e => setConductor(e.target.value)} disabled={!editable} className={inputCampo} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Cédula</span>
              <input type="text" value={cedula} onChange={e => setCedula(e.target.value)} disabled={!editable} className={inputCampo} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Placa vehículo</span>
              <input type="text" value={placa} onChange={e => setPlaca(e.target.value)} disabled={!editable} className={inputCampo} />
            </label>
          </div>
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
                      <input type="text" value={f[campo]} onChange={e => setCelda(i, campo, e.target.value)} disabled={!editable} className={inputCelda} />
                    </td>
                  ))}
                </tr>
              ))}
              {/* Pie del cuadro, calcado del papel: "TOTAL" abarca CLIENTE +
                  PRODUCTO, después las dos celdas editables bajo Und/Kg y
                  CANASTILLAS, y el aviso al conductor abarca DESTINO + FIRMA.
                  Se combina con colSpan real y no con un grid encima: así las
                  celdas las alinea el mismo motor de tabla que calcula los
                  anchos de las filas de arriba, y siguen cuadrando al
                  recalcularse el layout para el tamaño de la hoja al imprimir. */}
              <tr className="bg-gray-50 font-bold">
                <td colSpan={2} className={`${tdCls} px-2 py-1.5 text-sm`}>TOTAL</td>
                {(['und_kg', 'canastillas'] as const).map(campo => (
                  <td key={campo} className={tdCls}>
                    <input
                      type="text"
                      value={total[campo]}
                      onChange={e => setTotal(prev => ({ ...prev, [campo]: e.target.value }))}
                      disabled={!editable}
                      className={`${inputCelda} font-bold`}
                    />
                  </td>
                ))}
                <td colSpan={2} className={`${tdCls} px-2 py-1.5`}>
                  <p className="text-[10px] font-normal leading-snug text-gray-700">
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
            className="no-imprimir mt-2 inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            <Plus size={13} /> Agregar fila
          </button>
        )}

        {/* ── Firmas: se hacen sobre el papel impreso ── */}
        <div className="firmas-remision mt-10 grid grid-cols-2 gap-10">
          {([
            ['FIRMA RESPONSABLE PLANTA', firmaResponsable, setFirmaResponsable],
            ['FIRMA CONDUCTOR', firmaConductor, setFirmaConductor],
          ] as const).map(([etiqueta, valor, set]) => (
            <div key={etiqueta}>
              <input type="text" value={valor} onChange={e => set(e.target.value)} disabled={!editable} className="w-full border-0 bg-transparent px-1 pb-1 text-sm focus:outline-none" />
              <div className="border-t border-gray-800" />
              <p className="mt-1 text-center text-[11px] font-semibold uppercase text-gray-700">{etiqueta}</p>
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
          titulo={`¿Eliminar la remisión N° ${existente.remision.numero}?`}
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
  const [numeroSugerido, setNumeroSugerido] = useState<number | null>(null)
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
    setNumeroSugerido(await proximoNumero())
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">Remisiones</h2>
        <BotonAccion
          onClick={abrirNueva}
          className="rounded-lg bg-green-800 px-4 py-2 text-sm font-bold text-white hover:bg-green-700"
        >
          <Plus size={15} /> Nueva remisión
        </BotonAccion>
      </div>

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
                  <td className="px-4 py-3 font-mono font-bold text-gray-900">{r.numero}</td>
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

      {(creando || abierta) && (
        <ModalRemision
          // `key` fuerza un estado limpio al pasar de una remisión a otra: sin
          // esto React reusa la instancia y quedan los campos de la anterior.
          key={abierta?.remision.id ?? 'nueva'}
          existente={abierta}
          numeroSugerido={numeroSugerido}
          onCerrar={cerrarModal}
          onGuardado={trasGuardar}
          onError={avisoError}
          onInfo={avisoInfo}
        />
      )}
    </div>
  )
}
