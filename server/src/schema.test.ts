import { describe, expect, it } from "vitest";
import { sanitizePatch } from "./schema.js";
const item = (id = "a") => ({
  id,
  name: "Cube",
  type: "box" as const,
  position: { x: 999, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 0, y: 99, z: 1 },
  color: "#ffffff",
  material: "standard" as const,
  groupId: null,
  locked: false,
  visible: true,
});
describe("sanitizePatch", () => {
  it("clamps values and removes duplicate ids", () => {
    const p = sanitizePatch({
      message: "ok",
      mode: "append",
      objects: [item(), item()],
      warnings: [],
      suggestedCamera: null,
    });
    expect(p.objects).toHaveLength(1);
    expect(p.objects[0].position.x).toBe(100);
    expect(p.objects[0].scale.x).toBe(0.02);
  });
  it("rejects unknown types", () =>
    expect(() =>
      sanitizePatch({
        message: "",
        mode: "replace",
        objects: [{ ...item(), type: "html" }],
        warnings: [],
        suggestedCamera: null,
      }),
    ).toThrow());
});
