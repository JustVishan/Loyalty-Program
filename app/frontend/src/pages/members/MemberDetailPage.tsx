import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, X } from 'lucide-react'
import { api } from '../../lib/api.js'
import { formatCurrency, formatNumber, formatDate, tierBadgeColor } from '../../lib/utils.js'
import type { Member, Invoice } from '../../types/index.js'
import { useAuth } from '../../hooks/useAuth.js'

export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { isSuperAdmin } = useAuth()

  const [editingRate, setEditingRate]   = useState(false)
  const [rateInput,   setRateInput]     = useState('')

  const { data: member, isLoading: memberLoading } = useQuery<Member>({
    queryKey: ['members', id],
    queryFn:  () => api.get(`/members/${id}`).then(r => r.data),
  })

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ['invoices', 'member', id],
    queryFn:  () => api.get('/invoices', { params: { memberId: id } }).then(r => r.data),
    enabled:  !!id,
  })

  const setCustomRate = useMutation({
    mutationFn: (rate: number | null) =>
      api.patch(`/members/${id}/custom-rate`, { customDiscountRate: rate }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', id] })
      qc.invalidateQueries({ queryKey: ['members'] })
      setEditingRate(false)
      setRateInput('')
    },
  })

  function openEdit() {
    setRateInput(member?.customDiscountRate ? (parseFloat(member.customDiscountRate) * 100).toFixed(2) : '')
    setEditingRate(true)
  }

  function submitRate(e: React.FormEvent) {
    e.preventDefault()
    const val = rateInput.trim() === '' ? null : parseFloat(rateInput) / 100
    if (val !== null && (isNaN(val) || val < 0 || val > 1)) return
    setCustomRate.mutate(val)
  }

  if (memberLoading) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-[#BE123C] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!member) return (
    <div className="p-8 text-[#6B7280]">Member not found.</div>
  )

  const confirmedInvoices = invoices.filter(i => i.status === 'confirmed')
  const totalDiscount     = confirmedInvoices.reduce((s, i) => s + parseFloat(i.discountAmount), 0)

  return (
    <div className="p-8 max-w-5xl">
      {/* Back */}
      <button onClick={() => navigate('/members')}
        className="flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#111827] mb-6">
        <ArrowLeft size={16} /> Back to Members
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-[#111827]">{member.name}</h1>
              {!member.active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>}
            </div>
            <p className="text-[#6B7280] text-sm">{member.phone} · {member.type.replace('_', ' ')} · Joined {formatDate(member.joinedAt)}</p>
            <p className="text-[#9CA3AF] text-xs font-mono mt-1">{member.memberId}</p>
          </div>
          <div className="flex gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${tierBadgeColor(member.discountTier)}`}>
              Discount: {member.discountTier}
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${tierBadgeColor(member.pointsTier)}`}>
              Points: {member.pointsTier}
            </span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#6B7280] mb-1">YTD Sales</p>
          <p className="text-xl font-bold text-[#111827]">{formatCurrency(member.ytdSaleValue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#6B7280] mb-1">Total Discount Earned</p>
          <p className="text-xl font-bold text-green-600">{formatCurrency(totalDiscount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#6B7280] mb-1">Points Balance</p>
          <p className="text-xl font-bold text-[#BE123C]">{formatNumber(member.ytdPoints)} pts</p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#6B7280] mb-1">Redeemable Value</p>
          <p className="text-xl font-bold text-orange-600">
            {member.pointsCashValue != null ? formatCurrency(member.pointsCashValue) : '—'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#6B7280] mb-1">Total Invoices</p>
          <p className="text-xl font-bold text-[#111827]">{confirmedInvoices.length}</p>
        </div>
      </div>

      {/* Custom discount rate */}
      {isSuperAdmin && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#111827]">Custom Discount Rate</p>
              <p className="text-xs text-[#6B7280] mt-0.5">
                {member.customDiscountRate
                  ? <>Overrides tier rate — currently <strong className="text-[#BE123C]">{(parseFloat(member.customDiscountRate) * 100).toFixed(2)}%</strong></>
                  : 'No custom rate — tier rate applies'}
              </p>
            </div>
            {!editingRate && (
              <button onClick={openEdit}
                className="flex items-center gap-1.5 text-xs text-[#BE123C] hover:text-[#9F1239] font-medium border border-[#FECDD3] rounded-lg px-3 py-1.5 hover:bg-[#FFF1F2] transition-colors">
                <Pencil size={12} /> {member.customDiscountRate ? 'Edit' : 'Set Rate'}
              </button>
            )}
          </div>

          {editingRate && (
            <form onSubmit={submitRate} className="mt-3 flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-[#6B7280] mb-1">Discount % (leave blank to remove)</label>
                <div className="relative">
                  <input
                    type="text" inputMode="decimal" autoFocus
                    value={rateInput}
                    onChange={e => setRateInput(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder={member.customDiscountRate
                      ? (parseFloat(member.customDiscountRate) * 100).toFixed(2)
                      : 'e.g. 12 for 12%'}
                    className="w-full px-3 py-2 pr-8 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9CA3AF]">%</span>
                </div>
              </div>
              <button type="submit" disabled={setCustomRate.isPending}
                className="px-4 py-2 bg-[#BE123C] hover:bg-[#9F1239] text-white rounded-lg text-sm font-medium disabled:opacity-60">
                {setCustomRate.isPending ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditingRate(false)}
                className="p-2 text-[#9CA3AF] hover:text-[#374151]">
                <X size={16} />
              </button>
            </form>
          )}

          {setCustomRate.isError && (
            <p className="text-xs text-[#BE123C] mt-2">
              {(setCustomRate.error as any)?.response?.data?.error ?? 'Failed to update rate'}
            </p>
          )}
        </div>
      )}

      {/* Invoice history */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-base font-semibold text-[#111827]">Transaction History</h2>
        </div>
        {invoicesLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-[#BE123C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-12 text-[#6B7280] text-sm">No invoices yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Invoice #</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">Value</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">Discount</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">Net</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Rate Source</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Status</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.invoiceId} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                  <td className="py-3 px-4 font-medium text-[#111827]">{inv.invoiceNumber}</td>
                  <td className="py-3 px-4 text-right text-[#374151]">{formatCurrency(inv.invoiceValue)}</td>
                  <td className="py-3 px-4 text-right text-green-600">{formatCurrency(inv.discountAmount)}</td>
                  <td className="py-3 px-4 text-right font-medium text-[#111827]">{formatCurrency(inv.netInvoiceValue)}</td>
                  <td className="py-3 px-4">
                    <span className="text-xs bg-[#F3F4F6] text-[#374151] px-2 py-1 rounded capitalize">
                      {inv.rateSource.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      inv.status === 'confirmed' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    }`}>{inv.status}</span>
                  </td>
                  <td className="py-3 px-4 text-[#6B7280]">{formatDate(inv.confirmedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
