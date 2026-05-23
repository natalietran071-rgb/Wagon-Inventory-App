import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const Sidebar = ({ isOpen, onClose }: { isOpen?: boolean, onClose?: () => void }) => {
  const { t } = useLanguage();
  const { signOut, profile } = useAuth();
  const warehouseName = 'Inventory Hub';

  useEffect(() => {
    // app_settings removed as requested
  }, []);
  
  const navItems = [
    { name: t('inventory'), icon: 'inventory_2', path: '/inventory' },
    { name: t('inbound'), icon: 'input', path: '/inbound' },
    { name: t('outbound'), icon: 'output', path: '/outbound' },
    { name: t('audit'), icon: 'fact_check', path: '/audit' },
    { name: 'Master ERP', icon: 'database', path: '/master-erp' },
    { name: t('users'), icon: 'manage_accounts', path: '/users', roles: ['admin'] },
  ];

  const filteredNavItems = navItems.filter(item => {
    if (!item.roles) return true;
    return item.roles.includes(profile?.role);
  });

  return (
    <aside className={`fixed left-0 top-0 h-screen w-64 z-50 bg-surface-container-low flex flex-col py-8 border-r border-outline-variant/20 transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
      <div className="px-8 mb-8 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center text-on-primary shadow-xl shadow-primary/30 border border-white/20">
            <span className="material-symbols-outlined text-2xl">factory</span>
          </div>
        </div>
        <button className="lg:hidden p-2 text-on-surface-variant" onClick={onClose}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-4 overflow-y-auto no-scrollbar">
        {filteredNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-4 py-3.5 px-5 rounded-2xl transition-all ease-in-out duration-300 font-inter text-[13px] font-bold tracking-tight ${
                isActive
                  ? 'bg-primary text-on-primary shadow-lg shadow-primary/20'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary'
              }`
            }
          >
            <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 0" }}>{item.icon}</span>
            <span>{item.name}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto px-4 space-y-1 border-t border-outline-variant/10 pt-6">
        <button 
          onClick={signOut}
          className="w-full flex items-center gap-4 text-on-surface-variant py-3 px-5 hover:text-error transition-colors text-[13px] font-bold tracking-tight"
        >
          <span className="material-symbols-outlined text-xl">logout</span>
          <span>{t('logout')}</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
