-- =====================================================================
-- 24/10/2026 — TỒN KHO: MỘT NGUỒN SỰ THẬT (chạy trong Supabase → SQL Editor, bấm Run 1 lần)
--
-- LỖI ĐÃ GẶP: phiếu xuất 7.000 bị trừ thành 14.000 (mã YZCDLA00006).
--   Giao diện tự trừ tồn (Outbound.tsx) + trigger trong DB trừ thêm lần nữa khi phiếu
--   chuyển sang 'Đã Xuất'. Nhập kho cũng bị cộng 2 lần theo cùng cơ chế.
--
-- SAU FILE NÀY:
--   • CHỈ trigger trong DB cộng/trừ tồn, và CHỈ khi phiếu đã xác nhận:
--       phiếu nhập: status = 'Stocked'      (đã nhận)
--       phiếu xuất: status = 'Đã Xuất'      (đã giao hoàn tất)
--     Phiếu 'Chờ xuất' / chưa 'Stocked' KHÔNG đụng tới tồn. Sửa số lượng, đổi trạng thái,
--     xoá phiếu đều được trigger tự điều chỉnh đúng một lần.
--   • View inventory_pending: số đang chờ xác nhận (để giao diện hiện trong ngoặc).
--   • Tính lại TOÀN BỘ inventory từ sổ phiếu: tồn cuối = tồn đầu + nhập đã nhận − xuất đã giao.
--
-- Chạy TRƯỚC khi deploy code mới. Chạy lại nhiều lần cũng không sao (idempotent).
-- =====================================================================
BEGIN;

-- 0. Bỏ mọi trigger cũ (các phiên bản khác nhau từng được tạo)
DROP TRIGGER IF EXISTS trg_update_inventory_inbound        ON inbound_records;
DROP TRIGGER IF EXISTS trg_update_inventory_outbound       ON outbound_records;
DROP TRIGGER IF EXISTS trg_update_inventory_inbound_update ON inbound_records;
DROP TRIGGER IF EXISTS trg_update_inventory_outbound_update ON outbound_records;
DROP TRIGGER IF EXISTS trg_update_inventory_inbound_delete ON inbound_records;
DROP TRIGGER IF EXISTS trg_update_inventory_outbound_delete ON outbound_records;
DROP TRIGGER IF EXISTS trg_inv_inbound  ON inbound_records;
DROP TRIGGER IF EXISTS trg_inv_outbound ON outbound_records;

-- 0b. Kiểm tra: mỗi mã chỉ được có 1 dòng inventory (app dùng upsert onConflict erp)
DO $$
DECLARE d INT;
BEGIN
  SELECT count(*) INTO d FROM (SELECT erp FROM inventory GROUP BY erp HAVING count(*) > 1) x;
  IF d > 0 THEN
    RAISE EXCEPTION 'inventory có % mã bị trùng (nhiều dòng cho cùng 1 mã). Gộp các dòng trùng trước rồi chạy lại file này.', d;
  END IF;
END $$;

-- 1. Hàm cộng/trừ vào inventory (tự tạo dòng nếu mã chưa có). SECURITY DEFINER để không vướng RLS.
CREATE OR REPLACE FUNCTION inv_apply(p_erp TEXT, p_in NUMERIC, p_out NUMERIC,
                                     p_unit TEXT DEFAULT NULL, p_pos TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_erp IS NULL OR btrim(p_erp) = '' THEN RETURN; END IF;
  IF COALESCE(p_in, 0) = 0 AND COALESCE(p_out, 0) = 0 THEN RETURN; END IF;
  UPDATE inventory
     SET in_qty    = COALESCE(in_qty, 0)    + COALESCE(p_in, 0),
         out_qty   = COALESCE(out_qty, 0)   + COALESCE(p_out, 0),
         end_stock = COALESCE(end_stock, 0) + COALESCE(p_in, 0) - COALESCE(p_out, 0)
   WHERE id = (SELECT id FROM inventory WHERE erp = p_erp ORDER BY created_at LIMIT 1);
  IF NOT FOUND THEN
    INSERT INTO inventory (erp, name, unit, pos, start_stock, in_qty, out_qty, end_stock)
    VALUES (p_erp, '', COALESCE(p_unit, ''), COALESCE(NULLIF(p_pos, ''), 'MAIN'), 0,
            COALESCE(p_in, 0), COALESCE(p_out, 0), COALESCE(p_in, 0) - COALESCE(p_out, 0));
  END IF;
END $$;

-- 2. Trigger phiếu NHẬP: chỉ tính khi status = 'Stocked' (đã nhận)
CREATE OR REPLACE FUNCTION trg_inv_inbound_fn() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE o NUMERIC := 0; n NUMERIC := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Stocked' THEN PERFORM inv_apply(OLD.erp_code, -COALESCE(OLD.qty, 0), 0); END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Stocked' THEN o := COALESCE(OLD.qty, 0); END IF;
  IF NEW.status = 'Stocked' THEN n := COALESCE(NEW.qty, 0); END IF;
  IF TG_OP = 'UPDATE' AND OLD.erp_code IS DISTINCT FROM NEW.erp_code THEN
    PERFORM inv_apply(OLD.erp_code, -o, 0);
    PERFORM inv_apply(NEW.erp_code,  n, 0, NEW.unit, NEW.location);
  ELSE
    PERFORM inv_apply(NEW.erp_code, n - o, 0, NEW.unit, NEW.location);
  END IF;
  RETURN NEW;
END $$;

-- 3. Trigger phiếu XUẤT: chỉ tính khi status = 'Đã Xuất' (đã giao hoàn tất)
CREATE OR REPLACE FUNCTION trg_inv_outbound_fn() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE o NUMERIC := 0; n NUMERIC := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Đã Xuất' THEN PERFORM inv_apply(OLD.erp_code, 0, -COALESCE(OLD.qty, 0)); END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Đã Xuất' THEN o := COALESCE(OLD.qty, 0); END IF;
  IF NEW.status = 'Đã Xuất' THEN n := COALESCE(NEW.qty, 0); END IF;
  IF TG_OP = 'UPDATE' AND OLD.erp_code IS DISTINCT FROM NEW.erp_code THEN
    PERFORM inv_apply(OLD.erp_code, 0, -o);
    PERFORM inv_apply(NEW.erp_code, 0,  n, NULL, NEW.location);
  ELSE
    PERFORM inv_apply(NEW.erp_code, 0, n - o, NULL, NEW.location);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_inv_inbound
AFTER INSERT OR UPDATE OR DELETE ON inbound_records
FOR EACH ROW EXECUTE FUNCTION trg_inv_inbound_fn();

CREATE TRIGGER trg_inv_outbound
AFTER INSERT OR UPDATE OR DELETE ON outbound_records
FOR EACH ROW EXECUTE FUNCTION trg_inv_outbound_fn();

-- 4. View số ĐANG CHỜ XÁC NHẬN (chưa cộng/trừ vào tồn) — giao diện hiện trong ngoặc
CREATE OR REPLACE VIEW inventory_pending AS
SELECT erp, SUM(cho_nhan) AS cho_nhan, SUM(cho_xuat) AS cho_xuat
FROM (
  SELECT erp_code AS erp, COALESCE(qty, 0) AS cho_nhan, 0 AS cho_xuat
    FROM inbound_records  WHERE status IS DISTINCT FROM 'Stocked'
  UNION ALL
  SELECT erp_code, 0, COALESCE(qty, 0)
    FROM outbound_records WHERE status IS DISTINCT FROM 'Đã Xuất'
) t
WHERE erp IS NOT NULL AND erp <> ''
GROUP BY erp;
GRANT SELECT ON inventory_pending TO anon, authenticated;

-- 5. TÍNH LẠI TOÀN BỘ inventory từ sổ phiếu
-- 5a. Mã chỉ có trong phiếu mà chưa có dòng inventory → tạo dòng
INSERT INTO inventory (erp, name, unit, pos, start_stock, in_qty, out_qty, end_stock)
SELECT DISTINCT ON (r.erp_code) r.erp_code, '', COALESCE(r.unit, ''), COALESCE(NULLIF(r.location, ''), 'MAIN'), 0, 0, 0, 0
  FROM inbound_records r LEFT JOIN inventory i ON i.erp = r.erp_code
 WHERE i.erp IS NULL AND r.erp_code IS NOT NULL AND r.erp_code <> '';
INSERT INTO inventory (erp, name, unit, pos, start_stock, in_qty, out_qty, end_stock)
SELECT DISTINCT ON (o.erp_code) o.erp_code, '', '', COALESCE(NULLIF(o.location, ''), 'MAIN'), 0, 0, 0, 0
  FROM outbound_records o LEFT JOIN inventory i ON i.erp = o.erp_code
 WHERE i.erp IS NULL AND o.erp_code IS NOT NULL AND o.erp_code <> '';

-- 5b. in_qty = tổng phiếu nhập đã nhận · out_qty = tổng phiếu xuất đã giao · tồn cuối = tồn đầu + in − out
WITH s AS (
  SELECT erp, SUM(i) AS i, SUM(o) AS o FROM (
    SELECT erp_code AS erp, SUM(COALESCE(qty, 0)) AS i, 0 AS o FROM inbound_records  WHERE status = 'Stocked' GROUP BY erp_code
    UNION ALL
    SELECT erp_code, 0, SUM(COALESCE(qty, 0)) FROM outbound_records WHERE status = 'Đã Xuất' GROUP BY erp_code
  ) t GROUP BY erp
)
UPDATE inventory inv
   SET in_qty    = COALESCE(s.i, 0),
       out_qty   = COALESCE(s.o, 0),
       end_stock = COALESCE(inv.start_stock, 0) + COALESCE(s.i, 0) - COALESCE(s.o, 0)
  FROM inventory inv2 LEFT JOIN s ON s.erp = inv2.erp
 WHERE inv.id = inv2.id;

COMMIT;

-- 6. KIỂM TRA (chỉ đọc): mã bị lỗi hôm nay + số mã tồn âm
SELECT erp, name, start_stock, in_qty, out_qty, end_stock FROM inventory WHERE erp = 'YZCDLA00006';
SELECT count(*) AS so_ma_ton_am FROM inventory WHERE end_stock < 0;
SELECT * FROM inventory_pending ORDER BY cho_xuat DESC LIMIT 20;
