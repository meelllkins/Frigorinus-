import { supabase } from './supabase'

// ════════════════════════════════════════════════════════════════
// Direcciones de despacho NACIONAL
// ════════════════════════════════════════════════════════════════
// Catálogo de puntos de entrega por código. Solo aplica a la ruta 'Nacional':
// las demás rutas no llevan dirección. Ver migracion_direcciones_nacional.sql.
//
// El catálogo se llena SOLO: cada dirección nueva que se escribe al despachar
// queda guardada para la próxima vez.

/** Ruta que usa direcciones. Constante para no repetir el string suelto. */
export const RUTA_NACIONAL = 'Nacional'

export type DireccionNacional = {
  id: string
  codigo: string
  direccion: string
}

/**
 * Direcciones guardadas de varios códigos, en UNA sola consulta.
 * Devuelve un mapa codigo -> direcciones (ordenadas alfabéticamente).
 * Nunca lanza: si falla, devuelve {} y lo avisa por consola.
 */
export async function fetchDireccionesPorCodigo(codigos: string[]): Promise<Record<string, DireccionNacional[]>> {
  const unicos = [...new Set(codigos.map(c => c.trim()).filter(c => c !== ''))]
  if (unicos.length === 0) return {}

  const { data, error } = await supabase
    .from('direcciones_nacional')
    .select('id, codigo, direccion')
    .in('codigo', unicos)
    .order('direccion', { ascending: true })

  if (error) {
    console.error('[direccionesNacional] Error consultando direcciones:', error)
    return {}
  }

  const mapa: Record<string, DireccionNacional[]> = {}
  for (const d of (data ?? []) as DireccionNacional[]) {
    const lista = mapa[d.codigo]
    if (lista) lista.push(d)
    else mapa[d.codigo] = [d]
  }
  return mapa
}

/**
 * Guarda una dirección en el catálogo si todavía no estaba (el UNIQUE
 * codigo+direccion evita duplicados; el conflicto se ignora).
 * Devuelve true si quedó guardada o ya existía.
 */
export async function guardarDireccion(codigo: string, direccion: string): Promise<boolean> {
  const cod = codigo.trim()
  const dir = direccion.trim()
  if (cod === '' || dir === '') return false

  const { error } = await supabase
    .from('direcciones_nacional')
    .upsert({ codigo: cod, direccion: dir }, { onConflict: 'codigo,direccion', ignoreDuplicates: true })

  if (error) {
    console.error('[direccionesNacional] Error guardando dirección:', error)
    return false
  }
  return true
}

/**
 * Cuántos despachos VIVOS de ese código llevan esa dirección.
 *
 * Es lo que se le muestra a Rafa antes de confirmar una corrección, porque
 * editar reescribe también el histórico. `despachos` no tiene codigo_cliente:
 * se acota con el embed !inner sobre registros_beneficio, igual que el UPDATE
 * de la RPC. No cuenta `despachos_archivo`, que la RPC tampoco toca.
 */
export async function contarDespachosConDireccion(codigo: string, direccion: string): Promise<number> {
  const cod = codigo.trim()
  const dir = direccion.trim()
  if (cod === '' || dir === '') return 0

  const { count, error } = await supabase
    .from('despachos')
    .select('id, registros_beneficio!inner(codigo_cliente)', { count: 'exact', head: true })
    .eq('direccion', dir)
    .eq('registros_beneficio.codigo_cliente', cod)

  if (error) {
    console.error('[direccionesNacional] Error contando despachos:', error)
    return 0
  }
  return count ?? 0
}

/** Resultado de una operación del catálogo: o salió, o trae el motivo para mostrar. */
export type ResultadoCatalogo =
  | { ok: true; despachosActualizados: number }
  | { ok: false; mensaje: string }

/**
 * Corrige una dirección del catálogo y, en la misma transacción, los despachos
 * que la usaban. Ver SQL's/migracion_editar_direccion_nacional.sql.
 *
 * Los mensajes de error vienen ya redactados desde la función de Postgres
 * (duplicada, inexistente, sin cambio), así que se muestran tal cual.
 */
export async function editarDireccion(
  codigo: string,
  vieja: string,
  nueva: string,
): Promise<ResultadoCatalogo> {
  const { data, error } = await supabase.rpc('editar_direccion_nacional', {
    p_codigo: codigo.trim(),
    p_vieja: vieja.trim(),
    p_nueva: nueva.trim(),
  })

  if (error) {
    console.error('[direccionesNacional] Error editando dirección:', error)
    return { ok: false, mensaje: error.message }
  }
  return { ok: true, despachosActualizados: typeof data === 'number' ? data : 0 }
}

/**
 * Saca una dirección del catálogo de un código. NO toca `despachos`: los que ya
 * la usaron siguen mostrándola (la columna guarda texto, no una llave).
 */
export async function borrarDireccion(codigo: string, direccion: string): Promise<ResultadoCatalogo> {
  const { error } = await supabase
    .from('direcciones_nacional')
    .delete()
    .eq('codigo', codigo.trim())
    .eq('direccion', direccion.trim())

  if (error) {
    console.error('[direccionesNacional] Error borrando dirección:', error)
    return { ok: false, mensaje: error.message }
  }
  return { ok: true, despachosActualizados: 0 }
}
