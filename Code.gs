/**
 * Google Apps Script backend
 * Web thu thập dữ liệu lý lịch tư pháp / làm sạch dữ liệu
 *
 * Sheets:
 * 1) DSCNV: MaNV | HoTen | CCCD
 * 2) Responses: Timestamp | SubmissionId | MaNV | HoTen | CCCD | Consent | NgaySinh |
 *    GioiTinh | DanToc | TonGiao | DiaChiThuongTru | TrinhDoChuyenMon | MienGiam |
 *    Status | UpdatedAt
 * 3) AdminUsers: Username | PasswordHash | PasswordSalt | Active | CreatedAt | UpdatedAt
 *
 * Deploy as Web app:
 * Execute as: Me
 * Who has access: Anyone
 */

const CONFIG = {
  EMPLOYEE_SHEET: 'DSCNV',
  RESPONSE_SHEET: 'Responses',
  ADMIN_SHEET: 'AdminUsers',
  SESSION_SECONDS: 8 * 60 * 60,
  MAX_SESSION_SECONDS: 8 * 60 * 60,
  PEPPER_PROPERTY: 'PASSWORD_PEPPER',
  SPREADSHEET_PROPERTY: 'SPREADSHEET_ID'
};

function setup() {
  const ss = getSS_();
  ensureSheet_(ss, CONFIG.EMPLOYEE_SHEET, ['MaNV','HoTen','CCCD']);
  ensureSheet_(ss, CONFIG.RESPONSE_SHEET, [
    'Timestamp','SubmissionId','MaNV','HoTen','CCCD','Consent',
    'NgaySinh','GioiTinh','DanToc','TonGiao','DiaChiThuongTru',
    'TrinhDoChuyenMon','MienGiam','Status','UpdatedAt'
  ]);
  ensureSheet_(ss, CONFIG.ADMIN_SHEET, [
    'Username','PasswordHash','PasswordSalt','Active','CreatedAt','UpdatedAt'
  ]);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(CONFIG.PEPPER_PROPERTY)) {
    props.setProperty(CONFIG.PEPPER_PROPERTY, randomHex_(32));
  }

  const admin = getSheet_(CONFIG.ADMIN_SHEET);
  const rows = admin.getDataRange().getValues();
  if (rows.length <= 1) {
    const salt = randomHex_(16);
    const hash = hashPassword_('ChangeMe@123', salt);
    admin.appendRow(['admin', hash, salt, true, new Date(), new Date()]);
    Logger.log('Created admin user "admin" with temporary password: ChangeMe@123');
  }
  return 'Setup completed. Change the temporary admin password immediately.';
}

function doGet(e) {
  return json_({ ok: true, service: 'ly-lich-tu-phap-api', version: '1.0' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '');

    switch (action) {
      case 'employeeLogin': return employeeLogin_(body);
      case 'saveConsent': return saveConsent_(body);
      case 'submitForm': return submitForm_(body);
      case 'getMySubmission': return getMySubmission_(body);
      case 'adminLogin': return adminLogin_(body);
      case 'adminDashboard': return adminDashboard_(body);
      case 'adminChangePassword': return adminChangePassword_(body);
      case 'adminLogout': return adminLogout_(body);
      default: return json_({ ok:false, error:'INVALID_ACTION' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok:false, error:'SERVER_ERROR', message: safeMessage_(err) });
  }
}

/* ========================= EMPLOYEE ========================= */

function employeeLogin_(b) {
  const cccd = normalizeCCCD_(b.cccd);
  if (!/^\d{9,12}$/.test(cccd)) {
    return json_({ok:false, error:'INVALID_CCCD', message:'Số CCCD không hợp lệ.'});
  }

  const emp = findEmployeeByCCCD_(cccd);
  if (!emp) {
    return json_({ok:false, error:'NOT_FOUND', message:'Không tìm thấy thông tin CCCD trong danh sách nhân viên.'});
  }

  const token = createSession_('employee', {
    maNV: emp.maNV,
    hoTen: emp.hoTen,
    cccd: cccd
  });

  const previous = findLatestResponseByMaNV_(emp.maNV);
  return json_({
    ok:true,
    token:token,
    employee:{maNV:emp.maNV, hoTen:emp.hoTen, cccd:cccd},
    previous: previous ? sanitizeResponse_(previous) : null
  });
}

function saveConsent_(b) {
  const s = requireEmployeeSession_(b.token);
  if (!s) return json_({ok:false,error:'UNAUTHORIZED'});

  const consent = b.consent === true;
  const existing = findLatestResponseByMaNV_(s.maNV);

  if (!consent) {
    upsertResponse_(s, {
      Consent:'Không đồng ý',
      Status:'Từ chối',
      UpdatedAt:new Date()
    }, existing);
    return json_({ok:true, next:'end', message:'Đã ghi nhận lựa chọn của Anh/Chị.'});
  }

  upsertResponse_(s, {
    Consent:'Đồng ý',
    Status:'Đang kê khai',
    UpdatedAt:new Date()
  }, existing);

  return json_({ok:true,next:'form'});
}

function submitForm_(b) {
  const s = requireEmployeeSession_(b.token);
  if (!s) return json_({ok:false,error:'UNAUTHORIZED'});

  if (b.consent !== true) {
    return json_({ok:false,error:'CONSENT_REQUIRED',message:'Vui lòng xác nhận đồng ý trước khi kê khai.'});
  }

  const required = ['ngaySinh','tonGiao','diaChiThuongTru'];
  for (const k of required) {
    if (!String(b[k] || '').trim()) {
      return json_({ok:false,error:'MISSING_REQUIRED',field:k,message:'Vui lòng điền đầy đủ thông tin bắt buộc.'});
    }
  }

  const existing = findLatestResponseByMaNV_(s.maNV);
  upsertResponse_(s, {
    Consent:'Đồng ý',
    NgaySinh:clean_(b.ngaySinh),
    GioiTinh:clean_(b.gioiTinh),
    DanToc:clean_(b.danToc),
    TonGiao:clean_(b.tonGiao),
    DiaChiThuongTru:clean_(b.diaChiThuongTru),
    TrinhDoChuyenMon:clean_(b.trinhDoChuyenMon),
    MienGiam:clean_(b.mienGiam),
    Status:'Đã hoàn tất',
    UpdatedAt:new Date()
  }, existing);

  return json_({ok:true,message:'Đã lưu thông tin thành công.'});
}

function getMySubmission_(b) {
  const s = requireEmployeeSession_(b.token);
  if (!s) return json_({ok:false,error:'UNAUTHORIZED'});
  const r = findLatestResponseByMaNV_(s.maNV);
  return json_({ok:true,submission:r ? sanitizeResponse_(r) : null});
}

/* ========================= ADMIN ========================= */

function adminLogin_(b) {
  const username = clean_(b.username);
  const password = String(b.password || '');
  if (!username || !password) return json_({ok:false,error:'INVALID_LOGIN'});

  const admin = findAdmin_(username);
  if (!admin || String(admin.active).toLowerCase() === 'false') {
    return json_({ok:false,error:'INVALID_LOGIN',message:'Tài khoản hoặc mật khẩu không đúng.'});
  }

  const hash = hashPassword_(password, admin.salt);
  if (!secureEqual_(hash, admin.hash)) {
    return json_({ok:false,error:'INVALID_LOGIN',message:'Tài khoản hoặc mật khẩu không đúng.'});
  }

  const token = createSession_('admin', {username});
  return json_({ok:true,token});
}

function adminDashboard_(b) {
  const s = requireAdminSession_(b.token);
  if (!s) return json_({ok:false,error:'UNAUTHORIZED'});

  const data = getResponseObjects_();
  const employees = getEmployeeObjects_();

  const byStatus = { 'Chưa điền':0, 'Đang kê khai':0, 'Đã hoàn tất':0, 'Từ chối':0 };
  const latest = {};

  data.forEach(r => {
    if (!r.MaNV) return;
    if (!latest[r.MaNV] || new Date(r.UpdatedAt || r.Timestamp) > new Date(latest[r.MaNV].UpdatedAt || latest[r.MaNV].Timestamp)) {
      latest[r.MaNV] = r;
    }
  });

  employees.forEach(e => {
    if (!latest[e.MaNV]) {
      byStatus['Chưa điền']++;
    } else {
      const st = latest[e.MaNV].Status || 'Đang kê khai';
      if (byStatus[st] === undefined) byStatus[st] = 0;
      byStatus[st]++;
    }
  });

  const list = employees.map(e => {
    const r = latest[e.MaNV];
    return {
      maNV:e.MaNV,
      hoTen:e.HoTen,
      cccd:maskCCCD_(e.CCCD),
      status:r ? (r.Status || 'Đang kê khai') : 'Chưa điền',
      consent:r ? r.Consent : '',
      updatedAt:r ? formatDate_(r.UpdatedAt || r.Timestamp) : ''
    };
  });

  return json_({
    ok:true,
    summary:{
      totalEmployees:employees.length,
      completed:byStatus['Đã hoàn tất'] || 0,
      inProgress:byStatus['Đang kê khai'] || 0,
      refused:byStatus['Từ chối'] || 0,
      notStarted:byStatus['Chưa điền'] || 0
    },
    rows:list
  });
}

function adminChangePassword_(b) {
  const s = requireAdminSession_(b.token);
  if (!s) return json_({ok:false,error:'UNAUTHORIZED'});

  const oldPassword = String(b.oldPassword || '');
  const newPassword = String(b.newPassword || '');
  const confirm = String(b.confirmPassword || '');

  if (newPassword.length < 10) {
    return json_({ok:false,error:'WEAK_PASSWORD',message:'Mật khẩu mới phải có ít nhất 10 ký tự.'});
  }
  if (newPassword !== confirm) {
    return json_({ok:false,error:'PASSWORD_MISMATCH',message:'Xác nhận mật khẩu không khớp.'});
  }

  const admin = findAdmin_(s.username);
  if (!admin || !secureEqual_(hashPassword_(oldPassword, admin.salt), admin.hash)) {
    return json_({ok:false,error:'INVALID_PASSWORD',message:'Mật khẩu hiện tại không đúng.'});
  }

  const newSalt = randomHex_(16);
  const newHash = hashPassword_(newPassword, newSalt);
  const sh = getSheet_(CONFIG.ADMIN_SHEET);
  
  // FIX: Định vị chính xác dòng ô cụ thể để ghi đè, tránh lỗi Range kích thước
  sh.getRange(admin.row, 2).setValue(newHash);
  sh.getRange(admin.row, 3).setValue(newSalt);
  sh.getRange(admin.row, 6).setValue(new Date());
  
  return json_({ok:true,message:'Đã đổi mật khẩu admin.'});
}

function adminLogout_(b) {
  if (b.token) CacheService.getScriptCache().remove('sess:' + b.token);
  return json_({ok:true});
}

/* ========================= DATA ========================= */

function findEmployeeByCCCD_(cccd) {
  const rows = getSheet_(CONFIG.EMPLOYEE_SHEET).getDataRange().getDisplayValues();
  if (rows.length < 2) return null;
  const h = headerMap_(rows[0]);
  for (let i=1;i<rows.length;i++) {
    const c = normalizeCCCD_(rows[i][h.CCCD]);
    if (c === cccd) {
      return {
        row:i+1,
        maNV:String(rows[i][h.MaNV] || '').trim(),
        hoTen:String(rows[i][h.HoTen] || '').trim(),
        cccd:c
      };
    }
  }
  return null;
}

function findAdmin_(username) {
  const rows = getSheet_(CONFIG.ADMIN_SHEET).getDataRange().getValues();
  if (rows.length < 2) return null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === username) {
      return {
        row: i + 1, 
        username: username, 
        hash: String(rows[i][1]), 
        salt: String(rows[i][2]), 
        active: rows[i][3], 
        createdAt: rows[i][4]
      };
    }
  }
  return null;
}

function getEmployeeObjects_() {
  const rows = getSheet_(CONFIG.EMPLOYEE_SHEET).getDataRange().getDisplayValues();
  if (rows.length < 2) return [];
  const h = headerMap_(rows[0]);
  return rows.slice(1).map(r => ({
    MaNV:String(r[h.MaNV] || '').trim(),
    HoTen:String(r[h.HoTen] || '').trim(),
    CCCD:normalizeCCCD_(r[h.CCCD])
  })).filter(x => x.MaNV || x.HoTen || x.CCCD);
}

function getResponseObjects_() {
  const rows = getSheet_(CONFIG.RESPONSE_SHEET).getDataRange().getValues();
  if (rows.length < 2) return [];
  const h = headerMap_(rows[0]);
  return rows.slice(1).map((r, idx) => {
    const o={};
    o._row = idx + 2; // Gán thuộc tính vị trí dòng thực tế
    Object.keys(h).forEach(k => o[k]=r[h[k]]);
    return o;
  }).filter(r => r.MaNV);
}

function findLatestResponseByMaNV_(maNV) {
  const rows = getResponseObjects_().filter(r => String(r.MaNV).trim() === String(maNV).trim());
  if (!rows.length) return null;
  rows.sort((a,b) => new Date(b.UpdatedAt || b.Timestamp) - new Date(a.UpdatedAt || a.Timestamp));
  return rows[0];
}

function upsertResponse_(session, patch, existing) {
  const sh = getSheet_(CONFIG.RESPONSE_SHEET);
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  const base = {};
  headers.forEach(h => base[h]='');

  base.Timestamp = existing && existing.Timestamp ? existing.Timestamp : new Date();
  base.SubmissionId = existing && existing.SubmissionId ? existing.SubmissionId : Utilities.getUuid();
  base.MaNV = session.maNV;
  base.HoTen = session.hoTen;
  base.CCCD = session.cccd;
  Object.keys(patch).forEach(k => base[k]=patch[k]);

  const row = headers.map(h => base[h] === undefined ? '' : base[h]);

  if (existing && existing._row) {
    // FIX SỬA LỖI: Gọi chuẩn xác thuộc tính existing._row đã được định nghĩa ở trên
    sh.getRange(existing._row, 1, 1, headers.length).setValues([row]);
  } else if (existing) {
    const all = sh.getDataRange().getValues();
    // FIX SỬA LỖI: Gọi đúng tên hàm bổ trợ có dấu gạch dưới headerMap_
    const h = headerMap_(all[0]);
    let target = -1;
    for (let i=1;i<all.length;i++) {
      if (String(all[i][h.MaNV]).trim() === String(session.maNV).trim()) {
        if (target < 0 || new Date(all[i][h.UpdatedAt] || all[i][h.Timestamp]) < new Date(all[target][h.UpdatedAt] || all[target][h.Timestamp])) {
          target=i;
        }
      }
    }
    if (target >= 1) sh.getRange(target+1, 1, 1, headers.length).setValues([row]);
    else sh.appendRow(row);
  } else {
    sh.appendRow(row);
  }
}

/* ========================= SESSION / SECURITY ========================= */
function createSession_(type, payload) {
const token = Utilities.getUuid() + '-' + Utilities.getUuid();
const obj = {type, payload, expiresAt:Date.now() + CONFIG.SESSION_SECONDS*1000};
CacheService.getScriptCache().put('sess:' + token, JSON.stringify(obj), CONFIG.SESSION_SECONDS);
return token;
}
function getSession_(token) {
if (!token) return null;
const raw = CacheService.getScriptCache().get('sess:' + token);
if (!raw) return null;
const s = JSON.parse(raw);
if (s.expiresAt < Date.now()) {
CacheService.getScriptCache().remove('sess:' + token);
return null;
}
return s;
}
function requireEmployeeSession_(token) {
const s=getSession_(token);
return s && s.type==='employee' ? s.payload : null;
}
function requireAdminSession_(token) {
const s=getSession_(token);
return s && s.type==='admin' ? s.payload : null;
}
function hashPassword_(password, salt) {
const pepper = PropertiesService.getScriptProperties().getProperty(CONFIG.PEPPER_PROPERTY) || '';
return bytesToHex_(Utilities.computeDigest(
Utilities.DigestAlgorithm.SHA_256,
String(password) + ':' + String(salt) + ':' + pepper,
Utilities.Charset.UTF_8
));
}
function secureEqual_(a,b) {
a=String(a); b=String(b);
if (a.length !== b.length) return false;
let x=0;
for (let i=0;i<a.length;i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
return x===0;
}
function randomHex_(n) {
  // Sử dụng mã UUID sẵn có của Google kết hợp thuật toán băm SHA-256 để tạo chuỗi Hex ngẫu nhiên bảo mật cao
  const rawString = Utilities.getUuid() + '-' + Math.random() + '-' + Date.now();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawString, Utilities.Charset.UTF_8);
  const fullHex = bytesToHex_(digest);
  return fullHex.slice(0, n);
}

/* ========================= HELPERS ========================= */
function getSS_() {
const id = PropertiesService.getScriptProperties().getProperty(CONFIG.SPREADSHEET_PROPERTY);
if (!id) throw new Error('Chưa cấu hình SPREADSHEET_ID trong Script Properties.');
return SpreadsheetApp.openById(id);
}
function getSheet_(name) {
const sh=getSS_().getSheetByName(name);
if (!sh) throw new Error('Không tìm thấy sheet: '+name);
return sh;
}
function ensureSheet_(ss,name,headers) {
let sh=ss.getSheetByName(name);
if (!sh) sh=ss.insertSheet(name);
if (sh.getLastRow()===0) sh.appendRow(headers);
}
function headerMap_(headers) {
const h={};
headers.forEach((v,i)=>h[String(v).trim()]=i);
if (h['Mã NV'] !== undefined && h.MaNV === undefined) h.MaNV=h['Mã NV'];
if (h['Họ tên'] !== undefined && h.HoTen === undefined) h.HoTen=h['Họ tên'];
if (h['Họ và tên'] !== undefined && h.HoTen === undefined) h.HoTen=h['Họ và tên'];
if (h['Số CCCD'] !== undefined && h.CCCD === undefined) h.CCCD=h['Số CCCD'];
if (h['CCCD'] !== undefined && h.CCCD === undefined) h.CCCD=h['CCCD'];
['MaNV','HoTen','CCCD'].forEach(k=>{
if (h[k]===undefined) throw new Error('Thiếu cột bắt buộc trong sheet: '+k);
});
return h;
}
function normalizeCCCD_(v) {
let s=String(v==null?'':v).trim().replace(/[^\d]/g,'');
return s;
}
function maskCCCD_(v) {
const s=normalizeCCCD_(v);
if (s.length<=4) return '***';
return ''.repeat(Math.max(0,s.length-4))+s.slice(-4);
}
function clean_(v) {
return String(v==null?'':v).trim().slice(0,2000);
}
function sanitizeResponse_(r) {
if (!r) return null;
return {
MaNV:r.MaNV, HoTen:r.HoTen, Consent:r.Consent, NgaySinh:r.NgaySinh,
GioiTinh:r.GioiTinh, DanToc:r.DanToc, TonGiao:r.TonGiao,
DiaChiThuongTru:r.DiaChiThuongTru, TrinhDoChuyenMon:r.TrinhDoChuyenMon,
MienGiam:r.MienGiam, Status:r.Status, UpdatedAt:formatDate_(r.UpdatedAt || r.Timestamp)
};
}
function formatDate_(v) {
if (!v) return '';
const d = v instanceof Date ? v : new Date(v);
return isNaN(d) ? String(v) : Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
}
function bytesToHex_(bytes) {
return bytes.map(b => ('0'+((b<0?b+256:b).toString(16))).slice(-2)).join('');
}
function safeMessage_(e) {
return String(e && e.message ? e.message : e).slice(0,500);
}
function json_(obj) {
return ContentService.createTextOutput(JSON.stringify(obj))
.setMimeType(ContentService.MimeType.JSON);
}
