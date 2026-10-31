const ALLOWED = ["airbnb.com", "airbnb.ca", "airbnb.co.uk", "vrbo.com", "booking.com", "expedia.com", "homeaway.com", "tripadvisor.com", "agoda.com"];

const allowed = (url) =>
  url.protocol === "https:" && ALLOWED.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));

export default async function handler(req, res) {
  let target;
  try {
    target = new URL(String(req.query.url || ""));
  } catch {
    return res.status(400).send("Invalid URL");
  }
  try {
    for (let hop = 0; hop < 4; hop += 1) {
      if (!allowed(target)) return res.status(400).send("Calendar host is not supported");
      const upstream = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(10000) });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get("location")) {
        target = new URL(upstream.headers.get("location"), target);
        continue;
      }
      if (!upstream.ok) return res.status(502).send(`Channel returned ${upstream.status}`);
      const body = await upstream.text();
      if (!body.includes("BEGIN:VCALENDAR")) return res.status(422).send("Not an iCal calendar");
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      return res.status(200).send(body.slice(0, 2_000_000));
    }
    return res.status(502).send("Too many redirects");
  } catch (error) {
    return res.status(502).send("Could not reach the channel");
  }
}
