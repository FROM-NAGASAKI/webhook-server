const express = require('express');
const router = express.Router();
const { requireAuth } = require('../helpers/auth');

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;

// 翻訳API
router.post('/', requireAuth, async (req, res) => {
  const { text, targetLang } = req.body;
  if (!text || !targetLang) return res.json({ success: false, error: 'パラメータ不足' });

  try {
    const response = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: [text],
        target_lang: targetLang
      })
    });
    const data = await response.json();
    if (data.translations && data.translations[0]) {
      res.json({ success: true, text: data.translations[0].text });
    } else {
      res.json({ success: false, error: '翻訳失敗' });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
