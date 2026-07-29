import { RUTAS } from '../lib/rutas'

/**
 * Campos comunes de despacho: Ruta (obligatoria) + casilla "¿Es para otro
 * código?" que revela el campo de código destino. El estado lo maneja el padre.
 * Cabeza/Patas NO van aquí (son solo del canal de res, en Beneficios).
 */
interface Props {
  ruta: string
  onRuta: (r: string) => void
  otroCodigo: boolean
  onOtroCodigo: (b: boolean) => void
  codigoDestino: string
  onCodigoDestino: (s: string) => void
}

export default function RutaFields({
  ruta,
  onRuta,
  otroCodigo,
  onOtroCodigo,
  codigoDestino,
  onCodigoDestino,
}: Props) {
  const inputCls =
    'w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors'
  return (
    <div className="space-y-3 mb-4">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          Ruta <span className="text-red-500">*</span>
        </label>
        <select value={ruta} onChange={e => onRuta(e.target.value)} className={`${inputCls} bg-white`}>
          <option value="">Selecciona ruta...</option>
          {RUTAS.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={otroCodigo}
          onChange={e => onOtroCodigo(e.target.checked)}
          className="w-4 h-4 rounded accent-green-700 cursor-pointer"
        />
        ¿Es para otro código?
      </label>
      {otroCodigo && (
        <input
          type="text"
          value={codigoDestino}
          onChange={e => onCodigoDestino(e.target.value)}
          placeholder="Código destino..."
          className={inputCls}
        />
      )}
    </div>
  )
}
