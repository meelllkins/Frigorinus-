/**
 * ADELANTO DE VÍSCERAS — el texto que va a la observación del documento de ruta.
 *
 * Un código tiene N rayas con sus vísceras. Rafa despacha solo algunas canales y manda por
 * adelantado las vísceras de las rayas que SE QUEDAN en cava. En la observación del maestro
 * eso queda como:
 *
 *   ENVIAR 4 PAQ DE VISCERAS DE ADELANTO COD 120-2-3-4-5
 *   ENVIAR 2 PAQ DE VISCERAS DE ADELANTO COD 120-2-3 PARA COD 610
 *
 * Regla que define todo: la víscera que viaja CON su canal NO es adelanto. Solo cuentan las
 * vísceras cuya raya no salió en ese mismo acto.
 *
 * Este módulo es PURO a propósito (sin Supabase, sin React): la regla se puede verificar
 * suelta y la usan igual el despacho individual y el múltiple.
 */
import { normalizarCodigoDestino } from './codigoDestino'

/** Lo mínimo que hace falta de una víscera marcada para despacho. */
export interface VisceraAdelantada {
  /** Raya (animal) a la que pertenece. Es lo que se compara contra las canales del acto. */
  registroId: string
  codigoCliente: string
  /** `numero_animal` TAL CUAL está guardado: '07' es '07', nunca 7. */
  numeroAnimal: string
}

/** Una línea de adelanto ya armada, con su código para poder agruparlas. */
export interface LineaAdelanto {
  codigoCliente: string
  /** Rayas listadas, en el orden en que salen en el texto. */
  rayas: string[]
  texto: string
}

/**
 * Ordena rayas por VALOR numérico con desempate por texto, igual que el COD del documento
 * (ver grupoAFila en documentoRuta.ts): así 2 va antes que 10, y '02' y '2' —que son rayas
 * distintas— quedan juntas y en un orden estable.
 */
function ordenarRayas(rayas: string[]): string[] {
  return [...rayas].sort((a, b) => {
    const va = Number(a)
    const vb = Number(b)
    const na = Number.isFinite(va) ? va : Number.POSITIVE_INFINITY
    const nb = Number.isFinite(vb) ? vb : Number.POSITIVE_INFINITY
    return na - nb || (a < b ? -1 : a > b ? 1 : 0)
  })
}

/**
 * Arma las líneas de adelanto de UN acto de despacho.
 *
 * @param visceras            las vísceras marcadas para salir.
 * @param registrosDespachados ids de las rayas cuya CANAL sale en este mismo acto. Sus
 *                            vísceras no son adelanto y quedan afuera del conteo.
 * @param codigoDestino       destino elegido para las vísceras adelantadas. Solo se imprime
 *                            "PARA COD" cuando difiere del código dueño de la raya.
 *
 * Devuelve UNA línea por código de cliente, ordenadas por código. Sin adelanto -> arreglo
 * vacío (el llamador no escribe nada).
 */
export function lineasDeAdelanto(
  visceras: VisceraAdelantada[],
  registrosDespachados: Set<string>,
  codigoDestino: string | null
): LineaAdelanto[] {
  // Igual que formatearCod: el rótulo lo pone esta función, así que si el valor ya lo trae
  // escrito adentro se le saca. Si no, sale "PARA COD PARA COD 602".
  const destino = normalizarCodigoDestino(codigoDestino) ?? ''

  // Por código, las rayas SIN repetir: una raya tiene roja y blanca, y las dos marcadas
  // siguen siendo UN paquete de adelanto. Por eso el conteo es de rayas, no de vísceras.
  const rayasPorCodigo = new Map<string, Set<string>>()
  for (const v of visceras) {
    if (registrosDespachados.has(v.registroId)) continue // viaja con su canal: no es adelanto
    const numero = v.numeroAnimal.trim()
    if (numero === '') continue
    const set = rayasPorCodigo.get(v.codigoCliente)
    if (set) set.add(numero)
    else rayasPorCodigo.set(v.codigoCliente, new Set([numero]))
  }

  const codigos = [...rayasPorCodigo.keys()].sort((a, b) =>
    a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })
  )

  return codigos.map(codigo => {
    const rayas = ordenarRayas([...rayasPorCodigo.get(codigo)!])
    // "PARA COD" solo si el destino es OTRO cliente. Mandar el adelanto al código propio es
    // el caso normal y en el maestro no lleva sufijo.
    const sufijo = destino !== '' && destino !== codigo ? ` PARA COD ${destino}` : ''
    return {
      codigoCliente: codigo,
      rayas,
      texto: `ENVIAR ${rayas.length} PAQ DE VISCERAS DE ADELANTO COD ${codigo}-${rayas.join('-')}${sufijo}`,
    }
  })
}
