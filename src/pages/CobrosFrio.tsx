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
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-5">Cobros de frío pendientes</h2>
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
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
            {registros.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">
                  No hay cobros de frío pendientes
                </td>
              </tr>
            ) : (
              registros.map((r, i) => {
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
  )
}
