# Copilot / AI Agent Instructions — JME (Junction Modeller Expanded)

This file contains concise, repository-specific guidance to help an AI coding agent be productive immediately.

Principles
- Keep changes minimal and consistent with existing code style (Next.js + TypeScript + R3F).
- Preserve explicit Three.js resource management (dispose geometry/materials when removing meshes).

Key places to look
- `src/app/context/JModellerContext.tsx`: central state provider. Use `registerJunctionObject` / `unregisterJunctionObject` when adding/removing Three.js groups.
- `src/app/components/Scene.tsx`: R3F scene setup and where the provider state is used.
- `src/app/components/ThickLine.tsx`: canonical pattern for high-performance lines using `three/addons/lines/Line2`, `LineGeometry`, and `LineMaterial`. Note `material.resolution` must be set from `useThree().size`.
- `src/app/components/RoundaboutComponent.tsx` and `IntersectionComponent.tsx`: examples of building geometry in `useMemo` and rendering meshes/lines.
- `public/models/` and `public/textures/`: static assets (MTL/OBJ/texture files) live here; prefer referencing via Next.js `public` path.
- `src/app/includes/types/` and `src/app/includes/defaults.ts`: canonical types and default config values for junction objects.

Build / run / lint
- Dev server: `npm run dev` (Next.js app router, uses `--turbopack`).
- Build: `npm run build`.
- Start production: `npm run start`.
- Lint: `npm run lint`.

Project-specific conventions and patterns
- Provider-first: The `JModellerProvider` wraps the UI and R3F scene (see `src/app/page.tsx`). Any component that manipulates or registers junction objects should call `useJModellerContext()`.
- Registration pattern: Components should call `registerJunctionObject(groupRef.current)` once their `THREE.Group` has a `userData.id` set. Unregistering should call `unregisterJunctionObject(group)` and the context will dispose geometries/materials using `group.traverse(...)`.
- userData shape: code expects `group.userData.id` and sometimes `group.userData.maxDistanceToStopLine` and `group.userData.exitInfo`. Respect these keys when creating junction objects.
- Geometry creation: Heavy Three.js geometry/material creation is done in React `useMemo` or `useEffect` to avoid recreating on every render (see `RoundaboutComponent.tsx` and `ThickLine.tsx`). Follow that pattern.
- Line rendering: Use `Line2` + `LineGeometry` + `LineMaterial` (three addons) for wide lines; set `material.resolution.set(size.width, size.height)` and call `line.computeLineDistances()` when using dashed lines.
- Disposal: When removing objects, dispose geometry and material(s). `JModellerContext.unregisterJunctionObject` shows the canonical traversal-and-dispose pattern — replicate it if you add other object types.

Integration notes & gotchas observed (useful for edits)
- Roundabout naming mismatch: `RoundaboutComponent` memo returns `floorCircle` but a mesh uses `roundaboutFloor` (naming mismatch). Watch for similar typos when editing.
- Use `crypto.randomUUID()` for stable IDs when creating new junction structures (existing code uses this pattern).
- The project uses `@react-three/fiber` + `@react-three/drei` + `three` — prefer adding Three resources via R3F patterns (hooks/effects) to keep the render loop stable.
- When adding UI or controls, maintain `"use client"` at top of client-side React components.

Examples (copyable patterns)
- Registering an object (component):
  - Ensure `groupRef.current.userData.id = <id>` before calling `registerJunctionObject(groupRef.current)`.

- Safe dispose pattern (from context):
  - group.traverse((obj:any) => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); Array.isArray(obj.material) ? obj.material.forEach(m => m.dispose()) : obj.material?.dispose(); } });

When to run tests / checks
- There are no automated tests in the repo. Run `npm run dev` and check the browser console for runtime errors after code edits, especially Three.js disposal errors or missing imports.

If you edit or add files
- Keep changes narrowly scoped to the affected component or context. Update types in `src/app/includes/types/` if you add new `userData` fields or config properties.
- Search for usages of `registerJunctionObject`, `unregisterJunctionObject`, and `junctionObjectRefs` to find integration points to update.

Questions for the author (include when uncertain)
- Should `RoundaboutComponent` export the floor geometry property as `roundaboutFloor` (current mesh) or `floorCircle` (current memo)?
- Are there preferred ID namespaces or conventions beyond `crypto.randomUUID()` (e.g., predictable IDs for tests)?

If anything important is missing here, tell me what to inspect next (types, loaders, or specific components) and I will update this file.
