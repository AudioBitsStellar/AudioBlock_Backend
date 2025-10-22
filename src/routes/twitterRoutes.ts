import { Router, Request, Response } from "express";
import axios from "axios";
import crypto from "crypto";
import AppDataSource from "../config/db";
import { User } from "../entities/User";
import { generateCodeVerifier, generateCodeChallenge } from "../utils/helpers";
import { authArtistMiddleware } from "../middlewares/authMiddleware";
import redis from "../config/redis";

const router = Router();

// TTL for state in seconds (e.g., 5 minutes)
const STATE_TTL = 300;

// helper types for stored payload
type StoredState = {
  codeVerifier: string;
  userId: string;
};

// ---------- /init (authenticated) ----------
// User (frontend) calls this endpoint while sending the JWT in Authorization header.
// This endpoint generates PKCE+state, stores the verifier+userId in Redis and redirects to Twitter.
router.get("/init", authArtistMiddleware, async (req: Request, res: Response) => {
  try {
    // if your auth middleware augments req.user, adjust typing; cast here to be safe
    const userId = (req as any).user?.id as string | undefined;
    // const userId = "bdbf8392-7c27-4f4f-99de-182178f65ebf";
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const state = crypto.randomBytes(16).toString("hex");
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // store state -> { codeVerifier, userId } in Redis
    const storeVal: StoredState = { codeVerifier, userId };
    await redis.set(`twitter:state:${state}`, JSON.stringify(storeVal), "EX", STATE_TTL);

    const twitterAuthURL = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${process.env.TWITTER_CLIENT_ID}&redirect_uri=${encodeURIComponent(
      process.env.TWITTER_REDIRECT_URI!
    )}&scope=tweet.read%20users.read%20offline.access&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    // redirect the user's browser to twitter
    return res.redirect(twitterAuthURL);
  } catch (err: any) {
    console.error("Twitter init failed:", err?.response?.data || err?.message || err);
    return res.status(500).json({ error: "Twitter init failed" });
  }
});

// ---------- /callback (twitter redirects here) ----------
router.get("/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state" });
  }

  // load stored codeVerifier + userId from Redis
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
    // Exchange code for token (include Basic auth header)
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

    // Get user info with extra fields
    const userRes = await axios.get(
      "https://api.twitter.com/2/users/me?user.fields=profile_image_url,description,location,created_at,verified",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    const twitterUser = (userRes.data as any).data;

    // Save to DB using the userId we stored earlier
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      // cleanup on failure
      await redis.del(`twitter:state:${state}`);
      return res.status(404).json({ error: "User not found" });
    }

    // map values (optional: transform profile image to bigger size)
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

    // cleanup
    await redis.del(`twitter:state:${state}`);

    // Redirect back to your frontend or respond JSON depending on client
    // Common pattern: redirect to frontend route that shows success
    // Example:
    const successRedirect = process.env.TWITTER_SUCCESS_REDIRECT || "https://yourfrontend.com/settings";
    return res.redirect(successRedirect + "?twitter_connected=1");
  } catch (error: any) {
    console.error("Twitter auth failed:", error.response?.data || error.message || error);
    // cleanup
    await redis.del(`twitter:state:${state}`);
    return res.status(500).json({ error: "Twitter authentication failed" });
  }
});

export default router;
