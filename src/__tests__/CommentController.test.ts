import 'reflect-metadata';

const mockCreateComment = jest.fn();
const mockGetSongComments = jest.fn();
const mockGetReplies = jest.fn();
const mockUpdateComment = jest.fn();
const mockDeleteComment = jest.fn();

jest.mock('../services/CommentService', () => ({
  CommentService: jest.fn().mockImplementation(() => ({
    createComment: mockCreateComment,
    getSongComments: mockGetSongComments,
    getReplies: mockGetReplies,
    updateComment: mockUpdateComment,
    deleteComment: mockDeleteComment,
  })),
}));

import { CommentController } from '../controllers/CommentController';
import { Request, Response } from 'express';

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return { body: {}, params: {}, query: {}, ...overrides } as unknown as Request;
}

function mockRes(): { res: Response; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { res: { json, status } as unknown as Response, json, status };
}

beforeEach(() => {
  mockCreateComment.mockReset();
  mockGetSongComments.mockReset();
  mockGetReplies.mockReset();
  mockUpdateComment.mockReset();
  mockDeleteComment.mockReset();
});

describe('CommentController.createComment', () => {
  it('rejects an unauthenticated request', async () => {
    const controller = new CommentController();
    const req = mockReq({ params: { id: 'song1' }, body: { text: 'nice track' } });
    const { res, status } = mockRes();

    await controller.createComment(req, res);

    expect(mockCreateComment).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('creates a comment for an authenticated user', async () => {
    mockCreateComment.mockResolvedValue({ id: 'c1', text: 'nice track' });
    const controller = new CommentController();
    const req = mockReq({
      user: { id: 'user1' },
      params: { id: 'song1' },
      body: { text: 'nice track' },
    });
    const { res, status, json } = mockRes();

    await controller.createComment(req, res);

    expect(mockCreateComment).toHaveBeenCalledWith('user1', 'song1', 'nice track', undefined);
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      message: 'Comment created successfully',
      comment: { id: 'c1', text: 'nice track' },
    });
  });

  it('passes parentId through when replying', async () => {
    mockCreateComment.mockResolvedValue({ id: 'c2', text: 'agreed', parentId: 'c1' });
    const controller = new CommentController();
    const req = mockReq({
      user: { id: 'user1' },
      params: { id: 'song1' },
      body: { text: 'agreed', parentId: 'c1' },
    });
    const { res } = mockRes();

    await controller.createComment(req, res);

    expect(mockCreateComment).toHaveBeenCalledWith('user1', 'song1', 'agreed', 'c1');
  });
});

describe('CommentController.updateComment — authorization (issue #317)', () => {
  it('rejects an unauthenticated request without calling the service', async () => {
    const controller = new CommentController();
    const req = mockReq({ params: { id: 'c1' }, body: { text: 'edited' } });
    const { res, status } = mockRes();

    await controller.updateComment(req, res);

    expect(mockUpdateComment).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('delegates authorship enforcement to the service and surfaces its rejection', async () => {
    // The service is the actual author/moderator boundary — the controller's
    // job is only to pass the caller's id through and propagate whatever the
    // service decides, not to re-implement the check.
    const { AppError } = jest.requireActual('../errors/AppError');
    mockUpdateComment.mockRejectedValue(AppError.authorization('Not the comment author'));

    const controller = new CommentController();
    const req = mockReq({
      user: { id: 'not-the-author' },
      params: { id: 'c1' },
      body: { text: 'edited' },
    });
    const { res, status } = mockRes();

    await controller.updateComment(req, res);

    expect(mockUpdateComment).toHaveBeenCalledWith('not-the-author', 'c1', 'edited');
    expect(status).toHaveBeenCalledWith(403);
  });

  it('updates the comment for the authenticated author', async () => {
    mockUpdateComment.mockResolvedValue({ id: 'c1', text: 'edited' });
    const controller = new CommentController();
    const req = mockReq({
      user: { id: 'author1' },
      params: { id: 'c1' },
      body: { text: 'edited' },
    });
    const { res, status, json } = mockRes();

    await controller.updateComment(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      message: 'Comment updated successfully',
      comment: { id: 'c1', text: 'edited' },
    });
  });
});

describe('CommentController.deleteComment — authorization (issue #317)', () => {
  it('rejects an unauthenticated request without calling the service', async () => {
    const controller = new CommentController();
    const req = mockReq({ params: { id: 'c1' } });
    const { res, status } = mockRes();

    await controller.deleteComment(req, res);

    expect(mockDeleteComment).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('surfaces the service authorization rejection for a non-author, non-moderator caller', async () => {
    const { AppError } = jest.requireActual('../errors/AppError');
    mockDeleteComment.mockRejectedValue(
      AppError.authorization('Not authorized to delete this comment'),
    );

    const controller = new CommentController();
    const req = mockReq({ user: { id: 'stranger' }, params: { id: 'c1' } });
    const { res, status } = mockRes();

    await controller.deleteComment(req, res);

    expect(mockDeleteComment).toHaveBeenCalledWith('stranger', 'c1');
    expect(status).toHaveBeenCalledWith(403);
  });

  it('deletes the comment for the authenticated author', async () => {
    mockDeleteComment.mockResolvedValue(undefined);
    const controller = new CommentController();
    const req = mockReq({ user: { id: 'author1' }, params: { id: 'c1' } });
    const { res, status, json } = mockRes();

    await controller.deleteComment(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ message: 'Comment deleted successfully' });
  });
});

describe('CommentController.getSongComments', () => {
  it('applies default pagination', async () => {
    mockGetSongComments.mockResolvedValue({ comments: [], total: 0 });
    const controller = new CommentController();
    const req = mockReq({ params: { id: 'song1' } });
    const { res } = mockRes();

    await controller.getSongComments(req, res);

    expect(mockGetSongComments).toHaveBeenCalledWith('song1', 1, 20);
  });

  it('passes explicit page/limit query params through', async () => {
    mockGetSongComments.mockResolvedValue({ comments: [], total: 0 });
    const controller = new CommentController();
    const req = mockReq({ params: { id: 'song1' }, query: { page: '2', limit: '5' } });
    const { res } = mockRes();

    await controller.getSongComments(req, res);

    expect(mockGetSongComments).toHaveBeenCalledWith('song1', 2, 5);
  });
});

describe('CommentController.getReplies', () => {
  it('lists replies to a comment with pagination', async () => {
    mockGetReplies.mockResolvedValue({ replies: [{ id: 'r1' }], total: 1 });
    const controller = new CommentController();
    const req = mockReq({ params: { id: 'c1' }, query: { page: '1', limit: '10' } });
    const { res, json } = mockRes();

    await controller.getReplies(req, res);

    expect(mockGetReplies).toHaveBeenCalledWith('c1', 1, 10);
    expect(json).toHaveBeenCalledWith({ replies: [{ id: 'r1' }], total: 1 });
  });
});
