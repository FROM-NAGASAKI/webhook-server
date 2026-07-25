// 添付ファイルの自動削除ジョブ
// Cloudinaryのストレージ・帯域幅クレジットを圧迫し続けないよう、
// 送信から一定期間（デフォルト60日＝約2ヶ月）経過した添付ファイルを削除する。
//
// 削除対象は「管理者が送信した添付ファイル」（contacts.js / admin.js / broadcast.js 経由で
// Cloudinaryにアップロードしたもの）。ユーザーがMessenger経由で送ってきた添付ファイルは
// Facebook側のURL（Cloudinaryを経由しない）なので対象外。

const { deleteFromCloudinary } = require('./cloudinary');

const RETENTION_DAYS = 60; // 2ヶ月相当

async function cleanupOldAttachments(db, admin) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  console.log('[添付クリーンアップ] 開始: ' + cutoff.toISOString() + ' より前の添付ファイルを削除します');

  let deletedCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  try {
    // hasAttachment / attachmentDeleted フィールドで絞り込み、
    // 削除対象になり得るメッセージだけを取得する
    const snapshot = await db.collection('messages')
      .where('hasAttachment', '==', true)
      .where('attachmentDeleted', '==', false)
      .get();

    console.log('[添付クリーンアップ] 削除候補: ' + snapshot.size + ' 件');

    for (const doc of snapshot.docs) {
      const d = doc.data();
      if (!d.attachmentPublicId) { skippedCount++; continue; }

      const createdAt = d.createdAt ? d.createdAt.toDate() : null;
      if (!createdAt || createdAt > cutoff) { skippedCount++; continue; } // まだ2ヶ月経っていない

      try {
        await deleteFromCloudinary(d.attachmentPublicId, d.attachmentResourceType || 'image');
        await doc.ref.update({
          attachmentUrl: null,
          attachmentDeleted: true,
          attachmentDeletedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        deletedCount++;
        console.log('[添付クリーンアップ] 削除成功: ' + doc.id + ' (' + (d.attachmentName || '') + ')');
      } catch (err) {
        errorCount++;
        console.error('[添付クリーンアップ] 削除失敗: ' + doc.id, err.message);
      }
    }
  } catch (err) {
    console.error('[添付クリーンアップ] クエリエラー:', err.message);
    // hasAttachment/attachmentDeleted の複合インデックスが無い場合、
    // Firestoreがエラーメッセージ内にインデックス作成用のリンクを提示するので、
    // それをブラウザで開いて「作成」ボタンを押せば解決する。
  }

  console.log('[添付クリーンアップ] 完了: 削除 ' + deletedCount + ' 件 / 失敗 ' + errorCount + ' 件 / スキップ ' + skippedCount + ' 件');
  return { deletedCount, errorCount, skippedCount };
}

module.exports = { cleanupOldAttachments, RETENTION_DAYS };
