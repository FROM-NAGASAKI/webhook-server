const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

async function getSenderInfo(senderId) {
  return { name: '不明', picture: null };
}

async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } })
    });
    const data = await response.json();
    console.log('テキスト返信成功:', JSON.stringify(data));
  } catch (err) {
    console.error('返信エラー:', err);
  }
}

function getAttachmentType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

module.exports = { getSenderInfo, sendMessage, getAttachmentType };