const crypto = require('crypto');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  res.redirect('/login');
}

module.exports = { hashPassword, requireAuth };