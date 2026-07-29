const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { requireAuth } = require('../helpers/auth');
const { sendMessage, getAttachmentType, resolveMessagingParams } = require('../helpers/facebook');
const { avatarHtml, attachmentHtml, messengerLinkHtml, navHtml, commonCss, pwaHtml } = require('../helpers/html');
const { uploadToCloudinary } = require('../helpers/cloudinary');
const { resolveAllUnread } = require('../helpers/messages');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_SIZE = 50;

// 新着メッセージAPI
router.get('/messages/new', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  try {
    const after = req.query.after;
    const snapshot = await db.collection('messages').orderBy('createdAt', 'desc').limit(20).get();
    const senderIds = [...new Set(snapshot.docs.map(d => d.data().senderId).filter(Boolean))];
    const profileMap = {};
    await Promise.all(senderIds.map(async sid => {
      const doc = await db.collection('contacts').doc(sid).get();
      if (doc.exists) profileMap[sid] = doc.data();
    }));
    const messages = [];
    for (const doc of snapshot.docs) {
      const d = doc.data();
      if (!d.createdAt) continue;
      const createdAtISO = d.createdAt.toDate().toISOString();
      if (after && createdAtISO <= after) continue;
      const profile = profileMap[d.senderId] || {};
      messages.push({
        docId: doc.id, senderId: d.senderId,
        senderName: profile.passportName || d.senderName || '不明',
        senderPicture: d.senderPicture || null,
        message: d.message || '', status: d.status || '未対応',
        workplace: profile.workplace || '', residenceStatus: profile.residenceStatus || '',
        date: d.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        createdAtISO
      });
    }
    res.json({ messages });
  } catch (err) { res.json({ messages: [], error: err.message }); }
});

// 問い合わせ一覧（登録者ごとにスレッド化。最新メッセージがある登録者が上に来る）
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * PAGE_SIZE;
  const filterKeyword = req.query.keyword || '';
  const filterWorkplace = req.query.workplace || '';
  const filterResidence = req.query.residence || '';
  const filterStatus = req.query.status || '';

  // 全メッセージを新しい順で取得し、送信者ごとにグループ化する
  // Map を使うことで、送信者ID（数字の文字列）でも挿入順（＝時系列の新しい順）が保たれる
  const allSnapshot = await db.collection('messages').orderBy('createdAt', 'desc').get();
  const threadsMap = new Map();

  allSnapshot.docs.forEach(doc => {
    const d = doc.data();
    const sid = d.senderId;
    if (!sid) return;
    if (!threadsMap.has(sid)) {
      threadsMap.set(sid, {
        senderId: sid,
        latestDoc: doc,          // 全体で一番新しいメッセージ（並び順用。ユーザー/管理者どちらでも）
        latestData: d,
        latestUserData: null,    // ユーザーから最後に受信したメッセージ
        latestAdminData: null,   // 管理者が最後に送った返信
        count: 0,
        unreadCount: 0,
        replyTargetDoc: null     // 未対応の中で一番新しいメッセージ（返信対象）
      });
    }
    const t = threadsMap.get(sid);
    t.count++;
    if (d.status === '未対応') {
      t.unreadCount++;
      if (!t.replyTargetDoc) t.replyTargetDoc = doc;
    }
    if (d.isAdminSent) {
      if (!t.latestAdminData) t.latestAdminData = d;
    } else {
      if (!t.latestUserData) t.latestUserData = d;
    }
  });

  const allThreads = Array.from(threadsMap.values()); // すでに最新順

  // contactsは全件まとめて取得（都度個別取得よりも高速で、絞り込み用ドロップダウンの
  // 選択肢もページに関係なく全体から作れる）
  const contactsSnapshot = await db.collection('contacts').get();
  const profileMap = {};
  contactsSnapshot.docs.forEach(doc => { profileMap[doc.id] = doc.data(); });

  // 絞り込みドロップダウンの選択肢（全スレッド分から重複無しで作成）
  const workplaceSet = new Set();
  const residenceSet = new Set();
  allThreads.forEach(t => {
    const p = profileMap[t.senderId] || {};
    if (p.workplace) workplaceSet.add(p.workplace);
    if (p.residenceStatus) residenceSet.add(p.residenceStatus);
  });
  const workplaceOptions = [...workplaceSet].sort().map(w => '<option value="' + w + '" ' + (filterWorkplace === w ? 'selected' : '') + '>' + w + '</option>').join('');
  const residenceOptions = [...residenceSet].sort().map(r => '<option value="' + r + '" ' + (filterResidence === r ? 'selected' : '') + '>' + r + '</option>').join('');

  // 絞り込み（キーワード・事業所・在留資格・ステータス）をページングの前に適用する。
  // これをしないと「2ページ目には絞り込みが引き継がれない」問題が起きるため。
  const kwLower = filterKeyword.toLowerCase();
  const threads = allThreads.filter(t => {
    const profile = profileMap[t.senderId] || {};
    const fbName = (t.latestUserData ? t.latestUserData.senderName : t.latestData.senderName) || '不明';
    const registeredName = profile.passportName || '';
    const primaryName = registeredName || fbName;
    const userMessage = t.latestUserData ? (t.latestUserData.message || '') : '';
    const statusLabel = t.unreadCount > 0 ? '未対応' : '対応済み';

    if (filterWorkplace && (profile.workplace || '') !== filterWorkplace) return false;
    if (filterResidence && (profile.residenceStatus || '') !== filterResidence) return false;
    if (filterStatus && statusLabel !== filterStatus) return false;
    if (kwLower) {
      const haystack = (primaryName + ' ' + fbName + ' ' + (profile.workplace || '') + ' ' + (profile.residenceStatus || '') + ' ' + userMessage).toLowerCase();
      if (!haystack.includes(kwLower)) return false;
    }
    return true;
  });

  const totalCount = threads.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageThreads = threads.slice(offset, offset + PAGE_SIZE);

  const latestISO = allSnapshot.size > 0 && allSnapshot.docs[0].data().createdAt
    ? allSnapshot.docs[0].data().createdAt.toDate().toISOString() : '';

  const rows = pageThreads.map(t => {
    const d = t.latestData;
    const userData = t.latestUserData;   // ユーザーの最新メッセージ（無い場合はnull）
    const adminData = t.latestAdminData; // 管理者の最新返信（無い場合はnull）
    const sid = t.senderId;
    const profile = profileMap[sid] || {};
    const fbName = (userData ? userData.senderName : d.senderName) || '不明';
    const registeredName = profile.passportName || '';
    // 登録名があれば登録名を主表示にし、FB名は補足として小さく出す。
    // 登録名が無ければFB名（または候補があればその旨）を主表示にする。
    const primaryName = registeredName || fbName;
    const secondaryLabel = registeredName
      ? 'FBアカウント名：' + fbName
      : (profile.nameCandidate ? '登録名：未登録（候補：' + profile.nameCandidate + '）' : '登録名：未登録');
    const displayName = primaryName; // 検索用・並び替え用に使う代表名
    // 受信日時：ユーザーから最後に受信した日時（無ければ全体の最新日時にフォールバック）
    const dateSource = userData || d;
    const date = dateSource.createdAt ? dateSource.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明';
    // ステータス：未対応のメッセージが残っているかどうかで判定する
    const statusLabel = t.unreadCount > 0 ? '未対応' : '対応済み';
    const statusColor = t.unreadCount > 0 ? '#e74c3c' : '#27ae60';
    // メッセージ欄：ユーザーが最後に送ってきた内容（管理者の返信と混ざらないようにする）
    const userMessageHtml = userData ? (userData.message || '—') : '—';
    // 返信メッセージ欄：管理者が最後に返信した内容
    const replyHtml = adminData && (adminData.replyMessage || adminData.attachmentName)
      ? (adminData.replyMessage || '') + (adminData.attachmentName ? '<br><small>📎 ' + adminData.attachmentName + '</small>' : '')
      : '—';
    const replyAdminName = adminData ? (adminData.replyAdmin || '—') : '—';

    const unreadBadge = t.unreadCount > 0
      ? '<span style="background:#e74c3c;color:white;border-radius:12px;padding:1px 7px;font-size:11px;margin-left:6px;">' + t.unreadCount + '</span>'
      : '';
    const countBadge = '<span style="color:#999;font-size:12px;margin-left:6px;">(' + t.count + '件)</span>';

    // 返信対象：未対応メッセージがあればそれを更新（mode=update）、無ければ新規メッセージとして送信（mode=new）
    const replyDocId = t.replyTargetDoc ? t.replyTargetDoc.id : null;
    const mode = replyDocId ? 'update' : 'new';
    const formId = replyDocId || ('new_' + sid); // フォーム要素のID生成に使う一意な値

    const replyBtn = '<button onclick="openReply(\'' + formId + '\')" style="background:#2980b9;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">返信</button>';

    const replyForm = '<tr id="reply-' + formId + '" style="display:none;background:#f0f7ff;">'
        + '<td colspan="9" style="padding:12px;">'
        + '<div style="margin-bottom:8px;">'
        + '<label style="font-size:12px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">📋 定型文を使う</label>'
        + '<select id="tplSelect-' + formId + '" onchange="applyTemplate(this,\'text-' + formId + '\')" onfocus="loadTemplatesInto(this)" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;max-width:350px;width:100%;"><option value="">📋 定型文を選択...</option></select>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">'
        + '<div>'
        + '<label style="font-size:12px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">📝 日本語（入力）</label>'
        + '<textarea id="text-' + formId + '" rows="3" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;" placeholder="' + (mode === 'update' ? '返信メッセージを入力（任意）...' : '送信するメッセージを入力...') + '"></textarea>'
        + '<br><button onclick="translateAdminReply(\'' + formId + '\')" style="margin-top:4px;font-size:12px;padding:4px 10px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;">🌐 英訳する</button>'
        + '</div>'
        + '<div>'
        + '<label style="font-size:12px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">🌐 英語訳（自動）</label>'
        + '<textarea id="translated-' + formId + '" rows="3" style="width:100%;padding:8px;border:1px solid #27ae60;border-radius:4px;font-size:14px;box-sizing:border-box;background:#f9fff9;" placeholder="英訳がここに表示されます..."></textarea>'
        + '<div style="margin-top:4px;font-size:11px;color:#888;">※ 編集して送信も可能です</div>'
        + '</div>'
        + '</div>'
        + '<div style="margin-bottom:8px;">'
        + '<label style="font-size:12px;color:#555;font-weight:bold;">送信言語：</label>'
        + '<label style="font-size:13px;margin-left:8px;cursor:pointer;"><input type="radio" name="lang-' + formId + '" value="ja" checked> 日本語</label>'
        + '<label style="font-size:13px;margin-left:12px;cursor:pointer;"><input type="radio" name="lang-' + formId + '" value="en"> 英語訳</label>'
        + '<label style="font-size:13px;margin-left:12px;cursor:pointer;"><input type="radio" name="lang-' + formId + '" value="both"> 両方送信</label>'
        + '</div>'
        + '<div style="margin-bottom:8px;">'
        + '<label style="font-size:13px;color:#555;font-weight:bold;">📎 添付ファイル：</label>'
        + '<input type="file" id="file-' + formId + '" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:13px;margin-left:8px;">'
        + '<small style="color:#888;display:block;margin-top:4px;">画像・PDF・Word・Excel（最大25MB）</small>'
        + '</div>'
        + '<small style="color:#888;margin-top:4px;display:block;">※ 送信時に署名が自動付加されます</small>'
        + '<div style="margin-top:10px;">'
        + '<button onclick="sendReply(\'' + formId + '\',\'' + sid + '\',\'' + mode + '\')" style="background:#27ae60;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:8px;">送信</button>'
        + '<button onclick="closeReply(\'' + formId + '\')" style="background:#95a5a6;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">キャンセル</button>'
        + '<span id="result-' + formId + '" style="margin-left:12px;font-weight:bold;"></span>'
        + '</div>'
        + '<div style="border-top:1px solid #ddd;margin-top:14px;padding-top:10px;">'
        + '<label style="font-size:12px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">🗳️ この相手にアンケートを送る（上の返信とは別に送信できます）</label>'
        + '<select id="surveySelect-' + formId + '" onfocus="loadSurveyOptionsInto(this)" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;max-width:300px;width:100%;margin-right:6px;"><option value="">アンケートを選択...</option></select>'
        + '<button onclick="sendSurveyTo(\'' + sid + '\',\'surveySelect-' + formId + '\',\'surveyResult-' + formId + '\')" style="background:#8e44ad;color:white;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px;">送信</button>'
        + '<span id="surveyResult-' + formId + '" style="margin-left:10px;font-size:13px;font-weight:bold;"></span>'
        + '</div>'
        + '</td></tr>';

    return '<tr class="msg-row" data-search="' + fbName + ' ' + registeredName + ' ' + (profile.workplace || '') + ' ' + userMessageHtml + ' ' + (profile.residenceStatus || '') + '" data-docid="' + formId + '" data-workplace="' + (profile.workplace || '') + '" data-residence="' + (profile.residenceStatus || '') + '">'
      + '<td data-label="受信日時">' + date + '</td>'
      + '<td data-label="名前"><a href="/admin/contacts/' + sid + '" style="color:#2980b9;text-decoration:none;display:flex;align-items:flex-start;">' + avatarHtml(primaryName, dateSource.senderPicture)
      + '<div><div style="font-weight:bold;">' + primaryName + unreadBadge + countBadge + '</div>'
      + '<div style="font-size:12px;color:#888;margin-top:2px;">' + secondaryLabel + '</div>'
      + '<div style="font-size:11px;color:#aaa;margin-top:1px;">ID: ' + sid + '</div></div>'
      + '</a></td>'
      + '<td data-label="所属事業所">' + (profile.workplace || '—') + '</td>'
      + '<td data-label="在留資格">' + (profile.residenceStatus || '—') + '</td>'
      + '<td data-label="メッセージ">' + userMessageHtml + '</td>'
      + '<td data-label="返信メッセージ">' + replyHtml + '</td>'
      + '<td data-label="返信した管理者">' + replyAdminName + '</td>'
      + '<td data-label="ステータス" style="color:' + statusColor + ';font-weight:bold;">' + statusLabel + '</td>'
      + '<td data-label="操作">' + replyBtn + '</td>'
      + '</tr>' + replyForm;
  }).join('');

  // ページネーションHTML（絞り込み条件を維持したままページ送りする）
  function pageUrl(p) {
    const params = new URLSearchParams({ page: p, keyword: filterKeyword, workplace: filterWorkplace, residence: filterResidence, status: filterStatus });
    return '/admin?' + params.toString();
  }
  let paginationHtml = '<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap;">';
  if (page > 1) {
    paginationHtml += '<a href="' + pageUrl(page - 1) + '" style="padding:8px 16px;background:#2980b9;color:white;border-radius:4px;text-decoration:none;">← 前へ</a>';
  }
  for (let i = 1; i <= totalPages; i++) {
    if (i === page) {
      paginationHtml += '<span style="padding:8px 14px;background:#2c3e50;color:white;border-radius:4px;">' + i + '</span>';
    } else if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      paginationHtml += '<a href="' + pageUrl(i) + '" style="padding:8px 14px;background:white;color:#2980b9;border:1px solid #2980b9;border-radius:4px;text-decoration:none;">' + i + '</a>';
    } else if (i === page - 3 || i === page + 3) {
      paginationHtml += '<span style="padding:8px 4px;color:#888;">...</span>';
    }
  }
  if (page < totalPages) {
    paginationHtml += '<a href="' + pageUrl(page + 1) + '" style="padding:8px 16px;background:#2980b9;color:white;border-radius:4px;text-decoration:none;">次へ →</a>';
  }
  paginationHtml += '</div>';
  paginationHtml += '<div style="text-align:center;margin-top:8px;font-size:13px;color:#888;">'
    + '全 ' + totalCount + ' 名中 ' + (totalCount === 0 ? 0 : offset+1) + '〜' + Math.min(offset+PAGE_SIZE, totalCount) + ' 名表示'
    + '（' + page + ' / ' + totalPages + ' ページ）</div>';

  const script = `
<script>
var latestISO = '${latestISO}';

var __templatesCache = null;
async function loadTemplatesInto(selectEl) {
  if (__templatesCache) return; // 一度読み込んだら再取得しない
  try {
    var res = await fetch('/admin/profile/templates');
    var data = await res.json();
    __templatesCache = data.templates || [];
  } catch(e) { __templatesCache = []; }
  document.querySelectorAll("select[id^='tplSelect-']").forEach(function(sel) {
    var current = sel.value;
    sel.innerHTML = '<option value="">📋 定型文を選択...</option>' + __templatesCache.map(function(t, i) {
      return '<option value="' + i + '">' + t.title + '</option>';
    }).join('');
    sel.value = current;
  });
}
function applyTemplate(selectEl, textareaId) {
  var idx = selectEl.value;
  if (idx === '' || !__templatesCache) return;
  var t = __templatesCache[idx];
  if (t) document.getElementById(textareaId).value = t.body;
  selectEl.value = '';
}

var __surveysCache = null;
async function loadSurveyOptionsInto(selectEl) {
  if (__surveysCache) return;
  try {
    var res = await fetch('/admin/surveys/list-json');
    var data = await res.json();
    __surveysCache = data.surveys || [];
  } catch(e) { __surveysCache = []; }
  document.querySelectorAll("select[id^='surveySelect-']").forEach(function(sel) {
    var current = sel.value;
    sel.innerHTML = '<option value="">アンケートを選択...</option>' + __surveysCache.map(function(s) {
      return '<option value="' + s.id + '">' + s.title + '</option>';
    }).join('');
    sel.value = current;
  });
}
async function sendSurveyTo(senderId, selectId, resultId) {
  var select = document.getElementById(selectId);
  var surveyId = select.value;
  var result = document.getElementById(resultId);
  if (!surveyId) { result.textContent = '△ アンケートを選択してください'; result.style.color = 'orange'; return; }
  if (!confirm('このアンケートを送信しますか？')) return;
  result.textContent = '送信中...'; result.style.color = 'gray';
  try {
    var res = await fetch('/admin/surveys/' + surveyId + '/send-one', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderId: senderId })
    });
    var data = await res.json();
    if (data.success) { result.textContent = '✅ 送信しました'; result.style.color = 'green'; }
    else { result.textContent = '✗ 失敗: ' + data.error; result.style.color = 'red'; }
  } catch(e) { result.textContent = '✗ エラー: ' + e.message; result.style.color = 'red'; }
}

function openReply(docId) {
  var row = document.getElementById('reply-' + docId);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

function closeReply(docId) {
  var row = document.getElementById('reply-' + docId);
  if (row) row.style.display = 'none';
}

async function translateAdminReply(docId) {
  var text = document.getElementById('text-' + docId).value.trim();
  if (!text) { alert('翻訳するテキストを入力してください'); return; }
  var transEl = document.getElementById('translated-' + docId);
  transEl.value = '翻訳中...';
  try {
    var res = await fetch('/admin/translate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ text: text, targetLang: 'EN' })
    });
    var data = await res.json();
    transEl.value = data.success ? data.text : '翻訳失敗';
  } catch(e) {
    transEl.value = 'エラー: ' + e.message;
  }
}

async function sendReply(formId, senderId, mode) {
  var langEl = document.querySelector('input[name="lang-' + formId + '"]:checked');
  var lang = langEl ? langEl.value : 'ja';
  var jaText = document.getElementById('text-' + formId).value.trim();
  var enText = document.getElementById('translated-' + formId).value.trim();
  var fileInput = document.getElementById('file-' + formId);
  var result = document.getElementById('result-' + formId);
  var sendText = lang === 'ja' ? jaText : lang === 'en' ? enText : jaText + (enText ? '\\n\\n' + enText : '');
  if (!sendText && (!fileInput.files || fileInput.files.length === 0)) {
    result.textContent = '△ メッセージまたはファイルを入力してください';
    result.style.color = 'orange'; return;
  }
  result.textContent = '送信中...'; result.style.color = 'gray';
  try {
    var res;
    if (mode === 'update') {
      var formData = new FormData();
      formData.append('docId', formId);
      formData.append('senderId', senderId);
      formData.append('message', sendText);
      if (fileInput.files && fileInput.files.length > 0) formData.append('file', fileInput.files[0]);
      res = await fetch('/admin/reply', { method: 'POST', body: formData });
    } else {
      var formData2 = new FormData();
      formData2.append('message', sendText);
      if (fileInput.files && fileInput.files.length > 0) formData2.append('file', fileInput.files[0]);
      res = await fetch('/admin/contacts/' + senderId + '/send', { method: 'POST', body: formData2 });
    }
    var data = await res.json();
    if (data.success && data.warning) {
      result.textContent = '⚠️ ' + data.warning; result.style.color = '#9c640c';
      setTimeout(function(){ location.reload(); }, 2500);
    } else if (data.success) {
      result.textContent = '✅ 送信完了！'; result.style.color = 'green';
      setTimeout(function(){ location.reload(); }, 1500);
    } else {
      result.textContent = '✗ 送信失敗: ' + data.error; result.style.color = 'red';
    }
  } catch(e) {
    result.textContent = '✗ エラー: ' + e.message; result.style.color = 'red';
  }
}

async function checkNewMessages() {
  try {
    var res = await fetch('/admin/messages/new?after=' + encodeURIComponent(latestISO));
    var data = await res.json();
    if (data.messages && data.messages.length > 0) {
      latestISO = data.messages[0].createdAtISO;
      location.reload();
    }
  } catch(e) {}
}
setInterval(checkNewMessages, 60000);
</script>`;

  res.send('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">'
    + '<link rel="icon" href="https://www.facebook.com/favicon.ico">'
    + (typeof pwaHtml === 'function' ? pwaHtml() : '')
    + '<title>問い合わせ管理画面</title>'
    + '<style>' + commonCss()
    + '.search-bar{display:flex;gap:8px;margin-bottom:16px;align-items:center;background:white;padding:12px 16px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);flex-wrap:wrap;}'
    + '.search-bar input{flex:1;min-width:200px;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;}'
    + '.search-bar select{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;}'
    + '.btn-clear{padding:8px 14px;background:#95a5a6;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;text-decoration:none;display:inline-block;}'
    + '.btn-search{padding:8px 16px;background:#2980b9;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;}'
    + '.search-count{font-size:14px;color:#555;}'
    + 'table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + 'th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;font-size:13px;}'
    + 'td{padding:12px 16px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top;}'
    + 'tr.msg-row:hover td{background:#f8f9fa;}'
    + '@media (max-width:768px){'
    + '.container{padding:8px;}'
    + '.search-bar{padding:10px;gap:6px;}'
    + '.search-bar input,.search-bar select,.btn-clear,.btn-search{width:100%;min-width:0;flex:none;box-sizing:border-box;text-align:center;}'
    + '.search-count{width:100%;text-align:right;}'
    + 'table,thead,tbody{display:block;width:100%;}'
    + 'thead{display:none;}'
    + 'tr.msg-row{display:block;background:white;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,0.12);margin-bottom:10px;padding:10px 14px;}'
    + 'tr.msg-row td{display:block;padding:6px 0;border-bottom:1px solid #f0f0f0;}'
    + 'tr.msg-row td:last-child{border-bottom:none;}'
    + 'tr.msg-row td[data-label]:before{content:attr(data-label);display:block;font-size:11px;font-weight:bold;color:#999;margin-bottom:2px;}'
    + 'tr.msg-row td[data-label="名前"]:before{display:none;}'
    + 'tr[id^="reply-"] td{display:block;padding:0;border:none;}'
    + '}'
    + '</style></head><body>'
    + '<header><h1>📋 問い合わせ管理画面</h1>' + navHtml(req.session.adminDisplayName) + '</header>'
    + '<div class="container" style="overflow-x:auto;">'
    + '<form method="get" action="/admin">'
    + '<div class="search-bar">'
    + '<input type="text" name="keyword" value="' + filterKeyword + '" placeholder="🔍 名前・メッセージ・事業所・在留資格で検索...">'
    + '<select name="workplace"><option value="">すべての事業所</option>' + workplaceOptions + '</select>'
    + '<select name="residence"><option value="">すべての在留資格</option>' + residenceOptions + '</select>'
    + '<select name="status"><option value="">すべてのステータス</option><option value="未対応" ' + (filterStatus === '未対応' ? 'selected' : '') + '>未対応</option><option value="対応済み" ' + (filterStatus === '対応済み' ? 'selected' : '') + '>対応済み</option></select>'
    + '<button type="submit" class="btn-search">絞り込み</button>'
    + '<a href="/admin" class="btn-clear">× クリア</a>'
    + '<span class="search-count">' + totalCount + ' 名</span>'
    + '</div>'
    + '</form>'
    + '<table><thead><tr>'
    + '<th>受信日時</th><th>名前</th><th>所属事業所</th><th>在留資格</th>'
    + '<th>メッセージ</th><th>返信メッセージ</th><th>返信した管理者</th><th>ステータス</th><th>操作</th>'
    + '</tr></thead>'
    + '<tbody id="msgTable">' + rows + '</tbody></table>'
    + paginationHtml
    + '</div>'
    + script
    + '</body></html>');
});

// 返信API
router.post('/reply', requireAuth, upload.single('file'), async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { docId, senderId, message } = req.body;
  try {
    const docRef = db.collection('messages').doc(docId);
    const doc = await docRef.get();
    if (!doc.exists) return res.json({ success: false, error: 'メッセージが見つかりません' });

    // 署名をセッションから取得（なければFirestoreから取得）
    let signature = req.session.adminSignature || '';
    if (!signature) {
      try {
        const adminSnapshot = await db.collection('admins').where('userId', '==', req.session.adminId).limit(1).get();
        if (!adminSnapshot.empty) {
          signature = adminSnapshot.docs[0].data().signature || '';
          req.session.adminSignature = signature;
        }
      } catch (e) {}
    }

    // 署名込みのテキストを作成
    const replyText = (message || '') + (signature ? '\n\n' + signature : '');

    // テキストを先に送信する（本文はできるだけ確実に届けるため、添付より先に処理する）
    if (replyText.trim()) {
      try {
        // 管理者が手動で書いた返信のため、HUMAN_AGENTタグで送信（24時間ルールを超えて最大7日間送信可能）
        await sendMessage(senderId, replyText, 'HUMAN_AGENT');
      } catch (textErr) {
        const fbError = textErr.response && textErr.response.data && textErr.response.data.error;
        console.error('返信エラー（本文）:', senderId, fbError ? JSON.stringify(fbError) : textErr.message);
        return res.json({ success: false, error: fbError ? fbError.message : textErr.message });
      }
    }

    // 添付ファイル送信（Cloudinaryにアップロードして公開URLをMessengerに渡す）
    // 注意：本文はすでに届いているため、ここで失敗しても処理を打ち切らない
    let attachmentName = null;
    let attachmentType = null;
    let attachmentUrl = null;
    let attachmentPublicId = null;
    let attachmentResourceType = null;
    let attachmentSendFailed = false;
    let attachmentSendError = null;

    if (req.file) {
      try {
        const fileType = getAttachmentType(req.file.mimetype);
        attachmentName = req.file.originalname;
        attachmentType = fileType;

        const uploaded = await uploadToCloudinary(req.file.buffer, req.file.originalname, req.file.mimetype);
        attachmentUrl = uploaded.url;
        attachmentPublicId = uploaded.publicId;
        attachmentResourceType = uploaded.resourceType;

        const msgUrl = 'https://graph.facebook.com/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN;
        const msgRes = await axios.post(msgUrl, {
          recipient: { id: senderId },
          message: { attachment: { type: fileType, payload: { url: attachmentUrl, is_reusable: true } } },
          ...resolveMessagingParams('HUMAN_AGENT')
        });
        if (msgRes.data && msgRes.data.error) {
          attachmentSendFailed = true;
          attachmentSendError = msgRes.data.error.message;
        }
      } catch (attachErr) {
        const fbError = attachErr.response && attachErr.response.data && attachErr.response.data.error;
        attachmentSendFailed = true;
        attachmentSendError = fbError ? fbError.message : attachErr.message;
      }
      if (attachmentSendFailed) {
        console.error('添付送信エラー詳細:', senderId, attachmentSendError);
        attachmentUrl = null;
        attachmentPublicId = null;
      }
    }

    await docRef.update({
      status: '対応済み',
      replyMessage: replyText,
      replyAdmin: req.session.adminDisplayName || '管理者',
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      attachmentName: attachmentSendFailed ? null : attachmentName,
      attachmentType,
      attachmentUrl,
      attachmentPublicId,
      attachmentResourceType,
      hasAttachment: !attachmentSendFailed && !!attachmentPublicId,
      attachmentDeleted: false
    });

    // 連続して複数メッセージが届いていた場合、この返信でまとめて未対応を解消する
    try {
      const resolvedCount = await resolveAllUnread(db, senderId, docId);
      if (resolvedCount > 0) console.log('未対応をまとめて解消:', senderId, resolvedCount + '件');
    } catch (e) {
      console.error('未対応一括解消エラー:', senderId, e.message);
    }

    if (attachmentSendFailed) {
      return res.json({ success: true, warning: '本文は届きましたが、添付ファイルの送信に失敗しました: ' + attachmentSendError });
    }

    res.json({ success: true });
  } catch (err) {
    const fbError = err.response && err.response.data && err.response.data.error;
    console.error('返信エラー:', senderId, fbError ? JSON.stringify(fbError) : err.message);
    res.json({ success: false, error: fbError ? fbError.message : err.message });
  }
});

// 添付ファイル自動削除ジョブの手動実行（動作確認用）
// ブラウザでログイン後に /admin/attachments/cleanup-now を開くと、即座に実行して結果が画面に表示されます
router.get('/attachments/cleanup-now', requireAuth, async (req, res) => {
  try {
    const { cleanupOldAttachments, RETENTION_DAYS } = require('../helpers/cleanup');
    const db = req.app.get('db');
    const admin = req.app.get('adminSdk');
    const result = await cleanupOldAttachments(db, admin);
    res.send(
      '<h2>添付ファイル自動削除（手動実行）</h2>'
      + '<p>保持期間: ' + RETENTION_DAYS + '日</p>'
      + '<p>削除成功: ' + result.deletedCount + '件</p>'
      + '<p>失敗: ' + result.errorCount + '件</p>'
      + '<p>スキップ（まだ期間内 等）: ' + result.skippedCount + '件</p>'
      + '<p><a href="/admin">一覧に戻る</a></p>'
    );
  } catch (err) {
    res.status(500).send('エラー: ' + err.message);
  }
});

// 過去分の未対応クリーンアップ（一回限りの手動実行用）
// 「連続メッセージへの返信で未対応をまとめて解消する」修正より前に取り残された、
// 実際にはすでに返信済みのはずの未対応メッセージだけを解消します。
// まだ一度も返信していない本当に未対応のメッセージには触れません。
router.get('/messages/resolve-stale-unread', requireAuth, async (req, res) => {
  try {
    const { resolveStaleUnread } = require('../helpers/messages');
    const db = req.app.get('db');
    const result = await resolveStaleUnread(db);
    res.send(
      '<h2>過去分の未対応クリーンアップ（手動実行）</h2>'
      + '<p>チェックした未対応メッセージ数: ' + result.totalChecked + '件</p>'
      + '<p>対応済みに変更: ' + result.resolvedCount + '件</p>'
      + '<p>そのまま未対応で残した（本当に未返信）: ' + result.stillUnreadCount + '件</p>'
      + '<p><a href="/admin">一覧に戻る</a></p>'
    );
  } catch (err) {
    res.status(500).send('エラー: ' + err.message);
  }
});

module.exports = router;
