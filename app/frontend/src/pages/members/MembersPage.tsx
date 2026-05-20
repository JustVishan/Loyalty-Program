import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { api } from '../../lib/api.js'
import { formatCurrency, formatNumber, formatDate, tierBadgeColor } from '../../lib/utils.js'
import type { Member, Branch } from '../../types/index.js'
import { useAuth } from '../../hooks/useAuth.js'

export function MembersPage() {
  const { user, isSuperAdmin } = useAuth()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const [search, setSearch]   = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm]       = useState({ name: '', phone: '', type: 'engineer', branchId: user?.branchId ?? '' })

  const { data: memberList = [], isLoading } = useQuery<Member[]>({
    queryKey: ['members', search],
    queryFn:  () => api.get('/members', { params: { search: search || undefined } }).then(r => r.data),
  })

  const { data: branchList = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/branches').then(r => r.data),
    enabled:  isSuperAdmin,
  })

  const addMember = useMutation({
    mutationFn: (body: typeof form) => api.post('/members', body).then(r => r.data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['members'] }); setShowAdd(false); setForm({ name: '', phone: '', type: 'engineer', branchId: user?.branchId ?? '' }) },
  })

  const filtered = memberList.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.phone.includes(search)
  )

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Members</h1>
          <p className="text-sm text-[#6B7280] mt-1">{filtered.length} members</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-[#BE123C] hover:bg-[#9F1239] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Add Member
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
        <input
          type="text"
          placeholder="Search by name or phone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C] focus:border-transparent bg-white"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-[#BE123C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[#6B7280]">No members found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Name</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Phone</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Type</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Discount Tier</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Points Tier</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">YTD Sales</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">Points</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.memberId} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                  <td className="py-3 px-4 font-medium text-[#111827]">
                    <button onClick={() => navigate(`/members/${m.memberId}`)}
                      className="hover:text-[#BE123C] hover:underline text-left">
                      {m.name}
                    </button>
                    {!m.active && <span className="ml-2 text-xs text-[#9CA3AF]">(inactive)</span>}
                    {m.customDiscountRate && (
                      <span className="ml-2 text-xs bg-[#FFF1F2] text-[#BE123C] px-1.5 py-0.5 rounded">Custom Rate</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-[#374151]">{m.phone}</td>
                  <td className="py-3 px-4 text-[#374151] capitalize">{m.type.replace('_', ' ')}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${tierBadgeColor(m.discountTier)}`}>
                      {m.discountTier}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${tierBadgeColor(m.pointsTier)}`}>
                      {m.pointsTier}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-[#374151]">{formatCurrency(m.ytdSaleValue)}</td>
                  <td className="py-3 px-4 text-right text-[#374151]">{formatNumber(m.ytdPoints)}</td>
                  <td className="py-3 px-4 text-[#6B7280]">{formatDate(m.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Member Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-[#111827] mb-4">Add New Member</h2>
            <form
              onSubmit={e => { e.preventDefault(); addMember.mutate(form) }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1">Full Name</label>
                <input
                  type="text" required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1">Phone</label>
                <input
                  type="text" inputMode="numeric" required value={form.phone} maxLength={10}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))}
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]"
                >
                  <option value="engineer">Engineer</option>
                  <option value="contractor">Contractor</option>
                  <option value="tile_layer">Tile Layer</option>
                  <option value="architect">Architect</option>
                </select>
              </div>
              {isSuperAdmin && (
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1">Branch</label>
                  <select required value={form.branchId}
                    onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}
                    className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]"
                  >
                    <option value="">Select branch</option>
                    {branchList.filter(b => b.active).map(b => (
                      <option key={b.branchId} value={b.branchId}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {addMember.isError && (
                <p className="text-sm text-[#BE123C]">{(addMember.error as any)?.response?.data?.error ?? 'Failed to add member'}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 px-4 py-2 border border-[#E5E7EB] rounded-lg text-sm font-medium text-[#374151] hover:bg-[#F9FAFB]">
                  Cancel
                </button>
                <button type="submit" disabled={addMember.isPending}
                  className="flex-1 px-4 py-2 bg-[#BE123C] hover:bg-[#9F1239] text-white rounded-lg text-sm font-medium disabled:opacity-60">
                  {addMember.isPending ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
