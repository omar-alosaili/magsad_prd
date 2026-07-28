// Self-serve account deletion (PDPL right to erasure).
//
// Deleting an auth user needs the service-role key, which must never reach the
// browser — hence an edge function. The user to delete is taken ONLY from the
// caller's verified JWT, never from the request body, so a valid token can
// only ever delete its own owner.
//
// profiles.id references auth.users(id) ON DELETE CASCADE, and every table
// holding personal data cascades from profiles (lists, reviews, saved_places,
// visited_places, user_follows, user_interests, notifications, reports,
// list_likes/follows/purchases). Audit and business references are ON DELETE
// SET NULL, so records like audit_log and places.owner_id survive without the
// person attached. Storage has no foreign keys, so its files are removed here.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. Identify the caller from their own token.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthenticated" }, 401);

  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const uid = userData?.user?.id;
  if (userErr || !uid) return json({ error: "unauthenticated" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 2. Remove the caller's uploads. Best-effort: a storage hiccup must not
  //    block the erasure itself, but we report what happened.
  let filesRemoved = 0;
  let storageError: string | null = null;
  try {
    const { data: files } = await admin.storage.from("user-photos").list(uid, { limit: 1000 });
    const paths = (files ?? []).map(f => `${uid}/${f.name}`);
    if (paths.length) {
      const { error } = await admin.storage.from("user-photos").remove(paths);
      if (error) storageError = error.message;
      else filesRemoved = paths.length;
    }
  } catch (e) {
    storageError = String((e as Error)?.message ?? e);
  }

  // 3. Delete the auth user. The cascade does the rest.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) return json({ error: "delete_failed", detail: delErr.message }, 500);

  return json({ ok: true, filesRemoved, storageError });
});
