# ja-air-b-and-d
Booking system for landlords (zero dependencies, Node 18+).

- `npm start` → http://localhost:3000
- Landlords register/log in, list properties, and confirm/decline/cancel booking requests.
- Guests browse stays and request dates; overlapping bookings are rejected.
- Data is stored in `data.json` (override with `DB_FILE`). `npm test` runs the API test.
