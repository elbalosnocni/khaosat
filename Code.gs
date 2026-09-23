const MIEN_GIAM_ALLOWED_ = [
  'Không thuộc trường hợp miễn/giảm','Trẻ em','Người cao tuổi','Người khuyết tật',
  'Hộ nghèo/cận nghèo','Cư trú tại xã đặc biệt khó khăn',
  'Đồng bào dân tộc thiểu số ở xã có điều kiện KT-XH đặc biệt khó khăn',
  'Cư trú tại xã biên giới','Cư trú tại xã an toàn khu',
  'Học sinh từ đủ 16 tuổi trở lên','Sinh viên','Người có công với cách mạng',
  'Thân nhân liệt sĩ','Người có công nuôi liệt sĩ','Khác'
];

/**
 * HỆ THỐNG THU THẬP DỮ LIỆU LÝ LỊCH TƯ PHÁP
 * Google Apps Script Backend - Phiên bản không lỗi xuất Excel
 * Cập nhật: 23/09/2026
 */

const CONFIG = Object.freeze({
  EMPLOYEE_SHEET: 'DSCNV',
  RESPONSE_SHEET: 'Responses',
  ADMIN_SHEET: 'AdminUsers',

  SESSION_SECONDS: 6 * 60 * 60,

  PEPPER_PROPERTY: 'PASSWORD_PEPPER',
  SPREADSHEET_PROPERTY: 'SPREADSHEET_ID',
  DEADLINE_PROPERTY: 'SYSTEM_DEADLINE', // Thuộc tính lưu thời hạn cấu hình từ Admin

  MAX_TEXT: 2000,
  MAX_CCCD_LENGTH: 12,
  EMPLOYEE_CACHE_SECONDS: 300,
  RESPONSE_CACHE_SECONDS: 60
});

/* ========================= SETUP ========================= */

function setup() {
  const ss = getSS_();

  ensureSheet_(ss, CONFIG.EMPLOYEE_SHEET, ['MaNV', 'HoTen', 'CCCD']);
  ensureSheet_(ss, CONFIG.RESPONSE_SHEET, [
    'Timestamp', 'SubmissionId', 'MaNV', 'HoTen', 'CCCD', 'Consent',
    'NgaySinh', 'GioiTinh', 'DanToc', 'TonGiao', 'DiaChiThuongTru', 'DiaChiTamTru',
    'TrinhDoHocVan', 'TrinhDoChuyenMon', 'MienGiam', 'Status', 'UpdatedAt'
  ]);
  ensureSheet_(ss, CONFIG.ADMIN_SHEET, [
    'Username', 'PasswordHash', 'PasswordSalt', 'Active', 'CreatedAt', 'UpdatedAt'
  ]);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(CONFIG.PEPPER_PROPERTY)) {
    props.setProperty(CONFIG.PEPPER_PROPERTY, randomHex_(64));
  }
  
  // Đặt cấu hình thời hạn biểu mẫu mặc định ban đầu nếu chưa thiết lập
  if (!props.getProperty(CONFIG.DEADLINE_PROPERTY)) {
    props.setProperty(CONFIG.DEADLINE_PROPERTY, '2026-12-31T23:59');
  }

  const admin = getSheet_(CONFIG.ADMIN_SHEET);
  if (admin.getLastRow() <= 1) {
    const salt = randomHex_(32);
    const hash = hashPassword_('ChangeMe@123', salt);
    admin.appendRow(['admin', hash, salt, true, new Date(), new Date()]);
    Logger.log('Tai khoan admin mac dinh: admin / ChangeMe@123. Hay doi mat khau ngay.');
  }

  clearDataCaches_();
  return 'Setup completed.';
}

/* ========================= HTTP INTERFACES ========================= */

function doGet() {
  const deadlineStr = PropertiesService.getScriptProperties().getProperty(CONFIG.DEADLINE_PROPERTY) || '';
  return json_({
    ok: true,
    service: 'ly-lich-tu-phap-api',
    version: '3.1',
    time: new Date().toISOString(),
    deadline: deadlineStr,
    isExpired: isLinkExpired_()
  });
}

function doPost(e) {
  try {
    const body = parseRequest_(e);
    const action = String(body.action || '').trim();

    // Ngoại lệ các tính năng của Admin: Admin vẫn vào được Dashboard kể cả khi link khai báo của nhân viên hết hạn
    const isAdminAction = ['adminLogin', 'adminDashboard', 'adminChangePassword', 'adminLogout', 'adminDownloadExcel', 'adminSetDeadline'].indexOf(action) >= 0;

    if (!isAdminAction && isLinkExpired_()) {
      return json_({
        ok: false,
        error: 'LINK_EXPIRED',
        message: 'Hệ thống đã khóa! Liên kết thu thập thông tin đã hết thời hạn quy định.'
      });
    }

    switch (action) {
      case 'employeeLogin': return employeeLogin_(body);
      case 'saveConsent': return saveConsent_(body);
      case 'submitForm': return submitForm_(body);
      case 'getMySubmission': return getMySubmission_(body);

      case 'adminLogin': return adminLogin_(body);
      case 'adminDashboard': return adminDashboard_(body);
      case 'adminChangePassword': return adminChangePassword_(body);
      case 'adminLogout': return adminLogout_(body);
      case 'adminDownloadExcel': return adminDownloadExcel_(body); // Tải Excel trực tiếp từ dữ liệu mảng
      case 'adminSetDeadline': return adminSetDeadline_(body);     // Lưu cấu hình hạn chót mới từ Admin

      default:
        return json_({ ok: false, error: 'INVALID_ACTION', message: 'Yeu cau khong hop le.' });
    }
  } catch (err) {
    console.error(err);
    return json_({
      ok: false,
      error: 'SERVER_ERROR',
      message: safeMessage_(err)
    });
  }
}

function parseRequest_(e) {
  const raw = (e && e.postData && e.postData.contents) || '{}';
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('Du lieu gui len khong phai JSON hop le.');
  }
}

/* ========================= ĐÓNG LINK / KIỂM TRA HẾT HẠN ========================= */

function isLinkExpired_() {
  const deadlineStr = PropertiesService.getScriptProperties().getProperty(CONFIG.DEADLINE_PROPERTY);
  if (!deadlineStr) return false;
  
  const deadlineDate = new Date(deadlineStr);
  if (isNaN(deadlineDate.getTime())) return false;
  
  return Date.now() > deadlineDate.getTime();
}

/* ========================= EMPLOYEE LOGIC ========================= */

function employeeLogin_(b) {
  const cccd = normalizeCCCD_(b.cccd);

  if (!/^\d{9,12}$/.test(cccd)) {
    return json_({
      ok: false,
      error: 'INVALID_CCCD',
      message: 'So CCCD phai co 9 den 12 chu so.'
    });
  }

  const emp = findEmployeeByCCCD_(cccd);
  if (!emp) {
    return json_({
      ok: false,
      error: 'NOT_FOUND',
      message: 'Khong tim thay so CCCD trong danh sach nhan vien.'
    });
  }

  const token = createSession_('employee', {
    maNV: emp.maNV,
    hoTen: emp.hoTen,
    cccd: cccd
  });

  const previous = findLatestResponseByMaNV_(emp.maNV);

  return json_({
    ok: true,
    token: token,
    employee: {
      maNV: emp.maNV,
      hoTen: emp.hoTen,
      cccd: cccd
    },
    previous: previous ? sanitizeResponse_(previous) : null
  });
}

function saveConsent_(b) {
  const session = requireEmployeeSession_(b.token);
  if (!session) {
    return json_({ ok: false, error: 'UNAUTHORIZED', message: 'Phien lam viec da het han. Vui long dang nhap lai.' });
  }

  const consent = b.consent === true;
  const existing = findLatestResponseByMaNV_(session.maNV);

  if (!consent) {
    upsertResponse_(session, {
      Consent: 'Khong dong y',
      Status: 'Tu choi',
      UpdatedAt: new Date()
    }, existing);

    destroySession_(b.token);

    return json_({
      ok: true,
      next: 'end',
      message: 'Da ghi nhan lua chon khong dong y.'
    });
  }

  upsertResponse_(session, {
    Consent: 'Dong y',
    Status: 'Dang ke khai',
    UpdatedAt: new Date()
  }, existing);

  return json_({ ok: true, next: 'form' });
}

function normalizeMienGiam_(value) {
  const raw = clean_(value);
  if (!raw) return '';
  const selected = raw.split(';').map(function(s){ return clean_(s); })
    .filter(function(s){ return MIEN_GIAM_ALLOWED_.indexOf(s) >= 0; });
  const unique = [];
  selected.forEach(function(s){ if (unique.indexOf(s) < 0) unique.push(s); });
  if (unique.indexOf('Không thuộc trường hợp miễn/giảm') >= 0) return 'Không thuộc trường hợp miễn/giảm';
  return unique.join('; ');
}

function submitForm_(b) {
  const session = requireEmployeeSession_(b.token);
  if (!session) {
    return json_({ ok: false, error: 'UNAUTHORIZED', message: 'Phien lam viec da het han. Vui long dang nhap lai.' });
  }

  if (b.consent !== true) {
    return json_({
      ok: false,
      error: 'CONSENT_REQUIRED',
      message: 'Vui long xac nhan dong y truoc khi ke khai.'
    });
  }

  const fields = {
    ngaySinh: clean_(b.ngaySinh),
    gioiTinh: clean_(b.gioiTinh),
    danToc: clean_(b.danToc),
    tonGiao: clean_(b.tonGiao),
    diaChiThuongTru: clean_(b.diaChiThuongTru),
    diaChiTamTru: clean_(b.diaChiTamTru),
    trinhDoHocVan: clean_(b.trinhDoHocVan),
    trinhDoChuyenMon: clean_(b.trinhDoChuyenMon),
    mienGiam: normalizeMienGiam_(b.mienGiam)
  };

  const required = [
    ['ngaySinh', 'Ngay, thang, nam sinh'],
    ['diaChiThuongTru', 'Dia chi thuong tru']
  ];

  for (let i = 0; i < required.length; i++) {
    const key = required[i][0];
    if (!fields[key]) {
      return json_({
        ok: false,
        error: 'MISSING_REQUIRED',
        field: key,
        message: 'Vui long dien day du: ' + required[i][1] + '.'
      });
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.ngaySinh)) {
    return json_({
      ok: false,
      error: 'INVALID_DATE',
      field: 'ngaySinh',
      message: 'Ngay sinh khong dung dinh dang.'
    });
  }

  const existing = findLatestResponseByMaNV_(session.maNV);

  upsertResponse_(session, {
    Consent: 'Dong y',
    NgaySinh: fields.ngaySinh,
    GioiTinh: fields.gioiTinh,
    DanToc: fields.danToc,
    TonGiao: fields.tonGiao,
    DiaChiThuongTru: fields.diaChiThuongTru,
    DiaChiTamTru: fields.diaChiTamTru,
    TrinhDoHocVan: fields.trinhDoHocVan,
    TrinhDoChuyenMon: fields.trinhDoChuyenMon,
    MienGiam: fields.mienGiam,
    Status: 'Da hoan tat',
    UpdatedAt: new Date()
  }, existing);

  destroySession_(b.token);

  return json_({
    ok: true,
    message: 'Da luu thong tin ke khai thanh cong.'
  });
}

function getMySubmission_(b) {
  const session = requireEmployeeSession_(b.token);
  if (!session) {
    return json_({ ok: false, error: 'UNAUTHORIZED' });
  }

  const r = findLatestResponseByMaNV_(session.maNV);
  return json_({
    ok: true,
    submission: r ? sanitizeResponse_(r) : null
  });
}

/* ========================= ADMIN LOGIC ========================= */

function adminLogin_(b) {
  const username = clean_(b.username, 100);
  const password = String(b.password || '');

  if (!username || !password) {
    return json_({ ok: false, error: 'INVALID_LOGIN', message: 'Vui long nhap day du tai khoan va mat khau.' });
  }

  const admin = findAdmin_(username);
  if (!admin || !isActive_(admin.active)) {
    return json_({ ok: false, error: 'INVALID_LOGIN', message: 'Tai khoan hoac mat khau khong dung.' });
  }

  const hash = hashPassword_(password, admin.salt);
if (!secureEqual_(hash, admin.hash)) {
return json_({ ok: false, error: 'INVALID_LOGIN', message: 'Tai khoan hoac mat khau khong dung.' });
}
const token = createSession_('admin', { username: username });
return json_({ ok: true, token: token });
}
function adminDashboard_(b) {
const session = requireAdminSession_(b.token);
if (!session) {
return json_({ ok: false, error: 'UNAUTHORIZED', message: 'Phien admin da het han. Vui long dang nhap lai.' });
}
const ss = getSS_();
const employees = getEmployeeObjects_(ss);
const responses = getResponseObjects_(ss);
const deadlineStr = PropertiesService.getScriptProperties().getProperty(CONFIG.DEADLINE_PROPERTY) || '';
const latest = Object.create(null);
for (let i = 0; i < responses.length; i++) {
const r = responses[i];
const key = String(r.MaNV || '').trim();
if (!key) continue;
const currTime = dateMs_(r.UpdatedAt || r.Timestamp);
const oldTime = latest[key] ? dateMs_(latest[key].UpdatedAt || latest[key].Timestamp) : -1;
if (!latest[key] || currTime >= oldTime) {
latest[key] = r;
}
}
const summary = { totalEmployees: employees.length, completed: 0, inProgress: 0, refused: 0, notStarted: 0 };
const list = new Array(employees.length);
for (let i = 0; i < employees.length; i++) {
const e = employees[i];
const r = latest[e.MaNV];
const status = r ? String(r.Status || 'Dang ke khai') : 'Chua dien';
if (status === 'Da hoan tat') summary.completed++;
else if (status === 'Dang ke khai') summary.inProgress++;
else if (status === 'Tu choi') summary.refused++;
else summary.notStarted++;
list[i] = {
maNV: e.MaNV,
hoTen: e.HoTen,
cccd: maskCCCD_(e.CCCD),
status: status,
consent: r ? String(r.Consent || '') : '',
updatedAt: r ? formatDate_(r.UpdatedAt || r.Timestamp) : ''
};
}
return json_({
ok: true,
summary: summary,
rows: list,
deadline: deadlineStr
});
}
// LƯU CẤU HÌNH THỜI HẠN MỚI TỪ GIAO DIỆN ADMIN
function adminSetDeadline_(b) {
const session = requireAdminSession_(b.token);
if (!session) return json_({ ok: false, error: 'UNAUTHORIZED', message: 'Hết phiên làm việc.' });
const newDeadline = String(b.deadline || '').trim(); // YYYY-MM-DDTHH:mm
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(newDeadline)) {
return json_({ ok: false, error: 'INVALID_FORMAT', message: 'Định dạng thời gian hạn chót không hợp lệ.' });
}
const deadlineDate = new Date(newDeadline);
if (isNaN(deadlineDate.getTime())) {
return json_({ ok: false, error: 'INVALID_FORMAT', message: 'Thời gian hạn chót không hợp lệ.' });
}
PropertiesService.getScriptProperties().setProperty(CONFIG.DEADLINE_PROPERTY, newDeadline);
return json_({ ok: true, message: 'Cập nhật thời hạn đóng liên kết thành công!' });
}
// HÀM XUẤT FILE MỚI: Đọc mảng trực tiếp từ Sheet Responses chuyển sang chuỗi văn bản dữ liệu an toàn để tránh lỗi UrlFetch
function adminDownloadExcel_(b) {
  const session = requireAdminSession_(b.token);
  if (!session) {
    return json_({
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'Phiên quản trị viên đã hết hạn.'
    });
  }

  try {
    const sheet = getSheet_(CONFIG.RESPONSE_SHEET);
    const data = sheet.getDataRange().getDisplayValues();

    if (!data.length) {
      throw new Error('Không có dữ liệu trong sheet Responses.');
    }

    // Tạo file XLSX thật, thay vì ghi TSV nhưng đặt đuôi .xls.
    // Cách này loại bỏ cảnh báo "file format and extension don't match" của Excel.
    const xlsxBlob = buildXlsxBlob_(data, 'Responses');
    const fileName = 'Responses_Export_' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') +
      '.xlsx';

    return json_({
      ok: true,
      fileName: fileName,
      fileData: Utilities.base64Encode(xlsxBlob.getBytes()),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  } catch (err) {
    console.error(err);
    return json_({
      ok: false,
      error: 'EXPORT_FAILED',
      message: 'Lỗi tạo file Excel: ' + safeMessage_(err)
    });
  }
}

/**
 * Tạo một workbook XLSX tối giản nhưng hợp lệ bằng Utilities.zip().
 * Dữ liệu được ghi dưới dạng inline string để không cần sharedStrings.xml.
 */
function buildXlsxBlob_(rows, sheetName) {
  const safeSheetName = cleanXmlText_(sheetName || 'Responses').slice(0, 31) || 'Responses';
  const sheetRows = [];
  const maxCols = rows.reduce(function(max, row) {
    return Math.max(max, row.length);
  }, 0);

  for (let r = 0; r < rows.length; r++) {
    const cells = [];
    const row = rows[r] || [];

    for (let c = 0; c < maxCols; c++) {
      const value = row[c] == null ? '' : String(row[c]);
      if (!value) continue;

      const ref = columnName_(c + 1) + (r + 1);
      cells.push(
        '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
        escapeXml_(value) +
        '</t></is></c>'
      );
    }

    sheetRows.push('<row r="' + (r + 1) + '">' + cells.join('') + '</row>');
  }

  const dimension = 'A1:' + columnName_(Math.max(maxCols, 1)) + Math.max(rows.length, 1);

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';

  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="' + escapeXml_(safeSheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
    '</workbook>';

  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';

  const worksheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="' + dimension + '"/>' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetData>' + sheetRows.join('') + '</sheetData>' +
    '<autoFilter ref="' + dimension + '"/>' +
    '</worksheet>';

  const now = new Date().toISOString();
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:creator>Google Apps Script</dc:creator>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
    '</cp:coreProperties>';

  const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>Google Apps Script</Application>' +
    '<DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>' +
    '</Properties>';

  const files = [
    Utilities.newBlob(contentTypes, 'application/xml', '[Content_Types].xml'),
    Utilities.newBlob(rootRels, 'application/xml', '_rels/.rels'),
    Utilities.newBlob(workbook, 'application/xml', 'xl/workbook.xml'),
    Utilities.newBlob(workbookRels, 'application/xml', 'xl/_rels/workbook.xml.rels'),
    Utilities.newBlob(worksheet, 'application/xml', 'xl/worksheets/sheet1.xml'),
    Utilities.newBlob(core, 'application/xml', 'docProps/core.xml'),
    Utilities.newBlob(app, 'application/xml', 'docProps/app.xml')
  ];

  return Utilities.zip(files, 'Responses.xlsx');
}

function columnName_(number) {
  let n = Number(number);
  let name = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name || 'A';
}

function cleanXmlText_(value) {
  return String(value == null ? '' : value).replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/g, '');
}

function escapeXml_(value) {
  return cleanXmlText_(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function adminChangePassword_(b) {
const session = requireAdminSession_(b.token);
if (!session) return json_({ ok: false, error: 'UNAUTHORIZED' });
const oldPassword = String(b.oldPassword || '');
const newPassword = String(b.newPassword || '');
const confirm = String(b.confirmPassword || '');
if (newPassword.length < 10) return json_({ ok: false, error: 'WEAK_PASSWORD', message: 'Mat khau moi phai co it nhat 10 ky tu.' });
if (newPassword !== confirm) return json_({ ok: false, error: 'PASSWORD_MISMATCH', message: 'Xac nhan mat khau khong khop.' });
if (oldPassword === newPassword) return json_({ ok: false, error: 'SAME_PASSWORD', message: 'Mat khau moi phai khac mat khau hien tai.' });
const admin = findAdmin_(session.username);
if (!admin || !secureEqual_(hashPassword_(oldPassword, admin.salt), admin.hash)) {
return json_({ ok: false, error: 'INVALID_PASSWORD', message: 'Mat khau hien tai khong dung.' });
}
const newSalt = randomHex_(32);
const newHash = hashPassword_(newPassword, newSalt);
const sh = getSheet_(CONFIG.ADMIN_SHEET);
sh.getRange(admin.row, 2, 1, 2).setValues([[newHash, newSalt]]);
sh.getRange(admin.row, 6).setValue(new Date());
return json_({ ok: true, message: 'Da doi mat khau admin.' });
}
function adminLogout_(b) {
destroySession_(b.token);
return json_({ ok: true });
}
/* ========================= SHEET DATA CORE ========================= */
function findEmployeeByCCCD_(cccd) {
const employees = getEmployeeObjects_();
for (let i = 0; i < employees.length; i++) {
const e = employees[i];
if (normalizeCCCD_(e.CCCD) === cccd) {
return { row: e._row, maNV: e.MaNV, hoTen: e.HoTen, cccd: cccd };
}
}
return null;
}
function findAdmin_(username) {
const sh = getSheet_(CONFIG.ADMIN_SHEET);
const lastRow = sh.getLastRow();
if (lastRow < 2) return null;
const rows = sh.getRange(2, 1, lastRow - 1, 6).getValues();
for (let i = 0; i < rows.length; i++) {
const r = rows[i];
if (String(r[0] || '').trim() === username) {
return { row: i + 2, username: username, hash: String(r[1] || ''), salt: String(r[2] || ''), active: r[3], createdAt: r[4], updatedAt: r[5] };
}
}
return null;
}
function getEmployeeObjects_(ss) {
const cache = CacheService.getScriptCache();
const cached = cache.get('employees:v2');
if (cached) {
try { return JSON.parse(cached); } catch (err) { }
}
const sheet = ss ? ss.getSheetByName(CONFIG.EMPLOYEE_SHEET) : getSheet_(CONFIG.EMPLOYEE_SHEET);
if (!sheet) throw new Error('Khong tim thay sheet ' + CONFIG.EMPLOYEE_SHEET);
const rows = sheet.getDataRange().getDisplayValues();
if (rows.length < 2) return [];
const h = employeeHeaderMap_(rows[0]);
const list = [];
for (let i = 1; i < rows.length; i++) {
const r = rows[i];
const maNV = String(r[h.MaNV] || '').trim();
const hoTen = String(r[h.HoTen] || '').trim();
const cccd = normalizeCCCD_(r[h.CCCD]);
if (maNV || hoTen || cccd) {
list.push({ _row: i + 1, MaNV: maNV, HoTen: hoTen, CCCD: cccd });
}
}
cachePutJson_('employees:v2', list, CONFIG.EMPLOYEE_CACHE_SECONDS);
return list;
}
function getResponseObjects_(ss) {
const cache = CacheService.getScriptCache();
const cached = cache.get('responses:v3');
if (cached) {
try { return JSON.parse(cached); } catch (err) { }
}
const sheet = ss ? ss.getSheetByName(CONFIG.RESPONSE_SHEET) : getSheet_(CONFIG.RESPONSE_SHEET);
if (!sheet) throw new Error('Khong tim thay sheet ' + CONFIG.RESPONSE_SHEET);
const rows = sheet.getDataRange().getValues();
if (rows.length < 2) return [];
const headers = rows[0].map(function(v) { return String(v || '').trim(); });
const required = ['MaNV', 'HoTen', 'CCCD'];
for (let i = 0; i < required.length; i++) {
if (headers.indexOf(required[i]) < 0) throw new Error('Sheet Responses thieu cot ' + required[i]);
}
const list = [];
for (let i = 1; i < rows.length; i++) {
const row = rows[i];
const o = { _row: i + 1 };
for (let j = 0; j < headers.length; j++) {
if (headers[j]) o[headers[j]] = row[j];
}
list.push(o);
}
const filtered = list.filter(function(o) { return String(o.MaNV || '').trim() !== ''; });
cachePutJson_('responses:v3', filtered, CONFIG.RESPONSE_CACHE_SECONDS);
return filtered;
}
function findLatestResponseByMaNV_(maNV) {
const target = String(maNV || '').trim();
const responses = getResponseObjects_();
let latest = null;
let latestTime = -1;
for (let i = 0; i < responses.length; i++) {
const r = responses[i];
if (String(r.MaNV || '').trim() !== target) continue;
const t = dateMs_(r.UpdatedAt || r.Timestamp);
if (t >= latestTime) {
latest = r;
latestTime = t;
}
}
return latest;
}
function upsertResponse_(session, patch, existing) {
const lock = LockService.getScriptLock();
lock.waitLock(15000);
try {
const sh = getSheet_(CONFIG.RESPONSE_SHEET);
const lastCol = sh.getLastColumn();
if (lastCol < 1) throw new Error('Sheet Responses chua co cot.');
const headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
const base = Object.create(null);
for (let i = 0; i < headers.length; i++) { base[headers[i]] = ''; }
// SỬA ĐỊNH DẠNG: Ép ghi hẳn chuỗi text ngày tháng tường minh dd/MM/yyyy HH:mm:ss vào cả 2 cột thời gian
base.Timestamp = existing && existing.Timestamp ? formatDate_(existing.Timestamp) : formatDate_(new Date());
base.SubmissionId = existing && existing.SubmissionId ? existing.SubmissionId : Utilities.getUuid();
base.MaNV = session.maNV;
base.HoTen = session.hoTen;
base.CCCD = session.cccd;
const patchKeys = Object.keys(patch);
for (let i = 0; i < patchKeys.length; i++) {
const k = patchKeys[i];
if (patch[k] instanceof Date) {
base[k] = formatDate_(patch[k]);
} else {
base[k] = patch[k];
}
}
const row = headers.map(function(h) { return base[h] === undefined ? '' : base[h]; });
if (existing && existing._row) {
sh.getRange(existing._row, 1, 1, headers.length).setValues([row]);
} else {
sh.getRange(sh.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
}
clearDataCaches();
} finally {
lock.releaseLock();
}
}
/* ========================= SESSION ========================= */
function createSession_(type, payload) {
const token = Utilities.getUuid() + '-' + Utilities.getUuid();
const obj = { type: type, payload: payload, expiresAt: Date.now() + CONFIG.SESSION_SECONDS * 1000 };
CacheService.getScriptCache().put('sess:' + token, JSON.stringify(obj), CONFIG.SESSION_SECONDS);
return token;
}
function getSession_(token) {
const t = String(token || '').trim();
if (!t) return null;
const raw = CacheService.getScriptCache().get('sess:' + t);
if (!raw) return null;
try {
const s = JSON.parse(raw);
if (!s.expiresAt || s.expiresAt < Date.now()) {
destroySession_(t);
return null;
}
return s;
} catch (err) {
destroySession_(t);
return null;
}
}
function requireEmployeeSession_(token) {
const s = getSession_(token);
return s && s.type === 'employee' ? s.payload : null;
}
function requireAdminSession_(token) {
const s = getSession_(token);
return s && s.type === 'admin' ? s.payload : null;
}
function destroySession_(token) {
const t = String(token || '').trim();
if (t) CacheService.getScriptCache().remove('sess:' + t);
}
/* ========================= SECURITY ========================= */
function hashPassword_(password, salt) {
const pepper = PropertiesService.getScriptProperties().getProperty(CONFIG.PEPPER_PROPERTY) || '';
return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password) + ':' + String(salt) + ':' + pepper, Utilities.Charset.UTF_8));
}
function secureEqual_(a, b) {
a = String(a); b = String(b);
if (a.length !== b.length) return false;
let x = 0;
for (let i = 0; i < a.length; i++) { x |= a.charCodeAt(i) ^ b.charCodeAt(i); }
return x === 0;
}
function randomHex_(n) {
const raw = Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Date.now() + ':' + Math.random();
return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8)).slice(0, n);
}
function isActive_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes'; }
/* ========================= HELPERS ========================= */
function getSS_() {
const id = PropertiesService.getScriptProperties().getProperty(CONFIG.SPREADSHEET_PROPERTY);
if (!id) throw new Error('Chua cau hinh SPREADSHEET_ID trong Script Properties.');
return SpreadsheetApp.openById(id);
}
function getSheet_(name) {
const sh = getSS_().getSheetByName(name);
if (!sh) throw new Error('Khong tim thay sheet: ' + name);
return sh;
}
function ensureSheet_(ss, name, headers) {
let sh = ss.getSheetByName(name);
if (!sh) sh = ss.insertSheet(name);
if (sh.getLastRow() === 0) {
sh.getRange(1, 1, 1, headers.length).setValues([headers]);
sh.setFrozenRows(1);
}
}
function employeeHeaderMap_(headers) {
const h = {};
for (let i = 0; i < headers.length; i++) { h[String(headers[i]).trim()] = i; }
if (h['Mã NV'] !== undefined && h.MaNV === undefined) h.MaNV = h['Mã NV'];
if (h['Họ tên'] !== undefined && h.HoTen === undefined) h.HoTen = h['Họ tên'];
if (h['Họ và tên'] !== undefined && h.HoTen === undefined) h.HoTen = h['Họ và tên'];
if (h['Số CCCD'] !== undefined && h.CCCD === undefined) h.CCCD = h['Số CCCD'];
if (h['CCCD'] !== undefined && h.CCCD === undefined) h.CCCD = h['CCCD'];
['MaNV', 'HoTen', 'CCCD'].forEach(function(k) {
if (h[k] === undefined) throw new Error('Sheet DSCNV thieu cot bat buoc: ' + k);
});
return h;
}
function normalizeCCCD_(v) { return String(v == null ? '' : v).trim().replace(/[^\d]/g, '').slice(0, CONFIG.MAX_CCCD_LENGTH); }
function maskCCCD_(v) { const s = normalizeCCCD_(v); if (!s) return ''; if (s.length <= 4) return '*'.repeat(s.length); return '*'.repeat(s.length - 4) + s.slice(-4); }
function clean_(v, maxLen) { const n = maxLen || CONFIG.MAX_TEXT; return String(v == null ? '' : v).trim().slice(0, n); }
function sanitizeResponse_(r) {
if (!r) return null;
return {
MaNV: String(r.MaNV || ''), HoTen: String(r.HoTen || ''), Consent: String(r.Consent || ''),
NgaySinh: String(r.NgaySinh || ''), GioiTinh: String(r.GioiTinh || ''), DanToc: String(r.DanToc || ''),
TonGiao: String(r.TonGiao || ''), DiaChiThuongTru: String(r.DiaChiThuongTru || ''), DiaChiTamTru: String(r.DiaChiTamTru || ''),
TrinhDoHocVan: String(r.TrinhDoHocVan || ''), TrinhDoChuyenMon: String(r.TrinhDoChuyenMon || ''),
MienGiam: String(r.MienGiam || ''), Status: String(r.Status || ''), UpdatedAt: formatDate_(r.UpdatedAt || r.Timestamp)
};
}
function formatDate_(v) {
if (!v) return '';
const d = v instanceof Date ? v : new Date(v);
if (isNaN(d.getTime())) return String(v);
return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
}
function dateMs_(v) {
if (!v) return 0;
const d = v instanceof Date ? v : new Date(v);
const t = d.getTime();
return isNaN(t) ? 0 : t;
}
function bytesToHex_(bytes) {
const hex = [];
for (let i = 0; i < bytes.length; i++) {
const b = bytes[i];
hex.push(('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2));
}
return hex.join('');
}
function safeMessage_(e) { return String(e && e.message ? e.message : e).slice(0, 500); }
function cachePutJson_(key, value, seconds) { try { CacheService.getScriptCache().put(key, JSON.stringify(value), seconds); } catch (err) { } }
function clearDataCaches_() { const cache = CacheService.getScriptCache(); cache.remove('employees:v2'); cache.remove('responses:v3'); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

