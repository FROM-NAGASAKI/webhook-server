const express = require('express');
const admin = require('firebase-admin');
const app = express();
app.use(express.json());

// Firebase初期化（個別環境変数から組み立て）
const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40from-webhook.iam.gserviceaccount.com`,
  universe_domain: 'googleapis.com'
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const VERIFY_TOKEN = 'union_support_verify_2024';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

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

        // Firestoreに保存
        await db.collection('messages').add({
          senderId: senderId,
          message: messageText,
          status: '未対応',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('Firestoreに保存完了');

        // 自動返信
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