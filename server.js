// Zero-dependency booking system for landlords. Run: node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');

let db = { users: [], properties: [], bookings: [] };
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const sessions = new Map(); // token -> userId
const id = () => crypto.randomUUID();

const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const verify = (pw, stored) => {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(hash(pw, salt).split(':')[1], 'hex');
  return crypto.timingSafeEqual(a, Buffer.from(h, 'hex'));
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const nights = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const overlaps = (aIn, aOut, bIn, bOut) => aIn < bOut && bIn < aOut;
const blocking = (b) => b.status !== 'cancelled' && b.status !== 'declined';

function publicUser(u) { return { id: u.id, name: u.name, email: u.email }; }

function auth(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const u = db.users.find((x) => x.id === sessions.get(t));
  if (!u) throw new HttpError(401, 'Login required');
  return u;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { reject(new HttpError(413, 'Too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
  });
}

function propFields(b) {
  const p = {
    title: String(b.title || '').trim(),
    description: String(b.description || '').trim(),
    location: String(b.location || '').trim(),
    pricePerNight: Number(b.pricePerNight),
    maxGuests: parseInt(b.maxGuests, 10),
  };
  if (!p.title || !p.location) throw new HttpError(400, 'Title and location required');
  if (!(p.pricePerNight > 0)) throw new HttpError(400, 'Price must be positive');
  if (!(p.maxGuests > 0)) throw new HttpError(400, 'Max guests must be positive');
  return p;
}

function ownProperty(user, pid) {
  const p = db.properties.find((x) => x.id === pid);
  if (!p) throw new HttpError(404, 'Property not found');
  if (p.ownerId !== user.id) throw new HttpError(403, 'Not your property');
  return p;
}

async function api(req, res, url) {
  const m = req.method;
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const body = ['POST', 'PUT', 'PATCH'].includes(m) ? await readBody(req) : {};
  const send = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  if (parts[0] === 'register' && m === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!body.name || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Valid name and email required');
    if (String(body.password || '').length < 8) throw new HttpError(400, 'Password must be 8+ characters');
    if (db.users.some((u) => u.email === email)) throw new HttpError(409, 'Email already registered');
    const u = { id: id(), name: String(body.name).trim(), email, password: hash(body.password) };
    db.users.push(u); save();
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, u.id);
    return send({ token, user: publicUser(u) }, 201);
  }
  if (parts[0] === 'login' && m === 'POST') {
    const u = db.users.find((x) => x.email === String(body.email || '').trim().toLowerCase());
    if (!u || !verify(String(body.password || ''), u.password)) throw new HttpError(401, 'Invalid credentials');
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, u.id);
    return send({ token, user: publicUser(u) });
  }

  if (parts[0] === 'properties') {
    const pid = parts[1];
    if (!pid && m === 'GET') {
      const mine = url.searchParams.get('mine');
      let list = db.properties;
      if (mine) { const u = auth(req); list = list.filter((p) => p.ownerId === u.id); }
      return send(list);
    }
    if (!pid && m === 'POST') {
      const u = auth(req);
      const p = { id: id(), ownerId: u.id, ...propFields(body) };
      db.properties.push(p); save();
      return send(p, 201);
    }
    if (pid && parts[2] === 'availability' && m === 'GET') {
      if (!db.properties.some((p) => p.id === pid)) throw new HttpError(404, 'Property not found');
      return send(db.bookings.filter((b) => b.propertyId === pid && blocking(b))
        .map((b) => ({ checkIn: b.checkIn, checkOut: b.checkOut })));
    }
    if (pid && m === 'PUT') {
      const p = ownProperty(auth(req), pid);
      Object.assign(p, propFields(body)); save();
      return send(p);
    }
    if (pid && m === 'DELETE') {
      const p = ownProperty(auth(req), pid);
      db.properties = db.properties.filter((x) => x !== p);
      db.bookings = db.bookings.filter((b) => b.propertyId !== pid); save();
      return send({ ok: true });
    }
  }

  if (parts[0] === 'bookings') {
    if (!parts[1] && m === 'POST') {
      const p = db.properties.find((x) => x.id === body.propertyId);
      if (!p) throw new HttpError(404, 'Property not found');
      const { checkIn, checkOut } = body;
      if (!isDate(checkIn) || !isDate(checkOut)) throw new HttpError(400, 'Dates must be YYYY-MM-DD');
      if (checkIn < new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Check-in is in the past');
      if (checkOut <= checkIn) throw new HttpError(400, 'Check-out must be after check-in');
      const guests = parseInt(body.guests, 10) || 1;
      if (guests < 1 || guests > p.maxGuests) throw new HttpError(400, `Guests must be 1-${p.maxGuests}`);
      const guestEmail = String(body.guestEmail || '').trim();
      if (!body.guestName || !/^\S+@\S+\.\S+$/.test(guestEmail)) throw new HttpError(400, 'Guest name and valid email required');
      if (db.bookings.some((b) => b.propertyId === p.id && blocking(b) && overlaps(checkIn, checkOut, b.checkIn, b.checkOut)))
        throw new HttpError(409, 'Those dates are not available');
      const b = {
        id: id(), propertyId: p.id, guestName: String(body.guestName).trim(), guestEmail,
        checkIn, checkOut, guests, total: nights(checkIn, checkOut) * p.pricePerNight,
        status: 'pending', createdAt: new Date().toISOString(),
      };
      db.bookings.push(b); save();
      return send(b, 201);
    }
    if (!parts[1] && m === 'GET') {
      const u = auth(req);
      const mine = new Map(db.properties.filter((p) => p.ownerId === u.id).map((p) => [p.id, p]));
      return send(db.bookings.filter((b) => mine.has(b.propertyId))
        .map((b) => ({ ...b, propertyTitle: mine.get(b.propertyId).title }))
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn)));
    }
    if (parts[1] && m === 'PATCH') {
      const u = auth(req);
      const b = db.bookings.find((x) => x.id === parts[1]);
      if (!b) throw new HttpError(404, 'Booking not found');
      ownProperty(u, b.propertyId);
      if (!['confirmed', 'declined', 'cancelled'].includes(body.status)) throw new HttpError(400, 'Invalid status');
      if (body.status === 'confirmed' && db.bookings.some((o) => o !== b && o.propertyId === b.propertyId &&
        o.status === 'confirmed' && overlaps(b.checkIn, b.checkOut, o.checkIn, o.checkOut)))
        throw new HttpError(409, 'Conflicts with a confirmed booking');
      b.status = body.status; save();
      return send(b);
    }
  }
  throw new HttpError(404, 'Not found');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: status === 500 ? 'Server error' : e.message }));
  }
});

if (require.main === module) server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
module.exports = server;
