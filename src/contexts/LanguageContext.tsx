import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { zh } from '../i18n/zh';
import { en } from '../i18n/en';

export type Language = 'vi' | 'en' | 'zh';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: TrParams) => string;
}

export type TrParams = Record<string, unknown> | unknown[];

// Từ điển: khóa là chính câu tiếng Việt trong mã nguồn (hoặc khóa ngắn cho menu).
// Tiếng Việt là ngôn ngữ gốc nên không cần từ điển riêng: tr(key) trả về key.
const translations: Record<Language, Record<string, string>> = {
  vi: {},
  en,
  zh,
};

const STORAGE_KEY = 'wagon_language';

function readStoredLanguage(): Language {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'vi' || v === 'en' || v === 'zh') return v;
  } catch { /* ignore */ }
  return 'vi';
}

// Ngôn ngữ hiện hành ở cấp module để tr() dùng được ở mọi nơi (kể cả ngoài component).
let currentLanguage: Language = readStoredLanguage();

function interpolate(text: string, params?: TrParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => {
    const v = Array.isArray(params) ? params[Number(k)] : (params as Record<string, unknown>)[k];
    return v === undefined || v === null ? m : String(v);
  });
}

/**
 * Dịch một chuỗi. `key` là câu tiếng Việt gốc (hoặc khóa ngắn như 'inventory').
 * Placeholder dạng {0}, {1} (mảng) hoặc {name} (object).
 * Không có bản dịch thì trả về chính key, nên tiếng Việt luôn hiển thị đúng.
 */
export function tr(key: string, params?: TrParams): string {
  const dict = translations[currentLanguage];
  const text = (dict && dict[key]) || key;
  return interpolate(text, params);
}

export function getLanguage(): Language {
  return currentLanguage;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(currentLanguage);

  const setLanguage = useCallback((lang: Language) => {
    currentLanguage = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : lang;
    setLanguageState(lang);
  }, []);

  const t = useCallback((key: string, params?: TrParams) => tr(key, params), [language]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
