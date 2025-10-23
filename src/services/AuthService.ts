import { validate } from "class-validator";
import { JWTDTO } from "../dtos/JWTDTO";
import { verifyMessage } from "ethers";
import { Repository } from "typeorm";
import { User } from "../entities/User";
import AppDataSource from "../config/db";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { profile } from "console";
import redis from "../config/redis";
import { randomBytes } from "crypto";

export class AuthService {
  private userRepo: Repository<User>;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    dotenv.config();
  }

  async getNonce(email: string): Promise<any> {
    if (!email) {
      throw new Error("Email is required");
    }

    const nonce = randomBytes(16).toString("hex");

    // store nonce with 5-min expiry
    await redis.set(`nonce:${email}`, nonce, "EX", 300);

    return nonce;
  }

  async login(data: JWTDTO): Promise<{ user: User; token: string }> {
    const dto = Object.assign(new JWTDTO(), data);
    const errors = await validate(dto);
    const JWT_SECRET = process.env.JWT_SECRET as string;

    if (!JWT_SECRET) {
      throw new Error("JWT_SECRET not set in environment variables");
    }

    if (errors.length > 0) {
      throw new Error(errors.map((error) => error.constraints).join(", "));
    }

    if (dto.message) {
      const nonceMatch = dto.message.match(/Nonce: (\w+)/);
      if (!nonceMatch) throw new Error("Nonce missing in message");
      const nonce = nonceMatch[1];

      const storedNonce = await redis.get(`nonce:${dto.email}`);
      console.log("Stored nonce:", storedNonce);
      if (!storedNonce || storedNonce !== nonce) {
        throw new Error("Invalid or expired nonce");
      }

      // Delete nonce immediately (one-time use)
      await redis.del(`nonce:${dto.email}`);
    }

    const user = await this.userRepo.findOneBy({ email: dto.email });
    if (!user) {
      throw new Error("User not found");
    }

    const payload = {
      id: user.id,
      dynamixUserId: user.dynamixUserId,
      email: user.email,
      walletAddress: user.walletAddress,
      role: user.role,
      username: user.username,
      profileImage: user.profileImage,
      name: user.name,
      rewardPoints: user.rewardPoints,
      totalStreams: user.totalStreams,
      totalStreamTime: user.totalStreamTime,
      uniqueListeners: user.uniqueListeners,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });
    return { user, token };
  }

}
