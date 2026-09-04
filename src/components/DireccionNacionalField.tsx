import { useState } from 'react'
import { Settings } from 'lucide-react'
import GestionarDireccionesModal from './GestionarDireccionesModal'
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
  /**
   * Se llama cuando Rafa corrigió o borró una dirección del catálogo. El padre
   * es quien tiene `guardadas` en estado, así que es quien debe volver a
   * consultarlo; sin esto el selector seguiría mostrando lo viejo.
   * Sin este prop no se ofrece el botón de gestión (no habría cómo refrescar).
   */
  onCatalogoCambiado?: () => void
}

const OTRA = '__OTRA__'

export default function DireccionNacionalField({
  codigo,
  guardadas,
  valor,
  onValor,
  mostrarCodigo,
  onCatalogoCambiado,
}: Props) {
  const inputCls =
    'w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700 transition-colors'

  // Elegir "Otra" limpia `valor` para escribir, y con valor='' el desplegable no puede
  // distinguir "nada elegido" de "eligió Otra": ambos casos dejan valor=''. Por eso el modo
  // se guarda aparte, no se deriva de valor.
  const [modoOtro, setModoOtro] = useState(false)
  const [gestionando, setGestionando] = useState(false)

  /**
   * Si lo que Rafa acaba de corregir o borrar era JUSTO lo que tenía elegido,
   * el campo sigue el cambio: con la corrección se queda con el texto nuevo, y
   * con el borrado se vacía (elegir algo que ya no está en el catálogo dejaría
   * el despacho con una dirección fantasma).
   */
  function seguirCambioDelCatalogo(vieja: string, nueva: string | null) {
    if (valor !== vieja) return
    if (nueva === null) {
      setModoOtro(false)
      onValor('')
    } else {
      onValor(nueva)
    }
  }

  // Si lo escrito no coincide con ninguna guardada, el desplegable queda en "Otra".
  const coincide = guardadas.some(d => d.direccion === valor)
  const seleccion = modoOtro ? OTRA : valor === '' ? '' : coincide ? valor : OTRA

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

      <div className="flex items-center gap-2 mb-2">
        <select
          value={seleccion}
          onChange={e => {
            const v = e.target.value
            if (v === OTRA) {
              // "Otra" limpia el campo para escribir.
              setModoOtro(true)
              onValor('')
            } else {
              setModoOtro(false)
              onValor(v)
            }
          }}
          className={`${inputCls} bg-white`}
        >
          <option value="">
            {guardadas.length > 0 ? 'Selecciona dirección...' : 'Sin direcciones guardadas'}
          </option>
          {guardadas.map(d => (
            <option key={d.id} value={d.direccion}>{d.direccion}</option>
          ))}
          <option value={OTRA}>Otra (escribir)</option>
        </select>
        {onCatalogoCambiado && guardadas.length > 0 && (
          <button
            type="button"
            onClick={() => setGestionando(true)}
            title="Gestionar direcciones"
            aria-label={`Gestionar direcciones del código ${codigo}`}
            className="shrink-0 p-2 text-gray-500 hover:text-green-700 border-2 border-gray-200 hover:border-green-700 rounded-lg transition-colors"
          >
            <Settings size={16} />
          </button>
        )}
      </div>

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

      {gestionando && onCatalogoCambiado && (
        <GestionarDireccionesModal
          codigo={codigo}
          guardadas={guardadas}
          onCerrar={() => setGestionando(false)}
          onCambio={onCatalogoCambiado}
          onDireccionCorregida={seguirCambioDelCatalogo}
        />
      )}
    </div>
  )
}
