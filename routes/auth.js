const express = require('express');
const router = express.Router();
const { hashPassword } = require('../helpers/auth');

// ログイン画面
router.get('/login', (req, res) => {
  if (req.session && req.session.adminId) return res.redirect('/admin');
  const error = req.query.error ? '<p style="color:#e74c3c;margin-bottom:16px;">IDまたはパスワードが違います</p>' : '';
  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="icon" href="https://www.facebook.com/favicon.ico">
  <title>ログイン</title>
  <style>
    *{box-sizing:border-box;}
    body{font-family:sans-serif;margin:0;background:#2c3e50;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px;}
    .card{background:white;border-radius:12px;padding:32px;width:100%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.3);}
    h1{margin:0 0 8px;color:#2c3e50;font-size:22px;text-align:center;}
    .subtitle{text-align:center;color:#888;font-size:14px;margin-bottom:28px;}
    label{display:block;margin-bottom:6px;font-size:13px;color:#555;font-weight:bold;}
    input{width:100%;padding:14px;border:1px solid #ddd;border-radius:6px;font-size:16px;margin-bottom:18px;}
    input:focus{outline:none;border-color:#2980b9;}
    button{width:100%;padding:15px;background:#2c3e50;color:white;border:none;border-radius:6px;font-size:16px;cursor:pointer;font-weight:bold;}
    button:hover{background:#34495e;}
    @media (max-width:480px){
      body{padding:12px;}
      .card{padding:24px 20px;}
    }
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
  console.log('ログイン試行:', userId, !!password);
  const db = req.app.get('db');
  try {
    const snapshot = await db.collection('admins').where('userId', '==', userId).get();
    if (!snapshot.empty) {
      const adminData = snapshot.docs[0].data();
      console.log('DB hash:', adminData.password);
      console.log('Input hash:', hashPassword(password));
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

router.get("/privacy", (req, res) => { res.send("<!DOCTYPE html><html lang=\"ja\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Privacy Policy</title></head><body><div style=\"max-width:800px;margin:40px auto;padding:0 24px;font-family:sans-serif;\"><h1>Privacy Policy</h1><p>Last updated: June 3, 2026</p><h2>1. Information We Collect</h2><ul><li>Messages sent via Facebook Messenger</li><li>Facebook public profile (name, photo)</li><li>Message timestamps</li></ul><h2>2. How We Use Information</h2><ul><li>Responding to inquiries</li><li>Providing support services</li></ul><h2>3. Data Storage</h2><p>Data is stored in Google Firebase Firestore (asia-northeast1 region).</p><h2>4. Contact</h2><p>murakami@from-nagasaki.jp</p></div></body></html>"); });

module.exports = router;
