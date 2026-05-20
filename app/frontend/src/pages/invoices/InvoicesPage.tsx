import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../../lib/api.js'
import { formatCurrency, formatDate, formatNumber } from '../../lib/utils.js'
import type { Invoice, Member } from '../../types/index.js'
import { useAuth } from '../../hooks/useAuth.js'

export function InvoicesPage() {
  const { isAdminOrAbove } = useAuth()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [voidingId,  setVoidingId]  = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [form, setForm] = useState({ invoiceNumber: '', invoiceValue: '', overrideDiscountRate: '', overrideReason: '' })
  const [showBreakdown, setShowBreakdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const { data: invoiceList = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ['invoices'],
    queryFn:  () => api.get('/invoices').then(r => r.data),
  })

  const { data: memberList = [] } = useQuery<Member[]>({
    queryKey: ['members'],
    queryFn:  () => api.get('/members').then(r => r.data),
  })

  const previewValue = parseFloat(form.invoiceValue)
  const overrideRate = form.overrideDiscountRate ? parseFloat(form.overrideDiscountRate) / 100 : undefined
  const { data: preview, isFetching: previewFetching } = useQuery({
    queryKey: ['invoice-preview', selectedMember?.memberId, previewValue, overrideRate],
    queryFn:  () => api.get('/invoices/preview', { params: {
      memberId: selectedMember!.memberId,
      invoiceValue: previewValue,
      ...(overrideRate != null ? { overrideDiscountRate: overrideRate } : {}),
    }}).then(r => r.data),
    enabled: !!selectedMember && previewValue > 0 && !isNaN(previewValue),
    staleTime: 0,
  })

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const suggestions = memberSearch.trim().length > 0
    ? memberList.filter(m => m.active && (
        m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
        m.phone.includes(memberSearch) ||
        m.memberId.toLowerCase().startsWith(memberSearch.toLowerCase())
      )).slice(0, 6)
    : []

  function selectMember(m: Member) {
    setSelectedMember(m); setMemberSearch(m.name); setShowSuggestions(false)
  }

  function resetModal() {
    setShowCreate(false); setMemberSearch(''); setSelectedMember(null); setShowBreakdown(false)
    setForm({ invoiceNumber: '', invoiceValue: '', overrideDiscountRate: '', overrideReason: '' })
  }

  const createInvoice = useMutation({
    mutationFn: (body: any) => api.post('/invoices', body).then(r => r.data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['members'] }); resetModal() },
  })

  const voidInvoice = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/invoices/${id}/void`, { reason }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['invoices'] }); setVoidingId(null); setVoidReason('') },
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedMember) return
    const body: any = { memberId: selectedMember.memberId, invoiceNumber: form.invoiceNumber, invoiceValue: parseFloat(form.invoiceValue) }
    if (form.overrideDiscountRate) { body.overrideDiscountRate = parseFloat(form.overrideDiscountRate) / 100; body.overrideReason = form.overrideReason }
    createInvoice.mutate(body)
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Invoices</h1>
          <p className="text-sm text-[#6B7280] mt-1">{invoiceList.length} total</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#BE123C] hover:bg-[#9F1239] text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> New Invoice
        </button>
      </div>

      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-[#BE123C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Invoice #</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">Value</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">Discount</th>
                <th className="text-right py-3 px-4 text-[#6B7280] font-medium">Net</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Rate Source</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Status</th>
                <th className="text-left py-3 px-4 text-[#6B7280] font-medium">Date</th>
                {isAdminOrAbove && <th className="py-3 px-4" />}
              </tr>
            </thead>
            <tbody>
              {invoiceList.map((inv) => (
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
                  {isAdminOrAbove && (
                    <td className="py-3 px-4">
                      {inv.status === 'confirmed' && (
                        <button onClick={() => setVoidingId(inv.invoiceId)}
                          className="text-xs text-[#BE123C] hover:underline">Void</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Invoice Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-[#111827] mb-4">New Invoice</h2>
            <form onSubmit={handleCreate} className="space-y-4">

              {/* Member search */}
              <div ref={searchRef} className="relative">
                <label className="block text-sm font-medium text-[#374151] mb-1">Member</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                  <input
                    type="text"
                    placeholder="Search by name, phone, or member ID..."
                    value={memberSearch}
                    onChange={e => { setMemberSearch(e.target.value); setSelectedMember(null); setShowSuggestions(true) }}
                    onFocus={() => setShowSuggestions(true)}
                    className="w-full pl-8 pr-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]"
                  />
                </div>
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-[#E5E7EB] rounded-lg shadow-lg overflow-hidden">
                    {suggestions.map(m => (
                      <button key={m.memberId} type="button" onClick={() => selectMember(m)}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#F9FAFB] border-b border-[#F3F4F6] last:border-0">
                        <p className="text-sm font-medium text-[#111827]">{m.name}</p>
                        <p className="text-xs text-[#6B7280]">{m.phone} · {m.type.replace('_', ' ')} · ID: {m.memberId.slice(0, 8)}…</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Auto-filled member card */}
              {selectedMember && (
                <div className="bg-[#F9FAFB] rounded-lg p-3 text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Name</span>
                    <span className="font-medium text-[#111827]">{selectedMember.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Phone</span>
                    <span className="text-[#374151]">{selectedMember.phone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Discount Tier</span>
                    <span className="font-medium capitalize text-[#111827]">{selectedMember.discountTier}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Points Balance</span>
                    <span className="text-[#374151]">{formatNumber(selectedMember.ytdPoints)} pts</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Member ID</span>
                    <span className="text-[#9CA3AF] font-mono text-[10px]">{selectedMember.memberId}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1">Invoice Number</label>
                <input type="text" required value={form.invoiceNumber}
                  onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))}
                  placeholder="INV-0001"
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1">Invoice Value (₹)</label>
                <input type="text" inputMode="decimal" required value={form.invoiceValue}
                  onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ''); setForm(f => ({ ...f, invoiceValue: v })) }}
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]" />
              </div>
              {isAdminOrAbove && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1">
                      Override Discount % <span className="text-[#9CA3AF]">(optional)</span>
                    </label>
                    <input type="text" inputMode="decimal" value={form.overrideDiscountRate}
                      onChange={e => setForm(f => ({ ...f, overrideDiscountRate: e.target.value }))}
                      placeholder="e.g. 5 for 5%"
                      className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]" />
                  </div>
                  {form.overrideDiscountRate && (
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1">Override Reason</label>
                      <input type="text" required={!!form.overrideDiscountRate} value={form.overrideReason}
                        onChange={e => setForm(f => ({ ...f, overrideReason: e.target.value }))}
                        className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C]" />
                    </div>
                  )}
                </>
              )}
              {/* Live calculation preview */}
              {selectedMember && previewValue > 0 && (
                <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setShowBreakdown(b => !b)}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-[#F9FAFB] text-sm font-medium text-[#374151] hover:bg-[#F3F4F6]">
                    <span>Calculation Preview</span>
                    {previewFetching
                      ? <span className="w-3.5 h-3.5 border-2 border-[#BE123C] border-t-transparent rounded-full animate-spin" />
                      : showBreakdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    }
                  </button>
                  {preview && !previewFetching && (
                    <div className="px-3 py-2.5 space-y-1.5 text-xs">
                      <div className="flex justify-between text-[#6B7280]">
                        <span>Invoice Value</span><span className="font-medium text-[#111827]">{formatCurrency(previewValue)}</span>
                      </div>
                      <div className="flex justify-between text-[#6B7280]">
                        <span>Discount ({(preview.discount.discountRate * 100).toFixed(1)}% · {preview.discount.rateSource.replace(/_/g, ' ')})</span>
                        <span className="font-medium text-green-600">− {formatCurrency(preview.discount.discountAmount)}</span>
                      </div>
                      <div className="flex justify-between border-t border-[#F3F4F6] pt-1.5 text-[#111827] font-semibold">
                        <span>Net Value</span><span>{formatCurrency(preview.discount.netValue)}</span>
                      </div>
                      <div className="flex justify-between border-t border-[#F3F4F6] pt-1.5 text-[#BE123C] font-semibold">
                        <span>Points to Earn</span><span>+{formatNumber(preview.points.totalPoints)} pts</span>
                      </div>
                      {showBreakdown && preview.points.entries.length > 0 && (
                        <div className="mt-1 pt-1.5 border-t border-[#F3F4F6] space-y-1">
                          {preview.points.entries.map((e: any, i: number) => (
                            <div key={i} className="flex justify-between text-[#6B7280]">
                              <span>{e.note}</span>
                              <span className="font-medium text-[#374151]">+{e.points}</span>
                            </div>
                          ))}
                          <div className="flex justify-between text-[#6B7280] pt-0.5 border-t border-[#F3F4F6]">
                            <span>Current balance</span><span>{formatNumber(preview.memberYtdPoints)} pts</span>
                          </div>
                          <div className="flex justify-between text-[#BE123C] font-medium">
                            <span>New balance</span><span>{formatNumber(preview.memberYtdPoints + preview.points.totalPoints)} pts</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {createInvoice.isError && (
                <p className="text-sm text-[#BE123C]">{(createInvoice.error as any)?.response?.data?.error ?? 'Failed'}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={resetModal}
                  className="flex-1 px-4 py-2 border border-[#E5E7EB] rounded-lg text-sm font-medium text-[#374151] hover:bg-[#F9FAFB]">
                  Cancel
                </button>
                <button type="submit" disabled={createInvoice.isPending || !selectedMember}
                  className="flex-1 px-4 py-2 bg-[#BE123C] hover:bg-[#9F1239] text-white rounded-lg text-sm font-medium disabled:opacity-60">
                  {createInvoice.isPending ? 'Creating...' : 'Confirm Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Void Modal */}
      {voidingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-[#111827] mb-2">Void Invoice</h2>
            <p className="text-sm text-[#6B7280] mb-4">This will reverse all points earned from this invoice.</p>
            <textarea rows={3} value={voidReason} onChange={e => setVoidReason(e.target.value)}
              placeholder="Reason for voiding..."
              className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#BE123C] mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setVoidingId(null)}
                className="flex-1 px-4 py-2 border border-[#E5E7EB] rounded-lg text-sm font-medium text-[#374151] hover:bg-[#F9FAFB]">
                Cancel
              </button>
              <button onClick={() => voidInvoice.mutate({ id: voidingId, reason: voidReason })}
                disabled={!voidReason || voidInvoice.isPending}
                className="flex-1 px-4 py-2 bg-[#BE123C] hover:bg-[#9F1239] text-white rounded-lg text-sm font-medium disabled:opacity-60">
                {voidInvoice.isPending ? 'Voiding...' : 'Void Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
