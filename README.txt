HUONG DAN CAI DAT - HE THONG THU THAP DU LIEU LY LICH TU PHAP
Phien ban toi uu: 22/09/2026

1. FILE
- Code.gs: Backend Google Apps Script.
- index.html: Giao dien nhan vien + Admin.
- README.txt: Huong dan cai dat.

2. GOOGLE SHEETS
Tao 1 Google Spreadsheet va tao/nap sheet DSCNV.
Dong 1 cua DSCNV phai co cac cot:
MaNV | HoTen | CCCD

Code cung tu dong tao:
Responses
AdminUsers

3. SCRIPT PROPERTIES
Trong Apps Script:
Project Settings -> Script properties

Them:
SPREADSHEET_ID = ID cua Google Spreadsheet

Khong can tu tao PASSWORD_PEPPER. Ham setup() se tu dong tao.

4. CHAY SETUP
Trong Apps Script, chay ham setup() mot lan.
Cap quyen cho Apps Script neu Google yeu cau.

Tai khoan Admin mac dinh:
Username: admin
Password: ChangeMe@123

Dang nhap va doi mat khau ngay.

5. DEPLOY
Deploy -> New deployment -> Web app
- Execute as: Me
- Who has access: Anyone

Lay URL /exec va gan vao bien API_URL trong index.html.

6. LU Y QUAN TRONG
- CCCD duoc chuan hoa ve chu so de tim kiem, ho tro CCCD co so 0 dau.
- Dashboard Admin chi hien CCCD dang che, khong tra CCCD day du ra giao dien.
- Session duoc luu trong CacheService toi da 6 gio.
- Khi nhan vien gui form xong hoac tu choi, token nhan vien bi huy.
- LockService duoc dung khi ghi Responses de tranh ghi trung khi bam nhieu lan.
- Frontend co timeout 30 giay cho request.
- Loading overlay khoa cac nut trong luc dang goi API.
- Responses duoc cache ngan han de Dashboard khong doc Sheet lap lai qua nhieu.
- Sau khi ghi du lieu, cache duoc xoa de Dashboard nhan du lieu moi.

7. NOI DUNG BIEU MAU
Trang 1:
- Thong bao xu ly du lieu ca nhan.
- Dong y / Khong dong y.
- Neu Khong dong y: ghi nhan "Tu choi" va ket thuc phien.
- Neu Dong y: chuyen sang Trang 2.

Trang 2:
- Ho ten va CCCD lay tu DSCNV, khong cho sua.
- Ngay sinh: bat buoc.
- Gioi tinh: lua chon.
- Dan toc: nhap.
- Ton giao: bat buoc.
- Dia chi thuong tru: bat buoc.
- Trinh do / Chuyen mon.
- Thong tin mien, giam.

8. NEU DA CO DU LIEU CU
Khong xoa sheet Responses/AdminUsers hien tai neu muon giu du lieu.
Code moi van su dung cung ten sheet va cung cac cot chinh.
Tuy nhien nen sao luu Spreadsheet truoc khi chuyen sang phien ban moi.

9. KIEM TRA SAU KHI CAI
- Chay doGet(): phai tra JSON service/version.
- Dang nhap 1 CCCD co trong DSCNV.
- Chon Dong y -> Trang ke khai.
- Gui form -> Responses co 1 dong cap nhat.
- Chon Khong dong y -> Responses co Status = Tu choi.
- Dang nhap Admin -> Dashboard co thong ke va danh sach.
- Doi mat khau Admin.


=== V2 - CONG VAN TRUOC KHI DONG Y ===
- Trang dong y co khung xem cong van/tai lieu ngay truoc cau hoi dong y.
- Mac dinh: assets/cong-van.pdf.
- Ho tro PDF va anh JPG/JPEG/PNG/WebP; co nut mo tai lieu trong tab moi.
- Dat cong van chinh thuc vao assets/cong-van.pdf, hoac sua CONSENT_DOCUMENT_URL trong index.html.
- Khong kem cong van gia/mau trong goi nay.
- Dan toc va Ton giao la dropdown, khong bat buoc.
- Mien/giảm la checkbox dropdown, cho phep chon nhieu; muc 'Khong thuoc...' la lua chon doc lap.


CẬP NHẬT HIỂN THỊ CÔNG VĂN / TÀI LIỆU
- Có thể dùng ảnh JPG/JPEG/PNG/WebP.
- Có thể đổi sang PDF sau này.
- Có thể dán link Google Drive dạng:
  https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  Hệ thống tự chuyển sang /preview để nhúng trực tiếp trong trang.
- File Drive cần được chia sẻ quyền xem phù hợp cho người lao động.
- Không cần sửa phần JavaScript khi chuyển từ JPG sang PDF; chỉ cần đổi CONSENT_DOCUMENT_URL.
