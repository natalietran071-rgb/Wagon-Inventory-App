-- =====================================================================
-- Kiểm kê: bản ghi đã lưu không hiện ở tab "Đã lưu - Chờ gửi" / "Phê duyệt"
-- =====================================================================
-- Chạy trong Supabase Dashboard > SQL Editor của project app đang dùng.
-- Phần 1 chỉ đọc, chạy trước để xem bản ghi đang nằm đâu.
-- Phần 2 sửa hàm + gắn lại bản ghi mồ côi vào phiên, chạy lại được nhiều lần.

-- ---------------------------------------------------------------------
-- 1. CHẨN ĐOÁN (chỉ đọc)
-- ---------------------------------------------------------------------
-- 1a. 20 bản ghi kiểm kê mới nhất: session_id NULL = bản ghi mồ côi.
SELECT ar.id, ar.erp_code, ar.location, ar.actual_qty, ar.status, ar.session_id,
       s.session_name, ar.user_email, ar.created_at
FROM public.audit_records ar
LEFT JOIN public.audit_sessions s ON s.id = ar.session_id
ORDER BY ar.created_at DESC
LIMIT 20;

-- 1b. Hàm lưu đang chạy trên server có ghi session_id không?
SELECT p.proname, pg_get_function_arguments(p.oid) AS args,
       position('session_id' in pg_get_functiondef(p.oid)) > 0 AS writes_session_id
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('save_audit_record_v2', 'get_audited_items');

-- ---------------------------------------------------------------------
-- 2. SỬA
-- ---------------------------------------------------------------------
-- 2a. Hàm lưu: luôn ghi session_id; cùng phiên + mã + vị trí thì cập nhật thay vì tạo dòng mới.
--     Bỏ mọi bản cũ cùng tên (kể cả bản có chữ ký khác) để PostgREST không bị nhập nhằng.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('save_audit_record_v2', 'get_audited_items') LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.save_audit_record_v2(
  p_session_id UUID,
  p_erp_code   TEXT,
  p_actual_qty NUMERIC,
  p_location   TEXT DEFAULT '',
  p_note       TEXT DEFAULT NULL,
  p_auditor    TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_system_qty NUMERIC;
  v_item_name  TEXT;
  v_id         UUID;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN json_build_object('status', 'error', 'error', 'Thiếu phiên kiểm kê');
  END IF;

  -- Tồn hệ thống tại đúng vị trí; không có thì lấy tổng theo mã.
  SELECT end_stock, name INTO v_system_qty, v_item_name
  FROM public.inventory WHERE erp = p_erp_code AND pos = p_location LIMIT 1;
  IF v_item_name IS NULL THEN
    SELECT COALESCE(SUM(end_stock), 0), MAX(name) INTO v_system_qty, v_item_name
    FROM public.inventory WHERE erp = p_erp_code;
  END IF;

  SELECT id INTO v_id FROM public.audit_records
  WHERE session_id = p_session_id AND erp_code = p_erp_code
    AND COALESCE(location, '') = COALESCE(p_location, '') AND status = 'Draft'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.audit_records SET
      actual_qty = p_actual_qty,
      system_qty = COALESCE(v_system_qty, 0),
      item_name  = COALESCE(v_item_name, item_name, p_erp_code),
      note       = p_note,
      auditor    = COALESCE(p_auditor, auditor),
      user_email = COALESCE(p_user_email, user_email)
    WHERE id = v_id;
  ELSE
    INSERT INTO public.audit_records
      (session_id, erp_code, item_name, location, system_qty, actual_qty, note, auditor, user_email, status)
    VALUES
      (p_session_id, p_erp_code, COALESCE(v_item_name, p_erp_code), p_location,
       COALESCE(v_system_qty, 0), p_actual_qty, p_note, p_auditor, p_user_email, 'Draft')
    RETURNING id INTO v_id;
  END IF;

  RETURN json_build_object('status', 'success', 'id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_audit_record_v2(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 2b. Danh sách bản ghi theo phiên: LEFT JOIN để mã không còn trong kho vẫn hiện.
CREATE OR REPLACE FUNCTION public.get_audited_items(
  p_session_id UUID,
  p_status     TEXT DEFAULT 'Draft'
)
RETURNS TABLE (
  id UUID, erp_code TEXT, name TEXT, item_name TEXT, spec TEXT, location TEXT,
  system_qty NUMERIC, actual_qty NUMERIC, difference NUMERIC,
  note TEXT, created_at TIMESTAMPTZ, auditor TEXT, user_email TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ar.id, ar.erp_code,
         COALESCE(i.name, ar.item_name, '(mã không còn trong kho)') AS name,
         COALESCE(ar.item_name, i.name) AS item_name,
         i.spec, ar.location, ar.system_qty, ar.actual_qty,
         COALESCE(ar.difference, ar.actual_qty - ar.system_qty) AS difference,
         ar.note, ar.created_at, ar.auditor, ar.user_email
  FROM public.audit_records ar
  LEFT JOIN LATERAL (
    SELECT name, spec FROM public.inventory WHERE erp = ar.erp_code LIMIT 1
  ) i ON TRUE
  WHERE ar.session_id = p_session_id AND ar.status = p_status
  ORDER BY ar.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_audited_items(UUID, TEXT) TO authenticated;

-- 2c. Gắn các bản ghi mồ côi (Draft/Pending, session_id NULL) vào phiên Draft mới nhất
--     của chính người đã lưu; không có phiên của người đó thì dùng phiên Draft mới nhất bất kỳ.
UPDATE public.audit_records ar
SET session_id = COALESCE(
  (SELECT s.id FROM public.audit_sessions s
     WHERE s.status = 'Draft' AND s.auditor_email = ar.user_email
     ORDER BY s.created_at DESC LIMIT 1),
  (SELECT s.id FROM public.audit_sessions s
     WHERE s.status = 'Draft' ORDER BY s.created_at DESC LIMIT 1)
)
WHERE ar.session_id IS NULL AND ar.status IN ('Draft', 'Pending');

-- 2d. Kiểm tra lại: còn bản ghi mồ côi không?
SELECT count(*) AS orphan_records FROM public.audit_records
WHERE session_id IS NULL AND status IN ('Draft', 'Pending');
