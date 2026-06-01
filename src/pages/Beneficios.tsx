import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { RegistroBeneficio } from '../types'

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function diasEnCava(fechaBeneficio: string): number {
  const inicio = new Date(fechaBeneficio + 'T00:00:00')
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.floor((hoy.getTime() - inicio.getTime()) / 86_400_000)
}

const initialForm = {
  codigo_cliente: '',
  numero_animal: '',
  tipo_carne: 'res' as 'res' | 'cerdo',
  fecha_beneficio: new Date().toISOString().split('T')[0],
}

export default function Beneficio() {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [registros, setRegistros] = useState<RegistroBeneficio[]>([])

  useEffect(() => { fetchRegistros() }, [])

  async function fetchRegistros() {
    const { data } = await supabase
      .from('registros_beneficio')
      .select('*')
      .eq('estado', 'activo')
      .order('fecha_beneficio', { ascending: false })
    if (data) setRegistros(data)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const { data: registro, error: err } = await supabase
      .from('registros_beneficio')
      .insert({
        codigo_cliente: form.codigo_cliente.trim(),
        numero_animal: form.numero_animal.trim(),
        tipo_carne: form.tipo_carne,
        fecha_beneficio: form.fecha_beneficio,
        fecha_cobro_frio: addDays(form.fecha_beneficio, 2),
        estado: 'activo',
      })
      .select()
      .single()

    if (err || !registro) {
      setError('Error al guardar el registro.')
      setSaving(false)
      return
    }

    if (form.tipo_carne === 'res') {
      await supabase.from('inventario_visceras').insert({
        registro_id: registro.id,
        estado: 'en_inventario',
      })
    }

    setForm(initialForm)
    fetchRegistros()
    setSaving(false)
  }

  async function handleDespachar(r: RegistroBeneficio) {
    const hoy = new Date().toISOString().split('T')[0]
    await supabase.from('registros_beneficio').update({ estado: 'despachado' }).eq('id', r.id)
    await supabase.from('despachos').insert({
      registro_id: r.id,
      tipo_despacho: 'canal',
      fecha_despacho: hoy,
    })
    fetchRegistros()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Registrar animal</h2>
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-gray-200 rounded-xl p-6 grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Código cliente</label>
            <input
              type="text"
              value={form.codigo_cliente}
              onChange={e => setForm({ ...form, codigo_cliente: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Número de animal</label>
            <input
              type="text"
              value={form.numero_animal}
              onChange={e => setForm({ ...form, numero_animal: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de carne</label>
            <select
              value={form.tipo_carne}
              onChange={e => setForm({ ...form, tipo_carne: e.target.value as 'res' | 'cerdo' })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              <option value="res">Res</option>
              <option value="cerdo">Cerdo</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de beneficio</label>
            <input
              type="date"
              value={form.fecha_beneficio}
              onChange={e => setForm({ ...form, fecha_beneficio: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              required
            />
          </div>
          {error && <p className="sm:col-span-2 text-red-500 text-sm">{error}</p>}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-gray-900 text-white rounded-lg px-6 py-2 text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Registrar animal'}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Animales en cava</h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Código</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo de carne</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha de sacrificio</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Días en cava</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {registros.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No hay registros activos
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
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            dias >= 3 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {dias} {dias === 1 ? 'día' : 'días'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDespachar(r)}
                          className="text-xs font-medium text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1 hover:border-gray-400 transition-colors"
                        >
                          Despachar
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
