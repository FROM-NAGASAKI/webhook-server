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

module.exports = { resolveAllUnread };
