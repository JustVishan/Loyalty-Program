import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, FileText, Wallet, Settings, LogOut } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth.js'
import { api } from '../../lib/api.js'

const nav = [
  { to: '/',          label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/members',   label: 'Members',    icon: Users },
  { to: '/invoices',  label: 'Invoices',   icon: FileText },
  { to: '/payouts',   label: 'Payouts',    icon: Wallet },
]

export function Sidebar() {
  const { user, isSuperAdmin } = useAuth()

  async function handleLogout() {
    try { await api.post('/auth/logout') } catch {}
    localStorage.removeItem('accessToken')
    localStorage.removeItem('user')
    window.location.href = '/login'
  }

  return (
    <aside className="w-64 bg-white border-r border-[#E5E7EB] flex flex-col min-h-screen">

      {/* Logo */}
      <div className="px-6 py-5 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#BE123C] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">R</span>
          </div>
          <span className="font-bold text-[#111827] text-lg">RewardHub</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[#FFF1F2] text-[#BE123C]'
                  : 'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827]'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}

        {isSuperAdmin && (
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[#FFF1F2] text-[#BE123C]'
                  : 'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827]'
              }`
            }
          >
            <Settings size={18} />
            Settings
          </NavLink>
        )}
      </nav>

      {/* User + Logout */}
      <div className="px-3 py-4 border-t border-[#E5E7EB]">
        <div className="px-3 py-2 mb-1">
          <p className="text-xs font-medium text-[#111827]">{user?.username}</p>
          <p className="text-xs text-[#6B7280] capitalize">{user?.role?.replace('_', ' ')}</p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#FFF1F2] hover:text-[#BE123C] transition-colors"
        >
          <LogOut size={18} />
          Logout
        </button>
      </div>
    </aside>
  )
}
