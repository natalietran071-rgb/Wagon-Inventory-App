import React, { useState, useMemo, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { supabase } from '../lib/supabase';
import { exportToExcelMultiSheet } from '../lib/excelUtils';
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

const Inventory = () => {
  const { t } = useLanguage();
  const { profile, user } = useAuth();
  const { locations } = useData();
  const location = useLocation();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'category' | 'location' | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [searchName, setSearchName] = useState('');
  const [movementType, setMovementType] = useState<'all' | 'inbound' | 'outbound' | 'movement'>('all');

  useEffect(() => {
    if (location.state?.scannedErp) {
      setSearchName(location.state.scannedErp);
    }
  }, [location.state?.scannedErp]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedLocation, setSelectedLocation] = useState('All');
  const [tableLocation, setTableLocation] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [items, setItems] = useState<any[]>([]);
  const [totalFilteredCount, setTotalFilteredCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isLowStockModalOpen, setIsLowStockModalOpen] = useState(false);

  // Select & bulk delete
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  // Periodic report filtering
  const [reportFromDate, setReportFromDate] = useState('');
  const [reportToDate, setReportToDate] = useState('');
  const [stats, setStats] = useState({
    tong_sku: 0,
    sku_co_nhap: 0,
    tong_nhap: 0,
    tong_xuat: 0,
    tong_ton: 0
  });

  const fetchStats = async () => {
    try {
      const activeLocation = tableLocation !== 'All' ? tableLocation : selectedLocation;
      const { data, error } = await supabase.rpc('get_inventory_stats_by_date', {
        p_from_date: reportFromDate || null,
        p_to_date: reportToDate || null,
        p_search: searchName || '',
        p_category: selectedCategory,
        p_location: activeLocation
      });
      if (error) throw error;
      if (data) {
        setStats(data);
      }
    } catch (error) {
      console.error('Lỗi khi tải thông số dashboard:', error);
    }
  };

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  const [filterProblem, setFilterProblem] = useState<'all' | 'negative' | 'missing' | 'critical' | 'duplicate'>('all');

  const fetchInventory = async () => {
    try {
      let data: any[] = [];
      let count = 0;

      if (reportFromDate && reportToDate) {
        // Use RPC for date-filtered items with movements
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_inventory_by_date', {
          p_from_date: reportFromDate,
          p_to_date: reportToDate,
          p_search: searchName,
          p_location: tableLocation === 'All' ? '' : tableLocation,
          p_limit: itemsPerPage,
          p_offset: (currentPage - 1) * itemsPerPage
        });
        
        if (rpcError) throw rpcError;
        data = rpcData || [];
        
        count = data.length === itemsPerPage ? currentPage * itemsPerPage + 1 : (currentPage - 1) * itemsPerPage + data.length;
      } else {
        // Regular query with pagination
        let query = supabase
          .from('inventory')
          .select('*', { count: 'exact' });
        
        if (searchName) {
          query = query.or(`erp.ilike.%${searchName}%,name.ilike.%${searchName}%,name_zh.ilike.%${searchName}%`);
        }
        
        if (selectedCategory !== 'All') {
          query = query.eq('category', selectedCategory);
        }
        
        if (filterProblem === 'negative') {
          query = query.lt('end_stock', 0);
        } else if (filterProblem === 'missing') {
          query = query.or('name.is.null,name.eq.""');
        } else if (filterProblem === 'critical') {
          query = query.eq('critical', true);
        } else if (filterProblem === 'duplicate') {
          // Fetch all ERPs and find duplicates client-side
          const PAGE = 1000;
          let allData: any[] = [];
          let pg = 0;
          let hasMore = true;
          while (hasMore) {
            const { data: chunk } = await supabase.from('inventory').select('*').order('erp').range(pg * PAGE, (pg + 1) * PAGE - 1);
            if (chunk && chunk.length > 0) { allData = allData.concat(chunk); hasMore = chunk.length === PAGE; pg++; } else { hasMore = false; }
          }
          const erpCount: Record<string, number> = {};
          allData.forEach((item: any) => { erpCount[item.erp] = (erpCount[item.erp] || 0) + 1; });
          const dupSet = new Set(Object.keys(erpCount).filter(k => erpCount[k] > 1));
          const filtered = allData.filter((item: any) => dupSet.has(item.erp)).sort((a: any, b: any) => a.erp.localeCompare(b.erp));
          setItems(filtered);
          setTotalFilteredCount(filtered.length);
          return;
        }

        if (tableLocation !== 'All') {
          query = query.like('pos', `${tableLocation}%`);
        } else if (selectedLocation !== 'All') {
          query = query.like('pos', `${selectedLocation}%`);
        }

        if (sortBy === 'newest') {
          query = query.order('created_at', { ascending: false });
        } else if (sortBy === 'name_asc') {
          query = query.order('name', { ascending: true });
        } else if (sortBy === 'stock_desc') {
          query = query.order('end_stock', { ascending: false });
        } else if (sortBy === 'stock_asc') {
          query = query.order('end_stock', { ascending: true });
        }

        const { data: qData, error: qError, count: qCount } = await query
          .range((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage - 1);
        
        if (qError) throw qError;
        data = qData || [];
        count = qCount || 0;
      }
      
      setItems(data);
      setTotalFilteredCount(count);
    } catch (err: any) {
      console.error('Error fetching inventory:', err);
      // alert('Lỗi khi tải dữ liệu tồn kho: ' + err.message); // removed alert to avoid multiple alerts on load
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([
        fetchInventory(),
        fetchStats()
      ]);
      setLoading(false);
    };
    loadData();
  }, [currentPage, searchName, selectedCategory, selectedLocation, tableLocation, sortBy, reportFromDate, reportToDate, filterProblem]);

  useEffect(() => {
    // Reset to page 1 on filter change
    setCurrentPage(1);
  }, [searchName, selectedCategory, selectedLocation, tableLocation, sortBy, reportFromDate, reportToDate, filterProblem]);

  useEffect(() => {
    // Subscribe to changes
    const subscription = supabase
      .channel('inventory_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => {
        fetchInventory();
        fetchStats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  // Modals state
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean, item: any | null, reason: string }>({ isOpen: false, item: null, reason: '' });
  const [showDeletedHistory, setShowDeletedHistory] = useState(false);
  const [selectedItemDetail, setSelectedItemDetail] = useState<any | null>(null);
  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean, erp: string, name: string }>({ isOpen: false, erp: '', name: '' });
  
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const [editDetailData, setEditDetailData] = useState<any | null>(null);
  const [showItemEditHistory, setShowItemEditHistory] = useState(false);
  const [itemEditHistory, setItemEditHistory] = useState<any[]>([]);

  const canAdmin = profile?.role === 'admin' || profile?.role === 'editor' || user?.email === 'natalietran071@gmail.com' || !profile;

  const handleSaveEditDetail = async () => {
    if (!editDetailData) return;
    
    const price = editDetailData.price === '' ? null : Number(editDetailData.price);
    const min_stock = editDetailData.min_stock === '' ? null : Number(editDetailData.min_stock);

    try {
      const { error } = await supabase
        .from('inventory')
        .update({
          name: editDetailData.name,
          name_zh: editDetailData.name_zh,
          spec: editDetailData.spec,
          category: editDetailData.category,
          unit: editDetailData.unit,
          pos: editDetailData.pos,
          price: price,
          min_stock: min_stock,
          critical: editDetailData.critical,
          updated_at: new Date().toISOString()
        })
        .eq('erp', editDetailData.erp);

      if (error) throw error;

      if (selectedItemDetail) {
        const original = selectedItemDetail;
        const changes = [];
        if (original.name !== editDetailData.name) changes.push({ field: 'Tên', old: original.name, new: editDetailData.name });
        if (original.name_zh !== editDetailData.name_zh) changes.push({ field: 'Tên (CN)', old: original.name_zh, new: editDetailData.name_zh });
        if (original.category !== editDetailData.category) changes.push({ field: 'Phân loại', old: original.category, new: editDetailData.category });
        if (original.unit !== editDetailData.unit) changes.push({ field: 'Đơn vị', old: original.unit, new: editDetailData.unit });
        if (original.spec !== editDetailData.spec) changes.push({ field: 'Quy cách', old: original.spec, new: editDetailData.spec });
        if (original.pos !== editDetailData.pos) changes.push({ field: 'Vị trí', old: original.pos, new: editDetailData.pos });
        if (Number(original.price || 0) !== Number(price || 0)) changes.push({ field: 'Đơn giá', old: original.price, new: price });
        if (Number(original.min_stock || 0) !== Number(min_stock || 0)) changes.push({ field: 'Tồn tối thiểu', old: original.min_stock, new: min_stock });
        if (Boolean(original.critical) !== Boolean(editDetailData.critical)) changes.push({ field: 'Critical Item', old: original.critical ? 'Có' : 'Không', new: editDetailData.critical ? 'Có' : 'Không' });
        
        if (changes.length > 0) {
           await supabase.from('edit_history_inventory').insert(changes.map(c => ({
             erp_code: editDetailData.erp,
             field_name: c.field,
             old_value: String(c.old === null || c.old === undefined ? '' : c.old),
             new_value: String(c.new === null || c.new === undefined ? '' : c.new),
             reason: editDetailData.editReason || 'Cập nhật thông tin vật tư',
             edited_by: profile?.full_name || profile?.email || user?.email || 'Unknown'
           })));
        }
      }

      setSelectedItemDetail({ ...selectedItemDetail, ...editDetailData, price, min_stock });
      setIsEditingDetail(false);
      alert('Cập nhật thành công!');
      fetchInventory();
    } catch (err: any) {
      alert('Lỗi cập nhật: ' + err.message);
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteModal.item) return;
    if (!deleteModal.reason.trim()) {
       alert('Vui lòng nhập lý do xóa!');
       return;
    }
    
    try {
      const { error: insertError } = await supabase.from('deleted_items').insert([{
        erp: deleteModal.item.erp,
        name: deleteModal.item.name,
        deleted_by: profile?.full_name || profile?.email || user?.email || 'Unknown',
        reason: deleteModal.reason
      }]);

      if (insertError) throw insertError;

      const { error: deleteError } = await supabase
        .from('inventory')
        .delete()
        .eq('id', deleteModal.item.id);
      
      if (deleteError) throw deleteError;

      setItems(items.filter(item => item.id !== deleteModal.item.id));
      alert('Đã xóa thành công!');
      fetchInventory();
    } catch (err: any) {
      alert('Lỗi khi xóa vật tư: ' + err.message);
    } finally {
      setDeleteModal({ isOpen: false, item: null, reason: '' });
    }
  };

  const handleClearFilters = () => {
    setSearchName('');
    setSelectedCategory('All');
    setSelectedLocation('All');
    setTableLocation('All');
    setSortBy('name_asc');
    setReportFromDate('');
    setReportToDate('');
    setShowClearConfirm(false);
  };

  const handleSelectRow = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedRows(paginatedItems.map(r => r.id));
    } else {
      setSelectedRows([]);
    }
  };

  const executeDeleteSelected = async () => {
    setShowDeleteSelectedConfirm(false);
    setLoading(true);
    try {
      const recordsToDelete = items.filter(r => selectedRows.includes(r.id));

      // Log to deleted_items
      const deletedLogs = recordsToDelete.map(item => ({
        erp: item.erp,
        name: item.name,
        deleted_by: profile?.full_name || profile?.email || user?.email || 'Unknown',
        reason: `Xóa hàng loạt ${selectedRows.length} item`
      }));
      if (deletedLogs.length > 0) {
        await supabase.from('deleted_items').insert(deletedLogs);
      }

      // Delete in chunks
      const chunkSize = 200;
      let deletedCount = 0;
      for (let i = 0; i < selectedRows.length; i += chunkSize) {
        const chunk = selectedRows.slice(i, i + chunkSize);
        const { error } = await supabase.from('inventory').delete().in('id', chunk);
        if (error) throw error;
        deletedCount += chunk.length;
      }
      alert(`Đã xóa ${deletedCount} item khỏi tồn kho.`);
      setSelectedRows([]);
      fetchInventory();
      fetchStats();
    } catch (err: any) {
      console.error(err);
      alert('Lỗi khi xóa: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const executeDeleteAll = async () => {
    setShowDeleteAllConfirm(false);
    setLoading(true);
    try {
      // Log
      await supabase.from('deleted_items').insert([{
        erp: 'ALL',
        name: `Xóa toàn bộ ${totalFilteredCount} item tồn kho`,
        deleted_by: profile?.full_name || profile?.email || user?.email || 'Unknown',
        reason: 'Admin xóa toàn bộ dữ liệu tồn kho'
      }]);

      // Delete all inventory
      const { error } = await supabase.from('inventory').delete().neq('erp', '');
      if (error) throw error;

      alert('Đã xóa toàn bộ dữ liệu tồn kho!');
      setSelectedRows([]);
      fetchInventory();
      fetchStats();
    } catch (err: any) {
      console.error(err);
      alert('Lỗi: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const categories = ['All', 'Nguyên liệu', 'Vật liệu', 'Phụ liệu', 'Công cụ']; // Or fetch from DB

  const totalPages = Math.ceil(totalFilteredCount / itemsPerPage) || 1;
  const paginatedItems = items;

  // Calculations for Dashboard Cards
  const [deletedItems, setDeletedItems] = useState<any[]>([]);

  useEffect(() => {
    if (showDeletedHistory) {
      fetchDeletedItems();
    }
  }, [showDeletedHistory]);

  const fetchDeletedItems = async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data } = await supabase
      .from('deleted_items')
      .select('*')
      .gte('deleted_at', thirtyDaysAgo.toISOString())
      .order('deleted_at', { ascending: false });
      
    if (data) setDeletedItems(data);
  };

  const exportDeletedItemsToExcel = () => {
    import('xlsx').then(XLSX => {
      const exportData = deletedItems.map(item => ({
        'Mã ERP': item.erp,
        'Tên Vật Tư': item.name,
        'Lý do xóa': item.reason,
        'Xóa bởi': item.deleted_by,
        'Thời gian xóa': new Date(item.deleted_at).toLocaleString()
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Deleted Items");
      XLSX.writeFile(wb, `Lich_Su_Xoa_Vat_Tu_${new Date().toISOString().split('T')[0]}.xlsx`);
    });
  };

  const totalSKUs = items.length;
  const newSKUsToday = useMemo(() => {
    return items.filter(i => {
      if (!i.created_at) return false;
      const itemDate = new Date(i.created_at).toDateString();
      const today = new Date().toDateString();
      return itemDate === today;
    }).length;
  }, [items]);

  const exportInventoryToExcel = async () => {
    setLoading(true);
    showToast('Đang xuất dữ liệu...');
    try {
      const today = new Date().toISOString().split('T')[0];
      let allData: any[] = [];

      if (reportFromDate && reportToDate) {
        // Use RPC for date-range view (same as fetchInventory)
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_inventory_by_date', {
          p_from_date: reportFromDate,
          p_to_date: reportToDate,
          p_search: searchName,
          p_location: tableLocation === 'All' ? '' : tableLocation,
          p_limit: 100000,
          p_offset: 0
        });
        if (rpcError) throw rpcError;
        allData = rpcData || [];
      } else {
        // Regular pagination with ALL active filters
        const PAGE = 1000;
        let page = 0;
        let hasMore = true;

        while (hasMore) {
          let query = supabase.from('inventory').select('*')
            .order('erp', { ascending: true })
            .range(page * PAGE, (page + 1) * PAGE - 1);

          if (searchName) {
            query = query.or(`erp.ilike.%${searchName}%,name.ilike.%${searchName}%,name_zh.ilike.%${searchName}%`);
          }
          if (selectedCategory !== 'All') {
            query = query.eq('category', selectedCategory);
          }
          const loc = tableLocation === 'All' ? (selectedLocation === 'All' ? '' : selectedLocation) : tableLocation;
          if (loc) {
            query = query.like('pos', `${loc}%`);
          }
          if (filterProblem === 'negative') {
            query = query.lt('end_stock', 0);
          } else if (filterProblem === 'missing') {
            query = query.or('name.is.null,name.eq.""');
          } else if (filterProblem === 'critical') {
            query = query.eq('critical', true);
          }

          const { data, error } = await query;
          if (error) throw error;
          if (data && data.length > 0) {
            allData = allData.concat(data);
            hasMore = data.length === PAGE;
            page++;
          } else {
            hasMore = false;
          }
        }

        // Duplicate filter is client-side only
        if (filterProblem === 'duplicate') {
          const erpCount: Record<string, number> = {};
          allData.forEach(item => { erpCount[item.erp] = (erpCount[item.erp] || 0) + 1; });
          allData = allData.filter(item => erpCount[item.erp] > 1);
        }

        // Aggregate in/out from records tables (same source as dashboard)
        const [inboundAgg, outboundAgg] = await Promise.all([
          supabase.from('inbound_records').select('erp_code, qty'),
          supabase.from('outbound_records').select('erp_code, qty').eq('status', 'Đã Xuất')
        ]);
        const inMap = new Map<string, number>();
        (inboundAgg.data || []).forEach((r: any) => inMap.set(r.erp_code, (inMap.get(r.erp_code) || 0) + Number(r.qty)));
        const outMap = new Map<string, number>();
        (outboundAgg.data || []).forEach((r: any) => outMap.set(r.erp_code, (outMap.get(r.erp_code) || 0) + Number(r.qty)));
        allData = allData.map(item => ({ ...item, _in_agg: inMap.get(item.erp) || 0, _out_agg: outMap.get(item.erp) || 0 }));
      }

      const exportData = allData.map((item: any, idx: number) => ({
        'Số TT': idx + 1,
        'Mã ERP': item.erp,
        'Tên Tiếng Việt': item.name,
        'Tên Tiếng Trung': item.name_zh || '',
        'Quy cách': item.spec || '',
        'Vị trí': item.pos || '',
        'ĐVT': item.unit || '',
        'Tồn tối thiểu': item.min_stock !== null ? item.min_stock : '',
        'Critical': item.critical ? 'Có' : 'Không',
        'Tồn đầu kỳ': item.start_stock || 0,
        'Nhập trong kỳ': item.in_period !== undefined ? (item.in_period || 0) : (item._in_agg ?? item.in_qty ?? 0),
        'Xuất trong kỳ': item.out_period !== undefined ? (item.out_period || 0) : (item._out_agg ?? item.out_qty ?? 0),
        'Tồn cuối kỳ': item.end_stock || 0
      }));

      const fileName = reportFromDate
        ? `ton-kho_${reportFromDate}_${reportToDate || today}.xlsx`
        : `ton-kho_${today}.xlsx`;

      const sheets = exportToExcelMultiSheet(exportData, fileName, 'Tồn Kho');
      showToast(`✅ Đã xuất ${exportData.length.toLocaleString()} dòng — ${sheets} sheet!`);
    } catch (err: any) {
      console.error('Export error:', err);
      showToast('Lỗi: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const lowStockItems = items.filter(i => i.critical && i.min_stock !== null && (i.end_stock || 0) < i.min_stock);

  const exportLowStockToExcel = () => {
    import('xlsx').then(XLSX => {
      const exportData = lowStockItems.map((item, idx) => ({
         'Số TT': idx + 1,
         'Mã ERP': item.erp,
         'Tên Cần Mua': item.name,
         'Tên Tiếng Trung': item.name_zh || '',
         'Quy cách': item.spec || '',
         'Vị trí': item.pos || '',
         'ĐVT': item.unit || '',
         'Tồn tối thiểu': item.min_stock !== null ? item.min_stock : 'N/A',
         'Tồn hiện tại': item.end_stock || 0,
         'Cảnh báo': item.critical ? '⚠️ Vật tư quan trọng (Critical)' : 'Thấp hơn định mức tối thiểu'
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bao_Cao_Xin_Mua");
      XLSX.writeFile(wb, `Bao_Cao_Xin_Mua_${new Date().toISOString().split('T')[0]}.xlsx`);
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-on-surface tracking-tight mb-2">{t('inventory')}</h1>
          <p className="text-on-surface-variant font-medium">Theo dõi và quản lý vật tư trong thời gian thực.</p>
        </div>
        <div className="flex flex-wrap gap-2 md:gap-3 w-full xl:w-auto mt-2 md:mt-0">
          <button 
            onClick={() => setShowDeletedHistory(true)}
            className="flex-1 md:flex-none px-4 md:px-6 py-2 md:py-3 rounded-xl font-bold flex items-center justify-center gap-2 bg-error-container text-on-error-container hover:bg-error/20 transition-all font-mono text-xs md:text-sm"
          >
            <span className="material-symbols-outlined text-lg">delete_history</span>
            Lịch sử Hủy
          </button>
          <button 
            onClick={fetchInventory}
            disabled={loading}
            className="flex-1 md:flex-none px-4 md:px-6 py-2 md:py-3 rounded-xl font-bold flex items-center justify-center gap-2 bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest transition-all disabled:opacity-50 text-xs md:text-sm"
          >
            <span className={`material-symbols-outlined text-lg ${loading ? 'animate-spin' : ''}`}>sync</span>
            Đồng bộ
          </button>
          <button 
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`flex-1 md:flex-none px-4 md:px-6 py-2 md:py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all text-xs md:text-sm ${isFilterOpen ? 'bg-primary text-on-primary shadow-lg shadow-primary/20' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'}`}
          >
            <span className="material-symbols-outlined text-lg">{isFilterOpen ? 'filter_list_off' : 'filter_list'}</span>
            Bộ lọc
          </button>
          <button 
            onClick={exportInventoryToExcel}
            disabled={loading}
            className="flex-1 md:flex-none bg-surface-container-high text-on-surface-variant px-4 md:px-6 py-2 md:py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-surface-container-highest transition-all text-xs md:text-sm disabled:opacity-50">
            <span className="material-symbols-outlined text-lg">{loading ? 'sync' : 'download'}</span>
            {loading ? 'Đang xuất...' : 'Xuất Excel'}
          </button>
          {canAdmin && selectedRows.length > 0 && (
            <button 
              onClick={() => setShowDeleteSelectedConfirm(true)}
              className="flex-1 md:flex-none bg-error text-on-error px-4 md:px-6 py-2 md:py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all text-xs md:text-sm shadow-lg shadow-error/20"
            >
              <span className="material-symbols-outlined text-lg">delete</span>
              Xóa ({selectedRows.length})
            </button>
          )}
          {canAdmin && (
            <button 
              onClick={() => setShowDeleteAllConfirm(true)}
              className="flex-1 md:flex-none bg-error-container text-on-error-container px-4 md:px-6 py-2 md:py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-error/20 transition-all text-xs md:text-sm"
            >
              <span className="material-symbols-outlined text-lg">delete_sweep</span>
              Xóa toàn bộ
            </button>
          )}
        </div>
      </div>

      {/* ALWAYS VISIBLE SEARCH BAR */}
      <div className="bg-surface-container-low p-3 md:p-4 rounded-2xl md:rounded-3xl border border-outline-variant/10 flex items-center gap-3 md:gap-4 relative shadow-sm">
        <span className="material-symbols-outlined text-primary ml-1 md:ml-2 text-xl md:text-2xl">search</span>
        <input 
          type="text" 
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          onKeyDown={(e) => {
             if (e.key === 'Enter') {
                // Since useEffect handles search dynamically, this is just for UX/safety
                setCurrentPage(1);
             }
          }}
          placeholder="Tìm kiếm..."
          className="w-full bg-transparent border-none text-base md:text-lg font-medium focus:ring-0 placeholder:text-on-surface-variant/40 p-0"
          autoFocus
        />
        {searchName && (
          <button onClick={() => setSearchName('')} className="p-1 md:p-2 text-outline-variant hover:text-error transition-colors rounded-full hover:bg-surface-container-high flex items-center justify-center">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        )}
      </div>
      
      <div className="flex flex-wrap gap-2 items-center px-1 md:px-2">
        <div className="text-[10px] md:text-sm font-bold text-on-surface-variant mr-1 md:mr-2">Cảnh báo:</div>
        <button
          onClick={() => setFilterProblem('all')}
          className={`px-3 md:px-4 py-1 md:py-1.5 rounded-full text-[10px] md:text-xs font-bold transition-all ${filterProblem === 'all' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
        >
          Tất cả
        </button>
        <button
          onClick={() => setFilterProblem('negative')}
          className={`px-3 md:px-4 py-1 md:py-1.5 rounded-full text-[10px] md:text-xs font-bold transition-all flex items-center gap-1 ${filterProblem === 'negative' ? 'bg-error text-on-error' : 'bg-error-container/30 text-error hover:bg-error-container'}`}
        >
          <span className="material-symbols-outlined text-[12px] md:text-[14px]">warning</span>
          Tồn âm
        </button>
        <button
          onClick={() => setFilterProblem('missing')}
          className={`px-3 md:px-4 py-1 md:py-1.5 rounded-full text-[10px] md:text-xs font-bold transition-all flex items-center gap-1 ${filterProblem === 'missing' ? 'bg-amber-500 text-white' : 'bg-amber-500/10 text-amber-700 hover:bg-amber-500/20'}`}
        >
          <span className="material-symbols-outlined text-[12px] md:text-[14px]">info</span>
          Thiếu TT
        </button>
        <button
          onClick={() => setFilterProblem('critical')}
          className={`px-3 md:px-4 py-1 md:py-1.5 rounded-full text-[10px] md:text-xs font-bold transition-all flex items-center gap-1 ${filterProblem === 'critical' ? 'bg-emerald-500 text-white' : 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20'}`}
        >
          <span className="material-symbols-outlined text-[12px] md:text-[14px]">star</span>
          ⭐ Critical
        </button>
        <button
          onClick={() => setFilterProblem('duplicate')}
          className={`px-3 md:px-4 py-1 md:py-1.5 rounded-full text-[10px] md:text-xs font-bold transition-all flex items-center gap-1 ${filterProblem === 'duplicate' ? 'bg-violet-500 text-white' : 'bg-violet-500/10 text-violet-700 hover:bg-violet-500/20'}`}
        >
          <span className="material-symbols-outlined text-[12px] md:text-[14px]">content_copy</span>
          Trùng ERP
        </button>
      </div>

      <AnimatePresence>
        {isFilterOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="bg-surface-container-low p-8 rounded-[2rem] border border-outline-variant/10 grid grid-cols-1 md:grid-cols-2 gap-6 relative" style={{ zIndex: 40 }}>
              <div className="space-y-2 relative">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest px-1">Phân loại (Category)</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenDropdown(openDropdown === 'category' ? null : 'category')}
                    className="w-full bg-surface-container-lowest border-none rounded-xl py-3 px-4 text-sm font-medium focus:ring-2 focus:ring-primary/20 flex justify-between items-center text-on-surface"
                  >
                    <span>{selectedCategory === 'All' ? 'Tất cả phân loại' : selectedCategory}</span>
                    <span className={`material-symbols-outlined text-[20px] transition-transform ${openDropdown === 'category' ? 'rotate-180' : ''}`}>expand_more</span>
                  </button>
                  <AnimatePresence>
                    {openDropdown === 'category' && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 w-full mt-2 bg-surface-container-highest border border-outline-variant/10 rounded-xl shadow-lg max-h-60 overflow-hidden flex flex-col pointer-events-auto"
                      >
                       <div className="overflow-y-auto w-full max-h-60 custom-scrollbar">
                        {categories.map(cat => (
                          <button
                            key={cat}
                            className={`w-full text-left px-4 py-3 text-sm font-medium transition-colors hover:bg-surface-container-low ${selectedCategory === cat ? 'bg-primary-container/20 text-primary' : 'text-on-surface'}`}
                            onClick={() => { setSelectedCategory(cat); setOpenDropdown(null); }}
                          >
                            {cat === 'All' ? 'Tất cả phân loại' : cat}
                          </button>
                        ))}
                       </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div className="space-y-2 relative">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest px-1">Khu vực (Zone)</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenDropdown(openDropdown === 'location' ? null : 'location')}
                    className="w-full bg-surface-container-lowest border-none rounded-xl py-3 px-4 text-sm font-medium focus:ring-2 focus:ring-primary/20 flex justify-between items-center text-on-surface"
                  >
                    <span>{selectedLocation === 'All' ? 'Tất cả khu vực' : `Khu vực ${selectedLocation}`}</span>
                    <span className={`material-symbols-outlined text-[20px] transition-transform ${openDropdown === 'location' ? 'rotate-180' : ''}`}>expand_more</span>
                  </button>
                  <AnimatePresence>
                    {openDropdown === 'location' && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 w-full mt-2 bg-surface-container-highest border border-outline-variant/10 rounded-xl shadow-lg max-h-60 overflow-hidden flex flex-col pointer-events-auto"
                      >
                       <div className="overflow-y-auto w-full max-h-60 custom-scrollbar">
                        {locations.map(loc => (
                          <button
                            key={loc}
                            className={`w-full text-left px-4 py-3 text-sm font-medium transition-colors hover:bg-surface-container-low ${selectedLocation === loc ? 'bg-primary-container/20 text-primary' : 'text-on-surface'}`}
                            onClick={() => { setSelectedLocation(loc); setOpenDropdown(null); }}
                          >
                            {loc === 'All' ? 'Tất cả khu vực' : `Khu vực ${loc}`}
                          </button>
                        ))}
                       </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div className="md:col-span-2 flex justify-end gap-3 pt-2">
                <button 
                  onClick={() => setShowClearConfirm(true)}
                  className="text-xs font-bold text-on-surface-variant hover:text-error transition-colors"
                >
                  Xóa tất cả bộ lọc
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowClearConfirm(false)}
              className="absolute inset-0 bg-on-surface/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-surface-container-lowest p-8 rounded-[2rem] shadow-2xl max-w-sm w-full border border-outline-variant/10"
            >
              <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-6">
                <span className="material-symbols-outlined text-3xl">filter_alt_off</span>
              </div>
              <h3 className="text-xl font-black text-on-surface mb-2">Xác nhận xóa bộ lọc?</h3>
              <p className="text-on-surface-variant text-sm mb-8 leading-relaxed">
                Hành động này sẽ xóa toàn bộ các tiêu chí tìm kiếm và lọc hiện tại. Bạn có chắc chắn muốn tiếp tục?
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-3 px-4 rounded-xl font-bold text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
                >
                  {t('cancel')}
                </button>
                <button 
                  onClick={handleClearFilters}
                  className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-error text-on-error shadow-lg shadow-error/20 hover:opacity-90 transition-opacity"
                >
                  {t('confirm')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-12 gap-4 md:gap-6">
        <div className="col-span-12 sm:col-span-6 md:col-span-2 technical-card p-4 md:p-6 flex flex-col justify-between h-36 md:h-48 relative group">
          <div className="flex justify-between items-start">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-primary/10 rounded-xl md:rounded-2xl flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-xl md:text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>category</span>
            </div>
          </div>
          <div>
            <p className="text-on-surface-variant text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-0.5 md:mb-1 opacity-60">Tổng Mã Hàng (SKU)</p>
            <h3 className="text-2xl md:text-3xl font-extrabold text-on-surface data-value">{(stats.tong_sku || 0).toLocaleString()}</h3>
          </div>
          <div className="absolute -right-2 -bottom-2 md:-right-4 md:-bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <span className="material-symbols-outlined text-[5rem] md:text-[8rem]">inventory_2</span>
          </div>
        </div>

        <div className="col-span-12 md:col-span-8 technical-card border-none bg-gradient-to-br from-surface-container-low to-surface-container overflow-hidden p-0 h-auto md:h-48 relative group shadow-sm flex flex-col justify-between">
            <div className="px-4 md:px-6 py-2 md:py-4 border-b border-outline-variant/10 flex justify-between items-center bg-white/5 backdrop-blur-md z-10 w-full relative">
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-lg md:text-xl">monitoring</span>
                    <span className="text-[10px] md:text-xs font-bold text-on-surface uppercase tracking-widest opacity-80">Thông kê lưu lượng</span>
                </div>
                {(reportFromDate || reportToDate) && <span className="text-[9px] md:text-[10px] font-black tracking-widest text-primary px-2 py-0.5 bg-primary/10 rounded-full">Kỳ Báo Cáo</span>}
            </div>
            <div className="grid grid-cols-2 md:flex md:justify-between items-center px-4 md:px-6 py-4 md:py-6 gap-y-4 md:gap-y-6 h-full z-10 relative text-center md:text-left">
                <div className="flex-1 md:border-r border-outline-variant/20 px-2 lg:px-6">
                   <p className="text-on-surface-variant text-[9px] lg:text-[11px] font-black uppercase tracking-widest mb-1 md:mb-2 opacity-80 flex items-center justify-center md:justify-start gap-1 leading-tight"><span className="material-symbols-outlined text-[14px] md:text-[16px]">category</span> SKU CO NHAP</p>
                   <h3 className="text-xl lg:text-3xl font-extrabold text-on-surface data-value">{(stats.sku_co_nhap || 0).toLocaleString()}</h3>
                </div>
                <div className="flex-1 md:border-r border-outline-variant/20 px-2 lg:px-6 border-l md:border-l-0">
                   <p className="text-on-surface-variant text-[9px] lg:text-[11px] font-black uppercase tracking-widest mb-1 md:mb-2 opacity-80 flex items-center justify-center md:justify-start gap-1 leading-tight"><span className="material-symbols-outlined text-[14px] md:text-[16px]">login</span> TỔNG NHẬP</p>
                   <h3 className="text-xl lg:text-3xl font-extrabold text-on-surface data-value">{(stats.tong_nhap || 0).toLocaleString()}</h3>
                </div>
                <div className="flex-1 md:border-r border-outline-variant/20 px-2 lg:px-6 border-t md:border-t-0">
                   <p className="text-on-surface-variant text-[9px] lg:text-[11px] font-black uppercase tracking-widest mb-1 md:mb-2 opacity-80 flex items-center justify-center md:justify-start gap-1 leading-tight"><span className="material-symbols-outlined text-[14px] md:text-[16px]">logout</span> TỔNG XUẤT</p>
                   <h3 className="text-xl lg:text-3xl font-extrabold text-on-surface data-value">{(stats.tong_xuat || 0).toLocaleString()}</h3>
                </div>
                <div className="flex-1 px-2 lg:px-6 border-l md:border-l-0 border-t md:border-t-0">
                   <p className="text-on-surface-variant text-[9px] lg:text-[11px] font-black uppercase tracking-widest mb-1 md:mb-2 opacity-80 flex items-center justify-center md:justify-start gap-1 leading-tight"><span className="material-symbols-outlined text-[14px] md:text-[16px]">inventory</span> TỒN KHO</p>
                   <h3 className="text-xl lg:text-3xl font-extrabold text-primary data-value">{Number(stats.tong_ton || 0).toLocaleString()}</h3>
                </div>
            </div>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-[0.02] md:opacity-[0.03] group-hover:opacity-5 transition-opacity pointer-events-none">
              <span className="material-symbols-outlined text-[10rem] md:text-[12rem] text-primary">data_usage</span>
            </div>
        </div>

        <div className="col-span-12 sm:col-span-6 md:col-span-2 bg-error-container/10 border border-error/20 p-4 md:p-6 rounded-2xl md:rounded-[2rem] flex flex-col justify-between h-36 md:h-48 relative overflow-hidden group shadow-sm transition-all hover:bg-error-container/20 cursor-pointer" onClick={() => setIsLowStockModalOpen(true)}>
          <div className="flex justify-between items-start">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-error-container flex items-center justify-center text-on-error-container rounded-xl md:rounded-2xl">
              <span className="material-symbols-outlined text-xl md:text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
            </div>
            <span className="material-symbols-outlined text-error opacity-50 group-hover:opacity-100 transition-opacity">open_in_new</span>
          </div>
          <div>
            <p className="text-on-error-container text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-0.5 md:mb-1 opacity-60">Cần mua ngay</p>
            <h3 className="text-2xl md:text-3xl font-extrabold text-on-error-container data-value">{lowStockItems.length} <span className="text-xs md:text-sm font-medium opacity-70">Mã</span></h3>
          </div>
          <div className="absolute -right-2 -bottom-2 md:-right-4 md:-bottom-4 opacity-10 group-hover:opacity-20 transition-opacity text-error">
            <span className="material-symbols-outlined text-[5rem] md:text-[8rem]">emergency_home</span>
          </div>
        </div>
      </div>

      <div className="technical-card">
        <div className="px-4 md:px-8 py-4 md:py-6 flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-surface-container">
          <div className="flex flex-wrap gap-2 md:gap-4 w-full xl:w-auto">
            <select 
              value={tableLocation}
              onChange={(e) => setTableLocation(e.target.value)}
              className="bg-surface-container-low border-none rounded-xl text-[10px] md:text-xs font-bold px-3 md:px-4 py-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="All">Tất cả Vị Trí</option>
              {locations.filter(l => l !== 'All').map(loc => (
                <option key={loc} value={loc}>Khu vực {loc}</option>
              ))}
            </select>
            <select 
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-surface-container-low border-none rounded-xl text-[10px] md:text-xs font-bold px-3 md:px-4 py-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="newest">Sắp xếp: Mới nhất</option>
              <option value="name_asc">Sắp xếp: Tên A-Z</option>
              <option value="stock_desc">Sắp xếp: Tồn Cuối (Giảm)</option>
              <option value="stock_asc">Sắp xếp: Tồn Cuối (Tăng)</option>
            </select>
            
            <div className="flex items-center gap-1.5 md:gap-2 bg-surface-container-low rounded-xl px-2 border border-outline-variant/10 focus-within:border-primary/50 transition-colors">
               <span className="material-symbols-outlined text-sm text-primary pl-1">calendar_month</span>
               <input 
                  type="date"
                  value={reportFromDate}
                  onChange={e => setReportFromDate(e.target.value)}
                  className="bg-transparent border-none text-[10px] md:text-xs font-bold px-1 md:px-2 py-2 outline-none w-24 md:w-32"
               />
               <span className="text-[10px] md:text-xs font-bold text-on-surface-variant">đến</span>
               <input 
                  type="date"
                  value={reportToDate}
                  onChange={e => setReportToDate(e.target.value)}
                  className="bg-transparent border-none text-[10px] md:text-xs font-bold px-1 md:px-2 py-2 outline-none w-24 md:w-32"
               />
               {(reportFromDate || reportToDate) && (
                  <button onClick={() => { setReportFromDate(''); setReportToDate(''); }} className="p-1 hover:bg-error/10 text-error rounded-lg flex items-center justify-center transition-colors">
                     <span className="material-symbols-outlined text-xs md:text-sm">close</span>
                  </button>
               )}
            </div>
            {(reportFromDate && reportToDate) && (
              <select 
                value={movementType}
                onChange={(e: any) => setMovementType(e.target.value)}
                className="bg-primary/5 text-primary border-none rounded-xl text-[10px] md:text-xs font-bold px-3 md:px-4 py-2 focus:ring-primary/20 cursor-pointer"
              >
                <option value="all">Tất cả biến động</option>
                <option value="inbound">Chỉ hàng nhập</option>
                <option value="outbound">Chỉ hàng xuất</option>
                <option value="movement">Mã có phát sinh</option>
              </select>
            )}
          </div>
          <div className="hidden md:flex items-center gap-2 text-on-surface-variant text-[10px] font-bold uppercase tracking-widest opacity-60">
            <span className="material-symbols-outlined text-sm">history</span>
            {t('lastUpdate')}: {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
          </div>
        </div>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/50">
                {canAdmin && (
                  <th className="py-4 px-2 w-8">
                    <input 
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                      onChange={handleSelectAll}
                      checked={paginatedItems.length > 0 && selectedRows.length === paginatedItems.length}
                    />
                  </th>
                )}
                <th className="col-header py-4 px-4 hidden md:table-cell font-black text-[10px]">{t('erpCode')}</th>
                <th className="col-header py-4 px-3 font-black text-[10px]">{t('itemName')}</th>
                <th className="col-header py-4 px-3 hidden md:table-cell font-black text-[10px]">Tên Tiếng Trung</th>
                <th className="col-header py-4 px-3 hidden xl:table-cell font-black text-[10px]">{t('spec')}</th>
                <th className="col-header py-4 px-3 text-center hidden md:table-cell font-black text-[10px]">{t('unit')}</th>
                <th className="col-header py-4 px-3 font-black text-[10px] md:hidden lg:table-cell">{t('location')}</th>
                <th className="col-header py-4 px-3 text-right hidden xl:table-cell font-black text-[10px]">Tồn tối thiểu</th>
                <th className="col-header py-4 px-3 text-right hidden lg:table-cell font-black text-[10px]">{t('startStock')}</th>
                <th className="col-header py-4 px-3 text-right hidden lg:table-cell font-black text-[10px]">{t('inQty')}</th>
                <th className="col-header py-4 px-3 text-right hidden lg:table-cell font-black text-[10px]">{t('outQty')}</th>
                <th className="col-header py-4 px-4 text-right font-black text-[10px]">{t('endStock')}</th>
                {canAdmin && <th className="col-header py-4 px-3 text-right hidden lg:table-cell font-black text-[10px]">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y-0">
              {paginatedItems.map((item, idx) => {
                const isCritical = item.critical && item.min_stock !== null && (item.end_stock || 0) < item.min_stock;
                
                const itemData = {
                   start: item.start_stock || 0,
                   in: (reportFromDate && reportToDate) ? item.in_period : (item.in_qty || 0),
                   out: (reportFromDate && reportToDate) ? item.out_period : (item.out_qty || 0),
                   end: item.end_stock || 0
                };

                return (
                  <tr key={`${item.erp}-${idx}`} onClick={() => setSelectedItemDetail(item)} className={`group hover:bg-on-surface hover:text-surface transition-all cursor-pointer border-b border-outline-variant/10 ${isCritical ? 'bg-error-container/5' : ''} ${selectedRows.includes(item.id) ? 'bg-primary-container/20' : ''}`}>
                    {canAdmin && (
                      <td className="px-2 py-3 w-8" onClick={e => e.stopPropagation()}>
                        <input 
                          type="checkbox"
                          className="w-3.5 h-3.5 rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                          checked={selectedRows.includes(item.id)}
                          onChange={() => handleSelectRow(item.id)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setHistoryModal({ isOpen: true, erp: item.erp, name: item.name });
                        }}
                        className="bg-surface-container-high group-hover:bg-white/10 px-2 py-1 rounded text-[9px] font-black data-value hover:text-primary transition-colors cursor-pointer"
                        title="Xem lịch sử nhập xuất"
                      >
                        {item.erp}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-bold text-[13px] leading-tight">
                        {item.name ? item.name : <span className="text-amber-500 italic flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">warning</span> Thiếu thông tin</span>}
                      </div>
                      <div className={`text-[9px] font-medium mt-0.5 truncate max-w-[120px] md:max-w-none ${isCritical || itemData.end < 0 ? 'text-error group-hover:text-error-container flex items-center gap-1' : 'text-on-surface-variant group-hover:text-surface/60'}`}>
                        {(isCritical || itemData.end < 0) && <span className="material-symbols-outlined text-[10px]">error</span>}
                        {item.description || item.category || 'N/A'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs font-medium opacity-70 hidden md:table-cell">{item.name_zh || '-'}</td>
                    <td className="px-3 py-3 text-xs font-medium opacity-70 hidden xl:table-cell">{item.spec || '-'}</td>
                    <td className="px-3 py-3 text-center hidden md:table-cell">
                      <span className={`text-[9px] font-black uppercase tracking-wider ${item.unit === 'Tấm' || item.unit === 'Thùng' || item.unit === 'Box' ? 'bg-secondary-container text-on-secondary-container' : 'bg-primary-container text-on-primary-container'} px-1.5 py-0.5 rounded-full`}>
                        {item.unit}
                      </span>
                    </td>
                    <td className="px-3 py-3 md:hidden lg:table-cell">
                      <div className="flex items-center gap-1.5 text-[11px] font-black data-value">
                        <span className={`w-1.5 h-1.5 rounded-full ${isCritical ? 'bg-error' : 'bg-primary'} hidden md:block`}></span>
                        {item.pos || '-'}
                      </div>
                    </td>
                    <td className={`px-3 py-3 text-right font-bold text-[11px] data-value hidden xl:table-cell ${item.min_stock !== null && item.min_stock !== undefined ? 'text-surface-variant' : 'opacity-20'}`}>{(item.min_stock !== null && item.min_stock !== undefined) ? item.min_stock.toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-right font-bold text-[11px] data-value hidden xl:table-cell text-surface-variant/40">{(itemData.start || 0).toLocaleString('en-US')}</td>
                    <td className="px-3 py-3 text-right font-bold text-[11px] data-value text-primary group-hover:text-primary-container hidden lg:table-cell">{itemData.in > 0 ? `+${(itemData.in || 0).toLocaleString('en-US')}` : (itemData.in || 0).toLocaleString('en-US')}</td>
                    <td className="px-3 py-3 text-right font-bold text-[11px] data-value text-secondary group-hover:text-secondary-container hidden lg:table-cell">{(itemData.out || 0).toLocaleString('en-US')}</td>
                    <td className={`px-4 py-3 text-right font-black text-sm data-value ${(isCritical || itemData.end < 0) ? 'text-error group-hover:text-error-container' : 'text-primary group-hover:text-primary-container'}`}>
                      {itemData.end < 0 ? (
                        <span className="flex items-center justify-end gap-1" title="Tồn kho bị âm"><span className="material-symbols-outlined text-[12px]">warning</span> {(itemData.end || 0).toLocaleString('en-US')}</span>
                      ) : (
                        (itemData.end || 0).toLocaleString('en-US')
                      )}
                    </td>
                    {canAdmin && (
                      <td className="px-3 py-3 text-right hidden lg:table-cell">
                        <div className="flex items-center justify-end gap-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setHistoryModal({ isOpen: true, erp: item.erp, name: item.name });
                            }}
                            className="text-primary hover:bg-primary/10 p-1.5 rounded-lg transition-colors"
                            title="Lịch sử"
                          >
                            <span className="material-symbols-outlined text-sm">history</span>
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteModal({ isOpen: true, item, reason: '' });
                            }}
                            className="text-error hover:bg-error/10 p-1.5 rounded-lg transition-colors"
                            title="Xóa"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {paginatedItems.length === 0 && (
                <tr key="empty-inventory">
                  <td colSpan={canAdmin ? 13 : 11} className="px-8 py-12 text-center text-on-surface-variant font-medium">
                    Không tìm thấy vật tư phù hợp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 md:px-8 py-4 md:py-6 border-t border-surface-container flex flex-col sm:flex-row justify-between items-center bg-surface-container-low/30 gap-4">
          <p className="text-[10px] md:text-sm font-medium text-on-surface-variant text-center sm:text-left">
            Hiển thị <span className="font-bold text-on-surface">{totalFilteredCount > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} - {Math.min(currentPage * itemsPerPage, totalFilteredCount)}</span> / {totalFilteredCount}
          </p>
          <div className="flex gap-1 md:gap-2">
            <button 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-lg md:rounded-xl bg-surface-container-lowest border border-outline-variant/10 text-on-surface shadow-sm hover:bg-surface-container-low transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-lg">chevron_left</span>
            </button>
            <div className="flex items-center px-2 md:px-4 font-bold text-xs md:text-sm whitespace-nowrap">
              Trang {currentPage} / {totalPages}
            </div>
            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-lg md:rounded-xl bg-surface-container-lowest border border-outline-variant/10 text-on-surface shadow-sm hover:bg-surface-container-low transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-lg">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Delete Item Modal */}
      <AnimatePresence>
        {deleteModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-md overflow-hidden relative"
            >
              <div className="h-2 bg-error"></div>
              <div className="p-8">
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center text-error shrink-0">
                    <span className="material-symbols-outlined text-2xl">warning</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold font-manrope text-on-surface mb-2">Xóa vật tư</h3>
                    <p className="text-sm border border-outline-variant/20 rounded p-2 bg-surface-container-low font-mono font-bold text-primary inline-block mb-3">
                      {deleteModal.item?.erp}
                    </p>
                    <p className="text-sm font-medium text-on-surface-variant mb-6">
                      Bạn có chắc chắn muốn xóa <span className="font-bold text-on-surface">{deleteModal.item?.name}</span> khỏi hệ thống không? Tác vụ này sẽ được ghi log lại.
                    </p>

                    <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2 block">Lý do xóa <span className="text-error">*</span></label>
                    <textarea 
                      className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-error focus:border-error transition-all outline-none"
                      placeholder="Nhập lý do xóa (Bắt buộc)... VD: Sai quy cách, Lỗi nhập liệu..."
                      rows={3}
                      value={deleteModal.reason}
                      onChange={e => setDeleteModal(m => ({ ...m, reason: e.target.value }))}
                      autoFocus
                    ></textarea>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button 
                    onClick={() => setDeleteModal({ isOpen: false, item: null, reason: '' })}
                    className="px-6 py-2.5 font-bold text-on-surface-variant hover:bg-surface-container-low rounded-xl transition-colors text-sm"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={handleDeleteItem}
                    className="px-6 py-2.5 bg-error text-on-error font-bold rounded-xl shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all text-sm flex items-center gap-2"
                  >
                    Xóa vật tư
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Deleted Items History Modal */}
      <AnimatePresence>
        {showDeletedHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden relative"
            >
              <div className="px-8 py-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-error-container text-on-error-container flex items-center justify-center">
                    <span className="material-symbols-outlined">delete_history</span>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold font-manrope text-on-surface">Lịch sử Báo Hủy (30 ngày)</h3>
                    <p className="text-sm font-medium text-on-surface-variant">Danh sách các vật tư đã bị xóa khỏi hệ thống.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={exportDeletedItemsToExcel}
                    className="px-4 py-2 font-bold text-on-surface bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors text-sm flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">download</span>
                    Export Excel
                  </button>
                  <button 
                    onClick={() => setShowDeletedHistory(false)}
                    className="w-10 h-10 rounded-full hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>
              
              <div className="p-0 overflow-y-auto bg-surface-container-lowest">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low sticky top-0">
                    <tr className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                      <th className="py-4 px-6 border-b border-outline-variant/20">Thời gian xóa</th>
                      <th className="py-4 px-6 border-b border-outline-variant/20">Mã ERP</th>
                      <th className="py-4 px-6 border-b border-outline-variant/20">Tên Vật Tư</th>
                      <th className="py-4 px-6 border-b border-outline-variant/20">Lý do</th>
                      <th className="py-4 px-6 border-b border-outline-variant/20">Người xóa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10 text-sm">
                    {deletedItems.length > 0 ? deletedItems.map((item, idx) => (
                      <tr key={`${item.id || 'del'}-${idx}`} className="hover:bg-surface-container-low/50">
                        <td className="py-4 px-6 text-on-surface-variant">{item.deleted_at ? new Date(item.deleted_at).toLocaleString() : 'N/A'}</td>
                        <td className="py-4 px-6 font-bold text-error">{item.erp}</td>
                        <td className="py-4 px-6 font-medium">{item.name}</td>
                        <td className="py-4 px-6 text-on-surface-variant italic max-w-xs truncate" title={item.reason}>{item.reason}</td>
                        <td className="py-4 px-6 font-medium">{item.deleted_by}</td>
                      </tr>
                    )) : (
                      <tr key="empty-deleted">
                        <td colSpan={5} className="py-12 text-center text-on-surface-variant italic">Không có dữ liệu xóa nào trong 30 ngày qua.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Item Detail Modal */}
      <AnimatePresence>
        {selectedItemDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm" onClick={() => setSelectedItemDetail(null)}>
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden relative border border-outline-variant/10"
            >
              <div className="bg-surface-container-low p-6 flex items-center justify-between border-b border-outline-variant/10">
                <div className="flex gap-4 items-center">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                    <span className="material-symbols-outlined text-2xl">inventory_2</span>
                  </div>
                  <div>
                    {isEditingDetail ? (
                       <input 
                         type="text" 
                         value={editDetailData?.name || ''} 
                         onChange={e => setEditDetailData({...editDetailData, name: e.target.value})}
                         className="text-xl font-bold font-manrope bg-transparent border-b border-primary outline-none focus:ring-0 px-0 py-1 w-full"
                       />
                    ) : (
                       <h3 className="text-xl font-bold font-manrope">{selectedItemDetail.name}</h3>
                    )}
                    <p className="text-sm font-mono text-on-surface-variant">{selectedItemDetail.erp}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {canAdmin && (
                     isEditingDetail ? (
                        <button onClick={handleSaveEditDetail} className="px-4 py-2 bg-primary text-on-primary rounded-lg font-bold text-sm hover:shadow-md transition-all">Lưu</button>
                     ) : (
                        <>
                          <button onClick={() => {
                             setEditDetailData({ ...selectedItemDetail });
                             setIsEditingDetail(true);
                          }} className="px-3 md:px-4 py-2 bg-surface-container-highest text-on-surface rounded-lg font-bold text-sm hover:bg-outline-variant/20 transition-all flex items-center gap-1">
                             <span className="material-symbols-outlined text-[16px]">edit</span> <span className="hidden md:inline">Sửa</span>
                          </button>
                          <button onClick={() => {
                             setSelectedItemDetail(null);
                             setDeleteModal({ isOpen: true, item: selectedItemDetail, reason: '' });
                          }} className="px-3 md:px-4 py-2 bg-error-container text-on-error-container rounded-lg font-bold text-sm hover:bg-error/20 transition-all flex items-center gap-1">
                             <span className="material-symbols-outlined text-[16px]">delete</span> <span className="hidden md:inline">Xóa</span>
                          </button>
                        </>
                     )
                  )}
                  <button 
                    onClick={() => { setSelectedItemDetail(null); setIsEditingDetail(false); }}
                    className="w-10 h-10 rounded-full hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>
              <div className="p-8 space-y-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="bg-surface-container-low p-4 rounded-xl">
                    <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">Tồn Cuối (End Stock)</p>
                    <p className="text-2xl font-black text-primary data-value">{(selectedItemDetail.end_stock || 0).toLocaleString()}</p>
                  </div>
                  <div className="bg-surface-container-low p-4 rounded-xl">
                    <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">Nhập Kho (In)</p>
                    <p className="text-xl font-bold text-on-surface data-value">+{selectedItemDetail.in_qty || 0}</p>
                  </div>
                  <div className="bg-surface-container-low p-4 rounded-xl">
                    <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">Xuất Kho (Out)</p>
                    <p className="text-xl font-bold text-on-surface data-value">-{selectedItemDetail.out_qty || 0}</p>
                  </div>
                  <div className="bg-surface-container-low p-4 rounded-xl">
                    <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">Tồn Đầu (Start)</p>
                    <p className="text-xl font-bold text-on-surface-variant data-value opacity-60">{selectedItemDetail.start_stock || 0}</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-x-12 gap-y-6">
                  <div>
                     <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2 border-b border-outline-variant/10 pb-2">Thông tin cơ bản</p>
                     <ul className="space-y-3 text-sm">
                       <li className="flex justify-between items-center">
                          <span className="text-on-surface-variant">Phân loại:</span> 
                          {isEditingDetail ? (
                             <input type="text" value={editDetailData?.category || ''} onChange={e => setEditDetailData({...editDetailData, category: e.target.value})} className="bg-surface-container-high border-none rounded px-2 py-1 text-right w-32" />
                          ) : (
                             <span className="font-medium">{selectedItemDetail.category || 'N/A'}</span>
                          )}
                       </li>
                       <li className="flex justify-between items-center">
                          <span className="text-on-surface-variant">Tên (CN):</span> 
                          {isEditingDetail ? (
                             <input type="text" value={editDetailData?.name_zh || ''} onChange={e => setEditDetailData({...editDetailData, name_zh: e.target.value})} className="bg-surface-container-high border-none rounded px-2 py-1 text-right w-32" />
                          ) : (
                             <span className="font-medium">{selectedItemDetail.name_zh || 'N/A'}</span>
                          )}
                       </li>
                       <li className="flex justify-between items-center">
                          <span className="text-on-surface-variant">ĐVT:</span> 
                          {isEditingDetail ? (
                             <input type="text" value={editDetailData?.unit || ''} onChange={e => setEditDetailData({...editDetailData, unit: e.target.value})} className="bg-surface-container-high border-none rounded px-2 py-1 text-right w-24" />
                          ) : (
                             <span className="font-medium">{selectedItemDetail.unit}</span>
                          )}
                       </li>
                       <li className="flex justify-between items-center">
                          <span className="text-on-surface-variant">Quy cách:</span> 
                          {isEditingDetail ? (
                             <input type="text" value={editDetailData?.spec || ''} onChange={e => setEditDetailData({...editDetailData, spec: e.target.value})} className="bg-surface-container-high border-none rounded px-2 py-1 text-right w-32" />
                          ) : (
                             <span className="font-medium">{selectedItemDetail.spec || 'N/A'}</span>
                          )}
                       </li>
                     </ul>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2 border-b border-outline-variant/10 pb-2">Lưu trữ & Giá trị</p>
                     <ul className="space-y-3 text-sm">
                       <li className="flex justify-between items-center">
                          <span className="text-on-surface-variant">Vị trí:</span> 
                          {isEditingDetail ? (
                             <input type="text" value={editDetailData?.pos || ''} onChange={e => setEditDetailData({...editDetailData, pos: e.target.value})} className="bg-surface-container-high border-none rounded px-2 py-1 text-right w-24" />
                          ) : (
                             <span className="font-medium px-2 py-0.5 bg-surface-container-high rounded text-xs">{selectedItemDetail.pos || 'N/A'}</span>
                          )}
                       </li>
                       <li className="flex justify-between items-center">
                          <span className="text-on-surface-variant">Đơn giá:</span> 
                          {isEditingDetail ? (
                             <input type="number" value={editDetailData?.price ?? ''} onChange={e => setEditDetailData({...editDetailData, price: e.target.value})} className="bg-surface-container-high border-none rounded px-2 py-1 text-right w-24" />
                          ) : (
                             <span className="font-medium">{selectedItemDetail.price ? selectedItemDetail.price.toLocaleString() : '0'} VND</span>
                          )}
                       </li>
                       <li className="flex justify-between items-center">
                          <span className="text-on-surface-variant">Tồn tối thiểu (Cảnh báo):</span> 
                          {isEditingDetail ? (
                             <input type="number" value={editDetailData?.min_stock ?? ''} onChange={e => setEditDetailData({...editDetailData, min_stock: e.target.value})} className="bg-surface-container-high border-none rounded px-2 py-1 text-right w-24" />
                          ) : (
                             <span className={`font-medium ${selectedItemDetail.min_stock !== null && selectedItemDetail.min_stock !== undefined ? 'text-surface-variant' : 'opacity-40'}`}>{ (selectedItemDetail.min_stock !== null && selectedItemDetail.min_stock !== undefined) ? selectedItemDetail.min_stock.toLocaleString() : 'N/A'}</span>
                          )}
                       </li>
                       {isEditingDetail && (
                          <li className="flex justify-between items-center">
                             <span className="text-on-surface-variant">Quản lý đặc biệt:</span> 
                             <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={editDetailData?.critical || false} onChange={e => setEditDetailData({...editDetailData, critical: e.target.checked})} className="rounded text-error focus:ring-error" />
                                <span className="text-xs font-bold text-error">Critical Item</span>
                             </label>
                          </li>
                       )}
                     </ul>
                  </div>
                </div>

                {isEditingDetail && (
                  <div className="mt-2 p-4 bg-surface-container rounded-xl border border-outline-variant/10">
                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-2">Lý do thay đổi <span className="text-error">*</span></label>
                    <textarea 
                      className="w-full bg-surface-container-lowest border-none rounded-lg p-2 text-sm focus:ring-1 focus:ring-primary h-20 outline-none"
                      placeholder="Nhập lý do chỉnh sửa thông tin vật tư..."
                      value={editDetailData?.editReason || ''}
                      onChange={e => setEditDetailData({...editDetailData, editReason: e.target.value})}
                    />
                  </div>
                )}

                {!isEditingDetail && (
                  <div className="pt-4 border-t border-outline-variant/10 flex justify-center">
                    <button 
                      onClick={async () => {
                        const { data } = await supabase
                          .from('edit_history_inventory')
                          .select('*')
                          .eq('erp_code', selectedItemDetail.erp)
                          .order('edited_at', { ascending: false });
                        
                        if (data) setItemEditHistory(data);
                        setShowItemEditHistory(true);
                      }}
                      className="text-primary text-xs font-bold hover:underline flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">history</span>
                      Xem lịch sử chỉnh sửa thông tin
                    </button>
                  </div>
                )}

                {!isEditingDetail && selectedItemDetail.critical && (
                  <div className="bg-error-container/20 border border-error/20 p-4 rounded-xl flex items-center gap-3">
                     <span className="material-symbols-outlined text-error">warning</span>
                     <p className="text-sm font-medium text-error">Vật tư này được đánh dấu là <span className="font-bold">vật tư quan trọng (Critical Item)</span>. Cần chú ý theo dõi mức tồn kho.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Low Stock (Needs Purchasing) Modal */}
      <AnimatePresence>
        {isLowStockModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden relative"
            >
              <div className="px-8 py-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-error-container text-on-error-container flex items-center justify-center">
                    <span className="material-symbols-outlined">emergency_home</span>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold font-manrope text-on-surface">Vật tư quan trọng cần mua</h3>
                    <p className="text-sm font-medium text-on-surface-variant">Danh sách các mã hàng được đánh dấu "Critical Item" có mức tồn kho dưới định mức tối thiểu.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={exportLowStockToExcel}
                    className="px-4 py-2 font-bold text-on-surface bg-surface-container hover:bg-surface-container-high rounded-xl transition-colors text-sm flex items-center gap-2 shadow hover:shadow-md"
                  >
                    <span className="material-symbols-outlined text-sm text-primary">download</span>
                    Export Excel
                  </button>
                  <button 
                    onClick={() => setIsLowStockModalOpen(false)}
                    className="w-10 h-10 rounded-full hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors ml-2"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>
              
              <div className="p-0 overflow-y-auto bg-surface-container-lowest relative flex-1">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low sticky top-0 z-10 shadow-sm">
                    <tr className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                      <th className="py-4 px-6 border-b border-outline-variant/20">Mã ERP</th>
                      <th className="py-4 px-6 border-b border-outline-variant/20">Tên Vật Tư</th>
                      <th className="py-4 px-6 border-b border-outline-variant/20">Vị trí</th>
                      <th className="py-4 px-6 border-b border-outline-variant/20 text-right">Tồn tối thiểu</th>
                      <th className="py-4 px-6 border-b border-outline-variant/20 text-right">Tồn hiện tại</th>
                      <th className="py-4 px-6 border-b border-outline-variant/20 text-center">Phân loại</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10 text-sm">
                    {lowStockItems.length > 0 ? lowStockItems.map((item, idx) => (
                      <tr key={`${item.erp}-${idx}`} className="hover:bg-error-container/5 transition-colors cursor-pointer" onClick={() => { setIsLowStockModalOpen(false); setSelectedItemDetail(item); }}>
                        <td className="py-4 px-6">
                           <span className="bg-surface-container-high px-2 py-1 rounded-lg text-xs font-black shadow-sm">{item.erp}</span>
                        </td>
                        <td className="py-4 px-6">
                           <div className="font-bold text-surface">{item.name ? item.name : <span className="text-amber-500 italic flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">warning</span> Thiếu thông tin</span>}</div>
                           <div className="text-xs text-on-surface-variant flex gap-2">
                             {item.spec && <span>Quy cách: {item.spec}</span>}
                             <span>ĐVT: {item.unit}</span>
                           </div>
                        </td>
                        <td className="py-4 px-6 font-medium text-surface-variant">{item.pos || '-'}</td>
                        <td className="py-4 px-6 text-right font-bold text-surface-variant">{ (item.min_stock !== null && item.min_stock !== undefined) ? item.min_stock.toLocaleString() : 'N/A'}</td>
                        <td className="py-4 px-6 text-right font-black text-error text-lg">{(item.end_stock || 0).toLocaleString()}</td>
                        <td className="py-4 px-6 text-center">
                           <span className="inline-block px-3 py-1 bg-error-container text-on-error-container rounded-full text-[10px] font-black uppercase tracking-tighter">Critical Low</span>
                        </td>
                      </tr>
                    )) : (
                      <tr key="empty-lowstock">
                        <td colSpan={6} className="py-12 text-center text-on-surface-variant italic">
                           Thật tuyệt vời! Không có vật tư nào cảnh báo.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showItemEditHistory && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm" onClick={() => setShowItemEditHistory(false)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[70vh] border border-outline-variant/10"
            >
              <div className="p-4 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
                 <h3 className="font-bold font-manrope">Lịch sử thay đổi: {selectedItemDetail?.erp}</h3>
                 <button onClick={() => setShowItemEditHistory(false)} className="material-symbols-outlined text-on-surface-variant hover:text-error transition-colors">close</button>
              </div>
              <div className="flex-1 overflow-y-auto font-sans">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-container-lowest sticky top-0 border-b border-outline-variant/10">
                    <tr>
                      <th className="py-3 px-4 text-on-surface-variant uppercase font-black tracking-widest text-[9px]">Thời gian</th>
                      <th className="py-3 px-4 text-on-surface-variant uppercase font-black tracking-widest text-[9px]">Trường</th>
                      <th className="py-3 px-4 text-on-surface-variant uppercase font-black tracking-widest text-[9px]">Từ ➜ Sang</th>
                      <th className="py-3 px-4 text-on-surface-variant uppercase font-black tracking-widest text-[9px]">Ghi chú/Người sửa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemEditHistory.length > 0 ? itemEditHistory.map((item, idx) => (
                      <tr key={`${item.id || 'hist'}-${idx}`} className="hover:bg-surface-container-low/30 transition-colors border-b border-outline-variant/5">
                        <td className="py-3 px-4 whitespace-nowrap text-on-surface-variant">
                          {new Date(item.edited_at).toLocaleDateString('vi-VN')}
                          <br/>
                          <span className="opacity-50 text-[10px]">{new Date(item.edited_at).toLocaleTimeString('vi-VN')}</span>
                        </td>
                        <td className="py-3 px-4 font-bold text-primary">{item.field_name}</td>
                        <td className="py-3 px-4">
                           <div className="text-on-surface-variant opacity-50 line-through truncate max-w-[100px]">{item.old_value || 'None'}</div>
                           <div className="font-bold text-on-surface truncate max-w-[100px]">{item.new_value || 'None'}</div>
                        </td>
                        <td className="py-3 px-4">
                           <div className="italic text-on-surface-variant line-clamp-2 max-w-[200px]" title={item.reason}>{item.reason}</div>
                           <div className="font-bold text-secondary mt-1 text-[10px]">{item.edited_by}</div>
                        </td>
                      </tr>
                    )) : (
                      <tr key="empty-history">
                        <td colSpan={4} className="py-10 text-center text-on-surface-variant italic">Không có dữ liệu chỉnh sửa.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Selected Confirm Modal */}
      {showDeleteSelectedConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest p-8 rounded-[2rem] shadow-2xl max-w-sm w-full border border-outline-variant/10 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-6">
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
            </div>
            <h3 className="text-xl font-black text-on-surface mb-2">Xác nhận xóa {selectedRows.length} item</h3>
            <p className="text-on-surface-variant text-sm mb-6 leading-relaxed">
              Bạn có chắc chắn muốn XÓA <strong className="text-error">{selectedRows.length}</strong> item đã chọn khỏi tồn kho? Hành động này sẽ được ghi log lại.
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

      {/* Delete ALL Confirm Modal */}
      {showDeleteAllConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest p-8 rounded-[2rem] shadow-2xl max-w-sm w-full border border-outline-variant/10 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-6">
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>delete_forever</span>
            </div>
            <h3 className="text-xl font-black text-error mb-2">⚠ CẢNH BÁO NGUY HIỂM</h3>
            <p className="text-on-surface-variant text-sm mb-6 leading-relaxed">
              Bạn sắp XÓA <strong className="text-error">TOÀN BỘ</strong> dữ liệu tồn kho. Hành động này <strong className="text-error">KHÔNG THỂ HOÀN TÁC</strong>. Chỉ thực hiện khi cần reset dữ liệu để nhập lại từ đầu.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowDeleteAllConfirm(false)}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
                disabled={loading}
              >
                Hủy
              </button>
              <button 
                onClick={executeDeleteAll}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-error text-on-error shadow-lg shadow-error/20 hover:opacity-90 transition-opacity"
                disabled={loading}
              >
                {loading ? 'Đang xóa...' : 'XÓA TOÀN BỘ'}
              </button>
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
    </div>
  );
};

export default Inventory;
