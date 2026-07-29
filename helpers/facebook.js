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
module.exports = { getSenderInfo, sendMessage, getAttachmentType };
