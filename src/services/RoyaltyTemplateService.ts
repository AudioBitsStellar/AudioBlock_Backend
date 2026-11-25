import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { RoyaltyTemplate, TemplateSplit } from '../entities/RoyaltyTemplate';
import { AppError } from '../errors/AppError';
import { StrKey } from '@stellar/stellar-sdk';

export interface CreateTemplateInput {
  name: string;
  userId: string;
  splits: TemplateSplit[];
}

export class RoyaltyTemplateService {
  private templateRepo: Repository<RoyaltyTemplate>;

  constructor() {
    this.templateRepo = AppDataSource.getRepository(RoyaltyTemplate);
  }

  private validateSplits(splits: TemplateSplit[]): void {
    if (!Array.isArray(splits) || splits.length === 0) {
      throw AppError.validation('At least one royalty split is required');
    }

    const totalPercentage = splits.reduce((sum, split) => sum + Number(split.percentage), 0);
    if (!Number.isFinite(totalPercentage) || Math.abs(totalPercentage - 100) > 0.01) {
      throw AppError.validation('Template splits must total 100%');
    }

    const seenRecipients = new Set<string>();
    for (const split of splits) {
      if (!Number.isFinite(split.percentage) || split.percentage <= 0) {
        throw AppError.validation('Each royalty split percentage must be greater than zero');
      }
      if (!split.stellarAddress || !StrKey.isValidEd25519PublicKey(split.stellarAddress)) {
        throw AppError.validation('Each royalty split must include a valid Stellar G... address');
      }
      if (seenRecipients.has(split.stellarAddress)) {
        throw AppError.validation('Royalty split recipients must be unique');
      }
      seenRecipients.add(split.stellarAddress);
    }
  }

  async create(input: CreateTemplateInput): Promise<RoyaltyTemplate> {
    this.validateSplits(input.splits);

    const template = this.templateRepo.create({
      name: input.name,
      userId: input.userId,
      splits: input.splits,
    });

    return this.templateRepo.save(template);
  }

  async findByUser(userId: string): Promise<RoyaltyTemplate[]> {
    return this.templateRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<RoyaltyTemplate | null> {
    return this.templateRepo.findOneBy({ id });
  }

  async findOwnedById(id: string, userId: string): Promise<RoyaltyTemplate> {
    const template = await this.templateRepo.findOneBy({ id });
    if (!template) {
      throw AppError.notFound('Template not found');
    }
    if (template.userId !== userId) {
      throw AppError.authorization('Not authorized to view this template');
    }
    return template;
  }

  async update(
    id: string,
    userId: string,
    data: { name?: string; splits?: TemplateSplit[] },
  ): Promise<RoyaltyTemplate> {
    const template = await this.templateRepo.findOneBy({ id });
    if (!template) {
      throw AppError.notFound('Template not found');
    }

    if (template.userId !== userId) {
      throw AppError.authorization('Not authorized to modify this template');
    }

    if (data.name) {
      template.name = data.name;
    }

    if (data.splits) {
      this.validateSplits(data.splits);
      template.splits = data.splits;
    }

    return this.templateRepo.save(template);
  }

  async delete(id: string, userId: string): Promise<void> {
    const template = await this.templateRepo.findOneBy({ id });
    if (!template) {
      throw AppError.notFound('Template not found');
    }

    if (template.userId !== userId) {
      throw AppError.authorization('Not authorized to delete this template');
    }

    await this.templateRepo.remove(template);
  }
}
