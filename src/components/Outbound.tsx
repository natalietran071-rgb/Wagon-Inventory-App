import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { supabase } from '../lib/supabase';
import { exportToExcelMultiSheet } from '../lib/excelUtils';
import { useAuth } from '../contexts/AuthContext';
import ItemHistoryModal from './ItemHistoryModal';

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
  } catch(e) {
    console.log(msg);
  }
};

const safeConfirm = (msg: string) => {
  try {
    return window.confirm(msg);
  } catch(e) {
    console.warn("Window modals blocked, auto-confirming");
    return true;
  }
};

const Outbound = () => {
  const { profile, user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterDateType, setFilterDateType] = useState<'date' | 'created_at'>('date');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterNoBpm, setFilterNoBpm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean, erp: string, name: string }>({ isOpen: false, erp: '', name: '' });
  const [sortField, setSortField] = useState<'date' | 'outbound_id'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [outboundRecords, setOutboundRecords] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'single' | 'bulk'>('single');

  useEffect(() => {
    if (location.state?.scannedErp) {
      setFormData(prev => ({ ...prev, erpCode: location.state.scannedErp }));
      setActiveTab('single');
    }
  }, [location.state?.scannedErp]);
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const [showEditHistory, setShowEditHistory] = useState(false);
  const [errorLog, setErrorLog] = useState<string>('');
  const [editHistory, setEditHistory] = useState<any[]>([]);

  const fetchOutboundRecords = async (): Promise<any[]> => {
    const PAGE = 1000;
    let allData: any[] = [];
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase
        .from('outbound_records')
        .select('*')
        .order('created_at', { ascending: false })
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw error;
      if (data && data.length > 0) {
        allData = allData.concat(data);
        hasMore = data.length === PAGE;
        page++;
      } else {
        hasMore = false;
      }
    }
    return allData;
  };

  const loadOutboundRecords = async () => {
    try {
      const data = await fetchOutboundRecords();
      setOutboundRecords(data);
    } catch (error) {
      console.error('Error fetching outbound records:', error);
    }
  };

  useEffect(() => {
    if (showEditHistory) {
      const fetchEditHistory = async () => {
        try {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          
          const { data, error } = await supabase
            .from('edit_history_outbound')
            .select('*')
            .gte('edited_at', thirtyDaysAgo.toISOString())
            .order('edited_at', { ascending: false });
            
          if (error) throw error;
          if (data) setEditHistory(data);
        } catch (err: any) {
          console.error('Error fetching edit history:', err);
          showToast('Lỗi khi tải lịch sử: ' + err.message, true);
        }
      };
      fetchEditHistory();
    }
  }, [showEditHistory]);
  
  const canEdit = profile?.role === 'admin' || profile?.role === 'editor' || user?.email === 'natalietran071@gmail.com' || !profile;
  
  // Pagination state
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const createEmptyOutboundRow = () => ({
    outboundId: '',
    partner: '',
    recipientName: '',
    recipientId: '',
    deptName: '',
    deptCode: '',
    bpm: '',
    erpCode: '',
    qty: '',
    requiredDate: new Date().toISOString().split('T')[0]
  });

  const [outboundRows, setOutboundRows] = useState(Array.from({ length: 5 }, createEmptyOutboundRow));

  // Form state
  const [formData, setFormData] = useState({
    recipientName: '',
    recipientId: '',
    deptName: '',
    deptCode: '',
    erpCode: '',
    qty: '',
    requiredDate: new Date().toISOString().split('T')[0],
    bpm: '',
    noBpm: false
  });

  // Modal states
  const [viewingRecord, setViewingRecord] = useState<any | null>(null);
  const [editingRecord, setEditingRecord] = useState<any | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const fetchInventory = async (): Promise<any[]> => {
          const PAGE = 1000;
          let allInv: any[] = [];
          let pg = 0;
          let hasMore = true;
          while (hasMore) {
            const { data, error } = await supabase
              .from('inventory')
              .select('erp, name, name_zh, end_stock, spec, out_qty')
              .order('erp', { ascending: true })
              .range(pg * PAGE, (pg + 1) * PAGE - 1);
            if (error) { console.error('Inventory fetch error:', error); break; }
            if (data && data.length > 0) { allInv = allInv.concat(data); hasMore = data.length === PAGE; pg++; }
            else { hasMore = false; }
          }
          return allInv;
        };

        const [inv, outbound] = await Promise.all([fetchInventory(), fetchOutboundRecords()]);
        setInventoryItems(inv);
        setOutboundRecords(outbound);
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const outboundSub = supabase
      .channel('outbound_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outbound_records' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setOutboundRecords(prev => [payload.new, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setOutboundRecords(prev => prev.map(record => record.id === payload.new.id ? payload.new : record));
        } else if (payload.eventType === 'DELETE') {
          setOutboundRecords(prev => prev.filter(record => record.id !== payload.old.id));
        }
      })
      .subscribe();

    const inventorySub = supabase
      .channel('outbound_inventory_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inventory' }, (payload) => {
        if (payload.eventType === 'UPDATE') {
          setInventoryItems(prev => prev.map(item => item.erp === payload.new.erp ? { ...item, end_stock: payload.new.end_stock } : item));
        }
      })
      .subscribe();

    // QR Scan Event Listener
    const handleQRScanned = (e: any) => {
      const scannedCode = e.detail?.code;
      if (!scannedCode) return;

      if (activeTab === 'single') {
        setFormData(prev => ({ ...prev, erpCode: scannedCode }));
        showToast(`Đã nhận mã: ${scannedCode}`);
      } else {
        // Fill first empty ERP row or update state
        setOutboundRows(prev => {
          const newRows = [...prev];
          const emptyIdx = newRows.findIndex(r => !r.erpCode.trim());
          const targetIdx = emptyIdx !== -1 ? emptyIdx : 0;
          newRows[targetIdx] = { ...newRows[targetIdx], erpCode: scannedCode };
          return newRows;
        });
        showToast(`Đã thêm mã vào bảng: ${scannedCode}`);
      }
    };

    window.addEventListener('qr-scanned', handleQRScanned);

    return () => {
      supabase.removeChannel(outboundSub);
      supabase.removeChannel(inventorySub);
      window.removeEventListener('qr-scanned', handleQRScanned);
    };
  }, [activeTab]);

  const handleErpLookup = async (erp: string, rowIndex?: number) => {
    if (!erp || erp.trim().length < 3) return;
    const upperErp = erp.trim().toUpperCase();

    // Check cache
    let cached = inventoryItems.find(i => i.erp === upperErp);
    
    if (!cached) {
      const { data, error } = await supabase
        .from('inventory')
        .select('erp, name, name_zh, end_stock, unit, pos, spec')
        .eq('erp', upperErp)
        .single();
        
      if (data) {
        setInventoryItems(prev => {
          if (prev.some(i => i.erp === data.erp)) return prev;
          return [...prev, data];
        });
        cached = data;
      }
    }

    // Set value in the field (uppercase)
    if (rowIndex !== undefined) {
         const newRows = [...outboundRows];
         newRows[rowIndex].erpCode = upperErp;
         setOutboundRows(newRows);
    } else {
         setFormData(prev => ({ ...prev, erpCode: upperErp }));
    }
    
    if (!cached) {
      showToast(`Mã ERP "${upperErp}" không tồn tại trong hệ thống`, true);
    }
  };

  const handleRowChange = (index: number, field: string, value: string) => {
    const newRows = [...outboundRows];
    newRows[index][field as keyof ReturnType<typeof createEmptyOutboundRow>] = value;
    setOutboundRows(newRows);
  };

  const handlePaste = (e: React.ClipboardEvent, startIdx: number, startField: string) => {
    const rawData = e.clipboardData.getData('Text');
    if (!rawData) return;
    
    const lines = rawData.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length > 1 || lines[0].includes('\t')) {
      e.preventDefault();
      
      const newRows = [...outboundRows];
      const fields = ['outboundId', 'recipientId', 'recipientName', 'deptCode', 'deptName', 'bpm', 'erpCode', 'ignored_name', 'qty', 'requiredDate'];
      const fieldIdx = fields.indexOf(startField);
      
      let currentRowIdx = startIdx;
      
      for (const line of lines) {
        if (currentRowIdx >= newRows.length) {
          newRows.push(createEmptyOutboundRow());
        }
        
        const cols = line.split('\t');
        let currentFieldIdx = fieldIdx;
        
        for (const col of cols) {
          if (currentFieldIdx >= fields.length) break;
          const field = fields[currentFieldIdx];
          
          if (field === 'qty') {
             newRows[currentRowIdx].qty = col.trim().replace(/,/g, '');
          } else if (field !== 'ignored_name') {
             newRows[currentRowIdx][field as keyof ReturnType<typeof createEmptyOutboundRow>] = col.trim();
          }
          
          currentFieldIdx++;
        }
        currentRowIdx++;
      }
      
      setOutboundRows(newRows);
    }
  };

  const exportTemplate = () => {
    import('xlsx').then(XLSX => {
      const templateData = [{
        'Mã Phiếu Xuất (Bỏ trống sẽ tự tạo)': '',
        'Mã Nhân Viên': '',
        'Tên Người Nhận (*)': '',
        'Mã Bộ Phận': '',
        'Tên Bộ Phận': '',
        'Số BPM (hoặc "No BPM")': '',
        'Mã ERP (*)': '',
        'Tên Vật Tư (Không nhập)': '',
        'Số lượng xuất (*)': '',
        'Ngày Yêu Cầu (YYYY-MM-DD)': ''
      }];

      const ws = XLSX.utils.json_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Template");
      XLSX.writeFile(wb, "File_Mau_Xuat_Kho_Hang_Loat.xlsx");
    });
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      if (typeof bstr !== 'string') return;
      import('xlsx').then(XLSX => {
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        
        // Skip header row
        const rows = data.slice(1).filter(row => row.length > 0 && row.some(cell => cell !== undefined && cell !== ''));
        
        const newRows = [];
        let currentRowIdx = 0;
        
        for (const row of rows) {
            newRows.push(createEmptyOutboundRow());
            
            newRows[currentRowIdx].outboundId   = row[0]?.toString() || '';
            newRows[currentRowIdx].recipientId   = row[1]?.toString() || '';
            newRows[currentRowIdx].recipientName = row[2]?.toString() || '';
            newRows[currentRowIdx].deptCode      = row[3]?.toString() || '';
            newRows[currentRowIdx].deptName      = row[4]?.toString() || '';
            newRows[currentRowIdx].bpm           = row[5]?.toString() || '';
            newRows[currentRowIdx].erpCode       = row[6]?.toString() || '';
            newRows[currentRowIdx].qty           = row[8]?.toString() || '';

            // Excel dates might be number serials or strings
            let dateVal = row[9];
            if (typeof dateVal === 'number') {
                const dateParam = new Date((dateVal - (25567 + 2)) * 86400 * 1000);
                dateVal = dateParam.toISOString().split('T')[0];
            } else if (dateVal) {
                dateVal = dateVal.toString();
            } else {
                dateVal = new Date().toISOString().split('T')[0];
            }
            newRows[currentRowIdx].requiredDate = dateVal;
            
            currentRowIdx++;
        }
        
        while (newRows.length < 5) {
            newRows.push(createEmptyOutboundRow());
        }
        
        setOutboundRows(newRows);
      });
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleBatchSubmit = async (e: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!canEdit) return;

    const allRows = outboundRows.filter(row => row.erpCode.trim() || row.qty.trim());
    
    // Separate valid and invalid
    const validRows: typeof allRows = [];
    const errorRows: { row: number; reason: string; data: string }[] = [];

    allRows.forEach((row, idx) => {
      const erpTrim = row.erpCode.trim();
      const qtyNum = Math.round(parseFloat(row.qty));
      if (!erpTrim && !row.qty.trim()) {
        errorRows.push({ row: idx + 1, reason: 'Thiếu ERP và số lượng', data: `Partner: ${row.partner}` });
      } else if (!erpTrim) {
        errorRows.push({ row: idx + 1, reason: 'Thiếu mã ERP', data: `Qty: ${row.qty}, Partner: ${row.partner}` });
      } else if (!row.qty.trim() || isNaN(qtyNum) || qtyNum <= 0) {
        errorRows.push({ row: idx + 1, reason: 'Số lượng = 0 hoặc không hợp lệ', data: `ERP: ${erpTrim}, Qty: ${row.qty}` });
      } else {
        validRows.push(row);
      }
    });
    
    if (validRows.length === 0) {
      const errorMsg = `Không có dòng nào hợp lệ!\n\n${errorRows.map(e => `Dòng ${e.row}: ${e.reason} — ${e.data}`).join('\n')}`;
      setErrorLog(errorMsg); return;
      return;
    }

    const payload = validRows.map(row => {
      const recipientName = (row.recipientName || row.partner || '').trim() || 'Nội bộ';
      const recipientId = (row.recipientId || '').trim();
      const deptName = (row.deptName || '').trim();
      const deptCode = (row.deptCode || '').trim();
      const partnerDisplay = [recipientName, deptName].filter(Boolean).join(' / ');
      const initials = recipientName.split(' ').map((n: string) => n?.[0] || '').join('').toUpperCase().slice(0, 2);
      const outboundId = row.outboundId.trim() || `OUT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const bpmValue = row.bpm?.trim();
      return {
        outbound_id: outboundId,
        erp_code: row.erpCode.trim(),
        partner: partnerDisplay,
        recipient_name: recipientName || null,
        recipient_id: recipientId || null,
        dept_name: deptName || null,
        dept_code: deptCode || null,
        bpm_number: bpmValue === 'No BPM' ? 'No BPM' : (bpmValue || null),
        qty: Math.round(parseFloat(row.qty)),
        initials: initials,
        status: 'Chờ xuất',
        status_color: 'bg-amber-100 text-amber-700',
        dot_color: 'bg-amber-500',
        date: new Date().toISOString().split('T')[0],
        required_date: row.requiredDate || new Date().toISOString().split('T')[0]
      };
    });

    const chunkSize = 500;
    
    setLoading(true);
    let totalInserted = 0;
    const insertErrors: string[] = [];
    
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await supabase.from('outbound_records').insert(chunk);
      
      if (error) {
        console.error('Error saving outbound chunk:', error);
        insertErrors.push(`Chunk ${Math.floor(i/chunkSize)+1}: ${error.message}`);
      } else {
        totalInserted += chunk.length;
      }
    }

    setOutboundRows(Array.from({ length: 5 }, createEmptyOutboundRow));
    await loadOutboundRecords();
    setLoading(false);

    if (errorRows.length > 0 || insertErrors.length > 0) {
      const msg = [
        `Tạo thành công: ${totalInserted}/${allRows.length} lệnh xuất.`,
        errorRows.length > 0 ? `\n⚠️ ${errorRows.length} dòng bị bỏ qua:\n${errorRows.map(e => `Dòng ${e.row}: ${e.reason} — ${e.data}`).join('\n')}` : '',
        insertErrors.length > 0 ? `\n❌ Lỗi DB:\n${insertErrors.join('\n')}` : '',
      ].join('');
      setErrorLog(msg);
    } else {
      showToast(`✅ Tạo thành công ${totalInserted} lệnh xuất kho!`);
    }
    listRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!canEdit) return;

    if (!formData.recipientName.trim() || !formData.erpCode.trim() || !formData.qty) {
      showToast('Vui lòng điền đầy đủ Tên Người Nhận, Mã ERP và Số Lượng.', true);
      return;
    }

    const requestedQty = Math.round(parseFloat(formData.qty));
    const outboundId = `OUT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const partnerDisplay = [formData.recipientName, formData.deptName].filter(Boolean).join(' / ');
    const initials = formData.recipientName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    const { error } = await supabase
      .from('outbound_records')
      .insert([{
        outbound_id: outboundId,
        erp_code: formData.erpCode,
        partner: partnerDisplay,
        recipient_name: formData.recipientName.trim() || null,
        recipient_id: formData.recipientId.trim() || null,
        dept_name: formData.deptName.trim() || null,
        dept_code: formData.deptCode.trim() || null,
        bpm_number: formData.noBpm ? 'No BPM' : (formData.bpm.trim() || null),
        qty: requestedQty,
        initials: initials,
        status: 'Chờ xuất',
        status_color: 'bg-amber-100 text-amber-700',
        dot_color: 'bg-amber-500',
        date: new Date().toISOString().split('T')[0],
        required_date: formData.requiredDate
      }]);

    if (error) {
      console.error('Error saving outbound record:', error);
      showToast('Lỗi khi lưu phiếu xuất: ' + error.message, true);
    } else {
      setFormData({ recipientName: '', recipientId: '', deptName: '', deptCode: '', erpCode: '', qty: '', requiredDate: new Date().toISOString().split('T')[0], bpm: '', noBpm: false });
      await loadOutboundRecords();
      showToast('Tạo lệnh xuất kho thành công!');
      listRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleDeleteOutbound = async (id: string) => {
    if (!canEdit) return;
    if (!safeConfirm('Bạn có chắc chắn muốn xóa lệnh xuất này? Hành động này không thể hoàn tác.')) return;

    // Check if status is "Chờ xuất", otherwise we might need other logic, but let's just delete
    const { error } = await supabase.from('outbound_records').delete().eq('id', id);
    if (error) {
      showToast('Lỗi khi xóa lệnh xuất: ' + error.message, true);
    } else {
      setSelectedRows(prev => prev.filter(rowId => rowId !== id));
      showToast('Xóa thành công!');
    }
  };

  const handleDeleteSelected = async () => {
    if (!canEdit) return;
    if (selectedRows.length === 0) return;
    if (!safeConfirm(`Bạn có chắc chắn muốn xóa ${selectedRows.length} lệnh xuất đã chọn?`)) return;

    showToast(`Đang xóa ${selectedRows.length} lệnh xuất...`);
    try {
      const chunkSize = 100;
      for (let i = 0; i < selectedRows.length; i += chunkSize) {
        const chunk = selectedRows.slice(i, i + chunkSize);
        const { error } = await supabase.from('outbound_records').delete().in('id', chunk);
        if (error) throw error;
      }
      setSelectedRows([]);
      showToast(`✅ Đã xóa ${selectedRows.length} lệnh xuất!`);
      await loadOutboundRecords();
    } catch (error: any) {
      showToast('Lỗi khi xóa: ' + error.message, true);
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedRows(filteredOutbound.map(record => record.id));
    } else {
      setSelectedRows([]);
    }
  };

  const handleSelectRow = (id: any, checked: boolean) => {
    if (checked) {
      setSelectedRows(prev => [...prev, id]);
    } else {
      setSelectedRows(prev => prev.filter(rowId => rowId !== id));
    }
  };

  const handleCancelBatch = () => {
    setOutboundRows(Array.from({ length: 5 }, createEmptyOutboundRow));
  };
  
  const handleConfirmOutbound = async (record: any) => {
    if (!canEdit) return;
    if (record.status === 'Đã Xuất') {
      showToast('Lệnh này đã được xuất rồi!', true);
      return;
    }
    if (!safeConfirm(`Xác nhận xuất kho ${record.qty} ${record.erp_code}?`)) return;

    setLoading(true);
    try {
      const { error } = await supabase.rpc('confirm_outbound_batch', {
        p_record_ids: [record.id]
      });
      if (error) throw error;

      await supabase.from('movements').insert([{
        type: 'OUT', item_name: record.erp_code, qty: record.qty,
        user_name: profile?.email || 'Admin User'
      }]);

      setOutboundRecords(prev => prev.map(item => 
        String(item.id) === String(record.id) 
          ? { ...item, status: 'Đã Xuất', status_color: 'bg-emerald-100 text-emerald-700', dot_color: 'bg-emerald-500' } 
          : item
      ));
      setInventoryItems(prev => prev.map(item => 
        item.erp === record.erp_code 
          ? { ...item, end_stock: (item.end_stock || 0) - record.qty, out_qty: (item.out_qty || 0) + record.qty } 
          : item
      ));
      showToast(`✅ Đã xuất ${record.qty} ${record.erp_code}!`);
    } catch (error: any) {
      showToast('Lỗi xác nhận xuất: ' + error.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateOutbound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord || !canEdit) return;

    if (editingRecord.status === 'Đã Xuất' && (!editingRecord.editReason || !editingRecord.editReason.trim())) {
      showToast('Vui lòng nhập lý do sửa đổi!', true);
      return;
    }

    const requestedQty = Math.round(parseFloat(editingRecord.qty));
    const selectedItem = inventoryItems.find(i => i.erp === editingRecord.erp_code);
    
    if (!selectedItem) {
      showToast('Vui lòng chọn mã vật tư hợp lệ.', true);
      return;
    }
    
    // Nếu trạng thái là Chưa Xuất thì mới giới hạn tồn kho. Nếu đã xuất thì số lượng tồn kho đã bị trừ từ trước, 
    // cần tính khoảng chênh lệch nếu muốn check tồn kho, tạm thời giản lược cảnh báo cho dễ sửa.
    
    const initials = editingRecord.partner.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
    const originalRecord = outboundRecords.find(r => r.id === editingRecord.id);
    const oldQty = originalRecord ? originalRecord.qty : null;

    const { error } = await supabase
      .from('outbound_records')
      .update({
        erp_code: editingRecord.erp_code,
        partner: editingRecord.partner,
        qty: requestedQty,
        initials: initials,
        required_date: editingRecord.required_date
      })
      .eq('id', editingRecord.id);

    if (error) {
      showToast('Lỗi khi cập nhật phiếu xuất: ' + error.message, true);
    } else {
      // Log edit history
      const { error: historyError } = await supabase.from('edit_history_outbound').insert([{
        outbound_id: editingRecord.outbound_id,
        erp_code: editingRecord.erp_code,
        partner: editingRecord.partner,
        old_qty: oldQty,
        new_qty: requestedQty,
        reason: editingRecord.editReason || (editingRecord.status === 'Đã Xuất' ? 'Không có lý do' : 'Sửa phiếu chờ xuất'),
        edited_by: profile?.full_name || profile?.email || user?.email || 'Unknown'
      }]);

      if (historyError) {
        console.error('Error logging edit history:', historyError);
      }

      setOutboundRecords(prev => prev.map(item => String(item.id) === String(editingRecord.id) ? { ...item, ...editingRecord, initials } : item));
      setEditingRecord(null);
      showToast('Cập nhật lệnh xuất kho thành công!');
    }
  };

  const inventoryMap = useMemo(() => {
    const map = new Map();
    inventoryItems.forEach(item => map.set(item.erp, item));
    return map;
  }, [inventoryItems]);

  const filteredOutbound = useMemo(() => {
    let result = [...outboundRecords];
    const today = new Date().toISOString().split('T')[0];

    // Filter by Date range
    if (filterDateFrom || filterDateTo) {
      result = result.filter(item => {
        let itemDate = '';
        if (filterDateType === 'date') {
          itemDate = item.required_date || item.date;
        } else {
          itemDate = new Date(item.created_at).toISOString().split('T')[0];
        }
        const afterFrom = !filterDateFrom || itemDate >= filterDateFrom;
        const beforeTo = !filterDateTo || itemDate <= filterDateTo;
        const isOverduePending = item.status === 'Chờ xuất' && today > (item.required_date || item.date);
        return (afterFrom && beforeTo) || isOverduePending;
      });
    }

    // Filter by Status
    if (filterStatus !== 'all') {
      result = result.filter(item => item.status === filterStatus);
    }

    // Filter No BPM
    if (filterNoBpm) {
      result = result.filter(item => !item.bpm_number || item.bpm_number === 'No BPM');
    }

    // Search Query
    if (searchQuery.trim()) {
      const lowerQ = searchQuery.toLowerCase();
      result = result.filter(item => {
        const invItem = inventoryMap.get(item.erp_code);
        const itemNameMatch = invItem && (
          (invItem.name && invItem.name.toLowerCase().includes(lowerQ)) ||
          (invItem.name_zh && invItem.name_zh.includes(lowerQ)) ||
          (invItem.spec && invItem.spec.toLowerCase().includes(lowerQ))
        );
        return (item.outbound_id && item.outbound_id.toLowerCase().includes(lowerQ)) ||
          (item.partner && item.partner.toLowerCase().includes(lowerQ)) ||
          (item.erp_code && item.erp_code.toLowerCase().includes(lowerQ)) ||
          (item.bpm_number && item.bpm_number.toLowerCase().includes(lowerQ)) ||
          (item.date && item.date.toLowerCase().includes(lowerQ)) ||
          itemNameMatch;
      });
    }

    // Sort
    result.sort((a, b) => {
      let valA = a[sortField] || '';
      let valB = b[sortField] || '';

      if (sortField === 'date') {
        valA = a.required_date || a.date || '';
        valB = b.required_date || b.date || '';
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [outboundRecords, filterDateFrom, filterDateTo, filterDateType, filterStatus, filterNoBpm, sortField, sortOrder, searchQuery]);

  // Pagination logic
  const totalPages = Math.ceil(filteredOutbound.length / itemsPerPage) || 1;
  const paginatedOutbound = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredOutbound.slice(start, start + itemsPerPage);
  }, [filteredOutbound, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterDateFrom, filterDateTo, filterDateType, filterStatus, filterNoBpm]);

  const selectedItemDetails = useMemo(() => {
    return inventoryItems.find(i => i.erp === formData.erpCode) || null;
  }, [inventoryItems, formData.erpCode]);

  const selectedItemStock = selectedItemDetails ? (selectedItemDetails.end_stock || 0) : 0;

  const filteredOutboundStats = useMemo(() => {
    const totalQty = filteredOutbound.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    const uniqueItems = new Set(filteredOutbound.map(item => item.erp_code));
    return { count: filteredOutbound.length, qty: totalQty, uniqueSKU: uniqueItems.size };
  }, [filteredOutbound]);

  const exportOutboundToExcel = async () => {
    setLoading(true);
    showToast('Đang xuất dữ liệu...');
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: dataToExport, error } = await (supabase.rpc('export_outbound', {
        p_search: searchQuery || '',
        p_status: filterStatus.toLowerCase() === 'all' ? 'all' : filterStatus,
        p_from_date: filterDateFrom || null,
        p_to_date: filterDateTo || null
      }) as any).setHeader('Prefer', 'return=representation');

      if (error || !dataToExport) throw error || new Error('No data found');

      const filteredExport = filterNoBpm
        ? (dataToExport || []).filter((item: any) => !item.bpm_number || item.bpm_number === 'No BPM')
        : (dataToExport || []);

      const exportData = filteredExport.map(item => {
        const inv = inventoryMap.get(item.erp_code);
        return {
          'Mã Phiếu': item.outbound_id,
          'Mã NV': item.recipient_id || '',
          'Người Nhận': item.recipient_name || item.partner || '',
          'Mã Bộ Phận': item.dept_code || '',
          'Bộ Phận Nhận': item.dept_name || '',
          'Số BPM': item.bpm_number || '',
          'Mã ERP': item.erp_code,
          'Tên Vật Tư': inv ? `${inv.name || ''}${inv.name_zh ? ` (${inv.name_zh})` : ''}` : (item.item_name || ''),
          'Quy Cách': inv?.spec || '',
          'Số Lượng': item.qty,
          'Ngày Yêu Cầu': item.required_date || item.date,
          'Ngày Tạo': new Date(item.created_at).toLocaleString(),
          'Trạng Thái': item.status,
          'Vị Trí': item.location || '',
          'Người xử lý': item.initials
        };
      });

      const rangeTag = filterDateFrom || filterDateTo
        ? `_${filterDateFrom || '...'}_to_${filterDateTo || '...'}`
        : '';
      const fileName = `xuat-kho${rangeTag || `_${today}`}.xlsx`;
        
      const sheets = exportToExcelMultiSheet(exportData, fileName, 'Xuất Kho');
      showToast(`✅ Đã xuất ${exportData.length.toLocaleString()} dòng — ${sheets} sheet!`);
    } catch (err: any) {
      console.error('Export error:', err);
      showToast('Lỗi: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const selectedPendingCount = useMemo(() => {
    return outboundRecords.filter(r => selectedRows.includes(r.id) && r.status === 'Chờ xuất').length;
  }, [outboundRecords, selectedRows]);

  const handleBulkConfirmOutbound = async () => {
    if (!canEdit || selectedRows.length === 0) return;
    
    const pendingRecords = outboundRecords.filter(r => selectedRows.includes(r.id) && r.status === 'Chờ xuất');
    
    if (pendingRecords.length === 0) {
      showToast('Không có lệnh nào ở trạng thái "Chờ xuất" trong các mục được chọn!', true);
      return;
    }

    if (!safeConfirm(`Bạn có chắc chắn muốn xác nhận xuất kho cho ${pendingRecords.length} lệnh? Hệ thống sẽ tự động trừ tồn kho tương ứng.`)) return;

    setLoading(true);
    
    try {
      // Use atomic RPC to prevent double update - chunk IDs for .in() limit
      const allIds = pendingRecords.map(r => r.id);
      const chunkSize = 200;
      let totalConfirmed = 0;
      
      for (let i = 0; i < allIds.length; i += chunkSize) {
        const chunk = allIds.slice(i, i + chunkSize);
        const { data, error } = await supabase.rpc('confirm_outbound_batch', {
          p_record_ids: chunk
        });
        if (error) throw error;
        totalConfirmed += chunk.length;
      }

      // Record movements in chunks
      const movements = pendingRecords.map(record => ({
        type: 'OUT',
        item_name: record.erp_code,
        qty: record.qty,
        user_name: profile?.full_name || profile?.email || user?.email || 'System'
      }));
      for (let i = 0; i < movements.length; i += 500) {
        const chunk = movements.slice(i, i + 500);
        await supabase.from('movements').insert(chunk);
      }

      showToast(`✅ Đã xác nhận xuất kho ${totalConfirmed} lệnh!`);
    } catch (err: any) {
      console.error('Process error:', err);
      showToast('Có lỗi xảy ra: ' + (err.message || 'Không rõ nguyên nhân'), true);
    } finally {
      await loadOutboundRecords(); 
      setLoading(false);
      setSelectedRows([]);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between items-start gap-4 mb-6 md:mb-8">
        <div>
          <h2 className="text-3xl md:text-4xl font-black text-on-surface tracking-tight mb-1 md:mb-2">{t('outbound')}</h2>
          <p className="text-xs md:text-sm text-on-surface-variant font-medium opacity-70">Tạo phiếu và quản lý luồng hàng hóa xuất kho.</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button 
            onClick={() => setShowEditHistory(true)}
            className="flex-1 md:flex-none justify-center px-4 md:px-5 py-2.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant font-bold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-sm border border-outline-variant/10 text-xs md:text-base"
          >
            <span className="material-symbols-outlined text-lg">history</span>
            <span>Lịch sử</span>
          </button>
          <button 
            onClick={loadOutboundRecords}
            disabled={loading}
            className="flex-1 md:flex-none justify-center px-4 md:px-5 py-2.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant font-bold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-sm border border-outline-variant/10 text-xs md:text-base disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-lg ${loading ? 'animate-spin' : ''}`}>sync</span>
            <span>Đồng bộ</span>
          </button>
          <button 
            onClick={exportOutboundToExcel}
            disabled={loading}
            className="flex-1 md:flex-none justify-center px-4 md:px-5 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary font-bold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-sm border border-primary/20 text-xs md:text-base disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-lg">{loading ? 'sync' : 'file_download'}</span>
            <span>{loading ? 'Đang xuất...' : 'Xuất Excel'}</span>
          </button>
        </div>
      </div>


      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-4">
        <div className="bg-surface-container-low p-2 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-outline-variant/10 text-center">
          <span className="text-[8px] md:text-[10px] font-black text-on-surface-variant uppercase tracking-widest block mb-0.5 opacity-60">MÃ HÀNG</span>
          <div className="text-sm md:text-xl font-black text-primary leading-none tracking-tight">{filteredOutboundStats.uniqueSKU.toLocaleString()} <span className="text-[8px] md:text-[10px] font-medium opacity-50 font-inter">SKU</span></div>
        </div>
        <div className="bg-surface-container-low p-2 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-outline-variant/10 text-center">
          <span className="text-[8px] md:text-[10px] font-black text-on-surface-variant uppercase tracking-widest block mb-0.5 opacity-60">PHIẾU</span>
          <div className="text-sm md:text-xl font-black text-amber-600 leading-none tracking-tight">{filteredOutboundStats.count.toLocaleString()} <span className="text-[8px] md:text-[10px] font-medium opacity-50 font-inter">Lượt</span></div>
        </div>
        <div className="bg-surface-container-low p-2 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-outline-variant/10 text-center">
          <span className="text-[8px] md:text-[10px] font-black text-on-surface-variant uppercase tracking-widest block mb-0.5 opacity-60">TỔNG SL</span>
          <div className="text-sm md:text-xl font-black text-primary leading-none tracking-tight">{filteredOutboundStats.qty.toLocaleString()} <span className="text-[8px] md:text-[10px] font-medium opacity-50 font-inter">Units</span></div>
        </div>
      </div>

      {/* ── Filter bar (below stats) ── */}
      <div className="flex flex-wrap items-center gap-2 bg-surface-container-low p-2 rounded-2xl shadow-sm border border-outline-variant/10 mb-6">
        {/* Search */}
        <div className={`flex items-center transition-all duration-300 ease-in-out ${isSearchExpanded ? 'flex-1 min-w-[160px]' : 'w-10'}`}>
          <button
            onClick={() => setIsSearchExpanded(!isSearchExpanded)}
            className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all ${isSearchExpanded ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'}`}
          >
            <span className="material-symbols-outlined text-[18px]">{isSearchExpanded ? 'close' : 'search'}</span>
          </button>
          {isSearchExpanded && (
            <input
              autoFocus
              type="text"
              placeholder="Tìm mã ERP, người nhận, BPM..."
              className="flex-1 ml-2 h-10 bg-transparent border-none outline-none text-sm font-semibold text-on-surface placeholder:text-on-surface-variant/50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          )}
        </div>

        <div className="w-px h-8 bg-outline-variant/20 hidden sm:block"></div>

        {/* Status filter */}
        <div className="flex items-center gap-1.5 px-2">
          <span className="material-symbols-outlined text-sm text-on-surface-variant">filter_list</span>
          <select
            className="bg-transparent border-none text-xs font-bold focus:ring-0 cursor-pointer text-on-surface-variant appearance-none outline-none pr-3"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="Chờ xuất">Chờ xuất</option>
            <option value="Đã Xuất">Đã Xuất</option>
          </select>
        </div>

        <div className="w-px h-8 bg-outline-variant/20 hidden sm:block"></div>

        {/* Sort */}
        <div className="flex items-center gap-1 px-2">
          <span className="material-symbols-outlined text-sm text-on-surface-variant">swap_vert</span>
          <select
            className="bg-transparent border-none text-xs font-bold focus:ring-0 cursor-pointer text-on-surface-variant appearance-none outline-none pr-3"
            value={sortField}
            onChange={(e) => setSortField(e.target.value as any)}
          >
            <option value="date">Xếp theo Ngày</option>
            <option value="outbound_id">Xếp theo Mã Xuất</option>
          </select>
          <button
            onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
            className="p-1 hover:bg-surface-container-high rounded-lg transition-colors text-on-surface-variant"
          >
            <span className="material-symbols-outlined text-base">{sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>
          </button>
        </div>

        <div className="w-px h-8 bg-outline-variant/20 hidden sm:block"></div>

        {/* Date range */}
        <div className="flex items-center gap-1.5 px-2 flex-wrap">
          <span className="material-symbols-outlined text-sm text-on-surface-variant">calendar_today</span>
          <select
            className="bg-transparent border-none text-xs font-bold focus:ring-0 cursor-pointer text-on-surface-variant appearance-none outline-none pr-2"
            value={filterDateType}
            onChange={(e) => setFilterDateType(e.target.value as any)}
          >
            <option value="date">{t('requiredDate')}</option>
            <option value="created_at">Ngày tạo lệnh</option>
          </select>
          <input
            type="date"
            className="bg-transparent border-none text-xs font-bold focus:ring-0 cursor-pointer text-on-surface-variant outline-none min-w-[100px]"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
          />
          <span className="text-xs text-on-surface-variant font-bold">→</span>
          <input
            type="date"
            className="bg-transparent border-none text-xs font-bold focus:ring-0 cursor-pointer text-on-surface-variant outline-none min-w-[100px]"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
          />
          {(filterDateFrom || filterDateTo) && (
            <button
              onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }}
              className="text-on-surface-variant/50 hover:text-error transition-colors"
              title="Xoá bộ lọc ngày"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          )}
        </div>

        <div className="w-px h-8 bg-outline-variant/20 hidden sm:block"></div>

        {/* No BPM quick filter */}
        <button
          onClick={() => setFilterNoBpm(prev => !prev)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${filterNoBpm ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-surface-container-high text-on-surface-variant border-outline-variant/20 hover:bg-surface-container-highest'}`}
        >
          <span className="material-symbols-outlined text-sm">receipt_long</span>
          No BPM
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <section className="col-span-1 border border-outline-variant/10 rounded-[2rem] overflow-hidden shadow-sm">
          <div className="bg-surface-container-lowest p-6 sm:p-8 relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-primary/5 to-transparent rounded-full -mr-20 -mt-20"></div>
            
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 relative z-10 gap-4">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary">assignment_add</span>
                  Tạo Lệnh Xuất Kho
                </h3>
                {activeTab === 'bulk' && (
                  <div className="flex items-center gap-3 mt-1 text-sm text-on-surface-variant font-medium">
                    <p>Hỗ trợ dán (Ctrl+V) hoặc nạp dữ liệu từ Excel.</p>
                    <button onClick={exportTemplate} className="text-primary hover:underline flex items-center gap-1 font-bold">
                      <span className="material-symbols-outlined text-[14px]">download</span> Tải File Mẫu
                    </button>
                    <span className="text-outline-variant">|</span>
                    <label className="text-secondary hover:underline flex items-center gap-1 font-bold cursor-pointer">
                      <span className="material-symbols-outlined text-[14px]">upload_file</span> Nạp File Excel
                      <input 
                        type="file" 
                        accept=".xlsx, .xls" 
                        ref={fileInputRef} 
                        onChange={handleFileUpload} 
                        className="hidden" 
                      />
                    </label>
                  </div>
                )}
              </div>
              <div className="flex bg-surface-container-low p-1 rounded-xl">
                <button 
                  onClick={() => setActiveTab('single')}
                  className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'single' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
                >
                  Đơn lẻ
                </button>
                <button 
                  onClick={() => setActiveTab('bulk')}
                  className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'bulk' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
                >
                  Hàng loạt
                </button>
              </div>
            </div>

            {activeTab === 'single' ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-5">
                  {/* Người Nhận */}
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Người Nhận</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm"
                        placeholder="Mã nhân viên"
                        type="text"
                        value={formData.recipientId}
                        onChange={(e) => setFormData({ ...formData, recipientId: e.target.value })}
                      />
                      <input
                        className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm"
                        placeholder="Tên nhân viên *"
                        type="text"
                        value={formData.recipientName}
                        onChange={(e) => setFormData({ ...formData, recipientName: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  {/* Bộ Phận Nhận */}
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Bộ Phận Nhận</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm"
                        placeholder="Mã bộ phận"
                        type="text"
                        value={formData.deptCode}
                        onChange={(e) => setFormData({ ...formData, deptCode: e.target.value })}
                      />
                      <input
                        className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm"
                        placeholder="Tên bộ phận"
                        type="text"
                        value={formData.deptName}
                        onChange={(e) => setFormData({ ...formData, deptName: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Số BPM</label>
                      <input
                        className={`w-full border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm ${formData.noBpm ? 'bg-surface-container-low/40 text-on-surface-variant/50 cursor-not-allowed' : 'bg-surface-container-low'}`}
                        placeholder={formData.noBpm ? 'No BPM' : 'Nhập số BPM...'}
                        type="text"
                        value={formData.noBpm ? '' : formData.bpm}
                        onChange={(e) => setFormData({ ...formData, bpm: e.target.value })}
                        disabled={formData.noBpm}
                      />
                      <label className="flex items-center gap-2 mt-1.5 cursor-pointer w-fit">
                        <input
                          type="checkbox"
                          checked={formData.noBpm}
                          onChange={(e) => setFormData({ ...formData, noBpm: e.target.checked, bpm: '' })}
                          className="w-3.5 h-3.5 accent-primary"
                        />
                        <span className="text-[11px] font-bold text-on-surface-variant">No BPM</span>
                      </label>
                  </div>
                  <div>
                    <div className="flex justify-between items-center px-1">
                      <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">{t('erpCode')}</label>
                      <Link to="/new-item" className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">add_circle</span>
                        Tạo mới vật tư
                      </Link>
                    </div>
                    <div className="relative">
                      <input 
                        list="erp-options"
                        className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" 
                        placeholder="Nhập hoặc chọn mã vật tư..."
                        value={formData.erpCode}
                        onChange={(e) => setFormData({ ...formData, erpCode: e.target.value })}
                        onBlur={(e) => handleErpLookup(e.target.value)}
                        required
                      />
                      <datalist id="erp-options">
                        {inventoryItems.map((item, idx) => (
                          <option key={item.erp || `outbound-erp-${idx}`} value={item.erp || ''}>
                            {item.name} {item.name_zh ? `(${item.name_zh})` : ''}
                          </option>
                        ))}
                      </datalist>
                    </div>
                    {selectedItemDetails && (
                      <div className="mt-3 p-3 bg-primary-container/10 rounded-xl border border-primary-container/30">
                        <div className="text-sm font-bold text-on-surface">{selectedItemDetails.name}</div>
                        {selectedItemDetails.name_zh && <div className="text-xs font-medium text-primary/70 mb-1">{selectedItemDetails.name_zh}</div>}
                        <div className="text-xs text-on-surface-variant flex items-center gap-1 mt-1">
                          <span className="material-symbols-outlined text-[14px]">straighten</span>
                          Quy cách: {selectedItemDetails.spec || 'Không có'}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Số lượng yêu cầu</label>
                      <input 
                        className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" 
                        type="number" 
                        value={formData.qty}
                        onChange={(e) => setFormData({ ...formData, qty: e.target.value })}
                        required
                        max={selectedItemStock}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Tồn kho hiện tại</label>
                      <div className="w-full bg-surface-container-low/50 border border-outline-variant/15 rounded-xl py-3 px-4 text-sm font-semibold text-primary flex items-center justify-between">
                        <span>{selectedItemStock.toLocaleString('en-US')}</span>
                        <span className="text-[10px] px-2 py-0.5 bg-primary-container/20 rounded-full">Khả dụng</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Ngày cần xuất</label>
                      <input 
                        className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" 
                        type="date" 
                        value={formData.requiredDate}
                        onChange={(e) => setFormData({ ...formData, requiredDate: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="pt-4">
                    <button 
                      className="w-full py-4 bg-primary text-on-primary font-bold rounded-xl shadow-md hover:bg-primary-dim transition-colors flex justify-center items-center gap-2 disabled:opacity-50" 
                      type="button"
                      onClick={handleSubmit}
                      disabled={!canEdit}
                    >
                      <span className="material-symbols-outlined">send</span>
                      Xác Nhận Tạo Phiếu Xuất
                    </button>
                  </div>
                </div>
                <div>
                  <div className="bg-surface-container-low p-6 rounded-xl overflow-hidden relative group h-full flex flex-col justify-center">
                    <div className="relative z-10">
                      <p className="text-xs font-bold text-on-surface-variant uppercase mb-1">
                        Tổng xuất kho {filterDateFrom || filterDateTo ? `(${filterDateFrom || '...'} → ${filterDateTo || '...'})` : '(Tất cả)'}
                      </p>
                      <h4 className="text-3xl font-black text-on-surface">{filteredOutboundStats.qty.toLocaleString('en-US')} <span className="text-sm font-medium">Units</span></h4>
                      <div className="mt-4 flex items-center gap-2 text-sm font-medium text-primary bg-primary/10 w-fit px-3 py-1.5 rounded-lg">
                        <span className="material-symbols-outlined text-sm">receipt_long</span>
                        <span>Từ <span className="font-bold">{filteredOutboundStats.count.toLocaleString('en-US')}</span> phiếu xuất</span>
                      </div>
                      <div className="mt-8 p-4 bg-secondary-container/30 rounded-xl">
                        <div className="flex items-start gap-3">
                          <span className="material-symbols-outlined text-secondary text-xl">info</span>
                          <p className="text-xs text-on-secondary-container leading-relaxed font-medium">
                            <strong>Lưu ý:</strong> Hệ thống thiết lập trạng thái mặc định là "Chờ xuất". Bạn cần xác nhận ở bảng danh sách để trừ số lượng trong kho.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform duration-500 pointer-events-none">
                      <span className="material-symbols-outlined text-[150px]">analytics</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 relative z-10 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="overflow-x-auto border border-outline-variant/20 rounded-xl max-h-[500px] overflow-y-auto no-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead className="sticky top-0 bg-surface-container-highest z-20 shadow-sm border-b border-outline-variant/20">
                      <tr>
                        <th className="px-2 py-3 text-xs font-bold text-on-surface-variant uppercase text-center w-10">#</th>
                        <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[120px]">Mã Phiếu Xuất</th>
                        <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[100px]">Mã NV</th>
                        <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[130px]">Tên Người Nhận (*)</th>
                        <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[100px]">Mã Bộ Phận</th>
                        <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[130px]">Tên Bộ Phận</th>
                        <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[110px]">Số BPM</th>
                        <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[180px]">Mã ERP (*)</th>
                        <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[150px]">Tên SP</th>
                        <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[100px]">Số lượng (*)</th>
                        <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[150px]">Ngày cần xuất</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10 text-sm bg-surface-container-lowest">
                      {outboundRows.map((row, idx) => {
                        const item = inventoryItems.find(i => i.erp === row.erpCode);
                        return (
                          <tr key={idx} className="hover:bg-surface-container-low focus-within:bg-secondary-container/20 transition-colors group">
                            <td className="px-2 py-2 text-center text-on-surface-variant/50 text-[10px] font-bold select-none">{idx + 1}</td>
                            <td className="p-0 border-r border-outline-variant/5">
                              <input 
                                type="text" 
                                value={row.outboundId}
                                onChange={(e) => handleRowChange(idx, 'outboundId', e.target.value)}
                                onPaste={(e) => handlePaste(e, idx, 'outboundId')}
                                className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-medium"
                                placeholder="..."
                              />
                            </td>
                            <td className="p-0 border-r border-outline-variant/5">
                              <input
                                type="text"
                                value={row.recipientId || ''}
                                onChange={(e) => handleRowChange(idx, 'recipientId', e.target.value)}
                                onPaste={(e) => handlePaste(e, idx, 'recipientId')}
                                className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-medium"
                                placeholder="Mã NV"
                              />
                            </td>
                            <td className="p-0 border-r border-outline-variant/5">
                              <input
                                type="text"
                                value={row.recipientName || ''}
                                onChange={(e) => handleRowChange(idx, 'recipientName', e.target.value)}
                                onPaste={(e) => handlePaste(e, idx, 'recipientName')}
                                className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-medium"
                                placeholder="Tên người nhận..."
                              />
                            </td>
                            <td className="p-0 border-r border-outline-variant/5">
                              <input
                                type="text"
                                value={row.deptCode || ''}
                                onChange={(e) => handleRowChange(idx, 'deptCode', e.target.value)}
                                onPaste={(e) => handlePaste(e, idx, 'deptCode')}
                                className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-medium"
                                placeholder="Mã BP"
                              />
                            </td>
                            <td className="p-0 border-r border-outline-variant/5">
                              <input
                                type="text"
                                value={row.deptName || ''}
                                onChange={(e) => handleRowChange(idx, 'deptName', e.target.value)}
                                onPaste={(e) => handlePaste(e, idx, 'deptName')}
                                className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-medium"
                                placeholder="Tên bộ phận..."
                              />
                            </td>
                            <td className="p-0 border-r border-outline-variant/5">
                              <input
                                type="text"
                                value={row.bpm || ''}
                                onChange={(e) => handleRowChange(idx, 'bpm', e.target.value)}
                                onPaste={(e) => handlePaste(e, idx, 'bpm')}
                                className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-medium"
                                placeholder="BPM / No BPM"
                              />
                            </td>
                            <td className="p-0 border-r border-outline-variant/5 relative">
                              <input
                                list="outbound-erp-options"
                                type="text" 
                                value={row.erpCode}
                                onChange={(e) => handleRowChange(idx, 'erpCode', e.target.value)}
                                onBlur={(e) => handleErpLookup(e.target.value, idx)}
                                onPaste={(e) => handlePaste(e, idx, 'erpCode')}
                                className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-bold text-primary"
                                placeholder="Nhập/Chọn ERP"
                              />
                            </td>
                            <td className="p-0 border-r border-outline-variant/5 bg-on-surface/5">
                              <div className="w-full px-4 py-2 text-[10px] font-medium text-on-surface-variant select-none h-full min-h-[60px]" title={item?.name || ''}>
                                {item ? (
                                  <div className="space-y-0.5">
                                    <div className="font-bold text-on-surface line-clamp-1">{item.name}</div>
                                    {item.name_zh && <div className="text-[9px] opacity-60 line-clamp-1">{item.name_zh}</div>}
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-[9px] bg-secondary/10 text-secondary px-1 py-0.5 rounded">QC: {item.spec || '-'}</span>
                                      <span className="text-[9px] font-bold text-primary">Tồn: {item.end_stock.toLocaleString('en-US')}</span>
                                    </div>
                                  </div>
                                ) : <span className="text-outline-variant/50 italic">-</span>}
                              </div>
                            </td>
                            <td className="p-0 border-r border-outline-variant/5">
                              <input 
                                type="number" 
                                value={row.qty}
                                onChange={(e) => handleRowChange(idx, 'qty', e.target.value)}
                                onPaste={(e) => handlePaste(e, idx, 'qty')}
                                className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-bold"
                                placeholder="0"
                                min="0.01" step="0.01"
                              />
                            </td>
                            <td className="p-0">
                              <input 
                                type="date" 
                                value={row.requiredDate}
                                onChange={(e) => handleRowChange(idx, 'requiredDate', e.target.value)}
                                onPaste={(e) => handlePaste(e, idx, 'requiredDate')}
                                className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-medium text-on-surface-variant"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-between items-center bg-surface-container-low p-4 rounded-xl border border-outline-variant/20 mt-4">
                  <div className="text-sm font-medium text-on-surface-variant flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">info</span>
                    Sẽ lưu <strong className="text-primary">{outboundRows.filter(r => r.erpCode.trim() !== '' && Math.round(parseFloat(r.qty)) > 0).length}</strong> phiếu xuất hợp lệ.
                  </div>
                  <div className="flex gap-2">
                    <button 
                      type="button" 
                      onClick={handleCancelBatch}
                      className="bg-surface-container-highest text-on-surface px-6 py-2.5 rounded-xl font-bold hover:bg-surface-container-high transition-colors"
                    >
                      Hủy
                    </button>
                    <button 
                      type="button" 
                      onClick={handleBatchSubmit}
                      disabled={!canEdit || outboundRows.filter(r => r.erpCode.trim() !== '' && Math.round(parseFloat(r.qty)) > 0).length === 0}
                      className="bg-primary text-on-primary px-8 py-2.5 rounded-xl font-bold shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none disabled:hover:shadow-md"
                    >
                      Tạo Các Phiếu Này
                    </button>
                  </div>
                </div>
                <datalist id="outbound-erp-options">
                  {inventoryItems.map((item, idx) => (
                    <option key={item.erp || `bulk-erp-${idx}`} value={item.erp || ''}>
                      {item.name} {item.name_zh ? `(${item.name_zh})` : ''} - Tồn: {item.end_stock.toLocaleString('en-US')}
                    </option>
                  ))}
                </datalist>
              </div>
            )}
          </div>
        </section>

        <section ref={listRef} className="col-span-1 border border-outline-variant/10 rounded-[2rem] overflow-hidden shadow-sm">
          <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 md:px-8 py-4 md:py-6 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
              <h3 className="text-base md:text-lg font-bold">Danh sách lệnh xuất kho</h3>
              <div className="flex gap-2 items-center">
                <button 
                  onClick={() => loadOutboundRecords()}
                  className="p-2 hover:bg-surface-container-high rounded-full transition-colors text-on-surface-variant"
                  title="Tải lại dữ liệu"
                >
                  <span className="material-symbols-outlined text-lg">refresh</span>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="px-4 py-3 bg-surface-container-low flex items-center justify-between border-b border-outline-variant/10">
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox"
                    className="rounded border-outline-variant/30 text-primary w-4 h-4 focus:ring-primary/20"
                    checked={filteredOutbound.length > 0 && filteredOutbound.every(r => selectedRows.includes(r.id))}
                    onChange={handleSelectAll}
                  />
                  <span className="text-xs font-bold text-on-surface-variant">Chọn tất cả</span>
                </div>
                {selectedRows.length > 0 && (
                  <div className="flex gap-2">
                    <button 
                      onClick={handleBulkConfirmOutbound}
                      disabled={loading || selectedPendingCount === 0}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${selectedPendingCount > 0 ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-emerald-600/50 text-white/70 cursor-not-allowed'}`}
                    >
                      <span className="material-symbols-outlined text-[14px]">check_circle</span>
                      Đã Xuất ({selectedPendingCount})
                    </button>
                    <button 
                      onClick={handleDeleteSelected}
                      className="flex items-center gap-2 px-3 py-1.5 bg-error text-on-error rounded-lg text-xs font-bold hover:bg-error-container hover:text-on-error-container transition-colors shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                      Xóa ({selectedRows.length})
                    </button>
                  </div>
                )}
              </div>
              <table className="w-full text-left min-w-[800px]">
                <thead>
                  <tr className="text-[9px] md:text-[10px] font-black text-on-surface-variant uppercase tracking-widest border-none">
                    <th className="pb-3 md:pb-6 px-1 md:px-4 w-10 text-center"></th>
                    <th className="pb-3 md:pb-6 px-1 md:px-4 w-[110px] md:w-[150px]">Lệnh / ERP</th>
                    <th className="pb-3 md:pb-6 px-1 md:px-4 hidden sm:table-cell">Người Nhận / Bộ Phận</th>
                    <th className="pb-3 md:pb-6 px-1 md:px-4 hidden lg:table-cell">Số BPM</th>
                    <th className="pb-3 md:pb-6 px-1 md:px-4 hidden md:table-cell">{t('requiredDate')}</th>
                    <th className="pb-3 md:pb-6 px-1 md:px-4 text-center">SL</th>
                    <th className="pb-3 md:pb-6 px-1 md:px-4">Trạng Thái</th>
                    <th className="pb-3 md:pb-6 px-1 md:px-4 text-right">{t('action')}</th>
                  </tr>
                </thead>
                <tbody className="text-xs md:text-sm">
                  {paginatedOutbound.map((order, idx) => (
                    <tr key={order.id || idx} className={`hover:bg-surface-container-low transition-colors group border-t border-outline-variant/10 ${selectedRows.includes(order.id) ? 'bg-primary/5' : ''}`}>
                      <td className="px-1 py-3 md:px-4 md:py-6 align-middle text-center w-10">
                        <input 
                          type="checkbox"
                          className="rounded border-outline-variant/30 text-primary w-4 h-4 focus:ring-primary/20"
                          checked={selectedRows.includes(order.id)}
                          onChange={(e) => handleSelectRow(order.id, e.target.checked)}
                        />
                      </td>
                      <td className="px-1 py-3 md:px-4 md:py-6 align-middle">
                        <p className="font-bold text-on-surface text-[11px] md:text-sm">{order.outbound_id}</p>
                        {(() => {
                          const item = inventoryMap.get(order.erp_code);
                          return (
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHistoryModal({ isOpen: true, erp: order.erp_code, name: item?.name || '' });
                                }}
                                className="text-[9px] md:text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-md font-bold hover:bg-primary hover:text-white transition-colors cursor-pointer shrink-0"
                              >
                                ERP: {order.erp_code}
                              </button>
                              {item && <>
                                <span className="text-[9px] md:text-[10px] text-on-surface-variant italic truncate max-w-[120px] md:max-w-[180px]" title={item.name}>{item.name}{item.name_zh ? ` (${item.name_zh})` : ''}</span>
                                {item.spec && <span className="bg-secondary/10 text-secondary px-1 py-0.5 rounded text-[8px] font-medium shrink-0">{item.spec}</span>}
                              </>}
                            </div>
                          );
                        })()}
                        <div className="sm:hidden mt-2">
                           <p className="font-medium text-on-surface text-[10px] leading-tight break-words">{order.partner}</p>
                           <p className="text-[9px] text-on-surface-variant mt-0.5">{order.date}</p>
                        </div>
                      </td>
                      <td className="px-1 py-3 md:px-4 md:py-6 align-middle hidden sm:table-cell">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 md:w-8 md:h-8 rounded-lg bg-primary-container/20 flex items-center justify-center text-primary font-bold text-[10px] md:text-xs shrink-0">
                            {order.initials}
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              {order.recipient_name
                                ? <>
                                    <span className="font-medium text-on-surface text-xs md:text-sm">{order.recipient_name}</span>
                                    {order.recipient_id && <span className="text-[9px] bg-surface-container-high px-1.5 py-0.5 rounded font-mono">{order.recipient_id}</span>}
                                  </>
                                : <span className="font-medium text-on-surface text-xs md:text-sm">{order.partner}</span>
                              }
                            </div>
                            {(order.dept_name || order.dept_code) && (
                              <div className="flex items-center gap-1 mt-0.5">
                                {order.dept_code && <span className="text-[9px] bg-secondary/10 text-secondary px-1.5 py-0.5 rounded font-mono">{order.dept_code}</span>}
                                {order.dept_name && <span className="text-[9px] text-on-surface-variant">{order.dept_name}</span>}
                              </div>
                            )}
                            <p className="text-[9px] md:text-[10px] text-on-surface-variant mt-0.5">{new Date(order.created_at).toLocaleString()}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-1 py-3 md:px-4 md:py-6 align-middle hidden lg:table-cell">
                        {order.bpm_number ? (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${order.bpm_number === 'No BPM' ? 'bg-surface-container-high text-on-surface-variant/60 italic' : 'bg-primary/10 text-primary'}`}>
                            {order.bpm_number}
                          </span>
                        ) : <span className="text-on-surface-variant/30 text-xs">—</span>}
                      </td>
                      <td className="px-1 py-3 md:px-4 md:py-6 align-middle hidden md:table-cell">
                        <p className="font-medium text-on-surface text-xs">{order.date}</p>
                        <p className="text-[10px] text-on-surface-variant mt-0.5"><span className="font-bold text-secondary">Cần xuất:</span> {order.required_date || '-'}</p>
                      </td>
                      <td className="px-1 py-3 md:px-4 md:py-6 align-middle text-center font-bold text-on-surface text-xs md:text-sm">{Number(order.qty).toLocaleString('en-US')}</td>
                      <td className="px-1 py-3 md:px-4 md:py-6 align-middle">
                        <span className={`px-2 py-0.5 md:px-3 md:py-1 ${order.status_color} rounded-full text-[9px] md:text-[10px] font-bold flex items-center gap-1 w-fit`}>
                          <span className={`w-1.5 h-1.5 ${order.dot_color} rounded-full hidden md:inline-block`}></span>
                          {order.status}
                        </span>
                        {order.status === 'Chờ xuất' && new Date().toISOString().split('T')[0] > (order.required_date || order.date) && (
                          <span className="text-[9px] font-bold text-error bg-error/10 px-2 py-0.5 rounded-full mt-1 inline-block">Quá hạn</span>
                        )}
                      </td>
                      <td className="px-1 py-3 md:px-4 md:py-6 align-middle text-right">
                        <div className="flex justify-end gap-1 md:gap-2">
                          <button 
                            onClick={() => {
                              const item = inventoryMap.get(order.erp_code);
                              setHistoryModal({ isOpen: true, erp: order.erp_code, name: item?.name || '' });
                            }}
                            className="p-1 md:p-2 text-on-surface-variant hover:text-primary transition-colors bg-surface-container-high rounded-lg hover:bg-primary-container hover:text-on-primary-container"
                            title="Lịch sử"
                          >
                            <span className="material-symbols-outlined text-[16px] md:text-xl">history</span>
                          </button>
                          <button 
                            onClick={() => setViewingRecord(order)}
                            className="p-1 md:p-2 text-on-surface-variant hover:text-primary transition-colors bg-surface-container-high rounded-lg hover:bg-primary-container hover:text-on-primary-container"
                            title="Xem chi tiết"
                          >
                            <span className="material-symbols-outlined text-[16px] md:text-xl">visibility</span>
                          </button>
                          {canEdit && (
                            <>
                              <button 
                                onClick={() => setEditingRecord({ ...order, editReason: '' })}
                                className="p-1 md:p-2 text-on-surface-variant hover:text-secondary transition-colors bg-surface-container-high rounded-lg hover:bg-secondary-container hover:text-on-secondary-container"
                                title="Sửa thông tin"
                              >
                                <span className="material-symbols-outlined text-[16px] md:text-xl">edit</span>
                              </button>
                              <button 
                                onClick={() => handleDeleteOutbound(order.id)}
                                className="p-1 md:p-2 text-on-surface-variant hover:text-error transition-colors bg-surface-container-high rounded-lg hover:bg-error-container hover:text-on-error-container"
                                title="Xóa lệnh xuất"
                              >
                                <span className="material-symbols-outlined text-[16px] md:text-xl">delete</span>
                              </button>
                              {order.status === 'Chờ xuất' && (
                                <button 
                                  onClick={() => handleConfirmOutbound(order)}
                                  className="p-1 md:p-2 text-on-surface-variant hover:text-emerald-600 transition-colors bg-surface-container-high rounded-lg hover:bg-emerald-100"
                                  title="Xác nhận xuất kho"
                                >
                                  <span className="material-symbols-outlined text-[16px] md:text-xl">check_circle</span>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginatedOutbound.length === 0 && (
                    <tr key="empty-outbound">
                      <td colSpan={7} className="py-12 text-center text-on-surface-variant font-medium italic">
                        Không có dữ liệu xuất kho.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 md:px-8 py-4 md:py-6 bg-surface-container-low/30 border-t border-outline-variant/10 flex justify-between items-center text-[10px] md:text-xs font-medium text-on-surface-variant">
              <span>Hiển thị {paginatedOutbound.length} / {filteredOutbound.length}</span>
              <div className="flex items-center gap-2 md:gap-4">
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 md:p-2 hover:bg-surface-container-low rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-[16px] md:text-sm">chevron_left</span>
                </button>
                <span className="text-on-surface font-bold tracking-widest">{currentPage} / {totalPages}</span>
                <button 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 md:p-2 hover:bg-surface-container-low rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-[16px] md:text-sm">chevron_right</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* View Modal */}
      {viewingRecord && (() => {
        const viewItemDetails = inventoryItems.find(i => i.erp === viewingRecord.erp_code);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 flex justify-between items-center">
              <h3 className="text-lg font-bold text-on-surface">Chi tiết phiếu xuất</h3>
              <button onClick={() => setViewingRecord(null)} className="p-2 text-on-surface-variant hover:text-error transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-on-surface-variant uppercase mb-1">Mã Phiếu</p>
                  <p className="text-sm font-medium text-on-surface">{viewingRecord.outbound_id}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-on-surface-variant uppercase mb-1">Trạng Thái</p>
                  <span className={`px-3 py-1 ${viewingRecord.status_color} rounded-full text-[10px] font-bold flex items-center gap-1 w-fit`}>
                    <span className={`w-1.5 h-1.5 ${viewingRecord.dot_color} rounded-full`}></span>
                    {viewingRecord.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-bold text-on-surface-variant uppercase mb-1">Người Nhận</p>
                  <p className="text-sm font-medium text-on-surface">{viewingRecord.partner}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-on-surface-variant uppercase mb-1">Ngày Yêu Cầu</p>
                  <p className="text-sm font-medium text-on-surface">{viewingRecord.required_date || viewingRecord.date}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs font-bold text-on-surface-variant uppercase mb-1">Mã Vật Tư (ERP)</p>
                  <p className="text-sm font-medium text-on-surface">{viewingRecord.erp_code}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs font-bold text-on-surface-variant uppercase mb-1">Tên Vật Tư</p>
                  <p className="text-sm font-medium text-on-surface">{viewItemDetails?.name || viewingRecord.erp_code || 'Không rõ'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-on-surface-variant uppercase mb-1">Quy Cách</p>
                  <p className="text-sm font-medium text-on-surface">{viewItemDetails?.spec || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-on-surface-variant uppercase mb-1">Số Lượng</p>
                  <p className="text-sm font-bold text-primary">{Number(viewingRecord.qty).toLocaleString('en-US')}</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-surface-container-low/30 flex justify-end">
              <button 
                onClick={() => setViewingRecord(null)}
                className="px-6 py-2 bg-surface-container-high text-on-surface font-bold rounded-xl hover:bg-surface-container-highest transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Edit Modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 flex justify-between items-center">
              <h3 className="text-lg font-bold text-on-surface">Sửa thông tin phiếu xuất</h3>
              <button onClick={() => setEditingRecord(null)} className="p-2 text-on-surface-variant hover:text-error transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleUpdateOutbound} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Người Nhận</label>
                <input 
                  className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" 
                  type="text" 
                  value={editingRecord.partner}
                  onChange={(e) => setEditingRecord({ ...editingRecord, partner: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Mã ERP</label>
                <input 
                  list="edit-erp-options"
                  className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" 
                  value={editingRecord.erp_code}
                  onChange={(e) => setEditingRecord({ ...editingRecord, erp_code: e.target.value })}
                  required
                />
                <datalist id="edit-erp-options">
                  {inventoryItems.map((item, idx) => (
                    <option key={item.erp || `edit-erp-${idx}`} value={item.erp || ''}>
                      {item.name} {item.name_zh ? `(${item.name_zh})` : ''}
                    </option>
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Số lượng</label>
                  <input 
                    className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" 
                    type="number" 
                    value={editingRecord.qty}
                    onChange={(e) => setEditingRecord({ ...editingRecord, qty: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Ngày cần xuất</label>
                  <input 
                    className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" 
                    type="date" 
                    value={editingRecord.required_date || editingRecord.date}
                    onChange={(e) => setEditingRecord({ ...editingRecord, required_date: e.target.value })}
                    required
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Lý do sửa đổi <span className="text-error">*</span></label>
                <textarea 
                  className="w-full bg-surface-container-low border border-outline-variant/15 rounded-xl py-3 px-4 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm outline-none" 
                  placeholder="Nhập lý do thay đổi..." 
                  rows={2}
                  value={editingRecord.editReason || ''}
                  onChange={(e) => setEditingRecord({ ...editingRecord, editReason: e.target.value })}
                  required={editingRecord.status === 'Đã Xuất'}
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="px-6 py-2 bg-surface-container-high text-on-surface font-bold rounded-xl hover:bg-surface-container-highest transition-colors"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="px-6 py-2 bg-primary text-on-primary font-bold rounded-xl shadow-md hover:bg-primary-dim transition-colors"
                >
                  Lưu Thay Đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit History Modal */}
      {showEditHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-6 py-4 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                   <span className="material-symbols-outlined">history</span>
                 </div>
                 <h3 className="text-xl font-bold font-manrope text-on-surface">Lịch sử sửa phiếu xuất</h3>
              </div>
              <button onClick={() => setShowEditHistory(false)} className="p-2 text-on-surface-variant hover:text-error transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-0">
              <table className="w-full text-left">
                <thead className="bg-surface-container-low sticky top-0">
                  <tr className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                    <th className="py-4 px-6 border-b border-outline-variant/20 tracking-tighter">Thời gian</th>
                    <th className="py-4 px-6 border-b border-outline-variant/20">Phiếu / ERP</th>
                    <th className="py-4 px-6 border-b border-outline-variant/20 text-center">SL Cũ</th>
                    <th className="py-4 px-6 border-b border-outline-variant/20 text-center">SL Mới</th>
                    <th className="py-4 px-6 border-b border-outline-variant/20">Lý do/Người sửa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10 text-[11px] md:text-sm">
                  {editHistory.length > 0 ? editHistory.map((item, idx) => (
                    <tr key={item.id || idx} className="hover:bg-surface-container-low/50">
                      <td className="py-3 px-6 text-on-surface-variant whitespace-nowrap">
                        <div className="font-bold text-on-surface">{new Date(item.edited_at).toLocaleDateString('vi-VN')}</div>
                        <div className="text-[10px] opacity-60">{new Date(item.edited_at).toLocaleTimeString('vi-VN')}</div>
                      </td>
                      <td className="py-3 px-6">
                        <div className="font-bold text-primary">{item.outbound_id}</div>
                        <div className="text-[10px] font-medium opacity-70">ERP: {item.erp_code}</div>
                      </td>
                      <td className="py-3 px-6 font-bold text-on-surface-variant text-center bg-surface-container-low/30">{item.old_qty ?? '-'}</td>
                      <td className="py-3 px-6 font-bold text-primary text-center bg-primary/5">{item.new_qty}</td>
                      <td className="py-3 px-6">
                        <div className="text-on-surface-variant italic truncate max-w-[200px]" title={item.reason}>{item.reason}</div>
                        <div className="text-[10px] font-bold text-secondary mt-1">{item.edited_by}</div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-on-surface-variant italic">Không có dữ liệu sửa đổi trong 30 ngày qua.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <ItemHistoryModal 
        isOpen={historyModal.isOpen}
        erpCode={historyModal.erp}
        itemName={historyModal.name}
        onClose={() => setHistoryModal({ ...historyModal, isOpen: false })}
      />

      {/* Error Log Modal */}
      <AnimatePresence>
        {errorLog && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
            >
              <div className="px-8 py-5 border-b border-outline-variant/20 flex justify-between items-center bg-error-container/10">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-error text-2xl">report</span>
                  <h3 className="text-xl font-black text-on-surface">Chi tiết kết quả</h3>
                </div>
                <button onClick={() => setErrorLog('')} className="material-symbols-outlined text-on-surface-variant hover:text-error transition-colors">close</button>
              </div>
              <div className="p-6 flex-1 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-sm font-mono text-on-surface bg-surface-container-low p-4 rounded-xl border border-outline-variant/10 select-all">{errorLog}</pre>
              </div>
              <div className="px-8 py-4 border-t border-outline-variant/10 flex gap-3 justify-end">
                <button
                  onClick={() => { navigator.clipboard.writeText(errorLog); showToast('Đã copy!'); }}
                  className="px-6 py-3 bg-primary text-on-primary rounded-xl font-bold text-sm flex items-center gap-2 hover:shadow-lg transition-all"
                >
                  <span className="material-symbols-outlined text-lg">content_copy</span>
                  Copy
                </button>
                <button onClick={() => setErrorLog('')} className="px-6 py-3 bg-surface-container text-on-surface-variant rounded-xl font-bold text-sm hover:bg-surface-container-high transition-colors">
                  Đóng
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Outbound;
