router.post('/login', async (req, res) => {
  const { userId, password } = req.body;
  console.log('ログイン試行:', userId, !!password);
  const db = req.app.get('db');
  try {
    const snapshot = await db.collection('admins').where('userId', '==', userId).get();
    if (!snapshot.empty) {
      const adminData = snapshot.docs[0].data();
      console.log('DB hash:', adminData.password);
      console.log('Input hash:', hashPassword(password));
      if (adminData.password === hashPassword(password)) {
        req.session.adminId = userId;
        req.session.adminDisplayName = adminData.displayName || userId;
        req.session.adminSignature = adminData.signature || '';
        return res.redirect('/admin');
      }
    }
    const allAdmins = await db.collection('admins').get();
    if (allAdmins.empty && userId === 'from-nagasaki-admin' && password === 'fngs-4301') {
      req.session.adminId = userId;
      req.session.adminDisplayName = userId;
      req.session.adminSignature = '';
      return res.redirect('/admin');
    }
    res.redirect('/login?error=1');
  } catch (err) {
    console.error('ログインエラー:', err.message);
    res.redirect('/login?error=1');
  }
});