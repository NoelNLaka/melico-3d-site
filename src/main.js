import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// --- State & References ---
const container = document.getElementById('canvas-container');
let scene, camera, renderer, controls;
let modelRoot = null;
let buildingBox = null;   // bounding box of the building only (excludes the GIS terrain)
let directionalLight, ambientLight, hemisphereLight;
let initialCameraPos, initialTarget;
let isWireframe = false;
let shadowsEnabled = true;

// Classification Layers
const layers = {
  satellite: [],
  roofFraming: [],
  roofSurface: [],
  tanks: [],
  stairs: [],
  groundWalls: [],
  firstFloor: [],
  fence: [],
  floor: [],
  buildingBlocks: [],
  grid: [],
  roomLabels: []
};

// Layers hidden by default
const defaultHiddenLayers = ['roomLabels', 'grid'];

// Assigned in setupUI(); re-run once the GLB has loaded and been classified,
// since setupUI() runs before the async load resolves.
let refreshLayerCounts = () => {};

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

  // Geometry in melico_site.glb is Draco-compressed (keeps the download ~2 MB)
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('./draco/');
  loader.setDRACOLoader(dracoLoader);

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
      refreshLayerCounts();

      scene.add(modelRoot);
      modelRoot.updateMatrixWorld(true);

      // Bounding box of the building itself (everything except the GIS terrain)
      buildingBox = new THREE.Box3();
      modelRoot.traverse((child) => {
        if (child.isMesh && !layers.satellite.includes(child)) {
          buildingBox.expandByObject(child);
        }
      });

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

    // GLTFLoader passes node names through PropertyBinding.sanitizeNodeName(),
    // which replaces whitespace with '_' ("Common Rafter" -> "Common_Rafter").
    // Normalise here so the rules below match regardless of which form is used.
    const name = child.name.replace(/\s/g, '_');

    // Enhance materials for PBR appearance
    if (child.material) {
      child.material.side = THREE.DoubleSide;
      child.material.roughness = Math.max(child.material.roughness || 0.5, 0.4);
    }

    // Completely destroy and remove GroundSurface so it never renders or covers the Google Earth surface
    if (name.includes('GroundSurface') || name.includes('groundSurfaceGroup')) {
      child.visible = false;
      if (child.parent) {
        child.parent.remove(child);
      }
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
      return;
    }

    // Classify into functional layer
    if (name.includes('GOOGLE_SAT_WM')) {
      layers.satellite.push(child);
      child.receiveShadow = true;
      child.castShadow = false;
      child.userData.category = 'GIS Satellite Terrain';
      child.renderOrder = 1;

      // Apply polygonOffset to satellite terrain so it always renders
      // cleanly on top of any foundation/slab below it on mobile and desktop GPUs
      if (child.isMesh && child.material) {
        const applyOffset = (mat) => {
          mat.polygonOffset = true;
          mat.polygonOffsetFactor = -1;
          mat.polygonOffsetUnits = -1;
          mat.depthWrite = true;
        };
        if (Array.isArray(child.material)) {
          child.material.forEach(applyOffset);
        } else {
          applyOffset(child.material);
        }
      }
    } else if (
      name.startsWith('Common_Rafter') ||
      name.startsWith('Jack_Rafter') ||
      name.startsWith('Valley_Jack') ||
      name.startsWith('Hip_Rafter') ||
      name.startsWith('Ridge_Beam') ||
      name.startsWith('Valley_Rafter') ||
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
      name.startsWith('Roof_') ||
      name.startsWith('ValleyCap') ||
      name.startsWith('Building_Roof') ||
      name.startsWith('Under_Roof_Surface') ||
      name.startsWith('Top_Floor_Ceiling') ||
      name === 'Hip_Roof' ||
      name.includes('RoofSurface')
    ) {
      layers.roofSurface.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.category = 'Roof & Ceiling Surface';
    } else if (
      name.startsWith('Tank_') ||
      name.startsWith('Stand_') ||
      name.startsWith('Pad_')
    ) {
      layers.tanks.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.category = 'Water Tank & Stand';
    } else if (
      name.startsWith('Stair_') ||
      name.startsWith('House_Stair') ||
      name.startsWith('Steps_') ||
      name.startsWith('Landing') ||
      name.startsWith('FF_Rail') ||
      name.startsWith('GF_Rail') ||
      name.includes('Walkway') ||
      name.includes('Handrail')
    ) {
      layers.stairs.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.category = 'Stair, Walkway & Handrail';
    } else if (name.startsWith('Fence_')) {
      layers.fence.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.category = 'Boundary Fence';
    } else if (name.startsWith('Grid_')) {
      layers.grid.push(child);
      child.castShadow = false;
      child.receiveShadow = false;
      child.userData.category = 'Setting-Out Gridline';
    } else if (name.startsWith('Melico_Openings')) {
      layers.buildingBlocks.push(child);
      child.castShadow = false;
      child.receiveShadow = false;
      child.userData.category = 'Opening Outline (Window / Door / AC)';
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
      child.renderOrder = 0;
      child.userData.category = 'Floor Slab';
    } else if (name === 'A_Block' || name === 'B_Block' || name === 'C_Block') {
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
    { id: 'layer-tanks', key: 'tanks', items: layers.tanks },
    { id: 'layer-stairs', key: 'stairs', items: layers.stairs },
    { id: 'layer-fence', key: 'fence', items: layers.fence },
    { id: 'layer-ground-walls', key: 'groundWalls', items: layers.groundWalls },
    { id: 'layer-first-floor', key: 'firstFloor', items: layers.firstFloor },
    { id: 'layer-floor', key: 'floor', items: layers.floor },
    { id: 'layer-building-blocks', key: 'buildingBlocks', items: layers.buildingBlocks },
    { id: 'layer-grid', key: 'grid', items: layers.grid },
    { id: 'layer-room-labels', key: 'roomLabels', items: layers.roomLabels }
  ];

  // Live element counts on the layer rows and the header badge
  refreshLayerCounts = () => {
    let totalElements = 0;
    layerBindings.forEach(({ id, items }) => {
      const badge = document.getElementById('count-' + id.replace('layer-', ''));
      if (badge) badge.textContent = items.length;
      totalElements += items.length;
    });
    const hudElements = document.getElementById('hud-elements');
    if (hudElements) hudElements.textContent = totalElements + ' Elements';
  };
  refreshLayerCounts();

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

  // Layers Panel Collapse / Expand Controls
  const layersPanel = document.getElementById('layers-panel');
  const toggleLayersBtn = document.getElementById('btn-toggle-layers');
  const closeLayersBtn = document.getElementById('btn-close-layers');
  const panelBackdrop = document.getElementById('panel-backdrop');

  function setLayersPanelOpen(isOpen) {
    if (!layersPanel) return;
    layersPanel.classList.toggle('collapsed', !isOpen);
    if (panelBackdrop) {
      panelBackdrop.classList.toggle('active', isOpen && window.innerWidth <= 1024);
    }
  }

  toggleLayersBtn?.addEventListener('click', () => {
    const isCurrentlyCollapsed = layersPanel?.classList.contains('collapsed');
    setLayersPanelOpen(isCurrentlyCollapsed);
  });

  closeLayersBtn?.addEventListener('click', () => {
    setLayersPanelOpen(false);
  });

  panelBackdrop?.addEventListener('click', () => {
    setLayersPanelOpen(false);
  });

  // On small/medium screens (tablets & phones <= 1024px), collapse layers by default
  if (window.innerWidth <= 1024) {
    setLayersPanelOpen(false);
  }

  // Camera Presets Bar Container Toggle
  const camContainer = document.getElementById('camera-nav-container');
  const toggleCamBtn = document.getElementById('btn-toggle-cam');

  function setCamNavOpen(isOpen) {
    if (!camContainer) return;
    camContainer.classList.toggle('collapsed', !isOpen);
  }

  toggleCamBtn?.addEventListener('click', () => {
    const isCollapsed = camContainer?.classList.contains('collapsed');
    setCamNavOpen(isCollapsed);
  });

  // Camera Presets
  const camButtons = document.querySelectorAll('.cam-btn');
  function setActiveCamBtn(btn) {
    camButtons.forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    // On phones (<= 768px), minimize camera bar after choosing a preset for full view
    if (window.innerWidth <= 768) {
      setCamNavOpen(false);
    }
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

  // Helper: building-centred framing so presets stay valid if the model moves/rescales
  function buildingFrame() {
    const box = buildingBox || new THREE.Box3().setFromObject(modelRoot);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z) || 40;
    return { box, center, size, span };
  }

  // 3. Roof Framing Inspection
  document.getElementById('cam-roof')?.addEventListener('click', (e) => {
    setActiveCamBtn(e.currentTarget);
    const { box, center, span } = buildingFrame();
    const target = new THREE.Vector3(center.x, box.min.y + (box.max.y - box.min.y) * 0.7, center.z);
    const pos = new THREE.Vector3(center.x + span * 0.6, target.y + span * 0.55, center.z + span * 0.6);
    transitionCameraTo(pos, target);
  });

  // 4. Street View / Eye Level
  document.getElementById('cam-street')?.addEventListener('click', (e) => {
    setActiveCamBtn(e.currentTarget);
    const { box, center, span } = buildingFrame();
    const eyeY = box.min.y + 1.7;
    const target = new THREE.Vector3(center.x, eyeY + 1.2, center.z);
    const pos = new THREE.Vector3(center.x - span * 0.35, eyeY, center.z - span * 1.0);
    transitionCameraTo(pos, target);
  });

  // Viewport Tools
  // Clean View (Zen Mode / Hide HUD)
  const cleanViewBtn = document.getElementById('tool-clean-view');
  const restoreUiBtn = document.getElementById('btn-restore-ui');

  function setCleanView(isClean) {
    document.body.classList.toggle('ui-hidden', isClean);
  }

  cleanViewBtn?.addEventListener('click', () => {
    setCleanView(true);
  });

  restoreUiBtn?.addEventListener('click', () => {
    setCleanView(false);
  });

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
