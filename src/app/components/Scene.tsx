"use client";

import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useRef } from "react";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useJModellerContext } from "../context/JModellerContext";
import { FLOOR_Y } from "../includes/defaults";
import { JunctionComponents } from "./JunctionComponents";
import { TrafficSimulation } from "./TrafficSimulation";
import { RouteDebug } from "./RouteDebug";

export default function Scene() {
    const { selectedObjects } = useJModellerContext();
    const controlsRef = useRef<OrbitControlsImpl>(null);



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



            <JunctionComponents />

            <TrafficSimulation />
            <RouteDebug enabled />

        </>
    );
}
