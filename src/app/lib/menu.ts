import { supabase } from "./supabase";

// Owner-declared signature dishes. First-party by construction — the place's
// verified owner types them — so unlike anything derived from Google review
// text, this is data Magsad may store, index and search freely.
//
// Shape mirrors the schema: canonical categories are GLOBAL (so «أفضل كوكيز
// في الرياض» resolves to one concept), while each place carries its own dish
// names pointing at them.

export type DishCategory = {
  slug: string;
  nameAr: string;
  nameEn: string;
  emoji: string;
  synonyms: string[];
  // Google primaryType values that imply this category (pizza_restaurant →
  // pizza). Empty for dishes Google has no type for — cookies, matcha, kunafa.
  googleTypes: string[];
};

export type MenuItem = {
  id: string;
  placeId: string;
  name: string;
  categorySlug: string | null;
  description: string;
  isSignature: boolean;
  sort: number;
};

type CategoryRow = {
  slug: string; name_ar: string; name_en: string; emoji: string;
  synonyms: string[] | null; google_types: string[] | null;
};
type ItemRow = {
  id: string; place_id: string; name: string; category_slug: string | null;
  description: string; is_signature: boolean; sort: number;
};

const mapCategory = (r: CategoryRow): DishCategory => ({
  slug: r.slug, nameAr: r.name_ar, nameEn: r.name_en, emoji: r.emoji,
  synonyms: r.synonyms ?? [], googleTypes: r.google_types ?? [],
});

const mapItem = (r: ItemRow): MenuItem => ({
  id: r.id, placeId: r.place_id, name: r.name, categorySlug: r.category_slug,
  description: r.description, isSignature: r.is_signature, sort: r.sort,
});

// The shared taxonomy. Cached for the session: it is small, admin-managed,
// and read on every place page and every owner edit.
let categoryCache: Promise<DishCategory[]> | null = null;

export function getDishCategories(): Promise<DishCategory[]> {
  if (!categoryCache) {
    categoryCache = supabase
      .from("dish_categories")
      .select("slug, name_ar, name_en, emoji, synonyms, google_types")
      .order("sort")
      .then(({ data, error }) => {
        if (error) { categoryCache = null; throw error; }  // never cache a failure
        return (data as CategoryRow[]).map(mapCategory);
      });
  }
  return categoryCache;
}

export async function getPlaceMenu(placeId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("place_menu_items")
    .select("id, place_id, name, category_slug, description, is_signature, sort")
    .eq("place_id", placeId)
    .order("sort")
    .order("created_at");
  if (error) throw error;
  return (data as ItemRow[]).map(mapItem);
}

export async function addMenuItem(input: {
  placeId: string; name: string; categorySlug: string | null; description?: string; ownerId: string;
}): Promise<MenuItem> {
  const { data, error } = await supabase
    .from("place_menu_items")
    .insert({
      place_id: input.placeId,
      name: input.name.trim(),
      category_slug: input.categorySlug,
      description: (input.description ?? "").trim(),
      created_by: input.ownerId,
    })
    .select("id, place_id, name, category_slug, description, is_signature, sort")
    .single();
  // 23505 = the unique index on (place_id, lower(trim(name)))
  if (error?.code === "23505") throw new Error("duplicate");
  if (error) throw error;
  return mapItem(data as ItemRow);
}

export async function deleteMenuItem(id: string): Promise<void> {
  // .select() so an RLS-blocked delete surfaces instead of silently
  // "succeeding" with zero rows touched.
  const { data, error } = await supabase.from("place_menu_items").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("delete affected 0 rows (blocked or missing)");
}
