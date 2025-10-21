import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import AppDataSource from "../config/db";
import { User } from "../entities/User";
import { generateCodeVerifier, generateCodeChallenge } from "../utils/helpers";
import axios from "axios";

const router = Router();

const codeStore = new Map<string, string>(); // state -> code_verifier

// Step 1 - Redirect User to Twitter Authentication
router.get("/login", (req, res) => {
  const state = Math.random().toString(36).substring(2);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // store verifier for this state
  codeStore.set(state, codeVerifier);

  const twitterAuthURL = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${
    process.env.TWITTER_CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    process.env.TWITTER_REDIRECT_URI!
  )}&scope=tweet.read%20users.read%20offline.access%20users.read&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

  res.redirect(twitterAuthURL);
});

// Step 2 - Handle Callback
router.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  const userId = (req as any).user?.id;
  const codeVerifier = codeStore.get(state as string);

  if (!codeVerifier) {
    return res.status(400).json({ error: "Missing code verifier" });
  }

  try {
    // Exchange authorization code for access token
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
              `${process.env.TWITTER_CLIENT_ID!}:${process.env
                .TWITTER_CLIENT_SECRET!}`
            ).toString("base64"),
        },
      }
    );

    const access_token = (tokenRes.data as any).access_token;

    // Get user info
    const userRes = await axios.get(
      "https://api.twitter.com/2/users/me?user.fields=profile_image_url,description,location,created_at,verified",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    const twitterUser = (userRes.data as any).data;

    // Example response: { id, name, username }
    // Save this verified info to your DB for the logged-in Audioblocks user
    console.log("Verified Twitter User:", twitterUser);

    // Find logged-in user
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update verified Twitter info
    user.name = twitterUser.name;
    user.twitterId = twitterUser.id;
    user.twitterUsername = twitterUser.username;
    user.twitterDisplayName = twitterUser.name;
    user.twitterProfileImage = twitterUser.profile_image_url;
    user.profileImage = twitterUser.profile_image_url;
    user.twitterConnected = true;
    user.twitterVerified = twitterUser.verified;

    await userRepo.save(user);

    res.status(200).json({
      success: true,
      message: "Twitter account connected successfully",
      twitterUser,
    });
  } catch (error: any) {
    console.error(
      "Twitter auth failed:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Twitter authentication failed" });
  } finally {
    // cleanup
    codeStore.delete(state as string);
  }
});

export default router;
