import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const auth = { authorization: "Bearer valid-test-token" };
const options = {
  verifyToken: async () => ({
    id: "00000000-0000-4000-8000-000000000001",
    email: "test@example.com",
  }),
  consumeUsage: async () => undefined,
};
describe("Qraft API v1", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OPENAI_API_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.AI_RATE_LIMIT_PER_MINUTE;
    process.env.ALLOWED_ORIGINS = "http://localhost:5173,https://qraft.example";
    process.env.NODE_ENV = "test";
  });
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });
  it("reports exact disabled feature flags without secrets", async () => {
    const { createApp } = await import("./app.js");
    const response = await request(createApp()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.features).toEqual({
      textAi: false,
      imageAi: false,
      voiceAi: false,
      cloudProjects: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("KEY");
  });
  it("requires authentication for AI", async () => {
    const { createApp } = await import("./app.js");
    const response = await request(createApp(options))
      .post("/api/ai/scene")
      .send({ prompt: "robot" });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });
  it("returns AI_NOT_CONFIGURED instead of a fake scene", async () => {
    const { createApp } = await import("./app.js");
    const response = await request(createApp(options))
      .post("/api/ai/scene")
      .set(auth)
      .send({ prompt: "robot" });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("AI_NOT_CONFIGURED");
    expect(response.body.objects).toBeUndefined();
  });
  it("rejects empty prompt with 400", async () => {
    const { createApp } = await import("./app.js");
    expect(
      (
        await request(createApp(options))
          .post("/api/ai/scene")
          .set(auth)
          .send({ prompt: " " })
      ).status,
    ).toBe(400);
  });
  it("requires image consent after authentication", async () => {
    const { createApp } = await import("./app.js");
    const response = await request(createApp(options))
      .post("/api/ai/analyze-reference")
      .set(auth)
      .send({ consent: false, images: [] });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("CONSENT_REQUIRED");
  });
  it("rejects unsupported image MIME", async () => {
    const { createApp } = await import("./app.js");
    const response = await request(createApp(options))
      .post("/api/ai/analyze-reference")
      .set(auth)
      .send({ consent: true, images: ["data:text/plain;base64,SGk="] });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_IMAGE");
  });
  it("returns 413 JSON for oversized image request", async () => {
    const { createApp } = await import("./app.js");
    const body = JSON.stringify({
      consent: true,
      images: [`data:image/png;base64,${"A".repeat(8.1 * 1024 * 1024)}`],
    });
    const response = await request(createApp(options))
      .post("/api/ai/analyze-reference")
      .set(auth)
      .set("Content-Type", "application/json")
      .send(body);
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
  it("returns 400 for damaged JSON", async () => {
    const { createApp } = await import("./app.js");
    const response = await request(createApp(options))
      .post("/api/ai/scene")
      .set(auth)
      .set("Content-Type", "application/json")
      .send("{bad");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });
  it("allows configured CORS and denies another origin", async () => {
    const { createApp } = await import("./app.js");
    const app = createApp(options);
    expect(
      (
        await request(app)
          .get("/api/health")
          .set("Origin", "https://qraft.example")
      ).headers["access-control-allow-origin"],
    ).toBe("https://qraft.example");
    const denied = await request(app)
      .get("/api/health")
      .set("Origin", "https://evil.example");
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("CORS_DENIED");
  });
  it("returns uniform per-user minute limit error", async () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = "1";
    const { createApp } = await import("./app.js");
    const app = createApp(options);
    await request(app)
      .post("/api/ai/scene")
      .set(auth)
      .send({ prompt: "robot" });
    const response = await request(app)
      .post("/api/ai/scene")
      .set(auth)
      .send({ prompt: "house" });
    expect(response.status).toBe(429);
    expect(response.body.error).toMatchObject({
      code: "RATE_LIMIT",
      message: "Слишком много запросов.",
    });
    expect(response.body.error.requestId).toBeTruthy();
  });
  it("returns JSON 404 for unknown API route", async () => {
    const { createApp } = await import("./app.js");
    const response = await request(createApp(options)).get("/api/unknown");
    expect(response.status).toBe(404);
    expect(response.type).toContain("json");
  });
  it("voice endpoint requires audio", async () => {
    const { createApp } = await import("./app.js");
    const response = await request(createApp(options))
      .post("/api/ai/transcribe")
      .set(auth);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("AUDIO_REQUIRED");
  });
  it("health works in production mode", async () => {
    process.env.NODE_ENV = "production";
    const { createApp } = await import("./app.js");
    expect((await request(createApp(options)).get("/api/health")).status).toBe(
      200,
    );
  });
});
