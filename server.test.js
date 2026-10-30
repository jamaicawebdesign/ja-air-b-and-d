const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `bd-${process.pid}.json`);
const server = require('./server');

test('landlord flow with double-booking prevention', async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/api`;
  const call = async (m, u, body, token) => {
    const r = await fetch(base + u, {
      method: m, body: body && JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    });
    return { status: r.status, data: await r.json() };
  };
  const reg = await call('POST', '/register', { name: 'Ann', email: 'a@x.com', password: 'password1' });
  assert.equal(reg.status, 201);
  const t = reg.data.token;
  const prop = await call('POST', '/properties', { title: 'Villa', location: 'Kingston', pricePerNight: 100, maxGuests: 4 }, t);
  assert.equal(prop.status, 201);
  const g = { propertyId: prop.data.id, guestName: 'Bob', guestEmail: 'b@x.com', guests: 2 };
  const b1 = await call('POST', '/bookings', { ...g, checkIn: '2099-01-01', checkOut: '2099-01-04' });
  assert.equal(b1.data.total, 300);
  const b2 = await call('POST', '/bookings', { ...g, checkIn: '2099-01-03', checkOut: '2099-01-05' });
  assert.equal(b2.status, 409);
  const b3 = await call('POST', '/bookings', { ...g, checkIn: '2099-01-04', checkOut: '2099-01-05' });
  assert.equal(b3.status, 201);
  assert.equal((await call('GET', '/bookings')).status, 401);
  assert.equal((await call('PATCH', '/bookings/' + b1.data.id, { status: 'confirmed' }, t)).data.status, 'confirmed');
  assert.equal((await call('GET', '/bookings', null, t)).data.length, 2);
  server.close();
});
