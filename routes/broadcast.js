const express = require('express');
const router = express.Router();
const { requireAuth } = require('../helpers/auth');
const { avatarHtml, navHtml, commonCss } = require('../helpers/html');

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// グループ送信ページ
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');

  // contactsコレクションから全プロフィール取得
  const contactsSnapshot = await db.collection('contacts').get();
  const contacts = {};
  contactsSnapshot.docs.forEach(doc => {
    contacts[doc.id] = doc.data();
  });

  // messagesコレクションから送信者情報・最終メッセージ日時取得
  const msgSnapshot = await db.collection('messages').orderBy('createdAt', 'desc').get();
  const users = {};
  msgSnapshot.docs.forEach(doc => {
    const d = doc.data();
    const sid = d.senderId;
    if (!users[sid]) users[sid] = {
      senderId: sid,
      senderName: d.senderName || '不明',
      senderPicture: d.senderPicture || null,
      lastDate: d.createdAt,
      lastDateMs: d.createdAt ? d.createdAt.toDate().getTime() : 0
    };
  });

  // 統合データ作成
  const members = Object.values(users).map(u => {
    const profile = contacts[u.senderId] || {};
    const now = Date.now();
    const diffHours = u.lastDateMs ? Math.floor((now - u.lastDateMs) / 1000 / 60 / 60) : 9999;
    return {
      senderId: u.senderId,
      name: profile.passportName || u.senderName || '不明',
      picture: u.senderPicture,
      workplace: profile.workplace || '',
      residenceStatus: profile.residenceStatus || '',
      searchTags: profile.searchTags || '',
      lastDate: u.lastDate ? u.lastDate.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明',
      diffHours
    };
  });

  // フィルター
  const filterWorkplace = req.query.workplace || '';
  const filterResidence = req.query.residence || '';
  const filterKeyword = req.query.keyword || '';
  const filtered = members.filter(m => {
    if (filterWorkplace && m.workplace !== filterWorkplace) return false;
    if (filterResidence && m.residenceStatus !== filterResidence) return false;
    if (filterKeyword) {
      const kw = filterKeyword.toLowerCase();
      if (
        !m.name.toLowerCase().includes(kw) &&
        !m.workplace.toLowerCase().includes(kw) &&
        !m.residenceStatus.toLowerCase().includes(kw) &&
        !m.searchTags.toLowerCase().includes(kw)
      ) return false;
    }
    return true;
  });

  // 事業所・在留資格の選択肢
  const workplaces = [...new Set(members.map(m => m.workplace).filter(Boolean))];
  const residences = [...new Set(members.map(m => m.residenceStatus).filter(Boolean))];
  const workplaceOptions = workplaces.map(w => `<option value="${w}" ${filterWorkplace === w ? 'selected' : ''}>${w}</option>`).join('');
  const residenceOptions = residences.map(r => `<option value="${r}" ${filterResidence === r ? 'selected' : ''}>${r}</option>`).join('');

  const rows = filtered.map(m => {
    const over24 = m.diffHours > 24;
    const badge = over24
      ? `<span style="background:#e67e22;color:white;border-radius:4px;padding:2px 6px;font-size:11px;margin-left:6px;">24h超</span>`
      : `<span style="background:#27ae60;color:white;border-radius:4px;padding:2px 6px;font-size:11px;margin-left:6px;">24h内</span>`;
    return `<tr>
      <td style="text-align:center;"><input type="checkbox" name="targets" value="${m.senderId}" checked></td>
      <td><div style="display:flex;align-items:center;gap:8px;">${avatarHtml(m.name, m.picture)}<strong>${m.name}</strong>${badge}</div></td>
      <td>${m.workplace || '—'}</td>
      <td>${m.residenceStatus || '—'}</td>
      <td style="font-size:12px;color:#888;">${m.lastDate}</td>
    </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<link rel="icon" href="https://www.facebook.com/favicon.ico">
<title>グループ送信</title>
<style>${commonCss()}
table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;}
td{padding:12px 16px;border-bottom:1px solid #eee;font-size:14px;}
tr:hover td{background:#f0f7ff;}
.filter-bar{background:white;border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.1);display:flex;gap:12px;flex-wrap:wrap;align-items:center;}
.filter-bar input,.filter-bar select{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;}
.filter-bar button{padding:8px 16px;background:#2980b9;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;}
.filter-bar a{padding:8px 16px;background:#95a5a6;color:white;border-radius:4px;text-decoration:none;font-size:14px;}
.msg-box{background:white;border-radius:8px;padding:20px 24px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
textarea{width:100%;padding:12px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;resize:vertical;}
.send-btn{background:#e74c3c;color:white;border:none;padding:12px 32px;border-radius:6px;cursor:pointer;font-size:16px;font-weight:bold;margin-top:12px;}
.send-btn:disabled{background:#ccc;cursor:not-allowed;}
#resultArea{margin-top:16px;}
.result-item{padding:8px 12px;border-radius:4px;margin-bottom:6px;font-size:14px;}
.result-ok{background:#d5f5e3;color:#1e8449;}
.result-ng{background:#fadbd8;color:#922b21;}
</style>
</head><body>
<header><h1>📢 グループ送信</h1>${navHtml(req.session.adminDisplayName)}</header>
<div class="container">

  <div class="msg-box">
    <h3 style="margin-top:0;color:#2c3e50;">✉️ 送信メッセージ</h3>
    <textarea id="broadcastMsg" rows="5" placeholder="送信するメッセージを入力してください..."></textarea>
    <div style="margin-top:8px;font-size:13px;color:#888;">※ HUMAN_AGENTタグを使用するため24時間以上経過したユーザーにも送信可能です。</div>
  </div>

  <form method="get" action="/admin/broadcast">
    <div class="filter-bar">
      <input type="text" name="keyword" value="${filterKeyword}" placeholder="🔍 キーワード検索">
      <select name="workplace">
        <option value="">すべての事業所</option>
        ${workplaceOptions}
      </select>
      <select name="residence">
        <option value="">すべての在留資格</option>
        ${residenceOptions}
      </select>
      <button type="submit">絞り込み</button>
      <a href="/admin/broadcast">リセット</a>
    </div>
  </form>

  <div style="margin-bottom:8px;display:flex;align-items:center;gap:16px;">
    <span style="font-size:14px;color:#555;">対象: <strong>${filtered.length}</strong> 名</span>
    <label style="font-size:14px;cursor:pointer;">
      <input type="checkbox" id="selectAll" checked onchange="toggleAll(this)"> 全選択/解除
    </label>
    <button class="send-btn" id="sendBtn" onclick="sendBroadcast()">📢 一括送信</button>
  </div>

  <table>
    <thead><tr>
      <th style="width:40px;text-align:center;">選択</th>
      <th>名前</th>
      <th>所属事業所</th>
      <th>在留資格</th>
      <th>最終メッセージ</th>
    </tr></thead>
    <tbody id="memberTable">${rows}</tbody>
  </table>

  <div id="resultArea"></div>
</div>

<script>
function toggleAll(cb) {
  document.querySelectorAll('input[name="targets"]').forEach(c => c.checked = cb.checked);
}

async function sendBroadcast() {
  const msg = document.getElementById('broadcastMsg').value.trim();
  if (!msg) { alert('メッセージを入力してください'); return; }
  const targets = [...document.querySelectorAll('input[name="targets"]:checked')].map(c => c.value);
  if (targets.length === 0) { alert('送信対象を選択してください'); return; }
  if (!confirm(targets.length + '名に送信します。よろしいですか？')) return;

  const btn = document.getElementById('sendBtn');
  btn.disabled = true;
  btn.textContent = '送信中...';

  const resultArea = document.getElementById('resultArea');
  resultArea.innerHTML = '<div style="font-size:14px;color:#555;margin-bottom:8px;">送信結果：</div>';

  let successCount = 0;
  let failCount = 0;

  for (const senderId of targets) {
    try {
      const res = await fetch('/admin/broadcast/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId, message: msg })
      });
      const data = await res.json();
      const row = document.querySelector('input[value="' + senderId + '"]').closest('tr');
      const name = row.querySelector('strong').textContent;
      if (data.success) {
        successCount++;
        resultArea.innerHTML += '<div class="result-item result-ok">✅ ' + name + ' - 送信成功</div>';
      } else {
        failCount++;
        resultArea.innerHTML += '<div class="result-item result-ng">❌ ' + name + ' - 送信失敗: ' + data.error + '</div>';
      }
    } catch (e) {
      failCount++;
      resultArea.innerHTML += '<div class="result-item result-ng">❌ 送信エラー: ' + e.message + '</div>';
    }
    await new Promise(r => setTimeout(r, 300));
  }

  resultArea.innerHTML += '<div style="margin-top:12px;font-size:15px;font-weight:bold;">完了: ✅ ' + successCount + '件成功 / ❌ ' + failCount + '件失敗</div>';
  btn.disabled = false;
  btn.textContent = '📢 一括送信';
}
</script>
</body></html>`);
});

// 送信API
router.post('/send', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { senderId, message } = req.body;

  try {
    // HUMAN_AGENTタグを使用して送信
    const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text: message },
        messaging_type: 'MESSAGE_TAG',
        tag: 'HUMAN_AGENT'
      })
    });
    const data = await response.json();
    if (data.error) {
      console.error('グループ送信エラー:', senderId, data.error.message);
      return res.json({ success: false, error: data.error.message });
    }

    // messagesコレクションに記録
    const contactDoc = await db.collection('contacts').doc(senderId).get();
    const profile = contactDoc.exists ? contactDoc.data() : {};
    const senderName = profile.passportName || '不明';
    await db.collection('messages').add({
      senderId,
      senderName,
      senderPicture: null,
      message: `[グループ送信] ${message}`,
      replyMessage: message,
      replyAdmin: req.session.adminDisplayName || '管理者',
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: '対応済み',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('グループ送信成功:', senderId, senderName);
    res.json({ success: true });
  } catch (err) {
    console.error('グループ送信例外:', err.message);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
