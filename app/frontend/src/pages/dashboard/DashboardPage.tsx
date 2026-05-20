import { useQuery } from '@tanstack/react-query'
import { Users, FileText, Wallet, TrendingUp, BadgeDollarSign, PiggyBank } from 'lucide-react'
import { api } from '../../lib/api.js'
import { formatCurrency, formatNumber } from '../../lib/utils.js'
import type { DashboardStats } from '../../types/index.js'
import { useAuth } from '../../hooks/useAuth.js'

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub?: string; color: string
}) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-[#6B7280]">{label}</p>
        <div className={`w-9 h-9 ${color} rounded-lg flex items-center justify-center`}>
          <Icon size={18} />
        </div>
      </div>
      <p className="text-2xl font-bold text-[#111827]">{value}</p>
      {sub && <p className="text-xs text-[#6B7280] mt-1">{sub}</p>}
    </div>
  )
}

export function DashboardPage() {
  const { isSuperAdmin } = useAuth()
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey:  ['dashboard'],
    queryFn:   () => api.get('/dashboard').then(r => r.data),
    staleTime: 60_000,
  })

  if (isLoading) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-[#BE123C] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const d = data!

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#111827]">Dashboard</h1>
        <p className="text-sm text-[#6B7280] mt-1">Overview of the loyalty programme</p>
      </div>

      {/* Primary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard
          icon={Users} label="Active Members" color="bg-[#FFF1F2] text-[#BE123C]"
          value={formatNumber(d.members.total)}
          sub={`${d.members.gold} Gold · ${d.members.platinum} Platinum · ${d.members.diamond} Diamond`}
        />
        <StatCard
          icon={FileText} label="Total Invoices" color="bg-blue-50 text-blue-600"
          value={formatNumber(d.invoices.total)}
          sub={`${formatCurrency(d.invoices.totalSaleValue)} sale value`}
        />
        <StatCard
          icon={TrendingUp} label="Total Discounts Given" color="bg-green-50 text-green-600"
          value={formatCurrency(d.invoices.totalDiscount)}
        />
        <StatCard
          icon={Wallet} label="Pending Payouts" color="bg-orange-50 text-orange-600"
          value={formatNumber(d.pendingPayouts.count)}
          sub={`${formatCurrency(d.pendingPayouts.totalCash)} to pay`}
        />
      </div>

      {/* Financial obligation stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={BadgeDollarSign} label="Points Balance Owed" color="bg-purple-50 text-purple-600"
          value={formatCurrency(d.totalBalanceAmount)}
          sub="Cash value of all unredeemed points"
        />
        <StatCard
          icon={PiggyBank} label="Total Payouts Paid" color="bg-teal-50 text-teal-600"
          value={formatCurrency(d.paidPayouts.totalCash)}
          sub="Cash paid out to members so far"
        />
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
          <p className="text-sm font-medium text-[#6B7280] mb-4">Gross Liability %</p>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[#6B7280]">Actual</span>
                <span className="text-lg font-bold text-[#111827]">{d.actualGrossPercent.toFixed(2)}%</span>
              </div>
              <p className="text-xs text-[#9CA3AF]">(Discount + Paid Payouts) ÷ Sales</p>
            </div>
            <div className="border-t border-[#F3F4F6] pt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[#6B7280]">Theoretical</span>
                <span className="text-lg font-bold text-[#BE123C]">{d.theoreticalGrossPercent.toFixed(2)}%</span>
              </div>
              <p className="text-xs text-[#9CA3AF]">(Discount + Paid Payouts + Points Balance) ÷ Sales</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tier breakdown */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 mb-6">
        <h2 className="text-base font-semibold text-[#111827] mb-4">Member Tier Distribution</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            { tier: 'Gold',     count: d.members.gold,     color: 'bg-yellow-100 text-yellow-800' },
            { tier: 'Platinum', count: d.members.platinum, color: 'bg-blue-100 text-blue-800' },
            { tier: 'Diamond',  count: d.members.diamond,  color: 'bg-purple-100 text-purple-800' },
          ].map(({ tier, count, color }) => (
            <div key={tier} className="text-center p-4 rounded-lg bg-[#F9FAFB]">
              <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium mb-2 ${color}`}>{tier}</span>
              <p className="text-2xl font-bold text-[#111827]">{count}</p>
              <p className="text-xs text-[#6B7280]">members</p>
            </div>
          ))}
        </div>
      </div>

      {/* Branch breakdown (super admin only) */}
      {isSuperAdmin && d.branchBreakdown && d.branchBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
          <h2 className="text-base font-semibold text-[#111827] mb-4">Branch Performance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB]">
                  <th className="text-left py-2 px-3 text-[#6B7280] font-medium">Branch</th>
                  <th className="text-right py-2 px-3 text-[#6B7280] font-medium">Members</th>
                  <th className="text-right py-2 px-3 text-[#6B7280] font-medium">YTD Sales</th>
                </tr>
              </thead>
              <tbody>
                {d.branchBreakdown.map((b) => (
                  <tr key={b.branchId} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                    <td className="py-3 px-3 font-medium text-[#111827]">{b.branchName}</td>
                    <td className="py-3 px-3 text-right text-[#374151]">{formatNumber(b.members)}</td>
                    <td className="py-3 px-3 text-right text-[#374151]">{formatCurrency(b.ytdSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
