import React from 'react';
import { HashRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Inventory from './components/Inventory';
import Inbound from './components/Inbound';
import Outbound from './components/Outbound';
import Audit from './components/Audit';
import Login from './components/Login';
import UserManagement from './components/UserManagement';
import MasterERP from './components/MasterERP';
import Shipment from './components/Shipment';

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-6">
          <span className="material-symbols-outlined text-3xl">error</span>
        </div>
        <h2 className="text-xl font-black text-on-surface mb-2">Lỗi kết nối hệ thống</h2>
        <p className="text-on-surface-variant text-sm mb-8 max-w-md leading-relaxed">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-primary text-on-primary px-8 py-3 rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 transition-all"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const DefaultRedirect = () => {
  const { profile } = useAuth();
  if (profile?.role === 'dept_user') return <Navigate to="/shipment" replace />;
  return <Navigate to="/inventory" replace />;
};

const MasterERPRoute = () => {
  const { profile } = useAuth();
  if (profile?.role === 'dept_user') return <Navigate to="/shipment" replace />;
  return <MasterERP />;
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const getTitle = (path: string) => {
    switch (path) {
      case '/inventory': return 'Tồn Kho';
      case '/inbound': return 'Nhập Kho';
      case '/outbound': return 'Xuất Kho';
      case '/audit': return 'Kiểm Kê';
      case '/shipment': return 'Giao Hàng';
      case '/users': return 'Người dùng';
      case '/master-erp': return 'Master ERP';
      default: return 'Wagon Inventory Hub';
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="lg:pl-64 transition-all duration-300">
        <TopBar title={getTitle(location.pathname)} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        <main className="pt-20 md:pt-28 pb-8 md:pb-12 px-3 md:px-10 max-w-[1600px] mx-auto min-h-screen overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
};

function App() {
  const supabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

  if (!supabaseConfigured) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-warning/10 rounded-2xl flex items-center justify-center text-warning mb-6">
          <span className="material-symbols-outlined text-3xl">settings_suggest</span>
        </div>
        <h2 className="text-xl font-black text-on-surface mb-2">Chưa cấu hình Supabase</h2>
        <p className="text-on-surface-variant text-sm mb-8 max-w-md leading-relaxed">
          Vui lòng thiết lập <strong>VITE_SUPABASE_URL</strong> và <strong>VITE_SUPABASE_ANON_KEY</strong> trong bảng Secrets (Settings) để bắt đầu sử dụng ứng dụng.
        </p>
      </div>
    );
  }

  return (
    <AuthProvider>
      <DataProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/*" element={
              <PrivateRoute>
                <Layout>
                  <Routes>
                    <Route path="/" element={<DefaultRedirect />} />
                    <Route path="/inventory" element={<Inventory />} />
                    <Route path="/inbound" element={<Inbound />} />
                    <Route path="/outbound" element={<Outbound />} />
                    <Route path="/audit" element={<Audit />} />
                    <Route path="/shipment" element={<Shipment />} />
                    <Route path="/users" element={<UserManagement />} />
                    <Route path="/master-erp" element={<MasterERPRoute />} />
                  </Routes>
                </Layout>
              </PrivateRoute>
            } />
          </Routes>
        </Router>
      </DataProvider>
    </AuthProvider>
  );
}

export default App;
