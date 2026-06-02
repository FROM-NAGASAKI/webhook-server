const express = require('express');
const app = express();
app.use(express.json());

// デバッグ：環境変数の確認
console.log('=== 環境変数デバッグ ===');
console.log('FIREBASE_SERVICE_ACCOUNT exists:', !!process.env.FIREBASE_SERVICE_ACCOUNT);
console.log('FIREBASE_SERVICE_ACCOUNT length:', process.env.FIREBASE_SERVICE_ACCOUNT ? process.env.FIREBASE_SERVICE_ACCOUNT.length : 0);
console.log('PAGE_ACCESS_TOKEN exists:', !!process.env.PAGE_ACCESS_TOKEN);
console.log('全環境変数キー:', Object.keys(process.env).join(', '));
console.log('=== デバッグ終了 ===');

const VERIFY_TOKEN = 'union_support_verify_2024';

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

app.post('/webhook', (req, res) => {
  res.status(200).send('EVENT_RECEIVED');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('サーバー起動中 ポート:', PORT);
});