import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { SceneObject, SuggestedCamera } from "./model";

const geometry = (type: SceneObject["type"]) =>
  ({
    box: () => new THREE.BoxGeometry(),
    sphere: () => new THREE.SphereGeometry(0.65, 32, 18),
    cylinder: () => new THREE.CylinderGeometry(0.55, 0.55, 1.5, 24),
    cone: () => new THREE.ConeGeometry(0.65, 1.5, 24),
    torus: () => new THREE.TorusGeometry(0.65, 0.22, 16, 36),
    plane: () => new THREE.PlaneGeometry(2, 2),
  })[type]();

export type ViewportApi = {
  reset: () => void;
  snapshot: () => string;
  exportObjects: () => THREE.Object3D[];
};
type Props = {
  objects: SceneObject[];
  selectedId: string | null;
  mode: "translate" | "rotate" | "scale";
  camera: "perspective" | "orthographic";
  suggestedCamera?: SuggestedCamera | null;
  onSelect: (id: string | null, additive?: boolean) => void;
  onTransform: (id: string, patch: Partial<SceneObject>) => void;
  onReady?: (api: ViewportApi) => void;
};
type Runtime = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  perspective: THREE.PerspectiveCamera;
  orthographic: THREE.OrthographicCamera;
  activeCamera: THREE.Camera;
  orbit: OrbitControls;
  transform: TransformControls;
  meshes: Map<string, THREE.Mesh>;
  resizeObserver: ResizeObserver;
};

export default function Viewport(props: Props) {
  const [contextError, setContextError] = useState(false);
  const mount = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const objectsRef = useRef(props.objects);
  const selectRef = useRef(props.onSelect);
  const transformRef = useRef(props.onTransform);
  const readyRef = useRef(props.onReady);
  useEffect(() => {
    objectsRef.current = props.objects;
  }, [props.objects]);
  useEffect(() => {
    selectRef.current = props.onSelect;
  }, [props.onSelect]);
  useEffect(() => {
    transformRef.current = props.onTransform;
  }, [props.onTransform]);
  useEffect(() => {
    readyRef.current = props.onReady;
  }, [props.onReady]);

  useEffect(() => {
    const element = mount.current!;
    const scene = new THREE.Scene();
    const perspective = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
    const orthographic = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 1000);
    for (const camera of [perspective, orthographic]) {
      camera.position.set(9, 7, 11);
      camera.lookAt(0, 2, 0);
    }
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    element.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xdce7ff, 0x263046, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(6, 10, 7);
    key.castShadow = true;
    scene.add(
      key,
      new THREE.GridHelper(30, 30, 0x50617d, 0x273246),
      new THREE.AxesHelper(3),
    );
    const orbit = new OrbitControls(perspective, renderer.domElement);
    orbit.target.set(0, 2, 0);
    orbit.enableDamping = true;
    const transform = new TransformControls(perspective, renderer.domElement);
    scene.add(transform.getHelper());
    transform.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !event.value;
    });
    transform.addEventListener("mouseUp", () => {
      const object = transform.object;
      const stateObject =
        object &&
        objectsRef.current.find((item) => item.id === object.userData.id);
      if (!object || !stateObject || stateObject.locked) return;
      transformRef.current(stateObject.id, {
        position: {
          x: object.position.x,
          y: object.position.y,
          z: object.position.z,
        },
        rotation: {
          x: object.rotation.x,
          y: object.rotation.y,
          z: object.rotation.z,
        },
        scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
      });
    });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => {
      if ((transform as TransformControls & { dragging?: boolean }).dragging)
        return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(
        pointer,
        runtime.current?.activeCamera ?? perspective,
      );
      const hit = raycaster.intersectObjects(
        [...runtime.current!.meshes.values()],
        false,
      )[0];
      selectRef.current(hit?.object.userData.id ?? null, event.shiftKey);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setContextError(true);
    };
    const onContextRestored = () => setContextError(false);
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener(
      "webglcontextrestored",
      onContextRestored,
    );
    const resize = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      renderer.setSize(width, height, false);
      perspective.aspect = width / height;
      perspective.updateProjectionMatrix();
      const span = 8;
      orthographic.left = (-span * width) / height;
      orthographic.right = (span * width) / height;
      orthographic.top = span;
      orthographic.bottom = -span;
      orthographic.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);
    runtime.current = {
      scene,
      renderer,
      perspective,
      orthographic,
      activeCamera: perspective,
      orbit,
      transform,
      meshes: new Map(),
      resizeObserver,
    };
    const reset = () => {
      const current = runtime.current;
      if (!current) return;
      current.activeCamera.position.set(9, 7, 11);
      current.orbit.target.set(0, 2, 0);
      current.activeCamera.lookAt(current.orbit.target);
      current.orbit.update();
    };
    readyRef.current?.({
      reset,
      snapshot: () => renderer.domElement.toDataURL("image/png"),
      exportObjects: () =>
        [...runtime.current!.meshes.values()]
          .filter((mesh) => mesh.visible)
          .map((mesh) => mesh.clone()),
    });
    let animation = 0;
    const draw = () => {
      animation = requestAnimationFrame(draw);
      orbit.update();
      renderer.render(scene, runtime.current?.activeCamera ?? perspective);
    };
    resize();
    draw();
    return () => {
      cancelAnimationFrame(animation);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
      renderer.domElement.removeEventListener(
        "webglcontextrestored",
        onContextRestored,
      );
      for (const mesh of runtime.current?.meshes.values() ?? []) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      transform.detach();
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    const expected = new Set(props.objects.map((object) => object.id));
    for (const [id, mesh] of current.meshes) {
      if (!expected.has(id)) {
        if (current.transform.object === mesh) current.transform.detach();
        current.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        current.meshes.delete(id);
      }
    }
    for (const object of props.objects) {
      let mesh = current.meshes.get(object.id);
      if (!mesh || mesh.userData.type !== object.type) {
        if (mesh) {
          current.scene.remove(mesh);
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
        mesh = new THREE.Mesh(
          geometry(object.type),
          new THREE.MeshStandardMaterial(),
        );
        mesh.userData = { id: object.id, type: object.type };
        mesh.castShadow = mesh.receiveShadow = true;
        current.scene.add(mesh);
        current.meshes.set(object.id, mesh);
      }
      mesh.position.set(
        object.position.x,
        object.position.y,
        object.position.z,
      );
      mesh.rotation.set(
        object.rotation.x,
        object.rotation.y,
        object.rotation.z,
      );
      mesh.scale.set(object.scale.x, object.scale.y, object.scale.z);
      mesh.visible = object.visible;
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.set(object.color);
      material.transparent = object.material === "glass";
      material.opacity = object.material === "glass" ? 0.45 : 1;
      material.roughness =
        object.material === "matte"
          ? 0.95
          : object.material === "glass"
            ? 0.12
            : 0.45;
      material.metalness = object.material === "metal" ? 0.75 : 0.08;
      material.needsUpdate = true;
    }
  }, [props.objects]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    current.transform.setMode(props.mode);
    const selected = props.selectedId
      ? current.meshes.get(props.selectedId)
      : undefined;
    const stateObject = props.objects.find(
      (object) => object.id === props.selectedId,
    );
    if (selected && stateObject?.visible && !stateObject.locked)
      current.transform.attach(selected);
    else current.transform.detach();
  }, [props.selectedId, props.mode, props.objects]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    const next =
      props.camera === "perspective"
        ? current.perspective
        : current.orthographic;
    if (next === current.activeCamera) return;
    next.position.copy(current.activeCamera.position);
    next.quaternion.copy(current.activeCamera.quaternion);
    next.updateProjectionMatrix();
    current.activeCamera = next;
    current.orbit.object = next;
    current.transform.camera = next;
    current.orbit.update();
  }, [props.camera]);

  useEffect(() => {
    const current = runtime.current;
    const suggestion = props.suggestedCamera;
    if (!current || !suggestion) return;
    const safe = (value: number) => Math.max(-100, Math.min(100, value));
    current.activeCamera.position.set(
      safe(suggestion.position.x),
      safe(suggestion.position.y),
      safe(suggestion.position.z),
    );
    current.orbit.target.set(
      safe(suggestion.target.x),
      safe(suggestion.target.y),
      safe(suggestion.target.z),
    );
    current.activeCamera.lookAt(current.orbit.target);
    current.orbit.update();
  }, [props.suggestedCamera]);

  return (
    <div className="viewport" ref={mount} aria-label="Трёхмерная сцена">
      {contextError && (
        <div className="webgl-warning" role="alert">
          WebGL-контекст потерян. Ожидаем восстановление…
        </div>
      )}
    </div>
  );
}
