const express = require('express');
const admin = require('firebase-admin');
const session = require('express-session');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'from-nagasaki-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// 静的ファイル配信（PWA用）
app.use('/icons', express.static(path.join(__dirname, 'public/icons')));

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
app.set('db', db);
app.set('adminSdk', admin);

// PWA用ルート
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'public/manifest.json'));
});
app.get('/service-worker.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public/service-worker.js'));
});

const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhook');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contacts');
const userRoutes = require('./routes/users');
const memberRoutes = require('./routes/members');
const broadcastRoutes = require('./routes/broadcast');
const translateRoutes = require('./routes/translate');
const profileRoutes = require('./routes/profile');

app.use('/', authRoutes);
app.use('/', webhookRoutes);
app.use('/admin/translate', translateRoutes);
app.use('/admin/contacts', contactRoutes);
app.use('/admin/users', userRoutes);
app.use('/admin/members', memberRoutes);
app.use('/admin/broadcast', broadcastRoutes);
app.use('/admin/profile', profileRoutes);
app.use('/admin', adminRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('サーバー起動中 ポート:', PORT));
