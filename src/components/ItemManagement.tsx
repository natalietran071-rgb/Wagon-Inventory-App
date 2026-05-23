import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';

const ItemManagement = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    erp: '',
    unit: 'Cái (PCS)',
    name: '',
    name_zh: '',
    category: '',
    spec: '',
    pos: '',
    start_stock: 0,
    price: 0,
    critical: false
  });
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  
  // Preview states
  const [parsedItems, setParsedItems] = useState<any[]>([]);
  const [missingCount, setMissingCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [bulkImportDate, setBulkImportDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Db items state & filters
  const [dbItems, setDbItems] = useState<any[]>([]);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);

  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showSingleDeleteConfirm, setShowSingleDeleteConfirm] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);

  // Pending tab state
  const [activeMainTab, setActiveMainTab] = useState<'items' | 'pending'>('items');
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [editingPending, setEditingPending] = useState<any | null>(null);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [pendingModalSaving, setPendingModalSaving] = useState(false);
  const [deletePendingConfirm, setDeletePendingConfirm] = useState<any | null>(null);
  const [deletingPending, setDeletingPending] = useState(false);
  const [pendingSearch, setPendingSearch] = useState('');

  const handleSelectRow = (erp: string) => {
    setSelectedRows(prev => prev.includes(erp) ? prev.filter(r => r !== erp) : [...prev, erp]);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>, currentFilteredItems: any[]) => {
    if (e.target.checked) {
      setSelectedRows(currentFilteredItems.map(r => r.erp));
    } else {
      setSelectedRows([]);
    }
  };

  useEffect(() => { fetchItemsByDate(); }, [fromDate, toDate]);

  const fetchPendingInbound = async () => {
    setPendingLoading(true);
    try {
      const { data, count } = await supabase
        .from('inbound_upload_pending')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });
      setPendingItems(data || []);
      setPendingCount(count || 0);
    } catch (err) { console.error(err); }
    finally { setPendingLoading(false); }
  };

  useEffect(() => { if (activeMainTab === 'pending') fetchPendingInbound(); }, [activeMainTab]);

  const approvePendingInbound = async (p: any) => {
    if (!p.erp?.trim() || !p.name?.trim()) {
      alert('Cần có Mã ERP và Tên vật tư trước khi xác nhận.');
      return;
    }
    setPendingModalSaving(true);
    try {
      const erpTrimmed = p.erp.trim();
      // Check if ERP already exists in inventory
      const { data: existing } = await supabase.from('inventory').select('erp').eq('erp', erpTrimmed).maybeSingle();
      if (existing) {
        // Update existing record
        const { error: updErr } = await supabase.from('inventory').update({
          name: p.name, name_zh: p.name_zh, category: p.category,
          unit: p.unit || 'Cái (PCS)', spec: p.spec, pos: p.pos,
          price: p.price || 0, critical: p.critical || false, is_incomplete: false,
          updated_at: new Date().toISOString(),
        }).eq('erp', erpTrimmed);
        if (updErr) { alert('Lỗi cập nhật: ' + updErr.message); setPendingModalSaving(false); return; }
      } else {
        // Insert new record
        const { error: insErr } = await supabase.from('inventory').insert([{
          erp: erpTrimmed, name: p.name, name_zh: p.name_zh, category: p.category,
          unit: p.unit || 'Cái (PCS)', spec: p.spec, pos: p.pos,
          start_stock: p.start_stock || 0, end_stock: p.start_stock || 0,
          price: p.price || 0, critical: p.critical || false,
          in_qty: 0, out_qty: 0, created_at: new Date().toISOString(), is_incomplete: false,
        }]);
        if (insErr) { alert('Lỗi thêm mới: ' + insErr.message); setPendingModalSaving(false); return; }
      }
      if (p.order_id && p.qty > 0) {
        await supabase.from('inbound_records').insert([{
          order_id: p.order_id, erp_code: erpTrimmed, qty: p.qty,
          unit: p.unit, location: p.pos, status: 'Stocked',
          date: p.date || new Date().toISOString().split('T')[0],
          time: new Date().toLocaleTimeString()
        }]);
      }
      await supabase.from('inbound_upload_pending').delete().eq('id', p.id);
      setShowPendingModal(false);
      setEditingPending(null);
      fetchPendingInbound();
      fetchItemsByDate();
    } finally {
      setPendingModalSaving(false);
    }
  };

  const savePendingOnly = async () => {
    if (!editingPending) return;
    setPendingModalSaving(true);
    try {
      const { error } = await supabase.from('inbound_upload_pending').update({
        erp: editingPending.erp, name: editingPending.name, name_zh: editingPending.name_zh,
        category: editingPending.category, unit: editingPending.unit, spec: editingPending.spec,
        pos: editingPending.pos, start_stock: editingPending.start_stock, price: editingPending.price,
      }).eq('id', editingPending.id);
      if (error) { alert('Lỗi lưu: ' + error.message); return; }
      setShowPendingModal(false);
      setEditingPending(null);
      fetchPendingInbound();
    } finally {
      setPendingModalSaving(false);
    }
  };

  const deletePendingItem = async (p: any) => {
    setDeletingPending(true);
    try {
      const { error } = await supabase.from('inbound_upload_pending').delete().eq('id', p.id);
      if (error) { alert('Lỗi xóa: ' + error.message); return; }
      setDeletePendingConfirm(null);
      fetchPendingInbound();
    } finally {
      setDeletingPending(false);
    }
  };

  const fetchItemsByDate = async () => {
    setLoading(true);
    try {
      const CHUNK = 1000;
      let all: any[] = [];
      let from = 0;
      while (true) {
        let query = supabase.from('inventory').select('*').order('created_at', { ascending: false }).range(from, from + CHUNK - 1);
        if (fromDate) query = query.gte('created_at', new Date(fromDate).toISOString());
        if (toDate) {
          const endToDate = new Date(toDate);
          endToDate.setHours(23, 59, 59, 999);
          query = query.lte('created_at', endToDate.toISOString());
        }
        const { data } = await query;
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < CHUNK) break;
        from += CHUNK;
      }
      setDbItems(all);
    } catch (err) {
      console.error('Error fetching items:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    
    // originalItem is needed to calculate start_stock diff to update end_stock correctly
    const originalItem = dbItems.find(i => i.erp === editingItem.erp);
    const startStockDiff = Number(editingItem.start_stock) - Number(originalItem?.start_stock || 0);

    const newEndStock = Number(originalItem?.end_stock || 0) + startStockDiff;

    const { error } = await supabase
      .from('inventory')
      .update({
        name: editingItem.name,
        name_zh: editingItem.name_zh,
        category: editingItem.category,
        spec: editingItem.spec,
        unit: editingItem.unit,
        pos: editingItem.pos,
        price: editingItem.price,
        critical: editingItem.critical,
        start_stock: editingItem.start_stock,
        end_stock: newEndStock,
        is_incomplete: !editingItem.erp || !editingItem.name
      })
      .eq('erp', editingItem.erp);
    
    if (error) {
      alert('Lỗi lưu thay đổi: ' + error.message);
    } else {
      alert('Đã cập nhật thông tin thành công!');
      setEditingItem(null);
      fetchItemsByDate();
    }
  };

  const filteredDbItems = React.useMemo(() => {
    let result = dbItems;
    if (showIncompleteOnly) {
      result = result.filter(item => item.is_incomplete);
    }
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(item => 
        (item.erp && item.erp.toLowerCase().includes(lowerQuery)) ||
        (item.name && item.name.toLowerCase().includes(lowerQuery)) ||
        (item.name_zh && item.name_zh.toLowerCase().includes(lowerQuery)) ||
        (item.spec && item.spec.toLowerCase().includes(lowerQuery))
      );
    }
    return result;
  }, [dbItems, searchQuery, showIncompleteOnly]);

  const exportToExcel = () => {
    import('xlsx').then(XLSX => {
      const exportData = dbItems.map(item => ({
        'Thời gian tạo': new Date(item.created_at).toLocaleString(),
        'Mã ERP': item.erp,
        'Tên Vật Tư': item.name,
        'Tên Tiếng Trung': item.name_zh || '',
        'Quy cách': item.spec || '',
        'Đơn vị': item.unit,
        'Vị trí': item.pos || '',
        'Tồn Đầu Kỳ': item.start_stock,
        'Tồn Cuối': item.end_stock
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "ItemManagement");
      const fileName = `Quan_Ly_Ma_Hang_${fromDate || 'All'}_to_${toDate || 'All'}.xlsx`;
      XLSX.writeFile(wb, fileName);
    });
  };

  const executeSingleDelete = async () => {
    if (!showSingleDeleteConfirm) return;
    const { error } = await supabase.from('inventory').delete().eq('erp', showSingleDeleteConfirm);
    if (!error) {
      alert('Xóa thành công');
      fetchItemsByDate();
    } else {
      alert('Không thể xóa vật tư. Có thể đang bị ràng buộc dữ liệu.');
    }
    setShowSingleDeleteConfirm(null);
  };

  const handleDeleteFilteredListings = () => {
     if (!fromDate && !toDate && !searchQuery) {
        alert('Vui lòng sử dụng tính năng "Tìm kiếm" hoặc "Lọc theo ngày" để chọn vùng dữ liệu trước khi xóa toàn bộ!');
        return;
     }
     if (filteredDbItems.length === 0) return;
     setShowBulkDeleteConfirm(true);
  };

  const executeBulkDelete = async () => {
     setShowBulkDeleteConfirm(false);
     setLoading(true);
     try {
        const erpsToDelete = filteredDbItems.map(r => r.erp);
        const chunkSize = 200;
        let deletedCount = 0;
        for (let i = 0; i < erpsToDelete.length; i += chunkSize) {
           const chunk = erpsToDelete.slice(i, i + chunkSize);
           const { error } = await supabase.from('inventory').delete().in('erp', chunk);
           if (error) throw error;
           deletedCount += chunk.length;
        }
        alert(`Đã xóa thành công ${deletedCount} mã vật tư.`);
        fetchItemsByDate();
     } catch (err: any) {
        console.error('Lỗi khi xóa:', err);
        alert('Không thể xóa số lượng lớn. Có thể một số mặt hàng bị ràng buộc ở các bảng khác (Kiểm kê, Yêu cầu vật tư...).');
     } finally {
        setLoading(false);
     }
  };

  const executeDeleteSelected = async () => {
    setShowDeleteSelectedConfirm(false);
    setLoading(true);
    try {
      const chunkSize = 200;
      let deletedCount = 0;
      for (let i = 0; i < selectedRows.length; i += chunkSize) {
        const chunk = selectedRows.slice(i, i + chunkSize);
        const { error } = await supabase.from('inventory').delete().in('erp', chunk);
        if (error) throw error;
        deletedCount += chunk.length;
      }
      alert(`Đã xóa thành công ${deletedCount} mã vật tư đã chọn.`);
      setSelectedRows([]);
      fetchItemsByDate();
    } catch (err: any) {
      console.error('Lỗi khi xóa:', err);
      alert('Không thể xóa. Có thể mã hàng đã được liên kết với các bảng dữ liệu khác.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile && profile.role !== 'admin' && profile.role !== 'editor') {
      alert('Bạn không có quyền truy cập trang này.');
      navigate('/');
    }
  }, [profile, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.erp || !formData.name) {
      alert('Vui lòng điền đầy đủ Mã ERP và Tên vật tư.');
      return;
    }

    setLoading(true);
    
    try {
      // Check if ERP already exists
      const { data: existing, error: checkError } = await supabase
        .from('inventory')
        .select('erp')
        .eq('erp', formData.erp)
        .maybeSingle();

      if (checkError) {
        console.warn('Lỗi khi kiểm tra mã ERP (có thể bỏ qua):', checkError);
      }

      if (existing) {
        alert('Mã ERP này đã tồn tại trong hệ thống!');
        setLoading(false);
        return;
      }

      const { error } = await supabase
        .from('inventory')
        .insert([{
          erp: formData.erp,
          name: formData.name,
          name_zh: formData.name_zh,
          category: formData.category,
          unit: formData.unit,
          spec: formData.spec,
          pos: formData.pos,
          start_stock: formData.start_stock,
          end_stock: formData.start_stock,
          price: formData.price,
          critical: formData.critical,
          in_qty: 0,
          out_qty: 0,
          created_at: new Date().toISOString()
        }]);

      if (error) {
        throw error;
      }

      alert('Thêm vật tư thành công!');
      fetchItemsByDate();
      setFormData({ erp: '', unit: 'Cái (PCS)', name: '', name_zh: '', category: '', spec: '', pos: '', start_stock: 0, price: 0, critical: false });
    } catch (err: any) {
      console.error('Submit error:', err);
      alert('Lỗi khi lưu vật tư: ' + (err.message || 'Đã xảy ra lỗi không xác định.'));
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const templateData = [
      {
        'Ngày Nhập Kho': '2024-05-20',
        'Mã Đơn Nhập Kho (Order ID)': 'WGN-2024-001',
        'Mã ERP': 'WGN-EXAMPLE-001',
        'Tên Vật Tư (VN)': 'Vỏ nhựa',
        'Tên Vật Tư (CN)': '塑料外壳',
        'Phân Loại': 'Nhựa',
        'Quy Cách': '70*150mm',
        'Đơn Vị Tính': 'Cái (PCS)',
        'Vị Trí': 'SÂN THƯỢNG',
        'Tồn Đầu Kỳ': 100,
        'Đơn Giá': 5000,
        'Vật Tư Quan Trọng (Y/N)': 'N'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Wagon_Inventory_Template.xlsx');
  };

  const normalizeKey = (key: string) => {
    if (!key) return '';
    return key.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const wsname = workbook.SheetNames[0];
      const ws = workbook.Sheets[wsname];
      
      // Read as array of arrays to find the header row
      const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      
      let headerRowIndex = -1;
      let headers: string[] = [];

      // Look for a row that has something resembling "Mã ERP" or "Tên Vật Tư"
      for (let i = 0; i < Math.min(rawData.length, 20); i++) { // Check first 20 rows
        const row = rawData[i];
        if (!row || !Array.isArray(row)) continue;
        
        const rowStrings = row.map(cell => cell ? normalizeKey(String(cell)) : '');
        const hasErp = rowStrings.some(s => s.includes('maerp') || s.includes('mavattu') || s.includes('itemcode'));
        const hasName = rowStrings.some(s => s.includes('tenvattu') || s.includes('tenhang') || s.includes('itemname'));
        
        if (hasErp || hasName) {
          headerRowIndex = i;
          headers = row.map(cell => cell ? String(cell).trim() : '');
          break;
        }
      }

      if (headerRowIndex === -1) {
        alert('Không tìm thấy dòng tiêu đề (Header) trong file Excel.\nVui lòng đảm bảo file có chứa các cột như "Mã ERP", "Tên Vật Tư".\nBạn có thể tải Template về để xem mẫu chuẩn.');
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // Now map the data rows using the found headers
      const dataRows = rawData.slice(headerRowIndex + 1);
      
      if (dataRows.length > 20000) {
        alert(`Số lượng dữ liệu (${dataRows.length} dòng) vượt quá giới hạn 20,000 dòng/lần tải. Vui lòng chia nhỏ file Excel ra hoặc xóa bớt để đảm bảo tốc độ và độ ổn định của hệ thống!`);
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      const jsonData = dataRows.map(rowArray => {
        const rowObj: any = {};
        headers.forEach((header, index) => {
          if (header) {
            rowObj[header] = rowArray[index];
          }
        });
        return rowObj;
      });

      if (!jsonData || jsonData.length === 0) {
        alert('File Excel không có dữ liệu hoặc sai định dạng.');
        setImporting(false);
        return;
      }

      setTotalRows(jsonData.length);

      // Helper to get value by highly robust key matching
      const getVal = (row: any, targetKeys: string[]) => {
        const normalizedTargets = targetKeys.map(normalizeKey);
        const key = Object.keys(row).find(k => {
          const normalizedK = normalizeKey(k);
          return normalizedTargets.some(target => normalizedK.includes(target));
        });
        return key ? row[key] : null;
      };

      let missing = 0;

      const itemsToInsert = jsonData.map((row, rowIdx) => {
        const inputErp = getVal(row, ['Mã ERP', 'Mã VT', 'Mã Vật Tư', 'Item Code'])?.toString().trim() || '';
        const name = getVal(row, ['Tên Vật Tư (VN)', 'Tên Vật Tư', 'Tên Hàng', 'Item Name'])?.toString().trim() || '';
        const startStock = parseInt(getVal(row, ['Tồn Đầu Kỳ', 'Tồn Đầu', 'Số Lượng', 'Qty', 'Start Stock'])) || 0;
        const rawOrderId = getVal(row, ['Mã Đơn Nhập Kho (Order ID)', 'Mã Đơn Nhập Kho', 'Order ID', 'Mã Đơn'])?.toString().trim() || '';
        // "Opening Q'ty" and similar represent opening balance, not real inbound transactions
        const isOpeningStock = rawOrderId && /opening|tồn\s*đầu|ton\s*dau|opening\s*q/i.test(rawOrderId);
        const orderId = isOpeningStock ? '' : rawOrderId;
        const rawDate = getVal(row, ['Ngày Nhập Kho', 'Ngày Nhập', 'Date', 'Ngày']);
        
        // Parse date
        let parsedDate = '';
        if (rawDate) {
          if (typeof rawDate === 'number') {
            // Excel serial date to JS Date
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            parsedDate = new Date(excelEpoch.getTime() + rawDate * 86400000).toISOString().split('T')[0];
          } else {
            // Format parsing for DD/MM/YYYY or YYYY-MM-DD
            const strDate = rawDate.toString().trim();
            if (strDate.includes('/')) {
              const parts = strDate.split('/');
              if (parts.length === 3) {
                 parsedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
              }
            } else if (strDate.includes('-')) {
              parsedDate = strDate;
            }
          }
        }
        
        const is_incomplete = !inputErp || !name;
        if (is_incomplete) {
          missing++;
        }

        const erp = inputErp || (name ? `TEMP-${Date.now()}-${rowIdx}` : `EMPTY-${Date.now()}-${rowIdx}`);

        return {
          erp,
          name,
          name_zh: getVal(row, ['Tên Vật Tư (CN)', 'Tên Vật Tư (ZH)', 'Tên Tiếng Trung', 'Chinese Name'])?.toString().trim() || '',
          category: getVal(row, ['Phân Loại', 'Category', 'Nhóm'])?.toString().trim() || '',
          unit: getVal(row, ['Đơn Vị Tính', 'ĐVT', 'Unit'])?.toString().trim() || 'Cái (PCS)',
          spec: getVal(row, ['Quy Cách', 'Spec', 'Kích Thước'])?.toString().trim() || '',
          pos: getVal(row, ['Vị Trí', 'Location', 'Khu Vực'])?.toString().trim() || '',
          start_stock: (rawOrderId && !isOpeningStock) ? 0 : startStock,
          end_stock: (rawOrderId && !isOpeningStock) ? 0 : startStock,
          price: parseFloat(getVal(row, ['Đơn Giá', 'Price', 'Giá'])) || 0,
          critical: getVal(row, ['Vật Tư Quan Trọng (Y/N)', 'Vật Tư Quan Trọng', 'Critical'])?.toString().trim().toUpperCase() === 'Y',
          in_qty: 0,
          out_qty: 0,
          created_at: new Date().toISOString(),
          is_incomplete,
          _temp_order_id: orderId,
          _temp_qty: startStock,
          _temp_date: parsedDate,
          _is_file_duplicate: false,
        };
      });

      setMissingCount(missing);

      // Detect duplicate ERPs within the same file (among valid items)
      const erpCounts = new Map<string, number>();
      itemsToInsert.forEach(item => {
        if (!item.is_incomplete) {
          erpCounts.set(item.erp, (erpCounts.get(item.erp) || 0) + 1);
        }
      });
      let fileDupCount = 0;
      itemsToInsert.forEach(item => {
        if (!item.is_incomplete && (erpCounts.get(item.erp) || 0) > 1) {
          item._is_file_duplicate = true;
          fileDupCount++;
        }
      });
      setDuplicateCount(fileDupCount);

      if (itemsToInsert.length === 0) {
        alert(`Hệ thống đc được ${jsonData.length} dòng từ file Excel, nhưng KHÔNG CÓ dòng nào được parse.\nVui lòng kiểm tra lại định dạng file.`);
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // Show preview instead of uploading immediately
      setParsedItems(itemsToInsert);
      
    } catch (err: any) {
      console.error('Excel processing error:', err);
      alert('Lỗi khi xử lý file Excel: ' + (err.message || 'Vui lòng kiểm tra lại định dạng file.'));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const confirmUpload = async () => {
    setIsUploading(true);
    setUploadProgress(0);
    
    try {
      // Create inbound records using EXACT parsedItems
      const allInboundRecords: any[] = [];

      parsedItems.forEach(item => {
         // Only create inbound records when there is an actual Order ID
         // Opening stock (tồn đầu kỳ) should NOT create inbound records
         if (item._temp_qty > 0 && item._temp_order_id) {
            allInboundRecords.push({
              order_id: item._temp_order_id,
              erp_code: item.erp,
              qty: item._temp_qty,
              unit: item.unit,
              location: item.pos,
              status: 'Stocked',
              date: item._temp_date || bulkImportDate,
              time: new Date().toLocaleTimeString()
            });
         }
      });

      // === CORE LOGIC: Preserve ALL items, route anomalies to pending ===
      // 1. Collect unique ERPs from valid (non-incomplete) items
      const allErps = parsedItems.map(i => i.erp);
      const uniqueErps = Array.from(new Set(allErps));

      // 2. Fetch master_erp names for cross-reference (name mismatch check)
      const masterErpNameMap = new Map<string, string>(); // erp -> master name
      const fetchChunk = 200;
      for (let i = 0; i < uniqueErps.length; i += fetchChunk) {
        const chunk = uniqueErps.slice(i, i + fetchChunk);
        const { data: masterData } = await supabase.from('master_erp').select('erp, name').in('erp', chunk);
        if (masterData) {
          masterData.forEach((m: any) => masterErpNameMap.set(m.erp, m.name));
        }
      }

      // Route items: missing info → pending, file duplicate → pending,
      // master name mismatch → pending, everything else → inventory
      const inventoryItems: any[] = [];
      const pendingToInsert: any[] = [];

      parsedItems.forEach(item => {
        const hasErp  = item.erp && item.erp !== '0' && item.erp !== '#N/A' && item.erp !== 'N/A';
        const hasName = !!item.name?.trim();

        const buildPendingRow = (reason: string) => ({
          erp:         item.erp || '',
          name:        item.name || '',
          name_zh:     item.name_zh || '',
          category:    item.category || '',
          unit:        item.unit || 'Cái (PCS)',
          spec:        item.spec || '',
          pos:         item.pos || '',
          start_stock: item.start_stock || 0,
          price:       item.price || 0,
          critical:    item.critical || false,
          order_id:    item._temp_order_id || '',
          qty:         item._temp_qty || 0,
          date:        item._temp_date || '',
          reason,
        });

        if (!hasErp || !hasName) {
          const reason = !hasErp && !hasName ? 'missing_erp_and_name' : !hasErp ? 'missing_erp' : 'missing_name';
          pendingToInsert.push(buildPendingRow(reason));
        } else if (item._is_file_duplicate) {
          pendingToInsert.push(buildPendingRow('duplicate_erp_in_file'));
        } else {
          // Cross-check against master_erp — if ERP exists with a different name, route to pending
          const masterName = masterErpNameMap.get(item.erp);
          const nameMismatch = masterName !== undefined &&
            masterName.trim().toLowerCase() !== item.name.trim().toLowerCase();
          if (nameMismatch) {
            // Store master name in reason so user can see it in the pending modal
            pendingToInsert.push(buildPendingRow(`name_mismatch_with_master|${masterName}`));
          } else {
            inventoryItems.push({
              erp:          item.erp,
              name:         item.name,
              name_zh:      item.name_zh,
              category:     item.category,
              unit:         item.unit,
              spec:         item.spec,
              pos:          item.pos,
              price:        item.price,
              critical:     item.critical,
              start_stock:  item.start_stock || 0,
              end_stock:    item.end_stock || 0,
              in_qty:       0,
              out_qty:      0,
              created_at:   item.created_at,
              is_incomplete: false,
            });
          }
        }
      });

      const chunkSize = 500;
      let successCount = 0;
      let errorCount = 0;
      let lastError = '';

      // 4. Upsert inventory chunk by chunk (upsert keeps existing data for same ERP, inserts new)
      for (let i = 0; i < inventoryItems.length; i += chunkSize) {
        const chunk = inventoryItems.slice(i, i + chunkSize);
        let { error } = await supabase.rpc('bulk_upsert_inventory', { p_items: chunk });
        
        if (error) {
          // Fallback: try direct upsert if RPC fails
          const { error: fallbackError } = await supabase
            .from('inventory')
            .upsert(chunk, { onConflict: 'erp' });
          
          if (fallbackError) {
            console.error(`Error importing chunk ${i / chunkSize + 1}:`, fallbackError);
            errorCount += chunk.length;
            lastError = fallbackError.message;
          } else {
            successCount += chunk.length;
          }
        } else {
          successCount += chunk.length;
        }
        setUploadProgress(Math.round(((i + chunk.length) / inventoryItems.length) * 50));
      }

      // 5. Insert Inbound Records and Movements chunk by chunk
      if (allInboundRecords.length > 0) {
         let inboundSuccessCount = 0;
         for (let i = 0; i < allInboundRecords.length; i += chunkSize) {
           const chunk = allInboundRecords.slice(i, i + chunkSize);
           const { error: inboundError } = await supabase.from('inbound_records').insert(chunk);
           
           if (!inboundError) {
              const movementsToInsert = chunk.map(record => ({
                 type: 'IN',
                 item_name: record.erp_code,
                 qty: record.qty,
                 user_name: profile?.email || 'Bulk Upload',
                 created_at: new Date(record.date).toISOString()
              }));
              await supabase.from('movements').insert(movementsToInsert);
              inboundSuccessCount += chunk.length;
           } else {
              console.error('Error creating inbound records:', inboundError);
           }
         }
         console.log(`Successfully created ${inboundSuccessCount} inbound records out of ${allInboundRecords.length}`);
      }

      // Insert pending rows (don't insert with TEMP codes)
      let pendingInserted = 0;
      if (pendingToInsert.length > 0) {
        const PCHUNK = 500;
        for (let i = 0; i < pendingToInsert.length; i += PCHUNK) {
          const { error: pErr } = await supabase.from('inbound_upload_pending').insert(pendingToInsert.slice(i, i + PCHUNK));
          if (!pErr) pendingInserted += Math.min(PCHUNK, pendingToInsert.length - i);
        }
        setPendingCount(c => c + pendingInserted);
      }

      setUploadProgress(100);

      const pendingMsg = pendingInserted > 0 ? `\n⚠️ ${pendingInserted} dòng bất thường (thiếu ERP/Tên, trùng mã, tên khác Master) → chuyển vào tab Chờ xử lý` : '';
      if (errorCount > 0) {
        alert(`Tải lên hoàn tất nhưng có lỗi.\n\nThành công: ${successCount} item\nLỗi: ${errorCount} item${pendingMsg}`);
      } else {
        alert(`✅ Tải lên thành công ${successCount} item${allInboundRecords.length > 0 ? ` và ${allInboundRecords.length} phiếu nhập` : ''}!${pendingMsg}`);
        fetchItemsByDate();
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      alert('Lỗi khi tải dữ liệu lên server: ' + err.message);
    } finally {
      setIsUploading(false);
      setParsedItems([]);
    }
  };

  const cancelUpload = () => {
    setParsedItems([]);
    setUploadProgress(0);
  };


  const filteredPendingItems = React.useMemo(() => {
    if (!pendingSearch.trim()) return pendingItems;
    const q = pendingSearch.toLowerCase();
    return pendingItems.filter(p =>
      (p.erp && p.erp.toLowerCase().includes(q)) ||
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.spec && p.spec.toLowerCase().includes(q)) ||
      (p.order_id && p.order_id.toLowerCase().includes(q))
    );
  }, [pendingItems, pendingSearch]);

  const PENDING_REASON: Record<string, string> = {
    missing_erp: 'Thiếu Mã ERP',
    missing_name: 'Thiếu Tên vật tư',
    missing_erp_and_name: 'Thiếu ERP & Tên',
    duplicate_erp_in_file: 'Trùng ERP trong file',
    name_mismatch_with_master: 'Tên khác Master ERP',
  };

  const getPendingReasonLabel = (reason: string) => {
    if (!reason) return '';
    if (reason.startsWith('name_mismatch_with_master')) {
      const masterName = reason.split('|')[1];
      return masterName ? `Tên khác Master: "${masterName}"` : 'Tên khác Master ERP';
    }
    return PENDING_REASON[reason] || reason;
  };

  return (
    <div className="space-y-10">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-surface-container rounded-2xl p-1 w-fit">
        <button onClick={() => setActiveMainTab('items')}
          className={`px-5 py-2 rounded-xl text-sm font-bold transition-colors ${activeMainTab === 'items' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
          Danh sách vật tư
        </button>
        <button onClick={() => setActiveMainTab('pending')}
          className={`px-5 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2 ${activeMainTab === 'pending' ? 'bg-amber-500 text-white' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
          Chờ xử lý
          {pendingCount > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full font-black ${activeMainTab === 'pending' ? 'bg-white/20' : 'bg-amber-500 text-white'}`}>{pendingCount}</span>}
        </button>
      </div>

      {/* Pending tab */}
      {activeMainTab === 'pending' && (
        <div>
          <div className="flex items-center gap-3 mb-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl">
            <span className="material-symbols-outlined text-amber-500 text-2xl">warning</span>
            <div>
              <p className="text-sm font-bold text-on-surface">Dữ liệu cần xem xét trước khi nhập kho</p>
              <p className="text-xs text-on-surface-variant mt-0.5">Bao gồm: thiếu ERP/Tên, trùng mã ERP trong file, hoặc tên khác Master ERP. Sửa thông tin rồi bấm <strong className="text-amber-600">Xác nhận</strong> để đưa vào hệ thống.</p>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-on-surface-variant">Tổng chờ xử lý:</span>
              <span className="px-2.5 py-0.5 bg-amber-500/15 text-amber-700 rounded-full text-xs font-black">{pendingCount}</span>
            </div>
            {pendingSearch.trim() && (
              <span className="text-xs text-on-surface-variant">
                Đang lọc: <strong className="text-primary">{filteredPendingItems.length}</strong> / {pendingCount}
              </span>
            )}
          </div>

          <div className="relative mb-4">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-base pointer-events-none">search</span>
            <input
              value={pendingSearch}
              onChange={e => setPendingSearch(e.target.value)}
              placeholder="Tìm mã ERP, tên vật tư, Order ID..."
              className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl text-sm border border-outline-variant/40 shadow-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all"
            />
          </div>

          {pendingLoading ? (
            <p className="text-center py-12 text-on-surface-variant/40">Đang tải...</p>
          ) : filteredPendingItems.length === 0 ? (
            <div className="text-center py-16 bg-surface-container-low rounded-2xl">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 block mb-2">{pendingSearch ? 'search_off' : 'check_circle'}</span>
              <p className="text-sm text-on-surface-variant/50">{pendingSearch ? `Không tìm thấy kết quả cho "${pendingSearch}"` : 'Không có mục nào đang chờ xử lý'}</p>
            </div>
          ) : (
            <div className="bg-surface-container-low rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest border-b border-outline-variant/20">
                      <th className="px-4 py-3">Mã ERP</th>
                      <th className="px-4 py-3">Tên vật tư</th>
                      <th className="px-4 py-3 hidden md:table-cell">Quy Cách</th>
                      <th className="px-4 py-3 hidden lg:table-cell">Order ID</th>
                      <th className="px-4 py-3 hidden lg:table-cell">SL</th>
                      <th className="px-4 py-3">Lý do</th>
                      <th className="px-4 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPendingItems.map((p) => (
                      <tr key={p.id} onClick={() => { setEditingPending({...p}); setShowPendingModal(true); }} className="border-t border-outline-variant/10 hover:bg-amber-500/5 cursor-pointer">
                        <td className="px-4 py-3 font-mono font-bold text-amber-600 text-xs">{p.erp || <span className="italic text-on-surface-variant/40">Trống</span>}</td>
                        <td className="px-4 py-3">{p.name || <span className="italic text-error/50 text-xs">Chưa có tên</span>}</td>
                        <td className="px-4 py-3 hidden md:table-cell text-on-surface-variant text-xs">{p.spec || '—'}</td>
                        <td className="px-4 py-3 hidden lg:table-cell text-on-surface-variant text-xs">{p.order_id || '—'}</td>
                        <td className="px-4 py-3 hidden lg:table-cell text-on-surface-variant text-xs">{p.qty || 0}</td>
                        <td className="px-4 py-3"><span className="px-2 py-0.5 bg-amber-500/15 text-amber-700 rounded-full text-xs font-semibold">{getPendingReasonLabel(p.reason)}</span></td>
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => { setEditingPending({...p}); setShowPendingModal(true); }} className="p-1.5 rounded-lg text-outline-variant hover:text-primary hover:bg-primary/10 transition-colors" title="Sửa"><span className="material-symbols-outlined text-base">edit</span></button>
                            <button onClick={() => { setEditingPending({...p}); setShowPendingModal(true); }} className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition-colors"><span className="material-symbols-outlined text-sm">check</span>Xác nhận</button>
                            <button onClick={e => { e.stopPropagation(); setDeletePendingConfirm(p); }} className="p-1.5 rounded-lg text-outline-variant hover:text-error hover:bg-error/10 transition-colors" title="Xóa"><span className="material-symbols-outlined text-base">delete</span></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeMainTab === 'items' && <>
      <div className="flex flex-col md:flex-row md:items-end justify-between items-start gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-extrabold font-manrope text-on-surface tracking-tight mb-2">Đăng Ký Vật Tư Mới</h2>
          <p className="text-on-surface-variant md:text-lg">Khởi tạo mã ERP và định danh thông số kỹ thuật cho hệ thống quản trị.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button 
            type="button"
            onClick={downloadTemplate}
            className="px-6 py-3 bg-surface-container-high text-on-surface-variant rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-surface-container-highest transition-all"
          >
            <span className="material-symbols-outlined">download</span>
            Tải Template Excel
          </button>
          <button 
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="px-6 py-3 bg-secondary text-on-secondary rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-secondary/20 hover:opacity-90 transition-all disabled:opacity-50"
          >
            <span className="material-symbols-outlined">{importing ? 'sync' : 'upload_file'}</span>
            {importing ? 'Đang tải...' : 'Upload Excel (Bulk)'}
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleExcelUpload} 
            accept=".xlsx, .xls" 
            className="hidden" 
          />
        </div>
      </div>

      <form onSubmit={handleSubmit} className={`grid grid-cols-12 gap-8 ${parsedItems.length > 0 ? 'hidden' : ''}`}>
        <div className="col-span-12 lg:col-span-8 space-y-8">
          <section className="bg-surface-container-lowest rounded-xl p-8 shadow-sm">
            <div className="flex items-center gap-2 mb-8 text-primary">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>assignment</span>
              <h3 className="font-manrope font-bold text-lg">Thông Tin Cơ Bản</h3>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="col-span-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Mã ERP</label>
                <input 
                  className="w-full bg-surface-container-low border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all outline-none text-on-surface font-medium placeholder:text-outline-variant/50" 
                  placeholder="E.g., WGN-2024-001" 
                  type="text" 
                  value={formData.erp}
                  onChange={(e) => setFormData({ ...formData, erp: e.target.value })}
                  required
                />
              </div>
              <div className="col-span-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Đơn Vị Tính</label>
                <input 
                  list="unit-options"
                  className="w-full bg-surface-container-low border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all outline-none text-on-surface font-medium"
                  placeholder="Nhập hoặc chọn đơn vị..."
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                />
                <datalist id="unit-options">
                  <option value="Cái (PCS)" />
                  <option value="Bộ (SET)" />
                  <option value="Mét (M)" />
                  <option value="Kg (KG)" />
                  <option value="Cuộn" />
                  <option value="Thùng" />
                  <option value="Hộp" />
                  <option value="Tấm" />
                </datalist>
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Tên Vật Tư (VN)</label>
                <input 
                  className="w-full bg-surface-container-low border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all outline-none text-on-surface font-medium" 
                  placeholder="Nhập tên tiếng Việt..." 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Tên Vật Tư (CN)</label>
                <input 
                  className="w-full bg-surface-container-low border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all outline-none text-on-surface font-medium" 
                  placeholder="Nhập tên tiếng Trung..." 
                  type="text" 
                  value={formData.name_zh}
                  onChange={(e) => setFormData({ ...formData, name_zh: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Phân Loại (Category)</label>
                <input 
                  className="w-full bg-surface-container-low border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all outline-none text-on-surface font-medium" 
                  placeholder="E.g., Metal, Parts..." 
                  type="text" 
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Đơn Giá (VND)</label>
                <input 
                  className="w-full bg-surface-container-low border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all outline-none text-on-surface font-medium" 
                  placeholder="0" 
                  type="number" 
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="col-span-2 flex items-center gap-3 bg-surface-container-low p-4 rounded-xl">
                <input 
                  type="checkbox" 
                  id="critical"
                  className="w-5 h-5 rounded border-outline-variant text-primary focus:ring-primary"
                  checked={formData.critical}
                  onChange={(e) => setFormData({ ...formData, critical: e.target.checked })}
                />
                <label htmlFor="critical" className="text-sm font-bold text-on-surface cursor-pointer">Vật Tư Quan Trọng (Critical Item)</label>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Thông Số Kỹ Thuật (Spec)</label>
                <textarea 
                  className="w-full bg-surface-container-low border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all outline-none text-on-surface font-medium resize-none" 
                  placeholder="Mô tả chi tiết kỹ thuật, kích thước, chất liệu..." 
                  rows={4}
                  value={formData.spec}
                  onChange={(e) => setFormData({ ...formData, spec: e.target.value })}
                ></textarea>
              </div>
            </div>
          </section>

          <section className="bg-surface-container-lowest rounded-xl p-8 shadow-sm">
            <div className="flex items-center gap-2 mb-8 text-secondary">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>location_on</span>
              <h3 className="font-manrope font-bold text-lg">Lưu Trữ & Khởi Tạo</h3>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="col-span-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Vị Trí Mặc Định</label>
                <div className="relative">
                  <input 
                    className="w-full bg-surface-container-low border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:bg-surface-container-lowest transition-all outline-none text-on-surface font-medium" 
                    placeholder="Zone-A / Rack-05" 
                    type="text" 
                    value={formData.pos}
                    onChange={(e) => setFormData({ ...formData, pos: e.target.value })}
                  />
                  <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-outline-variant">search</span>
                </div>
              </div>
              <div className="col-span-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Số Lượng Đầu Kỳ</label>
                <div className="flex items-center bg-surface-container-low rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:bg-surface-container-lowest transition-all">
                  <button type="button" onClick={() => setFormData(prev => ({ ...prev, start_stock: Math.max(0, prev.start_stock - 1) }))} className="px-4 py-3 hover:bg-surface-container-high transition-colors text-on-surface-variant"><span className="material-symbols-outlined text-sm">remove</span></button>
                  <input 
                    className="w-full bg-transparent border-0 text-center py-3 focus:ring-0 text-on-surface font-bold" 
                    type="number" 
                    value={formData.start_stock}
                    onChange={(e) => setFormData({ ...formData, start_stock: parseInt(e.target.value) || 0 })}
                  />
                  <button type="button" onClick={() => setFormData(prev => ({ ...prev, start_stock: prev.start_stock + 1 }))} className="px-4 py-3 hover:bg-surface-container-high transition-colors text-on-surface-variant"><span className="material-symbols-outlined text-sm">add</span></button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="bg-surface-container-low rounded-xl p-6 border-2 border-dashed border-outline-variant/30 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-full bg-surface-container-lowest flex items-center justify-center text-primary mb-4 shadow-sm">
              <span className="material-symbols-outlined text-3xl">add_a_photo</span>
            </div>
            <h4 className="font-bold text-on-surface mb-1">Ảnh Minh Họa</h4>
            <p className="text-xs text-on-surface-variant mb-4">Tải lên hình ảnh vật tư thực tế để dễ dàng nhận diện.</p>
            <button type="button" className="px-6 py-2 bg-surface-container-lowest text-primary text-xs font-bold rounded-full shadow-sm hover:bg-primary hover:text-on-primary transition-all">Chọn File</button>
          </div>

          <div className="bg-surface-container-highest rounded-xl p-6 space-y-4">
            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold shadow-lg shadow-primary/20 flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <span className="material-symbols-outlined">{loading ? 'sync' : 'save'}</span>
              {loading ? 'Đang lưu...' : 'Lưu Thông Tin'}
            </button>
          </div>
        </div>
      </form>

      {parsedItems.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-primary">
              <span className="material-symbols-outlined text-3xl">table_view</span>
              <div>
                <h3 className="font-manrope font-bold text-xl">Xác nhận Dữ liệu Upload</h3>
                <p className="text-sm text-on-surface-variant font-medium">
                  Hệ thống đã đọc được <span className="text-on-surface font-bold">{totalRows.toLocaleString('en-US')}</span> dòng.
                  Tìm thấy <span className="text-primary font-bold">{(parsedItems.length - missingCount - duplicateCount).toLocaleString('en-US')}</span> vật tư hợp lệ.
                  {missingCount > 0 && <span className="text-amber-600 ml-1 font-semibold">(⚠️ {missingCount.toLocaleString('en-US')} dòng thiếu ERP/Tên → <strong>Tab Chờ xử lý</strong>)</span>}
                  {duplicateCount > 0 && <span className="text-orange-600 ml-1 font-semibold">(⚠️ {duplicateCount.toLocaleString('en-US')} dòng trùng Mã ERP trong file → <strong>Tab Chờ xử lý</strong>)</span>}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 bg-surface-container-low p-3 rounded-xl border border-outline-variant/10">
               <label className="text-xs font-bold text-on-surface-variant uppercase">Ngày mặc định (nếu ô Excel trống):</label>
               <input 
                  type="date"
                  value={bulkImportDate}
                  onChange={(e) => setBulkImportDate(e.target.value)}
                  className="bg-transparent border-none text-sm font-bold text-primary focus:ring-0 p-0 cursor-pointer"
               />
            </div>
          </div>

          <div className="overflow-x-auto border border-outline-variant/20 rounded-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low">
                  <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase">Mã ERP</th>
                  <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase">Tên Vật Tư (VN)</th>
                  <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase">Tên Vật Tư (CN)</th>
                  <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase">Đơn Vị</th>
                  <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase text-right">Tồn Đầu / Nhập</th>
                  <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase text-right">Ngày</th>
                  <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase text-right">Đơn Nhập</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-outline-variant/10">
                {parsedItems.slice(0, 5).map((item, idx) => (
                  <tr key={item.id || item.erp || idx} className="hover:bg-surface-container-low/50">
                    <td className="px-4 py-3 font-bold text-primary">{item.erp}</td>
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{item.name_zh || '-'}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{item.unit}</td>
                    <td className="px-4 py-3 text-right font-bold text-secondary">{(item._temp_qty || item.start_stock).toLocaleString('en-US')}</td>
                    <td className="px-4 py-3 text-right text-on-surface-variant whitespace-nowrap">{item._temp_date ? new Date(item._temp_date).toLocaleDateString('vi-VN') : 'Mặc định'}</td>
                    <td className="px-4 py-3 text-right text-xs bg-secondary-container text-on-secondary-container max-w-[100px] truncate">{item._temp_order_id || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedItems.length > 5 && (
              <div className="px-4 py-3 bg-surface-container-low/30 text-center text-xs font-medium text-on-surface-variant">
                ... và {parsedItems.length - 5} vật tư khác
              </div>
            )}
          </div>

          {isUploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-bold text-primary">
                <span>Đang tải lên hệ thống...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-primary h-full transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          <div className="flex gap-4 pt-4 border-t border-outline-variant/20">
            <button 
              onClick={cancelUpload}
              disabled={isUploading}
              className="px-6 py-3 bg-surface-container-high text-on-surface-variant rounded-xl font-bold text-sm hover:bg-surface-container-highest transition-all disabled:opacity-50 flex-1"
            >
              Hủy bỏ
            </button>
            <button 
              onClick={confirmUpload}
              disabled={isUploading}
              className="px-6 py-3 bg-primary text-on-primary rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 transition-all disabled:opacity-50 flex-1 flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <span className="material-symbols-outlined animate-spin">sync</span>
                  Đang xử lý...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">cloud_upload</span>
                  Xác nhận Upload {parsedItems.length - missingCount - duplicateCount} vật tư{(missingCount + duplicateCount) > 0 ? ` + ${missingCount + duplicateCount} chờ xử lý` : ''}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* RECENT ITEMS & EDIT */}
      {parsedItems.length === 0 && (
        <div className="bg-surface-container-lowest rounded-xl p-4 md:p-8 shadow-sm space-y-6">
          <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
            <h3 className="font-manrope font-bold text-lg md:text-xl flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">history</span>
              Danh sách quản lý mã vật tư
            </h3>
            
            <div className="flex gap-2 md:gap-4 items-center flex-wrap w-full xl:w-auto">
              <div className="flex-1 xl:flex-none relative bg-surface-container-low px-3 py-2 rounded-xl border border-outline-variant/10 flex items-center gap-2 w-full md:w-auto">
                <input 
                  type="text"
                  placeholder="Tìm kiếm: Mã ERP, tên, quy cách..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      // Handled by useMemo
                    }
                  }}
                  className="bg-transparent border-none text-[10px] md:text-xs font-medium focus:ring-0 outline-none w-full xl:w-60"
                />
                <span className="material-symbols-outlined text-sm text-outline-variant shrink-0">search</span>
              </div>
              <div className="flex items-center gap-2 bg-surface-container-low px-3 py-2 rounded-xl border border-outline-variant/10 w-full sm:w-auto">
                <input
                  type="checkbox"
                  id="incomplete-filter"
                  checked={showIncompleteOnly}
                  onChange={(e) => setShowIncompleteOnly(e.target.checked)}
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary shrink-0"
                />
                <label htmlFor="incomplete-filter" className="text-[10px] md:text-xs font-bold text-on-surface cursor-pointer whitespace-nowrap">
                  Thiếu thông tin
                </label>
              </div>
              <div className="flex items-center gap-2 bg-surface-container-low px-3 py-2 rounded-xl border border-outline-variant/10 flex-wrap w-full sm:w-auto">
                <span className="material-symbols-outlined text-[10px] md:text-sm text-on-surface-variant shrink-0">calendar_today</span>
                <span className="text-[10px] md:text-xs font-medium text-on-surface-variant whitespace-nowrap">Từ</span>
                <input 
                  type="date" 
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="bg-transparent border-none text-[10px] md:text-xs font-bold focus:ring-0 cursor-pointer p-0 min-w-[90px]"
                />
                <span className="text-[10px] md:text-xs font-medium text-on-surface-variant ml-2 whitespace-nowrap">Đến</span>
                <input 
                  type="date" 
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="bg-transparent border-none text-[10px] md:text-xs font-bold focus:ring-0 cursor-pointer p-0 min-w-[90px]"
                />
                {(fromDate || toDate) && (
                  <button onClick={() => { setFromDate(''); setToDate(''); }} className="material-symbols-outlined text-[10px] md:text-xs hover:text-error transition-colors ml-2 shrink-0">close</button>
                )}
              </div>
              <div className="flex gap-2 flex-wrap w-full sm:w-auto">
                {selectedRows.length > 0 && (
                  <button 
                    onClick={() => setShowDeleteSelectedConfirm(true)}
                    className="flex-1 sm:flex-none flex justify-center items-center gap-2 bg-error text-on-error px-4 py-2 rounded-xl hover:opacity-90 transition-colors font-bold text-[10px] md:text-xs shadow-lg shadow-error/20"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                    Xóa {selectedRows.length} mục
                  </button>
                )}
                {(fromDate || toDate || searchQuery) && filteredDbItems.length > 0 && selectedRows.length === 0 && (
                   <button 
                     onClick={handleDeleteFilteredListings}
                     className="flex-1 sm:flex-none flex justify-center items-center gap-2 bg-error-container text-on-error-container px-4 py-2 rounded-xl hover:bg-error hover:text-on-error transition-colors font-bold text-[10px] md:text-xs"
                   >
                     <span className="material-symbols-outlined text-sm">delete_sweep</span>
                     Xóa đã lọc
                   </button>
                )}
                <button 
                  onClick={exportToExcel}
                  className="flex-1 sm:flex-none flex justify-center items-center gap-2 bg-surface-container-high px-4 py-2 rounded-xl text-primary hover:bg-primary-container hover:text-on-primary-container transition-colors font-bold text-[10px] md:text-xs"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  Xuất Excel
                </button>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto border border-outline-variant/20 rounded-xl no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[300px]">
              <thead>
                <tr className="bg-surface-container-low">
                  <th className="px-1 md:px-4 py-2 md:py-3 text-[10px] md:text-xs w-6 md:w-10">
                    <input 
                      type="checkbox"
                      className="w-3 h-3 md:w-4 md:h-4 rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                      onChange={(e) => handleSelectAll(e, filteredDbItems)}
                      checked={filteredDbItems.length > 0 && selectedRows.length === filteredDbItems.length}
                    />
                  </th>
                  <th className="px-1 md:px-4 py-2 md:py-3 text-[10px] md:text-xs font-bold text-on-surface-variant uppercase">Mã / Tên</th>
                  <th className="px-1 md:px-4 py-2 md:py-3 text-[10px] md:text-xs font-bold text-on-surface-variant uppercase hidden md:table-cell">Tên Vật Tư (VN)</th>
                  <th className="px-1 md:px-4 py-2 md:py-3 text-[10px] md:text-xs font-bold text-on-surface-variant uppercase hidden md:table-cell">Quy cách</th>
                  <th className="px-1 md:px-4 py-2 md:py-3 text-[10px] md:text-xs font-bold text-on-surface-variant uppercase hidden sm:table-cell">Đơn Vị</th>
                  <th className="px-1 md:px-4 py-2 md:py-3 text-[10px] md:text-xs font-bold text-on-surface-variant uppercase text-right hidden lg:table-cell">Số lượng nhập</th>
                  <th className="px-1 md:px-4 py-2 md:py-3 text-[10px] md:text-xs font-bold text-on-surface-variant uppercase text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="text-[10px] md:text-sm divide-y divide-outline-variant/10">
                {filteredDbItems.map((item, idx) => {
                  return (
                    <tr key={item.id || item.erp || idx} className={`transition-colors group ${selectedRows.includes(item.erp) ? 'bg-primary-container/20' : 'hover:bg-surface-container-low/50'} ${item.is_incomplete ? 'bg-error-container/10' : ''}`} onClick={() => setEditingItem(item)}>
                      <td className="px-1 md:px-4 py-2 md:py-3" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox"
                          className="w-3 h-3 md:w-4 md:h-4 rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                          checked={selectedRows.includes(item.erp)}
                          onChange={() => handleSelectRow(item.erp)}
                        />
                      </td>
                      <td className="px-1 md:px-4 py-2 md:py-3 font-bold text-primary">
                        <div className="text-[10px] md:text-sm">{item.erp || <span className="text-error italic text-[9px]">Thiếu mã</span>}</div>
                        <div className="md:hidden mt-0.5">
                          <div className="font-medium text-on-surface line-clamp-1 text-[9px]">{item.name || <span className="text-error italic text-[9px]">Thiếu Tên</span>}</div>
                          {item.spec && <div className="text-on-surface-variant line-clamp-1 font-normal text-[8px] mt-0.5 -ml-px">{item.spec}</div>}
                        </div>
                      </td>
                      <td className="px-1 md:px-4 py-2 md:py-3 font-medium hidden md:table-cell">
                        {item.name || <span className="text-error italic block text-[10px]">Thiếu Tên</span>}
                        {item.is_incomplete && (
                          <span className="inline-block mt-1 bg-error/10 text-error px-2 py-0.5 rounded text-[8px] md:text-[10px] font-bold uppercase tracking-wider">Cần bổ sung</span>
                        )}
                      </td>
                      <td className="px-1 md:px-4 py-2 md:py-3 text-on-surface-variant hidden md:table-cell">
                        <div className="line-clamp-2 md:max-w-none">{item.spec || '-'}</div>
                      </td>
                      <td className="px-1 md:px-4 py-2 md:py-3 text-on-surface-variant hidden sm:table-cell">
                         {item.unit}
                      </td>
                      <td className="px-1 md:px-4 py-2 md:py-3 text-right text-on-surface-variant font-bold hidden lg:table-cell">
                         {item.start_stock.toLocaleString('en-US')}
                      </td>
                      <td className="px-1 md:px-4 py-2 md:py-3 text-right">
                        <button onClick={(e) => { e.stopPropagation(); setEditingItem(item); }} className="text-on-surface-variant hover:text-primary hover:bg-primary/10 p-1 md:p-1.5 rounded-lg transition-colors" title="Sửa thông tin">
                          <span className="material-symbols-outlined text-[13px] md:text-sm">edit</span>
                        </button>
                      </td>
                    </tr>

                  );
                })}
                {filteredDbItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-on-surface-variant italic">Không có dữ liệu phù hợp.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL CHỈNH SỬA PENDING - moved outside items block, rendered here as placeholder */}
      {false && editingPending && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-scrim/50 backdrop-blur-sm" onClick={() => { setShowPendingModal(false); setEditingPending(null); }}>
          <div className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-lg animate-in zoom-in-95 duration-200 overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 py-5 border-b border-outline-variant/20 flex items-center justify-between bg-amber-500/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                  <span className="material-symbols-outlined text-amber-600">pending_actions</span>
                </div>
                <div>
                  <h3 className="font-bold text-on-surface text-lg">Chỉnh sửa mục chờ xử lý</h3>
                  <p className="text-xs text-on-surface-variant mt-0.5"><span className="px-2 py-0.5 bg-amber-500/15 text-amber-700 rounded-full font-semibold">{getPendingReasonLabel(editingPending.reason)}</span></p>
                </div>
              </div>
              <button onClick={() => { setShowPendingModal(false); setEditingPending(null); }} className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center hover:bg-error-container hover:text-on-error-container transition-colors">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
            {/* Body */}
            <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Mã ERP <span className="text-error">*</span></label>
                  <input value={editingPending.erp || ''} onChange={e => setEditingPending((x: any) => ({...x, erp: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm font-mono border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Nhập mã ERP..." />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Đơn Vị</label>
                  <input value={editingPending.unit || ''} onChange={e => setEditingPending((x: any) => ({...x, unit: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Cái (PCS)..." />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Tên Vật Tư (VN) <span className="text-error">*</span></label>
                  <input value={editingPending.name || ''} onChange={e => setEditingPending((x: any) => ({...x, name: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Nhập tên tiếng Việt..." />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Tên Vật Tư (CN)</label>
                  <input value={editingPending.name_zh || ''} onChange={e => setEditingPending((x: any) => ({...x, name_zh: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Tên tiếng Trung..." />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Quy Cách</label>
                  <input value={editingPending.spec || ''} onChange={e => setEditingPending((x: any) => ({...x, spec: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Kích thước, chất liệu..." />
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Vị Trí</label>
                  <input value={editingPending.pos || ''} onChange={e => setEditingPending((x: any) => ({...x, pos: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Zone-A..." />
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Tồn Đầu Kỳ</label>
                  <input type="number" value={editingPending.start_stock || 0} onChange={e => setEditingPending((x: any) => ({...x, start_stock: parseInt(e.target.value) || 0}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" />
                </div>
              </div>
              {/* Read-only info */}
              {(editingPending.order_id || editingPending.qty) && (
                <div className="flex gap-3 bg-surface-container p-3 rounded-xl text-xs text-on-surface-variant">
                  {editingPending.order_id && <span>Đơn nhập: <strong className="text-on-surface">{editingPending.order_id}</strong></span>}
                  {editingPending.qty > 0 && <span>SL: <strong className="text-on-surface">{editingPending.qty}</strong></span>}
                  {editingPending.date && <span>Ngày: <strong className="text-on-surface">{editingPending.date}</strong></span>}
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="px-6 py-4 border-t border-outline-variant/20 flex gap-3 bg-surface-container-lowest">
              <button onClick={() => { setShowPendingModal(false); setEditingPending(null); }} disabled={pendingModalSaving}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-50">
                Đóng
              </button>
              <button onClick={savePendingOnly} disabled={pendingModalSaving}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-base">save</span>
                {pendingModalSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
              <button onClick={() => approvePendingInbound(editingPending)} disabled={pendingModalSaving}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20">
                <span className="material-symbols-outlined text-base">check_circle</span>
                {pendingModalSaving ? 'Đang xử lý...' : 'Xác nhận & Nhập kho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CẢNH BÁO XÓA ITEM ĐƠN LẺ */}
      {showSingleDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest p-8 rounded-[2rem] shadow-2xl max-w-sm w-full border border-outline-variant/10 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-6">
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
            </div>
            <h3 className="text-xl font-black text-on-surface mb-2">Cảnh báo xóa vật tư</h3>
            <p className="text-on-surface-variant text-sm mb-6 leading-relaxed">
              Bạn có chắc chắn muốn xóa vật tư <strong className="text-error">{showSingleDeleteConfirm}</strong>? Toàn bộ phiếu nhập, xuất và kiểm kê liên quan nên được xử lý trước. Hành động này không thể hoàn tác!
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowSingleDeleteConfirm(null)}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
              >
                Hủy
              </button>
              <button 
                onClick={executeSingleDelete}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-error text-on-error shadow-lg shadow-error/20 hover:opacity-90 transition-opacity"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CẢNH BÁO XÓA SELECTED */}
      {showDeleteSelectedConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest p-8 rounded-[2rem] shadow-2xl max-w-sm w-full border border-outline-variant/10 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-6">
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
            </div>
            <h3 className="text-xl font-black text-on-surface mb-2">Xóa các vật tư đã chọn</h3>
            <p className="text-on-surface-variant text-sm mb-6 leading-relaxed">
              Bạn có chắc chắn muốn XÓA HOÀN TOÀN <strong className="text-error">{selectedRows.length.toLocaleString('en-US')}</strong> vật tư đã tick chọn? Mọi thông tin tồn kho, nhập/xuất liên quan sẽ biến mất. Hành động này không thể hoàn tác!
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowDeleteSelectedConfirm(false)}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
                disabled={loading}
              >
                Hủy
              </button>
              <button 
                onClick={executeDeleteSelected}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-error text-on-error shadow-lg shadow-error/20 hover:opacity-90 transition-opacity"
                disabled={loading}
              >
                {loading ? 'Đang xóa...' : 'Xóa đã chọn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CẢNH BÁO XÓA HÀNG LOẠT */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest p-8 rounded-[2rem] shadow-2xl max-w-sm w-full border border-outline-variant/10 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-6">
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
            </div>
            <h3 className="text-xl font-black text-on-surface mb-2">CẢNH BÁO NGUY HIỂM</h3>
            <p className="text-on-surface-variant text-sm mb-6 leading-relaxed">
              Bạn có chắc chắn muốn XÓA HOÀN TOÀN <strong className="text-error">{filteredDbItems.length}</strong> vật tư đang hiển thị trong bộ lọc này? Mọi thông tin tồn kho, nhập/xuất liên quan sẽ biến mất. Hành động này không thể hoàn tác!
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowBulkDeleteConfirm(false)}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
                disabled={loading}
              >
                Hủy
              </button>
              <button 
                onClick={executeBulkDelete}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-error text-on-error shadow-lg shadow-error/20 hover:opacity-90 transition-opacity"
                disabled={loading}
              >
                {loading ? 'Đang xóa...' : 'Xóa toàn bộ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL SỬA VẬT TƯ */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-8 py-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest sticky top-0 z-10">
              <div>
                <h3 className="text-2xl font-bold font-manrope text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">edit_square</span>
                  Chỉnh sửa vật tư: {editingItem.erp}
                </h3>
                <p className="text-on-surface-variant text-sm mt-1 font-medium">Cập nhật toàn bộ thông tin mã vật tư.</p>
              </div>
              <button 
                onClick={() => setEditingItem(null)}
                className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface hover:bg-error-container hover:text-on-error-container transition-colors"
                type="button"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto space-y-8 bg-surface">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="col-span-2 lg:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Mã ERP</label>
                  <input 
                    className="w-full bg-surface-container border-0 rounded-xl px-4 py-3 outline-none text-on-surface-variant font-medium cursor-not-allowed opacity-70" 
                    type="text" 
                    value={editingItem.erp}
                    disabled
                  />
                  <p className="text-[10px] text-error mt-1">Không thể đổi mã ERP.</p>
                </div>
                <div className="col-span-2 lg:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Tên Vật Tư (VN) <span className="text-error">*</span></label>
                  <input 
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-on-surface font-medium" 
                    type="text" 
                    value={editingItem.name}
                    onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  />
                </div>
                <div className="col-span-2 lg:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Tên Vật Tư (CN)</label>
                  <input 
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-on-surface font-medium" 
                    type="text" 
                    value={editingItem.name_zh || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, name_zh: e.target.value })}
                  />
                </div>
                
                <div className="col-span-2 lg:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Phân loại</label>
                  <input 
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-on-surface font-medium" 
                    type="text" 
                    value={editingItem.category || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                  />
                </div>
                
                <div className="col-span-2 lg:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Đơn Vị Tính</label>
                  <input 
                    list="edit-unit-options"
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-on-surface font-medium" 
                    type="text" 
                    value={editingItem.unit || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, unit: e.target.value })}
                  />
                  <datalist id="edit-unit-options">
                    <option value="Cái (PCS)" />
                    <option value="Bộ (SET)" />
                    <option value="Mét (M)" />
                    <option value="Kg (KG)" />
                    <option value="Cuộn" />
                    <option value="Thùng" />
                    <option value="Hộp" />
                    <option value="Tấm" />
                  </datalist>
                </div>
                
                <div className="col-span-2 lg:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Vị Trí Mặc Định</label>
                  <input 
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-on-surface font-medium" 
                    type="text" 
                    value={editingItem.pos || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, pos: e.target.value })}
                  />
                </div>

                <div className="col-span-2 lg:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Số lượng đầu kỳ</label>
                  <input 
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-on-surface font-bold text-primary" 
                    type="number" 
                    value={editingItem.start_stock || 0}
                    onChange={(e) => setEditingItem({ ...editingItem, start_stock: e.target.value })}
                  />
                  <p className="text-[10px] text-outline-variant mt-1 italic">Thay đổi số đầu kỳ sẽ làm số Tồn Cuối thay đổi theo.</p>
                </div>

                <div className="col-span-2 lg:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Đơn Giá (VND)</label>
                  <input 
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-on-surface font-medium" 
                    type="number" 
                    value={editingItem.price || 0}
                    onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value })}
                  />
                </div>
                
                <div className="col-span-2 lg:col-span-1 pt-6">
                  <label className="flex items-center gap-3 bg-surface-container-low p-4 rounded-xl cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="w-5 h-5 rounded border-outline-variant text-primary focus:ring-primary"
                      checked={editingItem.critical}
                      onChange={(e) => setEditingItem({ ...editingItem, critical: e.target.checked })}
                    />
                    <span className="text-sm font-bold text-on-surface">Vật Tư Quan Trọng</span>
                  </label>
                </div>

                <div className="col-span-2 lg:col-span-3">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Thông Số Kỹ Thuật (Spec) / Quy Cách</label>
                  <textarea 
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:border-primary transition-all outline-none text-on-surface font-medium resize-none" 
                    rows={3}
                    value={editingItem.spec || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, spec: e.target.value })}
                  ></textarea>
                </div>
              </div>
            </div>
            
            <div className="px-8 py-6 border-t border-outline-variant/20 bg-surface-container-lowest flex justify-end gap-3 sticky bottom-0 z-10">
              <button 
                onClick={() => setEditingItem(null)}
                className="px-6 py-3 font-bold text-on-surface-variant hover:bg-surface-container-low rounded-xl transition-colors text-sm"
                type="button"
              >
                Trở lại
              </button>
              <button 
                onClick={handleSaveEdit}
                className="px-8 py-3 bg-primary text-on-primary font-bold rounded-xl shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all text-sm flex items-center gap-2"
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">save</span>
                Lưu Thay Đổi
              </button>
            </div>
          </div>
        </div>
      )}
      </> }

      {/* MODAL CHỈNH SỬA PENDING — outside items block so it renders on pending tab */}
      {showPendingModal && editingPending && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-scrim/50 backdrop-blur-sm" onClick={() => { setShowPendingModal(false); setEditingPending(null); }}>
          <div className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-lg animate-in zoom-in-95 duration-200 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-outline-variant/20 flex items-center justify-between bg-amber-500/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                  <span className="material-symbols-outlined text-amber-600">pending_actions</span>
                </div>
                <div>
                  <h3 className="font-bold text-on-surface text-lg">Chỉnh sửa mục chờ xử lý</h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    <span className="px-2 py-0.5 bg-amber-500/15 text-amber-700 rounded-full font-semibold">
                      {PENDING_REASON[editingPending.reason] || editingPending.reason}
                    </span>
                  </p>
                </div>
              </div>
              <button onClick={() => { setShowPendingModal(false); setEditingPending(null); }} className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center hover:bg-error-container hover:text-on-error-container transition-colors">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Mã ERP <span className="text-error">*</span></label>
                  <input value={editingPending.erp || ''} onChange={e => setEditingPending((x: any) => ({...x, erp: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm font-mono border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Nhập mã ERP..." />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Đơn Vị</label>
                  <input value={editingPending.unit || ''} onChange={e => setEditingPending((x: any) => ({...x, unit: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Cái (PCS)..." />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Tên Vật Tư (VN) <span className="text-error">*</span></label>
                  <input value={editingPending.name || ''} onChange={e => setEditingPending((x: any) => ({...x, name: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Nhập tên tiếng Việt..." />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Tên Vật Tư (CN)</label>
                  <input value={editingPending.name_zh || ''} onChange={e => setEditingPending((x: any) => ({...x, name_zh: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Tên tiếng Trung..." />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Quy Cách</label>
                  <input value={editingPending.spec || ''} onChange={e => setEditingPending((x: any) => ({...x, spec: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Kích thước, chất liệu..." />
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Vị Trí</label>
                  <input value={editingPending.pos || ''} onChange={e => setEditingPending((x: any) => ({...x, pos: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" placeholder="Zone-A..." />
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Tồn Đầu Kỳ</label>
                  <input type="number" value={editingPending.start_stock || 0} onChange={e => setEditingPending((x: any) => ({...x, start_stock: parseInt(e.target.value) || 0}))}
                    className="w-full px-3 py-2.5 bg-surface-container rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition-all" />
                </div>
              </div>
              {(editingPending.order_id || editingPending.qty > 0) && (
                <div className="flex gap-3 bg-surface-container p-3 rounded-xl text-xs text-on-surface-variant">
                  {editingPending.order_id && <span>Đơn nhập: <strong className="text-on-surface">{editingPending.order_id}</strong></span>}
                  {editingPending.qty > 0 && <span>SL: <strong className="text-on-surface">{editingPending.qty}</strong></span>}
                  {editingPending.date && <span>Ngày: <strong className="text-on-surface">{editingPending.date}</strong></span>}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-outline-variant/20 flex gap-3 bg-surface-container-lowest">
              <button onClick={() => { setShowPendingModal(false); setEditingPending(null); }} disabled={pendingModalSaving}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-50">
                Đóng
              </button>
              <button onClick={savePendingOnly} disabled={pendingModalSaving}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-base">save</span>
                {pendingModalSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
              <button onClick={() => approvePendingInbound(editingPending)} disabled={pendingModalSaving}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20">
                <span className="material-symbols-outlined text-base">check_circle</span>
                {pendingModalSaving ? 'Đang xử lý...' : 'Xác nhận & Nhập kho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL XÁC NHẬN XÓA PENDING */}
      {deletePendingConfirm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-scrim/50 backdrop-blur-sm">
          <div className="bg-surface-container-lowest rounded-3xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-6">
              <div className="w-14 h-14 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-5">
                <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>delete</span>
              </div>
              <h3 className="text-lg font-black text-on-surface mb-2">Xóa khỏi danh sách chờ?</h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Bạn có chắc muốn xóa dòng{deletePendingConfirm.erp ? <> mã <strong className="text-error font-mono">{deletePendingConfirm.erp}</strong></> : ' này'} khỏi tab Chờ xử lý? Dữ liệu sẽ bị xóa hoàn toàn.
              </p>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setDeletePendingConfirm(null)} disabled={deletingPending}
                className="flex-1 py-2.5 rounded-xl border border-outline-variant/40 font-bold text-sm hover:bg-surface-container transition-colors disabled:opacity-50">
                Hủy
              </button>
              <button onClick={() => deletePendingItem(deletePendingConfirm)} disabled={deletingPending}
                className="flex-1 py-2.5 rounded-xl bg-error text-on-error font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-base">delete</span>
                {deletingPending ? 'Đang xóa...' : 'Xóa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemManagement;
