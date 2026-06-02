const express = require('express');
const router = express.Router();
const { getSenderInfo, sendMessage } = require('../helpers/facebook');

const VERIFY_TOKEN = 'union_support_verify_2024';

// Webhook認証
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) res.status(200).send(challenge);
  else res.sendStatus(403);
});

// メッセージ受信
router.post('/webhook', async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      const event = entry.messaging[0];
      if (event && event.message && !event.message.is_echo) {
        const senderId = event.sender.id;
        const messageText = event.message.text;
        const senderInfo = await getSenderInfo(senderId);
        await db.collection('messages').add({
          senderId, senderName: senderInfo.name, senderPicture: senderInfo.picture,
          message: messageText, status: '未対応',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await sendMessage(senderId, 'お問い合わせありがとうございます。担当者より折り返しご連絡いたします。');
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else res.sendStatus(404);
});

module.exports = router;