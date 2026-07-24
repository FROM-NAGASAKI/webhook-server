const express = require('express');
const router = express.Router();
const axios = require('axios');
const VERIFY_TOKEN = 'union_support_verify_2024';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Webhook認証
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) res.status(200).send(challenge);
  else res.sendStatus(403);
});

// FacebookのユーザープロフィールAPIから実名・アイコンを取得する
// 失敗した場合は null を返す（呼び出し側で「不明」等にフォールバックする）
async function fetchFacebookProfile(senderId) {
  try {
    const url = 'https://graph.facebook.com/v19.0/' + senderId
      + '?fields=first_name,last_name,profile_pic&access_token=' + PAGE_ACCESS_TOKEN;
    const res = await axios.get(url);
    const data = res.data || {};
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
    return {
      fbName: name || null,
      fbPicture: data.profile_pic || null
    };
  } catch (err) {
    console.error('Facebookプロフィール取得エラー:', senderId, err.response ? JSON.stringify(err.response.data) : err.message);
    return null;
  }
}

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
        const messageText = event.message.text || '';
        const attachments = event.message.attachments || [];
        console.log('Webhook受信:', senderId, messageText, '添付:', attachments.length);

        // contactsコレクションからキャッシュ済みのFB名・登録名を取得
        let senderName = '不明';
        let senderPicture = null;
        try {
          const contactDoc = await db.collection('contacts').doc(senderId).get();
          const contactData = contactDoc.exists ? contactDoc.data() : {};

          if (contactData.fbName) {
            // すでにFB名をキャッシュ済みならそれを使う（毎回APIを呼ばない）
            senderName = contactData.fbName;
            senderPicture = contactData.fbPicture || null;
          } else {
            // 初回、またはまだ取得できていない場合はFacebook Graph APIから取得
            const profile = await fetchFacebookProfile(senderId);
            if (profile && profile.fbName) {
              senderName = profile.fbName;
              senderPicture = profile.fbPicture;
              await db.collection('contacts').doc(senderId).set({
                fbName: profile.fbName,
                fbPicture: profile.fbPicture,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
              console.log('FBプロフィール取得・保存成功:', senderId, profile.fbName);
            } else {
              console.log('FBプロフィール取得失敗、"不明"のまま保存:', senderId);
            }
          }
        } catch (err) {
          console.error('contacts取得エラー:', err.message);
        }

        // 複数添付ファイル対応
        const attachmentList = attachments.map(att => ({
          type: att.type || 'file',
          url: att.payload ? att.payload.url : null,
          name: att.type === 'image' ? '画像' :
                att.type === 'video' ? '動画' :
                att.type === 'audio' ? '音声' :
                att.type === 'file' ? (att.payload && att.payload.name) || 'ファイル' : '添付ファイル'
        }));
        // 後方互換のため単一添付も保持
        const firstAtt = attachmentList[0] || null;
        const attachmentName = firstAtt ? firstAtt.name : null;
        const attachmentType = firstAtt ? firstAtt.type : null;
        const attachmentUrl = firstAtt ? firstAtt.url : null;
        const attLabel = attachmentList.map(a => '[' + a.name + ']').join(' ');
        const displayMessage = messageText || attLabel || '（テキストなし）';
        try {
          await db.collection('messages').add({
            senderId,
            senderName,
            senderPicture,
            message: displayMessage,
            attachmentName,
            attachmentType,
            attachmentUrl,
            attachments: attachmentList,
            status: '未対応',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log('Firestore保存成功:', senderName);
        } catch (err) {
          console.error('Firestore保存エラー:', err.message);
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else res.sendStatus(404);
});

module.exports = router;
