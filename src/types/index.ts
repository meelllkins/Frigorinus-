export interface RegistroBeneficio {
  id: string
  codigo_cliente: string
  numero_animal: string
  tipo_carne: 'res' | 'cerdo'
  fecha_beneficio: string
  fecha_cobro_frio: string
  estado: 'activo' | 'despachado'
  notas?: string
  created_at: string
}

export interface InventarioViscera {
  id: string
  registro_id: string
  estado: 'en_inventario' | 'despachada'
  fecha_despacho?: string
  created_at: string
}

export interface Despacho {
  id: string
  registro_id: string
  tipo_despacho: 'canal' | 'viscera'
  fecha_despacho: string
  notas?: string
  created_at: string
}