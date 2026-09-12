-- Sửa lỗi "đánh dấu Critical Item không lưu được" và lịch sử chỉnh sửa vật tư bị mất.
-- Đã áp dụng ngày 2026-09-12:
--   * Phần A lên project Main (zginbmciyiqpvttntbeq)
--   * Phần B lên project Wagon Preview (nfenstuyyzjommplhsbj)
-- Cả hai phần đều chạy lại được nhiều lần (idempotent); chạy phần nào lên project nào cũng an toàn.

-- =====================================================================
-- A. Main
-- =====================================================================
-- A1. Trigger trg_auto_critical tự ghi đè cờ critical theo công thức
--     critical = (end_stock <= min_stock) mỗi khi UPDATE inventory, nên người dùng
--     tick Critical rồi lưu là bị gạt về false. Critical là cờ do người dùng chọn
--     ("vật tư quan trọng"); cảnh báo tồn thấp app tự tính riêng. Bỏ trigger.
DROP TRIGGER IF EXISTS trg_auto_critical ON public.inventory;
DROP FUNCTION IF EXISTS public.auto_update_critical();

-- A2. Bảng edit_history_inventory trên Main có cột cũ (erp, field_changed, note,
--     changed_by, changed_at) do trigger log_inventory_history ghi, còn app ghi/đọc
--     bằng erp_code, field_name, reason, edited_by, edited_at. Thêm cột app cần và
--     một trigger đồng bộ hai bộ cột để cả hai bên ghi đều đọc được.
ALTER TABLE public.edit_history_inventory
  ADD COLUMN IF NOT EXISTS erp_code   text,
  ADD COLUMN IF NOT EXISTS field_name text,
  ADD COLUMN IF NOT EXISTS reason     text,
  ADD COLUMN IF NOT EXISTS edited_by  text,
  ADD COLUMN IF NOT EXISTS edited_at  timestamptz DEFAULT now();
ALTER TABLE public.edit_history_inventory ALTER COLUMN erp DROP NOT NULL;

UPDATE public.edit_history_inventory SET
  erp_code   = COALESCE(erp_code, erp),
  field_name = COALESCE(field_name, field_changed),
  reason     = COALESCE(reason, note),
  edited_by  = COALESCE(edited_by, changed_by),
  edited_at  = COALESCE(edited_at, changed_at, now());

CREATE OR REPLACE FUNCTION public.sync_edit_history_inventory_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.erp           := COALESCE(NEW.erp, NEW.erp_code);
  NEW.erp_code      := COALESCE(NEW.erp_code, NEW.erp);
  NEW.field_name    := COALESCE(NEW.field_name, NEW.field_changed);
  NEW.field_changed := COALESCE(NEW.field_changed, NEW.field_name);
  NEW.reason        := COALESCE(NEW.reason, NEW.note);
  NEW.note          := COALESCE(NEW.note, NEW.reason);
  NEW.edited_by     := COALESCE(NEW.edited_by, NEW.changed_by);
  NEW.changed_by    := COALESCE(NEW.changed_by, NEW.edited_by);
  NEW.edited_at     := COALESCE(NEW.edited_at, NEW.changed_at, now());
  NEW.changed_at    := COALESCE(NEW.changed_at, NEW.edited_at);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_edit_history_inventory ON public.edit_history_inventory;
CREATE TRIGGER trg_sync_edit_history_inventory
  BEFORE INSERT ON public.edit_history_inventory
  FOR EACH ROW EXECUTE FUNCTION public.sync_edit_history_inventory_columns();

CREATE INDEX IF NOT EXISTS edit_history_inventory_erp_code_idx
  ON public.edit_history_inventory (erp_code, edited_at DESC);

-- =====================================================================
-- B. Wagon Preview
-- =====================================================================
-- Bốn bảng này bật RLS nhưng không có policy nào => mọi INSERT/SELECT từ app bị
-- từ chối âm thầm (lịch sử chỉnh sửa vật tư, lịch sử sửa phiếu nhập, phiên và vị trí
-- kiểm kê). Dùng cùng mẫu "Allow all" cho authenticated như các bảng khác.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['edit_history_inventory','edit_history_inbound','audit_locations','audit_sessions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow all on ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', 'Allow all on ' || t, t);
  END LOOP;
END $$;
