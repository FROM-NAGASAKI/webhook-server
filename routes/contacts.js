const express = require('express');
const router = express.Router();
const { requireAuth } = require('../helpers/auth');
const { sendMessage, getAttachmentType, resolveMessagingParams } = require('../helpers/facebook');
const { avatarHtml, attachmentHtml, messengerLinkHtml, navHtml, commonCss } = require('../helpers/html');
const { uploadToCloudinary } = require('../helpers/cloudinary');
const { resolveAllUnread } = require('../helpers/messages');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ユーザー一覧
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const snapshot = await db.collection('messages').orderBy('createdAt', 'desc').get();
  const users = {};
  snapshot.docs.forEach(doc => {
    const d = doc.data(); const sid = d.senderId;
    if (!users[sid]) users[sid] = {
      senderId: sid,
      senderName: d.senderName || '不明',
      senderPicture: d.senderPicture || null,
      count: 0,
      unread: 0,
      lastMessage: '',      // ユーザーが最後に送ってきたメッセージ（管理者の返信は含めない）
      lastDate: d.createdAt // 一覧の並び順表示用：直近の活動全体（ユーザー・管理者どちらでも）
    };
    const u = users[sid];
    u.count++;
    if (d.status === '未対応') u.unread++;
    if (!d.isAdminSent && !u.lastMessageSet) {
      u.lastMessage = d.message || '';
      u.lastMessageSet = true;
      // ユーザー由来の名前・アイコンを優先して保持する
      u.senderName = d.senderName || u.senderName;
      u.senderPicture = d.senderPicture || u.senderPicture;
    }
  });
  const senderIds = Object.keys(users);
  const profileMap = {};
  await Promise.all(senderIds.map(async sid => {
    const doc = await db.collection('contacts').doc(sid).get();
    if (doc.exists) profileMap[sid] = doc.data();
  }));
  const rows = Object.values(users).map(u => {
    const lastDate = u.lastDate ? u.lastDate.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const unreadBadge = u.unread > 0 ? '<span style="background:#e74c3c;color:white;border-radius:12px;padding:2px 8px;font-size:12px;margin-left:6px;">' + u.unread + '</span>' : '';
    const profile = profileMap[u.senderId] || {};
    const fbName = u.senderName || '不明';
    const registeredName = profile.passportName || '';
    const primaryName = registeredName || fbName;
    const secondaryLabel = registeredName
      ? 'FBアカウント名：' + fbName
      : (profile.nameCandidate ? '登録名：未登録（候補：' + profile.nameCandidate + '）' : '登録名：未登録');
    return '<tr onclick="location.href=\'/admin/contacts/' + u.senderId + '\'" style="cursor:pointer;">'
      + '<td data-label="名前"><div style="display:flex;align-items:flex-start;">' + avatarHtml(primaryName, u.senderPicture)
      + '<div><div><strong>' + primaryName + '</strong>' + unreadBadge + '</div>'
      + '<div style="font-size:12px;color:#888;margin-top:2px;">' + secondaryLabel + '</div>'
      + '<div style="font-size:11px;color:#aaa;margin-top:1px;">ID: ' + u.senderId + '</div></div>'
      + '</div></td>'
      + '<td data-label="所属事業所">' + (profile.workplace || '—') + '</td><td data-label="在留資格">' + (profile.residenceStatus || '—') + '</td>'
      + '<td data-label="最新メッセージ">' + (u.lastMessage || '—') + '</td><td data-label="最終日時">' + lastDate + '</td><td data-label="件数">' + u.count + '</td>'
      + '</tr>';
  }).join('');
  res.send('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">'
    + '<link rel="icon" href="https://www.facebook.com/favicon.ico">'
    + '<title>ユーザー履歴</title>'
    + '<style>' + commonCss() + ' table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + 'th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;} td{padding:14px 16px;border-bottom:1px solid #eee;} tr:hover td{background:#f0f7ff;}'
    + '@media (max-width:768px){'
    + '.container{padding:8px;}'
    + 'table,thead,tbody{display:block;width:100%;}'
    + 'thead{display:none;}'
    + 'tr{display:block;background:white;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,0.12);margin-bottom:10px;padding:10px 14px;}'
    + 'tr td{display:block;padding:6px 0;border-bottom:1px solid #f0f0f0;}'
    + 'tr td:last-child{border-bottom:none;}'
    + 'tr td[data-label]:before{content:attr(data-label);display:block;font-size:11px;font-weight:bold;color:#999;margin-bottom:2px;}'
    + 'tr td[data-label="名前"]:before{display:none;}'
    + '}'
    + '</style>'
    + '</head><body><header><h1>👥 ユーザー履歴</h1>' + navHtml(req.session.adminDisplayName) + '</header>'
    + '<div class="container"><table><thead><tr><th>名前</th><th>所属事業所</th><th>在留資格</th><th>最新メッセージ</th><th>最終日時</th><th>件数</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div></body></html>');
});

// ユーザー詳細
router.get('/:senderId', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const senderId = req.params.senderId;
  const [msgSnapshot, contactDoc] = await Promise.all([
    db.collection('messages').where('senderId', '==', senderId).orderBy('createdAt', 'asc').get(),
    db.collection('contacts').doc(senderId).get()
  ]);
  if (msgSnapshot.empty) return res.status(404).send('ユーザーが見つかりません');
  const firstData = msgSnapshot.docs[0].data();
  const profile = contactDoc.exists ? contactDoc.data() : {};
  const senderName = profile.passportName || firstData.senderName || '不明';
  const senderPicture = firstData.senderPicture || null;
  const totalCount = msgSnapshot.size;
  const unreadCount = msgSnapshot.docs.filter(d => d.data().status === '未対応').length;

  const messages = msgSnapshot.docs.map(doc => {
    const d = doc.data();
    const date = d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const status = d.status || '未対応';
    const statusColor = status === '未対応' ? '#e74c3c' : '#27ae60';
    const msgId = doc.id;

    // 管理者送信メッセージは右側（管理者側）に表示
    if (d.isAdminSent) {
      const replyText = d.replyMessage || '';
      const repliedAt = d.repliedAt ? d.repliedAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : date;
      return '<div style="display:flex;justify-content:flex-end;margin-bottom:16px;"><div class="chat-bubble" style="max-width:60%;">'
        + '<div style="font-size:12px;color:#888;margin-bottom:4px;text-align:right;">' + (d.replyAdmin || '管理者') + ' · ' + repliedAt + '</div>'
        + '<div style="background:#dcf8c6;border-radius:12px 0 12px 12px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,0.1);">'
        + '<div style="white-space:pre-wrap;">' + replyText + '</div>'
        + attachmentHtml(d)
        + '</div></div></div>';
    }

    let html = '<div style="display:flex;justify-content:flex-start;margin-bottom:8px;gap:8px;">'
      + avatarHtml(senderName, senderPicture)
      + '<div class="chat-bubble" style="max-width:60%;">'
      + '<div style="font-size:12px;color:#888;margin-bottom:4px;">' + senderName + ' · ' + date + '</div>'
      + '<div id="msg-' + msgId + '" style="background:white;border-radius:0 12px 12px 12px;padding:10px 12px;box-shadow:0 1px 4px rgba(0,0,0,0.1);">' + (d.message || '') + attachmentHtml(d) + '</div>'
      + '<div style="margin-top:4px;">'
      + '<button onclick="translateMsg(\'' + msgId + '\')" style="font-size:11px;padding:3px 8px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;">🌐 日本語訳</button>'
      + '<span id="trans-status-' + msgId + '" style="font-size:12px;color:#555;margin-left:8px;"></span>'
      + '</div>'
      + '<div id="trans-result-' + msgId + '" style="display:none;background:#eaf4fb;border-radius:4px;padding:8px;margin-top:4px;font-size:13px;color:#2c3e50;"></div>'
      + '<div style="font-size:12px;margin-top:4px;color:' + statusColor + ';">' + status + '</div>'
      + '</div>';

    if (d.replyAdmin && (d.replyMessage || d.attachmentName)) {
      const repliedAt = d.repliedAt ? d.repliedAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
      const replyText = d.replyMessage ? '<div style="white-space:pre-wrap;">' + d.replyMessage + '</div>' : '';
      html += '<div style="display:flex;justify-content:flex-end;margin-bottom:24px;"><div class="chat-bubble" style="max-width:60%;">'
        + '<div style="font-size:12px;color:#888;margin-bottom:4px;text-align:right;">' + (d.replyAdmin || '管理者') + ' · ' + repliedAt + '</div>'
        + '<div style="background:#dcf8c6;border-radius:12px 0 12px 12px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,0.1);">'
        + replyText + attachmentHtml(d)
        + '</div></div></div>';
    }

    html += '</div>';
    return html;
  }).join('');

  const nameCandidateHint = (!profile.passportName && profile.nameCandidate)
    ? '<div style="font-size:12px;color:#e67e22;margin-top:4px;">💡 候補（本人からの返信）：' + profile.nameCandidate + '　※内容を確認の上、そのまま保存もできます</div>'
    : '';

  const profileHtml = '<div class="card">'
    + '<h3 style="margin-top:0;color:#2c3e50;">📝 プロフィール情報</h3>'
    + '<div class="profile-grid">'
    + '<div><label>パスポートネーム</label><input type="text" id="passportName" value="' + (profile.passportName || profile.nameCandidate || '') + '" placeholder="例：MURAKAMI TARO">' + nameCandidateHint + '</div>'
    + '<div><label>所属事業所</label><input type="text" id="workplace" value="' + (profile.workplace || '') + '" placeholder="例：株式会社FROM長崎"></div>'
    + '<div><label>在留資格</label><input type="text" id="residenceStatus" value="' + (profile.residenceStatus || '') + '" placeholder="例：技能実習"></div>'
    + '<div><label>入国日</label><input type="date" id="entryDate" value="' + (profile.entryDate || '') + '"></div>'
    + '<div><label>検索用フォーム</label><input type="text" id="searchTags" value="' + (profile.searchTags || '') + '" placeholder="例：長崎 技能実習 2024"></div>'
    + '<div><label>備考</label><textarea class="profile-textarea" id="notes" rows="3" placeholder="自由記述...">' + (profile.notes || '') + '</textarea></div>'
    + '</div>'
    + '<button class="save" onclick="saveProfile()">💾 保存</button>'
    + '<span id="profileMsg" style="margin-left:12px;font-size:14px;font-weight:bold;"></span>'
    + '</div>';

  const script = `
<script>
var __templatesCache = null;
async function loadTemplatesInto(selectEl) {
  if (__templatesCache) return; // 一度読み込んだら再取得しない
  try {
    var res = await fetch('/admin/profile/templates');
    var data = await res.json();
    __templatesCache = data.templates || [];
  } catch(e) { __templatesCache = []; }
  document.querySelectorAll("select[id^='tplSelect-']").forEach(function(sel) {
    var current = sel.value;
    sel.innerHTML = '<option value="">📋 定型文を選択...</option>' + __templatesCache.map(function(t, i) {
      return '<option value="' + i + '">' + t.title + '</option>';
    }).join('');
    sel.value = current;
  });
}
function applyTemplate(selectEl, textareaId) {
  var idx = selectEl.value;
  if (idx === '' || !__templatesCache) return;
  var t = __templatesCache[idx];
  if (t) document.getElementById(textareaId).value = t.body;
  selectEl.value = '';
}

async function translateMsg(docId) {
  var msgEl = document.getElementById('msg-' + docId);
  var statusEl = document.getElementById('trans-status-' + docId);
  var resultEl = document.getElementById('trans-result-' + docId);
  var text = msgEl ? msgEl.textContent.trim() : '';
  if (!text) return;
  statusEl.textContent = '翻訳中...';
  try {
    var res = await fetch('/admin/translate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,targetLang:'JA'})});
    var data = await res.json();
    if (data.success) { resultEl.style.display='block'; resultEl.textContent='🇯🇵 '+data.text; statusEl.textContent=''; }
    else { statusEl.textContent='翻訳失敗'; }
  } catch(e) { statusEl.textContent='エラー'; }
}

async function translateReply(docId) {
  var text = document.getElementById('text-'+docId).value.trim();
  if (!text) { alert('翻訳するテキストを入力してください'); return; }
  var transEl = document.getElementById('translated-'+docId);
  transEl.value = '翻訳中...';
  try {
    var res = await fetch('/admin/translate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,targetLang:'EN'})});
    var data = await res.json();
    transEl.value = data.success ? data.text : '翻訳失敗';
  } catch(e) { transEl.value = 'エラー: '+e.message; }
}

async function sendReply(docId, senderId) {
  var radios = document.getElementsByName('lang-'+docId);
  var lang = 'ja';
  for(var i=0;i<radios.length;i++){if(radios[i].checked){lang=radios[i].value;break;}}
  var jaText = document.getElementById('text-'+docId).value.trim();
  var enText = document.getElementById('translated-'+docId).value.trim();
  var fileInput = document.getElementById('file-'+docId);
  var result = document.getElementById('result-'+docId);
  var sendText = lang==='ja' ? jaText : lang==='en' ? enText : jaText+(enText?String.fromCharCode(10,10)+enText:'');
  if (!sendText && (!fileInput.files||fileInput.files.length===0)) {
    result.textContent='△ メッセージまたはファイルを入力してください'; result.style.color='orange'; return;
  }
  result.textContent='送信中...'; result.style.color='gray';
  try {
    var fd = new FormData();
    fd.append('docId',docId); fd.append('senderId',senderId); fd.append('message',sendText);
    if (fileInput.files&&fileInput.files.length>0) fd.append('file',fileInput.files[0]);
    var res = await fetch('/admin/reply',{method:'POST',body:fd});
    var data = await res.json();
    if (data.success && data.warning) { result.textContent='⚠️ '+data.warning; result.style.color='#9c640c'; setTimeout(function(){location.reload();},2500); }
    else if (data.success) { result.textContent='✅ 送信完了！'; result.style.color='green'; setTimeout(function(){location.reload();},1500); }
    else { result.textContent='✗ 送信失敗: '+data.error; result.style.color='red'; }
  } catch(e) { result.textContent='✗ エラー: '+e.message; result.style.color='red'; }
}

async function saveProfile() {
  var msg = document.getElementById('profileMsg');
  msg.textContent='保存中...'; msg.style.color='gray';
  var data = {
    passportName: document.getElementById('passportName').value.trim(),
    workplace: document.getElementById('workplace').value.trim(),
    residenceStatus: document.getElementById('residenceStatus').value.trim(),
    entryDate: document.getElementById('entryDate').value,
    searchTags: document.getElementById('searchTags').value.trim(),
    notes: document.getElementById('notes').value.trim()
  };
  try {
    var res = await fetch('/admin/contacts/${senderId}/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    var result = await res.json();
    if (result.success) { msg.textContent='✅ 保存しました'; msg.style.color='green'; setTimeout(function(){location.reload();},1000); }
    else { msg.textContent='✗ 保存失敗: '+result.error; msg.style.color='red'; }
  } catch(e) { msg.textContent='✗ エラー: '+e.message; msg.style.color='red'; }
}

async function translateNewMsg() {
  var text = document.getElementById('newMsgJa').value.trim();
  if (!text) { alert('翻訳するテキストを入力してください'); return; }
  var transEl = document.getElementById('newMsgEn');
  transEl.value = '翻訳中...';
  try {
    var res = await fetch('/admin/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,targetLang:'EN'})});
    var data = await res.json();
    transEl.value = data.success ? data.text : '翻訳失敗';
  } catch(e) { transEl.value = 'エラー: '+e.message; }
}

async function sendNewMessage() {
  var radios = document.getElementsByName('newMsgLang');
  var lang = 'ja';
  for(var i=0;i<radios.length;i++){if(radios[i].checked){lang=radios[i].value;break;}}
  var jaText = document.getElementById('newMsgJa').value.trim();
  var enText = document.getElementById('newMsgEn').value.trim();
  var fileInput = document.getElementById('newMsgFile');
  var result = document.getElementById('newMsgResult');
  var sendText = lang==='ja' ? jaText : lang==='en' ? enText : jaText+(enText?String.fromCharCode(10,10)+enText:'');
  if (!sendText && (!fileInput||!fileInput.files||fileInput.files.length===0)) {
    result.textContent='△ メッセージまたはファイルを入力してください'; result.style.color='orange'; return;
  }
  result.textContent='送信中...'; result.style.color='gray';
  try {
    var fd = new FormData();
    fd.append('message',sendText);
    if (fileInput&&fileInput.files&&fileInput.files.length>0) fd.append('file',fileInput.files[0]);
    var res = await fetch('/admin/contacts/${senderId}/send',{method:'POST',body:fd});
    var data = await res.json();
    if (data.success && data.warning) {
      result.textContent='⚠️ '+data.warning; result.style.color='#9c640c';
      document.getElementById('newMsgJa').value='';
      document.getElementById('newMsgEn').value='';
      if(fileInput) fileInput.value='';
      setTimeout(function(){location.reload();},2500);
    } else if (data.success) {
      result.textContent='✅ 送信完了！'; result.style.color='green';
      document.getElementById('newMsgJa').value='';
      document.getElementById('newMsgEn').value='';
      if(fileInput) fileInput.value='';
      setTimeout(function(){location.reload();},1500);
    } else { result.textContent='✗ 送信失敗: '+data.error; result.style.color='red'; }
  } catch(e) { result.textContent='✗ エラー: '+e.message; result.style.color='red'; }
}

window.onload = function(){ window.scrollTo(0, document.body.scrollHeight); };
</script>`;

  res.send('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">'
    + '<link rel="icon" href="https://www.facebook.com/favicon.ico">'
    + '<title>' + senderName + ' の履歴</title>'
    + '<style>' + commonCss()
    + '.card{background:white;border-radius:8px;padding:20px 24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + '.user-info{display:flex;gap:32px;align-items:center;flex-wrap:wrap;}'
    + '.user-info .label{font-size:12px;color:#888;} .user-info .value{font-size:15px;font-weight:bold;}'
    + '.profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:600px;}'
    + 'label{display:block;margin-bottom:4px;font-size:13px;color:#555;font-weight:bold;}'
    + 'input[type=text],input[type=date]{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:100%;box-sizing:border-box;}'
    + 'textarea.profile-textarea{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:100%;box-sizing:border-box;resize:vertical;}'
    + 'button.save{background:#2980b9;color:white;border:none;padding:9px 20px;border-radius:4px;cursor:pointer;font-size:14px;margin-top:8px;}'
    + '.compose-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}'
    + '@media (max-width:768px){'
    + '.container{padding:8px;}'
    + '.card{padding:14px 16px;}'
    + '.user-info{gap:12px;}'
    + '.profile-grid{grid-template-columns:1fr;max-width:none;}'
    + '.compose-grid{grid-template-columns:1fr;}'
    + '.chat-bubble{max-width:85%!important;}'
    + '}'
    + '</style></head><body>'
    + '<header><h1>💬 ' + senderName + ' の履歴</h1>' + navHtml(req.session.adminDisplayName) + '</header>'
    + '<div class="container">'
    + '<div class="card"><div class="user-info">'
    + '<div>' + avatarHtml(senderName, senderPicture, 48) + '</div>'
    + '<div><div class="label">名前</div><div class="value">' + senderName + '</div></div>'
    + '<div><div class="label">送信者ID</div><div class="value" style="font-size:13px;">' + senderId + '</div></div>'
    + '<div><div class="label">問い合わせ件数</div><div class="value">' + totalCount + ' 件</div></div>'
    + '<div><div class="label">未対応</div><div class="value" style="color:' + (unreadCount > 0 ? '#e74c3c' : '#27ae60') + '">' + unreadCount + ' 件</div></div>'
    + '<div><a href="/admin/contacts" style="color:#2980b9;text-decoration:none;">← 一覧に戻る</a></div>'
    + '</div></div>'
    + messengerLinkHtml(senderId)
    + profileHtml
    + '<div class="card"><h3 style="margin-top:0;color:#2c3e50;">💬 会話履歴</h3>' + messages + '</div>'
    + '<div class="card" style="border:2px solid #2980b9;">'
    + '<h3 style="margin-top:0;color:#2980b9;">✉️ 新規メッセージ送信</h3>'
    + '<p style="font-size:13px;color:#888;margin-top:0;">※ HUMAN_AGENTタグを使用するため、最終メッセージから7日以内であれば24時間を過ぎていても送信可能です。</p>'
    + '<div style="margin-bottom:10px;">'
    + '<label style="font-size:13px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">📋 定型文を使う</label>'
    + '<select id="tplSelect-newMsg" onchange="applyTemplate(this,\'newMsgJa\')" onfocus="loadTemplatesInto(this)" style="padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;max-width:400px;width:100%;"><option value="">📋 定型文を選択...</option></select>'
    + '</div>'
    + '<div class="compose-grid">'
    + '<div>'
    + '<label style="font-size:13px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">📝 日本語（入力）</label>'
    + '<textarea id="newMsgJa" rows="4" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;resize:vertical;" placeholder="送信するメッセージを入力..."></textarea>'
    + '<button onclick="translateNewMsg()" style="margin-top:6px;font-size:12px;padding:4px 10px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;">🌐 英訳する</button>'
    + '</div>'
    + '<div>'
    + '<label style="font-size:13px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">🌐 英語訳（自動）</label>'
    + '<textarea id="newMsgEn" rows="4" style="width:100%;padding:8px;border:1px solid #27ae60;border-radius:4px;font-size:14px;box-sizing:border-box;resize:vertical;background:#f9fff9;" placeholder="英訳がここに表示されます..."></textarea>'
    + '<div style="margin-top:4px;font-size:11px;color:#888;">※ 編集して送信も可能です</div>'
    + '</div>'
    + '</div>'
    + '<div style="margin-bottom:12px;">'
    + '<label style="font-size:13px;color:#555;font-weight:bold;">送信言語：</label>'
    + '<label style="font-size:13px;margin-left:8px;cursor:pointer;"><input type="radio" name="newMsgLang" value="ja" checked> 日本語</label>'
    + '<label style="font-size:13px;margin-left:12px;cursor:pointer;"><input type="radio" name="newMsgLang" value="en"> 英語訳</label>'
    + '<label style="font-size:13px;margin-left:12px;cursor:pointer;"><input type="radio" name="newMsgLang" value="both"> 両方送信</label>'
    + '</div>'
    + '<div style="margin-bottom:12px;">'
    + '<label style="font-size:13px;color:#555;font-weight:bold;">📎 添付ファイル：</label>'
    + '<input type="file" id="newMsgFile" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:13px;margin-left:8px;">'
    + '<small style="color:#888;display:block;margin-top:4px;">画像・PDF・Word・Excel（最大25MB）</small>'
    + '</div>'
    + '<button onclick="sendNewMessage()" style="background:#2980b9;color:white;border:none;padding:10px 24px;border-radius:4px;cursor:pointer;font-size:15px;font-weight:bold;">📤 送信</button>'
    + '<span id="newMsgResult" style="margin-left:12px;font-weight:bold;font-size:14px;"></span>'
    + '</div>'
    + '</div>'
    + script
    + '</body></html>');
});

// 新規メッセージ送信API（ファイル添付対応・Cloudinary経由）
const multerContact = require('multer');
const axiosContact = require('axios');
const FormDataContact = require('form-data');
const uploadContact = multerContact({ storage: multerContact.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/:senderId/send', requireAuth, uploadContact.single('file'), async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { senderId } = req.params;
  const { message } = req.body;
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

  if (!message && !req.file) return res.json({ success: false, error: 'メッセージまたはファイルが必要です' });

  try {
    // 署名をセッションから取得
    let signature = req.session.adminSignature || '';
    if (!signature) {
      try {
        const adminSnapshot = await db.collection('admins').where('userId', '==', req.session.adminId).limit(1).get();
        if (!adminSnapshot.empty) {
          signature = adminSnapshot.docs[0].data().signature || '';
          req.session.adminSignature = signature;
        }
      } catch(e) {}
    }

    const sendText = (message || '') + (signature ? '\n\n' + signature : '');

    // テキスト送信
    if (sendText.trim()) {
      const url = 'https://graph.facebook.com/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: senderId },
          message: { text: sendText },
          ...resolveMessagingParams('HUMAN_AGENT') // 未承認のうちは自動的にRESPONSE（24時間ルール）にフォールバックする
        })
      });
      const data = await response.json();
      if (data.error) {
        console.error('個別送信エラー（本文）:', senderId, data.error.message);
        return res.json({ success: false, error: data.error.message });
      }
    }

    // ファイル添付送信（Cloudinaryにアップロードし、公開URLをMessengerに渡す）
    // /me/message_attachments を使わないため権限不足エラー(#100 2018047)を回避できる
    // 注意：本文はすでに届いているため、添付が失敗しても処理を打ち切らない
    let attachmentName = null;
    let attachmentUrl = null;
    let attachmentPublicId = null;
    let attachmentResourceType = null;
    let attachmentSendFailed = false;
    let attachmentSendError = null;
    if (req.file) {
      try {
        const fileType = getAttachmentType(req.file.mimetype);
        attachmentName = req.file.originalname;
        console.log('Cloudinaryアップロード開始:', req.file.originalname, req.file.mimetype, fileType, req.file.size);

        const uploaded = await uploadToCloudinary(req.file.buffer, req.file.originalname, req.file.mimetype);
        attachmentUrl = uploaded.url;
        attachmentPublicId = uploaded.publicId;
        attachmentResourceType = uploaded.resourceType;
        console.log('Cloudinaryアップロード完了:', attachmentUrl);

        const msgUrl = 'https://graph.facebook.com/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN;
        const msgRes = await axiosContact.post(msgUrl, {
          recipient: { id: senderId },
          message: { attachment: { type: fileType, payload: { url: attachmentUrl, is_reusable: true } } },
          ...resolveMessagingParams('HUMAN_AGENT')
        });
        if (msgRes.data && msgRes.data.error) {
          attachmentSendFailed = true;
          attachmentSendError = msgRes.data.error.message;
        }
      } catch (attachErr) {
        const fbError = attachErr.response && attachErr.response.data && attachErr.response.data.error;
        attachmentSendFailed = true;
        attachmentSendError = fbError ? fbError.message : attachErr.message;
      }
      if (attachmentSendFailed) {
        console.error('添付送信エラー詳細:', senderId, attachmentSendError);
        attachmentUrl = null;
        attachmentPublicId = null;
      }
    }

    // contactsから名前取得
    const contactDoc = await db.collection('contacts').doc(senderId).get();
    const profile = contactDoc.exists ? contactDoc.data() : {};
    const senderName = profile.passportName || '不明';

    // 管理者からの送信を記録（受信メッセージとして残さず、対応済みとして記録）
    // hasAttachment/attachmentDeleted/attachmentPublicId/attachmentResourceType は
    // 60日後の自動削除ジョブ（helpers/cleanup.js）が参照するために保存する
    await db.collection('messages').add({
      senderId,
      senderName,
      senderPicture: null,
      message: '[管理者送信] ' + (message || '') + (attachmentName ? (attachmentSendFailed ? ' [添付失敗: ' + attachmentName + ']' : ' [添付: ' + attachmentName + ']') : ''),
      replyMessage: sendText,
      replyAdmin: req.session.adminDisplayName || '管理者',
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: '対応済み',
      isAdminSent: true,
      attachmentName: attachmentSendFailed ? null : attachmentName,
      attachmentUrl,
      attachmentPublicId,
      attachmentResourceType,
      hasAttachment: !attachmentSendFailed && !!attachmentPublicId,
      attachmentDeleted: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('個別送信成功:', senderId, senderName);

    // 連続して複数メッセージが届いていた場合、この送信でまとめて未対応を解消する
    try {
      const resolvedCount = await resolveAllUnread(db, senderId);
      if (resolvedCount > 0) console.log('未対応をまとめて解消:', senderId, resolvedCount + '件');
    } catch (e) {
      console.error('未対応一括解消エラー:', senderId, e.message);
    }

    if (attachmentSendFailed) {
      return res.json({ success: true, warning: '本文は届きましたが、添付ファイルの送信に失敗しました: ' + attachmentSendError });
    }
    res.json({ success: true });
  } catch (err) {
    const fbError = err.response && err.response.data && err.response.data.error;
    console.error('個別送信エラー:', senderId, fbError ? JSON.stringify(fbError) : err.message);
    res.json({ success: false, error: fbError ? fbError.message : err.message });
  }
});

// プロフィール保存API
router.post('/:senderId/profile', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { senderId } = req.params;
  const { passportName, workplace, residenceStatus, entryDate, searchTags, notes } = req.body;
  try {
    // 注意：senderName（FBアカウント名）は登録名で上書きしない。
    // 「FB名」と「登録名」は別物として管理するため、messagesドキュメントは更新しない。
    await db.collection('contacts').doc(senderId).set(
      { passportName, workplace, residenceStatus, entryDate, searchTags, notes, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
