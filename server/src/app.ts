import path from "node:path";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI, { toFile } from "openai";
import multer from "multer";
import { zodTextFormat } from "openai/helpers/zod";
import { objectSchema, patchSchema, sanitizePatch } from "./schema.js";
import {
  consumeUsage,
  requireUser,
  serviceSupabase,
  type TokenVerifier,
  type UsageKind,
} from "./auth.js";

const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const key = process.env.OPENAI_API_KEY;
const openai = key
  ? new OpenAI({ apiKey: key, timeout: 30_000, maxRetries: 1 })
  : null;
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const system =
  "Ты — движок Qraft 3D. Верни только безопасный ScenePatch из примитивов box, sphere, cylinder, cone, torus, plane. Все объекты остаются редактируемыми. Координаты ±100, scale 0.02–30. Понимай русский и английский. Для изменения существующих объектов сохраняй их id. Никакого кода, HTML, шейдеров или дополнительных полей.";

const jsonFor = (limit: string) => express.json({ limit, strict: true });
const parseOrigins = () =>
  (
    process.env.ALLOWED_ORIGINS ||
    process.env.CLIENT_ORIGIN ||
    "http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const validateDataUrl = (value: unknown) => {
  if (typeof value !== "string")
    throw Object.assign(new Error("INVALID_IMAGE"), {
      status: 400,
      code: "INVALID_IMAGE",
    });
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match || !allowedImageTypes.has(match[1]))
    throw Object.assign(new Error("INVALID_IMAGE"), {
      status: 400,
      code: "INVALID_IMAGE",
    });
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw Object.assign(new Error("IMAGE_TOO_LARGE"), {
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  const signatures =
    match[1] === "image/png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === "image/jpeg"
        ? bytes[0] === 0xff && bytes[1] === 0xd8
        : bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
          bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!signatures)
    throw Object.assign(new Error("INVALID_IMAGE"), {
      status: 400,
      code: "INVALID_IMAGE",
    });
  return value;
};

type AppOptions = {
  verifyToken?: TokenVerifier;
  consumeUsage?: (userId: string, kind: UsageKind) => Promise<void>;
};
export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((request, response, next) => {
    request.requestId =
      request.headers["x-request-id"]?.toString().slice(0, 100) ||
      crypto.randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  });
  app.use(helmet({ crossOriginResourcePolicy: false }));
  const origins = parseOrigins();
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origins.includes(origin)) callback(null, true);
        else
          callback(
            Object.assign(new Error("CORS_DENIED"), {
              status: 403,
              code: "CORS_DENIED",
            }),
          );
      },
    }),
  );
  const auth = requireUser(options.verifyToken);
  const useQuota = options.consumeUsage || consumeUsage;
  const aiMinuteLimit = rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 20),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request) => request.user?.id || request.ip || "unknown",
    handler: (request, response) =>
      response.status(429).json({
        error: {
          code: "RATE_LIMIT",
          message: "Слишком много запросов.",
          requestId: request.requestId,
        },
      }),
  });

  app.get("/api/health", (_request, response) =>
    response.json({
      ok: true,
      features: {
        textAi: !!openai && !!serviceSupabase,
        imageAi: !!openai && !!serviceSupabase,
        voiceAi: !!openai && !!serviceSupabase,
        cloudProjects: !!serviceSupabase,
      },
      model: openai ? model : null,
    }),
  );
  app.post(
    "/api/ai/scene",
    auth,
    aiMinuteLimit,
    jsonFor("256kb"),
    async (request, response, next) => {
      try {
        const prompt =
          typeof request.body?.prompt === "string"
            ? request.body.prompt.trim()
            : "";
        if (!prompt)
          return response.status(400).json({
            error: {
              code: "EMPTY_PROMPT",
              message: "Введите описание сцены.",
            },
          });
        if (prompt.length > 1000)
          return response.status(413).json({
            error: {
              code: "PROMPT_TOO_LARGE",
              message: "Запрос слишком длинный.",
            },
          });
        if (!openai)
          return response.status(503).json({
            error: {
              code: "AI_NOT_CONFIGURED",
              message: "AI не настроен.",
              requestId: request.requestId,
            },
          });
        await useQuota(request.user!.id, "text");
        const compact: unknown[] = Array.isArray(request.body.scene)
          ? request.body.scene.slice(0, 100)
          : [];
        const result = await openai.responses.parse({
          model,
          max_output_tokens: 8000,
          store: false,
          input: [
            { role: "system", content: system },
            {
              role: "user",
              content: `Запрос: ${prompt}\nТекущая сцена: ${JSON.stringify(compact).slice(0, 30_000)}`,
            },
          ],
          text: { format: zodTextFormat(patchSchema, "scene_patch") },
        });
        if (!result.output_parsed)
          throw Object.assign(new Error("EMPTY_MODEL_RESPONSE"), {
            code: "EMPTY_MODEL_RESPONSE",
          });
        const safe = sanitizePatch(result.output_parsed);
        const locked = compact.flatMap((item) => {
          const parsed = objectSchema.safeParse(item);
          return parsed.success && parsed.data.locked ? [parsed.data] : [];
        });
        const lockedIds = new Set(locked.map((item) => item.id));
        safe.objects =
          safe.mode === "replace"
            ? [
                ...locked,
                ...safe.objects.filter((item) => !lockedIds.has(item.id)),
              ]
            : safe.objects.filter((item) => !lockedIds.has(item.id));
        return response.json(safe);
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/ai/analyze-reference",
    auth,
    aiMinuteLimit,
    jsonFor("8mb"),
    async (request, response, next) => {
      try {
        if (request.body?.consent !== true)
          return response.status(403).json({
            error: {
              code: "CONSENT_REQUIRED",
              message: "Нужно явно разрешить отправку изображения.",
            },
          });
        const sourceImages = Array.isArray(request.body.images)
          ? request.body.images.slice(0, 2)
          : [];
        if (!sourceImages.length)
          return response.status(400).json({
            error: {
              code: "IMAGE_REQUIRED",
              message: "Добавьте изображение.",
            },
          });
        const images: string[] = sourceImages.map((image: unknown) =>
          validateDataUrl(image),
        );
        if (!openai)
          return response.status(503).json({
            error: {
              code: "AI_NOT_CONFIGURED",
              message: "Анализ изображений требует настроенного OpenAI API.",
              requestId: request.requestId,
            },
          });
        await useQuota(request.user!.id, "image");
        const content = [
          {
            type: "input_text" as const,
            text: "Собери приблизительную 3D-композицию из разрешённых примитивов. Невидимые стороны оцени осторожно.",
          },
          ...images.map((image_url) => ({
            type: "input_image" as const,
            image_url,
            detail: "low" as const,
          })),
        ];
        const result = await openai.responses.parse({
          model,
          max_output_tokens: 8000,
          store: false,
          input: [
            { role: "system", content: system },
            { role: "user", content },
          ],
          text: { format: zodTextFormat(patchSchema, "scene_patch") },
        });
        if (!result.output_parsed)
          throw Object.assign(new Error("EMPTY_MODEL_RESPONSE"), {
            code: "EMPTY_MODEL_RESPONSE",
          });
        return response.json(sanitizePatch(result.output_parsed));
      } catch (error) {
        next(error);
      }
    },
  );
  const uploadAudio = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) =>
      callback(
        null,
        [
          "audio/webm",
          "audio/mp4",
          "audio/mpeg",
          "audio/wav",
          "audio/ogg",
        ].includes(file.mimetype),
      ),
  });
  app.post(
    "/api/ai/transcribe",
    auth,
    aiMinuteLimit,
    uploadAudio.single("audio"),
    async (request, response, next) => {
      try {
        if (!request.file)
          return response.status(400).json({
            error: {
              code: "AUDIO_REQUIRED",
              message: "Добавьте аудиозапись.",
              requestId: request.requestId,
            },
          });
        if (!openai)
          return response.status(503).json({
            error: {
              code: "AI_NOT_CONFIGURED",
              message: "Голосовой AI не настроен.",
              requestId: request.requestId,
            },
          });
        await useQuota(request.user!.id, "voice");
        const file = await toFile(
          request.file.buffer,
          request.file.originalname || "command.webm",
          { type: request.file.mimetype },
        );
        const transcription = await openai.audio.transcriptions.create({
          file,
          model:
            process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
        });
        return response.json({ text: transcription.text.slice(0, 2000) });
      } catch (error) {
        next(error);
      }
    },
  );
  app.all("/api/*", (_request, response) =>
    response.status(404).json({
      error: { code: "NOT_FOUND", message: "API-маршрут не найден." },
    }),
  );

  if (process.env.NODE_ENV === "production") {
    const clientDirectory = path.resolve(process.cwd(), "client", "dist");
    app.use(express.static(clientDirectory));
    app.get("*", (_request, response) =>
      response.sendFile(path.join(clientDirectory, "index.html")),
    );
  }

  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    void _next;
    const status =
      error?.type === "entity.too.large" || error?.code === "LIMIT_FILE_SIZE"
        ? 413
        : error instanceof SyntaxError && "body" in error
          ? 400
          : error?.status === 401
            ? 502
            : error?.status === 429
              ? 429
              : error?.status || (error?.name === "ZodError" ? 422 : 500);
    const code =
      error?.type === "entity.too.large" || error?.code === "LIMIT_FILE_SIZE"
        ? "PAYLOAD_TOO_LARGE"
        : status === 400 && error instanceof SyntaxError
          ? "INVALID_JSON"
          : error?.code ||
            (status === 429
              ? "RATE_LIMIT"
              : status === 422
                ? "INVALID_AI_RESPONSE"
                : "AI_REQUEST_FAILED");
    const messages: Record<string, string> = {
      PAYLOAD_TOO_LARGE: "Запрос превышает допустимый размер.",
      INVALID_JSON: "Повреждённый JSON.",
      INVALID_IMAGE:
        "Изображение повреждено или имеет неподдерживаемый формат.",
      CORS_DENIED: "Origin не разрешён.",
      RATE_LIMIT: "Слишком много запросов.",
      EMPTY_MODEL_RESPONSE: "Модель не вернула готовую сцену.",
      UNAUTHORIZED: "Требуется вход.",
      CLOUD_NOT_CONFIGURED: "Supabase не настроен.",
      AI_DAILY_LIMIT: "Дневной лимит AI исчерпан.",
    };
    response.status(status).json({
      error: {
        code,
        message: messages[code] || "Не удалось обработать запрос.",
        requestId: _request.requestId,
      },
    });
  };
  app.use(errors);
  return app;
}
