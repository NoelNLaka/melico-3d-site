# Melico 3D Site — Interactive Architectural & GIS Terrain Viewer

An interactive, high-performance 3D web application showcasing the complete architectural site layout, timber roof framing assembly, and high-resolution Google Satellite GIS terrain from the `MelicoMAP.blend` project.

Built with **Three.js** and **Vite**, optimized for ultra-fast load times on **Vercel**.

![Melico 3D Site Preview](https://img.shields.io/badge/Status-Live%203D-00f2fe?style=for-the-badge)
![Objects](https://img.shields.io/badge/Objects-525%20Elements-4facfe?style=for-the-badge)
![Model Size](https://img.shields.io/badge/Model%20Size-7.28%20MB-10b981?style=for-the-badge)

---

## 🌟 Key Features

1. **Self-Contained 3D Model (`melico_site.glb`)**:
   - **Size**: 7.28 MB (loads in < 2 seconds on CDN).
   - **GIS Satellite Map**: Embedded 1792×1280 satellite texture with UV mapping directly onto the terrain mesh (`EXPORT_GOOGLE_SAT_WM`).
   - **Roof Framing Assembly**: Over 360 individual timber components (282 Common Rafters, 48 Jack Rafters, 16 Valley Jacks, 6 Hip Rafters, 3 Ridge Beams, and plates).
   - **Wall & Partition Layout**: Ground Floor & First Floor internal walls, room dividers, and building massing blocks (A, B, C).

2. **Interactive Controls & Glassmorphic HUD**:
   - **Layer Visibility Toggles**: Isolate Satellite Map, Timber Roof Framing, Roof Cladding, Ground Floor Walls, First Floor Slabs, Building Blocks, and Room Labels.
   - **Camera Presets**:
     - 📐 **Isometric 3D**: Elevated architectural overview.
     - 🛰️ **Satellite Map**: High-altitude top-down GIS perspective.
     - 🪵 **Roof Framing**: Close-up inspection of timber truss joints.
     - 🚶 **Street View**: Eye-level pedestrian perspective.
   - **Interactive Raycaster Inspector**: Click any beam, rafter, or wall to inspect its name, dimensions, world coordinates, and vertex count in real-time.
   - **Viewport Tools**: Wireframe mode, sun & shadow simulation toggle, camera reset, and full-screen mode.

---

## 🛠️ Tech Stack

- **3D Engine**: [Three.js](https://threejs.org/) (WebGL2 with ACESFilmicToneMapping & PCFSoftShadowMap)
- **Bundler**: [Vite](https://vitejs.dev/)
- **Styling**: Vanilla CSS3 with glassmorphic dark-mode tokens
- **Typography**: Google Fonts (*Outfit* & *JetBrains Mono*)
- **Deployment**: [Vercel](https://vercel.com/) (configured via `vercel.json`)

---

## 🚀 Local Development

### Prerequisites
- Node.js (v18 or higher)
- npm or pnpm

### Installation
```bash
# Clone the repository
git clone https://github.com/NoelNLaka/melico-3d-site.git
cd melico-3d-site

# Install dependencies
npm install

# Start local dev server
npm run dev
```
Open your browser at `http://localhost:3000` to interact with the 3D model.

### Production Build
```bash
npm run build
npm run preview
```

---

## 🌐 Deploy to Vercel

### Method 1: Via Vercel Dashboard (Recommended)
1. Go to [vercel.com/new](https://vercel.com/new).
2. Select your GitHub repository **`NoelNLaka/melico-3d-site`**.
3. Framework Preset will auto-detect as **Vite**.
4. Click **Deploy**. Vercel will build and assign your live URL (e.g. `https://melico-3d-site.vercel.app`).

### Method 2: Via Vercel CLI
```bash
npx vercel
```

---

## 📂 Project Structure

```
melico-3d-site/
├── public/
│   └── models/
│       └── melico_site.glb       # 7.28 MB self-contained binary model & textures
├── src/
│   ├── main.js                   # Three.js scene, lighting, loader & controls
│   └── style.css                 # Dark glassmorphism styling
├── index.html                    # HTML5 shell & control UI
├── package.json                  # Dependencies & npm scripts
├── vite.config.js                # Vite build configuration
├── vercel.json                   # Vercel SPA routing & asset caching rules
└── README.md                     # Documentation
```

---

## 📄 License
Private & Confidential — 22 Engineering / Noel Akal.
