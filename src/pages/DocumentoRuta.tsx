import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertTriangle, ChevronDown, FileSpreadsheet } from 'lucide-react'
import {
  construirDocumentoDia,
  guardarDatosManuales,
  actualizarCabezaPatas,
  type DocumentoDia,
  type SeccionDocumento,
  type FilaDocumento,
  type DatosManuales,
} from '../lib/documentoRuta'
import { exportarDocumentoRuta } from '../lib/exportarDocumentoRuta'

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

export default function DocumentoRuta() {
  const [fecha, setFecha] = useState(hoyLocal())
  const [doc, setDoc] = useState<DocumentoDia | null>(null)
  const [showAvisos, setShowAvisos] = useState(false)
  // Campos manuales en estado local (un refresco NO debe borrar lo que Rafa escribe).
  const [manualLocal, setManualLocal] = useState<Record<string, DatosManuales>>({})
  // Edición local de cabeza/patas por fila (se limpia con cada doc nuevo → refleja lo guardado).
  const [cpLocal, setCpLocal] = useState<Record<string, { cabeza: string; patas: string }>>({})

  // Refresco (botón "Actualizar" / pestaña visible): recarga SIN reiniciar los campos
  // manuales — conserva lo que Rafa esté escribiendo y solo agrega rutas nuevas.
  const cargar = useCallback(async () => {
    const d = await construirDocumentoDia(fecha)
    setDoc(d)
    setCpLocal({}) // cabeza/patas se re-derivan del doc recién cargado
    setManualLocal(prev => {
      const next = { ...prev }
      for (const b of d.bloques) {
        if (!(b.ruta in next)) next[b.ruta] = b.manual ?? manualVacio()
      }
      return next
    })
  }, [fecha])

  // Montaje + cambio de fecha: carga inicial reinicializando los campos manuales.
  // El fetch va en un async con `await` antes de cualquier setState (sin cascadas).
  useEffect(() => {
    let vigente = true
    void (async () => {
      const d = await construirDocumentoDia(fecha)
      if (!vigente) return
      setDoc(d)
      setCpLocal({})
      const manual: Record<string, DatosManuales> = {}
      for (const b of d.bloques) manual[b.ruta] = b.manual ?? manualVacio()
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
  function setCampoManual(ruta: string, key: keyof DatosManuales, valor: string) {
    setManualLocal(prev => ({
      ...prev,
      [ruta]: { ...(prev[ruta] ?? manualVacio()), [key]: valor === '' ? null : valor } as DatosManuales,
    }))
  }
  function guardarCampoManual(ruta: string, key: keyof DatosManuales, valor: string) {
    guardarDatosManuales(fecha, ruta, { [key]: valor.trim() === '' ? null : valor } as Partial<DatosManuales>)
  }

  function campoManual(ruta: string, campo: keyof DatosManuales, label: string) {
    return (
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
        <input
          type="text"
          value={manualLocal[ruta]?.[campo] ?? ''}
          onChange={e => setCampoManual(ruta, campo, e.target.value)}
          onBlur={e => guardarCampoManual(ruta, campo, e.target.value)}
          className={inputCls}
        />
      </div>
    )
  }

  // ── Cabeza/Patas ───────────────────────────────────────────────
  const filaKey = (f: FilaDocumento) => f.despachoIdsCanal.join(',')
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
                    <tr key={`${f.cod}-${i}`} className={i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}>
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
          {doc.bloques.map(b => (
            <section key={b.ruta} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{b.ruta}</h3>
                <p className="text-sm text-gray-500 capitalize">{fechaLarga(doc.fecha)}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {campoManual(b.ruta, 'conductor', 'Conductor')}
                {campoManual(b.ruta, 'auxiliar', 'Auxiliar')}
                {campoManual(b.ruta, 'horaProgramada', 'Hora programada')}
                {campoManual(b.ruta, 'placa', 'Placa')}
              </div>

              {tabla('Bovinos', b.bovinos, true, true)}
              {tabla('Porcinos', b.porcinos, false, true)}

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Observación</label>
                <textarea
                  rows={2}
                  value={manualLocal[b.ruta]?.observacion ?? ''}
                  onChange={e => setCampoManual(b.ruta, 'observacion', e.target.value)}
                  onBlur={e => guardarCampoManual(b.ruta, 'observacion', e.target.value)}
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
