-- "What do people recommend here?" — collection side.
--
-- A SHARED vocabulary, not free text: recommendations use the same dish
-- terms the food search already ranks by, so «أفضل كوكيز في الرياض» can be
-- answered from what people actually recommended rather than from guessing
-- at review prose. The slugs mirror src/app/lib/dishVocabulary.ts.
--
-- Google's terms forbid storing or displaying their review content, so none
-- of this can be derived from Google. Every row here is first-party: a
-- Magsad user saying so, on the record, under their own account.

create table if not exists public.dishes (
  slug text primary key,
  name_ar text not null,
  emoji text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.place_dish_recommendations (
  place_id uuid not null references public.places(id) on delete cascade,
  dish_slug text not null references public.dishes(slug) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- one vote per person per dish per place; re-recommending is idempotent
  primary key (place_id, dish_slug, user_id)
);

create index if not exists pdr_place_idx on public.place_dish_recommendations(place_id);
create index if not exists pdr_dish_idx  on public.place_dish_recommendations(dish_slug);

alter table public.dishes enable row level security;
alter table public.place_dish_recommendations enable row level security;

-- The vocabulary is public reference data; only admins may change it, so a
-- user cannot invent terms that fragment the shared namespace.
drop policy if exists "dishes_select_all" on public.dishes;
create policy "dishes_select_all" on public.dishes for select using (true);
drop policy if exists "dishes_admin_write" on public.dishes;
create policy "dishes_admin_write" on public.dishes for all
  using (public.is_admin()) with check (public.is_admin());

-- Recommendations are public (they are the feature), but you may only ever
-- write your own — user_id is pinned to the caller, not taken from the body.
drop policy if exists "pdr_select_all" on public.place_dish_recommendations;
create policy "pdr_select_all" on public.place_dish_recommendations for select using (true);
drop policy if exists "pdr_insert_own" on public.place_dish_recommendations;
create policy "pdr_insert_own" on public.place_dish_recommendations for insert
  with check (user_id = auth.uid());
drop policy if exists "pdr_delete_own_or_admin" on public.place_dish_recommendations;
create policy "pdr_delete_own_or_admin" on public.place_dish_recommendations for delete
  using (user_id = auth.uid() or public.is_admin());

insert into public.dishes (slug, name_ar, emoji, sort) values
  ('coffee',     'قهوة',      '☕',  10),
  ('matcha',     'ماتشا',     '🍵',  20),
  ('cookies',    'كوكيز',     '🍪',  30),
  ('cake',       'كيك',       '🍰',  40),
  ('cheesecake', 'تشيزكيك',   '🍰',  50),
  ('croissant',  'كرواسون',   '🥐',  60),
  ('donut',      'دونات',     '🍩',  70),
  ('waffle',     'وافل',      '🧇',  80),
  ('pancake',    'بان كيك',   '🥞',  90),
  ('kunafa',     'كنافة',     '🥮', 100),
  ('chocolate',  'شوكولاتة',  '🍫', 110),
  ('icecream',   'آيس كريم',  '🍨', 120),
  ('breakfast',  'فطور',      '🍳', 130),
  ('burger',     'برجر',      '🍔', 140),
  ('pizza',      'بيتزا',     '🍕', 150),
  ('pasta',      'باستا',     '🍝', 160),
  ('steak',      'ستيك',      '🥩', 170),
  ('grill',      'مشويات',    '🍢', 180),
  ('shawarma',   'شاورما',    '🌯', 190),
  ('sushi',      'سوشي',      '🍣', 200),
  ('mandi',      'مندي',      '🍛', 210),
  ('kabsa',      'كبسة',      '🍚', 220)
on conflict (slug) do nothing;
