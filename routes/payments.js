const express = require('express');
const { randomUUID } = require('node:crypto');
const prisma = require('../utils/database');
const { verifyQuizTaker } = require('../middleware/auth');
const { paymentPlans } = require('../utils/payment-plans');
const { subscriptionFor } = require('../utils/subscriptions');
const { bachs, validSignature, assertConfiguration } = require('../utils/bachs');
const { fulfillPayment } = require('../utils/payment-fulfillment');
const router = express.Router();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    console.error('Payment request failed:', error.status || error.code || 'internal');
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Unable to process payment. Please retry or contact support.' });
  }
};
const readSubscription = async (id) => subscriptionFor(await prisma.quizTaker.findUnique({ where: { id } }));
function frontendOrigin() {
  let url;
  try { url = new URL(process.env.STUDENT_APP_URL); } catch { fail(503, 'Payments are not configured yet. Please contact BJOT support.'); }
  if (url.protocol !== 'https:' || url.hostname === 'localhost' || /^[\d.:]+$/.test(url.hostname)) fail(503, 'Payments require a public HTTPS student app URL.');
  return url.origin;
}
async function reconcile(payment) {
  if (payment.fulfilledAt) return true;
  if (!payment.checkoutId) return false;
  const session = await bachs(`/v1/checkout-sessions/${encodeURIComponent(payment.checkoutId)}`);
  if (['expired', 'cancelled'].includes(session.status)) {
    await prisma.payment.updateMany({ where: { id: payment.id, fulfilledAt: null }, data: { status: 'failed' } });
    fail(400, 'This checkout has expired or was cancelled. Return to plans to start a new checkout.');
  }
  return fulfillPayment(prisma, payment, session);
}

// Mounted with express.raw BEFORE the application's JSON parser.
router.post('/webhook', handle(async (req, res) => {
  if (!validSignature(req.body, req.headers)) return res.status(400).json({ success: false, message: 'Invalid signature' });
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.sendStatus(400); }
  if (event.type !== 'collection.succeeded' || !event.data?.checkout_id) return res.sendStatus(200);
  // Query only our persisted checkout ID; metadata supplied by a browser is never authority.
  let payment = await prisma.payment.findUnique({ where: { checkoutId: event.data.checkout_id } });
  if (!payment && typeof event.data.reference === 'string' && event.data.reference.startsWith('bjot-')) {
    payment = await prisma.payment.findUnique({ where: { reference: event.data.reference } });
    // Initialization may still be committing its provider ID. Ask Bachs to retry.
    if (payment && !payment.checkoutId) return res.sendStatus(503);
  }
  if (!payment) return res.sendStatus(200);
  if (payment.checkoutId !== event.data.checkout_id) return res.sendStatus(400);
  if (!await reconcile(payment)) return res.sendStatus(503);
  res.sendStatus(200);
}));

router.use(verifyQuizTaker);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/plans', handle(async (req, res) => {
  res.json({ success: true, plans: paymentPlans(), subscription: subscriptionFor(req.quizTaker) });
}));
router.get('/subscription', handle(async (req, res) => {
  res.json({ success: true, subscription: subscriptionFor(req.quizTaker) });
}));
router.post('/initialize', handle(async (req, res) => {
  const plan = paymentPlans().find((item) => item.id === req.body?.planId);
  if (!plan || !plan.available) fail(400, 'Choose an available plan from the pricing page.');
  assertConfiguration();
  if (!process.env.BACHS_WEBHOOK_SECRET) fail(503, 'Payments are not configured yet. Please contact BJOT support.');
  const origin = frontendOrigin();
  const payment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM quiz_takers WHERE id = ${req.quizTaker.id}::uuid FOR UPDATE`;
    const student = await tx.quizTaker.findUnique({ where: { id: req.quizTaker.id } });
    const subscription = subscriptionFor(student);
    const ranks = { lite: 1, pro: 2, 'pro-max': 3 };
    if (plan.expiresAt && subscription.accountType === 'premium' && subscription.expiresAt && new Date(subscription.expiresAt) > new Date(plan.expiresAt)) fail(409, 'Your current access already extends beyond this Pro Max tutorial period. Please contact support to change plans.');
    if (subscription.accountType === 'premium' && ranks[subscription.planLevel] > ranks[plan.level]) fail(409, 'You already have a higher plan. Renew it or wait until it expires before choosing a lower plan.');
    if (subscription.accountType === 'premium' && subscription.planLevel === 'pro-max') fail(409, 'Your Pro Max plan already covers the full tutorial period.');
    const recent = await tx.payment.findFirst({ where: { quizTakerId: student.id, planId: plan.id, status: 'pending', createdAt: { gt: new Date(Date.now() - 30 * 60000) } }, orderBy: { createdAt: 'desc' } });
    if (recent) return recent;
    return tx.payment.create({ data: { reference: `bjot-${randomUUID()}`, quizTakerId: student.id,
      planId: plan.id, planLevel: plan.level, months: plan.months,
      fixedExpiresAt: plan.expiresAt ? new Date(plan.expiresAt) : null,
      amount: plan.amount, currency: plan.currency, email: student.email } });
  });
  if (payment.authorizationUrl) return res.json({ success: true, authorizationUrl: payment.authorizationUrl, reference: payment.reference });
  const session = await bachs('/v1/checkout-sessions', {
    pricing: { currency: payment.currency, amount: (payment.amount / 100).toFixed(2) },
    customer: { email: payment.email }, reference: payment.reference,
    metadata: { payment_reference: payment.reference },
    success_url: `${origin}/billing/callback?reference=${encodeURIComponent(payment.reference)}`,
    cancel_url: `${origin}/billing?plan=${encodeURIComponent(payment.planId)}&cancelled=1`,
  }, payment.reference);
  let checkoutUrl;
  try { checkoutUrl = new URL(session.checkout_url); } catch { fail(502, 'Bachs did not return a valid checkout. Please retry.'); }
  if (checkoutUrl.protocol !== 'https:' || !['checkout.bachs.io', 'sandbox-checkout.bachs.io'].includes(checkoutUrl.hostname) || typeof session.checkout_id !== 'string') fail(502, 'Bachs did not return a valid checkout. Please retry.');
  await prisma.payment.update({ where: { id: payment.id }, data: { checkoutId: session.checkout_id, authorizationUrl: checkoutUrl.href } });
  res.json({ success: true, authorizationUrl: checkoutUrl.href, reference: payment.reference });
}));
router.get('/verify/:reference', handle(async (req, res) => {
  if (!/^bjot-[0-9a-f-]{36}$/.test(req.params.reference)) fail(400, 'Invalid payment reference.');
  const payment = await prisma.payment.findUnique({ where: { reference: req.params.reference } });
  if (!payment || payment.quizTakerId !== req.quizTaker.id) fail(404, 'Payment not found.');
  const paid = await reconcile(payment);
  res.json({ success: true, status: paid ? 'success' : 'pending', subscription: await readSubscription(req.quizTaker.id) });
}));
module.exports = router;
