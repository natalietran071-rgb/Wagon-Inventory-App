import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import { tr } from '../contexts/LanguageContext';

interface ItemHistoryModalProps {
  erpCode: string;
  isOpen: boolean;
  onClose: () => void;
  itemName?: string;
}

const ItemHistoryModal: React.FC<ItemHistoryModalProps> = ({ erpCode, isOpen, onClose, itemName }) => {
  const { t } = useLanguage();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Summaries
  const [summary, setSummary] = useState({
    totalIn: 0,
    totalOut: 0,
    balance: 0
  });

  const fetchHistory = async () => {
    if (!isOpen || !erpCode) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_item_history', {
        p_erp: erpCode,
        p_from_date: fromDate || null,
        p_to_date: toDate || null,
        p_type: filterType
      });

      if (error) throw error;
      setHistory(data || []);

      // Calculate totals
      const totals = (data || []).reduce((acc: any, item: any) => {
        if (item.loai === 'Nhập') acc.totalIn += Number(item.so_luong);
        else if (item.loai === 'Xuất') acc.totalOut += Number(item.so_luong);
        return acc;
      }, { totalIn: 0, totalOut: 0 });

      setSummary({
        totalIn: totals.totalIn,
        totalOut: totals.totalOut,
        balance: totals.totalIn - totals.totalOut
      });
    } catch (error) {
      console.error('Error fetching item history:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [isOpen, erpCode, filterType, fromDate, toDate]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-surface w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center justify-between bg-surface-container-low">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined">history</span>
              </div>
              <div>
                <h3 className="text-lg font-black text-on-surface uppercase tracking-tight">{tr("Lịch Sử Nhập Xuất")}</h3>
                <p className="text-xs text-on-surface-variant font-medium">ERP: <span className="text-primary font-bold">{erpCode}</span> {itemName && `| ${itemName}`}</p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="w-10 h-10 rounded-full hover:bg-surface-variant/20 flex items-center justify-center transition-colors"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Filters */}
          <div className="px-6 py-4 bg-surface-container-lowest/50 border-b border-outline-variant/5 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-1.5 block ml-1 opacity-70">{tr("Loại record")}</label>
              <select 
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full h-11 bg-surface-container/50 border border-outline-variant/20 rounded-xl px-4 text-sm font-medium focus:ring-2 focus:ring-primary/20 transition-all outline-none"
              >
                <option value="all">{tr("Tất cả")}</option>
                <option value="inbound">{tr("Chỉ Nhập")}</option>
                <option value="outbound">{tr("Chỉ Xuất")}</option>
              </select>
            </div>
            
            <div>
              <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-1.5 block ml-1 opacity-70">{tr("Từ ngày")}</label>
              <input 
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full h-11 bg-surface-container/50 border border-outline-variant/20 rounded-xl px-4 text-sm font-medium focus:ring-2 focus:ring-primary/20 transition-all outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-1.5 block ml-1 opacity-70">{tr("Đến ngày")}</label>
              <input 
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full h-11 bg-surface-container/50 border border-outline-variant/20 rounded-xl px-4 text-sm font-medium focus:ring-2 focus:ring-primary/20 transition-all outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => { setFilterType('all'); setFromDate(''); setToDate(''); }}
                className="h-11 flex-1 bg-surface-container-high/50 text-on-surface-variant rounded-xl text-xs font-black uppercase tracking-widest hover:bg-surface-container-high transition-all"
              >
                {tr("Đặt lại")}
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto p-0 scrollbar-thin scrollbar-thumb-outline-variant/20">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-12 h-12 border-4 border-primary/10 border-t-primary rounded-full animate-spin"></div>
                <p className="text-sm font-bold text-on-surface-variant animate-pulse">{tr("Đang tải lịch sử...")}</p>
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 opacity-40">
                <span className="material-symbols-outlined text-6xl">history_toggle_off</span>
                <p className="font-bold text-lg uppercase tracking-widest text-center px-6">{tr("Không có dữ liệu lịch sử")}</p>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-surface-container-low z-10">
                  <tr>
                    <th className="px-6 py-4 text-left text-[11px] font-black text-on-surface-variant uppercase tracking-widest">{tr("Loại")}</th>
                    <th className="px-6 py-4 text-left text-[11px] font-black text-on-surface-variant uppercase tracking-widest">{tr("Mã phiếu")}</th>
                    <th className="px-6 py-4 text-left text-[11px] font-black text-on-surface-variant uppercase tracking-widest">{tr("Ngày")}</th>
                    <th className="px-6 py-4 text-right text-[11px] font-black text-on-surface-variant uppercase tracking-widest">{tr("Số lượng")}</th>
                    <th className="px-6 py-4 text-left text-[11px] font-black text-on-surface-variant uppercase tracking-widest">{tr("Đơn vị")}</th>
                    <th className="px-6 py-4 text-left text-[11px] font-black text-on-surface-variant uppercase tracking-widest">{tr("Vị trí")}</th>
                    <th className="px-6 py-4 text-left text-[11px] font-black text-on-surface-variant uppercase tracking-widest">{tr("Đối tác")}</th>
                    <th className="px-6 py-4 text-center text-[11px] font-black text-on-surface-variant uppercase tracking-widest">{tr("Trạng thái")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {history.map((item, idx) => (
                    <tr key={`${item.ma_phieu}-${idx}`} className="group hover:bg-surface-variant/5">
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter ${item.loai === 'Nhập' 
                          ? 'bg-primary/10 text-primary' 
                          : 'bg-error/10 text-error'}`}>
                          <span className="material-symbols-outlined text-sm">
                            {item.loai === 'Nhập' ? 'login' : 'logout'}
                          </span>
                          {tr(item.loai)}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs font-bold text-on-surface-variant opacity-80 group-hover:opacity-100">{item.ma_phieu}</td>
                      <td className="px-6 py-4 text-xs font-medium text-on-surface-variant">{item.ngay}</td>
                      <td className={`px-6 py-4 text-right font-black ${item.loai === 'Nhập' ? 'text-primary' : 'text-error'}`}>
                        {item.loai === 'Nhập' ? `+${Number(item.so_luong).toLocaleString()}` : `-${Number(item.so_luong).toLocaleString()}`}
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-on-surface-variant">{item.don_vi || '-'}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 bg-surface-container px-2 py-1 rounded-md border border-outline-variant/10 w-fit">
                          <span className="material-symbols-outlined text-xs text-on-surface-variant opacity-60">location_on</span>
                          <span className="text-[11px] font-bold text-on-surface-variant uppercase">{item.vi_tri || '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-on-surface-variant max-w-[150px] truncate" title={item.doi_tac}>{item.doi_tac || '-'}</td>
                      <td className="px-6 py-4 text-center">
                        <span className="text-[10px] font-bold text-on-surface-variant/60">{item.trang_thai}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer Summaries */}
          <div className="px-6 py-6 bg-surface-container-low border-t border-outline-variant/10 grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-surface p-4 rounded-2xl border border-outline-variant/10 shadow-sm">
              <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-1 opacity-60">{tr("Tổng Nhập")}</p>
              <h4 className="text-xl font-black text-primary">+{summary.totalIn.toLocaleString()}</h4>
            </div>
            <div className="bg-surface p-4 rounded-2xl border border-outline-variant/10 shadow-sm">
              <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-1 opacity-60">{tr("Tổng Xuất")}</p>
              <h4 className="text-xl font-black text-error">-{summary.totalOut.toLocaleString()}</h4>
            </div>
            <div className="bg-surface p-4 rounded-2xl border border-outline-variant/10 shadow-sm col-span-2 lg:col-span-1">
              <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest mb-1 opacity-60">{tr("Chênh lệch (Balance)")}</p>
              <h4 className={`text-xl font-black ${summary.balance >= 0 ? 'text-primary' : 'text-error'}`}>
                {summary.balance > 0 ? '+' : ''}{summary.balance.toLocaleString()}
              </h4>
            </div>
            <div className="hidden lg:flex items-end justify-end">
              <button 
                onClick={onClose}
                className="px-8 py-3 bg-on-surface text-surface rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-on-surface-variant transition-all active:scale-95 shadow-lg shadow-on-surface/10"
              >
                {tr("Đóng")}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ItemHistoryModal;
