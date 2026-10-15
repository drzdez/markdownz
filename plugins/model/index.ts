// 3D model plugin: three.js. Dragging turns the model, right-dragging pans, the wheel zooms;
// printing renders the current view on white, fitted to the paper.

import {
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { DocumentView, FindProvider, PrintPages, ViewContext } from "../../src/formats/types";
import type { PluginApi, PluginInstance } from "../../src/plugins/api";

export { PLUGIN_API as api } from "../../src/plugins/api";

const STYLE = `
.model-view { overflow: hidden; background: var(--bg); }
.model-view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.model-reset { position: absolute; top: 8px; right: 12px; padding: 2px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg); color: var(--fg); font-size: 12px; cursor: pointer; }
.model-caption { position: absolute; right: 12px; bottom: 8px; padding: 2px 8px; border-radius: 4px; background: var(--bg);
  color: var(--muted); font-size: 12px; pointer-events: none; }
`;

const background = () => getComputedStyle(document.body).backgroundColor || "#ffffff";
const round = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Number(n.toPrecision(3)));

const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
const extOf = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();

function buffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** Plain geometry (STL, PLY) gets a neutral material; vertex colors are kept. PLY without faces is a point cloud. */
function meshOf(geometry: BufferGeometry, cloud = false): Object3D {
  const colors = !!geometry.getAttribute("color");
  if (cloud) return new Points(geometry, new PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: colors, color: colors ? 0xffffff : 0x8a8f99 }));
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  return new Mesh(geometry, new MeshStandardMaterial({ color: colors ? 0xffffff : 0xb8bcc4, vertexColors: colors, metalness: 0.1, roughness: 0.65, side: DoubleSide }));
}

async function loadModel(api: PluginApi, path: string, data: Uint8Array): Promise<Object3D> {
  switch (extOf(path)) {
    case "stl": {
      // Many STL files store zero normals; the faces give them anyway.
      const geometry = new STLLoader().parse(buffer(data));
      geometry.deleteAttribute("normal");
      return meshOf(geometry);
    }
    case "ply": {
      const geometry = new PLYLoader().parse(buffer(data));
      return meshOf(geometry, !geometry.getIndex());
    }
    case "obj": {
      const group = new OBJLoader().parse(api.decodeText(data));
      // OBJ without its .mtl: one neutral material.
      group.traverse((o) => {
        if (o instanceof Mesh) o.material = new MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.1, roughness: 0.65, side: DoubleSide });
      });
      return group;
    }
    case "3mf":
      return new ThreeMFLoader().parse(buffer(data));
    case "gltf":
    case "glb": {
      // Buffers and textures next to a .gltf file are read through the app's file URLs.
      const gltf = await new GLTFLoader().parseAsync(buffer(data), api.fileUrl(dirOf(path)));
      return gltf.scene;
    }
    default:
      throw new Error("not a supported 3D model");
  }
}

class ModelView implements DocumentView {
  readonly element: HTMLElement;
  private caption: HTMLElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(40, 1, 0.01, 1000);
  private controls: OrbitControls;
  private model: Object3D | null = null;
  private sphere = new Sphere(new Vector3(), 1);
  private light = new DirectionalLight(0xffffff, 1.6);
  private frame = 0;
  private resize: ResizeObserver;

  readonly find: FindProvider = {
    find: () => this.find.onResult?.({ index: -1, count: 0 }),
    clear: () => {},
  };

  constructor(private api: PluginApi) {
    const el = api.el;
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    const reset = el("button", { className: "model-reset", textContent: "Reset view", title: "Look at the whole model again" });
    reset.addEventListener("click", () => this.fit());
    this.caption = el("div", { className: "model-caption" });
    this.element = el("div", { className: "doc-view model-view", tabIndex: -1 }, this.renderer.domElement, reset, this.caption);

    this.scene.add(new HemisphereLight(0xffffff, 0x444450, 1.2), new AmbientLight(0xffffff, 0.3), this.camera);
    // The main light comes from the camera, so the side you look at is always lit.
    this.light.position.set(1, 1, 2);
    this.camera.add(this.light);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener("change", () => this.render());
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(this.element);
  }

  async load(path: string): Promise<{ title?: string }> {
    const data = await this.api.readBinary(path);
    const model = await loadModel(this.api, path, data);
    if (this.model) this.scene.remove(this.model);
    // Z-up formats (STL, 3MF, PLY are usually made in CAD and slicers) stand upright.
    const holder = new Group();
    holder.add(model);
    if (["stl", "3mf", "ply"].includes(extOf(path))) holder.rotation.x = -Math.PI / 2;
    this.model = holder;
    this.scene.add(holder);
    const box = new Box3().setFromObject(holder);
    if (box.isEmpty()) throw new Error("the model is empty");
    box.getBoundingSphere(this.sphere);
    const size = box.getSize(new Vector3());
    let triangles = 0;
    holder.traverse((o) => {
      if (o instanceof Mesh) {
        const g = o.geometry as BufferGeometry;
        triangles += (g.getIndex()?.count ?? g.getAttribute("position").count) / 3;
      }
    });
    this.caption.textContent = `${extOf(path).toUpperCase()} · ${round(size.x)} × ${round(size.z)} × ${round(size.y)} units · ${Math.round(triangles).toLocaleString()} triangles`;
    this.scene.background = new Color(background());
    this.fit();
    return {};
  }

  /** Looks at the whole model from the front, a little from above. */
  private fit(direction = new Vector3(0.6, 0.45, 1).normalize()): void {
    const { center, radius } = this.sphere;
    const distance = radius / Math.sin(((this.camera.fov / 2) * Math.PI) / 180) / Math.min(1, this.camera.aspect) * 1.05;
    this.camera.near = Math.max(radius / 1000, distance - radius * 4);
    this.camera.far = distance + radius * 4;
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.render();
  }

  private layout(): void {
    const { clientWidth: width, clientHeight: height } = this.element;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.renderer.render(this.scene, this.camera));
  }

  async refresh(_ctx: ViewContext): Promise<void> {
    this.scene.background = new Color(background());
    this.render();
  }

  setZoom(): void {}

  scrollToFragment(): boolean {
    return false;
  }

  outline() {
    return [];
  }

  position(): number {
    return 0;
  }

  /** One sheet with the current view on white, turned to match the window, rendered at about 200 dpi. */
  async printPages(paper: { width: number; height: number }): Promise<PrintPages> {
    if (!this.model) throw new Error("no model");
    const wide = this.element.clientWidth >= this.element.clientHeight;
    const size = wide === paper.width >= paper.height ? { ...paper } : { width: paper.height, height: paper.width };
    const scale = Math.min(200 / 25.4, 4096 / Math.max(size.width, size.height));
    const width = Math.round(size.width * scale);
    const height = Math.round(size.height * scale);

    const saved = { ratio: this.renderer.getPixelRatio(), aspect: this.camera.aspect, position: this.camera.position.clone(), background: this.scene.background };
    const direction = saved.position.clone().sub(this.controls.target).normalize();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.scene.background = new Color("#ffffff");
    this.fit(direction);
    cancelAnimationFrame(this.frame);
    this.renderer.render(this.scene, this.camera);
    const image = this.renderer.domElement.toDataURL("image/png");

    this.renderer.setPixelRatio(saved.ratio);
    this.scene.background = saved.background;
    this.camera.position.copy(saved.position);
    this.controls.update();
    this.layout();

    return {
      count: 1,
      size: () => size,
      render: () => this.api.el("img", { className: "mdz-image-page", src: image, alt: "" }),
      dispose: () => {},
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.element.remove();
  }
}

export default function activate(api: PluginApi): PluginInstance {
  document.head.append(api.el("style", { textContent: STYLE }));
  return { createView: () => new ModelView(api) };
}
