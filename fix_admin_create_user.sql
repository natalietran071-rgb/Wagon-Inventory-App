-- Sửa lỗi "Thêm người dùng" trong màn Quản lý người dùng.
-- Đã áp dụng lên project Supabase production ngày 2026-09-12 (migrations:
-- add_email_column_to_profiles, fix_admin_create_user_profile_upsert).
-- Giữ file này để môi trường khác (preview / local) chạy lại được.
--
-- Lỗi 1: column "email" of relation "profiles" does not exist
--   -> admin_create_user ghi cột email vào profiles nhưng bảng chưa có cột đó.
-- Lỗi 2: duplicate key value violates unique constraint "profiles_pkey"
--   -> trigger on_auth_user_created đã tự tạo dòng profile khi chèn auth.users,
--      admin_create_user chèn thêm lần nữa nên trùng khóa. Đổi sang upsert.

-- 1. Thêm cột email vào profiles và điền từ auth.users
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id AND p.email IS NULL;

-- 2. admin_create_user: kiểm tra email trùng, upsert profile thay vì insert
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text, p_password text, p_username text, p_full_name text, p_role text,
  p_dept_code text DEFAULT NULL::text, p_dept_name text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'auth'
AS $function$
DECLARE
  new_user_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(p_email)) THEN
    RETURN json_build_object('error', 'Email đã tồn tại: ' || lower(p_email), 'status', 'error');
  END IF;

  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, role, instance_id, aud,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  )
  VALUES (
    gen_random_uuid(),
    LOWER(p_email),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name, 'username', p_username),
    now(), now(), 'authenticated',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    '', '', '', '', '', '', '', ''
  )
  RETURNING id INTO new_user_id;

  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  VALUES (
    gen_random_uuid(),
    new_user_id::text,
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', LOWER(p_email), 'email_verified', true),
    'email',
    now(), now(), now()
  );

  -- Trigger on_auth_user_created đã tạo sẵn dòng profile (role viewer);
  -- upsert để ghi đè đúng thông tin admin nhập.
  INSERT INTO public.profiles (id, username, full_name, role, is_active, email, dept_code, dept_name)
  VALUES (new_user_id, p_username, p_full_name, p_role, true, LOWER(p_email), p_dept_code, p_dept_name)
  ON CONFLICT (id) DO UPDATE SET
    username  = EXCLUDED.username,
    full_name = EXCLUDED.full_name,
    role      = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    email     = EXCLUDED.email,
    dept_code = EXCLUDED.dept_code,
    dept_name = EXCLUDED.dept_name;

  RETURN json_build_object('id', new_user_id, 'status', 'success');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM, 'status', 'error');
END;
$function$;
