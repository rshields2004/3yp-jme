"use client";

import { useEffect, useRef, useState } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import { usePeer } from "../context/PeerContext";
import { NetMessage, SharedState } from "../includes/types/peer";
import { defaultIntersectionConfig, defaultRoundaboutConfig } from "../includes/defaults";
import { numberToExcelColumn } from "../includes/utils";
import { carClasses } from "../includes/types/carTypes";
import {
    Play, Pause, Square, Check, RotateCcw,
    ChevronDown, Link2, Trash2, PlusSquare, Copy
} from "lucide-react";

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
        <button
            title={title}
            onClick={onClick}
            disabled={disabled}
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                background: active ? "rgba(161,161,170,0.15)" : "transparent",
                border: `1px solid ${active ? "rgba(161,161,170,0.35)" : "rgba(161,161,170,0.12)"}`,
                borderRadius: 6,
                color: disabled ? "rgba(161,161,170,0.4)" : "rgba(255,255,255,0.95)",
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "all 0.12s",
                fontFamily: "inherit",
            }}
            onMouseEnter={e => !disabled && ((e.currentTarget.style.background = "rgba(161,161,170,0.12)"), (e.currentTarget.style.borderColor = "rgba(161,161,170,0.3)"))}
            onMouseLeave={e => !disabled && ((e.currentTarget.style.background = active ? "rgba(161,161,170,0.15)" : "transparent"), (e.currentTarget.style.borderColor = active ? "rgba(161,161,170,0.35)" : "rgba(161,161,170,0.12)"))}
        >
            {children}
        </button>
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
        <div style={{
            position: "fixed",
            ...(isBottom ? { bottom: 0 } : { top: 44 }),
            left: 0,
            right: 0,
            zIndex: 49,
            background: "rgba(9,9,11,0.97)",
            ...(isBottom
                ? { borderTop: "1px solid rgba(161,161,170,0.12)" }
                : { borderBottom: "1px solid rgba(161,161,170,0.12)" }
            ),
            maxHeight: "36vh",
            overflowY: "auto",
            padding: "16px 24px",
            fontFamily: "'Courier New', monospace",
            color: "rgba(255,255,255,0.92)",
            boxShadow: isBottom ? "0 -8px 32px rgba(0,0,0,0.5)" : "0 8px 32px rgba(0,0,0,0.5)",
        }}>
            {children}
        </div>
    );
}

const PANEL_BG = "rgba(161,161,170,0.06)";
const BORDER = "rgba(161,161,170,0.1)";
const MUTED = "rgba(225,225,230,0.92)";
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 12, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase", marginBottom: 10, marginTop: 14 }}>
        {children}
    </div>
);
const Row = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, ...style }}>{children}</div>
);
const SliderRow = ({
    label, min, max, step, value, onChange, displayValue,
}: {
    label: string; min: number; max: number; step: number;
    value: number; onChange: (v: number) => void; displayValue: string;
}) => (
    <div style={{ marginBottom: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2, color: "rgba(235,235,240,0.95)" }}>
            <span>{label}</span>
            <span style={{ color: "rgba(255,255,255,0.98)", fontVariantNumeric: "tabular-nums" }}>{displayValue}</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(Number(e.target.value))}
            style={{ width: "100%", accentColor: "rgba(161,161,170,0.8)", cursor: "pointer" }}
        />
    </div>
);

const ActionBtn = ({
    children, onClick, disabled = false, variant = "default",
}: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: "default" | "danger";
}) => (
    <button
        onClick={onClick}
        disabled={disabled}
        style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 12px",
            fontSize: 13,
            letterSpacing: "0.06em",
            background: variant === "danger" ? "rgba(239,68,68,0.08)" : PANEL_BG,
            border: `1px solid ${variant === "danger" ? "rgba(239,68,68,0.25)" : BORDER}`,
            borderRadius: 5,
            color: variant === "danger" ? "rgba(239,68,68,0.9)" : "rgba(245,245,248,0.95)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.4 : 1,
            fontFamily: "inherit",
            transition: "all 0.12s",
        }}
    >
        {children}
    </button>
);

// ─── main component ──────────────────────────────────────────────────────────

type MenuId = "junction" | "session" | "config" | null;

export default function AppHeader() {
    const [openMenu, setOpenMenu] = useState<MenuId>(null);
    const [joinCode, setJoinCode] = useState("");
    const menuRefs = useRef<Record<string, HTMLButtonElement | null>>({});

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
        isHost, hostId, connections, createHost, joinHost, send,
        isConnecting, connectionError, connectedPeerIds,
        pendingInitConfig, clearPendingInitConfig,
    } = usePeer();

    // ── peer effects (moved from SimControlPanel) ─────────────────────────
    // Consume any INIT_CONFIG that arrived while AppHeader was not mounted
    useEffect(() => {
        if (isHost || !pendingInitConfig) return;
        setJunction(pendingInitConfig.junctionConfig);
        setSimConfig(pendingInitConfig.simulationConfig);
        clearPendingInitConfig();
    }, []);

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
    const connStatus = connectionError ? "error" : isConnecting ? "connecting" : isConnected ? "connected" : "idle";
    const dotColor: Record<string, string> = {
        connected: "rgba(161,161,170,0.9)",
        connecting: "rgba(161,161,170,0.5)",
        error: "rgba(239,68,68,0.8)",
        idle: "rgba(161,161,170,0.2)",
    };

    // ── menu button positions ─────────────────────────────────────────────


    // ── render ────────────────────────────────────────────────────────────
    return (
        <>
            <style>{`
                @keyframes jmePulse {
                    0%, 100% { opacity: 0.3; }
                    50% { opacity: 1; }
                }
                .jme-hbtn:hover { color: rgba(255,255,255,0.95) !important; background: rgba(161,161,170,0.07) !important; }
            `}</style>

            {/* ── backdrop to close menus ── */}
            {openMenu && (
                <div
                    onClick={() => setOpenMenu(null)}
                    style={{ position: "fixed", inset: 0, zIndex: 48 }}
                />
            )}

            {/* ── header bar ── */}
            <div style={{
                position: "fixed",
                top: 0, left: 0, right: 0,
                height: 44,
                background: "rgba(9,9,11,0.95)",
                borderBottom: "1px solid rgba(161,161,170,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                zIndex: 50,
                backdropFilter: "blur(12px)",
                padding: "0 12px",
                fontFamily: "var(--font-mono), 'Courier New', monospace",
            }}>
                {/* left: logo + menus */}
                <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/logo.png"
                        alt="JME"
                        style={{ height: 26, width: "auto", marginRight: 16, userSelect: "none", display: "block" }}
                    />

                    {(["junction", "session", "config"] as MenuId[]).map(id => {
                        const label = id!.charAt(0).toUpperCase() + id!.slice(1);
                        const isOpen = openMenu === id;
                        return (
                            <button
                                key={id}
                                ref={el => { menuRefs.current[id!] = el; }}
                                className="jme-hbtn"
                                onClick={() => toggleMenu(id)}
                                style={{
                                    display: "flex", alignItems: "center", gap: 4,
                                    padding: "5px 10px",
                                    background: isOpen ? "rgba(161,161,170,0.1)" : "transparent",
                                    border: "none",
                                    borderRadius: 4,
                                    color: isOpen ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.82)",
                                    fontSize: 13,
                                    letterSpacing: "0.06em",
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                    transition: "color 0.1s, background 0.1s",
                                }}
                            >
                                {label}
                                <ChevronDown
                                    size={13}
                                    style={{
                                        opacity: 0.7,
                                        transform: isOpen ? "rotate(180deg)" : "none",
                                        transition: "transform 0.15s",
                                    }}
                                />
                            </button>
                        );
                    })}
                </div>

                {/* right: sim control icons */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {/* connection status */}
                    <div title={connStatus} style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: dotColor[connStatus],
                        flexShrink: 0,
                        marginRight: 4,
                        transition: "background 0.3s",
                    }} />

                    {/* loading badge */}
                    {simIsRunning && !carsReady && (
                        <span style={{
                            fontSize: 11, letterSpacing: "0.1em",
                            color: "rgba(225,225,230,0.92)",
                            animation: "jmePulse 1.5s ease-in-out infinite",
                        }}>LOADING</span>
                    )}

                    {/* confirm / back */}
                    {!isConfigConfirmed ? (
                        <IconBtn
                            title="Confirm Config"
                            disabled={junction.junctionObjects.length === 0 || simIsRunning}
                            onClick={confirmConfig}
                        >
                            <Check size={17} />
                        </IconBtn>
                    ) : !simIsRunning ? (
                        <IconBtn title="Back to Config" onClick={resetConfig}>
                            <RotateCcw size={17} />
                        </IconBtn>
                    ) : null}

                    {/* divider */}
                    <div style={{ width: 1, height: 20, background: "rgba(161,161,170,0.12)", margin: "0 2px" }} />

                    {/* start */}
                    <IconBtn
                        title="Start Simulation"
                        disabled={simIsRunning || !carsReady || !isConfigConfirmed}
                        active={simIsRunning && !simIsPaused}
                        onClick={() => { send({ type: "START" }); startSim(); }}
                    >
                        <Play size={17} />
                    </IconBtn>

                    {/* pause / resume */}
                    <IconBtn
                        title={simIsPaused ? "Resume" : "Pause"}
                        disabled={!simIsRunning}
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
                        disabled={!simIsRunning}
                        onClick={() => { send({ type: "HALT" }); haltSim(); }}
                    >
                        <Square size={17} />
                    </IconBtn>
                </div>
            </div>

            {/* ── JUNCTION dropdown ── */}
            {openMenu === "junction" && (
                <DropdownPanel>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
                        {/* left col: add buttons */}
                        <div style={{ width: 220, flexShrink: 0, paddingRight: 24, borderRight: `1px solid rgba(161,161,170,0.12)` }}>
                            <SectionTitle>Add Junction</SectionTitle>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                                <ActionBtn onClick={addNewIntersection} disabled={isConfigConfirmed || simIsRunning}>
                                    <PlusSquare size={14} /> Intersection
                                </ActionBtn>
                                <ActionBtn onClick={addNewRoundabout} disabled={isConfigConfirmed || simIsRunning}>
                                    <PlusSquare size={14} /> Roundabout
                                </ActionBtn>
                            </div>
                            <SectionTitle>Exit Links</SectionTitle>
                            <ActionBtn onClick={addNewLink} disabled={selectedExits.length !== 2 || isConfigConfirmed || simIsRunning}>
                                <Link2 size={14} /> Link Selected Exits{selectedExits.length === 2 ? "" : " (select 2)"}
                            </ActionBtn>
                        </div>
                        {/* right col: existing links */}
                        <div style={{ flex: 1, paddingLeft: 24, minWidth: 0 }}>
                            <SectionTitle>Current Links</SectionTitle>
                            {junction.junctionLinks.length === 0 ? (
                                <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>No links yet.</p>
                            ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 4 }}>
                                    {junction.junctionLinks.map(link => {
                                        const objA = junction.junctionObjects.find(o => o.id === link.objectPair[0].structureID);
                                        const objB = junction.junctionObjects.find(o => o.id === link.objectPair[1].structureID);
                                        return (
                                            <div key={link.id} style={{
                                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                                padding: "5px 8px", background: PANEL_BG,
                                                border: `1px solid ${BORDER}`, borderRadius: 4, fontSize: 12,
                                            }}>
                                                <span style={{ color: "rgba(255,255,255,0.92)" }}>
                                                    {objA?.name ?? "?"} Exit {link.objectPair[0].exitIndex}
                                                    <span style={{ opacity: 0.4, margin: "0 6px" }}>↔</span>
                                                    {objB?.name ?? "?"} Exit {link.objectPair[1].exitIndex}
                                                </span>
                                                <button onClick={() => removeLink(link.id)} disabled={isConfigConfirmed || simIsRunning}
                                                    style={{ background: "none", border: "none", color: "rgba(239,68,68,0.5)", cursor: "pointer", padding: "0 2px", lineHeight: 0, opacity: isConfigConfirmed || simIsRunning ? 0.2 : 1 }}>
                                                    <Trash2 size={13} />
                                                </button>
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
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 32px" }}>
                        {/* col 1: connection status */}
                        <div>
                            <SectionTitle>Connection</SectionTitle>
                            <div style={{ fontSize: 13, marginBottom: 6, color: connectionError ? "rgba(239,68,68,0.9)" : isConnected ? "rgba(255,255,255,0.95)" : MUTED }}>
                                {connectionError ?? (isConnecting ? "Connecting…" : isConnected ? "Connected" : "Not connected")}
                            </div>
                            <div style={{ height: 3, background: "rgba(161,161,170,0.08)", borderRadius: 2, overflow: "hidden", marginBottom: 12 }}>
                                <div style={{ height: "100%", width: isConnected ? "100%" : "40%", background: connectionError ? "rgba(239,68,68,0.6)" : "rgba(161,161,170,0.5)", borderRadius: 2, animation: isConnecting ? "jmePulse 1.5s ease-in-out infinite" : "none", transition: "width 0.3s, background 0.3s" }} />
                            </div>
                            <SectionTitle>Car Models</SectionTitle>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ flex: 1, height: 3, background: "rgba(161,161,170,0.08)", borderRadius: 2, overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: carsReady ? "100%" : "30%", background: carsReady ? "rgba(161,161,170,0.7)" : "rgba(161,161,170,0.4)", borderRadius: 2, animation: carsReady ? "none" : "jmePulse 1.5s ease-in-out infinite", transition: carsReady ? "width 0.3s" : "none" }} />
                                </div>
                                <span style={{ fontSize: 12, color: MUTED }}>{carsReady ? "Ready" : "Loading…"}</span>
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
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 5, marginBottom: 8 }}>
                                        <span style={{ flex: 1, fontSize: 13, letterSpacing: "0.1em", color: "rgba(255,255,255,0.95)" }}>{hostId}</span>
                                        <button onClick={() => navigator.clipboard.writeText(hostId ?? "")} title="Copy" style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", lineHeight: 0, padding: 0 }}><Copy size={14} /></button>
                                    </div>
                                    {connectedPeerIds.length === 0 ? (
                                <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>Waiting for peers…</p>
                                    ) : (
                                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                            {connectedPeerIds.map((pid, i) => (
                                                <div key={pid} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 4, fontSize: 12 }}>
                                                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(161,161,170,0.8)" }} />
                                                    <span style={{ color: MUTED }}>Peer {i + 1}</span>
                                                    <span style={{ marginLeft: "auto", opacity: 0.5, fontSize: 11 }}>{pid.slice(0, 8)}…</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                            {!isHost && isConnected && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.92)", margin: 0 }}>✓ Connected to host</p>}
                        </div>
                        {/* col 3: join */}
                        <div>
                            <SectionTitle>Join Session</SectionTitle>
                            {!isConnected && !isHost && (
                                <div style={{ display: "flex", gap: 6 }}>
                                    <input placeholder="xxxx-xxxx-xxxx" value={joinCode} onChange={e => setJoinCode(e.target.value)} onKeyDown={e => e.key === "Enter" && joinHost(joinCode)}
                                        style={{ flex: 1, padding: "6px 10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(161,161,170,0.2)", borderRadius: 4, color: "rgba(255,255,255,0.92)", fontSize: 12, fontFamily: "inherit", outline: "none" }}
                                    />
                                    <ActionBtn onClick={() => joinHost(joinCode)} disabled={!joinCode.trim() || isConnecting}>Join</ActionBtn>
                                </div>
                            )}
                            {(isConnected || isHost) && <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>Already in a session.</p>}
                        </div>
                    </div>
                </DropdownPanel>
            )}

            {/* ── CONFIG dropdown ── */}
            {openMenu === "config" && isConfigConfirmed && !simIsRunning && (
                <DropdownPanel>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 32px" }}>
                        {/* col 1: spawning */}
                        <div>
                            <SectionTitle>Spawning</SectionTitle>
                            <div style={{ marginBottom: 8 }}>
                                <div style={{ fontSize: 12, marginBottom: 3, color: "rgba(255,255,255,0.95)" }}>Seed</div>
                                <input type="text" value={simConfig.simSeed} onChange={e => setSimConfig(prev => ({ ...prev, simSeed: e.target.value }))}
                                    style={{ width: "100%", padding: "5px 8px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(161,161,170,0.2)", borderRadius: 4, color: "rgba(255,255,255,0.92)", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
                                />
                            </div>
                            <SliderRow label="Spawn Rate (veh/s)" min={0} max={10} step={0.1} value={simConfig.spawning.spawnRate} onChange={v => handleN(["spawning", "spawnRate"], v)} displayValue={simConfig.spawning.spawnRate.toFixed(1)} />
                            <SliderRow label="Max Vehicles" min={10} max={500} step={10} value={simConfig.spawning.maxVehicles} onChange={v => handleN(["spawning", "maxVehicles"], v)} displayValue={String(simConfig.spawning.maxVehicles)} />
                            <SliderRow label="Max Spawn Attempts" min={1} max={50} step={1} value={simConfig.spawning.maxSpawnAttemptsPerFrame} onChange={v => handleN(["spawning", "maxSpawnAttemptsPerFrame"], v)} displayValue={String(simConfig.spawning.maxSpawnAttemptsPerFrame)} />
                            <SliderRow label="Max Spawn Queue" min={5} max={200} step={5} value={simConfig.spawning.maxSpawnQueue} onChange={v => handleN(["spawning", "maxSpawnQueue"], v)} displayValue={String(simConfig.spawning.maxSpawnQueue)} />
                            <SectionTitle>Motion</SectionTitle>
                            <SliderRow label="Initial Speed" min={0} max={20} step={0.5} value={simConfig.motion.initialSpeed} onChange={v => handleN(["motion", "initialSpeed"], v)} displayValue={simConfig.motion.initialSpeed.toFixed(1)} />
                            <SliderRow label="Preferred Speed" min={1} max={30} step={0.5} value={simConfig.motion.preferredSpeed} onChange={v => handleN(["motion", "preferredSpeed"], v)} displayValue={simConfig.motion.preferredSpeed.toFixed(1)} />
                            <SliderRow label="Max Accel" min={0.5} max={15} step={0.5} value={simConfig.motion.maxAccel} onChange={v => handleN(["motion", "maxAccel"], v)} displayValue={simConfig.motion.maxAccel.toFixed(1)} />
                            <SliderRow label="Max Decel" min={0.5} max={15} step={0.5} value={simConfig.motion.maxDecel} onChange={v => handleN(["motion", "maxDecel"], v)} displayValue={simConfig.motion.maxDecel.toFixed(1)} />
                            <SliderRow label="Comfort Decel" min={0.5} max={15} step={0.5} value={simConfig.motion.comfortDecel} onChange={v => handleN(["motion", "comfortDecel"], v)} displayValue={simConfig.motion.comfortDecel.toFixed(1)} />
                        </div>
                        {/* col 2: spacing + rendering + car classes */}
                        <div>
                            <SectionTitle>Spacing</SectionTitle>
                            <SliderRow label="Min Bumper Gap" min={0} max={5} step={0.1} value={simConfig.spacing.minBumperGap} onChange={v => handleN(["spacing", "minBumperGap"], v)} displayValue={simConfig.spacing.minBumperGap.toFixed(1)} />
                            <SliderRow label="Time Headway (s)" min={0.1} max={5} step={0.1} value={simConfig.spacing.timeHeadway} onChange={v => handleN(["spacing", "timeHeadway"], v)} displayValue={simConfig.spacing.timeHeadway.toFixed(1)} />
                            <SliderRow label="Stop Line Offset" min={0} max={2} step={0.01} value={simConfig.spacing.stopLineOffset} onChange={v => handleN(["spacing", "stopLineOffset"], v)} displayValue={simConfig.spacing.stopLineOffset.toFixed(2)} />
                            <SectionTitle>Rendering</SectionTitle>
                            <SliderRow label="Y Offset" min={0} max={1} step={0.01} value={simConfig.rendering.yOffset} onChange={v => handleN(["rendering", "yOffset"], v)} displayValue={simConfig.rendering.yOffset.toFixed(2)} />
                            <SectionTitle>Car Classes</SectionTitle>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 8px" }}>
                                {carClasses.map(cc => {
                                    const enabled = simConfig.rendering.enabledCarClasses.includes(cc.bodyType);
                                    return (
                                    <label key={cc.bodyType} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: enabled ? "rgba(255,255,255,0.95)" : MUTED, cursor: "pointer" }}>
                                            <input type="checkbox" checked={enabled} onChange={() => setSimConfig(prev => { const cur = prev.rendering.enabledCarClasses; const next = enabled ? cur.filter(b => b !== cc.bodyType) : [...cur, cc.bodyType]; if (next.length === 0) return prev; return { ...prev, rendering: { ...prev.rendering, enabledCarClasses: next } }; })} style={{ accentColor: "rgba(161,161,170,0.8)" }} />
                                            {cc.bodyType}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                        {/* col 3: roundabout controller */}
                        <div>
                            <SectionTitle>Roundabout Controller</SectionTitle>
                            <SliderRow label="Min Gap Distance" min={0.5} max={10} step={0.5} value={simConfig.controllers.roundabout.roundaboutMinGap} onChange={v => handleN(["controllers", "roundabout", "roundaboutMinGap"], v)} displayValue={simConfig.controllers.roundabout.roundaboutMinGap.toFixed(1)} />
                            <SliderRow label="Min Time Gap (s)" min={0.1} max={5} step={0.1} value={simConfig.controllers.roundabout.roundaboutMinTimeGap} onChange={v => handleN(["controllers", "roundabout", "roundaboutMinTimeGap"], v)} displayValue={simConfig.controllers.roundabout.roundaboutMinTimeGap.toFixed(1)} />
                            <SliderRow label="Safe Entry Distance" min={5} max={50} step={1} value={simConfig.controllers.roundabout.roundaboutSafeEntryDist} onChange={v => handleN(["controllers", "roundabout", "roundaboutSafeEntryDist"], v)} displayValue={simConfig.controllers.roundabout.roundaboutSafeEntryDist.toFixed(0)} />
                            <SliderRow label="Entry Timeout (s)" min={0.1} max={5} step={0.1} value={simConfig.controllers.roundabout.roundaboutEntryTimeout} onChange={v => handleN(["controllers", "roundabout", "roundaboutEntryTimeout"], v)} displayValue={simConfig.controllers.roundabout.roundaboutEntryTimeout.toFixed(1)} />
                            <SliderRow label="Min Angular Sep (°)" min={5} max={90} step={1} value={Math.round(simConfig.controllers.roundabout.roundaboutMinAngularSep * 180 / Math.PI)} onChange={v => handleN(["controllers", "roundabout", "roundaboutMinAngularSep"], v * Math.PI / 180)} displayValue={`${Math.round(simConfig.controllers.roundabout.roundaboutMinAngularSep * 180 / Math.PI)}°`} />
                        </div>
                        {/* col 4: intersection controller */}
                        <div>
                            <SectionTitle>Intersection Controller</SectionTitle>
                            <SliderRow label="Green Time (s)" min={0.1} max={30} step={0.1} value={simConfig.controllers.intersection.intersectionGreenTime} onChange={v => handleN(["controllers", "intersection", "intersectionGreenTime"], v)} displayValue={simConfig.controllers.intersection.intersectionGreenTime.toFixed(1)} />
                            <SliderRow label="Amber Time (s)" min={0.1} max={10} step={0.1} value={simConfig.controllers.intersection.intersectionAmberTime} onChange={v => handleN(["controllers", "intersection", "intersectionAmberTime"], v)} displayValue={simConfig.controllers.intersection.intersectionAmberTime.toFixed(1)} />
                            <SliderRow label="Red-Amber Time (s)" min={0.1} max={5} step={0.1} value={simConfig.controllers.intersection.intersectionRedAmberTime} onChange={v => handleN(["controllers", "intersection", "intersectionRedAmberTime"], v)} displayValue={simConfig.controllers.intersection.intersectionRedAmberTime.toFixed(1)} />
                            <SliderRow label="All-Red Time (s)" min={0.1} max={5} step={0.1} value={simConfig.controllers.intersection.intersectionAllRedTime} onChange={v => handleN(["controllers", "intersection", "intersectionAllRedTime"], v)} displayValue={simConfig.controllers.intersection.intersectionAllRedTime.toFixed(1)} />
                        </div>
                    </div>
                </DropdownPanel>
            )}
            {openMenu === "config" && (!isConfigConfirmed || simIsRunning) && (
                <DropdownPanel>
                    <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
                        {simIsRunning
                            ? "Config is locked while the simulation is running."
                            : "Confirm the junction config first to access simulation settings."}
                    </p>
                </DropdownPanel>
            )}

            {/* ── VEHICLE HUD — shown in first-person follow mode ── */}
            {simIsRunning && followedVehicleId !== null && (
                <DropdownPanel anchor="bottom">
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                        <div style={{ display: "flex", gap: 40, alignItems: "flex-end", flexWrap: "wrap", justifyContent: "center" }}>
                            {[
                                ["SPEED", followedVehicleStats ? `${(followedVehicleStats.speed * 3.6).toFixed(1)} km/h` : "—"],
                                ["TARGET", followedVehicleStats ? `${(followedVehicleStats.preferredSpeed * 3.6).toFixed(1)} km/h` : "—"],
                                ["ACCEL", followedVehicleStats ? `${followedVehicleStats.accel >= 0 ? "+" : ""}${followedVehicleStats.accel.toFixed(2)} m/s²` : "—"],
                                ["PHASE", followedVehicleStats?.phase ?? "—"],
                                ["TYPE", followedVehicleStats?.bodyType ?? "—"],
                                ["ID", followedVehicleStats ? `#${followedVehicleStats.id}` : "—"],
                            ].map(([label, value]) => (
                                <div key={String(label)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                    <span style={{ fontSize: 11, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
                                    <span style={{ fontSize: 30, fontWeight: 700, color: "rgba(255,255,255,0.97)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 11, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase" }}>ON</span>
                            <span style={{ fontSize: 17, fontWeight: 600, color: "rgba(255,255,255,0.95)" }}>
                                {followedVehicleStats?.segment ?? "—"}
                            </span>
                        </div>
                        <div style={{ fontSize: 11, color: MUTED }}>
                            Press <kbd style={{ background: "rgba(255,255,255,0.1)", border: `1px solid ${BORDER}`, borderRadius: 3, padding: "1px 5px", fontFamily: "inherit" }}>Backspace</kbd> to exit first-person view
                        </div>
                    </div>
                </DropdownPanel>
            )}

            {/* ── STATS panel — auto-shown when sim is running ── */}
            {simIsRunning && followedVehicleId === null && (
                <DropdownPanel anchor="bottom">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "3px 32px", fontSize: 13, marginBottom: 10 }}>
                        {[
                            ["Active", stats.active],
                            ["Spawn Queue", stats.spawnQueue],
                            ["Spawned", stats.spawned],
                            ["Completed", stats.completed],
                            ["Routes", stats.routes],
                            ["Elapsed", `${stats.elapsedTime.toFixed(1)}s`],
                        ].map(([k, v]) => (
                            <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${BORDER}` }}>
                                <span style={{ color: MUTED }}>{k}</span>
                                <span style={{ color: "rgba(255,255,255,0.95)", fontVariantNumeric: "tabular-nums" }}>{v}</span>
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
                                        <div key={key} style={{ fontSize: 12, color: MUTED, marginBottom: 2 }}>
                                            {obj?.type ?? "junction"} {obj?.name ?? structureID.slice(0, 6)} Exit {exitIndex}:
                                            <span style={{ color: "rgba(255,255,255,0.95)", marginLeft: 4 }}>{q}</span>
                                        </div>
                                    );
                                })}
                        </>
                    )}

                    <SectionTitle>Junctions ({stats.junctions.global.count})</SectionTitle>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 24px", fontSize: 13 }}>
                        {[
                            ["Approaching", stats.junctions.global.approaching],
                            ["Waiting", stats.junctions.global.waiting],
                            ["Inside", stats.junctions.global.inside],
                            ["Exiting", stats.junctions.global.exiting],
                            ["Entered", stats.junctions.global.entered],
                            ["Exited", stats.junctions.global.exited],
                        ].map(([k, v]) => (
                            <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${BORDER}` }}>
                                <span style={{ color: MUTED }}>{k}</span>
                                <span style={{ color: "rgba(255,255,255,0.95)", fontVariantNumeric: "tabular-nums" }}>{v}</span>
                            </div>
                        ))}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                        <span style={{ color: MUTED }}>Avg Wait Time</span>
                        <span style={{ color: "rgba(255,255,255,0.95)", float: "right" }}>{stats.junctions.global.avgWaitTime.toFixed(1)}s</span>
                    </div>
                </DropdownPanel>
            )}
        </>
    );
}
