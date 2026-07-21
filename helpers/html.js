function avatarHtml(name, pictureUrl, size) {
  size = size || 32;
  if (pictureUrl) {
    return `<img src="${pictureUrl}" alt="${name}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px;border:2px solid #ddd;">`;
  }
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:#3498db;color:white;font-size:${Math.floor(size*0.44)}px;font-weight:bold;vertical-align:middle;margin-right:8px;">${initial}</span>`;
}
function attachmentHtml(d) {
  if (!d.attachmentName) return '';
  if (d.attachmentType === 'image' && d.attachmentUrl) {
    const url = d.attachmentUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<div style="margin-top:8px;"><img src="' + url + '" alt="' + d.attachmentName + '" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid #ddd;" onerror="this.style.display=\'none\'"></div>';
  }
  if (d.attachmentType === 'image') return '<div style="margin-top:8px;background:#f0f0f0;padding:8px 12px;border-radius:4px;font-size:13px;">🖼️ ' + d.attachmentName + '</div>';
  const icon = d.attachmentType === 'video' ? '🎥' : d.attachmentType === 'audio' ? '🎵' : '📄';
  return '<div style="margin-top:8px;background:#f0f0f0;padding:8px 12px;border-radius:4px;font-size:13px;">' + icon + ' ' + d.attachmentName + '</div>';
}
function messengerLinkHtml(senderId) {
  return `<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">
    <a href="https://m.me/${senderId}" target="_blank"
      style="display:inline-flex;align-items:center;gap:6px;background:#0084ff;color:white;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;">
      💬 Messengerで開く
    </a>
    <a href="fb-messenger://user/${senderId}"
      style="display:inline-flex;align-items:center;gap:6px;background:#25d366;color:white;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;">
      📱 アプリで開く（スマホ）
    </a>
  </div>`;
}
function navHtml(adminName) {
  return `<nav style="display:flex;align-items:center;gap:4px;">
    <a href="/admin">📋 問い合わせ</a>
    <a href="/admin/contacts">👥 ユーザー履歴</a>
    <a href="/admin/members">📊 メンバー一覧</a>
    <a href="/admin/broadcast">📢 グループ送信</a>
    <a href="/admin/users">👤 管理者</a>
    <span style="margin-left:16px;font-size:13px;opacity:0.8;">${adminName || ''}</span>
    <a href="/logout" style="margin-left:8px;background:rgba(231,76,60,0.7);">🚪 ログアウト</a>
  </nav>`;
}
function commonCss() {
  return `
    body { font-family: sans-serif; margin: 0; background: #f5f5f5; }
    header { background: #2c3e50; color: white; padding: 16px 24px; display:flex; justify-content:space-between; align-items:center; }
    header h1 { margin: 0; font-size: 20px; }
    nav a { color:white; text-decoration:none; margin-left:8px; padding:8px 14px; border-radius:4px; background:rgba(255,255,255,0.15); font-size:14px; }
    nav a:hover { background:rgba(255,255,255,0.25); }
    .container { padding: 24px; }`;
}
function faviconTag() {
  return `<link rel="icon" href="https://www.facebook.com/favicon.ico">`;
}
module.exports = { avatarHtml, attachmentHtml, messengerLinkHtml, navHtml, commonCss, faviconTag };
