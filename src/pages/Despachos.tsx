import { useState, useEffect } from 'react'
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
  }
}

export default function Despachos() {
  const [despachos, setDespachos] = useState<DespachoCon[]>([])

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('despachos')
        .select('*, registros_beneficio(codigo_cliente, numero_animal)')
        .order('fecha_despacho', { ascending: false })
      if (data) setDespachos(data as DespachoCon[])
    }
    fetch()
  }, [])

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Historial de despachos</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Código</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo de despacho</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha de despacho</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {despachos.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                  No hay despachos registrados
                </td>
              </tr>
            ) : (
              despachos.map(d => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-gray-900">
                    {d.registros_beneficio.codigo_cliente}-{d.registros_beneficio.numero_animal}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        d.tipo_despacho === 'canal'
                          ? 'bg-gray-100 text-gray-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {d.tipo_despacho === 'canal' ? 'Canal' : 'Víscera'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{d.fecha_despacho}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
