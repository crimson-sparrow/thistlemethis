// thistle me this – glass icon viewer.
// Every <canvas class="thistle-icon"> on the page gets its own spinning glass icon.
// Optional per-canvas attributes:
//   data-model  GLB url   (default: thistlemethis-icon.glb next to this script)
//   data-sky    HDR url   (default: sky.hdr next to this script)
//   data-tint   0..1 how much of the tinted body shows (default 0.6; 0 = perfectly clear)
//   data-level  brightness of that body (default 0.08; lower = darker glass)
//   data-rim    strength of the lilac edge glow (default 1.2; 0 = off)
//   data-back   how strongly the back edges show through the glass (default 0.8; 0 = off)
//   data-speed  seconds per full turn (default 12; 0 = still)
//   data-drag   "false" stops visitors grabbing and spinning it (default: on)
// Self-contained: loads three.js from jsDelivr, no import map needed (works in Squarespace code blocks).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.187.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { HDRLoader } from 'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/loaders/HDRLoader.js/+esm';
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/environments/RoomEnvironment.js/+esm';

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
  const SKY_TINT = parseFloat(d.tint ?? 0.6);
  const SKY_LEVEL = parseFloat(d.level ?? 0.08);
  const BODY = new THREE.Color(0.42, 0.52, 1.0);     // cool blue-grey cast on the sky seen through the glass

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;   // close to Blender "Standard"
  renderer.setClearColor(0x000000, 0);               // transparent, like the Cycles film

  const scene = new THREE.Scene();
  // Reflections: a soft studio room. Its big glowing panels stand in for the .blend's
  // large area lights and give the bevels their bright rims (point lights only made dots).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;

  // Backdrop the glass refracts. It draws only into three.js's transmission buffer,
  // so the canvas stays transparent and the page shows through the glass.
  // NoBlending overwrites three's default grey fill there with
  // rgb = sky * level * tint (premultiplied) and alpha = tint.
  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(80, 32, 16),
    new THREE.MeshBasicMaterial({
      color: BODY.clone().multiplyScalar(SKY_LEVEL * SKY_TINT),
      side: THREE.BackSide, depthWrite: false,
      opacity: SKY_TINT, blending: THREE.NoBlending,  // not "transparent": stays in the opaque list
    })
  );
  backdrop.onBeforeRender = (r) => { backdrop.material.colorWrite = r.getRenderTarget() !== null; };
  scene.add(backdrop);

  // The .blend's world (qwantani dusk 2 puresky HDRI) is what the glass refracts
  loadSky(d.sky ?? here('sky.hdr')).then((sky) => {
    backdrop.material.map = sky;
    backdrop.material.needsUpdate = true;
  });

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  let spinner;                                       // turns the icon at a constant speed
  const TURN = parseFloat(d.speed ?? 12);            // seconds per full turn (the .blend's 300 frames at 25 fps)

  loadModel(d.model ?? here('thistlemethis-icon.glb')).then((gltf) => {
    const model = gltf.scene.clone(true);              // each icon gets its own copy

    // Restore what glTF can't carry from the Cycles RGB-glass shader
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0,
      roughness: 0.06,
      transmission: 1, ior: 1.5, thickness: 1.8,
      dispersion: 12,                                  // the red/green/blue split (IOR 1.4–1.6)
      iridescence: 0.5, iridescenceIOR: 1.3,
      iridescenceThicknessRange: [250, 500],           // rainbow sheen on the bevels, no green cast face-on
      specularIntensity: 1, envMapIntensity: 1,
      side: THREE.FrontSide,                           // back faces would stack the tint
      // the see-through part carries alpha, so the page shows through the glass
      // while reflections and highlights stay at full strength
      transparent: true, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    // Bright lilac ring on the rounded bevels, like the Cycles Fresnel/Layer Weight mix.
    // data-rim sets its strength (default 1.2; 0 = off).
    const RIM = parseFloat(d.rim ?? 1.2);
    glass.onBeforeCompile = (sh) => {
      sh.uniforms.rimColor = { value: new THREE.Color(0.85, 0.8, 1.0) };
      sh.uniforms.rimStrength = { value: RIM };
      sh.fragmentShader = `uniform vec3 rimColor;
uniform float rimStrength;
` + sh.fragmentShader.replace('#include <opaque_fragment>', `
float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.5);
outgoingLight += rimColor * rimF * rimStrength;
#include <opaque_fragment>`);
    };

    // The far side of the glass, seen through the front: its edges and bevels glow
    // faintly, so from the flat sides you can see the back outline of every arm.
    // Drawn after the front, additively, so the front's tint doesn't hide it.
    // data-back sets its strength (default 0.8; 0 = off).
    const BACK = parseFloat(d.back ?? 0.8);
    const backGlass = new THREE.ShaderMaterial({
      uniforms: {
        rimColor: { value: new THREE.Color(0.8, 0.78, 1.0) },
        strength: { value: BACK },
      },
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 rimColor; uniform float strength;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          vec3 c = rimColor * (pow(f, 2.5) * 0.9 + 0.04) * strength;
          gl_FragColor = vec4(c, 0.0);
        }`,
      side: THREE.BackSide, transparent: true, depthWrite: false,
      // depth-tested against nothing in front of it except the glass, which writes no depth
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,          // add light
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, // keep alpha
    });
    glass.depthWrite = false;

    // The .blend's two big soft area lights only become tiny pinpoint spots in glTF,
    // which show up as sparkly dots on the glass as it spins. Fully transmissive glass
    // gets no diffuse light anyway, so drop them and let the sky light it.
    const lights = [], meshes = [];
    model.traverse((o) => {
      if (o.isMesh) meshes.push(o);
      if (o.isLight) lights.push(o);
    });
    lights.forEach((l) => l.removeFromParent());
    meshes.forEach((m) => {
      m.material = glass;
      if (BACK > 0) {
        const back = new THREE.Mesh(m.geometry, backGlass);
        back.renderOrder = 1;                          // after the front glass
        m.add(back);
      }
    });
    scene.add(model);

    // frame the icon
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    camera.position.copy(center).add(new THREE.Vector3(0, 0, size * 1.75));
    camera.lookAt(center);

    // The .blend's spin is eased (slows to a stop at each loop), so it's not played.
    // Instead the whole icon turns around the vertical axis at a steady speed.
    spinner = model;
  });

  new ResizeObserver(() => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }).observe(canvas);

  // Grab and spin: drag sideways to turn it, up/down to tilt a little. On release it
  // keeps the speed you threw it with, then eases back to the steady spin and upright.
  // data-drag="false" turns this off. touch-action pan-y keeps vertical page scrolling on phones.
  const BASE = TURN > 0 ? 2 * Math.PI / TURN : 0;   // steady spin, radians per second
  let vel = BASE, tilt = 0, drag = null;
  if (d.drag !== 'false') {
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), v: 0 };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id || !spinner) return;
      const now = performance.now(), dt = Math.max(now - drag.t, 1) / 1000;
      const k = 4 / canvas.clientWidth;               // a full-width drag = about 4 radians
      const dy = (e.clientY - drag.y) * k;
      const dYaw = (e.clientX - drag.x) * k;
      spinner.rotation.y += dYaw;
      tilt = Math.max(-0.6, Math.min(0.6, tilt + dy));
      drag.v = drag.v * 0.6 + (dYaw / dt) * 0.4;      // smoothed throw speed
      Object.assign(drag, { x: e.clientX, y: e.clientY, t: now });
    });
    const release = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      // a drag that stopped before letting go doesn't throw
      vel = performance.now() - drag.t > 80 ? 0 : Math.max(-25, Math.min(25, drag.v));
      drag = null;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  // only render while on screen
  const clock = new THREE.Clock();
  const loop = () => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (spinner && !drag) {
      vel += (BASE - vel) * (1 - Math.exp(-dt * 1.2));  // ease back to the steady spin
      tilt *= Math.exp(-dt * 3);                         // and back upright
      spinner.rotation.y += vel * dt;
    }
    if (spinner) spinner.rotation.x = tilt;
    renderer.render(scene, camera);
  };
  new IntersectionObserver(([e]) => {
    clock.getDelta();
    renderer.setAnimationLoop(e.isIntersecting ? loop : null);
  }).observe(canvas);

  return renderer;
}

document.querySelectorAll('canvas.thistle-icon').forEach(mountIcon);
