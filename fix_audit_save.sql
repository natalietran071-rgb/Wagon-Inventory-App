-- =====================================================================
-- Kiểm kê: bản ghi đã lưu không hiện ở tab "Đã lưu - Chờ gửi" / "Phê duyệt"
-- =====================================================================
-- Đã áp dụng lên project Main (zginbmciyiqpvttntbeq) ngày 2026-10-24.
--
-- Nguyên nhân thật: bảng audit_records lưu system_qty / actual_qty / difference
-- kiểu INTEGER, nhưng hàm get_audited_items khai báo trả về NUMERIC. Postgres
-- báo "structure of query does not match function result type" ở MỌI lời gọi,
-- app bắt lỗi rồi im lặng nên hai tab luôn rỗng. Bản ghi vẫn được lưu đúng phiên.
--
-- Sửa: ép kiểu rõ ràng trong hàm; đồng thời LEFT JOIN inventory để mã không còn
-- trong kho vẫn hiện tên. Chữ ký và cột trả về giữ nguyên để app không phải đổi.

CREATE OR REPLACE FUNCTION public.get_audited_items(p_session_id uuid, p_status text)
RETURNS TABLE(
  id uuid, erp_code text, item_name text, spec text, location text,
  system_qty numeric, actual_qty numeric, difference numeric,
  auditor text, note text, status text, audit_date date, created_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT ar.id, ar.erp_code,
    COALESCE(ar.item_name, inv.inv_name, '(mã không còn trong kho)')::text,
    COALESCE(ar.spec, inv.inv_spec)::text,
    ar.location,
    ar.system_qty::numeric,
    ar.actual_qty::numeric,
    COALESCE(ar.difference, ar.actual_qty - ar.system_qty)::numeric,
    ar.auditor, ar.note, ar.status, ar.audit_date, ar.created_at
  FROM public.audit_records ar
  LEFT JOIN LATERAL (
    SELECT i.name AS inv_name, i.spec AS inv_spec FROM public.inventory i WHERE i.erp = ar.erp_code LIMIT 1
  ) inv ON TRUE
  WHERE ar.session_id = p_session_id
    AND (p_status = 'all' OR ar.status = p_status)
  ORDER BY ar.created_at DESC;
END;
$function$;

-- Kiểm tra nhanh (thay <session_id> bằng id phiên đang chọn):
-- SELECT * FROM public.get_audited_items('<session_id>'::uuid, 'Draft');
