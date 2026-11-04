// Paid access is evaluated on every authenticated request, not from JWT claims.
function subscriptionFor(student, now = new Date()) {
  const expiresAt = student.subscriptionExpiresAt || null;
  const active = student.accountType === 'premium' && (!expiresAt || new Date(expiresAt) > now);
  return {
    accountType: active ? 'premium' : 'regular',
    planId: student.subscriptionPlanId || null,
    planLevel: student.subscriptionLevel || null,
    expiresAt,
    // Legacy premium accounts retain classes, but must have an explicit Pro plan for past questions.
    hasProAccess: active && ['pro', 'pro-max'].includes(student.subscriptionLevel),
  };
}

function requirePro(req, res, next) {
  if (!subscriptionFor(req.quizTaker).hasProAccess) {
    return res.status(403).json({ success: false, code: 'PRO_REQUIRED', message: 'Choose an active Pro plan to access JAMB past questions.', upgradeUrl: '/pricing' });
  }
  next();
}
module.exports = { subscriptionFor, requirePro };
