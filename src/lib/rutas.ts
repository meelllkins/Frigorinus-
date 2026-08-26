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
  'Gómez Plata',
  'CERDOS NORDESTE',
  'Externo',
] as const

export type Ruta = typeof RUTAS[number]

/**
 * Rutas que existen SOLO para porcinos.
 *
 * Hasta ahora la lista era una sola y compartida: el selector mostraba las mismas rutas
 * despachando res que cerdo. 'CERDOS NORDESTE' es la primera que no vale para las dos, así
 * que esta constante es todo lo que separa por especie. Una ruta que NO esté acá se sigue
 * ofreciendo para ambas, igual que siempre.
 */
export const RUTAS_SOLO_PORCINOS: readonly Ruta[] = ['CERDOS NORDESTE']

/**
 * Rutas que se ofrecen al despachar `tipoCarne`.
 *
 * Sin tipo se devuelven TODAS, que es el comportamiento de siempre: así un llamador que no
 * sepa la especie no pierde rutas por accidente.
 */
export function rutasPara(tipoCarne?: 'res' | 'cerdo'): readonly Ruta[] {
  if (tipoCarne !== 'res') return RUTAS
  return RUTAS.filter(r => !RUTAS_SOLO_PORCINOS.includes(r))
}
