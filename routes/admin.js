const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { requireAuth } = require('../helpers/auth');
const { sendMessage, getAttachmentType } = require('../helpers/facebook');
const { avatarHtml, attachmentHtml, messengerLinkHtml, navHtml, commonCss, pwaHtml } = require('../helpers/html');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const sharp = require('sharp');
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_SIZE = 50;

// Cloudinary設定（Railway環境変数から取得）
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// スマホ由来の非標準な画像ファイル（壊れたPNG等）をCloudinaryが拒否することがあるため、
// 画像の場合は一度sharpで標準的な形式に再エンコードしてからアップロードする
async function normalizeImageBuffer(buffer, mimetype) {
  if (!mimetype || !mimetype.startsWith('image/')) return buffer; // 画像以外はそのまま
  try {
    if (mimetype === 'image/png') {
      return await sharp(buffer, { failOn: 'none' }).png().toBuffer();
    }
    if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
      return await sharp(buffer, { failOn: 'none' }).jpeg().toBuffer();
    }
    return await sharp(buffer, { failOn: 'none' }).jpeg().toBuffer();
  } catch (e) {
    console.error('画像の再エンコードに失敗、元のバッファのまま続行:', e.message);
    return buffer;
  }
}

// バッファをCloudinaryにアップロードし、公開URLを返すヘルパー
async function uploadToCloudinary(buffer, originalname, mimetype) {
  const normalizedBuffer = await normalizeImageBuffer(buffer, mimetype);
  console.log('uploadToCloudinary詳細: size=' + normalizedBuffer.length + ' bytes (元: ' + buffer.length + ' bytes), mimetype=' + mimetype + ', name=' + originalname);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'auto' },
      (error, result) => {
        if (error) {
          console.error('Cloudinaryエラー詳細:', JSON.stringify(error));
          return reject(error);
        }
        resolve(result.secure_url);
      }
    );
    stream.end(normalizedBuffer);
  });
}

// 新着メッセージAPI
router.get('/messages/new', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  try {
    const after = req.query.after;
    const snapshot = await db.collection('messages').orderBy('createdAt', 'desc').limit(20).get();
    const senderIds = [...new Set(snapshot.docs.map(d => d.data().senderId).filter(Boolean))];
    const profileMap = {};
    await Promise.all(senderIds.map(async sid => {
      const doc = await db.collection('contacts').doc(sid).get();
      if (doc.exists) profileMap[sid] = doc.data();
    }));
    const messages = [];
    for (const doc of snapshot.docs) {
      const d = doc.data();
      if (!d.createdAt) continue;
      const createdAtISO = d.createdAt.toDate().toISOString();
      if (after && createdAtISO <= after) continue;
      const profile = profileMap[d.senderId] || {};
      messages.push({
        docId: doc.id, senderId: d.senderId,
        senderName: profile.passportName || d.senderName || '不明',
        senderPicture: d.senderPicture || null,
        message: d.message || '', status: d.status || '未対応',
        workplace: profile.workplace || '', residenceStatus: profile.residenceStatus || '',
        date: d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        createdAtISO
      });
    }
    res.json({ messages });
  } catch (err) { res.json({ messages: [], error: err.message }); }
});

// 問い合わせ一覧（登録者ごとにスレッド化。最新メッセージがある登録者が上に来る）
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * PAGE_SIZE;

  // 全メッセージを新しい順で取得し、送信者ごとにグループ化する
  // Map を使うことで、送信者ID（数字の文字列）でも挿入順（＝時系列の新しい順）が保たれる
  const allSnapshot = await db.collection('messages').orderBy('createdAt', 'desc').get();
  const threadsMap = new Map();

  allSnapshot.docs.forEach(doc => {
    const d = doc.data();
    const sid = d.senderId;
    if (!sid) return;
    if (!threadsMap.has(sid)) {
      threadsMap.set(sid, {
        senderId: sid,
        latestDoc: doc,       // 新しい順で最初に出てくるので、その送信者の最新メッセージになる
        latestData: d,
        count: 0,
        unreadCount: 0,
        replyTargetDoc: null  // 未対応の中で一番新しいメッセージ（返信対象）
      });
    }
    const t = threadsMap.get(sid);
    t.count++;
    if (d.status === '未対応') {
      t.unreadCount++;
      if (!t.replyTargetDoc) t.replyTargetDoc = doc;
    }
  });

  const threads = Array.from(threadsMap.values()); // すでに最新順
  const totalCount = threads.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageThreads = threads.slice(offset, offset + PAGE_SIZE);

  const senderIds = pageThreads.map(t => t.senderId);
  const profileMap = {};
  await Promise.all(senderIds.map(async sid => {
    const doc = await db.collection('contacts').doc(sid).get();
    if (doc.exists) profileMap[sid] = doc.data();
  }));

  const latestISO = allSnapshot.size > 0 && allSnapshot.docs[0].data().createdAt
    ? allSnapshot.docs[0].data().createdAt.toDate().toISOString() : '';

  const rows = pageThreads.map(t => {
    const d = t.latestData;
    const sid = t.senderId;
    const profile = profileMap[sid] || {};
    const fbName = d.senderName || '不明';
    const registeredName = profile.passportName || '';
    const registeredNameLabel = registeredName
      ? '登録名：' + registeredName
      : (profile.nameCandidate ? '登録名：未登録（候補：' + profile.nameCandidate + '）' : '登録名：未登録');
    const displayName = registeredName || fbName; // 検索用・並び替え用に使う代表名
    const date = d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const statusColor = d.status === '未対応' ? '#e74c3c' : '#27ae60';
    const replyHtml = (d.replyMessage || d.attachmentName)
      ? (d.replyMessage || '') + (d.attachmentName ? '<br><small>📎 ' + d.attachmentName + '</small>' : '')
      : '—';

    const unreadBadge = t.unreadCount > 0
      ? '<span style="background:#e74c3c;color:white;border-radius:12px;padding:1px 7px;font-size:11px;margin-left:6px;">' + t.unreadCount + '</span>'
      : '';
    const countBadge = '<span style="color:#999;font-size:12px;margin-left:6px;">(' + t.count + '件)</span>';

    // 返信対象：未対応メッセージがあればそれを更新（mode=update）、無ければ新規メッセージとして送信（mode=new）
    const replyDocId = t.replyTargetDoc ? t.replyTargetDoc.id : null;
    const mode = replyDocId ? 'update' : 'new';
    const formId = replyDocId || ('new_' + sid); // フォーム要素のID生成に使う一意な値

    const replyBtn = '<button onclick="openReply(\'' + formId + '\')" style="background:#2980b9;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">返信</button>';

    const replyForm = '<tr id="reply-' + formId + '" style="display:none;background:#f0f7ff;">'
        + '<td colspan="9" style="padding:12px;">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">'
        + '<div>'
        + '<label style="font-size:12px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">📝 日本語（入力）</label>'
        + '<textarea id="text-' + formId + '" rows="3" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;" placeholder="' + (mode === 'update' ? '返信メッセージを入力（任意）...' : '送信するメッセージを入力...') + '"></textarea>'
        + '<br><button onclick="translateAdminReply(\'' + formId + '\')" style="margin-top:4px;font-size:12px;padding:4px 10px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;">🌐 英訳する</button>'
        + '</div>'
        + '<div>'
        + '<label style="font-size:12px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">🌐 英語訳（自動）</label>'
        + '<textarea id="translated-' + formId + '" rows="3" style="width:100%;padding:8px;border:1px solid #27ae60;border-radius:4px;font-size:14px;box-sizing:border-box;background:#f9fff9;" placeholder="英訳がここに表示されます..."></textarea>'
        + '<div style="margin-top:4px;font-size:11px;color:#888;">※ 編集して送信も可能です</div>'
        + '</div>'
        + '</div>'
        + '<div style="margin-bottom:8px;">'
        + '<label style="font-size:12px;color:#555;font-weight:bold;">送信言語：</label>'
        + '<label style="font-size:13px;margin-left:8px;cursor:pointer;"><input type="radio" name="lang-' + formId + '" value="ja" checked> 日本語</label>'
        + '<label style="font-size:13px;margin-left:12px;cursor:pointer;"><input type="radio" name="lang-' + formId + '" value="en"> 英語訳</label>'
        + '<label style="font-size:13px;margin-left:12px;cursor:pointer;"><input type="radio" name="lang-' + formId + '" value="both"> 両方送信</label>'
        + '</div>'
        + '<div style="margin-bottom:8px;">'
        + '<label style="font-size:13px;color:#555;font-weight:bold;">📎 添付ファイル：</label>'
        + '<input type="file" id="file-' + formId + '" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:13px;margin-left:8px;">'
        + '<small style="color:#888;display:block;margin-top:4px;">画像・PDF・Word・Excel（最大25MB）</small>'
        + '</div>'
        + '<small style="color:#888;margin-top:4px;display:block;">※ 送信時に署名が自動付加されます</small>'
        + '<div style="margin-top:10px;">'
        + '<button onclick="sendReply(\'' + formId + '\',\'' + sid + '\',\'' + mode + '\')" style="background:#27ae60;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:8px;">送信</button>'
        + '<button onclick="closeReply(\'' + formId + '\')" style="background:#95a5a6;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">キャンセル</button>'
        + '<span id="result-' + formId + '" style="margin-left:12px;font-weight:bold;"></span>'
        + '</div>'
        + '</td></tr>';

    return '<tr class="msg-row" data-search="' + fbName + ' ' + registeredName + ' ' + (profile.workplace || '') + ' ' + (d.message || '') + ' ' + (profile.residenceStatus || '') + '" data-docid="' + formId + '">'
      + '<td data-label="受信日時">' + date + '</td>'
      + '<td data-label="名前"><a href="/admin/contacts/' + sid + '" style="color:#2980b9;text-decoration:none;display:flex;align-items:flex-start;">' + avatarHtml(fbName, d.senderPicture)
      + '<div><div style="font-weight:bold;">' + fbName + unreadBadge + countBadge + '</div>'
      + '<div style="font-size:12px;color:#888;margin-top:2px;">' + registeredNameLabel + '</div></div>'
      + '</a></td>'
      + '<td data-label="所属事業所">' + (profile.workplace || '—') + '</td>'
      + '<td data-label="在留資格">' + (profile.residenceStatus || '—') + '</td>'
      + '<td data-label="メッセージ">' + (d.message || '—') + '</td>'
      + '<td data-label="返信メッセージ">' + replyHtml + '</td>'
      + '<td data-label="返信した管理者">' + (d.replyAdmin || '—') + '</td>'
      + '<td data-label="ステータス" style="color:' + statusColor + ';font-weight:bold;">' + (d.status || '未対応') + '</td>'
      + '<td data-label="操作">' + replyBtn + '</td>'
      + '</tr>' + replyForm;
  }).join('');

  // ページネーションHTML
  let paginationHtml = '<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap;">';
  if (page > 1) {
    paginationHtml += '<a href="/admin?page=' + (page-1) + '" style="padding:8px 16px;background:#2980b9;color:white;border-radius:4px;text-decoration:none;">← 前へ</a>';
  }
  for (let i = 1; i <= totalPages; i++) {
    if (i === page) {
      paginationHtml += '<span style="padding:8px 14px;background:#2c3e50;color:white;border-radius:4px;">' + i + '</span>';
    } else if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      paginationHtml += '<a href="/admin?page=' + i + '" style="padding:8px 14px;background:white;color:#2980b9;border:1px solid #2980b9;border-radius:4px;text-decoration:none;">' + i + '</a>';
    } else if (i === page - 3 || i === page + 3) {
      paginationHtml += '<span style="padding:8px 4px;color:#888;">...</span>';
    }
  }
  if (page < totalPages) {
    paginationHtml += '<a href="/admin?page=' + (page+1) + '" style="padding:8px 16px;background:#2980b9;color:white;border-radius:4px;text-decoration:none;">次へ →</a>';
  }
  paginationHtml += '</div>';
  paginationHtml += '<div style="text-align:center;margin-top:8px;font-size:13px;color:#888;">'
    + '全 ' + totalCount + ' 名中 ' + (totalCount === 0 ? 0 : offset+1) + '〜' + Math.min(offset+PAGE_SIZE, totalCount) + ' 名表示'
    + '（' + page + ' / ' + totalPages + ' ページ）</div>';

  const script = `
<script>
var latestISO = '${latestISO}';

function filterRows() {
  var kw = document.getElementById('searchInput').value.toLowerCase();
  var status = document.getElementById('statusFilter').value;
  var rows = document.querySelectorAll('tr.msg-row');
  var count = 0;
  rows.forEach(function(row) {
    var search = (row.dataset.search || '').toLowerCase();
    var docId = row.dataset.docid;
    var replyRow = docId ? document.getElementById('reply-' + docId) : null;
    var statusCell = row.querySelector('td:nth-child(8)');
    var rowStatus = statusCell ? statusCell.textContent.trim() : '';
    var show = (!kw || search.includes(kw)) && (!status || rowStatus === status);
    row.style.display = show ? '' : 'none';
    if (replyRow) replyRow.style.display = 'none';
    if (show) count++;
  });
  document.getElementById('searchCount').textContent = count + ' 名';
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('statusFilter').value = '';
  filterRows();
}

function openReply(docId) {
  var row = document.getElementById('reply-' + docId);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

function closeReply(docId) {
  var row = document.getElementById('reply-' + docId);
  if (row) row.style.display = 'none';
}

async function translateAdminReply(docId) {
  var text = document.getElementById('text-' + docId).value.trim();
  if (!text) { alert('翻訳するテキストを入力してください'); return; }
  var transEl = document.getElementById('translated-' + docId);
  transEl.value = '翻訳中...';
  try {
    var res = await fetch('/admin/translate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ text: text, targetLang: 'EN' })
    });
    var data = await res.json();
    transEl.value = data.success ? data.text : '翻訳失敗';
  } catch(e) {
    transEl.value = 'エラー: ' + e.message;
  }
}

async function sendReply(formId, senderId, mode) {
  var langEl = document.querySelector('input[name="lang-' + formId + '"]:checked');
  var lang = langEl ? langEl.value : 'ja';
  var jaText = document.getElementById('text-' + formId).value.trim();
  var enText = document.getElementById('translated-' + formId).value.trim();
  var fileInput = document.getElementById('file-' + formId);
  var result = document.getElementById('result-' + formId);
  var sendText = lang === 'ja' ? jaText : lang === 'en' ? enText : jaText + (enText ? '\\n\\n' + enText : '');
  if (!sendText && (!fileInput.files || fileInput.files.length === 0)) {
    result.textContent = '△ メッセージまたはファイルを入力してください';
    result.style.color = 'orange'; return;
  }
  result.textContent = '送信中...'; result.style.color = 'gray';
  try {
    var res;
    if (mode === 'update') {
      var formData = new FormData();
      formData.append('docId', formId);
      formData.append('senderId', senderId);
      formData.append('message', sendText);
      if (fileInput.files && fileInput.files.length > 0) formData.append('file', fileInput.files[0]);
      res = await fetch('/admin/reply', { method: 'POST', body: formData });
    } else {
      var formData2 = new FormData();
      formData2.append('message', sendText);
      if (fileInput.files && fileInput.files.length > 0) formData2.append('file', fileInput.files[0]);
      res = await fetch('/admin/contacts/' + senderId + '/send', { method: 'POST', body: formData2 });
    }
    var data = await res.json();
    if (data.success) {
      result.textContent = '✅ 送信完了！'; result.style.color = 'green';
      setTimeout(function(){ location.reload(); }, 1500);
    } else {
      result.textContent = '✗ 送信失敗: ' + data.error; result.style.color = 'red';
    }
  } catch(e) {
    result.textContent = '✗ エラー: ' + e.message; result.style.color = 'red';
  }
}

async function checkNewMessages() {
  try {
    var res = await fetch('/admin/messages/new?after=' + encodeURIComponent(latestISO));
    var data = await res.json();
    if (data.messages && data.messages.length > 0) {
      latestISO = data.messages[0].createdAtISO;
      location.reload();
    }
  } catch(e) {}
}
setInterval(checkNewMessages, 60000);
</script>`;

  res.send('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">'
    + '<link rel="icon" href="https://www.facebook.com/favicon.ico">'
    + (typeof pwaHtml === 'function' ? pwaHtml() : '')
    + '<title>問い合わせ管理画面</title>'
    + '<style>' + commonCss()
    + '.search-bar{display:flex;gap:8px;margin-bottom:16px;align-items:center;background:white;padding:12px 16px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);flex-wrap:wrap;}'
    + '.search-bar input{flex:1;min-width:200px;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;}'
    + '.search-bar select{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;}'
    + '.btn-clear{padding:8px 14px;background:#95a5a6;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;}'
    + '.search-count{font-size:14px;color:#555;}'
    + 'table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + 'th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;font-size:13px;}'
    + 'td{padding:12px 16px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top;}'
    + 'tr.msg-row:hover td{background:#f8f9fa;}'
    + '@media (max-width:768px){'
    + '.container{padding:8px;}'
    + '.search-bar{padding:10px;gap:6px;}'
    + '.search-bar input,.search-bar select,.btn-clear{width:100%;min-width:0;flex:none;}'
    + '.search-count{width:100%;text-align:right;}'
    + 'table,thead,tbody{display:block;width:100%;}'
    + 'thead{display:none;}'
    + 'tr.msg-row{display:block;background:white;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,0.12);margin-bottom:10px;padding:10px 14px;}'
    + 'tr.msg-row td{display:block;padding:6px 0;border-bottom:1px solid #f0f0f0;}'
    + 'tr.msg-row td:last-child{border-bottom:none;}'
    + 'tr.msg-row td[data-label]:before{content:attr(data-label);display:block;font-size:11px;font-weight:bold;color:#999;margin-bottom:2px;}'
    + 'tr.msg-row td[data-label="名前"]:before{display:none;}'
    + 'tr[id^="reply-"] td{display:block;padding:0;border:none;}'
    + '}'
    + '</style></head><body>'
    + '<header><h1>📋 問い合わせ管理画面</h1>' + navHtml(req.session.adminDisplayName) + '</header>'
    + '<div class="container" style="overflow-x:auto;">'
    + '<div class="search-bar">'
    + '<input type="text" id="searchInput" placeholder="🔍 名前・メッセージ・事業所・在留資格で検索..." oninput="filterRows()">'
    + '<select id="statusFilter" onchange="filterRows()"><option value="">すべてのステータス</option><option value="未対応">未対応</option><option value="対応済み">対応済み</option></select>'
    + '<button class="btn-clear" onclick="clearSearch()">× クリア</button>'
    + '<span class="search-count" id="searchCount">' + pageThreads.length + ' 名</span>'
    + '</div>'
    + '<table><thead><tr>'
    + '<th>受信日時</th><th>名前</th><th>所属事業所</th><th>在留資格</th>'
    + '<th>メッセージ</th><th>返信メッセージ</th><th>返信した管理者</th><th>ステータス</th><th>操作</th>'
    + '</tr></thead>'
    + '<tbody id="msgTable">' + rows + '</tbody></table>'
    + paginationHtml
    + '</div>'
    + script
    + '</body></html>');
});

// 返信API
router.post('/reply', requireAuth, upload.single('file'), async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { docId, senderId, message } = req.body;
  try {
    const docRef = db.collection('messages').doc(docId);
    const doc = await docRef.get();
    if (!doc.exists) return res.json({ success: false, error: 'メッセージが見つかりません' });

    let attachmentName = null;
    let attachmentType = null;
    let attachmentUrl = null;

    if (req.file) {
      const fileType = getAttachmentType(req.file.mimetype);
      attachmentName = req.file.originalname;
      attachmentType = fileType;

      // Cloudinaryにアップロードして公開URLを取得し、そのURLをMessengerに渡す
      // （/me/message_attachments は権限不足のため使用しない）
      attachmentUrl = await uploadToCloudinary(req.file.buffer, req.file.originalname, req.file.mimetype);

      const msgUrl = 'https://graph.facebook.com/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN;
      const msgRes = await axios.post(msgUrl, {
        recipient: { id: senderId },
        message: { attachment: { type: fileType, payload: { url: attachmentUrl, is_reusable: true } } },
        messaging_type: 'RESPONSE'
      });
      if (msgRes.data && msgRes.data.error) {
        console.error('添付送信エラー:', msgRes.data.error);
        return res.json({ success: false, error: msgRes.data.error.message });
      }
    }

    // 署名をセッションから取得（なければFirestoreから取得）
    let signature = req.session.adminSignature || '';
    if (!signature) {
      try {
        const adminSnapshot = await db.collection('admins').where('userId', '==', req.session.adminId).limit(1).get();
        if (!adminSnapshot.empty) {
          signature = adminSnapshot.docs[0].data().signature || '';
          req.session.adminSignature = signature;
        }
      } catch (e) {}
    }

    // 署名込みのテキストを作成
    const replyText = (message || '') + (signature ? '\n\n' + signature : '');

    // 署名込みで送信
    if (replyText.trim()) {
      await sendMessage(senderId, replyText);
    }

    await docRef.update({
      status: '対応済み',
      replyMessage: replyText,
      replyAdmin: req.session.adminDisplayName || '管理者',
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      attachmentName, attachmentType, attachmentUrl
    });

    res.json({ success: true });
  } catch (err) {
    console.error('返信エラー:', err.message);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
