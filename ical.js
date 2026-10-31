export const PLATFORMS = {
  airbnb: "Airbnb",
  vrbo: "Vrbo",
  booking: "Booking.com",
  other: "Other"
};

const toIsoDate = (value) => {
  const digits = String(value).replace(/\D/g, "").slice(0, 8);
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : null;
};

export function parseIcal(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT") {
      if (current?.uid && current.start && current.end && current.end > current.start && !current.cancelled) {
        events.push({ uid: current.uid, start: current.start, end: current.end, summary: current.summary || "Reserved" });
      }
      current = null;
    } else if (current) {
      const index = line.indexOf(":");
      if (index < 0) continue;
      const name = line.slice(0, index).split(";")[0].toUpperCase();
      const value = line.slice(index + 1).trim();
      if (name === "UID") current.uid = value;
      if (name === "DTSTART") current.start = toIsoDate(value);
      if (name === "DTEND") current.end = toIsoDate(value);
      if (name === "SUMMARY") current.summary = value.replace(/\\,/g, ",").replace(/\\n/gi, " ");
      if (name === "STATUS" && value.toUpperCase() === "CANCELLED") current.cancelled = true;
    }
  }
  return events;
}

// Stays overlap when one starts before the other ends; same-day turnover is allowed.
export function findConflicts(reservations) {
  const active = reservations.filter((entry) => entry.status !== "cancelled");
  const byProperty = new Map();
  for (const entry of active) {
    if (!byProperty.has(entry.propertyId)) byProperty.set(entry.propertyId, []);
    byProperty.get(entry.propertyId).push(entry);
  }
  const pairs = [];
  const ids = new Set();
  for (const list of byProperty.values()) {
    list.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length && list[j].checkIn < list[i].checkOut; j += 1) {
        pairs.push([list[i], list[j]]);
        ids.add(list[i].id);
        ids.add(list[j].id);
      }
    }
  }
  return { pairs, ids };
}
