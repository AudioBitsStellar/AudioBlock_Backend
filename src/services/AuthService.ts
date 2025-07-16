import { validate } from "class-validator";
import { JWTDTO } from "../dtos/JWTDTO";
import { verifyMessage } from "ethers";
import { Repository } from "typeorm";
import { User } from "../entities/User";
import AppDataSource from "../config/db";
import jwt from 'jsonwebtoken'
import dotenv from "dotenv";



export class AuthService {
    private userRepo: Repository<User>;

    constructor() {
        this.userRepo = AppDataSource.getRepository(User);
        dotenv.config();
    }
    

    async login(data: JWTDTO): Promise<{ user: User; token: string }> {
        const dto = Object.assign(new JWTDTO(), data);
        const errors = await validate(dto);
        const JWT_SECRET = process.env.JWT_SECRET as string;

        if (errors.length > 0) {
            throw new Error(
                errors.map((error) => error.constraints).join(", ")
            );
        }

        const recoveredAddress = verifyMessage(dto.message, dto.signature);

        if (recoveredAddress.toLowerCase() !== dto.walletAddress.toLowerCase()) {
            throw new Error("Invalid signature");
        }

        const user = await this.userRepo.findOneBy({ walletAddress: dto.walletAddress });
        if (!user) {
            throw new Error("User not found");
        }

        if (!JWT_SECRET) {
            throw new Error("JWT_SECRET not set in environment variables");
        }

        const token = jwt.sign(user, JWT_SECRET, { expiresIn: "1d" });
        return {user, token}
    }
}