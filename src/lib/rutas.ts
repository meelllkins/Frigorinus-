/**
 * Rutas de despacho — ÚNICA fuente de verdad.
 *
 * ⚠️ Estos valores deben coincidir EXACTO (acentos, mayúsculas, "/") con el
 * CHECK de la columna `despachos.ruta` en Supabase. Si no coinciden, el INSERT
 * del despacho falla.
 */
export const RUTAS = [
  'Remedios/Segovia',
  'San José/Maceo',
  'Yolombó',
  'Cimitarra',
  'Don Matías',
  'Yalí/Vegachí',
  'Nacional',
  'Barbosa',
  'Puerto Berrío',
  'Caracolí/Cristales',
  'Cisneros/San Roque',
  'Externo',
] as const

export type Ruta = typeof RUTAS[number]
