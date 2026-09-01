import { describe, expect, it } from "vitest";
import {
  History,
  applyScenePatch,
  makeObject,
  migrateProject,
  projectSchema,
  validateObjectUpdate,
  type SceneObject,
  type ScenePatch,
} from "./model";

const patch = (
  mode: "replace" | "append",
  objects: SceneObject[],
): ScenePatch => ({
  message: "ok",
  mode,
  objects,
  warnings: [],
  suggestedCamera: null,
});
describe("scene state", () => {
  it("undo/redo keeps snapshots", () => {
    const history = new History({ objects: [], selectedId: null });
    const object = makeObject("box");
    history.commit({ objects: [object], selectedId: object.id });
    expect(history.undo().objects).toHaveLength(0);
    expect(history.redo().objects[0].type).toBe("box");
  });
  it("serializes a valid project", () => {
    const project = {
      version: 1 as const,
      name: "Test",
      objects: [makeObject("sphere")],
    };
    expect(
      projectSchema.parse(JSON.parse(JSON.stringify(project))).objects,
    ).toHaveLength(1);
  });
  it("replace replaces only with a valid patch", () => {
    expect(
      applyScenePatch(
        [makeObject("box")],
        patch("replace", [makeObject("sphere")]),
      ).objects[0].type,
    ).toBe("sphere");
  });
  it("append adds and updates by id", () => {
    const original = makeObject("box");
    const updated = { ...original, color: "#ff0000" };
    const added = makeObject("cone");
    const result = applyScenePatch(
      [original],
      patch("append", [updated, added]),
    ).objects;
    expect(result).toHaveLength(2);
    expect(result.find((item) => item.id === original.id)?.color).toBe(
      "#ff0000",
    );
  });
  it("rejects duplicate IDs", () => {
    const object = makeObject("box");
    expect(() =>
      applyScenePatch([], patch("append", [object, object])),
    ).toThrow("DUPLICATE_ID");
  });
  it("does not update locked objects", () => {
    const locked = { ...makeObject("box"), locked: true };
    const changed = { ...locked, color: "#ff0000", locked: false };
    expect(
      applyScenePatch([locked], patch("append", [changed])).objects[0],
    ).toEqual(locked);
  });
  it("preserves locked objects during replace", () => {
    const locked = { ...makeObject("box"), locked: true };
    const result = applyScenePatch(
      [locked, makeObject("cone")],
      patch("replace", [makeObject("sphere")]),
    ).objects;
    expect(result).toContainEqual(locked);
    expect(result.some((item) => item.type === "sphere")).toBe(true);
  });
  it("rejects duplicate IDs in imported projects", () => {
    const object = makeObject("box");
    expect(() =>
      projectSchema.parse({ version: 1, name: "x", objects: [object, object] }),
    ).toThrow("Повторяющийся ID");
  });
  it("migrates project v1 to v2 and rejects a future version", () => {
    const migrated = migrateProject({
      version: 1,
      name: "old",
      objects: [makeObject("box")],
    });
    expect(migrated.version).toBe(2);
    expect(migrated.revision).toBe(0);
    expect(() => migrateProject({ version: 99 })).toThrow(
      "UNSUPPORTED_PROJECT_VERSION",
    );
  });
  it("rejects invalid manual values", () => {
    const object = makeObject("box");
    expect(() => validateObjectUpdate(object, { name: "" })).toThrow();
    expect(() =>
      validateObjectUpdate(object, { scale: { x: Number.NaN, y: 1, z: 1 } }),
    ).toThrow();
    expect(() =>
      validateObjectUpdate(object, { position: { x: 101, y: 0, z: 0 } }),
    ).toThrow("диапазона");
  });
  it("rejects unknown primitives without changing current scene", () => {
    const current = [makeObject("box")];
    const invalid = { ...makeObject("box"), type: "script" };
    expect(() =>
      applyScenePatch(current, { ...patch("append", []), objects: [invalid] }),
    ).toThrow();
    expect(current).toHaveLength(1);
  });
  it("one AI commit is one undo step", () => {
    const before = [makeObject("box")];
    const history = new History({ objects: before, selectedId: null });
    const after = applyScenePatch(
      before,
      patch("append", [makeObject("sphere")]),
    ).objects;
    history.commit({ objects: after, selectedId: null });
    expect(history.undo().objects).toEqual(before);
  });
});
