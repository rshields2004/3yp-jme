"use client";

import { OrbitControls, Line } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useState, useEffect, useRef, useMemo } from "react";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
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
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    function pointsToCatmullCurve(points: [number, number, number][], closed = false) {
        const vectors = points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
        const curve = new THREE.CatmullRomCurve3(vectors, closed);
        curve.curveType = "centripetal";
        curve.arcLengthDivisions = 2000;
        return curve;
    }

    const debugCurveDrawPts = useMemo(() => {
        if (debugRoutePts.length < 2) return [];
        const curve = pointsToCatmullCurve(debugRoutePts, false);
        return curve.getPoints(300).map(v => [v.x, v.y + 0.05, v.z] as [number, number, number]);
    }, [debugRoutePts]);

    /** Generate routes once when sim starts */
    useEffect(() => {
        if (!simIsRunning) {
            routesRef.current = [];
            setDebugRoutePts([]);
            setRouteIndex(0);
            return;
        }

        const { routes } = generateAllRoutes(junction, junctionObjectRefs.current, {
            maxSteps: 25,
            disallowUTurn: true,
        });

        if (routes.length === 0) return;

        routesRef.current = routes;
        setRouteIndex(0);
        setDebugRoutePts(routes[0].points);
    }, [simIsRunning, junction, junctionObjectRefs]);

    /** Cycle routes every 1 second */
    useEffect(() => {
        if (!simIsRunning || routesRef.current.length === 0) return;

        intervalRef.current = setInterval(() => {
            setRouteIndex(prev => {
                const next = (prev + 1) % routesRef.current.length;

                console.log(
                    `Displaying route ${next + 1} / ${routesRef.current.length}`
                );

                setDebugRoutePts(routesRef.current[next].points);
                return next;
            });
        }, 500);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [simIsRunning]);

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
                maxDistance={100}
            />

            {debugCurveDrawPts.length > 1 && (
                <Line
                    points={debugCurveDrawPts}
                    color="red"
                    lineWidth={2}
                />
            )}

            {debugRoutePts.map(([x, y, z], i) => (
                <mesh key={i} position={[x, y + 0.08, z]}>
                    <sphereGeometry args={[0.15, 10, 10]} />
                    <meshBasicMaterial />
                </mesh>
            ))}

            <JunctionComponents />
        </>
    );
}
