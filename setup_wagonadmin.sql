-- Thiết lập tài khoản admin cho Wagon Inventory App.
-- Chạy file này trong Supabase Dashboard > SQL Editor (chạy với quyền postgres).
--
-- TRƯỚC KHI CHẠY: thay 'CHANGE_ME' ở dòng v_password bằng mật khẩu mong muốn
-- (mật khẩu không được lưu trong repo).
--
-- Kết quả:
--   - Nếu email chưa tồn tại: tạo user mới với mật khẩu bên dưới, email đã xác nhận.
--   - Nếu email đã tồn tại: đặt lại mật khẩu về giá trị bên dưới, xác nhận email.
--   - Đảm bảo profile có role = 'admin' và is_active = true.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_email    TEXT := 'natalietran071@gmail.com';
  v_password TEXT := 'CHANGE_ME';
  v_user_id  UUID;
BEGIN
  IF v_password = 'CHANGE_ME' OR length(v_password) < 6 THEN
    RAISE EXCEPTION 'Hãy thay v_password bằng mật khẩu thật (tối thiểu 6 ký tự) trước khi chạy';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'Wagon Admin', 'username', split_part(v_email, '@', 1)),
      now(),
      now()
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      'email',
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      now(),
      now(),
      now()
    );

    RAISE NOTICE 'Đã tạo user % (id=%)', v_email, v_user_id;
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt(v_password, gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        banned_until       = NULL,
        updated_at         = now()
    WHERE id = v_user_id;

    RAISE NOTICE 'Đã đặt lại mật khẩu cho user % (id=%)', v_email, v_user_id;
  END IF;

  INSERT INTO public.profiles (id, username, full_name, role, is_active)
  VALUES (v_user_id, split_part(v_email, '@', 1), 'Wagon Admin', 'admin', true)
  ON CONFLICT (id) DO UPDATE
    SET role = 'admin',
        is_active = true,
        updated_at = now();
END $$;

-- Kiểm tra lại
SELECT u.id, u.email, u.email_confirmed_at, p.role, p.is_active
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE lower(u.email) = 'natalietran071@gmail.com';
