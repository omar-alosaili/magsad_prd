-- Corrections to the type mapping in 0026, from the actual distribution of
-- primary_type across the catalog once the backfill landed.
--
-- 0026 asserted that Google has no type for shawarma or salad, and that its
-- nearest match for shawarma was `middle_eastern_restaurant`. Both claims were
-- wrong: `shawarma_restaurant` covers 69 places and `salad_shop` 3. That was a
-- guess at Google's vocabulary rather than a reading of it — these mappings
-- come from what the 3,712 backfilled rows actually contain.
--
-- Also picked up here: types more specific than the ones 0026 used.
-- `cake_shop` and `pastry_shop` are exact where `bakery` was an approximation,
-- and coffee had been mapped to two types while the catalog uses four.
update public.dish_categories set google_types = v.types
from (values
  -- shawarma_restaurant is exact and heavily used; middle_eastern_restaurant
  -- (53) and lebanese_restaurant (36) stay unmapped, as they imply a cuisine
  -- rather than a dish.
  ('shawarma',  array['shawarma_restaurant']),
  ('salad',     array['salad_shop']),
  ('coffee',    array['coffee_shop','cafe','coffee_roastery','coffee_stand']),
  ('tea',       array['tea_house','tea_store']),
  -- cake_shop/pastry_shop are precise; bakery stays as the broad backstop.
  ('cake',      array['cake_shop','bakery']),
  ('croissant', array['pastry_shop','bakery']),
  ('dessert',   array['dessert_shop','dessert_restaurant','confectionery','pastry_shop','candy_store'])
) as v(slug, types)
where dish_categories.slug = v.slug;

-- Two dishes the catalog clearly serves that the taxonomy had no concept for.
-- chicken_restaurant alone is 50 places — larger than pizza.
insert into public.dish_categories (slug, name_ar, name_en, emoji, synonyms, google_types, sort) values
  ('chicken', 'دجاج', 'Chicken', '🍗',
   array['دجاج','دجاجة','فروج','بروست','broast','chicken','wings','أجنحة'],
   array['chicken_restaurant','chicken_wings_restaurant'], 215),
  ('falafel', 'فلافل', 'Falafel', '🧆',
   array['فلافل','طعمية','falafel'],
   array['falafel_restaurant'], 225)
on conflict (slug) do nothing;
