import { plainToInstance } from 'class-transformer';
import { CreateUserDTO } from '../dtos/CreateUserDTO';
import { JWTDTO } from '../dtos/JWTDTO';
import { UpdateUserDTO } from '../dtos/UpdateUserDTO';
import { User } from '../entities/User';
import { AuthService } from '../services/AuthService';
import { UserService } from './../services/UserService';
import { Request, Response } from 'express';
import { validate } from 'class-validator';

export class AuthController {

    private userService: UserService
    private authService: AuthService;
    
    constructor() {
        this.userService = new UserService();
        this.authService = new AuthService();
    }

    register = async(req: Request, res: Response) => {
        try {
            // Add detailed logging for debugging
            console.log("=== REGISTER REQUEST DEBUG ===");
            console.log("Headers:", req.headers);
            console.log("Body:", JSON.stringify(req.body, null, 2));
            console.log("Body type:", typeof req.body);
            console.log("Body constructor:", req.body?.constructor?.name);

            // Validate request body exists
            if (!req.body || Object.keys(req.body).length === 0) {
                return res.status(400).json({ 
                    message: "Request body is required" 
                });
            }

            // Check for required fields before transformation
            const requiredFields = ['role', 'walletAddress', 'signature', 'message'];
            const missingFields = requiredFields.filter(field => !req.body[field]);
            
            if (missingFields.length > 0) {
                return res.status(400).json({ 
                    message: `Missing required fields: ${missingFields.join(', ')}` 
                });
            }

            // Transform with explicit options
            const userData = plainToInstance(CreateUserDTO, req.body, {
                excludeExtraneousValues: true,
                enableImplicitConversion: true
            });

            console.log("Transformed userData:", userData);
            console.log("UserData constructor:", userData?.constructor?.name);

            // Validate the transformed data
            const errors = await validate(userData);

            if (errors.length > 0) {
                console.log("Validation errors:", errors);
                const formattedErrors = errors.map(err => {
                    const constraints = err.constraints || {};
                    return Object.values(constraints);
                }).flat();
                
                return res.status(400).json({ 
                    message: formattedErrors.length > 0 ? formattedErrors : "Validation failed" 
                });
            }

            // Create user
            const user = await this.userService.createUser(userData);
            res.status(201).json(user);
            
        } catch (error) {
          
            
            this.handleError(res, error);
        }
    }

    login = async (req: Request, res: Response) => {
        try {
            // Add request validation
            if (!req.body || Object.keys(req.body).length === 0) {
                return res.status(400).json({ 
                    message: "Request body is required" 
                });
            }

            // You might want to validate JWTDTO as well
            const data: JWTDTO = req.body;
            
            // Optional: Add validation for JWTDTO
            const loginData = plainToInstance(JWTDTO, req.body);
            const errors = await validate(loginData);
            
            if (errors.length > 0) {
                const formattedErrors = errors.map(err => Object.values(err.constraints || {})).flat();
                return res.status(400).json({ message: formattedErrors });
            }

            const user = await this.authService.login(loginData);
            res.status(200).json(user); // Changed from 201 to 200 for login
            
        } catch (error) {
            console.error("Login error:", error);
            this.handleError(res, error);
        }
    }

     private handleError(res: Response, error: unknown): void {
        if (error instanceof Error) {
            console.error("Handled Error:", error.message, error.stack);
            
            res.status(400).json({ message: error.message });
        } else if (typeof error === 'string') {
            console.error("String Error:", error);
            res.status(400).json({ message: error });
        } else {
            console.error("Unknown Error:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    }
}