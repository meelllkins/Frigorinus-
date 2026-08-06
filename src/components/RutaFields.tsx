import { RUTAS } from '../lib/rutas'

/**
 * Campos comunes de despacho: Ruta (obligatoria) + casilla "¿Es para otro
 * código?" que revela el campo de código destino. El estado lo maneja el padre.
 * Cabeza/Patas NO van aquí (son solo del canal de res, en Beneficios).
 *
 * La FECHA DE ENTREGA es opcional: solo se dibuja si el padre pasa el par
 * fechaEntrega/onFechaEntrega. Quién lo pasa y cuándo:
 *   · Beneficios (donde salen las canales, que es lo que arma el documento de ruta) lo pasa
 *     SOLO en el tramo desde el que se adelanta un festivo — ver enTramoPrevioAFestivo()
 *     en lib/festivos.ts. El resto del año manda undefined y el campo no aparece.
 *   · Inventario nunca lo pasa; sus vísceras salen con la entrega por defecto de siempre.
 */
interface Props {
  ruta: string
  onRuta: (r: string) => void
  otroCodigo: boolean
  onOtroCodigo: (b: boolean) => void
  codigoDestino: string
  onCodigoDestino: (s: string) => void
  fechaEntrega?: string
  onFechaEntrega?: (f: string) => void
  /** Fecha de entrega normal, para poder avisar cuándo se está eligiendo otra. */
  fechaEntregaPorDefecto?: string
}

export default function RutaFields({
  ruta,
  onRuta,
  otroCodigo,
  onOtroCodigo,
  codigoDestino,
  onCodigoDestino,
  fechaEntrega,
  onFechaEntrega,
  fechaEntregaPorDefecto,
}: Props) {
  const inputCls =
    'w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors'
  const conFecha = fechaEntrega != null && onFechaEntrega != null
  const fechaCambiada = conFecha && fechaEntregaPorDefecto != null && fechaEntrega !== fechaEntregaPorDefecto
  // `?? ''` y `?.` en vez de apoyarse en el estrechamiento de `conFecha`: TypeScript no lo
  // arrastra dentro del callback de onChange, y así el control no depende de eso.
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

      {/* Fecha de entrega: viene con la de siempre puesta, así que no hay que tocarla en el
          día normal. Se cambia cuando en una jornada hay que dejar listo también lo del día
          siguiente (víspera de festivo): eso saca un documento de ruta aparte. */}
      {conFecha && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Fecha de entrega</label>
          <input
            type="date"
            value={fechaEntrega ?? ''}
            onChange={e => onFechaEntrega?.(e.target.value)}
            className={`${inputCls} bg-white`}
          />
          {fechaCambiada && (
            <p className="mt-1 text-xs text-amber-700">
              Sale en un documento de ruta aparte, separado del de la entrega normal.
            </p>
          )}
        </div>
      )}

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
