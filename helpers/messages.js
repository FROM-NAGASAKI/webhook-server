// 管理者が返信・送信した際、その相手の「未対応」メッセージをまとめて「対応済み」にする共通処理。
// 連続して複数メッセージが届いた場合、1回の返信で全ての未対応が解消されるようにするため。

async function resolveAllUnread(db, senderId, excludeDocId) {
  const snapshot = await db.collection('messages')
    .where('senderId', '==', senderId)
    .where('status', '==', '未対応')
    .get();
  if (snapshot.empty) return 0;

  const batch = db.batch();
  let count = 0;
  snapshot.docs.forEach(doc => {
    if (excludeDocId && doc.id === excludeDocId) return; // 個別に更新済みのドキュメントは二重更新を避けるためスキップ
    batch.update(doc.ref, { status: '対応済み' });
    count++;
  });
  if (count > 0) await batch.commit();
  return count;
}

// 過去分の一回限りのクリーンアップ用。
// 「連続メッセージへの返信で未対応をまとめて解消する」修正より前に発生した、
// 取り残された未対応メッセージ（＝実際にはその後の返信で対応済みのはずのもの）を解消する。
//
// 判定方法：送信者ごとに、管理者からの最新返信日時（isAdminSentがtrueの中で一番新しいcreatedAt）を求め、
// それより前に作成された「未対応」のユーザーメッセージだけを「対応済み」に更新する。
// 管理者からの返信が一度も無い相手や、返信より後に届いた未対応メッセージは対象外（本当に未対応のまま残す）。
async function resolveStaleUnread(db) {
  const snapshot = await db.collection('messages').get();

  const lastAdminReplyAtBySender = new Map(); // senderId -> Date
  const targets = []; // {doc, senderId, createdAt}

  snapshot.docs.forEach(doc => {
    const d = doc.data();
    if (!d.senderId || !d.createdAt) return;
    if (d.isAdminSent) {
      const t = d.createdAt.toDate();
      const current = lastAdminReplyAtBySender.get(d.senderId);
      if (!current || t > current) lastAdminReplyAtBySender.set(d.senderId, t);
    } else if (d.status === '未対応') {
      targets.push({ doc, senderId: d.senderId, createdAt: d.createdAt.toDate() });
    }
  });

  const toResolve = targets.filter(t => {
    const lastReply = lastAdminReplyAtBySender.get(t.senderId);
    return lastReply && t.createdAt <= lastReply;
  });

  let resolvedCount = 0;
  // Firestoreのbatchは1回500件までのため、分割して実行する
  for (let i = 0; i < toResolve.length; i += 400) {
    const chunk = toResolve.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach(t => batch.update(t.doc.ref, { status: '対応済み' }));
    await batch.commit();
    resolvedCount += chunk.length;
  }

  const stillUnreadCount = targets.length - resolvedCount;
  return { resolvedCount, stillUnreadCount, totalChecked: targets.length };
}

module.exports = { resolveAllUnread, resolveStaleUnread };
