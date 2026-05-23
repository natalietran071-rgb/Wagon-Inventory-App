import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

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

const Audit = () => {
  const { profile, user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'audit' | 'draft' | 'pending' | 'history'>('audit');

  // Session State
  const [currentSession, setCurrentSession] = useState<any | null>(null);
  const [draftSessions, setDraftSessions] = useState<any[]>([]);

  // Pagination State
  const [pendingPage, setPendingPage] = useState(0);
  const PAGE_SIZE = 50;

  // Data State
  const [pendingAuditItems, setPendingAuditItems] = useState<any[]>([]); // Items needing audit (Tab 1)
  const [totalPendingCount, setTotalPendingCount] = useState(0);
  const [auditItems, setAuditItems] = useState<any[]>([]); // Draft Records (Tab 2)
  const [pendingRecords, setPendingRecords] = useState<any[]>([]); // Items waiting for approval (Tab 3)
  const [historyItems, setHistoryItems] = useState<any[]>([]); // Approved/Rejected records (Tab 4)
  const [inventoryItems, setInventoryItems] = useState<any[]>([]); // For search suggestions
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [areaSearch, setAreaSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [draftSearchQuery, setDraftSearchQuery] = useState('');
  const [searchErp, setSearchErp] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [pendingSearch, setPendingSearch] = useState('');
  const [movementSearchRange, setMovementSearchRange] = useState({ 
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  });

  // Debounced search for inventory
  useEffect(() => {
    const timer = setTimeout(() => {
      if (hasSearched) {
        setPendingPage(0); // Reset page on search
        fetchPendingAuditItems();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, areaSearch, hasSearched]);

  useEffect(() => {
    if (hasSearched) {
      fetchPendingAuditItems();
    }
  }, [pendingPage]);

  const performInventorySearch = async (query: string) => {
    setIsSearching(true);
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .or(`erp.ilike.%${query}%,name.ilike.%${query}%,pos.ilike.%${query}%`)
        .limit(100);
      
      if (data) {
        // Merge with existing items to avoid duplicates but prefer fresh search results
        setInventoryItems(prev => {
          const map = new Map();
          // Add search results first to ensure they are at the top if needed
          data.forEach(item => map.set(item.erp, item));
          // Add previous items if they don't exist
          prev.forEach(item => {
            if (!map.has(item.erp)) map.set(item.erp, item);
          });
          return Array.from(map.values());
        });
      }
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setIsSearching(false);
    }
  };

  // Location suggestions
  const [locationSuggestions, setLocations] = useState<any[]>([]);
  
  // Edit record state
  const [editingRecord, setEditingRecord] = useState<any | null>(null);
  const [editQty, setEditQty] = useState<number | ''>('');
  const [editLoc, setEditLoc] = useState('');
  const [editNote, setEditNote] = useState('');

  // Scan modal state
  const [activeScanItem, setActiveScanItem] = useState<any | null>(null);
  const [itemLocations, setItemLocations] = useState<any[]>([]);
  const [actualQtyInput, setActualQtyInput] = useState<number | ''>('');
  const [locationInput, setLocationInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

  // History filtering
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);

  // Roles
  const isAdmin = profile?.role === 'admin' || user?.email === 'natalietran071@gmail.com';
  const canEdit = isAdmin || profile?.role === 'editor';

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!user?.email) return;
      setLoading(true);
      try {
        // Find latest draft sessions
        const { data: sessions } = await supabase
          .from('audit_sessions')
          .select('*')
          .eq('status', 'Draft')
          .order('created_at', { ascending: false })
          .limit(5);

        setDraftSessions(sessions || []);

        if (currentSession?.id && currentSession.id !== '00000000-0000-0000-0000-000000000000') {
           const tasks = [
             fetchBaseData(),
             fetchDraftRecords(currentSession.id),
             fetchPendingRecords(currentSession.id)
           ];
           if (hasSearched) {
             tasks.push(fetchPendingAuditItems(currentSession.id));
           }
           await Promise.all(tasks);
        } else {
           await fetchBaseData();
        }
      } catch (err: any) {
        console.error("Connectivity error on mount:", err);
        if (err.message === 'Failed to fetch' || err.message?.includes('network')) {
          alert("Lỗi kết nối Server: Vui lòng kiểm tra đường truyền hoặc cấu hình Supabase.");
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user?.email]);

  useEffect(() => {
    if (activeTab === 'history' && user?.email) {
      fetchApprovedHistory();
    }
  }, [activeTab, fromDate, toDate, searchErp, user?.email]);

  const handleCreateNewSession = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_sessions')
        .insert({
          session_name: `KIEM-KE-${new Date().toLocaleDateString('vi-VN').replace(/\//g, '')}`,
          auditor: profile?.full_name || user?.email,
          auditor_email: user?.email,
          status: 'Draft'
        })
        .select()
        .single();
        
      if (error) throw error;
      setCurrentSession(data);
      fetchDraftRecords(data.id);
      fetchPendingRecords(data.id);
      if (hasSearched) fetchPendingAuditItems(data.id);
      
      const { data: sessions } = await supabase
          .from('audit_sessions')
          .select('*')
          .eq('status', 'Draft')
          .order('created_at', { ascending: false })
          .limit(5);
      setDraftSessions(sessions || []);

      showToast('Đã tạo phiên kiểm kê mới');
    } catch (err: any) {
      showToast('Lỗi tạo phiên: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSession = (session: any) => {
    setCurrentSession(session);
    fetchDraftRecords(session.id);
    fetchPendingRecords(session.id);
    if (hasSearched) fetchPendingAuditItems(session.id);
    showToast(`Đã chọn phiên: ${session.session_name}`);
  };

  // Update fetch function to handle all filters
  const fetchPendingAuditItems = async (sessionId?: string) => {
    const sid = sessionId || currentSession?.id || '00000000-0000-0000-0000-000000000000';

    try {
      const { data, error } = await supabase.rpc('get_audit_items', {
        p_session_id: sid,
        p_search: searchQuery || '',
        p_location: areaSearch || '',
        p_from_date: movementSearchRange.from,
        p_to_date: movementSearchRange.to,
        p_limit: PAGE_SIZE,
        p_offset: pendingPage * PAGE_SIZE
      });
      if (error) throw error;
      // Filter out items already audited in this session as requested
      setPendingAuditItems((data || []).filter((item: any) => !item.already_audited));

      const { data: countData } = await supabase.rpc('count_audit_items', {
        p_session_id: sid,
        p_search: searchQuery || '',
        p_location: areaSearch || '',
        p_from_date: movementSearchRange.from,
        p_to_date: movementSearchRange.to
      });
      setTotalPendingCount(countData || 0);
    } catch (err) {
      console.error("Error fetching audit items:", err);
    }
  };

  const handleMovementSearch = () => {
    setHasSearched(true);
    setPendingPage(0);
    fetchPendingAuditItems();
    showToast('🔍 Đã cập nhật danh sách cần kiểm');
  };

  const fetchDraftRecords = async (sessionId?: string) => {
    const sid = sessionId || currentSession?.id;
    if (!sid) return;

    try {
      const { data, error } = await supabase.rpc('get_audited_items', {
        p_session_id: sid,
        p_status: 'Draft'
      });
      if (error) throw error;
      if (data) setAuditItems(data);
    } catch (err) {
      console.error("Error fetching draft records:", err);
    }
  };

  const fetchPendingRecords = async (sessionId?: string) => {
    const sid = sessionId || currentSession?.id;
    if (!sid) return;

    try {
      const { data, error } = await supabase.rpc('get_audited_items', {
        p_session_id: sid,
        p_status: 'Pending'
      });
      if (error) throw error;
      if (data) setPendingRecords(data);
    } catch (err) {
      console.error("Error fetching pending records:", err);
    }
  };

  const fetchApprovedHistory = async () => {
    try {
      let query = supabase
        .from('audit_records')
        .select('*')
        .eq('status', 'Approved')
        .order('approved_at', { ascending: false });

      // Filter theo ngày nếu có
      if (fromDate) query = query.gte('approved_at', fromDate + 'T00:00:00');
      if (toDate) query = query.lte('approved_at', toDate + 'T23:59:59');

      // Filter theo ERP nếu có
      if (searchErp) query = query.ilike('erp_code', '%' + searchErp + '%');

      const { data, error } = await query;
      if (error) throw error;
      
      // Map joined name to item_name if needed
      const formatted = (data || []).map((item: any) => ({
        ...item,
        name: item.item_name || 'N/A'
      }));
      setHistoryItems(formatted);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const handleSendOneForApproval = async (recordId: string) => {
    if (!user?.email) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('send_audit_record_for_approval', {
        p_record_id: recordId,
        p_user_email: user.email
      });
      if (error) showToast('Lỗi: ' + error.message, true);
      else {
        showToast('✅ Đã gửi phê duyệt!');
        await Promise.all([fetchDraftRecords(), fetchPendingRecords()]);
      }
    } catch (err: any) {
      showToast('Lỗi: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleSendAllForApproval = async () => {
    if (!currentSession?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('submit_audit_session', {
        p_session_id: currentSession.id
      });
      if (error) showToast('Lỗi: ' + error.message, true);
      else {
        showToast(`✅ Đã gửi ${data?.submitted || data || 0} mã!`);
        await Promise.all([fetchDraftRecords(), fetchPendingRecords()]);
      }
    } catch (err: any) {
      showToast('Lỗi: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const fetchBaseData = async () => {
    try {
      // Fetch Locations (for recommendations) - limited to 1000 for performance
      const { data: locRes, error } = await supabase
        .from('audit_locations')
        .select('name')
        .order('name')
        .limit(1000);
      if (!error && locRes) setLocations(locRes);
    } catch (err) {
      console.error("Error fetching base data:", err);
    }
  };

  const processAddItem = async (item: any) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_audit_item_detail', {
        p_erp: item.erp,
        p_session_id: currentSession?.id || '00000000-0000-0000-0000-000000000000'
      });
      
      if (error) throw error;
      
      setItemLocations(data?.positions || []);
      setActiveScanItem({
        ...item,
        end_stock: data?.total_stock || item.end_stock
      });
    } catch (err) {
      console.error("Error fetching item detail:", err);
      setItemLocations([item]);
      setActiveScanItem(item);
    } finally {
      setLocationInput(item.pos || '');
      setActualQtyInput('');
      setNoteInput('');
      setLoading(false);
    }
  };

  const handleSaveAuditRecord = async () => {
    let sessionId = currentSession?.id;
    
    // Auto-create session if none exists
    if (!sessionId || sessionId === '00000000-0000-0000-0000-000000000000') {
      try {
        const { data: newSession, error: sessionError } = await supabase
          .from('audit_sessions')
          .insert({
            session_name: `KIEM-KE-${new Date().toLocaleDateString('vi-VN').replace(/\//g, '')}`,
            auditor: profile?.full_name || user?.email,
            auditor_email: user?.email,
            status: 'Draft'
          })
          .select()
          .single();
        if (sessionError) throw sessionError;
        setCurrentSession(newSession);
        sessionId = newSession.id;
        
        const { data: sessions } = await supabase
          .from('audit_sessions')
          .select('*')
          .eq('status', 'Draft')
          .order('created_at', { ascending: false })
          .limit(5);
        setDraftSessions(sessions || []);
        
        showToast('Đã tự động tạo phiên kiểm kê mới');
      } catch (err: any) {
        return showToast('Lỗi tạo phiên: ' + err.message, true);
      }
    }
    const selectedErp = activeScanItem?.erp || activeScanItem?.erp_code;
    if (!selectedErp) return showToast('Chưa chọn mã ERP', true);
    if (actualQtyInput === undefined || actualQtyInput === null || actualQtyInput === '') {
      return showToast('Chưa nhập số lượng', true);
    }

    setLoading(true);
    try {
      // 1. Check duplicate if not editing
      if (!editingRecord) {
        const { data: dupData, error: dupError } = await supabase.rpc('check_audit_duplicate', {
          p_erp_code: selectedErp,
          p_location: locationInput || '',
          p_session_id: sessionId
        });
        
        if (dupError) throw dupError;
        if (dupData?.duplicate) {
          if (!window.confirm(`Mã này đang được kiểm bởi ${dupData.auditor}. Bạn có chắc muốn ghi đè?`)) {
             setLoading(false);
             return;
          }
        }
      }

      // 2. Save
      const { error } = await supabase.rpc('save_audit_record_v2', {
        p_session_id: sessionId,
        p_erp_code: selectedErp,
        p_actual_qty: Number(actualQtyInput),
        p_location: locationInput || '',
        p_note: noteInput || null,
        p_auditor: profile?.full_name || user?.email || 'Unknown',
        p_user_email: user?.email || ''
      });

      if (error) {
        showToast('Lỗi lưu: ' + error.message, true);
      } else {
        showToast(editingRecord ? '✅ Đã cập nhật!' : '✅ Đã lưu kiểm đếm!');
        setActiveScanItem(null);
        setEditingRecord(null);
        setActualQtyInput('');
        setLocationInput('');
        setNoteInput('');
        fetchDraftRecords();
        fetchPendingAuditItems();
      }
    } catch (err: any) {
      showToast('Lỗi: ' + err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleBatchAction = async (action: 'approve' | 'undo') => {
    if (selectedRecords.length === 0) return;
    if (!window.confirm(`Xác nhận ${action === 'approve' ? 'PHÊ DUYỆT' : 'HỦY'} ${selectedRecords.length} bản ghi đã chọn?`)) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(action === 'approve' ? 'approve_audit_records' : 'undo_audit_records', {
        p_record_ids: selectedRecords,
        p_approver_email: user?.email || 'Unknown',
        p_sync_inventory: true
      });

      if (error) throw error;
      
      // Reload if error is null (handles both JSON success and VOID returns)
      setSelectedRecords([]);
      await Promise.all([
        fetchPendingRecords(),
        fetchApprovedHistory(),
        fetchDraftRecords()
      ]);
    } catch (err: any) {
      alert("Lỗi: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUndoRecord = async (record: any) => {
    if (!window.confirm("Bạn có chắc muốn HỦY DUYỆT bản ghi này và đưa nó về trạng thái KIỂM KÊ (DRAFT)?")) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('undo_audit_records', {
        p_record_ids: [record.id],
        p_approver_email: user?.email || profile?.email || 'Unknown'
      });
      
      if (error) throw error;
      await Promise.all([
        fetchPendingRecords(),
        fetchApprovedHistory(),
        fetchDraftRecords()
      ]);
    } catch (err: any) {
      alert("Lỗi khi hủy duyệt: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (recordId: string) => {
    if (!recordId || !user?.email) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('approve_audit_records', {
        p_record_ids: [recordId],
        p_approver_email: user.email,
        p_sync_inventory: true
      });

      if (error) {
        showToast('Lỗi: ' + error.message, true);
        return;
      }
      
      showToast('✅ Đã phê duyệt!');
      await Promise.all([
        fetchPendingRecords(),
        fetchApprovedHistory()
      ]);
    } catch (err: any) {
      showToast("Lỗi: " + (err.message || "Không xác định"), true);
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async (recordId: string) => {
    if (!recordId || !user?.email) return;
    
    setLoading(true);
    try {
      const { error } = await supabase.rpc('undo_audit_records', {
        p_record_ids: [recordId],
        p_approver_email: user.email
      });

      if (error) {
        showToast('Lỗi: ' + error.message, true);
        return;
      }

      showToast('↩️ Đã hoàn tác!');
      await Promise.all([
        fetchPendingRecords(),
        fetchDraftRecords()
      ]);
    } catch (err: any) {
      showToast("Lỗi: " + (err.message || "Không xác định"), true);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAll = async () => {
    if (!currentSession?.id || !user?.email) return;
    if (!window.confirm("Xác nhận DUYỆT TẤT CẢ các bản ghi đang chờ? Thao tác này sẽ đồng bộ tồn kho.")) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('approve_all_audit_records', {
        p_session_id: currentSession.id,
        p_approver_email: user.email,
        p_sync_inventory: true
      });
      if (error) {
        showToast('Lỗi: ' + error.message, true);
        return;
      }
      showToast(`✅ Đã duyệt ${data?.approved || data || 0} mã!`);
      await Promise.all([
        fetchPendingRecords(),
        fetchApprovedHistory()
      ]);
    } catch (err: any) {
      showToast("Lỗi: " + (err.message || "Không xác định"), true);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAuditRecord = async (recordId: string) => {
    if (!window.confirm("Xóa bản ghi này?")) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('delete_audit_record', {
        p_record_id: recordId,
        p_session_id: currentSession.id
      });
      if (error) throw error;
      showToast('Đã xóa bản ghi');
      fetchDraftRecords();
    } catch (err: any) {
      alert("Lỗi: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitSession = async () => {
    if (auditItems.length === 0) return showToast('Không có bản ghi nào để gửi', true);
    if (!window.confirm(`Gửi ${auditItems.length} bản ghi đi phê duyệt?`)) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('submit_audit_session', {
        p_session_id: currentSession.id
      });
      if (error) throw error;
      showToast('✅ Đã gửi phê duyệt!');
      await Promise.all([
        fetchDraftRecords(),
        fetchPendingRecords()
      ]);
      setActiveTab('pending');
    } catch (err: any) {
      alert("Lỗi: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRecord = async () => {
    if (!editingRecord) return;
    if (editQty === '') {
      alert("Vui lòng nhập số lượng");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.rpc('save_audit_record', {
        p_session_id: currentSession.id,
        p_erp_code: editingRecord.erp_code,
        p_actual_qty: Number(editQty),
        p_location: editLoc,
        p_note: editNote,
        p_auditor: profile?.full_name || user?.email?.split('@')[0] || 'Unknown',
        p_user_email: user?.email || ''
      });

      if (error) throw error;
      
      setEditingRecord(null);
      fetchDraftRecords();
      showToast('✅ Đã cập nhật!');
    } catch (err: any) {
      alert("Lỗi khi cập nhật: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Use state data instead of RPC (which is capped at 1000 by PostgREST)
      let dataSource: any[] = [];
      if (activeTab === 'history') {
        dataSource = historyItems;
      } else if (activeTab === 'pending') {
        dataSource = pendingRecords;
      } else if (activeTab === 'draft') {
        dataSource = auditItems;
      } else {
        dataSource = [...auditItems, ...pendingRecords, ...historyItems];
      }

      const exportData = dataSource.map((item: any) => ({
        'Mã ERP': item.erp_code,
        'Tên Vật Tư': item.item_name || item.name || 'N/A',
        'Vị Trí': item.location || '',
        'SL Hệ Thống': item.system_qty || 0,
        'SL Thực Tế': item.actual_qty || 0,
        'Chênh Lệch': item.difference || 0,
        'Người Kiểm': item.auditor || '',
        'Ngày Kiểm': item.created_at ? new Date(item.created_at).toLocaleDateString('vi-VN') : '',
        'Trạng Thái': item.status || 'Chưa kiểm',
        'Ghi Chú': item.note || '',
        'Người Duyệt': item.approver || '',
        'Ngày Duyệt': item.approved_at ? new Date(item.approved_at).toLocaleDateString('vi-VN') : '',
        'Lý do điều chỉnh': item.adjustment_reason || ''
      }));

      const fileName = `kiem-ke_${today}.xlsx`;
      const { exportToExcelMultiSheet } = await import('../lib/excelUtils');
      const sheets = exportToExcelMultiSheet(exportData, fileName, 'Kiểm Kê');
      showToast(`✅ Đã xuất ${exportData.length.toLocaleString()} dòng — ${sheets} sheet!`);
    } catch (err: any) {
      console.error('Export error:', err);
      alert('Lỗi export: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const filteredPendingRecords = useMemo(() => {
    if (!pendingSearch.trim()) return pendingRecords;
    const q = pendingSearch.toLowerCase();
    return pendingRecords.filter(r =>
      (r.erp_code && r.erp_code.toLowerCase().includes(q)) ||
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.location && r.location.toLowerCase().includes(q)) ||
      (r.auditor && r.auditor.toLowerCase().includes(q))
    );
  }, [pendingRecords, pendingSearch]);

  const filteredInventoryItems = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    return inventoryItems.filter(item => 
      (item.erp && item.erp.toLowerCase().includes(q)) || 
      (item.name && item.name.toLowerCase().includes(q)) || 
      (item.pos && item.pos.toLowerCase().includes(q))
    ).slice(0, 50);
  }, [searchQuery, inventoryItems]);

  const EditRecordModal = () => (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-scrim/60 backdrop-blur-md">
      <div className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-outline-variant/10 animate-in fade-in zoom-in-95 duration-300">
        <div className="px-8 py-6 bg-surface-container-low border-b border-outline-variant/20 flex justify-between items-center">
          <h3 className="text-xl font-black text-on-surface">Chỉnh Sửa Bản Ghi</h3>
          <button onClick={() => setEditingRecord(null)} className="w-10 h-10 rounded-full hover:bg-surface-container transition-colors flex items-center justify-center">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-8 space-y-6">
          <div>
            <label className="block text-[10px] font-black text-on-surface-variant uppercase mb-2 ml-1">Số lượng thực tế</label>
            <input 
              type="number" 
              className="w-full bg-surface-container-low border border-outline-variant/30 rounded-2xl px-5 py-4 text-lg font-black focus:ring-4 focus:ring-primary/10 outline-none transition-all"
              value={editQty}
              onChange={e => setEditQty(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-on-surface-variant uppercase mb-2 ml-1">Vị trí (Location)</label>
            <input 
              type="text" 
              className="w-full bg-surface-container-low border border-outline-variant/30 rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-primary/10 outline-none transition-all"
              value={editLoc}
              onChange={e => setEditLoc(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-on-surface-variant uppercase mb-2 ml-1">Ghi chú</label>
            <textarea 
              className="w-full bg-surface-container-low border border-outline-variant/30 rounded-2xl px-5 py-4 text-sm font-medium focus:ring-4 focus:ring-primary/10 outline-none transition-all resize-none h-24"
              value={editNote}
              onChange={e => setEditNote(e.target.value)}
              placeholder="VD: Hàng lỗi, sai quy cách..."
            />
          </div>
          <button 
            onClick={handleUpdateRecord}
            className="w-full bg-primary text-on-primary py-4 rounded-2xl font-black shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all text-sm"
          >CẬP NHẬT THAY ĐỔI</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {editingRecord && <EditRecordModal />}
      {/* HEADER OVERVIEW */}
      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 bg-surface-container-lowest p-8 rounded-3xl shadow-sm relative overflow-hidden border border-outline-variant/10">
          <div className="relative z-10">
            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex flex-col gap-4 w-full">
                <div className="flex flex-wrap gap-4">
                  <div className="relative flex-1 min-w-[200px]">
                    <div className="flex bg-surface-container-low rounded-2xl px-5 py-4 border border-primary/20 focus-within:border-primary shadow-sm transition-all">
                      <span className="material-symbols-outlined text-primary mr-3 flex items-center">search</span>
                      <input 
                        type="text" 
                        placeholder="Mã ERP hoặc Tên vật tư..."
                        className="bg-transparent border-none text-sm font-black focus:ring-0 outline-none w-full"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleMovementSearch()}
                      />
                    </div>
                  </div>

                  <div className="flex-1 min-w-[200px]">
                    <div className="flex bg-surface-container-low rounded-2xl px-5 py-4 border border-primary/20 focus-within:border-primary shadow-sm transition-all">
                      <span className="material-symbols-outlined text-primary mr-3 flex items-center">location_on</span>
                      <input 
                        type="text" 
                        placeholder="Tìm theo khu vực..."
                        className="bg-transparent border-none text-sm font-black focus:ring-0 outline-none w-full"
                        value={areaSearch}
                        onChange={e => setAreaSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleMovementSearch()}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="mt-8 flex flex-wrap gap-4 items-center">
              <div className="flex bg-surface-container-low p-2 rounded-2xl border border-outline-variant/10 shadow-inner overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2">
                   <span className="material-symbols-outlined text-sm text-primary">calendar_month</span>
                   <div className="flex items-center gap-3">
                      <input 
                        type="date" 
                        className="bg-transparent border-none text-sm font-black focus:ring-0 p-0 w-[120px]" 
                        value={movementSearchRange.from}
                        onChange={e => setMovementSearchRange(prev => ({ ...prev, from: e.target.value }))}
                      />
                      <span className="opacity-30 text-xs font-black">TO</span>
                      <input 
                        type="date" 
                        className="bg-transparent border-none text-sm font-black focus:ring-0 p-0 w-[120px]" 
                        value={movementSearchRange.to}
                        onChange={e => setMovementSearchRange(prev => ({ ...prev, to: e.target.value }))}
                      />
                   </div>
                </div>
              </div>

              <button 
                onClick={handleMovementSearch}
                disabled={loading}
                className="bg-primary text-on-primary px-10 py-4 rounded-2xl text-sm font-black shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-xl">sync</span>
                LỌC MÃ BIẾN ĐỘNG
              </button>
            </div>
          </div>
          <div className="absolute right-[-20px] bottom-[-20px] opacity-[0.03] rotate-12 pointer-events-none">
            <span className="material-symbols-outlined text-[15rem]">inventory_2</span>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 bg-primary text-on-primary p-8 rounded-3xl shadow-xl flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"></div>
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-6">
              <span className="bg-white/20 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-white/10">Thông tin</span>
              <span className="material-symbols-outlined text-white/50">account_circle</span>
            </div>
            <div className="space-y-4">
              <div className="bg-white/10 p-5 rounded-2xl border border-white/5 backdrop-blur-sm">
                 <p className="text-[10px] font-black text-white/60 uppercase tracking-widest mb-1">Tài khoản</p>
                 <p className="text-lg font-bold">{profile?.full_name || 'Hệ Thống'}</p>
                 <p className="text-xs font-medium text-white/70 italic mt-0.5">{user?.email}</p>
              </div>
              <div className="bg-white/10 p-5 rounded-2xl border border-white/5 backdrop-blur-sm relative z-20">
                 <p className="text-[10px] font-black text-white/60 uppercase tracking-widest mb-2">Phiên Kiểm Kê</p>
                 {currentSession?.id && currentSession.id !== '00000000-0000-0000-0000-000000000000' ? (
                   <div className="flex flex-col gap-2">
                     <p className="text-sm font-bold text-white uppercase">{currentSession.session_name}</p>
                     <p className="text-xs text-white/70 font-medium">Tạo bởi: {currentSession.auditor_email || currentSession.auditor || 'Ẩn danh'}</p>
                     <button onClick={() => setCurrentSession(null)} className="text-[10px] text-primary bg-white px-3 py-1.5 rounded-lg mt-2 font-black w-fit shadow-md hover:scale-105 active:scale-95 transition-all">ĐỔI PHIÊN KHÁC</button>
                   </div>
                 ) : (
                   <div className="flex flex-col gap-2">
                     <select 
                       className="bg-white/20 text-white border border-white/20 rounded-xl px-3 py-2 text-xs font-bold outline-none cursor-pointer"
                       onChange={(e) => {
                         const sess = draftSessions.find(s => s.id === e.target.value);
                         if (sess) handleSelectSession(sess);
                       }}
                       value=""
                     >
                       <option value="" disabled className="text-black">-- Chọn phiên nháp --</option>
                       {draftSessions.map(s => (
                         <option key={s.id} value={s.id} className="text-black">{s.session_name} ({s.auditor_email || s.auditor || 'Ẩn danh'})</option>
                       ))}
                     </select>
                     <button onClick={handleCreateNewSession} className="bg-white text-primary px-3 py-2 rounded-xl text-xs font-black shadow-lg hover:scale-105 active:scale-95 transition-all mt-2 w-full uppercase">
                       + Tạo Mới
                     </button>
                   </div>
                 )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TABS */}
      <div className="flex gap-4 border-b border-outline-variant/10 mb-2 overflow-x-auto no-scrollbar">
        <button 
          onClick={() => setActiveTab('audit')}
          className={`px-6 py-4 font-black text-sm transition-all relative flex-shrink-0 ${activeTab === 'audit' ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface opacity-60'}`}
        >
          CẦN KIỂM
          {activeTab === 'audit' && <motion.div layoutId="tab-underline" className="absolute bottom-[-1px] left-0 right-0 h-1 bg-primary rounded-full" />}
        </button>
        <button 
          onClick={() => setActiveTab('draft')}
          className={`px-6 py-4 font-black text-sm transition-all relative flex-shrink-0 ${activeTab === 'draft' ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface opacity-60'}`}
        >
          ĐÃ LƯU - CHỜ GỬI
          {auditItems.length > 0 && <span className="ml-2 bg-primary text-on-primary text-[10px] px-1.5 py-0.5 rounded-full">{auditItems.length}</span>}
          {activeTab === 'draft' && <motion.div layoutId="tab-underline" className="absolute bottom-[-1px] left-0 right-0 h-1 bg-primary rounded-full" />}
        </button>
        <button 
          onClick={() => setActiveTab('pending')}
          className={`px-6 py-4 font-black text-sm transition-all relative flex-shrink-0 ${activeTab === 'pending' ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface opacity-60'}`}
        >
          PHÊ DUYỆT
          {pendingRecords.length > 0 && <span className="ml-2 bg-primary text-on-primary text-[10px] px-1.5 py-0.5 rounded-full">{pendingRecords.length}</span>}
          {activeTab === 'pending' && <motion.div layoutId="tab-underline" className="absolute bottom-[-1px] left-0 right-0 h-1 bg-primary rounded-full" />}
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          className={`px-6 py-4 font-black text-sm transition-all relative flex-shrink-0 ${activeTab === 'history' ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface opacity-60'}`}
        >
          LỊCH SỬ PHÊ DUYỆT
          {activeTab === 'history' && <motion.div layoutId="tab-underline" className="absolute bottom-[-1px] left-0 right-0 h-1 bg-primary rounded-full" />}
        </button>
      </div>

      {activeTab === 'audit' && (
        <div className="space-y-6 flex flex-col min-h-[500px]">
          <div className="bg-surface-container-low p-8 rounded-3xl border border-outline-variant/10 shadow-sm flex flex-col">
             <div className="flex justify-between items-center mb-6 shrink-0">
                <h4 className="text-sm font-black text-primary uppercase tracking-widest flex items-center gap-2">
                   <span className="material-symbols-outlined text-xl">list_alt</span>
                   Danh Sách Cần Kiểm ({totalPendingCount})
                </h4>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-[70vh] overflow-y-auto no-scrollbar pb-10">
                {!hasSearched ? (
                  <div className="col-span-full py-20 text-center">
                     <span className="material-symbols-outlined text-6xl text-primary opacity-20 mb-4 scale-125">search_insights</span>
                     <p className="text-on-surface-variant font-black text-sm uppercase tracking-widest italic tracking-tighter">Nhập mã ERP, tên hoặc vị trí rồi bấm Lọc Mã để tìm kiếm</p>
                  </div>
                ) : (
                  <>
                    {pendingAuditItems.map(item => (
                      <button 
                        key={`${item.erp}-${item.pos}`}
                        onClick={() => processAddItem(item)}
                        className="text-left p-5 rounded-2xl bg-white border border-outline-variant/10 hover:border-primary/40 hover:shadow-xl transition-all group relative overflow-hidden h-fit"
                      >
                         <div className="flex justify-between items-start relative z-10">
                            <div className="flex-1 pr-4">
                               <div className="flex items-center gap-2 mb-2">
                                  <span className="text-[10px] font-black text-primary font-mono bg-primary/5 px-2 py-0.5 rounded-md">{item.erp}</span>
                                  {item.movement_qty > 0 && <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[8px] font-black uppercase">Biến động</span>}
                               </div>
                               <p className="text-sm font-black text-on-surface mt-2 mb-3 line-clamp-2 leading-tight min-h-[2.5rem]">{item.name}</p>
                               <div className="flex items-center gap-2">
                                  <div className="flex items-center gap-1 bg-surface-container px-2 py-1 rounded-lg text-[10px] font-black text-on-surface-variant border border-outline-variant/10">
                                     <span className="material-symbols-outlined text-[12px]">location_on</span>
                                     {item.pos || 'MAIN'}
                                  </div>
                                  <div className="text-[10px] font-black text-on-surface-variant/60">Tồn: <span className="text-on-surface">{item.end_stock}</span></div>
                               </div>
                            </div>
                            <div className="bg-primary/10 text-primary p-2 rounded-xl group-hover:bg-primary group-hover:text-on-primary transition-all shadow-sm">
                               <span className="material-symbols-outlined text-lg">add</span>
                            </div>
                         </div>
                      </button>
                    ))}
                    {pendingAuditItems.length === 0 && (
                      <div className="col-span-full py-20 text-center">
                         <span className="material-symbols-outlined text-6xl text-outline-variant mb-4">inventory</span>
                         <p className="text-on-surface-variant font-black text-sm uppercase tracking-widest italic tracking-tighter">Hệ thống chưa tìm thấy mã có biến động phù hợp.</p>
                      </div>
                    )}
                  </>
                )}
             </div>

             {/* Pagination Controls */}
             {hasSearched && totalPendingCount > PAGE_SIZE && (
               <div className="flex justify-between items-center mt-6 shrink-0 pt-4 border-t border-outline-variant/10">
                  <div className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest">
                     Hiển thị {pendingPage * PAGE_SIZE + 1} - {Math.min((pendingPage + 1) * PAGE_SIZE, totalPendingCount)} / {totalPendingCount}
                  </div>
                  <div className="flex gap-2">
                     <button 
                       disabled={pendingPage === 0}
                       onClick={() => setPendingPage(p => p - 1)}
                       className="w-10 h-10 rounded-xl bg-white border border-outline-variant/20 flex items-center justify-center hover:bg-primary/10 disabled:opacity-30 disabled:hover:bg-white transition-all"
                     >
                        <span className="material-symbols-outlined">chevron_left</span>
                     </button>
                     <button 
                       disabled={(pendingPage + 1) * PAGE_SIZE >= totalPendingCount}
                       onClick={() => setPendingPage(p => p + 1)}
                       className="w-10 h-10 rounded-xl bg-white border border-outline-variant/20 flex items-center justify-center hover:bg-primary/10 disabled:opacity-30 disabled:hover:bg-white transition-all"
                     >
                        <span className="material-symbols-outlined">chevron_right</span>
                     </button>
                  </div>
               </div>
             )}
          </div>
        </div>
      )}

      {activeTab === 'draft' && (
        <div className="space-y-6">
          {!(currentSession?.id && currentSession.id !== '00000000-0000-0000-0000-000000000000') ? (
            <div className="bg-surface-container-lowest rounded-3xl shadow-sm border border-outline-variant/10 overflow-hidden py-20 text-center flex flex-col items-center">
              <span className="material-symbols-outlined text-6xl text-primary opacity-20 mb-4 scale-125">rule_folder</span>
              <p className="text-on-surface-variant font-black text-sm uppercase tracking-widest italic tracking-tighter">Vui lòng chọn hoặc tạo Phiên Kiểm Kê ở khung "Thông tin" phía trên</p>
            </div>
          ) : (
           <div className="bg-surface-container-lowest rounded-3xl shadow-sm border border-outline-variant/10 overflow-hidden">
             <div className="p-8 bg-surface-container-low/50 flex justify-between items-center border-b border-outline-variant/10">
                <div className="flex items-center gap-4">
                   <h4 className="text-sm font-black text-on-surface uppercase tracking-wider flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">edit_note</span>
                      Mã Đang Kiểm ({auditItems.length})
                   </h4>
                   {auditItems.length > 0 && (
                     <button 
                        onClick={handleSendAllForApproval}
                        className="bg-primary text-on-primary px-6 py-2 rounded-2xl text-xs font-black shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2"
                     >
                        <span className="material-symbols-outlined text-sm">send</span>
                        GỬI PHÊ DUYỆT TẤT CẢ
                     </button>
                   )}
                </div>
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Tìm trong danh sách..." 
                    className="bg-white border border-outline-variant/20 rounded-full px-6 py-2.5 text-xs font-bold outline-none w-64 focus:ring-4 focus:ring-primary/10 transition-all font-manrope"
                    value={draftSearchQuery}
                    onChange={e => setDraftSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                       if (e.key === 'Enter') {
                          // Handled via filter
                       }
                    }}
                  />
                </div>
             </div>
             <div className="overflow-x-auto font-manrope">
                <table className="w-full text-left">
                   <thead>
                      <tr className="bg-surface-container-high text-on-surface-variant uppercase text-[10px] font-black tracking-widest border-b border-outline-variant/10">
                         <th className="px-8 py-5">Mã / Vật Tư</th>
                         <th className="px-8 py-5 text-center">Vị Trí</th>
                         <th className="px-8 py-5 text-center">Hệ Thống</th>
                         <th className="px-8 py-5 text-center">Thực Tế</th>
                         <th className="px-8 py-5 text-center">Chênh Lệch</th>
                         <th className="px-8 py-5 text-right">Thao Tác</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-outline-variant/10 font-medium">
                      {auditItems.filter(i => i.erp_code.toLowerCase().includes(draftSearchQuery.toLowerCase())).map(item => (
                        <tr key={item.id} className="hover:bg-primary/5 transition-colors">
                          <td className="px-8 py-5">
                             <div className="font-black text-sm text-primary font-mono tracking-tight">{item.erp_code}</div>
                             <div className="text-xs font-bold text-on-surface line-clamp-1 opacity-80">{item.name}</div>
                          </td>
                          <td className="px-8 py-5 text-center">
                             <span className="bg-surface-container-high px-3 py-1 rounded-lg text-[10px] font-black border border-outline-variant/10">{item.location}</span>
                          </td>
                          <td className="px-8 py-5 text-center font-bold text-on-surface-variant">{item.system_qty}</td>
                          <td className="px-8 py-5 text-center font-black text-on-surface text-lg">{item.actual_qty}</td>
                          <td className="px-8 py-5 text-center">
                             <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${item.difference >= 0 ? 'bg-primary/10 text-primary' : 'bg-error/10 text-error'}`}>
                                {item.difference > 0 ? `+${item.difference}` : item.difference}
                             </span>
                          </td>
                          <td className="px-8 py-5 text-right">
                              <div className="flex justify-end gap-3">
                                <button 
                                   onClick={() => handleSendOneForApproval(item.id)}
                                   className="w-10 h-10 flex items-center justify-center hover:bg-emerald-500/10 text-emerald-600 rounded-xl transition-all"
                                   title="Gửi phê duyệt">
                                   <span className="material-symbols-outlined text-[20px]">send</span>
                                </button>
                                <button onClick={() => {
                                     setEditingRecord(item);
                                     setActiveScanItem({ erp: item.erp_code, name: item.name });
                                     setActualQtyInput(item.actual_qty);
                                     setLocationInput(item.location || '');
                                     setNoteInput(item.note || '');
                                   }} 
                                   className="w-10 h-10 flex items-center justify-center hover:bg-primary/10 text-primary rounded-xl transition-all"
                                   title="Sửa">
                                   <span className="material-symbols-outlined text-[20px]">edit</span>
                                </button>
                                <button 
                                   onClick={() => handleDeleteAuditRecord(item.id)}
                                   className="w-10 h-10 flex items-center justify-center hover:bg-error/10 text-error rounded-xl transition-all"
                                   title="Xóa">
                                   <span className="material-symbols-outlined text-[20px]">delete_forever</span>
                                </button>
                              </div>
                          </td>
                        </tr>
                      ))}
                   </tbody>
                </table>
                {auditItems.length === 0 && (
                  <div className="py-20 text-center bg-surface-container-lowest">
                     <span className="material-symbols-outlined text-6xl text-outline-variant mb-4">inventory_2</span>
                     <p className="text-on-surface-variant font-black text-sm uppercase tracking-widest italic opacity-60">Chưa có mã nào đang kiểm.</p>
                  </div>
                )}
             </div>
          </div>
          )}
        </div>
      )}

      {activeTab === 'pending' && (
        <div className="space-y-6">
          {!(currentSession?.id && currentSession.id !== '00000000-0000-0000-0000-000000000000') ? (
            <div className="bg-surface-container-lowest rounded-3xl shadow-sm border border-outline-variant/10 overflow-hidden py-20 text-center flex flex-col items-center">
              <span className="material-symbols-outlined text-6xl text-primary opacity-20 mb-4 scale-125">rule_folder</span>
              <p className="text-on-surface-variant font-black text-sm uppercase tracking-widest italic tracking-tighter">Vui lòng chọn hoặc tạo Phiên Kiểm Kê ở khung "Thông tin" phía trên</p>
            </div>
          ) : (
            <div className="bg-surface-container-lowest rounded-3xl shadow-sm border border-outline-variant/10 overflow-hidden">
               <div className="p-6 bg-surface-container-low/50 border-b border-outline-variant/10 space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                 <h4 className="text-sm font-black text-on-surface uppercase tracking-wider">Danh Sách Chờ Phê Duyệt</h4>
                 {isAdmin && (
                   <button
                      onClick={handleApproveAll}
                      className="bg-emerald-600 text-white px-6 py-2 rounded-2xl text-xs font-black shadow-xl shadow-emerald-200 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2"
                   >
                    <span className="material-symbols-outlined text-sm">done_all</span>
                    DUYỆT TẤT CẢ ({pendingRecords.length})
                   </button>
                 )}
                 {selectedRecords.length > 0 && !isAdmin && (
                   <div className="flex gap-2 animate-in slide-in-from-left-4 duration-300">
                      <button onClick={() => handleBatchAction('approve')} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-black shadow-lg shadow-emerald-200 uppercase">Duyệt ({selectedRecords.length})</button>
                      <button onClick={() => handleBatchAction('undo')} className="bg-red-600 text-white px-4 py-2 rounded-xl text-xs font-black shadow-lg shadow-red-200 uppercase">Hủy</button>
                   </div>
                 )}
              </div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-on-surface-variant">Tổng chờ duyệt:</span>
                  <span className="px-2.5 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-black">{pendingRecords.length}</span>
                </div>
                {pendingSearch.trim() && (
                  <span className="text-xs text-on-surface-variant">
                    Đang lọc: <strong className="text-primary">{filteredPendingRecords.length}</strong> / {pendingRecords.length}
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-base pointer-events-none">search</span>
                <input
                  value={pendingSearch}
                  onChange={e => setPendingSearch(e.target.value)}
                  placeholder="Tìm mã ERP, tên vật tư, vị trí, người kiểm..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl text-sm border border-outline-variant/30 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>
           </div>
           <div className="overflow-x-auto">
              <table className="w-full text-left">
                 <thead>
                    <tr className="bg-surface-container-high text-on-surface-variant uppercase text-[10px] font-black tracking-widest border-b border-outline-variant/10">
                       <th className="px-6 py-4">
                          <input 
                            type="checkbox" 
                            className="w-4 h-4 rounded text-primary focus:ring-primary outline-none cursor-pointer"
                            onChange={(e) => {
                               if (e.target.checked) setSelectedRecords(filteredPendingRecords.map(r => r.id));
                               else setSelectedRecords([]);
                            }}
                          />
                       </th>
                       <th className="px-6 py-4">Mã / Vật Tư</th>
                       <th className="px-6 py-4">Vị Trí</th>
                       <th className="px-6 py-4 text-center">SL Thực Tế</th>
                       <th className="px-6 py-4 text-center">Chênh Lệch</th>
                       <th className="px-6 py-4">Người Kiểm</th>
                       <th className="px-6 py-4">Ngày</th>
                       <th className="px-6 py-4 text-right">Thao Tác</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-outline-variant/10">
                    {filteredPendingRecords.map(item => (
                      <tr key={item.id} className="hover:bg-primary/5 transition-colors">
                        <td className="px-6 py-4">
                           <input 
                              type="checkbox" 
                              checked={selectedRecords.includes(item.id)}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedRecords(prev => [...prev, item.id]);
                                else setSelectedRecords(prev => prev.filter(id => id !== item.id));
                              }}
                              className="w-4 h-4 rounded text-primary focus:ring-primary outline-none cursor-pointer" 
                           />
                        </td>
                        <td className="px-6 py-4">
                           <div className="font-black text-sm text-primary font-mono">{item.erp_code}</div>
                           <div className="text-xs font-bold text-on-surface line-clamp-1">{item.name}</div>
                        </td>
                        <td className="px-6 py-4">
                           <span className="bg-surface-container px-2 py-0.5 rounded text-[10px] font-black">{item.location}</span>
                        </td>
                        <td className="px-6 py-4 text-center font-black text-on-surface">{item.actual_qty}</td>
                        <td className="px-6 py-4 text-center">
                           <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${item.difference >= 0 ? 'bg-primary/10 text-primary' : 'bg-error/10 text-error'}`}>
                              {item.difference > 0 ? `+${item.difference}` : item.difference}
                           </span>
                        </td>
                        <td className="px-6 py-4 text-[10px] font-bold text-on-surface-variant italic">{item.auditor}</td>
                        <td className="px-6 py-4 text-[10px] font-bold text-on-surface-variant italic">{new Date(item.created_at).toLocaleDateString('vi-VN')}</td>
                        <td className="px-6 py-4 text-right">
                           <div className="flex justify-end gap-2 text-xs">
                              <button 
                                onClick={() => handleApprove(item.id)}
                                className="p-2 bg-emerald-600 text-white rounded-lg shadow-sm hover:scale-105 transition-transform"
                                title="Phê duyệt"
                              >
                                 <span className="material-symbols-outlined text-sm">check_circle</span>
                              </button>
                              <button 
                                onClick={() => handleUndo(item.id)}
                                className="p-2 bg-red-600 text-white rounded-lg shadow-sm hover:scale-105 transition-transform"
                                title="Hủy/Hoàn tác"
                              >
                                 <span className="material-symbols-outlined text-sm">undo</span>
                              </button>
                           </div>
                        </td>
                      </tr>
                    ))}
                    {filteredPendingRecords.length === 0 && (
                      <tr><td colSpan={8} className="px-6 py-12 text-center text-on-surface-variant italic text-xs">
                        {pendingSearch ? `Không tìm thấy kết quả cho "${pendingSearch}"` : 'Không có bản ghi nào đang chờ duyệt.'}
                      </td></tr>
                    )}
                 </tbody>
              </table>
           </div>
          </div>
         )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
           {/* FILTER HISTORY */}
           <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 flex flex-wrap gap-6 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2 ml-1">Tìm theo Mã ERP</label>
                <div className="flex bg-white rounded-2xl px-5 py-3.5 border border-outline-variant/20 focus-within:border-primary shadow-sm transition-all">
                  <span className="material-symbols-outlined text-on-surface-variant mr-3">search</span>
                  <input 
                    type="text" 
                    placeholder="VD: YBCB..." 
                    className="bg-transparent border-none text-sm font-black focus:ring-0 outline-none w-full"
                    value={searchErp}
                    onChange={e => setSearchErp(e.target.value)}
                    onKeyDown={(e) => {
                       if (e.key === 'Enter') {
                          fetchApprovedHistory();
                       }
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2 ml-1">Từ ngày</label>
                <input 
                  type="date"
                  className="bg-white border border-outline-variant/20 rounded-2xl px-5 py-3.5 text-sm font-black focus:ring-4 focus:ring-primary/10 outline-none shadow-sm"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2 ml-1">Đến ngày</label>
                <input 
                  type="date"
                  className="bg-white border border-outline-variant/20 rounded-2xl px-5 py-3.5 text-sm font-black focus:ring-4 focus:ring-primary/10 outline-none shadow-sm"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                />
              </div>
              <button 
                onClick={exportToExcel}
                disabled={isExporting}
                className="bg-surface-container-highest text-on-surface px-6 py-3.5 rounded-2xl text-xs font-black hover:bg-surface-container-high transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-sm">{isExporting ? 'sync' : 'download'}</span>
                {isExporting ? 'ĐANG XUẤT...' : 'XUẤT EXCEL'}
              </button>
           </div>

           <div className="bg-surface-container-lowest rounded-3xl shadow-sm border border-outline-variant/10 overflow-hidden">
              <div className="p-8 bg-surface-container-low/50 flex justify-between items-center border-b border-outline-variant/10">
                 <h4 className="text-sm font-black text-on-surface uppercase tracking-wider">Lịch Sử Kiểm Kê Đã Duyệt</h4>
              </div>
              <div className="overflow-x-auto font-manrope">
                 <table className="w-full text-left">
                    <thead>
                       <tr className="bg-surface-container-high text-on-surface-variant uppercase text-[10px] font-black tracking-widest border-b border-outline-variant/10">
                          <th className="px-8 py-5">Mã / Vật Tư</th>
                          <th className="px-8 py-5 text-center">Vị Trí</th>
                          <th className="px-8 py-5 text-center">Thực Tế</th>
                          <th className="px-8 py-5 text-center">Chênh Lệch</th>
                          <th className="px-8 py-5">Người Kiểm</th>
                          <th className="px-8 py-5">Trạng Thái</th>
                          <th className="px-8 py-5">Người Duyệt / Ngày</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10 font-medium">
                       {historyItems.map(item => (
                         <tr key={item.id} className="hover:bg-primary/5 transition-colors">
                           <td className="px-8 py-5">
                              <div className="font-black text-sm text-primary font-mono tracking-tight">{item.erp_code}</div>
                              <div className="text-xs font-bold text-on-surface line-clamp-1 opacity-80">{item.name}</div>
                           </td>
                           <td className="px-8 py-5 text-center">
                              <span className="bg-surface-container-high px-3 py-1 rounded-lg text-[10px] font-black border border-outline-variant/10">{item.location}</span>
                           </td>
                           <td className="px-8 py-5 text-center font-black text-on-surface text-lg">{item.actual_qty}</td>
                           <td className="px-8 py-5 text-center">
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${item.difference >= 0 ? 'bg-primary/10 text-primary' : 'bg-error/10 text-error'}`}>
                                 {item.difference > 0 ? `+${item.difference}` : item.difference}
                              </span>
                           </td>
                           <td className="px-8 py-5 text-[10px] font-bold text-on-surface-variant italic">{item.auditor}</td>
                           <td className="px-8 py-5">
                              <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${item.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-error/10 text-error'}`}>
                                 {item.status === 'Approved' ? 'ĐÃ DUYỆT' : 'TỪ CHỐI'}
                              </span>
                           </td>
                           <td className="px-8 py-5 text-[10px] font-bold text-on-surface-variant italic">
                              <div className="font-black text-on-surface">{item.approver}</div>
                              <div className="opacity-60">{new Date(item.approved_at).toLocaleString('vi-VN')}</div>
                           </td>
                           <td className="px-8 py-5 text-right">
                              {item.status === 'Approved' && (
                                <button 
                                  onClick={() => handleUndoRecord(item)}
                                  className="w-10 h-10 flex items-center justify-center hover:bg-error/10 text-error rounded-xl transition-all"
                                  title="Hủy Duyệt"
                                >
                                   <span className="material-symbols-outlined text-[20px]">undo</span>
                                </button>
                              )}
                           </td>
                         </tr>
                       ))}
                       {historyItems.length === 0 && (
                         <tr><td colSpan={7} className="px-8 py-20 text-center text-on-surface-variant italic text-xs opacity-60">Không tìm thấy lịch sử phù hợp.</td></tr>
                       )}
                    </tbody>
                 </table>
              </div>
           </div>
        </div>
      )}

      {/* MODAL KHAI BÁO KIỂM ĐẾM THỰC TẾ */}
      {activeScanItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-scrim/70 backdrop-blur-md">
          <div className="bg-surface-container-lowest rounded-3xl shadow-2xl w-full max-w-xl p-0 animate-in fade-in zoom-in-95 duration-200 border border-outline-variant/10 overflow-hidden">
            <div className="p-8 pb-4">
              <h3 className="text-2xl font-black font-manrope text-on-surface flex items-center gap-3 mb-4">
                <div className="bg-primary/10 text-primary p-2 rounded-xl">
                  <span className="material-symbols-outlined">qr_code_scanner</span>
                </div>
                Khai Báo Kiểm Đếm
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-surface-container-low p-5 rounded-2xl border border-outline-variant/10 shadow-inner">
                   <div className="text-primary font-black text-xl font-mono tracking-tight">{activeScanItem.erp}</div>
                   <div className="text-sm font-bold text-on-surface mt-1 leading-tight">{activeScanItem.name}</div>
                </div>
                
                <div className="bg-primary/5 p-5 rounded-2xl border border-primary/10">
                   <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-3">Tồn kho theo vị trí (Hệ thống)</p>
                   <div className="space-y-2 max-h-[120px] overflow-y-auto pr-2 no-scrollbar">
                      {itemLocations.map((loc, idx) => (
                        <div key={idx} className="flex justify-between items-center bg-white/50 p-2 rounded-lg border border-primary/5">
                           <span className="text-xs font-black">{loc.pos || 'N/A'}</span>
                           <span className="text-xs font-bold text-primary">{loc.end_stock?.toLocaleString('en-US') || 0}</span>
                        </div>
                      ))}
                      {itemLocations.length === 0 && (
                        <div className="text-[10px] font-bold text-on-surface-variant italic text-center py-2">Không tìm thấy dữ liệu vị trí</div>
                      )}
                   </div>
                </div>
              </div>
            </div>
            
            <div className="p-8 pt-0 space-y-6">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                   <label className="block text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2 ml-1">Vị trí kiểm đếm (Location) *</label>
                   <div className="flex gap-2">
                     <div className="relative flex-1">
                       <input 
                          list="location-list"
                          className="w-full bg-surface-container-low border-2 border-outline-variant/20 rounded-2xl px-5 py-4 text-sm font-black focus:border-primary/50 focus:ring-0 outline-none transition-all uppercase"
                          value={locationInput}
                          onChange={e => setLocationInput(e.target.value)}
                          placeholder="Chọn/Nhập vị trí..."
                       />
                       <datalist id="location-list">
                         {itemLocations.map((loc, idx) => (
                           <option key={idx} value={loc.pos} />
                         ))}
                         {locationSuggestions.map(loc => (
                           <option key={loc.name} value={loc.name} />
                         ))}
                       </datalist>
                     </div>
                   </div>
                </div>

                <div>
                   <label className="block text-[10px] font-black text-primary uppercase tracking-widest mb-2 ml-1">Số lượng thực tế *</label>
                   <input 
                      autoFocus
                      type="number"
                      className="w-full bg-surface-container-lowest border-2 border-primary/40 rounded-2xl px-5 py-4 text-2xl font-black text-primary focus:border-primary focus:ring-[12px] focus:ring-primary/10 outline-none shadow-xl shadow-primary/10 transition-all text-center"
                      value={actualQtyInput}
                      onChange={e => setActualQtyInput(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="Số lượng..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && actualQtyInput !== '' && locationInput.trim()) {
                          handleSaveAuditRecord();
                        }
                      }}
                   />
                </div>
               </div>

                <div>
                   <label className="block text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-2 ml-1">Ghi chú kiểm đếm</label>
                   <input 
                      className="w-full bg-surface-container-low border border-outline-variant/30 rounded-2xl px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                      value={noteInput}
                      onChange={e => setNoteInput(e.target.value)}
                      placeholder="Ghi chú nếu có..."
                   />
                </div>

                <div className="grid grid-cols-2 gap-4 pb-4">
                  <button onClick={() => setActiveScanItem(null)} className="py-4 rounded-2xl text-sm font-black bg-surface-container hover:bg-surface-container-high transition-colors">HỦY BỎ</button>
                  <button 
                    onClick={handleSaveAuditRecord} 
                    disabled={loading}
                    className="py-4 rounded-2xl text-sm font-black bg-primary text-on-primary shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                  >
                    {loading ? 'ĐANG LƯU...' : 'XÁC NHẬN LƯU'}
                  </button>
                </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Audit;
