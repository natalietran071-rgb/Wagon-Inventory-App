-- Tinh giản tài khoản người dùng: đăng nhập bằng MÃ + MẬT KHẨU, không dùng email.
-- Đã áp dụng lên cả hai project Supabase: "Wagon Preview" (nfenstuyyzjommplhsbj)
-- và Main (zginbmciyiqpvttntbeq). Chạy lại được nhiều lần (idempotent).
--
-- Cách hoạt động:
--   * Mỗi user có profiles.login_code (duy nhất, viết hoa). User bộ phận dùng chính
--     mã bộ phận (VD: ACD02); user khác được cấp mã tự sinh WG001, WG002, ...
--   * Supabase Auth vẫn cần một "email" làm định danh, nên user mới được gán email
--     nội bộ <mã>@wagon.local. Email này không gửi thư, không xác nhận, không hiển thị.
--   * User cũ giữ nguyên email hiện có; login_code lấy từ phần trước dấu @.
--   * Màn đăng nhập gọi resolve_login_email(mã) để đổi mã -> email rồi signInWithPassword.
--   * Admin tạo user chỉ cần họ tên + vai trò (+ bộ phận). Mã và mật khẩu do DB sinh
--     và trả về một lần để admin gửi cho người dùng.

-- ---------------------------------------------------------------------------
-- 0. Email trong auth.users phải là chữ thường (GoTrue so sánh chữ thường)
-- ---------------------------------------------------------------------------
UPDATE auth.users SET email = lower(email), updated_at = now() WHERE email <> lower(email);
UPDATE auth.identities
SET identity_data = identity_data || jsonb_build_object('email', lower(identity_data->>'email'))
WHERE identity_data->>'email' IS NOT NULL AND identity_data->>'email' <> lower(identity_data->>'email');
UPDATE public.profiles SET email = lower(email) WHERE email IS NOT NULL AND email <> lower(email);

-- ---------------------------------------------------------------------------
-- 1. Cột login_code
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS login_code TEXT;

UPDATE public.profiles p
SET login_code = upper(split_part(u.email, '@', 1))
FROM auth.users u
WHERE u.id = p.id AND p.login_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_login_code_key
  ON public.profiles (upper(login_code));

-- ---------------------------------------------------------------------------
-- 2. Hàm tiện ích (chỉ dùng nội bộ)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wagon_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active
  );
$$;

-- Mật khẩu ngẫu nhiên 8 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/l/I).
CREATE OR REPLACE FUNCTION public.wagon_random_password(p_len int DEFAULT 8)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  v_bytes bytea := extensions.gen_random_bytes(p_len);
  v_out text := '';
  i int;
BEGIN
  FOR i IN 0 .. p_len - 1 LOOP
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  END LOOP;
  RETURN v_out;
END;
$$;

-- Mã đăng nhập tiếp theo dạng WG001, WG002, ... (bỏ qua mã đã dùng).
CREATE OR REPLACE FUNCTION public.wagon_next_login_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public'
AS $$
DECLARE
  v_n int;
  v_code text;
BEGIN
  SELECT COALESCE(MAX(substr(login_code, 3)::int), 0) INTO v_n
  FROM public.profiles
  WHERE login_code ~ '^WG[0-9]+$';

  LOOP
    v_n := v_n + 1;
    v_code := 'WG' || lpad(v_n::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE upper(login_code) = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.wagon_random_password(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wagon_next_login_code() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. resolve_login_email: màn đăng nhập gọi (ẩn danh) để đổi mã -> email
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_login_email(p_code text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_input text := lower(trim(p_code));
  v_email text;
BEGIN
  IF v_input = '' THEN RETURN NULL; END IF;
  IF position('@' IN v_input) > 0 THEN RETURN v_input; END IF;

  SELECT lower(u.email) INTO v_email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE upper(p.login_code) = upper(v_input)
  LIMIT 1;

  -- Mã chưa có trong profiles: dùng email nội bộ mặc định để login vẫn báo sai mật khẩu.
  RETURN COALESCE(v_email, v_input || '@wagon.local');
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC quản trị (bỏ các bản cũ nhận email / username / password)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_create_user(text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid, text, text, text, text, boolean, text);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid, text, text, text, text, boolean, text, text, text);
DROP FUNCTION IF EXISTS public.get_all_users();

-- Tạo user: chỉ cần họ tên + vai trò (+ bộ phận). Trả về mã + mật khẩu vừa sinh.
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_full_name text,
  p_role      text,
  p_dept_code text DEFAULT NULL,
  p_dept_name text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'auth'
AS $$
DECLARE
  v_id        uuid := gen_random_uuid();
  v_code      text;
  v_password  text;
  v_email     text;
  v_dept_code text := NULLIF(upper(trim(p_dept_code)), '');
  v_dept_name text := NULLIF(trim(p_dept_name), '');
BEGIN
  IF NOT public.wagon_is_admin() THEN
    RETURN json_build_object('status', 'error', 'error', 'Chỉ Admin mới được tạo người dùng');
  END IF;
  IF NULLIF(trim(p_full_name), '') IS NULL THEN
    RETURN json_build_object('status', 'error', 'error', 'Thiếu họ và tên');
  END IF;
  IF p_role NOT IN ('admin', 'editor', 'viewer', 'dept_user') THEN
    RETURN json_build_object('status', 'error', 'error', 'Vai trò không hợp lệ: ' || COALESCE(p_role, 'null'));
  END IF;
  IF p_role = 'dept_user' AND v_dept_code IS NULL THEN
    RETURN json_build_object('status', 'error', 'error', 'Tài khoản bộ phận cần có mã bộ phận');
  END IF;

  -- Mã đăng nhập: user bộ phận dùng mã bộ phận (nếu chưa ai dùng), còn lại WGxxx.
  IF p_role = 'dept_user'
     AND v_dept_code ~ '^[A-Z0-9]+$'
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE upper(login_code) = v_dept_code) THEN
    v_code := v_dept_code;
  ELSE
    v_code := public.wagon_next_login_code();
  END IF;

  v_password := public.wagon_random_password(8);
  v_email    := lower(v_code) || '@wagon.local';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    v_email, extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', trim(p_full_name), 'login_code', v_code),
    now(), now(), '', '', '', '', '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  INSERT INTO public.profiles (id, username, full_name, email, role, is_active, login_code, dept_code, dept_name)
  VALUES (
    v_id, v_code, trim(p_full_name), v_email, p_role, true, v_code,
    CASE WHEN p_role = 'dept_user' THEN v_dept_code END,
    CASE WHEN p_role = 'dept_user' THEN COALESCE(v_dept_name, v_dept_code) END
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username, full_name = EXCLUDED.full_name, email = EXCLUDED.email,
    role = EXCLUDED.role, is_active = true, login_code = EXCLUDED.login_code,
    dept_code = EXCLUDED.dept_code, dept_name = EXCLUDED.dept_name;

  RETURN json_build_object('status', 'success', 'id', v_id, 'login_code', v_code, 'password', v_password);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('status', 'error', 'error', SQLERRM);
END;
$$;

-- Cập nhật thông tin (không đổi mã, không đổi mật khẩu ở đây).
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id   uuid,
  p_full_name text,
  p_role      text,
  p_is_active boolean,
  p_dept_code text DEFAULT NULL,
  p_dept_name text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_dept_code text := NULLIF(upper(trim(p_dept_code)), '');
  v_dept_name text := NULLIF(trim(p_dept_name), '');
BEGIN
  IF NOT public.wagon_is_admin() THEN
    RETURN json_build_object('status', 'error', 'error', 'Chỉ Admin mới được sửa người dùng');
  END IF;
  IF p_role NOT IN ('admin', 'editor', 'viewer', 'dept_user') THEN
    RETURN json_build_object('status', 'error', 'error', 'Vai trò không hợp lệ: ' || COALESCE(p_role, 'null'));
  END IF;
  IF p_role = 'dept_user' AND v_dept_code IS NULL THEN
    RETURN json_build_object('status', 'error', 'error', 'Tài khoản bộ phận cần có mã bộ phận');
  END IF;

  UPDATE public.profiles SET
    full_name  = trim(p_full_name),
    role       = p_role,
    is_active  = p_is_active,
    dept_code  = CASE WHEN p_role = 'dept_user' THEN v_dept_code END,
    dept_name  = CASE WHEN p_role = 'dept_user' THEN COALESCE(v_dept_name, v_dept_code) END,
    updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('status', 'error', 'error', 'Không tìm thấy người dùng');
  END IF;

  UPDATE auth.users
  SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', trim(p_full_name)),
      updated_at = now()
  WHERE id = p_user_id;

  RETURN json_build_object('status', 'success');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('status', 'error', 'error', SQLERRM);
END;
$$;

-- Cấp lại mật khẩu: DB tự sinh và trả về để admin gửi cho người dùng.
CREATE OR REPLACE FUNCTION public.admin_reset_password(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'auth'
AS $$
DECLARE
  v_password text;
BEGIN
  IF NOT public.wagon_is_admin() THEN
    RETURN json_build_object('status', 'error', 'error', 'Chỉ Admin mới được cấp lại mật khẩu');
  END IF;

  v_password := public.wagon_random_password(8);

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('status', 'error', 'error', 'Không tìm thấy người dùng');
  END IF;

  RETURN json_build_object('status', 'success', 'password', v_password);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('status', 'error', 'error', SQLERRM);
END;
$$;

-- Đặt mật khẩu cụ thể (giữ cho tương thích; thêm kiểm tra admin).
CREATE OR REPLACE FUNCTION public.admin_update_password(p_user_id uuid, p_new_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'auth'
AS $$
BEGIN
  IF NOT public.wagon_is_admin() THEN
    RETURN json_build_object('status', 'error', 'error', 'Chỉ Admin mới được đổi mật khẩu');
  END IF;
  IF length(COALESCE(p_new_password, '')) < 6 THEN
    RETURN json_build_object('status', 'error', 'error', 'Mật khẩu tối thiểu 6 ký tự');
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = now()
  WHERE id = p_user_id;

  RETURN json_build_object('status', 'success');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('status', 'error', 'error', SQLERRM);
END;
$$;

-- Xóa user (thêm kiểm tra admin, không cho tự xóa mình).
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT public.wagon_is_admin() THEN
    RETURN json_build_object('status', 'error', 'error', 'Chỉ Admin mới được xóa người dùng');
  END IF;
  IF p_user_id = auth.uid() THEN
    RETURN json_build_object('status', 'error', 'error', 'Không thể tự xóa tài khoản đang đăng nhập');
  END IF;

  DELETE FROM public.profiles WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;

  RETURN json_build_object('status', 'success');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('status', 'error', 'error', SQLERRM);
END;
$$;

-- Danh sách user cho màn Quản lý người dùng.
CREATE OR REPLACE FUNCTION public.get_all_users()
RETURNS TABLE (
  id uuid,
  login_code text,
  username text,
  full_name text,
  role text,
  is_active boolean,
  dept_code text,
  dept_name text,
  last_sign_in_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF NOT public.wagon_is_admin() THEN
    RAISE EXCEPTION 'Chỉ Admin mới được xem danh sách người dùng';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(p.login_code, upper(split_part(u.email, '@', 1))),
    p.username,
    p.full_name,
    p.role,
    COALESCE(p.is_active, true),
    p.dept_code,
    p.dept_name,
    u.last_sign_in_at,
    u.created_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, text, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reset_password(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_password(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_all_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_users() TO authenticated;
