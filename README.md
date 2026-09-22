# Web thu thập dữ liệu lý lịch tư pháp

## Kiến trúc
- Frontend: GitHub Pages (`index.html`)
- Backend/API: Google Apps Script (`Code.gs`)
- Dữ liệu: Google Sheets
- Người lao động đăng nhập bằng CCCD có trong sheet `DSCNV`.
- Admin đăng nhập bằng tài khoản/mật khẩu riêng.
- Mật khẩu admin được lưu dạng SHA-256 + salt + pepper, không lưu mật khẩu rõ.

## 1. Chuẩn bị Google Sheet
Tạo Google Spreadsheet và sheet `DSCNV` với 3 cột:
`MaNV | HoTen | CCCD`

Có thể dùng tên cột tiếng Việt:
`Mã NV | Họ tên | CCCD`
hoặc
`Mã nhân viên | Họ và tên | Số CCCD`

Khuyến nghị cột CCCD để Plain text để giữ số 0 đầu.

## 2. Tạo Apps Script
Extensions > Apps Script > tạo file `Code.gs`, dán toàn bộ Code.gs.

Project Settings > Script properties:
- `SPREADSHEET_ID` = ID Google Spreadsheet
- `PASSWORD_PEPPER` = có thể để trống; hàm setup() sẽ tự tạo nếu chưa có.

Chạy hàm `setup()` một lần. Google sẽ yêu cầu cấp quyền.
Tài khoản admin ban đầu:
- username: `admin`
- password: `ChangeMe@123`

Sau khi đăng nhập phải đổi mật khẩu.

## 3. Deploy API
Deploy > New deployment > Web app:
- Execute as: Me
- Who has access: Anyone

Copy URL `/exec`.

## 4. GitHub Pages
Mở `index.html`, tìm:
`const API_URL = 'PASTE_YOUR_GAS_WEB_APP_EXEC_URL_HERE';`

Thay bằng URL `/exec` của Apps Script.
Commit lên GitHub và bật GitHub Pages.

## 5. Dữ liệu lưu
Code tự tạo sheet `Responses`:
Timestamp | SubmissionId | MaNV | HoTen | CCCD | Consent | NgaySinh |
GioiTinh | DanToc | TonGiao | DiaChiThuongTru | TrinhDoChuyenMon |
MienGiam | Status | UpdatedAt

Mỗi nhân viên chỉ có một bản ghi hiện hành. Nếu gửi lại, hệ thống cập nhật bản ghi thay vì tạo bản sao mới.

## 6. Lưu ý bảo mật
- Không đưa Spreadsheet ID hoặc mật khẩu admin vào frontend.
- CCCD được dùng để xác thực nhân viên, nhưng dashboard chỉ hiển thị 4 số cuối.
- Không ghi CCCD vào URL.
- API dùng POST JSON dạng `text/plain` để tránh CORS preflight thông thường.
- Nên hạn chế chia sẻ URL API và bật HTTPS/GitHub Pages.
- Vì dữ liệu là dữ liệu cá nhân nhạy cảm, doanh nghiệp nên rà soát thêm yêu cầu pháp lý, thời hạn lưu trữ, phân quyền và quy trình xóa/chỉnh sửa dữ liệu trước khi đưa vào vận hành thực tế.

## 7. Có thể mở rộng
- Xuất Excel/CSV từ dashboard.
- Lọc theo phòng ban.
- Thêm cột trạng thái xử lý.
- Thêm chức năng Admin xem/chỉnh sửa một hồ sơ.
- Gửi thông báo cho người chưa kê khai.
