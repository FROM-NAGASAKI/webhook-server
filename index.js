const express = require('express');
const app = express();
app.use(express.json());

console.log('FB_SA exists:', !!process.env.FB_SA);
console.log('FB_SA value:', process.env.FB_SA);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('起動 ポート:', PORT);
});