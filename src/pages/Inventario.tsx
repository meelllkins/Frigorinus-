import { useState, useEffect } from 'react'
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

export default function Inventario() {
  const [visceras, setVisceras] = useState<VisceraCon[]>([])

  useEffect(() => { fetchVisceras() }, [])

  async function fetchVisceras() {
    const { data } = await supabase
      .from('inventario_visceras')
      .select('*, registros_beneficio(codigo_cliente, numero_animal)')
      .eq('estado', 'en_inventario')
      .order('created_at', { ascending: false })
    if (data) setVisceras(data as VisceraCon[])
  }

  async function handleDespachar(v: VisceraCon) {
    const hoy = new Date().toISOString().split('T')[0]
    await supabase
      .from('inventario_visceras')
      .update({ estado: 'despachada', fecha_despacho: hoy })
      .eq('id', v.id)
    await supabase.from('despachos').insert({
      registro_id: v.registro_id,
      tipo_despacho: 'viscera',
      fecha_despacho: hoy,
    })
    fetchVisceras()
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Inventario de vísceras</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Código animal</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha ingreso</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visceras.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  No hay vísceras en inventario
                </td>
              </tr>
            ) : (
              visceras.map(v => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-gray-900">
                    {v.registros_beneficio.codigo_cliente}-{v.registros_beneficio.numero_animal}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                      En inventario
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{v.created_at.split('T')[0]}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDespachar(v)}
                      className="text-xs font-medium text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1 hover:border-gray-400 transition-colors"
                    >
                      Despachar
                    </button>
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
