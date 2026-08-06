import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { RefreshCw, AlertTriangle, ChevronDown, FileSpreadsheet } from 'lucide-react'
import {
  construirDocumentosDia,
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

// Fecha local de hoy (mismo patrón que el resto del proyecto: YYYY-MM-DD local, sin new Date() suelto).
function hoyLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Fecha con día de la semana en español, desde una fecha DATE.
// Se le pasa la fecha de ENTREGA del documento, que ahora es un dato explícito: antes se
// deducía acá sumándole 1 a la de despacho. El selector de arriba sigue siendo la fecha de
// DESPACHO (la jornada) y la consulta no cambia.
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
  fecha: string
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
 * Trae el maestro de secuencia y arma los documentos de la jornada, cada uno ordenado por
 * el orden de ENTREGA de SU día. Va fuera del componente porque no depende de ningún estado.
 * Si el maestro no se puede leer (tabla sin crear, sin permisos), devuelve undefined y
 * los documentos salen con su orden de siempre — nunca rompe la pantalla.
 *
 * El resolver se arma POR fecha de entrega, no uno para toda la pantalla: Cimitarra tiene un
 * maestro para LUNES y otro para JUEVES, así que dos documentos de la misma jornada tienen
 * que resolver contra días distintos. Con una sola fecha de entrega —el caso normal— se arma
 * uno solo, igual que antes.
 */
async function cargarDocumentos(fecha: string): Promise<{ docs: DocumentoDia[]; maestro: MaestroRow[] }> {
  const maestro = await fetchMaestroSecuencia()
  const resolverPara = maestro.length > 0
    ? (fechaEntrega: string) => crearResolverSecuencia(maestro, diaSemanaDe(fechaEntrega))
    : undefined
  const docs = await construirDocumentosDia(fecha, resolverPara)

  // Sin maestro los documentos igual se arman, pero las rutas regionales salen SIN el orden de
  // entrega (queda el orden por código). Antes esto pasaba en SILENCIO y era indistinguible
  // de un bug de ordenamiento; ahora se avisa en pantalla.
  if (maestro.length === 0 && docs.length > 0) {
    docs[0].avisos.unshift(
      'No se pudo leer el maestro de secuencia de entrega (tabla secuencia_entrega vacía o sin acceso): ' +
      'las rutas regionales salen ordenadas por código, no por orden de entrega. ' +
      '¿Falta correr migracion_secuencia_entrega.sql?'
    )
  }

  // Códigos sin orden asignado. SOLO en rutas regionales: en Nacional/Barbosa/Externo no
  // existe la secuencia, así que un código sin match ahí no es un problema y no se avisa.
  for (const doc of docs) {
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
  }
  return { docs, maestro }
}

export default function DocumentoRuta() {
  const [fecha, setFecha] = useState(hoyLocal())
  // UN documento por fecha de entrega. En una jornada normal es uno solo; en víspera de
  // festivo son dos (lo de mañana y lo del día hábil siguiente), cada uno con sus bloques.
  const [docs, setDocs] = useState<DocumentoDia[] | null>(null)
  const [showAvisos, setShowAvisos] = useState(false)
  // Campos manuales en estado local (un refresco NO debe borrar lo que Rafa escribe).
  // Clave por BLOQUE (fecha de entrega + ruta + carro), no por ruta: cada carro de Externo
  // y cada documento tienen sus propios datos manuales.
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
    const { docs: ds, maestro: m } = await cargarDocumentos(fecha)
    setDocs(ds)
    setMaestro(m)
    setCpLocal({}) // cabeza/patas se re-derivan de los docs recién cargados
    setManualLocal(prev => {
      const next = { ...prev }
      for (const d of ds) {
        for (const b of d.bloques) {
          const k = claveBloque(d.fechaEntrega, b)
          if (!(k in next)) next[k] = b.manual ?? manualVacio()
        }
      }
      return next
    })
  }, [fecha])

  // Montaje + cambio de fecha: carga inicial reinicializando los campos manuales.
  // El fetch va en un async con `await` antes de cualquier setState (sin cascadas).
  useEffect(() => {
    let vigente = true
    void (async () => {
      const { docs: ds, maestro: m } = await cargarDocumentos(fecha)
      if (!vigente) return
      setDocs(ds)
      setMaestro(m)
      setCpLocal({})
      const manual: Record<string, DatosManuales> = {}
      for (const d of ds) {
        for (const b of d.bloques) manual[claveBloque(d.fechaEntrega, b)] = b.manual ?? manualVacio()
      }
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
      const r = await guardarDatosManuales(p.fecha, p.fechaEntrega, p.ruta, p.datos, p.carroId)
      if (!r.ok) fallas.push(`${p.ruta}: ${r.mensaje}`)
    }
    setErrorGuardado(fallas.length > 0 ? fallas.join(' · ') : null)
  }, [])

  /** Agenda el guardado de un campo, acumulando por bloque: si varios campos del mismo
   *  encabezado quedan sucios a la vez (sin blur de por medio), salen en un solo upsert. */
  function encolarManual(fechaEntrega: string, b: BloqueRuta, key: keyof DatosManuales, valor: string) {
    const k = claveBloque(fechaEntrega, b)
    const previo = pendientesRef.current.get(k)
    pendientesRef.current.set(k, {
      // La fecha viaja con la escritura: si se mueve el selector, lo pendiente se guarda
      // en el día en el que se escribió.
      fecha,
      // Y la de ENTREGA también: es lo que separa el encabezado de un documento del otro
      // cuando la jornada produce dos (misma ruta con nombre, mismo carro_id '').
      fechaEntrega,
      ruta: b.ruta,
      carroId: b.carroId, // el carro va en la clave: dos externos del mismo día no se pisan
      datos: { ...previo?.datos, [key]: valor.trim() === '' ? null : valor } as Partial<DatosManuales>,
    })
    if (timerRef.current != null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flushManual() }, GUARDADO_MS)
  }

  function setCampoManual(fechaEntrega: string, b: BloqueRuta, key: keyof DatosManuales, valor: string) {
    const k = claveBloque(fechaEntrega, b)
    setManualLocal(prev => ({
      ...prev,
      [k]: { ...(prev[k] ?? manualVacio()), [key]: valor === '' ? null : valor } as DatosManuales,
    }))
    encolarManual(fechaEntrega, b, key, valor)
  }

  function guardarCampoManual(fechaEntrega: string, b: BloqueRuta, key: keyof DatosManuales, valor: string) {
    encolarManual(fechaEntrega, b, key, valor)
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

  function campoManual(fechaEntrega: string, b: BloqueRuta, campo: keyof DatosManuales, label: string) {
    return (
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
        <input
          type="text"
          value={manualLocal[claveBloque(fechaEntrega, b)]?.[campo] ?? ''}
          onChange={e => setCampoManual(fechaEntrega, b, campo, e.target.value)}
          onBlur={e => guardarCampoManual(fechaEntrega, b, campo, e.target.value)}
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
  // El DÍA con el que se guarda es el de la fecha de ENTREGA de ESTE documento (Cimitarra
  // guarda un maestro por día). Antes salía de la fecha de despacho + 1; con dos documentos
  // en la misma jornada eso escribiría la fila en el día equivocado.
  async function guardarSec(fechaEntrega: string, ruta: string, f: FilaDocumento, valor: string) {
    setEditSec(null)
    const n = Number(valor.trim())
    if (valor.trim() === '' || !Number.isFinite(n)) return
    if (n === f.secuencia) return // sin cambios
    const ok = await guardarSecuencia(maestro, ruta, f.codigoCliente, n, diaSemanaDe(fechaEntrega))
    if (ok) await cargar() // recarga: el documento se reordena con la secuencia nueva
  }

  // ── Exportar a Excel ───────────────────────────────────────────
  // Usa los datos manuales del ESTADO LOCAL (lo que Rafa ve, aunque no haya sacado el foco).
  // Va TODA la jornada en un solo libro: una hoja por fecha de entrega.
  function exportar() {
    if (!docs || docs.length === 0) return
    exportarDocumentoRuta(docs, new Map(Object.entries(manualLocal)))
  }

  // ── Render de una tabla de sección ─────────────────────────────
  function tabla(titulo: string, seccion: SeccionDocumento, conCP: boolean, editable: boolean, ruta: string | null = null, fechaEntrega: string | null = null) {
    // Para editar la secuencia hace falta saber a qué DÍA de entrega pertenece la fila: el
    // maestro de Cimitarra es por día. Sin fechaEntrega no se dibuja el control (hoy solo
    // pasa en la tabla de "sin ruta", que además nunca lleva secuencia).
    // Se guardan juntos en un objeto para poder usarlos dentro del onBlur sin depender de
    // que TypeScript arrastre el estrechamiento hasta el callback.
    const sec = ruta != null && fechaEntrega != null && rutaUsaSecuencia(ruta)
      ? { ruta, fechaEntrega }
      : null
    const conSecuencia = sec != null
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
                        {sec && (
                          editando ? (
                            <input
                              type="number" min={1} autoFocus
                              value={editSec.valor}
                              onChange={e => setEditSec({ key: f.key, valor: e.target.value })}
                              onBlur={e => guardarSec(sec.fechaEntrega, sec.ruta, f, e.target.value)}
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
  function seccionSinRutaDe(doc: DocumentoDia): SeccionDocumento | null {
    if (doc.sinRuta.length === 0) return null
    return {
      filas: doc.sinRuta,
      totales: doc.sinRuta.reduce(
        (t, f) => ({
          cant: t.cant + f.cant, vb: t.vb + f.vb, vr: t.vr + f.vr,
          cabeza: t.cabeza + (f.cabeza ?? 0), patas: t.patas + (f.patas ?? 0),
        }),
        { cant: 0, vb: 0, vr: 0, cabeza: 0, patas: 0 }
      ),
    }
  }

  // Avisos de TODA la jornada en un solo panel. Con más de un documento se le antepone el
  // día de entrega, si no "Cimitarra: el código X no tiene orden" saldría dos veces sin que
  // se pueda distinguir a cuál de los dos documentos se refiere.
  const hayVariasEntregas = (docs?.length ?? 0) > 1
  const avisos: string[] = (docs ?? []).flatMap(d =>
    d.avisos.map(a => (hayVariasEntregas ? `[entrega ${d.fechaEntrega}] ${a}` : a))
  )
  const haySinRuta = (docs ?? []).some(d => d.sinRuta.length > 0)

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
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
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
            disabled={!docs || docs.length === 0}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 transition-all duration-200 whitespace-nowrap disabled:opacity-40"
          >
            <FileSpreadsheet size={14} />
            Exportar a Excel
          </button>
        </div>
      </div>

      {haySinRuta && (
        <p className="text-xs text-amber-700 -mt-3">
          Hay despachos sin ruta asignada: se exportan en una hoja aparte llamada «Sin ruta».
        </p>
      )}

      {/* Aviso de la jornada partida. No es un error: es lo que Rafa pidió cuando deja
          listos dos días en una sola jornada (víspera de festivo). */}
      {hayVariasEntregas && (
        <p className="text-xs text-gray-500 -mt-3">
          Esta jornada tiene {docs?.length} fechas de entrega: sale un documento por cada una,
          con su propio encabezado. El Excel las trae como hojas separadas.
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

      {avisos.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowAvisos(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-amber-800"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              {avisos.length} {avisos.length === 1 ? 'aviso de datos' : 'avisos de datos'}
            </span>
            <ChevronDown size={16} className={`transition-transform duration-200 ${showAvisos ? 'rotate-180' : ''}`} />
          </button>
          {showAvisos && (
            <ul className="px-4 pb-3 space-y-1 text-sm text-amber-800 list-disc list-inside">
              {avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
        </div>
      )}

      {!docs ? (
        <p className="text-sm text-gray-400">Cargando documento...</p>
      ) : (
        docs.map(doc => {
          const seccionSinRuta = seccionSinRutaDe(doc)
          return (
            // Un grupo por fecha de ENTREGA. Con una sola entrega (el caso normal) esto es
            // exactamente lo que se veía antes; con dos, cada grupo lleva su propia franja
            // arriba para que no haya dudas de cuál documento es cuál.
            <div key={doc.fechaEntrega} className="space-y-6">
              {hayVariasEntregas && (
                <div className="bg-green-800 text-white rounded-xl px-4 py-2.5">
                  <p className="text-sm font-bold capitalize">Entrega {fechaLarga(doc.fechaEntrega)}</p>
                </div>
              )}

              {doc.bloques.map((b, i) => (
                // Externo puede aportar VARIOS bloques el mismo día (uno por carro), todos
                // con ruta==='Externo' -> la key no puede ser solo b.ruta (colisionaría). El orden
                // de doc.bloques es determinista, así que sumarle el índice es seguro.
                <section key={`${b.ruta}-${i}`} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{b.ruta}</h3>
                    <p className="text-sm text-gray-500 capitalize">{fechaLarga(doc.fechaEntrega)}</p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {campoManual(doc.fechaEntrega, b, 'conductor', 'Conductor')}
                    {campoManual(doc.fechaEntrega, b, 'auxiliar', 'Auxiliar')}
                    {campoManual(doc.fechaEntrega, b, 'horaProgramada', 'Hora programada')}
                    {campoManual(doc.fechaEntrega, b, 'placa', 'Placa')}
                  </div>

                  {/* Un carro externo lleva UN SOLO tipo de carne: se dibuja solo la sub-tabla que
                      tiene filas, para que no aparezca la vacía al lado (eso es lo que se veía como
                      "res y cerdo mezclados"). Las rutas con nombre sí muestran las dos aunque una
                      esté vacía, que es como Rafa arma sus alineaciones. */}
                  {(b.ruta !== 'Externo' || b.bovinos.filas.length > 0) && tabla('Bovinos', b.bovinos, true, true, b.ruta, doc.fechaEntrega)}
                  {(b.ruta !== 'Externo' || b.porcinos.filas.length > 0) && tabla('Porcinos', b.porcinos, false, true, b.ruta, doc.fechaEntrega)}

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
                      value={manualLocal[claveBloque(doc.fechaEntrega, b)]?.observacion ?? ''}
                      onChange={e => setCampoManual(doc.fechaEntrega, b, 'observacion', e.target.value)}
                      onBlur={e => guardarCampoManual(doc.fechaEntrega, b, 'observacion', e.target.value)}
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
            </div>
          )
        })
      )}
    </div>
  )
}
