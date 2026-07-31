import type { DireccionNacional } from '../lib/direccionesNacional'

/**
 * Selector de dirección para despachos NACIONALES. Solo se muestra cuando la ruta
 * elegida es 'Nacional' — el que lo usa decide eso, este componente solo pinta.
 *
 * Rafa elige una dirección ya guardada de ese código, o escribe una nueva; la nueva
 * queda en el catálogo al despachar, así no la vuelve a escribir la próxima vez.
 * El estado lo maneja el padre (mismo criterio que RutaFields).
 */
interface Props {
  codigo: string
  guardadas: DireccionNacional[]
  valor: string
  onValor: (v: string) => void
  /** Muestra el código arriba: útil en el despacho múltiple, con varios códigos. */
  mostrarCodigo?: boolean
}

const OTRA = '__OTRA__'

export default function DireccionNacionalField({ codigo, guardadas, valor, onValor, mostrarCodigo }: Props) {
  const inputCls =
    'w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors'

  // Si lo escrito no coincide con ninguna guardada, el desplegable queda en "Otra".
  const coincide = guardadas.some(d => d.direccion === valor)
  const seleccion = valor === '' ? '' : coincide ? valor : OTRA

  return (
    <div className="mb-3">
      {mostrarCodigo && (
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 font-mono">
          {codigo} — Dirección
        </p>
      )}
      {!mostrarCodigo && (
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Dirección de entrega</label>
      )}

      <select
        value={seleccion}
        onChange={e => {
          const v = e.target.value
          // "Otra" limpia el campo para escribir; si no, se toma la guardada tal cual.
          onValor(v === OTRA ? '' : v)
        }}
        className={`${inputCls} bg-white mb-2`}
      >
        <option value="">
          {guardadas.length > 0 ? 'Selecciona dirección...' : 'Sin direcciones guardadas'}
        </option>
        {guardadas.map(d => (
          <option key={d.id} value={d.direccion}>{d.direccion}</option>
        ))}
        <option value={OTRA}>Otra (escribir)</option>
      </select>

      {/* Se escribe cuando eligió "Otra" o cuando el código todavía no tiene ninguna. */}
      {(seleccion === OTRA || (seleccion === '' && guardadas.length === 0)) && (
        <input
          type="text"
          value={valor}
          onChange={e => onValor(e.target.value)}
          placeholder="Escribe la dirección..."
          className={inputCls}
        />
      )}

      {valor.trim() !== '' && !coincide && (
        <p className="text-xs text-gray-500 mt-1">Se guardará para la próxima vez.</p>
      )}
    </div>
  )
}
