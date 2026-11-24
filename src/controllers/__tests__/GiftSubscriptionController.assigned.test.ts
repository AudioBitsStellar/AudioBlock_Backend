import { createMockRequest, createMockResponse } from '../../../tests/helpers';
import { GiftStatus } from '../../entities/GiftSubscription';
import { SubscriptionStatus, SubscriptionTier } from '../../entities/Subscription';

const giftRepo = {
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  create: jest.fn((value) => value),
  save: jest.fn(async (value) => value),
};
const subRepo = {
  findOne: jest.fn(),
  create: jest.fn((value) => value),
  save: jest.fn(async (value) => ({ id: 'sub-1', ...value })),
};
const manager = {
  getRepository: jest.fn((entity: any) =>
    entity?.name === 'GiftSubscription' ? giftRepo : subRepo,
  ),
};

const dataSource = {
  getRepository: jest.fn(() => giftRepo),
  transaction: jest.fn(async (fn: any) => fn(manager)),
};

jest.mock('../../config/data-source', () => ({
  __esModule: true,
  AppDataSource: dataSource,
  default: dataSource,
}));

const notify = jest.fn();
jest.mock('../../services/NotificationService', () => ({
  NotificationService: jest.fn().mockImplementation(() => ({ create: notify })),
}));

import { GiftSubscriptionController } from '../GiftSubscriptionController';

describe('GiftSubscriptionController rules (#758)', () => {
  const controller = new GiftSubscriptionController();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GIFT_SUBSCRIPTION_EXPIRY_DAYS = '5';
  });

  it('rejects self-gifting', async () => {
    const req = createMockRequest({
      userId: 'user-1',
      body: { recipientId: 'user-1', tier: SubscriptionTier.ARTIST_PRO },
    });
    const res = createMockResponse();

    await controller.sendGift(req, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(giftRepo.save).not.toHaveBeenCalled();
  });

  it('only allows the recipient to accept', async () => {
    giftRepo.findOne.mockResolvedValue({
      id: 'gift-1',
      senderId: 'sender',
      recipientId: 'recipient',
      tier: SubscriptionTier.ARTIST_PRO,
      status: GiftStatus.PENDING,
      expiresAt: new Date(Date.now() + 60000),
    });
    const req = createMockRequest({ userId: 'someone-else', params: { id: 'gift-1' } });
    const res = createMockResponse();

    await controller.acceptGift(req, res as any);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(subRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a second accept and keeps subscription mutation inside a transaction', async () => {
    giftRepo.findOne
      .mockResolvedValueOnce({
        id: 'gift-1',
        senderId: 'sender',
        recipientId: 'recipient',
        tier: SubscriptionTier.ARTIST_PRO,
        durationDays: 30,
        status: GiftStatus.PENDING,
        expiresAt: new Date(Date.now() + 60000),
      })
      .mockResolvedValueOnce({
        id: 'gift-1',
        senderId: 'sender',
        recipientId: 'recipient',
        tier: SubscriptionTier.ARTIST_PRO,
        status: GiftStatus.ACCEPTED,
      });
    subRepo.findOne.mockResolvedValue({
      id: 'sub-1',
      userId: 'recipient',
      tier: SubscriptionTier.FREE,
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
    });

    const req = createMockRequest({ userId: 'recipient', params: { id: 'gift-1' } });
    const first = createMockResponse();
    await controller.acceptGift(req, first as any);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(subRepo.save).toHaveBeenCalledTimes(1);
    expect(giftRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: GiftStatus.ACCEPTED }));

    const second = createMockResponse();
    await controller.acceptGift(req, second as any);
    expect(second.status).toHaveBeenCalledWith(409);
  });

  it('uses configurable expiry and notifies the recipient', async () => {
    giftRepo.findOne.mockResolvedValue(null);
    giftRepo.save.mockImplementation(async (value: any) => ({ id: 'gift-2', ...value }));
    notify.mockResolvedValue({ id: 'notification-1' });

    const req = createMockRequest({
      userId: 'sender',
      body: { recipientId: 'recipient', tier: SubscriptionTier.ARTIST_PRO },
    });
    const res = createMockResponse();

    const before = Date.now();
    await controller.sendGift(req, res as any);
    const saved = giftRepo.save.mock.calls[0][0];

    expect(saved.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5 * 86400000 - 1000);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'recipient' }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
