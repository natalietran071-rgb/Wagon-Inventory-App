import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: any | null;
  loading: boolean;
  error: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  error: null,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const hasCleanedUp = useRef(false);
  const isFetchingProfile = useRef(false);

  const fetchProfile = async (userId: string) => {
    if (isFetchingProfile.current) return;
    isFetchingProfile.current = true;
    
    try {
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (fetchError) {
        console.error('Error fetching profile:', fetchError);
        // If profile doesn't exist, create one
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          const isFirstAdmin = userData.user.email === 'natalietran071@gmail.com';
          const loginCode = (userData.user.user_metadata?.login_code || userData.user.email?.split('@')[0] || '').toUpperCase();
          const { data: newProfile, error: upsertError } = await supabase
            .from('profiles')
            .upsert({
              id: userId,
              username: loginCode,
              login_code: loginCode,
              full_name: userData.user.user_metadata?.full_name || loginCode,
              role: isFirstAdmin ? 'admin' : 'viewer',
              is_active: true
            })
            .select()
            .single();
          
          if (upsertError) {
            console.error('Error creating profile:', upsertError);
          } else {
            setProfile(newProfile);
            triggerCleanup(newProfile);
          }
        }
      } else {
        // Force admin role for the specific email even if it exists
        if (data.email === 'natalietran071@gmail.com' && data.role !== 'admin') {
          const { data: updatedProfile } = await supabase
            .from('profiles')
            .update({ role: 'admin' })
            .eq('id', userId)
            .select()
            .single();
          const finalProfile = updatedProfile || data;
          setProfile(finalProfile);
          triggerCleanup(finalProfile);
        } else {
          setProfile(data);
          triggerCleanup(data);
        }
      }
    } catch (err) {
      console.error('Unexpected error in fetchProfile:', err);
      setError('Không thể tải thông tin người dùng. Vui lòng kiểm tra kết nối database.');
    } finally {
      isFetchingProfile.current = false;
      setLoading(false);
    }
  };

  const triggerCleanup = (userProfile: any) => {
    if (userProfile?.role === 'admin' && !hasCleanedUp.current) {
      hasCleanedUp.current = true;
      supabase.rpc('cleanup_old_history')
        .then(({ data: cleanupData, error: cleanupError }) => {
          if (cleanupError) console.error('Auto-cleanup error:', cleanupError);
          else console.log('Auto-cleanup result:', cleanupData);
        });
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        
        if (currentSession?.user) {
          await fetchProfile(currentSession.user.id);
        } else {
          setLoading(false);
        }
      } catch (err: any) {
        console.error('Auth initialization error:', err);
        setError(err.message || 'Lỗi khởi tạo hệ thống xác thực.');
        setLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, currentSession) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      
      if (currentSession?.user) {
        // Only fetch if session is different or profile is missing
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          fetchProfile(currentSession.user.id);
        }
      } else {
        setProfile(null);
        hasCleanedUp.current = false; // Reset cleanup flag on sign out
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, error, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
