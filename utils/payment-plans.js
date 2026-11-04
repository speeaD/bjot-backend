// Amounts mirror the public pricing page and are stored internally in kobo.
// Convert to major-unit decimal strings when calling Bachs.
const tracks = [
  { id: 'science', name: 'Science', prices: [[9000, 10000], [17000, 18000], [25000, 27000]], max: 35000 },
  { id: 'art-commercial', name: 'Art & Commercial', prices: [[8000, 9000], [15000, 16000], [23000, 24000]], max: 30000 },
];
const tiers = ['foundation', 'advanced', 'ultimate'];
// End of March 2027 in Africa/Lagos, exclusive. Override for the next tutorial cycle.
const maxExpiry = () => new Date(process.env.PRO_MAX_EXPIRES_AT || '2027-03-31T23:00:00.000Z');
function paymentPlans(now = new Date()) {
  return tracks.flatMap((track) => [
    ...tiers.flatMap((tier, index) => ['lite', 'pro'].map((level, variant) => ({
      id: `${track.id}-${tier}-${level}`, track: track.name,
      name: `${tier[0].toUpperCase() + tier.slice(1)} ${level === 'lite' ? 'Lite' : 'Pro'}`,
      amount: track.prices[index][variant] * 100, currency: 'NGN', months: index + 1, level, available: true,
    }))),
    { id: `${track.id}-ultimate-pro-max`, track: track.name, name: 'Ultimate Pro Max',
      amount: track.max * 100, currency: 'NGN', months: null, level: 'pro-max',
      expiresAt: Number.isFinite(maxExpiry().getTime()) ? maxExpiry().toISOString() : null,
      available: maxExpiry() > now },
  ]);
}
function addMonths(date, months) {
  const end = new Date(date);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}
module.exports = { paymentPlans, addMonths };
