import { useState, useEffect } from 'react'
import { Undo2, Trash2, Archive, X, AlertTriangle } from 'lucide-react'
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

interface DespachoArchivado {
  id: string
  registro_id: string
  tipo_despacho: 'canal' | 'viscera'
  fecha_despacho: string
  notas?: string
  created_at: string
  archivado_at: string
  registros_beneficio: {
    codigo_cliente: string
    numero_animal: string
    tipo_carne: 'res' | 'cerdo'
    fecha_beneficio: string
  } | null
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
  const [proximosAArchivar, setProximosAArchivar] = useState(0)
  const [showArchivo, setShowArchivo] = useState(false)
  const [archivo, setArchivo] = useState<DespachoArchivado[]>([])
  const [loadingArchivo, setLoadingArchivo] = useState(false)

  useEffect(() => { fetchDespachos() }, [])

  async function fetchDespachos() {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 15)
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`

    const { data: viejos } = await supabase
      .from('despachos')
      .select('id, registro_id, tipo_despacho, fecha_despacho, notas, created_at')
      .lt('fecha_despacho', cutoffStr)

    if (viejos && viejos.length > 0) {
      const toArchive = viejos.map(v => ({
        registro_id: v.registro_id,
        tipo_despacho: v.tipo_despacho,
        fecha_despacho: v.fecha_despacho,
        notas: v.notas,
        created_at: v.created_at,
        archivado_at: new Date().toISOString(),
      }))
      const { error: insertError } = await supabase
        .from('despachos_archivo')
        .insert(toArchive)

      if (!insertError) {
        const idsToDelete = viejos.map(v => v.id)
        await supabase.from('despachos').delete().in('id', idsToDelete)
      }
    }

    const { data } = await supabase
      .from('despachos')
      .select('*, registros_beneficio(codigo_cliente, numero_animal, tipo_carne, fecha_beneficio)')
      .order('created_at', { ascending: false })
    if (data) {
      setDespachos(data as DespachoCon[])
      const warning = new Date()
      warning.setDate(warning.getDate() - 12)
      const warningStr = `${warning.getFullYear()}-${String(warning.getMonth() + 1).padStart(2, '0')}-${String(warning.getDate()).padStart(2, '0')}`
      setProximosAArchivar(
        (data as DespachoCon[]).filter(d => d.fecha_despacho >= cutoffStr && d.fecha_despacho <= warningStr).length
      )
    }
  }

  async function fetchArchivo() {
    setLoadingArchivo(true)
    const { data: archData } = await supabase
      .from('despachos_archivo')
      .select('*')
      .order('fecha_despacho', { ascending: false })

    if (!archData || archData.length === 0) {
      setArchivo([])
      setLoadingArchivo(false)
      return
    }

    const registroIds = [...new Set(archData.map(r => r.registro_id).filter(Boolean))]
    const { data: benefData } = await supabase
      .from('registros_beneficio')
      .select('id, codigo_cliente, numero_animal, tipo_carne, fecha_beneficio')
      .in('id', registroIds)

    const benefMap = Object.fromEntries((benefData ?? []).map(b => [b.id, b]))

    setArchivo(
      archData.map(a => ({ ...a, registros_beneficio: benefMap[a.registro_id] ?? null })) as DespachoArchivado[]
    )
    setLoadingArchivo(false)
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

  function exportArchivoXLSX() {
    const today = localToday()
    const header = ['Código', 'Tipo de despacho', 'Fecha de sacrificio', 'Fecha de despacho', 'Archivado']
    const data = archivo.map(d => [
      d.registros_beneficio
        ? `${d.registros_beneficio.codigo_cliente}-${d.registros_beneficio.numero_animal}`
        : '—',
      d.tipo_despacho === 'canal' ? 'Canal' : 'Víscera',
      d.registros_beneficio?.fecha_beneficio ?? '—',
      d.fecha_despacho,
      d.archivado_at ? d.archivado_at.split('T')[0] : '—',
    ])
    exportXLSX(`historial-despachos-${today}.xlsx`, [header, ...data])
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
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 transition-all duration-200 whitespace-nowrap"
          >
            Exportar Excel
          </button>
          <button
            onClick={() => { fetchArchivo(); setShowArchivo(true) }}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 transition-all duration-200 whitespace-nowrap"
          >
            <Archive size={13} />
            Ver historial
          </button>
        </div>
      </div>

      {/* Banner de aviso */}
      {proximosAArchivar > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50 border border-amber-300 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={17} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{proximosAArchivar} {proximosAArchivar === 1 ? 'despacho' : 'despachos'}</span>{' '}
              {proximosAArchivar === 1 ? 'será archivado' : 'serán archivados'} en los próximos 3 días.
              Expórtalos antes si los necesitas.
            </p>
          </div>
          <button
            onClick={exportCSV}
            className="shrink-0 text-xs font-semibold text-amber-800 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg px-3 py-2 transition-all duration-200 whitespace-nowrap"
          >
            Exportar ahora
          </button>
        </div>
      )}

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
                <tr key={d.id} className={`transition-colors duration-150 hover:bg-blue-50 ${i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}>
                  <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                    {d.registros_beneficio.codigo_cliente}-{d.registros_beneficio.numero_animal}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all duration-200 ${
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
                          className="text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg px-3 py-1.5 transition-all duration-200 active:scale-95 disabled:opacity-50"
                        >
                          {reverting ? '...' : 'Sí'}
                        </button>
                        <button
                          onClick={() => setRevertConfirm(null)}
                          className="text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-1.5 transition-all duration-200"
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
                          className="text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-1.5 transition-all duration-200"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setDeleteConfirm(d.id); setRevertConfirm(null) }}
                          className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
                          title="Eliminar"
                        >
                          <Trash2 size={13} />
                        </button>
                        <button
                          onClick={() => { setRevertConfirm(d.id); setDeleteConfirm(null) }}
                          className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg px-2 sm:px-3 py-1.5 transition-all duration-200 hover:scale-105 active:scale-95"
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

      {/* Modal de historial archivado */}
      {showArchivo && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) setShowArchivo(false) }}
        >
          <div className="bg-white w-full h-[92dvh] sm:h-auto sm:max-h-[88vh] sm:max-w-4xl sm:rounded-2xl rounded-t-2xl flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <Archive size={16} className="text-gray-500" />
                <h3 className="text-base font-bold text-gray-900">Historial archivado</h3>
              </div>
              <div className="flex items-center gap-2">
                {archivo.length > 0 && (
                  <button
                    onClick={exportArchivoXLSX}
                    className="text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 transition-all duration-200 whitespace-nowrap"
                  >
                    Exportar Excel
                  </button>
                )}
                <button
                  onClick={() => setShowArchivo(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all duration-200"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto p-5">
              {loadingArchivo ? (
                <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
                  Cargando...
                </div>
              ) : archivo.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
                  No hay registros archivados aún
                </div>
              ) : (
                <div className="w-full overflow-x-auto rounded-2xl shadow-sm border border-gray-200 bg-white">
                  <table className="min-w-[700px] w-full text-sm">
                    <thead>
                      <tr className="bg-gray-800">
                        <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Código</th>
                        <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Tipo</th>
                        <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha sacrificio</th>
                        <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha despacho</th>
                        <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Archivado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {archivo.map((d, i) => (
                        <tr key={d.id} className={`transition-colors duration-150 hover:bg-blue-50 ${i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}>
                          <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                            {d.registros_beneficio
                              ? `${d.registros_beneficio.codigo_cliente}-${d.registros_beneficio.numero_animal}`
                              : <span className="text-gray-400 font-normal text-xs">—</span>}
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
                          <td className="px-4 py-3 text-gray-700">
                            {d.registros_beneficio?.fecha_beneficio ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-700">{d.fecha_despacho}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {d.archivado_at ? d.archivado_at.split('T')[0] : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
