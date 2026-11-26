// thistle me this – glass icon viewer.
// Every <canvas class="thistle-icon"> on the page gets its own spinning glass icon.
// Optional per-canvas attributes:
//   data-model  GLB url   (default: thistlemethis-icon.glb next to this script)
//   data-sky    HDR url   (default: sky.hdr next to this script)
//   data-tint   0..1 how much sky is mixed into the glass (default 0.2; 0 = perfectly clear)
//   data-level  sky brightness inside the glass (default 0.1; lower = darker on light pages)
// Self-contained: loads three.js from jsDelivr, no import map needed (works in Squarespace code blocks).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.187.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { HDRLoader } from 'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/loaders/HDRLoader.js/+esm';

const here = (f) => new URL(f, import.meta.url).href;

// Load each file once, however many icons are on the page.
const cache = new Map();
const once = (key, fn) => cache.get(key) ?? cache.set(key, fn()).get(key);
const loadModel = (url) => once(url, () => new GLTFLoader().loadAsync(url));
const loadSky = (url) => once(url, () => new HDRLoader().loadAsync(url).then((t) => {
  t.mapping = THREE.EquirectangularReflectionMapping; return t;
}));

export function mountIcon(canvas) {
  const d = canvas.dataset;
  const SKY_TINT = parseFloat(d.tint ?? 0.2);
  const SKY_LEVEL = parseFloat(d.level ?? 0.1);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;   // close to Blender "Standard"
  renderer.setClearColor(0x000000, 0);               // transparent, like the Cycles film

  const scene = new THREE.Scene();
  scene.environmentIntensity = 0.5;                  // Blender world strength 0.5

  // Backdrop the glass refracts. It draws only into three.js's transmission buffer,
  // so the canvas stays transparent and the page shows through the glass.
  // NoBlending overwrites three's default grey fill there with
  // rgb = sky * level * tint (premultiplied) and alpha = tint.
  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(80, 32, 16),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setScalar(SKY_LEVEL * SKY_TINT),
      side: THREE.BackSide, depthWrite: false,
      opacity: SKY_TINT, blending: THREE.NoBlending,  // not "transparent": stays in the opaque list
    })
  );
  backdrop.onBeforeRender = (r) => { backdrop.material.colorWrite = r.getRenderTarget() !== null; };
  scene.add(backdrop);

  // The .blend's world: qwantani dusk 2 (puresky) HDRI
  loadSky(d.sky ?? here('sky.hdr')).then((sky) => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(sky).texture;
    pmrem.dispose();
    backdrop.material.map = sky;
    backdrop.material.needsUpdate = true;
  });

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  let mixer;

  loadModel(d.model ?? here('thistlemethis-icon.glb')).then((gltf) => {
    const model = gltf.scene.clone(true);              // each icon gets its own copy

    // Restore what glTF can't carry from the Cycles RGB-glass shader
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.02,
      transmission: 1, ior: 1.5, thickness: 1.8,
      dispersion: 6,                                   // the red/green/blue split (IOR 1.4–1.6)
      iridescence: 0.35, iridescenceIOR: 1.3,
      specularIntensity: 1, envMapIntensity: 1,
      side: THREE.FrontSide,                           // back faces would stack the tint
      // the see-through part carries alpha, so the page shows through the glass
      // while reflections and highlights stay at full strength
      transparent: true, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    // The .blend's two big soft area lights only become tiny pinpoint spots in glTF,
    // which show up as sparkly dots on the glass as it spins. Fully transmissive glass
    // gets no diffuse light anyway, so drop them and let the sky light it.
    const lights = [];
    model.traverse((o) => {
      if (o.isMesh) o.material = glass;
      if (o.isLight) lights.push(o);
    });
    lights.forEach((l) => l.removeFromParent());
    scene.add(model);

    // frame the icon
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    camera.position.copy(center).add(new THREE.Vector3(0, 0, size * 1.75));
    camera.lookAt(center);

    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(gltf.animations[0]).play();     // 12 s spin from the .blend
    }
  });

  new ResizeObserver(() => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }).observe(canvas);

  // only render while on screen
  const clock = new THREE.Clock();
  const loop = () => { mixer?.update(clock.getDelta()); renderer.render(scene, camera); };
  new IntersectionObserver(([e]) => {
    clock.getDelta();
    renderer.setAnimationLoop(e.isIntersecting ? loop : null);
  }).observe(canvas);

  return renderer;
}

document.querySelectorAll('canvas.thistle-icon').forEach(mountIcon);
