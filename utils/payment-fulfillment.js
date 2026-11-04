const { subscriptionFor } = require('./subscriptions');
const { addMonths } = require('./payment-plans');
const fail = (message) => { throw Object.assign(new Error(message), { status: 409 }); };
// Exact decimal parsing: Bachs uses major-unit strings, our database uses integer kobo.
function kobo(value) {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
}
function validateCheckout(payment, session) {
  if (session.checkout_id !== payment.checkoutId || session.reference !== payment.reference ||
      session.currency !== payment.currency || kobo(session.amount) !== payment.amount ||
      (session.customer?.email || session.customer_details?.email)?.toLowerCase() !== payment.email.toLowerCase()) {
    fail('Payment details do not match this checkout. Please contact support.');
  }
  if (session.status !== 'completed' || session.payment_status !== 'succeeded') return false;
  // A completed free/trial checkout is not a paid collection.
  if (session.charge?.status !== 'succeeded' || session.charge.currency !== payment.currency || kobo(session.charge.amount) !== payment.amount) {
    fail('The collected payment does not match this plan. Please contact support.');
  }
  return true;
}
async function fulfillPayment(prisma, payment, session, now = new Date()) {
  if (!validateCheckout(payment, session)) return false;
  await prisma.$transaction(async (tx) => {
    // Serialize all purchases for this student, including competing webhook/callback deliveries.
    await tx.$queryRaw`SELECT id FROM quiz_takers WHERE id = ${payment.quizTakerId}::uuid FOR UPDATE`;
    const current = await tx.payment.findUnique({ where: { reference: payment.reference } });
    if (current.fulfilledAt) return;
    if (current.fixedExpiresAt && new Date(current.fixedExpiresAt) <= now) {
      fail('This tutorial period has ended. Contact support to reconcile this payment.');
    }
    const student = await tx.quizTaker.findUnique({ where: { id: payment.quizTakerId } });
    const subscription = subscriptionFor(student, now);
    const active = subscription.accountType === 'premium' && subscription.expiresAt;
    const sameLevel = active && subscription.planLevel === current.planLevel;
    const start = sameLevel ? new Date(subscription.expiresAt) : now;
    let expiresAt = current.fixedExpiresAt || addMonths(start, current.months);
    // A late, lower-tier checkout must never overwrite a newer, higher-tier purchase.
    const ranks = { lite: 1, pro: 2, 'pro-max': 3 };
    if (active && ranks[subscription.planLevel] > ranks[current.planLevel]) {
      fail('A higher plan is already active. Contact support to reconcile this payment.');
    }
    if (active && new Date(subscription.expiresAt) > expiresAt) {
      if (current.fixedExpiresAt) fail('Your existing access ends after this tutorial period. Contact support to reconcile this payment.');
      expiresAt = new Date(subscription.expiresAt);
    }
    await tx.quizTaker.update({ where: { id: student.id }, data: {
      accountType: 'premium', subscriptionPlanId: current.planId,
      subscriptionLevel: current.planLevel, subscriptionExpiresAt: expiresAt,
    } });
    await tx.payment.update({ where: { id: current.id }, data: {
      status: 'success', paidAt: session.completed_at ? new Date(session.completed_at) : now,
      fulfilledAt: now, expiresAt,
    } });
  });
  return true;
}
module.exports = { kobo, validateCheckout, fulfillPayment };
