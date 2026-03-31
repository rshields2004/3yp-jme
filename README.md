# JME - Junction Modeller Expanded

A 3D traffic simulation platform for designing, analysing, and visualising junction networks. Build intersections and roundabouts, connect them with road links, run realistic traffic simulations, and evaluate performance with industry-standard metrics - all in the browser.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![Three.js](https://img.shields.io/badge/Three.js-0.182-black?logo=three.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![PeerJS](https://img.shields.io/badge/PeerJS-P2P-green)
[![Documentation](https://img.shields.io/badge/API%20Docs-TypeDoc-3178c6)](https://rshields.xyz/docs/index.html)
---

## Table of Contents

- [Getting Started](#getting-started)
- [Modes](#modes)
- [Building Junctions](#building-junctions)
- [Linking Exits](#linking-exits)
- [Simulation](#simulation)
- [Traffic Controllers](#traffic-controllers)
- [Statistics & Metrics](#statistics--metrics)
- [PDF Reports](#pdf-reports)
- [Save & Load](#save--load)
- [Multiplayer (P2P)](#multiplayer-p2p)
- [Tutorial](#tutorial)
- [Camera Controls](#camera-controls)
- [Car Classes](#car-classes)
- [Simulation Config Reference](#simulation-config-reference)

---

## Getting Started

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Production build
npm run build
npm run start
```

Open `http://localhost:3000` in a modern browser.

---

## Modes

| Mode | Description |
|------|-------------|
| **View** | Free-orbit 3D camera. Watch simulations, follow vehicles in first-person, and inspect statistics. |
| **Build** | Top-down orthographic view. Place junction objects, drag to position, configure exits, and create links. |

Switch between modes using the **Modes** dropdown in the header.

---

## Building Junctions

### Intersection (Traffic-Light Controlled)

- Polygonal junction body with configurable exit arms (3–6 exits).
- Traffic light phases cycle through GREEN → AMBER → RED-AMBER → RED for each arm.
- Vehicles obey stop lines, respect signal colours, and detect queue build-up.

### Roundabout (Give-Way Controlled)

- Circular island with radiating exit arms (3–6 exits).
- Vehicles give way to ring traffic, enter when a safe gap is detected, and exit from the ring.
- Includes timeout-based forced entry to prevent infinite queueing.

### Per-Exit Configuration

Each exit can be individually tuned:

| Option | Range | Description |
|--------|-------|-------------|
| Num Lanes In | 1–3 | Inbound lanes entering the junction |
| Lane Count | 1–4 | Outbound lanes leaving the junction |
| Exit Length | 10–60 | Length of the exit arm (world units) |
| Spawn Rate | - | Optional per-exit spawn rate override |

Select a junction object by double-clicking it in Build mode to open the **Selection Panel** with these options.

---

## Linking Exits

1. In **Build mode**, click on an exit of one junction - it highlights red.
2. Click an exit on a different junction.
3. Press the **Link Exits** button that appears in the header.

Links are bidirectional. Vehicles can traverse them in either direction. They are rendered as Bézier curves with solid and dashed lane markings matching lane configuration.

---

## Simulation

Press the **Confirm** button to lock your layout, then press **Play** to start the simulation.

### Vehicle Spawning

- Vehicles spawn at entry exits based on the global spawn rate (default 0.5 vehicles/second).
- Demand is distributed across available routes and balanced by per-entry spawn queues.
- Per-exit spawn rate overrides are supported.

### Vehicle Physics

Vehicles follow the **Intelligent Driver Model (IDM)** with:

- Smooth acceleration and deceleration curves per car class.
- Leader-follower spacing with configurable bumper gap and time headway.
- Comfort braking and emergency braking thresholds.
- Speed adaptation near stop lines and junctions.

### Simulation Controls

| Button | Action |
|--------|--------|
| Play | Start simulation |
| Pause | Pause (vehicles freeze in place) |
| Stop | Halt and reset simulation |

---

## Traffic Controllers

### Intersection Controller

| Parameter | Default | Description |
|-----------|---------|-------------|
| Green Time | 8 s | Duration of green phase per arm |
| Amber Time | 1 s | Warning phase before red |
| Red-Amber Time | 1 s | Transition phase before green |
| All-Red Time | 2 s | Safety gap between phase changes |

### Roundabout Controller

| Parameter | Default | Description |
|-----------|---------|-------------|
| Min Gap | 2 m | Minimum distance on ring for safe entry |
| Min Time Gap | 1.5 s | Time since last vehicle exited ring |
| Safe Entry Distance | 20 m | Look-ahead distance for gap detection |
| Entry Timeout | 1.0 s | Force entry after this queue wait |
| Min Angular Separation | 30° | Vehicles must be spaced at least this far apart on the ring |

---

## Statistics & Metrics

Real-time statistics are available in the **Stats** panel and the popout statistics window.

### Per-Junction Metrics

| Metric | Description |
|--------|-------------|
| Approaching | Vehicles on approach segments |
| Waiting | Vehicles stopped at stop lines |
| Inside | Vehicles currently crossing the junction |
| Exiting | Vehicles on exit segments |
| Entered / Exited | Cumulative flow counters |
| Avg Wait Time | Mean delay per vehicle (seconds) |
| Max Wait Time | Longest individual delay recorded |
| Max Queue Length | Peak queue depth observed |
| Throughput | Vehicles per minute |
| **DoS** | Degree of Saturation - demand ÷ capacity ratio |
| **PRC** | Practical Reserve Capacity - how much additional traffic the junction can handle (%) |
| **MMQ** | Mean Maximum Queue - average of per-arm peak queues |
| **LOS** | Level of Service - HCM-based A–F grade |

### Level of Service Thresholds

| Grade | Signalised (s) | Roundabout (s) | Interpretation |
|-------|---------------|----------------|----------------|
| A | ≤ 10 | ≤ 10 | Free flow |
| B | ≤ 20 | ≤ 15 | Stable flow |
| C | ≤ 35 | ≤ 25 | Stable, acceptable delays |
| D | ≤ 55 | ≤ 35 | Approaching instability |
| E | ≤ 80 | ≤ 50 | Unstable flow |
| F | > 80 | > 50 | Forced / breakdown |

### Global Aggregates

Throughput, Avg Wait, Max Queue, PRC, and MMQ are also computed network-wide across all junctions.

---

## PDF Reports

Click the **Report** button (available after stopping a simulation that has recorded data) to generate a 3-page landscape A4 PDF:

| Page | Content |
|------|---------|
| **1 - Junction Diagram** | High-resolution rendered diagram of your layout with numbered exits, lane markings, link curves, and a colour-coded legend. |
| **2 - Configuration** | Global settings, per-object exit/lane tables, spawning & motion parameters, controller timings, and car class weights. Overflows to additional pages if needed. |
| **3 - Simulation Summary** | Overview tiles (spawned, completed, elapsed, avg speed, avg travel time), all-junction aggregate table, and per-junction breakdown with DoS, PRC, MMQ, and LOS pills. Overflows to additional pages for large networks. |

---

## Save & Load

### Saving

Click the **Download** button to export your junction layout and simulation configuration as a `.jme` JSON file.

The save file contains:

- All junction objects (type, position, exit configuration)
- All links between exits
- Full simulation config (spawn rates, vehicle physics, controller timings, car class overrides)

### Loading

Click the **Upload** button and select a `.jme` file. The current layout is replaced with the saved configuration. You can immediately confirm and run a simulation.

---

## Multiplayer (P2P)

JME supports real-time peer-to-peer collaboration via WebRTC (PeerJS).

> **Note:** P2P works out of the box over a **local network (LAN)**. For connections across the internet, you will need to configure **port forwarding** and set up a **TURN server** and **PeerJS signalling server**.

### Hosting

1. Open the **Session** dropdown.
2. Click **Create Host** - a 6-digit connection code is generated.
3. Share the code with others.

### Joining

1. Open the **Session** dropdown.
2. Enter the host's 6-digit code and click **Join**.
3. The host's junction layout and simulation config are synced automatically.

### How It Works

- The **host** controls the layout and simulation (start, pause, stop).
- **Clients** receive real-time updates and can observe but not modify the configuration.
- Connection status and latency are shown in the Session panel.
- Disconnect at any time using the exit button.

---

## Tutorial

Click the **? Tutorial** button to start an interactive 21-step guided walkthrough that covers:

1. Switching to Build mode
2. Adding an intersection and a roundabout
3. Positioning objects by dragging
4. Configuring exits and lanes
5. Linking two junctions together
6. Confirming the layout
7. Adjusting simulation parameters
8. Running the simulation
9. Stopping the simulation
10. Downloading a save file
11. Generating a PDF report

Each step highlights the relevant UI element and auto-advances when you complete the required action. Starting the tutorial resets the workspace to a clean state.

---

## Camera Controls

### View Mode

| Control | Action |
|---------|--------|
| Left-click drag | Orbit around scene |
| Right-click drag | Pan |
| Scroll wheel | Zoom in/out |
| Double-click junction | Centre and zoom to that object |
| Click a vehicle (during sim) | Follow in first-person view |
| Backspace | Exit first-person view |

### Build Mode

| Control | Action |
|---------|--------|
| Scroll wheel | Zoom (height adjustment) |
| Left-click drag on object | Move junction |
| Double-click object | Open config panel |
| Click exit arm | Select exit (for linking) |

The default camera position is an isometric view at (20, 35, 20) with a 60° field of view.

---

## Car Classes

Vehicles are rendered as 3D models with 12 body types and 7 colour variants. Each class has distinct physical characteristics:

| Class | Length (m) | Speed | Accel | Default Weight |
|-------|-----------|-------|-------|----------------|
| Normal | 1.82 | 1.00× | 1.00× | 25 |
| Hatchback | 1.81 | 1.00× | 1.00× | 20 |
| Coupe | 1.99 | 1.10× | 1.15× | 10 |
| Station | 2.10 | 1.00× | 0.95× | 10 |
| MPV | 2.00 | 0.95× | 0.90× | 8 |
| Pickup | 1.97 | 0.95× | 0.85× | 6 |
| Pickup (Small) | 1.92 | 0.95× | 0.90× | 6 |
| Minibus | 2.16 | 0.90× | 0.75× | 5 |
| Micro | 1.42 | 0.85× | 1.05× | 5 |
| Microcargo | 1.82 | 0.80× | 0.90× | 3 |
| Microtransport | 1.82 | 0.80× | 0.85× | 3 |
| Van | 2.16 | 0.85× | 0.70× | 3 |

**Weight** determines spawn probability - higher weight = more common. All classes can be individually enabled/disabled and their speed, acceleration, deceleration, and weight overridden in the Sim Config panel.

**Colours:** Blue, Citrus, Green, Orange, Red, Silver, Violet (randomly assigned at spawn).

---

## Simulation Config Reference

All parameters are adjustable in the **Sim Config** dropdown.

### Spawning

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Spawn Rate | 0.5 v/s | 0–5 | Vehicles per second per entry |
| Max Vehicles | 100 | 10–500 | Simultaneous vehicle limit |
| Max Spawn Queue | 25 | - | Per-entry demand cap |
| Max Spawn Attempts/Frame | 20 | - | Spawn loop limit |

### Motion

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Preferred Speed | 10 m/s | 1–30 | Target cruising speed |
| Max Acceleration | 4 m/s² | 0.5–15 | Acceleration cap |
| Max Deceleration | 8 m/s² | 0.5–15 | Emergency braking cap |
| Comfort Deceleration | 4 m/s² | - | Preferred smooth braking |

### Spacing

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Min Bumper Gap | 0.5 m | 0–5 | Safety distance between vehicles |
| Time Headway | 0.5 s | 0.1–5 | Speed-proportional following distance |
| Stop Line Offset | 0.01 m | 0–2 | Where vehicles stop relative to lines |

### Seed

| Parameter | Default | Description |
|-----------|---------|-------------|
| Sim Seed | `"default"` | String seed for deterministic, reproducible simulations |

---

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **React 19** + **TypeScript 5**
- **Three.js** + **React Three Fiber** + **Drei** (3D rendering)
- **PeerJS** (WebRTC peer-to-peer networking)
- **jsPDF** (PDF report generation)
- **Tailwind CSS 4** + **shadcn/ui** (interface components)
- **Lucide React** (icons)

