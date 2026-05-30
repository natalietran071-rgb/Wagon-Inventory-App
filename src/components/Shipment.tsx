import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { exportToExcelMultiSheet } from '../lib/excelUtils';

// ─── Toast ───────────────────────────────────────────────────────────────────
const showToast = (msg: string, isError = false) => {
  try {
    const div = document.createElement('div');
    div.className = `fixed top-6 right-6 z-[9999] px-6 py-4 rounded-xl shadow-2xl font-bold text-sm transition-all duration-300 transform translate-y-0 opacity-100 ${isError ? 'bg-error text-on-error' : 'bg-primary text-on-primary'}`;
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => {
      div.classList.add('opacity-0', '-translate-y-4');
      setTimeout(() => div.remove(), 300);
    }, 3000);
  } catch (e) {
    console.log(msg);
  }
};

// ─── Types ────────────────────────────────────────────────────────────────────
type ShipmentStatus = 'Pending' | 'Confirmed' | 'Rejected' | 'Returned';

interface ShipmentItem {
  erp_code: string;
  qty: number;
  location: string;
  required_date: string;
}

interface Shipment {
  id: string;
  outbound_id: string;
  bpm_number: string;
  recipient_id: string;
  recipient_name: string;
  dept_code: string;
  dept_name: string;
  status: ShipmentStatus;
  shipped_at: string;
  confirmed_at: string | null;
  confirmed_by_email: string | null;
  confirmed_by_name: string | null;
  rejection_note: string | null;
  return_confirmed_at: string | null;
  return_confirmed_by: string | null;
  created_at: string;
  total_qty: number;
  item_count: number;
  items: ShipmentItem[] | string;
}

type ActiveTab = 'pending' | 'processed' | 'all';
type ModalAction = 'confirm' | 'reject';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const parseItems = (raw: ShipmentItem[] | string): ShipmentItem[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw as string);
  } catch {
    return [];
  }
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch {
    return iso;
  }
};

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso ?? '—';
  }
};

// ─── Status badge ─────────────────────────────────────────────────────────────
const StatusBadge: React.FC<{ status: ShipmentStatus }> = ({ status }) => {
  const map: Record<ShipmentStatus, { label: string; cls: string }> = {
    Pending:   { label: 'Chờ xác nhận', cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
    Confirmed: { label: 'Đã xác nhận',  cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
    Rejected:  { label: 'Bị từ chối',   cls: 'bg-red-100 text-red-700 border border-red-200' },
    Returned:  { label: 'Đã nhận lại',  cls: 'bg-blue-100 text-blue-600 border border-blue-200' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-surface-container text-on-surface-variant border border-outline-variant/20' };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black ${cls}`}>
      {label}
    </span>
  );
};

// ─── Confirm/Reject Modal ─────────────────────────────────────────────────────
interface ModalProps {
  shipment: Shipment;
  action: ModalAction;
  onClose: () => void;
  onSuccess: () => void;
  userEmail: string;
  userName: string;
}

const ActionModal: React.FC<ModalProps> = ({ shipment, action, onClose, onSuccess, userEmail, userName }) => {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const items = parseItems(shipment.items);
  const isReject = action === 'reject';

  const handleSubmit = async () => {
    if (isReject && !note.trim()) {
      showToast('Vui lòng nhập lý do từ chối.', true);
      return;
    }
    setLoading(true);
    try {
      const rpc = isReject ? 'reject_shipment' : 'confirm_shipment';
      const { data, error } = await supabase.rpc(rpc, {
        p_confirmation_id: shipment.id,
        p_by_email: userEmail,
        p_by_name: userName,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      if (data?.success === false) {
        showToast(data.error ?? 'Có lỗi xảy ra.', true);
        return;
      }
      showToast(isReject ? 'Đã từ chối phiếu giao hàng.' : 'Đã xác nhận nhận hàng!');
      onSuccess();
      onClose();
    } catch (err: any) {
      showToast('Lỗi: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-lg bg-surface-container-lowest rounded-3xl shadow-2xl border border-outline-variant/10 overflow-hidden z-10"
      >
        {/* Header */}
        <div className={`px-6 py-4 flex items-center justify-between ${isReject ? 'bg-red-50 border-b border-red-100' : 'bg-emerald-50 border-b border-emerald-100'}`}>
          <div className="flex items-center gap-2">
            <span className={`material-symbols-outlined text-xl ${isReject ? 'text-red-600' : 'text-emerald-600'}`}>
              {isReject ? 'cancel' : 'check_circle'}
            </span>
            <h3 className="font-black text-on-surface text-base">
              {isReject ? 'Từ chối phiếu giao hàng' : 'Xác nhận đã nhận hàng'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-black/10 transition-colors">
            <span className="material-symbols-outlined text-base text-on-surface-variant">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Shipment info */}
          <div className="bg-surface-container-low rounded-2xl p-4 space-y-2 border border-outline-variant/10">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-black text-primary text-sm">{shipment.outbound_id}</span>
              {shipment.bpm_number && (
                <span className="text-xs text-on-surface-variant font-bold bg-surface-container px-2 py-0.5 rounded-lg">BPM: {shipment.bpm_number}</span>
              )}
              <StatusBadge status={shipment.status} />
            </div>
            <div className="text-sm text-on-surface-variant font-medium">
              <span className="font-bold text-on-surface">{shipment.recipient_name}</span>
              {shipment.dept_name && <span> · {shipment.dept_name}</span>}
            </div>
            <div className="text-xs text-on-surface-variant">
              Ngày xuất: {fmtDate(shipment.shipped_at)} · {shipment.item_count} mặt hàng · Tổng: <span className="font-black text-on-surface">{Number(shipment.total_qty).toLocaleString()}</span>
            </div>
          </div>

          {/* Items */}
          {items.length > 0 && (
            <div>
              <p className="text-xs font-black text-on-surface-variant uppercase tracking-wider mb-2">Chi tiết hàng hóa</p>
              <div className="rounded-2xl overflow-hidden border border-outline-variant/10">
                <table className="w-full text-xs">
                  <thead className="bg-surface-container">
                    <tr>
                      <th className="text-left px-3 py-2 font-black text-on-surface-variant">ERP</th>
                      <th className="text-right px-3 py-2 font-black text-on-surface-variant">SL</th>
                      <th className="text-left px-3 py-2 font-black text-on-surface-variant">Vị trí</th>
                      <th className="text-left px-3 py-2 font-black text-on-surface-variant">Ngày YC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i} className="border-t border-outline-variant/10 even:bg-surface-container-low/30">
                        <td className="px-3 py-2 font-mono font-bold text-primary">{item.erp_code}</td>
                        <td className="px-3 py-2 text-right font-black text-on-surface">{Number(item.qty).toLocaleString()}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{item.location || '—'}</td>
                        <td className="px-3 py-2 text-on-surface-variant">{fmtDate(item.required_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Note textarea */}
          <div>
            <label className="text-xs font-black text-on-surface-variant uppercase tracking-wider block mb-1.5">
              {isReject ? 'Lý do từ chối *' : 'Ghi chú (tuỳ chọn)'}
            </label>
            <textarea
              className="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 py-2.5 text-sm font-medium text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              rows={3}
              placeholder={isReject ? 'Lý do từ chối...' : 'Ghi chú thêm (nếu có)...'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoFocus={isReject}
            />
            {isReject && !note.trim() && (
              <p className="text-xs text-error mt-1 font-medium">Bắt buộc nhập lý do từ chối.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex gap-3 border-t border-outline-variant/10 bg-surface-container-low/50">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant transition-all border border-outline-variant/10 disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || (isReject && !note.trim())}
            className={`flex-1 py-2.5 rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isReject
                ? 'bg-error text-on-error hover:bg-error/90'
                : 'bg-primary text-on-primary hover:bg-primary/90'
            }`}
          >
            {loading && <span className="material-symbols-outlined text-base animate-spin">sync</span>}
            {isReject ? 'Xác nhận từ chối' : 'Xác nhận nhận hàng'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// ─── Shipment Card ────────────────────────────────────────────────────────────
interface CardProps {
  shipment: Shipment;
  isWarehouse: boolean;
  userDeptCode: string;
  onAction: (shipment: Shipment, action: ModalAction) => void;
  onReturnConfirm: (shipment: Shipment) => void;
}

const ShipmentCard: React.FC<CardProps> = ({ shipment, isWarehouse, userDeptCode, onAction, onReturnConfirm }) => {
  const [expanded, setExpanded] = useState(false);
  const items = parseItems(shipment.items);

  const canAct = shipment.status === 'Pending' && (isWarehouse || shipment.dept_code === userDeptCode);
  const canConfirmReturn = isWarehouse && shipment.status === 'Rejected';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="bg-surface-container-lowest rounded-3xl border border-outline-variant/10 shadow-sm overflow-hidden"
    >
      {/* Top row */}
      <div className="px-5 pt-5 pb-3 flex flex-col sm:flex-row sm:items-start gap-3">
        {/* Left: IDs */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="font-mono font-black text-primary text-sm tracking-tight bg-primary/5 px-2.5 py-0.5 rounded-lg border border-primary/10">
              {shipment.outbound_id}
            </span>
            {shipment.bpm_number && (
              <span className="text-xs font-bold text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-lg border border-outline-variant/10">
                BPM: {shipment.bpm_number}
              </span>
            )}
            <StatusBadge status={shipment.status} />
          </div>

          {/* Recipient */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="material-symbols-outlined text-base text-on-surface-variant">person</span>
            <span className="font-bold text-on-surface text-sm">{shipment.recipient_name}</span>
            {shipment.dept_name && (
              <span className="text-xs text-on-surface-variant font-medium">· {shipment.dept_name}</span>
            )}
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant font-medium">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">inventory_2</span>
              {Number(shipment.item_count)} mặt hàng
            </span>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">pin</span>
              Tổng: <span className="font-black text-on-surface ml-0.5">{Number(shipment.total_qty).toLocaleString()}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">local_shipping</span>
              {fmtDate(shipment.shipped_at)}
            </span>
          </div>
        </div>

        {/* Right: Date + expand toggle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-xs font-bold text-on-surface-variant border border-outline-variant/10 transition-all"
            aria-label="Toggle items"
          >
            <span className="material-symbols-outlined text-sm">{expanded ? 'expand_less' : 'expand_more'}</span>
            {expanded ? 'Thu gọn' : 'Chi tiết'}
          </button>
        </div>
      </div>

      {/* Confirmed / Rejected info */}
      {(shipment.status === 'Confirmed' || shipment.status === 'Returned') && shipment.confirmed_at && (
        <div className="mx-5 mb-3 px-4 py-2 bg-emerald-50 rounded-xl border border-emerald-100 text-xs text-emerald-700 font-medium flex flex-wrap gap-x-3 gap-y-1">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            Xác nhận bởi: <span className="font-black ml-0.5">{shipment.confirmed_by_name || shipment.confirmed_by_email || '—'}</span>
          </span>
          <span>{fmtDateTime(shipment.confirmed_at)}</span>
        </div>
      )}

      {shipment.status === 'Rejected' && (
        <div className="mx-5 mb-3 px-4 py-2 bg-red-50 rounded-xl border border-red-100 text-xs text-red-700 font-medium">
          <span className="flex items-center gap-1 mb-0.5">
            <span className="material-symbols-outlined text-sm">cancel</span>
            <span className="font-black">Bị từ chối bởi: {shipment.confirmed_by_name || shipment.confirmed_by_email || '—'}</span>
            <span className="ml-auto text-red-500">{fmtDateTime(shipment.confirmed_at)}</span>
          </span>
          {shipment.rejection_note && (
            <p className="text-red-600 mt-1 font-medium">Lý do: {shipment.rejection_note}</p>
          )}
        </div>
      )}

      {shipment.status === 'Returned' && shipment.return_confirmed_at && (
        <div className="mx-5 mb-3 px-4 py-2 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700 font-medium flex flex-wrap gap-x-3 gap-y-1">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">undo</span>
            Nhận lại bởi kho: <span className="font-black ml-0.5">{shipment.return_confirmed_by || '—'}</span>
          </span>
          <span>{fmtDateTime(shipment.return_confirmed_at)}</span>
        </div>
      )}

      {/* Collapsible items */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="items"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="mx-5 mb-4 rounded-2xl overflow-hidden border border-outline-variant/10">
              <table className="w-full text-xs">
                <thead className="bg-surface-container">
                  <tr>
                    <th className="text-left px-3 py-2 font-black text-on-surface-variant uppercase tracking-wider">ERP Code</th>
                    <th className="text-right px-3 py-2 font-black text-on-surface-variant uppercase tracking-wider">Số lượng</th>
                    <th className="text-left px-3 py-2 font-black text-on-surface-variant uppercase tracking-wider">Vị trí</th>
                    <th className="text-left px-3 py-2 font-black text-on-surface-variant uppercase tracking-wider">Ngày yêu cầu</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-on-surface-variant italic">Không có dữ liệu</td>
                    </tr>
                  ) : (
                    items.map((item, i) => (
                      <tr key={i} className="border-t border-outline-variant/10 even:bg-surface-container-low/30">
                        <td className="px-3 py-2 font-mono font-black text-primary">{item.erp_code}</td>
                        <td className="px-3 py-2 text-right font-black text-on-surface">{Number(item.qty).toLocaleString()}</td>
                        <td className="px-3 py-2 text-on-surface-variant font-medium">{item.location || '—'}</td>
                        <td className="px-3 py-2 text-on-surface-variant font-medium">{fmtDate(item.required_date)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action buttons */}
      {(canAct || canConfirmReturn) && (
        <div className="px-5 pb-5 pt-1 flex flex-wrap gap-2">
          {canAct && (
            <>
              <button
                onClick={() => onAction(shipment, 'confirm')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs transition-all shadow-sm"
              >
                <span className="material-symbols-outlined text-sm">check_circle</span>
                Xác nhận đã nhận
              </button>
              <button
                onClick={() => onAction(shipment, 'reject')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border-2 border-error text-error hover:bg-error/5 font-black text-xs transition-all"
              >
                <span className="material-symbols-outlined text-sm">cancel</span>
                Từ chối
              </button>
            </>
          )}
          {canConfirmReturn && (
            <button
              onClick={() => onReturnConfirm(shipment)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-xs transition-all shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">undo</span>
              Xác nhận nhận lại kho
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const Shipment: React.FC = () => {
  const { profile, user } = useAuth();

  const isWarehouse = profile?.role === 'admin' || profile?.role === 'editor';
  const deptCode = isWarehouse ? null : (profile?.dept_code ?? null);

  // ── State ──
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | 'all'>('all');
  const [activeTab, setActiveTab] = useState<ActiveTab>('pending');

  const [modalShipment, setModalShipment] = useState<Shipment | null>(null);
  const [modalAction, setModalAction] = useState<ModalAction>('confirm');

  // ── Fetch ──
  const fetchShipments = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_shipments', {
        p_dept_code: deptCode,
        p_status: null,
        p_from_date: filterFrom || null,
        p_to_date: filterTo || null,
      });
      if (error) throw error;
      setShipments((data as Shipment[]) ?? []);
    } catch (err: any) {
      showToast('Lỗi tải dữ liệu: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  }, [deptCode, filterFrom, filterTo]);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  // ── Filtered list ──
  const filtered = useMemo(() => {
    let list = [...shipments];

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter(s => s.status === statusFilter);
    }

    // Tab filter
    if (activeTab === 'pending') {
      list = list.filter(s => s.status === 'Pending');
    } else if (activeTab === 'processed') {
      list = list.filter(s => s.status !== 'Pending');
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        (s.outbound_id && s.outbound_id.toLowerCase().includes(q)) ||
        (s.bpm_number && s.bpm_number.toLowerCase().includes(q)) ||
        (s.recipient_name && s.recipient_name.toLowerCase().includes(q)) ||
        (s.dept_name && s.dept_name.toLowerCase().includes(q))
      );
    }

    return list;
  }, [shipments, statusFilter, activeTab, searchQuery]);

  // ── Summary counts ──
  const counts = useMemo(() => ({
    pending: shipments.filter(s => s.status === 'Pending').length,
    confirmed: shipments.filter(s => s.status === 'Confirmed').length,
    rejected: shipments.filter(s => s.status === 'Rejected').length,
  }), [shipments]);

  // ── Action handlers ──
  const openModal = (shipment: Shipment, action: ModalAction) => {
    setModalShipment(shipment);
    setModalAction(action);
  };

  const handleReturnConfirm = async (shipment: Shipment) => {
    if (!isWarehouse) return;
    const ok = window.confirm(`Xác nhận kho đã nhận lại hàng từ phiếu ${shipment.outbound_id}?`);
    if (!ok) return;
    try {
      const { data, error } = await supabase.rpc('confirm_shipment_return', {
        p_confirmation_id: shipment.id,
        p_by_email: user?.email ?? '',
      });
      if (error) throw error;
      if (data?.success === false) {
        showToast(data.error ?? 'Có lỗi xảy ra.', true);
        return;
      }
      showToast('Đã xác nhận kho nhận lại hàng!');
      fetchShipments();
    } catch (err: any) {
      showToast('Lỗi: ' + err.message, true);
    }
  };

  // ── Export ──
  const handleExport = async () => {
    setExporting(true);
    showToast('Đang chuẩn bị xuất dữ liệu...');
    try {
      const PAGE = 1000;
      let allData: Shipment[] = [];
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase.rpc('get_shipments', {
          p_dept_code: deptCode,
          p_status: null,
          p_from_date: filterFrom || null,
          p_to_date: filterTo || null,
        });
        // Note: get_shipments RPC — paginate via range if needed
        if (error) throw error;
        const rows = (data as Shipment[]) ?? [];
        allData = rows; // RPC returns all; use range only if table-based
        hasMore = false; // RPC handles all rows in one call
        page++;
        // If we wanted table-based pagination: break when rows.length < PAGE
        void page;
        void PAGE;
      }

      if (allData.length === 0) {
        showToast('Không có dữ liệu để xuất.', true);
        return;
      }

      const rows = allData.map(s => ({
        'Phiếu xuất': s.outbound_id,
        'BPM': s.bpm_number || '',
        'Bộ phận': s.dept_name || '',
        'Người nhận': s.recipient_name || '',
        'Tổng SL': Number(s.total_qty),
        'Trạng thái': s.status,
        'Ngày xuất': fmtDate(s.shipped_at),
        'Ngày xác nhận': fmtDate(s.confirmed_at),
        'Người xác nhận': s.confirmed_by_name || s.confirmed_by_email || '',
        'Ghi chú': s.rejection_note || '',
      }));

      const today = new Date().toISOString().split('T')[0];
      const fileName = `giao-hang_${today}.xlsx`;
      exportToExcelMultiSheet(rows, fileName, 'Giao Hàng');
      showToast(`Đã xuất ${rows.length.toLocaleString()} phiếu!`);
    } catch (err: any) {
      showToast('Lỗi xuất Excel: ' + err.message, true);
    } finally {
      setExporting(false);
    }
  };

  // ── Summary card ──
  const SummaryCard: React.FC<{
    label: string;
    count: number;
    icon: string;
    color: string;
    bgColor: string;
    onClick?: () => void;
    active?: boolean;
  }> = ({ label, count, icon, color, bgColor, onClick, active }) => (
    <button
      onClick={onClick}
      className={`flex-1 min-w-0 bg-surface-container-low rounded-2xl border transition-all duration-200 p-3 md:p-4 text-left ${
        active
          ? 'border-primary/40 shadow-md bg-primary/5'
          : 'border-outline-variant/10 hover:border-outline-variant/30 hover:shadow-sm'
      }`}
    >
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-xl mb-2 ${bgColor}`}>
        <span className={`material-symbols-outlined text-base ${color}`}>{icon}</span>
      </div>
      <div className={`text-xl md:text-2xl font-black leading-none tracking-tight ${color}`}>{count.toLocaleString()}</div>
      <div className="text-[10px] md:text-xs font-bold text-on-surface-variant mt-0.5 leading-tight">{label}</div>
    </button>
  );

  // ── Tab config ──
  const tabs: { key: ActiveTab; label: string }[] = [
    { key: 'pending', label: 'Chờ xác nhận' },
    { key: 'processed', label: 'Đã xử lý' },
    { key: 'all', label: 'Tất cả' },
  ];

  return (
    <div className="space-y-6 md:space-y-8">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between items-start gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-black text-on-surface tracking-tight mb-1">Giao Hàng</h2>
          <p className="text-xs md:text-sm text-on-surface-variant font-medium opacity-70">
            {isWarehouse
              ? 'Theo dõi và xác nhận phiếu giao hàng đến các bộ phận.'
              : `Phiếu giao hàng của bộ phận ${profile?.dept_name ?? '—'}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button
            onClick={fetchShipments}
            disabled={loading}
            className="flex-1 md:flex-none justify-center px-4 md:px-5 py-2.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant font-bold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-sm border border-outline-variant/10 text-xs md:text-sm disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-lg ${loading ? 'animate-spin' : ''}`}>sync</span>
            <span>Đồng bộ</span>
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="flex-1 md:flex-none justify-center px-4 md:px-5 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary font-bold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-sm border border-primary/20 text-xs md:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-lg">{exporting ? 'sync' : 'file_download'}</span>
            <span>{exporting ? 'Đang xuất...' : 'Xuất Excel'}</span>
          </button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="flex gap-2 md:gap-4">
        <SummaryCard
          label="Chờ xác nhận"
          count={counts.pending}
          icon="pending"
          color="text-amber-600"
          bgColor="bg-amber-100"
          onClick={() => setActiveTab('pending')}
          active={activeTab === 'pending'}
        />
        <SummaryCard
          label="Đã xác nhận"
          count={counts.confirmed}
          icon="check_circle"
          color="text-emerald-600"
          bgColor="bg-emerald-100"
          onClick={() => setActiveTab('processed')}
          active={activeTab === 'processed'}
        />
        <SummaryCard
          label="Bị từ chối"
          count={counts.rejected}
          icon="cancel"
          color="text-red-600"
          bgColor="bg-red-100"
          onClick={() => setActiveTab('processed')}
          active={false}
        />
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2 bg-surface-container-low p-2 md:p-3 rounded-2xl shadow-sm border border-outline-variant/10">
        {/* Search */}
        <div className="flex items-center flex-1 min-w-[160px] bg-surface-container rounded-xl px-3 py-2 border border-outline-variant/10">
          <span className="material-symbols-outlined text-sm text-on-surface-variant mr-2">search</span>
          <input
            type="text"
            placeholder="Tìm phiếu xuất, BPM, người nhận..."
            className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-on-surface placeholder:text-on-surface-variant/40"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-on-surface-variant/50 hover:text-error transition-colors">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          )}
        </div>

        <div className="w-px h-8 bg-outline-variant/20 hidden sm:block" />

        {/* Status filter */}
        <div className="flex items-center gap-1.5 px-2">
          <span className="material-symbols-outlined text-sm text-on-surface-variant">filter_list</span>
          <select
            className="bg-transparent border-none text-xs font-bold focus:ring-0 cursor-pointer text-on-surface-variant appearance-none outline-none pr-3"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ShipmentStatus | 'all')}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="Pending">Chờ xác nhận</option>
            <option value="Confirmed">Đã xác nhận</option>
            <option value="Rejected">Bị từ chối</option>
            <option value="Returned">Đã nhận lại</option>
          </select>
        </div>

        <div className="w-px h-8 bg-outline-variant/20 hidden sm:block" />

        {/* Date range */}
        <div className="flex items-center gap-1.5 px-2 flex-wrap">
          <span className="material-symbols-outlined text-sm text-on-surface-variant">calendar_today</span>
          <input
            type="date"
            className="bg-transparent border-none text-xs font-bold focus:ring-0 cursor-pointer text-on-surface-variant outline-none min-w-[100px]"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
          />
          <span className="text-xs text-on-surface-variant font-bold">→</span>
          <input
            type="date"
            className="bg-transparent border-none text-xs font-bold focus:ring-0 cursor-pointer text-on-surface-variant outline-none min-w-[100px]"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
          />
          {(filterFrom || filterTo) && (
            <button
              onClick={() => { setFilterFrom(''); setFilterTo(''); }}
              className="text-on-surface-variant/50 hover:text-error transition-colors"
              title="Xoá bộ lọc ngày"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-surface-container-low p-1 rounded-2xl border border-outline-variant/10 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all duration-200 ${
              activeTab === tab.key
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            {tab.label}
            {tab.key === 'pending' && counts.pending > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black ${activeTab === tab.key ? 'bg-white/25 text-on-primary' : 'bg-amber-500 text-white'}`}>
                {counts.pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── List ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <span className="material-symbols-outlined text-4xl text-primary animate-spin">sync</span>
          <p className="text-on-surface-variant font-bold text-sm">Đang tải dữ liệu...</p>
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center py-20 gap-3"
        >
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">local_shipping</span>
          <p className="text-on-surface-variant font-bold text-sm">
            {activeTab === 'pending' ? 'Không có phiếu nào chờ xác nhận.' : 'Không tìm thấy phiếu nào.'}
          </p>
          {(searchQuery || statusFilter !== 'all' || filterFrom || filterTo) && (
            <button
              onClick={() => { setSearchQuery(''); setStatusFilter('all'); setFilterFrom(''); setFilterTo(''); }}
              className="text-xs text-primary font-bold hover:underline"
            >
              Xoá bộ lọc
            </button>
          )}
        </motion.div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-on-surface-variant font-bold px-1">
            Hiển thị {filtered.length.toLocaleString()} phiếu
          </p>
          <AnimatePresence mode="popLayout">
            {filtered.map(shipment => (
              <ShipmentCard
                key={shipment.id}
                shipment={shipment}
                isWarehouse={isWarehouse}
                userDeptCode={profile?.dept_code ?? ''}
                onAction={openModal}
                onReturnConfirm={handleReturnConfirm}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Modal ── */}
      <AnimatePresence>
        {modalShipment && (
          <ActionModal
            key="modal"
            shipment={modalShipment}
            action={modalAction}
            onClose={() => setModalShipment(null)}
            onSuccess={fetchShipments}
            userEmail={user?.email ?? ''}
            userName={profile?.full_name ?? user?.email ?? ''}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Shipment;
