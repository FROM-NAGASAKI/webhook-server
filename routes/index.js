const express = require('express');
const admin = require('firebase-admin');
const session = require('express-session');
const app = express();

// ミドルウェア
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'from-nagasaki-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// Firebase初期化
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// dbとadminをappに登録（各routeから使用）
app.set('db', db);
app.set('adminSdk', admin);

// ルーティング
const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhook');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contacts');
const userRoutes = require('./routes/users');
const memberRoutes = require('./routes/members');

app.use('/', authRoutes);
app.use('/', webhookRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/contacts', contactRoutes);
app.use('/admin/users', userRoutes);
app.use('/admin/members', memberRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('サーバー起動中 ポート:', PORT));
