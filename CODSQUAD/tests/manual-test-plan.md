# CODSQUAD manual test plan

Record the tester, browser, environment, and result for every check. Do not mark tests passed until they were actually run against the configured Supabase project.

## Authentication

- [ ] Login works with each of the four authorized accounts.
- [ ] Invalid password shows a non-sensitive error.
- [ ] An unapproved account is denied access.
- [ ] Public sign-up is disabled in Supabase Auth.
- [ ] Refresh preserves an authorized session.
- [ ] Logout returns the user to the login screen.
- [ ] Password recovery redirect and password update work with the real Auth email configuration.

## Members and settings

- [ ] Only authorized member profiles appear in the member directory.
- [ ] Profile updates persist after refresh.
- [ ] A profile update cannot change `role` or `is_authorized`.
- [ ] Duplicate usernames are handled with a clear message.
- [ ] Profile image upload, signed URL reading, and old image cleanup work.
- [ ] User preferences persist and presence visibility is respected.

## Chat and privacy

- [ ] The group conversation exists once and contains only the authorized squad.
- [ ] Messages are persisted and arrive in real time on a second signed-in browser.
- [ ] Only the sender can edit or delete their own messages.
- [ ] Private conversations cannot be read by a third member who is not a participant.
- [ ] A user cannot add themselves to another conversation by direct API request.
- [ ] `last_read_at`, group unread count, and direct-message unread count update as expected.
- [ ] Image upload is limited to allowed image types and a 5 MB maximum.
- [ ] A private image URL cannot be accessed by an unauthorized user or non-participant.
- [ ] Realtime subscriptions clean up when switching conversations and recover after disconnection.

## Sessions and announcements

- [ ] Authorized members can create future sessions and join/leave the roster.
- [ ] Members cannot cancel another user's session unless they are the admin.
- [ ] Only admin can create, edit, pin, or delete announcements.
- [ ] Announcement updates appear after refresh and via Realtime where supported.

## RLS / adversarial checks

- [ ] Run the checks in `security-checklist.md` using at least two authorized accounts and one unapproved test account.
- [ ] Anonymous requests cannot query private tables or storage.
- [ ] A regular member cannot set their profile role to `admin` using a direct API request.
- [ ] The browser bundle, Network tab, and source maps contain no service-role key or privileged secret.

## Responsive / accessibility

- [ ] Test 320 px, 375 px, tablet, and desktop widths.
- [ ] No horizontal page overflow occurs.
- [ ] Mobile navigation opens and closes.
- [ ] Chat input and attachments can be used on mobile.
- [ ] Keyboard focus is visible and dialogs close with Escape.
- [ ] Reduced-motion setting reduces non-essential animations.
