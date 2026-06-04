import { useState, useEffect } from 'react'
import { Undo2, Trash2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'

interface DespachoCon {
  id: string
  registro_id: string
  tipo_despacho: 'canal' | 'viscera'
  fecha_despacho: string
  notas?: string
  created_at: string
  registros_beneficio: {
    codigo_cliente: string
    numero_animal: string
    tipo_carne: 'res' | 'cerdo'
    fecha_beneficio: string
  }
}

function localToday(): string {
  const d = new Date()
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

export default function Despachos() {
  const [despachos, setDespachos] = useState<DespachoCon[]>([])
  const [revertConfirm, setRevertConfirm] = useState<string | null>(null)
  const [reverting, setReverting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => { fetchDespachos() }, [])

  async function fetchDespachos() {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 15)
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
    await supabase.from('despachos').delete().lt('fecha_despacho', cutoffStr)

    const { data } = await supabase
      .from('despachos')
      .select('*, registros_beneficio(codigo_cliente, numero_animal, tipo_carne, fecha_beneficio)')
      .order('created_at', { ascending: false })
    if (data) setDespachos(data as DespachoCon[])
  }

  async function handleRevertir(d: DespachoCon) {
    setReverting(true)

    if (d.tipo_despacho === 'canal') {
      await supabase
        .from('registros_beneficio')
        .update({ estado: 'activo' })
        .eq('id', d.registro_id)

      if (d.registros_beneficio.tipo_carne === 'res') {
        await supabase
          .from('inventario_visceras')
          .update({ estado: 'en_inventario', fecha_despacho: null })
          .eq('registro_id', d.registro_id)
          .eq('estado', 'despachada')

        await supabase
          .from('despachos')
          .delete()
          .eq('registro_id', d.registro_id)
          .eq('tipo_despacho', 'viscera')
      }
    } else {
      await supabase
        .from('inventario_visceras')
        .update({ estado: 'en_inventario', fecha_despacho: null })
        .eq('registro_id', d.registro_id)
        .eq('estado', 'despachada')
    }

    await supabase.from('despachos').delete().eq('id', d.id)

    setRevertConfirm(null)
    setReverting(false)
    fetchDespachos()
  }

  async function handleEliminar(d: DespachoCon) {
    await supabase.from('inventario_visceras').delete().eq('registro_id', d.registro_id)
    await supabase.from('despachos').delete().eq('id', d.id)
    await supabase.from('registros_beneficio').delete().eq('id', d.registro_id)
    setDeleteConfirm(null)
    fetchDespachos()
  }

  const q = search.trim().toLowerCase()
  const visibleDespachos = despachos.filter(d =>
    !q || `${d.registros_beneficio.codigo_cliente}-${d.registros_beneficio.numero_animal}`.toLowerCase().includes(q)
  )

  function exportCSV() {
    const today = localToday()
    const header = ['Código', 'Tipo de despacho', 'Fecha de sacrificio', 'Fecha de despacho']
    const data = visibleDespachos.map(d => [
      `${d.registros_beneficio.codigo_cliente}-${d.registros_beneficio.numero_animal}`,
      d.tipo_despacho === 'canal' ? 'Canal' : 'Víscera',
      d.registros_beneficio.fecha_beneficio,
      d.fecha_despacho,
    ])
    exportXLSX(`despachos-${today}.xlsx`, [header, ...data])
  }

  return (
    <div className="overflow-x-hidden touch-pan-y">
      <h2 className="text-xl font-bold text-gray-900 mb-5">Historial de despachos</h2>

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
          Exportar Excel
        </button>
      </div>

      <div className="w-full overflow-x-auto rounded-2xl shadow-sm border border-gray-200 bg-white">
        <table className="min-w-[650px] w-full text-sm">
          <thead>
            <tr className="bg-gray-800">
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Código</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Tipo de despacho</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha de sacrificio</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha de despacho</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleDespachos.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">
                  {despachos.length === 0
                    ? 'No hay despachos registrados'
                    : 'Sin resultados para la búsqueda'}
                </td>
              </tr>
            ) : (
              visibleDespachos.map((d, i) => (
                <tr key={d.id} className={`transition-colors hover:bg-blue-50 ${i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}>
                  <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                    {d.registros_beneficio.codigo_cliente}-{d.registros_beneficio.numero_animal}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        d.tipo_despacho === 'canal'
                          ? 'bg-gray-200 text-gray-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {d.tipo_despacho === 'canal' ? 'Canal' : 'Víscera'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{d.registros_beneficio.fecha_beneficio}</td>
                  <td className="px-4 py-3 text-gray-700">{d.fecha_despacho}</td>
                  <td className="px-4 py-3 text-right">
                    {revertConfirm === d.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-gray-500">¿Confirmar?</span>
                        <button
                          onClick={() => handleRevertir(d)}
                          disabled={reverting}
                          className="text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                        >
                          {reverting ? '...' : 'Sí'}
                        </button>
                        <button
                          onClick={() => setRevertConfirm(null)}
                          className="text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-1.5 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : deleteConfirm === d.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-gray-500">¿Eliminar?</span>
                        <button
                          onClick={() => handleEliminar(d)}
                          className="text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg px-3 py-1.5 transition-colors"
                        >
                          Sí
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-1.5 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setDeleteConfirm(d.id); setRevertConfirm(null) }}
                          className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={13} />
                        </button>
                        <button
                          onClick={() => { setRevertConfirm(d.id); setDeleteConfirm(null) }}
                          className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg px-2 sm:px-3 py-1.5 transition-colors"
                        >
                          <Undo2 size={12} />
                          <span className="hidden sm:inline">Revertir</span>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
