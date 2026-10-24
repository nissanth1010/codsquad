-- Run this only AFTER creating all four accounts in Supabase Dashboard > Authentication > Users.
-- Replace the four sample email strings with the exact login email addresses.
-- Keep one trusted account as admin. This SQL Editor runs with privileged database access.
-- The script below also sets the expected CODSQUAD display names and usernames.

update public.profiles p
set is_authorized = true,
    role = case
      when lower(u.email) = lower('ghostnovasoftware.official@gmail.com') then 'admin'
      else 'member'
    end,
    display_name = case
      when lower(u.email) = lower('ghostnovasoftware.official@gmail.com') then 'Nithish'
      when lower(u.email) = lower('nissanth1010@gmail.com') then 'Nissanth'
      when lower(u.email) = lower('nithish1128@gmail.com') then 'Senthil Kumar'
      when lower(u.email) = lower('janakimani122005@gmail.com') then 'Sharrvesh'
      else p.display_name
    end,
    username = case
      when lower(u.email) = lower('ghostnovasoftware.official@gmail.com') then 'nithish'
      when lower(u.email) = lower('nissanth1010@gmail.com') then 'nissanth'
      when lower(u.email) = lower('nithish1128@gmail.com') then 'senthilkumar'
      when lower(u.email) = lower('janakimani122005@gmail.com') then 'sharrvesh'
      else p.username
    end
from auth.users u
where p.id = u.id
  and lower(u.email) in (
    lower('ghostnovasoftware.official@gmail.com'),
    lower('nissanth1010@gmail.com'),
    lower('nithish1128@gmail.com'),
    lower('janakimani122005@gmail.com')
  );

-- Verify the exact four authorized accounts and role assignment:
select u.email, p.username, p.display_name, p.is_authorized, p.role
from public.profiles p
join auth.users u on u.id = p.id
where p.is_authorized = true
order by p.display_name;

-- Do not run a public signup flow. Keep public self-registration disabled in Supabase Auth settings.
