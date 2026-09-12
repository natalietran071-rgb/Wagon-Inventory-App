// Tài khoản nội bộ đăng nhập bằng "mã đăng nhập" (VD: WG001) thay vì email.
// Supabase Auth vẫn cần một địa chỉ email làm định danh, nên mỗi mã được ánh xạ
// sang một email nội bộ cố định dạng <mã>@wagon.local. Email này không dùng để
// gửi thư hay xác nhận gì cả; người dùng không bao giờ thấy nó.

export const LOGIN_CODE_DOMAIN = 'wagon.local';

/** Chuyển mã đăng nhập (hoặc email thật, nếu người dùng gõ vào) thành email dùng cho Supabase Auth. */
export function loginCodeToEmail(input: string): string {
  const value = input.trim().toLowerCase();
  if (value.includes('@')) return value;
  return `${value}@${LOGIN_CODE_DOMAIN}`;
}

/** Hiển thị mã đăng nhập: bỏ phần @wagon.local, viết hoa. Email thật thì giữ nguyên. */
export function displayLoginCode(emailOrCode?: string | null): string {
  if (!emailOrCode) return '';
  const value = emailOrCode.trim();
  const suffix = `@${LOGIN_CODE_DOMAIN}`;
  if (value.toLowerCase().endsWith(suffix)) {
    return value.slice(0, -suffix.length).toUpperCase();
  }
  return value;
}
