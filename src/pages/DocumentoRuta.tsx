import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertTriangle, ChevronDown, FileSpreadsheet } from 'lucide-react'
import {
  construirDocumentoDia,
  guardarDatosManuales,
  actualizarCabezaPatas,
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
  diaEntregaDe,
} from '../lib/secuenciaEntrega'

// Fecha local de hoy (mismo patrón que el resto del proyecto: YYYY-MM-DD local, sin new Date() suelto).
function hoyLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Fecha con día de la semana en español, desde una fecha DATE.
// La fecha MOSTRADA es la de ENTREGA: lo despachado un día se entrega al siguiente (despacho + 1).
// La consulta y el selector siguen usando la fecha de DESPACHO exacta; esto es solo presentación.
function fechaLarga(fecha: string): string {
  const d = new Date(fecha + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** Identidad del bloque para el estado manual: la ruta, y en Externo además el carro. */
function claveBloque(b: { ruta: string; carroId: string | null }): string {
  return b.carroId ? `${b.ruta}|${b.carroId}` : b.ruta
}

function manualVacio(): DatosManuales {
  return { conductor: null, auxiliar: null, placa: null, horaProgramada: null, observacion: null }
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
 * Trae el maestro de secuencia y arma el resolver que ordena las filas del documento
 * por orden de ENTREGA. Va fuera del componente porque no depende de ningún estado.
 * Si el maestro no se puede leer (tabla sin crear, sin permisos), devuelve undefined y
 * el documento sale con su orden de siempre — nunca rompe la pantalla.
 */
async function resolverDeSecuencia(fecha: string) {
  const maestro = await fetchMaestroSecuencia()
  if (maestro.length === 0) return undefined
  return crearResolverSecuencia(maestro, diaEntregaDe(fecha))
}

export default function DocumentoRuta() {
  const [fecha, setFecha] = useState(hoyLocal())
  const [doc, setDoc] = useState<DocumentoDia | null>(null)
  const [showAvisos, setShowAvisos] = useState(false)
  // Campos manuales en estado local (un refresco NO debe borrar lo que Rafa escribe).
  // Clave por BLOQUE, no por ruta: cada carro de Externo tiene sus propios datos manuales.
  const [manualLocal, setManualLocal] = useState<Record<string, DatosManuales>>({})
  // Edición local de cabeza/patas por fila (se limpia con cada doc nuevo → refleja lo guardado).
  const [cpLocal, setCpLocal] = useState<Record<string, { cabeza: string; patas: string }>>({})

  // Refresco (botón "Actualizar" / pestaña visible): recarga SIN reiniciar los campos
  // manuales — conserva lo que Rafa esté escribiendo y solo agrega rutas nuevas.
  const cargar = useCallback(async () => {
    const d = await construirDocumentoDia(fecha, await resolverDeSecuencia(fecha))
    setDoc(d)
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
      const d = await construirDocumentoDia(fecha, await resolverDeSecuencia(fecha))
      if (!vigente) return
      setDoc(d)
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
  function setCampoManual(b: BloqueRuta, key: keyof DatosManuales, valor: string) {
    const k = claveBloque(b)
    setManualLocal(prev => ({
      ...prev,
      [k]: { ...(prev[k] ?? manualVacio()), [key]: valor === '' ? null : valor } as DatosManuales,
    }))
  }
  function guardarCampoManual(b: BloqueRuta, key: keyof DatosManuales, valor: string) {
    // El carro va en la clave: dos carros externos del mismo día ya no se pisan.
    guardarDatosManuales(
      fecha,
      b.ruta,
      { [key]: valor.trim() === '' ? null : valor } as Partial<DatosManuales>,
      b.carroId
    )
  }

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

  // ── Exportar a Excel ───────────────────────────────────────────
  // Usa los datos manuales del ESTADO LOCAL (lo que Rafa ve, aunque no haya sacado el foco).
  function exportar() {
    if (!doc) return
    exportarDocumentoRuta(doc, new Map(Object.entries(manualLocal)))
  }

  // ── Render de una tabla de sección ─────────────────────────────
  function tabla(titulo: string, seccion: SeccionDocumento, conCP: boolean, editable: boolean) {
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
                  return (
                    <tr key={f.key} className={i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-900">{f.cod}</td>
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
            // Externo ahora puede aportar VARIOS bloques el mismo día (uno por carro), todos
            // con ruta==='Externo' -> la key no puede ser solo b.ruta (colisionaría). El orden
            // de doc.bloques es determinista, así que sumarle el índice es seguro.
            <section key={`${b.ruta}-${i}`} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{b.ruta}</h3>
                <p className="text-sm text-gray-500 capitalize">{fechaLarga(doc.fecha)}</p>
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
              {(b.ruta !== 'Externo' || b.bovinos.filas.length > 0) && tabla('Bovinos', b.bovinos, true, true)}
              {(b.ruta !== 'Externo' || b.porcinos.filas.length > 0) && tabla('Porcinos', b.porcinos, false, true)}

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
