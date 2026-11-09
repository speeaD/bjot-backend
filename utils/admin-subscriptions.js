const { subscriptionFor } = require('./subscriptions');
const { paymentPlans } = require('./payment-plans');

const levels = new Set(['lite', 'pro', 'pro-max']);
const invalid = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };

function adminSubscriptionOptions(now = new Date()) {
  return { proMaxExpiresAt: paymentPlans(now).find((plan) => plan.level === 'pro-max')?.expiresAt || null };
}

function adminStudent(student, now = new Date()) {
  return { ...student, subscription: subscriptionFor(student, now) };
}

function subscriptionUpdate(current, input, now = new Date()) {
  const supplied = input.subscriptionLevel !== undefined || input.subscriptionExpiresAt !== undefined;
  if (input.accountType === 'regular') {
    if (supplied && input.subscriptionLevel != null) invalid('A regular account cannot have a paid plan');
    return { subscriptionPlanId: null, subscriptionLevel: null, subscriptionExpiresAt: null };
  }
  if (!supplied) {
    // A generic premium upgrade never revives a previous paid entitlement.
    return input.accountType === 'premium' && current.accountType !== 'premium'
      ? { subscriptionPlanId: null, subscriptionLevel: null, subscriptionExpiresAt: null } : {};
  }
  const level = input.subscriptionLevel === undefined ? current.subscriptionLevel : input.subscriptionLevel;
  if (level === null) {
    if (input.subscriptionExpiresAt != null) invalid('Choose a paid plan before setting its expiry');
    return { accountType: 'premium', subscriptionPlanId: null, subscriptionLevel: null, subscriptionExpiresAt: null };
  }
  if (!levels.has(level)) invalid('Choose Lite, Pro, Pro Max, or premium with no plan set');
  const rawExpiry = input.subscriptionExpiresAt === undefined ? current.subscriptionExpiresAt : input.subscriptionExpiresAt;
  const expiry = rawExpiry instanceof Date ? rawExpiry : typeof rawExpiry === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(rawExpiry) ? new Date(rawExpiry) : null;
  if (!expiry || !Number.isFinite(expiry.getTime()) || expiry <= now) invalid('Choose a valid future expiry date for this plan');
  if (level === 'pro-max') {
    const maximum = new Date(adminSubscriptionOptions(now).proMaxExpiresAt);
    if (!Number.isFinite(maximum.getTime()) || maximum <= now || expiry > maximum) {
      invalid('Pro Max expiry must fall within the configured tutorial period');
    }
  }
  return { accountType: 'premium', subscriptionLevel: level, subscriptionExpiresAt: expiry,
    subscriptionPlanId: current.subscriptionLevel === level && current.subscriptionPlanId ? current.subscriptionPlanId : `admin-${level}` };
}

module.exports = { adminSubscriptionOptions, adminStudent, subscriptionUpdate };
