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
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-5">Inventario de vísceras</h2>
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800">
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Código animal</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Estado</th>
              <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha ingreso</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visceras.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">
                  No hay vísceras en inventario
                </td>
              </tr>
            ) : (
              visceras.map((v, i) => (
                <tr key={v.id} className={`transition-colors hover:bg-blue-50 ${i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}>
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
                      className="text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-3 py-1.5 transition-colors"
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
