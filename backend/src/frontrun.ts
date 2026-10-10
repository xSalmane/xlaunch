// Smart followers via l'API Frontrun (frontrun.pro) : les comptes X « smart » (traders, fondateurs, fonds, KOLs)
// qui suivent un profil. Résultats gardés en cache pour économiser le quota de l'API.
import { kv } from "./db.js";

const KEY = process.env.FRONTRUN_API_KEY ?? "";
const BASE = (process.env.FRONTRUN_API_URL ?? "https://loadbalance.frontrun.pro").replace(/\/+$/, "");
const PATH = process.env.FRONTRUN_SMART_PATH ?? "/api/v1/twitter/{handle}/smart-followers";
const TTL_S = Number(process.env.FRONTRUN_CACHE_HOURS ?? 12) * 3600;
const ERROR_TTL_S = 10 * 60;

export const frontrunEnabled = () => !!KEY;

export type SmartFollower = { handle: string; name: string; avatar: string; followers: number; label: string };
export type SmartFollowers = { totalCount: number; followers: SmartFollower[]; fetchedAt: number };

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** l'API peut nommer les champs de plusieurs façons : on prend le premier qui existe */
function normalize(raw: unknown): SmartFollower | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const handle = str(r.twitterUsername ?? r.twitter ?? r.username ?? r.screenName ?? r.screen_name ?? r.handle).replace(/^@/, "");
  if (!/^\w{1,15}$/.test(handle)) return null;
  const labels = [r.primaryLabel, r.label, r.category, ...(Array.isArray(r.tags) ? r.tags : []), ...(Array.isArray(r.labels) ? r.labels : [])]
    .map((x) => (x && typeof x === "object" ? str((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).label) : str(x)))
    .filter(Boolean);
  const avatar = str(r.profileImageUrl ?? r.profilePhoto ?? r.profile_image_url ?? r.avatar ?? r.profileImage);
  return {
    handle,
    name: str(r.name ?? r.displayName ?? r.display_name) || handle,
    avatar: /^https:\/\//.test(avatar) ? avatar : "",
    followers: num(r.followersCount ?? r.followers_count ?? r.followers),
    label: (labels[0] ?? "").slice(0, 32),
  };
}

const inflight = new Map<string, Promise<SmartFollowers>>();

async function fetchSmart(handle: string): Promise<SmartFollowers> {
  const url = BASE + PATH.replace("{handle}", encodeURIComponent(handle));
  const res = await fetch(url, {
    headers: { "x-api-key": KEY, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Frontrun ${res.status} ${body}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const list = (data.smartFollowers ?? data.smart_followers ?? data.followers ?? data.data ?? data.items ?? []) as unknown[];
  const followers = (Array.isArray(list) ? list : []).map(normalize).filter((x): x is SmartFollower => !!x);
  return { totalCount: Math.max(num(data.totalCount ?? data.total_count ?? data.total ?? data.count), followers.length), followers, fetchedAt: Math.floor(Date.now() / 1000) };
}

/** smart followers d'un compte X (null si l'API n'est pas configurée) */
export async function smartFollowers(handleIn: string): Promise<SmartFollowers | null> {
  if (!KEY) return null;
  const handle = handleIn.replace(/^@/, "").toLowerCase();
  if (!/^\w{1,15}$/.test(handle)) throw new Error("Invalid X handle.");
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = "sf:" + handle;
  const cached = kv.get(cacheKey);
  if (cached) {
    const c = JSON.parse(cached) as { at: number; data?: SmartFollowers; error?: string };
    if (c.data && now - c.at < TTL_S) return c.data;
    if (c.error && now - c.at < ERROR_TTL_S) throw new Error(c.error);
  }
  let p = inflight.get(handle);
  if (!p) {
    p = fetchSmart(handle)
      .then((data) => { kv.set(cacheKey, JSON.stringify({ at: now, data })); return data; })
      .catch((e: Error) => {
        console.error("frontrun", handle, e.message);
        // on garde l'ancien résultat s'il existe, sinon on mémorise l'erreur quelques minutes
        if (cached) { const c = JSON.parse(cached); if (c.data) return c.data as SmartFollowers; }
        kv.set(cacheKey, JSON.stringify({ at: now, error: "Smart followers are unavailable right now." }));
        throw new Error("Smart followers are unavailable right now.");
      })
      .finally(() => inflight.delete(handle));
    inflight.set(handle, p);
  }
  return p;
}
