const express = require('express');
const router = express.Router();
const { requireAuth } = require('../helpers/auth');
const { sendMessage, getAttachmentType } = require('../helpers/facebook');
const { avatarHtml, attachmentHtml, messengerLinkHtml, navHtml, commonCss } = require('../helpers/html');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ユーザー一覧
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const snapshot = await db.collection('messages').orderBy('createdAt', 'desc').get();
  const users = {};
  snapshot.docs.forEach(doc => {
    const d = doc.data(); const sid = d.senderId;
    if (!users[sid]) users[sid] = { senderId: sid, senderName: d.senderName || '不明', senderPicture: d.senderPicture || null, count: 0, unread: 0, lastMessage: d.message || '', lastDate: d.createdAt };
    users[sid].count++;
    if (d.status === '未対応') users[sid].unread++;
  });
  const senderIds = Object.keys(users);
  const profileMap = {};
  await Promise.all(senderIds.map(async sid => {
    const doc = await db.collection('contacts').doc(sid).get();
    if (doc.exists) profileMap[sid] = doc.data();
  }));
  const rows = Object.values(users).map(u => {
    const lastDate = u.lastDate ? u.lastDate.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const unreadBadge = u.unread > 0 ? `<span style="background:#e74c3c;color:white;border-radius:12px;padding:2px 8px;font-size:12px;margin-left:6px;">${u.unread}</span>` : '';
    const profile = profileMap[u.senderId] || {};
    return `<tr onclick="location.href='/admin/contacts/${u.senderId}'" style="cursor:pointer;">
      <td><div style="display:flex;align-items:center;">${avatarHtml(u.senderName, u.senderPicture)}<strong>${u.senderName}</strong>${unreadBadge}</div></td>
      <td>${profile.workplace || '—'}</td><td>${profile.residenceStatus || '—'}</td>
      <td>${u.lastMessage}</td><td>${lastDate}</td><td>${u.count}</td>
    </tr>`;
  }).join('');
  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<link rel="icon" href="https://www.facebook.com/favicon.ico">
<title>ユーザー履歴</title>
<style>${commonCss()} table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;} td{padding:14px 16px;border-bottom:1px solid #eee;} tr:hover td{background:#f0f7ff;}</style>
</head><body><header><h1>👥 ユーザー履歴</h1>${navHtml(req.session.adminDisplayName)}</header>
<div class="container"><table><thead><tr><th>名前</th><th>所属事業所</th><th>在留資格</th><th>最新メッセージ</th><th>最終日時</th><th>件数</th></tr></thead>
<tbody>${rows}</tbody></table></div></body></html>`);
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
  const senderName = firstData.senderName || '不明';
  const senderPicture = firstData.senderPicture || null;
  const totalCount = msgSnapshot.size;
  const unreadCount = msgSnapshot.docs.filter(d => d.data().status === '未対応').length;
  const profile = contactDoc.exists ? contactDoc.data() : {};

  const messages = msgSnapshot.docs.map(doc => {
    const d = doc.data();
    const date = d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const status = d.status || '未対応';
    const statusColor = status === '未対応' ? '#e74c3c' : '#27ae60';
    let html = `<div style="display:flex;justify-content:flex-start;margin-bottom:16px;gap:8px;">
      ${avatarHtml(senderName, senderPicture)}
      <div style="max-width:60%;">
        <div style="font-size:12px;color:#888;margin-bottom:4px;">${senderName} · ${date}</div>
        <div style="background:white;border-radius:0 12px 12px 12px;padding:10px 12px;box-shadow:0 1px 4px rgba(0,0,0,0.1);">${d.message || ''}</div>
        <div style="font-size:12px;margin-top:4px;color:${statusColor};">${status}</div>
      </div>`;
    if (d.replyMessage || d.attachmentName) {
      const repliedAt = d.repliedAt ? d.repliedAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
      const replyText = d.replyMessage ? `<div style="white-space:pre-wrap;">` + d.replyMessage + `</div>` : '';
      html += `<div style="display:flex;justify-content:flex-end;margin-bottom:24px;"><div style="max-width:60%;">
        <div style="font-size:12px;color:#888;margin-bottom:4px;text-align:right;">${d.replyAdmin || '管理者'} · ${repliedAt}</div>
        <div style="background:#dcf8c6;border-radius:12px 0 12px 12px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,0.1);">
          ${replyText}${attachmentHtml(d)}
        </div>
      </div></div>`;
    }
    if (status === '未対応') {
      html += `<div style="display:flex;justify-content:flex-end;margin-bottom:24px;"><div style="max-width:70%;background:#f0f7ff;border-radius:8px;padding:12px;border:1px dashed #2980b9;">
        <textarea id="text-${doc.id}" rows="3" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;" placeholder="返信メッセージを入力（任意）..."></textarea>
        <div style="margin-top:8px;">
          <label style="font-size:13px;color:#555;font-weight:bold;">📎 添付ファイル：</label>
          <div style="margin-top:8px;"><input type="file" id="file-${doc.id}" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:13px;"></div>
          <small style="color:#888;display:block;margin-top:4px;">画像・PDF・Word・Excel（最大25MB）</small>
        </div>
        <div style="margin-top:8px;">
          <button onclick="sendReply('${doc.id}','${senderId}')" style="background:#27ae60;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:8px;">送信</button>
          <span id="result-${doc.id}" style="font-weight:bold;"></span>
        </div>
      </div></div>`;
    }
    html += `</div>`;
    return html;
  }).join('');

  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<link rel="icon" href="https://www.facebook.com/favicon.ico">
<title>${senderName} の履歴</title>
<style>${commonCss()}
.card{background:white;border-radius:8px;padding:20px 24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
.user-info{display:flex;gap:32px;align-items:center;flex-wrap:wrap;}
.user-info .label{font-size:12px;color:#888;} .user-info .value{font-size:15px;font-weight:bold;}
.profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:600px;}
label{display:block;margin-bottom:4px;font-size:13px;color:#555;font-weight:bold;}
input[type=text],input[type=date]{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:100%;box-sizing:border-box;}
button.save{background:#2980b9;color:white;border:none;padding:9px 20px;border-radius:4px;cursor:pointer;font-size:14px;margin-top:8px;}
</style></head><body>
<header><h1>💬 ${senderName} の履歴</h1>${navHtml(req.session.adminDisplayName)}</header>
<div class="container">
  <div class="card"><div class="user-info">
    <div>${avatarHtml(senderName, senderPicture, 48)}</div>
    <div><div class="label">名前</div><div class="value">${senderName}</div></div>
    <div><div class="label">送信者ID</div><div class="value" style="font-size:13px;">${senderId}</div></div>
    <div><div class="label">問い合わせ件数</div><div class="value">${totalCount} 件</div></div>
    <div><div class="label">未対応</div><div class="value" style="color:${unreadCount > 0 ? '#e74c3c' : '#27ae60'}">${unreadCount} 件</div></div>
    <div><a href="/admin/contacts" style="color:#2980b9;text-decoration:none;">← 一覧に戻る</a></div>
  </div></div>
  ${messengerLinkHtml(senderId)}
  <div class="card">
    <h3 style="margin-top:0;color:#2c3e50;">📝 プロフィール情報</h3>
    <div class="profile-grid">
      <div><label>パスポートネーム</label><input type="text" id="passportName" value="${profile.passportName || ''}" placeholder="例：MURAKAMI TARO"></div>
      <div><label>所属事業所</label><input type="text" id="workplace" value="${profile.workplace || ''}" placeholder="例：株式会社FROM長崎"></div>
      <div><label>在留資格</label><input type="text" id="residenceStatus" value="${profile.residenceStatus || ''}" placeholder="例：技能実習"></div>
      <div><label>入国日</label><input type="date" id="entryDate" value="${profile.entryDate || ''}"></div>
    </div>
    <button class="save" onclick="saveProfile()">💾 保存</button>
    <span id="profileMsg" style="margin-left:12px;font-size:14px;font-weight:bold;"></span>
  </div>
  <div class="card"><h3 style="margin-top:0;color:#2c3e50;">💬 会話履歴</h3>${messages}</div>
</div>
<script>
async function saveProfile(){
  const msg=document.getElementById('profileMsg');msg.textContent='保存中...';msg.style.color='gray';
  const data={passportName:document.getElementById('passportName').value.trim(),workplace:document.getElementById('workplace').value.trim(),residenceStatus:document.getElementById('residenceStatus').value.trim(),entryDate:document.getElementById('entryDate').value};
  try{
    const res=await fetch('/admin/contacts/${senderId}/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await res.json();
    if(result.success){msg.textContent='✅ 保存しました';msg.style.color='green';}
    else{msg.textContent='✗ 保存失敗: '+result.error;msg.style.color='red';}
  }catch(e){msg.textContent='✗ エラー: '+e.message;msg.style.color='red';}
}
async function sendReply(docId,senderId){
  const text=document.getElementById('text-'+docId).value;
  const fileInput=document.getElementById('file-'+docId);
  const result=document.getElementById('result-'+docId);
  if(!text.trim()&&(!fileInput.files||fileInput.files.length===0)){result.textContent='△ メッセージまたはファイルを入力してください';result.style.color='orange';return;}
  result.textContent='送信中...';result.style.color='gray';
  try{
    const formData=new FormData();
    formData.append('docId',docId);formData.append('senderId',senderId);formData.append('message',text);
    if(fileInput.files&&fileInput.files.length>0)formData.append('file',fileInput.files[0]);
    const res=await fetch('/admin/reply',{method:'POST',body:formData});
    const data=await res.json();
    if(data.success){result.textContent='✅ 送信完了！';result.style.color='green';setTimeout(()=>location.reload(),1500);}
    else{result.textContent='✗ 送信失敗: '+data.error;result.style.color='red';}
  }catch(e){result.textContent='✗ エラー: '+e.message;result.style.color='red';}
}
window.onload=()=>window.scrollTo(0,document.body.scrollHeight);
</script></body></html>`);
});

// プロフィール保存API
router.post('/:senderId/profile', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { senderId } = req.params;
  const { passportName, workplace, residenceStatus, entryDate } = req.body;
  try {
    await db.collection('contacts').doc(senderId).set(
      { passportName, workplace, residenceStatus, entryDate, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    // messagesコレクションのsenderNameも更新
    if (passportName) {
      const msgSnapshot = await db.collection('messages').where('senderId', '==', senderId).get();
      const batch = db.batch();
      msgSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, { senderName: passportName });
      });
      await batch.commit();
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;