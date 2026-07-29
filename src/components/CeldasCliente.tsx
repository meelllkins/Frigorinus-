import type { ClienteInfo } from '../lib/clientes'

/**
 * Dos celdas de tabla: Cliente + Ruta (municipio).
 * - Si no hay match (código sin fila ACTIVA, ej. TESTQA), fallback en gris.
 * - El texto es clickeable (sin íconos ni columnas nuevas): abre el modal de
 *   editar/crear cliente para ese código.
 */
export default function CeldasCliente({
  codigo,
  info,
  onEditar,
}: {
  codigo: string
  info?: ClienteInfo
  onEditar: (codigo: string) => void
}) {
  const btnCls =
    'text-left hover:underline decoration-dotted underline-offset-2 cursor-pointer'
  return (
    <>
      <td className="px-4 py-3 text-gray-700">
        <button type="button" onClick={() => onEditar(codigo)} className={btnCls} title="Editar / crear cliente">
          {info?.cliente || <span className="text-gray-400">Cliente no encontrado</span>}
        </button>
      </td>
      <td className="px-4 py-3 text-gray-700">
        <button type="button" onClick={() => onEditar(codigo)} className={btnCls} title="Editar municipio">
          {info?.municipio || <span className="text-gray-400">—</span>}
        </button>
      </td>
    </>
  )
}
