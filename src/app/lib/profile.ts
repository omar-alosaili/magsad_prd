import { supabase } from "./supabase";
import type { Profile } from "./types";

export type ProfileEdit = Partial<Pick<Profile,
  "name" | "bio" | "avatar_url" | "notification_opt_in" | "username" |
  "location" | "instagram" | "x_handle" | "tiktok" | "snapchat" | "website" |
  "personalization_opt_in"
>>;

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// ILIKE treats % and _ as wildcards, and usernames may legally contain _ —
// unescaped, "oma_" would match "omar" (false "taken" verdicts, and ?u=
// deep links opening the wrong profile). Escape for exact-match lookups.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, m => `\\${m}`);
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

// Public view of another user (?u= deep link) — public columns only.
export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles").select(PUBLIC_PROFILE_COLS).ilike("username", escapeLike(username)).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function updateProfile(userId: string, patch: ProfileEdit): Promise<void> {
  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
}

// Optional profile picture — stored in the user-photos bucket under the
// owner's uid folder (same RLS as review photos). 5MB cap.
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
// Avatar paths are timestamped, so a replacement used to leave the old
// object behind forever — unbounded per-user storage growth. Delete the
// superseded file(s) after a successful upload / on removal.
const AVATAR_PREFIX = "avatar-";

export async function deleteAvatarFiles(userId: string, keepPath?: string): Promise<void> {
  const { data, error } = await supabase.storage.from("user-photos").list(userId);
  if (error || !data) return; // best-effort: never block the profile save
  const stale = data
    .filter(f => f.name.startsWith(AVATAR_PREFIX) && `${userId}/${f.name}` !== keepPath)
    .map(f => `${userId}/${f.name}`);
  if (stale.length) await supabase.storage.from("user-photos").remove(stale);
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (file.size > MAX_AVATAR_BYTES) throw new Error("avatar_too_large");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("user-photos").upload(path, file, {
    contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  // Only after the new file is safely stored — a failed cleanup costs an
  // orphan, a premature one would lose the user's picture.
  await deleteAvatarFiles(userId, path).catch(() => {});
  const { data } = supabase.storage.from("user-photos").getPublicUrl(path);
  return data.publicUrl;
}

// True if the username is free (case-insensitive), ignoring the caller's own.
export async function isUsernameAvailable(username: string, selfId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles").select("id").ilike("username", escapeLike(username));
  if (error) throw error;
  return data.every(row => row.id === selfId);
}

// Columns that are meant to be seen by OTHER users. Don't ship preference
// flags / role / ownership to every searcher.
const PUBLIC_PROFILE_COLS =
  "id, name, username, avatar_url, bio, location, instagram, x_handle, tiktok, snapchat, website, created_at";

// User search for the Explore "Users" tab: by name, username, or bio.
export async function searchProfiles(query: string, excludeId: string | null, limit = 20): Promise<Profile[]> {
  // The placeholder invites "@handle" queries — usernames are stored
  // without the @, so strip it or the search finds nothing. Drop
  // PostgREST or() structural chars, then escape ILIKE wildcards for the
  // pattern (qPat) while ranking with the raw text (qRaw) so "om_ar"/"%"
  // match literally instead of as patterns.
  const qRaw = query.trim().replace(/^@/, "").replace(/[,()"\\*]/g, " ").trim();
  const qPat = escapeLike(qRaw);
  let req = supabase.from("profiles").select(PUBLIC_PROFILE_COLS).order("created_at", { ascending: false }).limit(limit);
  // Hide the viewer from the empty-query discovery list, but an explicit
  // search for your own handle should find you — not say "no users".
  if (excludeId && !qRaw) req = req.neq("id", excludeId);
  if (qRaw) req = req.or(`name.ilike.%${qPat}%,username.ilike.%${qPat}%,bio.ilike.%${qPat}%`);
  const { data, error } = await req;
  if (error) throw error;
  let results = (data ?? []) as Profile[];
  // Relevance: exact handle first, then handle-prefix, then the rest —
  // created_at ordering alone could push the exact match out entirely.
  if (qRaw) {
    const rank = (p: Profile) =>
      p.username === qRaw ? 0 : p.username?.startsWith(qRaw) ? 1 : (p.name ?? "").includes(qRaw) ? 2 : 3;
    results = [...results].sort((a, b) => rank(a) - rank(b));
    // Guarantee an exact-handle match is present even if the broad query's
    // limit window missed it.
    if (USERNAME_RE.test(qRaw) && !results.some(p => p.username === qRaw)) {
      const { data: exact } = await supabase
        .from("profiles").select(PUBLIC_PROFILE_COLS).ilike("username", qPat).maybeSingle();
      if (exact) results = [exact as Profile, ...results];
    }
  }
  return results;
}

export async function getSuggestedUsers(excludeUserId: string, limit = 5): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles").select("*").neq("id", excludeUserId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data as Profile[];
}

// Private: RLS only returns follow rows involving the caller, so this is
// accurate for your own profile and for admins, and near-zero (hidden)
// for anyone else — which is the intended privacy behavior.
export async function getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  const [{ count: followers }, { count: following }] = await Promise.all([
    supabase.from("user_follows").select("*", { count: "exact", head: true }).eq("followee_id", userId),
    supabase.from("user_follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
  ]);
  return { followers: followers ?? 0, following: following ?? 0 };
}

export async function getFollowingIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("user_follows").select("followee_id").eq("follower_id", userId);
  if (error) throw error;
  return new Set(data.map(row => row.followee_id as string));
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_follows").select("follower_id")
    .eq("follower_id", followerId).eq("followee_id", followeeId).maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function toggleFollowUser(followerId: string, followeeId: string, currentlyFollowing: boolean): Promise<void> {
  if (currentlyFollowing) {
    const { error } = await supabase.from("user_follows").delete().eq("follower_id", followerId).eq("followee_id", followeeId);
    if (error) throw error;
  } else {
    // ignoreDuplicates: re-following (e.g. after a race the UI guard missed)
    // is a no-op, not a spurious duplicate-key error toast.
    const { error } = await supabase
      .from("user_follows")
      .upsert({ follower_id: followerId, followee_id: followeeId }, { onConflict: "follower_id,followee_id", ignoreDuplicates: true });
    if (error) throw error;
  }
}
