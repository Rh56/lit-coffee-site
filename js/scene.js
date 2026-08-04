/* ==========================================================================
   Lit — hero signature scene
   A steel roasting drum tumbling beans through rising embers.
   Bethlehem's blast furnaces, scaled down to a coffee roaster.
   ========================================================================== */
import * as THREE from "three";

const COLORS = {
  char: 0x17110d,
  ember: 0xd9541f,
  ember2: 0xb23e17,
  gold: 0xe8a23d,
  steel: 0x8b98a0,
  bean: 0x3a271b,
  beanLit: 0x5a2f1a,
};

const BEAN_COUNT = 46;
const EMBER_COUNT = 320;
const DRUM_RADIUS = 1.55;
const DRUM_LENGTH = 2.4;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function initScene(canvas) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let supportsWebGL = true;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    supportsWebGL = false;
  }
  if (!supportsWebGL || !renderer) return { destroy() {} };

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COLORS.char, 0.09);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const restPos = new THREE.Vector3(0.9, 0.35, 6.1);
  const startPos = new THREE.Vector3(2.6, 3.4, 11.5);
  camera.position.copy(reduceMotion ? restPos : startPos);
  camera.lookAt(0, 0, 0);

  // ---- lights ---------------------------------------------------------
  const ambient = new THREE.AmbientLight(0x2a2016, 1.1);
  scene.add(ambient);

  const emberLight = new THREE.PointLight(COLORS.ember, 0, 9, 2);
  emberLight.position.set(0.6, -0.2, 1.6);
  scene.add(emberLight);

  const rimLight = new THREE.DirectionalLight(COLORS.steel, 0.5);
  rimLight.position.set(-4, 3, -3);
  scene.add(rimLight);

  const glow = new THREE.PointLight(COLORS.gold, 0, 14, 2);
  glow.position.set(-1.5, 1.8, -1);
  scene.add(glow);

  // ---- drum cage --------------------------------------------------------
  const drum = new THREE.Group();
  drum.rotation.z = Math.PI / 2 * 0.14;
  scene.add(drum);

  const cageMat = new THREE.MeshBasicMaterial({
    color: COLORS.steel,
    wireframe: true,
    transparent: true,
    opacity: 0.34,
  });
  const cageGeo = new THREE.CylinderGeometry(DRUM_RADIUS, DRUM_RADIUS, DRUM_LENGTH, 20, 6, true);
  const cage = new THREE.Mesh(cageGeo, cageMat);
  drum.add(cage);

  // end rings to read as a mechanical drum, not just a barrel of wires
  const ringGeo = new THREE.TorusGeometry(DRUM_RADIUS, 0.02, 8, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.steel, transparent: true, opacity: 0.55 });
  const ringA = new THREE.Mesh(ringGeo, ringMat);
  ringA.rotation.x = Math.PI / 2;
  ringA.position.y = DRUM_LENGTH / 2;
  const ringB = ringA.clone();
  ringB.position.y = -DRUM_LENGTH / 2;
  drum.add(ringA, ringB);

  // central axle glow
  const axleGeo = new THREE.CylinderGeometry(0.04, 0.04, DRUM_LENGTH + 0.6, 8);
  const axleMat = new THREE.MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.5 });
  const axle = new THREE.Mesh(axleGeo, axleMat);
  drum.add(axle);

  // ---- tumbling beans -----------------------------------------------------
  const beanGeo = new THREE.SphereGeometry(0.15, 10, 8);
  beanGeo.scale(1, 0.78, 0.92);
  const beanMat = new THREE.MeshStandardMaterial({
    color: COLORS.bean,
    roughness: 0.65,
    metalness: 0.05,
    emissive: new THREE.Color(COLORS.ember2),
    emissiveIntensity: 0,
  });
  const beans = new THREE.InstancedMesh(beanGeo, beanMat, BEAN_COUNT);
  drum.add(beans);

  const beanData = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < BEAN_COUNT; i++) {
    beanData.push({
      radius: THREE.MathUtils.randFloat(0.25, DRUM_RADIUS * 0.86),
      angle: Math.random() * Math.PI * 2,
      speed: THREE.MathUtils.randFloat(0.25, 0.55) * (Math.random() < 0.5 ? -1 : 1),
      y: THREE.MathUtils.randFloat(-DRUM_LENGTH / 2 + 0.2, DRUM_LENGTH / 2 - 0.2),
      wobble: Math.random() * Math.PI * 2,
      spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(),
      spinSpeed: THREE.MathUtils.randFloat(0.6, 1.6),
    });
  }

  // ---- embers -----------------------------------------------------------
  const emberGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(EMBER_COUNT * 3);
  const seeds = new Float32Array(EMBER_COUNT);
  const speeds = new Float32Array(EMBER_COUNT);
  const spread = new Float32Array(EMBER_COUNT * 2);

  for (let i = 0; i < EMBER_COUNT; i++) {
    const r = Math.sqrt(Math.random()) * DRUM_RADIUS * 0.95;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3 + 0] = Math.cos(a) * r;
    positions[i * 3 + 1] = THREE.MathUtils.randFloat(-1.4, 1.4);
    positions[i * 3 + 2] = Math.sin(a) * r;
    seeds[i] = Math.random() * 10;
    speeds[i] = THREE.MathUtils.randFloat(0.35, 1.1);
    spread[i * 2 + 0] = (Math.random() - 0.5) * 0.5;
    spread[i * 2 + 1] = (Math.random() - 0.5) * 0.5;
  }
  emberGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  emberGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  emberGeo.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  emberGeo.setAttribute("aSpread", new THREE.BufferAttribute(spread, 2));

  const emberMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uColorHot: { value: new THREE.Color(COLORS.gold) },
      uColorCool: { value: new THREE.Color(COLORS.ember2) },
      uHeight: { value: DRUM_LENGTH },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uHeight;
      attribute float aSeed;
      attribute float aSpeed;
      attribute vec2 aSpread;
      varying float vLife;
      void main(){
        float span = uHeight * 1.6;
        float raw = mod(position.y + uTime * aSpeed * 0.6 + aSeed, span) - span * 0.5;
        vLife = clamp((raw + span * 0.5) / span, 0.0, 1.0);
        vec3 p = position;
        p.y = raw;
        p.x += sin(uTime * 0.7 + aSeed) * aSpread.x;
        p.z += cos(uTime * 0.6 + aSeed) * aSpread.y;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float size = (1.6 - vLife) * 5.5 + 1.5;
        gl_PointSize = size * (12.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColorHot;
      uniform vec3 uColorCool;
      uniform float uIntensity;
      varying float vLife;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float alpha = smoothstep(0.5, 0.0, d);
        alpha *= smoothstep(1.0, 0.55, vLife);
        vec3 color = mix(uColorHot, uColorCool, vLife);
        gl_FragColor = vec4(color, alpha * uIntensity);
      }
    `,
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  drum.add(embers);

  // ---- backdrop glow plane ------------------------------------------------
  const glowGeo = new THREE.PlaneGeometry(9, 9);
  const glowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(COLORS.ember) }, uIntensity: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uIntensity;
      void main(){
        float d = distance(vUv, vec2(0.5));
        float a = smoothstep(0.5, 0.0, d) * uIntensity;
        gl_FragColor = vec4(uColor, a * 0.35);
      }
    `,
  });
  const glowPlane = new THREE.Mesh(glowGeo, glowMat);
  glowPlane.position.z = -2.4;
  scene.add(glowPlane);

  // ---- responsive sizing --------------------------------------------------
  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  // ---- mouse parallax -------------------------------------------------
  const mouse = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  function onPointerMove(e) {
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = (e.clientY / window.innerHeight - 0.5) * 2;
  }
  if (!reduceMotion) window.addEventListener("pointermove", onPointerMove, { passive: true });

  // ---- visibility gating (perf) -----------------------------------------
  let inView = true;
  const io = new IntersectionObserver((entries) => {
    inView = entries[0].isIntersecting;
  }, { threshold: 0.01 });
  io.observe(canvas);

  // ---- animation loop -----------------------------------------------------
  const clock = new THREE.Clock();
  let introT = 0;
  let raf = null;
  let ignited = false;

  function renderStatic() {
    drum.rotation.y = 0.5;
    emberMat.uniforms.uIntensity.value = 1;
    glowMat.uniforms.uIntensity.value = 1;
    emberLight.intensity = 2.2;
    glow.intensity = 1.4;
    updateBeans(0);
    renderer.render(scene, camera);
  }

  function updateBeans(t) {
    for (let i = 0; i < BEAN_COUNT; i++) {
      const d = beanData[i];
      const angle = d.angle + t * d.speed;
      const wobble = Math.sin(t * 1.3 + d.wobble) * 0.06;
      const r = d.radius + wobble;
      dummy.position.set(Math.cos(angle) * r, d.y, Math.sin(angle) * r);
      dummy.rotation.set(d.spin.x * t * d.spinSpeed, d.spin.y * t * d.spinSpeed, d.spin.z * t * d.spinSpeed);
      dummy.updateMatrix();
      beans.setMatrixAt(i, dummy.matrix);
    }
    beans.instanceMatrix.needsUpdate = true;
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    if (!inView) return;

    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    if (introT < 1) {
      introT = Math.min(1, introT + dt / 2.3);
      const e = easeOutCubic(introT);
      camera.position.lerpVectors(startPos, restPos, e);
      camera.lookAt(0, 0, 0);

      const ignite = Math.max(0, (introT - 0.15) / 0.85);
      const ie = easeInOutSine(Math.min(1, ignite));
      emberMat.uniforms.uIntensity.value = ie;
      glowMat.uniforms.uIntensity.value = ie;
      emberLight.intensity = ie * 2.4;
      glow.intensity = ie * 1.5;
      beanMat.emissiveIntensity = ie * 0.5;
      scene.fog.density = 0.09 - ie * 0.055;

      if (!ignited && ignite > 0.02) {
        ignited = true;
        canvas.dispatchEvent(new CustomEvent("scene:ignite", { bubbles: true }));
      }
    } else {
      mouse.x += (target.x - mouse.x) * 0.04;
      mouse.y += (target.y - mouse.y) * 0.04;
      camera.position.x = restPos.x + mouse.x * 0.35;
      camera.position.y = restPos.y - mouse.y * 0.22;
      camera.lookAt(0, 0.05, 0);
    }

    drum.rotation.y = t * 0.22;
    emberMat.uniforms.uTime.value = t;
    updateBeans(t);

    renderer.render(scene, camera);
  }

  if (reduceMotion) {
    renderStatic();
  } else {
    tick();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = null;
    } else if (!document.hidden && !raf && !reduceMotion) {
      clock.start();
      tick();
    }
  });

  return {
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      resizeObserver.disconnect();
      io.disconnect();
      renderer.dispose();
    },
  };
}
