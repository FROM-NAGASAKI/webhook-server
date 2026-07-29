// アンケート機能の共通ロジック
// - startSurvey: 管理者が対象者にアンケートを送信する（1問目を送る）
// - handleSurveyReply: ユーザーがクイックリプライ（ボタン）をタップした際に呼ばれる。
//   回答を記録し、次の質問を送るか、完了処理を行う。

const { sendQuickReplyMessage, sendMessage } = require('./facebook');

async function sendSurveyQuestionToUser(senderId, question, tag) {
  const quickReplies = question.options.map(o => ({ title: o.label, payload: o.value }));
  return sendQuickReplyMessage(senderId, question.text, quickReplies, tag);
}

// アンケートを開始する（1問目を送信し、進行状況をFirestoreに記録する）
// 初回送信のみ、24時間を過ぎている場合に備えてHUMAN_AGENTタグを使う（最大7日間まで送信可能）
async function startSurvey(db, admin, senderId, surveyId, contactData) {
  const surveyDoc = await db.collection('surveys').doc(surveyId).get();
  if (!surveyDoc.exists) throw new Error('アンケートが見つかりません');
  const survey = surveyDoc.data();
  if (!survey.questions || survey.questions.length === 0) throw new Error('質問が設定されていません');

  const responseRef = db.collection('surveyResponses').doc();
  await responseRef.set({
    surveyId,
    surveyTitle: survey.title || '',
    senderId,
    senderName: (contactData && contactData.passportName) || null,
    answers: {},
    currentQuestionIndex: 0,
    status: 'in_progress',
    startedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await db.collection('contacts').doc(senderId).set({
    activeSurveyResponseId: responseRef.id
  }, { merge: true });

  await sendSurveyQuestionToUser(senderId, survey.questions[0], 'HUMAN_AGENT');
  return responseRef.id;
}

// クイックリプライ（ボタンの回答）を受け取った際の処理。
// アンケート回答中でなければ null を返す（呼び出し側で通常の問い合わせ処理にフォールバックする）。
async function handleSurveyReply(db, admin, senderId, payload) {
  const contactRef = db.collection('contacts').doc(senderId);
  const contactDoc = await contactRef.get();
  const contactData = contactDoc.exists ? contactDoc.data() : {};
  const responseId = contactData.activeSurveyResponseId;
  if (!responseId) return null;

  const responseRef = db.collection('surveyResponses').doc(responseId);
  const responseDoc = await responseRef.get();
  if (!responseDoc.exists || responseDoc.data().status !== 'in_progress') {
    await contactRef.update({ activeSurveyResponseId: admin.firestore.FieldValue.delete() }).catch(() => {});
    return null;
  }
  const response = responseDoc.data();

  const surveyDoc = await db.collection('surveys').doc(response.surveyId).get();
  if (!surveyDoc.exists) return null;
  const survey = surveyDoc.data();
  const question = survey.questions[response.currentQuestionIndex];
  if (!question) return null;

  // 選択肢のラベルを見つけておく（履歴表示用）
  const selectedOption = question.options.find(o => o.value === payload);
  const answerLabel = selectedOption ? selectedOption.label : payload;

  const answers = Object.assign({}, response.answers, { [question.id]: payload });
  const nextIndex = response.currentQuestionIndex + 1;
  const isCompleted = nextIndex >= survey.questions.length;

  if (!isCompleted) {
    await responseRef.update({ answers, currentQuestionIndex: nextIndex });
    // ユーザーが今まさにタップしたばかりで24時間ルールの範囲内のため、タグ不要
    await sendSurveyQuestionToUser(senderId, survey.questions[nextIndex]);
  } else {
    await responseRef.update({
      answers,
      currentQuestionIndex: nextIndex,
      status: 'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await contactRef.update({ activeSurveyResponseId: admin.firestore.FieldValue.delete() }).catch(() => {});
    try {
      const completionMessage = survey.completionMessage || 'ご回答ありがとうございました。';
      await sendMessage(senderId, completionMessage);
    } catch (e) {}
  }

  return {
    surveyId: response.surveyId,
    surveyTitle: response.surveyTitle,
    questionText: question.text,
    answerLabel,
    completed: isCompleted
  };
}

module.exports = { startSurvey, handleSurveyReply, sendSurveyQuestionToUser };
