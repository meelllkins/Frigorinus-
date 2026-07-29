import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { fetchMunicipios, updateClienteMunicipio, crearCliente, type ClienteInfo } from '../lib/clientes'

const OTRO = '__OTRO__'

interface Props {
  codigo: string
  /** Definido = editar (solo ruta). Undefined = crear (nombre + ruta). */
  info?: ClienteInfo
  onClose: () => void
  onSaved: (codigo: string, info: ClienteInfo) => void
}

export default function ClienteModal({ codigo, info, onClose, onSaved }: Props) {
  const esEdicion = !!info
  const [municipios, setMunicipios] = useState<string[]>([])
  const [nombre, setNombre] = useState(info?.cliente ?? '')
  const [rutaSel, setRutaSel] = useState(info?.municipio ?? '')
  const [rutaOtro, setRutaOtro] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchMunicipios().then(setMunicipios)
  }, [])

  // Aseguramos que la ruta actual (en edición) sea siempre una opción, aunque la
  // lista distinct aún no haya cargado o difiera por espacios/casing.
  const opciones =
    info?.municipio && !municipios.includes(info.municipio)
      ? [info.municipio, ...municipios]
      : municipios

  const rutaFinal = (rutaSel === OTRO ? rutaOtro : rutaSel).trim()

  async function handleGuardar() {
    setError('')
    if (!esEdicion && !nombre.trim()) {
      setError('Ingresa el nombre del cliente.')
      return
    }
    if (!rutaFinal) {
      setError('Selecciona o escribe un municipio.')
      return
    }

    setSaving(true)
    if (esEdicion && info) {
      const res = await updateClienteMunicipio(info.id, rutaFinal)
      if (res.error) {
        setError('No se pudo guardar. Intenta de nuevo.')
        setSaving(false)
        return
      }
      onSaved(codigo, { ...info, municipio: rutaFinal })
    } else {
      const res = await crearCliente(codigo, nombre.trim(), rutaFinal)
      if (res.error || !res.id) {
        setError('No se pudo crear. Intenta de nuevo.')
        setSaving(false)
        return
      }
      onSaved(codigo, { id: res.id, cliente: nombre.trim(), municipio: rutaFinal })
    }
    setSaving(false)
    onClose()
  }

  const inputCls =
    'w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors'

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-base font-bold text-gray-900">
            {esEdicion ? 'Corregir municipio' : 'Crear cliente'}
            <span className="text-gray-400 font-normal"> · Código {codigo}</span>
          </h3>
          <button
            onClick={onClose}
            className="ml-3 p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nombre: editable solo al crear; en edición va de solo lectura (pendiente con Rafa) */}
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nombre del cliente</label>
        {esEdicion ? (
          <p className="text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-4">
            {info?.cliente || '—'}
          </p>
        ) : (
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Nombre del cliente..."
            className={`${inputCls} mb-4`}
            autoFocus
          />
        )}

        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Municipio</label>
        <select
          value={rutaSel}
          onChange={e => setRutaSel(e.target.value)}
          className={`${inputCls} bg-white`}
        >
          <option value="">Selecciona...</option>
          {opciones.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
          <option value={OTRO}>Otro (escribir)</option>
        </select>
        {rutaSel === OTRO && (
          <input
            type="text"
            value={rutaOtro}
            onChange={e => setRutaOtro(e.target.value)}
            placeholder="Nuevo municipio..."
            className={`${inputCls} mt-2`}
            autoFocus
          />
        )}

        {error && <p className="text-sm text-red-600 font-medium mt-3">{error}</p>}

        <div className="flex gap-3 justify-end mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleGuardar}
            disabled={saving}
            className="px-4 py-2 text-sm font-bold text-white bg-green-800 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
