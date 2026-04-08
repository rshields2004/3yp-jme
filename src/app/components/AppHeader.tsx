/**
 * AppHeader.tsx
 *
 * Main application header bar with simulation controls, junction
 * building tools, P2P session management, and configuration panels.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import { usePeer } from "../context/PeerContext";
import { NetMessage, SharedState } from "../includes/types/peer";
import { defaultIntersectionConfig, defaultRoundaboutConfig, defaultJunctionConfig, defaultSimConfig } from "../includes/constants";
import { numberToExcelColumn } from "../includes/utils";
import { carClasses } from "../includes/types/carTypes";
import { generateReport } from "../includes/reportGenerator";
import {
    Play, Pause, Square, Check, RotateCcw,
    ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
    Link2, Trash2, PlusSquare, Copy, LogOut, Settings2,
    Eye, EyeOff, Hammer, HelpCircle, ExternalLink, BookOpen,
    Download,
    Upload,
    FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { downloadSave, loadSaveFromFile } from "../includes/saveLoad";

/**
 * Small icon-only button wrapped in a tooltip.
 * @param children - icon element to render inside the button
 * @param title - tooltip text shown on hover
 * @param onClick - click handler
 * @param disabled - whether the button is disabled
 * @param active - whether the button appears in its active/pressed state
 * @returns the rendered icon button
 */
const IconBtn = ({
    children, title, onClick, disabled = false, active = false, ...rest
}: {
    children: React.ReactNode;
    title?: string;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    [key: string]: unknown;
}) => {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClick}
                    disabled={disabled}
                    className={cn(
                        "size-9 border border-white/[0.08] text-white/75",
                        active && "bg-white/[0.1] border-white/25",
                        !disabled && "hover:bg-white/[0.08] hover:border-white/20 hover:text-white"
                    )}
                    {...rest}
                >
                    {children}
                </Button>
            </TooltipTrigger>
            {title && <TooltipContent side="bottom">{title}</TooltipContent>}
        </Tooltip>
    );
}

/**
 * Sliding dropdown panel anchored to the top or bottom of the viewport.
 * @param children - panel content
 * @param anchor - edge the panel slides from (`"top"` or `"bottom"`)
 * @param panelOpen - whether the selection panel is open (shifts left edge)
 * @param fullHeight - whether the panel extends to fill the remaining viewport height
 * @returns the rendered dropdown panel
 */
const DropdownPanel = ({
    children,
    anchor = "top",
    panelOpen = false,
    fullHeight = false,
}: {
    children: React.ReactNode;
    anchor?: "top" | "bottom";
    panelOpen?: boolean;
    fullHeight?: boolean;
}) => {
    const isBottom = anchor === "bottom";
    return (
        <div
            className={cn(
                "fixed right-0 bg-zinc-950/97 overflow-y-auto px-6 py-4",
                "font-mono text-white/95 backdrop-blur-xl",
                isBottom
                    ? "bottom-0 border-t border-white/[0.08] shadow-[0_-8px_32px_rgba(0,0,0,0.5)]"
                    : "top-[44px] border-b border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
            )}
            style={{
                maxHeight: fullHeight ? "calc(100vh - 44px)" : "22vh",
                ...(fullHeight && !isBottom ? { bottom: 0 } : {}),
                zIndex: 49,
                left: panelOpen ? "25vw" : "0",
                transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
            data-dropdown-panel
        >
            {children}
        </div>
    );
}

/**
 * Uppercase label used to separate groups of controls within a dropdown panel.
 *
 * @param children - child elements to render
 * @returns the rendered section title
 */
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[11px] tracking-[0.18em] text-white/75 uppercase mb-2.5 mt-3.5 first:mt-0">
        {children}
    </div>
);

/**
 * Labelled slider row for numeric config values in the header dropdowns.
 * @param label - descriptive text to the left of the slider
 * @param min - slider minimum
 * @param max - slider maximum
 * @param step - slider step increment
 * @param value - current value
 * @param onChange - callback with the new value
 * @param displayValue - formatted string shown to the right of the label
 * @returns the rendered slider row
 */
const SliderRowUi = ({
    label, min, max, step, value, onChange, displayValue,
}: {
    label: string; min: number; max: number; step: number;
    value: number; onChange: (v: number) => void; displayValue: string;
}) => {
    return (
        <div className="mb-1.5">
            <div className="flex justify-between text-[13px] mb-1 text-white/92">
                <span>{label}</span>
                <span className="tabular-nums text-white">{displayValue}</span>
            </div>
            <Slider
                min={min}
                max={max}
                step={step}
                value={[value]}
                onValueChange={([v]) => onChange(v)}
                className="w-full"
            />
        </div>
    );
}

/**
 * Styled action button used for primary actions (e.g. add object, confirm config).
 * @param children - button label/icon content
 * @param onClick - click handler
 * @param disabled - whether the button is disabled
 * @param variant - visual style (`"default"` or `"danger"`)
 * @returns the rendered action button
 */
const ActionBtn = ({
    children, onClick, disabled = false, variant = "default", ...rest
}: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: "default" | "danger";
    [key: string]: unknown;
}) => {
    return (
        <Button
            size="sm"
            variant={variant === "danger" ? "destructive" : "outline"}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "text-xs tracking-wide font-normal gap-1.5",
                variant === "default" && "bg-white/[0.04] border-white/[0.1] text-white/90 hover:bg-white/[0.1] hover:border-white/25 hover:text-white"
            )}
            {...rest}
        >
            {children}
        </Button>
    );
}

/**
 * Top navigation bar with dropdown menus for session, configuration, and
 * simulation modes. Also displays real-time stats during a running simulation.
 *
 * @param onExitAction - callback when exit is clicked
 * @param panelOpen - whether the selection panel is open
 * @param onMenuHeightChangeAction - callback reporting the dropdown height
 * @param onStartTutorialAction - callback to start the tutorial
 * @returns the rendered header bar
 */

type MenuId = "session" | "modes" | "config" | null;

const AppHeader = ({ onExitAction, panelOpen = false, onMenuHeightChangeAction, onStartTutorialAction }: { onExitAction?: () => void; panelOpen?: boolean; onMenuHeightChangeAction?: (height: number) => void; onStartTutorialAction?: () => void }) => {
    const [openMenu, setOpenMenu] = useState<MenuId>(null);
    const [joinCode, setJoinCode] = useState("");
    const [statsCollapsed, setStatsCollapsed] = useState(false);

    const {
        isConfigConfirmed, simIsRunning, carsReady, junction,
        confirmConfig, resetConfig, startSim, simIsPaused,
        pauseSim, resumeSim, haltSim, stats,
        setJunction, simConfig, setSimConfig,
        selectedExits, setSelectedExits,
        selectedObjects, setSelectedObjects,
        objectCounter, setObjectCounter,
        followedVehicleId, setFollowedVehicleId, followedVehicleStats, resetFpvLook,
        toolMode, setToolMode,
        showOverlayLabels, setShowOverlayLabels,
    } = useJModellerContext();

    const statsRef = useRef(stats);
    statsRef.current = stats;

    // Measure and report the dropdown panel height whenever the open menu or relevant layout state changes
    useEffect(() => {
        if (!openMenu) {
            onMenuHeightChangeAction?.(0);
            return;
        }
        const raf = requestAnimationFrame(() => {
            const el = document.querySelector('[data-dropdown-panel]') as HTMLElement | null;
            if (el) onMenuHeightChangeAction?.(el.getBoundingClientRect().height);
        });
        return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openMenu, onMenuHeightChangeAction, selectedExits.length, toolMode, junction.junctionLinks.length]);

    // Keep the Modes dropdown pinned open while in Build mode
    useEffect(() => {
        if (toolMode === "build") setOpenMenu("modes");
    }, [toolMode]);

    const isPanelOpen = panelOpen || selectedObjects.length > 0;

    const {
        isHost, hostId, connections, createHost, joinHost, send, disconnect,
        isConnecting, connectionError, connectedPeerIds,
    } = usePeer();

    // peer effects
    const clientHandlerRef = useRef<(data: unknown) => void>(null!);
    clientHandlerRef.current = (data: unknown) => {
        const msg = data as NetMessage;
        if (msg.type === "INIT_CONFIG") {
            setJunction(msg.appdata.junctionConfig);
            setSimConfig(msg.appdata.simulationConfig);
            if (msg.appdata.isConfigConfirmed) {
                confirmConfig();
            } else {
                resetConfig();
            }
        }
        if (msg.type === "START")  { startSim(); }
        if (msg.type === "PAUSE")  { pauseSim(); }
        if (msg.type === "RESUME") { resumeSim(); }
        if (msg.type === "HALT")   { haltSim(); }
    };

    const buildSharedState = (): SharedState => ({
        junctionConfig: junction,
        simulationConfig: simConfig,
        isConfigConfirmed,
    });

    // Attach incoming-data handler on the client's peer connection to process host messages
    useEffect(() => {
        if (isHost) return;
        const conn = connections[0];
        if (!conn) return;
        const handler = (data: unknown) => clientHandlerRef.current(data);
        conn.on("data", handler);
        return () => { conn.off("data", handler); };
    }, [connections, isHost]);

    // Send initial config to each newly connected peer (host only)
    useEffect(() => {
        if (!isHost) return;
        connections.forEach(conn => {
            if ((conn as any)._initSent) return;
            const sendInit = () => {
                conn.send({ type: "INIT_CONFIG", appdata: buildSharedState() });
                (conn as any)._initSent = true;
            };
            if (conn.open) { sendInit(); } else { conn.on("open", sendInit); }
        });
    }, [connections, isHost]);

    // Broadcast updated config to all peers whenever junction, sim config, or confirmation state changes (host only)
    useEffect(() => {
        if (!isHost) return;
        send({ type: "INIT_CONFIG", appdata: buildSharedState() });
    }, [junction, simConfig, isConfigConfirmed]);

    // Sync the session code URL parameter with the current host/client state
    useEffect(() => {
        if (isHost && hostId) {
            const url = new URL(window.location.href);
            url.searchParams.set("s", hostId);
            window.history.replaceState(null, "", url.toString());
        }

        if (!isHost) {
            const url = new URL(window.location.href);
            url.searchParams.delete("s");
            window.history.replaceState(null, "", url.toString());
        }
    }, [isHost, hostId])


    // Send periodic keep-alive pings to the host so it can detect disconnected clients
    useEffect(() => {
        if (isHost || connections.length === 0) return;
        const interval = setInterval(() => { send({ type: "PING" }); }, 3000);
        return () => clearInterval(interval);
    }, [isHost, connections.length, send]);

    // Reset state when a client loses connection
    const wasClientRef = useRef(false);
    // Detect when this client disconnects from the host and reset simulation/config state
    useEffect(() => {
        const isClient = !isHost && connections.length > 0;
        if (isClient) {
            wasClientRef.current = true;
        } else if (wasClientRef.current) {
            wasClientRef.current = false;
            if (simIsRunning) haltSim();
            resetConfig();
        }
    }, [isHost, connections.length]);

    // junction helpers
    const addNewIntersection = () => {
        if (junction.junctionObjects.filter(o => o.type === "intersection").length >= 10) return;
        setObjectCounter(prev => prev + 1);
        setJunction(prev => ({
            ...prev,
            junctionObjects: [
                ...prev.junctionObjects,
                { id: String(objectCounter + 1), name: numberToExcelColumn(objectCounter), type: "intersection", config: defaultIntersectionConfig },
            ],
        }));
    };

    const addNewRoundabout = () => {
        setObjectCounter(prev => prev + 1);
        setJunction(prev => ({
            ...prev,
            junctionObjects: [
                ...prev.junctionObjects,
                { id: String(objectCounter + 1), name: numberToExcelColumn(objectCounter), type: "roundabout", config: defaultRoundaboutConfig },
            ],
        }));
    };

    const addNewLink = () => {
        if (selectedExits.length !== 2) return;
        const [a, b] = selectedExits;
        const exists = junction.junctionLinks.some(link =>
            (link.objectPair[0].structureID === a.structureID && link.objectPair[0].exitIndex === a.exitIndex &&
                link.objectPair[1].structureID === b.structureID && link.objectPair[1].exitIndex === b.exitIndex) ||
            (link.objectPair[0].structureID === b.structureID && link.objectPair[0].exitIndex === b.exitIndex &&
                link.objectPair[1].structureID === a.structureID && link.objectPair[1].exitIndex === a.exitIndex)
        );
        if (exists) return;
        const objA = junction.junctionObjects.find(jo => jo.id === a.structureID);
        const objB = junction.junctionObjects.find(jo => jo.id === b.structureID);
        const cfgA = objA?.config;
        const cfgB = objB?.config;
        if (cfgA && cfgB) {
            const lcA = cfgA.exitConfig[a.exitIndex].laneCount;
            const lcB = cfgB.exitConfig[b.exitIndex].laneCount;
            const nInA = cfgA.exitConfig[a.exitIndex].numLanesIn;
            const nInB = cfgB.exitConfig[b.exitIndex].numLanesIn;
            if (lcA === lcB && nInA === (lcA - nInB)) {
                setObjectCounter(prev => prev + 1);
                setJunction(prev => ({
                    ...prev,
                    junctionLinks: [...prev.junctionLinks, { id: String(objectCounter + 1), objectPair: [a, b] }],
                }));
                setSelectedExits([]);
            } else {
                alert("Cannot link exits with different number of lanes...yet!");
            }
        }
    };

    const removeLink = (linkID: string) => {
        setJunction(prev => ({ ...prev, junctionLinks: prev.junctionLinks.filter(l => l.id !== linkID) }));
    };

    // sim config helper
    type ConfigPath = readonly (string | number)[];
    const setByPath = <T extends object>(obj: T, path: ConfigPath, value: number): T => {
        const [head, ...rest] = path;
        if (!head) return obj;
        return { ...obj, [head]: rest.length === 0 ? value : setByPath((obj as any)[head], rest, value) };
    };
    const handleN = (path: ConfigPath, value: number) =>
        setSimConfig(prev => setByPath(prev, path, value));

    // misc
    const toggleMenu = (id: MenuId) => setOpenMenu(prev => prev === id ? null : id);
    const isConnected = connections.length > 0;
    const isClientConnected = !isHost && isConnected;
    const connStatus = connectionError ? "error" : isConnecting ? "connecting" : isConnected ? "connected" : "idle";
    const dotColor: Record<string, string> = {
        connected: "bg-zinc-300",
        connecting: "bg-zinc-500",
        error: "bg-red-500",
        idle: "bg-zinc-700",
    };

    // render
    return (
        <>
            <style>{`
                @keyframes jmePulse {
                    0%, 100% { opacity: 0.3; }
                    50% { opacity: 1; }
                }
            `}</style>

            {/* backdrop to close menus (skip when modes is pinned open in build mode) */}
            {openMenu && !(toolMode === "build" && openMenu === "modes") && (
                <div
                    onClick={() => setOpenMenu(null)}
                    className="fixed inset-0"
                    style={{ zIndex: 48 }}
                />
            )}

            {/* ── header bar ── */}
            <div
                className="fixed top-0 right-0 h-[44px] bg-zinc-950/97 border-b border-white/[0.08] flex items-center justify-between backdrop-blur-xl px-3 font-mono text-white/95 overflow-x-auto"
                style={{ zIndex: 50, left: panelOpen ? "25vw" : "0", transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}
            >
                {/* left: exit + logo + menus */}
                <div className="flex items-center flex-shrink-0">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 mr-2.5 border border-white/[0.08] text-white/75 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 flex-shrink-0"
                                onClick={() => {
                                    if (simIsRunning) haltSim();
                                    setJunction(defaultJunctionConfig);
                                    setSimConfig(defaultSimConfig);
                                    disconnect();
                                    onExitAction?.();
                                }}
                            >
                                <LogOut size={15} />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Exit to menu</TooltipContent>
                    </Tooltip>

                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/logo.png"
                        alt="JME"
                        className="h-[26px] w-auto mr-4 select-none block"
                    />

                    {(["modes", "session", "config"] as MenuId[]).map(id => {
                        const label = id === "config" ? "Sim Config" : id!.charAt(0).toUpperCase() + id!.slice(1);
                        const isOpen = openMenu === id;
                        const isClient = !isHost && connections.length > 0;
                        const disabled = (id === "config" && (!isConfigConfirmed || isClient)) || (id === "modes" && isClient);
                        return (
                            <Button
                                key={id}
                                variant="ghost"
                                size="sm"
                                data-menu-id={id}
                                onClick={() => !disabled && toggleMenu(id)}
                                disabled={disabled}
                                className={cn(
                                    "gap-1 px-2.5 text-[12px] tracking-[0.15em] uppercase text-white/75 hover:text-white hover:bg-white/[0.07] rounded",
                                    isOpen && "bg-white/[0.07] text-white",
                                    disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-white/75"
                                )}
                            >
                                {label}
                                <ChevronDown
                                    size={13}
                                    className={cn("opacity-70 transition-transform duration-150", isOpen && "rotate-180")}
                                />
                            </Button>
                        );
                    })}
                </div>

                {/* right: sim control icons */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* docs */}
                    <IconBtn title="Documentation" onClick={() => window.open("https://rshields.xyz/docs/index.html", "_blank", "noopener,noreferrer")}>
                        <BookOpen size={17} />
                    </IconBtn>

                    {/* tutorial */}
                    <IconBtn title="Tutorial" onClick={onStartTutorialAction} disabled={!isHost && connections.length > 0}>
                        <HelpCircle size={17} />
                    </IconBtn>

                    <IconBtn
                        title="Save config"
                        disabled={simIsRunning || isClientConnected}
                        onClick={() => downloadSave(junction, simConfig)}
                        data-action="download-save"
                    >
                        <Download size={17} />
                    </IconBtn>

                    <IconBtn
                        title="Load config"
                        disabled={simIsRunning || isClientConnected}
                        onClick={async () => {
                            try {
                                const save = await loadSaveFromFile();
                                // Reset sim state first
                                if (simIsRunning) haltSim();
                                resetConfig();
                                setJunction(save.junctionConfig);
                                setSimConfig(save.simConfig);
                                setOpenMenu(null);
                            } catch {
                                // user cancelled or bad file - silently ignore
                            }
                        }}
                    >
                        <Upload size={17} />
                    </IconBtn>
                    <IconBtn
                        title="Generate PDF Report"
                        disabled={simIsRunning || stats.spawned === 0}
                        onClick={() => generateReport(junction, simConfig, stats)}
                        data-action="download-report"
                    >
                        <FileText size={17} />
                    </IconBtn>

                    <Separator orientation="vertical" className="h-5 mx-0.5 bg-white/[0.08]" />

                    {/* connection status dot */}
                    <div
                        title={connStatus}
                        className={cn("size-1.5 rounded-full mr-1 transition-colors duration-300 flex-shrink-0", dotColor[connStatus], connStatus === "connecting" && "animate-pulse")}
                    />

                    {/* loading badge */}
                    {simIsRunning && !carsReady && (
                        <span
                            className="text-[11px] tracking-widest text-white/92"
                            style={{ animation: "jmePulse 1.5s ease-in-out infinite" }}
                        >
                            LOADING
                        </span>
                    )}

                    {/* confirm / back */}
                    {!isConfigConfirmed ? (
                        <IconBtn
                            title="Confirm Config"
                            disabled={junction.junctionObjects.length === 0 || simIsRunning || isClientConnected}
                            onClick={() => { confirmConfig(); setOpenMenu(null); }}
                            data-action="confirm-config"
                        >
                            <Check size={17} />
                        </IconBtn>
                    ) : !simIsRunning ? (
                        <IconBtn title="Back to Config" disabled={isClientConnected} onClick={resetConfig}>
                            <RotateCcw size={17} />
                        </IconBtn>
                    ) : null}

                    {/* divider */}
                    <Separator orientation="vertical" className="h-5 mx-0.5 bg-white/[0.08]" />

                    {/* start */}
                    <IconBtn
                        title="Start Simulation"
                        disabled={simIsRunning || !carsReady || !isConfigConfirmed || isClientConnected}
                        active={simIsRunning && !simIsPaused}
                        onClick={() => { send({ type: "START" }); startSim(); }}
                        data-action="play-sim"
                    >
                        <Play size={17} />
                    </IconBtn>

                    {/* pause / resume */}
                    <IconBtn
                        title={simIsPaused ? "Resume" : "Pause"}
                        disabled={!simIsRunning || isClientConnected}
                        onClick={() => {
                            if (simIsPaused) { send({ type: "RESUME" }); resumeSim(); }
                            else { send({ type: "PAUSE" }); pauseSim(); }
                        }}
                    >
                        {simIsPaused ? <Play size={17} /> : <Pause size={17} />}
                    </IconBtn>

                    {/* stop */}
                    <IconBtn
                        title="Stop Simulation"
                        disabled={!simIsRunning || isClientConnected}
                        onClick={() => { send({ type: "HALT" }); haltSim(); }}
                        data-action="stop-sim"
                    >
                        <Square size={17} />
                    </IconBtn>

                    {/* toggle overlay labels */}
                    <IconBtn
                        title={showOverlayLabels ? "Hide Overlay Labels" : "Show Overlay Labels"}
                        disabled={!simIsRunning}
                        onClick={() => setShowOverlayLabels(v => !v)}
                        active={showOverlayLabels}
                    >
                        {showOverlayLabels ? <Eye size={17} /> : <EyeOff size={17} />}
                    </IconBtn>

                    {/* speed multiplier (visible while sim is running) */}
                    {simIsRunning && (
                        <>
                            <Separator orientation="vertical" className="h-5 mx-0.5 bg-white/[0.08]" />
                            <div className="flex items-center gap-0.5">
                                <span className="text-[11px] text-white/60 whitespace-nowrap mr-1">Speed</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6 text-white/60 hover:text-white hover:bg-white/10"
                                    onClick={() => setSimConfig(prev => ({ ...prev, speedMultiplier: Math.max(1, (prev.speedMultiplier ?? 1) / 2) }))}
                                    disabled={(simConfig.speedMultiplier ?? 1) <= 1 || isClientConnected}
                                >
                                    <ChevronLeft size={14} />
                                </Button>
                                <span className="text-[11px] text-white/92 tabular-nums w-8 text-center select-none">{simConfig.speedMultiplier ?? 1}x</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6 text-white/60 hover:text-white hover:bg-white/10"
                                    onClick={() => setSimConfig(prev => ({ ...prev, speedMultiplier: Math.min(64, (prev.speedMultiplier ?? 1) * 2) }))}
                                    disabled={(simConfig.speedMultiplier ?? 1) >= 64 || isClientConnected}
                                >
                                    <ChevronRight size={14} />
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── SESSION dropdown ── */}
            {openMenu === "session" && (
                <DropdownPanel panelOpen={isPanelOpen}>
                    <div className="grid gap-8" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                        {/* col 1: connection + car models */}
                        <div>
                            
                            {!isHost && (
                                <>
                                    <SectionTitle>Connection</SectionTitle>
                                    <div className={cn("text-[13px] mb-1.5 flex items-center gap-2", connectionError ? "text-red-400" : isConnected ? "text-white" : "text-white/75")}>
                                        {isConnecting && !isConnected && (
                                            <Settings2
                                                size={13}
                                                className="animate-spin flex-shrink-0"
                                            />
                                        )}
                                        {connectionError ?? (isConnecting ? "Connecting…" : isConnected ? "Connected" : "Not connected")}
                                    </div>
                                </>
                            )}       
                            <SectionTitle>Car Models</SectionTitle>
                            <div className="flex items-center gap-2">
                                <Progress value={carsReady ? 100 : 30} className={cn("h-[3px] flex-1", !carsReady && "animate-pulse")} />
                                <span className="text-xs text-white/75">{carsReady ? "Ready" : "Loading…"}</span>
                            </div>
                        </div>
                        {/* col 2: host */}
                        <div>
                            <SectionTitle>Host</SectionTitle>
                            {!isHost && !isConnected && (
                                <ActionBtn onClick={createHost}>Host Session</ActionBtn>
                            )}
                            {isHost && (
                                <>
                                    <div className="flex items-center gap-2 px-2.5 py-2 bg-white/[0.04] border border-white/[0.08] rounded mb-2">
                                        <span className="flex-1 text-[13px] tracking-widest text-white">{hostId}</span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="size-6 text-white/75 hover:text-white"
                                            onClick={() => navigator.clipboard.writeText(hostId ?? "")}
                                            title="Copy"
                                        >
                                            <Copy size={14} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="size-6 text-white/75 hover:text-white"
                                            onClick={() => {
                                                const url = new URL(window.location.href);
                                                url.searchParams.set("s", hostId ?? "");
                                                navigator.clipboard.writeText(url.toString());
                                            }}
                                            title="Copy invite link"
                                        >
                                            <Link2 size={14} />
                                        </Button>
                                    </div>
                                    {connectedPeerIds.length === 0 ? (
                                        <p className="text-xs text-white/75 m-0">Waiting for peers…</p>
                                    ) : (
                                        <div className="flex flex-col gap-1">
                                            {connectedPeerIds.map((pid, i) => (
                                                <div key={pid} className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded text-xs">
                                                    <div className="size-1.5 rounded-full bg-zinc-400 flex-shrink-0" />
                                                    <span className="text-white/75">Peer {i + 1}</span>
                                                    <span className="ml-auto opacity-50 text-[11px]">{pid.slice(0, 8)}…</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                            {!isHost && isConnected && <p className="text-xs text-white m-0">✓ Connected to host</p>}
                        </div>
                        {/* col 3: join */}
                        <div>
                            <SectionTitle>Join Session</SectionTitle>
                            {!isConnected && !isHost && (
                                <div className="flex gap-1.5">
                                    <Input
                                        placeholder="xxxxxx"
                                        value={joinCode}
                                        onChange={e => setJoinCode(e.target.value)}
                                        onKeyDown={e => e.key === "Enter" && joinHost(joinCode)}
                                        className="flex-1 h-8 text-xs bg-white/[0.04] border-white/[0.12] text-white/92 placeholder:text-white/30 focus-visible:ring-white/20"
                                    />
                                    <ActionBtn onClick={() => joinHost(joinCode)} disabled={!joinCode.trim() || isConnecting}>Join</ActionBtn>
                                </div>
                            )}
                            {isHost && <p className="text-xs text-white/75 m-0">Already in a session.</p>}
                            {isClientConnected && (
                                <div className="flex flex-col gap-2">
                                    <p className="text-xs text-white/75 m-0">Already in a session.</p>
                                    <ActionBtn variant="danger" onClick={() => { disconnect(); resetConfig(); if (simIsRunning) haltSim(); setOpenMenu(null); }}>
                                        <LogOut size={13} /> Disconnect
                                    </ActionBtn>
                                </div>
                            )}
                        </div>
                    </div>
                </DropdownPanel>
            )}

            {/* ── MODES dropdown ── */}
            {openMenu === "modes" && (
                <DropdownPanel panelOpen={isPanelOpen}>
                    <SectionTitle>Mode</SectionTitle>
                    <div className="flex gap-2 mb-3">
                        <button
                            onClick={() => { setToolMode("view"); setSelectedObjects([]); setSelectedExits([]); setOpenMenu(null); }}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 rounded border text-[12px] tracking-[0.12em] uppercase transition-colors",
                                toolMode === "view"
                                    ? "bg-white/[0.12] border-white/30 text-white"
                                    : "bg-white/[0.03] border-white/[0.08] text-white/60 hover:bg-white/[0.07] hover:text-white/90",
                            )}
                        >
                            <Eye size={14} />
                            View
                        </button>
                        <button
                            data-tool-mode="build"
                            onClick={() => { setToolMode("build"); setSelectedObjects([]); setSelectedExits([]); }}
                            disabled={simIsRunning || isConfigConfirmed}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 rounded border text-[12px] tracking-[0.12em] uppercase transition-colors",
                                toolMode === "build"
                                    ? "bg-white/[0.12] border-white/30 text-white"
                                    : "bg-white/[0.03] border-white/[0.08] text-white/60 hover:bg-white/[0.07] hover:text-white/90",
                                (simIsRunning || isConfigConfirmed) && "opacity-40 cursor-not-allowed"
                            )}
                        >
                            <Hammer size={14} />
                            Build
                        </button>
                    </div>
                    <p className="text-[11px] text-white/50 leading-relaxed mb-3">
                        {toolMode === "view"
                            ? "Orbit camera freely. Double-click a junction to centre on it."
                            : "Top-down view. Place junctions, drag to reposition, link exits, and right-click to edit config."}
                    </p>

                    {/* ── Build-mode inline tools ── */}
                    {toolMode === "build" && !simIsRunning && !isConfigConfirmed && (
                        <div className="flex gap-6">
                            <div className="flex-1 min-w-0">
                                <SectionTitle>Build Tools</SectionTitle>
                                <div className="flex gap-1.5 mb-3 flex-wrap">
                                    <ActionBtn onClick={() => addNewIntersection()} disabled={isClientConnected} data-action="add-intersection">
                                        <PlusSquare size={14} /> Intersection
                                    </ActionBtn>
                                    <ActionBtn onClick={() => addNewRoundabout()} disabled={isClientConnected} data-action="add-roundabout">
                                        <PlusSquare size={14} /> Roundabout
                                    </ActionBtn>
                                    {selectedExits.length === 2 && (
                                        <ActionBtn onClick={() => addNewLink()} disabled={isClientConnected} data-action="link-exits">
                                            <Link2 size={14} /> Link Exits ({selectedExits.map(e => `exit ${e.exitIndex}`).join(" ↔ ")})
                                        </ActionBtn>
                                    )}
                                </div>
                            </div>

                            {junction.junctionLinks.length > 0 && (
                                <div className="flex-1 min-w-0">
                                    <SectionTitle>Links</SectionTitle>
                                    <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                                        {junction.junctionLinks.map(link => {
                                            const objA = junction.junctionObjects.find(o => o.id === link.objectPair[0].structureID);
                                            const objB = junction.junctionObjects.find(o => o.id === link.objectPair[1].structureID);
                                            return (
                                                <div key={link.id} className="flex items-center justify-between px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-xs">
                                                    <span className="text-white/92">
                                                        {objA?.name ?? "?"} Exit {link.objectPair[0].exitIndex}
                                                        <span className="opacity-40 mx-1.5">↔</span>
                                                        {objB?.name ?? "?"} Exit {link.objectPair[1].exitIndex}
                                                    </span>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="size-6 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 ml-2"
                                                        onClick={() => removeLink(link.id)}
                                                        disabled={isClientConnected}
                                                    >
                                                        <Trash2 size={13} />
                                                    </Button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </DropdownPanel>
            )}

            {/* ── SIM CONFIG dropdown ── */}
            {openMenu === "config" && isConfigConfirmed && !simIsRunning && (
                <DropdownPanel panelOpen={isPanelOpen} fullHeight>
                    {isClientConnected && (
                        <p className="text-xs text-zinc-500 mb-3 tracking-wide">
                            VIEW ONLY - config is controlled by the host
                        </p>
                    )}
                    <div
                        className={cn("grid gap-8", isClientConnected && "pointer-events-none opacity-55")}
                        style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}
                    >
                        {/* col 1: spawning + motion */}
                        <div>
                            <SectionTitle>Spawning</SectionTitle>
                            <div className="mb-2">
                                <Label className="text-xs text-white/92 mb-1 block">Seed</Label>
                                <Input
                                    value={simConfig.simSeed}
                                    onChange={e => setSimConfig(prev => ({ ...prev, simSeed: e.target.value }))}
                                    className="h-8 text-xs bg-white/[0.04] border-white/[0.12] text-white/92 focus-visible:ring-white/20"
                                />
                            </div>
                            <SliderRowUi label="Spawn Rate (veh/s)" min={0} max={4} step={0.01} value={simConfig.spawning.spawnRate} onChange={v => handleN(["spawning", "spawnRate"], v)} displayValue={simConfig.spawning.spawnRate.toFixed(2)} />
                            <SliderRowUi label="Max Vehicles" min={10} max={500} step={10} value={simConfig.spawning.maxVehicles} onChange={v => handleN(["spawning", "maxVehicles"], v)} displayValue={String(simConfig.spawning.maxVehicles)} />
                            <SliderRowUi label="Max Spawn Attempts" min={1} max={50} step={1} value={simConfig.spawning.maxSpawnAttemptsPerFrame} onChange={v => handleN(["spawning", "maxSpawnAttemptsPerFrame"], v)} displayValue={String(simConfig.spawning.maxSpawnAttemptsPerFrame)} />
                            <SliderRowUi label="Max Spawn Queue" min={5} max={200} step={5} value={simConfig.spawning.maxSpawnQueue} onChange={v => handleN(["spawning", "maxSpawnQueue"], v)} displayValue={String(simConfig.spawning.maxSpawnQueue)} />
                            <SectionTitle>Simulation</SectionTitle>
                            <div className="mb-2">
                                <Label className="text-xs text-white/92 mb-1 block">Max Sim Time (s)</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={simConfig.maxSimTime ?? 3600}
                                    onChange={e => {
                                        const v = Math.max(1, Math.round(parseFloat(e.target.value) || 1));
                                        setSimConfig(prev => ({ ...prev, maxSimTime: v }));
                                    }}
                                    className="h-8 w-28 text-xs bg-white/[0.04] border-white/[0.12] text-white/92 focus-visible:ring-white/20 tabular-nums"
                                />
                            </div>
                            <div className="mb-2">
                                <Label className="text-xs text-white/92 mb-1 block">Speed Multiplier</Label>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 text-white/60 hover:text-white hover:bg-white/10 border border-white/[0.12]"
                                        onClick={() => setSimConfig(prev => ({ ...prev, speedMultiplier: Math.max(1, (prev.speedMultiplier ?? 1) / 2) }))}
                                        disabled={(simConfig.speedMultiplier ?? 1) <= 1 || isClientConnected}
                                    >
                                        <ChevronLeft size={14} />
                                    </Button>
                                    <span className="text-xs text-white/92 tabular-nums w-10 text-center select-none">{simConfig.speedMultiplier ?? 1}x</span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 text-white/60 hover:text-white hover:bg-white/10 border border-white/[0.12]"
                                        onClick={() => setSimConfig(prev => ({ ...prev, speedMultiplier: Math.min(64, (prev.speedMultiplier ?? 1) * 2) }))}
                                        disabled={(simConfig.speedMultiplier ?? 1) >= 64 || isClientConnected}
                                    >
                                        <ChevronRight size={14} />
                                    </Button>
                                </div>
                            </div>
                            <SectionTitle>Motion</SectionTitle>
                            <SliderRowUi label="Initial Speed" min={0} max={20} step={0.5} value={simConfig.motion.initialSpeed} onChange={v => handleN(["motion", "initialSpeed"], v)} displayValue={simConfig.motion.initialSpeed.toFixed(1)} />
                            <SliderRowUi label="Preferred Speed" min={1} max={30} step={0.5} value={simConfig.motion.preferredSpeed} onChange={v => handleN(["motion", "preferredSpeed"], v)} displayValue={simConfig.motion.preferredSpeed.toFixed(1)} />
                            <SliderRowUi label="Max Accel" min={0.5} max={15} step={0.5} value={simConfig.motion.maxAccel} onChange={v => handleN(["motion", "maxAccel"], v)} displayValue={simConfig.motion.maxAccel.toFixed(1)} />
                            <SliderRowUi label="Max Decel" min={0.5} max={15} step={0.5} value={simConfig.motion.maxDecel} onChange={v => handleN(["motion", "maxDecel"], v)} displayValue={simConfig.motion.maxDecel.toFixed(1)} />
                            <SliderRowUi label="Comfort Decel" min={0.5} max={15} step={0.5} value={simConfig.motion.comfortDecel} onChange={v => handleN(["motion", "comfortDecel"], v)} displayValue={simConfig.motion.comfortDecel.toFixed(1)} />
                        </div>
                        {/* col 2: spacing + rendering + car classes */}
                        <div>
                            <SectionTitle>Spacing</SectionTitle>
                            <SliderRowUi label="Min Bumper Gap" min={0} max={5} step={0.1} value={simConfig.spacing.minBumperGap} onChange={v => handleN(["spacing", "minBumperGap"], v)} displayValue={simConfig.spacing.minBumperGap.toFixed(1)} />
                            <SliderRowUi label="Time Headway (s)" min={0.1} max={5} step={0.1} value={simConfig.spacing.timeHeadway} onChange={v => handleN(["spacing", "timeHeadway"], v)} displayValue={simConfig.spacing.timeHeadway.toFixed(1)} />
                            <SliderRowUi label="Stop Line Offset" min={0} max={2} step={0.01} value={simConfig.spacing.stopLineOffset} onChange={v => handleN(["spacing", "stopLineOffset"], v)} displayValue={simConfig.spacing.stopLineOffset.toFixed(2)} />
                            <SectionTitle>Rendering</SectionTitle>
                            <SliderRowUi label="Y Offset" min={0} max={1} step={0.01} value={simConfig.rendering.yOffset} onChange={v => handleN(["rendering", "yOffset"], v)} displayValue={simConfig.rendering.yOffset.toFixed(2)} />
                        </div>
                        {/* col 3: roundabout controller */}
                        <div>
                            <SectionTitle>Roundabout Controller</SectionTitle>
                            <SliderRowUi label="Min Gap Distance" min={0.5} max={10} step={0.5} value={simConfig.controllers.roundabout.roundaboutMinGap} onChange={v => handleN(["controllers", "roundabout", "roundaboutMinGap"], v)} displayValue={simConfig.controllers.roundabout.roundaboutMinGap.toFixed(1)} />
                            <SliderRowUi label="Min Time Gap (s)" min={0.1} max={5} step={0.1} value={simConfig.controllers.roundabout.roundaboutMinTimeGap} onChange={v => handleN(["controllers", "roundabout", "roundaboutMinTimeGap"], v)} displayValue={simConfig.controllers.roundabout.roundaboutMinTimeGap.toFixed(1)} />
                            <SliderRowUi label="Safe Entry Distance" min={5} max={50} step={1} value={simConfig.controllers.roundabout.roundaboutSafeEntryDist} onChange={v => handleN(["controllers", "roundabout", "roundaboutSafeEntryDist"], v)} displayValue={simConfig.controllers.roundabout.roundaboutSafeEntryDist.toFixed(0)} />
                            <SliderRowUi label="Entry Timeout (s)" min={0.1} max={5} step={0.1} value={simConfig.controllers.roundabout.roundaboutEntryTimeout} onChange={v => handleN(["controllers", "roundabout", "roundaboutEntryTimeout"], v)} displayValue={simConfig.controllers.roundabout.roundaboutEntryTimeout.toFixed(1)} />
                            <SliderRowUi
                                label="Min Angular Sep (°)"
                                min={5} max={90} step={1}
                                value={Math.round(simConfig.controllers.roundabout.roundaboutMinAngularSep * 180 / Math.PI)}
                                onChange={v => handleN(["controllers", "roundabout", "roundaboutMinAngularSep"], v * Math.PI / 180)}
                                displayValue={`${Math.round(simConfig.controllers.roundabout.roundaboutMinAngularSep * 180 / Math.PI)}°`}
                            />
                        </div>
                        {/* col 4: intersection controller */}
                        <div>
                            <SectionTitle>Intersection Controller</SectionTitle>
                            <SliderRowUi label="Green Time (s)" min={0.1} max={30} step={0.1} value={simConfig.controllers.intersection.intersectionGreenTime} onChange={v => handleN(["controllers", "intersection", "intersectionGreenTime"], v)} displayValue={simConfig.controllers.intersection.intersectionGreenTime.toFixed(1)} />
                            <SliderRowUi label="Amber Time (s)" min={0.1} max={10} step={0.1} value={simConfig.controllers.intersection.intersectionAmberTime} onChange={v => handleN(["controllers", "intersection", "intersectionAmberTime"], v)} displayValue={simConfig.controllers.intersection.intersectionAmberTime.toFixed(1)} />
                            <SliderRowUi label="Red-Amber Time (s)" min={0.1} max={5} step={0.1} value={simConfig.controllers.intersection.intersectionRedAmberTime} onChange={v => handleN(["controllers", "intersection", "intersectionRedAmberTime"], v)} displayValue={simConfig.controllers.intersection.intersectionRedAmberTime.toFixed(1)} />
                            <SliderRowUi label="All-Red Time (s)" min={0.1} max={5} step={0.1} value={simConfig.controllers.intersection.intersectionAllRedTime} onChange={v => handleN(["controllers", "intersection", "intersectionAllRedTime"], v)} displayValue={simConfig.controllers.intersection.intersectionAllRedTime.toFixed(1)} />
                        </div>
                    </div>

                    {/* ── Car Classes table ── */}
                    <div className={cn("mt-6", isClientConnected && "pointer-events-none opacity-55")}>
                        <SectionTitle>Car Classes</SectionTitle>
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="text-white/60 border-b border-white/[0.08]">
                                    <th className="text-left font-normal py-1.5 pr-3">Enabled</th>
                                    <th className="text-left font-normal py-1.5 pr-3">Class</th>
                                    <th className="text-left font-normal py-1.5 pr-3">Speed Factor</th>
                                    <th className="text-left font-normal py-1.5 pr-3">Accel Factor</th>
                                    <th className="text-left font-normal py-1.5 pr-3">Decel Factor</th>
                                    <th className="text-left font-normal py-1.5">Weight</th>
                                </tr>
                            </thead>
                            <tbody>
                                {carClasses.map(cc => {
                                    const enabled = simConfig.rendering.enabledCarClasses.includes(cc.bodyType);
                                    const ovr = simConfig.carClassOverrides[cc.bodyType] ?? { speedFactor: cc.speedFactor, accelFactor: cc.accelFactor, decelFactor: cc.decelFactor, weight: cc.weight };
                                    const setOvr = (field: string, value: number) =>
                                        setSimConfig(prev => ({
                                            ...prev,
                                            carClassOverrides: {
                                                ...prev.carClassOverrides,
                                                [cc.bodyType]: { ...prev.carClassOverrides[cc.bodyType], [field]: value },
                                            },
                                        }));
                                    return (
                                        <tr key={cc.bodyType} className={cn("border-b border-white/[0.04]", !enabled && "opacity-40")}>
                                            <td className="py-1.5 pr-3">
                                                <Checkbox
                                                    id={`cc-${cc.bodyType}`}
                                                    checked={enabled}
                                                    onCheckedChange={() => {
                                                        setSimConfig(prev => {
                                                            const cur = prev.rendering.enabledCarClasses;
                                                            const next = enabled ? cur.filter(b => b !== cc.bodyType) : [...cur, cc.bodyType];
                                                            if (next.length === 0) return prev;
                                                            return { ...prev, rendering: { ...prev.rendering, enabledCarClasses: next } };
                                                        });
                                                    }}
                                                />
                                            </td>
                                            <td className="py-1.5 pr-3">
                                                <Label htmlFor={`cc-${cc.bodyType}`} className={cn("text-xs cursor-pointer", enabled ? "text-white/92" : "text-white/50")}>
                                                    {cc.bodyType}
                                                </Label>
                                            </td>
                                            <td className="py-1.5 pr-3">
                                                <Input
                                                    type="number" min={0.1} max={3} step={0.05}
                                                    value={ovr.speedFactor}
                                                    onChange={e => setOvr("speedFactor", parseFloat(e.target.value) || 0)}
                                                    className="h-7 w-20 text-xs bg-white/[0.04] border-white/[0.12] text-white/92 tabular-nums"
                                                />
                                            </td>
                                            <td className="py-1.5 pr-3">
                                                <Input
                                                    type="number" min={0.1} max={3} step={0.05}
                                                    value={ovr.accelFactor}
                                                    onChange={e => setOvr("accelFactor", parseFloat(e.target.value) || 0)}
                                                    className="h-7 w-20 text-xs bg-white/[0.04] border-white/[0.12] text-white/92 tabular-nums"
                                                />
                                            </td>
                                            <td className="py-1.5 pr-3">
                                                <Input
                                                    type="number" min={0.1} max={3} step={0.05}
                                                    value={ovr.decelFactor}
                                                    onChange={e => setOvr("decelFactor", parseFloat(e.target.value) || 0)}
                                                    className="h-7 w-20 text-xs bg-white/[0.04] border-white/[0.12] text-white/92 tabular-nums"
                                                />
                                            </td>
                                            <td className="py-1.5">
                                                <Input
                                                    type="number" min={0} max={100} step={1}
                                                    value={ovr.weight}
                                                    onChange={e => setOvr("weight", parseFloat(e.target.value) || 0)}
                                                    className="h-7 w-20 text-xs bg-white/[0.04] border-white/[0.12] text-white/92 tabular-nums"
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </DropdownPanel>
            )}
            {openMenu === "config" && simIsRunning && (
                <DropdownPanel panelOpen={isPanelOpen}>
                    <p className="text-[13px] text-white/75 m-0">
                        Config is locked while the simulation is running.
                    </p>
                </DropdownPanel>
            )}

            {/* ── VEHICLE HUD ── */}
            {simIsRunning && followedVehicleId !== null && (
                <DropdownPanel anchor="bottom" panelOpen={isPanelOpen}>
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex gap-10 items-end flex-wrap justify-center">
                            {[
                                ["SPEED", followedVehicleStats ? `${(followedVehicleStats.speed * 3.6).toFixed(1)} km/h` : "-"],
                                ["TARGET", followedVehicleStats ? `${(followedVehicleStats.preferredSpeed * 3.6).toFixed(1)} km/h` : "-"],
                                ["ACCEL", followedVehicleStats ? `${followedVehicleStats.accel >= 0 ? "+" : ""}${followedVehicleStats.accel.toFixed(2)} m/s²` : "-"],
                                ["PHASE", followedVehicleStats?.phase ?? "-"],
                                ["TYPE", followedVehicleStats?.bodyType ?? "-"],
                                ["ID", followedVehicleStats ? `#${followedVehicleStats.id}` : "-"],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="flex flex-col items-center gap-0.5">
                                    <span className="text-[11px] text-white/75 tracking-widest uppercase">{label}</span>
                                    <span className="text-[30px] font-bold text-white/97 tabular-nums leading-none">{value}</span>
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center gap-2.5">
                            <span className="text-[11px] text-white/75 tracking-widest uppercase">ON</span>
                            <span className="text-[17px] font-semibold text-white/95">
                                {followedVehicleStats?.segment ?? "-"}
                            </span>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => resetFpvLook()}
                                className="text-[11px] text-white/75 flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
                            >
                                Press <Kbd>C</Kbd> to re-centre camera
                            </button>
                            <button
                                onClick={() => setFollowedVehicleId(null)}
                                className="text-[11px] text-white/75 flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
                            >
                                Press <Kbd>Backspace</Kbd> to exit first-person view
                            </button>
                        </div>
                    </div>
                </DropdownPanel>
            )}

            {/* ── STATS panel ── */}
            {simIsRunning && followedVehicleId === null && (
                <div
                    className="fixed right-0 bg-zinc-950/97 overflow-hidden px-0 py-0 font-mono text-white/95 backdrop-blur-xl bottom-0 border-t border-white/[0.08] shadow-[0_-8px_32px_rgba(0,0,0,0.5)]"
                    style={{
                        zIndex: 49,
                        left: isPanelOpen ? "25vw" : "0",
                        transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                    }}
                >
                    {/* Collapse / Undock toolbar */}
                    <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/[0.08]">
                        <button
                            onClick={() => setStatsCollapsed(c => !c)}
                            className="flex items-center gap-1.5 text-[11px] tracking-[0.12em] text-white/75 uppercase hover:text-white transition-colors"
                        >
                            {statsCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            Statistics
                        </button>
                        <button
                            onClick={() => {
                                const w = window.open("", "_blank", "width=480,height=400,menubar=no,toolbar=no,location=no,status=no");
                                if (!w) return;
                                w.document.title = "Simulation Statistics";
                                const style = w.document.createElement("style");
                                style.textContent = `body{margin:0;background:#09090b;color:#f5f5f5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;padding:16px}
                                    .grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 24px;margin-bottom:12px}
                                    .row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.08)}
                                    .label{opacity:0.75}.value{font-variant-numeric:tabular-nums}
                                    h3{font-size:11px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.75;margin:12px 0 6px}`;
                                w.document.head.appendChild(style);
                                const body = w.document.body;
                                const update = () => {
                                    if (w.closed) return;
                                    const s = statsRef.current;
                                    body.innerHTML = `
                                        <div class="grid" style="grid-template-columns:1fr 1fr 1fr 1fr">
                                            ${[["Active",s.active],["Spawn Queue",s.spawnQueue],["Spawned",s.spawned],["Completed",s.completed],["Routes",s.routes],["Elapsed",s.elapsedTime.toFixed(1)+"s"],["Avg Speed",s.avgSpeed.toFixed(1)],["Avg Travel",s.avgTravelTime.toFixed(1)+"s"]]
                                                .map(([k,v])=>`<div class="row"><span class="label">${k}</span><span class="value">${v}</span></div>`).join("")}
                                        </div>
                                        <h3>Junctions (${s.junctions.global.count})</h3>
                                        <div class="grid">
                                            ${[["Approaching",s.junctions.global.approaching],["Waiting",s.junctions.global.waiting],["Inside",s.junctions.global.inside],["Exiting",s.junctions.global.exiting],["Entered",s.junctions.global.entered],["Exited",s.junctions.global.exited]]
                                                .map(([k,v])=>`<div class="row"><span class="label">${k}</span><span class="value">${v}</span></div>`).join("")}
                                        </div>
                                        <div class="grid">
                                            ${[["Avg Wait",s.junctions.global.avgWaitTime.toFixed(1)+"s"],["Max Queue",s.junctions.global.maxQueueLength],["Throughput",s.junctions.global.throughput.toFixed(1)+" v/m"],["PRC",s.junctions.global.prc.toFixed(1)+"%"],["MMQ",s.junctions.global.mmq.toFixed(1)]]
                                                .map(([k,v])=>`<div class="row"><span class="label">${k}</span><span class="value">${v}</span></div>`).join("")}
                                        </div>
                                        ${Object.values(s.junctions.byId).map(j => {
                                            const obj = junction.junctionObjects.find(o => o.id === j.id);
                                            const name = obj?.name ?? j.id.slice(0, 6);
                                            const typeLabel = j.type === "roundabout" ? "Roundabout" : "Intersection";
                                            const losColor = (j.levelOfService === "A" || j.levelOfService === "B") ? "#4ade80"
                                                : (j.levelOfService === "C" || j.levelOfService === "D") ? "#facc15"
                                                : (j.levelOfService === "E" || j.levelOfService === "F") ? "#f87171" : "#fff";
                                            return `<h3>${typeLabel} ${name}</h3>
                                            <div class="grid">
                                                ${[["Approaching",j.approaching],["Waiting",j.waiting],["Inside",j.inside],["Exiting",j.exiting],["Entered",j.entered],["Exited",j.exited],
                                                   ["Avg Wait",j.avgWaitTime.toFixed(1)+"s"],["Max Wait",j.maxWaitTime.toFixed(1)+"s"],["Throughput",j.throughput.toFixed(1)+" v/m"],["Max Queue",j.maxQueueLength],
                                                   ["DoS",j.dos.toFixed(2)],["PRC",j.prc.toFixed(1)+"%"],["MMQ",j.mmq.toFixed(1)]]
                                                    .map(([k,v])=>`<div class="row"><span class="label">${k}</span><span class="value">${v}</span></div>`).join("")}
                                                <div class="row"><span class="label">LOS</span><span class="value" style="color:${losColor};font-weight:700">${j.levelOfService}</span></div>
                                                ${j.state ? `<div class="row" style="border:none"><span class="label">Signal</span><span class="value">${j.state}</span></div>` : ""}
                                            </div>`;
                                        }).join("")}`;
                                };
                                update();
                                const interval = setInterval(update, 500);
                                w.addEventListener("beforeunload", () => {
                                    clearInterval(interval);
                                    setStatsCollapsed(false);
                                });
                                setStatsCollapsed(true);
                            }}
                            className="text-white/50 hover:text-white transition-colors"
                            title="Undock to separate window"
                        >
                            <ExternalLink size={14} />
                        </button>
                    </div>

                    {/* Collapsible content */}
                    {!statsCollapsed && (
                        <div className="px-6 py-4 overflow-y-auto" style={{ maxHeight: "22vh" }}>
                            <div className="grid gap-x-8 gap-y-0.5 text-[13px] mb-2.5" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                                {[
                                    ["Active", stats.active],
                                    ["Spawn Queue", stats.spawnQueue],
                                    ["Spawned", stats.spawned],
                                    ["Completed", stats.completed],
                                    ["Routes", stats.routes],
                                    ["Elapsed", `${stats.elapsedTime.toFixed(1)}s`],
                                    ["Avg Speed", stats.avgSpeed.toFixed(1)],
                                    ["Avg Travel", `${stats.avgTravelTime.toFixed(1)}s`],
                                ].map(([k, v]) => (
                                    <div key={String(k)} className="flex justify-between py-0.5 border-b border-white/[0.08]">
                                        <span className="text-white/75">{k}</span>
                                        <span className="text-white tabular-nums">{v}</span>
                                    </div>
                                ))}
                            </div>

                            {stats.spawnQueueByEntry && Object.keys(stats.spawnQueueByEntry).length > 0 && (
                                <>
                                    <SectionTitle>Queue by Entry</SectionTitle>
                                    {Object.entries(stats.spawnQueueByEntry)
                                        .filter(([, q]) => q > 0)
                                        .map(([key, q]) => {
                                            const parts = key.split("-");
                                            const exitIndex = parts[parts.length - 1];
                                            const structureID = parts.slice(0, -1).join("-");
                                            const obj = junction.junctionObjects.find(o => o.id === structureID);
                                            return (
                                                <div key={key} className="text-xs text-white/75 mb-0.5">
                                                    {obj?.type ?? "junction"} {obj?.name ?? structureID.slice(0, 6)} Exit {Number(exitIndex) + 1}:
                                                    <span className="text-white ml-1">{q}</span>
                                                </div>
                                            );
                                        })}
                                </>
                            )}

                            <SectionTitle>Junctions ({stats.junctions.global.count})</SectionTitle>
                            <div className="grid gap-x-6 gap-y-0.5 text-[13px]" style={{ gridTemplateColumns: "1fr 1fr" }}>
                                {[
                                    ["Approaching", stats.junctions.global.approaching],
                                    ["Waiting", stats.junctions.global.waiting],
                                    ["Inside", stats.junctions.global.inside],
                                    ["Exiting", stats.junctions.global.exiting],
                                    ["Entered", stats.junctions.global.entered],
                                    ["Exited", stats.junctions.global.exited],
                                ].map(([k, v]) => (
                                    <div key={String(k)} className="flex justify-between py-0.5 border-b border-white/[0.08]">
                                        <span className="text-white/75">{k}</span>
                                        <span className="text-white tabular-nums">{v}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-2 text-[13px] flex justify-between">
                                <span className="text-white/75">Avg Wait Time</span>
                                <span className="text-white">{stats.junctions.global.avgWaitTime.toFixed(1)}s</span>
                            </div>
                            <div className="grid gap-x-6 gap-y-0.5 text-[13px] mt-1" style={{ gridTemplateColumns: "1fr 1fr" }}>
                                {[
                                    ["Max Queue", stats.junctions.global.maxQueueLength],
                                    ["Throughput", `${stats.junctions.global.throughput.toFixed(1)} v/m`],
                                    ["PRC", `${stats.junctions.global.prc.toFixed(1)}%`],
                                    ["MMQ", stats.junctions.global.mmq.toFixed(1)],
                                ].map(([k, v]) => (
                                    <div key={String(k)} className="flex justify-between py-0.5 border-b border-white/[0.08]">
                                        <span className="text-white/75">{k}</span>
                                        <span className="text-white tabular-nums">{v}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Per-junction breakdown */}
                            {Object.values(stats.junctions.byId).map((j) => {
                                const obj = junction.junctionObjects.find(o => o.id === j.id);
                                const name = obj?.name ?? j.id.slice(0, 6);
                                const typeLabel = j.type === "roundabout" ? "Roundabout" : "Intersection";
                                const losColor = (j.levelOfService === "A" || j.levelOfService === "B") ? "text-green-400"
                                    : (j.levelOfService === "C" || j.levelOfService === "D") ? "text-yellow-400"
                                    : (j.levelOfService === "E" || j.levelOfService === "F") ? "text-red-400" : "text-white";
                                return (
                                    <div key={j.id}>
                                        <SectionTitle>{typeLabel} {name}</SectionTitle>
                                        <div className="grid gap-x-6 gap-y-0.5 text-[13px]" style={{ gridTemplateColumns: "1fr 1fr" }}>
                                            {([
                                                ["Approaching", j.approaching],
                                                ["Waiting", j.waiting],
                                                ["Inside", j.inside],
                                                ["Exiting", j.exiting],
                                                ["Entered", j.entered],
                                                ["Exited", j.exited],
                                                ["Avg Wait", `${j.avgWaitTime.toFixed(1)}s`],
                                                ["Max Wait", `${j.maxWaitTime.toFixed(1)}s`],
                                                ["Throughput", `${j.throughput.toFixed(1)} v/m`],
                                                ["Max Queue", j.maxQueueLength],
                                                ["DoS", j.dos.toFixed(2)],
                                                ["PRC", `${j.prc.toFixed(1)}%`],
                                                ["MMQ", j.mmq.toFixed(1)],
                                            ] as [string, string | number][]).map(([k, v]) => (
                                                <div key={k} className="flex justify-between py-0.5 border-b border-white/[0.08]">
                                                    <span className="text-white/75">{k}</span>
                                                    <span className="text-white tabular-nums">{v}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-1 text-[13px] flex justify-between">
                                            <span className="text-white/75">LOS</span>
                                            <span className={`${losColor} font-bold tabular-nums`}>{j.levelOfService}</span>
                                        </div>
                                        {j.state && (
                                            <div className="text-[13px] flex justify-between">
                                                <span className="text-white/75">Signal</span>
                                                <span className="text-white">{j.state}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

export default AppHeader;
