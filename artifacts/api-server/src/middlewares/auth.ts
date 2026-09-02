import type { NextFunction, Request, RequestHandler, Response } from "express";
import { SESSION_COOKIE, userFromSession, type AuthUser, type UserRole } from "../lib/auth";

export type AuthenticatedRequest = Request & { user?: AuthUser };

function cookieValue(request: Request, name: string) {
  const header = request.headers.cookie;
  if (!header) return undefined;
  return header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export const attachUser: RequestHandler = async (req, res, next) => {
  try {
    const user = await userFromSession(cookieValue(req, SESSION_COOKIE));
    (req as AuthenticatedRequest).user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;
  if (!user) return res.status(401).json({ error: "Authentication required." });
  return next();
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, res, next) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ error: "Authentication required." });
    if (!roles.some((role) => user.roles.includes(role))) return res.status(403).json({ error: "You do not have permission for this action." });
    return next();
  };
}

export function currentUser(req: Request) {
  return (req as AuthenticatedRequest).user;
}