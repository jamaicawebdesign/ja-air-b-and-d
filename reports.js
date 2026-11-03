export const CATEGORIES = { cleaning: "Cleaning", maintenance: "Maintenance", platform_commission: "Platform commissions", utilities: "Utilities", supplies: "Supplies", marketing: "Marketing", taxes: "Taxes", other: "Other" };

const day = 86400000;
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms) => new Date(ms).toISOString().slice(0, 10);

export function monthRange(ym) {
  const [year, month] = ym.split("-").map(Number);
  const start = toIso(Date.UTC(year, month - 1, 1));
  const end = toIso(Date.UTC(year, month, 1));
  return { start, end, days: (toMs(end) - toMs(start)) / day };
}

// Nights of a stay that fall in [start, end)
export function overlapNights(reservation, start, end) {
  const from = Math.max(toMs(reservation.checkIn), toMs(start));
  const to = Math.min(toMs(reservation.checkOut), toMs(end));
  return Math.max(0, Math.round((to - from) / day));
}

export function propertyStats({ property, reservations, expenses, payments = [], start, end }) {
  const available = (toMs(end) - toMs(start)) / day;
  let nights = 0;
  let revenue = 0;
  let bookings = 0;
  for (const reservation of reservations) {
    if (reservation.propertyId !== property.id || reservation.status === "cancelled") continue;
    const inRange = overlapNights(reservation, start, end);
    if (!inRange) continue;
    const total = Math.max(1, Math.round((toMs(reservation.checkOut) - toMs(reservation.checkIn)) / day));
    nights += inRange;
    revenue += (Number(reservation.amount) || 0) * (inRange / total);
    bookings += 1;
  }
  // Cash view: money that actually arrived this period, and balances still unpaid on stays that began by the period's end
  const received = payments.filter((entry) => entry.propertyId === property.id && entry.date >= start && entry.date < end).reduce((sum, entry) => sum + entry.amount, 0);
  const outstanding = reservations.filter((entry) => entry.propertyId === property.id && entry.status !== "cancelled" && entry.checkIn < end).reduce((sum, entry) => sum + (entry.outstanding || 0), 0);
  const own = expenses.filter((entry) => entry.propertyId === property.id && entry.date >= start && entry.date < end);
  const spent = own.reduce((sum, entry) => sum + entry.amount, 0);
  const byCategory = {};
  for (const entry of own) byCategory[entry.category] = (byCategory[entry.category] || 0) + entry.amount;
  return {
    nights: Math.min(nights, available), available, bookings, revenue, received, outstanding, expenses: spent, byCategory,
    cleaningExpenses: byCategory.cleaning || 0,
    maintenanceExpenses: byCategory.maintenance || 0,
    platformCommissions: byCategory.platform_commission || 0,
    occupancy: available ? Math.min(100, Math.round((nights / available) * 100)) : 0,
    adr: nights ? revenue / nights : 0,
    revpar: available ? revenue / available : 0
  };
}

export function sumStats(list) {
  const total = list.reduce((acc, s) => ({
    nights: acc.nights + s.nights, available: acc.available + s.available, bookings: acc.bookings + s.bookings,
    revenue: acc.revenue + s.revenue, received: acc.received + s.received, outstanding: acc.outstanding + s.outstanding, expenses: acc.expenses + s.expenses,
    cleaningExpenses: acc.cleaningExpenses + s.cleaningExpenses,
    maintenanceExpenses: acc.maintenanceExpenses + s.maintenanceExpenses,
    platformCommissions: acc.platformCommissions + s.platformCommissions
  }), { nights: 0, available: 0, bookings: 0, revenue: 0, received: 0, outstanding: 0, expenses: 0, cleaningExpenses: 0, maintenanceExpenses: 0, platformCommissions: 0 });
  return {
    ...total,
    occupancy: total.available ? Math.min(100, Math.round((total.nights / total.available) * 100)) : 0,
    adr: total.nights ? total.revenue / total.nights : 0,
    revpar: total.available ? total.revenue / total.available : 0
  };
}

export function ownerPayout(revenue, expenses, feePct) {
  const fee = revenue * (feePct / 100);
  return { fee, net: revenue - fee - expenses };
}

// Each property can override the owner's default commission (commissionPct = null means use the default).
export function ownerPayoutRows(rows, defaultPct, expenses) {
  const fee = rows.reduce((sum, row) => sum + row.stats.revenue * ((row.commissionPct ?? defaultPct) / 100), 0);
  const revenue = rows.reduce((sum, row) => sum + row.stats.revenue, 0);
  return { fee, net: revenue - fee - expenses };
}

// Cash basis: management fee is taken on money received, and payouts already made are deducted.
export function ownerPayoutDue(rows, defaultPct, paidOut) {
  const received = rows.reduce((sum, row) => sum + row.stats.received, 0);
  const fee = rows.reduce((sum, row) => sum + row.stats.received * ((row.commissionPct ?? defaultPct) / 100), 0);
  const expenses = rows.reduce((sum, row) => sum + row.stats.expenses, 0);
  const net = received - fee - expenses;
  return { received, fee, expenses, net, paidOut, due: net - paidOut };
}

export function statementHtml({ owner, period, rows, totals, payout, fmt, esc, generated, feeLabel = `${owner.feePct}%`, cash = null, payoutLines = [], note = "" }) {
  const lines = rows.map((row) => `<tr><td>${esc(row.name)}</td><td>${row.stats.bookings}</td><td>${row.stats.occupancy}%</td><td>${fmt(row.stats.adr)}</td><td>${fmt(row.stats.revenue)}</td><td>${fmt(row.stats.cleaningExpenses)}</td><td>${fmt(row.stats.maintenanceExpenses)}</td><td>${fmt(row.stats.platformCommissions)}</td><td>${fmt(row.stats.expenses)}</td></tr>`).join("");
  const expenseLines = rows.flatMap((row) => Object.entries(row.stats.byCategory).map(([category, amount]) => `<tr><td>${esc(row.name)}</td><td>${esc(CATEGORIES[category] || category)}</td><td>${fmt(amount)}</td></tr>`)).join("");
  const otherExpenses = totals.expenses - totals.cleaningExpenses - totals.maintenanceExpenses - totals.platformCommissions;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Owner statement – ${esc(owner.name)} – ${esc(period)}</title>
<style>body{font:14px/1.5 "Segoe UI",sans-serif;color:#111;max-width:1100px;margin:30px auto;padding:0 20px}h1{margin:0}h2{margin:26px 0 8px;font-size:15px}
.bar{height:6px;background:linear-gradient(90deg,#009b3a 33%,#fed100 33% 66%,#000 66%);margin:10px 0 18px}table{width:100%;border-collapse:collapse}
th,td{padding:7px 8px;border-bottom:1px solid #ddd;text-align:left}th{background:#f0f3f1;font-size:12px}.sum td:last-child,.sum th:last-child{text-align:right}
.net{font-size:18px;font-weight:700;background:#fff6c2}button{margin-top:20px;padding:9px 16px;font:inherit}@media print{button{display:none}}</style></head><body>
<h1>Owner statement</h1><div class="bar"></div>
<p><strong>${esc(owner.name)}</strong>${owner.email ? `<br>${esc(owner.email)}` : ""}<br>Period: ${esc(period)}<br>Generated ${esc(generated)}</p>
<h2>Property performance</h2><table><thead><tr><th>Property</th><th>Bookings</th><th>Occupancy</th><th>ADR</th><th>Gross revenue</th><th>Cleaning</th><th>Maintenance</th><th>Platform commissions</th><th>Total expenses</th></tr></thead><tbody>${lines}</tbody></table>
${expenseLines ? `<h2>Expenses by category</h2><table><thead><tr><th>Property</th><th>Category</th><th>Amount</th></tr></thead><tbody>${expenseLines}</tbody></table>` : ""}
<h2>Summary</h2><table class="sum"><tbody>
<tr><td>Gross booking revenue</td><td>${fmt(totals.revenue)}</td></tr>
<tr><td>Occupancy rate</td><td>${totals.occupancy}%</td></tr>
<tr><td>Average daily rate (ADR)</td><td>${fmt(totals.adr)}</td></tr>
<tr><td>Cleaning expenses</td><td>− ${fmt(totals.cleaningExpenses)}</td></tr>
<tr><td>Maintenance expenses</td><td>− ${fmt(totals.maintenanceExpenses)}</td></tr>
<tr><td>Platform commissions</td><td>− ${fmt(totals.platformCommissions)}</td></tr>
<tr><td>Management fee${feeLabel ? ` (${feeLabel})` : ""}</td><td>− ${fmt(payout.fee)}</td></tr>
${otherExpenses ? `<tr><td>Other expenses</td><td>− ${fmt(otherExpenses)}</td></tr>` : ""}
<tr class="net"><td>Net payout to owner</td><td>${fmt(payout.net)}</td></tr></tbody></table>
${cash ? `<h2>Cash position <small>(what has actually moved)</small></h2><table class="sum"><tbody>
<tr><td>Booking revenue earned (stays this period)</td><td>${fmt(totals.revenue)}</td></tr>
<tr><td>Money actually received (payments this period)</td><td>${fmt(cash.received)}</td></tr>
<tr><td>Outstanding payments (unpaid balances)</td><td>${fmt(totals.outstanding)}</td></tr>
<tr><td>Expenses incurred</td><td>− ${fmt(cash.expenses)}</td></tr>
<tr><td>Management fee on money received</td><td>− ${fmt(cash.fee)}</td></tr>
<tr><td>Net owed to owner from money received</td><td>${fmt(cash.net)}</td></tr>
<tr><td>Payouts already made to owner</td><td>− ${fmt(cash.paidOut)}</td></tr>
<tr class="net"><td>Owner payout due</td><td>${fmt(cash.due)}</td></tr></tbody></table>
${payoutLines.length ? `<h2>Payouts made</h2><table><tbody>${payoutLines.map((line) => `<tr><td>${esc(line.date)}</td><td>${esc(line.detail)}</td><td>${esc(line.amount)}</td></tr>`).join("")}</tbody></table>` : ""}` : ""}
${note ? `<p style="font-size:12px;color:#555">${esc(note)}</p>` : ""}
<button onclick="window.print()">Print / save as PDF</button></body></html>`;
}
