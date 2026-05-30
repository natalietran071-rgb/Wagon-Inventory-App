import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { supabase } from '../lib/supabase';
import { exportToExcelMultiSheet } from '../lib/excelUtils';
import { useAuth } from '../contexts/AuthContext';
import ItemManagement from './ItemManagement';
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

const Inbound = () => {
  const { profile, user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [inboundRecords, setInboundRecords] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [recentMovements, setRecentMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (location.state?.scannedErp) {
      handleRowChange(0, 'erpCode', location.state.scannedErp);
    }
  }, [location.state?.scannedErp]);

  const canEdit = profile?.role === 'admin' || profile?.role === 'editor' || user?.email === 'natalietran071@gmail.com' || !profile;

  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [errorLog, setErrorLog] = useState<string>('');
  const [editHistory, setEditHistory] = useState<any[]>([]);

  // Form state
  // Form state
  const createEmptyRow = () => ({
    orderId: '',
    erpCode: '',
    qty: '',
    unit: 'Kiện (Pallet)',
    location: '',
    date: new Date().toISOString().split('T')[0]
  });

  const [inboundRows, setInboundRows] = useState(Array.from({ length: 5 }, createEmptyRow));

  const fetchInboundRecords = async (): Promise<any[]> => {
    const PAGE = 1000;
    let allData: any[] = [];
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase
        .from('inbound_records')
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

  const loadInboundRecords = async () => {
    try {
      const data = await fetchInboundRecords();
      setInboundRecords(data);
    } catch (error) {
      console.error('Error fetching inbound records:', error);
    }
  };

  const handleSync = async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      const fetchInventoryLocal = async (): Promise<any[]> => {
        const PAGE = 1000;
        let allInv: any[] = [];
        let pg = 0;
        let hasMore = true;
        while (hasMore) {
          const { data, error } = await supabase
            .from('inventory')
            .select('erp, name, name_zh, unit, pos, spec, in_qty, end_stock')
            .order('erp', { ascending: true })
            .range(pg * PAGE, (pg + 1) * PAGE - 1);
          if (error) { console.error('Inventory fetch error:', error); break; }
          if (data && data.length > 0) { allInv = allInv.concat(data); hasMore = data.length === PAGE; pg++; }
          else { hasMore = false; }
        }
        return allInv;
      };
      const [inv, inbound] = await Promise.all([fetchInventoryLocal(), fetchInboundRecords()]);
      setInventoryItems(inv);
      setInboundRecords(inbound);
    } finally {
      setIsSyncing(false);
      syncingRef.current = false;
    }
  };

  const handleRowChange = (index: number, field: string, value: string) => {
    const newRows = [...inboundRows];
    
    if (field === 'erpCode') {
      const item = inventoryItems.find(i => i.erp === value);
      if (item) {
        newRows[index] = {
          ...newRows[index],
          erpCode: value,
          unit: item.unit || 'Kiện (Pallet)',
          location: item.pos || ''
        };
      } else {
        newRows[index][field as keyof ReturnType<typeof createEmptyRow>] = value;
      }
    } else {
      newRows[index][field as keyof ReturnType<typeof createEmptyRow>] = value;
    }
    
    setInboundRows(newRows);
  };

  const handlePaste = (e: React.ClipboardEvent, startIdx: number, startField: string) => {
    const rawData = e.clipboardData.getData('Text');
    if (!rawData) return;
    
    const lines = rawData.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length > 1 || lines[0].includes('\t')) {
      e.preventDefault();
      
      const newRows = [...inboundRows];
      const fields = ['orderId', 'erpCode', 'ignored_name', 'ignored_spec', 'qty', 'unit', 'location', 'date'];
      const fieldIdx = fields.indexOf(startField);
      
      let currentRowIdx = startIdx;
      
      for (const line of lines) {
        if (currentRowIdx >= newRows.length) {
          newRows.push(createEmptyRow());
        }
        
        const cols = line.split('\t');
        let currentFieldIdx = fieldIdx;
        
        for (const col of cols) {
          if (currentFieldIdx >= fields.length) break;
          const field = fields[currentFieldIdx];
          
          if (field === 'erpCode') {
             newRows[currentRowIdx].erpCode = col.trim();
          } else if (field === 'qty') {
             newRows[currentRowIdx].qty = col.trim().replace(/,/g, '');
          } else if (field !== 'ignored_name' && field !== 'ignored_spec') {
             newRows[currentRowIdx][field as keyof ReturnType<typeof createEmptyRow>] = col.trim();
          }
          
          if (field === 'erpCode') {
            const item = inventoryItems.find(i => i.erp === newRows[currentRowIdx].erpCode);
            if (item) {
              if (currentFieldIdx < fields.indexOf('unit') && (!cols[fields.indexOf('unit') - fieldIdx] || !cols[fields.indexOf('unit') - fieldIdx].trim())) {
                 newRows[currentRowIdx].unit = item.unit || 'Kiện (Pallet)';
              }
              if (currentFieldIdx < fields.indexOf('location') && (!cols[fields.indexOf('location') - fieldIdx] || !cols[fields.indexOf('location') - fieldIdx].trim())) {
                 newRows[currentRowIdx].location = item.pos || '';
              }
            }
          }
          currentFieldIdx++;
        }
        currentRowIdx++;
      }
      
      setInboundRows(newRows);
    }
  };

  useEffect(() => {
    const handleQRScanned = (e: any) => {
      const scannedCode = e.detail?.code;
      if (!scannedCode) return;

      setSingleRow(prev => ({ ...prev, erpCode: scannedCode }));
      
      // Specifically for bulk if we are in bulk mode? Actually the phone has only single form.
      // But let's handle bulk as well if needed.
      setInboundRows(prev => {
        const newRows = [...prev];
        const emptyIdx = newRows.findIndex(r => !r.erpCode.trim());
        const targetIdx = emptyIdx !== -1 ? emptyIdx : 0;
        newRows[targetIdx] = { ...newRows[targetIdx], erpCode: scannedCode };
        return newRows;
      });
    };

    window.addEventListener('qr-scanned', handleQRScanned);
    return () => window.removeEventListener('qr-scanned', handleQRScanned);
  }, []);

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedRows(filteredInbound.map(r => r.id));
    } else {
      setSelectedRows([]);
    }
  };

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
              .select('erp, name, name_zh, unit, pos, spec, in_qty, end_stock')
              .order('erp', { ascending: true })
              .range(pg * PAGE, (pg + 1) * PAGE - 1);
            if (error) { console.error('Inventory fetch error:', error); break; }
            if (data && data.length > 0) { allInv = allInv.concat(data); hasMore = data.length === PAGE; pg++; }
            else { hasMore = false; }
          }
          return allInv;
        };

        const movementsFetch = supabase
          .from('movements')
          .select('*')
          .eq('type', 'IN')
          .order('created_at', { ascending: false })
          .limit(3);

        const [inv, inbound, movementsRes] = await Promise.all([
          fetchInventory(),
          fetchInboundRecords(),
          movementsFetch
        ]);
        setInventoryItems(inv);
        setInboundRecords(inbound);
        setRecentMovements(movementsRes.data || []);
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const inboundSub = supabase
      .channel('inbound_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbound_records' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setInboundRecords(prev => {
            if (prev.some(r => r.id === payload.new.id)) return prev;
            return [payload.new, ...prev];
          });
        } else if (payload.eventType === 'UPDATE') {
          setInboundRecords(prev => prev.map(item => item.id === payload.new.id ? payload.new : item));
        } else if (payload.eventType === 'DELETE') {
          setInboundRecords(prev => prev.filter(item => item.id !== payload.old.id));
        }
      })
      .subscribe();

    const movementsSub = supabase
      .channel('inbound_movements_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'movements', filter: 'type=eq.IN' }, (payload) => {
        setRecentMovements(prev => [payload.new, ...prev].slice(0, 3));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(inboundSub);
      supabase.removeChannel(movementsSub);
    };
  }, []);

  useEffect(() => {
    if (showEditHistory) {
      const fetchEditHistory = async () => {
        try {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          
          const { data, error } = await supabase
            .from('edit_history_inbound')
            .select('*')
            .gte('edited_at', thirtyDaysAgo.toISOString())
            .order('edited_at', { ascending: false });
            
          if (error) throw error;
          if (data) setEditHistory(data);
        } catch (err: any) {
          console.error('Error fetching edit history:', err);
        }
      };
      fetchEditHistory();
    }
  }, [showEditHistory]);

  const handleSubmitBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    const allRows = inboundRows.filter(r => r.orderId || r.erpCode || r.qty);
    
    if (allRows.length === 0) {
      alert('Vui lòng điền dữ liệu để nhập kho!');
      return;
    }

    // Separate valid and invalid rows
    const validRows: typeof allRows = [];
    const errorRows: { row: number; reason: string; data: string }[] = [];

    allRows.forEach((row, idx) => {
      if (!row.erpCode && !row.qty) {
        errorRows.push({ row: idx + 1, reason: 'Thiếu mã ERP và số lượng', data: JSON.stringify(row) });
      } else if (!row.erpCode) {
        errorRows.push({ row: idx + 1, reason: 'Thiếu mã ERP', data: `OrderID: ${row.orderId}, Qty: ${row.qty}` });
      } else if (!row.qty || Math.round(parseFloat(row.qty)) <= 0) {
        errorRows.push({ row: idx + 1, reason: 'Số lượng = 0 hoặc không hợp lệ', data: `ERP: ${row.erpCode}, Qty: ${row.qty}` });
      } else {
        validRows.push(row);
      }
    });
    
    if (validRows.length === 0) {
      const errorMsg = `Không có dòng nào hợp lệ!\n\nChi tiết lỗi:\n${errorRows.map(e => `Dòng ${e.row}: ${e.reason} — ${e.data}`).join('\n')}`;
      setErrorLog(errorMsg); return;
      return;
    }

    setLoading(true);
    
    try {
      const recordsToInsert = validRows.map(row => ({
        order_id: row.orderId,
        erp_code: row.erpCode,
        qty: Math.round(parseFloat(row.qty)) || 0,
        unit: row.unit,
        location: row.location,
        status: 'Stocked',
        date: row.date || new Date().toISOString().split('T')[0],
        time: new Date().toLocaleTimeString()
      }));

      const chunkSize = 500;
      for (let i = 0; i < recordsToInsert.length; i += chunkSize) {
        const chunk = recordsToInsert.slice(i, i + chunkSize);
        const { error } = await supabase.from('inbound_records').insert(chunk);
        if (error) throw error;
      }

      // 1. Record movement for dashboard
      const movementsToInsert = validRows.map(row => ({
        type: 'IN',
        item_name: row.erpCode,
        qty: Math.round(parseFloat(row.qty)) || 0,
        user_name: profile?.email || 'Admin User',
        created_at: new Date(row.date || new Date()).toISOString()
      }));
      
      for (let i = 0; i < movementsToInsert.length; i += chunkSize) {
        const chunk = movementsToInsert.slice(i, i + chunkSize);
        await supabase.from('movements').insert(chunk);
      }

      // 2. Update inventory table — group qty by ERP, update in_qty + end_stock
      const erpList = Array.from(new Set(validRows.map(r => r.erpCode)));
      
      // Fetch in chunks to avoid .in() limit
      let existingMap = new Map<string, any>();
      for (let i = 0; i < erpList.length; i += 200) {
        const chunk = erpList.slice(i, i + 200);
        const { data: existingData } = await supabase.from('inventory').select('*').in('erp', chunk);
        if (existingData) {
          existingData.forEach((item: any) => existingMap.set(item.erp, item));
        }
      }
      
      const qtyByErp: Record<string, number> = {};
      for (const row of validRows) {
         qtyByErp[row.erpCode] = (qtyByErp[row.erpCode] || 0) + (Math.round(parseFloat(row.qty)) || 0);
      }

      const invUpdates = [];
      for (const erp of Object.keys(qtyByErp)) {
         const qty = qtyByErp[erp];
         const existingItem = existingMap.get(erp);
         const rowEx = validRows.find(r => r.erpCode === erp);
         
         if (existingItem) {
           invUpdates.push({
             ...existingItem,
             in_qty: (existingItem.in_qty || 0) + qty,
             end_stock: (existingItem.end_stock || 0) + qty
           });
         } else if (rowEx) {
            invUpdates.push({
             erp: erp,
             name: '',
             unit: rowEx.unit,
             pos: rowEx.location,
             start_stock: 0,
             in_qty: qty,
             out_qty: 0,
             end_stock: qty,
             critical: false
           });
         }
      }

      if (invUpdates.length > 0) {
        for (let i = 0; i < invUpdates.length; i += chunkSize) {
          const chunk = invUpdates.slice(i, i + chunkSize);
          await supabase.from('inventory').upsert(chunk, { onConflict: 'erp' });
        }
      }

      setInboundRows(Array.from({ length: 5 }, createEmptyRow));
      await loadInboundRecords();
      
      if (errorRows.length > 0) {
        const errorMsg = `Nhập kho thành công ${validRows.length} dòng.\n\n⚠️ ${errorRows.length} dòng bị bỏ qua:\n${errorRows.map(e => `Dòng ${e.row}: ${e.reason} — ${e.data}`).join('\n')}`;
        setErrorLog(errorMsg);
      } else {
        alert(`Nhập kho hàng loạt thành công ${validRows.length} dòng!`);
      }
    } catch (err: any) {
      console.error(err);
      setErrorLog(`Lỗi: ${err.message}

Dữ liệu: ${validRows.length} dòng hợp lệ, ${errorRows.length} dòng lỗi`);
    } finally {
      setLoading(false);
    }
  };

  const [singleRow, setSingleRow] = useState(createEmptyRow());

  const handleErpInput = async (erp: string, rowIndex: number | 'single') => {
    if (!erp || erp.trim().length < 3) return;

    const upperErp = erp.trim().toUpperCase();
    
    // Check if we already have it in cache first
    const cachedItem = inventoryItems.find(i => i.erp === upperErp);
    if (cachedItem) {
      if (rowIndex === 'single') {
        setSingleRow(prev => ({
          ...prev,
          erpCode: upperErp,
          unit: cachedItem.unit || prev.unit,
          location: cachedItem.pos || prev.location
        }));
      } else {
        const newRows = [...inboundRows];
        newRows[rowIndex] = {
          ...newRows[rowIndex],
          erpCode: upperErp,
          unit: cachedItem.unit || newRows[rowIndex].unit,
          location: cachedItem.pos || newRows[rowIndex].location
        };
        setInboundRows(newRows);
      }
      return;
    }

    // Not in cache, fetch from Supabase
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('erp, name, name_zh, spec, unit, pos, end_stock')
        .eq('erp', upperErp)
        .single();

      if (data) {
        // Add to cache so UI can display name/spec, ensuring no duplicates
        setInventoryItems(prev => {
          if (prev.some(i => i.erp === data.erp)) return prev;
          return [...prev, data];
        });
        
        if (rowIndex === 'single') {
          setSingleRow(prev => ({
            ...prev,
            erpCode: data.erp,
            unit: data.unit || prev.unit,
            location: data.pos || prev.location
          }));
        } else {
          const newRows = [...inboundRows];
          newRows[rowIndex] = {
            ...newRows[rowIndex],
            erpCode: data.erp,
            unit: data.unit || newRows[rowIndex].unit,
            location: data.pos || newRows[rowIndex].location
          };
          setInboundRows(newRows);
        }
      } else {
        // Show row error as requested (using toast)
        showToast(`Mã ERP "${upperErp}" không tồn tại trong hệ thống`, true);
      }
    } catch (err: any) {
      if (err.code === 'PGRST116') { // No rows found
         showToast(`Mã ERP "${upperErp}" không tồn tại trong hệ thống`, true);
      } else {
        console.error('Error fetching ERP info:', err);
      }
    }
  };

  const handleSingleRowChange = (field: string, value: string) => {
    const newRow = { ...singleRow };
    if (field === 'erpCode') {
      const item = inventoryItems.find(i => i.erp === value);
      if (item) {
        newRow.erpCode = value;
        newRow.unit = item.unit || 'Kiện (Pallet)';
        newRow.location = item.pos || '';
      } else {
        newRow[field as keyof ReturnType<typeof createEmptyRow>] = value;
      }
    } else {
      newRow[field as keyof ReturnType<typeof createEmptyRow>] = value;
    }
    setSingleRow(newRow);
  };

  const handleSubmitSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleRow.erpCode || !singleRow.qty) {
      alert('Vui lòng điền mã ERP và số lượng!');
      return;
    }
    setLoading(true);
    try {
      const recordToInsert = {
        order_id: singleRow.orderId,
        erp_code: singleRow.erpCode,
        qty: Math.round(parseFloat(singleRow.qty)) || 0,
        unit: singleRow.unit,
        location: singleRow.location,
        status: 'Stocked',
        date: singleRow.date || new Date().toISOString().split('T')[0],
        time: new Date().toLocaleTimeString()
      };

      const { error } = await supabase.from('inbound_records').insert([recordToInsert]);
      if (error) throw error;

      const movementToInsert = {
        type: 'IN',
        item_name: singleRow.erpCode,
        qty: Math.round(parseFloat(singleRow.qty)) || 0,
        user_name: profile?.email || 'Admin User',
        created_at: new Date(singleRow.date || new Date()).toISOString()
      };
      await supabase.from('movements').insert([movementToInsert]);

      const { data: existingData } = await supabase.from('inventory').select('*').eq('erp', singleRow.erpCode).single();
      
      const invUpdate = {
        erp: singleRow.erpCode,
        in_qty: (existingData?.in_qty || 0) + (Math.round(parseFloat(singleRow.qty)) || 0),
        end_stock: (existingData?.end_stock || 0) + (Math.round(parseFloat(singleRow.qty)) || 0),
        pos: singleRow.location || existingData?.pos || '',
        name: existingData?.name || '',
        unit: singleRow.unit || existingData?.unit || '',
        updated_at: new Date().toISOString()
      };
      
      await supabase.from('inventory').upsert([invUpdate], { onConflict: 'erp' });

      setSingleRow(createEmptyRow());
      alert('Nhập kho thành công!');
    } catch (err: any) {
      console.error(err);
      alert('Lỗi nhập kho: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const [activeModuleTab, setActiveModuleTab] = useState('receipts');

  const [editingInbound, setEditingInbound] = useState<any | null>(null);
  const [editingInventory, setEditingInventory] = useState<any | null>(null);
  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean, erp: string, name: string }>({ isOpen: false, erp: '', name: '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleEditClick = async (record: any) => {
    setEditingInbound({ ...record });
    
    // Fetch associated inventory item to allow editing quy cách
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .eq('erp', record.erp_code)
      .single();
      
    if (data && !error) {
      setEditingInventory(data);
    } else {
      setEditingInventory(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingInbound) return;

    // Validate bắt buộc
    if (!editingInbound.qty || Number(editingInbound.qty) <= 0) {
      showToast('Số lượng phải lớn hơn 0', true);
      return;
    }
    if (!editingInbound.editReason || editingInbound.editReason.trim() === '') {
      showToast('Vui lòng nhập lý do chỉnh sửa', true);
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('inbound_records')
        .update({
          order_id: editingInbound.order_id,
          qty: Number(editingInbound.qty),      // ← ép kiểu số
          unit: editingInbound.unit,
          location: editingInbound.location,
          date: editingInbound.date,
          status: editingInbound.status,
          note: editingInbound.editReason       // lưu lý do vào note
        })
        .eq('id', editingInbound.id);

      if (error) {
        showToast('Lỗi lưu: ' + error.message, true);
        return;
      }

      showToast('✅ Đã lưu thay đổi!');
      setEditingInbound(null);    // ← ĐÓNG MODAL
      setEditingInventory(null);
      loadInboundRecords();       // ← RELOAD DANH SÁCH
    } catch (err: any) {
      console.error('Error saving edit:', err);
      showToast('Lỗi: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const inventoryMap = useMemo(() => {
    const map = new Map();
    inventoryItems.forEach(item => map.set(item.erp, item));
    return map;
  }, [inventoryItems]);

  const filteredInbound = useMemo(() => {
    let result = inboundRecords;
    if (fromDate) {
      result = result.filter(item => item.date >= fromDate);
    }
    if (toDate) {
      result = result.filter(item => item.date <= toDate);
    }
    if (searchQuery.trim()) {
      const lowerQ = searchQuery.toLowerCase();
      result = result.filter(item => {
        const invItem = inventoryMap.get(item.erp_code);
        const nameMatch = invItem && (
          (invItem.name && invItem.name.toLowerCase().includes(lowerQ)) ||
          (invItem.name_zh && invItem.name_zh.includes(lowerQ)) ||
          (invItem.spec && invItem.spec.toLowerCase().includes(lowerQ))
        );
        return (item.order_id && item.order_id.toLowerCase().includes(lowerQ)) ||
          (item.erp_code && item.erp_code.toLowerCase().includes(lowerQ)) ||
          (item.location && item.location.toLowerCase().includes(lowerQ)) ||
          nameMatch;
      });
    }
    return result;
  }, [inboundRecords, fromDate, toDate, searchQuery, inventoryMap]);

  const exportToExcel = async () => {
    setLoading(true);
    showToast('Đang xuất dữ liệu...');
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: dataToExport, error } = await (supabase.rpc('export_inbound', {
        p_search: searchQuery || '',
        p_from_date: fromDate || null,
        p_to_date: toDate || null
      }) as any).setHeader('Prefer', 'return=representation');

      if (error || !dataToExport) throw error || new Error('No data found');

      const exportData = (dataToExport || []).map(item => {
        const inv = inventoryMap.get(item.erp_code);
        return {
          'Thời gian': `${item.date} ${item.time || ''}`,
          'Order ID': item.order_id,
          'Mã ERP': item.erp_code,
          'Tên Vật Tư': inv ? `${inv.name || ''}${inv.name_zh ? ` (${inv.name_zh})` : ''}` : '',
          'Quy Cách': inv?.spec || '',
          'Số lượng': item.qty,
          'Đơn vị': item.unit,
          'Vị trí': item.location || '',
          'Trạng thái': item.status
        };
      });

      const fileName = fromDate
        ? `nhap-kho_${fromDate}_${toDate || today}.xlsx`
        : `nhap-kho_${today}.xlsx`;
        
      const sheets = exportToExcelMultiSheet(exportData, fileName, 'Nhập Kho');
      showToast(`✅ Đã xuất ${exportData.length.toLocaleString()} dòng — ${sheets} sheet!`);
    } catch (err: any) {
      console.error('Export error:', err);
      showToast('Lỗi: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const exportTemplate = () => {
    import('xlsx').then(XLSX => {
      const templateData = [{
        'Order ID': '',
        'Mã ERP': '',
        'Tên SP (Hiển thị tự động, không nhập)': '',
        'Quy cách (Hiển thị tự động, không nhập)': '',
        'Số lượng': '',
        'Đơn vị': '',
        'Vị trí': '',
        'Ngày nhập (YYYY-MM-DD)': ''
      }];

      const ws = XLSX.utils.json_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Template");
      XLSX.writeFile(wb, "File_Mau_Nhap_Kho_Hang_Loat.xlsx");
    });
  };

  const todayInboundCount = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return inboundRecords.filter(item => item.date === today).length;
  }, [inboundRecords]);

  const summaryFiltered = useMemo(() => {
    let totalQty = 0;
    const uniqueItems = new Set();
    filteredInbound.forEach(r => {
      totalQty += Number(r.qty) || 0;
      if (r.erp_code) uniqueItems.add(r.erp_code);
    });
    return {
      totalRows: filteredInbound.length,
      uniqueItems: uniqueItems.size,
      totalQty
    };
  }, [filteredInbound]);

  const handleDeleteFilteredInbound = async () => {
    if (!fromDate && !toDate && !searchQuery) {
      alert('Vui lòng sử dụng tính năng "Tìm kiếm" hoặc "Lọc theo ngày" để chọn vùng dữ liệu trước khi xóa toàn bộ!');
      return;
    }
    if (filteredInbound.length === 0) return;
    setShowDeleteConfirm(true);
  };

  const executeDeleteFilteredInbound = async () => {
    setShowDeleteConfirm(false);
    setLoading(true);
    try {
      // 1. Nhóm số lượng nhập theo ERP để trừ vào inventory
      const qtyToSubtractByErp: Record<string, number> = {};
      for (const record of filteredInbound) {
        if (record.erp_code && record.qty) {
          qtyToSubtractByErp[record.erp_code] = (qtyToSubtractByErp[record.erp_code] || 0) + Number(record.qty);
        }
      }
      
      // 2. Fetch existing inventory to decrease or delete
      const erpsToUpdate = Object.keys(qtyToSubtractByErp);
      if (erpsToUpdate.length > 0) {
         const invChunkSize = 100;
         for (let i = 0; i < erpsToUpdate.length; i += invChunkSize) {
           const chunk = erpsToUpdate.slice(i, i + invChunkSize);
           const { data: invData } = await supabase.from('inventory').select('*').in('erp', chunk);
           
           if (invData && invData.length > 0) {
              const invUpdates: any[] = [];
              const erpsToRemove: string[] = [];
              
              invData.forEach(item => {
                 const subQty = qtyToSubtractByErp[item.erp] || 0;
                 const newInQty = Math.max(0, (item.in_qty || 0) - subQty);
                 const newEndStock = Math.max(0, (item.end_stock || 0) - subQty);
                 
                 // Nếu không còn tồn đầu, không còn nhập, không còn xuất -> Xóa vĩnh viễn khỏi DB Tồn Kho
                 if (newInQty === 0 && (item.start_stock || 0) === 0 && (item.out_qty || 0) === 0) {
                   erpsToRemove.push(item.erp);
                 } else {
                   invUpdates.push({
                      ...item,
                      in_qty: newInQty,
                      end_stock: newEndStock
                   });
                 }
              });

              if (invUpdates.length > 0) {
                await supabase.from('inventory').upsert(invUpdates, { onConflict: 'erp' });
              }
              if (erpsToRemove.length > 0) {
                await supabase.from('inventory').delete().in('erp', erpsToRemove);
              }
           }
         }
      }

      // 3. Delete inbound records
      const idsToDelete = filteredInbound.map(r => r.id);
      const chunkSize = 200;
      let deletedCount = 0;
      for (let i = 0; i < idsToDelete.length; i += chunkSize) {
        const chunk = idsToDelete.slice(i, i + chunkSize);
        const { error } = await supabase.from('inbound_records').delete().in('id', chunk);
        if (error) throw error;
        deletedCount += chunk.length;
      }
      alert(`Đã xóa thủ công ${deletedCount} mục nhập kho. Số lượng và thông tin vật tư tương ứng trong kho đã được dọn sạch!`);
    } catch (err: any) {
      console.error(err);
      alert('Lỗi khi xóa dữ liệu: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const executeDeleteSelected = async () => {
    setShowDeleteSelectedConfirm(false);
    setLoading(true);
    try {
      const recordsToDelete = inboundRecords.filter(r => selectedRows.includes(r.id));
      
      // 1. Nhóm số lượng nhập theo ERP để trừ vào inventory
      const qtyToSubtractByErp: Record<string, number> = {};
      for (const record of recordsToDelete) {
        if (record.erp_code && record.qty) {
          qtyToSubtractByErp[record.erp_code] = (qtyToSubtractByErp[record.erp_code] || 0) + Number(record.qty);
        }
      }
      
      // 2. Fetch existing inventory to decrease or delete
      const erpsToUpdate = Object.keys(qtyToSubtractByErp);
      if (erpsToUpdate.length > 0) {
         const invChunkSize = 100;
         for (let i = 0; i < erpsToUpdate.length; i += invChunkSize) {
           const chunk = erpsToUpdate.slice(i, i + invChunkSize);
           const { data: invData } = await supabase.from('inventory').select('*').in('erp', chunk);
           
           if (invData && invData.length > 0) {
              const invUpdates: any[] = [];
              const erpsToRemove: string[] = [];
              
              invData.forEach(item => {
                 const subQty = qtyToSubtractByErp[item.erp] || 0;
                 const newInQty = Math.max(0, (item.in_qty || 0) - subQty);
                 const newEndStock = Math.max(0, (item.end_stock || 0) - subQty);
                 
                 if (newInQty === 0 && (item.start_stock || 0) === 0 && (item.out_qty || 0) === 0) {
                   erpsToRemove.push(item.erp);
                 } else {
                   invUpdates.push({
                      ...item,
                      in_qty: newInQty,
                      end_stock: newEndStock
                   });
                 }
              });

              if (invUpdates.length > 0) {
                await supabase.from('inventory').upsert(invUpdates, { onConflict: 'erp' });
              }
              if (erpsToRemove.length > 0) {
                await supabase.from('inventory').delete().in('erp', erpsToRemove);
              }
           }
         }
      }

      // 3. Delete inbound records
      const chunkSize = 200;
      let deletedCount = 0;
      for (let i = 0; i < selectedRows.length; i += chunkSize) {
        const chunk = selectedRows.slice(i, i + chunkSize);
        const { error } = await supabase.from('inbound_records').delete().in('id', chunk);
        if (error) throw error;
        deletedCount += chunk.length;
      }
      alert(`Đã xóa ${deletedCount} mục nhập kho đã chọn. Kho đã được đồng bộ!`);
      setSelectedRows([]);
    } catch (err: any) {
      console.error(err);
      alert('Lỗi khi xóa dữ liệu: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold font-manrope text-on-surface tracking-tight mb-1 md:mb-2">{t('inbound')}</h2>
          <p className="text-xs md:text-sm text-on-surface-variant font-medium">Ghi nhận thông tin vật tư nhập kho mới.</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex bg-surface-container-low p-1 rounded-xl w-full md:w-auto">
            <button 
              onClick={() => setActiveModuleTab('receipts')}
              className={`flex-1 md:flex-none px-4 md:px-6 py-2 rounded-lg text-xs md:text-sm font-bold transition-all ${activeModuleTab === 'receipts' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
            >
              Nhập Kho 
            </button>
            <button 
              onClick={() => setActiveModuleTab('items')}
              className={`flex-1 md:flex-none px-4 md:px-6 py-2 rounded-lg text-xs md:text-sm font-bold transition-all ${activeModuleTab === 'items' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
            >
              Quản Lý Mã
            </button>
          </div>
        </div>
      </div>

      {activeModuleTab === 'receipts' ? (
        <>
        <div className="grid grid-cols-1 gap-8">
          <div className="col-span-1 border border-outline-variant/10 rounded-[2rem] overflow-hidden shadow-sm">
            <div className="hidden md:block bg-surface-container-lowest p-8 relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-primary/5 to-transparent rounded-full -mr-20 -mt-20"></div>
            <div className="flex justify-between items-start mb-8 relative z-10">
              <div>
                <h3 className="text-2xl font-bold font-manrope flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">add_box</span>
                  Phiếu Nhập Kho (Hàng Loạt)
                </h3>
                <div className="flex items-center gap-3 mt-1 text-sm text-on-surface-variant font-medium">
                  <p>Hỗ trợ dán (Ctrl+V) dữ liệu từ Excel.</p>
                  <button onClick={exportTemplate} className="text-primary hover:underline flex items-center gap-1 font-bold">
                    <span className="material-symbols-outlined text-sm">download</span> Tải File Mẫu
                  </button>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="bg-secondary-container/30 px-4 py-2 rounded-xl border border-secondary-container/50">
                  <span className="text-[10px] font-bold text-secondary uppercase tracking-widest block text-center mb-0.5">Hôm nay</span>
                  <div className="text-sm font-black font-manrope text-on-secondary-container text-center">{todayInboundCount} <span className="font-medium text-[10px]">Phiếu</span></div>
                </div>
                <button type="button" onClick={() => setActiveModuleTab('items')} className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer">
                  <span className="material-symbols-outlined text-[14px]">add_circle</span>
                  Tạo vật tư
                </button>
              </div>
            </div>
            <form onSubmit={handleSubmitBulk} className="space-y-4 relative z-10 w-full">
              <div className="overflow-x-auto border border-outline-variant/20 rounded-xl max-h-[500px] overflow-y-auto no-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-surface-container-highest z-20 shadow-sm border-b border-outline-variant/20">
                    <tr>
                      <th className="px-2 py-3 text-xs font-bold text-on-surface-variant uppercase text-center w-10">#</th>
                      <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[150px]">Order ID</th>
                      <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[200px]">{t('erpCode')}</th>
                      <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[150px]">Tên SP</th>
                      <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[100px]">Quy cách</th>
                      <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[120px]">Số lượng</th>
                      <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[120px]">{t('unit')}</th>
                      <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[150px]">{t('location')}</th>
                      <th className="px-4 py-3 text-xs font-bold text-on-surface-variant uppercase min-w-[150px]">Ngày nhập</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10 text-sm bg-surface-container-lowest">
                    {inboundRows.map((row, idx) => {
                      const item = inventoryItems.find(i => i.erp === row.erpCode);
                      return (
                        <tr key={idx} className="hover:bg-surface-container-low focus-within:bg-secondary-container/20 transition-colors group">
                          <td className="px-2 py-2 text-center text-on-surface-variant/50 text-[10px] font-bold select-none">{idx + 1}</td>
                          <td className="p-0 border-r border-outline-variant/5">
                            <input 
                              type="text" 
                              value={row.orderId}
                              onChange={(e) => handleRowChange(idx, 'orderId', e.target.value)}
                              onPaste={(e) => handlePaste(e, idx, 'orderId')}
                              className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-medium"
                              placeholder="Mã Order"
                            />
                          </td>
                          <td className="p-0 border-r border-outline-variant/5 relative">
                            <input 
                              list="inbound-erp-options"
                              type="text" 
                              value={row.erpCode}
                              onChange={(e) => handleRowChange(idx, 'erpCode', e.target.value)}
                              onBlur={(e) => handleErpInput(e.target.value, idx)}
                              onPaste={(e) => handlePaste(e, idx, 'erpCode')}
                              className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-bold text-primary placeholder:font-normal placeholder:text-outline-variant/40"
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
                                    <span className="text-[8px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">Tồn: {item.end_stock.toLocaleString('en-US')}</span>
                                  </div>
                                </div>
                              ) : <span className="text-outline-variant/50 italic">-</span>}
                            </div>
                          </td>
                          <td className="p-0 border-r border-outline-variant/5 bg-on-surface/5">
                            <div className="w-full px-4 py-3 text-[10px] font-medium text-on-surface-variant line-clamp-2 select-none h-full" title={item?.spec || ''}>
                              {item ? item.spec : <span className="text-outline-variant/50 italic">-</span>}
                            </div>
                          </td>
                          <td className="p-0 border-r border-outline-variant/5">
                            <input 
                              type="number" 
                              value={row.qty}
                              onChange={(e) => handleRowChange(idx, 'qty', e.target.value)}
                              onPaste={(e) => handlePaste(e, idx, 'qty')}
                              className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-bold text-on-surface"
                              placeholder="0.00"
                            />
                          </td>
                          <td className="p-0 border-r border-outline-variant/5 relative">
                            <input 
                              list="inbound-unit-options"
                              type="text" 
                              value={row.unit}
                              onChange={(e) => handleRowChange(idx, 'unit', e.target.value)}
                              onPaste={(e) => handlePaste(e, idx, 'unit')}
                              className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-medium"
                              placeholder="ĐVT"
                            />
                          </td>
                          <td className="p-0 border-r border-outline-variant/5">
                            <input 
                              type="text" 
                              value={row.location}
                              onChange={(e) => handleRowChange(idx, 'location', e.target.value)}
                              onPaste={(e) => handlePaste(e, idx, 'location')}
                              className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-sm font-medium"
                              placeholder="Vị trí"
                            />
                          </td>
                          <td className="p-0">
                            <input 
                              type="date" 
                              value={row.date}
                              onChange={(e) => handleRowChange(idx, 'date', e.target.value)}
                              onPaste={(e) => handlePaste(e, idx, 'date')}
                              className="w-full bg-transparent border-none focus:ring-2 focus:ring-primary focus:outline-none px-4 py-3 text-xs font-medium cursor-pointer"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="pt-6 flex justify-between items-center bg-surface-container-lowest mt-4 border-t border-outline-variant/10">
                <button 
                  className="px-6 py-3 text-sm font-bold text-on-surface-variant hover:text-error hover:bg-error-container/20 rounded-xl transition-all" 
                  type="reset" 
                  onClick={() => setInboundRows(Array.from({ length: 5 }, createEmptyRow))}
                >
                  Xóa trắng bảng
                </button>
                <button 
                  className="px-8 py-3.5 bg-primary text-on-primary text-sm font-bold rounded-xl shadow-md active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2" 
                  type="submit"
                  disabled={!canEdit}
                >
                   <span className="material-symbols-outlined">dataset</span>
                   Xác nhận nhập kho hàng loạt
                </button>
              </div>
            </form>
            </div>

            <div className="block md:hidden bg-surface-container-lowest p-6 relative">
               <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/5 to-transparent rounded-full -mr-10 -mt-10"></div>
               <div className="flex justify-between items-center mb-6 relative z-10">
                   <h3 className="text-xl font-bold font-manrope flex items-center gap-2 text-on-surface">
                     <span className="material-symbols-outlined text-primary">add_box</span>
                     Nhập Kho
                   </h3>
                   <div className="bg-secondary-container/30 px-3 py-1.5 rounded-lg border border-secondary-container/50">
                     <span className="text-[9px] font-bold text-secondary uppercase tracking-widest block text-center">Hôm nay</span>
                     <div className="text-sm font-bold text-on-secondary-container text-center">{todayInboundCount}</div>
                   </div>
               </div>
               <form onSubmit={handleSubmitSingle} className="space-y-4 relative z-10 w-full pb-2">
                 <div className="space-y-4">
                   <div className="relative">
                     <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Tiết mục (Order)</label>
                     <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant">tag</span>
                        <input type="text" value={singleRow.orderId} onChange={(e) => handleSingleRowChange('orderId', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl pl-10 pr-4 py-3.5 text-sm focus:ring-2 focus:ring-primary focus:outline-none" placeholder="Tùy chọn" />
                     </div>
                   </div>
                   <div className="relative">
                     <div className="flex justify-between items-end mb-1.5">
                       <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider">Mã ERP <span className="text-error">*</span></label>
                       <button type="button" onClick={() => setActiveModuleTab('items')} className="text-[10px] font-bold text-primary hover:underline flex items-center">
                          Tạo mới
                       </button>
                     </div>
                     <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-primary">qr_code_scanner</span>
                        <input 
                          list="inbound-erp-options" 
                          type="text" 
                          required 
                          value={singleRow.erpCode} 
                          onChange={(e) => handleSingleRowChange('erpCode', e.target.value)} 
                          onBlur={(e) => handleErpInput(e.target.value, 'single')}
                          className="w-full bg-primary/5 border border-primary/30 rounded-xl pl-10 pr-4 py-3.5 text-sm font-bold text-primary focus:ring-2 focus:ring-primary focus:outline-none" 
                          placeholder="Chọn hoặc nhập mã ERP" 
                        />
                     </div>
                   </div>
                   {(() => {
                      const item = inventoryItems.find(i => i.erp === singleRow.erpCode);
                      if (item) {
                        return (
                          <div className="px-4 py-3 bg-surface-container rounded-xl flex flex-col items-start border-l-2 border-primary">
                            <span className="text-[10px] uppercase font-bold text-on-surface-variant/70 mb-1">Vật tư mục tiêu</span>
                            <p className="text-sm font-bold text-on-surface mb-0.5">{item.name}</p>
                            <p className="text-xs text-on-surface-variant truncate w-full">{item.spec || 'Không có quy cách'}</p>
                          </div>
                        );
                      }
                      return null;
                   })()}
                   <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Số lượng <span className="text-error">*</span></label>
                       <div className="relative">
                           <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant">123</span>
                           <input type="number" step="any" required value={singleRow.qty} onChange={(e) => handleSingleRowChange('qty', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl pl-10 pr-4 py-3.5 text-base font-black text-on-surface focus:ring-2 focus:ring-primary focus:outline-none" placeholder="0" />
                       </div>
                     </div>
                     <div>
                       <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">{t('unit')}</label>
                       <input list="inbound-unit-options" type="text" value={singleRow.unit} onChange={(e) => handleSingleRowChange('unit', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3.5 text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none" placeholder="ĐVT" />
                     </div>
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">{t('location')}</label>
                       <div className="relative">
                           <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant">location_on</span>
                           <input type="text" value={singleRow.location} onChange={(e) => handleSingleRowChange('location', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl pl-9 pr-3 py-3.5 text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none" placeholder="Kho X..." />
                       </div>
                     </div>
                     <div>
                       <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Ngày nhập</label>
                       <input type="date" value={singleRow.date} onChange={(e) => handleSingleRowChange('date', e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 py-3.5 text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none" />
                     </div>
                   </div>
                 </div>

                 <button 
                  className="w-full mt-8 py-4 bg-primary text-on-primary text-base font-bold rounded-xl shadow-lg shadow-primary/30 active:scale-95 transition-all disabled:opacity-50 flex justify-center items-center gap-2" 
                  type="submit"
                  disabled={!canEdit}
                 >
                    <span className="material-symbols-outlined">add_circle</span>
                    Xác nhận nhập kho
                 </button>
               </form>
            </div>
            
            {/* Shared Datalists */}
            <datalist id="inbound-erp-options">
              {inventoryItems.map((item, idx) => (
                <option key={item.erp || `inbound-erp-${idx}`} value={item.erp || ''}>
                  {item.name} {item.name_zh ? `(${item.name_zh})` : ''}
                </option>
              ))}
            </datalist>
            <datalist id="inbound-unit-options">
               <option value="Kiện (Pallet)" />
               <option value="Thùng (Box)" />
               <option value="Cái (Pcs)" />
               <option value="Cái (PCS)" />
               <option value="Bộ (SET)" />
               <option value="Mét (M)" />
               <option value="Kg (KG)" />
               <option value="Cuộn" />
            </datalist>
          </div>
        </div>

      <div className="bg-surface-container-lowest rounded-2xl md:rounded-[2rem] p-4 md:p-6 lg:p-8 shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-4 md:mb-10">
          <div className="flex items-center gap-4">
            <h3 className="text-lg md:text-xl font-bold font-manrope">Lịch sử nhập kho</h3>
            <button 
              onClick={() => setShowEditHistory(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-secondary/10 text-secondary rounded-lg hover:bg-secondary/20 transition-all text-[10px] md:text-xs font-bold"
            >
              <span className="material-symbols-outlined text-sm">history</span>
              Lịch sử sửa
            </button>
          </div>
          <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-center w-full xl:w-auto">
            <div className="relative bg-surface-container-low px-3 md:px-4 py-2 md:py-2 rounded-xl border border-outline-variant/10 w-full sm:w-auto">
              <input 
                type="text"
                placeholder="Tìm kiếm..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // Search is handled via useMemo locally, so no other action needed
                  }
                }}
                className="bg-transparent border-none text-[10px] md:text-sm font-medium focus:ring-0 outline-none w-full sm:w-52"
              />
              <span className="material-symbols-outlined text-sm absolute right-3 top-1/2 -translate-y-1/2 text-outline-variant">search</span>
            </div>
            <div className="flex items-center gap-1.5 md:gap-2 bg-surface-container-low px-3 md:px-4 py-2 md:py-2 rounded-xl border border-outline-variant/10 overflow-x-auto no-scrollbar w-full sm:w-auto">
              <span className="material-symbols-outlined text-sm text-on-surface-variant shrink-0">calendar_today</span>
              <span className="text-[10px] md:text-xs font-medium text-on-surface-variant whitespace-nowrap">Từ</span>
              <input 
                type="date" 
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="bg-transparent border-none text-[10px] md:text-xs font-bold focus:ring-0 cursor-pointer p-0 min-w-[90px]"
              />
              <span className="text-[10px] md:text-xs font-medium text-on-surface-variant whitespace-nowrap">Hết</span>
              <input 
                type="date" 
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="bg-transparent border-none text-[10px] md:text-xs font-bold focus:ring-0 cursor-pointer p-0 min-w-[90px]"
              />
              {(fromDate || toDate) && (
                <button onClick={() => { setFromDate(''); setToDate(''); }} className="material-symbols-outlined text-[14px] hover:text-error transition-colors ml-1 shrink-0">close</button>
              )}
            </div>
            <div className="flex gap-2 flex-wrap w-full sm:w-auto">
              {selectedRows.length > 0 && canEdit && (
                <button 
                  onClick={() => setShowDeleteSelectedConfirm(true)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-error text-on-error px-3 md:px-4 py-2 rounded-xl hover:opacity-90 transition-colors font-bold text-[10px] md:text-xs shadow-lg shadow-error/20"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                  Xóa ({selectedRows.length})
                </button>
              )}
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-surface-container-high text-on-surface-variant px-3 md:px-4 py-2 rounded-xl hover:bg-surface-container-highest transition-colors font-bold text-[10px] md:text-xs disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-sm ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
                Đồng bộ
              </button>
              <button
                onClick={exportToExcel}
                disabled={loading}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-surface-container-high px-3 md:px-4 py-2 rounded-xl text-primary hover:bg-primary-container hover:text-on-primary-container transition-colors font-bold text-[10px] md:text-xs disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">{loading ? 'sync' : 'download'}</span>
                {loading ? 'Đang xuất...' : 'Xuất Excel'}
              </button>
            </div>
          </div>
          
          <div className="mb-4 md:mb-6 grid grid-cols-3 gap-2 md:gap-6 p-3 md:p-6 bg-primary-container/20 rounded-xl border border-primary-container/30 text-center md:text-left">
            <div className="flex flex-col">
               <span className="text-[8px] md:text-xs font-bold text-on-surface-variant uppercase mb-0.5 md:mb-1">Vật tư</span>
               <span className="text-xs md:text-lg font-black text-primary">{summaryFiltered.uniqueItems.toLocaleString('en-US')} <span className="text-[8px] md:text-sm font-medium">SKU</span></span>
            </div>
            <div className="border-l border-outline-variant/30 flex flex-col pl-2 md:pl-0 md:border-none">
               <span className="text-[8px] md:text-xs font-bold text-on-surface-variant uppercase mb-0.5 md:mb-1">Số phiếu</span>
               <span className="text-xs md:text-lg font-black text-primary">{summaryFiltered.totalRows.toLocaleString('en-US')} <span className="text-[8px] md:text-sm font-medium">Phiếu</span></span>
            </div>
            <div className="border-l border-outline-variant/30 flex flex-col pl-2 md:pl-0 md:border-none">
               <span className="text-[8px] md:text-xs font-bold text-on-surface-variant uppercase mb-0.5 md:mb-1">Tổng SL</span>
               <span className="text-xs md:text-lg font-black text-secondary">{summaryFiltered.totalQty.toLocaleString('en-US')} <span className="text-[8px] md:text-sm font-medium">Units</span></span>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[9px] md:text-[10px] font-black text-on-surface-variant uppercase tracking-widest border-none">
                <th className="pb-3 md:pb-6 px-1 md:px-4 w-6 md:w-10">
                  <input 
                    type="checkbox"
                    className="w-3 h-3 md:w-4 md:h-4 rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                    onChange={handleSelectAll}
                    checked={filteredInbound.length > 0 && selectedRows.length === filteredInbound.length}
                  />
                </th>
                <th className="pb-3 md:pb-6 px-1 md:px-4 hidden lg:table-cell">Thời gian</th>
                <th className="pb-3 md:pb-6 px-1 md:px-4 hidden md:table-cell">Mã Đơn</th>
                <th className="pb-3 md:pb-6 px-1 md:px-4">Vật tư / ERP</th>
                <th className="pb-3 md:pb-6 px-1 md:px-4 hidden xl:table-cell">Tên Vật Tư</th>
                <th className="pb-3 md:pb-6 px-1 md:px-4 hidden xl:table-cell">Quy Cách</th>
                <th className="pb-3 md:pb-6 px-1 md:px-4 text-right md:text-left">SL</th>
                <th className="pb-3 md:pb-6 px-1 md:px-4 hidden lg:table-cell">{t('location')}</th>
                <th className="pb-3 md:pb-6 px-1 md:px-4 hidden xl:table-cell">Trạng thái</th>
                <th className="pb-3 md:pb-6 px-1 md:px-4 text-right">{t('action')}</th>
              </tr>
            </thead>
            <tbody className="text-[10px] md:text-sm">
              {filteredInbound.map((row, idx) => (
                <tr key={row.id || idx} className={`transition-colors group ${selectedRows.includes(row.id) ? 'bg-primary-container/20' : 'hover:bg-surface-container-low'}`}>
                  <td className="py-3 md:py-6 px-1 md:px-4 w-6 md:w-10">
                    <input 
                      type="checkbox"
                      className="w-3 h-3 md:w-4 md:h-4 rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                      checked={selectedRows.includes(row.id)}
                      onChange={() => handleSelectRow(row.id)}
                    />
                  </td>
                  <td className="py-3 md:py-6 px-1 md:px-4 font-medium hidden md:table-cell">
                    <div className="flex flex-col">
                      <span className="text-on-surface font-bold whitespace-nowrap">{row.date}</span>
                      <span className="text-[10px] text-on-surface-variant">{row.time}</span>
                    </div>
                  </td>
                  <td className="py-3 md:py-6 px-1 md:px-4 font-bold hidden md:table-cell">{row.order_id}</td>
                  <td className="py-3 md:py-6 px-1 md:px-4 text-on-surface-variant font-mono">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setHistoryModal({ isOpen: true, erp: row.erp_code, name: row.item_name || '' });
                      }}
                      className="font-bold text-primary text-[11px] md:text-sm hover:underline cursor-pointer"
                      title="Xem lịch sử nhập xuất"
                    >
                      {row.erp_code}
                    </button>
                    <div className="md:hidden flex flex-col gap-0.5 mt-0.5">
                      <span className="text-[9px] text-outline-variant inline-block font-sans"><span className="font-bold">Order:</span> {row.order_id || '-'}</span>
                      <span className="text-[9px] text-outline-variant inline-block font-sans"><span className="font-bold">Loc:</span> {row.location || '-'}</span>
                      <span className="text-[9px] text-outline-variant inline-block font-sans"><span className="font-bold">Lúc:</span> {row.date} {row.time || '-'}</span>
                    </div>
                  </td>
                  <td className="py-3 md:py-6 px-1 md:px-4 hidden xl:table-cell">
                    {(() => { const inv = inventoryMap.get(row.erp_code); return inv ? <span className="text-xs text-on-surface">{inv.name}{inv.name_zh ? ` (${inv.name_zh})` : ''}</span> : <span className="text-outline-variant/40 text-xs">—</span>; })()}
                  </td>
                  <td className="py-3 md:py-6 px-1 md:px-4 hidden xl:table-cell">
                    {(() => { const inv = inventoryMap.get(row.erp_code); return inv?.spec ? <span className="text-xs text-on-surface-variant">{inv.spec}</span> : <span className="text-outline-variant/40 text-xs">—</span>; })()}
                  </td>
                  <td className="py-3 md:py-6 px-1 md:px-4 font-bold text-right md:text-left text-[11px] md:text-sm">{Number(row.qty).toLocaleString('en-US')} <span className="text-[9px] md:text-xs font-normal text-outline-variant inline-block ml-0.5 md:ml-1">{row.unit}</span></td>
                  <td className="py-3 md:py-6 px-1 md:px-4 hidden lg:table-cell"><span className="px-3 py-1 bg-surface-container-high rounded-full text-[9px] md:text-xs">{row.location}</span></td>
                  <td className="py-3 md:py-6 px-1 md:px-4 hidden xl:table-cell">
                    <span className={`px-2 md:px-3 py-1 ${row.status === 'Stocked' ? 'bg-primary-container text-on-primary-container' : 'bg-secondary-container text-on-secondary-container'} rounded-full text-[8px] md:text-[10px] font-bold uppercase`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="py-3 md:py-6 px-1 md:px-4 text-right flex justify-end gap-1 px-1">
                    <button 
                      onClick={() => setHistoryModal({ isOpen: true, erp: row.erp_code, name: row.item_name || '' })}
                      className="material-symbols-outlined text-outline-variant hover:text-primary transition-colors bg-surface-container hover:bg-primary/10 p-1 md:p-2 rounded-lg text-[14px] md:text-base"
                      title="Lịch sử"
                    >
                      history
                    </button>
                    {canEdit && (
                      <button 
                        onClick={() => handleEditClick(row)}
                        className="material-symbols-outlined text-outline-variant hover:text-primary transition-colors bg-surface-container hover:bg-primary/10 p-1 md:p-2 rounded-lg text-[14px] md:text-base"
                        title="Sửa thông tin"
                      >
                        edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredInbound.length === 0 && (
                <tr key="empty-inbound">
                  <td colSpan={7} className="py-12 text-center text-on-surface-variant font-medium italic">
                    Không có dữ liệu nhập kho cho ngày này.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      ) : (
        <ItemManagement />
      )}

      {showDeleteSelectedConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest p-8 rounded-[2rem] shadow-2xl max-w-sm w-full border border-outline-variant/10 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-6">
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
            </div>
            <h3 className="text-xl font-black text-on-surface mb-2">Xác nhận xóa {selectedRows.length} mục</h3>
            <p className="text-on-surface-variant text-sm mb-6 leading-relaxed">
              Bạn có chắc chắn muốn XÓA <strong className="text-error">{selectedRows.length}</strong> dữ liệu nhập kho đã được tick chọn? Số lượng tồn kho của các mặt hàng liên quan sẽ bị GIẢM TỰ ĐỘNG tương ứng.
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
                {loading ? 'Đang xóa...' : 'Xác nhận xóa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest p-8 rounded-[2rem] shadow-2xl max-w-sm w-full border border-outline-variant/10 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-6">
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
            </div>
            <h3 className="text-xl font-black text-on-surface mb-2">CẢNH BÁO NGUY HIỂM</h3>
            <p className="text-on-surface-variant text-sm mb-6 leading-relaxed">
              Bạn có chắc chắn muốn XÓA TOÀN BỘ <strong className="text-error">{filteredInbound.length}</strong> dữ liệu nhập kho đang hiển thị trong bộ lọc này? Số lượng tồn kho của các mặt hàng liên quan sẽ bị GIẢM TỰ ĐỘNG tương ứng. Hành động này không thể hoàn tác!
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
                disabled={loading}
              >
                Hủy
              </button>
              <button 
                onClick={executeDeleteFilteredInbound}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-error text-on-error shadow-lg shadow-error/20 hover:opacity-90 transition-opacity"
                disabled={loading}
              >
                {loading ? 'Đang xóa...' : 'Xác nhận xóa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingInbound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-8 py-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest sticky top-0 z-10">
              <div>
                <h3 className="text-2xl font-bold font-manrope text-on-surface">Chỉnh sửa phiếu nhập kho</h3>
                <p className="text-on-surface-variant text-sm mt-1 font-medium">Cập nhật thông tin phiếu nhập và quy cách vật tư.</p>
              </div>
              <button 
                onClick={() => { setEditingInbound(null); setEditingInventory(null); }}
                className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface hover:bg-error-container hover:text-on-error-container transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto space-y-8 bg-surface">
              <div className="bg-surface-container-low rounded-2xl p-6 border border-outline-variant/10">
                <h4 className="text-sm font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">receipt_long</span>
                  Thông tin phiếu nhập
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mã đơn hàng</label>
                    <input 
                      type="text" 
                      className="w-full bg-surface-container-lowest border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20"
                      value={editingInbound.order_id}
                      onChange={e => setEditingInbound({ ...editingInbound, order_id: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Mã ERP</label>
                    <input 
                      type="text" 
                      className="w-full bg-surface-container-lowest border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20"
                      value={editingInbound.erp_code}
                      onChange={e => setEditingInbound({ ...editingInbound, erp_code: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Trạng thái</label>
                    <select 
                      className="w-full bg-surface-container-lowest border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                      value={editingInbound.status || 'Stocked'}
                      onChange={e => setEditingInbound({ ...editingInbound, status: e.target.value })}
                    >
                      <option value="Stocked">Stocked</option>
                      <option value="Pending">Pending</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Số lượng nhập</label>
                    <input 
                      type="number" 
                      className="w-full bg-surface-container-lowest border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20 text-right data-value"
                      value={editingInbound.qty}
                      onChange={e => setEditingInbound({ ...editingInbound, qty: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Ngày nhập</label>
                    <input 
                      type="date" 
                      className="w-full bg-surface-container-lowest border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                      value={editingInbound.date || ''}
                      onChange={e => setEditingInbound({ ...editingInbound, date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Đơn vị</label>
                    <input 
                      type="text" 
                      className="w-full bg-surface-container-lowest border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20"
                      value={editingInbound.unit}
                      onChange={e => setEditingInbound({ ...editingInbound, unit: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Vị trí (Location)</label>
                    <input 
                      type="text" 
                      className="w-full bg-surface-container-lowest border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20"
                      value={editingInbound.location || ''}
                      onChange={e => setEditingInbound({ ...editingInbound, location: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="bg-surface-container-low rounded-2xl p-6 border border-outline-variant/10">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Lý do chỉnh sửa <span className="text-error">*</span></label>
                <textarea 
                  className="w-full bg-surface-container-lowest border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 min-h-[80px]"
                  placeholder="Nhập lý do thay đổi số lượng hoặc thông tin phiếu..."
                  value={editingInbound.editReason || ''}
                  onChange={e => setEditingInbound({ ...editingInbound, editReason: e.target.value })}
                />
              </div>

              {editingInventory && (
                <div className="bg-primary/5 rounded-2xl p-6 border border-primary/20 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-5">
                     <span className="material-symbols-outlined text-[10rem]">inventory</span>
                  </div>
                  <h4 className="text-sm font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2 relative z-10">
                    <span className="material-symbols-outlined text-base">category</span>
                    Thông tin vật tư
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-2 gap-4 relative z-10">
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-bold text-primary uppercase tracking-wider">Tên vật tư (VN)</label>
                      <input 
                        type="text" 
                        className="w-full bg-surface-container-lowest border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20"
                        value={editingInventory.name}
                        onChange={e => setEditingInventory({ ...editingInventory, name: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-bold text-primary uppercase tracking-wider">Quy cách (Specification)</label>
                      <input 
                        type="text" 
                        className="w-full bg-surface-container-lowest border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-primary/20"
                        value={editingInventory.spec || ''}
                        onChange={e => setEditingInventory({ ...editingInventory, spec: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="px-8 py-6 border-t border-outline-variant/20 bg-surface-container-lowest flex justify-end gap-3 sticky bottom-0 z-10">
              <button 
                onClick={() => { setEditingInbound(null); setEditingInventory(null); }}
                className="px-6 py-3 font-bold text-on-surface-variant hover:bg-surface-container-low rounded-xl transition-colors text-sm"
              >
                Hủy
              </button>
              <button 
                onClick={handleSaveEdit}
                className="px-8 py-3 bg-primary text-on-primary font-bold rounded-xl shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all text-sm flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">save</span>
                Lưu Thay Đổi
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditHistory && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden border border-outline-variant/10"
          >
            <div className="px-8 py-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner">
                  <span className="material-symbols-outlined text-2xl">history</span>
                </div>
                <div>
                  <h3 className="text-xl font-bold font-manrope text-on-surface">Lịch sử sửa phiếu nhập</h3>
                  <p className="text-on-surface-variant text-xs font-medium">Theo dõi các thay đổi trong 30 ngày qua.</p>
                </div>
              </div>
              <button 
                onClick={() => setShowEditHistory(false)}
                className="w-10 h-10 rounded-full hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="flex-1 overflow-x-auto no-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="bg-surface-container-low/50 sticky top-0 z-10 backdrop-blur-md">
                  <tr className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest border-b border-outline-variant/20">
                    <th className="py-5 px-6">Thời gian</th>
                    <th className="py-5 px-6">Phiếu / ERP</th>
                    <th className="py-5 px-6 text-center">SL Cũ</th>
                    <th className="py-5 px-6 text-center">Biến động</th>
                    <th className="py-5 px-6 text-center">SL Mới</th>
                    <th className="py-5 px-6">Lý do / Người thực hiện</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10 text-sm">
                  {editHistory.length > 0 ? editHistory.map((item, idx) => {
                    const diff = Number(item.new_qty) - Number(item.old_qty || 0);
                    return (
                      <tr key={item.id || idx} className="hover:bg-surface-container-low/50 transition-colors">
                        <td className="py-4 px-6 text-on-surface-variant whitespace-nowrap">
                          <div className="font-bold text-on-surface">{new Date(item.edited_at).toLocaleDateString('vi-VN')}</div>
                          <div className="text-[10px] opacity-60 font-medium">{new Date(item.edited_at).toLocaleTimeString('vi-VN')}</div>
                        </td>
                        <td className="py-4 px-6">
                          <div className="font-black text-primary tracking-tight">#{item.order_id}</div>
                          <div className="bg-surface-container-high px-2 py-0.5 rounded text-[10px] font-bold text-on-surface-variant inline-block mt-1">ERP: {item.erp_code}</div>
                        </td>
                        <td className="py-4 px-6 font-bold text-on-surface-variant text-center bg-surface-container-low/30">{item.old_qty !== null && item.old_qty !== undefined ? Number(item.old_qty).toLocaleString('en-US') : '-'}</td>
                        <td className="py-4 px-6 text-center">
                          <span className={`px-2 py-1 rounded-md text-[10px] font-black ${diff > 0 ? 'bg-emerald-100 text-emerald-700' : diff < 0 ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-600'}`}>
                            {diff > 0 ? `+${diff.toLocaleString('en-US')}` : diff.toLocaleString('en-US')}
                          </span>
                        </td>
                        <td className="py-4 px-6 font-black text-primary text-center bg-primary/5">{Number(item.new_qty).toLocaleString('en-US')}</td>
                        <td className="py-4 px-6">
                          <div className="flex items-start gap-2">
                             <span className="material-symbols-outlined text-sm text-outline-variant mt-0.5">chat_bubble</span>
                             <div className="text-on-surface font-medium text-xs italic line-clamp-2 max-w-[250px]" title={item.reason}>{item.reason}</div>
                          </div>
                          <div className="flex items-center gap-1.5 mt-2">
                             <div className="w-5 h-5 rounded-full bg-secondary/10 flex items-center justify-center text-secondary">
                                <span className="material-symbols-outlined text-[12px]">person</span>
                             </div>
                             <span className="text-[10px] font-black text-secondary uppercase tracking-wider">{item.edited_by}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={6} className="py-24 text-center">
                        <div className="flex flex-col items-center gap-4 opacity-40">
                          <span className="material-symbols-outlined text-6xl">history_toggle_off</span>
                          <p className="text-sm font-bold italic tracking-wide">Không có dữ liệu chỉnh sửa trong 30 ngày qua.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-8 py-6 bg-surface-container-low border-t border-outline-variant/10 flex justify-between items-center text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">
               <span>Tổng cộng {editHistory.length} lần điều chỉnh</span>
               <button 
                onClick={() => setShowEditHistory(false)}
                className="px-8 py-3 bg-primary text-on-primary rounded-xl font-bold text-xs shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
               >
                 Đóng cửa sổ
               </button>
            </div>
          </motion.div>
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
                  onClick={() => { navigator.clipboard.writeText(errorLog); alert('Đã copy!'); }}
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

export default Inbound;
