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
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-5">Registrar animal</h2>
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-5"
        >
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Código cliente</label>
            <input
              type="text"
              value={form.codigo_cliente}
              onChange={e => setForm({ ...form, codigo_cliente: e.target.value })}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Número de animal</label>
            <input
              type="text"
              value={form.numero_animal}
              onChange={e => setForm({ ...form, numero_animal: e.target.value })}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tipo de carne</label>
            <select
              value={form.tipo_carne}
              onChange={e => setForm({ ...form, tipo_carne: e.target.value as 'res' | 'cerdo' })}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors bg-white"
            >
              <option value="res">Res</option>
              <option value="cerdo">Cerdo</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Fecha de beneficio</label>
            <input
              type="date"
              value={form.fecha_beneficio}
              onChange={e => setForm({ ...form, fecha_beneficio: e.target.value })}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors"
              required
            />
          </div>
          {error && <p className="sm:col-span-2 text-red-600 text-sm font-medium">{error}</p>}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-green-800 hover:bg-green-700 text-white rounded-lg px-7 py-2.5 text-sm font-bold tracking-wide transition-colors disabled:opacity-50 shadow-sm"
            >
              {saving ? 'Guardando...' : 'Registrar animal'}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-5">Animales en cava</h2>
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800">
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Código</th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Tipo de carne</th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha de sacrificio</th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Días en cava</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {registros.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">
                    No hay animales en cava
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
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            dias >= 3 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {dias} {dias === 1 ? 'día' : 'días'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDespachar(r)}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-3 py-1.5 transition-colors"
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
