// Cảnh 3D bàn cờ vua: bàn, quân, khay quân bị ăn, ánh sáng, camera góc "ngồi đánh cờ", hiệu ứng.
// Module này chỉ lo phần hiển thị; luật cờ nằm ở shared/chess.js.
//
// Giao diện view dùng chung với board2d.js: sync(board, tray), select, setLastMove, setCheck, animateMove,
// setFlipped, pickCell, resetCamera, topView, setQuality, setRotateEnabled, dispose; onSlow, onContextLost.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rowOf, colOf } from '../shared/chess.js';
import { BOARD_W, BOARD_D, BOARD_H, cellToWorld, worldToCell } from './geometry.js';
import { fitView } from './camera-fit.js';
import { makeBoardTexture, makeTableTexture, makeTrayTexture } from './textures.js';
import { PAL } from './palette.js';
import { TRAY_SCALE, layoutFor, traySlot, trayBase } from './tray.js';

const SEAT_POLAR = (46 * Math.PI) / 180; // nhìn xiên ~44 độ so với mặt bàn
const SEAT_POLAR_TALL = (38 * Math.PI) / 180; // màn dọc: nhìn cao hơn để mép xa rộng ra, quân rõ hơn
const TOP_POLAR = 0.14;
const TARGET = new THREE.Vector3(0, 0, 0);
const PIECE_SCALE = 0.6; // mô hình GLB cao 1.5-2.6 đơn vị, đế rộng 1.05; thu về vừa một ô
const MODEL_FILE = { p: 'pawn', r: 'rook', b: 'bishop', n: 'knight', q: 'queen', k: 'king' };
const MODEL_URL = (t) => `/models/${MODEL_FILE[t]}.glb`;
const PIECE_HEIGHT = { p: 1.52, r: 1.87, b: 2.23, n: 2.3, q: 2.38, k: 2.62 };
const TRAY_H = 0.08;
const MARK_Y = 0.012;

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

export function createView(container) {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.background);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

  // ---------- ánh sáng ----------
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a3d22, 0.72));
  const key = new THREE.DirectionalLight(0xfff0d8, 1.45);
  key.position.set(4, 13, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 32 });
  key.shadow.bias = -0.0004;
  scene.add(key);
  // Đèn viền từ phía xa: vẽ vệt sáng dọc mép quân Đen ở hàng sau để chúng tách khỏi nền tối.
  const rim = new THREE.DirectionalLight(0xffe6c8, 0.85);
  rim.position.set(-3, 7, -14);
  scene.add(rim);

  // ---------- bàn và mặt bàn cờ ----------
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ map: makeTableTexture(renderer), roughness: 0.85 })
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -BOARD_H;
  table.receiveShadow = true;
  scene.add(table);

  const boardGroup = new THREE.Group();
  scene.add(boardGroup);

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_D),
    new THREE.MeshStandardMaterial({ color: PAL.slab, roughness: 0.7 })
  );
  slab.position.y = -BOARD_H / 2;
  slab.castShadow = true;
  slab.receiveShadow = true;
  boardGroup.add(slab);

  const faceMat = new THREE.MeshStandardMaterial({ map: makeBoardTexture(renderer, false), roughness: 0.6 });
  const faceMaps = { normal: faceMat.map, flipped: null };
  let labelsFlipped = false;
  // Chữ a-h, 1-8 trên mặt bàn đổi sang bản lộn ngược khi bàn lật, để người ngồi bên Đen vẫn đọc xuôi.
  function setLabelsFlipped(flag) {
    if (flag === labelsFlipped) return;
    labelsFlipped = flag;
    if (flag && !faceMaps.flipped) faceMaps.flipped = makeBoardTexture(renderer, true);
    faceMat.map = flag ? faceMaps.flipped : faceMaps.normal;
    faceMat.needsUpdate = true;
  }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_D), faceMat);
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.002;
  face.receiveShadow = true;
  boardGroup.add(face);

  // ---------- quân cờ ----------
  // Mỗi loại quân là một file GLB (tải một lần, nhân bản cho từng quân). Chưa tải xong hoặc tải lỗi thì
  // dùng quân dự phòng dựng bằng hình tròn xoay để ván vẫn chơi được.
  const bodyMats = {
    w: new THREE.MeshStandardMaterial({ color: 0xece0c4, roughness: 0.38, metalness: 0.05 }),
    b: new THREE.MeshStandardMaterial({ color: 0x84492a, roughness: 0.34, metalness: 0.08, emissive: 0x1c0d05 }),
  };
  const models = {}; // loại quân (p r n b q k) -> Object3D mẫu
  let loadedAll = false;
  const fallbackGeo = {};
  function fallbackFor(type) {
    if (fallbackGeo[type]) return fallbackGeo[type];
    const h = PIECE_HEIGHT[type] * PIECE_SCALE;
    const w = type === 'p' ? 0.26 : 0.3;
    const pts = [[0.001, 0], [0.31, 0], [0.31, 0.06], [w, 0.12], [w * 0.65, h * 0.45], [w * 0.8, h * 0.8], [w * 0.8, h * 0.9], [0.001, h]];
    fallbackGeo[type] = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 28);
    return fallbackGeo[type];
  }

  function loadModels() {
    const loader = new GLTFLoader();
    const types = Object.keys(PIECE_HEIGHT);
    let pending = types.length;
    const errors = [];
    for (const t of types) {
      loader.load(
        MODEL_URL(t),
        (gltf) => {
          try {
            gltf.scene.traverse((o) => {
              if (o.isMesh) {
                o.castShadow = true;
                o.receiveShadow = true;
              }
            });
            models[t] = gltf.scene;
          } catch (e) {
            errors.push(`${t}: ${e && e.message}`);
          }
          if (--pending === 0) done();
        },
        undefined,
        (e) => {
          errors.push(`${t}: ${(e && e.message) || 'không tải được'}`);
          if (--pending === 0) done();
        }
      );
    }
    function done() {
      loadedAll = true;
      if (alive && lastBoard) sync(lastBoard, lastTray); // thay quân dự phòng bằng quân thật
      if (view.onModelsLoaded) view.onModelsLoaded(Object.keys(models).length === types.length, errors.join('; '));
    }
  }

  const pieceGroup = new THREE.Group();
  boardGroup.add(pieceGroup);
  const trayGroup = new THREE.Group();
  boardGroup.add(trayGroup);
  const meshes = new Array(64).fill(null);

  function createPiece(ch, scale = 1) {
    const type = ch.toLowerCase();
    const side = ch === ch.toUpperCase() ? 'w' : 'b';
    const g = new THREE.Group();
    const tpl = models[type];
    if (tpl) {
      const m = tpl.clone(true);
      m.traverse((o) => {
        if (o.isMesh && o.material && o.material.name === 'body') o.material = bodyMats[side];
      });
      m.scale.setScalar(PIECE_SCALE);
      // Mã quay nghiêng (hơi hướng về phía đối thủ) để nhìn thấy rõ hình đầu ngựa từ phía người chơi.
      m.rotation.y = Math.PI + Math.PI / 9; // cả hai bên cùng nhìn sang trái và quay mặt về phía người xem, thấy rõ đôi mắt
      g.add(m);
    } else {
      const f = new THREE.Mesh(fallbackFor(type), bodyMats[side]);
      f.castShadow = true;
      f.receiveShadow = true;
      g.add(f);
    }
    g.scale.setScalar(scale);
    g.userData.ch = ch;
    return g;
  }

  // ---------- khay quân bị ăn ----------
  const trayMat = new THREE.MeshStandardMaterial({ map: makeTrayTexture(renderer), roughness: 0.8 });
  const trayY = -BOARD_H + TRAY_H;
  let layout = 'tb';
  let insetTop = 0;
  let insetBottom = 0;
  let lastTray = { w: [], b: [] };
  let lastBoard = null;
  let trayMeshes = { w: [], b: [] };

  function buildTrays(tray) {
    trayGroup.clear();
    trayMeshes = { w: [], b: [] };
    for (const side of ['w', 'b']) {
      const base = trayBase(side, layout);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(base.w, TRAY_H, base.d), trayMat);
      plate.position.set(base.cx, -BOARD_H + TRAY_H / 2, base.cz);
      plate.receiveShadow = true;
      trayGroup.add(plate);
      tray[side].forEach((ch, i) => {
        const p = createPiece(ch, TRAY_SCALE);
        const s = traySlot(side, i, layout);
        p.position.set(s.x, trayY, s.z);
        trayGroup.add(p);
        trayMeshes[side].push(p);
      });
    }
  }

  // ---------- dấu hiệu trên bàn ----------
  const overlay = new THREE.Group();
  boardGroup.add(overlay);
  const selectLayer = new THREE.Group();
  const lastLayer = new THREE.Group();
  const checkLayer = new THREE.Group();
  overlay.add(lastLayer, selectLayer, checkLayer);

  const ringGeo = (inner, outer) => new THREE.RingGeometry(inner, outer, 40).rotateX(-Math.PI / 2);
  const basic = (color, opacity) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const selRingGeo = ringGeo(0.5, 0.62);
  const capRingGeo = ringGeo(0.45, 0.58);
  const lastRingGeo = ringGeo(0.51, 0.56);
  const dotGeo = new THREE.CircleGeometry(0.17, 24).rotateX(-Math.PI / 2);
  const greenMat = basic(0x2e9e6b, 0.95);
  const dotMat = basic(0x2e9e6b, 0.8);
  const redMat = basic(0xe8352b, 0.95);
  const yellowMat = basic(0xffd23f, 0.9);
  const checkMat = basic(0xe8352b, 0.8);

  function placeMark(group, geo, mat, idx) {
    const m = new THREE.Mesh(geo, mat);
    const { x, z } = cellToWorld(rowOf(idx), colOf(idx));
    m.position.set(x, MARK_Y, z);
    m.renderOrder = 2;
    group.add(m);
    return m;
  }

  // ---------- hiệu ứng (tween) ----------
  const tweens = [];
  function tween(duration, onUpdate, onDone) {
    tweens.push({ t0: performance.now(), duration, onUpdate, onDone });
  }

  // ---------- camera ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableRotate = false; // mặc định khóa; nút "Xoay" trên thanh nút mới bật
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.3;
  controls.minAzimuthAngle = -0.9;
  controls.maxAzimuthAngle = 0.9;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target.copy(TARGET);

  // Camera được mô tả bằng (góc đứng polar, góc ngang azim, tỉ lệ zoom so với khoảng cách vừa khít).
  // Khi bố cục đổi (ẩn/hiện menu, xoay màn hình) chỉ tính lại khoảng cách và độ dời, giữ nguyên góc và zoom.
  let cam = { polar: SEAT_POLAR, azim: 0, ratio: 1 };
  const seatPolar = () => (layout === 'tb' ? SEAT_POLAR_TALL : SEAT_POLAR);

  function viewSize() {
    return { w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) };
  }

  let fitRot = 0; // góc lật bàn dùng để tính khung hình (đích của lần lật)

  function fitAt(polar, azim) {
    const { w, h } = viewSize();
    return fitView({ layout, w, h, top: insetTop, bottom: insetBottom, fov: camera.fov, polar, azim, rot: fitRot });
  }

  // Đặt camera theo trạng thái cam: vị trí, độ dời hình, giới hạn zoom.
  function placeCamera(st) {
    const { w, h } = viewSize();
    const f = fitAt(st.polar, st.azim);
    const d = f.distance * st.ratio;
    camera.position.set(
      TARGET.x + d * Math.sin(st.polar) * Math.sin(st.azim),
      TARGET.y + d * Math.cos(st.polar),
      TARGET.z + d * Math.sin(st.polar) * Math.cos(st.azim)
    );
    camera.setViewOffset(w, h, -f.ox, -f.oy, w, h);
    controls.target.copy(TARGET);
    controls.minDistance = f.distance * 0.45;
    controls.maxDistance = f.distance * 1.6;
    cam = { ...st };
  }

  // Đọc lại góc và zoom hiện tại từ camera (người chơi có thể đã xoay hoặc zoom).
  function readCamera() {
    const dx = camera.position.x - TARGET.x;
    const dy = camera.position.y - TARGET.y;
    const dz = camera.position.z - TARGET.z;
    const r = Math.hypot(dx, dy, dz);
    if (r < 1e-3) return cam;
    const polar = Math.acos(Math.max(-1, Math.min(1, dy / r)));
    const azim = Math.atan2(dx, dz);
    const f = fitAt(polar, azim);
    return { polar, azim, ratio: r / f.distance };
  }

  function goTo(st, animate) {
    if (!animate) {
      placeCamera(st);
      return;
    }
    const from = readCamera();
    // đi theo đường ngắn nhất về góc ngang
    let da = st.azim - from.azim;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    tween(550, (p) => {
      const e = ease(p);
      placeCamera({
        polar: from.polar + (st.polar - from.polar) * e,
        azim: from.azim + da * e,
        ratio: from.ratio + (st.ratio - from.ratio) * e,
      });
    });
  }

  function resetCamera(animate = true) {
    goTo({ polar: seatPolar(), azim: 0, ratio: 1 }, animate);
  }

  function topView() {
    goTo({ polar: TOP_POLAR, azim: 0, ratio: 1 }, true);
  }

  // Tâm BÀN CỜ luôn ở gốc và camera nhìn thẳng vào đó, nên trục giữa bàn thẳng đứng;
  // phần khay được đưa vào khung hình bằng độ dời ống kính (setViewOffset) chứ không bằng cách quay camera.
  function centerAssembly() {
    boardGroup.position.set(0, 0, 0);
  }

  let firstLayout = true;
  function resize() {
    const { w, h } = viewSize();
    let keep = firstLayout ? null : readCamera();
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const next = layoutFor(w / Math.max(80, h - insetTop - insetBottom));
    if (next !== layout) {
      layout = next;
      buildTrays(lastTray);
    }
    if (firstLayout) keep = { polar: seatPolar(), azim: 0, ratio: 1 };
    firstLayout = false;
    centerAssembly();
    placeCamera(keep);
  }

  // ---------- chất lượng ----------
  function setQuality(low) {
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !low;
    key.castShadow = !low;
    scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  }

  // ---------- giao diện công khai ----------
  let selectedMesh = null;
  let pendingFlight = null; // quân vừa bị ăn, sẽ bay vào khay ở lần sync kế tiếp

  function sync(board, tray = { w: [], b: [] }) {
    lastBoard = board;
    pieceGroup.clear();
    meshes.fill(null);
    selectedMesh = null;
    for (let i = 0; i < 64; i++) {
      const ch = board[i];
      if (ch === '.') continue;
      const p = createPiece(ch);
      const { x, z } = cellToWorld(rowOf(i), colOf(i));
      p.position.set(x, 0, z);
      pieceGroup.add(p);
      meshes[i] = p;
    }
    lastTray = tray;
    buildTrays(tray);

    const fl = pendingFlight;
    pendingFlight = null;
    if (fl && performance.now() - fl.at < 1500) {
      const side = fl.ch === fl.ch.toUpperCase() ? 'w' : 'b';
      const slotMesh = trayMeshes[side][tray[side].length - 1];
      if (slotMesh && tray[side][tray[side].length - 1] === fl.ch) {
        slotMesh.visible = false;
        const end = slotMesh.position.clone();
        const flight = createPiece(fl.ch, 1);
        flight.position.set(fl.x, 0.25, fl.z);
        trayGroup.add(flight);
        tween(
          520,
          (p) => {
            const e = ease(p);
            flight.position.x = fl.x + (end.x - fl.x) * e;
            flight.position.z = fl.z + (end.z - fl.z) * e;
            flight.position.y = 0.25 + (end.y - 0.25) * e + 1.1 * Math.sin(Math.PI * e);
            flight.scale.setScalar(1 + (TRAY_SCALE - 1) * e);
          },
          () => {
            trayGroup.remove(flight);
            slotMesh.visible = true;
          }
        );
      }
    }
  }

  // idx: ô đang chọn (hoặc null); targets: [{ to, capture }]
  function select(idx, targets = []) {
    selectLayer.clear();
    if (selectedMesh) {
      selectedMesh.position.y = 0;
      selectedMesh = null;
    }
    if (idx === null || idx === undefined) return;
    placeMark(selectLayer, selRingGeo, greenMat, idx);
    const m = meshes[idx];
    if (m) {
      m.position.y = 0.2;
      selectedMesh = m;
    }
    for (const t of targets) {
      if (t.capture) placeMark(selectLayer, capRingGeo, redMat, t.to);
      else placeMark(selectLayer, dotGeo, dotMat, t.to);
    }
  }

  function setLastMove(from, to) {
    lastLayer.clear();
    if (from === null || from === undefined) return;
    placeMark(lastLayer, lastRingGeo, yellowMat, from);
    placeMark(lastLayer, lastRingGeo, yellowMat, to);
  }

  function setCheck(idx) {
    checkLayer.clear();
    if (idx === null || idx === undefined || idx < 0) return;
    placeMark(checkLayer, selRingGeo, checkMat, idx);
  }

  // Nhấc quân lên, trượt sang ô mới, đặt xuống rồi gọi onLand.
  function animateMove(from, to, onLand) {
    const mesh = meshes[from];
    if (!mesh) {
      onLand();
      return;
    }
    const captured = meshes[to];
    const capturedCh = captured ? captured.userData.ch : null;
    const a = cellToWorld(rowOf(from), colOf(from));
    const b = cellToWorld(rowOf(to), colOf(to));
    const startY = mesh.position.y;
    selectLayer.clear();
    selectedMesh = null;
    tween(
      340,
      (p) => {
        const e = ease(p);
        mesh.position.x = a.x + (b.x - a.x) * e;
        mesh.position.z = a.z + (b.z - a.z) * e;
        mesh.position.y = startY * (1 - e) + 0.9 * Math.sin(Math.PI * e);
      },
      () => {
        mesh.position.set(b.x, 0, b.z);
        if (captured) {
          pieceGroup.remove(captured);
          pendingFlight = { ch: capturedCh, x: b.x, z: b.z, at: performance.now() };
        }
        onLand();
      }
    );
  }

  function setFlipped(flag, animate = true) {
    const target = flag ? Math.PI : 0;
    if (target !== fitRot) {
      const keep = readCamera();
      fitRot = target;
      placeCamera(keep);
    }
    if (!animate) {
      setLabelsFlipped(flag);
      boardGroup.rotation.y = target;
      return;
    }
    const from = boardGroup.rotation.y;
    tween(650, (p) => {
      boardGroup.rotation.y = from + (target - from) * ease(p);
      if (p >= 0.5) setLabelsFlipped(flag); // đổi chữ giữa lúc xoay, khi bàn nằm nghiêng
    });
  }

  // Ô cờ dưới điểm chạm (toạ độ màn hình), hoặc null.
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  function pickCell(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    boardGroup.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(pieceGroup.children, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && o.parent !== pieceGroup) o = o.parent;
      const i = meshes.indexOf(o);
      if (i >= 0) return { row: rowOf(i), col: colOf(i) };
    }
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    const local = boardGroup.worldToLocal(hit.clone());
    return worldToCell(local.x, local.z);
  }

  // ---------- vòng lặp vẽ ----------
  let alive = true;
  let prevNow = 0;
  let slowSum = 0;
  let slowCount = 0;
  let slowStrikes = 0;

  function watchFps(now) {
    const dt = now - prevNow;
    prevNow = now;
    if (dt <= 0 || dt > 400 || document.hidden) return; // bỏ qua lúc tab bị ẩn hoặc treo
    slowSum += dt;
    slowCount++;
    if (slowCount >= 90) {
      const avg = slowSum / slowCount;
      slowSum = 0;
      slowCount = 0;
      slowStrikes = avg > 42 ? slowStrikes + 1 : 0; // dưới ~24 fps ba lần liên tiếp
      if (slowStrikes >= 3) {
        slowStrikes = 0;
        if (view.onSlow) view.onSlow();
      }
    }
  }

  function frame(now) {
    if (!alive) return;
    requestAnimationFrame(frame);
    watchFps(now);
    for (const tw of tweens.slice()) {
      const p = Math.min(1, (now - tw.t0) / tw.duration);
      tw.onUpdate(p);
      if (p >= 1) {
        tweens.splice(tweens.indexOf(tw), 1);
        if (tw.onDone) tw.onDone();
      }
    }
    checkMat.opacity = 0.55 + 0.35 * Math.sin(now / 180);
    centerAssembly();
    controls.update();
    renderer.render(scene, camera);
  }

  const onContextLost = (e) => {
    e.preventDefault();
    if (view.onContextLost) view.onContextLost();
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  window.addEventListener('resize', resize);

  function dispose() {
    alive = false;
    window.removeEventListener('resize', resize);
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    controls.dispose();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch (_) {
      /* bỏ qua */
    }
    renderer.domElement.remove();
  }

  setQuality(false);
  resize();
  loadModels();
  requestAnimationFrame(frame);

  const view = {
    kind: '3d',
    domElement: renderer.domElement,
    onSlow: null,
    onContextLost: null,
    onModelsLoaded: null,
    sync,
    select,
    setLastMove,
    setCheck,
    animateMove,
    setFlipped,
    pickCell,
    resetCamera: () => resetCamera(true),
    topView,
    setQuality,
    setInsets(top, bottom) {
      insetTop = Math.max(0, top | 0);
      insetBottom = Math.max(0, bottom | 0);
      resize();
    },
    setRotateEnabled: (flag) => {
      controls.enableRotate = !!flag;
    },
    dispose,
  };
  return view;
}

