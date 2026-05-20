import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { api } from '../../lib/api.js'
import { formatCurrency, formatNumber, formatDate } from '../../lib/utils.js'
import type { Payout, Member } from '../../types/index.js'
import { useAuth } from '../../hooks/useAuth.js'

const statusColor: Record<string, string> = {
  pending:   'bg-yellow-50 text-yellow-700',
  confirmed: 'bg-blue-50 text-blue-700',
  paid:      'bg-green-50 text-green-700',
}

export function PayoutsPage() {
  const { isAdminOrAbove } = useAuth()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ memberId: '', pointsToRedeem: '', password: '' })

  const { data: payoutList = [], isLoading } = useQuery<Payout[]>({
    queryKey: ['payouts'],
    queryFn:  () => api.get('/payouts').then(r => r.data),
  })

  const { data: memberList = [] } = useQuery<Member[]>({
    queryKey: ['members'],
    queryFn:  () => api.get('/members').then(r => r.data),
  })

  const createPayout = useMutation({
    mutationFn: (body: any) => api.post('/payouts', body).then(r => r.data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['payouts'] }); setShowCreate(false); setForm({ memberId: '', pointsToRedeem: '', password: '' }) },
  })

  const confirmPayout = useMutation({
    mutationFn: (id: string) => api.patch(`/payouts/${id}/confirm`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['payouts'] }),
  })

  const markPaid = useMutation({
    mutationFn: (id: string) => api.patch(`/payouts/${id}/paid`),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['payouts'] }); qc.invalidateQueries({ queryKey: ['members'] }) },
  })

  const selectedMember = memberList.find(m => m.memberId === form.memberId)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Payouts</h1>
          <p className="text-sm text-[#6B7280] mt-1">Points redemptions</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#BE123C] hover:bg-[#9F1239] text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} /> New Redemption
        </button>
      </div>

      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-[#BE123C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : payoutList.length === 0 ? (
          <div className="text-center py-16 text-[#6B7280]">No payouts yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Member</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">Points</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">Cash Value</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">Rate</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Status</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Created</th>
                {isAdminOrAbove && <th className="py-3 px-4" />}
              </tr>
            </thead>
            <tbody>
              {payoutList.map((p) => (
                <tr key={p.payoutId} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                  <td className="py-3 px-4">
                    <p className="font-medium text-[#111827]">{p.memberName}</p>
                    <p className="text-xs text-[#6B7280]">{p.memberPhone}</p>
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-[#111827]">{formatNumber(p.pointsRedeemed)}</td>
                  <td className="py-3 px-4 text-right text-[#111827] font-semibold">{formatCurrency(p.cashValue)}</td>
                  <td className="py-3 px-4 text-right text-[#6B7280]">₹{p.redemptionRateApplied}/pt</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium capitalize ${statusColor[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[#6B7280]">{formatDate(p.createdAt)}</td>
                  {isAdminOrAbove && (
                    <td className="py-3 px-4 text-right space-x-2">
                      {p.status === 'pending' && (
                        <button onClick={() => confirmPayout.mutate(p.payoutId)}
                          className="text-xs text-blue-600 hover:underline">Confirm</button>
                      )}
                      {p.status === 'confirmed' && (
                        <button onClick={() => markPaid.mutate(p.payoutId)}
                          className="text-xs text-green-600 hover:underline">Mark Paid</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Payout Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-[#111827] mb-4">New Redemption</h2>
            <form onSubmit={e => { e.preventDefault(); createPayout.mutate({ memberId: form.memberId, pointsToRedeem: parseInt(form.pointsToRedeem), password: form.password }) }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1">Member</label>
                <select required value={form.memberId}
                  onChange={e => setForm(f => ({ ...f, memberId: e.target.value }))}
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]"
                >
                  <option value="">Select member</option>
                  {memberList.filter(m => m.active && m.ytdPoints > 0).map(m => (
                    <option key={m.memberId} value={m.memberId}>{m.name} — {formatNumber(m.ytdPoints)} pts</option>
                  ))}
                </select>
              </div>
              {selectedMember && (
                <div className="bg-[#F9FAFB] rounded-lg p-3 text-sm">
                  <p className="text-[#6B7280]">Available points: <span className="font-semibold text-[#111827]">{formatNumber(selectedMember.ytdPoints)}</span></p>
                  <p className="text-[#6B7280]">Points tier: <span className="font-semibold text-[#111827] capitalize">{selectedMember.pointsTier}</span></p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1">Points to Redeem</label>
                <input
                  type="number" required min="1"
                  max={selectedMember?.ytdPoints}
                  value={form.pointsToRedeem}
                  onChange={e => setForm(f => ({ ...f, pointsToRedeem: e.target.value }))}
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1">
                  Confirm your password
                </label>
                <input
                  type="password" required value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Enter your password to confirm"
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]"
                />
              </div>
              {createPayout.isError && (
                <p className="text-sm text-[#BE123C]">{(createPayout.error as any)?.response?.data?.error ?? 'Failed'}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 px-4 py-2 border border-[#E5E7EB] rounded-lg text-sm font-medium text-[#374151] hover:bg-[#F9FAFB]">
                  Cancel
                </button>
                <button type="submit" disabled={createPayout.isPending}
                  className="flex-1 px-4 py-2 bg-[#BE123C] hover:bg-[#9F1239] text-white rounded-lg text-sm font-medium disabled:opacity-60">
                  {createPayout.isPending ? 'Creating...' : 'Create Redemption'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
