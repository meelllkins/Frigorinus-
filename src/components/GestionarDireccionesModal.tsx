import { useState } from 'react'
import { Pencil, Trash2, X } from 'lucide-react'
import {
  borrarDireccion,
  contarDespachosConDireccion,
  editarDireccion,
  type DireccionNacional,
} from '../lib/direccionesNacional'

/**
 * Gestión del catálogo de direcciones NACIONAL de UN código: corregir el texto
 * de una dirección mal escrita, o sacarla del catálogo.
 *
 * Las dos operaciones no son simétricas y por eso cada una confirma distinto:
 *   · Editar propaga al histórico (ver la RPC editar_direccion_nacional), así
 *     que primero se cuentan los despachos afectados y se le dicen a Rafa.
 *   · Borrar NO toca despachos: los que ya la usaron siguen mostrándola.
 *
 * No recarga nada por su cuenta: avisa con onCambio() y el padre revuelve a
 * consultar el catálogo, que es quien lo tiene en estado.
 */
interface Props {
  codigo: string
  guardadas: DireccionNacional[]
  onCerrar: () => void
  onCambio: () => void
  /**
   * La dirección que quedó corregida o borrada, para que el padre ajuste lo
   * elegido en el selector si era justo esa.
   */
  onDireccionCorregida: (vieja: string, nueva: string | null) => void
}

export default function GestionarDireccionesModal({
  codigo,
  guardadas,
  onCerrar,
  onCambio,
  onDireccionCorregida,
}: Props) {
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [textoEditado, setTextoEditado] = useState('')
  // Paso de confirmación de la edición: guarda el conteo ya consultado, para no
  // volver a pedirlo al confirmar.
  const [confirmEdit, setConfirmEdit] = useState<
    { vieja: string; nueva: string; despachos: number } | null
  >(null)
  const [confirmBorrar, setConfirmBorrar] = useState<DireccionNacional | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')

  const inputCls =
    'w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors'

  function empezarEdicion(d: DireccionNacional) {
    setError('')
    setEditandoId(d.id)
    setTextoEditado(d.direccion)
  }

  function cancelarEdicion() {
    setEditandoId(null)
    setTextoEditado('')
    setError('')
  }

  /** Paso 1 de la edición: contar los despachos que se van a reescribir. */
  async function pedirConfirmacion(d: DireccionNacional) {
    const nueva = textoEditado.trim()
    setError('')
    if (nueva === '') {
      setError('La dirección no puede quedar vacía.')
      return
    }
    if (nueva === d.direccion) {
      cancelarEdicion()
      return
    }
    setProcesando(true)
    const despachos = await contarDespachosConDireccion(codigo, d.direccion)
    setProcesando(false)
    setConfirmEdit({ vieja: d.direccion, nueva, despachos })
  }

  /** Paso 2: ya confirmado, se corrige catálogo + histórico en una transacción. */
  async function confirmarEdicion() {
    if (!confirmEdit) return
    setProcesando(true)
    const res = await editarDireccion(codigo, confirmEdit.vieja, confirmEdit.nueva)
    setProcesando(false)
    if (!res.ok) {
      setError(res.mensaje)
      setConfirmEdit(null)
      return
    }
    onDireccionCorregida(confirmEdit.vieja, confirmEdit.nueva)
    setConfirmEdit(null)
    cancelarEdicion()
    onCambio()
  }

  async function confirmarBorrado() {
    if (!confirmBorrar) return
    setProcesando(true)
    const res = await borrarDireccion(codigo, confirmBorrar.direccion)
    setProcesando(false)
    if (!res.ok) {
      setError(res.mensaje)
      setConfirmBorrar(null)
      return
    }
    onDireccionCorregida(confirmBorrar.direccion, null)
    setConfirmBorrar(null)
    onCambio()
  }

  return (
    // z-[60]: este modal se abre DESDE el modal de despacho (z-50) y tiene que
    // quedar encima, no debajo.
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto animate-scaleIn">
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-base font-bold text-gray-900">Direcciones guardadas</h3>
          <button
            type="button"
            onClick={onCerrar}
            className="text-gray-400 hover:text-gray-700 transition-colors"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide font-mono mb-4">
          Código {codigo}
        </p>

        {error && <p className="text-sm text-red-600 font-medium mb-3">{error}</p>}

        {guardadas.length === 0 ? (
          <p className="text-sm text-gray-500 mb-5">Este código todavía no tiene direcciones guardadas.</p>
        ) : (
          <div className="space-y-2 mb-5 max-h-[50vh] overflow-y-auto pr-1">
            {guardadas.map(d => (
              <div key={d.id} className="border border-gray-200 rounded-lg px-3 py-2">
                {editandoId === d.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={textoEditado}
                      onChange={e => setTextoEditado(e.target.value)}
                      autoFocus
                      className={inputCls}
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={cancelarEdicion}
                        disabled={procesando}
                        className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all duration-200 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => pedirConfirmacion(d)}
                        disabled={procesando}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-green-800 hover:bg-green-700 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50"
                      >
                        {procesando ? 'Revisando...' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-gray-700 break-words min-w-0">{d.direccion}</span>
                    <button
                      type="button"
                      onClick={() => empezarEdicion(d)}
                      className="text-gray-400 hover:text-green-700 transition-colors shrink-0"
                      aria-label={`Editar ${d.direccion}`}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setError(''); setConfirmBorrar(d) }}
                      className="text-gray-400 hover:text-red-600 transition-colors shrink-0"
                      aria-label={`Borrar ${d.direccion}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCerrar}
            className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all duration-200"
          >
            Cerrar
          </button>
        </div>
      </div>

      {/* Confirmación de la corrección: dice cuántos despachos se reescriben. */}
      {confirmEdit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 animate-scaleIn">
            <h3 className="text-base font-bold text-gray-900 mb-3">Confirmar corrección</h3>
            <p className="text-sm text-gray-600 mb-5">
              Vas a corregir "<span className="font-semibold text-gray-900">{confirmEdit.vieja}</span>" a "
              <span className="font-semibold text-gray-900">{confirmEdit.nueva}</span>".
              <br />
              Esto también actualizará{' '}
              <span className="font-semibold text-gray-900">{confirmEdit.despachos}</span> despachos históricos
              que usan "<span className="font-semibold text-gray-900">{confirmEdit.vieja}</span>".
              <br />
              ¿Confirmar?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmEdit(null)}
                disabled={procesando}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all duration-200 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEdicion}
                disabled={procesando}
                className="px-4 py-2 text-sm font-bold text-white bg-green-800 hover:bg-green-700 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50"
              >
                {procesando ? 'Corrigiendo...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmación del borrado: deja claro que el histórico NO se toca. */}
      {confirmBorrar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 animate-scaleIn">
            <h3 className="text-base font-bold text-gray-900 mb-3">
              ¿Borrar "{confirmBorrar.direccion}" del catálogo?
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              Los despachos que ya la usaron NO se verán afectados (siguen mostrando "
              <span className="font-semibold text-gray-900">{confirmBorrar.direccion}</span>"). Solo dejará de
              aparecer para futuros despachos.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmBorrar(null)}
                disabled={procesando}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all duration-200 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarBorrado}
                disabled={procesando}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50"
              >
                {procesando ? 'Borrando...' : 'Borrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
