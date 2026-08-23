-- `dish_categories` is now the single vocabulary behind food search (it used
-- to be a hardcoded client list that had drifted from this table). The client
-- list carried one concept this table lacked — chocolate — so add it here
-- rather than let the switch quietly drop a searchable term.
insert into public.dish_categories (slug, name_ar, name_en, emoji, synonyms, sort) values
  ('chocolate', 'شوكولاتة', 'Chocolate', '🍫',
   array['شوكولاتة','شوكولاته','شوكولا','شكولاتة','شكولاته','شوكلت','chocolate'], 145)
on conflict (slug) do nothing;
