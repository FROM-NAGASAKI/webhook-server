const express = require('express');
const admin = require('firebase-admin');
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

// Basic認証ミドルウェア
const ADMIN_ID = 'from-nagasaki-admin';
const ADMIN_PASS = 'fngs-4301';

function basicAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('認証が必要です');
  }
  const base64 = authHeader.slice(6);
  const decoded = Buffer.from(base64, 'base64').toString('utf-8');
  const [id, pass] = decoded.split(':');
  if (id === ADMIN_ID && pass === ADMIN_PASS) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('IDまたはパスワードが違います');
}

// 管理画面
app.get('/admin', basicAuth, async (req, res) => {
  const snapshot = await db.collection('messages')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const rows = snapshot.docs.map(doc => {
    const d = doc.data();
    const date = d.createdAt ? d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    const status = d.status || '未対応';
    const statusColor = status === '未対応' ? '#e74c3c' : '#27ae60';
    return `
      <tr>
        <td>${date}</td>
        <td>${d.senderId || ''}</td>
        <td>${d.message || ''}</td>
        <td style="color:${statusColor};font-weight:bold;">${status}</td>
        <td>
          <button onclick="openReply('${doc.id}', '${d.senderId}', this)" 
            style="background:#2980b9;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">
            返信
          </button>
        </td>
      </tr>
      <tr id="reply-${doc.id}" style="display:none;background:#f0f7ff;">
        <td colspan="5" style="padding:12px;">
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
    header button { background:#3498db;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:14px; }
    .container { padding: 24px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    th { background: #2c3e50; color: white; padding: 12px 16px; text-align: left; }
    td { padding: 12px 16px; border-bottom: 1px solid #eee; }
    tr:hover td { background: #f9f9f9; }
    .count { margin-bottom: 16px; color: #666; }
  </style>
</head>
<body>
  <header>
    <h1>📋 問い合わせ管理画面</h1>
    <button onclick="location.reload()">🔄 更新</button>
  </header>
  <div class="container">
    <p class="count">件数：${snapshot.size} 件</p>
    <table>
      <thead>
        <tr>
          <th>受信日時</th>
          <th>送信者ID</th>
          <th>メッセージ</th>
          <th>ステータス</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
  <script>
    function openReply(id, senderId, btn) {
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
          document.getElementById('text-' + docId).value = '';
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

// 返信API
app.post('/admin/reply', basicAuth, async (req, res) => {
  const { docId, senderId, message } = req.body;
  try {
    await sendMessage(senderId, message);
    await db.collection('messages').doc(docId).update({
      status: '対応済み',
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      replyMessage: message
    });
    res.json({ success: true });
  } catch (err) {
    console.error('返信エラー:', err);
    res.json({ success: false, error: err.message });
  }
});

// Webhook認証
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook認証成功');
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
        console.log('受信:', senderId, messageText);

        await db.collection('messages').add({
          senderId: senderId,
          message: messageText,
          status: '未対応',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('Firestoreに保存完了');

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
  const payload = {
    recipient: { id: recipientId },
    message: { text: text }
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    console.log('返信成功:', JSON.stringify(data));
  } catch (err) {
    console.error('返信失敗:', err);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('サーバー起動中 ポート:', PORT);
});