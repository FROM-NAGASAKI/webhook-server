const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
async function getSenderInfo(senderId) {
  return { name: '不明', picture: null };
}

// tag を指定した場合は messaging_type:'MESSAGE_TAG' で送信する（例: 'HUMAN_AGENT'）。
// tag を指定しない場合は今まで通り messaging_type:'RESPONSE'（24時間ルール）で送信する。
// ※ HUMAN_AGENTタグは「人間の管理者が手動で書いた返信」にのみ使用可能。
//    webhook.js の自動応答（bot）には絶対に使わないこと（Metaのポリシー違反になる）。
async function sendMessage(recipientId, text, tag) {
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  const payload = {
    recipient: { id: recipientId },
    message: { text }
  };
  if (tag) {
    payload.messaging_type = 'MESSAGE_TAG';
    payload.tag = tag;
  } else {
    payload.messaging_type = 'RESPONSE';
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    console.log('テキスト返信成功:', JSON.stringify(data));
    return data;
  } catch (err) {
    console.error('返信エラー:', err);
    throw err;
  }
}
function getAttachmentType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

// クイックリプライ（選択式ボタン）付きメッセージを送信する。
// quickReplies: [{ title: '表示文言', payload: '内部値' }, ...]（最大13件、Facebook側の仕様）
async function sendQuickReplyMessage(recipientId, text, quickReplies, tag) {
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  const payload = {
    recipient: { id: recipientId },
    message: {
      text,
      quick_replies: quickReplies.slice(0, 13).map(q => ({
        content_type: 'text',
        title: q.title.slice(0, 20), // Facebookの文字数制限
        payload: q.payload
      }))
    }
  };
  if (tag) {
    payload.messaging_type = 'MESSAGE_TAG';
    payload.tag = tag;
  } else {
    payload.messaging_type = 'RESPONSE';
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    console.log('クイックリプライ送信結果:', JSON.stringify(data));
    if (data.error) {
      // Facebook側がエラーを返した場合は、呼び出し元で検知できるよう例外にする
      const err = new Error(data.error.message || 'クイックリプライの送信に失敗しました');
      err.fbError = data.error;
      throw err;
    }
    return data;
  } catch (err) {
    console.error('クイックリプライ送信エラー:', err.message || err);
    throw err;
  }
}

module.exports = { getSenderInfo, sendMessage, getAttachmentType, sendQuickReplyMessage };
