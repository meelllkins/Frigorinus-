import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { RegistroBeneficio } from '../types'

function diasEnCava(fechaBeneficio: string): number {
  const inicio = new Date(fechaBeneficio + 'T00:00:00')
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.floor((hoy.getTime() - inicio.getTime()) / 86_400_000)
}

export default function CobrosFrio() {
  const [registros, setRegistros] = useState<RegistroBeneficio[]>([])

  useEffect(() => {
    async function fetch() {
      const hoy = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('registros_beneficio')
        .select('*')
        .eq('estado', 'activo')
        .lte('fecha_cobro_frio', hoy)
      if (data) {
        setRegistros(
          [...data].sort((a, b) => diasEnCava(b.fecha_beneficio) - diasEnCava(a.fecha_beneficio))
        )
      }
    }
    fetch()
  }, [])

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Cobros de frío pendientes</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Código</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo de carne</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha de sacrificio</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Días en cava</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {registros.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  No hay cobros de frío pendientes
                </td>
              </tr>
            ) : (
              registros.map(r => {
                const dias = diasEnCava(r.fecha_beneficio)
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-900">
                      {r.codigo_cliente}-{r.numero_animal}
                    </td>
                    <td className="px-4 py-3 capitalize text-gray-700">{r.tipo_carne}</td>
                    <td className="px-4 py-3 text-gray-700">{r.fecha_beneficio}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
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
  )
}
