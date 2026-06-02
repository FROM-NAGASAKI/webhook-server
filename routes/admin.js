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
        senderName: d.senderName || '不明', senderPicture: d.senderPicture || null,
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
    const date = d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const status = d.status || '未対応';
    const statusColor = status === '未対応' ? '#e74c3c' : '#27ae60';
    const name = d.senderName || '不明';
    const picture = d.senderPicture || null;
    const profile = profileMap[d.senderId] || {};
    const workplace = profile.workplace || '―';
    const residenceStatus = profile.residenceStatus || '―';
    const searchData = [name, d.message || '', profile.passportName || '', workplace, residenceStatus].join(' ').toLowerCase();
    let replyHtml = '―';
    if (d.replyMessage) replyHtml = d.replyMessage.replace(/\n/g, '<br>');
    if (d.attachmentName) {
      const icon = d.attachmentType === 'image' ? '🖼️' : '📄';
      replyHtml += '<br><span style="font-size:12px;color:#2980b9;">' + icon + ' ' + d.attachmentName + '</span>';
    }
    return `
      <tr class="msg-row" data-search="${searchData.replace(/"/g, '&quot;')}" data-docid="${doc.id}">
        <td>${date}</td>
        <td><a href="/admin/contacts/${d.senderId}" style="color:#2980b9;text-decoration:none;font-weight:bold;display:flex;align-items:center;">${avatarHtml(name, picture)}${name}</a></td>
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

  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <link rel="icon" href="https://www.facebook.com/favicon.ico">
  <title>問い合わせ管理画面</title>
  <style>${commonCss()}
    .search-bar{background:white;border-radius:8px;padding:16px 20px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1);display:flex;gap:12px;align-items:center;flex-wrap:wrap;}
    .search-bar input[type=text]{padding:9px 14px;border:1px solid #ccc;border-radius:6px;font-size:14px;width:280px;outline:none;}
    .search-bar select{padding:9px 14px;border:1px solid #ccc;border-radius:6px;font-size:14px;outline:none;}
    .search-bar button{padding:9px 16px;border:none;border-radius:6px;cursor:pointer;font-size:14px;}
    .btn-clear{background:#ecf0f1;color:#555;} .search-count{color:#666;font-size:14px;}
    table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);min-width:1100px;}
    th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;white-space:nowrap;}
    td{padding:12px 16px;border-bottom:1px solid #eee;vertical-align:middle;max-width:180px;word-break:break-all;}
    tr.msg-row:hover td{background:#f9f9f9;} .hidden{display:none !important;}
    @keyframes highlight{0%{background:#fff9c4;}100%{background:transparent;}}
    .new-message td{animation:highlight 3s ease-out;}
  </style></head><body>
  <header><h1>📋 問い合わせ管理画面</h1>${navHtml(req.session.adminDisplayName)}</header>
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
    let totalCount=${snapshot.size};
    let lastISO='${latestISO}';
    let isRefreshing=false;
    let countdown=60;
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
    async function checkNewMessages(){
      if(isRefreshing)return;
      isRefreshing=true;
      try{
        const res=await fetch('/admin/messages/new?after='+encodeURIComponent(lastISO));
        const data=await res.json();
        if(data.messages&&data.messages.length>0){
          const tbody=document.getElementById('msgTable');
          data.messages.forEach(msg=>{
            if(document.querySelector('[data-docid="'+msg.docId+'"]'))return;
            totalCount++;
            const statusColor=msg.status==='未対応'?'#e74c3c':'#27ae60';
            const avatar=msg.senderPicture
              ?'<img src="'+msg.senderPicture+'" style="width:32px;height:32px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px;border:2px solid #ddd;">'
              :'<span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#3498db;color:white;font-size:14px;font-weight:bold;vertical-align:middle;margin-right:8px;">'+(msg.senderName||'?').charAt(0).toUpperCase()+'</span>';
            const newRow=document.createElement('tr');
            newRow.className='msg-row new-message';
            newRow.setAttribute('data-search',[msg.senderName||'',msg.message||'',msg.workplace||'',msg.residenceStatus||''].join(' ').toLowerCase());
            newRow.setAttribute('data-docid',msg.docId);
            newRow.innerHTML=\`<td>\${msg.date}</td>
              <td><a href="/admin/contacts/\${msg.senderId}" style="color:#2980b9;text-decoration:none;font-weight:bold;display:flex;align-items:center;">\${avatar}\${msg.senderName||'不明'}</a></td>
              <td>\${msg.workplace||'―'}</td><td>\${msg.residenceStatus||'―'}</td>
              <td>\${msg.message||''}</td><td>―</td><td>―</td>
              <td style="color:\${statusColor};font-weight:bold;">\${msg.status}</td>
              <td><button onclick="openReply('\${msg.docId}')" style="background:#2980b9;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">返信</button></td>\`;
            const replyRow=document.createElement('tr');
            replyRow.id='reply-'+msg.docId;
            replyRow.style.cssText='display:none;background:#f0f7ff;';
            replyRow.innerHTML=\`<td colspan="9" style="padding:12px;">
              <textarea id="text-\${msg.docId}" rows="3" style="width:80%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;" placeholder="返信メッセージを入力（任意）..."></textarea>
              <div style="margin-top:8px;display:flex;align-items:center;gap:12px;">
                <label style="font-size:13px;color:#555;font-weight:bold;">📎 添付ファイル：</label>
                <input type="file" id="file-\${msg.docId}" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:13px;">
              </div>
              <small style="color:#888;margin-top:4px;display:block;">※ 送信時に署名が自動付加されます</small>
              <div style="margin-top:10px;">
                <button onclick="sendReply('\${msg.docId}','\${msg.senderId}')" style="background:#27ae60;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:8px;">送信</button>
                <button onclick="closeReply('\${msg.docId}')" style="background:#95a5a6;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">キャンセル</button>
                <span id="result-\${msg.docId}" style="margin-left:12px;font-weight:bold;"></span>
              </div></td>\`;
            tbody.insertBefore(replyRow,tbody.firstChild);
            tbody.insertBefore(newRow,tbody.firstChild);
            if(msg.createdAtISO>lastISO)lastISO=msg.createdAtISO;
          });
          document.getElementById('searchCount').textContent='全 '+totalCount+' 件';
          document.title='🔔 新着 '+data.messages.length+'件 | 問い合わせ管理画面';
          setTimeout(()=>{document.title='📋 問い合わせ管理画面';},5000);
        }
      }catch(e){console.error('自動更新エラー:',e);}
      isRefreshing=false;
    }
    setInterval(checkNewMessages,60000);
    const indicator=document.createElement('div');
    indicator.style.cssText='position:fixed;bottom:16px;right:16px;background:rgba(44,62,80,0.85);color:white;padding:8px 16px;border-radius:20px;font-size:12px;z-index:999;';
    indicator.textContent='🔄 次回更新: 60秒後';
    document.body.appendChild(indicator);
    setInterval(()=>{countdown--;if(countdown<=0)countdown=60;indicator.textContent='🔄 次回更新: '+countdown+'秒後';},1000);
  </script></body></html>`);
});

// 返信API
router.post('/reply', requireAuth, upload.single('file'), async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const docId = req.body.docId;
  const senderId = req.body.senderId;
  const message = req.body.message;
  const adminId = req.session.adminId;
  const adminDisplayName = req.session.adminDisplayName;
  const adminSignature = req.session.adminSignature;
  try {
    if (message && message.trim()) {
      let fullMessage = message;
      if (adminSignature) fullMessage = message + '\n\n' + adminSignature;
      await sendMessage(senderId, fullMessage);
      await db.collection('messages').doc(docId).update({
        status: '対応済み', repliedAt: admin.firestore.FieldValue.serverTimestamp(),
        replyMessage: fullMessage, replyAdmin: adminDisplayName || adminId
      });
    }
    if (req.file) {
      const attachmentType = getAttachmentType(req.file.mimetype);
      const formData1 = new FormData();
      formData1.append('recipient', JSON.stringify({ id: senderId }));
      formData1.append('message', JSON.stringify({ attachment: { type: attachmentType, payload: { is_reusable: false } } }));
      formData1.append('filedata', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });
      const axiosRes = await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, formData1, { headers: formData1.getHeaders() });
      if (axiosRes.data.message_id) {
        let attachmentUrl = null;
        if (attachmentType === 'image') {
          try {
            const urlRes = await fetch(`https://graph.facebook.com/v19.0/${axiosRes.data.message_id}/attachments?access_token=${PAGE_ACCESS_TOKEN}`);
            const urlData = await urlRes.json();
            if (urlData.data && urlData.data[0] && urlData.data[0].image_data) attachmentUrl = urlData.data[0].image_data.url;
          } catch (e) {}
        }
        const updateData = { status: '対応済み', repliedAt: admin.firestore.FieldValue.serverTimestamp(), replyAdmin: adminDisplayName || adminId, attachmentName: req.file.originalname, attachmentType };
        if (attachmentUrl) updateData.attachmentUrl = attachmentUrl;
        if (!message || !message.trim()) updateData.replyMessage = `[添付ファイル: ${req.file.originalname}]`;
        await db.collection('messages').doc(docId).update(updateData);
      } else {
        return res.json({ success: false, error: 'ファイル送信失敗: ' + JSON.stringify(axiosRes.data) });
      }
    }
    res.json({ success: true });
  } catch (err) {
    const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
    res.json({ success: false, error: errMsg });
  }
});

module.exports = router;