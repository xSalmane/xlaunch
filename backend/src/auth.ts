import crypto from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.js";

/**
 * Connexion X (OAuth 2.0 + PKCE).
 * Le site (et l'embed dans X) ouvre /auth/x/start en popup ; la popup renvoie le jeton
 * à la page d'origine par postMessage (origine stricte). Pas de cookie tiers.
 * Si la popup n'a pas d'opener (bloquée, ou ouverte dans un onglet), elle redirige
 * vers la page de retour avec le jeton dans le fragment d'URL.
 */

const REDIRECT_URI = `${config.publicUrl}/auth/x/callback`;
const pending = new Map<string, { verifier: string; ret: string; exp: number }>();
const b64url = (b: Buffer) => b.toString("base64url");
const safeReturn = (r: unknown) => (typeof r === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(r) ? r : "/");

export const DEV_LOGIN = process.env.DEV_LOGIN === "1";
if (DEV_LOGIN && config.chain === "base") throw new Error("DEV_LOGIN interdit sur Base mainnet");

export type Session = {
  sub: string; // id numérique X
  handle: string;
  avatar: string;
  accountCreated: number;
  followers: number;
  iat: number;
};

export const authRouter = Router();

authRouter.get("/auth/x/start", (req, res) => {
  if (DEV_LOGIN) return res.redirect(`/auth/dev?return=${encodeURIComponent(safeReturn(req.query.return))}`);
  if (!config.xClientId || !config.xClientSecret)
    return res.status(503).send(page("Sign-in with X isn't set up on this site yet. Try again a bit later."));
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  pending.set(state, { verifier, ret: safeReturn(req.query.return), exp: Date.now() + 10 * 60_000 });
  for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);

  // encodage %20 (et non "+") pour les espaces, comme dans la documentation X
  const params: Record<string, string> = {
    response_type: "code",
    client_id: config.xClientId,
    redirect_uri: REDIRECT_URI,
    scope: "tweet.read users.read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  };
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  res.redirect(`https://x.com/i/oauth2/authorize?${qs}`);
});

authRouter.get("/auth/x/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  const p = state ? pending.get(state) : undefined;
  if (!code || !state || !p || p.exp < Date.now()) return res.status(400).send(page("This sign-in link has expired. Start signing in again from the site."));
  pending.delete(state);

  try {
    const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${config.xClientId}:${config.xClientSecret}`).toString("base64"),
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: p.verifier }),
    });
    if (!tokenRes.ok) throw new Error("token " + tokenRes.status);
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const meRes = await fetch("https://api.x.com/2/users/me?user.fields=created_at,public_metrics,profile_image_url", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) throw new Error("me " + meRes.status);
    const { data } = (await meRes.json()) as {
      data: { id: string; username: string; created_at: string; profile_image_url?: string; public_metrics: { followers_count: number } };
    };

    const jwt = await issue({
      id: data.id,
      handle: data.username,
      avatar: data.profile_image_url ?? "",
      accountCreated: Math.floor(new Date(data.created_at).getTime() / 1000),
      followers: data.public_metrics.followers_count,
    });
    finish(res, jwt, p.ret);
  } catch (e) {
    console.error("oauth", e);
    res.status(502).send(page("X didn't respond to the sign-in. Close this window and try again."));
  }
});

// Connexion de démo (testnet / local uniquement) : choisit un pseudo sans passer par X.
authRouter.get("/auth/dev", async (req, res) => {
  if (!DEV_LOGIN) return res.status(404).end();
  const ret = safeReturn(req.query.return);
  const handle = typeof req.query.handle === "string" ? req.query.handle.replace(/[^\w]/g, "").slice(0, 15) : "";
  if (!handle) {
    return res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demo sign-in</title><body style="font-family:system-ui;max-width:360px;margin:48px auto;padding:0 16px">
<h1 style="font-size:20px">Demo sign-in</h1>
<p>Test mode: no X account is contacted. Pick a username.</p>
<form><input type="hidden" name="return" value="${ret}">
<input name="handle" placeholder="username" required style="padding:10px;width:100%;margin-bottom:10px;font:inherit">
<button style="padding:10px 16px;font:inherit">Sign in</button></form>`);
  }
  const id = String(BigInt("0x" + crypto.createHash("sha256").update(handle.toLowerCase()).digest("hex").slice(0, 15)));
  const jwt = await issue({ id, handle, avatar: "", accountCreated: 1_500_000_000, followers: 1000 });
  finish(res, jwt, ret);
});

async function issue(u: { id: string; handle: string; avatar: string; accountCreated: number; followers: number }) {
  return new SignJWT({ handle: u.handle, avatar: u.avatar, accountCreated: u.accountCreated, followers: u.followers })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(config.jwtSecret);
}

function finish(res: Response, jwt: string, ret: string) {
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
  res.send(`<!doctype html><meta charset="utf-8"><title>Signed in</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p>Signed in. This window will close.</p>
<script>
  const t = ${JSON.stringify(jwt)};
  const origin = ${JSON.stringify(config.publicUrl)};
  if (window.opener) { try { window.opener.postMessage({ type: "xlaunch-auth", token: t }, origin); } catch (e) {} window.close(); }
  setTimeout(() => location.replace(${JSON.stringify(ret)} + "#t=" + encodeURIComponent(t)), 300);
</script>`);
}

const page = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:24px">${msg}</body>`;

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.header("authorization");
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in with X to continue." });
  try {
    const { payload } = await jwtVerify(h.slice(7), config.jwtSecret, { algorithms: ["HS256"] });
    res.locals.session = payload as unknown as Session;
    next();
  } catch {
    res.status(401).json({ error: "Your session expired. Sign in with X again." });
  }
}

/** raison d'inéligibilité, ou null */
export function eligibility(s: Session): string | null {
  const ageDays = (Date.now() / 1000 - s.accountCreated) / 86400;
  if (ageDays < config.minAccountAgeDays) return `Your X account must be at least ${config.minAccountAgeDays} days old to launch a token.`;
  if (s.followers < config.minFollowers) return `You need at least ${config.minFollowers} followers on X to launch a token.`;
  return null;
}
