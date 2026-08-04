/* ==========================================================================
   Lit — hero signature scene
   Coffee pours in a spiral stream, fills a mug wrapped with the "lit"
   wordmark, then the mug turns slowly over a small flame, steam rising.
   ========================================================================== */
import * as THREE from "three";

const COLORS = {
  cream: 0xf1e7d6,
  ink: 0x3a271b,
  coffee: 0x4a2c18,
  coffeeShine: 0x7a4426,
  ember: 0xd9541f,
  gold: 0xe8a23d,
  flameHot: 0xffd166,
  glow: 0xffb347,
  kettle: 0x241c16,
  kettleTrim: 0x8b98a0,
};

const STEAM_COUNT = 140;
const FLAME_COUNT = 90;
const STREAM_COUNT = 130;
const CUP_Y = 0.15;
const FLAME_Y = -1.85;
const RIG_SCALE = 0.72;
const COFFEE_EMPTY_Y = -0.66;
const COFFEE_FULL_Y = 0.62;
const SPOUT_TIP = new THREE.Vector3(0.1, 2.05, 0.08);
const RIM_CENTER = new THREE.Vector3(0, 0.86, 0);

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// piecewise-linear interpolation across [t, value] keyframes, clamped at ends
function keyframe(t, stops) {
  if (t <= stops[0][0]) return stops[0][1];
  if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, v0] = stops[i];
    const [t1, v1] = stops[i + 1];
    if (t >= t0 && t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return stops[stops.length - 1][1];
}

function paintCupTexture(canvas, fontFamily) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#f1e7d6";
  ctx.fillRect(0, 0, w, h);

  const fontSize = 168;
  ctx.textBaseline = "alphabetic";
  ctx.font = `italic 600 ${fontSize}px ${fontFamily}`;
  const cy = h * 0.46;

  [w * 0.25, w * 0.75].forEach((cx) => {
    const lw = ctx.measureText("l").width;
    const iw = ctx.measureText("i").width;
    const tw = ctx.measureText("t").width;
    let x = cx - (lw + iw + tw) / 2;
    const y = cy + fontSize * 0.32;
    ctx.fillStyle = "#3a271b";
    ctx.fillText("l", x, y);
    x += lw;
    ctx.fillStyle = "#d9541f";
    ctx.fillText("i", x, y);
    x += iw;
    ctx.fillStyle = "#3a271b";
    ctx.fillText("t", x, y);
  });
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
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2b1c12, 0.04);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const restPos = new THREE.Vector3(0.5, 0.05, 8.6);
  const startPos = new THREE.Vector3(1.5, 1.1, 11.5);
  camera.position.copy(reduceMotion ? restPos : startPos);
  camera.lookAt(0, -0.15, 0);

  // ---- lights: warm and bright rather than moody --------------------------
  const ambient = new THREE.AmbientLight(0x8a715a, 1.4);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xfff6e8, 1.3);
  keyLight.position.set(-3, 4, 4);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffd9a8, 0.6);
  fillLight.position.set(3, 1, -2);
  scene.add(fillLight);

  const flameLight = new THREE.PointLight(COLORS.ember, 0, 8, 2);
  flameLight.position.set(0, (FLAME_Y + 0.2) * RIG_SCALE, 0);
  scene.add(flameLight);

  // ---- rig: everything turns together, slowly ------------------------------
  const rig = new THREE.Group();
  rig.scale.setScalar(RIG_SCALE);
  scene.add(rig);

  // ---- mug, wrapped with the "lit" wordmark on both sides ------------------
  const mug = new THREE.Group();
  mug.position.y = CUP_Y;
  rig.add(mug);

  const cupCanvas = document.createElement("canvas");
  cupCanvas.width = 1024;
  cupCanvas.height = 512;
  paintCupTexture(cupCanvas, "Georgia, serif");
  const cupTexture = new THREE.CanvasTexture(cupCanvas);
  cupTexture.colorSpace = THREE.SRGBColorSpace;

  if (document.fonts && document.fonts.load) {
    document.fonts
      .load(`italic 600 168px Fraunces`)
      .then(() => document.fonts.ready)
      .then(() => {
        paintCupTexture(cupCanvas, '"Fraunces", Georgia, serif');
        cupTexture.needsUpdate = true;
      })
      .catch(() => {});
  }

  const bodyGeo = new THREE.CylinderGeometry(0.95, 0.78, 1.35, 48, 1, true);
  const bodyMat = new THREE.MeshStandardMaterial({
    map: cupTexture,
    roughness: 0.4,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  mug.add(body);

  const trimMat = new THREE.MeshStandardMaterial({ color: COLORS.cream, roughness: 0.38, metalness: 0.04 });

  const base = new THREE.Mesh(new THREE.CircleGeometry(0.78, 40), trimMat);
  base.rotation.x = Math.PI / 2;
  base.position.y = -0.675;
  mug.add(base);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.045, 12, 40), trimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.675;
  mug.add(rim);

  const coffeeMat = new THREE.MeshStandardMaterial({
    color: COLORS.coffee,
    roughness: 0.22,
    metalness: 0.1,
    emissive: new THREE.Color(COLORS.coffeeShine),
    emissiveIntensity: 0.12,
  });
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.88, 40), coffeeMat);
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = COFFEE_EMPTY_Y;
  mug.add(coffee);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.11, 14, 32, Math.PI * 1.5), trimMat);
  handle.position.set(0.95, 0, 0);
  handle.rotation.set(0, Math.PI / 2, Math.PI * 0.75);
  mug.add(handle);

  // ---- kettle: pours, then fades once the cup is full -----------------------
  const kettle = new THREE.Group();
  kettle.position.set(0.05, 2.2, -0.05);
  rig.add(kettle);

  const kettleBodyMat = new THREE.MeshStandardMaterial({ color: COLORS.kettle, roughness: 0.45, metalness: 0.15, transparent: true });
  const kettleTrimMat = new THREE.MeshStandardMaterial({ color: COLORS.kettleTrim, roughness: 0.35, metalness: 0.4, transparent: true });

  const kettleBody = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), kettleBodyMat);
  kettleBody.scale.set(1, 0.85, 0.85);
  kettle.add(kettleBody);

  const kettleSpout = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.075, 0.4, 10), kettleTrimMat);
  kettleSpout.position.set(0.28, -0.1, 0.15);
  kettleSpout.rotation.set(0, 0, -Math.PI * 0.32);
  kettle.add(kettleSpout);

  const kettleLid = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), kettleTrimMat);
  kettleLid.position.set(-0.05, 0.24, 0);
  kettle.add(kettleLid);

  const kettleMats = [kettleBodyMat, kettleTrimMat];

  // ---- spiral pour stream ----------------------------------------------------
  const streamGeo = new THREE.BufferGeometry();
  const stPhase = new Float32Array(STREAM_COUNT);
  const stSpeed = new Float32Array(STREAM_COUNT);
  const stSeed = new Float32Array(STREAM_COUNT);
  for (let i = 0; i < STREAM_COUNT; i++) {
    stPhase[i] = i / STREAM_COUNT;
    stSpeed[i] = THREE.MathUtils.randFloat(0.5, 0.7);
    stSeed[i] = Math.random();
  }
  streamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(STREAM_COUNT * 3), 3));
  streamGeo.setAttribute("aPhase", new THREE.BufferAttribute(stPhase, 1));
  streamGeo.setAttribute("aSpeed", new THREE.BufferAttribute(stSpeed, 1));
  streamGeo.setAttribute("aSeed", new THREE.BufferAttribute(stSeed, 1));

  const streamMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uFrom: { value: SPOUT_TIP.clone() },
      uTo: { value: RIM_CENTER.clone() },
      uHot: { value: new THREE.Color(COLORS.gold) },
      uCool: { value: new THREE.Color(COLORS.ember) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform vec3 uFrom;
      uniform vec3 uTo;
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSeed;
      varying float vProgress;
      void main(){
        float progress = fract(aPhase + uTime * aSpeed);
        vProgress = progress;
        vec3 pathPos = mix(uFrom, uTo, progress);
        float radius = mix(0.16, 0.015, progress);
        float angle = aSeed * 6.2831 + uTime * 2.4 + progress * 10.0;
        pathPos.x += cos(angle) * radius;
        pathPos.z += sin(angle) * radius;
        vec4 mv = modelViewMatrix * vec4(pathPos, 1.0);
        float size = mix(7.0, 2.5, progress);
        gl_PointSize = size * (10.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uHot;
      uniform vec3 uCool;
      uniform float uIntensity;
      varying float vProgress;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float alpha = smoothstep(0.5, 0.0, d);
        alpha *= smoothstep(0.0, 0.08, vProgress) * smoothstep(1.0, 0.9, vProgress);
        vec3 color = mix(uHot, uCool, vProgress);
        gl_FragColor = vec4(color, alpha * uIntensity);
      }
    `,
  });
  const stream = new THREE.Points(streamGeo, streamMat);
  rig.add(stream);

  // ---- flame beneath the mug --------------------------------------------
  const flameGeo = new THREE.BufferGeometry();
  const fPos = new Float32Array(FLAME_COUNT * 3);
  const fSeed = new Float32Array(FLAME_COUNT);
  const fSpeed = new Float32Array(FLAME_COUNT);
  for (let i = 0; i < FLAME_COUNT; i++) {
    const r = Math.random() * 0.4;
    const a = Math.random() * Math.PI * 2;
    fPos[i * 3 + 0] = Math.cos(a) * r;
    fPos[i * 3 + 1] = FLAME_Y + Math.random() * 0.15;
    fPos[i * 3 + 2] = Math.sin(a) * r;
    fSeed[i] = Math.random() * 20;
    fSpeed[i] = THREE.MathUtils.randFloat(0.6, 1.3);
  }
  flameGeo.setAttribute("position", new THREE.BufferAttribute(fPos, 3));
  flameGeo.setAttribute("aSeed", new THREE.BufferAttribute(fSeed, 1));
  flameGeo.setAttribute("aSpeed", new THREE.BufferAttribute(fSpeed, 1));

  const flameMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uHot: { value: new THREE.Color(COLORS.flameHot) },
      uCool: { value: new THREE.Color(COLORS.ember) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      attribute float aSeed;
      attribute float aSpeed;
      varying float vLife;
      void main(){
        float span = 0.55;
        float raw = mod(position.y + uTime * aSpeed * 0.8 + aSeed, span);
        vLife = clamp(raw / span, 0.0, 1.0);
        vec3 p = position;
        p.y = ${FLAME_Y.toFixed(2)} + raw;
        float taper = 1.0 - vLife;
        p.x *= 0.4 + taper * 0.6;
        p.z *= 0.4 + taper * 0.6;
        p.x += sin(uTime * 3.0 + aSeed) * 0.03 * vLife;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float size = (1.0 - vLife) * 13.0 + 4.0;
        gl_PointSize = size * (10.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uHot;
      uniform vec3 uCool;
      uniform float uIntensity;
      varying float vLife;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float alpha = smoothstep(0.5, 0.0, d);
        alpha *= smoothstep(1.0, 0.15, vLife);
        vec3 color = mix(uHot, uCool, vLife);
        gl_FragColor = vec4(color, alpha * uIntensity);
      }
    `,
  });
  const flame = new THREE.Points(flameGeo, flameMat);
  rig.add(flame);

  // ---- steam rising from the cup -------------------------------------------
  const steamGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(STEAM_COUNT * 3);
  const sSeed = new Float32Array(STEAM_COUNT);
  const sSpeed = new Float32Array(STEAM_COUNT);
  const sSpread = new Float32Array(STEAM_COUNT * 2);
  for (let i = 0; i < STEAM_COUNT; i++) {
    const r = Math.sqrt(Math.random()) * 0.55;
    const a = Math.random() * Math.PI * 2;
    sPos[i * 3 + 0] = Math.cos(a) * r;
    sPos[i * 3 + 1] = THREE.MathUtils.randFloat(0, 2.4);
    sPos[i * 3 + 2] = Math.sin(a) * r;
    sSeed[i] = Math.random() * 10;
    sSpeed[i] = THREE.MathUtils.randFloat(0.25, 0.6);
    sSpread[i * 2 + 0] = (Math.random() - 0.5) * 0.7;
    sSpread[i * 2 + 1] = (Math.random() - 0.5) * 0.7;
  }
  steamGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
  steamGeo.setAttribute("aSeed", new THREE.BufferAttribute(sSeed, 1));
  steamGeo.setAttribute("aSpeed", new THREE.BufferAttribute(sSpeed, 1));
  steamGeo.setAttribute("aSpread", new THREE.BufferAttribute(sSpread, 2));

  const steamMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uColor: { value: new THREE.Color(COLORS.cream) },
      uBase: { value: CUP_Y + 0.62 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uBase;
      attribute float aSeed;
      attribute float aSpeed;
      attribute vec2 aSpread;
      varying float vLife;
      void main(){
        float span = 2.4;
        float raw = mod(position.y + uTime * aSpeed * 0.6 + aSeed, span);
        vLife = clamp(raw / span, 0.0, 1.0);
        vec3 p = position;
        p.y = uBase + raw;
        p.x += sin(uTime * 0.5 + aSeed) * aSpread.x * vLife;
        p.z += cos(uTime * 0.45 + aSeed) * aSpread.y * vLife;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float size = (0.4 + vLife * 1.6) * 10.0;
        gl_PointSize = size * (10.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vLife;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float alpha = smoothstep(0.5, 0.0, d);
        alpha *= smoothstep(1.0, 0.05, vLife) * 0.4;
        gl_FragColor = vec4(uColor, alpha * uIntensity);
      }
    `,
  });
  const steam = new THREE.Points(steamGeo, steamMat);
  rig.add(steam);

  // ---- warm backdrop glow ---------------------------------------------------
  const glowGeo = new THREE.PlaneGeometry(10, 10);
  const glowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(COLORS.glow) }, uIntensity: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uIntensity;
      void main(){
        float d = distance(vUv, vec2(0.5, 0.42));
        float a = smoothstep(0.55, 0.0, d) * uIntensity;
        gl_FragColor = vec4(uColor, a * 0.4);
      }
    `,
  });
  const glowPlane = new THREE.Mesh(glowGeo, glowMat);
  glowPlane.position.z = -3;
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

  // ---- pour choreography (fractions of intro progress) -----------------------
  const KETTLE_TILT = [
    [0, -0.15],
    [0.15, -1.0],
    [0.55, -1.0],
    [0.72, -0.15],
  ];
  const KETTLE_OPACITY = [
    [0, 1],
    [0.78, 1],
    [0.94, 0],
  ];
  const STREAM_INTENSITY = [
    [0, 0],
    [0.14, 1],
    [0.55, 1],
    [0.68, 0],
  ];
  const FILL_FRACTION = [
    [0.16, 0],
    [0.64, 1],
  ];
  const IGNITE = [
    [0, 0.15],
    [0.3, 1],
  ];

  // ---- animation loop -----------------------------------------------------
  const clock = new THREE.Clock();
  let introT = 0;
  let raf = null;
  let ignited = false;

  function setKettleOpacity(v) {
    kettleMats.forEach((m) => (m.opacity = v));
    kettle.visible = v > 0.01;
  }

  function renderStatic() {
    rig.rotation.y = 0.4;
    flameMat.uniforms.uIntensity.value = 1;
    steamMat.uniforms.uIntensity.value = 1;
    glowMat.uniforms.uIntensity.value = 1;
    streamMat.uniforms.uIntensity.value = 0;
    flameLight.intensity = 1.8;
    coffee.position.y = COFFEE_FULL_Y;
    setKettleOpacity(0);
    renderer.render(scene, camera);
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    if (!inView) return;

    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    if (introT < 1) {
      introT = Math.min(1, introT + dt / 2.6);
      const e = easeOutCubic(Math.min(1, introT / 0.6));
      camera.position.lerpVectors(startPos, restPos, e);
      camera.lookAt(0, -0.15, 0);

      const ignite = keyframe(introT, IGNITE);
      flameMat.uniforms.uIntensity.value = ignite;
      glowMat.uniforms.uIntensity.value = ignite;
      flameLight.intensity = ignite * 1.8;

      kettle.rotation.z = keyframe(introT, KETTLE_TILT);
      setKettleOpacity(keyframe(introT, KETTLE_OPACITY));
      streamMat.uniforms.uIntensity.value = keyframe(introT, STREAM_INTENSITY);

      const fill = keyframe(introT, FILL_FRACTION);
      coffee.position.y = THREE.MathUtils.lerp(COFFEE_EMPTY_Y, COFFEE_FULL_Y, fill);
      steamMat.uniforms.uIntensity.value = fill;

      if (!ignited && ignite > 0.02) {
        ignited = true;
        canvas.dispatchEvent(new CustomEvent("scene:ignite", { bubbles: true }));
      }
    } else {
      mouse.x += (target.x - mouse.x) * 0.04;
      mouse.y += (target.y - mouse.y) * 0.04;
      camera.position.x = restPos.x + mouse.x * 0.35;
      camera.position.y = restPos.y - mouse.y * 0.2;
      camera.lookAt(0, -0.15, 0);
      flameLight.intensity = 1.6 + Math.sin(t * 9.0) * 0.15 + Math.sin(t * 23.0) * 0.08;
    }

    rig.rotation.y = t * 0.16;
    flameMat.uniforms.uTime.value = t;
    steamMat.uniforms.uTime.value = t;
    streamMat.uniforms.uTime.value = t;

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
