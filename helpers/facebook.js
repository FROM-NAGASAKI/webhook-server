const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

async function getSenderInfo(senderId) {
  try {
    const url = `https://graph.facebook.com/v19.0/${senderId}?fields=name,picture&access_token=${PAGE_ACCESS_TOKEN}`;
    const response = await fetch(url);
    const data = await response.json();
    return { name: data.name || '不明', picture: data.picture?.data?.url || null };
  } catch (err) { return { name: '不明', picture: null }; }
}

async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } })
    });
    const data = await response.json();
    console.log('テキスト返信成功:', JSON.stringify(data));
  } catch (err) { console.error('テキスト返信失敗:', err); }
}

function getAttachmentType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

module.exports = { getSenderInfo, sendMessage, getAttachmentType };