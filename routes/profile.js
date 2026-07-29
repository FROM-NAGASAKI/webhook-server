const express = require('express');
const router = express.Router();
const { requireAuth, hashPassword } = require('../helpers/auth');
const { navHtml, commonCss } = require('../helpers/html');

// マイプロフィール画面
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const adminId = req.session.adminId;

  const snapshot = await db.collection('admins').where('userId', '==', adminId).limit(1).get();
  if (snapshot.empty) return res.status(404).send('管理者が見つかりません');
  const adminData = snapshot.docs[0].data();
  const docId = snapshot.docs[0].id;

  const templatesSnapshot = await db.collection('admins').doc(docId).collection('templates').orderBy('createdAt', 'asc').get();
  const templates = templatesSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  const templateRows = templates.map(t =>
    '<div class="template-item" data-id="' + t.id + '">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">'
    + '<input type="text" class="tpl-title" value="' + (t.title || '').replace(/"/g, '&quot;') + '" style="font-weight:bold;flex:1;margin-bottom:0;padding:6px 10px;">'
    + '<button onclick="deleteTemplate(\'' + t.id + '\')" style="background:#e74c3c;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;">🗑️ 削除</button>'
    + '</div>'
    + '<textarea class="tpl-body" rows="3" style="margin-bottom:6px;">' + (t.body || '') + '</textarea>'
    + '<button onclick="updateTemplate(\'' + t.id + '\')" style="background:#2980b9;color:white;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px;">💾 この定型文を更新</button>'
    + '<span class="tpl-msg" style="margin-left:8px;font-size:12px;font-weight:bold;"></span>'
    + '</div>'
  ).join('') || '<p style="color:#888;font-size:13px;">まだ定型文がありません。下のフォームから追加してください。</p>';

  res.send('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">'
    + '<link rel="icon" href="https://www.facebook.com/favicon.ico">'
    + '<title>マイプロフィール</title>'
    + '<style>' + commonCss()
    + '.card{background:white;border-radius:8px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.1);margin-bottom:24px;max-width:600px;}'
    + 'label{display:block;margin-bottom:4px;font-size:13px;color:#555;font-weight:bold;}'
    + 'input[type=text],input[type=password]{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:100%;box-sizing:border-box;margin-bottom:16px;}'
    + 'textarea{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:100%;box-sizing:border-box;resize:vertical;}'
    + 'button.save{background:#2980b9;color:white;border:none;padding:9px 20px;border-radius:4px;cursor:pointer;font-size:14px;margin-top:12px;}'
    + 'button.save:hover{background:#1a6fa8;}'
    + '.section{margin-bottom:32px;}'
    + '.section h3{margin-top:0;color:#2c3e50;border-bottom:2px solid #eee;padding-bottom:8px;}'
    + '.template-item{background:#f9f9f9;border:1px solid #eee;border-radius:6px;padding:12px;margin-bottom:12px;}'
    + '</style></head><body>'
    + '<header><h1>👤 マイプロフィール</h1>' + navHtml(req.session.adminDisplayName) + '</header>'
    + '<div class="container">'
    + '<div class="card">'

    // 署名編集
    + '<div class="section">'
    + '<h3>✏️ 署名設定</h3>'
    + '<p style="font-size:13px;color:#888;margin-top:0;">返信メッセージの末尾に自動付加されます。</p>'
    + '<label>署名</label>'
    + '<textarea id="signature" rows="6" placeholder="例：担当：村上&#10;FROMながさき協同組合&#10;TEL: 095-XXX-XXXX&#10;mail: info@from-nagasaki.jp">' + (adminData.signature || '') + '</textarea>'
    + '<button class="save" onclick="saveSignature()">💾 署名を保存</button>'
    + '<span id="signatureMsg" style="margin-left:12px;font-size:14px;font-weight:bold;"></span>'
    + '</div>'

    // 表示名編集
    + '<div class="section">'
    + '<h3>🏷️ 表示名設定</h3>'
    + '<label>表示名</label>'
    + '<input type="text" id="displayName" value="' + (adminData.displayName || '') + '" placeholder="例：村上 志信">'
    + '<button class="save" onclick="saveDisplayName()">💾 表示名を保存</button>'
    + '<span id="displayNameMsg" style="margin-left:12px;font-size:14px;font-weight:bold;"></span>'
    + '</div>'

    // メール通知設定
    + '<div class="section">'
    + '<h3>🔔 メール通知設定</h3>'
    + '<p style="font-size:13px;color:#888;margin-top:0;">新しい問い合わせが届いたときに、登録したメールアドレス宛に通知します。</p>'
    + '<label>通知先メールアドレス</label>'
    + '<input type="text" id="notifyEmail" value="' + (adminData.notifyEmail || '') + '" placeholder="例：murakami@example.com">'
    + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:normal;margin-bottom:16px;">'
    + '<input type="checkbox" id="notifyEnabled" style="width:auto;margin:0;" ' + (adminData.notifyEnabled ? 'checked' : '') + '> 新しい問い合わせをメールで受け取る'
    + '</label>'
    + '<button class="save" onclick="saveNotifyEmail()">💾 通知設定を保存</button>'
    + '<span id="notifyEmailMsg" style="margin-left:12px;font-size:14px;font-weight:bold;"></span>'
    + '</div>'

    // 定型文設定
    + '<div class="section">'
    + '<h3>📋 定型文設定</h3>'
    + '<p style="font-size:13px;color:#888;margin-top:0;">よく使うメッセージを登録しておくと、返信・グループ送信時に選んで呼び出せます。</p>'
    + '<div id="templateList">' + templateRows + '</div>'
    + '<div style="border-top:1px solid #eee;padding-top:16px;margin-top:16px;">'
    + '<label>新しい定型文のタイトル</label>'
    + '<input type="text" id="newTplTitle" placeholder="例：出勤確認のお願い">'
    + '<label>本文</label>'
    + '<textarea id="newTplBody" rows="4" placeholder="定型文の本文を入力..."></textarea>'
    + '<button class="save" onclick="addTemplate()">➕ 定型文を追加</button>'
    + '<span id="newTplMsg" style="margin-left:12px;font-size:14px;font-weight:bold;"></span>'
    + '</div>'
    + '</div>'

    // パスワード変更
    + '<div class="section">'
    + '<h3>🔑 パスワード変更</h3>'
    + '<label>現在のパスワード</label>'
    + '<input type="password" id="currentPass" placeholder="現在のパスワードを入力">'
    + '<label>新しいパスワード</label>'
    + '<input type="password" id="newPass" placeholder="新しいパスワードを入力">'
    + '<label>新しいパスワード（確認）</label>'
    + '<input type="password" id="confirmPass" placeholder="新しいパスワードを再入力">'
    + '<button class="save" onclick="changePassword()">🔑 パスワードを変更</button>'
    + '<span id="passwordMsg" style="margin-left:12px;font-size:14px;font-weight:bold;"></span>'
    + '</div>'

    + '</div></div>'
    + '<script>'
    + 'async function saveSignature(){'
    + 'var msg=document.getElementById("signatureMsg");'
    + 'msg.textContent="保存中...";msg.style.color="gray";'
    + 'var signature=document.getElementById("signature").value;'
    + 'try{'
    + 'var res=await fetch("/admin/profile/signature",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({signature})});'
    + 'var data=await res.json();'
    + 'if(data.success){msg.textContent="✅ 保存しました";msg.style.color="green";}'
    + 'else{msg.textContent="✗ 保存失敗: "+data.error;msg.style.color="red";}'
    + '}catch(e){msg.textContent="✗ エラー: "+e.message;msg.style.color="red";}'
    + '}'

    + 'async function saveDisplayName(){'
    + 'var msg=document.getElementById("displayNameMsg");'
    + 'msg.textContent="保存中...";msg.style.color="gray";'
    + 'var displayName=document.getElementById("displayName").value.trim();'
    + 'try{'
    + 'var res=await fetch("/admin/profile/displayname",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName})});'
    + 'var data=await res.json();'
    + 'if(data.success){msg.textContent="✅ 保存しました";msg.style.color="green";setTimeout(function(){location.reload();},1000);}'
    + 'else{msg.textContent="✗ 保存失敗: "+data.error;msg.style.color="red";}'
    + '}catch(e){msg.textContent="✗ エラー: "+e.message;msg.style.color="red";}'
    + '}'

    + 'async function saveNotifyEmail(){'
    + 'var msg=document.getElementById("notifyEmailMsg");'
    + 'msg.textContent="保存中...";msg.style.color="gray";'
    + 'var notifyEmail=document.getElementById("notifyEmail").value.trim();'
    + 'var notifyEnabled=document.getElementById("notifyEnabled").checked;'
    + 'if(notifyEnabled&&!notifyEmail){msg.textContent="△ メールアドレスを入力してください";msg.style.color="orange";return;}'
    + 'try{'
    + 'var res=await fetch("/admin/profile/notification-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({notifyEmail,notifyEnabled})});'
    + 'var data=await res.json();'
    + 'if(data.success){msg.textContent="✅ 保存しました";msg.style.color="green";}'
    + 'else{msg.textContent="✗ 保存失敗: "+data.error;msg.style.color="red";}'
    + '}catch(e){msg.textContent="✗ エラー: "+e.message;msg.style.color="red";}'
    + '}'

    + 'async function addTemplate(){'
    + 'var msg=document.getElementById("newTplMsg");'
    + 'var title=document.getElementById("newTplTitle").value.trim();'
    + 'var body=document.getElementById("newTplBody").value.trim();'
    + 'if(!title||!body){msg.textContent="△ タイトルと本文を入力してください";msg.style.color="orange";return;}'
    + 'msg.textContent="追加中...";msg.style.color="gray";'
    + 'try{'
    + 'var res=await fetch("/admin/profile/templates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,body})});'
    + 'var data=await res.json();'
    + 'if(data.success){msg.textContent="✅ 追加しました";msg.style.color="green";setTimeout(function(){location.reload();},800);}'
    + 'else{msg.textContent="✗ 失敗: "+data.error;msg.style.color="red";}'
    + '}catch(e){msg.textContent="✗ エラー: "+e.message;msg.style.color="red";}'
    + '}'

    + 'async function updateTemplate(id){'
    + 'var item=document.querySelector(".template-item[data-id=\'"+id+"\']");'
    + 'var msg=item.querySelector(".tpl-msg");'
    + 'var title=item.querySelector(".tpl-title").value.trim();'
    + 'var body=item.querySelector(".tpl-body").value.trim();'
    + 'if(!title||!body){msg.textContent="△ 入力してください";msg.style.color="orange";return;}'
    + 'msg.textContent="保存中...";msg.style.color="gray";'
    + 'try{'
    + 'var res=await fetch("/admin/profile/templates/"+id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,body})});'
    + 'var data=await res.json();'
    + 'if(data.success){msg.textContent="✅ 更新しました";msg.style.color="green";}'
    + 'else{msg.textContent="✗ 失敗: "+data.error;msg.style.color="red";}'
    + '}catch(e){msg.textContent="✗ エラー: "+e.message;msg.style.color="red";}'
    + '}'

    + 'async function deleteTemplate(id){'
    + 'if(!confirm("この定型文を削除しますか？"))return;'
    + 'try{'
    + 'var res=await fetch("/admin/profile/templates/"+id+"/delete",{method:"POST"});'
    + 'var data=await res.json();'
    + 'if(data.success){location.reload();}'
    + 'else{alert("削除失敗: "+data.error);}'
    + '}catch(e){alert("エラー: "+e.message);}'
    + '}'

    + 'async function changePassword(){'
    + 'var msg=document.getElementById("passwordMsg");'
    + 'var current=document.getElementById("currentPass").value;'
    + 'var newPass=document.getElementById("newPass").value;'
    + 'var confirm=document.getElementById("confirmPass").value;'
    + 'if(!current||!newPass||!confirm){msg.textContent="△ すべての項目を入力してください";msg.style.color="orange";return;}'
    + 'if(newPass!==confirm){msg.textContent="△ 新しいパスワードが一致しません";msg.style.color="orange";return;}'
    + 'if(newPass.length<6){msg.textContent="△ パスワードは6文字以上にしてください";msg.style.color="orange";return;}'
    + 'msg.textContent="変更中...";msg.style.color="gray";'
    + 'try{'
    + 'var res=await fetch("/admin/profile/password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword:current,newPassword:newPass})});'
    + 'var data=await res.json();'
    + 'if(data.success){msg.textContent="✅ パスワードを変更しました";msg.style.color="green";document.getElementById("currentPass").value="";document.getElementById("newPass").value="";document.getElementById("confirmPass").value="";}'
    + 'else{msg.textContent="✗ "+data.error;msg.style.color="red";}'
    + '}catch(e){msg.textContent="✗ エラー: "+e.message;msg.style.color="red";}'
    + '}'
    + '</script></body></html>');
});

// 署名保存API
router.post('/signature', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const adminId = req.session.adminId;
  const { signature } = req.body;
  try {
    const snapshot = await db.collection('admins').where('userId', '==', adminId).limit(1).get();
    if (snapshot.empty) return res.json({ success: false, error: '管理者が見つかりません' });
    await snapshot.docs[0].ref.update({ signature, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    req.session.adminSignature = signature;
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 表示名保存API
router.post('/displayname', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const adminId = req.session.adminId;
  const { displayName } = req.body;
  try {
    const snapshot = await db.collection('admins').where('userId', '==', adminId).limit(1).get();
    if (snapshot.empty) return res.json({ success: false, error: '管理者が見つかりません' });
    await snapshot.docs[0].ref.update({ displayName, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    req.session.adminDisplayName = displayName;
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// メール通知設定保存API
router.post('/notification-email', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const adminId = req.session.adminId;
  const { notifyEmail, notifyEnabled } = req.body;

  // ごく簡易的なメール形式チェック（厳密なRFC準拠チェックは行わない）
  if (notifyEnabled && (!notifyEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail))) {
    return res.json({ success: false, error: 'メールアドレスの形式が正しくありません' });
  }

  try {
    const snapshot = await db.collection('admins').where('userId', '==', adminId).limit(1).get();
    if (snapshot.empty) return res.json({ success: false, error: '管理者が見つかりません' });
    await snapshot.docs[0].ref.update({
      notifyEmail: notifyEmail || '',
      notifyEnabled: !!notifyEnabled,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// パスワード変更API
router.post('/password', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const adminId = req.session.adminId;
  const { currentPassword, newPassword } = req.body;
  const { hashPassword } = require('../helpers/auth');
  try {
    const snapshot = await db.collection('admins').where('userId', '==', adminId).limit(1).get();
    if (snapshot.empty) return res.json({ success: false, error: '管理者が見つかりません' });
    const adminData = snapshot.docs[0].data();
    if (adminData.passwordHash !== hashPassword(currentPassword)) {
      return res.json({ success: false, error: '現在のパスワードが正しくありません' });
    }
    await snapshot.docs[0].ref.update({ passwordHash: hashPassword(newPassword), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 定型文一覧取得API（他の画面のドロップダウンから呼ばれる）
router.get('/templates', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const adminId = req.session.adminId;
  try {
    const snapshot = await db.collection('admins').where('userId', '==', adminId).limit(1).get();
    if (snapshot.empty) return res.json({ templates: [] });
    const docId = snapshot.docs[0].id;
    const tplSnapshot = await db.collection('admins').doc(docId).collection('templates').orderBy('createdAt', 'asc').get();
    const templates = tplSnapshot.docs.map(d => ({ id: d.id, title: d.data().title, body: d.data().body }));
    res.json({ templates });
  } catch (err) {
    res.json({ templates: [], error: err.message });
  }
});

// 定型文追加API
router.post('/templates', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const adminId = req.session.adminId;
  const { title, body } = req.body;
  if (!title || !body) return res.json({ success: false, error: 'タイトルと本文を入力してください' });
  try {
    const snapshot = await db.collection('admins').where('userId', '==', adminId).limit(1).get();
    if (snapshot.empty) return res.json({ success: false, error: '管理者が見つかりません' });
    const docId = snapshot.docs[0].id;
    await db.collection('admins').doc(docId).collection('templates').add({
      title, body, createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 定型文更新API
router.post('/templates/:templateId', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const adminId = req.session.adminId;
  const { templateId } = req.params;
  const { title, body } = req.body;
  if (!title || !body) return res.json({ success: false, error: 'タイトルと本文を入力してください' });
  try {
    const snapshot = await db.collection('admins').where('userId', '==', adminId).limit(1).get();
    if (snapshot.empty) return res.json({ success: false, error: '管理者が見つかりません' });
    const docId = snapshot.docs[0].id;
    await db.collection('admins').doc(docId).collection('templates').doc(templateId).update({
      title, body, updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 定型文削除API
router.post('/templates/:templateId/delete', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const adminId = req.session.adminId;
  const { templateId } = req.params;
  try {
    const snapshot = await db.collection('admins').where('userId', '==', adminId).limit(1).get();
    if (snapshot.empty) return res.json({ success: false, error: '管理者が見つかりません' });
    const docId = snapshot.docs[0].id;
    await db.collection('admins').doc(docId).collection('templates').doc(templateId).delete();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
