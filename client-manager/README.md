# RNK FINWEALTH SERVICES — Client Desk

Responsive admin-only client management app for mobile and desktop.

## Features
- Admin email/password sign-in (no sign-up screen)
- Add, edit, search, and delete client records
- Record date, contact details, address, expected investment, scheme, investment date and tentative investment date
- Follow-up status, next call date/time, call note and remarks
- Dashboard for total clients, calls due today, overdue calls, and upcoming investments
- Click-to-call links and CSV export

## Secure database setup (Supabase)
1. Open the Supabase project you intend to use and go to **SQL Editor**.
2. Run `../supabase/client-manager-schema.sql` (or open that file from this repository and paste its SQL).
3. In **Authentication → Users**, create your one admin user with email/password. Do not enable public sign-ups.
4. Copy the admin user's UUID from the Users page.
5. In SQL Editor run:
   ```sql
   insert into public.rnk_admins (user_id)
   values ('PASTE-ADMIN-USER-UUID-HERE')
   on conflict (user_id) do nothing;
   ```
6. In Supabase **Project Settings → API**, copy the Project URL and the **publishable** key (or legacy anon key). Never use a service-role/secret key.
7. Open the app and choose **Configure database connection**. Enter the URL and public key. Connection details are stored in that browser; configure it once on each device.
8. Sign in using the admin email/password you created.

## Deployment
The app is in `client-manager/` so it can be deployed separately from the public RNK website. In Vercel, create/link a project to this repository with **Root Directory = client-manager** and Framework Preset **Other** (static HTML). The app entry is `index.html`.

## Security notes
- Client records are protected by Row Level Security (RLS). Only user IDs inserted into `public.rnk_admins` can read or change records.
- Do not share admin credentials or exported CSV files.
- This version displays reminders inside the app while it is open; push notifications/background alerts are not included.
- Database connection values are saved in browser local storage. Use a trusted device and sign out on shared devices.
