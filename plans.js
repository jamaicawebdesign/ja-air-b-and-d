export const PLANS = {
  starter: { name: "Starter", limit: 2, price: 12 },
  host: { name: "Host", limit: 6, price: 29 },
  pro: { name: "Pro", limit: 15, price: 59 },
  manager: { name: "Manager", limit: 40, price: 119 }
};

export function subscriptionState(sub, today = new Date().toISOString().slice(0, 10)) {
  if (!sub) return { status: "unknown", daysLeft: null };
  const end = sub.status === "active" ? sub.paidUntil : sub.status === "trial" || sub.status === "pending" ? sub.trialEnds : null;
  const daysLeft = end ? Math.ceil((new Date(end) - new Date(today)) / 86400000) : null;
  const expired = sub.status === "expired" || (sub.status === "active" && end && daysLeft < 0);
  return { status: expired ? "expired" : sub.status, daysLeft, end };
}
