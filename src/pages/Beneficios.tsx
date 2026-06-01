import { useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
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

function sortCodigos(codigos: string[]): string[] {
  return [...codigos].sort((a, b) => {
    const na = Number(a), nb = Number(b)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
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

const initialForm = {
  codigo_cliente: '',
  numero_animal: '',
  fecha_beneficio: new Date().toISOString().split('T')[0],
}

const initialBatchForm = {
  codigo_cliente: '',
  numero_inicial: '',
  numero_final: '',
  fecha_beneficio: new Date().toISOString().split('T')[0],
}

export default function Beneficio() {
  const [activeTab, setActiveTab] = useState<'res' | 'cerdo'>('res')

  // Formulario individual
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const codigoRef = useRef<HTMLInputElement>(null)
  const numeroRef = useRef<HTMLInputElement>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Formulario en lote
  const [showBatch, setShowBatch] = useState(false)
  const [batchForm, setBatchForm] = useState(initialBatchForm)
  const [batchSaving, setBatchSaving] = useState(false)
  const [batchError, setBatchError] = useState('')
  const [batchSuccess, setBatchSuccess] = useState('')
  const batchErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tabla
  const [registros, setRegistros] = useState<RegistroBeneficio[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchRegistros()
    codigoRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!selectAllRef.current) return
    const visible = registros
      .filter(r => r.tipo_carne === activeTab)
      .filter(r => {
        const q = search.trim().toLowerCase()
        return !q || `${r.codigo_cliente}-${r.numero_animal}`.toLowerCase().includes(q)
      })
    const selectedCount = visible.filter(r => selected.has(r.id)).length
    selectAllRef.current.indeterminate = selectedCount > 0 && selectedCount < visible.length
  }, [selected, registros, activeTab, search])

  async function fetchRegistros() {
    const { data } = await supabase
      .from('registros_beneficio')
      .select('*')
      .eq('estado', 'activo')
      .order('fecha_beneficio', { ascending: false })
    if (data) setRegistros(data)
  }

  function showError(msg: string) {
    setError(msg)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setError(''), 4000)
  }

  function showBatchError(msg: string) {
    setBatchError(msg)
    if (batchErrorTimerRef.current) clearTimeout(batchErrorTimerRef.current)
    batchErrorTimerRef.current = setTimeout(() => setBatchError(''), 4000)
  }

  function handleTabChange(tab: 'res' | 'cerdo') {
    setActiveTab(tab)
    setForm(initialForm)
    setError('')
    setSearch('')
    setSelected(new Set())
    setBatchError('')
    setBatchSuccess('')
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    if (batchErrorTimerRef.current) clearTimeout(batchErrorTimerRef.current)
    setTimeout(() => codigoRef.current?.focus(), 0)
  }

  // Registros visibles según tab activo + búsqueda
  const q = search.trim().toLowerCase()
  const visibleRegistros = registros
    .filter(r => r.tipo_carne === activeTab)
    .filter(r => !q || `${r.codigo_cliente}-${r.numero_animal}`.toLowerCase().includes(q))
  const byTab = registros.filter(r => r.tipo_carne === activeTab)

  const codigosEnCava = sortCodigos([
    ...new Set(byTab.map(r => r.codigo_cliente))
  ])

  function toggleAll() {
    const visibleIds = visibleRegistros.map(r => r.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        visibleIds.forEach(id => next.delete(id))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        visibleIds.forEach(id => next.add(id))
        return next
      })
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function exportCSV() {
    const today = new Date().toISOString().split('T')[0]
    const header = ['Código', 'Tipo', 'Fecha de sacrificio', 'Días en cava']
    const data = visibleRegistros.map(r => [
      `${r.codigo_cliente}-${r.numero_animal}`,
      r.tipo_carne === 'res' ? 'Res' : 'Cerdo',
      r.fecha_beneficio,
      String(diasEnCava(r.fecha_beneficio)),
    ])
    downloadCSV(`inventario-${today}.csv`, [header, ...data])
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
        tipo_carne: activeTab,
        fecha_beneficio: form.fecha_beneficio,
        fecha_cobro_frio: addDays(form.fecha_beneficio, 2),
        estado: 'activo',
      })
      .select()
      .single()

    if (err || !registro) {
      showError(
        err?.code === '23505'
          ? 'Este animal ya está registrado en el inventario'
          : 'Error al guardar. Intenta de nuevo'
      )
      setSaving(false)
      return
    }

    if (activeTab === 'res') {
      await supabase.from('inventario_visceras').insert({
        registro_id: registro.id,
        estado: 'en_inventario',
      })
    }

    setForm(initialForm)
    fetchRegistros()
    setSaving(false)
    setTimeout(() => codigoRef.current?.focus(), 0)
  }

  async function handleBatchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBatchError('')
    setBatchSuccess('')

    const inicial = parseInt(batchForm.numero_inicial)
    const final = parseInt(batchForm.numero_final)

    if (isNaN(inicial) || isNaN(final) || final <= inicial) {
      showBatchError('El número final debe ser mayor al inicial.')
      return
    }

    setBatchSaving(true)

    const rows = []
    for (let n = inicial; n <= final; n++) {
      rows.push({
        codigo_cliente: batchForm.codigo_cliente.trim(),
        numero_animal: String(n),
        tipo_carne: activeTab,
        fecha_beneficio: batchForm.fecha_beneficio,
        fecha_cobro_frio: addDays(batchForm.fecha_beneficio, 2),
        estado: 'activo',
      })
    }

    const { data: inserted, error: err } = await supabase
      .from('registros_beneficio')
      .insert(rows)
      .select('id')

    if (err || !inserted) {
      showBatchError(
        err?.code === '23505'
          ? 'Uno o más animales del lote ya están registrados en el inventario'
          : 'Error al guardar. Intenta de nuevo'
      )
      setBatchSaving(false)
      return
    }

    if (activeTab === 'res') {
      await supabase.from('inventario_visceras').insert(
        inserted.map(r => ({ registro_id: r.id, estado: 'en_inventario' }))
      )
    }

    setBatchSuccess(`Se registraron ${inserted.length} animales correctamente.`)
    setBatchForm(initialBatchForm)
    setBatchSaving(false)
    fetchRegistros()
  }

  async function handleDespachar(r: RegistroBeneficio) {
    const hoy = new Date().toISOString().split('T')[0]
    await supabase.from('registros_beneficio').update({ estado: 'despachado' }).eq('id', r.id)
    await supabase.from('despachos').insert({
      registro_id: r.id,
      tipo_despacho: 'canal',
      fecha_despacho: hoy,
    })
    setSelected(prev => { const next = new Set(prev); next.delete(r.id); return next })
    fetchRegistros()
  }

  async function handleDespacharMultiple() {
    setDispatching(true)
    const hoy = new Date().toISOString().split('T')[0]
    const ids = Array.from(selected)

    await supabase
      .from('registros_beneficio')
      .update({ estado: 'despachado' })
      .in('id', ids)

    await supabase.from('despachos').insert(
      ids.map(id => ({
        registro_id: id,
        tipo_despacho: 'canal',
        fecha_despacho: hoy,
      }))
    )

    setSelected(new Set())
    setShowModal(false)
    setDispatching(false)
    fetchRegistros()
  }

  const batchCount = (() => {
    const ini = parseInt(batchForm.numero_inicial)
    const fin = parseInt(batchForm.numero_final)
    if (!isNaN(ini) && !isNaN(fin) && fin > ini) return fin - ini + 1
    return null
  })()

  const someSelected = selected.size > 0
  const allVisibleSelected =
    visibleRegistros.length > 0 && visibleRegistros.every(r => selected.has(r.id))

  const inputClass =
    'w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors'

  return (
    <div className="space-y-8">
      {/* Modal de confirmación de despacho múltiple */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-bold text-gray-900 mb-2">Confirmar despacho</h3>
            <p className="text-sm text-gray-600 mb-6">
              ¿Estás seguro de despachar{' '}
              <span className="font-semibold text-gray-900">
                {selected.size} {selected.size === 1 ? 'animal' : 'animales'}
              </span>?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDespacharMultiple}
                disabled={dispatching}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50"
              >
                {dispatching ? 'Despachando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-5">Registrar animal</h2>

        {/* Subtabs */}
        <div className="flex w-fit border border-gray-200 rounded-xl overflow-hidden shadow-sm mb-3">
          {(['res', 'cerdo'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabChange(tab)}
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

        {/* Resumen de códigos en cava */}
        {codigosEnCava.length > 0 && (
          <p className="text-xs text-gray-500 mb-4">
            Códigos en cava:{' '}
            <span className="font-medium text-gray-700">{codigosEnCava.join(', ')}</span>
          </p>
        )}

        {/* Formulario individual */}
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 grid grid-cols-1 sm:grid-cols-3 gap-5"
        >
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Código cliente</label>
            <input
              ref={codigoRef}
              type="text"
              value={form.codigo_cliente}
              onChange={e => setForm({ ...form, codigo_cliente: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); numeroRef.current?.focus() }
              }}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Número de animal</label>
            <input
              ref={numeroRef}
              type="text"
              value={form.numero_animal}
              onChange={e => setForm({ ...form, numero_animal: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); formRef.current?.requestSubmit() }
              }}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Fecha de beneficio</label>
            <input
              type="date"
              value={form.fecha_beneficio}
              onChange={e => setForm({ ...form, fecha_beneficio: e.target.value })}
              className={inputClass}
              required
            />
          </div>
          {error && <p className="sm:col-span-3 text-red-600 text-sm font-medium">{error}</p>}
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-green-800 hover:bg-green-700 text-white rounded-lg px-7 py-2.5 text-sm font-bold tracking-wide transition-colors disabled:opacity-50 shadow-sm"
            >
              {saving ? 'Guardando...' : `Registrar ${activeTab === 'res' ? 'res' : 'cerdo'}`}
            </button>
          </div>
        </form>

        {/* Sección colapsable: lote */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowBatch(b => !b)}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronDown
              size={16}
              className={`transition-transform duration-200 ${showBatch ? 'rotate-180' : ''}`}
            />
            Registrar varios a la vez
          </button>

          {showBatch && (
            <form
              onSubmit={handleBatchSubmit}
              className="mt-4 bg-gray-50 border border-gray-200 rounded-2xl p-6 grid grid-cols-1 sm:grid-cols-2 gap-5"
            >
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Código cliente</label>
                <input
                  type="text"
                  value={batchForm.codigo_cliente}
                  onChange={e => setBatchForm({ ...batchForm, codigo_cliente: e.target.value })}
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Fecha de beneficio</label>
                <input
                  type="date"
                  value={batchForm.fecha_beneficio}
                  onChange={e => setBatchForm({ ...batchForm, fecha_beneficio: e.target.value })}
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Número animal inicial</label>
                <input
                  type="number"
                  min={1}
                  value={batchForm.numero_inicial}
                  onChange={e => setBatchForm({ ...batchForm, numero_inicial: e.target.value })}
                  className={inputClass}
                  placeholder="ej: 121"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Número animal final</label>
                <input
                  type="number"
                  min={1}
                  value={batchForm.numero_final}
                  onChange={e => setBatchForm({ ...batchForm, numero_final: e.target.value })}
                  className={inputClass}
                  placeholder="ej: 130"
                  required
                />
              </div>

              {batchCount !== null && (
                <p className="sm:col-span-2 text-sm text-gray-600 font-medium">
                  Se registrarán{' '}
                  <span className="font-bold text-gray-900">{batchCount} animales</span>
                </p>
              )}
              {batchError && (
                <p className="sm:col-span-2 text-sm text-red-600 font-medium">{batchError}</p>
              )}
              {batchSuccess && (
                <p className="sm:col-span-2 text-sm text-green-700 font-semibold">{batchSuccess}</p>
              )}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={batchSaving || batchCount === null}
                  className="bg-green-800 hover:bg-green-700 text-white rounded-lg px-7 py-2.5 text-sm font-bold tracking-wide transition-colors disabled:opacity-50 shadow-sm"
                >
                  {batchSaving ? 'Registrando...' : 'Registrar lote'}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-5">Animales en cava</h2>

        {/* Toolbar: búsqueda + exportar */}
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

        {/* Barra de despacho múltiple */}
        {someSelected && (
          <div className="mb-4 flex items-center justify-between bg-gray-900 text-white rounded-xl px-5 py-3">
            <span className="text-sm font-semibold">
              {selected.size} {selected.size === 1 ? 'animal seleccionado' : 'animales seleccionados'}
            </span>
            <button
              onClick={() => setShowModal(true)}
              className="bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg px-4 py-2 transition-colors"
            >
              Despachar {selected.size} seleccionados
            </button>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800">
                <th className="px-4 py-3 w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded accent-white cursor-pointer"
                  />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Código</th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Tipo de carne</th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha de sacrificio</th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Días en cava</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRegistros.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">
                    {byTab.length === 0
                      ? `No hay ${activeTab === 'res' ? 'reses' : 'cerdos'} en cava`
                      : 'Sin resultados para la búsqueda'}
                  </td>
                </tr>
              ) : (
                visibleRegistros.map((r, i) => {
                  const dias = diasEnCava(r.fecha_beneficio)
                  const isSelected = selected.has(r.id)
                  return (
                    <tr
                      key={r.id}
                      className={`transition-colors hover:bg-blue-50 ${
                        isSelected ? 'bg-blue-50' : i % 2 === 1 ? 'bg-gray-50' : 'bg-white'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(r.id)}
                          className="w-4 h-4 rounded accent-gray-900 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                        {r.codigo_cliente}-{r.numero_animal}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          r.tipo_carne === 'res' ? 'bg-amber-100 text-amber-700' : 'bg-pink-100 text-pink-700'
                        }`}>
                          {r.tipo_carne === 'res' ? 'Res' : 'Cerdo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.fecha_beneficio}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          dias >= 3 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        }`}>
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
