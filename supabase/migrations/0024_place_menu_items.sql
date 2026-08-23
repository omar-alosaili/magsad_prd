-- Owner-declared signature dishes — «أطباق مميزة».
--
-- First-party data by construction: the owner of the place types it. No
-- dependency on a review corpus we are not allowed to keep, and it produces
-- exactly the object the recommendation architecture wants:
--
--     Place → Menu Item → (later) Recommendation Evidence
--
-- Two tables on purpose. `dish_categories` holds GLOBAL canonical concepts
-- (cookie, spanish latte, cheesecake…); `place_menu_items` holds the owner's
-- own dish name linked to one of them. Putting the canonical concept on the
-- per-place row instead would duplicate "cookie" once per place and leave
-- nothing for a taxonomy or a shared embedding to hang off — the search
-- «أفضل كوكيز في الرياض» has to resolve to ONE concept, not 400 strings.

create table if not exists public.dish_categories (
  slug text primary key,
  name_ar text not null,
  name_en text not null default '',
  emoji text not null default '',
  -- raw spellings for matching; Postgres does no Arabic folding, so every
  -- variant is listed rather than normalized at query time
  synonyms text[] not null default '{}',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.place_menu_items (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  -- the owner's actual dish name, e.g. «كوكيز الشوكولاتة بالملح»
  name text not null check (char_length(trim(name)) between 1 and 80),
  -- which canonical concept it belongs to; nullable so an owner is never
  -- blocked by a missing category, and an admin can map it later
  category_slug text references public.dish_categories(slug) on delete set null,
  description text not null default '' check (char_length(description) <= 200),
  is_signature boolean not null default true,
  sort int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pmi_place_idx on public.place_menu_items(place_id);
create index if not exists pmi_category_idx on public.place_menu_items(category_slug);
-- One place cannot list the same dish name twice
create unique index if not exists pmi_unique_name on public.place_menu_items(place_id, lower(trim(name)));

alter table public.dish_categories enable row level security;
alter table public.place_menu_items enable row level security;

-- The taxonomy is public reference data; only admins may change it, so
-- owners cannot fragment the shared namespace.
drop policy if exists "dish_categories_select_all" on public.dish_categories;
create policy "dish_categories_select_all" on public.dish_categories for select using (true);
drop policy if exists "dish_categories_admin_write" on public.dish_categories;
create policy "dish_categories_admin_write" on public.dish_categories for all
  using (public.is_admin()) with check (public.is_admin());

-- Menu items are public to read (they are the feature) and writable only by
-- the verified owner of that place, or an admin.
drop policy if exists "pmi_select_all" on public.place_menu_items;
create policy "pmi_select_all" on public.place_menu_items for select using (true);
drop policy if exists "pmi_owner_write" on public.place_menu_items;
create policy "pmi_owner_write" on public.place_menu_items for all
  using (public.owns_place(place_id) or public.is_admin())
  with check (public.owns_place(place_id) or public.is_admin());

insert into public.dish_categories (slug, name_ar, name_en, emoji, synonyms, sort) values
  ('coffee',     'قهوة',      'Coffee',      '☕',  array['قهوة','قهوه','كوفي','coffee','اسبريسو','espresso','لاتيه','latte','كابتشينو','cappuccino'], 10),
  ('matcha',     'ماتشا',     'Matcha',      '🍵',  array['ماتشا','matcha'], 20),
  ('tea',        'شاي',       'Tea',         '🫖',  array['شاي','tea','كرك','karak'], 30),
  ('juice',      'عصير',      'Juice',       '🧃',  array['عصير','عصائر','juice','سموذي','smoothie'], 40),
  ('cookies',    'كوكيز',     'Cookies',     '🍪',  array['كوكيز','كوكي','cookie','cookies','بسكوت'], 50),
  ('cake',       'كيك',       'Cake',        '🍰',  array['كيك','كيكة','كيكه','cake'], 60),
  ('cheesecake', 'تشيزكيك',   'Cheesecake',  '🧀',  array['تشيزكيك','تشيز كيك','cheesecake','سان سباستيان','basque'], 70),
  ('croissant',  'كرواسون',   'Croissant',   '🥐',  array['كرواسون','كرواسان','كرسون','croissant'], 80),
  ('donut',      'دونات',     'Donut',       '🍩',  array['دونات','دوناتس','donut','donuts','doughnut'], 90),
  ('waffle',     'وافل',      'Waffle',      '🧇',  array['وافل','waffle'], 100),
  ('pancake',    'بان كيك',   'Pancake',     '🥞',  array['بان كيك','بانكيك','pancake'], 110),
  ('kunafa',     'كنافة',     'Kunafa',      '🥮',  array['كنافة','كنافه','kunafa','knafeh'], 120),
  ('icecream',   'آيس كريم',  'Ice cream',   '🍨',  array['آيس كريم','ايس كريم','بوظة','جيلاتو','ice cream','gelato'], 130),
  ('dessert',    'حلى',       'Dessert',     '🍮',  array['حلى','حلا','حلويات','dessert','desserts'], 140),
  ('breakfast',  'فطور',      'Breakfast',   '🍳',  array['فطور','فطار','breakfast'], 150),
  ('sandwich',   'ساندويتش',  'Sandwich',    '🥪',  array['ساندويتش','سندويش','sandwich','راب','wrap'], 160),
  ('burger',     'برجر',      'Burger',      '🍔',  array['برجر','برغر','برقر','همبرجر','burger'], 170),
  ('pizza',      'بيتزا',     'Pizza',       '🍕',  array['بيتزا','pizza'], 180),
  ('pasta',      'باستا',     'Pasta',       '🍝',  array['باستا','معكرونة','مكرونة','pasta'], 190),
  ('steak',      'ستيك',      'Steak',       '🥩',  array['ستيك','steak'], 200),
  ('grill',      'مشويات',    'Grill',       '🍢',  array['مشويات','مشاوي','grill','bbq'], 210),
  ('shawarma',   'شاورما',    'Shawarma',    '🌯',  array['شاورما','shawarma'], 220),
  ('sushi',      'سوشي',      'Sushi',       '🍣',  array['سوشي','sushi'], 230),
  ('seafood',    'بحريات',    'Seafood',     '🦐',  array['بحريات','سمك','روبيان','seafood','shrimp','fish'], 240),
  ('mandi',      'مندي',      'Mandi',       '🍛',  array['مندي','mandi','مضغوط'], 250),
  ('kabsa',      'كبسة',      'Kabsa',       '🍚',  array['كبسة','كبسه','kabsa'], 260),
  ('salad',      'سلطة',      'Salad',       '🥗',  array['سلطة','سلطات','salad','salads'], 270)
on conflict (slug) do nothing;
