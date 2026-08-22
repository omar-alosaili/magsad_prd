import { supabase } from "./supabase";
import { DISH_BY_SLUG, type Dish } from "./dishVocabulary";

// Dish recommendations — "what do people recommend here?".
//
// First-party only. Google's terms forbid storing or deriving from their
// review content, so every row is a Magsad user saying so under their own
// account. The shared vocabulary (dishVocabulary.ts / the dishes table) is
// what lets these answer «أفضل كوكيز في الرياض» rather than being free-text
// notes that only make sense on one place.

export type DishCount = { dish: Dish; count: number; recommendedByMe: boolean };

// Aggregate for one place, most-recommended first.
export async function getPlaceDishes(placeId: string, viewerId: string | null): Promise<DishCount[]> {
  const { data, error } = await supabase
    .from("place_dish_recommendations")
    .select("dish_slug, user_id")
    .eq("place_id", placeId);
  if (error) throw error;

  const rows = (data ?? []) as { dish_slug: string; user_id: string }[];
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const r of rows) {
    const prev = counts.get(r.dish_slug) ?? { count: 0, mine: false };
    counts.set(r.dish_slug, {
      count: prev.count + 1,
      mine: prev.mine || (!!viewerId && r.user_id === viewerId),
    });
  }
  return [...counts.entries()]
    // A slug with no vocabulary entry means the term was retired — skip it
    // rather than render a blank chip.
    .filter(([slug]) => !!DISH_BY_SLUG[slug])
    .map(([slug, v]) => ({ dish: DISH_BY_SLUG[slug], count: v.count, recommendedByMe: v.mine }))
    .sort((a, b) => b.count - a.count || a.dish.name.localeCompare(b.dish.name, "ar"));
}

// What this viewer has already recommended here — pre-selects the picker so
// editing a review doesn't silently drop previous choices.
export async function getMyDishes(placeId: string, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("place_dish_recommendations")
    .select("dish_slug")
    .eq("place_id", placeId)
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map(r => (r as { dish_slug: string }).dish_slug);
}

// Replace this viewer's recommendations for a place with `slugs`.
// Deliberately a full replace, not append: the picker shows the user their
// current selection, so unticking something has to actually remove it.
export async function setMyDishes(placeId: string, userId: string, slugs: string[]): Promise<void> {
  const wanted = [...new Set(slugs)].filter(s => !!DISH_BY_SLUG[s]);
  const current = await getMyDishes(placeId, userId);

  const toAdd = wanted.filter(s => !current.includes(s));
  const toRemove = current.filter(s => !wanted.includes(s));

  if (toRemove.length) {
    const { error } = await supabase
      .from("place_dish_recommendations")
      .delete()
      .eq("place_id", placeId)
      .eq("user_id", userId)
      .in("dish_slug", toRemove);
    if (error) throw error;
  }
  if (toAdd.length) {
    const { error } = await supabase
      .from("place_dish_recommendations")
      // Idempotent: the PK is (place_id, dish_slug, user_id), so a double
      // submit must not 23505 the whole review.
      .upsert(
        toAdd.map(dish_slug => ({ place_id: placeId, user_id: userId, dish_slug })),
        { onConflict: "place_id,dish_slug,user_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  }
}
