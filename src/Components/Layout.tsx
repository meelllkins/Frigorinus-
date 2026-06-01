import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ClipboardList, AlertTriangle, Package, Truck, LogOut } from 'lucide-react'

export default function Layout() {
  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Frigorinus Logística</h1>
          <p className="text-xs text-gray-500">Control de cobros de planta</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <LogOut size={16} />
          Salir
        </button>
      </header>

      <nav className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-1">
          {[
            { to: '/', label: 'Inventario Actual', icon: ClipboardList },
            { to: '/cobros', label: 'Cobros de Frío', icon: AlertTriangle },
            { to: '/inventario', label: 'Inventario', icon: Package },
            { to: '/despachos', label: 'Despachos', icon: Truck },
          ].map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-900'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="p-6">
        <Outlet />
      </main>
    </div>
  )
}