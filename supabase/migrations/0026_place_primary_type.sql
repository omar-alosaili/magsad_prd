-- Google's fine-grained place type, kept instead of discarded.
--
-- The sync has always REQUESTED `primaryType` but collapsed it to كافيه or
-- مطعم and threw the rest away (mapGoogleType). That left the catalog with no
-- dish signal at all: measured 2026-08-23, `description` was empty on all
-- 3,711 published places, `category` set on 1, and `tags` held exactly one
-- distinct value («فطور»). Food search could therefore only match a dish word
-- inside a place's NAME — which is why «كوكيز» found 2 places and «كرواسون»
-- found none.
--
-- primaryType is a Pro-tier field, so keeping it adds no cost to the existing
-- syncs (they already request Enterprise-tier fields, and billing follows the
-- highest tier requested).
--
-- Google's caching terms allow only place_id to be stored indefinitely, so
-- this is treated exactly like latitude/longitude already are: refreshed by
-- the rotating sync rather than kept as a permanent record.
alter table public.places add column if not exists primary_type text;
create index if not exists places_primary_type_idx on public.places(primary_type)
  where primary_type is not null;

-- Which Google types imply a category. Lives on the taxonomy row so the
-- vocabulary stays in ONE place — the same reason food search now reads its
-- synonyms from this table instead of a hardcoded client list.
alter table public.dish_categories add column if not exists google_types text[] not null default '{}';

-- Only mappings where the type reliably implies the dish. Deliberately absent:
-- shawarma, mandi, kabsa (Google's nearest type is `middle_eastern_restaurant`,
-- far too broad to mean any one of them), and cookies, matcha, cheesecake,
-- waffle, pancake, kunafa, salad (Google has no type for them at all). Those
-- stay dependent on place names and owner-declared menus — an approximation
-- dressed up as a match would be worse than an honest gap.
--
-- `bakery` → croissant/cake is the one genuine approximation here: a bakery
-- reliably sells both, but it does not SPECIALISE in either. Type matches are
-- weighted below both name matches and owner-declared dishes so an
-- approximation can never outrank a place that actually claims the dish.
update public.dish_categories set google_types = v.types
from (values
  ('coffee',     array['coffee_shop','cafe']),
  ('tea',        array['tea_house']),
  ('juice',      array['juice_shop','acai_shop']),
  ('cake',       array['bakery']),
  ('croissant',  array['bakery']),
  ('donut',      array['donut_shop']),
  ('icecream',   array['ice_cream_shop']),
  ('dessert',    array['dessert_shop','dessert_restaurant','confectionery']),
  ('chocolate',  array['chocolate_shop','chocolate_factory']),
  ('breakfast',  array['breakfast_restaurant','brunch_restaurant']),
  ('sandwich',   array['sandwich_shop','deli','bagel_shop']),
  ('burger',     array['hamburger_restaurant']),
  ('pizza',      array['pizza_restaurant']),
  ('pasta',      array['italian_restaurant']),
  ('steak',      array['steak_house']),
  ('grill',      array['barbecue_restaurant','bar_and_grill']),
  ('sushi',      array['sushi_restaurant','japanese_restaurant']),
  ('seafood',    array['seafood_restaurant'])
) as v(slug, types)
where dish_categories.slug = v.slug;
