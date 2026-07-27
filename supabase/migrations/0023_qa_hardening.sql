-- QA remediation pass (report 2026-07-25). Server-side enforcement for
-- rules that until now existed only in client JavaScript, plus the
-- data-layer half of two moderation decisions.

-- D-01 — Upload limits were advisory: a 6 MB file and an HTML file were both
-- accepted straight into the "image" buckets, because file_size_limit and
-- allowed_mime_types were NULL. The client checks stay (better UX: they fail
-- before the upload) but the bucket is now the actual boundary.
update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
 where id in ('user-photos', 'place-photos');

-- D-08 — Quarantined/retired places stayed publicly readable: hiding them was
-- client-side only, so a moderation decision wasn't enforced where it counts.
-- Owners and admins keep full visibility.
drop policy if exists "places_select_all" on public.places;
create policy "places_select_visible_or_privileged" on public.places
  for select using (
    status in ('published', 'search_only')
    or public.is_admin()
    or public.owns_place(id)
  );

-- D-07 — Free text was unbounded in both the client and the DB, so one user
-- could store arbitrarily large text that then renders for every viewer.
-- Generous caps: long enough for a real review, short enough to be safe.
alter table public.reviews
  add constraint reviews_comment_len check (char_length(coalesce(comment, '')) <= 1500);
alter table public.profiles
  add constraint profiles_name_len check (char_length(coalesce(name, '')) <= 60),
  add constraint profiles_bio_len check (char_length(coalesce(bio, '')) <= 300),
  add constraint profiles_location_len check (char_length(coalesce(location, '')) <= 60),
  add constraint profiles_website_len check (char_length(coalesce(website, '')) <= 200);

-- D-03/D-04 — "New" was a stored flag that nothing reliably cleared: it was
-- true on 100% of the catalog, so the badge and its filter carried no signal.
-- The aging step also only ran inside the monthly sync AND filtered
-- source='google', while the column defaults to 'manual' — admin-added places
-- could never lose the badge. Age the existing rows once here; the client now
-- derives "new" from created_at at read time (see data.ts isRecentlyAdded), so
-- this flag no longer drives the badge.
update public.places
   set is_new = false
 where is_new = true
   and created_at < now() - interval '14 days';
