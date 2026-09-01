import {
  migrateProject,
  projectV2Schema,
  type ProjectV2,
  type SceneObject,
} from "./model";

const DB_NAME = "qraft-3d";
const STORE = "projects";
const ACTIVE_KEY = "qraft-active-project";
const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const transaction = async <T>(
  mode: IDBTransactionMode,
  action: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
) => {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    action(tx.objectStore(STORE), resolve, reject);
    tx.oncomplete = () => database.close();
    tx.onerror = () => reject(tx.error);
  });
};
export async function saveLocalProject(project: ProjectV2) {
  const valid = projectV2Schema.parse(project);
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(valid);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  localStorage.setItem(ACTIVE_KEY, project.id);
}
export async function loadActiveProject(): Promise<ProjectV2 | null> {
  const id = localStorage.getItem(ACTIVE_KEY);
  if (!id) return migrateLegacyProject();
  try {
    const raw = await transaction<unknown>(
      "readonly",
      (store, resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    return raw ? projectV2Schema.parse(raw) : migrateLegacyProject();
  } catch (error) {
    const recovery = JSON.stringify({
      id,
      error: String(error),
      recoveredAt: new Date().toISOString(),
    });
    localStorage.setItem(`qraft-recovery-${Date.now()}`, recovery);
    throw new Error("Сохранённый проект повреждён. Создана recovery-копия.", {
      cause: error,
    });
  }
}
async function migrateLegacyProject() {
  const raw = localStorage.getItem("qraft-project");
  if (!raw) return null;
  try {
    const project = migrateProject(JSON.parse(raw));
    await saveLocalProject(project);
    localStorage.removeItem("qraft-project");
    return project;
  } catch {
    localStorage.setItem(`qraft-recovery-${Date.now()}`, raw);
    throw new Error(
      "Старое сохранение повреждено. Исходные данные сохранены как recovery-копия.",
    );
  }
}
export function createLocalProject(
  name = "Новый проект",
  objects: SceneObject[] = [],
): ProjectV2 {
  const now = new Date().toISOString();
  return {
    version: 2,
    id: crypto.randomUUID(),
    name,
    objects,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    thumbnail: null,
    syncStatus: "local",
  };
}
export async function listLocalProjects(): Promise<ProjectV2[]> {
  return transaction<ProjectV2[]>("readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () =>
      resolve(request.result.map((item) => projectV2Schema.parse(item)));
    request.onerror = () => reject(request.error);
  });
}
export async function deleteLocalProject(id: string) {
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
