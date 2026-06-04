import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Pencil, Truck } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import type { RegistroBeneficio } from '../types'

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function diasEnCava(fechaBeneficio: string): number {
  const inicio = new Date(fechaBeneficio + 'T00:00:00')
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.floor((hoy.getTime() - inicio.getTime()) / 86_400_000)
}

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sortCodigos(codigos: string[]): string[] {
  return [...codigos].sort((a, b) => {
    const na = Number(a), nb = Number(b)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
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

function getInitialForm() {
  return { codigo_cliente: '', numero_animal: '', fecha_beneficio: localToday() }
}

function getInitialBatchForm() {
  return { codigo_cliente: '', numero_inicial: '', numero_final: '', fecha_beneficio: localToday() }
}

interface VisceraSingle {
  id: string
  registro_id: string
  created_at: string
}

interface VisceraGroup {
  codigo: string
  registro_id: string
  visceras: VisceraSingle[]
}

function formatVisceraDate(timestamp: string): string {
  const d = new Date(timestamp)
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return `${String(local.getDate()).padStart(2, '0')}/${String(local.getMonth() + 1).padStart(2, '0')}/${local.getFullYear()}`
}

interface EditForm {
  codigo_cliente: string
  numero_animal: string
  fecha_beneficio: string
}

export default function Beneficio() {
  const [activeTab, setActiveTab] = useState<'res' | 'cerdo'>('res')

  // Formulario individual
  const [form, setForm] = useState(getInitialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const codigoRef = useRef<HTMLInputElement>(null)
  const numeroRef = useRef<HTMLInputElement>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Formulario en lote
  const [showBatch, setShowBatch] = useState(false)
  const [batchForm, setBatchForm] = useState(getInitialBatchForm)
  const [batchSaving, setBatchSaving] = useState(false)
  const [batchError, setBatchError] = useState('')
  const [batchSuccess, setBatchSuccess] = useState('')
  const batchErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Edición inline
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const editErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tabla
  const [registros, setRegistros] = useState<RegistroBeneficio[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [visceraModal, setVisceraModal] = useState<{
    registro: RegistroBeneficio
    visceras: VisceraSingle[]
  } | null>(null)
  const [visceraSelected, setVisceraSelected] = useState<Set<string>>(new Set())
  const [visceraDispatching, setVisceraDispatching] = useState(false)
  const [visceraMultiModal, setVisceraMultiModal] = useState<{
    canalesCount: number
    groups: VisceraGroup[]
  } | null>(null)
  const [visceraMultiSelected, setVisceraMultiSelected] = useState<Set<string>>(new Set())
  const [visceraMultiDispatching, setVisceraMultiDispatching] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchRegistros()
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
      .order('created_at', { ascending: false })
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

  function showEditError(msg: string) {
    setEditError(msg)
    if (editErrorTimerRef.current) clearTimeout(editErrorTimerRef.current)
    editErrorTimerRef.current = setTimeout(() => setEditError(''), 4000)
  }

  function handleTabChange(tab: 'res' | 'cerdo') {
    setActiveTab(tab)
    setForm(getInitialForm())
    setError('')
    setSearch('')
    setSelected(new Set())
    setBatchError('')
    setBatchSuccess('')
    cancelEdit()
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    if (batchErrorTimerRef.current) clearTimeout(batchErrorTimerRef.current)
  }

  function startEdit(r: RegistroBeneficio) {
    setEditingId(r.id)
    setEditForm({
      codigo_cliente: r.codigo_cliente,
      numero_animal: r.numero_animal,
      fecha_beneficio: r.fecha_beneficio,
    })
    setEditError('')
    if (editErrorTimerRef.current) clearTimeout(editErrorTimerRef.current)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(null)
    setEditError('')
    if (editErrorTimerRef.current) clearTimeout(editErrorTimerRef.current)
  }

  async function handleSaveEdit(r: RegistroBeneficio) {
    if (!editForm) return
    setEditSaving(true)

    const { error: err } = await supabase
      .from('registros_beneficio')
      .update({
        codigo_cliente: editForm.codigo_cliente.trim(),
        numero_animal: editForm.numero_animal.trim(),
        fecha_beneficio: editForm.fecha_beneficio,
        fecha_cobro_frio: addDays(editForm.fecha_beneficio, 2),
      })
      .eq('id', r.id)

    if (err) {
      showEditError(
        err.code === '23505'
          ? 'Ya existe un registro con ese animal y fecha de sacrificio'
          : 'Error al guardar. Intenta de nuevo'
      )
      setEditSaving(false)
      return
    }

    setEditingId(null)
    setEditForm(null)
    setEditSaving(false)
    fetchRegistros()
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
    const today = localToday()
    const header = ['Código', 'Tipo', 'Fecha de sacrificio', 'Días en cava']
    const data = visibleRegistros.map(r => [
      `${r.codigo_cliente}-${r.numero_animal}`,
      r.tipo_carne === 'res' ? 'Res' : 'Cerdo',
      r.fecha_beneficio,
      String(diasEnCava(r.fecha_beneficio)),
    ])
    exportXLSX(`inventario-${today}.xlsx`, [header, ...data])
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
          ? 'Este animal ya está registrado con esa fecha de sacrificio'
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

    setForm(getInitialForm())
    setSearch('')
    fetchRegistros()
    setSaving(false)
    if (window.innerWidth > 768) setTimeout(() => codigoRef.current?.focus(), 0)
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
          ? 'Uno o más animales ya están registrados con esa fecha de sacrificio'
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
    setBatchForm(getInitialBatchForm())
    setSearch('')
    setBatchSaving(false)
    fetchRegistros()
  }

  async function handleDespachar(r: RegistroBeneficio) {
    if (r.tipo_carne === 'cerdo') {
      const hoy = localToday()
      await supabase.from('registros_beneficio').update({ estado: 'despachado' }).eq('id', r.id)
      await supabase.from('despachos').insert({
        registro_id: r.id,
        tipo_despacho: 'canal',
        fecha_despacho: hoy,
      })
      setSelected(prev => { const next = new Set(prev); next.delete(r.id); return next })
      fetchRegistros()
      return
    }

    const { data } = await supabase
      .from('inventario_visceras')
      .select('id, registro_id, created_at')
      .eq('registro_id', r.id)
      .eq('estado', 'en_inventario')

    const visceras = (data ?? []) as VisceraSingle[]
    setVisceraSelected(new Set(visceras.map(v => v.id)))
    setVisceraModal({ registro: r, visceras })
  }

  async function handleDespacharCanalSolo() {
    if (!visceraModal) return
    setVisceraDispatching(true)
    const hoy = localToday()
    const r = visceraModal.registro
    await supabase.from('registros_beneficio').update({ estado: 'despachado' }).eq('id', r.id)
    await supabase.from('despachos').insert({
      registro_id: r.id,
      tipo_despacho: 'canal',
      fecha_despacho: hoy,
    })
    setSelected(prev => { const next = new Set(prev); next.delete(r.id); return next })
    setVisceraModal(null)
    setVisceraSelected(new Set())
    setVisceraDispatching(false)
    fetchRegistros()
  }

  async function handleDespacharCanalYVisceras() {
    if (!visceraModal) return
    setVisceraDispatching(true)
    const hoy = localToday()
    const r = visceraModal.registro
    await supabase.from('registros_beneficio').update({ estado: 'despachado' }).eq('id', r.id)
    await supabase.from('despachos').insert({
      registro_id: r.id,
      tipo_despacho: 'canal',
      fecha_despacho: hoy,
    })
    const selectedIds = Array.from(visceraSelected)
    if (selectedIds.length > 0) {
      await supabase
        .from('inventario_visceras')
        .update({ estado: 'despachada', fecha_despacho: hoy })
        .in('id', selectedIds)
      const selectedVisceras = visceraModal.visceras.filter(v => visceraSelected.has(v.id))
      await supabase.from('despachos').insert(
        selectedVisceras.map(v => ({
          registro_id: v.registro_id,
          tipo_despacho: 'viscera',
          fecha_despacho: hoy,
        }))
      )
    }
    setSelected(prev => { const next = new Set(prev); next.delete(r.id); return next })
    setVisceraModal(null)
    setVisceraSelected(new Set())
    setVisceraDispatching(false)
    fetchRegistros()
  }

  async function handleDespacharSeleccionMulti() {
    if (!visceraMultiModal) return
    const selectedIds = Array.from(visceraMultiSelected)
    if (selectedIds.length === 0) {
      setVisceraMultiModal(null)
      setVisceraMultiSelected(new Set())
      return
    }
    setVisceraMultiDispatching(true)
    const hoy = localToday()
    const allVisceras = visceraMultiModal.groups.flatMap(g => g.visceras)
    const toDispatch = allVisceras.filter(v => visceraMultiSelected.has(v.id))
    await supabase
      .from('inventario_visceras')
      .update({ estado: 'despachada', fecha_despacho: hoy })
      .in('id', selectedIds)
    await supabase.from('despachos').insert(
      toDispatch.map(v => ({
        registro_id: v.registro_id,
        tipo_despacho: 'viscera',
        fecha_despacho: hoy,
      }))
    )
    setVisceraMultiModal(null)
    setVisceraMultiSelected(new Set())
    setVisceraMultiDispatching(false)
  }

  async function handleDespacharMultiple() {
    setDispatching(true)
    const hoy = localToday()
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

    const resIds = registros
      .filter(r => ids.includes(r.id) && r.tipo_carne === 'res')
      .map(r => r.id)

    setSelected(new Set())
    setShowModal(false)
    setDispatching(false)
    fetchRegistros()

    if (resIds.length > 0) {
      const { data } = await supabase
        .from('inventario_visceras')
        .select('id, registro_id, created_at')
        .in('registro_id', resIds)
        .eq('estado', 'en_inventario')

      const visceras = (data ?? []) as VisceraSingle[]
      if (visceras.length > 0) {
        const groupMap = new Map<string, VisceraGroup>()
        for (const v of visceras) {
          const reg = registros.find(r => r.id === v.registro_id)
          if (!reg) continue
          const codigo = `${reg.codigo_cliente}-${reg.numero_animal}`
          if (!groupMap.has(v.registro_id)) {
            groupMap.set(v.registro_id, { codigo, registro_id: v.registro_id, visceras: [] })
          }
          groupMap.get(v.registro_id)!.visceras.push(v)
        }
        const allGroups = Array.from(groupMap.values())
        setVisceraMultiSelected(new Set(allGroups.flatMap(g => g.visceras.map(v => v.id))))
        setVisceraMultiModal({
          canalesCount: ids.length,
          groups: allGroups,
        })
      }
    }
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

  const editInputClass =
    'border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 bg-white'

  return (
    <div className="space-y-8 overflow-x-hidden touch-pan-y">
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

      {/* Modal de despacho individual con vísceras (solo reses) */}
      {visceraModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-bold text-gray-900 mb-2">Despachar canal y vísceras</h3>
            <p className="text-sm text-gray-600 mb-4">
              Canal{' '}
              <span className="font-semibold text-gray-900">
                {visceraModal.registro.codigo_cliente}-{visceraModal.registro.numero_animal}
              </span>{' '}
              lista para despacho.
            </p>
            {visceraModal.visceras.length > 0 ? (
              <div className="mb-5">
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Vísceras disponibles</p>
                <div className="space-y-2">
                  {visceraModal.visceras.map(v => (
                    <label key={v.id} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visceraSelected.has(v.id)}
                        onChange={() => {
                          const next = new Set(visceraSelected)
                          if (next.has(v.id)) next.delete(v.id)
                          else next.add(v.id)
                          setVisceraSelected(next)
                        }}
                        className="w-4 h-4 rounded accent-green-700 cursor-pointer"
                      />
                      <span className="text-sm text-gray-700">
                        Ingresada: {formatVisceraDate(v.created_at)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-5">Esta res no tiene vísceras disponibles en cava.</p>
            )}
            <div className="flex gap-3 justify-end flex-wrap">
              {visceraModal.visceras.length > 0 ? (
                <>
                  <button
                    onClick={handleDespacharCanalSolo}
                    disabled={visceraDispatching}
                    className="px-4 py-2 text-sm font-semibold text-gray-700 border border-gray-300 rounded-lg transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    Despachar canal solamente
                  </button>
                  <button
                    onClick={handleDespacharCanalYVisceras}
                    disabled={visceraDispatching}
                    className="px-4 py-2 text-sm font-bold text-white bg-green-800 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {visceraDispatching ? 'Despachando...' : 'Despachar selección'}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleDespacharCanalSolo}
                  disabled={visceraDispatching}
                  className="px-4 py-2 text-sm font-bold text-white bg-green-800 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {visceraDispatching ? 'Despachando...' : 'Despachar canal'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal resumen de vísceras post despacho múltiple */}
      {visceraMultiModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-gray-900 mb-2">¿Despachar vísceras también?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Se despacharon{' '}
              <span className="font-semibold text-gray-900">{visceraMultiModal.canalesCount} canales</span>. Selecciona las vísceras a despachar:
            </p>
            <div className="mb-5 space-y-4">
              {visceraMultiModal.groups.map(g => (
                <div key={g.registro_id}>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide font-mono">{g.codigo}</p>
                  <div className="space-y-2 pl-1">
                    {g.visceras.map(v => (
                      <label key={v.id} className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visceraMultiSelected.has(v.id)}
                          onChange={() => {
                            const next = new Set(visceraMultiSelected)
                            if (next.has(v.id)) next.delete(v.id)
                            else next.add(v.id)
                            setVisceraMultiSelected(next)
                          }}
                          className="w-4 h-4 rounded accent-green-700 cursor-pointer"
                        />
                        <span className="text-sm text-gray-700">
                          Ingresada: {formatVisceraDate(v.created_at)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-end flex-wrap">
              <button
                onClick={() => { setVisceraMultiModal(null); setVisceraMultiSelected(new Set()) }}
                disabled={visceraMultiDispatching}
                className="px-4 py-2 text-sm font-semibold text-gray-700 border border-gray-300 rounded-lg transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                No despachar vísceras
              </button>
              <button
                onClick={handleDespacharSeleccionMulti}
                disabled={visceraMultiDispatching}
                className="px-4 py-2 text-sm font-bold text-white bg-green-800 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {visceraMultiDispatching ? 'Despachando...' : 'Despachar selección'}
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
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-1.5">Códigos en cava:</p>
            <div className="flex flex-wrap gap-1.5">
              {codigosEnCava.map(c => (
                <span key={c} className="bg-gray-100 border border-gray-200 text-gray-700 text-xs font-bold px-2 py-0.5 rounded-md">
                  {c}
                </span>
              ))}
            </div>
          </div>
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
            Exportar Excel
          </button>
        </div>

        {/* Barra de despacho múltiple */}
        {someSelected && (
          <div className="mb-4 flex items-center justify-between bg-gray-900 text-white rounded-xl px-4 py-3 gap-3">
            <span className="text-sm font-semibold">
              <span className="hidden sm:inline">{selected.size} {selected.size === 1 ? 'animal seleccionado' : 'animales seleccionados'}</span>
              <span className="sm:hidden">{selected.size} sel.</span>
            </span>
            <button
              onClick={() => {
                if (selected.size === 1) {
                  const id = Array.from(selected)[0]
                  const r = registros.find(reg => reg.id === id)
                  if (r) handleDespachar(r)
                } else {
                  setShowModal(true)
                }
              }}
              className="bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg px-3 sm:px-4 py-2 transition-colors whitespace-nowrap"
            >
              <span className="hidden sm:inline">Despachar {selected.size} seleccionados</span>
              <span className="sm:hidden">Despachar</span>
            </button>
          </div>
        )}

        <div className="w-full overflow-x-auto rounded-2xl shadow-sm border border-gray-200 bg-white">
          <table className="min-w-[650px] w-full text-sm">
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
                  const isSelected = selected.has(r.id)
                  const isEditing = editingId === r.id

                  if (isEditing && editForm) {
                    const diasEdit = diasEnCava(editForm.fecha_beneficio)
                    return (
                      <tr key={r.id} className="bg-amber-50 border-l-2 border-amber-400">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(r.id)}
                            className="w-4 h-4 rounded accent-gray-900 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editForm.codigo_cliente}
                              onChange={e => setEditForm({ ...editForm, codigo_cliente: e.target.value })}
                              className={`${editInputClass} w-20`}
                            />
                            <span className="text-gray-400 text-xs">-</span>
                            <input
                              type="text"
                              value={editForm.numero_animal}
                              onChange={e => setEditForm({ ...editForm, numero_animal: e.target.value })}
                              className={`${editInputClass} w-16`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            r.tipo_carne === 'res' ? 'bg-amber-100 text-amber-700' : 'bg-pink-100 text-pink-700'
                          }`}>
                            {r.tipo_carne === 'res' ? 'Res' : 'Cerdo'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="date"
                            value={editForm.fecha_beneficio}
                            onChange={e => setEditForm({ ...editForm, fecha_beneficio: e.target.value })}
                            className={editInputClass}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            diasEdit >= 3 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {diasEdit} {diasEdit === 1 ? 'día' : 'días'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleSaveEdit(r)}
                                disabled={editSaving}
                                className="text-xs font-semibold text-white bg-green-800 hover:bg-green-700 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                              >
                                {editSaving ? '...' : 'Guardar'}
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-1.5 transition-colors"
                              >
                                Cancelar
                              </button>
                            </div>
                            {editError && (
                              <span className="text-xs text-red-600 text-right">{editError}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  }

                  const dias = diasEnCava(r.fecha_beneficio)
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
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => startEdit(r)}
                            className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                            title="Editar"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => handleDespachar(r)}
                            className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2 sm:px-3 py-1.5 transition-colors"
                          >
                            <Truck size={12} />
                            <span className="hidden sm:inline">Despachar</span>
                          </button>
                        </div>
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
