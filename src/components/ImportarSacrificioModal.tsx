import { AlertTriangle, X } from 'lucide-react'
import type { FilasClasificadas, ParseSacrificio } from '../lib/sacrificioPdf'

interface Props {
  parse: ParseSacrificio
  clasificadas: FilasClasificadas
  confirmando: boolean
  /** Error de la inserción; el modal queda abierto para poder reintentar. */
  error: string
  onCancelar: () => void
  onConfirmar: () => void
}

/**
 * Preview de la carga masiva desde el PDF de sacrificio. No persiste nada por su cuenta:
 * solo muestra lo que se parseó y delega en `onConfirmar`. Cancelar cierra sin escribir.
 */
export default function ImportarSacrificioModal({
  parse,
  clasificadas,
  confirmando,
  error,
  onCancelar,
  onConfirmar,
}: Props) {
  const { nuevas, duplicadas, todas } = clasificadas
  const advertencias = parse.advertencias

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] flex flex-col animate-scaleIn">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900">Cargar PDF de sacrificio</h3>
          <button
            onClick={onCancelar}
            disabled={confirmando}
            className="ml-3 p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-sm">
          <dt className="text-gray-500">Fecha de sacrificio</dt>
          <dd className="font-semibold text-gray-900 text-right font-mono">{parse.fechaTexto}</dd>
          <dt className="text-gray-500">Filas leídas del PDF</dt>
          <dd className="font-semibold text-gray-900 text-right">{parse.filas.length}</dd>
        </dl>

        <div className="flex gap-2 mb-4">
          <div className="flex-1 rounded-xl border border-green-200 bg-green-50 px-3 py-2">
            <p className="text-xl font-bold text-green-800 leading-none">{nuevas.length}</p>
            <p className="text-xs font-semibold text-green-700 mt-1">
              {nuevas.length === 1 ? 'nuevo' : 'nuevos'}
            </p>
          </div>
          <div className="flex-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xl font-bold text-amber-800 leading-none">{duplicadas.length}</p>
            <p className="text-xs font-semibold text-amber-700 mt-1">
              {duplicadas.length === 1 ? 'duplicado' : 'duplicados'}
            </p>
          </div>
        </div>

        {advertencias.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 space-y-1">
            {advertencias.map(a => (
              <p key={a} className="flex gap-2 text-xs text-amber-800 font-medium">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{a}</span>
              </p>
            ))}
          </div>
        )}

        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Animales del PDF
        </p>
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100">
          {todas.map((f, i) => (
            <div
              key={`${f.codigoAlterno}-${i}`}
              className={`flex items-center justify-between px-3 py-1.5 text-sm ${
                f.duplicada ? 'bg-amber-50' : i % 2 === 1 ? 'bg-gray-50' : 'bg-white'
              }`}
            >
              <span className="font-mono font-semibold text-gray-900">
                {f.codigo_cliente}-{f.numero_animal}
              </span>
              {f.duplicada ? (
                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                  Ya registrado
                </span>
              ) : (
                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                  Nuevo
                </span>
              )}
            </div>
          ))}
        </div>

        {error && <p className="mt-3 text-sm text-red-600 font-medium">{error}</p>}

        <div className="flex gap-3 justify-end mt-4">
          <button
            onClick={onCancelar}
            disabled={confirmando}
            className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all duration-200 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={confirmando}
            className="px-4 py-2 text-sm font-bold text-white bg-green-800 hover:bg-green-700 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-50"
          >
            {/* Con 0 nuevos sigue habilitado a propósito: confirmar un PDF ya cargado no
                inserta nada y el toast lo dice, que es el resultado esperado. */}
            {confirmando
              ? 'Cargando...'
              : nuevas.length === 0
                ? 'Confirmar'
                : `Confirmar ${nuevas.length}`}
          </button>
        </div>
      </div>
    </div>
  )
}
