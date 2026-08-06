/**
 * FECHA DE ENTREGA — el día PARA EL QUE se entrega un despacho.
 *
 * Hasta ahora el día de entrega no se guardaba en ningún lado: se INFERÍA como
 * "fecha de despacho + 1" en cuatro lugares distintos (el encabezado de la pantalla,
 * la línea de fecha del Excel, el nombre de hoja y el día de semana de Cimitarra).
 * Con eso, todo lo despachado en una jornada salía forzosamente en UN solo documento.
 *
 * El caso que rompe esa suposición es la víspera de festivo: en una misma jornada hay
 * que dejar listo lo de mañana Y lo del día hábil siguiente, y son DOS documentos de
 * ruta distintos, cada uno con su propio carro, conductor y placa.
 *
 * Por eso `despachos.fecha_entrega` es ahora una columna real y este módulo es la
 * ÚNICA fuente del default y del fallback. Regla de oro: un despacho que no elige
 * nada tiene que comportarse EXACTO como antes, o sea entrega = despacho + 1.
 */

/**
 * Cuántos días después del despacho se entrega por defecto. Es el mismo "+1" que
 * estaba repartido por todo el proyecto; acá vive una sola vez.
 */
export const DIAS_HASTA_ENTREGA = 1

/**
 * Suma días a una fecha 'YYYY-MM-DD' y devuelve otra 'YYYY-MM-DD'.
 * El 'T00:00:00' es obligatorio: sin él `new Date('2026-08-06')` se interpreta como
 * UTC y en Colombia (UTC-5) devuelve el día ANTERIOR. Es el mismo patrón que ya usaba
 * el resto del proyecto.
 */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + 'T00:00:00')
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Fecha de entrega NORMAL de un despacho: el día hábil siguiente por convención de
 * Rafa (despacho + 1). Es lo que propone el selector al despachar y lo que se asume
 * para las filas viejas que no tienen la columna.
 */
export function entregaPorDefecto(fechaDespacho: string): string {
  return sumarDias(fechaDespacho, DIAS_HASTA_ENTREGA)
}

/**
 * Fecha de entrega EFECTIVA de una fila de `despachos`.
 *
 * TRANSICIÓN: manda `fecha_entrega` si está escrita; si es NULL —despachos anteriores
 * a la migración, o insertados por fuera de la app— se cae al default de siempre. Así
 * todo el histórico se sigue agrupando y ordenando exactamente igual que antes.
 */
export function fechaEntregaDe(fechaEntrega: string | null | undefined, fechaDespacho: string): string {
  const f = (fechaEntrega ?? '').trim()
  return f === '' ? entregaPorDefecto(fechaDespacho) : f
}
