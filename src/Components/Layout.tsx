import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ClipboardList, AlertTriangle, Package, Truck, LogOut, Thermometer } from 'lucide-react'

export default function Layout() {
  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans">
      <header className="bg-gray-900 px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="bg-green-700 rounded-lg p-2 flex items-center justify-center">
            <Thermometer size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-wide leading-tight">Frigorinus</h1>
            <p className="text-xs text-gray-400 leading-tight">Logística de planta</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800"
        >
          <LogOut size={15} />
          Salir
        </button>
      </header>

      <nav className="bg-white shadow-sm border-b border-gray-200 px-6">
        <div className="flex">
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
                `flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition-all ${
                  isActive
                    ? 'border-green-700 text-green-800 bg-green-50'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="p-6 max-w-6xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
