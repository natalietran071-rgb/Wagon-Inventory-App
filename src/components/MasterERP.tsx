import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type MasterItem = {
  id: string;
  erp: string;
  name: string | null;
  name_zh: string | null;
  spec: string | null;
  unit: string | null;
  updated_at: string;
};

type PendingItem = {
  id: string;
  erp: string;
  name: string | null;
  name_zh: string | null;
  spec: string | null;
  unit: string | null;
  reason: string;
  created_at: string;
};

type Toast = { msg: string; error?: boolean };

const PAGE_SIZE = 50;

const REASON_LABEL: Record<string, string> = {
  duplicate_in_file: 'Trùng Mã ERP trong file',
};

const MasterERP = () => {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'editor';

  const [tab, setTab] = useState<'master' | 'pending'>('master');

  // Master tab state
  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [missingName, setMissingName] = useState(0);
  const [missingSpec, setMissingSpec] = useState(0);
  const [page, setPage] = useState(0);
  const [activeFilter, setActiveFilter] = useState<'all' | 'no_name' | 'no_spec'>('all');

  // Pending tab state
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingPage, setPendingPage] = useState(0);
  const [pendingSearch, setPendingSearch] = useState('');

  // Edit state (shared between master & pending)
  const [editTarget, setEditTarget] = useState<{ type: 'master' | 'pending'; item: MasterItem | PendingItem } | null>(null);
  const [editForm, setEditForm] = useState({ erp: '', name: '', name_zh: '', spec: '', unit: '' });

  // Upload state
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadSummary, setUploadSummary] = useState<{ ok: number; pending: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Fetch stats ───────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    const [{ count: total }, { count: noName }, { count: noSpec }, { count: pCount }] = await Promise.all([
      supabase.from('master_erp').select('*', { count: 'exact', head: true }),
      supabase.from('master_erp').select('*', { count: 'exact', head: true }).is('name', null),
      supabase.from('master_erp').select('*', { count: 'exact', head: true }).is('spec', null),
      supabase.from('master_erp_pending').select('*', { count: 'exact', head: true }),
    ]);
    setTotalCount(total || 0);
    setMissingName(noName || 0);
    setMissingSpec(noSpec || 0);
    setPendingCount(pCount || 0);
  }, []);

  // ── Fetch master items ────────────────────────────────────
  const fetchItems = useCallback(async (search = searchQuery, pg = page, filter = activeFilter) => {
    setLoading(true);
    try {
      let q = supabase
        .from('master_erp')
        .select('*', { count: 'exact' })
        .order('erp', { ascending: true })
        .range(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE - 1);
      if (search.trim()) q = q.or(`erp.ilike.%${search}%,name.ilike.%${search}%,name_zh.ilike.%${search}%,spec.ilike.%${search}%`);
      if (filter === 'no_name') q = q.is('name', null);
      if (filter === 'no_spec') q = q.is('spec', null);
      const { data, error, count } = await q;
      if (error) throw error;
      setItems(data || []);
      setTotalCount(count || 0);
    } catch (err: any) {
      showToast('Lỗi tải dữ liệu: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, page, activeFilter]);

  // ── Fetch pending items ───────────────────────────────────
  const fetchPending = useCallback(async (search = pendingSearch, pg = pendingPage) => {
    setPendingLoading(true);
    try {
      let q = supabase
        .from('master_erp_pending')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE - 1);
      if (search.trim()) q = q.or(`erp.ilike.%${search}%,name.ilike.%${search}%`);
      const { data, error, count } = await q;
      if (error) throw error;
      setPendingItems(data || []);
      setPendingCount(count || 0);
    } catch (err: any) {
      showToast('Lỗi tải pending: ' + err.message, true);
    } finally {
      setPendingLoading(false);
    }
  }, [pendingSearch, pendingPage]);

  useEffect(() => { fetchStats(); }, []);
  useEffect(() => { fetchItems(searchQuery, page, activeFilter); }, [page, activeFilter]);
  useEffect(() => { if (tab === 'pending') fetchPending(pendingSearch, pendingPage); }, [pendingPage, tab]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchItems(searchQuery, 0, activeFilter);
  };

  const exportToExcel = async () => {
    setLoading(true);
    showToast('Đang xuất dữ liệu...');
    try {
      const XLSX = await import('xlsx');
      const CHUNK = 3000;
      let all: any[] = [];
      let from = 0;
      while (true) {
        let q = supabase.from('master_erp').select('erp,name,name_zh,spec,unit,updated_at').order('erp', { ascending: true }).range(from, from + CHUNK - 1);
        if (activeFilter === 'no_name') q = q.is('name', null);
        else if (activeFilter === 'no_spec') q = q.is('spec', null);
        if (searchQuery) q = q.or(`erp.ilike.%${searchQuery}%,name.ilike.%${searchQuery}%,name_zh.ilike.%${searchQuery}%,spec.ilike.%${searchQuery}%`);
        const { data } = await q;
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < CHUNK) break;
        from += CHUNK;
      }
      const rows = all.map((r, i) => ({
        'STT': i + 1,
        'Mã ERP': r.erp,
        'Tên Tiếng Việt': r.name || '',
        'Tên Tiếng Trung': r.name_zh || '',
        'Quy Cách': r.spec || '',
        'Đơn Vị': r.unit || '',
        'Cập Nhật': r.updated_at ? new Date(r.updated_at).toLocaleDateString('vi-VN') : '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Master ERP');
      XLSX.writeFile(wb, `master_erp_${new Date().toISOString().split('T')[0]}.xlsx`);
      showToast(`✅ Đã xuất ${rows.length.toLocaleString()} mã ERP`);
    } catch (err: any) {
      showToast('Lỗi xuất Excel: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const setFilter = (f: 'all' | 'no_name' | 'no_spec') => {
    setActiveFilter(f);
    setPage(0);
    setSearchQuery('');
  };

  // ── Parse uploaded Excel ──────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (raw.length === 0) { showToast('File không có dữ liệu', true); return; }

      const norm = (s: string) => s.trim().toLowerCase().normalize('NFC');
      const rowKeys = Object.keys(raw[0] || {});
      const findCol = (keys: string[]): string | undefined => {
        for (const k of keys) { const hit = rowKeys.find(c => norm(c) === norm(k)); if (hit) return hit; }
        for (const k of keys) { const nk = norm(k); const hit = rowKeys.find(c => norm(c).includes(nk) || nk.includes(norm(c))); if (hit) return hit; }
        return undefined;
      };

      const erpCol  = findCol(['Mã ERP', 'mã erp', 'ERP', 'erp', 'MÃ ERP', 'Mã Hàng ERP', 'Mã vật tư']);
      const nameCol = findCol(['Tên Tiếng Việt', 'Tên SP', 'Tên Vật Tư', 'Tên Hàng', 'name', 'tên', 'Tên']);
      const zhCol   = findCol(['Tên Tiếng Trung', 'name_zh', 'Tên Trung', 'Tên TQ']);
      const specCol = findCol(['Quy Cách', 'QUY CÁCH', 'spec', 'Specifications']);
      const unitCol = findCol(['Đơn Tính', 'ĐVT', 'ĐƠN TÍNH', 'unit', 'Đơn vị', 'DVT']);

      if (!erpCol) {
        showToast(`Không tìm thấy cột Mã ERP. Cột trong file: ${rowKeys.slice(0, 8).join(', ')}`, true);
        return;
      }

      const getCell = (row: any, col?: string) => col ? String(row[col] ?? '').trim() : '';

      const allRows = raw
        .map(row => ({
          erp:     getCell(row, erpCol),
          name:    getCell(row, nameCol),
          name_zh: getCell(row, zhCol),
          spec:    getCell(row, specCol),
          unit:    getCell(row, unitCol),
        }))
        .filter(r => r.erp && r.erp !== '#N/A' && r.erp !== 'N/A');

      if (allRows.length === 0) { showToast('Không có dòng hợp lệ (cột Mã ERP trống hoặc #N/A)', true); return; }

      setParsedRows(allRows);
      setShowPreview(true);
    } catch (err: any) {
      showToast('Lỗi đọc file: ' + err.message, true);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Confirm upload ────────────────────────────────────────
  const confirmUpload = async () => {
    if (!parsedRows.length) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadStatus('Đang phân tích dữ liệu...');
    setUploadSummary(null);

    try {
      // Tách unique vs duplicate
      const erpCount = new Map<string, number>();
      parsedRows.forEach(r => erpCount.set(r.erp, (erpCount.get(r.erp) || 0) + 1));

      const uniqueRows  = parsedRows.filter(r => erpCount.get(r.erp) === 1);
      const dupRows     = parsedRows.filter(r => (erpCount.get(r.erp) || 0) > 1);

      // Upload unique rows via RPC (no row limit)
      const CHUNK = 3000;
      let done = 0;
      for (let i = 0; i < uniqueRows.length; i += CHUNK) {
        const chunk = uniqueRows.slice(i, i + CHUNK).map(r => ({
          erp: r.erp, name: r.name || null, name_zh: r.name_zh || null,
          spec: r.spec || null, unit: r.unit || null,
        }));
        setUploadStatus(`Đang upload ${done + 1}–${Math.min(done + CHUNK, uniqueRows.length)} / ${uniqueRows.length.toLocaleString()} mã OK...`);
        const { error } = await supabase.rpc('bulk_upsert_master_erp', { items: chunk });
        if (error) throw error;
        done += chunk.length;
        setUploadProgress(Math.round((done / parsedRows.length) * 100));
      }

      // Insert duplicate rows into pending
      if (dupRows.length > 0) {
        setUploadStatus(`Đang lưu ${dupRows.length.toLocaleString()} dòng trùng vào Chờ xử lý...`);
        const pendingChunk = dupRows.map(r => ({
          erp: r.erp, name: r.name || null, name_zh: r.name_zh || null,
          spec: r.spec || null, unit: r.unit || null,
          reason: 'duplicate_in_file',
        }));
        for (let i = 0; i < pendingChunk.length; i += CHUNK) {
          const { error } = await supabase.from('master_erp_pending').insert(pendingChunk.slice(i, i + CHUNK));
          if (error) throw error;
        }
        setUploadProgress(100);
      }

      setUploadSummary({ ok: uniqueRows.length, pending: dupRows.length });
      await fetchStats();
      await fetchItems(searchQuery, 0, activeFilter);
      setPage(0);
    } catch (err: any) {
      showToast('Lỗi upload: ' + err.message, true);
      setShowPreview(false);
      setParsedRows([]);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
    }
  };

  const closePreview = () => {
    setShowPreview(false);
    setParsedRows([]);
    setUploadSummary(null);
    if (uploadSummary?.pending && uploadSummary.pending > 0) {
      setTab('pending');
      fetchPending('', 0);
      setPendingPage(0);
    }
  };

  // ── Download template ─────────────────────────────────────
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet([{
      'Mã ERP': 'VT-00001', 'Tên Tiếng Việt': 'Ví dụ tên sản phẩm',
      'Tên Tiếng Trung': '示例产品名称', 'Quy Cách': 'M4×25mm', 'Đơn Tính': 'Cái',
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master ERP');
    XLSX.writeFile(wb, 'Template_Master_ERP.xlsx');
  };

  // ── Edit ──────────────────────────────────────────────────
  const openEdit = (type: 'master' | 'pending', item: MasterItem | PendingItem) => {
    setEditTarget({ type, item });
    setEditForm({
      erp:     item.erp,
      name:    item.name    || '',
      name_zh: item.name_zh || '',
      spec:    item.spec    || '',
      unit:    item.unit    || '',
    });
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    const { type, item } = editTarget;
    const payload = {
      erp:        editForm.erp.trim(),
      name:       editForm.name.trim()    || null,
      name_zh:    editForm.name_zh.trim() || null,
      spec:       editForm.spec.trim()    || null,
      unit:       editForm.unit.trim()    || null,
    };
    if (!payload.erp) { showToast('Mã ERP không được để trống', true); return; }

    if (type === 'master') {
      const { error } = await supabase.from('master_erp')
        .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', item.id);
      if (error) { showToast('Lỗi: ' + error.message, true); return; }
      showToast(`Đã cập nhật ${item.erp}`);
      await Promise.all([fetchItems(), fetchStats()]);
    } else {
      const { error } = await supabase.from('master_erp_pending').update(payload).eq('id', item.id);
      if (error) { showToast('Lỗi: ' + error.message, true); return; }
      showToast('Đã cập nhật thông tin chờ xử lý');
      await fetchPending();
    }
    setEditTarget(null);
  };

  // ── Approve pending → move to master ─────────────────────
  const approvePending = async (p: PendingItem) => {
    const { error } = await supabase.rpc('bulk_upsert_master_erp', {
      items: [{ erp: p.erp, name: p.name, name_zh: p.name_zh, spec: p.spec, unit: p.unit }],
    });
    if (error) { showToast('Lỗi xác nhận: ' + error.message, true); return; }
    await supabase.from('master_erp_pending').delete().eq('id', p.id);
    showToast(`Đã xác nhận ${p.erp} vào Master ERP`);
    await Promise.all([fetchStats(), fetchPending(), fetchItems()]);
  };

  const totalPages   = Math.ceil(totalCount / PAGE_SIZE);
  const pendingPages = Math.ceil(pendingCount / PAGE_SIZE);

  // Duplicate ERP summary for preview
  const previewDupErps = (() => {
    if (!parsedRows.length) return { unique: 0, dupErps: [] as string[] };
    const count = new Map<string, number>();
    parsedRows.forEach(r => count.set(r.erp, (count.get(r.erp) || 0) + 1));
    const dupErps = [...count.entries()].filter(([, c]) => c > 1).map(([erp]) => erp);
    return { unique: parsedRows.length - parsedRows.filter(r => (count.get(r.erp) || 0) > 1).length, dupErps };
  })();

  return (
    <div className="p-4 md:p-8 max-w-screen-xl mx-auto">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-bold transition-all ${toast.error ? 'bg-error text-on-error' : 'bg-primary text-on-primary'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-on-surface">Master ERP</h1>
          <p className="text-sm text-on-surface-variant mt-1">Danh sách mã ERP chuẩn — nguồn đối chiếu cho nhập/xuất kho</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                if (!window.confirm(`Bạn có chắc chắn muốn XÓA TOÀN BỘ ${totalCount.toLocaleString()} mã ERP? Hành động này không thể hoàn tác!`)) return;
                setLoading(true);
                const { error } = await supabase.from('master_erp').delete().neq('erp', '___NEVER___');
                setLoading(false);
                if (error) { alert('Lỗi: ' + error.message); return; }
                setItems([]); setTotalCount(0); setMissingName(0); setMissingSpec(0);
                alert('Đã xóa toàn bộ Master ERP.');
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-error/40 text-sm font-bold text-error hover:bg-error/10 transition-colors"
            >
              <span className="material-symbols-outlined text-base">delete_sweep</span>Xóa tất cả
            </button>
            <button onClick={exportToExcel} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/40 text-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50">
              <span className="material-symbols-outlined text-base">file_download</span>Xuất Excel
            </button>
            <button onClick={downloadTemplate} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/40 text-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors">
              <span className="material-symbols-outlined text-base">download</span>File mẫu
            </button>
            <label className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold cursor-pointer hover:bg-primary/90 transition-colors">
              <span className="material-symbols-outlined text-base">upload_file</span>Upload Excel
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
        )}
      </div>

      {/* Stats / Quick Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <button onClick={() => setFilter('all')} className={`rounded-2xl p-4 text-left transition-all border-2 ${activeFilter === 'all' && tab === 'master' ? 'border-primary bg-primary/10' : 'border-transparent bg-surface-container hover:bg-surface-container-high'}`}>
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Tổng mã ERP</p>
          <p className="text-2xl font-extrabold text-primary">{totalCount.toLocaleString()}</p>
        </button>
        <button onClick={() => setFilter('no_name')} className={`rounded-2xl p-4 text-left transition-all border-2 ${activeFilter === 'no_name' ? 'border-error bg-error/10' : 'border-transparent bg-surface-container hover:bg-surface-container-high'}`}>
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Thiếu tên VN</p>
          <p className="text-2xl font-extrabold text-error">{missingName.toLocaleString()}</p>
          <p className="text-xs text-error/60 mt-0.5">{activeFilter === 'no_name' ? '← Đang lọc' : 'Nhấn để lọc'}</p>
        </button>
        <button onClick={() => setFilter('no_spec')} className={`rounded-2xl p-4 text-left transition-all border-2 ${activeFilter === 'no_spec' ? 'border-tertiary bg-tertiary/10' : 'border-transparent bg-surface-container hover:bg-surface-container-high'}`}>
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Thiếu quy cách</p>
          <p className="text-2xl font-extrabold text-tertiary">{missingSpec.toLocaleString()}</p>
          <p className="text-xs text-tertiary/60 mt-0.5">{activeFilter === 'no_spec' ? '← Đang lọc' : 'Nhấn để lọc'}</p>
        </button>
        <button onClick={() => { setTab('pending'); fetchPending('', 0); setPendingPage(0); }} className={`rounded-2xl p-4 text-left transition-all border-2 ${tab === 'pending' ? 'border-amber-500 bg-amber-500/10' : 'border-transparent bg-surface-container hover:bg-surface-container-high'}`}>
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Chờ xử lý</p>
          <p className="text-2xl font-extrabold text-amber-500">{pendingCount.toLocaleString()}</p>
          <p className="text-xs text-amber-500/70 mt-0.5">{tab === 'pending' ? '← Đang xem' : 'Nhấn để xem'}</p>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-container rounded-2xl p-1 w-fit">
        <button onClick={() => setTab('master')} className={`px-5 py-2 rounded-xl text-sm font-bold transition-colors ${tab === 'master' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
          Danh sách Master
        </button>
        <button onClick={() => { setTab('pending'); fetchPending('', 0); setPendingPage(0); }} className={`px-5 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2 ${tab === 'pending' ? 'bg-amber-500 text-white' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
          Chờ xử lý
          {pendingCount > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full font-black ${tab === 'pending' ? 'bg-white/20' : 'bg-amber-500 text-white'}`}>{pendingCount}</span>}
        </button>
      </div>

      {/* ── MASTER TAB ──────────────────────────────────────── */}
      {tab === 'master' && (
        <>
          <form onSubmit={handleSearch} className="flex gap-2 mb-6">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">search</span>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Tìm mã ERP, tên Việt, tên Trung, quy cách..."
                className="w-full pl-10 pr-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface placeholder-on-surface-variant/40 border border-outline-variant/30 focus:outline-none focus:border-primary/50" />
            </div>
            <button type="submit" className="px-4 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors">Tìm</button>
            {searchQuery && (
              <button type="button" onClick={() => { setSearchQuery(''); setPage(0); fetchItems('', 0, activeFilter); }} className="px-4 py-2.5 bg-surface-container rounded-xl text-sm font-bold hover:bg-surface-container-high transition-colors">Xóa lọc</button>
            )}
          </form>

          <div className="bg-surface-container-low rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest border-b border-outline-variant/20">
                    <th className="px-4 py-4">Mã ERP</th>
                    <th className="px-4 py-4">Tên Tiếng Việt</th>
                    <th className="px-4 py-4 hidden md:table-cell">Tên Tiếng Trung</th>
                    <th className="px-4 py-4 hidden lg:table-cell">Quy Cách</th>
                    <th className="px-4 py-4 hidden xl:table-cell">Đơn Tính</th>
                    <th className="px-4 py-4 hidden xl:table-cell">Cập nhật</th>
                    {canEdit && <th className="px-4 py-4 text-right">Thao tác</th>}
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {loading ? (
                    <tr><td colSpan={7} className="text-center py-16 text-on-surface-variant/40">Đang tải...</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-16">
                      <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 block mb-2">inventory_2</span>
                      <p className="text-sm text-on-surface-variant/50">{searchQuery ? 'Không tìm thấy kết quả' : 'Chưa có dữ liệu Master ERP'}</p>
                    </td></tr>
                  ) : items.map(item => (
                    <tr key={item.id} className="border-t border-outline-variant/10 hover:bg-surface-container transition-colors">
                      <td className="px-4 py-3"><span className="font-mono font-bold text-primary text-xs">{item.erp}</span></td>
                      <td className="px-4 py-3">{item.name ? <span className="font-medium text-on-surface">{item.name}</span> : <span className="text-error/50 italic text-xs">Chưa có tên</span>}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-on-surface-variant text-xs">{item.name_zh || <span className="text-outline-variant/40">—</span>}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-on-surface-variant text-xs">{item.spec || <span className="text-outline-variant/40">—</span>}</td>
                      <td className="px-4 py-3 hidden xl:table-cell">{item.unit ? <span className="px-2 py-0.5 bg-surface-container-high rounded-full text-xs">{item.unit}</span> : <span className="text-outline-variant/40 text-xs">—</span>}</td>
                      <td className="px-4 py-3 hidden xl:table-cell text-xs text-on-surface-variant/60">{new Date(item.updated_at).toLocaleDateString('vi-VN')}</td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => openEdit('master', item)} className="p-1.5 rounded-lg text-outline-variant hover:text-primary hover:bg-primary/10 transition-colors" title="Sửa">
                            <span className="material-symbols-outlined text-base">edit</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-outline-variant/10">
                <span className="text-on-surface-variant text-xs">{(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString()} / {totalCount.toLocaleString()}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(0)} disabled={page === 0} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs hover:bg-surface-container-high">«</button>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs hover:bg-surface-container-high">← Trước</button>
                  <span className="text-xs text-on-surface-variant px-2">Trang {page + 1} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs hover:bg-surface-container-high">Sau →</button>
                  <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs hover:bg-surface-container-high">»</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── PENDING TAB ─────────────────────────────────────── */}
      {tab === 'pending' && (
        <>
          <div className="flex items-center gap-3 mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl">
            <span className="material-symbols-outlined text-amber-500 text-2xl">warning</span>
            <div>
              <p className="text-sm font-bold text-on-surface">Những mã ERP này bị trùng lặp trong file upload</p>
              <p className="text-xs text-on-surface-variant mt-0.5">Kiểm tra và sửa thông tin, sau đó bấm <span className="font-bold text-amber-600">Xác nhận vào Master</span> để lưu chính thức.</p>
            </div>
          </div>

          <form onSubmit={e => { e.preventDefault(); setPendingPage(0); fetchPending(pendingSearch, 0); }} className="flex gap-2 mb-6">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">search</span>
              <input value={pendingSearch} onChange={e => setPendingSearch(e.target.value)} placeholder="Tìm mã ERP, tên..."
                className="w-full pl-10 pr-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface placeholder-on-surface-variant/40 border border-outline-variant/30 focus:outline-none focus:border-amber-500/50" />
            </div>
            <button type="submit" className="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 transition-colors">Tìm</button>
          </form>

          <div className="bg-surface-container-low rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest border-b border-outline-variant/20">
                    <th className="px-4 py-4">Mã ERP</th>
                    <th className="px-4 py-4">Tên Tiếng Việt</th>
                    <th className="px-4 py-4 hidden md:table-cell">Tên Tiếng Trung</th>
                    <th className="px-4 py-4 hidden lg:table-cell">Quy Cách</th>
                    <th className="px-4 py-4 hidden xl:table-cell">Đơn Tính</th>
                    <th className="px-4 py-4">Lý do</th>
                    {canEdit && <th className="px-4 py-4 text-right">Thao tác</th>}
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {pendingLoading ? (
                    <tr><td colSpan={7} className="text-center py-16 text-on-surface-variant/40">Đang tải...</td></tr>
                  ) : pendingItems.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-16">
                      <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 block mb-2">check_circle</span>
                      <p className="text-sm text-on-surface-variant/50">Không có mã nào đang chờ xử lý</p>
                    </td></tr>
                  ) : pendingItems.map(item => (
                    <tr key={item.id} className="border-t border-outline-variant/10 hover:bg-amber-500/5 transition-colors">
                      <td className="px-4 py-3"><span className="font-mono font-bold text-amber-600 text-xs">{item.erp}</span></td>
                      <td className="px-4 py-3">{item.name || <span className="text-error/50 italic text-xs">Chưa có tên</span>}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-on-surface-variant text-xs">{item.name_zh || '—'}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-on-surface-variant text-xs">{item.spec || '—'}</td>
                      <td className="px-4 py-3 hidden xl:table-cell text-xs">{item.unit || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-amber-500/15 text-amber-700 rounded-full text-xs font-semibold">
                          {REASON_LABEL[item.reason] || item.reason}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit('pending', item)} className="p-1.5 rounded-lg text-outline-variant hover:text-primary hover:bg-primary/10 transition-colors" title="Sửa trước khi xác nhận">
                              <span className="material-symbols-outlined text-base">edit</span>
                            </button>
                            <button onClick={() => approvePending(item)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition-colors" title="Xác nhận vào Master ERP">
                              <span className="material-symbols-outlined text-sm">check</span>Xác nhận
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pendingPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-outline-variant/10">
                <span className="text-on-surface-variant text-xs">{(pendingPage * PAGE_SIZE + 1).toLocaleString()}–{Math.min((pendingPage + 1) * PAGE_SIZE, pendingCount).toLocaleString()} / {pendingCount.toLocaleString()}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPendingPage(p => Math.max(0, p - 1))} disabled={pendingPage === 0} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs">← Trước</button>
                  <span className="text-xs text-on-surface-variant px-2">Trang {pendingPage + 1} / {pendingPages}</span>
                  <button onClick={() => setPendingPage(p => Math.min(pendingPages - 1, p + 1))} disabled={pendingPage >= pendingPages - 1} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs">Sau →</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Edit Modal ─────────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl w-full max-w-lg shadow-2xl">
            <div className="p-6 border-b border-outline-variant/20 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-on-surface">Sửa thông tin</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {editTarget.type === 'pending' && <span className="text-amber-600 font-semibold">Đang sửa mục Chờ xử lý — </span>}
                  Mã ERP có thể sửa nếu bị nhập sai
                </p>
              </div>
              <button onClick={() => setEditTarget(null)} className="p-2 rounded-xl hover:bg-surface-container transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 block">Mã ERP</label>
                <input value={editForm.erp} onChange={e => setEditForm(f => ({ ...f, erp: e.target.value }))}
                  className={`w-full px-4 py-2.5 rounded-xl text-sm font-mono font-bold border focus:outline-none focus:border-primary/50 ${editTarget.type === 'master' ? 'bg-surface-container-high text-on-surface-variant border-outline-variant/20 cursor-not-allowed' : 'bg-surface-container text-on-surface border-outline-variant/30'}`}
                  readOnly={editTarget.type === 'master'}
                />
                {editTarget.type === 'master' && <p className="text-xs text-on-surface-variant/50 mt-1">Mã ERP trong Master không thể thay đổi</p>}
              </div>
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 block">Tên Tiếng Việt</label>
                <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary/50" placeholder="Tên sản phẩm tiếng Việt" />
              </div>
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 block">Tên Tiếng Trung</label>
                <input value={editForm.name_zh} onChange={e => setEditForm(f => ({ ...f, name_zh: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary/50" placeholder="中文名称" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 block">Quy Cách</label>
                  <input value={editForm.spec} onChange={e => setEditForm(f => ({ ...f, spec: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary/50" placeholder="VD: M4×25mm" />
                </div>
                <div>
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 block">Đơn Tính</label>
                  <input value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary/50" placeholder="VD: Cái, Kg, M" />
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-outline-variant/20 flex gap-3 justify-end">
              <button onClick={() => setEditTarget(null)} className="px-5 py-2.5 rounded-xl border border-outline-variant/40 font-bold text-sm">Hủy</button>
              {editTarget.type === 'pending' && (
                <button onClick={async () => { await saveEdit(); if (!toast?.error) await approvePending(editTarget.item as PendingItem); }}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 text-white font-bold text-sm flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">check</span>Lưu & Xác nhận vào Master
                </button>
              )}
              <button onClick={saveEdit} className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm flex items-center gap-2">
                <span className="material-symbols-outlined text-base">save</span>Lưu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Upload Preview Modal ──────────────────────────── */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-6 border-b border-outline-variant/20 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-on-surface">Xác nhận upload Master ERP</h2>
                {!uploadSummary ? (
                  <div className="flex gap-4 mt-1 text-sm">
                    <span className="text-primary font-bold">{previewDupErps.unique.toLocaleString()} mã OK</span>
                    {previewDupErps.dupErps.length > 0 && (
                      <span className="text-amber-600 font-bold">{parsedRows.length - previewDupErps.unique} dòng trùng ({previewDupErps.dupErps.length} mã) → vào Chờ xử lý</span>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-4 mt-1 text-sm">
                    <span className="text-primary font-bold">✓ {uploadSummary.ok.toLocaleString()} mã đã upload</span>
                    {uploadSummary.pending > 0 && <span className="text-amber-600 font-bold">⚠ {uploadSummary.pending} dòng → Chờ xử lý</span>}
                  </div>
                )}
              </div>
              {!uploading && (
                <button onClick={closePreview} className="p-2 rounded-xl hover:bg-surface-container transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              )}
            </div>

            {!uploadSummary && (
              <>
                {previewDupErps.dupErps.length > 0 && (
                  <div className="mx-4 mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                    <p className="text-xs font-bold text-amber-700 mb-1">
                      <span className="material-symbols-outlined text-sm align-middle mr-1">warning</span>
                      {previewDupErps.dupErps.length} Mã ERP bị trùng trong file — sẽ lưu vào tab Chờ xử lý:
                    </p>
                    <p className="text-xs font-mono text-amber-800 break-all">{previewDupErps.dupErps.slice(0, 20).join(', ')}{previewDupErps.dupErps.length > 20 ? ` ... và ${previewDupErps.dupErps.length - 20} mã nữa` : ''}</p>
                  </div>
                )}
                <div className="overflow-auto flex-1 p-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest">
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Mã ERP</th>
                        <th className="px-3 py-2 text-left">Tên Tiếng Việt</th>
                        <th className="px-3 py-2 text-left hidden md:table-cell">Quy Cách</th>
                        <th className="px-3 py-2 text-left">Đơn Tính</th>
                        <th className="px-3 py-2 text-left">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, 100).map((r, i) => {
                        const isDup = previewDupErps.dupErps.includes(r.erp);
                        return (
                          <tr key={i} className={`border-t border-outline-variant/10 ${isDup ? 'bg-amber-500/5' : ''}`}>
                            <td className="px-3 py-1.5 text-on-surface-variant/40">{i + 1}</td>
                            <td className={`px-3 py-1.5 font-mono font-bold text-xs ${isDup ? 'text-amber-600' : 'text-primary'}`}>{r.erp}</td>
                            <td className="px-3 py-1.5">{r.name || <span className="text-error/60 italic">Trống</span>}</td>
                            <td className="px-3 py-1.5 hidden md:table-cell text-on-surface-variant">{r.spec || '—'}</td>
                            <td className="px-3 py-1.5">{r.unit || '—'}</td>
                            <td className="px-3 py-1.5">
                              {isDup
                                ? <span className="px-1.5 py-0.5 bg-amber-500/15 text-amber-700 rounded text-[10px] font-bold">Trùng → Chờ XL</span>
                                : <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px] font-bold">OK</span>
                              }
                            </td>
                          </tr>
                        );
                      })}
                      {parsedRows.length > 100 && (
                        <tr><td colSpan={6} className="px-3 py-2 text-center text-on-surface-variant/50 italic text-xs">... và {(parsedRows.length - 100).toLocaleString()} dòng nữa</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {uploadSummary && (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center">
                  <span className="material-symbols-outlined text-6xl text-primary block mb-4">check_circle</span>
                  <p className="text-xl font-extrabold text-on-surface mb-2">Upload hoàn tất</p>
                  <p className="text-sm text-on-surface-variant">
                    <span className="text-primary font-bold">{uploadSummary.ok.toLocaleString()} mã</span> đã vào Master ERP
                    {uploadSummary.pending > 0 && <><br /><span className="text-amber-600 font-bold">{uploadSummary.pending} dòng trùng</span> đang chờ xử lý</>}
                  </p>
                </div>
              </div>
            )}

            {uploading && (
              <div className="px-6 pb-2">
                <div className="w-full bg-surface-container rounded-full h-2.5">
                  <div className="bg-primary h-2.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="text-xs text-on-surface-variant mt-1.5 text-center">{uploadStatus || `${uploadProgress}%`}</p>
              </div>
            )}

            <div className="p-6 border-t border-outline-variant/20 flex gap-3 justify-end">
              {uploadSummary ? (
                <button onClick={closePreview} className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">{uploadSummary.pending > 0 ? 'pending_actions' : 'done'}</span>
                  {uploadSummary.pending > 0 ? 'Xem mã Chờ xử lý' : 'Đóng'}
                </button>
              ) : (
                <>
                  <button onClick={() => { setShowPreview(false); setParsedRows([]); }} disabled={uploading} className="px-5 py-2.5 rounded-xl border border-outline-variant/40 font-bold text-sm disabled:opacity-50">Hủy</button>
                  <button onClick={confirmUpload} disabled={uploading} className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm disabled:opacity-50 flex items-center gap-2">
                    {uploading ? <><span className="material-symbols-outlined text-base animate-spin">progress_activity</span>Đang upload...</> : <><span className="material-symbols-outlined text-base">upload</span>Xác nhận Upload</>}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterERP;
