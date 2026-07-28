// メール通知用の共通ヘルパー（Gmail + アプリパスワードを使用）
// 必要な環境変数：
//   GMAIL_USER          … 送信元Gmailアドレス（例: notify@gmail.com）
//   GMAIL_APP_PASSWORD  … Googleアカウントで発行した16桁のアプリパスワード

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

async function sendMail(to, subject, text, html) {
  return transporter.sendMail({
    from: '"FROMながさき 問い合わせシステム" <' + process.env.GMAIL_USER + '>',
    to,
    subject,
    text,
    html
  });
}

// 「メール通知を受け取る」設定になっている管理者全員に、新規問い合わせのお知らせを送る
async function notifyAdminsOfNewInquiry(db, { senderName, senderId, messageText }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log('[メール通知] GMAIL_USER/GMAIL_APP_PASSWORD が未設定のためスキップします');
    return;
  }

  try {
    const snapshot = await db.collection('admins').where('notifyEnabled', '==', true).get();
    const recipients = snapshot.docs
      .map(doc => doc.data().notifyEmail)
      .filter(Boolean);

    if (recipients.length === 0) {
      console.log('[メール通知] 通知先メールアドレスが登録されていないためスキップします');
      return;
    }

    const domain = process.env.RAILWAY_PUBLIC_DOMAIN || 'webhook-server-production-7345.up.railway.app';
    const link = 'https://' + domain + '/admin/contacts/' + senderId;
    const bodyText = messageText || '(添付ファイルのみ、またはテキストなし)';

    const subject = '【FROMながさき】新しい問い合わせ - ' + senderName;
    const text = senderName + ' さんから新しい問い合わせが届きました。\n\n'
      + '内容：\n' + bodyText + '\n\n'
      + '管理画面で確認する：\n' + link;
    const html = '<p><strong>' + senderName + '</strong> さんから新しい問い合わせが届きました。</p>'
      + '<p style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:6px;">' + bodyText.replace(/</g, '&lt;') + '</p>'
      + '<p><a href="' + link + '">管理画面で確認する</a></p>';

    await Promise.all(recipients.map(email =>
      sendMail(email, subject, text, html).catch(err => console.error('[メール通知] 送信失敗:', email, err.message))
    ));
    console.log('[メール通知] 送信完了:', recipients.join(', '));
  } catch (err) {
    console.error('[メール通知] エラー:', err.message);
  }
}

module.exports = { sendMail, notifyAdminsOfNewInquiry };
