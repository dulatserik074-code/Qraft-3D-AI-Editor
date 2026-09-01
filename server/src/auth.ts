import { createClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";

export type AuthUser = { id: string; email?: string };
// Express requires namespace-based declaration merging for request context.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const serviceSupabase =
  url && serviceKey
    ? createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
export type TokenVerifier = (token: string) => Promise<AuthUser>;
export const verifySupabaseToken: TokenVerifier = async (token) => {
  if (!serviceSupabase)
    throw Object.assign(new Error("CLOUD_NOT_CONFIGURED"), {
      status: 503,
      code: "CLOUD_NOT_CONFIGURED",
    });
  const { data, error } = await serviceSupabase.auth.getUser(token);
  if (error || !data.user)
    throw Object.assign(new Error("UNAUTHORIZED"), {
      status: 401,
      code: "UNAUTHORIZED",
    });
  return { id: data.user.id, email: data.user.email };
};
export const requireUser =
  (verify: TokenVerifier = verifySupabaseToken) =>
  async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer "))
      return response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Требуется вход.",
          requestId: request.requestId,
        },
      });
    try {
      request.user = await verify(authorization.slice(7));
      next();
    } catch (error) {
      next(error);
    }
  };

export type UsageKind = "text" | "image" | "voice";
export async function consumeUsage(userId: string, kind: UsageKind) {
  if (!serviceSupabase)
    throw Object.assign(new Error("CLOUD_NOT_CONFIGURED"), {
      status: 503,
      code: "CLOUD_NOT_CONFIGURED",
    });
  const limits = {
    text: Number(process.env.AI_DAILY_TEXT_LIMIT || 50),
    image: Number(process.env.AI_DAILY_IMAGE_LIMIT || 10),
    voice: Number(process.env.AI_DAILY_VOICE_LIMIT || 20),
  };
  const { data, error } = await serviceSupabase.rpc("consume_ai_usage", {
    p_user_id: userId,
    p_kind: kind,
    p_user_limit: limits[kind],
    p_global_limit: Number(process.env.AI_GLOBAL_DAILY_LIMIT || 1000),
  });
  if (error)
    throw Object.assign(new Error("USAGE_CHECK_FAILED"), {
      status: 503,
      code: "USAGE_CHECK_FAILED",
    });
  if (data !== true)
    throw Object.assign(new Error("AI_DAILY_LIMIT"), {
      status: 429,
      code: "AI_DAILY_LIMIT",
    });
}
