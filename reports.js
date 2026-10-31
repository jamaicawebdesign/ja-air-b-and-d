export const CATEGORIES = { cleaning: "Cleaning", maintenance: "Maintenance", utilities: "Utilities", supplies: "Supplies", marketing: "Marketing", taxes: "Taxes", other: "Other" };

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

export function propertyStats({ property, reservations, expenses, start, end }) {
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
  const own = expenses.filter((entry) => entry.propertyId === property.id && entry.date >= start && entry.date < end);
  const spent = own.reduce((sum, entry) => sum + entry.amount, 0);
  const byCategory = {};
  for (const entry of own) byCategory[entry.category] = (byCategory[entry.category] || 0) + entry.amount;
  return {
    nights: Math.min(nights, available), available, bookings, revenue, expenses: spent, byCategory,
    occupancy: available ? Math.min(100, Math.round((nights / available) * 100)) : 0,
    adr: nights ? revenue / nights : 0,
    revpar: available ? revenue / available : 0
  };
}

export function sumStats(list) {
  const total = list.reduce((acc, s) => ({
    nights: acc.nights + s.nights, available: acc.available + s.available, bookings: acc.bookings + s.bookings,
    revenue: acc.revenue + s.revenue, expenses: acc.expenses + s.expenses
  }), { nights: 0, available: 0, bookings: 0, revenue: 0, expenses: 0 });
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

export function statementHtml({ owner, period, rows, totals, payout, fmt, esc, generated }) {
  const lines = rows.map((row) => `<tr><td>${esc(row.name)}</td><td>${row.stats.bookings}</td><td>${row.stats.occupancy}%</td><td>${fmt(row.stats.adr)}</td><td>${fmt(row.stats.revenue)}</td><td>${fmt(row.stats.expenses)}</td></tr>`).join("");
  const expenseLines = rows.flatMap((row) => Object.entries(row.stats.byCategory).map(([category, amount]) => `<tr><td>${esc(row.name)}</td><td>${esc(CATEGORIES[category] || category)}</td><td>${fmt(amount)}</td></tr>`)).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Owner statement – ${esc(owner.name)} – ${esc(period)}</title>
<style>body{font:14px/1.5 "Segoe UI",sans-serif;color:#111;max-width:760px;margin:30px auto;padding:0 20px}h1{margin:0}h2{margin:26px 0 8px;font-size:15px}
.bar{height:6px;background:linear-gradient(90deg,#009b3a 33%,#fed100 33% 66%,#000 66%);margin:10px 0 18px}table{width:100%;border-collapse:collapse}
th,td{padding:7px 8px;border-bottom:1px solid #ddd;text-align:left}th{background:#f0f3f1;font-size:12px}.sum td:last-child,.sum th:last-child{text-align:right}
.net{font-size:18px;font-weight:700;background:#fff6c2}button{margin-top:20px;padding:9px 16px;font:inherit}@media print{button{display:none}}</style></head><body>
<h1>Owner statement</h1><div class="bar"></div>
<p><strong>${esc(owner.name)}</strong>${owner.email ? `<br>${esc(owner.email)}` : ""}<br>Period: ${esc(period)}<br>Generated ${esc(generated)}</p>
<h2>Property performance</h2><table><thead><tr><th>Property</th><th>Bookings</th><th>Occupancy</th><th>ADR</th><th>Revenue</th><th>Expenses</th></tr></thead><tbody>${lines}</tbody></table>
${expenseLines ? `<h2>Expenses by category</h2><table><thead><tr><th>Property</th><th>Category</th><th>Amount</th></tr></thead><tbody>${expenseLines}</tbody></table>` : ""}
<h2>Summary</h2><table class="sum"><tbody>
<tr><td>Gross revenue</td><td>${fmt(totals.revenue)}</td></tr>
<tr><td>Management fee (${owner.feePct}%)</td><td>− ${fmt(payout.fee)}</td></tr>
<tr><td>Expenses</td><td>− ${fmt(totals.expenses)}</td></tr>
<tr class="net"><td>Net payout to owner</td><td>${fmt(payout.net)}</td></tr></tbody></table>
<button onclick="window.print()">Print / save as PDF</button></body></html>`;
}
