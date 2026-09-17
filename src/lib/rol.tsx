import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Rol = 'admin' | 'remisiones'

type RolContextValue = {
  rol: Rol | null
  cargando: boolean
}

const RolContext = createContext<RolContextValue>({ rol: null, cargando: true })

/**
 * Resuelve el rol UNA sola vez por sesión (RPC `mi_rol`, ver SQL's/migracion_
 * roles.sql), no en cada pantalla. Depende de `session?.user.id` y no de
 * `session` entera: el objeto session cambia en cada refresh de token
 * (cada rato, mismo usuario) y eso volvería a pedir el rol sin necesidad;
 * el id de usuario solo cambia en un login/logout/cambio de cuenta real.
 *
 * Si `session` es null el rol se limpia (no queda pegado el de la cuenta
 * anterior si otra persona se loguea en el mismo dispositivo).
 *
 * Fail-open ante error de red/RPC, igual que rol_actual() en la base: si la
 * llamada falla se asume 'admin' en vez de dejar a alguien bloqueado por un
 * problema de conexión. El candado real vive en las policies de RLS — esto
 * del frontend solo evita que la pantalla parezca guardar sin guardar (ver
 * el wrapper de bloqueo en Layout.tsx).
 */
export function RolProvider({ session, children }: { session: Session | null; children: ReactNode }) {
  const [rol, setRol] = useState<Rol | null>(null)
  const [cargando, setCargando] = useState(true)
  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) {
      setRol(null)
      setCargando(false)
      return
    }

    let cancelado = false
    setCargando(true)

    supabase.rpc('mi_rol').then(({ data, error }) => {
      if (cancelado) return
      if (error) {
        console.error('[rol] Error consultando mi_rol():', error)
        setRol('admin')
      } else {
        setRol(data as Rol)
      }
      setCargando(false)
    })

    return () => {
      cancelado = true
    }
  }, [userId])

  return <RolContext.Provider value={{ rol, cargando }}>{children}</RolContext.Provider>
}

export function useRol() {
  return useContext(RolContext)
}
