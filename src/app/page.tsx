"use client";

import { Canvas } from "@react-three/fiber";
import SelectionPanel from "./components/SelectionPanel";
import AppHeader from "./components/AppHeader";
import Scene from "./components/Scene";
import type { SceneHandle } from "./components/Scene";
import { JModellerProvider } from "./context/JModellerContext";
import { useJModellerContext } from "./context/JModellerContext";
import { PeerProvider, usePeer } from "./context/PeerContext";
import { useEffect, useRef, useState } from "react";
import CoverPage from "./components/CoverPage";
import { useTutorial } from "./context/useTutorial";
import { TutorialOverlay } from "./components/TutorialOverlay";
import { SaveFile } from "./includes/saveLoad";
import { defaultJunctionConfig, defaultSimConfig } from "./includes/defaults";

const zoomBtnStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 32, height: 32,
    background: "rgba(9,9,11,0.97)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.75)",
    fontFamily: "var(--font-mono), 'Courier New', monospace",
    fontSize: 18, fontWeight: 400,
    cursor: "pointer",
    backdropFilter: "blur(12px)",
    userSelect: "none",
    transition: "color 0.15s, background 0.15s",
};

function AppContent({ onExit, loadedSave }: { onExit: () => void; loadedSave?: SaveFile | null }) {
    const { selectedObjects, setJunction, setSimConfig, haltSim, resetConfig, setSelectedObjects, setSelectedExits, setObjectCounter, junctionObjectRefs, unregisterJunctionObject } = useJModellerContext();
    const { disconnect, connections, isHost } = usePeer();
    const panelOpen = selectedObjects.length > 0;
    const [navDropdownHeight, setNavDropdownHeight] = useState(0);
    const HEADER_H = 44;
    const canvasTop = `${HEADER_H + navDropdownHeight}px`;
    const sceneRef = useRef<SceneHandle>(null);
    const tutorial = useTutorial();

    const handleStartTutorial = () => {
        // Halt any running simulation
        haltSim();
        resetConfig();
        // Disconnect P2P session
        if (isHost || connections.length > 0) {
            disconnect();
        }
        // Dispose and clear all Three.js junction object refs
        for (const group of [...junctionObjectRefs.current]) {
            unregisterJunctionObject(group);
        }
        // Reset config to defaults
        setJunction({ ...defaultJunctionConfig });
        setSimConfig({ ...defaultSimConfig });
        setSelectedObjects([]);
        setSelectedExits([]);
        setObjectCounter(0);
        // Reset camera to default isometric view
        sceneRef.current?.resetCamera();
        // Start tutorial
        tutorial.start();
    };

    useEffect(() => {
        if (!loadedSave) {
            return;
        }
        setJunction(loadedSave.junctionConfig);
        setSimConfig(loadedSave.simConfig);
    })


    return (
        <>
            <AppHeader onExitAction={onExit} onMenuHeightChangeAction={setNavDropdownHeight} onStartTutorialAction={handleStartTutorial} />
            <TutorialOverlay
                currentStep={tutorial.currentStep}
                stepIndex={tutorial.stepIndex}
                totalSteps={tutorial.totalSteps}
                highlightRect={tutorial.highlightRect}
                onNext={tutorial.next}
                onSkip={tutorial.skip}
            />
            <Canvas
                camera={{ position: [20, 35, 20], fov: 60 }}
                style={{
                    background: "#0a0a0a",
                    position: "absolute",
                    top: canvasTop,
                    right: 0,
                    bottom: 0,
                    left: panelOpen ? "25vw" : "0",
                    transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1), top 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
                onContextMenu={(e) => e.preventDefault()}
            >
                <Scene ref={sceneRef} />
            </Canvas>
            <SelectionPanel />
            {/* Zoom buttons — plain DOM, always bottom-right of viewport */}
            <div style={{ position: "fixed", bottom: "1.5rem", right: "1.5rem", display: "flex", flexDirection: "column", gap: 4, zIndex: 40 }}>
                <button style={{ ...zoomBtnStyle, borderRadius: "6px 6px 2px 2px" }}
                    onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.95)"; e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.75)"; e.currentTarget.style.background = "rgba(9,9,11,0.97)"; }}
                    onClick={() => sceneRef.current?.zoom(0.8)}
                    title="Zoom in"
                >+</button>
                <button style={{ ...zoomBtnStyle, borderRadius: "2px 2px 6px 6px" }}
                    onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.95)"; e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.75)"; e.currentTarget.style.background = "rgba(9,9,11,0.97)"; }}
                    onClick={() => sceneRef.current?.zoom(1.25)}
                    title="Zoom out"
                >−</button>
            </div>
        </>
    );
}

export default function Page() {

    const [entered, setEntered] = useState(false);
    const [sessionCode, setSessionCode] = useState("");
    const [loadedSave, setLoadedSave] = useState<SaveFile | null>(null);

    useEffect(() => {
        const code = new URLSearchParams(window.location.search).get("s") ?? "";
        setSessionCode(code);
    }, []);

    const handleLoadSave = (save: SaveFile) => {
        setLoadedSave(save);
        setEntered(true);
    };


    const handleExit = () => {
        setEntered(false);
        setLoadedSave(null);
        setSessionCode("");
        // Remove ?s= from URL so CoverPage won't auto-rejoin
        const url = new URL(window.location.href);
        if (url.searchParams.has("s")) {
            url.searchParams.delete("s");
            window.history.replaceState(null, "", url.toString());
        }
    };

    return (
        <PeerProvider>
            <JModellerProvider>
                <div 
                    style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {!entered && (
                        <CoverPage 
                            onContinueAction={() => setEntered(true)}
                            initialSessionCode={sessionCode}
                            onLoadSaveAction={handleLoadSave}
                        />
                    )}

                    {entered && (
                         <AppContent
                            onExit={handleExit}
                            loadedSave={loadedSave}
                        />
                    )}
                </div>
            </JModellerProvider>
        </PeerProvider>
    );
};
