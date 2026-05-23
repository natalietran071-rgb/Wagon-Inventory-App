import React, { useState, useEffect, useRef, useMemo } from 'react';
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

const MasterERP = () => {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'editor';

  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Upload state
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchItems = async (search = searchQuery, pg = page) => {
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
      setTotalCount(count || 0);
    } catch (err: any) {
      showToast('Lỗi tải dữ liệu: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, [page]);

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

      // Flexible column mapping with Unicode normalization + partial fallback
      const norm = (s: string) => s.trim().toLowerCase().normalize('NFC');
      const rowKeys = Object.keys(raw[0] || {});

      const findCol = (keys: string[]): string | undefined => {
        // 1. exact match (after normalize)
        for (const k of keys) {
          const hit = rowKeys.find(c => norm(c) === norm(k));
          if (hit) return hit;
        }
        // 2. partial/contains match
        for (const k of keys) {
          const nk = norm(k);
          const hit = rowKeys.find(c => norm(c).includes(nk) || nk.includes(norm(c)));
          if (hit) return hit;
        }
        return undefined;
      };

      const erpCol   = findCol(['Mã ERP', 'mã erp', 'ERP', 'erp', 'MÃ ERP', 'ma erp', 'Mã Hàng ERP', 'mã hàng erp']);
      const nameCol  = findCol(['Tên Tiếng Việt', 'tên tiếng việt', 'Tên SP', 'tên sp', 'Tên Vật Tư', 'tên vật tư', 'Tên Hàng', 'tên hàng', 'name', 'tên', 'Tên']);
      const zhCol    = findCol(['Tên Tiếng Trung', 'tên tiếng trung', 'name_zh', 'Tên Trung', 'tên trung', 'Tên TQ', 'tên tq']);
      const specCol  = findCol(['Quy Cách', 'quy cách', 'QUY CÁCH', 'spec', 'Quy cách', 'Specifications']);
      const unitCol  = findCol(['Đơn Tính', 'đơn tính', 'ĐVT', 'đvt', 'ĐƠN TÍNH', 'unit', 'đơn vị', 'Đơn vị', 'DVT']);

      if (!erpCol) {
        const found = rowKeys.slice(0, 8).join(', ');
        showToast(`Không tìm thấy cột Mã ERP. Cột trong file: ${found}`, true);
        return;
      }

      const getCell = (row: any, col: string | undefined) =>
        col ? String(row[col] ?? '').trim() : '';

      const rows = raw
        .map(row => ({
          erp:     getCell(row, erpCol),
          name:    getCell(row, nameCol),
          name_zh: getCell(row, zhCol),
          spec:    getCell(row, specCol),
          unit:    getCell(row, unitCol),
        }))
        .filter(r => r.erp && r.erp !== '#N/A' && r.erp !== 'N/A' && r.erp !== '');

      if (rows.length === 0) {
        showToast('Không tìm thấy dữ liệu hợp lệ trong file', true);
        return;
      }
      setParsedRows(rows);
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
    try {
      const CHUNK = 500;
      let done = 0;
      for (let i = 0; i < parsedRows.length; i += CHUNK) {
        const chunk = parsedRows.slice(i, i + CHUNK).map(r => ({
          erp: r.erp,
          name: r.name || null,
          name_zh: r.name_zh || null,
          spec: r.spec || null,
          unit: r.unit || null,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await supabase
          .from('master_erp')
          .upsert(chunk, { onConflict: 'erp' });
        if (error) throw error;
        done += chunk.length;
        setUploadProgress(Math.round((done / parsedRows.length) * 100));
      }
      showToast(`✅ Đã cập nhật ${parsedRows.length.toLocaleString()} mã ERP vào Master`);
      setShowPreview(false);
      setParsedRows([]);
      setPage(0);
      fetchItems(searchQuery, 0);
    } catch (err: any) {
      showToast('Lỗi upload: ' + err.message, true);
    } finally {
      setUploading(false);
      setUploadProgress(0);
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

  // ── Delete item ───────────────────────────────────────────
  const handleDelete = async (id: string, erp: string) => {
    if (!window.confirm(`Xóa mã ERP "${erp}" khỏi Master?`)) return;
    const { error } = await supabase.from('master_erp').delete().eq('id', id);
    if (error) { showToast('Lỗi xóa: ' + error.message, true); return; }
    showToast(`Đã xóa ${erp}`);
    fetchItems();
  };

  const stats = useMemo(() => ({
    total: totalCount,
    missingName: items.filter(i => !i.name).length,
    missingSpec: items.filter(i => !i.spec).length,
  }), [items, totalCount]);

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
          <div className="flex gap-2">
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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-surface-container rounded-2xl p-5">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Tổng mã ERP</p>
          <p className="text-3xl font-extrabold text-primary">{totalCount.toLocaleString()}</p>
        </div>
        <div className="bg-surface-container rounded-2xl p-5">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Thiếu tên</p>
          <p className="text-3xl font-extrabold text-error">{stats.missingName.toLocaleString()}</p>
        </div>
        <div className="bg-surface-container rounded-2xl p-5 col-span-2 md:col-span-1">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Thiếu quy cách</p>
          <p className="text-3xl font-extrabold text-tertiary">{stats.missingSpec.toLocaleString()}</p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">search</span>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm mã ERP, tên, quy cách..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface placeholder-on-surface-variant/40 border border-outline-variant/30 focus:outline-none focus:border-primary/50"
          />
        </div>
        <button type="submit" className="px-4 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors">
          Tìm
        </button>
        {searchQuery && (
          <button type="button" onClick={() => { setSearchQuery(''); setPage(0); fetchItems('', 0); }} className="px-4 py-2.5 bg-surface-container rounded-xl text-sm font-bold hover:bg-surface-container-high transition-colors">
            Xóa
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
                {canEdit && <th className="px-4 py-4 text-right">Xóa</th>}
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
                      : <span className="text-outline-variant/40 italic text-xs">—</span>
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
                      <button onClick={() => handleDelete(item.id, item.erp)} className="p-1.5 rounded-lg text-outline-variant hover:text-error hover:bg-error/10 transition-colors">
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
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
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} / {totalCount.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs hover:bg-surface-container-high transition-colors">← Trước</button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 rounded-lg bg-surface-container disabled:opacity-30 font-bold text-xs hover:bg-surface-container-high transition-colors">Sau →</button>
            </div>
          </div>
        )}
      </div>

      {/* Upload Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="p-6 border-b border-outline-variant/20 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-on-surface">Xác nhận upload Master ERP</h2>
                <p className="text-sm text-on-surface-variant mt-0.5">
                  {parsedRows.length.toLocaleString()} mã ERP — mã đã có sẽ được cập nhật, mã mới sẽ được thêm
                </p>
              </div>
              <button onClick={() => { setShowPreview(false); setParsedRows([]); }} className="p-2 rounded-xl hover:bg-surface-container transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="overflow-auto flex-1 p-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest">
                    <th className="px-3 py-2 text-left">Mã ERP</th>
                    <th className="px-3 py-2 text-left">Tên Tiếng Việt</th>
                    <th className="px-3 py-2 text-left hidden md:table-cell">Tên Tiếng Trung</th>
                    <th className="px-3 py-2 text-left hidden md:table-cell">Quy Cách</th>
                    <th className="px-3 py-2 text-left">Đơn Tính</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-outline-variant/10">
                      <td className="px-3 py-2 font-mono font-bold text-primary">{r.erp}</td>
                      <td className="px-3 py-2">{r.name || <span className="text-error/60 italic">Trống</span>}</td>
                      <td className="px-3 py-2 hidden md:table-cell text-on-surface-variant">{r.name_zh || '—'}</td>
                      <td className="px-3 py-2 hidden md:table-cell text-on-surface-variant">{r.spec || '—'}</td>
                      <td className="px-3 py-2">{r.unit || '—'}</td>
                    </tr>
                  ))}
                  {parsedRows.length > 50 && (
                    <tr><td colSpan={5} className="px-3 py-2 text-center text-on-surface-variant/50 italic">... và {parsedRows.length - 50} dòng nữa</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {uploading && (
              <div className="px-6 pb-2">
                <div className="w-full bg-surface-container rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="text-xs text-on-surface-variant mt-1 text-center">{uploadProgress}%</p>
              </div>
            )}

            <div className="p-6 border-t border-outline-variant/20 flex gap-3 justify-end">
              <button onClick={() => { setShowPreview(false); setParsedRows([]); }} disabled={uploading} className="px-5 py-2.5 rounded-xl border border-outline-variant/40 font-bold text-sm disabled:opacity-50">
                Hủy
              </button>
              <button onClick={confirmUpload} disabled={uploading} className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-sm disabled:opacity-50 flex items-center gap-2">
                {uploading ? <><span className="material-symbols-outlined text-base animate-spin">progress_activity</span> Đang upload...</> : <><span className="material-symbols-outlined text-base">upload</span> Xác nhận Upload</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterERP;
