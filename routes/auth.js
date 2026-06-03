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
  console.log('ログイン試行:', userId, !!password);
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
router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

module.exports = router;