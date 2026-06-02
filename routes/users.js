const express = require('express');
const router = express.Router();
const { requireAuth, hashPassword } = require('../helpers/auth');
const { navHtml, commonCss } = require('../helpers/html');

// 管理者一覧
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');
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
  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <link rel="icon" href="https://www.facebook.com/favicon.ico">
  <title>管理者管理</title>
  <style>${commonCss()} .card{background:white;border-radius:8px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.1);margin-bottom:24px;}
  table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
  th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;} td{padding:12px 16px;border-bottom:1px solid #eee;vertical-align:top;}
  input[type=text],input[type=password]{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:180px;}
  textarea{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:300px;}
  button.add{background:#27ae60;color:white;border:none;padding:9px 20px;border-radius:4px;cursor:pointer;font-size:14px;}
  .msg{margin-top:12px;font-weight:bold;} .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:700px;}
  label{display:block;margin-bottom:4px;font-size:13px;color:#555;font-weight:bold;}</style></head><body>
  <header><h1>👤 管理者管理</h1>${navHtml(req.session.adminDisplayName)}</header>
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
router.post('/add', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { userId, password, displayName, signature } = req.body;
  try {
    const existing = await db.collection('admins').where('userId', '==', userId).get();
    if (!existing.empty) return res.json({ success: false, error: 'このIDはすでに存在します' });
    await db.collection('admins').add({ userId, password: hashPassword(password), displayName: displayName || userId, signature: signature || '', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// 管理者削除API
router.post('/delete', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const { docId } = req.body;
  try {
    await db.collection('admins').doc(docId).delete();
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

module.exports = router;