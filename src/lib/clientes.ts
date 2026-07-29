import { supabase } from './supabase'

export interface ClienteInfo {
  id: string
  cliente: string
  municipio: string
}

/**
 * Trae en UNA sola consulta los clientes ACTIVOS para los códigos dados y
 * arma un mapa codigo -> { id, cliente, municipio }.
 * - Solo filas con estado='ACTIVO' (las 'INACTIVO' son códigos reasignados).
 * - Si un código tuviera 2 filas activas a la vez (caso raro), se queda la primera.
 * - Trae el `id` de la fila para poder corregirla luego POR ID (nunca por codigo,
 *   porque puede haber 2 activas del mismo código y no queremos tocar las dos).
 */
export async function fetchClientesMap(
  codigos: (string | null | undefined)[]
): Promise<Record<string, ClienteInfo>> {
  const unicos = [...new Set(codigos.filter((c): c is string => !!c))]
  if (unicos.length === 0) return {}

  const { data, error } = await supabase
    .from('clientes')
    .select('id, codigo, cliente, municipio')
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
      mapa[row.codigo] = { id: row.id, cliente: row.cliente ?? '', municipio: row.municipio ?? '' }
    }
  }
  return mapa
}

/**
 * Municipios existentes en `clientes` (distinct, sin nulos/vacíos, alfabético).
 * Alimenta el desplegable de Ruta del modal.
 */
export async function fetchMunicipios(): Promise<string[]> {
  const { data, error } = await supabase
    .from('clientes')
    .select('municipio')
    .not('municipio', 'is', null)

  if (error) {
    console.error('[fetchMunicipios] Error consultando municipios:', error)
    return []
  }

  const set = new Set<string>()
  for (const row of data ?? []) {
    const m = (row.municipio ?? '').trim()
    if (m) set.add(m)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'))
}

/**
 * Corrige la ruta (municipio) de UNA fila específica por su id.
 * Nunca por codigo: puede haber (raramente) 2 filas activas del mismo código.
 */
export async function updateClienteMunicipio(
  id: string,
  municipio: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('clientes')
    .update({ municipio })
    .eq('id', id)

  if (error) {
    console.error('[updateClienteMunicipio] Error actualizando cliente:', error)
    return { error: error.message }
  }
  return { error: null }
}

/**
 * Crea una fila nueva en `clientes` para un código sin registro.
 * Solo nombre + ruta; el resto de columnas quedan en su default/null.
 */
export async function crearCliente(
  codigo: string,
  cliente: string,
  municipio: string
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('clientes')
    .insert({ codigo, cliente, municipio, estado: 'ACTIVO' })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[crearCliente] Error creando cliente:', error)
    return { id: null, error: error?.message ?? 'Error desconocido' }
  }
  return { id: data.id, error: null }
}
