// Thiết lập tài khoản admin cho Wagon Inventory App qua Supabase Admin API.
//
// Cách chạy:
//   SUPABASE_SERVICE_ROLE_KEY=<service_role_key> ADMIN_PASSWORD=<mật khẩu> node setup_wagonadmin.js
//
// Cần VITE_SUPABASE_URL (hoặc NEXT_PUBLIC_SUPABASE_URL) trong .env / môi trường,
// SUPABASE_SERVICE_ROLE_KEY (lấy tại Supabase Dashboard > Settings > API),
// và ADMIN_PASSWORD (mật khẩu muốn đặt; không lưu trong repo).
// KHÔNG dùng anon key: chỉ service role key mới có quyền tạo / đổi mật khẩu user.

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'natalietran071@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Thiếu VITE_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 6) {
  console.error('Thiếu ADMIN_PASSWORD (tối thiểu 6 ký tự)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 1000) return null;
    page += 1;
  }
}

async function main() {
  const username = ADMIN_EMAIL.split('@')[0];
  let user = await findUserByEmail(ADMIN_EMAIL);

  if (user) {
    const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
    console.log(`Đã đặt lại mật khẩu cho ${ADMIN_EMAIL} (id=${user.id})`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Wagon Admin', username },
    });
    if (error) throw error;
    user = data.user;
    console.log(`Đã tạo user ${ADMIN_EMAIL} (id=${user.id})`);
  }

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: user.id,
    username,
    full_name: 'Wagon Admin',
    role: 'admin',
    is_active: true,
  });
  if (profileError) throw profileError;

  console.log('Profile đã được đặt role=admin, is_active=true. Xong.');
}

main().catch((err) => {
  console.error('Lỗi:', err.message || err);
  process.exit(1);
});
