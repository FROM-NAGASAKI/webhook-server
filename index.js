const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const app = express();
app.use(express.json());

// Firebase初期化
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const VERIFY_TOKEN = 'union_support_verify_2024';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// パスワードハッシュ化
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Basic認証ミドルウェア
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
      return next();
    }
  }

  const allAdmins = await db.collection('admins').get();
  if (allAdmins.empty && id === 'from-nagasaki-admin' && pass === 'fngs-4301') {
    req.adminId = id;
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('IDまたはパスワードが違います');
}

// 送信者の名前を取得
async function getSenderName(senderId) {
  try {
    const url = `https://graph.facebook.com/v19.0/${senderId}?fields=name&access_token=${PAGE_ACCESS_TOKEN}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.name || '不明';
  } catch (err) {
    return '不明';
  }
}

// 管理画面（問い合わせ一覧）
app.get('/admin', basicAuth, async (req, res) => {
  const snapshot = await db.collection('messages')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const rows = snapshot.docs.map(doc => {
    const d = doc.data();
    const date = d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const repliedAt = d.repliedAt ? d.repliedAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
    const status = d.status || '未対応';
    const statusColor = status === '未対応' ? '#e74c3c' : '#27ae60';
    const name = d.senderName || '不明';
    const replyMessage = d.replyMessage || '―';
    const replyAdmin = d.replyAdmin || '―';

    return `
      <tr>
        <td>${date}</td>
        <td>${name}</td>
        <td>${d.senderId || ''}</td>
        <td>${d.message || ''}</td>
        <td>${replyMessage}</td>
        <td>${replyAdmin}</td>
        <td style="color:${statusColor};font-weight:bold;">${status}</td>
        <td>
          <button onclick="openReply('${doc.id}')"
            style="background:#2980b9;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">
            返信
          </button>
        </td>
      </tr>
      <tr id="reply-${doc.id}" style="display:none;background:#f0f7ff;">
        <td colspan="8" style="padding:12px;">
          <textarea id="text-${doc.id}" rows="3"
            style="width:80%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;"
            placeholder="返信メッセージを入力..."></textarea>
          <br><br>
          <button onclick="sendReply('${doc.id}', '${d.senderId}')"
            style="background:#27ae60;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:8px;">
            送信
          </button>
          <button onclick="closeReply('${doc.id}')"
            style="background:#95a5a6;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">
            キャンセル
          </button>
          <span id="result-${doc.id}" style="margin-left:12px;font-weight:bold;"></span>
        </td>
      </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>問い合わせ管理画面</title>
  <style>
    body { font-family: sans-serif; margin: 0; background: #f5f5f5; }
    header { background: #2c3e50; color: white; padding: 16px 24px; display:flex; justify-content:space-between; align-items:center; }
    header h1 { margin: 0; font-size: 20px; }
    nav a { color:white; text-decoration:none; margin-left:12px; padding:8px 14px; border-radius:4px; background:rgba(255,255,255,0.15); font-size:14px; }
    nav a:hover { background:rgba(255,255,255,0.25); }
    .container { padding: 24px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); min-width: 900px; }
    th { background: #2c3e50; color: white; padding: 12px 16px; text-align: left; white-space: nowrap; }
    td { padding: 12px 16px; border-bottom: 1px solid #eee; vertical-align: top; max-width: 200px; word-break: break-all; }
    tr:hover td { background: #f9f9f9; }
    .count { margin-bottom: 16px; color: #666; }
  </style>
</head>
<body>
  <header>
    <h1>📋 問い合わせ管理画面</h1>
    <nav>
      <a href="/admin">📋 問い合わせ</a>
      <a href="/admin/users">👤 管理者</a>
      <a href="#" onclick="location.reload()">🔄 更新</a>
    </nav>
  </header>
  <div class="container">
    <p class="count">件数：${snapshot.size} 件</p>
    <table>
      <thead>
        <tr>
          <th>受信日時</th>
          <th>名前</th>
          <th>送信者ID</th>
          <th>メッセージ</th>
          <th>返信メッセージ</th>
          <th>返信した管理者</th>
          <th>ステータス</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <script>
    function openReply(id) {
      const row = document.getElementById('reply-' + id);
      row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
    }
    function closeReply(id) {
      document.getElementById('reply-' + id).style.display = 'none';
    }
    async function sendReply(docId, senderId) {
      const text = document.getElementById('text-' + docId).value;
      const result = document.getElementById('result-' + docId);
      if (!text.trim()) { result.textContent = '⚠️ メッセージを入力してください'; result.style.color='orange'; return; }
      result.textContent = '送信中...'; result.style.color='gray';
      try {
        const res = await fetch('/admin/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId, senderId, message: text })
        });
        const data = await res.json();
        if (data.success) {
          result.textContent = '✅ 送信完了！'; result.style.color='green';
          setTimeout(() => location.reload(), 1500);
        } else {
          result.textContent = '❌ 送信失敗: ' + data.error; result.style.color='red';
        }
      } catch(e) {
        result.textContent = '❌ エラー: ' + e.message; result.style.color='red';
      }
    }
  </script>
</body>
</html>`);
});

// 管理者一覧ページ
app.get('/admin/users', basicAuth, async (req, res) => {
  const snapshot = await db.collection('admins').orderBy('createdAt', 'desc').get();
  const rows = snapshot.docs.map(doc => {
    const d = doc.data();
    return `
      <tr>
        <td>${d.userId}</td>
        <td>${d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明'}</td>
        <td>
          <button onclick="deleteUser('${doc.id}', '${d.userId}')"
            style="background:#e74c3c;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">
            削除
          </button>
        </td>
      </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理者管理</title>
  <style>
    body { font-family: sans-serif; margin: 0; background: #f5f5f5; }
    header { background: #2c3e50; color: white; padding: 16px 24px; display:flex; justify-content:space-between; align-items:center; }
    header h1 { margin: 0; font-size: 20px; }
    nav a { color:white; text-decoration:none; margin-left:12px; padding:8px 14px; border-radius:4px; background:rgba(255,255,255,0.15); font-size:14px; }
    nav a:hover { background:rgba(255,255,255,0.25); }
    .container { padding: 24px; }
    .card { background:white; border-radius:8px; padding:24px; box-shadow:0 2px 8px rgba(0,0,0,0.1); margin-bottom:24px; }
    table { width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.1); }
    th { background:#2c3e50; color:white; padding:12px 16px; text-align:left; }
    td { padding:12px 16px; border-bottom:1px solid #eee; }
    input { padding:8px 12px; border:1px solid #ccc; border-radius:4px; font-size:14px; width:200px; }
    button.add { background:#27ae60;color:white;border:none;padding:9px 20px;border-radius:4px;cursor:pointer;font-size:14px; }
    .msg { margin-top:12px; font-weight:bold; }
  </style>
</head>
<body>
  <header>
    <h1>👤 管理者管理</h1>
    <nav>
      <a href="/admin">📋 問い合わせ</a>
      <a href="/admin/users">👤 管理者</a>
    </nav>
  </header>
  <div class="container">
    <div class="card">
      <h2 style="margin-top:0;">管理者を追加</h2>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="newId" placeholder="ユーザーID">
        <input type="password" id="newPass" placeholder="パスワード">
        <button class="add" onclick="addUser()">追加</button>
      </div>
      <p class="msg" id="addMsg"></p>
    </div>
    <table>
      <thead>
        <tr>
          <th>ユーザーID</th>
          <th>登録日時</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="userList">${rows}</tbody>
    </table>
  </div>
  <script>
    async function addUser() {
      const userId = document.getElementById('newId').value.trim();
      const password = document.getElementById('newPass').value.trim();
      const msg = document.getElementById('addMsg');
      if (!userId || !password) { msg.textContent = '⚠️ IDとパスワードを入力してください'; msg.style.color='orange'; return; }
      msg.textContent = '追加中...'; msg.style.color='gray';
      const res = await fetch('/admin/users/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password })
      });
      const data = await res.json();
      if (data.success) {
        msg.textContent = '✅ 追加しました'; msg.style.color='green';
        setTimeout(() => location.reload(), 1000);
      } else {
        msg.textContent = '❌ ' + data.error; msg.style.color='red';
      }
    }
    async function deleteUser(docId, userId) {
      if (!confirm(userId + ' を削除しますか？')) return;
      const res = await fetch('/admin/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId })
      });
      const data = await res.json();
      if (data.success) location.reload();
      else alert('削除失敗: ' + data.error);
    }
  </script>
</body>
</html>`);
});

// 管理者追加API
app.post('/admin/users/add', basicAuth, async (req, res) => {
  const { userId, password } = req.body;
  try {
    const existing = await db.collection('admins').where('userId', '==', userId).get();
    if (!existing.empty) return res.json({ success: false, error: 'このIDはすでに存在します' });
    await db.collection('admins').add({
      userId,
      password: hashPassword(password),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 管理者削除API
app.post('/admin/users/delete', basicAuth, async (req, res) => {
  const { docId } = req.body;
  try {
    await db.collection('admins').doc(docId).delete();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 返信API
app.post('/admin/reply', basicAuth, async (req, res) => {
  const { docId, senderId, message } = req.body;
  try {
    await sendMessage(senderId, message);
    await db.collection('messages').doc(docId).update({
      status: '対応済み',
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      replyMessage: message,
      replyAdmin: req.adminId
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Webhook認証
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// メッセージ受信・保存・自動返信
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      const event = entry.messaging[0];
      if (event && event.message && !event.message.is_echo) {
        const senderId = event.sender.id;
        const messageText = event.message.text;
        const senderName = await getSenderName(senderId);
        await db.collection('messages').add({
          senderId,
          senderName,
          message: messageText,
          status: '未対応',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await sendMessage(senderId, 'お問い合わせありがとうございます。担当者より折り返しご連絡いたします。');
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// メッセージ送信関数
async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } })
    });
    const data = await response.json();
    console.log('返信成功:', JSON.stringify(data));
  } catch (err) {
    console.error('返信失敗:', err);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('サーバー起動中 ポート:', PORT));