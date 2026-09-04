/**
 * CÓDIGO DESTINO — el "PARA COD X" lo pone la app, no el usuario.
 *
 * El campo de destino es texto libre (`¿Es para otro código?` en RutaFields, y el de las
 * vísceras adelantadas en Beneficios). Escribir ahí "PARA COD 602" en vez de "602" es lo
 * natural, porque es como se lee en el documento — pero después el render agrega SU propio
 * prefijo y sale duplicado:
 *
 *   ENVIAR 1 PAQ DE VISCERAS DE ADELANTO COD TESTQA-2 PARA COD PARA COD 602
 *
 * No es una doble concatenación del código: tanto formatearCod() como lineasDeAdelanto()
 * agregan el prefijo UNA sola vez cada uno. Lo que viene duplicado es el valor.
 *
 * Este módulo es PURO y sin dependencias a propósito: lo usan la escritura (Beneficios,
 * Inventario) y los dos renders (documentoRuta, adelantoVisceras), y ninguno debe arrastrar
 * a los otros.
 */

/**
 * Prefijos que se sacan, en orden, si el valor los trae adelante. Se aplican de a uno para
 * cubrir las variantes que se escriben a mano: "PARA COD 602", "para el codigo 602", "COD 602".
 */
const PREFIJOS = [/^para\s+/i, /^el\s+/i, /^c(?:o|ó)d(?:igo)?\.?\s*/i]

/**
 * Deja el código destino pelado, sin el rótulo.
 *
 * Devuelve null para vacío, así encaja directo en la columna `codigo_destino` (nullable) y
 * en el `destino === ''` que ya chequean los renders.
 *
 * Nunca devuelve vacío por sacar de más: si el valor ERA literalmente "COD", se respeta tal
 * cual en vez de borrarlo.
 */
export function normalizarCodigoDestino(valor: string | null | undefined): string | null {
  let v = (valor ?? '').trim()
  if (v === '') return null
  for (const re of PREFIJOS) {
    const sinPrefijo = v.replace(re, '').trim()
    if (sinPrefijo !== '') v = sinPrefijo
  }
  return v
}
