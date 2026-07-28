const express = require('express');
const router = express.Router();
const { requireAuth } = require('../helpers/auth');
const { avatarHtml, navHtml, commonCss } = require('../helpers/html');

// メンバー一覧
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');

  // contactsコレクションから全プロフィール取得
  const contactsSnapshot = await db.collection('contacts').get();
  const contacts = {};
  contactsSnapshot.docs.forEach(doc => {
    contacts[doc.id] = doc.data();
  });

  // messagesコレクションから送信者情報・件数取得
  const msgSnapshot = await db.collection('messages').orderBy('createdAt', 'desc').get();
  const users = {};
  msgSnapshot.docs.forEach(doc => {
    const d = doc.data();
    const sid = d.senderId;
    if (!users[sid]) users[sid] = {
      senderId: sid,
      senderName: d.senderName || '不明',
      senderPicture: d.senderPicture || null,
      count: 0,
      unread: 0,
      lastDate: d.createdAt
    };
    users[sid].count++;
    if (d.status === '未対応') users[sid].unread++;
  });

  // 統合データ作成
  const members = Object.values(users).map(u => {
    const profile = contacts[u.senderId] || {};
    return {
      senderId: u.senderId,
      name: profile.passportName || u.senderName || '不明',
      picture: u.senderPicture,
      workplace: profile.workplace || '',
      residenceStatus: profile.residenceStatus || '',
      entryDate: profile.entryDate || '',
      searchTags: profile.searchTags || '',
      notes: profile.notes || '',
      count: u.count,
      unread: u.unread,
      lastDate: u.lastDate ? u.lastDate.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明',
      lastDateRaw: u.lastDate ? u.lastDate.toDate().getTime() : 0
    };
  });

  // ソート
  const sortKey = req.query.sort || 'lastDate';
  const sortDir = req.query.dir || 'desc';
  members.sort((a, b) => {
    let av = a[sortKey] || '';
    let bv = b[sortKey] || '';
    if (sortKey === 'lastDateRaw' || sortKey === 'count' || sortKey === 'unread') {
      av = Number(av); bv = Number(bv);
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    return sortDir === 'asc' ? av.localeCompare(bv, 'ja') : bv.localeCompare(av, 'ja');
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
        !m.searchTags.toLowerCase().includes(kw) &&
        !m.notes.toLowerCase().includes(kw)
      ) return false;
    }
    return true;
  });

  // ソートリンク生成
  function sortLink(key, label) {
    const newDir = (sortKey === key && sortDir === 'asc') ? 'desc' : 'asc';
    const arrow = sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const params = new URLSearchParams({ sort: key, dir: newDir, workplace: filterWorkplace, residence: filterResidence, keyword: filterKeyword });
    return `<a href="/admin/members?${params}" style="color:white;text-decoration:none;">${label}${arrow}</a>`;
  }

  // 事業所・在留資格の選択肢
  const workplaces = [...new Set(members.map(m => m.workplace).filter(Boolean))];
  const residences = [...new Set(members.map(m => m.residenceStatus).filter(Boolean))];

  const rows = filtered.map(m => {
    const unreadBadge = m.unread > 0 ? `<span style="background:#e74c3c;color:white;border-radius:12px;padding:2px 8px;font-size:12px;margin-left:6px;">${m.unread}</span>` : '';
    return `<tr onclick="location.href='/admin/contacts/${m.senderId}'" style="cursor:pointer;">
      <td data-label="名前"><div style="display:flex;align-items:center;gap:8px;">${avatarHtml(m.name, m.picture)}<div><strong>${m.name}</strong>${unreadBadge}<div style="font-size:11px;color:#888;">${m.senderId}</div></div></div></td>
      <td data-label="所属事業所">${m.workplace || '—'}</td>
      <td data-label="在留資格">${m.residenceStatus || '—'}</td>
      <td data-label="入国日">${m.entryDate || '—'}</td>
      <td data-label="件数" style="text-align:center;">${m.count}</td>
      <td data-label="未対応" style="text-align:center;color:${m.unread > 0 ? '#e74c3c' : '#27ae60'};">${m.unread}</td>
      <td data-label="最終日時">${m.lastDate}</td>
      <td data-label="備考" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#888;">${m.notes || '—'}</td>
    </tr>`;
  }).join('');

  const workplaceOptions = workplaces.map(w => `<option value="${w}" ${filterWorkplace === w ? 'selected' : ''}>${w}</option>`).join('');
  const residenceOptions = residences.map(r => `<option value="${r}" ${filterResidence === r ? 'selected' : ''}>${r}</option>`).join('');

  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<link rel="icon" href="https://www.facebook.com/favicon.ico">
<title>メンバー一覧</title>
<style>${commonCss()}
table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;}
td{padding:12px 16px;border-bottom:1px solid #eee;font-size:14px;}
tr:hover td{background:#f0f7ff;}
.filter-bar{background:white;border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.1);display:flex;gap:12px;flex-wrap:wrap;align-items:center;}
.filter-bar input,.filter-bar select{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;}
.filter-bar button{padding:8px 16px;background:#2980b9;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;}
.filter-bar a{padding:8px 16px;background:#95a5a6;color:white;border-radius:4px;text-decoration:none;font-size:14px;}
.count-badge{background:#2c3e50;color:white;border-radius:12px;padding:2px 10px;font-size:13px;margin-left:8px;}
@media (max-width:768px){
  .container{padding:8px;}
  .filter-bar{padding:12px;gap:8px;}
  .filter-bar input,.filter-bar select,.filter-bar button,.filter-bar a{width:100%;box-sizing:border-box;text-align:center;}
  table,thead,tbody{display:block;width:100%;}
  thead{display:none;}
  tbody tr{display:block;background:white;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,0.12);margin-bottom:10px;padding:10px 14px;}
  tbody tr td{display:block;padding:6px 0;border-bottom:1px solid #f0f0f0;white-space:normal!important;max-width:none!important;overflow:visible!important;text-overflow:clip!important;}
  tbody tr td:last-child{border-bottom:none;}
  tbody tr td[data-label]:before{content:attr(data-label);display:block;font-size:11px;font-weight:bold;color:#999;margin-bottom:2px;}
  tbody tr td[data-label="名前"]:before{display:none;}
}
</style>
</head><body>
<header><h1>👥 メンバー一覧</h1>${navHtml(req.session.adminDisplayName)}</header>
<div class="container">
  <form method="get" action="/admin/members">
    <input type="hidden" name="sort" value="${sortKey}">
    <input type="hidden" name="dir" value="${sortDir}">
    <div class="filter-bar">
      <input type="text" name="keyword" value="${filterKeyword}" placeholder="🔍 キーワード検索（名前・事業所・備考・タグ）" style="flex:1;min-width:200px;">
      <select name="workplace">
        <option value="">すべての事業所</option>
        ${workplaceOptions}
      </select>
      <select name="residence">
        <option value="">すべての在留資格</option>
        ${residenceOptions}
      </select>
      <button type="submit">検索</button>
      <a href="/admin/members">リセット</a>
    </div>
  </form>
  <div style="margin-bottom:8px;font-size:14px;color:#555;">
    全 <strong>${members.length}</strong> 名中 <strong>${filtered.length}</strong> 名表示
    <span class="count-badge">未対応あり: ${filtered.filter(m => m.unread > 0).length} 名</span>
  </div>
  <table>
    <thead><tr>
      <th>${sortLink('name', '名前')}</th>
      <th>${sortLink('workplace', '所属事業所')}</th>
      <th>${sortLink('residenceStatus', '在留資格')}</th>
      <th>${sortLink('entryDate', '入国日')}</th>
      <th>${sortLink('count', '件数')}</th>
      <th>${sortLink('unread', '未対応')}</th>
      <th>${sortLink('lastDateRaw', '最終日時')}</th>
      <th>備考</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
</body></html>`);
});

module.exports = router;
