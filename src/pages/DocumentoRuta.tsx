import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { RefreshCw, AlertTriangle, ChevronDown, FileSpreadsheet } from 'lucide-react'
import {
  construirDocumentoDia,
  guardarDatosManuales,
  actualizarCabezaPatas,
  claveBloque,
  type DocumentoDia,
  type BloqueRuta,
  type SeccionDocumento,
  type FilaDocumento,
  type DatosManuales,
} from '../lib/documentoRuta'
import { exportarDocumentoRuta } from '../lib/exportarDocumentoRuta'
import {
  fetchMaestroSecuencia,
  crearResolverSecuencia,
  diaSemanaDe,
  rutaUsaSecuencia,
  guardarSecuencia,
  type MaestroRow,
} from '../lib/secuenciaEntrega'
import { entregaPorDefecto } from '../lib/fechaEntrega'

// Fecha local de hoy (mismo patrón que el resto del proyecto: YYYY-MM-DD local, sin new Date() suelto).
function hoyLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Fecha con día de la semana en español, desde una fecha DATE. Se le pasa la fecha de
// ENTREGA, que es lo que el selector de arriba elige y lo que identifica al documento.
function fechaLarga(fecha: string): string {
  const d = new Date(fecha + 'T00:00:00')
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function manualVacio(): DatosManuales {
  return { conductor: null, auxiliar: null, placa: null, horaProgramada: null, observacion: null }
}

/**
 * Espera antes de persistir lo tipeado. Suficiente para no escribir letra por letra,
 * corto para que un cambio de pestaña o de módulo llegue después del guardado.
 */
const GUARDADO_MS = 1000

/** Una escritura pendiente: se acumula por BLOQUE, así varios campos del mismo
 *  encabezado salen en un solo upsert en vez de uno por campo. */
type EscrituraPendiente = {
  fechaEntrega: string
  ruta: string
  carroId: string | null
  datos: Partial<DatosManuales>
}

function toNumOrNull(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const inputCls =
  'w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors'
const cellInputCls =
  'w-20 border border-gray-200 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 disabled:bg-gray-50 disabled:text-gray-400'

/**
 * Trae el maestro de secuencia y arma EL documento de una fecha de entrega. Va fuera del
 * componente porque no depende de ningún estado. Si el maestro no se puede leer (tabla sin
 * crear, sin permisos), el documento sale con su orden de siempre — nunca rompe la pantalla.
 *
 * El resolver se arma con el día de semana de la ENTREGA, que es el que usa el maestro de
 * Cimitarra (LUNES/JUEVES). Como el documento entero es una sola fecha de entrega, alcanza
 * con uno para toda la pantalla.
 */
async function cargarDocumento(fechaEntrega: string): Promise<{ doc: DocumentoDia; maestro: MaestroRow[] }> {
  const maestro = await fetchMaestroSecuencia()
  const resolver = maestro.length > 0
    ? crearResolverSecuencia(maestro, diaSemanaDe(fechaEntrega))
    : undefined
  const doc = await construirDocumentoDia(fechaEntrega, resolver)

  // Sin maestro el documento igual se arma, pero las rutas regionales salen SIN el orden de
  // entrega (queda el orden por código). Antes esto pasaba en SILENCIO y era indistinguible
  // de un bug de ordenamiento; ahora se avisa en pantalla.
  if (maestro.length === 0) {
    doc.avisos.unshift(
      'No se pudo leer el maestro de secuencia de entrega (tabla secuencia_entrega vacía o sin acceso): ' +
      'las rutas regionales salen ordenadas por código, no por orden de entrega. ' +
      '¿Falta correr migracion_secuencia_entrega.sql?'
    )
  }

  // Códigos sin orden asignado. SOLO en rutas regionales: en Nacional/Barbosa/Externo no
  // existe la secuencia, así que un código sin match ahí no es un problema y no se avisa.
  for (const b of doc.bloques) {
    if (!rutaUsaSecuencia(b.ruta)) continue
    const sinOrden = [...b.bovinos.filas, ...b.porcinos.filas].filter(f => f.secuencia == null)
    if (sinOrden.length === 0) continue
    const codigos = [...new Set(sinOrden.map(f => f.codigoCliente))].join(', ')
    doc.avisos.push(
      `${b.ruta}: ${sinOrden.length === 1 ? 'el código' : 'los códigos'} ${codigos} ` +
      `no ${sinOrden.length === 1 ? 'tiene' : 'tienen'} orden de entrega asignado; ` +
      `${sinOrden.length === 1 ? 'sale' : 'salen'} al final. Se puede asignar desde la tabla.`
    )
  }
  return { doc, maestro }
}

export default function DocumentoRuta() {
  // El selector elige la fecha de ENTREGA, no la jornada: la "tabla del 8" es una sola.
  // Arranca en la entrega normal de hoy (hoy + 1), que es la que Rafa está armando.
  const [fecha, setFecha] = useState(entregaPorDefecto(hoyLocal()))
  // UN documento por FECHA DE ENTREGA. Entra todo lo que se entrega ese día, se haya
  // despachado el día anterior o tres días antes.
  const [doc, setDoc] = useState<DocumentoDia | null>(null)
  const [showAvisos, setShowAvisos] = useState(false)
  // Campos manuales en estado local (un refresco NO debe borrar lo que Rafa escribe).
  // Clave por BLOQUE (ruta + carro): cada carro de Externo tiene sus propios datos manuales.
  const [manualLocal, setManualLocal] = useState<Record<string, DatosManuales>>({})
  // Edición local de cabeza/patas por fila (se limpia con cada doc nuevo → refleja lo guardado).
  const [cpLocal, setCpLocal] = useState<Record<string, { cabeza: string; patas: string }>>({})
  // El maestro se guarda para poder ACTUALIZAR la secuencia de un código existente
  // (guardarSecuencia lo necesita para no duplicar filas).
  const [maestro, setMaestro] = useState<MaestroRow[]>([])
  // Fila cuya secuencia se está editando (key de la fila) y el valor tipeado.
  const [editSec, setEditSec] = useState<{ key: string; valor: string } | null>(null)
  // Escrituras del encabezado todavía no confirmadas contra la base, por clave de bloque.
  // Va en un ref y no en estado: se lee desde el cleanup del desmontaje, donde un
  // valor capturado por render ya sería viejo.
  const pendientesRef = useRef<Map<string, EscrituraPendiente>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Último fallo de guardado del encabezado. Antes se descartaba: el dato se veía en
  // pantalla (estado local) y desaparecía recién al volver, sin nada que lo explicara.
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)

  // Refresco (botón "Actualizar" / pestaña visible): recarga SIN reiniciar los campos
  // manuales — conserva lo que Rafa esté escribiendo y solo agrega rutas nuevas.
  const cargar = useCallback(async () => {
    const { doc: d, maestro: m } = await cargarDocumento(fecha)
    setDoc(d)
    setMaestro(m)
    setCpLocal({}) // cabeza/patas se re-derivan del doc recién cargado
    setManualLocal(prev => {
      const next = { ...prev }
      for (const b of d.bloques) {
        const k = claveBloque(b)
        if (!(k in next)) next[k] = b.manual ?? manualVacio()
      }
      return next
    })
  }, [fecha])

  // Montaje + cambio de fecha: carga inicial reinicializando los campos manuales.
  // El fetch va en un async con `await` antes de cualquier setState (sin cascadas).
  useEffect(() => {
    let vigente = true
    void (async () => {
      const { doc: d, maestro: m } = await cargarDocumento(fecha)
      if (!vigente) return
      setDoc(d)
      setMaestro(m)
      setCpLocal({})
      const manual: Record<string, DatosManuales> = {}
      for (const b of d.bloques) manual[claveBloque(b)] = b.manual ?? manualVacio()
      setManualLocal(manual)
    })()
    return () => { vigente = false }
  }, [fecha])

  // Al volver la pestaña visible → recarga SIN reinicializar (no toca lo que se escribe). Sin polling.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [cargar])

  // ── Campos manuales ────────────────────────────────────────────
  // Persistir SOLO en onBlur perdía lo tipeado: si el campo no se confirma y la pantalla
  // se desmonta (cambio de módulo) o la página se recarga (PWA vuelta del fondo), se va
  // con ella `manualLocal`, que es estado de React; al volver, el efecto de montaje
  // reconstruye el encabezado desde la base y lo escrito nunca existió. Ahora cada tecla
  // agenda el guardado y el blur solo lo adelanta.

  /** Escribe lo pendiente y corta el temporizador. La llaman el debounce, el blur, el
   *  ocultado de la pestaña y la salida de la pantalla. */
  const flushManual = useCallback(async () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendientesRef.current.size === 0) return
    // Se vacía ANTES de esperar: lo que se tipee durante el viaje a la base entra como
    // pendiente nuevo en vez de perderse dentro de este lote.
    const lote = [...pendientesRef.current.values()]
    pendientesRef.current.clear()

    const fallas: string[] = []
    for (const p of lote) {
      const r = await guardarDatosManuales(p.fechaEntrega, p.ruta, p.datos, p.carroId)
      if (!r.ok) fallas.push(`${p.ruta}: ${r.mensaje}`)
    }
    setErrorGuardado(fallas.length > 0 ? fallas.join(' · ') : null)
  }, [])

  /** Agenda el guardado de un campo, acumulando por bloque: si varios campos del mismo
   *  encabezado quedan sucios a la vez (sin blur de por medio), salen en un solo upsert. */
  function encolarManual(b: BloqueRuta, key: keyof DatosManuales, valor: string) {
    const k = claveBloque(b)
    const previo = pendientesRef.current.get(k)
    pendientesRef.current.set(k, {
      // La fecha de entrega viaja con la escritura: si se mueve el selector, lo pendiente
      // se guarda en la tabla en la que se escribió.
      fechaEntrega: fecha,
      ruta: b.ruta,
      carroId: b.carroId, // el carro va en la clave: dos externos del mismo día no se pisan
      datos: { ...previo?.datos, [key]: valor.trim() === '' ? null : valor } as Partial<DatosManuales>,
    })
    if (timerRef.current != null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flushManual() }, GUARDADO_MS)
  }

  function setCampoManual(b: BloqueRuta, key: keyof DatosManuales, valor: string) {
    const k = claveBloque(b)
    setManualLocal(prev => ({
      ...prev,
      [k]: { ...(prev[k] ?? manualVacio()), [key]: valor === '' ? null : valor } as DatosManuales,
    }))
    encolarManual(b, key, valor)
  }

  function guardarCampoManual(b: BloqueRuta, key: keyof DatosManuales, valor: string) {
    encolarManual(b, key, valor)
    void flushManual()
  }

  // Respaldo del debounce para el segundo justo antes de irse: se fuerza la escritura al
  // ocultarse la pestaña, al descargarse la página y en el cleanup del desmontaje — este
  // último es el punto exacto en el que `manualLocal` deja de existir. La petición ya
  // despachada sobrevive al desmontaje; lo que no sobrevive es el estado.
  useEffect(() => {
    const onOcultar = () => { if (document.visibilityState === 'hidden') void flushManual() }
    const onDescargar = () => { void flushManual() }
    document.addEventListener('visibilitychange', onOcultar)
    window.addEventListener('pagehide', onDescargar)
    return () => {
      document.removeEventListener('visibilitychange', onOcultar)
      window.removeEventListener('pagehide', onDescargar)
      void flushManual()
    }
  }, [flushManual])

  function campoManual(b: BloqueRuta, campo: keyof DatosManuales, label: string) {
    return (
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
        <input
          type="text"
          value={manualLocal[claveBloque(b)]?.[campo] ?? ''}
          onChange={e => setCampoManual(b, campo, e.target.value)}
          onBlur={e => guardarCampoManual(b, campo, e.target.value)}
          className={inputCls}
        />
      </div>
    )
  }

  // ── Cabeza/Patas ───────────────────────────────────────────────
  // Identidad estable de la fila (viene de documentoRuta). Antes se usaba
  // despachoIdsCanal.join(','), que para las filas SIN canal (solo vísceras) daba ''
  // en todas: compartían estado de edición entre sí.
  const filaKey = (f: FilaDocumento) => f.key
  const cpDe = (f: FilaDocumento) => ({
    cabeza: f.cabeza != null ? String(f.cabeza) : '',
    patas: f.patas != null ? String(f.patas) : '',
  })

  function setCP(f: FilaDocumento, campo: 'cabeza' | 'patas', valor: string) {
    const key = filaKey(f)
    setCpLocal(prev => ({ ...prev, [key]: { ...(prev[key] ?? cpDe(f)), [campo]: valor } }))
  }

  async function guardarCP(f: FilaDocumento) {
    if (f.despachoIdsCanal.length === 0) return
    const cp = cpLocal[filaKey(f)] ?? cpDe(f)
    const ok = await actualizarCabezaPatas(f.despachoIdsCanal, toNumOrNull(cp.cabeza), toNumOrNull(cp.patas))
    if (ok) await cargar() // recalcula totales de la sección
  }

  // ── Secuencia de entrega (solo rutas regionales) ───────────────
  // Rafa asigna el número que corresponde; se guarda tal cual, sin correr las demás.
  // El DÍA con el que se guarda es el de la ENTREGA del documento (Cimitarra guarda un
  // maestro por día, y sus LUNES/JUEVES siempre fueron días de entrega). Como el documento
  // entero es una sola fecha de entrega, sale del selector.
  async function guardarSec(ruta: string, f: FilaDocumento, valor: string) {
    setEditSec(null)
    const n = Number(valor.trim())
    if (valor.trim() === '' || !Number.isFinite(n)) return
    if (n === f.secuencia) return // sin cambios
    const ok = await guardarSecuencia(maestro, ruta, f.codigoCliente, n, diaSemanaDe(fecha))
    if (ok) await cargar() // recarga: el documento se reordena con la secuencia nueva
  }

  // ── Exportar a Excel ───────────────────────────────────────────
  // Usa los datos manuales del ESTADO LOCAL (lo que Rafa ve, aunque no haya sacado el foco).
  function exportar() {
    if (!doc) return
    exportarDocumentoRuta(doc, new Map(Object.entries(manualLocal)))
  }

  // ── Render de una tabla de sección ─────────────────────────────
  function tabla(titulo: string, seccion: SeccionDocumento, conCP: boolean, editable: boolean, ruta: string | null = null) {
    // Se guarda en una const para que TypeScript arrastre el estrechamiento hasta el onBlur.
    const rutaSec = ruta != null && rutaUsaSecuencia(ruta) ? ruta : null
    const conSecuencia = rutaSec != null
    const thCls = 'text-left px-4 py-2.5 font-semibold text-white text-xs uppercase tracking-wider'
    const tdNum = 'px-4 py-2.5 text-gray-700 text-right'
    return (
      <div>
        <h4 className="text-sm font-bold text-gray-700 mb-1.5">{titulo}</h4>
        <div className="w-full overflow-x-auto rounded-xl shadow-sm border border-gray-200 bg-white">
          <table className="min-w-[520px] w-full text-sm">
            <thead>
              <tr className="bg-gray-800">
                <th className={thCls}>COD</th>
                <th className={`${thCls} text-right`}>CANT</th>
                <th className={`${thCls} text-right`}>V/B</th>
                <th className={`${thCls} text-right`}>V/R</th>
                {conCP && <th className={`${thCls} text-right`}>CABEZA</th>}
                {conCP && <th className={`${thCls} text-right`}>PATAS</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {seccion.filas.length === 0 ? (
                <tr>
                  <td colSpan={conCP ? 6 : 4} className="px-4 py-4 text-center text-gray-400 text-sm">Sin filas</td>
                </tr>
              ) : (
                seccion.filas.map((f, i) => {
                  const cp = cpLocal[filaKey(f)] ?? cpDe(f)
                  const sinCanal = f.despachoIdsCanal.length === 0
                  // Separador: se dibuja UNA vez, justo antes del primer código sin orden.
                  const primeroSinOrden =
                    conSecuencia && f.secuencia == null &&
                    (i === 0 || seccion.filas[i - 1].secuencia != null)
                  const editando = editSec?.key === f.key
                  return (
                    <Fragment key={f.key}>
                      {primeroSinOrden && (
                        <tr className="bg-amber-50">
                          <td colSpan={conCP ? 6 : 4} className="px-4 py-1.5 text-center text-[11px] font-semibold text-amber-700 uppercase tracking-wider">
                            — Sin orden de entrega asignado —
                          </td>
                        </tr>
                      )}
                    <tr className={i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-900">
                        {f.cod}
                        {rutaSec && (
                          editando ? (
                            <input
                              type="number" min={1} autoFocus
                              value={editSec.valor}
                              onChange={e => setEditSec({ key: f.key, valor: e.target.value })}
                              onBlur={e => guardarSec(rutaSec, f, e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditSec(null) }}
                              className="ml-2 w-16 border border-gray-300 rounded px-1 py-0.5 text-xs font-sans"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditSec({ key: f.key, valor: f.secuencia != null ? String(f.secuencia) : '' })}
                              title={f.secuencia != null ? 'Cambiar el orden de entrega' : 'Asignar orden de entrega'}
                              className={`ml-2 px-1.5 py-0.5 rounded text-[11px] font-sans font-semibold transition-colors ${
                                f.secuencia != null
                                  ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                                  : 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                              }`}
                            >
                              {f.secuencia != null ? f.secuencia : 'sin orden'}
                            </button>
                          )
                        )}
                      </td>
                      <td className={tdNum}>{f.cant}</td>
                      <td className={tdNum}>{f.vb}</td>
                      <td className={tdNum}>{f.vr}</td>
                      {conCP && (editable ? (
                        <>
                          <td className="px-4 py-2 text-right">
                            <input type="number" min={0} value={cp.cabeza} disabled={sinCanal}
                              onChange={e => setCP(f, 'cabeza', e.target.value)} onBlur={() => guardarCP(f)}
                              className={cellInputCls} />
                          </td>
                          <td className="px-4 py-2 text-right">
                            <input type="number" min={0} value={cp.patas} disabled={sinCanal}
                              onChange={e => setCP(f, 'patas', e.target.value)} onBlur={() => guardarCP(f)}
                              className={cellInputCls} />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={tdNum}>{f.cabeza ?? ''}</td>
                          <td className={tdNum}>{f.patas ?? ''}</td>
                        </>
                      ))}
                    </tr>
                    </Fragment>
                  )
                })
              )}
              <tr className="bg-gray-100 font-bold text-gray-900">
                <td className="px-4 py-2.5">TOTAL</td>
                <td className={tdNum}>{seccion.totales.cant}</td>
                <td className={tdNum}>{seccion.totales.vb}</td>
                <td className={tdNum}>{seccion.totales.vr}</td>
                {conCP && <td className={tdNum}>{seccion.totales.cabeza}</td>}
                {conCP && <td className={tdNum}>{seccion.totales.patas}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // sección de solo lectura para "sin ruta" (lista plana → le calculamos totales)
  const seccionSinRuta: SeccionDocumento | null = doc && doc.sinRuta.length > 0
    ? {
        filas: doc.sinRuta,
        totales: doc.sinRuta.reduce(
          (t, f) => ({
            cant: t.cant + f.cant, vb: t.vb + f.vb, vr: t.vr + f.vr,
            cabeza: t.cabeza + (f.cabeza ?? 0), patas: t.patas + (f.patas ?? 0),
          }),
          { cant: 0, vb: 0, vr: 0, cabeza: 0, patas: 0 }
        ),
      }
    : null

  // Direcciones de entrega: SOLO la ruta Nacional las lleva. Se listan por código
  // (un mismo bloque puede llevar varios clientes, cada uno a su punto de entrega).
  // Es POR LÍNEA, no por código: un código repartido entre 3 direcciones (caso 355) ya
  // viene como 3 filas distintas del documento, y cada una lleva la suya.
  function direccionesDelBloque(b: BloqueRuta): { key: string; cod: string; direccion: string; cant: number }[] {
    if (b.ruta !== 'Nacional') return []
    return [...b.bovinos.filas, ...b.porcinos.filas]
      .filter(f => f.direccion)
      .map(f => ({ key: f.key, cod: f.cod, direccion: f.direccion as string, cant: f.cant }))
  }

  return (
    <div className="space-y-6 overflow-x-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold text-gray-900">Documento de ruta</h2>
        <div className="flex items-center gap-2">
          {/* Elige la fecha de ENTREGA, no la jornada: es lo que identifica al documento. */}
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Entrega</label>
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            title="Fecha de entrega del documento"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 bg-white"
          />
          <button
            onClick={() => cargar()}
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-green-800 hover:bg-green-700 rounded-lg px-3 py-2 transition-all duration-200 active:scale-95 whitespace-nowrap"
          >
            <RefreshCw size={14} />
            Actualizar
          </button>
          <button
            onClick={exportar}
            disabled={!doc}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 transition-all duration-200 whitespace-nowrap disabled:opacity-40"
          >
            <FileSpreadsheet size={14} />
            Exportar a Excel
          </button>
        </div>
      </div>

      {doc && doc.sinRuta.length > 0 && (
        <p className="text-xs text-amber-700 -mt-3">
          Hay despachos sin ruta asignada: se exportan en una hoja aparte llamada «Sin ruta».
        </p>
      )}


      {errorGuardado && (
        <div className="border border-red-300 bg-red-50 rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
          <div className="text-sm text-red-800 min-w-0">
            <p className="font-semibold">Los datos del encabezado NO se guardaron.</p>
            <p className="mt-0.5 break-words">{errorGuardado}</p>
          </div>
        </div>
      )}

      {doc && doc.avisos.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowAvisos(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-amber-800"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              {doc.avisos.length} {doc.avisos.length === 1 ? 'aviso de datos' : 'avisos de datos'}
            </span>
            <ChevronDown size={16} className={`transition-transform duration-200 ${showAvisos ? 'rotate-180' : ''}`} />
          </button>
          {showAvisos && (
            <ul className="px-4 pb-3 space-y-1 text-sm text-amber-800 list-disc list-inside">
              {doc.avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
        </div>
      )}

      {!doc ? (
        <p className="text-sm text-gray-400">Cargando documento...</p>
      ) : (
        <>
          {doc.bloques.map((b, i) => (
            // Externo puede aportar VARIOS bloques el mismo día (uno por carro), todos
            // con ruta==='Externo' -> la key no puede ser solo b.ruta (colisionaría). El orden
            // de doc.bloques es determinista, así que sumarle el índice es seguro.
            <section key={`${b.ruta}-${i}`} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{b.ruta}</h3>
                {/* La tabla ES una fecha de entrega: va acá, en el encabezado, y no repetida
                    por fila. Todo lo de abajo se entrega este día, se haya despachado cuando
                    se haya despachado. */}
                <p className="text-sm text-gray-500 first-letter:uppercase">Entrega {fechaLarga(doc.fechaEntrega)}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {campoManual(b, 'conductor', 'Conductor')}
                {campoManual(b, 'auxiliar', 'Auxiliar')}
                {campoManual(b, 'horaProgramada', 'Hora programada')}
                {campoManual(b, 'placa', 'Placa')}
              </div>

              {/* Un carro externo lleva UN SOLO tipo de carne: se dibuja solo la sub-tabla que
                  tiene filas, para que no aparezca la vacía al lado (eso es lo que se veía como
                  "res y cerdo mezclados"). Las rutas con nombre sí muestran las dos aunque una
                  esté vacía, que es como Rafa arma sus alineaciones. */}
              {(b.ruta !== 'Externo' || b.bovinos.filas.length > 0) && tabla('Bovinos', b.bovinos, true, true, b.ruta)}
              {(b.ruta !== 'Externo' || b.porcinos.filas.length > 0) && tabla('Porcinos', b.porcinos, false, true, b.ruta)}

              {direccionesDelBloque(b).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Direcciones de entrega</p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    {direccionesDelBloque(b).map(d => (
                      <li key={d.key}>
                        <span className="font-mono font-semibold text-gray-900">{d.cod}</span>
                        <span className="text-gray-500"> — </span>
                        {d.direccion}
                        <span className="text-gray-500"> — {d.cant}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Observación</label>
                <textarea
                  rows={2}
                  value={manualLocal[claveBloque(b)]?.observacion ?? ''}
                  onChange={e => setCampoManual(b, 'observacion', e.target.value)}
                  onBlur={e => guardarCampoManual(b, 'observacion', e.target.value)}
                  className={inputCls}
                />
              </div>
            </section>
          ))}

          {seccionSinRuta && (
            <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-3">
              <h3 className="text-lg font-bold text-gray-900">Despachos sin ruta asignada</h3>
              {tabla('Detalle', seccionSinRuta, true, false)}
            </section>
          )}
        </>
      )}
    </div>
  )
}
