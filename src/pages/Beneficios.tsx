import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Pencil, Trash2, Truck, Upload, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { fetchClientesMap, type ClienteInfo } from '../lib/clientes'
import CeldasCliente from '../components/CeldasCliente'
import ClienteModal from '../components/ClienteModal'
import ImportarSacrificioModal from '../components/ImportarSacrificioModal'
import RutaFields from '../components/RutaFields'
import DireccionNacionalField from '../components/DireccionNacionalField'
import {
  RUTA_NACIONAL,
  fetchDireccionesPorCodigo,
  guardarDireccion,
  type DireccionNacional,
} from '../lib/direccionesNacional'
import { entregaPorDefecto } from '../lib/fechaEntrega'
import { enTramoPrevioAFestivo } from '../lib/festivos'
import { lineasDeAdelanto } from '../lib/adelantoVisceras'
import { normalizarCodigoDestino } from '../lib/codigoDestino'
import { agregarLineaObservacion } from '../lib/documentoRuta'
// Solo tipos: se borran al compilar, así que sacrificioPdf.ts (y con él pdfjs-dist) no entra
// en el chunk de arranque. El módulo se carga con import() dentro del handler del botón.
import type { FilasClasificadas, ParseSacrificio } from '../lib/sacrificioPdf'
import type { RegistroBeneficio } from '../types'

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Cabeza/Patas: entero opcional; '' -> NULL (no confundir con 0).
// Cabeza/Patas de canal de res: si el campo va vacío al despachar, se guarda 0 (no null),
// para que en el documento de rutas salga "0" y no una celda en blanco. Solo cambia al
// editar a propósito en el documento (ahí sí puede quedar en blanco o con el número que ponga).
function toIntOrZero(s: string): number {
  const t = s.trim()
  if (t === '') return 0
  const n = parseInt(t, 10)
  return Number.isNaN(n) ? 0 : n
}

// ── Media canal ──────────────────────────────────────────────────────────────
// `fraccion_despachada` puede llegar como string (PostgREST serializa NUMERIC así a veces)
// o faltar del todo si la migración todavía no se corrió: en ambos casos vale 0.
function fraccionDespachada(r: { fraccion_despachada?: number | string | null }): number {
  const n = Number(r.fraccion_despachada ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Cuánto queda por despachar de un animal: 1 (entero) o 0.5 (le sacaron una mitad). */
function fraccionRestante(r: { fraccion_despachada?: number | string | null }): number {
  return Math.max(0, 1 - fraccionDespachada(r))
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
  numero_animal: string
  codigo_cliente: string
  tipo: 'roja' | 'blanca' | null
}

/**
 * A partir de cuántos códigos la sección de vísceras arranca plegada. Con pocos códigos
 * se ve todo de una; con muchos (20 códigos × 5-8 vísceras) la pantalla queda impracticable
 * si se abre entera, así que arranca en un renglón por código.
 */
const PLEGAR_VISCERAS_DESDE = 3

/** Fila cruda de inventario_visceras con el embed de su registro, como la devuelve PostgREST. */
interface VisceraFila {
  id: string
  registro_id: string
  created_at: string
  tipo: 'roja' | 'blanca' | null
  registros_beneficio: { numero_animal: string; codigo_cliente: string } | null
}

/**
 * Vísceras que unos códigos tienen EN CAVA, para N códigos y en una sola consulta.
 *
 * ÚNICA fuente de qué vísceras se ofrecen al despachar: la usan el individual y el
 * múltiple, para que no vuelvan a divergir (el múltiple miraba solo las vísceras de los
 * animales del lote y se quedaba mudo cuando el resultado daba vacío).
 *
 * Se ofrecen TODAS las del código, no solo las de las rayas marcadas: el canal y su
 * víscera no siempre salen el mismo día, así que la víscera de una raya despachada ayer
 * tiene que poder salir hoy con el resto del código.
 *
 * Fuera del componente a propósito: no toca estado, así que es estable y el efecto que la
 * llama no depende de una función recreada en cada render.
 */
async function fetchVisceraDisponibles(codigos: string[]): Promise<VisceraSingle[]> {
  if (codigos.length === 0) return []
  const { data: registrosCliente } = await supabase
    .from('registros_beneficio')
    .select('id')
    .in('codigo_cliente', codigos)
    .eq('tipo_carne', 'res')

  const ids = (registrosCliente ?? []).map(x => x.id)
  if (ids.length === 0) return []

  const { data } = await supabase
    .from('inventario_visceras')
    .select('id, registro_id, tipo, created_at, registros_beneficio(numero_animal, codigo_cliente)')
    .in('registro_id', ids)
    .eq('estado', 'en_inventario')

  // El embed llega anidado y PostgREST no lo tipa solo; se declara la forma de la fila en
  // vez de un `any`, que además apagaba el chequeo de todo el map.
  const filas = (data ?? []) as unknown as VisceraFila[]
  return filas.map(v => ({
    id: v.id,
    registro_id: v.registro_id,
    created_at: v.created_at,
    numero_animal: v.registros_beneficio?.numero_animal ?? '',
    codigo_cliente: v.registros_beneficio?.codigo_cliente ?? '',
    tipo: v.tipo ?? null,
  }))
}

function formatVisceraDate(timestamp: string): string {
  const d = new Date(timestamp)
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return `${String(local.getDate()).padStart(2, '0')}/${String(local.getMonth() + 1).padStart(2, '0')}/${local.getFullYear()}`
}

// Mismos colores que tipoBadge() de Inventario.tsx y Despachos.tsx (consistencia visual)
function tipoBadge(tipo: 'roja' | 'blanca' | null): { label: string; cls: string } {
  if (tipo === 'roja') return { label: 'Roja', cls: 'bg-red-100 text-red-700' }
  if (tipo === 'blanca') return { label: 'Blanca', cls: 'bg-slate-50 text-slate-600 border border-slate-300' }
  return { label: 'Sin tipo', cls: 'bg-gray-100 text-gray-400' }
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
  // Enter salta al campo siguiente, igual que en el formulario individual: código ->
  // inicial -> final -> enviar. La fecha queda fuera de la cadena, como allá, porque viene
  // con el día de hoy puesto y casi nunca se toca.
  const batchFormRef = useRef<HTMLFormElement>(null)
  const batchInicialRef = useRef<HTMLInputElement>(null)
  const batchFinalRef = useRef<HTMLInputElement>(null)

  // Edición inline
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const editErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tabla
  const [registros, setRegistros] = useState<RegistroBeneficio[]>([])
  const [clientesMap, setClientesMap] = useState<Record<string, ClienteInfo>>({})
  const [modalCodigo, setModalCodigo] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  // Campos de despacho (ruta obligatoria, código destino, cabeza/patas solo res)
  const [despRuta, setDespRuta] = useState('')
  const [despOtroCodigo, setDespOtroCodigo] = useState(false)
  const [despCodigoDestino, setDespCodigoDestino] = useState('')
  // Destino PROPIO de las vísceras adelantadas, independiente del de la canal: Rafa manda
  // la canal al código dueño y el adelanto a otro cliente en el MISMO acto. Cada víscera ya
  // es su propia fila en `despachos`, con su propio codigo_destino, así que no hace falta
  // columna nueva — antes se le escribía el mismo valor que a la canal y punto.
  const [despVisceraOtroCodigo, setDespVisceraOtroCodigo] = useState(false)
  const [despVisceraCodigoDestino, setDespVisceraCodigoDestino] = useState('')
  // Fallo al escribir la línea de adelanto en la observación. El despacho ya se guardó, así
  // que no se revierte nada: solo se avisa para que Rafa la escriba a mano si hace falta.
  const [adelantoError, setAdelantoError] = useState('')
  const [despCabeza, setDespCabeza] = useState('')
  const [despPatas, setDespPatas] = useState('')
  // Múltiple: cabeza/patas POR CÓDIGO de cliente (un lote puede mezclar clientes).
  const [despCabezaPatasPorCodigo, setDespCabezaPatasPorCodigo] = useState<Record<string, { cabeza: string; patas: string }>>({})
  // Direcciones SOLO de la ruta Nacional: catálogo guardado y lo elegido por código.
  const [direccionesGuardadas, setDireccionesGuardadas] = useState<Record<string, DireccionNacional[]>>({})
  // Sube cuando Rafa corrige o borra una dirección desde "Gestionar direcciones": es lo que
  // vuelve a disparar la consulta del catálogo, para que el selector no quede con lo viejo.
  const [catalogoVersion, setCatalogoVersion] = useState(0)
  const [despDireccionPorCodigo, setDespDireccionPorCodigo] = useState<Record<string, string>>({})
  // Reparto por raya (caso 355): qué códigos reparten, y la dirección de cada raya.
  const [despRepartirPorCodigo, setDespRepartirPorCodigo] = useState<Record<string, boolean>>({})
  const [despDireccionPorRegistro, setDespDireccionPorRegistro] = useState<Record<string, string>>({})
  // Fecha PARA LA QUE se entrega este despacho. Arranca en la de siempre (despacho + 1);
  // Rafa la cambia cuando en una jornada deja listo también lo del día siguiente hábil.
  // Ver src/lib/fechaEntrega.ts.
  const [despFechaEntrega, setDespFechaEntrega] = useState(entregaPorDefecto(localToday()))
  // Desposte es POR ANIMAL: booleano en individual, set de ids marcados en múltiple.
  const [despDesposte, setDespDesposte] = useState(false)
  const [despDesposteIds, setDespDesposteIds] = useState<Set<string>>(new Set())
  // Media canal: solo en el despacho INDIVIDUAL (es una decisión por animal).
  const [despMediaCanal, setDespMediaCanal] = useState(false)
  const [visceraModal, setVisceraModal] = useState<{
    registro: RegistroBeneficio
    visceras: VisceraSingle[]
  } | null>(null)
  const [visceraSelected, setVisceraSelected] = useState<Set<string>>(new Set())
  const [visceraDispatching, setVisceraDispatching] = useState(false)
  // Vísceras ofrecidas en el despacho MÚLTIPLE. Van dentro del mismo modal que el canal
  // (antes eran un segundo modal posterior al insert, que además no aparecía si el lote
  // no traía vísceras propias: el bloque simplemente se perdía).
  // `null` = todavía no se consultaron; `[]` = se consultaron y el lote no tiene.
  const [despVisceras, setDespVisceras] = useState<VisceraSingle[] | null>(null)
  const [despVisceraSelected, setDespVisceraSelected] = useState<Set<string>>(new Set())
  // Qué códigos están desplegados en la sección de vísceras (ver PLEGAR_VISCERAS_DESDE).
  const [despVisceraAbiertos, setDespVisceraAbiertos] = useState<Set<string>>(new Set())
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const deleteErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showDeleteMultiModal, setShowDeleteMultiModal] = useState(false)
  const [deletingMulti, setDeletingMulti] = useState(false)
  const [deleteMultiError, setDeleteMultiError] = useState('')
  const selectAllRef = useRef<HTMLInputElement>(null)

  // Carga masiva desde el PDF de sacrificio del ERP (solo bovinos). Ver src/lib/sacrificioPdf.ts.
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const [pdfLeyendo, setPdfLeyendo] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const pdfErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pdfPreview, setPdfPreview] = useState<
    { parse: ParseSacrificio; clasificadas: FilasClasificadas } | null
  >(null)
  const [pdfConfirmando, setPdfConfirmando] = useState(false)
  const [pdfInsertError, setPdfInsertError] = useState('')
  const [toast, setToast] = useState('')
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (data) {
      setRegistros(data)
      setClientesMap(await fetchClientesMap(data.map(r => r.codigo_cliente)))
    }
  }

  // Al editar una fila se puede cambiar el código a uno que no estaba en el lote
  // inicial. Si no está en el mapa, lo buscamos puntualmente (onBlur del campo)
  // y lo fusionamos, para que la celda Cliente/Ruta de esa fila muestre el real.
  // Si no existe o no tiene fila ACTIVA, nuevo[c] queda undefined y cae al fallback.
  async function lookupClienteEnEdicion(codigo: string) {
    const c = codigo.trim()
    if (!c || c in clientesMap) return
    const nuevo = await fetchClientesMap([c])
    if (nuevo[c]) setClientesMap(prev => ({ ...prev, ...nuevo }))
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

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(''), 6000)
  }

  function showPdfError(msg: string) {
    setPdfError(msg)
    if (pdfErrorTimerRef.current) clearTimeout(pdfErrorTimerRef.current)
    pdfErrorTimerRef.current = setTimeout(() => setPdfError(''), 8000)
  }

  /**
   * Los errores que lanza sacrificioPdf.ts ya vienen redactados para el usuario; se
   * reconocen por `name` para no tener que importar la clase (y arrastrar el módulo al
   * bundle inicial). Cualquier otra cosa es un bug y sale con un texto genérico.
   */
  function mensajePdf(err: unknown): string {
    if (err instanceof Error && err.name === 'SacrificioPdfError') return err.message
    console.error('[cargarPdfSacrificio] Error inesperado:', err)
    return 'No se pudo leer el PDF. Probá de nuevo.'
  }

  /**
   * Lee el PDF y abre el preview. No escribe NADA en la base: eso pasa recién al confirmar.
   * pdfjs-dist entra por dynamic import acá adentro, no en el bundle inicial.
   */
  async function handlePdfElegido(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Se limpia el input para que elegir DOS VECES el mismo archivo vuelva a disparar onChange.
    e.target.value = ''
    if (!file) return
    setPdfError('')
    setPdfInsertError('')
    setPdfLeyendo(true)
    try {
      const { parsearSacrificioPdf, clasificarFilas } = await import('../lib/sacrificioPdf')
      const parse = await parsearSacrificioPdf(file)
      const clasificadas = await clasificarFilas(parse.filas, parse.fechaISO)
      setPdfPreview({ parse, clasificadas })
    } catch (err) {
      showPdfError(mensajePdf(err))
    } finally {
      setPdfLeyendo(false)
    }
  }

  async function handleConfirmarPdf() {
    if (!pdfPreview) return
    setPdfConfirmando(true)
    setPdfInsertError('')
    try {
      const { insertarFilas } = await import('../lib/sacrificioPdf')
      const { insertados, saltados, advertencias } = await insertarFilas(
        pdfPreview.clasificadas,
        pdfPreview.parse.fechaISO
      )
      setPdfPreview(null)
      // El PDF es de bovinos: si Rafa estaba en la pestaña de cerdos, no vería nada de lo cargado.
      setActiveTab('res')
      showToast(
        [
          `${insertados} ${insertados === 1 ? 'animal insertado' : 'animales insertados'}, ${saltados} ${saltados === 1 ? 'saltado' : 'saltados'} por duplicado.`,
          ...advertencias,
        ].join(' ')
      )
      setSearch('')
      fetchRegistros()
    } catch (err) {
      // El modal queda abierto para poder reintentar sin volver a elegir el archivo.
      setPdfInsertError(mensajePdf(err))
    } finally {
      setPdfConfirmando(false)
    }
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
      .select('id')
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

    // Las vísceras (roja + blanca) las crea el trigger crear_viscera_automatica en la BD.
    // Verificamos que se hayan creado las 2.
    if (activeTab === 'res') {
      const { data: visceras } = await supabase
        .from('inventario_visceras')
        .select('id')
        .eq('registro_id', registro.id)
      if (!visceras || visceras.length < 2) {
        showError('El animal se registró, pero sus vísceras no se crearon correctamente. Contacta al administrador.')
      }
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
      .select('id, numero_animal')

    // Las vísceras (roja + blanca por cada res) las crea el trigger crear_viscera_automatica en la BD.
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
      const insertedIds = inserted.map(r => r.id)
      const { data: viscerasCreadas } = await supabase
        .from('inventario_visceras')
        .select('registro_id')
        .in('registro_id', insertedIds)
      const createdIds = new Set((viscerasCreadas ?? []).map(v => v.registro_id))
      const failedAnimals = inserted
        .filter(r => !createdIds.has(r.id))
        .map(r => `${batchForm.codigo_cliente.trim()}-${r.numero_animal}`)
      if (failedAnimals.length > 0) {
        setBatchError(
          `Las vísceras no se crearon para: ${failedAnimals.join(', ')}. Contacta al administrador.`
        )
      }
    }

    setBatchSuccess(`Se registraron ${inserted.length} animales correctamente.`)
    setBatchForm(getInitialBatchForm())
    setSearch('')
    setBatchSaving(false)
    fetchRegistros()
  }

  function resetDespFields() {
    setDespRuta('')
    // Vuelve SIEMPRE a la entrega normal: un despacho para un día distinto es la excepción
    // y no se debe arrastrar al siguiente. Sin este reset, después de despachar para el
    // post-festivo todo lo demás saldría con esa fecha.
    setDespFechaEntrega(entregaPorDefecto(localToday()))
    setDespOtroCodigo(false)
    setDespCodigoDestino('')
    setDespVisceraOtroCodigo(false)
    setDespVisceraCodigoDestino('')
    setAdelantoError('')
    setDespCabeza('')
    setDespPatas('')
    setDespDesposte(false)
    setDespDesposteIds(new Set())
    setDespCabezaPatasPorCodigo({})
    setDespMediaCanal(false)
    setDespDireccionPorCodigo({})
    setDespRepartirPorCodigo({})
    setDespDireccionPorRegistro({})
    // `null` y no `[]`: el modal arranca en "Cargando" y no en "no hay vísceras", que sería
    // el mismo silencio que hacía parecer que el bloque no existía.
    setDespVisceras(null)
    setDespVisceraSelected(new Set())
    setDespVisceraAbiertos(new Set())
  }

  /**
   * Destino propio de las vísceras adelantadas. Se dibuja solo si hay alguna marcada: sin
   * vísceras en el acto el campo no significa nada.
   */
  function campoDestinoVisceras(hayMarcadas: boolean) {
    if (!hayMarcadas) return null
    return (
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={despVisceraOtroCodigo}
            onChange={e => setDespVisceraOtroCodigo(e.target.checked)}
            className="w-4 h-4 rounded accent-green-700 cursor-pointer"
          />
          <span className="text-sm font-semibold text-gray-700">Las vísceras van a otro código</span>
        </label>
        {despVisceraOtroCodigo && (
          <input
            type="text"
            value={despVisceraCodigoDestino}
            onChange={e => setDespVisceraCodigoDestino(e.target.value)}
            placeholder="Código destino de las vísceras (ej: 610)"
            className={`${despInputCls} mt-2`}
          />
        )}
        <p className="mt-1.5 text-xs text-gray-500">
          Sin marcar, las vísceras salen al mismo destino que la canal.
        </p>
      </div>
    )
  }

  const despInputCls =
    'w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors'
  const codigosResEnLote = sortCodigos([...new Set(
    registros.filter(r => selected.has(r.id) && r.tipo_carne === 'res').map(r => r.codigo_cliente)
  )])

  // Direcciones: aplican a TODO el lote nacional (reses y cerdos), no solo a reses.
  const codigosEnLote = sortCodigos([...new Set(
    registros.filter(r => selected.has(r.id)).map(r => r.codigo_cliente)
  )])
  const codigosEnLoteKey = codigosEnLote.join('|')

  /** Rayas del lote, en el orden en que se listan. Base del "todos" de desposte. */
  const rayasDelLote = registros.filter(r => selected.has(r.id))
  const desposteMarcados = rayasDelLote.filter(r => despDesposteIds.has(r.id)).length
  const desposteTodos = rayasDelLote.length > 0 && desposteMarcados === rayasDelLote.length

  /**
   * Master de desposte: si ya estaban TODAS marcadas, desmarca; si no, marca todas.
   * Solo toca las rayas del lote, así que no arrastra marcas de una selección anterior.
   */
  function toggleDesposteTodos() {
    setDespDesposteIds(desposteTodos ? new Set() : new Set(rayasDelLote.map(r => r.id)))
  }

  /**
   * Identificador del CARRO para este acto de despacho. Solo Externo: cada vez que se
   * despacha a Externo es un carro distinto, con su propio conductor/placa/hora. Se genera
   * uno por acto y se escribe en TODAS las filas de ese despacho (canal y sus vísceras).
   */
  function nuevoCarroId(): string | null {
    return despRuta === 'Externo' ? crypto.randomUUID() : null
  }

  /**
   * Destino que va en las filas de VÍSCERA. Si Rafa no marcó nada, es el mismo de la canal
   * (comportamiento de siempre); si marcó, las vísceras adelantadas salen para otro código.
   */
  function codigoDestinoDeVisceras(destinoCanal: string | null): string | null {
    // normalizarCodigoDestino saca el "PARA COD" si vino tipeado adentro: el rótulo lo pone
    // el render, y si además viene en el valor sale duplicado.
    const propio = normalizarCodigoDestino(despVisceraCodigoDestino)
    return despVisceraOtroCodigo && propio != null ? propio : destinoCanal
  }

  /**
   * Escribe en la observación del documento una línea por código con adelanto.
   *
   * Se llama DESPUÉS de insertar los despachos y NO revierte nada si falla: el despacho es
   * el dato y la línea es texto de apoyo. El append lo hace el servidor (ver
   * agregarLineaObservacion), así que no pisa lo que Rafa esté escribiendo en el textarea.
   */
  async function escribirAdelanto(
    visceras: VisceraSingle[],
    registrosDespachados: Set<string>,
    ruta: string,
    fechaEntrega: string,
    carroId: string | null,
    destinoVisceras: string | null
  ): Promise<void> {
    const lineas = lineasDeAdelanto(
      visceras.map(v => ({
        registroId: v.registro_id,
        codigoCliente: v.codigo_cliente,
        numeroAnimal: v.numero_animal,
      })),
      registrosDespachados,
      destinoVisceras
    )
    if (lineas.length === 0) return

    const fallas: string[] = []
    for (const l of lineas) {
      const r = await agregarLineaObservacion(fechaEntrega, ruta, l.texto, carroId)
      if (!r.ok) fallas.push(r.mensaje)
    }
    if (fallas.length > 0) {
      setAdelantoError(
        `El despacho se guardó, pero la nota de adelanto no se pudo escribir en la observación (${fallas[0]}). Agregala a mano en el documento de ruta.`
      )
    }
  }

  /**
   * Fecha de entrega que se escribe en `despachos`. Es lo que Rafa eligió, y si vació el
   * campo (un <input type="date"> se puede dejar en blanco) se cae a la entrega normal:
   * mejor el comportamiento de siempre que una fila sin fecha de entrega.
   */
  function fechaEntregaAEscribir(hoy: string): string {
    return despFechaEntrega.trim() === '' ? entregaPorDefecto(hoy) : despFechaEntrega
  }

  /**
   * ¿Se ofrece elegir la fecha de entrega en este despacho?
   *
   * Solo en el tramo desde el que Rafa adelanta el trabajo de un festivo (ver festivos.ts):
   * es el único momento en que hace falta despachar para dos días distintos. El resto del
   * año el campo no aparece y el despacho se comporta igual que antes de que existiera:
   * `despFechaEntrega` sigue valiendo la entrega normal y es lo que se escribe.
   *
   * Se evalúa en cada render y no una sola vez al montar, para que la pantalla no se quede
   * con el criterio de ayer si queda abierta pasada la medianoche.
   */
  const mostrarFechaEntrega = enTramoPrevioAFestivo(localToday())

  /**
   * Vísceras del lote agrupadas por CÓDIGO de cliente (no por animal): Rafa despacha por
   * código, así que ese es el renglón que marca. Dentro de cada grupo, cada víscera dice de
   * qué raya viene, para no perder la atribución.
   */
  const visceraGruposLote = (() => {
    const mapa = new Map<string, VisceraSingle[]>()
    for (const v of despVisceras ?? []) {
      const grupo = mapa.get(v.codigo_cliente)
      if (grupo) grupo.push(v)
      else mapa.set(v.codigo_cliente, [v])
    }
    for (const grupo of mapa.values()) {
      grupo.sort((a, b) =>
        a.numero_animal.localeCompare(b.numero_animal, undefined, { numeric: true })
      )
    }
    return sortCodigos([...mapa.keys()]).map(codigo => ({ codigo, visceras: mapa.get(codigo)! }))
  })()

  const totalVisceraLote = (despVisceras ?? []).length

  /** Marca o desmarca de un golpe todas las vísceras de un código. */
  function toggleVisceraGrupo(visceras: VisceraSingle[]) {
    const todasMarcadas = visceras.every(v => despVisceraSelected.has(v.id))
    const next = new Set(despVisceraSelected)
    for (const v of visceras) {
      if (todasMarcadas) next.delete(v.id)
      else next.add(v.id)
    }
    setDespVisceraSelected(next)
  }

  function toggleVisceraAbierto(codigo: string) {
    const next = new Set(despVisceraAbiertos)
    if (next.has(codigo)) next.delete(codigo)
    else next.add(codigo)
    setDespVisceraAbiertos(next)
  }

  /** Rayas (animales) de un código dentro del lote seleccionado. Una raya = un registro. */
  function rayasDelCodigo(codigo: string): RegistroBeneficio[] {
    return registros.filter(r => selected.has(r.id) && r.codigo_cliente === codigo)
  }

  /**
   * Dirección de UNA raya (solo Nacional). `despachos` ya es una fila por raya, así que
   * esta es la dirección que se guarda en esa fila.
   * Si el código no reparte, todas sus rayas llevan la misma dirección (caso simple, sin
   * fricción). Si reparte (caso 355), cada raya lleva la suya y cae a la del código si
   * todavía no le asignaron una.
   */
  function direccionDeRaya(registroId: string, codigo: string): string | null {
    if (despRuta !== RUTA_NACIONAL) return null
    const delCodigo = despDireccionPorCodigo[codigo] ?? ''
    const cruda = despRepartirPorCodigo[codigo]
      ? (despDireccionPorRegistro[registroId] ?? delCodigo)
      : delCodigo
    const d = cruda.trim()
    return d === '' ? null : d
  }

  /**
   * Dirección de UNA víscera del lote múltiple (solo Nacional).
   *
   * Normalmente es la de SU raya. Pero se ofrecen todas las vísceras del código, incluidas
   * las de rayas que no están en el lote: esas no tienen dirección propia, y si el código
   * reparte por raya tampoco hay una del código (ese campo se oculta al repartir). Ahí se
   * cae a la de la primera raya del código en el lote, que es el camión al que se suben:
   * mejor eso que una fila sin dirección.
   */
  function direccionDeViscera(v: VisceraSingle): string | null {
    const propia = direccionDeRaya(v.registro_id, v.codigo_cliente)
    if (propia) return propia
    const primeraRaya = rayasDelCodigo(v.codigo_cliente)[0]
    return primeraRaya ? direccionDeRaya(primeraRaya.id, v.codigo_cliente) : null
  }

  /** Guarda en el catálogo TODAS las direcciones usadas, para reusarlas la próxima vez. */
  async function persistirDirecciones(rayas: { registroId: string; codigo: string }[]) {
    if (despRuta !== RUTA_NACIONAL) return
    const vistas = new Set<string>()
    for (const { registroId, codigo } of rayas) {
      const dir = direccionDeRaya(registroId, codigo)
      if (!dir) continue
      const clave = `${codigo}|${dir}`
      if (vistas.has(clave)) continue
      vistas.add(clave)
      await guardarDireccion(codigo, dir)
    }
  }

  // Al elegir ruta Nacional se traen las direcciones ya guardadas de los códigos en juego.
  // El await va ANTES del setState (regla set-state-in-effect del compilador de React).
  useEffect(() => {
    if (despRuta !== RUTA_NACIONAL) return
    const codigos = visceraModal
      ? [visceraModal.registro.codigo_cliente]
      : codigosEnLoteKey.split('|').filter(c => c !== '')
    if (codigos.length === 0) return
    let vigente = true
    void (async () => {
      const mapa = await fetchDireccionesPorCodigo(codigos)
      if (vigente) setDireccionesGuardadas(mapa)
    })()
    return () => { vigente = false }
  }, [despRuta, visceraModal, codigosEnLoteKey, catalogoVersion])

  // Vísceras del lote múltiple: se traen al abrir el modal de despacho, para que Rafa las
  // marque en el mismo acto que los canales. Los setState van DESPUÉS del await (regla
  // set-state-in-effect del compilador de React), igual que en el efecto de direcciones.
  useEffect(() => {
    if (!showModal) return
    const codigos = codigosEnLoteKey.split('|').filter(c => c !== '')
    if (codigos.length === 0) return
    let vigente = true
    void (async () => {
      const visceras = await fetchVisceraDisponibles(codigos)
      if (!vigente) return
      setDespVisceras(visceras)
      const conVisceras = [...new Set(visceras.map(v => v.codigo_cliente))]
      setDespVisceraAbiertos(
        conVisceras.length <= PLEGAR_VISCERAS_DESDE ? new Set(conVisceras) : new Set()
      )
    })()
    return () => { vigente = false }
  }, [showModal, codigosEnLoteKey])

  async function handleDespachar(r: RegistroBeneficio) {
    resetDespFields()
    if (r.tipo_carne === 'cerdo') {
      // Los cerdos no tienen vísceras, pero igual pasan por el modal para elegir ruta.
      setVisceraSelected(new Set())
      setVisceraModal({ registro: r, visceras: [] })
      return
    }

    const visceras = await fetchVisceraDisponibles([r.codigo_cliente])
    setVisceraSelected(new Set())
    setVisceraModal({ registro: r, visceras })
  }

  /**
   * Cuánto sale en este despacho de canal y cómo queda el animal después.
   * ÚNICA fuente de esta regla: la usan el despacho individual y el múltiple, para
   * que no vuelvan a divergir (el múltiple ignoraba media canal y sobre-despachaba).
   *
   * Si ya le sacaron una mitad, lo que sale es forzosamente la mitad que queda
   * (no se puede despachar "entero" un animal al que ya le falta la mitad).
   * El animal solo pasa a 'despachado' cuando completó 1: mientras tenga media
   * pendiente sigue 'activo' y visible en la lista.
   *
   * `mediaCanal` = lo que pidió el usuario. En el múltiple es siempre false (media
   * canal es una decisión por animal y solo se ofrece en el individual), pero aun
   * así respeta el 0.5 restante de un animal ya partido.
   */
  function despachoDeCanal(r: RegistroBeneficio, mediaCanal: boolean) {
    const restante = fraccionRestante(r)
    const fraccion = restante <= 0.5 ? restante : mediaCanal ? 0.5 : 1
    const total = fraccionDespachada(r) + fraccion
    return {
      fraccion,
      registroUpdate: {
        estado: total >= 1 ? 'despachado' : 'activo',
        fraccion_despachada: total,
      },
    }
  }

  async function handleDespacharCanalSolo() {
    if (!visceraModal) return
    setVisceraDispatching(true)
    const hoy = localToday()
    const r = visceraModal.registro
    const codigoDestinoFinal = despOtroCodigo ? normalizarCodigoDestino(despCodigoDestino) : null
    const esRes = r.tipo_carne === 'res'
    const { fraccion, registroUpdate } = despachoDeCanal(r, despMediaCanal)
    const carroId = nuevoCarroId() // un carro por acto de despacho (solo Externo)
    const fechaEntrega = fechaEntregaAEscribir(hoy)
    await persistirDirecciones([{ registroId: r.id, codigo: r.codigo_cliente }])
    await supabase.from('registros_beneficio').update(registroUpdate).eq('id', r.id)
    await supabase.from('despachos').insert({
      registro_id: r.id,
      tipo_despacho: 'canal',
      fecha_despacho: hoy,
      fecha_entrega: fechaEntrega,
      ruta: despRuta,
      codigo_destino: codigoDestinoFinal,
      cabeza: esRes ? toIntOrZero(despCabeza) : null,
      patas: esRes ? toIntOrZero(despPatas) : null,
      es_desposte: despDesposte,
      fraccion,
      direccion: direccionDeRaya(r.id, r.codigo_cliente),
      carro_id: carroId,
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
    const codigoDestinoFinal = despOtroCodigo ? normalizarCodigoDestino(despCodigoDestino) : null
    const esRes = r.tipo_carne === 'res'
    const { fraccion, registroUpdate } = despachoDeCanal(r, despMediaCanal)
    const carroId = nuevoCarroId() // un carro por acto de despacho (solo Externo)
    const fechaEntrega = fechaEntregaAEscribir(hoy)
    await persistirDirecciones([{ registroId: r.id, codigo: r.codigo_cliente }])
    await supabase.from('registros_beneficio').update(registroUpdate).eq('id', r.id)
    await supabase.from('despachos').insert({
      registro_id: r.id,
      tipo_despacho: 'canal',
      fecha_despacho: hoy,
      fecha_entrega: fechaEntrega,
      ruta: despRuta,
      codigo_destino: codigoDestinoFinal,
      cabeza: esRes ? toIntOrZero(despCabeza) : null,
      patas: esRes ? toIntOrZero(despPatas) : null,
      es_desposte: despDesposte,
      fraccion,
      direccion: direccionDeRaya(r.id, r.codigo_cliente),
      carro_id: carroId,
    })
    const selectedIds = Array.from(visceraSelected)
    if (selectedIds.length > 0) {
      await supabase
        .from('inventario_visceras')
        .update({ estado: 'despachada', fecha_despacho: hoy })
        .in('id', selectedIds)
      const selectedVisceras = visceraModal.visceras.filter(v => visceraSelected.has(v.id))
      // Destino PROPIO de las vísceras: puede ser otro código que el de la canal.
      const destinoVisceras = codigoDestinoDeVisceras(codigoDestinoFinal)
      await supabase.from('despachos').insert(
        selectedVisceras.map(v => ({
          registro_id: v.registro_id,
          viscera_id: v.id,
          tipo_despacho: 'viscera',
          fecha_despacho: hoy,
          // Misma ruta, CARRO y FECHA DE ENTREGA que el canal (sin cabeza/patas): las
          // vísceras viajan con él, así que tienen que caer en el mismo documento. El
          // DESTINO ya no se hereda: el adelanto puede ir a otro cliente.
          fecha_entrega: fechaEntrega,
          ruta: despRuta,
          codigo_destino: destinoVisceras,
          carro_id: carroId,
          // Misma dirección que su canal (individual = un solo animal, un solo código).
          // Se escribe acá y no se deja solo al fallback de documentoRuta.ts: ese fallback
          // solo une por registro_id (misma raya) y no sobrevive al archivado.
          direccion: direccionDeRaya(v.registro_id, r.codigo_cliente),
        }))
      )
      // Adelanto: las vísceras marcadas cuya raya NO sale en este acto. La de la canal que
      // sí sale queda afuera del conteo (lo resuelve lineasDeAdelanto).
      await escribirAdelanto(
        selectedVisceras,
        new Set([r.id]),
        despRuta,
        fechaEntrega,
        carroId,
        destinoVisceras
      )
    }
    setSelected(prev => { const next = new Set(prev); next.delete(r.id); return next })
    setVisceraModal(null)
    setVisceraSelected(new Set())
    setVisceraDispatching(false)
    fetchRegistros()
  }

  async function handleEliminarRegistro(r: RegistroBeneficio) {
    setDeleteError('')
    if (r.tipo_carne === 'res') {
      const { error: errViscera } = await supabase
        .from('inventario_visceras')
        .delete()
        .eq('registro_id', r.id)
      if (errViscera) {
        setDeleteError('Error al eliminar la víscera. Intenta de nuevo.')
        if (deleteErrorTimerRef.current) clearTimeout(deleteErrorTimerRef.current)
        deleteErrorTimerRef.current = setTimeout(() => setDeleteError(''), 4000)
        return
      }
    }
    const { error: errRegistro } = await supabase
      .from('registros_beneficio')
      .delete()
      .eq('id', r.id)
    if (errRegistro) {
      setDeleteError('Error al eliminar el animal. Intenta de nuevo.')
      if (deleteErrorTimerRef.current) clearTimeout(deleteErrorTimerRef.current)
      deleteErrorTimerRef.current = setTimeout(() => setDeleteError(''), 4000)
      return
    }
    setDeleteConfirm(null)
    setSelected(prev => { const next = new Set(prev); next.delete(r.id); return next })
    fetchRegistros()
  }

  async function handleEliminarMultiple() {
    setDeletingMulti(true)
    setDeleteMultiError('')
    const ids = Array.from(selected)
    const toDelete = registros.filter(r => ids.includes(r.id))
    const failed: string[] = []

    for (const r of toDelete) {
      if (r.tipo_carne === 'res') {
        const { error: errV } = await supabase
          .from('inventario_visceras')
          .delete()
          .eq('registro_id', r.id)
        if (errV) {
          failed.push(`${r.codigo_cliente}-${r.numero_animal}`)
          continue
        }
      }
      const { error: errR } = await supabase
        .from('registros_beneficio')
        .delete()
        .eq('id', r.id)
      if (errR) {
        failed.push(`${r.codigo_cliente}-${r.numero_animal}`)
      }
    }

    setDeletingMulti(false)
    setSelected(new Set())
    fetchRegistros()
    if (failed.length > 0) {
      setDeleteMultiError(`No se pudieron eliminar: ${failed.join(', ')}.`)
    } else {
      setShowDeleteMultiModal(false)
    }
  }

  async function handleDespacharMultiple() {
    setDispatching(true)
    const hoy = localToday()
    const ids = Array.from(selected)

    const regById = new Map(registros.map(r => [r.id, r] as const))

    // Media canal en el lote: se resuelve POR ANIMAL con la misma regla del individual
    // (despachoDeCanal). Sin esto, un animal con media pendiente recibía un despacho de 1
    // encima del 0.5 previo y el documento le sumaba 1.5.
    // El múltiple no ofrece media canal, pero si al animal ya le sacaron una mitad, sale
    // SOLO la mitad restante.
    const fraccionPorId = new Map<string, number>()
    // Los animales que terminan igual se actualizan juntos: en el múltiple todos quedan
    // completos (fraccion_despachada = 1), así que en la práctica es UNA sola consulta.
    // Se agrupa igual —en vez de asumirlo— para que no se rompa si algún día el múltiple
    // permite despachar medias.
    const lotesUpdate = new Map<string, { update: Record<string, unknown>; ids: string[] }>()
    // Animales que REALMENTE salen en este lote (ver el guard de abajo). Todo lo que
    // viene después —cabeza/patas, el insert y las vísceras— se arma con esta lista y
    // no con `ids`, para que un animal salteado no reciba fila igual.
    const idsADespachar: string[] = []
    for (const id of ids) {
      const r = regById.get(id)
      if (!r) continue
      const { fraccion, registroUpdate } = despachoDeCanal(r, false)
      // GUARD: si no queda nada por despachar, `fraccion` sería 0 y violaría el CHECK
      // fraccion IN (0.5, 1), tumbando el INSERT del LOTE ENTERO. Y como el update de
      // registros_beneficio ya corrió, los animales quedarían marcados 'despachado' sin
      // ninguna fila de despacho: se pierde el rastro del lote. Por los flujos normales
      // no se llega acá (al completar 1 el animal pasa a 'despachado' y sale de la lista);
      // esto cubre datos editados a mano en Supabase o una migración corrida a medias.
      if (fraccion <= 0) continue
      idsADespachar.push(id)
      fraccionPorId.set(id, fraccion)
      const clave = `${registroUpdate.estado}|${registroUpdate.fraccion_despachada}`
      const lote = lotesUpdate.get(clave)
      if (lote) lote.ids.push(id)
      else lotesUpdate.set(clave, { update: registroUpdate, ids: [id] })
    }
    for (const lote of lotesUpdate.values()) {
      await supabase.from('registros_beneficio').update(lote.update).in('id', lote.ids)
    }

    const codigoDestinoFinal = despOtroCodigo ? normalizarCodigoDestino(despCodigoDestino) : null
    const carroId = nuevoCarroId() // todo el lote viaja en el MISMO carro
    const fechaEntrega = fechaEntregaAEscribir(hoy) // ...y para el MISMO día de entrega
    await persistirDirecciones(idsADespachar.map(id => ({ registroId: id, codigo: regById.get(id)?.codigo_cliente ?? '' })))

    // Cabeza/Patas: un total POR CÓDIGO de cliente, escrito solo en la PRIMERA fila
    // (res) de ese código dentro del lote; las demás filas de ese código quedan null.
    const primeraFilaPorCodigo = new Map<string, string>()
    for (const id of idsADespachar) {
      const r = regById.get(id)
      if (r && r.tipo_carne === 'res' && !primeraFilaPorCodigo.has(r.codigo_cliente)) {
        primeraFilaPorCodigo.set(r.codigo_cliente, id)
      }
    }

    if (idsADespachar.length > 0) await supabase.from('despachos').insert(
      idsADespachar.map(id => {
        const r = regById.get(id)
        const esPrimeraDeSuCodigo = !!r && r.tipo_carne === 'res' && primeraFilaPorCodigo.get(r.codigo_cliente) === id
        const cp = r ? despCabezaPatasPorCodigo[r.codigo_cliente] : undefined
        return {
          registro_id: id,
          tipo_despacho: 'canal',
          fecha_despacho: hoy,
          fecha_entrega: fechaEntrega,
          ruta: despRuta,
          codigo_destino: codigoDestinoFinal,
          // Desposte es POR ANIMAL: cada fila guarda lo marcado para ese id puntual.
          es_desposte: despDesposteIds.has(id),
          // Cabeza/Patas: total del código, solo en su primera fila del lote.
          cabeza: esPrimeraDeSuCodigo ? toIntOrZero(cp?.cabeza ?? '') : null,
          patas: esPrimeraDeSuCodigo ? toIntOrZero(cp?.patas ?? '') : null,
          // Fracción REAL que sale (0.5 si al animal ya le habían sacado una mitad).
          fraccion: fraccionPorId.get(id) ?? 1,
          // Dirección: solo Nacional, y es POR CÓDIGO (cada cliente su punto de entrega).
          direccion: r ? direccionDeRaya(id, r.codigo_cliente) : null,
          carro_id: carroId,
        }
      })
    )

    // Vísceras marcadas en el MISMO modal: salen en este acto, con el mismo carro y la
    // misma fecha de entrega que los canales, para que caigan en el mismo documento.
    const visceraADespachar = (despVisceras ?? []).filter(v => despVisceraSelected.has(v.id))
    if (visceraADespachar.length > 0) {
      // Destino PROPIO de las vísceras: puede ser otro código que el de los canales.
      const destinoVisceras = codigoDestinoDeVisceras(codigoDestinoFinal)
      await supabase
        .from('inventario_visceras')
        .update({ estado: 'despachada', fecha_despacho: hoy })
        .in('id', visceraADespachar.map(v => v.id))
      await supabase.from('despachos').insert(
        visceraADespachar.map(v => ({
          registro_id: v.registro_id,
          viscera_id: v.id,
          tipo_despacho: 'viscera',
          fecha_despacho: hoy,
          // Misma ruta, carro y fecha de entrega que los canales del lote (sin cabeza/patas):
          // las vísceras viajan en ese camión. El DESTINO ya no se hereda: el adelanto puede
          // ir a otro cliente.
          fecha_entrega: fechaEntrega,
          ruta: despRuta,
          codigo_destino: destinoVisceras,
          carro_id: carroId,
          // Misma dirección que el canal de SU código (ver direccionDeViscera). Se escribe
          // acá para que sobreviva al archivado, no solo al fallback de documentoRuta.ts.
          direccion: direccionDeViscera(v),
        }))
      )
      // Adelanto: las vísceras marcadas cuya raya NO sale en este lote.
      await escribirAdelanto(
        visceraADespachar,
        new Set(idsADespachar),
        despRuta,
        fechaEntrega,
        carroId,
        destinoVisceras
      )
    }

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

  const editInputClass =
    'border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 bg-white'

  return (
    <div className="space-y-8 overflow-x-hidden touch-pan-y">
      {/* Modal de confirmación de despacho múltiple */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn">
          {/* max-w-md (y no sm como los demás): acá entra además la lista de vísceras
              agrupada por código, que con max-w-sm queda apretada. */}
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto animate-scaleIn">
            <h3 className="text-base font-bold text-gray-900 mb-2">Confirmar despacho</h3>
            <p className="text-sm text-gray-600 mb-4">
              ¿Estás seguro de despachar{' '}
              <span className="font-semibold text-gray-900">
                {selected.size} {selected.size === 1 ? 'animal' : 'animales'}
              </span>
              {despVisceraSelected.size > 0 && (
                <>
                  {' y '}
                  <span className="font-semibold text-gray-900">
                    {despVisceraSelected.size} {despVisceraSelected.size === 1 ? 'víscera' : 'vísceras'}
                  </span>
                </>
              )}?
            </p>
            <RutaFields
              ruta={despRuta}
              onRuta={setDespRuta}
              otroCodigo={despOtroCodigo}
              onOtroCodigo={setDespOtroCodigo}
              codigoDestino={despCodigoDestino}
              onCodigoDestino={setDespCodigoDestino}
              fechaEntrega={mostrarFechaEntrega ? despFechaEntrega : undefined}
              onFechaEntrega={mostrarFechaEntrega ? setDespFechaEntrega : undefined}
              fechaEntregaPorDefecto={entregaPorDefecto(localToday())}
              tipoCarne={activeTab}
            />
            {despRuta === RUTA_NACIONAL && codigosEnLote.map(cod => {
              const guardadas = direccionesGuardadas[cod] ?? []
              const rayas = rayasDelCodigo(cod)
              // El reparto por raya solo tiene sentido si el código tiene MÁS DE UNA dirección
              // guardada y más de una raya en el lote. Cerdo va aparte: Rafa lo maneja manual.
              const puedeRepartir =
                guardadas.length >= 2 && rayas.length >= 2 && rayas.some(r => r.tipo_carne === 'res')
              const repartir = !!despRepartirPorCodigo[cod]
              return (
                <div key={cod} className="mb-3">
                  {!repartir && (
                    <DireccionNacionalField
                      codigo={cod}
                      mostrarCodigo
                      guardadas={guardadas}
                      valor={despDireccionPorCodigo[cod] ?? ''}
                      onValor={v => setDespDireccionPorCodigo(prev => ({ ...prev, [cod]: v }))}
                      onCatalogoCambiado={() => setCatalogoVersion(v => v + 1)}
                    />
                  )}
                  {puedeRepartir && (
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-2">
                      <input
                        type="checkbox"
                        checked={repartir}
                        onChange={e => setDespRepartirPorCodigo(prev => ({ ...prev, [cod]: e.target.checked }))}
                        className="w-4 h-4 rounded accent-green-700 cursor-pointer"
                      />
                      Repartir {cod} entre varias direcciones
                    </label>
                  )}
                  {repartir && rayas.map(r => (
                    <DireccionNacionalField
                      key={r.id}
                      codigo={`${cod}-${r.numero_animal}`}
                      mostrarCodigo
                      guardadas={guardadas}
                      valor={despDireccionPorRegistro[r.id] ?? despDireccionPorCodigo[cod] ?? ''}
                      onValor={v => setDespDireccionPorRegistro(prev => ({ ...prev, [r.id]: v }))}
                      /* Sin gestión acá: `codigo` es la etiqueta de la raya ("355-12"), no
                         el código del catálogo, y la corrección iría a un código que no
                         existe. Se gestiona desde la vista sin reparto o desde el individual. */
                    />
                  ))}
                </div>
              )
            })}
            {codigosResEnLote.length > 0 && (
              <div className="mb-4 space-y-3">
                {codigosResEnLote.map(cod => (
                  <div key={cod}>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 font-mono">{cod} — Cabeza / Patas</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Cabeza</label>
                        <input type="number" min={0} value={despCabezaPatasPorCodigo[cod]?.cabeza ?? ''} onChange={e => setDespCabezaPatasPorCodigo(prev => ({ ...prev, [cod]: { cabeza: e.target.value, patas: prev[cod]?.patas ?? '' } }))} placeholder="0" className={despInputCls} />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Patas</label>
                        <input type="number" min={0} value={despCabezaPatasPorCodigo[cod]?.patas ?? ''} onChange={e => setDespCabezaPatasPorCodigo(prev => ({ ...prev, [cod]: { cabeza: prev[cod]?.cabeza ?? '', patas: e.target.value } }))} placeholder="0" className={despInputCls} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Vísceras del lote, agrupadas por código y plegables. Van acá —y no en un
                modal posterior— para que el canal y sus vísceras salgan en un solo acto. */}
            <div className="mb-4">
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vísceras</p>
                {totalVisceraLote > 0 && (
                  <p className="text-xs text-gray-500">
                    {despVisceraSelected.size} de {totalVisceraLote} seleccionadas
                  </p>
                )}
              </div>
              {despVisceras === null ? (
                <p className="text-sm text-gray-400">Cargando vísceras...</p>
              ) : totalVisceraLote === 0 ? (
                <p className="text-sm text-gray-500">Estos códigos no tienen vísceras en cava.</p>
              ) : (
                <>
                  {campoDestinoVisceras(despVisceraSelected.size > 0)}
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setDespVisceraSelected(new Set((despVisceras ?? []).map(v => v.id)))}
                      className="text-xs font-semibold text-green-700 hover:text-green-900 bg-green-50 hover:bg-green-100 border border-green-200 rounded px-2 py-0.5 transition-colors"
                    >
                      Todas
                    </button>
                    <button
                      type="button"
                      onClick={() => setDespVisceraSelected(new Set())}
                      className="text-xs font-semibold text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded px-2 py-0.5 transition-colors"
                    >
                      Ninguna
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                    {visceraGruposLote.map(g => {
                      const marcadas = g.visceras.filter(v => despVisceraSelected.has(v.id)).length
                      const todas = marcadas === g.visceras.length
                      const rojas = g.visceras.filter(v => v.tipo === 'roja').length
                      const blancas = g.visceras.filter(v => v.tipo === 'blanca').length
                      const abierto = despVisceraAbiertos.has(g.codigo)
                      return (
                        <div key={g.codigo} className="border border-gray-200 rounded-lg overflow-hidden">
                          <div className="flex items-center gap-2 px-2.5 py-2 bg-gray-50">
                            <input
                              type="checkbox"
                              checked={todas}
                              ref={el => { if (el) el.indeterminate = marcadas > 0 && !todas }}
                              onChange={() => toggleVisceraGrupo(g.visceras)}
                              className="w-4 h-4 rounded accent-green-700 cursor-pointer shrink-0"
                            />
                            <button
                              type="button"
                              onClick={() => toggleVisceraAbierto(g.codigo)}
                              className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
                            >
                              <span className="flex flex-col min-w-0">
                                <span className="text-sm font-semibold text-gray-800 font-mono">{g.codigo}</span>
                                <span className="text-xs text-gray-500">
                                  {rojas} rojas · {blancas} blancas
                                </span>
                              </span>
                              <span className="flex items-center gap-1.5 shrink-0">
                                <span className="text-xs font-semibold text-gray-500">
                                  {marcadas}/{g.visceras.length}
                                </span>
                                <ChevronDown
                                  size={14}
                                  className={`text-gray-400 transition-transform duration-200 ${abierto ? 'rotate-180' : ''}`}
                                />
                              </span>
                            </button>
                          </div>
                          {abierto && (
                            <div className="px-2.5 py-2 space-y-2 border-t border-gray-100">
                              {g.visceras.map(v => (
                                <label key={v.id} className="flex items-center gap-2.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={despVisceraSelected.has(v.id)}
                                    onChange={() => {
                                      const next = new Set(despVisceraSelected)
                                      if (next.has(v.id)) next.delete(v.id)
                                      else next.add(v.id)
                                      setDespVisceraSelected(next)
                                    }}
                                    className="w-4 h-4 rounded accent-green-700 cursor-pointer shrink-0"
                                  />
                                  <span className="flex items-center gap-2 text-sm text-gray-700 min-w-0">
                                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold shrink-0 ${tipoBadge(v.tipo).cls}`}>
                                      {tipoBadge(v.tipo).label}
                                    </span>
                                    <span className="font-mono text-xs text-gray-600 shrink-0">
                                      {v.codigo_cliente}-{v.numero_animal}
                                    </span>
                                    <span className="text-xs text-gray-400 truncate">
                                      {formatVisceraDate(v.created_at)}
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="mb-4">
              {/* Master: marca/desmarca de un golpe todas las rayas del lote. Va en la
                  cabecera de la lista, que es donde se espera este control. */}
              <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={desposteTodos}
                  ref={el => { if (el) el.indeterminate = desposteMarcados > 0 && !desposteTodos }}
                  onChange={toggleDesposteTodos}
                  className="w-4 h-4 rounded accent-green-700 cursor-pointer shrink-0"
                />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  ¿Desposte? (por animal)
                </span>
                {desposteMarcados > 0 && (
                  <span className="text-xs font-semibold text-gray-500 ml-auto">
                    {desposteMarcados}/{rayasDelLote.length}
                  </span>
                )}
              </label>
              <div className="max-h-[35vh] overflow-y-auto pr-1 space-y-1.5">
                {rayasDelLote.map(r => (
                  <label key={r.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={despDesposteIds.has(r.id)}
                      onChange={() =>
                        setDespDesposteIds(prev => {
                          const next = new Set(prev)
                          if (next.has(r.id)) next.delete(r.id)
                          else next.add(r.id)
                          return next
                        })
                      }
                      className="w-4 h-4 rounded accent-green-700 cursor-pointer"
                    />
                    <span className="font-mono">{r.codigo_cliente}-{r.numero_animal}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all duration-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleDespacharMultiple}
                disabled={dispatching || !despRuta}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50"
              >
                {dispatching ? 'Despachando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación de eliminación múltiple */}
      {showDeleteMultiModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 max-h-[90vh] overflow-y-auto animate-scaleIn">
            <h3 className="text-base font-bold text-gray-900 mb-2">Confirmar eliminación</h3>
            <p className="text-sm text-gray-600 mb-6">
              ¿Estás seguro de eliminar{' '}
              <span className="font-semibold text-gray-900">
                {selected.size} {selected.size === 1 ? 'animal' : 'animales'}
              </span>? Esta acción no se puede deshacer.
            </p>
            {deleteMultiError && (
              <p className="text-sm text-red-600 font-medium mb-4">{deleteMultiError}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowDeleteMultiModal(false); setDeleteMultiError('') }}
                disabled={deletingMulti}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all duration-200 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleEliminarMultiple}
                disabled={deletingMulti}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50"
              >
                {deletingMulti ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de despacho individual con vísceras (solo reses) */}
      {visceraModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 max-h-[90vh] overflow-y-auto animate-scaleIn">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-base font-bold text-gray-900">
                Vísceras disponibles — Cliente {visceraModal.registro.codigo_cliente}
              </h3>
              <button
                onClick={() => setVisceraModal(null)}
                className="ml-3 p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Canal{' '}
              <span className="font-semibold text-gray-900">
                {visceraModal.registro.codigo_cliente}-{visceraModal.registro.numero_animal}
              </span>{' '}
              lista para despacho.
            </p>
            <RutaFields
              ruta={despRuta}
              onRuta={setDespRuta}
              otroCodigo={despOtroCodigo}
              onOtroCodigo={setDespOtroCodigo}
              codigoDestino={despCodigoDestino}
              onCodigoDestino={setDespCodigoDestino}
              fechaEntrega={mostrarFechaEntrega ? despFechaEntrega : undefined}
              onFechaEntrega={mostrarFechaEntrega ? setDespFechaEntrega : undefined}
              fechaEntregaPorDefecto={entregaPorDefecto(localToday())}
              tipoCarne="res"
            />
            {despRuta === RUTA_NACIONAL && (
              <DireccionNacionalField
                codigo={visceraModal.registro.codigo_cliente}
                guardadas={direccionesGuardadas[visceraModal.registro.codigo_cliente] ?? []}
                valor={despDireccionPorCodigo[visceraModal.registro.codigo_cliente] ?? ''}
                onValor={v => setDespDireccionPorCodigo(prev => ({ ...prev, [visceraModal.registro.codigo_cliente]: v }))}
                onCatalogoCambiado={() => setCatalogoVersion(v => v + 1)}
                /* Individual = una sola raya: no hay nada que repartir, va directo. */
              />
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={despDesposte}
                onChange={e => setDespDesposte(e.target.checked)}
                className="w-4 h-4 rounded accent-green-700 cursor-pointer"
              />
              ¿Es desposte?
            </label>
            {/* Media canal: si al animal ya le sacaron una mitad, no hay nada que elegir —
                sale la mitad que queda y se avisa en vez de mostrar la casilla. */}
            {fraccionRestante(visceraModal.registro) <= 0.5 ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                A este animal ya le despacharon una mitad: sale la <span className="font-semibold">media canal restante (0.5)</span>.
              </p>
            ) : (
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-4">
                <input
                  type="checkbox"
                  checked={despMediaCanal}
                  onChange={e => setDespMediaCanal(e.target.checked)}
                  className="w-4 h-4 rounded accent-green-700 cursor-pointer"
                />
                ¿Media canal? <span className="text-gray-500">(sale 0.5; la otra mitad queda en cava)</span>
              </label>
            )}
            {visceraModal.registro.tipo_carne === 'res' && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Cabeza</label>
                  <input type="number" min={0} value={despCabeza} onChange={e => setDespCabeza(e.target.value)} placeholder="0" className={despInputCls} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Patas</label>
                  <input type="number" min={0} value={despPatas} onChange={e => setDespPatas(e.target.value)} placeholder="0" className={despInputCls} />
                </div>
              </div>
            )}
            {visceraModal.visceras.length > 0 ? (
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vísceras disponibles</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setVisceraSelected(new Set(visceraModal.visceras.map(v => v.id)))}
                      className="text-xs font-semibold text-green-700 hover:text-green-900 bg-green-50 hover:bg-green-100 border border-green-200 rounded px-2 py-0.5 transition-colors"
                    >
                      Seleccionar todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisceraSelected(new Set())}
                      className="text-xs font-semibold text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded px-2 py-0.5 transition-colors"
                    >
                      Desmarcar todos
                    </button>
                  </div>
                </div>
                {campoDestinoVisceras(visceraSelected.size > 0)}
                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
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
                      <span className="flex items-center gap-2 text-sm text-gray-700">
                        <span>Animal {v.codigo_cliente}-{v.numero_animal}</span>
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${tipoBadge(v.tipo).cls}`}>
                          {tipoBadge(v.tipo).label}
                        </span>
                        <span className="text-gray-500">— Ingresó {formatVisceraDate(v.created_at)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-5">Este cliente no tiene vísceras disponibles en cava.</p>
            )}
            <div className="flex gap-3 justify-end flex-wrap">
              {visceraModal.visceras.length > 0 ? (
                <>
                  <button
                    onClick={handleDespacharCanalSolo}
                    disabled={visceraDispatching || !despRuta}
                    className="px-4 py-2 text-sm font-semibold text-gray-700 border border-gray-300 rounded-lg transition-all duration-200 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Despachar canal solamente
                  </button>
                  <button
                    onClick={handleDespacharCanalYVisceras}
                    disabled={visceraDispatching || !despRuta}
                    className="px-4 py-2 text-sm font-bold text-white bg-green-800 hover:bg-green-700 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50"
                  >
                    {visceraDispatching ? 'Despachando...' : 'Despachar selección'}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleDespacharCanalSolo}
                  disabled={visceraDispatching || !despRuta}
                  className="px-4 py-2 text-sm font-bold text-white bg-green-800 hover:bg-green-700 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50"
                >
                  {visceraDispatching ? 'Despachando...' : 'Despachar canal'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <section>
        <div className="flex items-start justify-between gap-4 mb-5">
          <h2 className="text-xl font-bold text-gray-900">Registrar animal</h2>
          {/* Carga masiva desde el PDF del ERP (VisualERP, solo bovinos). */}
          <div className="flex flex-col items-end gap-1.5">
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handlePdfElegido}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => pdfInputRef.current?.click()}
              disabled={pdfLeyendo}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 transition-all duration-200 active:scale-95 disabled:opacity-50 whitespace-nowrap shadow-sm"
            >
              <Upload size={14} />
              {pdfLeyendo ? 'Leyendo PDF...' : 'Cargar PDF sacrificio'}
            </button>
            {pdfError && (
              <p className="text-xs text-red-600 font-medium text-right max-w-xs">{pdfError}</p>
            )}
          </div>
        </div>

        {/* Subtabs */}
        <div className="flex w-fit border border-gray-200 rounded-xl overflow-hidden shadow-sm mb-3">
          {(['res', 'cerdo'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabChange(tab)}
              className={`px-8 py-2.5 text-sm font-semibold transition-all duration-200 ${
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

        {/* El despacho SÍ se guardó; lo que falló es la nota de adelanto en la observación.
            Va acá y no en el modal porque el modal ya se cerró al despachar. */}
        {adelantoError && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2">
            <p className="text-sm text-amber-800 flex-1">{adelantoError}</p>
            <button
              type="button"
              onClick={() => setAdelantoError('')}
              className="text-xs font-semibold text-amber-800 hover:text-amber-900 shrink-0"
            >
              Cerrar
            </button>
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
              className="bg-green-800 hover:bg-green-700 text-white rounded-lg px-7 py-2.5 text-sm font-bold tracking-wide transition-all duration-200 active:scale-95 disabled:opacity-50 shadow-sm"
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
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-all duration-200"
          >
            <ChevronDown
              size={16}
              className={`transition-transform duration-200 ${showBatch ? 'rotate-180' : ''}`}
            />
            Registrar varios a la vez
          </button>

          {showBatch && (
            <form
              ref={batchFormRef}
              onSubmit={handleBatchSubmit}
              className="mt-4 bg-gray-50 border border-gray-200 rounded-2xl p-6 grid grid-cols-1 sm:grid-cols-2 gap-5"
            >
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Código cliente</label>
                <input
                  type="text"
                  value={batchForm.codigo_cliente}
                  onChange={e => setBatchForm({ ...batchForm, codigo_cliente: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); batchInicialRef.current?.focus() }
                  }}
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
                  ref={batchInicialRef}
                  type="number"
                  min={1}
                  value={batchForm.numero_inicial}
                  onChange={e => setBatchForm({ ...batchForm, numero_inicial: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); batchFinalRef.current?.focus() }
                  }}
                  className={inputClass}
                  placeholder="ej: 121"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Número animal final</label>
                <input
                  ref={batchFinalRef}
                  type="number"
                  min={1}
                  value={batchForm.numero_final}
                  onChange={e => setBatchForm({ ...batchForm, numero_final: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); batchFormRef.current?.requestSubmit() }
                  }}
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
                  className="bg-green-800 hover:bg-green-700 text-white rounded-lg px-7 py-2.5 text-sm font-bold tracking-wide transition-all duration-200 active:scale-95 disabled:opacity-50 shadow-sm"
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
            className="text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 transition-all duration-200 whitespace-nowrap"
          >
            Exportar Excel
          </button>
        </div>

        {/* Barra de despacho múltiple */}
        {someSelected && (
          <div className="mb-4 flex items-center justify-between bg-gray-900 text-white rounded-xl px-4 py-3 gap-3 animate-slideDown">
            <span className="text-sm font-semibold">
              <span className="hidden sm:inline">{selected.size} {selected.size === 1 ? 'animal seleccionado' : 'animales seleccionados'}</span>
              <span className="sm:hidden">{selected.size} sel.</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setShowDeleteMultiModal(true); setDeleteMultiError('') }}
                className="text-sm font-bold text-red-400 hover:text-red-300 transition-all duration-200 whitespace-nowrap"
              >
                <span className="hidden sm:inline">Eliminar {selected.size} seleccionados</span>
                <span className="sm:hidden">Eliminar</span>
              </button>
              <button
                onClick={() => {
                  if (selected.size === 1) {
                    const id = Array.from(selected)[0]
                    const r = registros.find(reg => reg.id === id)
                    if (r) handleDespachar(r)
                  } else {
                    resetDespFields()
                    setShowModal(true)
                  }
                }}
                className="bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg px-3 sm:px-4 py-2 transition-all duration-200 active:scale-95 whitespace-nowrap"
              >
                <span className="hidden sm:inline">Despachar {selected.size} seleccionados</span>
                <span className="sm:hidden">Despachar</span>
              </button>
            </div>
          </div>
        )}

        <div className="w-full overflow-x-auto rounded-2xl shadow-sm border border-gray-200 bg-white">
          <table className="min-w-[880px] w-full text-sm">
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
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Municipio</th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Tipo de carne</th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Fecha de sacrificio</th>
                <th className="text-left px-4 py-3 font-semibold text-white text-xs uppercase tracking-wider">Días en cava</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRegistros.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">
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
                              onBlur={e => lookupClienteEnEdicion(e.target.value)}
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
                        <CeldasCliente codigo={editForm.codigo_cliente} info={clientesMap[editForm.codigo_cliente]} onEditar={setModalCodigo} />
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all duration-200 ${
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
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                            diasEdit >= 3 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          } ${diasEdit >= 5 ? 'animate-pulse' : ''}`}>
                            {diasEdit} {diasEdit === 1 ? 'día' : 'días'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleSaveEdit(r)}
                                disabled={editSaving}
                                className="text-xs font-semibold text-white bg-green-800 hover:bg-green-700 rounded-lg px-3 py-1.5 transition-all duration-200 active:scale-95 disabled:opacity-50"
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
                      className={`transition-colors duration-150 hover:bg-blue-50 ${
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
                      <CeldasCliente codigo={r.codigo_cliente} info={clientesMap[r.codigo_cliente]} onEditar={setModalCodigo} />
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            r.tipo_carne === 'res' ? 'bg-amber-100 text-amber-700' : 'bg-pink-100 text-pink-700'
                          }`}>
                            {r.tipo_carne === 'res' ? 'Res' : 'Cerdo'}
                          </span>
                          {/* Al animal le sacaron una mitad: queda 0.5 en cava para despachar aparte. */}
                          {fraccionRestante(r) <= 0.5 && (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 whitespace-nowrap">
                              Media canal (0.5)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.fecha_beneficio}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                          dias >= 3 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        } ${dias >= 5 ? 'animate-pulse' : ''}`}>
                          {dias} {dias === 1 ? 'día' : 'días'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center justify-end gap-2">
                            {deleteConfirm === r.id ? (
                              <>
                                <span className="text-xs text-gray-500">¿Eliminar?</span>
                                <button
                                  onClick={() => handleEliminarRegistro(r)}
                                  className="text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg px-2.5 py-1.5 transition-all duration-200 active:scale-95"
                                >
                                  Sí
                                </button>
                                <button
                                  onClick={() => { setDeleteConfirm(null); setDeleteError('') }}
                                  className="text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg px-2.5 py-1.5 transition-all duration-200"
                                >
                                  No
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => { setDeleteConfirm(r.id); setDeleteError('') }}
                                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
                                  title="Eliminar"
                                >
                                  <Trash2 size={13} />
                                </button>
                                <button
                                  onClick={() => startEdit(r)}
                                  className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-all duration-200 hover:scale-105 active:scale-95"
                                  title="Editar"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={() => handleDespachar(r)}
                                  className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2 sm:px-3 py-1.5 transition-all duration-200 hover:scale-105 active:scale-95"
                                >
                                  <Truck size={12} />
                                  <span className="hidden sm:inline">Despachar</span>
                                </button>
                              </>
                            )}
                          </div>
                          {deleteConfirm === r.id && deleteError && (
                            <span className="text-xs text-red-600 text-right">{deleteError}</span>
                          )}
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

      {modalCodigo !== null && (
        <ClienteModal
          key={modalCodigo}
          codigo={modalCodigo}
          info={clientesMap[modalCodigo]}
          onClose={() => setModalCodigo(null)}
          onSaved={(cod, nuevo) => setClientesMap(prev => ({ ...prev, [cod]: nuevo }))}
        />
      )}

      {pdfPreview && (
        <ImportarSacrificioModal
          parse={pdfPreview.parse}
          clasificadas={pdfPreview.clasificadas}
          confirmando={pdfConfirmando}
          error={pdfInsertError}
          onCancelar={() => { setPdfPreview(null); setPdfInsertError('') }}
          onConfirmar={handleConfirmarPdf}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-gray-900 text-white text-sm font-semibold rounded-xl shadow-xl px-4 py-3 animate-slideDown">
          {toast}
        </div>
      )}
    </div>
  )
}
