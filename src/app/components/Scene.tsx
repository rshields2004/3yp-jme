"use client";

import { OrbitControls, Html, Grid } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useRef } from "react";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useJModellerContext } from "../context/JModellerContext";
import { usePeer } from "../context/PeerContext";
import { FLOOR_Y } from "../includes/defaults";
import { JunctionComponents } from "./JunctionComponents";
import { TrafficSimulation } from "./TrafficSimulation";
import { RouteDebug } from "./RouteDebug";

export default function Scene() {
    const { selectedObjects, followedVehicleId, junction, simIsRunning, isConfigConfirmed } = useJModellerContext();
    const { isHost, connections } = usePeer();
    const isClientConnected = !isHost && connections.length > 0;
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const isEmpty = junction.junctionObjects.length === 0 && !simIsRunning;

    return (
        <>
            <fog attach="fog" args={["#0a0a0a", 100, 250]} />

            <ambientLight intensity={1} />
            <directionalLight position={[20, 50, 20]} intensity={0.6} />
            <pointLight position={[0, 5, 0]} intensity={2} color="#ffaa00" />

            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 1, 0]} receiveShadow>
                <planeGeometry args={[500, 500]} />
                <meshStandardMaterial color="#09090b" />
            </mesh>

            {!isConfigConfirmed && (
                <>
                    <Grid
                        position={[0, 0, 0]}
                        args={[200, 200]}
                        cellSize={1}
                        cellThickness={0.4}
                        cellColor="#27272a"
                        sectionSize={10}
                        sectionThickness={0.8}
                        sectionColor="#3f3f46"
                        fadeDistance={120}
                        fadeStrength={1.5}
                        infiniteGrid
                    />
                    <mesh position={[0, 0, 0]}>
                        <sphereGeometry args={[0.12, 16, 16]} />
                        <meshBasicMaterial color="#ffffff" />
                    </mesh>
                </>
            )}

            <EffectComposer>
                <Bloom intensity={1.5} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
            </EffectComposer>

            <OrbitControls
                enabled={selectedObjects.length === 0 && followedVehicleId === null}
                ref={controlsRef}
                minPolarAngle={Math.PI / 6}
                maxPolarAngle={Math.PI / 2.1}
                minDistance={5}
                maxDistance={200}
            />



            <JunctionComponents />

            {isEmpty && (
                <>
                    <Html center position={[0, 1, 0]} zIndexRange={[10, 0]}>
                        <div style={{
                            background: "rgba(9,9,11,0.93)",
                            border: "1px solid rgba(161,161,170,0.15)",
                            borderRadius: 8,
                            padding: "12px 18px",
                            fontFamily: "var(--font-mono), 'Courier New', monospace",
                            whiteSpace: "nowrap",
                            boxShadow: "0 4px 24px rgba(0,0,0,0.65)",
                            textAlign: "center",
                            pointerEvents: "none",
                        }}>
                            <div style={{
                                fontSize: 13, fontWeight: 700, letterSpacing: "0.12em",
                                color: "rgba(255,255,255,0.95)", textTransform: "uppercase",
                                marginBottom: 6,
                            }}>
                                No objects placed
                            </div>
                            {!isClientConnected && (
                                <div style={{ fontSize: 12, color: "rgba(225,225,230,0.75)", lineHeight: 1.6 }}>
                                    Open{" "}
                                    <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>Junction</span>
                                    {" "}to add a roundabout or intersection
                                </div>
                            )}
                        </div>
                    </Html>
                </>
            )}

            <TrafficSimulation />
            <RouteDebug enabled />

        </>
    );
}
