import { useState } from 'react'
import { X } from 'lucide-react'
import { updateClienteMunicipio, updateClienteNombre, updateClienteCampos, crearCliente, type ClienteInfo } from '../lib/clientes'
import { RUTAS } from '../lib/rutas'

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
  const [nombre, setNombre] = useState(info?.cliente ?? '')
  const [rutaSel, setRutaSel] = useState(info?.municipio ?? '')
  const [rutaOtro, setRutaOtro] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Opciones fijas desde la constante RUTAS. Incluimos el municipio actual si no
  // estuviera en la lista, para que quede preseleccionado en modo editar.
  const opciones: string[] =
    info?.municipio && !(RUTAS as readonly string[]).includes(info.municipio)
      ? [info.municipio, ...RUTAS]
      : [...RUTAS]

  const rutaFinal = (rutaSel === OTRO ? rutaOtro : rutaSel).trim()

  async function handleGuardar() {
    setError('')
    if (!nombre.trim()) {
      setError('Ingresa el nombre del cliente.')
      return
    }
    if (!rutaFinal) {
      setError('Selecciona o escribe un municipio.')
      return
    }

    setSaving(true)
    if (esEdicion && info) {
      const nuevoNombre = nombre.trim()
      const nombreCambio = nuevoNombre !== info.cliente
      const municipioCambio = rutaFinal !== info.municipio
      let res: { error: string | null } = { error: null }
      if (nombreCambio && municipioCambio) {
        // Ambos cambiaron: un solo UPDATE con { municipio, cliente }.
        res = await updateClienteCampos(info.id, { municipio: rutaFinal, cliente: nuevoNombre })
      } else if (municipioCambio) {
        res = await updateClienteMunicipio(info.id, rutaFinal)
      } else if (nombreCambio) {
        res = await updateClienteNombre(info.id, nuevoNombre)
      }
      if (res.error) {
        setError('No se pudo guardar. Intenta de nuevo.')
        setSaving(false)
        return
      }
      onSaved(codigo, { ...info, cliente: nuevoNombre, municipio: rutaFinal })
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

        {/* Nombre: editable tanto al crear como al editar. */}
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nombre del cliente</label>
        <input
          type="text"
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          placeholder="Nombre del cliente..."
          className={`${inputCls} mb-4`}
        />

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
