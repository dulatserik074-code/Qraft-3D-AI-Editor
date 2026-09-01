import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import Viewport, { type ViewportApi } from "./Viewport";
import {
  History,
  applyScenePatch,
  makeObject,
  migrateProject,
  projectV2Schema,
  scenePatchSchema,
  validateObjectUpdate,
  type EditorSnapshot,
  type PrimitiveType,
  type ProjectV2,
  type SceneObject,
  type SuggestedCamera,
} from "./model";
import { demoScene } from "./demo";
import {
  createLocalProject,
  deleteLocalProject,
  listLocalProjects,
  loadActiveProject,
  saveLocalProject,
} from "./storage";
import {
  getSession,
  listCloudProjects,
  resetPassword,
  signIn,
  signOut,
  signUp,
  saveCloudProject,
  supabase,
  supabaseConfigured,
} from "./supabase";
import type { Session } from "@supabase/supabase-js";

const primitives: { type: PrimitiveType; label: string; icon: string }[] = [
  { type: "box", label: "Куб", icon: "□" },
  { type: "sphere", label: "Сфера", icon: "○" },
  { type: "cylinder", label: "Цилиндр", icon: "◫" },
  { type: "cone", label: "Конус", icon: "△" },
  { type: "torus", label: "Тор", icon: "◎" },
  { type: "plane", label: "Плоскость", icon: "▱" },
];
const download = (name: string, data: Blob | string) => {
  const anchor = document.createElement("a");
  anchor.href = typeof data === "string" ? data : URL.createObjectURL(data);
  anchor.download = name;
  anchor.click();
  if (typeof data !== "string")
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
};
const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Не удалось прочитать изображение."));
    reader.onerror = () =>
      reject(new Error("Не удалось прочитать изображение."));
    reader.readAsDataURL(file);
  });
const apiError = async (response: Response) => {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? `Ошибка сервера (${response.status}).`;
};

export default function App() {
  const initial = useMemo(() => [] as SceneObject[], []);
  const history = useRef(new History({ objects: initial, selectedId: null }));
  const [snapshot, setSnapshot] = useState<EditorSnapshot>({
    objects: initial,
    selectedId: null,
  });
  const [mode, setMode] = useState<"translate" | "rotate" | "scale">(
    "translate",
  );
  const [camera, setCamera] = useState<"perspective" | "orthographic">(
    "perspective",
  );
  const [suggestedCamera, setSuggestedCamera] =
    useState<SuggestedCamera | null>(null);
  const [aiConnected, setAiConnected] = useState(false);
  const [aiStatus, setAiStatus] = useState("Проверка…");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [project, setProject] = useState<ProjectV2>(() => createLocalProject());
  const [dirty, setDirty] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [referenceData, setReferenceData] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState("");
  const [opacity, setOpacity] = useState(0.35);
  const [consent, setConsent] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<
    "add" | "scene" | "properties" | "account" | "projects" | null
  >(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [localProjects, setLocalProjects] = useState<ProjectV2[]>([]);
  const [cloudProjects, setCloudProjects] = useState<ProjectV2[]>([]);
  const viewport = useRef<ViewportApi | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordTimer = useRef<number | null>(null);
  const selected =
    snapshot.objects.find((object) => object.id === snapshot.selectedId) ??
    null;

  const commit = useCallback(
    (factory: (current: EditorSnapshot) => EditorSnapshot) => {
      setDirty(true);
      setSnapshot((current) => history.current.commit(factory(current)));
    },
    [],
  );
  const select = useCallback((id: string | null, additive = false) => {
    setSelectedIds((current) =>
      id === null
        ? []
        : additive
          ? current.includes(id)
            ? current.filter((item) => item !== id)
            : [...current, id]
          : [id],
    );
    setSnapshot(history.current.select(id));
  }, []);
  const change = useCallback(
    (id: string, patch: Partial<SceneObject>) => {
      try {
        commit((current) => ({
          ...current,
          objects: current.objects.map((object) =>
            object.id === id ? validateObjectUpdate(object, patch) : object,
          ),
        }));
        setFieldError("");
      } catch (error) {
        setFieldError(
          error instanceof Error ? error.message : "Некорректное значение.",
        );
      }
    },
    [commit],
  );
  const transformGroup = useCallback(
    (id: string, patch: Partial<SceneObject>) => {
      commit((current) => {
        const source = current.objects.find((object) => object.id === id);
        if (!source || source.locked) return current;
        const nextSource = validateObjectUpdate(source, patch);
        if (!source.groupId)
          return {
            ...current,
            objects: current.objects.map((object) =>
              object.id === id ? nextSource : object,
            ),
          };
        const delta = {
          x: nextSource.position.x - source.position.x,
          y: nextSource.position.y - source.position.y,
          z: nextSource.position.z - source.position.z,
        };
        const rotationDelta = {
          x: nextSource.rotation.x - source.rotation.x,
          y: nextSource.rotation.y - source.rotation.y,
          z: nextSource.rotation.z - source.rotation.z,
        };
        const scaleRatio = {
          x: nextSource.scale.x / source.scale.x,
          y: nextSource.scale.y / source.scale.y,
          z: nextSource.scale.z / source.scale.z,
        };
        return {
          ...current,
          objects: current.objects.map((object) =>
            object.groupId === source.groupId && !object.locked
              ? validateObjectUpdate(object, {
                  position: {
                    x: object.position.x + delta.x,
                    y: object.position.y + delta.y,
                    z: object.position.z + delta.z,
                  },
                  rotation: {
                    x: object.rotation.x + rotationDelta.x,
                    y: object.rotation.y + rotationDelta.y,
                    z: object.rotation.z + rotationDelta.z,
                  },
                  scale: {
                    x: object.scale.x * scaleRatio.x,
                    y: object.scale.y * scaleRatio.y,
                    z: object.scale.z * scaleRatio.z,
                  },
                })
              : object,
          ),
        };
      });
    },
    [commit],
  );
  const applyPatch = useCallback(
    (raw: unknown, message?: string) => {
      const validated = scenePatchSchema.parse(raw);
      commit((current) => ({
        objects: applyScenePatch(current.objects, validated).objects,
        selectedId: null,
      }));
      setSuggestedCamera(validated.suggestedCamera);
      setNotice(
        message ??
          `${validated.message}${validated.warnings.length ? ` · ${validated.warnings.join(", ")}` : ""}`,
      );
    },
    [commit],
  );

  useEffect(() => {
    loadActiveProject()
      .then((loaded) => {
        if (!loaded) return;
        projectV2Schema.parse(loaded);
        history.current = new History({
          objects: loaded.objects,
          selectedId: null,
        });
        setProject(loaded);
        setSnapshot(history.current.value);
      })
      .catch((error) =>
        setNotice(
          error instanceof Error
            ? error.message
            : "Не удалось восстановить проект.",
        ),
      );
    getSession().then(setSession);
    return supabase?.auth.onAuthStateChange((_event, next) => setSession(next))
      .data.subscription.unsubscribe;
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setProject((currentProject) => {
        const next = projectV2Schema.parse({
          ...currentProject,
          objects: snapshot.objects,
          updatedAt: new Date().toISOString(),
          syncStatus:
            currentProject.syncStatus === "synced"
              ? "pending"
              : currentProject.syncStatus,
        });
        saveLocalProject(next)
          .then(() => setDirty(false))
          .catch((error) =>
            setNotice(
              error instanceof Error
                ? error.message
                : "Ошибка локального сохранения.",
            ),
          );
        return next;
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [snapshot.objects]);
  useEffect(() => {
    fetch("/api/health")
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiError(response));
        return response.json() as Promise<{
          features: {
            textAi: boolean;
            imageAi: boolean;
            voiceAi: boolean;
            cloudProjects: boolean;
          };
          model: string | null;
        }>;
      })
      .then((health) => {
        setAiConnected(health.features.textAi);
        setAiStatus(
          health.features.textAi ? `AI: ${health.model}` : "AI не настроен",
        );
      })
      .catch(() => {
        setAiConnected(false);
        setAiStatus("AI не настроен");
      });
  }, []);
  useEffect(
    () => () => {
      if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    },
    [referenceUrl],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setSnapshot(
          event.shiftKey ? history.current.redo() : history.current.undo(),
        );
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        setSnapshot(history.current.redo());
        return;
      }
      if (event.key === "Escape") {
        select(null);
        setMobilePanel(null);
        return;
      }
      if (event.key.toLowerCase() === "w") setMode("translate");
      if (event.key.toLowerCase() === "e") setMode("rotate");
      if (event.key.toLowerCase() === "r") setMode("scale");
      const object = snapshot.objects.find(
        (item) => item.id === snapshot.selectedId,
      );
      if (!object) return;
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !object.locked
      ) {
        event.preventDefault();
        commit((current) => ({
          objects: current.objects.filter((item) => item.id !== object.id),
          selectedId: null,
        }));
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        commit((current) => {
          const copy = {
            ...object,
            id: crypto.randomUUID(),
            name: `${object.name} копия`,
            position: { ...object.position, x: object.position.x + 0.5 },
          };
          return { objects: [...current.objects, copy], selectedId: copy.id };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snapshot, commit, select]);

  const add = (type: PrimitiveType) =>
    commit((current) => {
      const object = makeObject(type, current.objects.length + 1);
      return { objects: [...current.objects, object], selectedId: object.id };
    });
  const runAi = async () => {
    if (!prompt.trim()) return;
    const currentSession = await getSession();
    if (!currentSession) {
      setNotice(
        "Войдите, чтобы использовать AI. Ручной редактор доступен без входа.",
      );
      return;
    }
    if (!aiConnected) {
      setNotice("AI не настроен владельцем приложения.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/ai/scene", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${currentSession.access_token}`,
        },
        body: JSON.stringify({ prompt, scene: snapshot.objects.slice(0, 100) }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      applyPatch(await response.json());
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить AI-команду. Текущая сцена сохранена.",
      );
    } finally {
      setBusy(false);
    }
  };
  const chooseReference = async (file?: File) => {
    if (!file) return;
    setReferenceError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      return setReferenceError("Поддерживаются только PNG, JPG/JPEG и WebP.");
    if (file.size > 5 * 1024 * 1024)
      return setReferenceError("Изображение должно быть не больше 5 МБ.");
    try {
      const data = await readDataUrl(file);
      if (referenceUrl) URL.revokeObjectURL(referenceUrl);
      setReferenceUrl(URL.createObjectURL(file));
      setReferenceData(data);
      setConsent(false);
    } catch (error) {
      setReferenceError(
        error instanceof Error
          ? error.message
          : "Не удалось прочитать изображение.",
      );
    }
  };
  const removeReference = () => {
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    setReferenceUrl(null);
    setReferenceData(null);
    setConsent(false);
    setReferenceError("");
  };
  const analyzeReference = async () => {
    if (!consent || !referenceData) return;
    const currentSession = await getSession();
    if (!currentSession) {
      setReferenceError("Войдите, чтобы использовать AI-анализ.");
      return;
    }
    if (!aiConnected) {
      setReferenceError(
        "Анализ изображения требует подключённого OpenAI API. Текущая сцена не изменена.",
      );
      return;
    }
    setAnalyzing(true);
    setReferenceError("");
    try {
      const response = await fetch("/api/ai/analyze-reference", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${currentSession.access_token}`,
        },
        body: JSON.stringify({ consent: true, images: [referenceData] }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      applyPatch(
        await response.json(),
        "Черновая 3D-композиция по изображению создана. Невидимые стороны оценены приблизительно.",
      );
    } catch (error) {
      setReferenceError(
        error instanceof Error
          ? error.message
          : "Не удалось проанализировать изображение.",
      );
    } finally {
      setAnalyzing(false);
    }
  };
  const exportJson = () =>
    download(
      "qraft-project.json",
      new Blob(
        [JSON.stringify({ ...project, objects: snapshot.objects }, null, 2)],
        { type: "application/json" },
      ),
    );
  const importJson = (file: File) =>
    file.text().then((text) => {
      try {
        const imported = migrateProject(JSON.parse(text));
        commit(() => ({ objects: imported.objects, selectedId: null }));
        setProject(imported);
        setNotice("Проект открыт.");
      } catch {
        setNotice("Файл проекта повреждён или имеет неверный формат.");
      }
    });
  const exportGlb = async () => {
    const { GLTFExporter } =
      await import("three/examples/jsm/exporters/GLTFExporter.js");
    const scene = new THREE.Scene();
    viewport.current?.exportObjects().forEach((object) => scene.add(object));
    new GLTFExporter().parse(
      scene,
      (result) =>
        download(
          "qraft-scene.glb",
          new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }),
        ),
      (error) => setNotice(String(error)),
      { binary: true, onlyVisible: true },
    );
  };
  const refreshProjects = async () => {
    setLocalProjects(await listLocalProjects());
    setCloudProjects(session ? await listCloudProjects().catch(() => []) : []);
  };
  const showProjects = async () => {
    await refreshProjects();
    setProjectsOpen(true);
  };
  const openProject = (next: ProjectV2) => {
    history.current = new History({ objects: next.objects, selectedId: null });
    setProject(next);
    setSnapshot(history.current.value);
    setProjectsOpen(false);
    setMobilePanel(null);
  };
  const syncProject = async () => {
    if (!session) return setNotice("Войдите, чтобы сохранить проект в облако.");
    try {
      const synced = await saveCloudProject(
        { ...project, objects: snapshot.objects },
        session.user.id,
      );
      setProject(synced);
      await saveLocalProject(synced);
      setNotice("Проект синхронизирован.");
      await refreshProjects();
    } catch (error) {
      setNotice(
        error instanceof Error && error.message === "CLOUD_CONFLICT"
          ? "Облачная версия новее. Откройте её перед сохранением."
          : "Не удалось сохранить проект в облако.",
      );
    }
  };
  const stopRecording = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };
  const startRecording = async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setNotice("Браузер не поддерживает запись голоса.");
      return;
    }
    const currentSession = await getSession();
    if (!currentSession) {
      setNotice("Войдите, чтобы использовать голосовые команды.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const mediaRecorder = new MediaRecorder(stream);
      recorder.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        if (recordTimer.current) window.clearTimeout(recordTimer.current);
        const audio = new Blob(chunks, {
          type: mediaRecorder.mimeType || "audio/webm",
        });
        if (!audio.size || audio.size > 8 * 1024 * 1024) {
          setNotice("Запись пуста или превышает 8 МБ.");
          return;
        }
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", audio, "command.webm");
          const response = await fetch("/api/ai/transcribe", {
            method: "POST",
            headers: { authorization: `Bearer ${currentSession.access_token}` },
            body: form,
          });
          if (!response.ok) throw new Error(await apiError(response));
          const result = (await response.json()) as { text: string };
          setPrompt(result.text);
          setNotice("Текст распознан. Проверьте его и нажмите «Создать».");
        } catch (error) {
          setNotice(
            error instanceof Error
              ? error.message
              : "Не удалось распознать голос.",
          );
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorder.start();
      setRecording(true);
      recordTimer.current = window.setTimeout(stopRecording, 30_000);
    } catch {
      setNotice("Нет доступа к микрофону или запись была отменена.");
    }
  };

  const addPanel = (
    <>
      <h3>Добавить объект</h3>
      <div className="primitives">
        {primitives.map((item) => (
          <button key={item.type} onClick={() => add(item.type)}>
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
      <h3>Character Builder</h3>
      <div className="templates">
        <button
          onClick={() =>
            commit(() => ({ objects: demoScene("робот"), selectedId: null }))
          }
        >
          🤖 Робот
        </button>
        <button
          onClick={() =>
            commit(() => ({ objects: demoScene("снеговик"), selectedId: null }))
          }
        >
          ☃ Существо
        </button>
        <button
          onClick={() =>
            commit(() => ({ objects: demoScene("дом"), selectedId: null }))
          }
        >
          ⌂ Дом
        </button>
      </div>
      <h3>Reference Image</h3>
      <label className="drop">
        Загрузить PNG / JPG / WebP
        <input
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => chooseReference(event.target.files?.[0])}
        />
      </label>
      {referenceError && (
        <p className="error" role="alert">
          {referenceError}
        </p>
      )}
      {referenceUrl && (
        <>
          <label>
            Прозрачность{" "}
            <input
              type="range"
              min=".05"
              max="1"
              step=".05"
              value={opacity}
              onChange={(event) => setOpacity(+event.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />{" "}
            Разрешаю отправить изображение ИИ
          </label>
          <button disabled={!consent || analyzing} onClick={analyzeReference}>
            {analyzing ? "Анализирую…" : "Создать 3D по изображению"}
          </button>
          <button onClick={removeReference}>Удалить референс</button>
        </>
      )}
    </>
  );
  const scenePanel = (
    <>
      <h3>
        Объекты <small>{snapshot.objects.length}</small>
      </h3>
      <div className="objects">
        {snapshot.objects.map((object) => (
          <button
            className={selectedIds.includes(object.id) ? "selected" : ""}
            key={object.id}
            onClick={(event) => select(object.id, event.shiftKey)}
          >
            <span style={{ background: object.color }} />
            {object.name}
            <i>
              {object.visible ? "◉" : "○"} {object.locked ? "🔒" : ""}
            </i>
          </button>
        ))}
      </div>
      {selectedIds.length > 1 && (
        <div className="row">
          <button
            onClick={() => {
              const groupId = crypto.randomUUID();
              commit((current) => ({
                ...current,
                objects: current.objects.map((object) =>
                  selectedIds.includes(object.id) && !object.locked
                    ? { ...object, groupId }
                    : object,
                ),
              }));
            }}
          >
            Группировать
          </button>
          <button
            onClick={() =>
              commit((current) => ({
                ...current,
                objects: current.objects.map((object) =>
                  selectedIds.includes(object.id) && !object.locked
                    ? { ...object, groupId: null }
                    : object,
                ),
              }))
            }
          >
            Разгруппировать
          </button>
        </div>
      )}
    </>
  );
  const propertiesPanel = selected ? (
    <>
      {fieldError && (
        <p className="error" role="alert">
          {fieldError}
        </p>
      )}
      <Properties
        object={selected}
        change={(patch) => change(selected.id, patch)}
        remove={() =>
          commit((current) => ({
            objects: current.objects.filter(
              (object) => object.id !== selected.id,
            ),
            selectedId: null,
          }))
        }
        duplicate={() =>
          commit((current) => {
            const object = {
              ...selected,
              id: crypto.randomUUID(),
              name: `${selected.name} копия`,
              position: { ...selected.position, x: selected.position.x + 0.5 },
            };
            return {
              objects: [...current.objects, object],
              selectedId: object.id,
            };
          })
        }
      />
    </>
  ) : (
    <div className="empty">
      Выберите объект
      <br />
      <small>Кликните по сцене или списку</small>
    </div>
  );

  return (
    <main className="app">
      <header>
        <div className="brand">
          <span className="logo">Q</span>
          <b>
            Qraft <i>3D</i>
          </b>
          {dirty && <span title="Есть несохранённые изменения">●</span>}
        </div>
        <div className="toolbar">
          <button
            onClick={() =>
              confirm("Очистить несохранённую сцену?") &&
              commit(() => ({ objects: [], selectedId: null }))
            }
          >
            Новая
          </button>
          <label className="button">
            Открыть
            <input
              hidden
              type="file"
              accept="application/json"
              onChange={(event) =>
                event.target.files?.[0] && importJson(event.target.files[0])
              }
            />
          </label>
          <button onClick={exportJson}>Сохранить</button>
          <button onClick={showProjects}>Проекты</button>
          <button disabled={!session} onClick={syncProject}>
            В облако
          </button>
          <span className="sep" />
          <button
            aria-label="Отменить"
            onClick={() => setSnapshot(history.current.undo())}
          >
            ↶ Undo
          </button>
          <button
            aria-label="Повторить"
            onClick={() => setSnapshot(history.current.redo())}
          >
            ↷ Redo
          </button>
          <span className="sep" />
          <button
            onClick={() =>
              viewport.current &&
              download("qraft-scene.png", viewport.current.snapshot())
            }
          >
            PNG
          </button>
          <button onClick={exportGlb}>GLB</button>
          <button onClick={() => setAccountOpen(!accountOpen)}>
            {session ? session.user.email : "Войти"}
          </button>
        </div>
        <span className="status">● {aiStatus}</span>
      </header>
      <nav className="mobile-tabs" aria-label="Панели редактора">
        <button
          aria-expanded={mobilePanel === "add"}
          onClick={() => setMobilePanel(mobilePanel === "add" ? null : "add")}
        >
          ＋ Добавить
        </button>
        <button
          aria-expanded={mobilePanel === "scene"}
          onClick={() =>
            setMobilePanel(mobilePanel === "scene" ? null : "scene")
          }
        >
          ☷ Сцена
        </button>
        <button
          aria-expanded={mobilePanel === "properties"}
          onClick={() =>
            setMobilePanel(mobilePanel === "properties" ? null : "properties")
          }
        >
          ⚙ Свойства
        </button>
        <button
          aria-expanded={mobilePanel === "projects"}
          onClick={() => {
            setMobilePanel("projects");
            void showProjects();
          }}
        >
          ▣ Проекты
        </button>
        <button
          aria-expanded={mobilePanel === "account"}
          onClick={() =>
            setMobilePanel(mobilePanel === "account" ? null : "account")
          }
        >
          ◉ Аккаунт
        </button>
      </nav>
      <section className="workspace">
        <aside className="left panel">{addPanel}</aside>
        <div className="stage">
          {referenceUrl && (
            <img
              className="reference"
              src={referenceUrl}
              style={{ opacity }}
              alt="Референс для 3D-модели"
            />
          )}
          <Viewport
            objects={snapshot.objects}
            selectedId={snapshot.selectedId}
            mode={mode}
            camera={camera}
            suggestedCamera={suggestedCamera}
            onSelect={select}
            onTransform={transformGroup}
            onReady={(api) => {
              viewport.current = api;
            }}
          />
          <div className="view-tools">
            <button
              className={mode === "translate" ? "active" : ""}
              onClick={() => setMode("translate")}
            >
              Move
            </button>
            <button
              className={mode === "rotate" ? "active" : ""}
              onClick={() => setMode("rotate")}
            >
              Rotate
            </button>
            <button
              className={mode === "scale" ? "active" : ""}
              onClick={() => setMode("scale")}
            >
              Scale
            </button>
            <button
              onClick={() =>
                setCamera(
                  camera === "perspective" ? "orthographic" : "perspective",
                )
              }
            >
              {camera === "perspective" ? "Перспектива" : "Орто"}
            </button>
            <button onClick={() => viewport.current?.reset()}>
              Сброс вида
            </button>
          </div>
        </div>
        <aside className="right panel">
          {scenePanel}
          {propertiesPanel}
        </aside>
      </section>
      {(projectsOpen || mobilePanel === "projects") && (
        <ProjectsPanel
          local={localProjects}
          cloud={cloudProjects}
          close={() => {
            setProjectsOpen(false);
            setMobilePanel(null);
          }}
          open={openProject}
          create={() => openProject(createLocalProject())}
          remove={async (id) => {
            if (confirm("Удалить локальный проект?")) {
              await deleteLocalProject(id);
              await refreshProjects();
            }
          }}
        />
      )}
      {(accountOpen || mobilePanel === "account") && (
        <AccountPanel
          session={session}
          close={() => {
            setAccountOpen(false);
            setMobilePanel(null);
          }}
        />
      )}
      {mobilePanel && mobilePanel !== "account" && (
        <>
          <button
            className="drawer-overlay"
            aria-label="Закрыть панель"
            onClick={() => setMobilePanel(null)}
          />
          <aside id="mobile-editor-panel" className="mobile-drawer panel">
            <button
              className="drawer-close"
              aria-label="Закрыть панель"
              onClick={() => setMobilePanel(null)}
            >
              ×
            </button>
            {mobilePanel === "add"
              ? addPanel
              : mobilePanel === "scene"
                ? scenePanel
                : propertiesPanel}
          </aside>
        </>
      )}
      <section className="ai">
        <div>
          <b>✦ AI‑команда</b>
          <small>Опишите сцену по‑русски или по‑английски</small>
        </div>
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value.slice(0, 1000))}
          onKeyDown={(event) => event.key === "Enter" && runAi()}
          placeholder="Например: создай синего робота с красной антенной"
        />
        <button
          className={recording ? "recording" : ""}
          disabled={transcribing || !aiConnected}
          aria-label={
            recording ? "Остановить запись" : "Записать голосовую команду"
          }
          onClick={recording ? stopRecording : startRecording}
        >
          {transcribing ? "…" : recording ? "■" : "🎙"}
        </button>
        <button
          disabled={busy || !prompt.trim() || !aiConnected || !session}
          onClick={runAi}
        >
          {busy ? "Создаю…" : "Создать ✦"}
        </button>
        {notice && <p role="status">{notice}</p>}
      </section>
    </main>
  );
}

function Properties({
  object,
  change,
  remove,
  duplicate,
}: {
  object: SceneObject;
  change: (patch: Partial<SceneObject>) => void;
  remove: () => void;
  duplicate: () => void;
}) {
  const vector = (key: "position" | "rotation" | "scale") => (
    <div className="vector">
      {(["x", "y", "z"] as const).map((axis) => (
        <label key={axis}>
          {axis.toUpperCase()}
          <input
            aria-label={`${key} ${axis}`}
            type="number"
            step={key === "rotation" ? ".1" : ".2"}
            value={Number(object[key][axis].toFixed(2))}
            onChange={(event) =>
              change({ [key]: { ...object[key], [axis]: +event.target.value } })
            }
          />
        </label>
      ))}
    </div>
  );
  return (
    <div className="props">
      <h3>Свойства</h3>
      <label>
        Имя
        <input
          value={object.name}
          onChange={(event) => change({ name: event.target.value })}
        />
      </label>
      <label>
        Цвет
        <input
          type="color"
          value={object.color}
          onChange={(event) => change({ color: event.target.value })}
        />
      </label>
      <label>
        Материал
        <select
          value={object.material}
          onChange={(event) =>
            change({ material: event.target.value as SceneObject["material"] })
          }
        >
          <option value="standard">Стандартный</option>
          <option value="matte">Матовый</option>
          <option value="metal">Металл</option>
          <option value="glass">Стекло</option>
        </select>
      </label>
      <h4>Позиция</h4>
      {vector("position")}
      <h4>Вращение</h4>
      {vector("rotation")}
      <h4>Масштаб</h4>
      {vector("scale")}
      <div className="row">
        <button onClick={() => change({ visible: !object.visible })}>
          {object.visible ? "Скрыть" : "Показать"}
        </button>
        <button onClick={() => change({ locked: !object.locked })}>
          {object.locked ? "Разблок." : "Блок."}
        </button>
      </div>
      <div className="row">
        <button onClick={duplicate}>Дублировать</button>
        <button className="danger" onClick={remove}>
          Удалить
        </button>
      </div>
    </div>
  );
}

function AccountPanel({
  session,
  close,
}: {
  session: Session | null;
  close: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const action = async (kind: "in" | "up" | "reset") => {
    try {
      if (kind === "in") await signIn(email, password);
      if (kind === "up") await signUp(email, password);
      if (kind === "reset") await resetPassword(email);
      setMessage(
        kind === "reset"
          ? "Письмо для восстановления отправлено."
          : kind === "up"
            ? "Регистрация выполнена. Проверьте email."
            : "Вход выполнен.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Ошибка авторизации.",
      );
    }
  };
  return (
    <>
      <button
        className="drawer-overlay"
        aria-label="Закрыть аккаунт"
        onClick={close}
      />
      <aside
        className="account-panel panel"
        role="dialog"
        aria-modal="true"
        aria-label="Аккаунт"
      >
        <button className="drawer-close" aria-label="Закрыть" onClick={close}>
          ×
        </button>
        <h3>Аккаунт</h3>
        {!supabaseConfigured && (
          <p className="error">
            Supabase не настроен. Доступен гостевой локальный режим.
          </p>
        )}
        {session ? (
          <>
            <p>{session.user.email}</p>
            <button onClick={() => signOut()}>Выйти</button>
          </>
        ) : (
          <>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div className="templates">
              <button
                disabled={!supabaseConfigured}
                onClick={() => action("in")}
              >
                Войти
              </button>
              <button
                disabled={!supabaseConfigured}
                onClick={() => action("up")}
              >
                Регистрация
              </button>
              <button
                disabled={!supabaseConfigured || !email}
                onClick={() => action("reset")}
              >
                Восстановить пароль
              </button>
            </div>
          </>
        )}
        {message && <p role="status">{message}</p>}
        <small>
          Гостевой режим сохраняет проекты локально. Облако и AI требуют входа.
        </small>
      </aside>
    </>
  );
}

function ProjectsPanel({
  local,
  cloud,
  close,
  open,
  create,
  remove,
}: {
  local: ProjectV2[];
  cloud: ProjectV2[];
  close: () => void;
  open: (project: ProjectV2) => void;
  create: () => void;
  remove: (id: string) => void;
}) {
  const rows = (items: ProjectV2[], source: string) =>
    items.map((item) => (
      <div className="project-row" key={`${source}-${item.id}`}>
        <button onClick={() => open(item)}>
          <b>{item.name}</b>
          <small>
            {new Date(item.updatedAt).toLocaleString("ru")} · {source}
          </small>
        </button>
        {source === "локально" && (
          <button
            aria-label={`Удалить ${item.name}`}
            onClick={() => remove(item.id)}
          >
            ×
          </button>
        )}
      </div>
    ));
  return (
    <>
      <button
        className="drawer-overlay"
        aria-label="Закрыть проекты"
        onClick={close}
      />
      <aside
        className="projects-panel panel"
        role="dialog"
        aria-modal="true"
        aria-label="Проекты"
      >
        <button className="drawer-close" aria-label="Закрыть" onClick={close}>
          ×
        </button>
        <h3>Проекты</h3>
        <button onClick={create}>＋ Новый проект</button>
        <h3>На устройстве</h3>
        {local.length ? (
          rows(local, "локально")
        ) : (
          <p className="empty">Нет проектов</p>
        )}
        <h3>В облаке</h3>
        {cloud.length ? (
          rows(cloud, "облако")
        ) : (
          <p className="empty">Войдите или сохраните проект в облако</p>
        )}
      </aside>
    </>
  );
}
