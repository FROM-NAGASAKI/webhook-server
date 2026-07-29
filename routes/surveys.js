const express = require('express');
const router = express.Router();
const { requireAuth } = require('../helpers/auth');
const { navHtml, commonCss, avatarHtml } = require('../helpers/html');
const { startSurvey } = require('../helpers/surveyEngine');
const { HUMAN_AGENT_APPROVED } = require('../helpers/facebook');

// アンケート一覧
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const snapshot = await db.collection('surveys').orderBy('createdAt', 'desc').get();
  const surveys = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

  const rows = surveys.map(s => {
    const qCount = (s.questions || []).length;
    return '<tr>'
      + '<td data-label="タイトル"><strong>' + (s.title || '（無題）') + '</strong></td>'
      + '<td data-label="質問数">' + qCount + ' 問</td>'
      + '<td data-label="作成者">' + (s.createdBy || '不明') + '</td>'
      + '<td data-label="作成日">' + (s.createdAt ? s.createdAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明') + '</td>'
      + '<td data-label="操作">'
      + '<a href="/admin/surveys/' + s.id + '/send" style="padding:6px 12px;background:#2980b9;color:white;border-radius:4px;text-decoration:none;font-size:13px;margin-right:6px;display:inline-block;margin-bottom:4px;">📤 送信</a>'
      + '<a href="/admin/surveys/' + s.id + '/results" style="padding:6px 12px;background:#27ae60;color:white;border-radius:4px;text-decoration:none;font-size:13px;margin-right:6px;display:inline-block;margin-bottom:4px;">📊 結果</a>'
      + '<a href="/admin/surveys/' + s.id + '/edit" style="padding:6px 12px;background:#95a5a6;color:white;border-radius:4px;text-decoration:none;font-size:13px;margin-right:6px;display:inline-block;margin-bottom:4px;">✏️ 編集</a>'
      + '<button onclick="deleteSurvey(\'' + s.id + '\')" style="padding:6px 12px;background:#e74c3c;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;display:inline-block;margin-bottom:4px;">🗑️ 削除</button>'
      + '</td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:#888;padding:24px;">まだアンケートがありません</td></tr>';

  res.send(pageShell('📊 アンケート管理', req.session.adminDisplayName, `
    <div class="card">
      <h3 style="margin-top:0;color:#2c3e50;">➕ 新規アンケート作成</h3>
      <label>タイトル</label>
      <input type="text" id="newTitle" placeholder="例：住居に関する満足度調査">
      <div id="questionList"></div>
      <button type="button" onclick="addQuestion()" style="background:#95a5a6;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;margin-bottom:12px;">➕ 質問を追加</button>
      <br>
      <button onclick="createSurvey()" style="background:#2980b9;color:white;border:none;padding:10px 24px;border-radius:4px;cursor:pointer;font-size:15px;font-weight:bold;">💾 アンケートを作成</button>
      <span id="createMsg" style="margin-left:12px;font-weight:bold;"></span>
    </div>

    <div class="card">
      <h3 style="margin-top:0;color:#2c3e50;">📋 アンケート一覧</h3>
      <table><thead><tr><th>タイトル</th><th>質問数</th><th>作成日</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
  `, `
    var qIndex = 0;
    function addQuestion(text, options) {
      var container = document.getElementById('questionList');
      var id = 'q' + qIndex;
      var div = document.createElement('div');
      div.style.cssText = 'background:#f9f9f9;border:1px solid #eee;border-radius:6px;padding:12px;margin-bottom:10px;';
      div.innerHTML =
        '<label>質問文</label>' +
        '<input type="text" class="q-text" placeholder="例：現在の住居に満足していますか？" value="' + (text ? text.replace(/"/g, '&quot;') : '') + '">' +
        '<label>選択肢（カンマ区切り。例：とても満足,満足,普通,不満,とても不満）</label>' +
        '<input type="text" class="q-options" placeholder="例：1,2,3,4,5" value="' + (options ? options.replace(/"/g, '&quot;') : '') + '">' +
        '<button type="button" onclick="this.parentElement.remove()" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;">この質問を削除</button>';
      div.id = id;
      container.appendChild(div);
      qIndex++;
    }
    addQuestion(); // 初期状態で1問分のフォームを表示

    async function createSurvey() {
      var msg = document.getElementById('createMsg');
      var title = document.getElementById('newTitle').value.trim();
      var qDivs = document.querySelectorAll('#questionList > div');
      var questions = [];
      qDivs.forEach(function(div, i) {
        var text = div.querySelector('.q-text').value.trim();
        var optionsRaw = div.querySelector('.q-options').value.trim();
        if (!text || !optionsRaw) return;
        var options = optionsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean).map(function(s) {
          return { label: s, value: s };
        });
        questions.push({ id: 'q' + i, text: text, options: options });
      });
      if (!title) { msg.textContent = '△ タイトルを入力してください'; msg.style.color = 'orange'; return; }
      if (questions.length === 0) { msg.textContent = '△ 質問を1つ以上入力してください'; msg.style.color = 'orange'; return; }
      msg.textContent = '作成中...'; msg.style.color = 'gray';
      try {
        var res = await fetch('/admin/surveys/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title, questions: questions })
        });
        var data = await res.json();
        if (data.success) { msg.textContent = '✅ 作成しました'; msg.style.color = 'green'; setTimeout(function(){ location.reload(); }, 800); }
        else { msg.textContent = '✗ 失敗: ' + data.error; msg.style.color = 'red'; }
      } catch(e) { msg.textContent = '✗ エラー: ' + e.message; msg.style.color = 'red'; }
    }

    async function deleteSurvey(id) {
      if (!confirm('このアンケートを削除しますか？（回答結果は残ります）')) return;
      try {
        var res = await fetch('/admin/surveys/' + id + '/delete', { method: 'POST' });
        var data = await res.json();
        if (data.success) location.reload();
        else alert('削除失敗: ' + data.error);
      } catch(e) { alert('エラー: ' + e.message); }
    }
  `));
});

// アンケート作成API
router.post('/create', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { title, questions } = req.body;
  if (!title || !questions || questions.length === 0) {
    return res.json({ success: false, error: 'タイトルと質問が必要です' });
  }
  try {
    await db.collection('surveys').add({
      title, questions,
      createdBy: req.session.adminDisplayName || '管理者',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 編集画面
router.get('/:surveyId/edit', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const surveyDoc = await db.collection('surveys').doc(req.params.surveyId).get();
  if (!surveyDoc.exists) return res.status(404).send('アンケートが見つかりません');
  const survey = surveyDoc.data();

  const questionsJson = JSON.stringify(survey.questions || []).replace(/</g, '\\u003c');

  res.send(pageShell('✏️ アンケート編集', req.session.adminDisplayName, `
    <div class="card">
      <label>タイトル</label>
      <input type="text" id="editTitle" value="${(survey.title || '').replace(/"/g, '&quot;')}">
      <div id="questionList"></div>
      <button type="button" onclick="addQuestion()" style="background:#95a5a6;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;margin-bottom:12px;">➕ 質問を追加</button>
      <br>
      <button onclick="updateSurvey()" style="background:#2980b9;color:white;border:none;padding:10px 24px;border-radius:4px;cursor:pointer;font-size:15px;font-weight:bold;">💾 更新を保存</button>
      <a href="/admin/surveys" style="margin-left:12px;color:#2980b9;">← 一覧に戻る</a>
      <span id="editMsg" style="margin-left:12px;font-weight:bold;"></span>
    </div>
  `, `
    var existingQuestions = ${questionsJson};
    var qIndex = 0;
    function addQuestion(text, optionsStr) {
      var container = document.getElementById('questionList');
      var div = document.createElement('div');
      div.style.cssText = 'background:#f9f9f9;border:1px solid #eee;border-radius:6px;padding:12px;margin-bottom:10px;';
      div.innerHTML =
        '<label>質問文</label>' +
        '<input type="text" class="q-text" value="' + (text ? text.replace(/"/g, '&quot;') : '') + '">' +
        '<label>選択肢（カンマ区切り）</label>' +
        '<input type="text" class="q-options" value="' + (optionsStr ? optionsStr.replace(/"/g, '&quot;') : '') + '">' +
        '<button type="button" onclick="this.parentElement.remove()" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;">この質問を削除</button>';
      container.appendChild(div);
      qIndex++;
    }
    if (existingQuestions.length > 0) {
      existingQuestions.forEach(function(q) {
        addQuestion(q.text, q.options.map(function(o){ return o.label; }).join(','));
      });
    } else {
      addQuestion();
    }

    async function updateSurvey() {
      var msg = document.getElementById('editMsg');
      var title = document.getElementById('editTitle').value.trim();
      var qDivs = document.querySelectorAll('#questionList > div');
      var questions = [];
      qDivs.forEach(function(div, i) {
        var text = div.querySelector('.q-text').value.trim();
        var optionsRaw = div.querySelector('.q-options').value.trim();
        if (!text || !optionsRaw) return;
        var options = optionsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean).map(function(s) {
          return { label: s, value: s };
        });
        questions.push({ id: 'q' + i, text: text, options: options });
      });
      if (!title || questions.length === 0) { msg.textContent = '△ タイトルと質問を入力してください'; msg.style.color = 'orange'; return; }
      msg.textContent = '保存中...'; msg.style.color = 'gray';
      try {
        var res = await fetch('/admin/surveys/${req.params.surveyId}/update', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title, questions: questions })
        });
        var data = await res.json();
        if (data.success) { msg.textContent = '✅ 保存しました'; msg.style.color = 'green'; }
        else { msg.textContent = '✗ 失敗: ' + data.error; msg.style.color = 'red'; }
      } catch(e) { msg.textContent = '✗ エラー: ' + e.message; msg.style.color = 'red'; }
    }
  `));
});

// 更新API
router.post('/:surveyId/update', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { title, questions } = req.body;
  if (!title || !questions || questions.length === 0) {
    return res.json({ success: false, error: 'タイトルと質問が必要です' });
  }
  try {
    await db.collection('surveys').doc(req.params.surveyId).update({
      title, questions, updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 削除API（アンケート定義のみ削除。回答結果は残す）
router.post('/:surveyId/delete', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  try {
    await db.collection('surveys').doc(req.params.surveyId).delete();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 送信対象選択画面
router.get('/:surveyId/send', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const surveyId = req.params.surveyId;
  const surveyDoc = await db.collection('surveys').doc(surveyId).get();
  if (!surveyDoc.exists) return res.status(404).send('アンケートが見つかりません');
  const survey = surveyDoc.data();

  const contactsSnapshot = await db.collection('contacts').get();
  const contacts = {};
  contactsSnapshot.docs.forEach(doc => { contacts[doc.id] = doc.data(); });

  const msgSnapshot = await db.collection('messages').orderBy('createdAt', 'desc').get();
  const users = {};
  msgSnapshot.docs.forEach(doc => {
    const d = doc.data();
    const sid = d.senderId;
    if (!users[sid]) users[sid] = {
      senderId: sid, senderName: d.senderName || '不明', senderPicture: d.senderPicture || null,
      lastDateMs: d.createdAt ? d.createdAt.toDate().getTime() : 0
    };
  });

  const now = Date.now();
  const members = Object.values(users).map(u => {
    const profile = contacts[u.senderId] || {};
    const diffHours = u.lastDateMs ? Math.floor((now - u.lastDateMs) / 1000 / 60 / 60) : 9999;
    return {
      senderId: u.senderId,
      name: profile.passportName || u.senderName || '不明',
      picture: u.senderPicture,
      workplace: profile.workplace || '',
      diffHours
    };
  });

  const rows = members.map(m => {
    const maxHours = HUMAN_AGENT_APPROVED ? 24 * 7 : 24;
    const over7Days = m.diffHours > maxHours;
    const badgeLabel = HUMAN_AGENT_APPROVED ? '7日' : '24時間';
    const badge = over7Days
      ? '<span class="badge-over7d" style="background:#e67e22;color:white;border-radius:4px;padding:2px 6px;font-size:11px;margin-left:6px;">' + badgeLabel + '超</span>'
      : '<span style="background:#27ae60;color:white;border-radius:4px;padding:2px 6px;font-size:11px;margin-left:6px;">' + badgeLabel + '以内</span>';
    return '<tr>'
      + '<td data-label="選択" style="text-align:center;"><input type="checkbox" name="targets" value="' + m.senderId + '"></td>'
      + '<td data-label="名前"><div style="display:flex;align-items:center;gap:8px;">' + avatarHtml(m.name, m.picture) + '<strong>' + m.name + '</strong>' + badge + '</div></td>'
      + '<td data-label="所属事業所">' + (m.workplace || '—') + '</td>'
      + '</tr>';
  }).join('');

  res.send(pageShell('📤 アンケート送信：' + survey.title, req.session.adminDisplayName, `
    <div class="card">
      <p style="margin:0;color:#555;">「<strong>${survey.title}</strong>」（全${(survey.questions||[]).length}問）を送信します。</p>
      <p style="font-size:13px;color:#888;">※ ${HUMAN_AGENT_APPROVED ? 'HUMAN_AGENTタグを使用するため、最終メッセージから7日以内であれば24時間を過ぎたユーザーにも送信可能です。7日を超えるユーザーは送信できません。' : 'HUMAN_AGENTタグは現在Meta側の承認待ちのため、最終メッセージから24時間以内のユーザーにのみ送信可能です。'}</p>
    </div>
    <div style="margin-bottom:8px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
      <label style="font-size:14px;cursor:pointer;"><input type="checkbox" id="selectAll" onchange="toggleAll(this)"> 全選択/解除</label>
      <button class="send-btn" id="sendBtn" onclick="sendSurvey()" style="background:#e74c3c;color:white;border:none;padding:12px 32px;border-radius:6px;cursor:pointer;font-size:16px;font-weight:bold;">📤 一括送信</button>
    </div>
    <table><thead><tr><th style="width:40px;text-align:center;">選択</th><th>名前</th><th>所属事業所</th></tr></thead>
    <tbody id="memberTable">${rows}</tbody></table>
    <div id="resultArea" style="margin-top:16px;"></div>
  `, `
    function toggleAll(cb) {
      document.querySelectorAll("input[name='targets']").forEach(function(c){ c.checked = cb.checked; });
    }
    async function sendSurvey() {
      var targets = [...document.querySelectorAll("input[name='targets']:checked")].map(function(c){ return c.value; });
      var over7dUsers = [...document.querySelectorAll("input[name='targets']:checked")].filter(function(c){ var row=c.closest('tr'); return row && row.querySelector('.badge-over7d'); }).map(function(c){ var row=c.closest('tr'); return row.querySelector('strong').textContent; });
      if (over7dUsers.length > 0) { alert('⚠️ 以下のユーザーは送信可能期間を超えているため送信できません。\\n' + over7dUsers.join('\\n')); return; }
      if (targets.length === 0) { alert('送信対象を選択してください'); return; }
      if (!confirm(targets.length + '名に送信します。よろしいですか？')) return;
      var btn = document.getElementById('sendBtn'); btn.disabled = true; btn.textContent = '送信中...';
      var resultArea = document.getElementById('resultArea');
      resultArea.innerHTML = '';
      var successCount = 0, failCount = 0;
      for (var i = 0; i < targets.length; i++) {
        var senderId = targets[i];
        try {
          var res = await fetch('/admin/surveys/${surveyId}/send-one', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senderId: senderId })
          });
          var data = await res.json();
          var row = document.querySelector("input[value='" + senderId + "']").closest('tr');
          var name = row.querySelector('strong').textContent;
          if (data.success) { successCount++; resultArea.innerHTML += '<div style="padding:8px 12px;border-radius:4px;margin-bottom:6px;background:#d5f5e3;color:#1e8449;">✅ ' + name + ' - 送信成功</div>'; }
          else { failCount++; resultArea.innerHTML += '<div style="padding:8px 12px;border-radius:4px;margin-bottom:6px;background:#fadbd8;color:#922b21;">❌ ' + name + ' - 失敗: ' + data.error + '</div>'; }
        } catch(e) { failCount++; }
        await new Promise(function(r){ setTimeout(r, 300); });
      }
      resultArea.innerHTML += '<div style="margin-top:12px;font-weight:bold;">完了: ✅ ' + successCount + '件成功 / ❌ ' + failCount + '件失敗</div>';
      btn.disabled = false; btn.textContent = '📤 一括送信';
    }
  `));
});

// 個別送信API（送信画面から1人ずつ呼ばれる）
router.post('/:surveyId/send-one', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { senderId } = req.body;
  try {
    const contactDoc = await db.collection('contacts').doc(senderId).get();
    const contactData = contactDoc.exists ? contactDoc.data() : {};
    await startSurvey(db, admin, senderId, req.params.surveyId, contactData);
    res.json({ success: true });
  } catch (err) {
    const fbError = err.fbError || (err.response && err.response.data && err.response.data.error);
    console.error('アンケート送信エラー:', senderId, fbError ? JSON.stringify(fbError) : err.message);
    res.json({ success: false, error: fbError ? fbError.message : err.message });
  }
});

// 結果集計画面
router.get('/:surveyId/results', requireAuth, async (req, res) => {
  const db = req.app.get('db');
  const surveyId = req.params.surveyId;
  const surveyDoc = await db.collection('surveys').doc(surveyId).get();
  if (!surveyDoc.exists) return res.status(404).send('アンケートが見つかりません');
  const survey = surveyDoc.data();
  const questions = survey.questions || [];

  const responsesSnapshot = await db.collection('surveyResponses').where('surveyId', '==', surveyId).get();
  const responses = responsesSnapshot.docs.map(d => d.data());
  const completed = responses.filter(r => r.status === 'completed');

  // 回答者の名前（登録名優先、無ければFBアカウント名）を調べるため、contactsをまとめて取得
  const contactsSnapshot = await db.collection('contacts').get();
  const contacts = {};
  contactsSnapshot.docs.forEach(doc => { contacts[doc.id] = doc.data(); });

  const questionBlocks = questions.map(q => {
    const counts = {};
    q.options.forEach(o => { counts[o.value] = 0; });
    completed.forEach(r => {
      const ans = r.answers && r.answers[q.id];
      if (ans !== undefined && counts.hasOwnProperty(ans)) counts[ans]++;
    });
    const maxCount = Math.max(1, ...Object.values(counts));
    const bars = q.options.map(o => {
      const c = counts[o.value] || 0;
      const pct = Math.round((c / maxCount) * 100);
      return '<div style="margin-bottom:8px;">'
        + '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px;"><span>' + o.label + '</span><span>' + c + '件</span></div>'
        + '<div style="background:#eee;border-radius:4px;overflow:hidden;height:10px;"><div style="background:#2980b9;width:' + pct + '%;height:100%;"></div></div>'
        + '</div>';
    }).join('');
    return '<div class="card"><h4 style="margin-top:0;">' + q.text + '</h4>' + bars + '</div>';
  }).join('');

  // 質問ごとの選択肢ラベルを引くための対応表（値→表示ラベル）
  const questionHeaders = questions.map(q => '<th>' + q.text + '</th>').join('');

  const respondentRows = responses.map(r => {
    const statusLabel = r.status === 'completed' ? '<span style="color:#27ae60;">完了</span>' : '<span style="color:#e67e22;">回答中</span>';
    const profile = contacts[r.senderId] || {};
    const name = profile.passportName || r.senderName || '不明(' + r.senderId.slice(-4) + ')';

    const answerCells = questions.map(q => {
      const rawValue = r.answers && r.answers[q.id];
      if (rawValue === undefined || rawValue === null) return '<td data-label="' + q.text + '" style="color:#ccc;">—</td>';
      const opt = q.options.find(o => o.value === rawValue);
      return '<td data-label="' + q.text + '">' + (opt ? opt.label : rawValue) + '</td>';
    }).join('');

    return '<tr>'
      + '<td data-label="名前"><a href="/admin/contacts/' + r.senderId + '" style="color:#2980b9;text-decoration:none;font-weight:bold;">' + name + '</a></td>'
      + answerCells
      + '<td data-label="状況">' + statusLabel + '</td>'
      + '<td data-label="開始日時">' + (r.startedAt ? r.startedAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明') + '</td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="' + (questions.length + 3) + '" style="text-align:center;color:#888;">まだ回答がありません</td></tr>';

  res.send(pageShell('📊 結果：' + survey.title, req.session.adminDisplayName, `
    <div class="card">
      <p style="margin:0;">送信数: <strong>${responses.length}</strong> 件 ／ 回答完了: <strong>${completed.length}</strong> 件</p>
    </div>
    ${questionBlocks}
    <div class="card">
      <h4 style="margin-top:0;">回答者一覧（個人ごとの回答内容）</h4>
      <div style="overflow-x:auto;">
      <table><thead><tr><th>名前</th>${questionHeaders}<th>状況</th><th>開始日時</th></tr></thead><tbody>${respondentRows}</tbody></table>
      </div>
    </div>
    <a href="/admin/surveys" style="color:#2980b9;">← アンケート一覧に戻る</a>
  `, ''));
});

// 共通ページテンプレート
function pageShell(title, adminName, bodyHtml, scriptJs) {
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">'
    + '<link rel="icon" href="https://www.facebook.com/favicon.ico">'
    + '<title>' + title + '</title>'
    + '<style>' + commonCss()
    + '.card{background:white;border-radius:8px;padding:20px 24px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + 'label{display:block;margin-bottom:4px;font-size:13px;color:#555;font-weight:bold;margin-top:10px;}'
    + 'input[type=text]{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;width:100%;box-sizing:border-box;margin-bottom:6px;}'
    + 'table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + 'th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;font-size:13px;}'
    + 'td{padding:12px 16px;border-bottom:1px solid #eee;font-size:13px;}'
    + 'tr:hover td{background:#f8f9fa;}'
    + '@media (max-width:768px){'
    + '.container{padding:8px;}'
    + 'table,thead,tbody{display:block;width:100%;} thead{display:none;}'
    + 'tbody tr{display:block;background:white;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,0.12);margin-bottom:10px;padding:10px 14px;}'
    + 'tbody tr td{display:block;padding:6px 0;border-bottom:1px solid #f0f0f0;}'
    + 'tbody tr td[data-label]:before{content:attr(data-label);display:block;font-size:11px;font-weight:bold;color:#999;margin-bottom:2px;}'
    + '}'
    + '</style></head><body>'
    + '<header><h1>' + title + '</h1>' + navHtml(adminName) + '</header>'
    + '<div class="container">' + bodyHtml + '</div>'
    + '<script>' + scriptJs + '</script>'
    + '</body></html>';
}

module.exports = router;
