"use client";

import { OrbitControls, Line } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { MTLLoader, OBJLoader } from "three-stdlib";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import { useJModellerContext } from "../context/JModellerContext";
import { FLOOR_Y } from "../includes/defaults";
import * as THREE from "three";
import { JunctionComponents } from "./JunctionComponents";
import { generateAllRoutes } from "../includes/carRouting";

export default function Scene() {
  const { selectedObjects, junction, simIsRunning, junctionObjectRefs } = useJModellerContext();
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const [debugRoutePts, setDebugRoutePts] = useState<[number, number, number][]>([]);
  const [routeIndex, setRouteIndex] = useState(0);

  const routesRef = useRef<{ points: [number, number, number][] }[]>([]);

  // ---- Car model refs ----
  const carProtoRef = useRef<THREE.Group | null>(null);
  const carRef = useRef<THREE.Group | null>(null);
  const [carReady, setCarReady] = useState(false);

  // ---- Curve animation refs ----
  const curveRef = useRef<THREE.CatmullRomCurve3 | null>(null);
  const curveLenRef = useRef(1); // cache curve length
  const tRef = useRef(0);
  const routeIndexRef = useRef(0);
  const advancingRef = useRef(false);

  const tmpPos = useRef(new THREE.Vector3());
  const tmpTan = useRef(new THREE.Vector3());

  function pointsToCatmullCurve(points: [number, number, number][], closed = false) {
    const vectors = points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(vectors, closed);
    curve.curveType = "centripetal";

    // more divisions if you have long / detailed routes (helps constant-speed feel)
    curve.arcLengthDivisions = Math.max(2000, vectors.length * 50);

    // important: refresh internal arc-length table
    curve.updateArcLengths();
    return curve;
  }

  function dedupePoints(pts: [number, number, number][], eps = 1e-3) {
    const out: [number, number, number][] = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last) {
        out.push(p);
        continue;
      }
      const dx = p[0] - last[0];
      const dy = p[1] - last[1];
      const dz = p[2] - last[2];
      if (dx * dx + dy * dy + dz * dz > eps * eps) out.push(p);
    }
    return out;
  }

  async function loadCarOBJMTL(objUrl: string, mtlUrl: string) {
    const mtl = await new Promise<THREE.MaterialCreator>((resolve, reject) => {
      new MTLLoader().load(mtlUrl, resolve, undefined, reject);
    });
    mtl.preload();

    const obj = await new Promise<THREE.Group>((resolve, reject) => {
      const loader = new OBJLoader();
      loader.setMaterials(mtl);
      loader.load(objUrl, resolve, undefined, reject);
    });

    obj.traverse((o) => {
      if ((o as any).isMesh) {
        const m = o as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });

    return obj;
  }

  const setActiveRoute = useCallback((idx: number) => {
    const routes = routesRef.current;
    if (!routes.length) return;

    const clamped = ((idx % routes.length) + routes.length) % routes.length;
    routeIndexRef.current = clamped;

    // Fix B: build a curve, then resample it to uniform spacing
    const rawPts = dedupePoints(routes[clamped].points ?? []);
    if (rawPts.length < 2) {
      if (routes.length > 1) setActiveRoute(clamped + 1);
      return;
    }

    // 1) build initial curve from raw points
    const baseCurve = pointsToCatmullCurve(rawPts, false);

    // 2) resample to evenly spaced points (key part of Fix B)
    // choose number of samples based on curve length
    const baseLen = baseCurve.getLength();
    const spacing = 0.35; // metres between samples (tweak)
    const sampleCount = Math.max(50, Math.ceil(baseLen / spacing));
    const spaced = baseCurve.getSpacedPoints(sampleCount);

    // 3) rebuild a new curve from spaced points (smoother, uniform parameterisation)
    const uniformCurve = new THREE.CatmullRomCurve3(spaced, false);
    uniformCurve.curveType = "centripetal";
    uniformCurve.arcLengthDivisions = Math.max(4000, sampleCount * 10);
    uniformCurve.updateArcLengths();

    curveRef.current = uniformCurve;
    curveLenRef.current = uniformCurve.getLength();

    // reset progress
    tRef.current = 0;

    // Debug visuals: show the original raw route points (or swap to spaced if preferred)
    setRouteIndex(clamped);
    setDebugRoutePts(rawPts);

    // snap car to start immediately
    const car = carRef.current;
    const curve = curveRef.current;
    if (car && curve) {
      const p0 = curve.getPointAt(0);
      const t0 = curve.getTangentAt(0);
      car.position.copy(p0);
      car.position.y += 0.02;
      car.lookAt(p0.clone().add(t0));
    }
  }, []);

  const debugCurveDrawPts = useMemo(() => {
    if (debugRoutePts.length < 2) return [];
    const curve = pointsToCatmullCurve(debugRoutePts, false);
    return curve.getPoints(300).map(v => [v.x, v.y + 0.05, v.z] as [number, number, number]);
  }, [debugRoutePts]);

  /** Generate routes + load car when sim starts */
  useEffect(() => {
    let cancelled = false;

    if (!simIsRunning) {
      routesRef.current = [];
      setDebugRoutePts([]);
      setRouteIndex(0);

      curveRef.current = null;
      curveLenRef.current = 1;
      tRef.current = 0;
      routeIndexRef.current = 0;
      advancingRef.current = false;

      carProtoRef.current = null;
      carRef.current = null;
      setCarReady(false);
      return;
    }

    // Generate routes
    const { routes } = generateAllRoutes(junction, junctionObjectRefs.current, {
      maxSteps: 25,
      disallowUTurn: true,
    });

    routesRef.current = routes ?? [];
    if (!routesRef.current.length) return;

    // Load car prototype
    (async () => {
      try {
        const proto = await loadCarOBJMTL("/models/car-station-red.obj", "/models/car-station-red.mtl");
        if (cancelled) return;

        // scale/orient as needed
        proto.scale.setScalar(1);
        proto.rotation.y = Math.PI;

        // Center pivot for lookAt stability
        proto.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(proto);
        const center = new THREE.Vector3();
        box.getCenter(center);
        proto.position.sub(center);

        carProtoRef.current = proto;

        const instance = proto.clone(true);
        instance.traverse((o) => {
          if ((o as any).isMesh) {
            const m = o as THREE.Mesh;
            m.material = (m.material as THREE.Material).clone();
          }
        });

        carRef.current = instance;
        setCarReady(true);

        // set first route now that we have a car
        setActiveRoute(0);
      } catch (e) {
        console.error("Failed to load car OBJ/MTL", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [simIsRunning, junction, junctionObjectRefs, setActiveRoute]);

  /** Animate the car along the active curve */
  useFrame((_, delta) => {
    if (!simIsRunning) return;
    const curve = curveRef.current;
    const car = carRef.current;
    if (!curve || !car) return;

    if (advancingRef.current) return;

    const L = curveLenRef.current;

    if (L < 0.2) {
      advancingRef.current = true;
      setActiveRoute(routeIndexRef.current + 1);
      advancingRef.current = false;
      return;
    }

    // Constant speed in metres/second (Fix B + normalization)
    const speedMps = 20; // tweak
    const speedTPerSec = speedMps / L;

    tRef.current += speedTPerSec * delta;

    if (tRef.current >= 1) {
      advancingRef.current = true;
      setActiveRoute(routeIndexRef.current + 1);
      advancingRef.current = false;
      return;
    }

    const t = tRef.current;
    curve.getPointAt(t, tmpPos.current);
    curve.getTangentAt(t, tmpTan.current);

    car.position.copy(tmpPos.current);
    car.position.y += 0.02;

    const lookAt = tmpPos.current.clone().add(tmpTan.current);
    car.lookAt(lookAt);
  });

  return (
    <>
      <axesHelper args={[50]} />
      <fog attach="fog" args={["#0a0a0a", 100, 250]} />

      <ambientLight intensity={1} />
      <directionalLight position={[20, 50, 20]} intensity={0.6} />
      <pointLight position={[0, 5, 0]} intensity={2} color="#ffaa00" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 1, 0]} receiveShadow>
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color="#1c1c1c" />
      </mesh>

      <EffectComposer>
        <Bloom intensity={1.5} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
      </EffectComposer>

      <OrbitControls
        enabled={selectedObjects.length === 0}
        ref={controlsRef}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={5}
        maxDistance={200}
      />

      {debugCurveDrawPts.length > 1 && <Line points={debugCurveDrawPts} color="red" lineWidth={2} />}

      {debugRoutePts.map(([x, y, z], i) => (
        <mesh key={i} position={[x, y + 0.08, z]}>
          <sphereGeometry args={[0.15, 10, 10]} />
          <meshBasicMaterial />
        </mesh>
      ))}

      {/* Moving car */}
      {simIsRunning && carReady && carRef.current && <primitive object={carRef.current} />}

      <JunctionComponents />
    </>
  );
}
