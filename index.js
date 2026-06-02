const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const app = express();
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const VERIFY_TOKEN = 'union_support_verify_2024';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function basicAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('認証が必要です');
  }
  const base64 = authHeader.slice(6);
  const decoded = Buffer.from(base64, 'base64').toString('utf-8');
  const [id, pass] = decoded.split(':');

  const snapshot = await db.collection('admins').where('userId', '==', id).get();
  if (!snapshot.empty) {
    const adminData = snapshot.docs[0].data();
    if (adminData.password === hashPassword(pass)) {
      req.adminId = id;
      req.adminDisplayName = adminData.displayName || id;
      req.adminSignature = adminData.signature || '';
      return next();
    }
  }

  const allAdmins = await db.collection('admins').get();
  if (allAdmins.empty && id === 'from-nagasaki-admin' && pass === 'fngs-4301') {
    req.adminId = id; req.adminDisplayName = id; req.adminSignature = '';
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('IDまたはパスワードが違います');
}

async function getSenderName(senderId) {
  try {
    const url = `https://graph.facebook.com/v19.0/${senderId}?fields=name&access_token=${PAGE_ACCESS_TOKEN}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.name || '不明';
  } catch (err) { return '不明'; }
}

function getAttachmentType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } })
    });
    const data = await response.json();
    console.log('テキスト返信成功:', JSON.stringify(data));
  } catch (err) { console.error('テキスト返信失敗:', err); }
}

// 添付ファイル表示HTML生成
function attachmentHtml(d) {
  if (!d.attachmentName) return '';
  if (d.attachmentType === 'image' && d.attachmentUrl) {
    const safeUrl = d.attachmentUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<div style="margin-top:8px;">
      <img src="${safeUrl}" alt="${d.attachmentName}"
        style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid #ddd;cursor:pointer;"
        onclick="window.open(this.src,'_blank')"
        onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <div style="display:none;background:#f0f0f0;padding:8px;border-radius:4px;font-size:13px;">
        🖼️ ${d.attachmentName}
      </div>
    </div>`;
  }
  const icon = d.attachmentType === 'image' ? '🖼️' : d.attachmentType === 'video' ? '🎥' : d.attachmentType === 'audio' ? '🎵' : '📄';
  return `<div style="margin-top:8px;background:#f0f0f0;padding:8px 12px;border-radius:4px;font-size:13px;">
    ${icon} ${d.attachmentName}
  </div>`;
}
  const icon = d.attachmentType === 'image' ? '🖼️' : d.attachmentType === 'video' ? '🎥' : d.attachmentType === 'audio' ? '🎵' : '📄';
  return `<div style="margin-top:8px;background:#f0f0f0;padding:8px 12px;border-radius:4px;font-size:13px;">
    ${icon} ${d.attachmentName}
  </div>`;
}

function navHtml() {
  return `<nav>
    <a href="/admin">📋 問い合わせ</a>
    <a href="/admin/contacts">👥 ユーザー履歴</a>
    <a href="/admin/users">👤 管理者</a>
  </nav>`;
}

function commonCss() {
  return `
    body { font-family: sans-serif; margin: 0; background: #f5f5f5; }
    header { background: #2c3e50; color: white; padding: 16px 24px; display:flex; justify-content:space-between; align-items:center; }
    header h1 { margin: 0; font-size: 20px; }
    nav a { color:white; text-decoration:none; margin-left:12px; padding:8px 14px; border-radius:4px; background:rgba(255,255,255,0.15); font-size:14px; }
    nav a:hover { background:rgba(255,255,255,0.25); }
    .container { padding: 24px; }`;
}

// 問い合わせ一覧
app.get('/admin', basicAuth, async (req, res) => {
  const snapshot = await db.collection('messages').orderBy('createdAt', 'desc').limit(100).get();
  const senderIds = [...new Set(snapshot.docs.map(d => d.data().senderId).filter(Boolean))];
  const profileMap = {};
  await Promise.all(senderIds.map(async sid => {
    const doc = await db.collection('contacts').doc(sid).get();
    if (doc.exists) profileMap[sid] = doc.data();
  }));

  const rows = snapshot.docs.map(doc => {
    const d = doc.data();
    const date = d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const status = d.status || '未対応';
    const statusColor = status === '未対応' ? '#e74c3c' : '#27ae60';
    const name = d.senderName || '不明';
    const profile = profileMap[d.senderId] || {};
    const workplace = profile.workplace || '―';
    const residenceStatus = profile.residenceStatus || '―';
    const searchData = [name, d.message || '', profile.passportName || '', workplace, residenceStatus].join(' ').toLowerCase();

    let replyHtml = '―';
    if (d.replyMessage) replyHtml = d.replyMessage.replace(/\n/g, '<br>');
    if (d.attachmentName) {
      const icon = d.attachmentType === 'image' ? '🖼️' : '📄';
      replyHtml += `<br><span style="font-size:12px;color:#2980b9;">${icon} ${d.attachmentName}</span>`;
    }

    return `
      <tr class="msg-row" data-search="${searchData.replace(/"/g, '&quot;')}">
        <td>${date}</td>
        <td><a href="/admin/contacts/${d.senderId}" style="color:#2980b9;text-decoration:none;font-weight:bold;">${name}</a></td>
        <td>${workplace}</td><td>${residenceStatus}</td>
        <td>${d.message || ''}</td>
        <td>${replyHtml}</td>
        <td>${d.replyAdmin || '―'}</td>
        <td style="color:${statusColor};font-weight:bold;">${status}</td>
        <td><button onclick="openReply('${doc.id}')" style="background:#2980b9;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">返信</button></td>
      </tr>
      <tr id="reply-${doc.id}" style="display:none;background:#f0f7ff;">
        <td colspan="9" style="padding:12px;">
          <textarea id="text-${doc.id}" rows="3" style="width:80%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;" placeholder="返信メッセージを入力（任意）..."></textarea>
          <br>
          <div style="margin-top:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <label style="font-size:13px;color:#555;font-weight:bold;">📎 添付ファイル：</label>
            <input type="file" id="file-${doc.id}" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:13px;">
            <small style="color:#888;">画像・PDF・Word・Excel（最大25MB）</small>
          </div>
          <small style="color:#888;margin-top:4px;display:block;">※ 送信時に署名が自動付加されます</small>
          <div style="margin-top:10px;">
            <button onclick="sendReply('${doc.id}','${d.senderId}')" style="background:#27ae60;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:8px;">送信</button>
            <button onclick="closeReply('${doc.id}')" style="background:#95a5a6;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">キャンセル</button>
            <span id="result-${doc.id}" style="margin-left:12px;font-weight:bold;"></span>
          </div>
        </td>
      </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>問い合わせ管理画面</title>
  <style>${commonCss()}
    .search-bar{background:white;border-radius:8px;padding:16px 20px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1);display:flex;gap:12px;align-items:center;flex-wrap:wrap;}
    .search-bar input[type=text]{padding:9px 14px;border:1px solid #ccc;border-radius:6px;font-size:14px;width:280px;outline:none;}
    .search-bar select{padding:9px 14px;border:1px solid #ccc;border-radius:6px;font-size:14px;outline:none;}
    .search-bar button{padding:9px 16px;border:none;border-radius:6px;cursor:pointer;font-size:14px;}
    .btn-clear{background:#ecf0f1;color:#555;} .search-count{color:#666;font-size:14px;}
    table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);min-width:1100px;}
    th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;white-space:nowrap;}
    td{padding:12px 16px;border-bottom:1px solid #eee;vertical-align:top;max-width:180px;word-break:break-all;}
    tr.msg-row:hover td{background:#f9f9f9;} .hidden{display:none !important;}
  </style></head><body>
  <header><h1>📋 問い合わせ管理画面</h1>${navHtml()}</header>
  <div class="container" style="overflow-x:auto;">
    <div class="search-bar">
      <input type="text" id="searchInput" placeholder="🔍 名前・メッセージ・事業所・在留資格で検索..." oninput="filterRows()">
      <select id="statusFilter" onchange="filterRows()">
        <option value="">すべてのステータス</option>
        <option value="未対応">未対応</option>
        <option value="対応済み">対応済み</option>
      </select>
      <button class="btn-clear" onclick="clearSearch()">✕ クリア</button>
      <span class="search-count" id="searchCount">全 ${snapshot.size} 件</span>
    </div>
    <table><thead><tr>
      <th>受信日時</th><th>名前</th><th>所属事業所</th><th>在留資格</th>
      <th>メッセージ</th><th>返信メッセージ</th><th>返信した管理者</th><th>ステータス</th><th>操作</th>
    </tr></thead><tbody id="msgTable">${rows}</tbody></table>
  </div>
  <script>
    const totalCount=${snapshot.size};
    function filterRows(){
      const keyword=document.getElementById('searchInput').value.toLowerCase().trim();
      const status=document.getElementById('statusFilter').value;
      const rows=document.querySelectorAll('tr.msg-row');
      let visible=0;
      rows.forEach(row=>{
        const searchData=row.getAttribute('data-search')||'';
        const statusCell=row.querySelector('td:nth-child(8)');
        const rowStatus=statusCell?statusCell.textContent.trim():'';
        const show=(!keyword||searchData.includes(keyword))&&(!status||rowStatus===status);
        row.classList.toggle('hidden',!show);
        const replyRow=row.nextElementSibling;
        if(replyRow&&replyRow.id&&replyRow.id.startsWith('reply-'))replyRow.classList.toggle('hidden',!show);
        if(show)visible++;
      });
      document.getElementById('searchCount').textContent=keyword||status?\`\${visible} 件 / 全 \${totalCount} 件\`:\`全 \${totalCount} 件\`;
    }
    function clearSearch(){document.getElementById('searchInput').value='';document.getElementById('statusFilter').value='';filterRows();}
    function openReply(id){const r=document.getElementById('reply-'+id);r.style.display=r.style.display==='none'?'table-row':'none';}
    function closeReply(id){document.getElementById('reply-'+id).style.display='none';}
    async function sendReply(docId,senderId){
      const text=document.getElementById('text-'+docId).value;
      const fileInput=document.getElementById('file-'+docId);
      const result=document.getElementById('result-'+docId);
      if(!text.trim()&&(!fileInput.files||fileInput.files.length===0)){result.textContent='⚠️ メッセージまたはファイルを入力してください';result.style.color='orange';return;}
      result.textContent='送信中...';result.style.color='gray';
      try{
        const formData=new FormData();
        formData.append('docId',docId);formData.append('senderId',senderId);formData.append('message',text);
        if(fileInput.files&&fileInput.files.length>0)formData.append('file',fileInput.files[0]);
        const res=await fetch('/admin/reply',{method:'POST',body:formData});
        const data=await res.json();
        if(data.success){result.textContent='✅ 送信完了！';result.style.color='green';setTimeout(()=>location.reload(),1500);}
        else{result.textContent='❌ 送信失敗: '+data.error;result.style.color='red';}
      }catch(e){result.textContent='❌ エラー: '+e.message;result.style.color='red';}
    }
  </script></body></html>`);
});

// ユーザー一覧
app.get('/admin/contacts', basicAuth, async (req, res) => {
  const snapshot = await db.collection('messages').orderBy('createdAt', 'desc').get();
  const users = {};
  snapshot.docs.forEach(doc => {
    const d = doc.data(); const sid = d.senderId;
    if (!users[sid]) users[sid] = { senderId: sid, senderName: d.senderName || '不明', count: 0, unread: 0, lastMessage: d.message || '', lastDate: d.createdAt };
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
      <td><strong>${u.senderName}</strong>${unreadBadge}</td>
      <td>${profile.workplace || '―'}</td><td>${profile.residenceStatus || '―'}</td>
      <td>${u.lastMessage}</td><td>${lastDate}</td><td>${u.count}</td>
    </tr>`;
  }).join('');
  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>ユーザー履歴</title>
  <style>${commonCss()} table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
  th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;} td{padding:14px 16px;border-bottom:1px solid #eee;} tr:hover td{background:#f0f7ff;}</style>
  </head><body><header><h1>👥 ユーザー履歴</h1>${navHtml()}</header>
  <div class="container"><table><thead><tr><th>名前</th><th>所属事業所</th><th>在留資格</th><th>最新メッセージ</th><th>最終日時</th><th>件数</th></tr></thead>
  <tbody>${rows}</tbody></table></div></body></html>`);
});

// ユーザー詳細
app.get('/admin/contacts/:senderId', basicAuth, async (req, res) => {
  const senderId = req.params.senderId;
  const [msgSnapshot, contactDoc] = await Promise.all([
    db.collection('messages').where('senderId', '==', senderId).orderBy('createdAt', 'asc').get(),
    db.collection('contacts').doc(senderId).get()
  ]);
  if (msgSnapshot.empty) return res.status(404).send('ユーザーが見つかりません');
  const senderName = msgSnapshot.docs[0].data().senderName || '不明';
  const totalCount = msgSnapshot.size;
  const unreadCount = msgSnapshot.docs.filter(d => d.data().status === '未対応').length;
  const profile = contactDoc.exists ? contactDoc.data() : {};

  const messages = msgSnapshot.docs.map(doc => {
    const d = doc.data();
    const date = d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const status = d.status || '未対応';
    const statusColor = status === '未対応' ? '#e74c3c' : '#27ae60';

    let html = `<div style="display:flex;justify-content:flex-start;margin-bottom:16px;"><div style="max-width:60%;">
      <div style="font-size:12px;color:#888;margin-bottom:4px;">${senderName} · ${date}</div>
      <div style="background:white;border-radius:0 12px 12px 12px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,0.1);">${d.message || ''}</div>
      <div style="font-size:12px;margin-top:4px;color:${statusColor};">${status}</div>
    </div></div>`;

    if (d.replyMessage || d.attachmentName) {
      const repliedAt = d.repliedAt ? d.repliedAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
      const replyText = d.replyMessage ? `<div style="white-space:pre-wrap;">${d.replyMessage}</div>` : '';
      const attachHtml = attachmentHtml(d);
      html += `<div style="display:flex;justify-content:flex-end;margin-bottom:24px;"><div style="max-width:60%;">
        <div style="font-size:12px;color:#888;margin-bottom:4px;text-align:right;">${d.replyAdmin || '管理者'} · ${repliedAt}</div>
        <div style="background:#dcf8c6;border-radius:12px 0 12px 12px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,0.1);">
          ${replyText}${attachHtml}
        </div>
      </div></div>`;
    }

    if (status === '未対応') {
      html += `<div style="display:flex;justify-content:flex-end;margin-bottom:24px;"><div style="max-width:70%;background:#f0f7ff;border-radius:8px;padding:12px;border:1px dashed #2980b9;">
        <textarea id="text-${doc.id}" rows="3" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;" placeholder="返信メッセージを入力（任意）..."></textarea>
        <div style="margin-top:8px;">
          <label style="font-size:13px;color:#555;font-weight:bold;">📎 添付ファイル：</label>
          <input type="file" id="file-${doc.id}" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:13px;">
          <small style="color:#888;display:block;margin-top:4px;">画像・PDF・Word・Excel（最大25MB）</small>
        </div>
        <div style="margin-top:8px;">
          <button onclick="sendReply('${doc.id}','${senderId}')" style="background:#27ae60;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:8px;">送信</button>
          <span id="result-${doc.id}" style="font-weight:bold;"></span>
        </div>
      </div></div>`;
    }
    return html;
  }).join('');

  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>${senderName} の履歴</title>
  <style>${commonCss()}
    .card{background:white;border-radius:8px;padding:20px 24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
    .user-info{display:flex;gap:32px;align-items:center;flex-wrap:wrap;}
    .user-info .label{font-size:12px;color:#888;} .user-info .value{font-size:15px;font-weight:bold;}
    .profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:600px;}
    label{display:block;margin-bottom:4px;font-size:13px;color:#555;font-weight:bold;}
    input[type=text],input[type=date]{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:100%;box-sizing:border-box;}
    button.save{background:#2980b9;color:white;border:none;padding:9px 20px;border-radius:4px;cursor:pointer;font-size:14px;margin-top:8px;}
  </style></head><body>
  <header><h1>💬 ${senderName} の履歴</h1>${navHtml()}</header>
  <div class="container">
    <div class="card"><div class="user-info">
      <div><div class="label">名前</div><div class="value">${senderName}</div></div>
      <div><div class="label">送信者ID</div><div class="value" style="font-size:13px;">${senderId}</div></div>
      <div><div class="label">問い合わせ件数</div><div class="value">${totalCount} 件</div></div>
      <div><div class="label">未対応</div><div class="value" style="color:${unreadCount > 0 ? '#e74c3c' : '#27ae60'}">${unreadCount} 件</div></div>
      <div><a href="/admin/contacts" style="color:#2980b9;text-decoration:none;">← 一覧に戻る</a></div>
    </div></div>
    <div class="card">
      <h3 style="margin-top:0;color:#2c3e50;">📝 プロフィール情報</h3>
      <div class="profile-grid">
        <div><label>パスポートネーム</label><input type="text" id="passportName" value="${profile.passportName || ''}" placeholder="例：MURAKAMI TARO"></div>
        <div><label>所属事業所</label><input type="text" id="workplace" value="${profile.workplace || ''}" placeholder="例：株式会社FROM長崎"></div>
        <div><label>在留資格</label><input type="text" id="residenceStatus" value="${profile.residenceStatus || ''}" placeholder="例：技能実習"></div>
        <div><label>入国日</label><input type="date" id="entryDate" value="${profile.entryDate || ''}"></div>
      </div>
      <button class="save" onclick="saveProfile()">💾 保存</button>
      <span id="profileMsg" style="margin-left:12px;font-weight:bold;"></span>
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
        else{msg.textContent='❌ 保存失敗: '+result.error;msg.style.color='red';}
      }catch(e){msg.textContent='❌ エラー: '+e.message;msg.style.color='red';}
    }
    async function sendReply(docId,senderId){
      const text=document.getElementById('text-'+docId).value;
      const fileInput=document.getElementById('file-'+docId);
      const result=document.getElementById('result-'+docId);
      if(!text.trim()&&(!fileInput.files||fileInput.files.length===0)){result.textContent='⚠️ メッセージまたはファイルを入力してください';result.style.color='orange';return;}
      result.textContent='送信中...';result.style.color='gray';
      try{
        const formData=new FormData();
        formData.append('docId',docId);formData.append('senderId',senderId);formData.append('message',text);
        if(fileInput.files&&fileInput.files.length>0)formData.append('file',fileInput.files[0]);
        const res=await fetch('/admin/reply',{method:'POST',body:formData});
        const data=await res.json();
        if(data.success){result.textContent='✅ 送信完了！';result.style.color='green';setTimeout(()=>location.reload(),1500);}
        else{result.textContent='❌ 送信失敗: '+data.error;result.style.color='red';}
      }catch(e){result.textContent='❌ エラー: '+e.message;result.style.color='red';}
    }
    window.onload=()=>window.scrollTo(0,document.body.scrollHeight);
  </script></body></html>`);
});

// プロフィール保存API
app.post('/admin/contacts/:senderId/profile', basicAuth, async (req, res) => {
  const { senderId } = req.params;
  const { passportName, workplace, residenceStatus, entryDate } = req.body;
  try {
    await db.collection('contacts').doc(senderId).set({ passportName, workplace, residenceStatus, entryDate, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// 返信API
app.post('/admin/reply', basicAuth, upload.single('file'), async (req, res) => {
  const docId = req.body.docId;
  const senderId = req.body.senderId;
  const message = req.body.message;
  console.log('受信データ:', { docId, senderId, message, file: req.file?.originalname });

  try {
    // テキスト返信
    if (message && message.trim()) {
      let fullMessage = message;
      if (req.adminSignature) fullMessage = message + '\n\n' + req.adminSignature;
      await sendMessage(senderId, fullMessage);
      await db.collection('messages').doc(docId).update({
        status: '対応済み',
        repliedAt: admin.firestore.FieldValue.serverTimestamp(),
        replyMessage: fullMessage,
        replyAdmin: req.adminDisplayName || req.adminId
      });
    }

    // ファイル送信
    if (req.file) {
      const attachmentType = getAttachmentType(req.file.mimetype);
      console.log('ファイル送信中:', req.file.originalname, attachmentType, senderId);

      const formData1 = new FormData();
      formData1.append('recipient', JSON.stringify({ id: senderId }));
      formData1.append('message', JSON.stringify({
        attachment: { type: attachmentType, payload: { is_reusable: false } }
      }));
      formData1.append('filedata', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype
      });

      const axiosRes = await axios.post(
        `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
        formData1,
        { headers: formData1.getHeaders() }
      );
      console.log('ファイル送信結果:', JSON.stringify(axiosRes.data));

      if (axiosRes.data.message_id) {
        // 画像URLをGraph APIから取得
        let attachmentUrl = null;
        if (attachmentType === 'image') {
          try {
            const msgId = axiosRes.data.message_id;
            const urlRes = await fetch(
              `https://graph.facebook.com/v19.0/${msgId}/attachments?access_token=${PAGE_ACCESS_TOKEN}`
            );
            const urlData = await urlRes.json();
            console.log('画像URL取得:', JSON.stringify(urlData));
            if (urlData.data && urlData.data[0] && urlData.data[0].image_data) {
              attachmentUrl = urlData.data[0].image_data.url;
            }
          } catch (urlErr) {
            console.error('URL取得失敗:', urlErr);
          }
        }

        const updateData = {
          status: '対応済み',
          repliedAt: admin.firestore.FieldValue.serverTimestamp(),
          replyAdmin: req.adminDisplayName || req.adminId,
          attachmentName: req.file.originalname,
          attachmentType: attachmentType
        };
        if (attachmentUrl) updateData.attachmentUrl = attachmentUrl;
        if (!message || !message.trim()) {
          updateData.replyMessage = `[添付ファイル: ${req.file.originalname}]`;
        }
        await db.collection('messages').doc(docId).update(updateData);
      } else {
        console.error('ファイル送信エラー:', axiosRes.data);
        return res.json({ success: false, error: 'ファイル送信失敗: ' + JSON.stringify(axiosRes.data) });
      }
    }

    res.json({ success: true });
  } catch (err) {
    const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error('返信エラー:', errMsg);
    res.json({ success: false, error: errMsg });
  }
});

// 管理者一覧
app.get('/admin/users', basicAuth, async (req, res) => {
  const snapshot = await db.collection('admins').orderBy('createdAt', 'desc').get();
  const rows = snapshot.docs.map(doc => {
    const d = doc.data();
    return `<tr>
      <td>${d.userId}</td><td>${d.displayName || '―'}</td>
      <td style="white-space:pre-wrap;">${d.signature || '―'}</td>
      <td>${d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明'}</td>
      <td><button onclick="deleteUser('${doc.id}','${d.userId}')" style="background:#e74c3c;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">削除</button></td>
    </tr>`;
  }).join('');
  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>管理者管理</title>
  <style>${commonCss()} .card{background:white;border-radius:8px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.1);margin-bottom:24px;}
  table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
  th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;} td{padding:12px 16px;border-bottom:1px solid #eee;vertical-align:top;}
  input[type=text],input[type=password]{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:180px;}
  textarea{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:300px;}
  button.add{background:#27ae60;color:white;border:none;padding:9px 20px;border-radius:4px;cursor:pointer;font-size:14px;}
  .msg{margin-top:12px;font-weight:bold;} .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:700px;}
  label{display:block;margin-bottom:4px;font-size:13px;color:#555;font-weight:bold;}</style></head><body>
  <header><h1>👤 管理者管理</h1>${navHtml()}</header>
  <div class="container">
    <div class="card"><h2 style="margin-top:0;">管理者を追加</h2>
      <div class="form-grid">
        <div><label>ユーザーID *</label><input type="text" id="newId" placeholder="例：yamada"></div>
        <div><label>パスワード *</label><input type="password" id="newPass" placeholder="パスワード"></div>
        <div><label>表示名</label><input type="text" id="newDisplayName" placeholder="例：村上 太郎"></div>
        <div><label>署名</label><textarea id="newSignature" rows="3" placeholder="例：担当：村上&#10;From長崎サポート&#10;TEL: 095-XXX-XXXX"></textarea></div>
      </div>
      <br><button class="add" onclick="addUser()">追加</button>
      <p class="msg" id="addMsg"></p>
    </div>
    <table><thead><tr><th>ユーザーID</th><th>表示名</th><th>署名</th><th>登録日時</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>
  <script>
    async function addUser(){
      const userId=document.getElementById('newId').value.trim(),password=document.getElementById('newPass').value.trim(),displayName=document.getElementById('newDisplayName').value.trim(),signature=document.getElementById('newSignature').value.trim(),msg=document.getElementById('addMsg');
      if(!userId||!password){msg.textContent='⚠️ IDとパスワードを入力してください';msg.style.color='orange';return;}
      msg.textContent='追加中...';msg.style.color='gray';
      const res=await fetch('/admin/users/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,password,displayName,signature})});
      const data=await res.json();
      if(data.success){msg.textContent='✅ 追加しました';msg.style.color='green';setTimeout(()=>location.reload(),1000);}
      else{msg.textContent='❌ '+data.error;msg.style.color='red';}
    }
    async function deleteUser(docId,userId){
      if(!confirm(userId+' を削除しますか？'))return;
      const res=await fetch('/admin/users/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({docId})});
      const data=await res.json();
      if(data.success)location.reload();
      else alert('削除失敗: '+data.error);
    }
  </script></body></html>`);
});

// 管理者追加API
app.post('/admin/users/add', basicAuth, async (req, res) => {
  const { userId, password, displayName, signature } = req.body;
  try {
    const existing = await db.collection('admins').where('userId', '==', userId).get();
    if (!existing.empty) return res.json({ success: false, error: 'このIDはすでに存在します' });
    await db.collection('admins').add({ userId, password: hashPassword(password), displayName: displayName || userId, signature: signature || '', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// 管理者削除API
app.post('/admin/users/delete', basicAuth, async (req, res) => {
  const { docId } = req.body;
  try {
    await db.collection('admins').doc(docId).delete();
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// Webhook認証
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) res.status(200).send(challenge);
  else res.sendStatus(403);
});

// メッセージ受信
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      const event = entry.messaging[0];
      if (event && event.message && !event.message.is_echo) {
        const senderId = event.sender.id;
        const messageText = event.message.text;
        const senderName = await getSenderName(senderId);
        await db.collection('messages').add({ senderId, senderName, message: messageText, status: '未対応', createdAt: admin.firestore.FieldValue.serverTimestamp() });
        await sendMessage(senderId, 'お問い合わせありがとうございます。担当者より折り返しご連絡いたします。');
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else res.sendStatus(404);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('サーバー起動中 ポート:', PORT));