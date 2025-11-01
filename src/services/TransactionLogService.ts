import { Repository } from "typeorm";
import { TransactionLog } from "../entities/TransactionLog";
import AppDataSource from "../config/db";

export class TransactionLogService {
    // Implement transaction log methods here
    private transactionLogRepo: Repository<TransactionLog>;
    constructor() {
        // Initialization code here
        this.transactionLogRepo = AppDataSource.getRepository(TransactionLog);
    }

    async createLogEntry(userId: string, txHash: string, action: string, description: string): Promise<TransactionLog> {
        const log = this.transactionLogRepo.create({
            user_id: userId,
            txHash,
            action,
            description,
        });
        await this.transactionLogRepo.save(log);
        return log;
    }

    async getLogsByUser(userId: string): Promise<any[]> {
        return this.transactionLogRepo.findBy({ user_id: userId });
    }
}