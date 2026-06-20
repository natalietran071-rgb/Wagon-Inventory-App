# Wagon Inventory App — Tổng Hợp Quy Trình Vận Hành

> Tài liệu này để bạn đọc lại khi quên mình đang ở đâu trong tiến độ. Viết theo lưu trình thực tế, module nào nối với module nào, và tình trạng đồng bộ giữa **bản chính (Production / main)** và **bản nhánh (Preview / branch `claude/fix-outbound-imports-4RlzJ`)**.

## 0. Hai môi trường đang tồn tại

| | Production (main) | Wagon Preview (branch) |
|---|---|---|
| Supabase project | `zginbmciyiqpvttntbeq` | `nfenstuyyzjommplhsbj` |
| Database | Riêng biệt, KHÔNG tự đồng bộ với nhau | Riêng biệt |
| Mục đích | App thật, dữ liệu thật | Môi trường test trước khi đẩy lên main |
| Trạng thái tính năng Dept-routing (Shipment) | Đầy đủ từ đầu | Vừa được dựng lại đủ (xem mục 7) |

**Lưu ý quan trọng:** Tài khoản đăng nhập (email/password) ở 2 bên KHÔNG chung nhau. Đổi password ở bên này không ảnh hưởng bên kia — phải set tay từng bên nếu muốn dùng chung.

---

## 1. Sơ đồ lưu trình tổng quát (theo đường đi của 1 món hàng)

```
[Mua hàng / Đặt hàng]
        |
        v
   ON THE WAY  (Hàng đang về)  -- "Nhập Kho" -->  INBOUND (Nhập kho)
        |                                              |
        |                                              v
        |                                        INVENTORY (Tồn kho) <---- ITEM MANAGEMENT (tạo SKU mới)
        |                                              ^
        |                                              |  (đối chiếu mã)
        |                                        MASTER ERP (danh mục mã hàng chuẩn)
        |
        v
   OUTBOUND (Xuất kho) -- xác nhận xuất -->  trừ INVENTORY, tạo SHIPMENT (Giao hàng)
                                                        |
                                                        v
                                          Bộ phận nhận hàng XÁC NHẬN trên SHIPMENT
                                                        |
                                              (nếu từ chối) --> Trả lại kho

   AUDIT (Kiểm kê)  -- đối chiếu định kỳ -->  điều chỉnh INVENTORY theo số thực tế
   USER MANAGEMENT -- tạo/sửa account, gán role + dept_code cho từng bộ phận
```

---

## 2. Chi tiết từng module

### 2.1 Inbound — Nhập Kho
- **Làm gì:** Nhập tay 1 dòng, hoặc dán nhiều dòng từ Excel (Order ID, PO, ERP, Qty, Bộ phận, Vị trí...).
- **Ghi vào:** `inbound_records` (lịch sử nhập) → `movements` (log giao dịch IN) → `inventory` (cộng `in_qty` và `end_stock`).
- **Sửa/xoá:** có lưu lại lý do vào `edit_history_inbound`.

### 2.2 On The Way — Hàng Đang Về
- **Làm gì:** Khai báo trước các đơn hàng đang vận chuyển (chưa tới kho), status = `pending`.
- **Khi hàng tới:** bấm "Nhập Kho" → tự động tạo `inbound_records` + cộng `inventory`, đổi status `on_the_way` thành `arrived`.
- **Liên kết:** đây là bước TRƯỚC Inbound — giúp kho biết hàng nào sắp về để theo dõi (badge "OTW" hiện trên Inventory).

### 2.3 Inventory — Tồn Kho
- **Vai trò:** Bảng trung tâm — mọi module khác đều đọc/ghi vào đây.
- **Hiển thị:** tồn hiện tại, tồn tối thiểu, cảnh báo (âm kho, thiếu thông tin, trùng mã, hàng critical).
- **Đọc thêm từ:** `on_the_way` (badge OTW), `inbound_records`/`outbound_records` (tổng nhập/xuất theo khoảng ngày).

### 2.4 Master ERP — Danh Mục Mã Hàng Chuẩn
- **Làm gì:** Danh sách mã ERP chuẩn (tên Việt, tên Trung, quy cách) dùng để đối chiếu khi nhập liệu ở Item Management/Inbound.
- **Bảng:** `master_erp` (chính), `master_erp_pending` (mã trùng trong file chờ duyệt).

### 2.5 Item Management — Quản Lý Mã Hàng (SKU)
- **Làm gì:** Tạo mã hàng mới vào `inventory` (tồn đầu kỳ), hoặc upload Excel hàng loạt.
- **Hàng thiếu thông tin/trùng:** rơi vào `inbound_upload_pending` để duyệt sau.

### 2.6 Outbound — Xuất Kho
- **Làm gì:** Nhập đơn xuất (người nhận, bộ phận, mã ERP, qty, BPM số), status ban đầu = `Chờ xuất`.
- **Bấm "Xuất Kho":** RPC `confirm_outbound_batch` → đổi status `Đã Xuất`, **trừ ngay** `inventory.end_stock`, cộng `out_qty`, ghi `movements` (OUT).
- **Quan trọng:** Tại đây, nếu đơn có `dept_code`, **trigger tự động tạo phiếu trong `shipment_confirmations`** (status=`Pending`) — đây là cầu nối sang module Shipment.
- **Hàng thiếu thông tin:** rơi vào `outbound_pending`.

### 2.7 Shipment — Giao Hàng (xác nhận theo bộ phận)
- **Làm gì:** Bộ phận nhận hàng (dept_user) chỉ thấy phiếu của đúng `dept_code` mình (lọc qua RPC `get_shipments`). Admin/editor (kho) thấy tất cả.
- **Bộ phận xác nhận:** "Xác nhận đã nhận" (RPC `confirm_shipment`) hoặc "Từ chối" (RPC `reject_shipment`, có bắt buộc nêu lý do).
- **Nếu bị từ chối:** kho xác nhận nhận lại hàng (RPC `confirm_shipment_return`) → status `Returned`, đẩy `outbound_records.status` về `Đã Trả Kho`.
- **CHƯA CÓ (việc còn tồn):** Inventory hiện **không hiển thị cảnh báo** khi hàng đã trừ kho nhưng bộ phận chưa confirm — chỉ thấy trong tab riêng của Shipment ("Chờ xác nhận", màu vàng). Đây là điểm đang để ngỏ, có thể làm thêm badge cảnh báo trên Inventory giống kiểu "OTW" nếu cần.
- **Trạng thái dữ liệu:** `Pending` → `Confirmed` hoặc `Rejected` → (nếu Rejected) `Returned`.

### 2.8 Audit — Kiểm Kê
- **Làm gì:** Tạo phiên kiểm kê (`audit_sessions`), lọc mã có biến động (RPC `get_audit_items`), nhập số thực tế → lưu Draft (`audit_records`).
- **Luồng duyệt:** Draft → gửi duyệt (Pending) → Admin duyệt (RPC `approve_audit_records`) → **tự động điều chỉnh `inventory.end_stock`** theo số chênh lệch thực tế.

### 2.9 User Management — Quản Lý Người Dùng
- **Làm gì:** Tạo account (RPC `admin_create_user`), gán role (`admin`/`editor`/`viewer`/`dept_user`) + `dept_code`/`dept_name` nếu là dept_user.
- **Liên kết quan trọng:** `dept_code` gán ở đây chính là chìa khoá để Shipment lọc đúng phiếu cho đúng bộ phận (mục 2.7).

---

## 3. Bảng liên kết module ↔ bảng dữ liệu (nhìn nhanh)

| Module ghi vào | Bảng | Module khác đọc ra |
|---|---|---|
| Inbound, On The Way | `inbound_records` | Inventory (tổng nhập) |
| Outbound | `outbound_records` | Inventory (tổng xuất), Shipment (qua trigger) |
| Outbound (trigger tự động) | `shipment_confirmations` | Shipment |
| Item Management, Inbound, Outbound, Audit | `inventory` | **Mọi module** (bảng trung tâm) |
| User Management | `profiles` (dept_code, role) | Shipment (lọc theo dept_code), Sidebar (ẩn/hiện menu theo role) |
| Master ERP | `master_erp` | Item Management (đối chiếu tên/mã) |

---

## 4. Việc còn tồn / cần làm tiếp

1. **Inventory chưa cảnh báo "đã trừ kho nhưng chưa được confirm"** — đề xuất thêm badge giống "OTW" cho các ERP có `shipment_confirmations.status = 'Pending'` lâu.
2. **Đồng bộ password/account giữa main và branch** — phải set tay, không tự động.
3. Khi tạo dept_user mới (ví dụ "Lắp Ráp"), nhớ kiểm tra lại bằng cách: tạo 1 phiếu xuất với `dept_code` đó → đăng nhập bằng account dept_user → xem Shipment có hiện phiếu không.

---

*Cập nhật lần cuối dựa trên buổi làm việc sửa lỗi tạo user (`admin_create_user`, `provider_id`, `profiles_role_check`) và dựng lại toàn bộ subsystem Shipment trên môi trường Preview.*
