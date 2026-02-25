"use client";

import { Canvas } from "@react-three/fiber";
import SelectionPanel from "./components/SelectionPanel";
import AppHeader from "./components/AppHeader";
import Scene from "./components/Scene";
import { JModellerProvider } from "./context/JModellerContext";
import { PeerProvider } from "./context/PeerContext";
import { useState } from "react";
import CoverPage from "./components/CoverPage";

export default function Page() {

    const [entered, setEntered] = useState(false);

    return (
        <PeerProvider>
            <JModellerProvider>
                <div 
                    style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {!entered && (
                        <CoverPage onContinueAction={() => setEntered(true)} />
                    )}

                    {entered && (
                        <>
                            <AppHeader onExitAction={() => setEntered(false)} />
                            <Canvas
                                camera={{ position: [20, 20, 20], fov: 60 }}
                                style={{ background: "#0a0a0a", position: "absolute", inset: 0, width: "100%", height: "100%" }}
                                onContextMenu={(e) => e.preventDefault()}
                            >
                                <Scene />
                            </Canvas>
                            <SelectionPanel />
                        </>
                    )}
                </div>
            </JModellerProvider>
        </PeerProvider>
    );
};
