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
