import type { ClienteInfo } from '../lib/clientes'

/**
 * Dos celdas de tabla: Cliente + Ruta (municipio).
 * Si no hay match en el mapa de clientes (código sin fila ACTIVA, ej. TESTQA),
 * muestra un fallback en gris sin romper el layout.
 */
export default function CeldasCliente({ info }: { info?: ClienteInfo }) {
  return (
    <>
      <td className="px-4 py-3 text-gray-700">
        {info?.cliente || <span className="text-gray-400">Cliente no encontrado</span>}
      </td>
      <td className="px-4 py-3 text-gray-700">
        {info?.municipio || <span className="text-gray-400">—</span>}
      </td>
    </>
  )
}
