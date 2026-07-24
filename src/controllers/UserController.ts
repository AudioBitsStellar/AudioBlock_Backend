import { CreateUserDTO } from "../dtos/CreateUserDTO";
import { UpdateUserDTO } from "../dtos/UpdateUserDTO";
import { User } from "../entities/User";
import { UserService } from "./../services/UserService";
import { Request, Response } from "express";
import { handleError } from "../utils/helpers";
import { HTTP_STATUS } from "../config/constants";

/**
 * Thin HTTP layer for user-related endpoints.
 * Delegates all business logic to UserService.
 */
export class UserController {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  getUserByWalletAddress = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const walletAddress = Array.isArray(req.params.walletAddress)
        ? req.params.walletAddress[0]
        : req.params.walletAddress;

      const user = await this.userService.getUserByWalletAddress(walletAddress);
      res.status(HTTP_STATUS.OK).json(user);
    } catch (error) {
      handleError(res, error);
    }
  };

  getUserById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const user = await this.userService.getUserById(id);
      res.status(HTTP_STATUS.OK).json(user);
    } catch (error) {
      handleError(res, error);
    }
  };

  getAllUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const users = await this.userService.getAllUsers();
      res.status(HTTP_STATUS.OK).json(users);
    } catch (error) {
      handleError(res, error);
    }
  };

  updateUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const user = await this.userService.updateUser(id, req.body);
      res.status(HTTP_STATUS.OK).json(user);
    } catch (error) {
      handleError(res, error);
    }
  };

  deleteUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const user = await this.userService.deleteUser(id);
      res.status(HTTP_STATUS.OK).json(user);
    } catch (error) {
      handleError(res, error);
    }
  };
}
