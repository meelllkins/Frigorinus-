import { useState, useEffect, useRef } from 'react'
import { Truck } from 'lucide-react'
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

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function downloadCSV(filename: string, rows: string[][]): void {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const csv = '﻿' + rows.map(row => row.map(esc).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Inventario() {
  const [visceras, setVisceras] = useState<VisceraCon[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [dispatching, setDispatching] = useState(false)
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
    await supabase
      .from('registros_beneficio')
      .update({ estado: 'despachado' })
      .eq('id', v.registro_id)
    setSelected(prev => { const next = new Set(prev); next.delete(v.id); return next })
    fetchVisceras()
  }

  async function handleDespacharMultiple() {
    setDispatching(true)
    const hoy = localToday()
    const ids = Array.from(selected)
    const candidates = visceras.filter(v => selected.has(v.id))
    const registroIds = candidates.map(v => v.registro_id)

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

    await supabase
      .from('registros_beneficio')
      .update({ estado: 'despachado' })
      .in('id', registroIds)

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

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function exportCSV() {
    const today = localToday()
    const header = ['Código animal', 'Estado', 'Fecha ingreso']
    const data = visibleVisceras.map(v => [
      `${v.registros_beneficio.codigo_cliente}-${v.registros_beneficio.numero_animal}`,
      'En inventario',
      v.created_at.split('T')[0],
    ])
    downloadCSV(`inventario-visceras-${today}.csv`, [header, ...data])
  }

  const someSelected = selected.size > 0

  return (
    <div className="overflow-x-hidden">
      {/* Modal de confirmación de despacho múltiple */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
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
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDespacharMultiple}
                disabled={dispatching}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50"
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
          className="text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 transition-colors whitespace-nowrap"
        >
          Exportar CSV
        </button>
      </div>

      {/* Barra de despacho múltiple */}
      {someSelected && (
        <div className="mb-4 flex items-center justify-between bg-gray-900 text-white rounded-xl px-4 py-3 gap-3">
          <span className="text-sm font-semibold">
            <span className="hidden sm:inline">{selected.size} {selected.size === 1 ? 'víscera seleccionada' : 'vísceras seleccionadas'}</span>
            <span className="sm:hidden">{selected.size} sel.</span>
          </span>
          <button
            onClick={() => setShowModal(true)}
            className="bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg px-3 sm:px-4 py-2 transition-colors whitespace-nowrap"
          >
            <span className="hidden sm:inline">Despachar {selected.size} seleccionadas</span>
            <span className="sm:hidden">Despachar</span>
          </button>
        </div>
      )}

      <div className="w-full overflow-x-auto touch-pan-x rounded-2xl shadow-sm border border-gray-200 bg-white">
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
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha ingreso</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleVisceras.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">
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
                    className={`transition-colors hover:bg-blue-50 ${
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
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                        En inventario
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{v.created_at.split('T')[0]}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDespachar(v)}
                        className="flex items-center gap-1 ml-auto text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2 sm:px-3 py-1.5 transition-colors"
                      >
                        <Truck size={12} />
                        <span className="hidden sm:inline">Despachar</span>
                      </button>
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
