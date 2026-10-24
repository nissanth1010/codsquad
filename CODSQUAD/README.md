# CODSQUAD

**Four players. One squad. Infinite possibilities.**

CODSQUAD is a private gaming hub for four friends. This repository is a fresh implementation using HTML, CSS, Vanilla JavaScript, and Supabase. It does not use MongoDB, Mongoose, React, TypeScript, or Tailwind.

## Included

- Dark charcoal + lime gaming UI, responsive for desktop and mobile
- Invite-only sign-in with Supabase Auth
- Profile and favorite-game management
- Live member presence (authorized users only)
- Gaming lounge and scheduled sessions
- Private squad group chat and one-to-one conversations
- Message history, editing/deletion of own messages, image sharing
- Announcements, activity feed, per-user notifications, settings
- Admin-only announcement management and read-only community overview
- PostgreSQL schema, RLS policies, private Storage bucket policy, and Realtime setup
- Netlify-ready static frontend and a manual QA checklist

## Status / important boundary

The source code is prepared, but it is **not connected to a live Supabase project yet**. There were no Supabase project URL, publishable key, or four account emails available in the request. Therefore, authentication and database-backed features cannot work until you configure your own project and run the SQL setup. The app shows a setup notice until the public Supabase configuration is entered.

This repository has not been verified against a live Supabase instance. Do not call it production-ready until the manual security and feature checks in `tests/manual-test-plan.md` pass.

## 1. Create a Supabase project

1. Create a new project at [Supabase](https://supabase.com/dashboard).
2. In **Project Settings → API**, copy the Project URL and the **publishable key** (or legacy anon key if that is what your project exposes).
3. Open `js/config.js` and replace the placeholders:

   ```js
   export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
   export const SUPABASE_PUBLISHABLE_KEY = 'YOUR_SUPABASE_PUBLISHABLE_KEY';
   ```

4. Never put a `service_role` key or any secret key in `js/config.js`, HTML, or any other browser-visible file.

The supplied `.env.example` is a reference for configuration only. This is a static browser application, so simply adding `.env` to Netlify does not inject variables into browser JavaScript; use `js/config.js` as documented or add a secure build-time injection strategy before deploying.

## 2. Run the SQL migrations

Open **Supabase Dashboard → SQL Editor** and run the files in order:

1. `supabase/migrations/001_initial_schema.sql`
2. Create all four auth users as described below.
3. Edit and run `supabase/migrations/002_authorize_four_members.sql`.

The initial schema creates the tables, trusted helper functions, authorization policies, private media bucket, message/announcement/session notification triggers, database-side message flood control, and Realtime publication entries. The SQL is written for a Supabase-managed Postgres project (which provides the `auth`, `storage`, and `realtime` schemas). Run it once on a fresh project, then review any SQL Editor errors before proceeding.

## 3. Create four accounts (registration is invite-only)

In **Authentication → Users**, create the four accounts manually. Use the exact email addresses the members will sign in with:

- Nithish
- Nissanth
- Senthil Kumar
- Sharrvesh

Set secure, distinct passwords and share them directly with the intended account owners. Do not put those passwords in this repository.

Then edit `002_authorize_four_members.sql`, replacing:

- `ghostnovasoftware.official@gmail.com`
- `nissanth1010@gmail.com`
- `nithish1128@gmail.com`
- `janakimani122005@gmail.com`

with the exact account emails. The current script assigns **Nissanth** the `admin` role and the other three people the `member` role. Change that assignment if a different trusted account should administer CODSQUAD. Run the script and inspect its verification query to confirm exactly the expected accounts are authorized.

In **Authentication → Settings / Providers**, disable public sign-ups so visitors cannot create accounts. Set the Site URL and allowed redirect URLs for local development and the real Netlify URL you deploy to.

The database trigger creates each new profile as `is_authorized = false`; a fresh account is not allowed into CODSQUAD until the trusted SQL authorization step is complete.

## 4. Run locally

Because the application uses JavaScript modules, open it through a local web server (not by double-clicking `index.html`). From the `CODSQUAD` directory, use one of these options:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080` in your browser. Alternatively, use a local static server you already trust. Add `http://localhost:8080` to the Supabase Auth allowed redirect URLs for development.

## 5. Deploy to Netlify

1. Push this folder to a private or public Git repository (do not commit passwords or private keys).
2. Import the repository into Netlify.
3. Set the publish directory to `.` as configured in `netlify.toml`.
4. Deploy the site.
5. Update Supabase Auth Site URL and redirect allow-list to include the exact Netlify URL.
6. Open the deployed site and test each feature with at least two authorized accounts.

This is a static frontend. It does not require an Express server for the current feature set. Privileged admin actions intentionally rely on Supabase RLS/database policies rather than a service-role key exposed to the browser.

## 6. How access control works

- Supabase Auth identifies the current user.
- The profile trigger creates a default unapproved profile.
- A trusted SQL Editor operation authorizes the four chosen account IDs by their exact emails.
- RLS policies protect every app table, private conversations, messages, notification ownership, and settings.
- Private direct conversations are created through `create_private_conversation(target_user_id)`, not by trusting a browser-provided membership insert.
- Group membership is initialized through `ensure_group_conversation()` for authorized users.
- The `codsquad-media` bucket is private; files are accessed using short-lived signed URLs and storage RLS policies.
- Supabase Realtime Presence is restricted to authorized users by policies on `realtime.messages`.
- Admin role and member authorization are not editable from the profile form.

RLS is a crucial part of the design, but SQL deserves a real test against the actual Supabase project before relying on the app for private content.

## 7. Project structure

```text
CODSQUAD/
  index.html
  404.html
  css/styles.css
  js/config.js
  js/app.js
  assets/images/favicon.svg
  supabase/migrations/001_initial_schema.sql
  supabase/migrations/002_authorize_four_members.sql
  tests/manual-test-plan.md
  tests/security-checklist.md
  .env.example
  .gitignore
  netlify.toml
  README.md
```

## 8. Troubleshooting

- **Setup notice remains:** confirm `js/config.js` contains a valid Supabase URL and publishable key and refresh the page.
- **Sign-in works but access is denied:** check that the exact auth-user email appears as `is_authorized = true` in `public.profiles`.
- **Members are missing:** verify the profile trigger ran and the four profiles are authorized.
- **Messages fail:** check whether both users are authorized, the conversation membership exists, RLS policies were installed, and `messages` appears in the `supabase_realtime` publication.
- **Images fail:** verify the `codsquad-media` bucket is private, Storage policies are present, and the image is JPG/PNG/WebP/GIF no larger than 5 MB.
- **Presence is missing:** confirm the private presence policies on `realtime.messages` were created and the browser is signed in with an authorized account.
- **Username error:** usernames must be unique, 3–24 characters, using letters, numbers, and underscores.

## 9. Never commit secrets

Do not commit private passwords, service-role keys, personal credentials, or a database connection string. The publishable/anon key is intended for browser use only when RLS policies are configured correctly. Privileged keys are not browser configuration.
