const express = require('express');
const router = express.Router();
const { hashPassword } = require('../helpers/auth');

// ログイン画面
router.get('/login', (req, res) => {
  if (req.session && req.session.adminId) return res.redirect('/admin');
  const error = req.query.error ? '<p style="color:#e74c3c;margin-bottom:16px;">IDまたはパスワードが違います</p>' : '';
  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <link rel="icon" href="https://www.facebook.com/favicon.ico">
  <title>ログイン</title>
  <style>
    body{font-family:sans-serif;margin:0;background:#2c3e50;display:flex;justify-content:center;align-items:center;min-height:100vh;}
    .card{background:white;border-radius:12px;padding:40px;width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.3);}
    h1{margin:0 0 8px;color:#2c3e50;font-size:22px;text-align:center;}
    .subtitle{text-align:center;color:#888;font-size:14px;margin-bottom:28px;}
    label{display:block;margin-bottom:4px;font-size:13px;color:#555;font-weight:bold;}
    input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;margin-bottom:16px;}
    input:focus{outline:none;border-color:#2980b9;}
    button{width:100%;padding:12px;background:#2c3e50;color:white;border:none;border-radius:6px;font-size:15px;cursor:pointer;font-weight:bold;}
    button:hover{background:#34495e;}
  </style></head><body>
  <div class="card">
    <h1>📋 管理画面</h1>
    <p class="subtitle">From 連絡ツール</p>
    ${error}
    <form method="POST" action="/login">
      <label>ユーザーID</label>
      <input type="text" name="userId" placeholder="ユーザーIDを入力" required autofocus>
      <label>パスワード</label>
      <input type="password" name="password" placeholder="パスワードを入力" required>
      <button type="submit">ログイン</button>
    </form>
  </div></body></html>`);
});

// ログイン処理
router.post('/login', async (req, res) => {
  const { userId, password } = req.body;
  const db = req.app.get('db');
  try {
    const snapshot = await db.collection('admins').where('userId', '==', userId).get();
    if (!snapshot.empty) {
      const adminData = snapshot.docs[0].data();
      if (adminData.password === hashPassword(password)) {
        req.session.adminId = userId;
        req.session.adminDisplayName = adminData.displayName || userId;
        req.session.adminSignature = adminData.signature || '';
        return res.redirect('/admin');
      }
    }
    const allAdmins = await db.collection('admins').get();
    if (allAdmins.empty && userId === 'from-nagasaki-admin' && password === 'fngs-4301') {
      req.session.adminId = userId;
      req.session.adminDisplayName = userId;
      req.session.adminSignature = '';
      return res.redirect('/admin');
    }
    res.redirect('/login?error=1');
  } catch (err) {
    console.error('ログインエラー:', err.message);
    res.redirect('/login?error=1');
  }
});

// ログアウト
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// プライバシーポリシー
router.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="https://www.facebook.com/favicon.ico">
  <title>プライバシーポリシー | From 連絡ツール</title>
  <style>
    body{font-family:sans-serif;margin:0;background:#f5f5f5;color:#333;}
    header{background:#2c3e50;color:white;padding:20px 24px;}
    header h1{margin:0;font-size:20px;}
    .container{max-width:800px;margin:40px auto;padding:0 24px;}
    .card{background:white;border-radius:8px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.1);margin-bottom:24px;}
    h2{color:#2c3e50;border-bottom:2px solid #ecf0f1;padding-bottom:8px;}
    h3{color:#34495e;}
    p,li{line-height:1.8;color:#555;}
    ul{padding-left:20px;}
    .updated{color:#888;font-size:14px;}
    a{color:#2980b9;}
    footer{text-align:center;padding:24px;color:#888;font-size:14px;}
  </style></head><body>
  <header><h1>📋 From 連絡ツール</h1></header>
  <div class="container">
    <div class="card">
      <h2>プライバシーポリシー</h2>
      <p class="updated">最終更新日：2026年6月3日</p>
      <p>From 連絡ツール（以下「本サービス」）は、外国人労働者と支援担当者をつなぐFacebook Messengerを活用した問い合わせ管理サービスです。本プライバシーポリシーは、本サービスが収集・利用する情報について説明します。</p>
    </div>
    <div class="card">
      <h2>1. 収集する情報</h2>
      <p>本サービスでは、以下の情報を収集します：</p>
      <ul>
        <li>Facebook Messengerを通じて送信されたメッセージの内容</li>
        <li>Facebookの公開プロフィール情報（名前、プロフィール画像）</li>
        <li>メッセージの送受信日時</li>
        <li>管理者が入力したプロフィール情報（所属事業所、在留資格、入国日等）</li>
      </ul>
    </div>
    <div class="card">
      <h2>2. 情報の利用目的</h2>
      <p>収集した情報は以下の目的で利用します：</p>
      <ul>
        <li>問い合わせへの返信および対応管理</li>
        <li>担当者による適切なサポートの提供</li>
        <li>サービス改善のための分析</li>
      </ul>
    </div>
    <div class="card">
      <h2>3. 情報の共有</h2>
      <p>収集した個人情報は、以下の場合を除き、第三者に提供しません：</p>
      <ul>
        <li>ご本人の同意がある場合</li>
        <li>法令に基づく開示が必要な場合</li>
        <li>本サービスの運営に必要な業務委託先への提供（守秘義務契約の締結を条件とします）</li>
      </ul>
    </div>
    <div class="card">
      <h2>4. データの保管</h2>
      <p>メッセージデータはGoogle Firebase（Firestore）に保管されます。データは日本国内のサーバー（asia-northeast1リージョン）に保存されます。</p>
    </div>
    <div class="card">
      <h2>5. データの保持期間</h2>
      <p>収集したデータは、サービス利用目的が達成されるまで、または本人からの削除要請があるまで保持します。</p>
    </div>
    <div class="card">
      <h2>6. Facebookプラットフォームの利用</h2>
      <p>本サービスはMeta社のMessenger APIを利用しています。Facebookのデータ利用ポリシーについては、<a href="https://www.facebook.com/privacy/policy/" target="_blank">Metaのプライバシーポリシー</a>をご参照ください。</p>
    </div>
    <div class="card">
      <h2>7. お問い合わせ</h2>
      <p>プライバシーに関するお問い合わせは、以下までご連絡ください：</p>
      <ul>
        <li>運営：株式会社FROMながさき</li>
        <li>メール：murakami@from-nagasaki.jp</li>
      </ul>
    </div>
    <div class="card">
      <h2>8. ポリシーの変更</h2>
      <p>本プライバシーポリシーは必要に応じて更新することがあります。重要な変更がある場合は、本