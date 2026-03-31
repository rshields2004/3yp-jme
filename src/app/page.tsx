/**
 * page.tsx
 * Root page component — orchestrates the cover page, mobile gate,
 * and main application content (canvas, header, panels).
 */
"use client";

import { Canvas } from "@react-three/fiber";
import SelectionPanel from "./components/SelectionPanel";
import AppHeader from "./components/AppHeader";
import Scene from "./components/Scene";
import type { SceneHandle } from "./components/Scene";
import { JModellerProvider } from "./context/JModellerContext";
import { useJModellerContext } from "./context/JModellerContext";
import { PeerProvider, usePeer } from "./context/PeerContext";
import { useCallback, useEffect, useRef, useState } from "react";
import CoverPage from "./components/CoverPage";
import { useTutorial } from "./context/useTutorial";
import { TutorialOverlay } from "./components/TutorialOverlay";
import { SaveFile } from "./includes/saveLoad";
import { defaultJunctionConfig, defaultSimConfig, HEADER_HEIGHT } from "./includes/constants";

/**
 * Shared inline CSS for the floating zoom +/- buttons.
 */
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

/**
 * Main application shell rendered after the cover page.
 * Composes the header, canvas, selection panel, tutorial overlay, and zoom controls.
 * @param onExit - callback to return to the cover page
 * @param loadedSave - optional save file to restore on mount
 * @returns the rendered application shell
 */
const AppContent = ({ onExit, loadedSave }: { onExit: () => void; loadedSave?: SaveFile | null }) => {
    const { selectedObjects, setJunction, setSimConfig, haltSim, resetConfig, setSelectedObjects, setSelectedExits, setObjectCounter, junctionObjectRefs, unregisterJunctionObject } = useJModellerContext();
    const { disconnect, connections, isHost } = usePeer();
    const panelOpen = selectedObjects.length > 0;
    const [navDropdownHeight, setNavDropdownHeight] = useState(0);
    const canvasTop = `${HEADER_HEIGHT + navDropdownHeight}px`;
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
        haltSim();
        resetConfig();
        setSelectedObjects([]);
        setSelectedExits([]);
        setJunction(loadedSave.junctionConfig);
        setSimConfig(loadedSave.simConfig);
    }, [loadedSave])


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

/**
 * Full-screen overlay warning mobile users that the app is best used on desktop.
 * @param onProceed - callback when the user elects to continue anyway
 * @returns the rendered mobile warning overlay
 */
const MobileGate = ({ onProceed }: { onProceed: () => void }) => {
    return (
        <div className="fixed inset-0 bg-[#080808] flex flex-col items-center justify-center" style={{ zIndex: 200, fontFamily: "var(--font-mono), 'Courier New', monospace", overflow: "hidden" }}>
            {/* Grid background */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    backgroundImage: `
                        linear-gradient(rgba(161,161,170,0.04) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(161,161,170,0.04) 1px, transparent 1px)
                    `,
                    backgroundSize: "40px 40px",
                }}
            />
            {/* Corner accents */}
            {([
                { top: 24, left: 24, borderTop: "1px solid", borderLeft: "1px solid" },
                { top: 24, right: 24, borderTop: "1px solid", borderRight: "1px solid" },
                { bottom: 24, left: 24, borderBottom: "1px solid", borderLeft: "1px solid" },
                { bottom: 24, right: 24, borderBottom: "1px solid", borderRight: "1px solid" },
            ] as React.CSSProperties[]).map((style, i) => (
                <div
                    key={i}
                    className="absolute w-8 h-8"
                    style={{ ...style, borderColor: "rgba(240,240,240,0.57)" }}
                />
            ))}
            {/* Content */}
            <div className="relative flex flex-col items-center max-w-[400px] w-full px-6 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="JME" className="h-12 w-auto mb-8 select-none" />
                <h2 className="text-[18px] font-semibold text-white/90 tracking-[0.04em] mb-3">
                    Best used on desktop
                </h2>
                <p className="text-[13px] text-white/40 leading-relaxed tracking-[0.03em] mb-10">
                    This application relies on keyboard shortcuts, drag controls, and a wide viewport that work best on a desktop browser.
                </p>
                <button
                    onClick={onProceed}
                    className="text-[12px] tracking-[0.15em] uppercase text-white/35 hover:text-white/70 transition-colors duration-150 bg-transparent border-none cursor-pointer underline underline-offset-4 decoration-white/15 hover:decoration-white/40"
                >
                    Proceed anyway
                </button>
            </div>
        </div>
    );
}

/**
 * Top-level page component wrapping providers and routing between cover/app views.
 * @returns the rendered page
 */
const Page = () => {

    const [entered, setEntered] = useState(false);
    const [sessionCode, setSessionCode] = useState("");
    const [loadedSave, setLoadedSave] = useState<SaveFile | null>(null);
    const [mobileBypass, setMobileBypass] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const code = new URLSearchParams(window.location.search).get("s") ?? "";
        setSessionCode(code);
    }, []);

    const checkMobile = useCallback(() => {
        setIsMobile(window.innerWidth < 768);
    }, []);

    useEffect(() => {
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, [checkMobile]);

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
                    {isMobile && !mobileBypass && (
                        <MobileGate onProceed={() => setMobileBypass(true)} />
                    )}

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

export default Page;
