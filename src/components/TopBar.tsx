import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage, Language } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Html5Qrcode } from 'html5-qrcode';
import { tr } from '../contexts/LanguageContext';

const TopBar = ({ title, onToggleSidebar }: { title: string, onToggleSidebar?: () => void }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { language, setLanguage, t } = useLanguage();
  const { user } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showLangMenu, setShowLangMenu] = useState(false);
  
  const [scannedItem, setScannedItem] = useState<any | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);

  const qrRef = useRef<Html5Qrcode | null>(null);

  const handleScannedCode = async (decodedText: string) => {
    setIsQuerying(true);
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .eq('erp', decodedText)
        .single();
      
      if (error || !data) {
        setNotFoundCode(decodedText);
        setScannedItem(null);
      } else {
        setScannedItem(data);
        setNotFoundCode(null);
      }
      setShowResultModal(true);
      window.dispatchEvent(new CustomEvent('qr-scanned', { detail: { code: decodedText } }));
    } catch (err) {
      console.error("Error querying scanned code:", err);
    } finally {
      setIsQuerying(false);
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (isScanning) {
      setScanError(null);
      const startScanner = async () => {
        try {
          qrRef.current = new Html5Qrcode("reader");
          await qrRef.current.start(
            { facingMode: "environment" },
            { 
              fps: 10, 
              qrbox: (viewWidth, viewHeight) => {
                const size = Math.min(viewWidth, viewHeight) * 0.7;
                return { width: size, height: size };
              } 
            },
            (decodedText) => {
              handleScannedCode(decodedText);
            },
            undefined
          );
        } catch (err: any) {
          console.error("QR Code Scanner error:", err);
          if (err?.toString()?.includes('NotAllowedError') || err?.toString()?.includes('Permission denied')) {
            setScanError(tr("Quyền truy cập Camera bị từ chối. Vui lòng kiểm tra cài đặt trình duyệt và cấp quyền camera cho trang web."));
          } else {
            setScanError(tr("Không thể khởi động camera. Lỗi:") + (err?.message || err?.toString()));
          }
        }
      };

      // Delay a bit to ensure element is in DOM
      const timer = setTimeout(startScanner, 300);
      return () => {
        clearTimeout(timer);
        if (qrRef.current && qrRef.current.isScanning) {
          qrRef.current.stop().catch(console.error);
        }
      };
    }
  }, [isScanning]);

  const languages: { code: Language; label: string; flag: string }[] = [
    { code: 'vi', label: tr("Tiếng Việt"), flag: '🇻🇳' },
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'zh', label: '繁體中文', flag: '🇹🇼' },
  ];

  return (
    <header className="fixed top-0 right-0 left-0 lg:left-64 h-16 md:h-20 z-30 glass-panel flex justify-between items-center px-4 md:px-10 transition-all duration-300">
      <div className="flex items-center gap-2 md:gap-6 flex-1 min-w-0">
        <button 
          onClick={onToggleSidebar}
          className="lg:hidden p-2 text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors"
        >
          <span className="material-symbols-outlined text-xl">menu</span>
        </button>
        <h2 className="text-lg md:text-2xl font-black text-on-surface font-manrope tracking-tighter truncate">{title ? (t(title.toLowerCase().replace(' ', '')) || title) : ''}</h2>
        <button 
          onClick={() => setIsScanning(true)}
          className="hidden md:flex items-center gap-2.5 bg-primary/10 text-primary px-5 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-primary hover:text-on-primary shadow-sm hover:shadow-lg hover:shadow-primary/20 transition-all"
        >
          <span className="material-symbols-outlined text-base">qr_code_scanner</span>
          {t('scanQR')}
        </button>
        <button
          onClick={() => setIsScanning(true)}
          className="md:hidden flex items-center justify-center bg-primary/10 text-primary w-9 h-9 rounded-lg hover:bg-primary hover:text-on-primary transition-all shrink-0"
        >
          <span className="material-symbols-outlined text-lg">qr_code_scanner</span>
        </button>
      </div>

      <AnimatePresence>
        {isScanning && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsScanning(false)}
              className="absolute inset-0 bg-on-surface/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-surface-container-lowest p-8 rounded-[2.5rem] shadow-2xl max-w-md w-full border border-outline-variant/10 text-center"
            >
              <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center text-primary mx-auto mb-6">
                <span className="material-symbols-outlined text-4xl animate-pulse">qr_code_scanner</span>
              </div>
              <h3 className="text-2xl font-black text-on-surface mb-2">
                {scanError ? tr("Lỗi Camera") : isQuerying ? tr("Đang truy vấn vật tư...") : tr("Đang khởi động Camera...")}
              </h3>
              <p className={`text-sm mb-8 ${scanError ? "text-error font-bold" : "text-on-surface-variant font-medium"}`}>
                {scanError || (isQuerying ? tr("Vui lòng đợi trong giây lát.") : tr("Vui lòng đưa mã QR vào khung hình để hệ thống tự động nhận diện vật tư."))}
              </p>
              <div className={`aspect-video bg-black rounded-2xl mb-8 relative overflow-hidden flex items-center justify-center border-4 shadow-inner transition-colors ${scanError ? "border-error/20" : "border-primary/20"}`}>
                <div id="reader" className="w-full h-full"></div>
                {(!qrRef.current?.isScanning || isQuerying) && !scanError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-20">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      {isQuerying && <p className="text-white text-xs font-bold uppercase tracking-widest">{tr("Đang tìm kiếm...")}</p>}
                    </div>
                  </div>
                )}
                {scanError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-error/10 flex-col gap-4 p-6">
                    <span className="material-symbols-outlined text-5xl text-error">no_photography</span>
                    <button 
                      onClick={() => setIsScanning(false)}
                      className="text-xs text-error font-bold underline px-4 py-2 hover:bg-error/10 rounded-lg transition-colors"
                    >
                      {tr("Đóng và thử lại sau")}
                    </button>
                  </div>
                )}
                <div className={`w-full h-[2px] bg-primary absolute top-1/2 -translate-y-1/2 animate-[scan_2s_infinite] pointer-events-none z-10 opacity-50 ${scanError ? 'hidden' : ''}`}></div>
              </div>
              <button 
                onClick={() => setIsScanning(false)}
                className="w-full py-4 rounded-2xl font-bold text-sm bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-colors"
              >
                {t('cancel')}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showResultModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowResultModal(false)}
              className="absolute inset-0 bg-on-surface/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ y: 20, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.95 }}
              className="relative bg-surface-container-lowest p-6 rounded-[2rem] shadow-2xl max-w-lg w-full border border-outline-variant/10"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl ${scannedItem ? 'bg-primary/10 text-primary' : 'bg-error/10 text-error'}`}>
                    <span className="material-symbols-outlined">{scannedItem ? 'inventory_2' : 'warning'}</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-on-surface">{scannedItem ? tr("Thông Tin Vật Tư") : tr("Không Tìm Thấy")}</h3>
                    <p className="text-sm text-on-surface-variant font-medium">{tr("Kết quả quét mã QR")}</p>
                  </div>
                </div>
                <button onClick={() => setShowResultModal(false)} className="w-10 h-10 rounded-full hover:bg-surface-container transition-colors flex items-center justify-center">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {scannedItem ? (
                <div className="space-y-6">
                  <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">{tr("Mã ERP")}</p>
                        <h4 className="text-lg font-black text-on-surface">{scannedItem.erp}</h4>
                      </div>
                      {scannedItem.critical && (
                        <span className="px-3 py-1 bg-error/10 text-error rounded-full text-[10px] font-bold uppercase tracking-wider">{tr("Tồn Kho Thấp!")}</span>
                      )}
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                         <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">{tr("Tên Vật Tư")}</p>
                         <p className="text-sm font-bold text-on-surface line-clamp-2">{scannedItem.name}</p>
                         {scannedItem.name_zh && <p className="text-sm text-on-surface-variant/70 italic mt-0.5">{scannedItem.name_zh}</p>}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant/5">
                          <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">{tr("Số Lượng Tồn")}</p>
                          <p className={`text-xl font-black ${scannedItem.end_stock <= (scannedItem.min_stock || 0) ? 'text-error' : 'text-primary'}`}>
                            {scannedItem.end_stock}
                          </p>
                        </div>
                        <div className="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant/5">
                          <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">{tr("Vị Trí")}</p>
                          <p className="text-xl font-black text-on-surface">{scannedItem.pos || '---'}</p>
                        </div>
                      </div>

                      <div>
                         <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">{tr("Quy Cách")}</p>
                         <p className="text-sm font-medium text-on-surface bg-surface-container-highest/20 px-3 py-2 rounded-lg">{scannedItem.spec || tr("Không có quy cách")}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => {
                        navigate('/inbound', { state: { scannedErp: scannedItem.erp } });
                        setShowResultModal(false);
                      }}
                      className="flex flex-col items-center gap-2 p-4 bg-primary text-on-primary rounded-3xl hover:shadow-lg hover:shadow-primary/30 transition-all font-bold"
                    >
                      <span className="material-symbols-outlined">add_box</span>
                      <span className="text-xs uppercase tracking-widest">{tr("Nhập Kho")}</span>
                    </button>
                    <button 
                      onClick={() => {
                        navigate('/outbound', { state: { scannedErp: scannedItem.erp } });
                        setShowResultModal(false);
                      }}
                      className="flex flex-col items-center gap-2 p-4 bg-secondary text-on-secondary rounded-3xl hover:shadow-lg hover:shadow-secondary/30 transition-all font-bold"
                    >
                      <span className="material-symbols-outlined">output</span>
                      <span className="text-xs uppercase tracking-widest">{tr("Xuất Kho")}</span>
                    </button>
                    <button 
                      onClick={() => {
                        navigate('/audit', { state: { scannedErp: scannedItem.erp } });
                        setShowResultModal(false);
                      }}
                      className="flex flex-col items-center gap-2 p-4 bg-surface-container-highest text-on-surface rounded-3xl hover:bg-surface-container-high transition-all font-bold"
                    >
                      <span className="material-symbols-outlined">fact_check</span>
                      <span className="text-xs uppercase tracking-widest">{tr("Kiểm Kê")}</span>
                    </button>
                    <button 
                      onClick={() => {
                        navigate('/inventory', { state: { erpSearch: scannedItem.erp } });
                        setShowResultModal(false);
                      }}
                      className="flex flex-col items-center gap-2 p-4 bg-surface-container-highest text-on-surface rounded-3xl hover:bg-surface-container-high transition-all font-bold"
                    >
                      <span className="material-symbols-outlined">search</span>
                      <span className="text-xs uppercase tracking-widest">{tr("Chi Tiết")}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center">
                  <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="material-symbols-outlined text-4xl">search_off</span>
                  </div>
                  <p className="text-lg font-bold text-on-surface mb-2">{tr("Mã")} {notFoundCode} {tr("không tồn tại")}</p>
                  <p className="text-sm text-on-surface-variant font-medium mb-8">{tr("Hệ thống không tìm thấy vật tư nào tương ứng với mã ERP này trong cơ sở dữ liệu.")}</p>
                  <button 
                    onClick={() => {
                      setIsScanning(true);
                      setShowResultModal(false);
                    }}
                    className="bg-primary text-on-primary px-8 py-3 rounded-2xl font-bold hover:shadow-lg hover:shadow-primary/30 transition-all"
                  >
                    {tr("Quét Lại")}
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes scan {
          0%, 100% { top: 20%; }
          50% { top: 80%; }
        }
      `}</style>

      <div className="flex items-center gap-1.5 md:gap-6">
        <div className="flex items-center gap-1 md:gap-2">
          <div className="relative">
            <button 
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="flex items-center gap-1 md:gap-2 px-1.5 md:px-3 py-1.5 md:py-2 rounded-lg md:rounded-xl hover:bg-surface-container transition-colors text-[10px] md:text-sm font-bold md:border md:border-outline-variant/10"
            >
              <span className="text-lg md:text-base">{languages.find(l => l.code === language)?.flag}</span>
              <span className="hidden md:inline uppercase">{language}</span>
              <span className="hidden md:inline material-symbols-outlined text-sm">expand_more</span>
            </button>
            
            <AnimatePresence>
              {showLangMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowLangMenu(false)} />
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 mt-2 w-40 bg-surface-container-lowest rounded-2xl shadow-xl border border-outline-variant/10 z-20 overflow-hidden"
                  >
                    {languages.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          setLanguage(lang.code);
                          setShowLangMenu(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold transition-colors hover:bg-surface-container-low ${language === lang.code ? 'text-primary' : 'text-on-surface-variant'}`}
                      >
                        <span>{lang.flag}</span>
                        <span>{lang.label}</span>
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <button className="p-2 text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors relative">
            <span className="material-symbols-outlined">notifications</span>
            <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full"></span>
          </button>
        </div>
        <div className="hidden md:block h-8 w-[1px] bg-outline-variant/30"></div>
        <div className="flex items-center gap-3">
          <div className="hidden md:block text-right">
            <p className="text-sm font-bold text-on-surface">{user?.email?.split('@')[0] || 'Admin User'}</p>
            <p className="text-[10px] text-on-surface-variant font-medium">Warehouse Manager</p>
          </div>
          <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary-container font-bold ring-2 ring-primary/10 text-sm md:text-base">
            {user?.email?.[0].toUpperCase() || 'A'}
          </div>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
