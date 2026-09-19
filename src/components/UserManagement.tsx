import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { tr } from '../contexts/LanguageContext';

type Role = 'admin' | 'editor' | 'viewer' | 'dept_user';

interface UserProfile {
  id: string;
  login_code: string;
  username?: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  dept_code?: string | null;
  dept_name?: string | null;
  last_sign_in_at?: string | null;
  created_at: string;
}

interface Credentials {
  full_name: string;
  login_code: string;
  password: string;
  title: string;
}

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin (Quản trị viên)',
  editor: 'Editor (Chỉnh sửa / Nhập xuất)',
  viewer: 'Viewer (Chỉ xem)',
  dept_user: 'Dept User (Bộ phận)',
};

const emptyForm = {
  full_name: '',
  role: 'viewer' as Role,
  is_active: true,
  dept_code: '',
  dept_name: '',
};

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_all_users');
      if (error) throw error;
      setUsers(data || []);
    } catch (err: any) {
      console.error('Error fetching users:', err);
      alert(tr("Không tải được danh sách người dùng:") + (err.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const validateDept = () => {
    if (formData.role === 'dept_user' && !formData.dept_code.trim()) {
      alert(tr("Vui lòng nhập Mã bộ phận cho tài khoản Dept User."));
      return false;
    }
    return true;
  };

  const handleOpenAdd = () => {
    setFormData({ ...emptyForm });
    setIsAddModalOpen(true);
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateDept()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_create_user', {
        p_full_name: formData.full_name.trim(),
        p_role: formData.role,
        p_dept_code: formData.role === 'dept_user' ? formData.dept_code.trim() : null,
        p_dept_name: formData.role === 'dept_user' ? formData.dept_name.trim() || null : null,
      });
      if (error) throw error;
      if (!data || data.status !== 'success') throw new Error(data?.error || tr("Không thể tạo người dùng"));

      setIsAddModalOpen(false);
      setCredentials({
        title: tr("Tài khoản đã được tạo"),
        full_name: formData.full_name.trim(),
        login_code: data.login_code,
        password: data.password,
      });
      await fetchUsers();
    } catch (err: any) {
      console.error('Error creating user:', err);
      alert(tr("Lỗi:") + (err.message || tr("Không thể tạo người dùng")));
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (user: UserProfile) => {
    setSelectedUser(user);
    setFormData({
      full_name: user.full_name || '',
      role: user.role || 'viewer',
      is_active: user.is_active,
      dept_code: user.dept_code || '',
      dept_name: user.dept_name || '',
    });
    setIsEditModalOpen(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    if (!validateDept()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_update_user', {
        p_user_id: selectedUser.id,
        p_full_name: formData.full_name.trim(),
        p_role: formData.role,
        p_is_active: formData.is_active,
        p_dept_code: formData.role === 'dept_user' ? formData.dept_code.trim() : null,
        p_dept_name: formData.role === 'dept_user' ? formData.dept_name.trim() || null : null,
      });
      if (error) throw error;
      if (!data || data.status !== 'success') throw new Error(data?.error || tr("Không thể cập nhật"));

      setIsEditModalOpen(false);
      await fetchUsers();
    } catch (err: any) {
      console.error('Error updating user:', err);
      alert(tr("Lỗi:") + (err.message || tr("Không thể cập nhật")));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (user: UserProfile) => {
    if (!confirm(tr("Cấp mật khẩu mới cho {0}?\nMật khẩu cũ sẽ không dùng được nữa.", [user.full_name || user.login_code]))) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_reset_password', { p_user_id: user.id });
      if (error) throw error;
      if (!data || data.status !== 'success') throw new Error(data?.error || tr("Không thể cấp lại mật khẩu"));

      setCredentials({
        title: tr("Mật khẩu mới đã được cấp"),
        full_name: user.full_name,
        login_code: user.login_code,
        password: data.password,
      });
    } catch (err: any) {
      console.error('Error resetting password:', err);
      alert(tr("Lỗi:") + (err.message || tr("Không thể cấp lại mật khẩu")));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (user: UserProfile) => {
    if (!confirm(tr("Xóa người dùng {0}? Không thể hoàn tác.", [user.full_name || user.login_code]))) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_delete_user', { p_user_id: user.id });
      if (error) throw error;
      if (!data || data.status !== 'success') throw new Error(data?.error || tr("Không thể xóa"));
      setUsers(prev => prev.filter(u => u.id !== user.id));
    } catch (err: any) {
      alert(tr("Lỗi:") + (err.message || tr("Không thể xóa")));
    } finally {
      setLoading(false);
    }
  };

  const handleManualCleanup = async () => {
    if (!confirm(tr("Bạn có muốn dọn dẹp các lịch sử cũ hơn 30 ngày ngay bây giờ?"))) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('cleanup_old_history');
      if (error) throw error;
      const { deleted_history, deleted_items } = data;
      alert(tr("✅ Dọn dẹp thành công!\n- Lịch sử chỉnh sửa: {0}\n- Danh mục đã xóa: {1}", [deleted_history, deleted_items]));
    } catch (err: any) {
      console.error('Cleanup error:', err);
      alert(tr("Lỗi:") + (err.message || tr("Không thể dọn dẹp")));
    } finally {
      setLoading(false);
    }
  };

  const copyCredentials = async () => {
    if (!credentials) return;
    const text = tr("Tài khoản Wagon Inventory\nHọ tên: {0}\nMã đăng nhập: {1}\nMật khẩu: {2}", [credentials.full_name, credentials.login_code, credentials.password]);
    try {
      await navigator.clipboard.writeText(text);
      alert(tr("Đã copy mã đăng nhập và mật khẩu."));
    } catch {
      alert(tr("Không copy được, vui lòng ghi lại thủ công."));
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredUsers = users.filter(u =>
    !q ||
    u.full_name?.toLowerCase().includes(q) ||
    u.login_code?.toLowerCase().includes(q) ||
    u.dept_code?.toLowerCase().includes(q) ||
    u.dept_name?.toLowerCase().includes(q)
  );

  const inputClass = 'w-full bg-surface-container-low border-none rounded-2xl py-4 px-6 text-sm font-bold shadow-inner focus:ring-2 focus:ring-primary/20';
  const labelClass = 'block text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-3';

  const renderFormFields = (idPrefix: string, showActive: boolean) => (
    <>
      <div>
        <label className={labelClass}>{tr("Họ và tên")}</label>
        <input
          type="text" required autoFocus
          className={inputClass}
          placeholder={tr("Nhập họ và tên...")}
          value={formData.full_name}
          onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
        />
      </div>

      <div>
        <label className={labelClass}>{tr("Vai trò")}</label>
        <div className="relative">
          <select
            className={`${inputClass} appearance-none cursor-pointer`}
            value={formData.role}
            onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as Role }))}
          >
            {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
              <option key={r} value={r}>{tr(ROLE_LABELS[r])}</option>
            ))}
          </select>
          <span className="absolute right-6 top-1/2 -translate-y-1/2 material-symbols-outlined pointer-events-none text-on-surface-variant">expand_more</span>
        </div>
      </div>

      {formData.role === 'dept_user' && (
        <div className="grid grid-cols-2 gap-4 p-4 bg-amber-50 rounded-2xl border border-amber-200">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2">{tr("Mã bộ phận *")}</label>
            <input
              type="text" required
              className="w-full bg-white border border-amber-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-amber-300 outline-none uppercase"
              placeholder="VD: ACD02"
              value={formData.dept_code}
              onChange={(e) => setFormData(prev => ({ ...prev, dept_code: e.target.value.toUpperCase() }))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2">{tr("Tên bộ phận")}</label>
            <input
              type="text"
              className="w-full bg-white border border-amber-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-amber-300 outline-none"
              placeholder={tr("VD: Kế toán")}
              value={formData.dept_name}
              onChange={(e) => setFormData(prev => ({ ...prev, dept_name: e.target.value }))}
            />
          </div>
        </div>
      )}

      {showActive && (
        <div className="flex items-center gap-4 bg-surface-container-low p-5 rounded-2xl border border-outline-variant/5">
          <input
            type="checkbox"
            id={`${idPrefix}_is_active`}
            className="w-6 h-6 rounded-lg border-none bg-surface-container-highest text-primary focus:ring-primary/20 cursor-pointer"
            checked={formData.is_active}
            onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
          />
          <label htmlFor={`${idPrefix}_is_active`} className="text-sm font-bold text-on-surface cursor-pointer select-none">{tr("Kích hoạt tài khoản")}</label>
        </div>
      )}
    </>
  );

  const modalShell = (onClose: () => void, children: React.ReactNode, maxWidth = 'max-w-lg') => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-on-surface/40 backdrop-blur-md"
      />
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className={`relative bg-surface-container-lowest p-10 rounded-[2.5rem] shadow-2xl ${maxWidth} w-full border border-outline-variant/10`}
      >
        {children}
      </motion.div>
    </div>
  );

  return (
    <div className="p-4 md:p-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
        <div>
          <h2 className="text-3xl font-black text-on-surface font-manrope tracking-tight mb-2">{tr("Quản lý người dùng")}</h2>
          <p className="text-on-surface-variant font-medium">{tr("Tạo tài khoản bằng họ tên, hệ thống tự cấp mã đăng nhập và mật khẩu.")}</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <button
            onClick={fetchUsers}
            className="p-3 bg-surface-container rounded-2xl text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined">refresh</span>
          </button>
          <button
            onClick={handleManualCleanup}
            title={tr("Dọn dẹp lịch sử (>30 ngày)")}
            className="flex items-center gap-2 px-4 py-3 bg-surface-container rounded-2xl text-on-surface-variant hover:bg-warning/10 hover:text-warning transition-all border border-outline-variant/10 shadow-sm"
          >
            <span className="material-symbols-outlined text-xl">cleaning_services</span>
            <span className="uppercase tracking-widest text-[9px] font-black hidden md:inline">{tr("Dọn dẹp")}</span>
          </button>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-on-primary rounded-2xl font-black text-sm hover:shadow-lg hover:shadow-primary/20 transition-all"
          >
            <span className="material-symbols-outlined">person_add</span>
            <span className="uppercase tracking-widest text-[11px]">{tr("Thêm người dùng")}</span>
          </button>
        </div>
      </div>

      <div className="glass-panel rounded-[2.5rem] overflow-hidden border border-outline-variant/10 shadow-sm mb-10 bg-white/80 backdrop-blur-xl">
        <div className="p-6 border-b border-outline-variant/10">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-on-surface-variant">search</span>
            <input
              type="text"
              placeholder={tr("Tìm theo tên, mã đăng nhập, bộ phận...")}
              className="w-full bg-surface-container-lowest border-none rounded-2xl py-4 pl-12 pr-6 text-sm font-bold shadow-inner focus:ring-2 focus:ring-primary/20"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[10px] font-black tracking-widest border-b border-outline-variant/10">
                <th className="px-8 py-5">{tr("Họ và tên")}</th>
                <th className="px-8 py-5">{tr("Mã đăng nhập")}</th>
                <th className="px-8 py-5">{tr("Vai trò")}</th>
                <th className="px-8 py-5">{tr("Đăng nhập cuối")}</th>
                <th className="px-8 py-5">{tr("Trạng thái")}</th>
                <th className="px-8 py-5 text-right">{tr("Thao tác")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5">
              {loading && users.length === 0 ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-8 py-6 h-16 bg-surface-container-lowest/50"></td>
                  </tr>
                ))
              ) : filteredUsers.length > 0 ? (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-primary/5 transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black uppercase text-xs">
                          {user.full_name?.charAt(0) || user.login_code?.charAt(0) || 'U'}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-on-surface">{user.full_name || tr("Chưa cập nhật")}</p>
                          {user.role === 'dept_user' && user.dept_name && (
                            <p className="text-[10px] text-on-surface-variant/70 font-medium">{user.dept_name}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="font-mono text-sm font-black text-primary tracking-wider">{user.login_code}</span>
                    </td>
                    <td className="px-8 py-6">
                      <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                        user.role === 'admin' ? 'bg-error/10 text-error' :
                        user.role === 'editor' ? 'bg-primary/10 text-primary' :
                        user.role === 'dept_user' ? 'bg-amber-500/10 text-amber-600' :
                        'bg-surface-container-highest text-on-surface-variant'
                      }`}>
                        {user.role === 'dept_user' ? `Dept: ${user.dept_code || '—'}` : user.role}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-sm font-medium text-on-surface-variant">
                      {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : tr("Chưa từng")}
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${user.is_active ? 'bg-success' : 'bg-outline-variant'}`}></span>
                        <span className={`text-[11px] font-bold ${user.is_active ? 'text-success' : 'text-on-surface-variant'}`}>
                          {user.is_active ? 'Active' : tr("Bị khóa")}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex justify-end gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleResetPassword(user)}
                          title={tr("Cấp mật khẩu mới")}
                          className="p-2 rounded-xl hover:bg-warning/10 text-on-surface-variant hover:text-warning transition-all"
                        >
                          <span className="material-symbols-outlined text-xl">lock_reset</span>
                        </button>
                        <button
                          onClick={() => handleEdit(user)}
                          title={tr("Chỉnh sửa")}
                          className="p-2 rounded-xl hover:bg-primary/10 text-on-surface-variant hover:text-primary transition-all"
                        >
                          <span className="material-symbols-outlined text-xl">edit</span>
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user)}
                          title={tr("Xóa người dùng")}
                          className="p-2 rounded-xl hover:bg-error/10 text-on-surface-variant hover:text-error transition-all"
                        >
                          <span className="material-symbols-outlined text-xl">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr key="empty-users">
                  <td colSpan={6} className="px-8 py-20 text-center text-on-surface-variant font-bold italic">
                    {tr("Không tìm thấy người dùng nào.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Thêm người dùng */}
      <AnimatePresence>
        {isAddModalOpen && modalShell(() => setIsAddModalOpen(false), (
          <>
            <h3 className="text-3xl font-black text-on-surface mb-2">{tr("Thêm người dùng")}</h3>
            <p className="text-xs text-on-surface-variant font-medium mb-8">{tr("Mã đăng nhập và mật khẩu sẽ được tạo tự động sau khi lưu.")}</p>
            <form onSubmit={handleAddUser} className="space-y-6">
              {renderFormFields('add', false)}
              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-5 bg-surface-container text-on-surface-variant rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-surface-container-high transition-colors"
                >
                  {tr("HỦY")}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-5 bg-primary text-on-primary rounded-2xl font-black text-xs uppercase tracking-widest hover:shadow-lg hover:shadow-primary/30 transition-all disabled:opacity-50"
                >
                  {loading ? tr("ĐANG TẠO...") : tr("TẠO TÀI KHOẢN")}
                </button>
              </div>
            </form>
          </>
        ))}
      </AnimatePresence>

      {/* Modal Chỉnh sửa */}
      <AnimatePresence>
        {isEditModalOpen && selectedUser && modalShell(() => setIsEditModalOpen(false), (
          <>
            <h3 className="text-3xl font-black text-on-surface mb-2">{tr("Chỉnh sửa thông tin")}</h3>
            <p className="text-xs text-on-surface-variant font-medium mb-8">
              {tr("Mã đăng nhập:")} <span className="font-mono font-black text-primary">{selectedUser.login_code}</span> {tr("(không đổi được)")}
            </p>
            <form onSubmit={handleUpdate} className="space-y-6">
              {renderFormFields('edit', true)}
              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 py-5 bg-surface-container text-on-surface-variant rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-surface-container-high transition-colors"
                >
                  {tr("HỦY")}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-5 bg-primary text-on-primary rounded-2xl font-black text-xs uppercase tracking-widest hover:shadow-lg hover:shadow-primary/30 transition-all disabled:opacity-50"
                >
                  {loading ? tr("ĐANG LƯU...") : tr("LƯU THAY ĐỔI")}
                </button>
              </div>
            </form>
          </>
        ))}
      </AnimatePresence>

      {/* Modal hiển thị mã + mật khẩu (chỉ hiện một lần) */}
      <AnimatePresence>
        {credentials && modalShell(() => setCredentials(null), (
          <>
            <div className="w-14 h-14 bg-success/10 rounded-2xl flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-success text-3xl">verified_user</span>
            </div>
            <h3 className="text-2xl font-black text-on-surface mb-1">{credentials.title}</h3>
            <p className="text-xs text-on-surface-variant font-medium mb-8">
              {tr("Gửi thông tin dưới đây cho")} <span className="font-bold text-on-surface">{credentials.full_name}</span>. Mật khẩu chỉ hiển thị một lần, hãy lưu lại ngay.
            </p>

            <div className="space-y-4">
              <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-1">{tr("Mã đăng nhập")}</p>
                <p className="text-2xl font-black font-mono text-primary tracking-widest select-all">{credentials.login_code}</p>
              </div>
              <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-1">{tr("Mật khẩu")}</p>
                <p className="text-2xl font-black font-mono text-on-surface tracking-widest select-all break-all">{credentials.password}</p>
              </div>
            </div>

            <div className="flex gap-3 pt-8">
              <button
                type="button"
                onClick={copyCredentials}
                className="flex-1 py-4 bg-surface-container-high text-on-surface rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary/10 hover:text-primary transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">content_copy</span>
                COPY
              </button>
              <button
                type="button"
                onClick={() => setCredentials(null)}
                className="flex-1 py-4 bg-primary text-on-primary rounded-2xl font-black text-xs uppercase tracking-widest hover:shadow-lg hover:shadow-primary/30 transition-all"
              >
                {tr("ĐÃ LƯU, ĐÓNG")}
              </button>
            </div>
          </>
        ), 'max-w-md')}
      </AnimatePresence>
    </div>
  );
};

export default UserManagement;
