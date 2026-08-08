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
 * ÚNICA fuente del default y del fallback: un despacho que no elige nada entrega al día
 * siguiente, con la única excepción del sábado, que entrega el lunes.
 */

/**
 * Cuántos días después del despacho se entrega por defecto. Es el mismo "+1" que
 * estaba repartido por todo el proyecto; acá vive una sola vez.
 *
 * El sábado es la única excepción: ver entregaPorDefecto().
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
 * Fecha de entrega NORMAL de un despacho: el día siguiente por convención de Rafa
 * (despacho + 1), salvo el SÁBADO, que entrega el lunes (+2) porque el domingo no se
 * entrega. Es lo que propone el selector al despachar; Rafa siempre puede cambiarlo.
 *
 * OJO: es SOLO el sábado. No es una regla general de saltar domingos ni festivos — un
 * despacho en víspera de festivo sigue proponiendo +1, y para eso está el selector.
 *
 * ⚠️ Con esta excepción la función DEJA DE SER INVERTIBLE: sábado (+2) y domingo (+1)
 *    dan los dos lunes. Por eso jornadaCanonica() en documentoRuta.ts NO intenta ser su
 *    inversa y se queda en un −1 fijo; está explicado allá.
 */
export function entregaPorDefecto(fechaDespacho: string): string {
  const esSabado = new Date(fechaDespacho + 'T00:00:00').getDay() === 6 // 0 = domingo
  return sumarDias(fechaDespacho, esSabado ? DIAS_HASTA_ENTREGA + 1 : DIAS_HASTA_ENTREGA)
}

/**
 * Fecha de entrega EFECTIVA de una fila de `despachos`.
 *
 * TRANSICIÓN: manda `fecha_entrega` si está escrita; si es NULL —despachos anteriores
 * a la migración, o insertados por fuera de la app— se cae al default.
 *
 * ⚠️ HOY NO TIENE LLAMADORES: el agrupamiento del documento resuelve el caso NULL en SQL
 *    (ver construirDocumentoDia), y ahí el histórico se busca con un −1 FIJO, no con este
 *    default. Desde que el sábado entrega +2 las dos vías dejaron de coincidir para ese
 *    día, y es a propósito: el histórico tiene que seguir apareciendo en la misma tabla
 *    de siempre. Si alguna vez se vuelve a usar esta función para agrupar, hay que
 *    decidir primero cuál de los dos criterios manda.
 */
export function fechaEntregaDe(fechaEntrega: string | null | undefined, fechaDespacho: string): string {
  const f = (fechaEntrega ?? '').trim()
  return f === '' ? entregaPorDefecto(fechaDespacho) : f
}
