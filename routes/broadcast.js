const express = require('express');
const router = express.Router();
const { requireAuth } = require('../helpers/auth');
const { avatarHtml, navHtml, commonCss, pwaHtml } = require('../helpers/html');
const { uploadToCloudinary } = require('../helpers/cloudinary');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// グループ送信ページ
router.get('/', requireAuth, async (req, res) => {
  const db = req.app.get('db');

  const contactsSnapshot = await db.collection('contacts').get();
  const contacts = {};
  contactsSnapshot.docs.forEach(doc => { contacts[doc.id] = doc.data(); });

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

  const filterWorkplace = req.query.workplace || '';
  const filterResidence = req.query.residence || '';
  const filterKeyword = req.query.keyword || '';
  const filtered = members.filter(m => {
    if (filterWorkplace && m.workplace !== filterWorkplace) return false;
    if (filterResidence && m.residenceStatus !== filterResidence) return false;
    if (filterKeyword) {
      const kw = filterKeyword.toLowerCase();
      if (!m.name.toLowerCase().includes(kw) && !m.workplace.toLowerCase().includes(kw) &&
          !m.residenceStatus.toLowerCase().includes(kw) && !m.searchTags.toLowerCase().includes(kw)) return false;
    }
    return true;
  });

  const workplaces = [...new Set(members.map(m => m.workplace).filter(Boolean))];
  const residences = [...new Set(members.map(m => m.residenceStatus).filter(Boolean))];
  const workplaceOptions = workplaces.map(w => '<option value="' + w + '" ' + (filterWorkplace === w ? 'selected' : '') + '>' + w + '</option>').join('');
  const residenceOptions = residences.map(r => '<option value="' + r + '" ' + (filterResidence === r ? 'selected' : '') + '>' + r + '</option>').join('');

  const rows = filtered.map(m => {
    const over7Days = m.diffHours > 24 * 7;
    const badge = over7Days
      ? '<span class="badge-over7d" style="background:#e67e22;color:white;border-radius:4px;padding:2px 6px;font-size:11px;margin-left:6px;">7日超</span>'
      : '<span style="background:#27ae60;color:white;border-radius:4px;padding:2px 6px;font-size:11px;margin-left:6px;">7日以内</span>';
    return '<tr>'
      + '<td data-label="選択" style="text-align:center;"><input type="checkbox" name="targets" value="' + m.senderId + '"></td>'
      + '<td data-label="名前"><div style="display:flex;align-items:center;gap:8px;">' + avatarHtml(m.name, m.picture) + '<strong>' + m.name + '</strong>' + badge + '</div></td>'
      + '<td data-label="所属事業所">' + (m.workplace || '—') + '</td>'
      + '<td data-label="在留資格">' + (m.residenceStatus || '—') + '</td>'
      + '<td data-label="最終メッセージ" style="font-size:12px;color:#888;">' + m.lastDate + '</td>'
      + '</tr>';
  }).join('');

  res.send('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">'
    + '<link rel="icon" href="https://www.facebook.com/favicon.ico">'
    + (typeof pwaHtml === 'function' ? pwaHtml() : '')
    + '<title>グループ送信</title>'
    + '<style>' + commonCss()
    + 'table{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + 'th{background:#2c3e50;color:white;padding:12px 16px;text-align:left;}'
    + 'td{padding:12px 16px;border-bottom:1px solid #eee;font-size:14px;}'
    + 'tr:hover td{background:#f0f7ff;}'
    + '.filter-bar{background:white;border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.1);display:flex;gap:12px;flex-wrap:wrap;align-items:center;}'
    + '.filter-bar input,.filter-bar select{padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;}'
    + '.filter-bar button{padding:8px 16px;background:#2980b9;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;}'
    + '.filter-bar a{padding:8px 16px;background:#95a5a6;color:white;border-radius:4px;text-decoration:none;font-size:14px;}'
    + '.msg-box{background:white;border-radius:8px;padding:20px 24px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + 'textarea{width:100%;padding:12px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;resize:vertical;}'
    + '.compose-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}'
    + '.send-btn{background:#e74c3c;color:white;border:none;padding:12px 32px;border-radius:6px;cursor:pointer;font-size:16px;font-weight:bold;margin-top:12px;}'
    + '.send-btn:disabled{background:#ccc;cursor:not-allowed;}'
    + '#resultArea{margin-top:16px;}'
    + '.result-item{padding:8px 12px;border-radius:4px;margin-bottom:6px;font-size:14px;}'
    + '.result-ok{background:#d5f5e3;color:#1e8449;}'
    + '.result-ng{background:#fadbd8;color:#922b21;}'
    + '.result-warn{background:#fdebd0;color:#9c640c;}'
    + '@media (max-width:768px){'
    + '.container{padding:8px;}'
    + '.msg-box{padding:14px 16px;}'
    + '.compose-grid{grid-template-columns:1fr;}'
    + '.filter-bar{padding:12px;gap:8px;}'
    + '.filter-bar input,.filter-bar select,.filter-bar button,.filter-bar a{width:100%;box-sizing:border-box;text-align:center;}'
    + 'table,thead,tbody{display:block;width:100%;}'
    + 'thead{display:none;}'
    + 'tbody tr{display:block;background:white;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,0.12);margin-bottom:10px;padding:10px 14px;}'
    + 'tbody tr td{display:block;padding:6px 0;border-bottom:1px solid #f0f0f0;}'
    + 'tbody tr td:last-child{border-bottom:none;}'
    + 'tbody tr td[data-label]:before{content:attr(data-label);display:block;font-size:11px;font-weight:bold;color:#999;margin-bottom:2px;}'
    + 'tbody tr td[data-label="選択"]{text-align:left!important;}'
    + 'tbody tr td[data-label="選択"]:before{display:inline;margin-right:8px;}'
    + '.send-btn{width:100%;}'
    + '}'
    + '</style>'
    + '</head><body>'
    + '<header><h1>📢 グループ送信</h1>' + navHtml(req.session.adminDisplayName) + '</header>'
    + '<div class="container">'

    + '<div class="msg-box">'
    + '<h3 style="margin-top:0;color:#2c3e50;">✉️ 送信内容</h3>'
    + '<div style="margin-bottom:10px;">'
    + '<label style="font-size:13px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">📋 定型文を使う</label>'
    + '<select id="tplSelect-broadcast" onchange="applyTemplate(this,\'broadcastMsgJa\')" onfocus="loadTemplatesInto(this)" style="padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;max-width:400px;width:100%;"><option value="">📋 定型文を選択...</option></select>'
    + '</div>'
    + '<div class="compose-grid">'
    + '<div>'
    + '<label style="font-size:13px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">📝 日本語（入力）</label>'
    + '<textarea id="broadcastMsgJa" rows="5" placeholder="送信するメッセージを入力してください..."></textarea>'
    + '<button onclick="translateBroadcast()" style="margin-top:6px;font-size:12px;padding:4px 10px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;">🌐 英訳する</button>'
    + '</div>'
    + '<div>'
    + '<label style="font-size:13px;color:#555;font-weight:bold;display:block;margin-bottom:4px;">🌐 英語訳（自動）</label>'
    + '<textarea id="broadcastMsgEn" rows="5" placeholder="英訳がここに表示されます..." style="border-color:#27ae60;background:#f9fff9;"></textarea>'
    + '<div style="margin-top:4px;font-size:11px;color:#888;">※ 編集して送信も可能です</div>'
    + '</div>'
    + '</div>'
    + '<div style="margin-bottom:12px;">'
    + '<label style="font-size:13px;color:#555;font-weight:bold;">送信言語：</label>'
    + '<label style="font-size:13px;margin-left:8px;cursor:pointer;"><input type="radio" name="broadcastLang" value="ja" checked> 日本語</label>'
    + '<label style="font-size:13px;margin-left:12px;cursor:pointer;"><input type="radio" name="broadcastLang" value="en"> 英語訳</label>'
    + '<label style="font-size:13px;margin-left:12px;cursor:pointer;"><input type="radio" name="broadcastLang" value="both"> 両方送信</label>'
    + '</div>'
    + '<div style="margin-bottom:12px;">'
    + '<label style="font-size:13px;color:#555;font-weight:bold;">📎 添付ファイル：</label>'
    + '<input type="file" id="broadcastFile" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:13px;margin-left:8px;">'
    + '<small style="color:#888;display:block;margin-top:4px;">画像・PDF・Word・Excel（最大25MB）</small>'
    + '</div>'
    + '<div style="font-size:13px;color:#888;">※ HUMAN_AGENTタグを使用するため、最終メッセージから7日以内であれば24時間を過ぎたユーザーにも送信可能です。</div>'
    + '</div>'

    + '<form method="get" action="/admin/broadcast">'
    + '<div class="filter-bar">'
    + '<input type="text" name="keyword" value="' + filterKeyword + '" placeholder="🔍 キーワード検索">'
    + '<select name="workplace"><option value="">すべての事業所</option>' + workplaceOptions + '</select>'
    + '<select name="residence"><option value="">すべての在留資格</option>' + residenceOptions + '</select>'
    + '<button type="submit">絞り込み</button>'
    + '<a href="/admin/broadcast">リセット</a>'
    + '</div>'
    + '</form>'

    + '<div style="margin-bottom:8px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">'
    + '<span style="font-size:14px;color:#555;">対象: <strong>' + filtered.length + '</strong> 名</span>'
    + '<label style="font-size:14px;cursor:pointer;"><input type="checkbox" id="selectAll" onchange="toggleAll(this)"> 全選択/解除</label>'
    + '<button class="send-btn" id="sendBtn" onclick="sendBroadcast()">📢 一括送信</button>'
    + '</div>'

    + '<table><thead><tr>'
    + '<th style="width:40px;text-align:center;">選択</th>'
    + '<th>名前</th><th>所属事業所</th><th>在留資格</th><th>最終メッセージ</th>'
    + '</tr></thead>'
    + '<tbody id="memberTable">' + rows + '</tbody></table>'
    + '<div id="resultArea"></div>'
    + '</div>'

    + '<script>'
    + 'var __templatesCache=null;'
    + 'async function loadTemplatesInto(selectEl){'
    + 'if(__templatesCache){return;}' // 一度読み込んだら再取得しない（onfocusで複数回呼ばれても安全）
    + 'try{'
    + 'var res=await fetch("/admin/profile/templates");'
    + 'var data=await res.json();'
    + '__templatesCache=data.templates||[];'
    + '}catch(e){__templatesCache=[];}'
    + 'document.querySelectorAll("select[id^=\'tplSelect-\']").forEach(function(sel){'
    + 'var current=sel.value;'
    + 'sel.innerHTML="<option value=\'\'>📋 定型文を選択...</option>"+__templatesCache.map(function(t,i){return "<option value=\'"+i+"\'>"+t.title+"</option>";}).join("");'
    + 'sel.value=current;'
    + '});'
    + '}'
    + 'function applyTemplate(selectEl,textareaId){'
    + 'var idx=selectEl.value;'
    + 'if(idx===""||!__templatesCache)return;'
    + 'var t=__templatesCache[idx];'
    + 'if(t)document.getElementById(textareaId).value=t.body;'
    + 'selectEl.value="";'
    + '}'

    + 'function toggleAll(cb){'
    + 'document.querySelectorAll("input[name=\'targets\']").forEach(function(c){c.checked=cb.checked;});'
    + '}'

    + 'async function translateBroadcast(){'
    + 'var text=document.getElementById("broadcastMsgJa").value.trim();'
    + 'if(!text){alert("翻訳するテキストを入力してください");return;}'
    + 'var transEl=document.getElementById("broadcastMsgEn");'
    + 'transEl.value="翻訳中...";'
    + 'try{'
    + 'var res=await fetch("/admin/translate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:text,targetLang:"EN"})});'
    + 'var data=await res.json();'
    + 'transEl.value=data.success?data.text:"翻訳失敗";'
    + '}catch(e){transEl.value="エラー: "+e.message;}'
    + '}'

    + 'async function sendBroadcast(){'
    + 'var langEl=document.querySelector("input[name=\'broadcastLang\']:checked");'
    + 'var lang=langEl?langEl.value:"ja";'
    + 'var jaText=document.getElementById("broadcastMsgJa").value.trim();'
    + 'var enText=document.getElementById("broadcastMsgEn").value.trim();'
    + 'var fileInput=document.getElementById("broadcastFile");'
    + 'var sendText=lang==="ja"?jaText:lang==="en"?enText:jaText+(enText?"\\n\\n"+enText:"");'
    + 'var targets=[...document.querySelectorAll("input[name=\'targets\']:checked")].map(function(c){return c.value;});'
    + 'if(!sendText&&(!fileInput.files||fileInput.files.length===0)){alert("メッセージまたはファイルを入力してください");return;}'
    + 'if(targets.length===0){alert("送信対象を選択してください");return;}'
    + 'var over7dUsers=[...document.querySelectorAll("input[name=\'targets\']:checked")].filter(function(c){var row=c.closest("tr");return row&&row.querySelector(".badge-over7d");}).map(function(c){var row=c.closest("tr");return row.querySelector("strong").textContent;});'
    + 'if(over7dUsers.length>0){alert("\u26a0\ufe0f 以下のユーザーは最終メッセージから7日以上経過しているため、HUMAN_AGENTタグでも送信できません。\\n個別に再度連絡を取ってから送信してください。\\n\\n"+over7dUsers.join("\\n"));return;}'
    + 'if(!confirm(targets.length+"名に送信します。よろしいですか？"))return;'
    + 'var btn=document.getElementById("sendBtn");'
    + 'btn.disabled=true;btn.textContent="送信中...";'
    + 'var resultArea=document.getElementById("resultArea");'
    + 'resultArea.innerHTML="<div style=\'font-size:14px;color:#555;margin-bottom:8px;\'>送信結果：</div>";'
    + 'var successCount=0,failCount=0;'
    + 'for(var i=0;i<targets.length;i++){'
    + 'var senderId=targets[i];'
    + 'try{'
    + 'var formData=new FormData();'
    + 'formData.append("senderId",senderId);'
    + 'formData.append("message",sendText);'
    + 'if(fileInput.files&&fileInput.files.length>0)formData.append("file",fileInput.files[0]);'
    + 'var res=await fetch("/admin/broadcast/send",{method:"POST",body:formData});'
    + 'var data=await res.json();'
    + 'var row=document.querySelector("input[value=\'"+senderId+"\']").closest("tr");'
    + 'var name=row.querySelector("strong").textContent;'
    + 'if(data.success&&data.warning){'
    + 'successCount++;'
    + 'resultArea.innerHTML+="<div class=\'result-item result-warn\'>⚠️ "+name+" - "+data.warning+"</div>";'
    + '}else if(data.success){'
    + 'successCount++;'
    + 'resultArea.innerHTML+="<div class=\'result-item result-ok\'>✅ "+name+" - 送信成功</div>";'
    + '}else{'
    + 'failCount++;'
    + 'resultArea.innerHTML+="<div class=\'result-item result-ng\'>❌ "+name+" - 送信失敗: "+data.error+"</div>";'
    + '}'
    + '}catch(e){'
    + 'failCount++;'
    + 'resultArea.innerHTML+="<div class=\'result-item result-ng\'>❌ 送信エラー: "+e.message+"</div>";'
    + '}'
    + 'await new Promise(function(r){setTimeout(r,300);});'
    + '}'
    + 'resultArea.innerHTML+="<div style=\'margin-top:12px;font-size:15px;font-weight:bold;\'>完了: ✅ "+successCount+"件成功 / ❌ "+failCount+"件失敗</div>";'
    + 'btn.disabled=false;btn.textContent="📢 一括送信";'
    + '}'
    + '</script>'
    + '</body></html>');
});

// 送信API
router.post('/send', requireAuth, upload.single('file'), async (req, res) => {
  const db = req.app.get('db');
  const admin = req.app.get('adminSdk');
  const { senderId, message } = req.body;

  let textSendFailed = false;
  let textSendError = null;
  let attachmentSendFailed = false;
  let attachmentSendError = null;
  let attachmentName = null;
  let attachmentUrl = null;
  let attachmentPublicId = null;
  let attachmentResourceType = null;

  try {
    // 署名取得
    let signature = req.session.adminSignature || '';
    if (!signature) {
      const adminSnapshot = await db.collection('admins').where('userId', '==', req.session.adminId).limit(1).get();
      if (!adminSnapshot.empty) {
        signature = adminSnapshot.docs[0].data().signature || '';
        req.session.adminSignature = signature;
      }
    }

    const sendText = (message || '') + (signature ? '\n\n' + signature : '');

    // テキスト送信（通常送信）
    if (sendText.trim()) {
      try {
        const url = 'https://graph.facebook.com/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: senderId },
            message: { text: sendText },
            messaging_type: 'MESSAGE_TAG',
            tag: 'HUMAN_AGENT' // 管理者が手動で書いた内容のグループ送信のため使用可（最大7日間）
          })
        });
        const data = await response.json();
        if (data.error) {
          textSendFailed = true;
          textSendError = data.error.message;
        }
      } catch (textErr) {
        textSendFailed = true;
        textSendError = textErr.message;
      }
    }

    // テキストが失敗した場合、何も相手に届いていないので、ここで打ち切って記録もしない
    if (textSendFailed) {
      console.error('グループ送信エラー（本文）:', senderId, textSendError);
      return res.json({ success: false, error: textSendError });
    }

    // ファイル添付送信（Cloudinaryにアップロードして公開URLをMessengerに渡す）
    // 注意：本文はすでに相手に届いているため、ここで失敗しても処理を打ち切らない。
    // 添付失敗の情報を保持したまま、必ずFirestoreへの記録まで進める。
    if (req.file) {
      try {
        const { getAttachmentType } = require('../helpers/facebook');
        const fileType = getAttachmentType(req.file.mimetype);
        attachmentName = req.file.originalname;
        const uploaded = await uploadToCloudinary(req.file.buffer, req.file.originalname, req.file.mimetype);
        attachmentUrl = uploaded.url;
        attachmentPublicId = uploaded.publicId;
        attachmentResourceType = uploaded.resourceType;
        const msgUrl = 'https://graph.facebook.com/v19.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN;
        const msgRes = await axios.post(msgUrl, {
          recipient: { id: senderId },
          message: { attachment: { type: fileType, payload: { url: attachmentUrl, is_reusable: true } } },
          messaging_type: 'MESSAGE_TAG',
          tag: 'HUMAN_AGENT'
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
        console.error('グループ送信の添付エラー:', senderId, attachmentSendError);
        // 添付が届かなかった記録として、URLとpublicIdは保存しない（存在しないものとして扱う）
        attachmentUrl = null;
        attachmentPublicId = null;
      }
    }

    // Firestoreに記録（本文が届いた時点で必ず記録する。添付が失敗していてもここまで到達する）
    // isAdminSent:true を付けることで、contacts.js の個別送信と同じ形式で
    // 会話タイムライン上に「管理者からの返信」として正しく表示されるようにする
    // hasAttachment/attachmentDeleted/attachmentPublicId/attachmentResourceType は
    // 60日後の自動削除ジョブ（helpers/cleanup.js）が参照するために保存する
    const contactDoc = await db.collection('contacts').doc(senderId).get();
    const profile = contactDoc.exists ? contactDoc.data() : {};
    const senderName = profile.passportName || '不明';
    const attachmentTag = req.file
      ? (attachmentSendFailed ? ' [添付失敗: ' + attachmentName + ']' : ' [添付: ' + attachmentName + ']')
      : '';
    await db.collection('messages').add({
      senderId, senderName, senderPicture: null,
      message: '[グループ送信] ' + (message || '') + attachmentTag,
      replyMessage: sendText,
      replyAdmin: req.session.adminDisplayName || '管理者',
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: '対応済み',
      isAdminSent: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      attachmentName: attachmentSendFailed ? null : attachmentName,
      attachmentUrl,
      attachmentPublicId,
      attachmentResourceType,
      hasAttachment: !attachmentSendFailed && !!attachmentPublicId,
      attachmentDeleted: false
    });

    if (attachmentSendFailed) {
      console.log('グループ送信（本文のみ成功、添付失敗）:', senderId, senderName);
      // 本文は届いているので success:true としつつ、添付の問題をwarningとして伝える
      return res.json({ success: true, warning: '本文は届きましたが、添付ファイルの送信に失敗しました: ' + attachmentSendError });
    }

    console.log('グループ送信成功:', senderId, senderName);
    res.json({ success: true });
  } catch (err) {
    const fbError = err.response && err.response.data && err.response.data.error;
    console.error('グループ送信例外:', senderId, fbError ? JSON.stringify(fbError) : err.message);
    res.json({ success: false, error: fbError ? fbError.message : err.message });
  }
});

module.exports = router;
