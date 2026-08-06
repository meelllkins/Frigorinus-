/**
 * FESTIVOS — cuándo se ofrece elegir la fecha de entrega.
 *
 * El selector de fecha de entrega (ver fechaEntrega.ts) existe por un solo motivo: cuando
 * cae un festivo, Rafa tiene que dejar despachado el festivo Y el día siguiente, y arma ese
 * bloque desde los días previos. Fuera de esa ventana el selector solo estorba, así que se
 * esconde y el despacho vuelve a comportarse exactamente como siempre (entrega = despacho + 1).
 *
 * Este módulo NO tiene dependencias a propósito: así se puede verificar suelto.
 */

/**
 * Festivos de Colombia, en orden cronológico y en formato 'YYYY-MM-DD'.
 *
 * ⚠️ MANTENIMIENTO: la lista llega hasta 2027-05-01. Cuando se acabe, el selector deja de
 * aparecer (enTramoPrevioAFestivo devuelve false para todo) — no rompe nada, pero Rafa se
 * queda sin poder adelantar el post-festivo. Hay que extenderla antes de esa fecha.
 *
 * El orden importa: enTramoPrevioAFestivo toma el PRIMERO que sea >= hoy. Como son
 * 'YYYY-MM-DD', el orden alfabético ya es el cronológico.
 */
export const FESTIVOS: readonly string[] = [
  '2026-08-07',
  '2026-08-17',
  '2026-10-12',
  '2026-11-02',
  '2026-11-16',
  '2026-12-08',
  '2026-12-25',
  '2027-01-01',
  '2027-01-11',
  '2027-03-22',
  '2027-03-25',
  '2027-03-26',
  '2027-05-01',
]

const FESTIVOS_SET = new Set(FESTIVOS)

/** ¿Esta fecha 'YYYY-MM-DD' es festivo? */
export function esFestivo(fecha: string): boolean {
  return FESTIVOS_SET.has(fecha)
}

/**
 * 'YYYY-MM-DD' local de un Date. Local y no toISOString(): en Colombia (UTC-5) el ISO en
 * UTC devuelve el día anterior. Mismo criterio que el resto del proyecto.
 */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Día de OPERACIÓN normal: lunes a sábado, y que no sea festivo.
 *
 * El sábado SÍ cuenta (Rafa trabaja en planta) y el domingo NO (trabaja desde casa, pero no
 * hay jornada de despacho). Esta distinción es justo lo que hace que, con un festivo el
 * lunes, el selector aparezca sábado y domingo pero no el viernes: entre el viernes y el
 * lunes se atraviesa el sábado, que es jornada normal y corta el adelanto.
 */
function esDiaDeOperacion(fecha: string): boolean {
  const diaSemana = new Date(fecha + 'T00:00:00').getDay() // 0 = domingo
  if (diaSemana === 0) return false
  return !esFestivo(fecha)
}

/**
 * ¿La jornada de `hoy` está en el tramo desde el que se adelanta el trabajo de un festivo?
 *
 * Criterio: existe un festivo H >= hoy tal que TODOS los días estrictamente entre hoy y H
 * son no operativos (domingo o festivo). O sea: hoy es el último día operativo antes del
 * festivo, o un día no operativo de la racha inmediatamente anterior.
 *
 * Casos que tiene que dar (confirmados con Rafa):
 *   · festivo LUNES  -> sábado ✔ y domingo ✔ (viernes ✘: el sábado de por medio es jornada)
 *   · festivo VIERNES -> jueves ✔ (miércoles ✘: el jueves de por medio es jornada)
 *   · sin festivo cerca -> ✘ siempre, y el despacho queda idéntico a como era antes.
 *
 * Si `hoy` ES el festivo, el tramo entre medio queda vacío y devuelve true.
 */
export function enTramoPrevioAFestivo(hoy: string): boolean {
  const proximo = FESTIVOS.find(f => f >= hoy)
  if (proximo === undefined) return false // se acabó la lista: ver nota de MANTENIMIENTO

  // Se recorre día por día desde mañana hasta la víspera del festivo. En la práctica son 0,
  // 1 o 2 vueltas: la primera jornada normal que aparece corta el tramo.
  const cursor = new Date(hoy + 'T00:00:00')
  cursor.setDate(cursor.getDate() + 1)
  while (iso(cursor) < proximo) {
    if (esDiaDeOperacion(iso(cursor))) return false
    cursor.setDate(cursor.getDate() + 1)
  }
  return true
}
