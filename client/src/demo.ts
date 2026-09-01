import { makeObject, type SceneObject } from "./model";
const part = (
  type: Parameters<typeof makeObject>[0],
  name: string,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  color: string,
  groupId: string,
): SceneObject => ({
  ...makeObject(type),
  name,
  position: { x, y, z },
  scale: { x: sx, y: sy, z: sz },
  color,
  groupId,
});
export function demoScene(kind: string): SceneObject[] {
  const q = kind.toLowerCase(),
    g = crypto.randomUUID();
  if (q.includes("дом"))
    return [
      part("box", "Дом", 0, 1, 0, 2, 1.5, 2, "#f0b86e", g),
      part("cone", "Крыша", 0, 3, 0, 2.6, 1.3, 2.6, "#bb4d5a", g),
      part("box", "Дверь", 0, 0.8, 2.02, 0.55, 1.1, 0.12, "#724c33", g),
      part("box", "Окно", 1.1, 1.5, 2.03, 0.45, 0.45, 0.1, "#6bd5ff", g),
    ];
  if (q.includes("снег"))
    return [
      part("sphere", "Нижний шар", 0, 1, 0, 1.35, 1.35, 1.35, "#f4f7ff", g),
      part("sphere", "Средний шар", 0, 3, 0, 1, 1, 1, "#f4f7ff", g),
      part("sphere", "Голова", 0, 4.55, 0, 0.72, 0.72, 0.72, "#ffffff", g),
      part("cone", "Нос", 0, 4.55, 0.8, 0.18, 0.18, 0.6, "#ff7a38", g),
    ];
  if (q.includes("баз"))
    return ["box", "sphere", "cylinder", "cone", "torus"].map((t, i) => ({
      ...makeObject(t as Parameters<typeof makeObject>[0]),
      position: { x: (i - 2) * 2, y: 1, z: 0 },
    }));
  return [
    part("box", "Корпус", 0, 2, 0, 1.4, 1.7, 0.8, "#4876ff", g),
    part("box", "Голова", 0, 4.25, 0, 1.2, 1, 0.9, "#6b8cff", g),
    part("cylinder", "Левая рука", -1.8, 2.2, 0, 0.32, 1.5, 0.32, "#6b8cff", g),
    part("cylinder", "Правая рука", 1.8, 2.2, 0, 0.32, 1.5, 0.32, "#6b8cff", g),
    part("cylinder", "Левая нога", -0.65, 0.25, 0, 0.4, 1.4, 0.4, "#354fc1", g),
    part("cylinder", "Правая нога", 0.65, 0.25, 0, 0.4, 1.4, 0.4, "#354fc1", g),
    part(
      "sphere",
      "Левый глаз",
      -0.43,
      4.4,
      0.93,
      0.16,
      0.16,
      0.1,
      "#d9ff55",
      g,
    ),
    part(
      "sphere",
      "Правый глаз",
      0.43,
      4.4,
      0.93,
      0.16,
      0.16,
      0.1,
      "#d9ff55",
      g,
    ),
    part("cylinder", "Антенна", 0, 5.55, 0, 0.12, 0.65, 0.12, "#ff4d68", g),
  ];
}
