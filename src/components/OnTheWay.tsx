import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const showToast = (msg: string, isError = false) => {
  try {
    const div = document.createElement('div');
    div.className = `fixed top-6 right-6 z-[9999] px-6 py-4 rounded-xl shadow-2xl font-bold text-sm transition-all duration-300 transform translate-y-0 opacity-100 ${isError ? 'bg-error text-on-error' : 'bg-primary text-on-primary'}`;
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => { div.classList.add('opacity-0', '-translate-y-4'); setTimeout(() => div.remove(), 300); }, 3000);
  } catch (e) { console.log(msg); }
};

const createEmptyRow = () => ({
  bpmNumber: '',
  poNumber: '',
  erpCode: '',
  qcCheckNo: '',
  qty: '',
  unit: 'Cái',
  deptCode: '',
  deptName: '',
  location: '',
  expectedDate: '',
  remark: '',
});

const OnTheWay = () => {
  const { profile, user } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'editor' || user?.email === 'natalietran071@gmail.com' || !profile;

  const [records, setRecords] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);
  const [rows, setRows] = useState(Array.from({ length: 5 }, createEmptyRow));
  const [filterStatus, setFilterStatus] = useState<'pending' | 'arrived' | 'cancelled' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [editingRecord, setEditingRecord] = useState<any | null>(null);
  const [arrivingRecord, setArrivingRecord] = useState<any | null>(null);
  const [arrivingDate, setArrivingDate] = useState(new Date().toISOString().split('T')[0]);
  const [arrivingLocation, setArrivingLocation] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inventoryMap = useMemo(() => {
    const m = new Map<string, any>();
    inventoryItems.forEach(i => m.set(i.erp, i));
    return m;
  }, [inventoryItems]);

  // ── load data ──────────────────────────────────────────────
  const loadRecords = async () => {
    try {
      let all: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('on_the_way')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      setRecords(all);
    } catch (err: any) {
      showToast('Lỗi tải dữ liệu: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const loadInventory = async () => {
    let all: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabase.from('inventory').select('erp,name,name_zh,spec,end_stock,unit').range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    setInventoryItems(all);
  };

  useEffect(() => {
    loadRecords();
    loadInventory();
  }, []);

  const handleSync = async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    try { await Promise.all([loadRecords(), loadInventory()]); }
    finally { setIsSyncing(false); syncingRef.current = false; }
  };

  // ── filtered list ──────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = records;
    if (filterStatus !== 'all') result = result.filter(r => r.status === filterStatus);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r =>
        (r.erp_code && r.erp_code.toLowerCase().includes(q)) ||
        (r.bpm_number && r.bpm_number.toLowerCase().includes(q)) ||
        (r.po_number && r.po_number.toLowerCase().includes(q)) ||
        (r.dept_name && r.dept_name.toLowerCase().includes(q)) ||
        (r.dept_code && r.dept_code.toLowerCase().includes(q)) ||
        (r.remark && r.remark.toLowerCase().includes(q))
      );
    }
    return [...result].sort((a, b) => {
      const da = a.created_at || '';
      const db = b.created_at || '';
      return sortOrder === 'desc' ? db.localeCompare(da) : da.localeCompare(db);
    });
  }, [records, filterStatus, searchQuery, sortOrder]);

  const stats = useMemo(() => {
    const pending = records.filter(r => r.status === 'pending');
    return {
      pendingCount: pending.length,
      pendingQty: pending.reduce((s, r) => s + Number(r.qty || 0), 0),
      pendingSKU: new Set(pending.map(r => r.erp_code)).size,
    };
  }, [records]);

  // ── row helpers ────────────────────────────────────────────
  const handleRowChange = (idx: number, field: string, value: string) => {
    const newRows = [...rows];
    (newRows[idx] as any)[field] = value;
    setRows(newRows);
  };

  const handlePaste = (e: React.ClipboardEvent, startIdx: number, startField: string) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const fields = ['bpmNumber', 'poNumber', 'erpCode', 'qcCheckNo', 'qty', 'unit', 'deptCode', 'deptName', 'location', 'expectedDate', 'remark'];
    const startFieldIdx = fields.indexOf(startField);
    if (startFieldIdx === -1) return;
    const pastedRows = text.trim().split('\n').map(r => r.split('\t'));
    const newRows = [...rows];
    pastedRows.forEach((cols, ri) => {
      const rowIdx = startIdx + ri;
      while (newRows.length <= rowIdx) newRows.push(createEmptyRow());
      cols.forEach((col, ci) => {
        const fieldIdx = startFieldIdx + ci;
        if (fieldIdx < fields.length) (newRows[rowIdx] as any)[fields[fieldIdx]] = col.trim();
      });
    });
    setRows(newRows);
  };

  // ── submit batch ───────────────────────────────────────────
  const handleBatchSubmit = async () => {
    const validRows = rows.filter(r => r.erpCode.trim() && Number(r.qty) > 0);
    if (validRows.length === 0) { showToast('Nhập ít nhất 1 dòng hợp lệ (ERP + số lượng)', true); return; }
    try {
      const records = validRows.map(r => ({
        bpm_number: r.bpmNumber.trim() || null,
        po_number: r.poNumber.trim() || null,
        erp_code: r.erpCode.trim().toUpperCase(),
        qc_check_no: r.qcCheckNo.trim() || null,
        qty: Number(r.qty),
        unit: r.unit || 'Cái',
        dept_code: r.deptCode.trim() || null,
        dept_name: r.deptName.trim() || null,
        location: r.location.trim() || null,
        expected_date: r.expectedDate || null,
        remark: r.remark.trim() || null,
        status: 'pending',
        created_by: profile?.username || user?.email || 'system',
      }));
      const { error } = await supabase.from('on_the_way').insert(records);
      if (error) throw error;
      showToast(`✅ Đã thêm ${records.length} đơn hàng On the Way`);
      setRows(Array.from({ length: 5 }, createEmptyRow));
      await loadRecords();
    } catch (err: any) {
      showToast('Lỗi: ' + err.message, true);
    }
  };

  const handleCancel = () => setRows(Array.from({ length: 5 }, createEmptyRow));

  // ── arrive: transfer to inbound ────────────────────────────
  const handleArriveConfirm = async () => {
    if (!arrivingRecord) return;
    try {
      const inboundRecord = {
        order_id: arrivingRecord.bpm_number || arrivingRecord.po_number || null,
        erp_code: arrivingRecord.erp_code,
        qty: arrivingRecord.qty,
        unit: arrivingRecord.unit || 'Cái',
        location: arrivingLocation || arrivingRecord.location || null,
        date: arrivingDate,
        dept_code: arrivingRecord.dept_code || null,
        dept_name: arrivingRecord.dept_name || null,
        po_number: arrivingRecord.po_number || null,
        qc_check_no: arrivingRecord.qc_check_no || null,
        remark: arrivingRecord.remark || null,
        otw_id: arrivingRecord.id,
        created_at: new Date().toISOString(),
        status: 'STOCKED',
      };

      // Insert to inbound_records
      const { data: inboundData, error: inboundErr } = await supabase
        .from('inbound_records')
        .insert([inboundRecord])
        .select()
        .single();
      if (inboundErr) throw inboundErr;

      // Update inventory in_qty + end_stock
      const { data: inv } = await supabase
        .from('inventory')
        .select('in_qty, end_stock')
        .eq('erp', arrivingRecord.erp_code)
        .single();
      if (inv) {
        await supabase.from('inventory').update({
          in_qty: (Number(inv.in_qty) || 0) + Number(arrivingRecord.qty),
          end_stock: (Number(inv.end_stock) || 0) + Number(arrivingRecord.qty),
          updated_at: new Date().toISOString(),
        }).eq('erp', arrivingRecord.erp_code);
      }

      // Mark on_the_way as arrived
      await supabase.from('on_the_way').update({
        status: 'arrived',
        arrived_inbound_id: inboundData?.id || null,
        updated_at: new Date().toISOString(),
      }).eq('id', arrivingRecord.id);

      showToast('✅ Đã nhập kho thành công! Tồn kho đã được cập nhật.');
      setArrivingRecord(null);
      await loadRecords();
    } catch (err: any) {
      showToast('Lỗi: ' + err.message, true);
    }
  };

  // ── cancel OTW ─────────────────────────────────────────────
  const handleCancelRecord = async (id: string) => {
    const { error } = await supabase.from('on_the_way').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { showToast('Lỗi: ' + error.message, true); return; }
    showToast('Đã huỷ đơn hàng');
    await loadRecords();
  };

  // ── export Excel ───────────────────────────────────────────
  const handleExport = () => {
    import('xlsx').then(XLSX => {
      const rows = filtered.map(r => ({
        'BPM Number': r.bpm_number || '',
        'PO Number': r.po_number || '',
        'Mã ERP': r.erp_code || '',
        'Tên vật tư': inventoryMap.get(r.erp_code)?.name || '',
        'QC Check No': r.qc_check_no || '',
        'Số lượng': r.qty,
        'Đơn vị': r.unit || '',
        'Mã bộ phận': r.dept_code || '',
        'Tên bộ phận': r.dept_name || '',
        'Vị trí': r.location || '',
        'Ngày dự kiến': r.expected_date || '',
        'Ghi chú': r.remark || '',
        'Trạng thái': r.status,
        'Ngày tạo': new Date(r.created_at).toLocaleString('vi-VN'),
        'Người tạo': r.created_by || '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'On The Way');
      XLSX.writeFile(wb, `On_The_Way_${new Date().toISOString().split('T')[0]}.xlsx`);
    });
  };

  const statusColor: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    arrived: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-rose-100 text-rose-600',
  };
  const statusLabel: Record<string, string> = {
    pending: 'Đang về',
    arrived: 'Đã về',
    cancelled: 'Đã huỷ',
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'SKU đang về', value: stats.pendingSKU.toLocaleString('en-US'), icon: 'inventory_2', color: 'text-primary' },
          { label: 'Tổng đơn đang về', value: stats.pendingCount.toLocaleString('en-US'), icon: 'local_shipping', color: 'text-amber-600' },
          { label: 'Tổng SL đang về', value: stats.pendingQty.toLocaleString('en-US'), icon: 'stack', color: 'text-secondary' },
        ].map(s => (
          <div key={s.label} className="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/10 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className={`material-symbols-outlined text-lg ${s.color}`}>{s.icon}</span>
              <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">{s.label}</span>
            </div>
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Create form ── */}
      {canEdit && (
        <section className="border border-outline-variant/10 rounded-[2rem] overflow-hidden shadow-sm bg-surface-container-lowest">
          <div className="p-6 sm:p-8">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-600">add_circle</span>
                  Thêm hàng đang trên đường về
                </h3>
                <p className="text-xs text-on-surface-variant mt-1">Hỗ trợ dán (Ctrl+V) trực tiếp từ Excel.</p>
              </div>
            </div>

            <div className="overflow-x-auto border border-outline-variant/20 rounded-xl max-h-[420px] overflow-y-auto no-scrollbar">
              <table className="w-full text-left border-collapse" style={{ minWidth: 1200 }}>
                <thead className="sticky top-0 bg-surface-container-highest z-20 border-b border-outline-variant/20">
                  <tr>
                    <th className="px-2 py-3 text-xs font-bold text-on-surface-variant uppercase text-center w-8">#</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[110px]">BPM Number</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[110px]">PO Number</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[150px]">Mã ERP (*)</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[130px]">Tên SP</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[110px]">QC Check No</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[90px]">SL (*)</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[80px]">ĐV</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[100px]">Mã BP</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[120px]">Tên bộ phận</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[100px]">Vị trí</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[130px]">Ngày dự kiến</th>
                    <th className="px-3 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[160px]">Remark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10 bg-surface-container-lowest text-sm">
                  {rows.map((row, idx) => {
                    const item = inventoryMap.get(row.erpCode.toUpperCase());
                    return (
                      <tr key={idx} className="hover:bg-surface-container-low transition-colors">
                        <td className="px-2 py-2 text-center text-on-surface-variant/40 text-[10px] font-bold select-none">{idx + 1}</td>
                        {(['bpmNumber', 'poNumber'] as const).map(f => (
                          <td key={f} className="p-0 border-r border-outline-variant/5">
                            <input type="text" value={(row as any)[f]} onChange={e => handleRowChange(idx, f, e.target.value)}
                              onPaste={e => handlePaste(e, idx, f)}
                              className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-3 py-3 text-sm font-medium" placeholder="..." />
                          </td>
                        ))}
                        <td className="p-0 border-r border-outline-variant/5">
                          <input list="otw-erp-options" type="text" value={row.erpCode}
                            onChange={e => handleRowChange(idx, 'erpCode', e.target.value.toUpperCase())}
                            onPaste={e => handlePaste(e, idx, 'erpCode')}
                            className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-3 py-3 text-sm font-bold text-primary"
                            placeholder="Nhập/Chọn ERP" />
                        </td>
                        <td className="p-0 border-r border-outline-variant/5 bg-on-surface/5">
                          <div className="px-3 py-2 text-[10px] font-medium text-on-surface-variant min-h-[52px]">
                            {item ? <><div className="font-bold text-on-surface line-clamp-1">{item.name}</div>{item.name_zh && <div className="opacity-60 text-[9px]">{item.name_zh}</div>}</> : <span className="italic opacity-40">-</span>}
                          </div>
                        </td>
                        <td className="p-0 border-r border-outline-variant/5">
                          <input type="text" value={row.qcCheckNo} onChange={e => handleRowChange(idx, 'qcCheckNo', e.target.value)}
                            onPaste={e => handlePaste(e, idx, 'qcCheckNo')}
                            className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-3 py-3 text-sm font-medium" placeholder="..." />
                        </td>
                        <td className={`p-0 border-r border-outline-variant/5 ${row.erpCode.trim() && !Number(row.qty) ? 'bg-amber-50' : ''}`}>
                          <input type="number" value={row.qty} onChange={e => handleRowChange(idx, 'qty', e.target.value)}
                            onPaste={e => handlePaste(e, idx, 'qty')}
                            className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-3 py-3 text-sm font-bold" placeholder="Nhập SL" min="1" />
                        </td>
                        <td className="p-0 border-r border-outline-variant/5">
                          <input type="text" value={row.unit} onChange={e => handleRowChange(idx, 'unit', e.target.value)}
                            className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-3 py-3 text-sm font-medium" placeholder="Cái" />
                        </td>
                        {(['deptCode', 'deptName', 'location'] as const).map(f => (
                          <td key={f} className="p-0 border-r border-outline-variant/5">
                            <input type="text" value={(row as any)[f]} onChange={e => handleRowChange(idx, f, e.target.value)}
                              onPaste={e => handlePaste(e, idx, f)}
                              className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-3 py-3 text-sm font-medium" placeholder="..." />
                          </td>
                        ))}
                        <td className="p-0 border-r border-outline-variant/5">
                          <input type="date" value={row.expectedDate} onChange={e => handleRowChange(idx, 'expectedDate', e.target.value)}
                            className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-3 py-3 text-sm font-medium text-on-surface-variant" />
                        </td>
                        <td className="p-0">
                          <input type="text" value={row.remark} onChange={e => handleRowChange(idx, 'remark', e.target.value)}
                            onPaste={e => handlePaste(e, idx, 'remark')}
                            className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-3 py-3 text-sm font-medium" placeholder="Ghi chú..." />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="otw-erp-options">
                {inventoryItems.map((item, i) => (
                  <option key={item.erp || i} value={item.erp}>{item.name} - Tồn: {item.end_stock?.toLocaleString('en-US')}</option>
                ))}
              </datalist>
            </div>

            <div className="flex justify-between items-center mt-4 bg-surface-container-low p-4 rounded-xl border border-outline-variant/20">
              <div className="text-sm font-medium text-on-surface-variant flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-600">info</span>
                {(() => {
                  const valid = rows.filter(r => r.erpCode.trim() && Number(r.qty) > 0).length;
                  const hasErpNoQty = rows.filter(r => r.erpCode.trim() && !Number(r.qty)).length;
                  if (valid > 0) return <span>Sẽ lưu <strong className="text-amber-600">{valid}</strong> đơn hợp lệ.</span>;
                  if (hasErpNoQty > 0) return <span className="text-amber-700">Đã có Mã ERP — vui lòng nhập <strong>Số lượng &gt; 0</strong> để kích hoạt nút.</span>;
                  return <span>Nhập <strong>Mã ERP</strong> + <strong>Số lượng &gt; 0</strong> để kích hoạt nút.</span>;
                })()}
              </div>
              <div className="flex gap-2">
                <button onClick={handleCancel} className="bg-surface-container-highest text-on-surface px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-surface-container-high transition-colors">Huỷ</button>
                <button onClick={handleBatchSubmit} disabled={!canEdit || rows.filter(r => r.erpCode.trim() && Number(r.qty) > 0).length === 0}
                  className="bg-amber-600 text-white px-8 py-2.5 rounded-xl font-bold text-sm shadow hover:bg-amber-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title={rows.filter(r => r.erpCode.trim() && Number(r.qty) > 0).length === 0 ? 'Cần nhập Mã ERP + Số lượng > 0' : ''}>
                  Thêm vào On the Way
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── List ── */}
      <section className="border border-outline-variant/10 rounded-[2rem] overflow-hidden shadow-sm bg-surface-container-lowest">
        {/* Header controls */}
        <div className="px-6 py-4 border-b border-outline-variant/10 flex flex-col md:flex-row gap-3 justify-between items-start md:items-center">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold">Danh sách hàng On the Way</h3>
            <div className="flex gap-1 bg-surface-container rounded-xl p-1 ml-2">
              {(['pending', 'arrived', 'cancelled', 'all'] as const).map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${filterStatus === s ? 'bg-amber-500 text-white' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
                  {s === 'all' ? 'Tất cả' : statusLabel[s]}
                  {s !== 'all' && <span className="ml-1 text-[10px]">({records.filter(r => r.status === s).length})</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative bg-surface-container-low px-3 py-2 rounded-xl border border-outline-variant/10">
              <input type="text" placeholder="Tìm ERP, BPM, PO, bộ phận..." value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-transparent border-none text-xs font-medium focus:ring-0 outline-none w-52" />
              <span className="material-symbols-outlined text-sm absolute right-3 top-1/2 -translate-y-1/2 text-outline-variant">search</span>
            </div>
            <button onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
              className="flex items-center gap-1.5 bg-surface-container-low px-3 py-2 rounded-xl border border-outline-variant/10 text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors">
              <span className="material-symbols-outlined text-sm">{sortOrder === 'desc' ? 'arrow_downward' : 'arrow_upward'}</span>
              {sortOrder === 'desc' ? 'Mới nhất' : 'Cũ nhất'}
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors">
              <span className="material-symbols-outlined text-sm">download</span>
              Xuất Excel
            </button>
            <button onClick={handleSync} disabled={isSyncing}
              className={`p-2 hover:bg-surface-container-high rounded-full transition-colors text-on-surface-variant ${isSyncing ? 'animate-spin text-primary' : ''}`}>
              <span className="material-symbols-outlined text-lg">refresh</span>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-on-surface-variant">
              <span className="material-symbols-outlined animate-spin text-3xl mr-3">progress_activity</span> Đang tải...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-40">
              <span className="material-symbols-outlined text-6xl">local_shipping</span>
              <p className="font-bold italic">Không có đơn hàng nào.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-sm" style={{ minWidth: 1100 }}>
              <thead className="bg-surface-container-low border-b border-outline-variant/20">
                <tr className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest">
                  <th className="py-4 px-4">Ngày tạo</th>
                  <th className="py-4 px-4">BPM / PO</th>
                  <th className="py-4 px-4">Mã ERP</th>
                  <th className="py-4 px-4">Tên vật tư</th>
                  <th className="py-4 px-4">QC Check No</th>
                  <th className="py-4 px-4 text-center">SL</th>
                  <th className="py-4 px-4">Bộ phận</th>
                  <th className="py-4 px-4">Vị trí / Ngày dự kiến</th>
                  <th className="py-4 px-4">Remark</th>
                  <th className="py-4 px-4 text-center">Trạng thái</th>
                  <th className="py-4 px-4 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {filtered.map(r => {
                  const item = inventoryMap.get(r.erp_code);
                  return (
                    <tr key={r.id} className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap text-on-surface-variant">
                        <div className="font-bold text-on-surface text-xs">{new Date(r.created_at).toLocaleDateString('vi-VN')}</div>
                        <div className="text-[10px] opacity-50">{r.created_by}</div>
                      </td>
                      <td className="py-3 px-4">
                        {r.bpm_number && <div className="font-bold text-primary text-xs">BPM: {r.bpm_number}</div>}
                        {r.po_number && <div className="text-[10px] text-on-surface-variant font-medium">PO: {r.po_number}</div>}
                        {!r.bpm_number && !r.po_number && <span className="opacity-30 italic text-xs">-</span>}
                      </td>
                      <td className="py-3 px-4 font-bold text-primary text-xs">{r.erp_code}</td>
                      <td className="py-3 px-4 max-w-[180px]">
                        <div className="font-medium text-on-surface text-xs line-clamp-2">{item?.name || <span className="italic opacity-40">-</span>}</div>
                        {item?.name_zh && <div className="text-[9px] opacity-50">{item.name_zh}</div>}
                      </td>
                      <td className="py-3 px-4 text-xs text-on-surface-variant">{r.qc_check_no || <span className="opacity-30">-</span>}</td>
                      <td className="py-3 px-4 text-center font-bold text-on-surface">{Number(r.qty).toLocaleString('en-US')} <span className="text-[10px] font-normal text-on-surface-variant">{r.unit}</span></td>
                      <td className="py-3 px-4">
                        {r.dept_code && <div className="text-[10px] font-bold text-on-surface">{r.dept_code}</div>}
                        {r.dept_name && <div className="text-[10px] text-on-surface-variant">{r.dept_name}</div>}
                        {!r.dept_code && !r.dept_name && <span className="opacity-30 text-xs">-</span>}
                      </td>
                      <td className="py-3 px-4">
                        {r.location && <div className="text-xs font-medium text-on-surface">{r.location}</div>}
                        {r.expected_date && <div className="text-[10px] text-amber-600 font-bold">📅 {r.expected_date}</div>}
                      </td>
                      <td className="py-3 px-4 max-w-[160px]">
                        <div className="text-xs text-on-surface-variant italic line-clamp-2">{r.remark || <span className="opacity-30">-</span>}</div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${statusColor[r.status] || 'bg-gray-100 text-gray-600'}`}>
                          {statusLabel[r.status] || r.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1.5">
                          {r.status === 'pending' && canEdit && (
                            <>
                              <button
                                onClick={() => { setArrivingRecord(r); setArrivingLocation(r.location || ''); setArrivingDate(new Date().toISOString().split('T')[0]); }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-bold hover:bg-emerald-700 transition-colors shadow-sm"
                                title="Hàng đã về, nhập kho"
                              >
                                <span className="material-symbols-outlined text-sm">input</span>
                                Nhập kho
                              </button>
                              <button
                                onClick={() => handleCancelRecord(r.id)}
                                className="p-1.5 rounded-lg text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors"
                                title="Huỷ đơn"
                              >
                                <span className="material-symbols-outlined text-base">cancel</span>
                              </button>
                            </>
                          )}
                          {r.status === 'arrived' && (
                            <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                              <span className="material-symbols-outlined text-sm">check_circle</span> Đã nhập kho
                            </span>
                          )}
                          {r.status === 'cancelled' && (
                            <span className="text-[10px] text-rose-500 italic">Đã huỷ</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-outline-variant/10 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
          Hiển thị {filtered.length} / {records.length} đơn
        </div>
      </section>

      {/* ── Arrive confirmation modal ── */}
      <AnimatePresence>
        {arrivingRecord && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-md border border-outline-variant/10 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700">
                  <span className="material-symbols-outlined text-2xl">input</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold">Xác nhận nhập kho</h3>
                  <p className="text-xs text-on-surface-variant">ERP: <strong className="text-primary">{arrivingRecord.erp_code}</strong> — SL: <strong>{Number(arrivingRecord.qty).toLocaleString('en-US')} {arrivingRecord.unit}</strong></p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Ngày nhập kho</label>
                  <input type="date" value={arrivingDate} onChange={e => setArrivingDate(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Vị trí lưu kho</label>
                  <input type="text" value={arrivingLocation} onChange={e => setArrivingLocation(e.target.value)}
                    placeholder={arrivingRecord.location || 'VD: A1-01'}
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-3 mt-8">
                <button onClick={() => setArrivingRecord(null)}
                  className="flex-1 py-3 bg-surface-container-high text-on-surface rounded-xl font-bold text-sm hover:bg-surface-container-highest transition-colors">
                  Huỷ
                </button>
                <button onClick={handleArriveConfirm}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm shadow hover:bg-emerald-700 transition-all">
                  ✅ Xác nhận nhập kho
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OnTheWay;
