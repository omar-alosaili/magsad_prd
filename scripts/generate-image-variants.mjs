// Pre-generate resized variants for every photo in place-photos.
//
// WHY: the app briefly served images through Supabase's /render/image/
// endpoint, which bills per DISTINCT origin image — $5/1,000 after only 100
// per month on Pro. A 14k-photo catalog exhausted that quota within days of
// shipping. Variants stored as plain files serve at zero marginal cost;
// ~1 GB of extra storage sits comfortably inside the plan's 100 GB.
//
// CONVENTION (must match sizedImage() in src/app/lib/types.ts):
//   google/<placeId>/0.jpg  ->  google/<placeId>/0_w430.jpg   (card/hero)
//                               google/<placeId>/0_w200.jpg   (thumb)
//
// Idempotent: existing variants are skipped, so re-running after a sync or
// an interrupted run only processes what's missing. Usage:
//   node scripts/generate-image-variants.mjs            # backfill everything
//   node scripts/generate-image-variants.mjs --prefix google/<placeId>
import { readFileSync } from "node:fs";
import sharp from "sharp"; // devDependency — never bundled into the app

// CI provides credentials as env vars; local runs read .env.prod.local.
function loadEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env;
  return Object.fromEntries(
    readFileSync(new URL("../.env.prod.local", import.meta.url), "utf8")
      .split(/\r?\n/).filter(l => l.includes("="))
      .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/\r$/, "")]),
  );
}
const env = loadEnv();
const SB = env.SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

const WIDTHS = [430, 200];
const QUALITY = { 430: 70, 200: 65 };
const CONCURRENCY = 10;
const BUCKET = "place-photos";
const prefixArg = process.argv.includes("--prefix")
  ? process.argv[process.argv.indexOf("--prefix") + 1]
  : "";

async function listAll(prefix) {
  // storage list API pages at 1000 per folder; walk recursively
  const out = [];
  const queue = [prefix];
  while (queue.length) {
    const dir = queue.shift();
    for (let offset = 0; ; offset += 1000) {
      const r = await fetch(`${SB}/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: dir, limit: 1000, offset }),
      });
      const items = await r.json();
      if (!Array.isArray(items) || !items.length) break;
      for (const it of items) {
        const path = dir ? `${dir}/${it.name}` : it.name;
        if (it.id === null) queue.push(path);   // folder
        else out.push(path);
      }
      if (items.length < 1000) break;
    }
  }
  return out;
}

const isVariant = p => /_w(200|430)\.jpg$/.test(p);
const isSource = p => /\.(jpe?g|png|webp)$/i.test(p) && !isVariant(p);

async function processOne(path, have) {
  const missing = WIDTHS.filter(w => !have.has(path.replace(/\.(jpe?g|png|webp)$/i, `_w${w}.jpg`)));
  if (!missing.length) return "skip";
  const res = await fetch(`${SB}/storage/v1/object/public/${BUCKET}/${path}`);
  if (!res.ok) return "fetch_fail";
  const buf = Buffer.from(await res.arrayBuffer());
  for (const w of missing) {
    const out = await sharp(buf)
      .resize({ width: w, withoutEnlargement: true })
      .jpeg({ quality: QUALITY[w], mozjpeg: true })
      .toBuffer();
    const vpath = path.replace(/\.(jpe?g|png|webp)$/i, `_w${w}.jpg`);
    const up = await fetch(`${SB}/storage/v1/object/${BUCKET}/${vpath}`, {
      method: "POST",
      headers: { ...H, "Content-Type": "image/jpeg", "x-upsert": "true" },
      body: out,
    });
    if (!up.ok) return "upload_fail";
  }
  return "done";
}

console.log("listing bucket…");
const all = await listAll(prefixArg);
const have = new Set(all.filter(isVariant));
const sources = all.filter(isSource);
console.log(`${sources.length} source images, ${have.size} variants already present`);

let done = 0, skip = 0, fail = 0, i = 0;
const t0 = Date.now();
async function worker() {
  while (i < sources.length) {
    const path = sources[i++];
    try {
      const r = await processOne(path, have);
      if (r === "done") done++; else if (r === "skip") skip++; else fail++;
    } catch { fail++; }
    const n = done + skip + fail;
    if (n % 500 === 0) {
      const rate = n / ((Date.now() - t0) / 1000);
      console.log(`${n}/${sources.length} (${done} generated, ${skip} skipped, ${fail} failed) — ${rate.toFixed(1)}/s`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`FINISHED: ${done} generated, ${skip} skipped, ${fail} failed of ${sources.length}`);
