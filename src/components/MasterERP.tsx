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

type Toast = { msg: string; error?: boolean };

const PAGE_SIZE = 50;

const MasterERP = () => {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'editor';

  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [missingName, setMissingName] = useState(0);
  const [missingSpec, setMissingSpec] = useState(0);
  const [page, setPage] = useState(0);

  // Upload state
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [editItem, setEditItem] = useState<MasterItem | null>(null);
  const [editForm, setEditForm] = useState({ name: '', name_zh: '', spec: '', unit: '' });

  // Delete-all confirm state
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const showToast = (msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchStats = useCallback(async () => {
    const [{ count: total }, { count: noName }, { count: noSpec }] = await Promise.all([
      supabase.from('master_erp').select('*', { count: 'exact', head: true }),
      supabase.from('master_erp').select('*', { count: 'exact', head: true }).is('name', null),
      supabase.from('master_erp').select('*', { count: 'exact', head: true }).is('spec', null),
    ]);
    setTotalCount(total || 0);
    setMissingName(noName || 0);
    setMissingSpec(noSpec || 0);
  }, []);

  const fetchItems = useCallback(async (search = searchQuery, pg = page) => {
    setLoading(true);
    try {
      let query = supabase
        .from('master_erp')
        .select('*', { count: 'exact' })
        .order('erp', { ascending: true })
        .range(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE - 1);

      if (search.trim()) {
        query = query.or(
          `erp.ilike.%${search}%,name.ilike.%${search}%,name_zh.ilike.%${search}%,spec.ilike.%${search}%`
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;
      setItems(data || []);
      if (!search.trim()) setTotalCount(count || 0);
      else setTotalCount(count || 0);
    } catch (err: any) {
      showToast('Lỗi tải dữ liệu: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, page]);

  useEffect(() => { fetchItems(); }, [page]);

  useEffect(() => { fetchStats(); }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchItems(searchQuery, 0);
  };

  // ── Parse uploaded Excel file ─────────────────────────────
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
        for (const k of keys) {
          const hit = rowKeys.find(c => norm(c) === norm(k));
          if (hit) return hit;
        }
        for (const k of keys) {
          const nk = norm(k);
          const hit = rowKeys.find(c => norm(c).includes(nk) || nk.includes(norm(c)));
          if (hit) return hit;
        }
        return undefined;
      };

      const erpCol  = findCol(['Mã ERP', 'mã erp', 'ERP', 'erp', 'MÃ ERP', 'ma erp', 'Mã Hàng ERP', 'mã hàng erp', 'Mã vật tư']);
      const nameCol = findCol(['Tên Tiếng Việt', 'tên tiếng việt', 'Tên SP', 'tên sp', 'Tên Vật Tư', 'tên vật tư', 'Tên Hàng', 'tên hàng', 'name', 'tên', 'Tên']);
      const zhCol   = findCol(['Tên Tiếng Trung', 'tên tiếng trung', 'name_zh', 'Tên Trung', 'tên trung', 'Tên TQ', 'tên tq']);
      const specCol = findCol(['Quy Cách', 'quy cách', 'QUY CÁCH', 'spec', 'Specifications']);
      const unitCol = findCol(['Đơn Tính', 'đơn tính', 'ĐVT', 'đvt', 'ĐƠN TÍNH', 'unit', 'đơn vị', 'Đơn vị', 'DVT']);

      if (!erpCol) {
        showToast(`Không tìm thấy cột Mã ERP. Cột trong file: ${rowKeys.slice(0, 8).join(', ')}`, true);
        return;
      }

      const getCell = (row: any, col: string | undefined) =>
        col ? String(row[col] ?? '').trim() : '';

      const rawRows = raw
        .map(row => ({
          erp:     getCell(row, erpCol),
          name:    getCell(row, nameCol),
          name_zh: getCell(row, zhCol),
          spec:    getCell(row, specCol),
          unit:    getCell(row, unitCol),
        }))
        .filter(r => r.erp && r.erp !== '#N/A' && r.erp !== 'N/A');

      // Deduplicate by erp — keep last occurrence (latest data wins)
      const rows = Array.from(
        new Map(rawRows.map(r => [r.erp, r])).values()
      );

      if (rows.length === 0) {
        showToast('Không có dòng hợp lệ (cột Mã ERP trống hoặc #N/A)', true);
        return;
      }
      const dupCount = rawRows.length - rows.length;
      setParsedRows(rows);
      if (dupCount > 0) showToast(`Đã bỏ ${dupCount} dòng trùng Mã ERP trong file`);
      setShowPreview(true);
    } catch (err: any) {
      showToast('Lỗi đọc file: ' + err.message, true);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Confirm upload via RPC (no row limit) ─────────────────
  const confirmUpload = async () => {
    if (!parsedRows.length) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadStatus('');
    try {
      const CHUNK = 3000;
      let done = 0;
      for (let i = 0; i < parsedRows.length; i += CHUNK) {
        const chunk = parsedRows.slice(i, i + CHUNK).map(r => ({
          erp:     r.erp,
          name:    r.name || null,
          name_zh: r.name_zh || null,
          spec:    r.spec || null,
          unit:    r.unit || null,
        }));
        setUploadStatus(`Đang xử lý ${done + 1}–${Math.min(done + CHUNK, parsedRows.length)} / ${parsedRows.length.toLocaleString()}...`);
        const { error } = await supabase.rpc('bulk_upsert_master_erp', { items: chunk });
        if (error) throw error;
        done += chunk.length;
        setUploadProgress(Math.round((done / parsedRows.length) * 100));
      }
      showToast(`Đã cập nhật ${parsedRows.length.toLocaleString()} mã ERP`);
      setShowPreview(false);
      setParsedRows([]);
      setPage(0);
      await Promise.all([fetchItems(searchQuery, 0), fetchStats()]);
    } catch (err: any) {
      showToast('Lỗi upload: ' + err.message, true);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
    }
  };

  // ── Download template ─────────────────────────────────────
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet([{
      'Mã ERP': 'VT-00001',
      'Tên Tiếng Việt': 'Ví dụ tên sản phẩm',
      'Tên Tiếng Trung': '示例产品名称',
      'Quy Cách': 'M4×25mm',
      'Đơn Tính': 'Cái',
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master ERP');
    XLSX.writeFile(wb, 'Template_Master_ERP.xlsx');
  };

  // ── Edit item ─────────────────────────────────────────────
  const openEdit = (item: MasterItem) => {
    setEditItem(item);
    setEditForm({
      name:    item.name    || '',
      name_zh: item.name_zh || '',
      spec:    item.spec    || '',
      unit:    item.unit    || '',
    });
  };

  const saveEdit = async () => {
    if (!editItem) return;
    const { error } = await supabase
      .from('master_erp')
      .update({
        name:       editForm.name.trim()    || null,
        name_zh:    editForm.name_zh.trim() || null,
        spec:       editForm.spec.trim()    || null,
        unit:       editForm.unit.trim()    || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editItem.id);
    if (error) { showToast('Lỗi cập nhật: ' + error.message, true); return; }
    showToast(`Đã cập nhật ${editItem.erp}`);
    setEditItem(null);
    await Promise.all([fetchItems(), fetchStats()]);
  };

  // ── Delete single ─────────────────────────────────────────
  const handleDelete = async (id: string, erp: string) => {
    if (!window.confirm(`Xóa mã ERP "${erp}" khỏi Master?`)) return;
    const { error } = await supabase.from('master_erp').delete().eq('id', id);
    if (error) { showToast('Lỗi xóa: ' + error.message, true); return; }
    showToast(`Đã xóa ${erp}`);
    await Promise.all([fetchItems(), fetchStats()]);
  };

  // ── Delete all ────────────────────────────────────────────
  const handleDeleteAll = async () => {
    if (deleteConfirmText !== 'XÓA TẤT CẢ') return;
    const { error } = await supabase.from('master_erp').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) { showToast('Lỗi xóa: ' + error.message, true); return; }
    showToast('Đã xóa toàn bộ Master ERP');
    setShowDeleteAll(false);
    setDeleteConfirmText('');
    setItems([]);
    setTotalCount(0);
    setMissingName(0);
    setMissingSpec(0);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-4 md:p-8 max-w-screen-xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-bold transition-all ${toast.error ? 'bg-error text-on-error' : 'bg-primary text-on-primary'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-on-surface">Master ERP</h1>
          <p className="text-sm text-on-surface-variant mt-1">Danh sách mã ERP chuẩn — nguồn đối chiếu cho nhập/xuất kho</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {totalCount > 0 && (
              <button
                onClick={() => setShowDeleteAll(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-error/40 text-sm font-bold text-error hover:bg-error/10 transition-colors"
              >
                <span className="material-symbols-outlined text-base">delete_sweep</span>
                Xóa tất cả
              </button>
            )}
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/40 text-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined text-base">download</span>
              File mẫu
            </button>
            <label className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold cursor-pointer hover:bg-primary/90 transition-colors">
              <span className="material-symbols-outlined text-base">upload_file</span>
              Upload Excel
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-surface-container rounded-2xl p-5">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Tổng mã ERP</p>
          <p className="text-3xl font-extrabold text-primary">{totalCount.toLocaleString()}</p>
        </div>
        <div className="bg-surface-container rounded-2xl p-5">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Thiếu tên VN</p>
          <p className="text-3xl font-extrabold text-error">{missingName.toLocaleString()}</p>
        </div>
        <div className="bg-surface-container rounded-2xl p-5">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Thiếu quy cách</p>
          <p className="text-3xl font-extrabold text-tertiary">{missingSpec.toLocaleString()}</p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">search</span>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm mã ERP, tên Việt, tên Trung, quy cách..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface placeholder-on-surface-variant/40 border border-outline-variant/30 focus:outline-none focus:border-primary/50"
          />
        </div>
        <button type="submit" className="px-4 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors">
          Tìm
        </button>
        {searchQuery && (
          <button type="button" onClick={() => { setSearchQuery(''); setPage(0); fetchItems('', 0); }} className="px-4 py-2.5 bg-surface-container rounded-xl text-sm font-bold hover:bg-surface-container-high transition-colors">
            Xóa lọc
          </button>
        )}
      </form>

      {/* Table */}
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
                <tr>
                  <td colSpan={7} className="text-center py-16">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 block mb-2">inventory_2</span>
                    <p className="text-sm text-on-surface-variant/50">{searchQuery ? 'Không tìm thấy kết quả' : 'Chưa có dữ liệu Master ERP'}</p>
                    {!searchQuery && canEdit && <p className="text-xs text-on-surface-variant/40 mt-1">Upload file Excel để bắt đầu</p>}
                  </td>
                </tr>
              ) : items.map(item => (
                <tr key={item.id} className="border-t border-outline-variant/10 hover:bg-surface-container transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono font-bold text-primary text-xs">{item.erp}</span>
                  </td>
                  <td className="px-4 py-3">
                    {item.name
                      ? <span className="font-medium text-on-surface">{item.name}</span>
                      : <span className="text-error/50 italic text-xs">Chưa có tên</span>
                    }
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-on-surface-variant text-xs">{item.name_zh || <span className="text-outline-variant/40">—</span>}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-on-surface-variant text-xs">{item.spec || <span className="text-outline-variant/40">—</span>}</td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    {item.unit ? <span className="px-2 py-0.5 bg-surface-container-high rounded-full text-xs">{item.unit}</span> : <span className="text-outline-variant/40 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell text-xs text-on-surface-variant/60">
                    {new Date(item.updated_at).toLocaleDateString('vi-VN')}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg text-outline-variant hover:text-primary hover:bg-primary/10 transition-colors" title="Sửa">
                          <span className="material-symbols-outlined text-base">edit</span>
                        </button>
                        <button onClick={() => handleDelete(item.id, item.erp)} className="p-1.5 rounded-lg text-outline-variant hover:text-error hover:bg-error/10 transition-colors" title="Xóa">
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-outline-variant/10 text-sm">
            <span className="text-on-surface-variant text-xs">
              {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString()} / {totalCount.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(0)} disabled={page === 0} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs hover:bg-surface-container-high transition-colors">«</button>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs hover:bg-surface-container-high transition-colors">← Trước</button>
              <span className="text-xs text-on-surface-variant px-2">Trang {page + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs hover:bg-surface-container-high transition-colors">Sau →</button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs hover:bg-surface-container-high transition-colors">»</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Edit Modal ─────────────────────────────────────────── */}
      {editItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl w-full max-w-lg shadow-2xl">
            <div className="p-6 border-b border-outline-variant/20 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-on-surface">Sửa thông tin</h2>
                <p className="text-xs font-mono text-primary mt-0.5">{editItem.erp}</p>
              </div>
              <button onClick={() => setEditItem(null)} className="p-2 rounded-xl hover:bg-surface-container transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 block">Tên Tiếng Việt</label>
                <input
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary/50"
                  placeholder="Tên sản phẩm tiếng Việt"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 block">Tên Tiếng Trung</label>
                <input
                  value={editForm.name_zh}
                  onChange={e => setEditForm(f => ({ ...f, name_zh: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary/50"
                  placeholder="中文名称"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 block">Quy Cách</label>
                  <input
                    value={editForm.spec}
                    onChange={e => setEditForm(f => ({ ...f, spec: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary/50"
                    placeholder="VD: M4×25mm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 block">Đơn Tính</label>
                  <input
                    value={editForm.unit}
                    onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface border border-outline-variant/30 focus:outline-none focus:border-primary/50"
                    placeholder="VD: Cái, Kg, M"
                  />
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-outline-variant/20 flex gap-3 justify-end">
              <button onClick={() => setEditItem(null)} className="px-5 py-2.5 rounded-xl border border-outline-variant/40 font-bold text-sm">
                Hủy
              </button>
              <button onClick={saveEdit} className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm flex items-center gap-2">
                <span className="material-symbols-outlined text-base">save</span>
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete All Modal ──────────────────────────────────── */}
      {showDeleteAll && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl w-full max-w-md shadow-2xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="material-symbols-outlined text-error text-3xl">warning</span>
                <div>
                  <h2 className="text-lg font-extrabold text-on-surface">Xóa toàn bộ Master ERP?</h2>
                  <p className="text-sm text-on-surface-variant mt-0.5">Hành động này không thể hoàn tác</p>
                </div>
              </div>
              <p className="text-sm text-on-surface-variant mb-4">
                Sẽ xóa <span className="font-bold text-error">{totalCount.toLocaleString()} mã ERP</span>. Gõ <span className="font-mono font-bold">XÓA TẤT CẢ</span> để xác nhận:
              </p>
              <input
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                className="w-full px-4 py-2.5 bg-surface-container rounded-xl text-sm font-mono border border-error/30 focus:outline-none focus:border-error/60 mb-4"
                placeholder="XÓA TẤT CẢ"
              />
              <div className="flex gap-3 justify-end">
                <button onClick={() => { setShowDeleteAll(false); setDeleteConfirmText(''); }} className="px-5 py-2.5 rounded-xl border border-outline-variant/40 font-bold text-sm">
                  Hủy
                </button>
                <button
                  onClick={handleDeleteAll}
                  disabled={deleteConfirmText !== 'XÓA TẤT CẢ'}
                  className="px-5 py-2.5 rounded-xl bg-error text-on-error font-bold text-sm disabled:opacity-40 flex items-center gap-2 transition-opacity"
                >
                  <span className="material-symbols-outlined text-base">delete_forever</span>
                  Xóa tất cả
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Upload Preview Modal ──────────────────────────────── */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="p-6 border-b border-outline-variant/20 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-on-surface">Xác nhận upload Master ERP</h2>
                <p className="text-sm text-on-surface-variant mt-0.5">
                  <span className="font-bold text-primary">{parsedRows.length.toLocaleString()}</span> mã ERP — mã đã có sẽ được cập nhật, mã mới sẽ được thêm
                </p>
              </div>
              <button onClick={() => { setShowPreview(false); setParsedRows([]); }} disabled={uploading} className="p-2 rounded-xl hover:bg-surface-container transition-colors disabled:opacity-40">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="overflow-auto flex-1 p-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest">
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Mã ERP</th>
                    <th className="px-3 py-2 text-left">Tên Tiếng Việt</th>
                    <th className="px-3 py-2 text-left hidden md:table-cell">Tên Tiếng Trung</th>
                    <th className="px-3 py-2 text-left hidden md:table-cell">Quy Cách</th>
                    <th className="px-3 py-2 text-left">Đơn Tính</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-t border-outline-variant/10">
                      <td className="px-3 py-1.5 text-on-surface-variant/40">{i + 1}</td>
                      <td className="px-3 py-1.5 font-mono font-bold text-primary">{r.erp}</td>
                      <td className="px-3 py-1.5">{r.name || <span className="text-error/60 italic">Trống</span>}</td>
                      <td className="px-3 py-1.5 hidden md:table-cell text-on-surface-variant">{r.name_zh || '—'}</td>
                      <td className="px-3 py-1.5 hidden md:table-cell text-on-surface-variant">{r.spec || '—'}</td>
                      <td className="px-3 py-1.5">{r.unit || '—'}</td>
                    </tr>
                  ))}
                  {parsedRows.length > 100 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-2 text-center text-on-surface-variant/50 italic text-xs">
                        ... và {(parsedRows.length - 100).toLocaleString()} dòng nữa
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {uploading && (
              <div className="px-6 pb-2">
                <div className="w-full bg-surface-container rounded-full h-2.5">
                  <div className="bg-primary h-2.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="text-xs text-on-surface-variant mt-1.5 text-center">{uploadStatus || `${uploadProgress}%`}</p>
              </div>
            )}

            <div className="p-6 border-t border-outline-variant/20 flex gap-3 justify-end">
              <button onClick={() => { setShowPreview(false); setParsedRows([]); }} disabled={uploading} className="px-5 py-2.5 rounded-xl border border-outline-variant/40 font-bold text-sm disabled:opacity-50">
                Hủy
              </button>
              <button onClick={confirmUpload} disabled={uploading} className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm disabled:opacity-50 flex items-center gap-2">
                {uploading
                  ? <><span className="material-symbols-outlined text-base animate-spin">progress_activity</span> Đang upload...</>
                  : <><span className="material-symbols-outlined text-base">upload</span> Xác nhận Upload</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterERP;
