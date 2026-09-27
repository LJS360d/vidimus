import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
} from 'three';
import { PAGE_EVENT } from '../app-shell';

const base = '/vidimus/showcase/';

interface Accessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC3';
}

interface Gltf {
  accessors: Accessor[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  meshes: {
    primitives: { attributes: Record<string, number>; indices?: number; mode: number }[];
  }[];
}

// A minimal GLB reader: one mesh, float positions and colours, 16-bit indices. That is all the
// page graph written by scripts/docs.ts uses, and it keeps GLTFLoader out of the bundle.
const readGlb = (buffer: ArrayBuffer) => {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))) as Gltf;
  const bin = 20 + jsonLength + 8;
  const read = (index: number) => {
    const accessor = json.accessors[index];
    const bufferView = accessor && json.bufferViews[accessor.bufferView];
    if (!accessor || !bufferView) throw new Error(`no accessor ${index}`);
    const offset = bin + (bufferView.byteOffset ?? 0);
    const size = accessor.type === 'VEC3' ? 3 : 1;
    return accessor.componentType === 5123
      ? new BufferAttribute(new Uint16Array(buffer, offset, accessor.count), 1)
      : new BufferAttribute(new Float32Array(buffer, offset, accessor.count * size), size);
  };
  return (json.meshes[0]?.primitives ?? []).map(({ attributes, indices, mode }) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', read(attributes.POSITION ?? 0));
    geometry.setAttribute('color', read(attributes.COLOR_0 ?? 1));
    if (indices !== undefined) geometry.setIndex(read(indices));
    return { geometry, mode };
  });
};

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const startScene = async (holder: HTMLElement) => {
  if (holder.dataset.started) return;
  holder.dataset.started = '';
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return; // no WebGL: the poster image stays
  }
  const primitives = readGlb(await (await fetch(`${base}graph.glb`)).arrayBuffer());
  const scene = new Scene();
  for (const { geometry, mode } of primitives) {
    scene.add(
      mode === 0
        ? new Points(geometry, new PointsMaterial({ size: 0.09, vertexColors: true }))
        : new LineSegments(
            geometry,
            new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 }),
          ),
    );
  }
  const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 100);
  camera.position.set(0, 0.4, 3.4);
  camera.lookAt(0, 0, 0);
  const resize = () => {
    const width = holder.clientWidth;
    renderer.setSize(width, (width * 9) / 16, false);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  };
  resize();
  new ResizeObserver(resize).observe(holder);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  holder.append(renderer.domElement);
  holder.classList.add('is-live');

  let visible = true;
  let last = 0;
  const frame = (time: number) => {
    scene.rotation.y += Math.min(time - last, 50) * 0.0002;
    last = time;
    renderer.render(scene, camera);
    if (visible && !reducedMotion.matches) requestAnimationFrame(frame);
  };
  // One frame under reduced motion; otherwise spin only while the scene is on screen.
  renderer.render(scene, camera);
  new IntersectionObserver(([entry]) => {
    const was = visible;
    visible = !!entry?.isIntersecting;
    if (visible && !was && !reducedMotion.matches) requestAnimationFrame(frame);
  }).observe(holder);
  if (!reducedMotion.matches) requestAnimationFrame(frame);
};

// Click-to-load: nothing from the embed's host loads until the visitor asks for it.
const startFacades = () => {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-embed]')) {
    if (button.dataset.bound) continue;
    button.dataset.bound = '';
    button.addEventListener('click', () => {
      const frame = document.createElement('iframe');
      frame.src = button.dataset.embed ?? '';
      frame.title = button.dataset.title ?? '';
      frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
      frame.setAttribute(
        'sandbox',
        'allow-scripts allow-same-origin allow-popups allow-presentation',
      );
      frame.className = 'showcase-frame';
      button.replaceWith(frame);
      frame.focus();
    });
  }
};

interface Result {
  audit: string;
  status: string;
  summary: string;
}

const startResults = async () => {
  for (const body of document.querySelectorAll<HTMLElement>('tbody[data-results]')) {
    if (body.dataset.filled) continue;
    body.dataset.filled = '';
    const results = (await (await fetch(`${base}results.json`)).json()) as Result[];
    body.replaceChildren(
      ...results.map(({ audit, status, summary }) => {
        const row = document.createElement('tr');
        for (const text of [audit, status, summary]) {
          const cell = document.createElement('td');
          cell.textContent = text;
          row.append(cell);
        }
        return row;
      }),
    );
  }
};

const start = () => {
  const scene = document.getElementById('showcase-scene');
  if (scene) void startScene(scene);
  startFacades();
  void startResults();
};

start();
document.addEventListener(PAGE_EVENT, start);
