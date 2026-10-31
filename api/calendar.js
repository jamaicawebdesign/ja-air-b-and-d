const stamp = (iso) => iso.replace(/-/g, "");

export default async function handler(req, res) {
  const token = String(req.query.token || "").replace(/\.ics$/, "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) return res.status(400).send("Invalid token");
  const url = process.env.VITE_SUPABASE_URL || "https://lqzcfqaayrneavkfdonm.supabase.co";
  const key = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_JyJIWFyaun2V_mZW81S2Sw_vqE7KtA2";
  if (!url || !key) return res.status(500).send("Supabase is not configured");
  const response = await fetch(`${url}/rest/v1/rpc/channel_feed`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token })
  });
  if (!response.ok) return res.status(502).send("Could not load calendar");
  const rows = await response.json();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Havenstay//Channel Manager//EN", "CALSCALE:GREGORIAN"];
  for (const row of rows) {
    lines.push("BEGIN:VEVENT", `UID:${row.uid}@havenstay`, `DTSTART;VALUE=DATE:${stamp(row.check_in)}`,
      `DTEND;VALUE=DATE:${stamp(row.check_out)}`, `SUMMARY:${row.summary}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300");
  res.status(200).send(lines.join("\r\n"));
}
