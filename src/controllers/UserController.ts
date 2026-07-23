import { CreateUserDTO } from '../dtos/CreateUserDTO';
import { UpdateUserDTO } from '../dtos/UpdateUserDTO';
import { User } from '../entities/User';
import { UserService } from './../services/UserService';
import { Request, Response } from 'express';

export class UserController {

    private userService: UserService
    constructor() {
        this.userService = new UserService();
    }

    getUserByWalletAddress =async (req: Request, res: Response): Promise<void> => {
        try {
            const walletAddress: string = Array.isArray(req.params.walletAddress) ? req.params.walletAddress[0] : req.params.walletAddress;
            const user: User | null = await this.userService.getUserByWalletAddress(walletAddress);
            res.status(200).json(user);
        } catch (error) {
            req.log.error({ err: error }, "Get user by wallet address error");
            this.handleError(res, error);
        }
    }

    getUserById =async (req: Request, res: Response): Promise<void> => {
        try {
            const id: string = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            const user: User | null = await this.userService.getUserById(id);
            res.status(200).json(user);
        } catch (error) {
            req.log.error({ err: error }, "Get user by id error");
            this.handleError(res, error);
        }
    }

    getAllUsers = async (req: Request, res: Response): Promise<void> => {
        try {
            const users: User[] = await this.userService.getAllUsers();
            res.status(200).json(users);
        } catch (error) {
            req.log.error({ err: error }, "Get all users error");
            this.handleError(res, error);
        }
    }

    updateUser =async (req: Request, res: Response): Promise<void> => {
        try {
            const id: string = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            const updateData: UpdateUserDTO = req.body;
            const user: User | null = await this.userService.updateUser(id, updateData);
            res.status(200).json(user);
        } catch (error) {
            req.log.error({ err: error }, "Update user error");
            this.handleError(res, error);
        }
    }

    deleteUser = async (req: Request, res: Response): Promise<void> => {
        try {
            const id: string = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            const user: User | null = await this.userService.deleteUser(id);
            res.status(200).json(user);
        } catch (error) {
            req.log.error({ err: error }, "Delete user error");
            this.handleError(res, error);
        }
    }

    private handleError(res: Response, error: unknown): void {
        if (error instanceof Error) {
            res.log.error({ err: error }, "Handled error");
            res.status(400).json({ message: error.message });
        } else if (typeof error === 'string') {
            res.log.error({ error }, "String error");
            res.status(400).json({ message: error });
        } else {
            res.log.error({ error }, "Unknown error");
            res.status(500).json({ message: "Internal server error" });
        }
    }
}
