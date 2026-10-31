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

Open the app through the Vite server (`npm run dev` or `npm run preview`); opening `index.html` directly from disk will not work. Sign-in and sign-up are linkable at `/#signin` and `/#signup`.

Use `npm run build` to create the deployable static site in `dist/`. Set the same two `VITE_` variables in your hosting provider before building.

## Features

- Email/password sign-up and sign-in with Supabase Auth.
- Cloud-saved properties and reservations, scoped to the signed-in landlord by database RLS policies.
- Create, edit, search, filter, and remove properties and reservations.
- Overview of upcoming stays, expected revenue, and near-term arrivals.
- Responsive layout and selectable display currency.

The currency selector only changes display formatting; it does not convert stored amounts. Existing browser-local data from an earlier version is not uploaded automatically. Payment processing, calendar sync, and guest-facing booking are not included yet.

## Channel management and multi-calendar

The **Channels** page keeps Airbnb, Vrbo and Booking.com calendars in sync using iCal, the calendar feed every one of them supports.

1. Run the "Channel management" section at the bottom of `supabase/schema.sql` in the Supabase SQL editor.
2. Click **Connect channel**, pick a property and channel, and paste that channel's calendar (iCal) link. Its blocked dates import as reservations.
3. Press **Copy export link** and paste it into that channel's calendar import. It receives every other booking for the property (never its own), so a stay on one channel blocks the others.
4. Overlapping stays are flagged on the calendar grid, in reservations and in the sidebar badge.

Imports run when you press Sync, when you open the Channels page, and every 15 minutes while the app is open. The `api/` functions (Vercel) fetch channel calendars and serve the export feed, so this needs a Vercel deployment, not `vite preview`. Prices, photos and policies are not pushed: that needs each channel's partner API, so the per-channel price adjustment is shown for reference.

## Unified inbox and guest communication

The **Inbox** page keeps every guest conversation (Airbnb, WhatsApp, email, Booking.com, Vrbo, SMS) in one place.

1. Run the "Unified inbox" section at the bottom of `supabase/schema.sql` in the Supabase SQL editor.
2. Start a conversation, or log a message a guest sent you on any platform, and reply from the thread.
3. Click **Add starter templates** for booking confirmation, pre-arrival, check-out and review-request messages. They are queued automatically for direct reservations when due (on load, when you open the Inbox and every 15 minutes while the app is open), once per reservation per trigger.
4. Queued messages are sent with one click via WhatsApp, SMS or your email app. An **auto-reply** template drafts a response when a logged guest message contains one of its keywords.

Airbnb, Booking.com and Vrbo messages can't be read automatically without each platform's partner API, and WhatsApp sending needs the WhatsApp Business API, so messages are logged here and sent through the guest's own channel.

## Operations and cleaning automation

The **Operations** page turns every checkout (direct or imported from Airbnb, Vrbo, Booking.com) into a cleaning task.

1. Run the "Operations & cleaning automation" section at the bottom of `supabase/schema.sql`. It also creates a private `task-photos` storage bucket.
2. Add your cleaners and maintenance staff with mobile numbers.
3. Turnover tasks are created for checkouts from 7 days ago to 3 days ahead (on load, when you open the page and every 15 minutes), once per reservation, and assigned to the active cleaner with the fewest open tasks. You can also add maintenance tasks manually.
4. **Notify on WhatsApp / SMS** opens a pre-written message to the assignee on your phone. Track status (To do, In progress, Done) and attach photo proof, using the camera on mobile. Overdue tasks are highlighted and counted in the sidebar badge.

Staff don't have their own logins and there are no push notifications; messages are sent through WhatsApp or SMS from your device.
