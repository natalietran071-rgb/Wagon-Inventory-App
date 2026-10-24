<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f3e46de4-873a-4a68-85df-45983c4d59e1

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## 24/10/2026 — Tồn kho: một nguồn sự thật (sửa lỗi trừ/cộng 2 lần)

- **Lỗi:** phiếu xuất 7.000 bị trừ 14.000 vì giao diện tự trừ tồn rồi trigger trong DB trừ thêm lần nữa khi phiếu chuyển "Đã Xuất". Nhập kho cũng bị cộng 2 lần.
- **Sửa:** chỉ trigger trong DB cộng/trừ tồn, và chỉ khi phiếu đã xác nhận (nhập: `Stocked`, xuất: `Đã Xuất`). Giao diện không tự cộng/trừ nữa (Inbound.tsx, Outbound.tsx).
- **Số chờ xác nhận** hiện trong ngoặc dưới Tồn cuối (view `inventory_pending`), chưa tính vào tồn.
- **Cách áp dụng:** 1) mở Supabase → SQL Editor → dán và chạy `sql/2026-10-24_ton_kho_mot_nguon_su_that.sql` (tạo trigger mới, view, và tính lại toàn bộ tồn từ sổ phiếu); 2) deploy code mới. Chạy SQL trước, deploy sau.
