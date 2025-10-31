"use client";

import { Canvas } from "@react-three/fiber";
import DebugPanel from "./components/DebugPanel";
import Scene from "./components/Scene";
import { JModellerProvider } from "./context/JModellerContext";

export default function Page() {

    return (
        <JModellerProvider>
            <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
                <Canvas
                    camera={{ position: [5, 5, 5], fov: 60 }}
                    style={{ background: "#0a0a0a", width: "100vw", height: "100vh" }}
                >
                    <Scene />
                    
                </Canvas>
                <DebugPanel />
            </div>
        </JModellerProvider>
    );
};
