"use client";

import { Canvas } from "@react-three/fiber";
import DebugPanel from "./components/DebugPanel";
import SimConfigPanel from "./components/SimConfigPanel";
import Scene from "./components/Scene";
import { JModellerProvider } from "./context/JModellerContext";
import { PeerProvider } from "./context/PeerContext";
import SimControlPanel from "./components/SimControlPanel";

export default function Page() {

    return (
        <PeerProvider>
            <JModellerProvider>
                <div 
                    style={{ width: "100vw", height: "100vh", position: "relative" }}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    <Canvas
                        camera={{ position: [5, 5, 5], fov: 60 }}
                        style={{ background: "#0a0a0a", width: "100vw", height: "100vh" }}
                        onContextMenu={(e) => e.preventDefault()}
                    >
                        <Scene />
                        
                    </Canvas>
                    <DebugPanel />
                    <SimConfigPanel />
                    <SimControlPanel />
                    
                </div>
            </JModellerProvider>
        </PeerProvider>
    );
};
