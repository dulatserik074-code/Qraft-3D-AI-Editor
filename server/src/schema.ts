import { z } from "zod";
export const primitiveTypes = [
  "box",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
] as const;
const vec = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict();
export const objectSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(100),
    type: z.enum(primitiveTypes),
    position: vec,
    rotation: vec,
    scale: vec,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    material: z.enum(["standard", "matte", "metal", "glass"]),
    groupId: z.string().max(80).nullable(),
    locked: z.boolean(),
    visible: z.boolean(),
  })
  .strict();
export const patchSchema = z
  .object({
    message: z.string().max(500),
    mode: z.enum(["replace", "append"]),
    objects: z.array(objectSchema).max(50),
    warnings: z.array(z.string().max(200)).max(10),
    suggestedCamera: z
      .object({ position: vec, target: vec })
      .strict()
      .nullable(),
  })
  .strict();
export type ScenePatch = z.infer<typeof patchSchema>;
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
export function sanitizePatch(input: unknown): ScenePatch {
  const p = patchSchema.parse(input),
    ids = new Set<string>();
  return {
    ...p,
    objects: p.objects
      .filter((o) => {
        if (ids.has(o.id)) return false;
        ids.add(o.id);
        return true;
      })
      .slice(0, 50)
      .map((o) => ({
        ...o,
        position: {
          x: clamp(o.position.x, -100, 100),
          y: clamp(o.position.y, -100, 100),
          z: clamp(o.position.z, -100, 100),
        },
        rotation: {
          x: clamp(o.rotation.x, -Math.PI * 2, Math.PI * 2),
          y: clamp(o.rotation.y, -Math.PI * 2, Math.PI * 2),
          z: clamp(o.rotation.z, -Math.PI * 2, Math.PI * 2),
        },
        scale: {
          x: clamp(o.scale.x, 0.02, 30),
          y: clamp(o.scale.y, 0.02, 30),
          z: clamp(o.scale.z, 0.02, 30),
        },
      })),
  };
}
