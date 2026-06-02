import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { RegistroBeneficio } from '../types'

function diasEnCava(fechaBeneficio: string): number {
  const inicio = new Date(fechaBeneficio + 'T00:00:00')
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.floor((hoy.getTime() - inicio.getTime()) / 86_400_000)
}

function urgenciaBadge(dias: number): string {
  if (dias === 2) return 'bg-green-100 text-green-700'
  if (dias <= 4) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
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

export default function CobrosFrio() {
  const [registros, setRegistros] = useState<RegistroBeneficio[]>([])
  const [activeTab, setActiveTab] = useState<'res' | 'cerdo'>('res')
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function fetch() {
      const hoy = localToday()
      const { data } = await supabase
        .from('registros_beneficio')
        .select('*')
        .eq('estado', 'activo')
        .lte('fecha_cobro_frio', hoy)
        .order('created_at', { ascending: false })
      if (data) setRegistros(data)
    }
    fetch()
  }, [])

  const q = search.trim().toLowerCase()
  const byTab = registros.filter(r => r.tipo_carne === activeTab)
  const visibleRegistros = byTab.filter(r =>
    !q || `${r.codigo_cliente}-${r.numero_animal}`.toLowerCase().includes(q)
  )

  const codigosConCobro = [...new Set(byTab.map(r => r.codigo_cliente))].sort((a, b) => {
    const na = Number(a), nb = Number(b)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })

  function exportCSV() {
    const today = localToday()
    const header = ['Código', 'Tipo', 'Fecha de sacrificio', 'Días en cava']
    const data = visibleRegistros.map(r => [
      `${r.codigo_cliente}-${r.numero_animal}`,
      r.tipo_carne === 'res' ? 'Res' : 'Cerdo',
      r.fecha_beneficio,
      String(diasEnCava(r.fecha_beneficio)),
    ])
    downloadCSV(`cobros-frio-${today}.csv`, [header, ...data])
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-5">Cobros de frío pendientes</h2>

      {/* Subtabs */}
      <div className="flex w-fit border border-gray-200 rounded-xl overflow-hidden shadow-sm mb-5">
        {(['res', 'cerdo'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => { setActiveTab(tab); setSearch('') }}
            className={`px-8 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === tab
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800'
            }`}
          >
            {tab === 'res' ? 'Reses' : 'Cerdos'}
          </button>
        ))}
      </div>

      {/* Resumen de códigos con cobro pendiente */}
      {codigosConCobro.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-1.5">Códigos con cobro pendiente:</p>
          <div className="flex flex-wrap gap-1.5">
            {codigosConCobro.map(c => (
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

      <div className="overflow-x-auto rounded-2xl shadow-sm border border-gray-200">
      <div className="bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800">
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Código</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Tipo de carne</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha de sacrificio</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Días en cava</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleRegistros.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">
                  {byTab.length === 0
                    ? `No hay cobros de frío pendientes de ${activeTab === 'res' ? 'reses' : 'cerdos'}`
                    : 'Sin resultados para la búsqueda'}
                </td>
              </tr>
            ) : (
              visibleRegistros.map((r, i) => {
                const dias = diasEnCava(r.fecha_beneficio)
                return (
                  <tr key={r.id} className={`transition-colors hover:bg-blue-50 ${i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}>
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                      {r.codigo_cliente}-{r.numero_animal}
                    </td>
                    <td className="px-4 py-3 capitalize text-gray-700">{r.tipo_carne}</td>
                    <td className="px-4 py-3 text-gray-700">{r.fecha_beneficio}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${urgenciaBadge(dias)}`}>
                        {dias} {dias === 1 ? 'día' : 'días'}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  )
}
