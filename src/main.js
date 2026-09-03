import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- State & References ---
const container = document.getElementById('canvas-container');
let scene, camera, renderer, controls;
let modelRoot = null;
let directionalLight, ambientLight, hemisphereLight;
let initialCameraPos, initialTarget;
let isWireframe = false;
let shadowsEnabled = true;

// Classification Layers
const layers = {
  satellite: [],
  roofFraming: [],
  roofSurface: [],
  groundWalls: [],
  firstFloor: [],
  floor: [],
  buildingBlocks: [],
  roomLabels: []
};

// Layers hidden by default
const defaultHiddenLayers = ['satellite', 'roomLabels'];

// Selection & Raycasting
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedMesh = null;
let selectionBox = null;
const pointerDownPos = { x: 0, y: 0 };
let pointerDownTime = 0;

// Camera Animation State
let isAnimatingCamera = false;
let cameraStartPos = new THREE.Vector3();
let cameraEndPos = new THREE.Vector3();
let targetStart = new THREE.Vector3();
let targetEnd = new THREE.Vector3();
let animProgress = 0;
const animDuration = 1000; // ms
let animStartTime = 0;

// --- Initialize Scene ---
function init() {
  // 1. Scene & Environment
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1d);
  scene.fog = new THREE.FogExp2(0x0a0f1d, 0.0035);

  // 2. Camera
  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 2000);
  camera.position.set(60, 50, 70);

  // 3. Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // 4. Orbit Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 + 0.02; // prevent dipping under the horizon
  controls.minDistance = 2;
  controls.maxDistance = 600;
  controls.target.set(0, 5, 0);

  initialCameraPos = camera.position.clone();
  initialTarget = controls.target.clone();

  // 5. Lighting Setup
  setupLighting();

  // 6. Load GLB Model
  loadModel();

  // 7. Event Listeners & UI Binding
  setupEventListeners();
  setupUI();

  // 8. Animation Loop
  animate();
}

// --- Lighting Rig ---
function setupLighting() {
  // Soft sky/ground ambient
  hemisphereLight = new THREE.HemisphereLight(0xddeeff, 0x182030, 0.7);
  scene.add(hemisphereLight);

  ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  // Sun simulation
  directionalLight = new THREE.DirectionalLight(0xfff8e7, 1.8);
  directionalLight.position.set(80, 120, 90);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 10;
  directionalLight.shadow.camera.far = 400;
  directionalLight.shadow.bias = -0.0005;

  const d = 120;
  directionalLight.shadow.camera.left = -d;
  directionalLight.shadow.camera.right = d;
  directionalLight.shadow.camera.top = d;
  directionalLight.shadow.camera.bottom = -d;

  scene.add(directionalLight);
}

// --- Model Loader ---
function loadModel() {
  const loader = new GLTFLoader();
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const loadDetail = document.getElementById('load-detail');
  const overlay = document.getElementById('loading-overlay');

  loader.load(
    './models/melico_site.glb',
    (gltf) => {
      modelRoot = gltf.scene;

      // Adjust model orientation / scale if needed
      classifySceneObjects(modelRoot);

      scene.add(modelRoot);

      // Compute bounding box & center camera view
      const box = new THREE.Box3().setFromObject(modelRoot);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      controls.target.copy(center);
      camera.position.set(center.x + maxDim * 0.7, center.y + maxDim * 0.6, center.z + maxDim * 0.7);
      camera.lookAt(center);

      initialCameraPos = camera.position.clone();
      initialTarget = controls.target.clone();

      // Fade out loading screen
      setTimeout(() => {
        overlay.classList.remove('active');
      }, 400);
    },
    (xhr) => {
      if (xhr.lengthComputable) {
        const percent = Math.round((xhr.loaded / xhr.total) * 100);
        progressBar.style.width = percent + '%';
        progressText.innerText = percent + '%';
        const mb = (xhr.loaded / (1024 * 1024)).toFixed(1);
        const totalMb = (xhr.total / (1024 * 1024)).toFixed(1);
        loadDetail.innerText = `Downloaded ${mb} MB of ${totalMb} MB...`;
      } else {
        const mb = (xhr.loaded / (1024 * 1024)).toFixed(1);
        loadDetail.innerText = `Downloaded ${mb} MB...`;
      }
    },
    (error) => {
      console.error('Error loading 3D model:', error);
      loadDetail.innerText = 'Error loading model. Check console.';
      progressText.innerText = 'Failed';
      progressBar.style.background = '#ef4444';
    }
  );
}

// --- Classify & Categorize Objects into Layers ---
function classifySceneObjects(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;

    const name = child.name;

    // Enhance materials for PBR appearance
    if (child.material) {
      child.material.side = THREE.DoubleSide;
      child.material.roughness = Math.max(child.material.roughness || 0.5, 0.4);
    }

    // Classify into functional layer
    if (name.includes('GOOGLE_SAT_WM') || name.includes('GroundSurface')) {
      layers.satellite.push(child);
      child.receiveShadow = true;
      child.castShadow = false;
      child.userData.category = 'GIS Satellite Terrain';
    } else if (
      name.startsWith('Common Rafter') ||
      name.startsWith('Jack Rafter') ||
      name.startsWith('Valley Jack') ||
      name.startsWith('Hip Rafter') ||
      name.startsWith('Ridge Beam') ||
      name.startsWith('Valley Rafter') ||
      name.startsWith('Plate')
    ) {
      layers.roofFraming.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.category = 'Timber Roof Framing';
    } else if (
      name.startsWith('Fascia') ||
      name.startsWith('HipCap') ||
      name.startsWith('RoofCap') ||
      name === 'Hip Roof' ||
      name.includes('RoofSurface')
    ) {
      layers.roofSurface.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.category = 'Roof Cladding & Cap';
    } else if (
      name.startsWith('IntWall_') ||
      name.startsWith('RoomDiv_') ||
      name === 'Walls' ||
      name.startsWith('Mesh_')
    ) {
      layers.groundWalls.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.category = 'Ground Floor Partition';
    } else if (
      name.startsWith('FF_IntWall_') ||
      name === 'FF_Floor' ||
      name.startsWith('FF_Mesh_')
    ) {
      layers.firstFloor.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.category = 'First Floor Structure';
    } else if (name === 'Floor') {
      layers.floor.push(child);
      child.castShadow = false;
      child.receiveShadow = true;
      child.userData.category = 'Floor Slab';
    } else if (name === 'A Block' || name === 'B Block' || name === 'C Block') {
      layers.buildingBlocks.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.category = 'Building Wing / Massing';
    } else if ((name.startsWith('Rm_') && name.includes('Lbl')) || name.startsWith('Rm_sub')) {
      layers.roomLabels.push(child);
      child.userData.category = 'Room Identifier Label';
    } else {
      layers.groundWalls.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.category = 'Architectural Element';
    }

    // Apply default hidden state
    for (const layerKey of defaultHiddenLayers) {
      if (layers[layerKey].includes(child)) {
        child.visible = false;
      }
    }
  });
}

// --- Smooth Camera Transitions ---
function transitionCameraTo(endPos, endTarget) {
  cameraStartPos.copy(camera.position);
  cameraEndPos.copy(endPos);
  targetStart.copy(controls.target);
  targetEnd.copy(endTarget);
  animStartTime = performance.now();
  isAnimatingCamera = true;
}

function updateCameraAnimation(now) {
  if (!isAnimatingCamera) return;

  const elapsed = now - animStartTime;
  let progress = Math.min(elapsed / animDuration, 1);

  // Smooth ease-in-out curve
  const ease = progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;

  camera.position.lerpVectors(cameraStartPos, cameraEndPos, ease);
  controls.target.lerpVectors(targetStart, targetEnd, ease);

  if (progress >= 1) {
    isAnimatingCamera = false;
  }
}

// --- UI Binding & Event Listeners ---
function setupUI() {
  // Layer Toggles
  const layerBindings = [
    { id: 'layer-satellite', key: 'satellite', items: layers.satellite },
    { id: 'layer-roof-framing', key: 'roofFraming', items: layers.roofFraming },
    { id: 'layer-roof-surface', key: 'roofSurface', items: layers.roofSurface },
    { id: 'layer-ground-walls', key: 'groundWalls', items: layers.groundWalls },
    { id: 'layer-first-floor', key: 'firstFloor', items: layers.firstFloor },
    { id: 'layer-floor', key: 'floor', items: layers.floor },
    { id: 'layer-building-blocks', key: 'buildingBlocks', items: layers.buildingBlocks },
    { id: 'layer-room-labels', key: 'roomLabels', items: layers.roomLabels }
  ];

  // Sync checkbox state with default hidden layers
  layerBindings.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (el && defaultHiddenLayers.includes(key)) {
      el.checked = false;
    }
  });

  layerBindings.forEach(({ id, items }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      items.forEach((mesh) => {
        mesh.visible = e.target.checked;
      });
    });
  });

  // Toggle All Layers Button
  const toggleAllBtn = document.getElementById('toggle-all-layers-btn');
  let allOn = true;
  toggleAllBtn.addEventListener('click', () => {
    allOn = !allOn;
    toggleAllBtn.innerText = allOn ? 'All On' : 'All Off';
    layerBindings.forEach(({ id, items }) => {
      const el = document.getElementById(id);
      if (el) el.checked = allOn;
      items.forEach((mesh) => (mesh.visible = allOn));
    });
  });

  // Camera Presets
  const camButtons = document.querySelectorAll('.cam-btn');
  function setActiveCamBtn(btn) {
    camButtons.forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }

  // 1. Isometric
  document.getElementById('cam-isometric')?.addEventListener('click', (e) => {
    setActiveCamBtn(e.currentTarget);
    const target = initialTarget.clone();
    const pos = target.clone().add(new THREE.Vector3(75, 60, 75));
    transitionCameraTo(pos, target);
  });

  // 2. Satellite Top-Down
  document.getElementById('cam-satellite')?.addEventListener('click', (e) => {
    setActiveCamBtn(e.currentTarget);
    const target = initialTarget.clone();
    const pos = target.clone().add(new THREE.Vector3(0.01, 140, 0));
    transitionCameraTo(pos, target);
  });

  // 3. Roof Framing Inspection
  document.getElementById('cam-roof')?.addEventListener('click', (e) => {
    setActiveCamBtn(e.currentTarget);
    // Find roof center or average rafter location
    const target = new THREE.Vector3(8, 3.5, -20);
    const pos = new THREE.Vector3(18, 14, -6);
    transitionCameraTo(pos, target);
  });

  // 4. Street View / Eye Level
  document.getElementById('cam-street')?.addEventListener('click', (e) => {
    setActiveCamBtn(e.currentTarget);
    const target = new THREE.Vector3(8, 2, -15);
    const pos = new THREE.Vector3(-15, 2.5, -35);
    transitionCameraTo(pos, target);
  });

  // Viewport Tools
  // Wireframe
  const wireframeBtn = document.getElementById('tool-wireframe');
  wireframeBtn?.addEventListener('click', () => {
    isWireframe = !isWireframe;
    wireframeBtn.classList.toggle('active', isWireframe);
    if (!modelRoot) return;
    modelRoot.traverse((child) => {
      if (child.isMesh && child.material && !child.name.includes('GOOGLE_SAT_WM') && !child.name.includes('GroundSurface')) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => (m.wireframe = isWireframe));
        } else {
          child.material.wireframe = isWireframe;
        }
      }
    });
  });

  // Sun / Shadows Toggle
  const sunBtn = document.getElementById('tool-sun');
  sunBtn?.addEventListener('click', () => {
    shadowsEnabled = !shadowsEnabled;
    sunBtn.classList.toggle('active', shadowsEnabled);
    renderer.shadowMap.enabled = shadowsEnabled;
    directionalLight.castShadow = shadowsEnabled;
    if (modelRoot) {
      modelRoot.traverse((child) => {
        if (child.isMesh && child.material) child.material.needsUpdate = true;
      });
    }
  });

  // Reset Camera
  document.getElementById('tool-reset')?.addEventListener('click', () => {
    setActiveCamBtn(document.getElementById('cam-isometric'));
    transitionCameraTo(initialCameraPos, initialTarget);
  });

  // Fullscreen Toggle
  document.getElementById('tool-fullscreen')?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Inspector Close Button
  document.getElementById('insp-close-btn')?.addEventListener('click', () => {
    document.getElementById('inspector-card')?.classList.remove('visible');
    deselectMesh();
  });
}

// --- Raycasting & Inspector ---
function setupEventListeners() {
  window.addEventListener('resize', onWindowResize);

  container.addEventListener('pointerdown', (e) => {
    if (e.target !== renderer.domElement) return;
    pointerDownPos.x = e.clientX;
    pointerDownPos.y = e.clientY;
    pointerDownTime = performance.now();
  });

  container.addEventListener('pointerup', (e) => {
    if (e.target !== renderer.domElement) return;
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = performance.now() - pointerDownTime;

    // If dragged to orbit/pan (> 5px) or held longer than 500ms, do NOT trigger inspection
    if (dist > 5 || duration > 500) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
      // Find first valid mesh that is visible and NOT the satellite map or selection box
      const hit = intersects.find((i) =>
        i.object.isMesh &&
        i.object.visible &&
        !i.object.name.includes('GOOGLE_SAT_WM') &&
        !i.object.name.includes('GroundSurface') &&
        i.object !== selectionBox
      );

      if (hit) {
        inspectMesh(hit.object);
      } else {
        deselectMesh();
        document.getElementById('inspector-card')?.classList.remove('visible');
      }
    } else {
      deselectMesh();
      document.getElementById('inspector-card')?.classList.remove('visible');
    }
  });
}

function inspectMesh(mesh) {
  deselectMesh();

  selectedMesh = mesh;

  // Highlight using an architectural cyan wireframe BoxHelper instead of replacing materials
  if (!selectionBox) {
    selectionBox = new THREE.BoxHelper(mesh, 0x00f2fe);
    selectionBox.material.depthTest = false;
    selectionBox.material.transparent = true;
    selectionBox.material.opacity = 0.9;
    scene.add(selectionBox);
  } else {
    selectionBox.setFromObject(mesh);
    selectionBox.visible = true;
  }

  const card = document.getElementById('inspector-card');
  const nameEl = document.getElementById('insp-name');
  const catEl = document.getElementById('insp-category');
  const typeEl = document.getElementById('insp-type');
  const posEl = document.getElementById('insp-pos');
  const dimEl = document.getElementById('insp-dim');
  const vertsEl = document.getElementById('insp-verts');

  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const pos = mesh.getWorldPosition(new THREE.Vector3());
  const vertCount = mesh.geometry?.attributes?.position?.count || 0;

  nameEl.innerText = mesh.name || 'Unnamed Mesh';
  catEl.innerText = mesh.userData.category || 'Architecture';
  typeEl.innerText = mesh.name.split('.')[0] || 'Mesh';
  posEl.innerText = `X: ${pos.x.toFixed(2)}, Y: ${pos.y.toFixed(2)}, Z: ${pos.z.toFixed(2)}`;
  dimEl.innerText = `${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m`;
  vertsEl.innerText = vertCount.toLocaleString();

  card.classList.add('visible');
}

function deselectMesh() {
  selectedMesh = null;
  if (selectionBox) {
    selectionBox.visible = false;
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// --- Animation Render Loop ---
function animate(now = 0) {
  requestAnimationFrame(animate);

  updateCameraAnimation(now);
  controls.update();

  if (selectionBox && selectedMesh && selectionBox.visible) {
    selectionBox.update();
  }

  renderer.render(scene, camera);
}

// Start app
init();
