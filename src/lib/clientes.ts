import { supabase } from './supabase'

export interface ClienteInfo {
  cliente: string
  municipio: string
}

/**
 * Trae en UNA sola consulta los clientes ACTIVOS para los códigos dados y
 * arma un mapa codigo -> { cliente, municipio }.
 *
 * - Solo filas con estado='ACTIVO' (las 'INACTIVO' son códigos reasignados).
 * - Si un código tuviera 2 filas activas a la vez (caso raro conocido), se
 *   queda la primera que llega (no se sobreescribe).
 * - Los códigos sin fila activa simplemente no aparecen en el mapa; la UI
 *   decide el fallback ("Cliente no encontrado" / "—").
 */
export async function fetchClientesMap(
  codigos: (string | null | undefined)[]
): Promise<Record<string, ClienteInfo>> {
  const unicos = [...new Set(codigos.filter((c): c is string => !!c))]
  if (unicos.length === 0) return {}

  const { data, error } = await supabase
    .from('clientes')
    .select('codigo, cliente, municipio')
    .in('codigo', unicos)
    .eq('estado', 'ACTIVO')

  if (error) {
    // Sin esto, un fallo de red devuelve mapa vacío y TODAS las filas mostrarían
    // "Cliente no encontrado" (indistinguible de un no-match real). El log deja rastro.
    console.error('[fetchClientesMap] Error consultando clientes:', error)
    return {}
  }

  const mapa: Record<string, ClienteInfo> = {}
  for (const row of data ?? []) {
    if (row.codigo != null && !(row.codigo in mapa)) {
      mapa[row.codigo] = { cliente: row.cliente ?? '', municipio: row.municipio ?? '' }
    }
  }
  return mapa
}
