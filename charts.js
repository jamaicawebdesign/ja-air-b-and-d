const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const COLORS = { green: "#009b3a", gold: "#fed100", black: "#111111", red: "#c0392b", blue: "#3b6fd8", navy: "#003580", pink: "#ff5a5f", purple: "#8a79c9" };

function niceMax(value) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value);
  return step * power;
}

// Grouped vertical bars. series: [{ label, color, values[] }], labels: x labels.
export function barChart({ labels, series, format }) {
  const width = 520, height = 220, left = 46, bottom = 26, top = 12;
  const max = niceMax(Math.max(0, ...series.flatMap((entry) => entry.values)));
  const plotH = height - top - bottom;
  const groupW = (width - left - 10) / labels.length;
  const barW = Math.min(26, (groupW - 12) / series.length);
  const grid = [0, 0.5, 1].map((fraction) => {
    const y = top + plotH * (1 - fraction);
    return `<line x1="${left}" x2="${width - 6}" y1="${y}" y2="${y}" stroke="#d5ddd8"/><text x="${left - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#000">${esc(format(max * fraction))}</text>`;
  }).join("");
  const bars = labels.map((label, index) => {
    const x0 = left + index * groupW + (groupW - barW * series.length) / 2;
    const rects = series.map((entry, s) => {
      const value = entry.values[index] || 0;
      const h = (value / max) * plotH;
      return `<rect x="${x0 + s * barW}" y="${top + plotH - h}" width="${barW - 2}" height="${Math.max(h, value > 0 ? 1 : 0)}" rx="3" fill="${entry.color}"><title>${esc(entry.label)} · ${esc(label)}: ${esc(format(value))}</title></rect>`;
    }).join("");
    return `${rects}<text x="${left + index * groupW + groupW / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="#000">${esc(label)}</text>`;
  }).join("");
  const legend = series.map((entry) => `<span><i style="background:${entry.color}"></i>${esc(entry.label)}</span>`).join("");
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart">${grid}${bars}</svg><div class="chart-legend">${legend}</div>`;
}

// Area/line chart of percentages (0-100)
export function lineChart({ labels, values, color = COLORS.green, suffix = "%" }) {
  const width = 520, height = 200, left = 38, bottom = 24, top = 12;
  const plotW = width - left - 10, plotH = height - top - bottom;
  const step = values.length > 1 ? plotW / (values.length - 1) : plotW;
  const points = values.map((value, index) => [left + index * step, top + plotH * (1 - Math.min(100, value) / 100)]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)[0].toFixed(1)} ${top + plotH} L${left} ${top + plotH} Z`;
  const grid = [0, 50, 100].map((tick) => {
    const y = top + plotH * (1 - tick / 100);
    return `<line x1="${left}" x2="${width - 6}" y1="${y}" y2="${y}" stroke="#d5ddd8"/><text x="${left - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#000">${tick}${suffix}</text>`;
  }).join("");
  const ticks = labels.map((label, index) => (index % 6 === 0 ? `<text x="${points[index][0]}" y="${height - 6}" text-anchor="middle" font-size="11" fill="#000">${esc(label)}</text>` : "")).join("");
  const dots = points.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="7" fill="transparent"><title>${esc(labels[index])}: ${Math.round(values[index])}${suffix}</title></circle>`).join("");
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Occupancy trend">${grid}<path d="${area}" fill="${color}" fill-opacity=".18"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>${ticks}${dots}</svg>`;
}

// Donut. slices: [{ label, value, color }]
export function donutChart({ slices, centerLabel }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 62, stroke = 26, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = total ? slices.filter((slice) => slice.value > 0).map((slice) => {
    const length = (slice.value / total) * circumference;
    const arc = `<circle r="${radius}" cx="90" cy="90" fill="none" stroke="${slice.color}" stroke-width="${stroke}" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)"><title>${esc(slice.label)}: ${slice.value}</title></circle>`;
    offset += length;
    return arc;
  }).join("") : `<circle r="${radius}" cx="90" cy="90" fill="none" stroke="#d5ddd8" stroke-width="${stroke}"/>`;
  const legend = slices.map((slice) => `<span><i style="background:${slice.color}"></i>${esc(slice.label)} <b>${slice.value}</b></span>`).join("");
  return `<div class="donut"><svg viewBox="0 0 180 180" role="img" aria-label="Breakdown">${arcs}<text x="90" y="88" text-anchor="middle" font-size="26" font-weight="800" fill="#000">${total}</text><text x="90" y="106" text-anchor="middle" font-size="11" fill="#000">${esc(centerLabel)}</text></svg><div class="chart-legend vertical">${legend}</div></div>`;
}

// Horizontal bars. rows: [{ label, value, display }]
export function rankBars({ rows, color = COLORS.green }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return `<div class="rank">${rows.map((row) => `<div class="rank-row"><span class="rank-label">${esc(row.label)}</span><div class="rank-track"><span style="width:${Math.max(2, (row.value / max) * 100)}%;background:${color}"></span></div><b>${esc(row.display)}</b></div>`).join("")}</div>`;
}
