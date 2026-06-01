const express = require('express');
const app = express();

app.use(express.json());

const VERIFY_TOKEN = 'union_support_verify_2024';

// Webhook認証（MetaがURLを確認するために使用）
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook認証成功');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook認証失敗');
    res.sendStatus(403);
  }
});

// メッセージ受信
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    body.entry.forEach(entry => {
      const event = entry.messaging[0];
      if (event && event.message) {
        const senderId = event.sender.id;
        const messageText = event.message.text;
        console.log('受信:', senderId, messageText);
      }
    });
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

const PORT = process.env.PORT