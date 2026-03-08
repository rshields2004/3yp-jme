"use client";

import { Canvas } from "@react-three/fiber";
import SelectionPanel from "./components/SelectionPanel";
import AppHeader from "./components/AppHeader";
import Scene from "./components/Scene";
import type { SceneHandle } from "./components/Scene";
import { JModellerProvider } from "./context/JModellerContext";
import { useJModellerContext } from "./context/JModellerContext";
import { PeerProvider } from "./context/PeerContext";
import { useEffect, useRef, useState } from "react";
import CoverPage from "./components/CoverPage";

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

function AppContent({ onExit }: { onExit: () => void }) {
    const { selectedObjects } = useJModellerContext();
    const panelOpen = selectedObjects.length > 0;
    const [navDropdownHeight, setNavDropdownHeight] = useState(0);
    const HEADER_H = 44;
    const canvasTop = `${HEADER_H + navDropdownHeight}px`;
    const sceneRef = useRef<SceneHandle>(null);
    return (
        <>
            <AppHeader onExitAction={onExit} onMenuHeightChangeAction={setNavDropdownHeight} />
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

    useEffect(() => {
        const code = new URLSearchParams(window.location.search).get("s") ?? "";
        setSessionCode(code);
    }, []);


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
                        />
                    )}

                    {entered && <AppContent onExit={() => setEntered(false)} />}
                </div>
            </JModellerProvider>
        </PeerProvider>
    );
};
