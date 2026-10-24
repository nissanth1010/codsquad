# CODSQUAD security checklist

This checklist is intentionally not marked complete. Run it on the configured project before relying on real conversations.

## Before launch

- [ ] Public signups disabled in Supabase Auth.
- [ ] Only the intended four Auth users have `profiles.is_authorized = true`.
- [ ] Only the intended trusted user has `profiles.role = 'admin'`.
- [ ] `001_initial_schema.sql` executed without errors.
- [ ] `002_authorize_four_members.sql` was edited to real account emails and verified.
- [ ] All private app tables have RLS enabled.
- [ ] No unrestricted `USING (true)` policy exists for private data.
- [ ] `anon` has no application-table access.
- [ ] `service_role` / secret keys are absent from the frontend.
- [ ] The `codsquad-media` Storage bucket is private and its policies are present.
- [ ] Only needed tables have been added to `supabase_realtime`.
- [ ] Supabase Auth redirect URLs are restricted to trusted development/deployment hosts.

## Cross-user tests

- [ ] User A cannot read a private conversation that does not include A.
- [ ] User A cannot read the messages or attachments of a private conversation between B and C.
- [ ] User A cannot send a message using another user's `sender_id`.
- [ ] User A cannot update or delete a message belonging to B.
- [ ] User A cannot edit `role` or `is_authorized` through profile updates.
- [ ] A non-admin cannot create or modify announcements.
- [ ] A non-owner/non-admin cannot cancel a session created by someone else.
- [ ] User A cannot read or update User B's notifications or settings.
- [ ] An unauthorized account cannot track or listen to the private presence topic.
- [ ] Expired signed image URLs are re-issued only after an authorized read.

## Secrets / data hygiene

- [ ] No passwords or private keys in Git history.
- [ ] No sensitive tokens or private message text in activity logs.
- [ ] Back up SQL migrations and document who owns the Supabase project.
- [ ] Have a safe process for removing a member account and handling their retained messages/media.
