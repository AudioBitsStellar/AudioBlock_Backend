import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { RoyaltyTemplate, TemplateSplit } from '../entities/RoyaltyTemplate';
import { AppError } from '../errors/AppError';

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

  async create(input: CreateTemplateInput): Promise<RoyaltyTemplate> {
    const totalPercentage = input.splits.reduce((sum, s) => sum + s.percentage, 0);
    if (Math.abs(totalPercentage - 100) > 0.01) {
      throw AppError.validation('Template splits must total 100%');
    }

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
      const totalPercentage = data.splits.reduce((sum, s) => sum + s.percentage, 0);
      if (Math.abs(totalPercentage - 100) > 0.01) {
        throw AppError.validation('Template splits must total 100%');
      }
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
