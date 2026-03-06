"use client";

import { useEffect, useRef, useState } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import { usePeer } from "../context/PeerContext";
import { NetMessage, SharedState } from "../includes/types/peer";
import { defaultIntersectionConfig, defaultRoundaboutConfig, defaultJunctionConfig, defaultSimConfig } from "../includes/defaults";
import { numberToExcelColumn } from "../includes/utils";
import { carClasses } from "../includes/types/carTypes";
import {
    Play, Pause, Square, Check, RotateCcw,
    ChevronDown, Link2, Trash2, PlusSquare, Copy, LogOut
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

// ─── small reusable sub-components ──────────────────────────────────────────

function IconBtn({
    children, title, onClick, disabled = false, active = false,
}: {
    children: React.ReactNode;
    title?: string;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClick}
                    disabled={disabled}
                    className={cn(
                        "size-9 border border-white/[0.08] text-white/90",
                        active && "bg-white/[0.1] border-white/25",
                        !disabled && "hover:bg-white/[0.08] hover:border-white/20 hover:text-white"
                    )}
                >
                    {children}
                </Button>
            </TooltipTrigger>
            {title && <TooltipContent side="bottom">{title}</TooltipContent>}
        </Tooltip>
    );
}

function DropdownPanel({
    children,
    anchor = "top",
}: {
    children: React.ReactNode;
    anchor?: "top" | "bottom";
}) {
    const isBottom = anchor === "bottom";
    return (
        <div
            className={cn(
                "fixed left-0 right-0 bg-zinc-950/97 overflow-y-auto px-6 py-4",
                "font-mono text-white/92",
                isBottom
                    ? "bottom-0 border-t border-white/[0.08] shadow-[0_-8px_32px_rgba(0,0,0,0.5)]"
                    : "top-[44px] border-b border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
            )}
            style={{ maxHeight: "36vh", zIndex: 49 }}
        >
            {children}
        </div>
    );
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[11px] tracking-[0.18em] text-white/75 uppercase mb-2.5 mt-3.5 first:mt-0">
        {children}
    </div>
);

function SliderRowUi({
    label, min, max, step, value, onChange, displayValue,
}: {
    label: string; min: number; max: number; step: number;
    value: number; onChange: (v: number) => void; displayValue: string;
}) {
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

function ActionBtn({
    children, onClick, disabled = false, variant = "default",
}: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: "default" | "danger";
}) {
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
        >
            {children}
        </Button>
    );
}

// ─── main component ──────────────────────────────────────────────────────────

type MenuId = "junction" | "session" | "config" | null;

export default function AppHeader({ onExitAction }: { onExitAction?: () => void }) {
    const [openMenu, setOpenMenu] = useState<MenuId>(null);
    const [joinCode, setJoinCode] = useState("");

    const {
        isConfigConfirmed, simIsRunning, carsReady, junction,
        confirmConfig, resetConfig, startSim, simIsPaused,
        pauseSim, resumeSim, haltSim, stats,
        setJunction, simConfig, setSimConfig,
        selectedExits, setSelectedExits,
        objectCounter, setObjectCounter,
        followedVehicleId, followedVehicleStats,
    } = useJModellerContext();

    const {
        isHost, hostId, connections, createHost, joinHost, send, disconnect,
        isConnecting, connectionError, connectedPeerIds,
    } = usePeer();

    // ── peer effects ──────────────────────────────────────────────────────
    const clientHandlerRef = useRef<(data: unknown) => void>(null!);
    clientHandlerRef.current = (data: unknown) => {
        const msg = data as NetMessage;
        if (msg.type === "INIT_CONFIG") {
            setJunction(msg.appdata.junctionConfig);
            setSimConfig(msg.appdata.simulationConfig);
        }
        if (msg.type === "START")  { startSim(); }
        if (msg.type === "PAUSE")  { pauseSim(); }
        if (msg.type === "RESUME") { resumeSim(); }
        if (msg.type === "HALT")   { haltSim(); }
    };

    const buildSharedState = (): SharedState => ({
        junctionConfig: junction,
        simulationConfig: simConfig,
    });

    useEffect(() => {
        if (isHost) return;
        const conn = connections[0];
        if (!conn) return;
        const handler = (data: unknown) => clientHandlerRef.current(data);
        conn.on("data", handler);
        return () => { conn.off("data", handler); };
    }, [connections, isHost]);

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

    useEffect(() => {
        if (!isHost) return;
        send({ type: "INIT_CONFIG", appdata: buildSharedState() });
    }, [junction, simConfig]);

    useEffect(() => {
        if (isHost || connections.length === 0) return;
        const interval = setInterval(() => { send({ type: "PING" }); }, 3000);
        return () => clearInterval(interval);
    }, [isHost, connections.length, send]);

    // ── junction helpers ──────────────────────────────────────────────────
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

    // ── sim config helper ─────────────────────────────────────────────────
    type ConfigPath = readonly (string | number)[];
    const setByPath = <T extends object>(obj: T, path: ConfigPath, value: number): T => {
        const [head, ...rest] = path;
        if (!head) return obj;
        return { ...obj, [head]: rest.length === 0 ? value : setByPath((obj as any)[head], rest, value) };
    };
    const handleN = (path: ConfigPath, value: number) =>
        setSimConfig(prev => setByPath(prev, path, value));

    // ── misc ──────────────────────────────────────────────────────────────
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

    // ── render ────────────────────────────────────────────────────────────
    return (
        <>
            <style>{`
                @keyframes jmePulse {
                    0%, 100% { opacity: 0.3; }
                    50% { opacity: 1; }
                }
            `}</style>

            {/* backdrop to close menus */}
            {openMenu && (
                <div
                    onClick={() => setOpenMenu(null)}
                    className="fixed inset-0"
                    style={{ zIndex: 48 }}
                />
            )}

            {/* ── header bar ── */}
            <div
                className="fixed top-0 left-0 right-0 h-[44px] bg-zinc-950/95 border-b border-white/[0.08] flex items-center justify-between backdrop-blur-xl px-3 font-mono"
                style={{ zIndex: 50 }}
            >
                {/* left: exit + logo + menus */}
                <div className="flex items-center">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 mr-2.5 border border-white/[0.08] text-zinc-400 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 flex-shrink-0"
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

                    {(["junction", "session", "config"] as MenuId[]).map(id => {
                        const label = id!.charAt(0).toUpperCase() + id!.slice(1);
                        const isOpen = openMenu === id;
                        return (
                            <Button
                                key={id}
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleMenu(id)}
                                className={cn(
                                    "gap-1 px-2.5 text-[13px] tracking-wide text-white/82 hover:text-white hover:bg-white/[0.07] rounded",
                                    isOpen && "bg-white/[0.1] text-white"
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
                <div className="flex items-center gap-1.5">
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
                            onClick={confirmConfig}
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
                    >
                        <Square size={17} />
                    </IconBtn>
                </div>
            </div>

            {/* ── JUNCTION dropdown ── */}
            {openMenu === "junction" && (
                <DropdownPanel>
                    <div className="flex items-start">
                        {/* left col: add buttons */}
                        <div className="w-[220px] flex-shrink-0 pr-6 border-r border-white/[0.08]">
                            <SectionTitle>Add Junction</SectionTitle>
                            <div className="flex flex-col gap-1.5 mb-2">
                                <ActionBtn onClick={addNewIntersection} disabled={isConfigConfirmed || simIsRunning || isClientConnected}>
                                    <PlusSquare size={14} /> Intersection
                                </ActionBtn>
                                <ActionBtn onClick={addNewRoundabout} disabled={isConfigConfirmed || simIsRunning || isClientConnected}>
                                    <PlusSquare size={14} /> Roundabout
                                </ActionBtn>
                            </div>
                            <SectionTitle>Exit Links</SectionTitle>
                            <ActionBtn onClick={addNewLink} disabled={selectedExits.length !== 2 || isConfigConfirmed || simIsRunning || isClientConnected}>
                                <Link2 size={14} /> Link Selected Exits{selectedExits.length === 2 ? "" : " (select 2)"}
                            </ActionBtn>
                        </div>
                        {/* right col: existing links */}
                        <div className="flex-1 pl-6 min-w-0">
                            <SectionTitle>Current Links</SectionTitle>
                            {junction.junctionLinks.length === 0 ? (
                                <p className="text-xs text-white/75 m-0">No links yet.</p>
                            ) : (
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
                                                    disabled={isConfigConfirmed || simIsRunning || isClientConnected}
                                                >
                                                    <Trash2 size={13} />
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </DropdownPanel>
            )}

            {/* ── SESSION dropdown ── */}
            {openMenu === "session" && (
                <DropdownPanel>
                    <div className="grid gap-8" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                        {/* col 1: connection + car models */}
                        <div>
                            <SectionTitle>Connection</SectionTitle>
                            <div className={cn("text-[13px] mb-1.5", connectionError ? "text-red-400" : isConnected ? "text-white" : "text-white/75")}>
                                {connectionError ?? (isConnecting ? "Connecting…" : isConnected ? "Connected" : "Not connected")}
                            </div>
                            <Progress
                                value={isConnected ? 100 : 40}
                                className={cn("h-[3px] mb-3", isConnecting && !isConnected && "animate-pulse")}
                            />
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
                                    <ActionBtn variant="danger" onClick={() => { disconnect(); setOpenMenu(null); }}>
                                        <LogOut size={13} /> Disconnect
                                    </ActionBtn>
                                </div>
                            )}
                        </div>
                    </div>
                </DropdownPanel>
            )}

            {/* ── CONFIG dropdown ── */}
            {openMenu === "config" && isConfigConfirmed && !simIsRunning && (
                <DropdownPanel>
                    {isClientConnected && (
                        <p className="text-xs text-zinc-500 mb-3 tracking-wide">
                            VIEW ONLY — config is controlled by the host
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
                            <SliderRowUi label="Spawn Rate (veh/s)" min={0} max={10} step={0.1} value={simConfig.spawning.spawnRate} onChange={v => handleN(["spawning", "spawnRate"], v)} displayValue={simConfig.spawning.spawnRate.toFixed(1)} />
                            <SliderRowUi label="Max Vehicles" min={10} max={500} step={10} value={simConfig.spawning.maxVehicles} onChange={v => handleN(["spawning", "maxVehicles"], v)} displayValue={String(simConfig.spawning.maxVehicles)} />
                            <SliderRowUi label="Max Spawn Attempts" min={1} max={50} step={1} value={simConfig.spawning.maxSpawnAttemptsPerFrame} onChange={v => handleN(["spawning", "maxSpawnAttemptsPerFrame"], v)} displayValue={String(simConfig.spawning.maxSpawnAttemptsPerFrame)} />
                            <SliderRowUi label="Max Spawn Queue" min={5} max={200} step={5} value={simConfig.spawning.maxSpawnQueue} onChange={v => handleN(["spawning", "maxSpawnQueue"], v)} displayValue={String(simConfig.spawning.maxSpawnQueue)} />
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
                            <SectionTitle>Car Classes</SectionTitle>
                            <div className="grid gap-y-1.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                                {carClasses.map(cc => {
                                    const enabled = simConfig.rendering.enabledCarClasses.includes(cc.bodyType);
                                    return (
                                        <div key={cc.bodyType} className="flex items-center gap-1.5">
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
                                            <Label htmlFor={`cc-${cc.bodyType}`} className={cn("text-xs cursor-pointer", enabled ? "text-white/92" : "text-white/50")}>
                                                {cc.bodyType}
                                            </Label>
                                        </div>
                                    );
                                })}
                            </div>
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
                </DropdownPanel>
            )}
            {openMenu === "config" && (!isConfigConfirmed || simIsRunning) && (
                <DropdownPanel>
                    <p className="text-[13px] text-white/75 m-0">
                        {simIsRunning
                            ? "Config is locked while the simulation is running."
                            : "Confirm the junction config first to access simulation settings."}
                    </p>
                </DropdownPanel>
            )}

            {/* ── VEHICLE HUD ── */}
            {simIsRunning && followedVehicleId !== null && (
                <DropdownPanel anchor="bottom">
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex gap-10 items-end flex-wrap justify-center">
                            {[
                                ["SPEED", followedVehicleStats ? `${(followedVehicleStats.speed * 3.6).toFixed(1)} km/h` : "—"],
                                ["TARGET", followedVehicleStats ? `${(followedVehicleStats.preferredSpeed * 3.6).toFixed(1)} km/h` : "—"],
                                ["ACCEL", followedVehicleStats ? `${followedVehicleStats.accel >= 0 ? "+" : ""}${followedVehicleStats.accel.toFixed(2)} m/s²` : "—"],
                                ["PHASE", followedVehicleStats?.phase ?? "—"],
                                ["TYPE", followedVehicleStats?.bodyType ?? "—"],
                                ["ID", followedVehicleStats ? `#${followedVehicleStats.id}` : "—"],
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
                                {followedVehicleStats?.segment ?? "—"}
                            </span>
                        </div>
                        <div className="text-[11px] text-white/75 flex items-center gap-1.5">
                            Press <Kbd>Backspace</Kbd> to exit first-person view
                        </div>
                    </div>
                </DropdownPanel>
            )}

            {/* ── STATS panel ── */}
            {simIsRunning && followedVehicleId === null && (
                <DropdownPanel anchor="bottom">
                    <div className="grid gap-x-8 gap-y-0.5 text-[13px] mb-2.5" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                        {[
                            ["Active", stats.active],
                            ["Spawn Queue", stats.spawnQueue],
                            ["Spawned", stats.spawned],
                            ["Completed", stats.completed],
                            ["Routes", stats.routes],
                            ["Elapsed", `${stats.elapsedTime.toFixed(1)}s`],
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
                                            {obj?.type ?? "junction"} {obj?.name ?? structureID.slice(0, 6)} Exit {exitIndex}:
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
                </DropdownPanel>
            )}
        </>
    );
}
