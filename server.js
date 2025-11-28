const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// 静的ファイル配信
app.use(express.static('public'));

// ルート
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ヘルスチェックエンドポイント（App Runner用）
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

app.listen(port, () => {
  console.log(`BrowserInfer server running on port ${port}`);
});