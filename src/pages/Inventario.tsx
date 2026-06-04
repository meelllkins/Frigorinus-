import { useState, useEffect, useRef } from 'react'
import { Truck, Trash2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'

interface VisceraCon {
  id: string
  registro_id: string
  estado: 'en_inventario' | 'despachada'
  fecha_despacho?: string
  created_at: string
  registros_beneficio: {
    codigo_cliente: string
    numero_animal: string
  }
}

function localToday(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function parsearFechaLocal(timestamp: string): Date {
  const d = new Date(timestamp)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function formatFecha(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function formatFechaFilename(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function exportXLSX(filename: string, rows: string[][]): void {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = rows[0].map((_, ci) => ({
    wch: Math.max(...rows.map(r => (r[ci] ?? '').length))
  }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Datos')
  XLSX.writeFile(wb, filename)
}

function diasEnCava(createdAt: string): number {
  const ingreso = parsearFechaLocal(createdAt)
  const hoy = localToday()
  return Math.floor((hoy.getTime() - ingreso.getTime()) / (1000 * 60 * 60 * 24))
}

function diasBadge(dias: number): string {
  if (dias <= 2) return 'bg-green-100 text-green-700'
  if (dias <= 4) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

export default function Inventario() {
  const [visceras, setVisceras] = useState<VisceraCon[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchVisceras() }, [])

  useEffect(() => {
    if (!selectAllRef.current) return
    const q = search.trim().toLowerCase()
    const visible = visceras.filter(v =>
      !q || `${v.registros_beneficio.codigo_cliente}-${v.registros_beneficio.numero_animal}`.toLowerCase().includes(q)
    )
    const selectedCount = visible.filter(v => selected.has(v.id)).length
    selectAllRef.current.indeterminate = selectedCount > 0 && selectedCount < visible.length
  }, [selected, visceras, search])

  async function fetchVisceras() {
    const { data } = await supabase
      .from('inventario_visceras')
      .select('*, registros_beneficio(codigo_cliente, numero_animal)')
      .eq('estado', 'en_inventario')
      .order('created_at', { ascending: false })
    if (data) setVisceras(data as VisceraCon[])
  }

  async function handleDespachar(v: VisceraCon) {
    const hoy = localToday()
    await supabase
      .from('inventario_visceras')
      .update({ estado: 'despachada', fecha_despacho: hoy })
      .eq('id', v.id)
    await supabase.from('despachos').insert({
      registro_id: v.registro_id,
      tipo_despacho: 'viscera',
      fecha_despacho: hoy,
    })
    setSelected(prev => { const next = new Set(prev); next.delete(v.id); return next })
    fetchVisceras()
  }

  async function handleDespacharMultiple() {
    setDispatching(true)
    const hoy = localToday()
    const ids = Array.from(selected)
    const candidates = visceras.filter(v => selected.has(v.id))

    await supabase
      .from('inventario_visceras')
      .update({ estado: 'despachada', fecha_despacho: hoy })
      .in('id', ids)

    await supabase.from('despachos').insert(
      candidates.map(v => ({
        registro_id: v.registro_id,
        tipo_despacho: 'viscera',
        fecha_despacho: hoy,
      }))
    )

    setSelected(new Set())
    setShowModal(false)
    setDispatching(false)
    fetchVisceras()
  }

  const q = search.trim().toLowerCase()
  const visibleVisceras = visceras.filter(v =>
    !q || `${v.registros_beneficio.codigo_cliente}-${v.registros_beneficio.numero_animal}`.toLowerCase().includes(q)
  )

  const codigosConVisceras = [...new Set(visceras.map(v => v.registros_beneficio.codigo_cliente))].sort((a, b) => {
    const na = Number(a), nb = Number(b)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })

  const allVisibleSelected =
    visibleVisceras.length > 0 && visibleVisceras.every(v => selected.has(v.id))

  function toggleAll() {
    const visibleIds = visibleVisceras.map(v => v.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        visibleIds.forEach(id => next.delete(id))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        visibleIds.forEach(id => next.add(id))
        return next
      })
    }
  }

  async function handleEliminar(id: string) {
    await supabase.from('inventario_visceras').delete().eq('id', id)
    setDeleteConfirm(null)
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next })
    fetchVisceras()
  }

  async function handleEliminarMultiple() {
    setDeleting(true)
    const ids = Array.from(selected)
    await supabase.from('inventario_visceras').delete().in('id', ids)
    setSelected(new Set())
    setShowDeleteModal(false)
    setDeleting(false)
    fetchVisceras()
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function exportCSV() {
    const today = formatFechaFilename(localToday())
    const header = ['Código animal', 'Estado', 'Fecha de ingreso', 'Días en cava']
    const data = visibleVisceras.map(v => [
      `${v.registros_beneficio.codigo_cliente}-${v.registros_beneficio.numero_animal}`,
      'En inventario',
      formatFecha(parsearFechaLocal(v.created_at)),
      String(diasEnCava(v.created_at)),
    ])
    exportXLSX(`inventario-visceras-${today}.xlsx`, [header, ...data])
  }

  const someSelected = selected.size > 0

  return (
    <div className="overflow-x-hidden touch-pan-y">
      {/* Modal de confirmación de eliminación múltiple */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 animate-scaleIn">
            <h3 className="text-base font-bold text-gray-900 mb-2">Confirmar eliminación</h3>
            <p className="text-sm text-gray-600 mb-6">
              ¿Estás seguro de eliminar{' '}
              <span className="font-semibold text-gray-900">
                {selected.size} {selected.size === 1 ? 'víscera' : 'vísceras'}
              </span>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all duration-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleEliminarMultiple}
                disabled={deleting}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50"
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación de despacho múltiple */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 animate-scaleIn">
            <h3 className="text-base font-bold text-gray-900 mb-2">Confirmar despacho</h3>
            <p className="text-sm text-gray-600 mb-6">
              ¿Estás seguro de despachar{' '}
              <span className="font-semibold text-gray-900">
                {selected.size} {selected.size === 1 ? 'víscera' : 'vísceras'}
              </span>?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all duration-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleDespacharMultiple}
                disabled={dispatching}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50"
              >
                {dispatching ? 'Despachando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <h2 className="text-xl font-bold text-gray-900 mb-5">Inventario de vísceras</h2>

      {/* Resumen de códigos con vísceras */}
      {codigosConVisceras.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1.5">Códigos con vísceras en inventario:</p>
          <div className="flex flex-wrap gap-1.5">
            {codigosConVisceras.map(c => (
              <span key={c} className="bg-gray-100 border border-gray-200 text-gray-700 text-xs font-bold px-2 py-0.5 rounded-md">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por código..."
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-60 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 bg-white"
        />
        <button
          onClick={exportCSV}
          className="text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 transition-all duration-200 whitespace-nowrap"
        >
          Exportar Excel
        </button>
      </div>

      {/* Barra de acciones múltiples */}
      {someSelected && (
        <div className="mb-4 flex items-center justify-between bg-gray-900 text-white rounded-xl px-4 py-3 gap-3 animate-slideDown">
          <span className="text-sm font-semibold">
            <span className="hidden sm:inline">{selected.size} {selected.size === 1 ? 'víscera seleccionada' : 'vísceras seleccionadas'}</span>
            <span className="sm:hidden">{selected.size} sel.</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeleteModal(true)}
              className="text-sm font-bold text-red-400 hover:text-red-300 transition-all duration-200 whitespace-nowrap"
            >
              <span className="hidden sm:inline">Eliminar {selected.size} seleccionadas</span>
              <span className="sm:hidden">Eliminar</span>
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg px-3 sm:px-4 py-2 transition-all duration-200 active:scale-95 whitespace-nowrap"
            >
              <span className="hidden sm:inline">Despachar {selected.size} seleccionadas</span>
              <span className="sm:hidden">Despachar</span>
            </button>
          </div>
        </div>
      )}

      <div className="w-full overflow-x-auto rounded-2xl shadow-sm border border-gray-200 bg-white">
        <table className="min-w-[650px] w-full text-sm">
          <thead>
            <tr className="bg-gray-800">
              <th className="px-4 py-3 w-10">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded accent-white cursor-pointer"
                />
              </th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Código animal</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Estado</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha de ingreso</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Días en cava</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleVisceras.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">
                  {visceras.length === 0
                    ? 'No hay vísceras en inventario'
                    : 'Sin resultados para la búsqueda'}
                </td>
              </tr>
            ) : (
              visibleVisceras.map((v, i) => {
                const isSelected = selected.has(v.id)
                return (
                  <tr
                    key={v.id}
                    className={`transition-colors duration-150 hover:bg-blue-50 ${
                      isSelected ? 'bg-blue-50' : i % 2 === 1 ? 'bg-gray-50' : 'bg-white'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(v.id)}
                        className="w-4 h-4 rounded accent-gray-900 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                      {v.registros_beneficio.codigo_cliente}-{v.registros_beneficio.numero_animal}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all duration-200 bg-blue-100 text-blue-700">
                        En inventario
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatFecha(parsearFechaLocal(v.created_at))}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all duration-200 ${diasBadge(diasEnCava(v.created_at))} ${diasEnCava(v.created_at) >= 5 ? 'animate-pulse' : ''}`}>
                        {diasEnCava(v.created_at)} {diasEnCava(v.created_at) === 1 ? 'día' : 'días'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {deleteConfirm === v.id ? (
                          <>
                            <span className="text-xs text-gray-500">¿Eliminar?</span>
                            <button
                              onClick={() => handleEliminar(v.id)}
                              className="text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg px-2.5 py-1.5 transition-all duration-200 active:scale-95"
                            >
                              Sí
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg px-2.5 py-1.5 transition-all duration-200"
                            >
                              No
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => { setDeleteConfirm(v.id); setDeleteConfirm(v.id) }}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
                              title="Eliminar"
                            >
                              <Trash2 size={13} />
                            </button>
                            <button
                              onClick={() => handleDespachar(v)}
                              className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2 sm:px-3 py-1.5 transition-all duration-200 hover:scale-105 active:scale-95"
                            >
                              <Truck size={12} />
                              <span className="hidden sm:inline">Despachar</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
