# Havenstay

A landlord dashboard for organizing rental properties and guest reservations. Supabase provides authentication and cloud storage, with row-level security isolating each landlord's records.

## Set up Supabase

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql) once. It creates the property and reservation tables, ownership constraints, and row-level security policies.
3. In **Project Settings → API**, copy the project URL and the publishable key (or legacy `anon` key). These browser keys are designed to be public; never use a `service_role` or secret key in this app.
4. In **Authentication → URL Configuration**, set the local and deployed app URLs as allowed redirect URLs. In **Authentication → Providers → Email**, configure email sign-in and confirmation to your preference. If confirmations are enabled, newly registered landlords must confirm their email before signing in.

## Run locally

```sh
npm install
cp .env.example .env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`, then start the app:

```sh
npm run dev
```

Use `npm run build` to create the deployable static site in `dist/`. Set the same two `VITE_` variables in your hosting provider before building.

## Features

- Email/password sign-up and sign-in with Supabase Auth.
- Cloud-saved properties and reservations, scoped to the signed-in landlord by database RLS policies.
- Create, edit, search, filter, and remove properties and reservations.
- Overview of upcoming stays, expected revenue, and near-term arrivals.
- Responsive layout and selectable display currency.

The currency selector only changes display formatting; it does not convert stored amounts. Existing browser-local data from an earlier version is not uploaded automatically. Payment processing, calendar sync, and guest-facing booking are not included yet.
