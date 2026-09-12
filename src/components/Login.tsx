import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { loginCodeToEmail } from '../lib/loginCode';
import { tr } from '../contexts/LanguageContext';

const Login = () => {
  const navigate = useNavigate();
  const { session: currentSession } = useAuth();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentSession) {
      navigate('/inventory');
    }
  }, [currentSession, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Mã đăng nhập -> email nội bộ. Ưu tiên tra cứu trên DB (hỗ trợ cả tài khoản cũ),
      // nếu RPC lỗi thì dùng quy ước <mã>@wagon.local.
      let email = loginCodeToEmail(code);
      const { data: resolved, error: resolveError } = await supabase.rpc('resolve_login_email', { p_code: code.trim() });
      if (!resolveError && typeof resolved === 'string' && resolved) email = resolved;

      const { data: { session }, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        if (/invalid login credentials/i.test(error.message)) {
          throw new Error(tr("Mã đăng nhập hoặc mật khẩu không đúng."));
        }
        throw error;
      }
      if (session) navigate('/inventory');
    } catch (err: any) {
      setError(err.message || tr("Đã có lỗi xảy ra."));
    } finally {
      setLoading(false);
    }
  };

  const iconStyle: React.CSSProperties = {
    fontFamily: "'Material Symbols Outlined'",
    fontSize: '1.25rem',
    width: '1.25rem',
    height: '1.25rem',
    lineHeight: 1,
    overflow: 'hidden'
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px]"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-[120px]"></div>

      <div className="bg-surface-container-lowest p-6 sm:p-10 rounded-2xl sm:rounded-[2rem] shadow-2xl w-full max-w-md relative z-10 border border-outline-variant/10">
        <div className="text-center mb-8 sm:mb-10">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6">
            <span className="material-symbols-outlined text-primary" style={{ ...iconStyle, fontSize: '2rem', width: '2rem', height: '2rem', fontVariationSettings: "'FILL' 1" }}>warehouse</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-on-surface font-manrope tracking-tight">Wagon Inventory Hub</h1>
          <p className="text-on-surface-variant font-medium mt-2 text-sm sm:text-base">{tr("Hệ thống quản lý kho vận thông minh")}</p>
        </div>

        {error && (
          <div className="bg-error-container/20 border border-error/30 text-error p-3 sm:p-4 rounded-xl mb-4 sm:mb-6 text-xs sm:text-sm font-medium flex items-start gap-2">
            <span className="material-symbols-outlined flex-shrink-0" style={iconStyle}>error</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4 sm:space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider px-1">{tr("Mã đăng nhập")}</label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" style={iconStyle}>badge</span>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full bg-surface-container-low border-none rounded-xl py-3.5 sm:py-4 pl-12 pr-4 focus:ring-2 focus:ring-primary/20 font-medium text-sm sm:text-base uppercase"
                placeholder="WG001"
                autoComplete="username"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider px-1">{tr("Mật khẩu")}</label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" style={iconStyle}>lock</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface-container-low border-none rounded-xl py-3.5 sm:py-4 pl-12 pr-4 focus:ring-2 focus:ring-primary/20 font-medium text-sm sm:text-base"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 sm:py-4 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-70 disabled:hover:scale-100 text-sm sm:text-base"
          >
            {loading ? tr("Đang xử lý...") : tr("Đăng Nhập")}
          </button>
        </form>

        <p className="mt-6 sm:mt-8 text-center text-xs sm:text-sm font-medium text-on-surface-variant">
          {tr("Chưa có tài khoản hoặc quên mật khẩu? Liên hệ quản trị viên để được cấp mã đăng nhập mới.")}
        </p>
      </div>
    </div>
  );
};

export default Login;
