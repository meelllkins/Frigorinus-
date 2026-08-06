export interface RegistroBeneficio {
  id: string
  codigo_cliente: string
  numero_animal: string
  tipo_carne: 'res' | 'cerdo'
  fecha_beneficio: string
  fecha_cobro_frio: string
  estado: 'activo' | 'despachado'
  // Cuánto del animal ya salió: 0 = entero en cava, 0.5 = le queda media canal, 1 = completo.
  // Mientras sea < 1 el animal sigue 'activo' y visible en la lista.
  fraccion_despachada?: number | string | null
  notas?: string
  created_at: string
}

export interface InventarioViscera {
  id: string
  registro_id: string
  tipo: 'roja' | 'blanca' | null
  estado: 'en_inventario' | 'despachada'
  fecha_despacho?: string
  created_at: string
}

export interface Despacho {
  id: string
  registro_id: string
  viscera_id?: string | null
  tipo_despacho: 'canal' | 'viscera'
  fecha_despacho: string
  // Día PARA EL QUE se entrega, distinto de fecha_despacho: es lo que agrupa el documento
  // de ruta. Opcional porque las filas anteriores a la migración lo tienen en NULL y ahí
  // vale el default de siempre (despacho + 1). Ver src/lib/fechaEntrega.ts.
  fecha_entrega?: string | null
  // Cuánto del canal salió en este despacho: 1 = entero, 0.5 = media canal.
  fraccion?: number | string | null
  notas?: string
  created_at: string
}