import { z } from "zod";

export const primitiveTypes = [
  "box",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
] as const;
export type PrimitiveType = (typeof primitiveTypes)[number];
export type MaterialType = "standard" | "matte" | "metal" | "glass";
export type Vec3 = { x: number; y: number; z: number };
export type SceneObject = {
  id: string;
  name: string;
  type: PrimitiveType;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  material: MaterialType;
  groupId: string | null;
  locked: boolean;
  visible: boolean;
};
export type SuggestedCamera = { position: Vec3; target: Vec3 };
export type ScenePatch = {
  message: string;
  mode: "replace" | "append";
  objects: SceneObject[];
  warnings: string[];
  suggestedCamera: SuggestedCamera | null;
};

const vec3 = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  })
  .strict();
export const sceneObjectSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(100),
    type: z.enum(primitiveTypes),
    position: vec3,
    rotation: vec3,
    scale: vec3,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    material: z.enum(["standard", "matte", "metal", "glass"]),
    groupId: z.string().max(80).nullable(),
    locked: z.boolean(),
    visible: z.boolean(),
  })
  .strict();
export const scenePatchSchema = z
  .object({
    message: z.string().max(500),
    mode: z.enum(["replace", "append"]),
    objects: z.array(sceneObjectSchema).max(50),
    warnings: z.array(z.string().max(200)).max(10),
    suggestedCamera: z
      .object({ position: vec3, target: vec3 })
      .strict()
      .nullable(),
  })
  .strict();
const uniqueObjects = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .array(schema)
    .max(500)
    .superRefine((objects, context) => {
      const ids = new Set<string>();
      for (const object of objects as SceneObject[]) {
        if (ids.has(object.id))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Повторяющийся ID: ${object.id}`,
          });
        ids.add(object.id);
      }
    });
export const projectSchema = z
  .object({
    version: z.literal(1),
    name: z.string(),
    objects: uniqueObjects(sceneObjectSchema),
  })
  .strict();
export const projectV2Schema = z
  .object({
    version: z.literal(2),
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    objects: uniqueObjects(sceneObjectSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    thumbnail: z.string().nullable(),
    syncStatus: z.enum(["local", "pending", "synced", "conflict"]),
  })
  .strict();
export type ProjectV2 = z.infer<typeof projectV2Schema>;
export function migrateProject(input: unknown): ProjectV2 {
  const future = z
    .object({ version: z.number() })
    .passthrough()
    .safeParse(input);
  if (future.success && future.data.version > 2)
    throw new Error("UNSUPPORTED_PROJECT_VERSION");
  const v2 = projectV2Schema.safeParse(input);
  if (v2.success) return v2.data;
  const v1 = projectSchema.parse(input);
  const now = new Date().toISOString();
  return {
    version: 2,
    id: crypto.randomUUID(),
    name: v1.name || "Без названия",
    objects: v1.objects,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    thumbnail: null,
    syncStatus: "local",
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const sanitizeVec = (value: Vec3, limit: number): Vec3 => ({
  x: clamp(value.x, -limit, limit),
  y: clamp(value.y, -limit, limit),
  z: clamp(value.z, -limit, limit),
});
export function sanitizeObject(object: SceneObject): SceneObject {
  return {
    ...object,
    position: sanitizeVec(object.position, 100),
    rotation: sanitizeVec(object.rotation, Math.PI * 2),
    scale: {
      x: clamp(object.scale.x, 0.02, 30),
      y: clamp(object.scale.y, 0.02, 30),
      z: clamp(object.scale.z, 0.02, 30),
    },
    color: /^#[0-9a-fA-F]{6}$/.test(object.color) ? object.color : "#7c8cff",
  };
}
export function validateObjectUpdate(
  object: SceneObject,
  patch: Partial<SceneObject>,
): SceneObject {
  const candidate = sceneObjectSchema.parse({ ...object, ...patch });
  if (!candidate.name.trim()) throw new Error("Имя не может быть пустым.");
  const sanitized = sanitizeObject(candidate);
  if (
    JSON.stringify(candidate.position) !== JSON.stringify(sanitized.position) ||
    JSON.stringify(candidate.rotation) !== JSON.stringify(sanitized.rotation) ||
    JSON.stringify(candidate.scale) !== JSON.stringify(sanitized.scale)
  )
    throw new Error("Число находится вне допустимого диапазона.");
  return sanitized;
}

export type AppliedPatch = {
  objects: SceneObject[];
  suggestedCamera: SuggestedCamera | null;
};
export function applyScenePatch(
  current: SceneObject[],
  input: unknown,
): AppliedPatch {
  const patch = scenePatchSchema.parse(input);
  const incomingIds = new Set<string>();
  for (const object of patch.objects) {
    if (incomingIds.has(object.id))
      throw new Error(`DUPLICATE_ID:${object.id}`);
    incomingIds.add(object.id);
  }
  const sanitized = patch.objects.map(sanitizeObject);
  if (patch.mode === "replace") {
    const locked = current.filter((object) => object.locked);
    const lockedIds = new Set(locked.map((object) => object.id));
    const objects = [
      ...locked,
      ...sanitized.filter((object) => !lockedIds.has(object.id)),
    ];
    if (objects.length > 500) throw new Error("SCENE_LIMIT");
    return { objects, suggestedCamera: patch.suggestedCamera };
  }
  const byId = new Map(current.map((object) => [object.id, object]));
  for (const object of sanitized) {
    const existing = byId.get(object.id);
    if (existing?.locked) continue;
    byId.set(object.id, object);
  }
  const objects = [...byId.values()];
  if (objects.length > 500) throw new Error("SCENE_LIMIT");
  return { objects, suggestedCamera: patch.suggestedCamera };
}

const names: Record<PrimitiveType, string> = {
  box: "Куб",
  sphere: "Сфера",
  cylinder: "Цилиндр",
  cone: "Конус",
  torus: "Тор",
  plane: "Плоскость",
};
export const makeObject = (
  type: PrimitiveType,
  index = 1,
  at: Partial<Vec3> = {},
): SceneObject => ({
  id: crypto.randomUUID(),
  name: `${names[type]} ${index}`,
  type,
  position: {
    x: at.x ?? 0,
    y: at.y ?? (type === "plane" ? 0 : 1),
    z: at.z ?? 0,
  },
  rotation: { x: type === "plane" ? -Math.PI / 2 : 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  color: "#7c8cff",
  material: "standard",
  groupId: null,
  locked: false,
  visible: true,
});

export type EditorSnapshot = {
  objects: SceneObject[];
  selectedId: string | null;
};
export class History {
  private past: EditorSnapshot[] = [];
  private future: EditorSnapshot[] = [];
  constructor(private current: EditorSnapshot) {}
  get value() {
    return structuredClone(this.current);
  }
  commit(next: EditorSnapshot) {
    this.past.push(structuredClone(this.current));
    if (this.past.length > 50) this.past.shift();
    this.current = structuredClone(next);
    this.future = [];
    return this.value;
  }
  select(selectedId: string | null) {
    this.current = { ...this.current, selectedId };
    return this.value;
  }
  undo() {
    const previous = this.past.pop();
    if (!previous) return this.value;
    this.future.push(structuredClone(this.current));
    this.current = previous;
    return this.value;
  }
  redo() {
    const next = this.future.pop();
    if (!next) return this.value;
    this.past.push(structuredClone(this.current));
    this.current = next;
    return this.value;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
}
