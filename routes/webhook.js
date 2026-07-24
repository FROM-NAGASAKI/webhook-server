const express = require('express');
const router = express.Router();
const axios = require('axios');
const { sendMessage } = require('../helpers/facebook');
const VERIFY_TOKEN = 'union_support_verify_2024';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// 初回コンタクト時に送る、名前を尋ねる自動メッセージ（日本語＋英語）
const NAME_REQUEST_MESSAGE = 'はじめまして。FROM長崎共同組合お問い合わせ窓口です。\n'
  + '今後の対応のため、お名前（フルネーム）を教えてください。\n\n'
  + 'Hello! This is the inquiry contact for FROM Nagasaki Cooperative Association.\n'
  + 'Could you please tell us your full name so we can assist you properly?';

// Webhook認証
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) res.status(200).send(challenge);
  else res.sendStatus(403);
});

// FacebookのユーザープロフィールAPIから実名・アイコンを取得する
// 失敗した場合は null を返す（呼び出し側で「不明(下4桁)」等にフォールバックする）
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

// 送信者の表示名を解決する。
// 1. contactsにfbNameがキャッシュ済みならそれを使う
// 2. まだAPIを試していなければ一度だけ試す（成功すればキャッシュ、失敗すればfbNameCheckedを立てて以後は再試行しない）
// 3. どうしても取得できない場合は「不明(送信者IDの下4桁)」にフォールバックする
// 併せて、まだ名前を尋ねていない場合は自動返信を送るべきか（needsNameRequest）も返す
async function resolveSenderProfile(db, senderId) {
  const contactRef = db.collection('contacts').doc(senderId);
  const contactDoc = await contactRef.get();
  const contactData = contactDoc.exists ? contactDoc.data() : {};
  const shortId = senderId.slice(-4);

  if (contactData.fbName) {
    return {
      senderName: contactData.fbName,
      senderPicture: contactData.fbPicture || null,
      needsNameRequest: false,
      askedForName: !!contactData.askedForName,
      contactRef
    };
  }

  if (contactData.fbNameChecked) {
    // 過去に一度APIを試して取得できなかった。再度APIは叩かず下4桁表示に統一する
    return {
      senderName: '不明(' + shortId + ')',
      senderPicture: null,
      needsNameRequest: !contactData.askedForName,
      askedForName: !!contactData.askedForName,
      contactRef
    };
  }

  // 初回：Graph APIでの取得を一度だけ試みる
  const profile = await fetchFacebookProfile(senderId);
  const update = { fbNameChecked: true };
  let senderName;
  let senderPicture = null;
  if (profile && profile.fbName) {
    senderName = profile.fbName;
    senderPicture = profile.fbPicture;
    update.fbName = profile.fbName;
    update.fbPicture = profile.fbPicture;
  } else {
    senderName = '不明(' + shortId + ')';
  }
  await contactRef.set(update, { merge: true });

  return {
    senderName,
    senderPicture,
    needsNameRequest: !profile || !profile.fbName, // 取得できなかった場合のみ名前を尋ねる
    askedForName: false,
    contactRef
  };
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

        let senderName = '不明';
        let senderPicture = null;
        let contactRef = null;
        let needsNameRequest = false;
        let alreadyAsked = false;

        try {
          const resolved = await resolveSenderProfile(db, senderId);
          senderName = resolved.senderName;
          senderPicture = resolved.senderPicture;
          contactRef = resolved.contactRef;
          needsNameRequest = resolved.needsNameRequest;
          alreadyAsked = resolved.askedForName;
        } catch (err) {
          console.error('contacts取得エラー:', err.message);
        }

        // まだ名前を尋ねていなければ、自動返信で名前を尋ねる（一度だけ）
        if (needsNameRequest && !alreadyAsked && contactRef) {
          try {
            await sendMessage(senderId, NAME_REQUEST_MESSAGE);
            await contactRef.set({ askedForName: true }, { merge: true });
            console.log('名前確認メッセージを自動送信:', senderId);
          } catch (err) {
            console.error('名前確認メッセージ送信エラー:', err.message);
          }
        } else if (alreadyAsked && contactRef) {
          // すでに名前を尋ねた後の返信 → まだ登録名が無ければ「登録名の候補」として保存する（最初の1回のみ）
          try {
            const contactSnap = await contactRef.get();
            const contactData = contactSnap.exists ? contactSnap.data() : {};
            if (!contactData.passportName && !contactData.nameCandidateCaptured && messageText) {
              await contactRef.set({
                nameCandidate: messageText.trim(),
                nameCandidateCaptured: true
              }, { merge: true });
              console.log('登録名候補を保存:', senderId, messageText.trim());
            }
          } catch (err) {
            console.error('登録名候補の保存エラー:', err.message);
          }
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
