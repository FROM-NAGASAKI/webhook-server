const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { requireAuth } = require('../helpers/auth');
const { sendMessage, getAttachmentType } = require('../helpers/facebook');
const { avatarHtml, attachmentHtml, messengerLinkHtml, navHtml, commonCss } = require('../helpers/html');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

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

// 問い合わせ一覧
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const snapshot = await db.collection('messages').orderBy('createdAt', 'desc').limit(100).get();
  const senderIds = [...new Set(snapshot.docs.map(d => d.data().senderId).filter(Boolean))];
  const profileMap = {};
  await Promise.all(senderIds.map(async sid => {
    const doc = await db.collection('contacts').doc(sid).get();
    if (doc.exists) profileMap[sid] = doc.data();
  }));
  const latestISO = snapshot.size > 0 && snapshot.docs[0].data().createdAt
    ? snapshot.docs[0].data().createdAt.toDate().toISOString() : '';

  const rows = snapshot.docs.map(doc => {
    const d = doc.data();
    const profile = profileMap[d.senderId] || {};
    const displayName = profile.passportName || d.senderName || '不明';
    const date = d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const statusColor = d.status === '未対応' ? '#e74c3c' : '#27ae60';
    const replyHtml = (d.replyMessage || d.attachmentName)
      ? (d.replyMessage || '') + (d.attachmentName ? '<br><small>📎 ' + d.attachmentName + '</small>' : '')
      : '—';

    const replyBtn = d.status === '未対応'
      ? '<button onclick="openReply(\'' + doc.id + '\')" style="background:#2980b9;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">返信</button>'
      : '';

    const replyForm = d.status === '未対応'
      ? '<tr id="reply-' + doc.id + '" style="display:none;background:#f0f7ff;">'
        + '<td colspan="9" style="padding:12px;">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">'
        + '<div>'
        + '<label style="font-size:12px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">📝 日本語（入力）</label>'
        + '<textarea id="text-' + doc.id + '" rows="3" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;" placeholder="返信メッセージを入力（任意）..."></textarea>'
        + '<br><button onclick="translateAdminReply(\'' + doc.id + '\')" style="margin-top:4px;font-size:12px;padding:4px 10px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;">🌐 英訳する</button>'
        + '</div>'
        + '<div>'
        + '<label style="font-size:12px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">🌐 英語訳（自動）</label>'
        + '<textarea id="translated-' + doc.id + '" rows="3" style="width:100%;padding:8px;border:1px solid #27ae60;border-radius:4px;font-size:14px;box-sizing:border-box;background:#f9fff9;" placeholder="英訳がここに表示されます..."></textarea>'
        + '<div style="margin-top:4px;font-size:11px;color:#888;">※ 編集して送信も可能です</div>'
        + '</div>'
        + '</div>'
        + '<div style="margin-bottom:8px;">'
        + '<label style="font-size:12px;color:#555;font-weight:bold;">送信言語：</label>'
        + '<label style="font-size:13px;margin-left:8px;cursor:pointer;"><input type="radio" name="lang-' + doc.id + '" value="ja" checked> 日本語</label>'
        + '<label style="font-size:13px;margin-left:12px;cursor:pointer;"><input type="radio" name="lang-' + doc.id + '" value="en"> 英語訳</label>'
        + '<label style="font-size:13px;margin-left:12px;cursor:pointer;"><input type="radio" name="lang-' + doc.id + '" value="both"> 両方送信</label>'
        + '</div>'
        + '<div style="margin-bottom:8px;">'
        + '<label style="font-size:13px;color:#555;font-weight:bold;">📎 添付ファイル：</label>'
        + '<input type="file" id="file-' + doc.id + '" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:13px;margin-left:8px;">'
        + '<small style="color:#888;display:block;margin-top:4px;">画像・PDF・Word・Excel（最大25MB）</small>'
        + '</div>'
        + '<small style="color:#888;margin-top:4px;display:block;">※ 送信時に署名が自動付加されます</small>'
        + '<div style="margin-top:10px;">'
        + '<button onclick="sendReply(\'' + doc.id + '\',\'' + d.senderId + '\')" style="background:#27ae60;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:8px;">送信</button>'
        + '<button onclick="closeReply(\'' + doc.id + '\')" style="background:#95a5a6;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">キャンセル</button>'
        + '<span id="result-' + doc.id + '" style="margin-left:12px;font-weight:bold;"></span>'
        + '</div>'
        + '</td></tr>'
      : '';

    return '<tr class="msg-row" data-search="' + displayName + ' ' + (profile.workplace || '') + ' ' + (d.message || '') + ' ' + (profile.residenceStatus || '') + '" data-docid="' + doc.id + '">'
      + '<td>' + date + '</td>'
      + '<td><a href="/admin/contacts/' + d.senderId + '" style="color:#2980b9;text-decoration:none;font-weight:bold;display:flex;align-items:center;">' + avatarHtml(displayName, d.senderPicture) + displayName + '</a></td>'
      + '<td>' + (profile.workplace || '—') + '</td>'
      + '<td>' + (profile.residenceStatus || '—') + '</td>'
      + '<td>' + (d.message || '—') + '</td>'
      + '<td>' + replyHtml + '</td>'
      + '<td>' + (d.replyAdmin || '—') + '</td>'
      + '<td style="color:' + statusColor + ';font-weight:bold;">' + (d.status || '未対応') + '</td>'
      + '<td>' + replyBtn + '</td>'
      + '</tr>' + replyForm;
  }).join('');

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
    var replyRow = document.getElementById('reply-' + docId);
    var statusCell = row.querySelector('td:nth-child(8)');
    var rowStatus = statusCell ? statusCell.textContent.trim() : '';
    var show = (!kw || search.includes(kw)) && (!status || rowStatus === status);
    row.style.display = show ? '' : 'none';
    if (replyRow) replyRow.style.display = 'none';
    if (show) count++;
  });
  document.getElementById('searchCount').textContent = '全 ' + count + ' 件';
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

async function sendReply(docId, senderId) {
  var langEl = document.querySelector('input[name="lang-' + docId + '"]:checked');
  var lang = langEl ? langEl.value : 'ja';
  var jaText = document.getElementById('text-' + docId).value.trim();
  var enText = document.getElementById('translated-' + docId).value.trim();
  var fileInput = document.getElementById('file-' + docId);
  var result = document.getElementById('result-' + docId);
  var sendText = lang === 'ja' ? jaText : lang === 'en' ? enText : jaText + (enText ? '\\n\\n' + enText : '');
  if (!sendText && (!fileInput.files || fileInput.files.length === 0)) {
    result.textContent = '△ メッセージまたはファイルを入力してください';
    result.style.color = 'orange'; return;
  }
  result.textContent = '送信中...'; result.style.color = 'gray';
  try {
    var formData = new FormData();
    formData.append('docId', docId);
    formData.append('senderId', senderId);
    formData.append('message', sendText);
    if (fileInput.files && fileInput.files.length > 0) formData.append('file', fileInput.files[0]);
    var res = await fetch('/admin/reply', { method: 'POST', body: formData });
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
    + '<title>問い合わせ管理画面</title>'
    + '<style>' + commonCss()
    + '.search-bar{display:flex;gap:8px;margin-bottom:16px;align-items:center;background:white;padding:12px 16px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + '.search-bar input{flex:1;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;}'
    + '.search-bar select{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;}'
    + '.btn-clear{padding:8px 14px;background:#95a5a6;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;}'
    + '.search-count{font-size:14px;color:#555;}'
    + 'table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + 'th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;font-size:13px;}'
    + 'td{padding:12px 16px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top;}'
    + 'tr.msg-row:hover td{background:#f8f9fa;}'
    + '@keyframes highlight{0%{background:#fff3cd;}100%{background:white;}}'
    + '.new-message td{animation:highlight 3s ease-out;}'
    + '</style></head><body>'
    + '<header><h1>📋 問い合わせ管理画面</h1>' + navHtml(req.session.adminDisplayName) + '</header>'
    + '<div class="container" style="overflow-x:auto;">'
    + '<div class="search-bar">'
    + '<input type="text" id="searchInput" placeholder="🔍 名前・メッセージ・事業所・在留資格で検索..." oninput="filterRows()">'
    + '<select id="statusFilter" onchange="filterRows()"><option value="">すべてのステータス</option><option value="未対応">未対応</option><option value="対応済み">対応済み</option></select>'
    + '<button class="btn-clear" onclick="clearSearch()">× クリア</button>'
    + '<span class="search-count" id="searchCount">全 ' + snapshot.size + ' 件</span>'
    + '</div>'
    + '<table><thead><tr>'
    + '<th>受信日時</th><th>名前</th><th>所属事業所</th><th>在留資格</th>'
    + '<th>メッセージ</th><th>返信メッセージ</th><th>返信した管理者</th><th>ステータス</th><th>操作</th>'
    + '</tr></thead>'
    + '<tbody id="msgTable">' + rows + '</tbody></table>'
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
      const url = 'https://graph.facebook.com/v19.0/me/message_attachments?access_token=' + PAGE_ACCESS_TOKEN;
      const form = new FormData();
      form.append('message', JSON.stringify({ attachment: { type: fileType, payload: { is_reusable: true } } }));
      form.append('filedata', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });
      const uploadRes = await axios.post(url, form, { headers: form.getHeaders() });
      const attachmentId = uploadRes.data.attachment_id;
      const msgUrl = 'https://graph.facebook.com/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN;
      const msgRes = await axios.post(msgUrl, {
        recipient: { id: senderId },
        message: { attachment: { type: fileType, payload: { attachment_id: attachmentId } } }
      });
      attachmentUrl = msgRes.data.attachment_url || null;
    }

    if (message && message.trim()) {
      await sendMessage(senderId, message);
    }

    const replyText = (message || '') + '\n担当：' + (req.session.adminDisplayName || '管理者') + '\ntel\nmail\nfacebook';

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
