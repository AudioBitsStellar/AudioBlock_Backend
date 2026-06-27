import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { authArtistMiddleware } from "../middlewares/authMiddleware";
import { UserRole } from "../entities/User";

jest.mock("jsonwebtoken");

describe("authArtistMiddleware", () => {
  const buildResponse = () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;

    return res;
  };

  it("rejects a listener-role JWT from artist-only routes", () => {
    const req = {
      headers: { authorization: "Bearer listener.jwt" },
    } as Request;
    const res = buildResponse();
    const next = jest.fn();
    process.env.JWT_SECRET = "test_secret";
    (jwt.verify as jest.Mock).mockReturnValue({
      id: "listener-1",
      role: UserRole.LISTENER,
    });

    authArtistMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Forbidden: one of these roles is required: artist, admin",
    });
    expect(next).not.toHaveBeenCalled();
  });
});
