import { Router, Request, Response } from "express";
import axios from "axios";
import crypto from "crypto";
import AppDataSource from "../config/db";
import { User } from "../entities/User";
import { generateCodeVerifier, generateCodeChallenge } from "../utils/helpers";
import { authArtistMiddleware } from "../middlewares/authMiddleware";
import redis from "../config/redis";

const router = Router();

// TTL for state in seconds (5 minutes)
const STATE_TTL = 300;

// helper types for stored payload
type StoredState = {
  codeVerifier: string;
  userId: string;
};

// ---------- /init (authenticated) ----------
// The artist frontend calls this while sending the JWT in Authorization header.
// Generates PKCE+state, stores verifier+userId in Redis, then redirects to Twitter.
router.get("/init", authArtistMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const state = crypto.randomBytes(16).toString("hex");
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const storeVal: StoredState = { codeVerifier, userId };
    await redis.set(`twitter:state:${state}`, JSON.stringify(storeVal), "EX", STATE_TTL);

    const twitterAuthURL = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${process.env.TWITTER_CLIENT_ID}&redirect_uri=${encodeURIComponent(
      process.env.TWITTER_REDIRECT_URI!
    )}&scope=tweet.read%20users.read%20offline.access&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    return res.redirect(twitterAuthURL);
  } catch (err: any) {
    console.error("Twitter init failed:", err?.response?.data || err?.message || err);
    return res.status(500).json({ error: "Twitter init failed" });
  }
});

// ---------- /callback (Twitter redirects here after user authorises) ----------
// Token persistence note (#44): the Twitter access token obtained during this
// OAuth exchange is used ONCE to fetch the user's profile fields and is then
// discarded — it is NOT stored in the database. AudioBlocks uses Twitter only
// for identity/profile enrichment (username, display name, profile image).
// There is no ongoing API access that would require token refresh, so no
// token refresh flow is needed.  If a future feature requires posting tweets
// or reading DMs on the user's behalf, persist access_token / refresh_token
// and implement the OAuth 2.0 refresh flow at that point.
router.get("/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state" });
  }

  const raw = await redis.get(`twitter:state:${state}`);
  if (!raw) {
    return res.status(400).json({ error: "Invalid or expired state" });
  }

  let stored: StoredState;
  try {
    stored = JSON.parse(raw) as StoredState;
  } catch (e) {
    await redis.del(`twitter:state:${state}`);
    return res.status(400).json({ error: "Invalid state data" });
  }

  const codeVerifier = stored.codeVerifier;
  const userId = stored.userId;

  try {
    const tokenRes = await axios.post(
      "https://api.twitter.com/2/oauth2/token",
      new URLSearchParams({
        code: code as string,
        grant_type: "authorization_code",
        redirect_uri: process.env.TWITTER_REDIRECT_URI!,
        client_id: process.env.TWITTER_CLIENT_ID!,
        code_verifier: codeVerifier,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.TWITTER_CLIENT_ID!}:${process.env.TWITTER_CLIENT_SECRET!}`
            ).toString("base64"),
        },
      }
    );

    const access_token = (tokenRes.data as any).access_token;
    if (!access_token) {
      throw new Error("No access token returned");
    }

    const userRes = await axios.get(
      "https://api.twitter.com/2/users/me?user.fields=profile_image_url,description,location,created_at,verified",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    const twitterUser = (userRes.data as any).data;

    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      await redis.del(`twitter:state:${state}`);
      return res.status(404).json({ error: "User not found" });
    }

    const profileImage =
      twitterUser.profile_image_url?.replace("_normal", "_400x400") || null;

    user.name = twitterUser.name ?? user.name;
    user.twitterId = twitterUser.id;
    user.twitterUsername = twitterUser.username;
    user.twitterDisplayName = twitterUser.name;
    user.twitterProfileImage = profileImage;
    user.profileImage = profileImage ?? user.profileImage;
    user.twitterConnected = true;
    user.twitterVerified = !!twitterUser.verified;

    await userRepo.save(user);
    await redis.del(`twitter:state:${state}`);

    // #44/#62: TWITTER_SUCCESS_REDIRECT must be set to the artist-dashboard route
    // that handles post-OAuth arrival (e.g. /settings/social or /dashboard/connect).
    // The frontend reads the `twitter_connected=1` query param and refreshes its
    // UI state (profile badge, connected status indicator).
    // Startup will throw if this variable is absent so misconfiguration is caught early.
    const successRedirect = process.env.TWITTER_SUCCESS_REDIRECT;
    if (!successRedirect) {
      throw new Error(
        "TWITTER_SUCCESS_REDIRECT is not configured. Set it to the artist-dashboard URL " +
        "that receives the post-OAuth redirect (e.g. https://artist.audioblockz.com/settings/social)."
      );
    }

    return res.redirect(`${successRedirect}?twitter_connected=1`);
  } catch (error: any) {
    console.error("Twitter auth failed:", error.response?.data || error.message || error);
    await redis.del(`twitter:state:${state}`);
    return res.status(500).json({ error: "Twitter authentication failed" });
  }
});

// ---------- /disconnect (authenticated) ----------
// Clears all Twitter-linked fields on the authenticated user's account.
// After this call the user can re-run the OAuth flow to reconnect a different account.
router.post("/disconnect", authArtistMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.twitterConnected) {
      return res.status(400).json({ error: "Twitter is not connected" });
    }

    user.twitterId = undefined;
    user.twitterUsername = undefined;
    user.twitterDisplayName = undefined;
    user.twitterProfileImage = undefined;
    user.twitterConnected = false;
    user.twitterVerified = false;

    await userRepo.save(user);

    return res.status(200).json({ success: true, message: "Twitter account disconnected" });
  } catch (err: any) {
    console.error("Twitter disconnect failed:", err?.message || err);
    return res.status(500).json({ error: "Twitter disconnect failed" });
  }
});

export default router;
