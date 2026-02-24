"use client";

import { useState } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import { defaultExitConfig } from "../includes/defaults";
import { ExitConfig, ExitRef } from "../includes/types/types";
import { ChevronDown, Trash2 } from "lucide-react";

const MUTED         = "rgba(225,225,230,0.92)";
const BORDER        = "rgba(161,161,170,0.1)";
const PANEL_BG      = "rgba(161,161,170,0.06)";
const HEADER_H      = 44;

// ── tiny helpers ────────────────────────────────────────────────────────────

const SliderRow = ({
    label, min, max, step, value, onChange, display,
}: {
    label: string; min: number; max: number; step: number;
    value: number; onChange: (v: number) => void; display: string;
}) => (
    <div style={{ marginBottom: 7 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2, color: "rgba(235,235,240,0.95)" }}>
            <span>{label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.98)" }}>{display}</span>
        </div>
        <input
            type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(Number(e.target.value))}
            style={{ width: "100%", accentColor: "rgba(161,161,170,0.8)", cursor: "pointer" }}
        />
    </div>
);

// ── per-object config panel ──────────────────────────────────────────────────

function ObjectConfig({ objId }: { objId: string }) {
    const {
        junction, setJunction, removeObject,
        simIsRunning, isConfigConfirmed, simConfig,
    } = useJModellerContext();

    const obj = junction.junctionObjects.find(o => o.id === objId);
    if (!obj) return null;

    const isExitConnected = (exitIndex: number) =>
        junction.junctionLinks.some(l =>
            (l.objectPair[0].structureID === objId && l.objectPair[0].exitIndex === exitIndex) ||
            (l.objectPair[1].structureID === objId && l.objectPair[1].exitIndex === exitIndex)
        );

    // ── handlers ─────────────────────────────────────────────────────────

    const handleNumExits = (value: number) =>
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(o =>
                o.id !== objId ? o : {
                    ...o,
                    config: {
                        ...o.config,
                        numExits: value,
                        exitConfig: Array.from({ length: value }, (_, j) => o.config.exitConfig[j] ?? defaultExitConfig),
                    },
                }
            ),
        }));

    const handleExitLength = (exitIndex: number, value: number) =>
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(o =>
                o.id !== objId ? o : {
                    ...o,
                    config: {
                        ...o.config,
                        exitConfig: o.config.exitConfig.map((ex, i) => i === exitIndex ? { ...ex, exitLength: value } : ex),
                    },
                }
            ),
        }));

    const handleLaneCount = (exitIndex: number, value: number) =>
        setJunction(prev => {
            const link = prev.junctionLinks.find(l => l.objectPair.some(r => r.structureID === objId && r.exitIndex === exitIndex));
            const linkedRef: ExitRef | null = link
                ? link.objectPair.find(r => !(r.structureID === objId && r.exitIndex === exitIndex)) ?? null
                : null;

            return {
                ...prev,
                junctionObjects: prev.junctionObjects.map(o => {
                    const remap = (exitConfig: ExitConfig[]) =>
                        exitConfig.map((ex, i) => {
                            if (i !== exitIndex) return ex;
                            const nli = ex.numLanesIn < 1 || ex.numLanesIn >= value ? Math.floor(value / 2) : ex.numLanesIn;
                            return { ...ex, laneCount: value, numLanesIn: nli };
                        });

                    if (o.id === objId) return { ...o, config: { ...o.config, exitConfig: remap(o.config.exitConfig) } };
                    if (linkedRef && o.id === linkedRef.structureID) {
                        return {
                            ...o,
                            config: {
                                ...o.config,
                                exitConfig: o.config.exitConfig.map((ex, i) => {
                                    if (i !== linkedRef.exitIndex) return ex;
                                    const nli = ex.numLanesIn < 1 || ex.numLanesIn >= value ? Math.floor(value / 2) : ex.numLanesIn;
                                    return { ...ex, laneCount: value, numLanesIn: nli };
                                }),
                            },
                        };
                    }
                    return o;
                }),
            };
        });

    const handleNumLanesIn = (exitIndex: number, value: number) =>
        setJunction(prev => {
            const thisObj = prev.junctionObjects.find(o => o.id === objId);
            if (!thisObj) return prev;
            const link = prev.junctionLinks.find(l => l.objectPair.some(r => r.structureID === objId && r.exitIndex === exitIndex));
            const linkedRef: ExitRef | null = link
                ? link.objectPair.find(r => !(r.structureID === objId && r.exitIndex === exitIndex)) ?? null
                : null;
            const exits = thisObj.config.exitConfig;
            const laneCountHere = exits[exitIndex].laneCount;
            let clamped = Math.max(0, Math.min(value, laneCountHere - 1));
            const totalOutOthers = exits.reduce((s, ex, i) => i === exitIndex ? s : s + (ex.laneCount - ex.numLanesIn), 0);
            clamped = thisObj.type === "roundabout"
                ? Math.min(clamped, thisObj.config.numExits - 1)
                : Math.min(clamped, totalOutOthers);
            clamped = Math.max(0, clamped);

            return {
                ...prev,
                junctionObjects: prev.junctionObjects.map(o => {
                    if (o.id === objId) return { ...o, config: { ...o.config, exitConfig: o.config.exitConfig.map((ex, i) => i === exitIndex ? { ...ex, numLanesIn: clamped } : ex) } };
                    if (linkedRef && o.id === linkedRef.structureID) {
                        return {
                            ...o,
                            config: {
                                ...o.config,
                                exitConfig: o.config.exitConfig.map((ex, i) =>
                                    i !== linkedRef.exitIndex ? ex : { ...ex, numLanesIn: Math.max(0, Math.min(ex.laneCount, ex.laneCount - clamped)) }
                                ),
                            },
                        };
                    }
                    return o;
                }),
            };
        });

    const handleSpawnRate = (exitIndex: number, value: number) =>
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(o =>
                o.id !== objId ? o : { ...o, config: { ...o.config, exitConfig: o.config.exitConfig.map((ex, i) => i === exitIndex ? { ...ex, spawnRate: value } : ex) } }
            ),
        }));

    const clearSpawnRate = (exitIndex: number) =>
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(o => {
                if (o.id !== objId) return o;
                return {
                    ...o,
                    config: {
                        ...o.config,
                        exitConfig: o.config.exitConfig.map((ex, i) => {
                            if (i !== exitIndex) return ex;
                            const { spawnRate, ...rest } = ex;
                            return rest;
                        }),
                    },
                };
            }),
        }));

    // ── render ────────────────────────────────────────────────────────────

    const allConnected = isConfigConfirmed && obj.config.exitConfig.every((_, j) => isExitConnected(j));
    const visibleExits = obj.config.exitConfig
        .map((exit, j) => ({ exit, index: j }))
        .filter(({ index: j }) => !isConfigConfirmed || !isExitConnected(j));

    return (
        <fieldset disabled={simIsRunning} style={{ border: "none", padding: 0, margin: 0 }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                    <div style={{ fontSize: 12, letterSpacing: "0.15em", color: MUTED, textTransform: "uppercase", marginBottom: 2 }}>
                        {obj.type}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,0.95)", letterSpacing: "0.04em" }}>
                        {obj.name}
                    </div>
                </div>
                {!isConfigConfirmed && !simIsRunning && (
                    <button
                        onClick={() => removeObject(obj.id)}
                        title="Delete junction"
                        style={{
                            display: "flex", alignItems: "center", gap: 4,
                            padding: "5px 9px",
                            background: "rgba(239,68,68,0.07)",
                            border: "1px solid rgba(239,68,68,0.2)",
                            borderRadius: 5, color: "rgba(239,68,68,0.7)",
                            fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                        }}
                    >
                        <Trash2 size={13} /> Delete
                    </button>
                )}
            </div>

            {/* Exits count (pre-confirm only) */}
            {!isConfigConfirmed && (
                <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, letterSpacing: "0.12em", color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>Exits</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                            type="range"
                            min={2}
                            max={obj.type === "roundabout" ? 6 : 10}
                            value={obj.config.numExits}
                            onChange={e => handleNumExits(Number(e.target.value))}
                            style={{ flex: 1, accentColor: "rgba(161,161,170,0.8)", cursor: "pointer" }}
                        />
                        <span style={{ fontSize: 14, color: "rgba(255,255,255,0.95)", fontVariantNumeric: "tabular-nums", minWidth: 16, textAlign: "right" }}>
                            {obj.config.numExits}
                        </span>
                    </div>
                </div>
            )}

            {/* All-connected warning */}
            {allConnected && (
                <div style={{
                    padding: "8px 10px",
                    background: "rgba(239,68,68,0.07)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    borderRadius: 5, fontSize: 12,
                    color: "rgba(239,68,68,0.9)",
                    marginBottom: 10,
                }}>
                    All exits are linked — no spawn points available.
                </div>
            )}

            {/* Per-exit config */}
            {visibleExits.map(({ exit, index: j }) => (
                <ExitRow
                    key={j}
                    j={j}
                    exit={exit}
                    obj={obj}
                    isConfigConfirmed={isConfigConfirmed}
                    globalSpawnRate={simConfig.spawning.spawnRate}
                    onLaneCount={v => handleLaneCount(j, v)}
                    onExitLength={v => handleExitLength(j, v)}
                    onNumLanesIn={v => handleNumLanesIn(j, v)}
                    onSpawnRate={v => handleSpawnRate(j, v)}
                    onClearSpawnRate={() => clearSpawnRate(j)}
                />
            ))}
        </fieldset>
    );
}

// ── exit row ─────────────────────────────────────────────────────────────────

function ExitRow({ j, exit, obj, isConfigConfirmed, globalSpawnRate, onLaneCount, onExitLength, onNumLanesIn, onSpawnRate, onClearSpawnRate }: {
    j: number;
    exit: ExitConfig;
    obj: ReturnType<typeof useJModellerContext>["junction"]["junctionObjects"][number];
    isConfigConfirmed: boolean;
    globalSpawnRate: number;
    onLaneCount: (v: number) => void;
    onExitLength: (v: number) => void;
    onNumLanesIn: (v: number) => void;
    onSpawnRate: (v: number) => void;
    onClearSpawnRate: () => void;
}) {
    const [open, setOpen] = useState(true);
    return (
        <div style={{
            marginBottom: 6,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            overflow: "hidden",
        }}>
            {/* exit header */}
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    width: "100%", padding: "7px 10px",
                    background: PANEL_BG,
                    border: "none", cursor: "pointer", fontFamily: "inherit",
                    color: "rgba(255,255,255,0.88)",
                }}
            >
                <span style={{ fontSize: 13, letterSpacing: "0.08em" }}>
                    Exit {j}
                    {isConfigConfirmed && (
                        <span style={{ fontSize: 11, color: MUTED, marginLeft: 6 }}>
                            {obj.id.slice(0, 6)}-{j}
                        </span>
                    )}
                </span>
                <ChevronDown size={14} style={{ opacity: 0.55, transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }} />
            </button>

            {open && (
                <div style={{ padding: "10px 10px 8px" }}>
                    {!isConfigConfirmed && (
                        <>
                            <SliderRow label="Lanes" min={2} max={obj.config.numExits * 2} step={1} value={exit.laneCount} onChange={onLaneCount} display={String(exit.laneCount)} />
                            <SliderRow label="Length" min={obj.type === "roundabout" ? 20 : 10} max={70} step={1} value={exit.exitLength} onChange={onExitLength} display={String(exit.exitLength)} />
                            <SliderRow label="Lanes in" min={1} max={exit.laneCount - 1} step={1} value={exit.numLanesIn} onChange={onNumLanesIn} display={String(exit.numLanesIn)} />
                        </>
                    )}
                    {isConfigConfirmed && (
                        <div>
                            <SliderRow
                                label="Spawn Rate Override (veh/s)"
                                min={0} max={10} step={0.1}
                                value={exit.spawnRate ?? globalSpawnRate}
                                onChange={onSpawnRate}
                                display={exit.spawnRate != null ? exit.spawnRate.toFixed(1) : `${globalSpawnRate.toFixed(1)} (global)`}
                            />
                            {exit.spawnRate != null && (
                                <button
                                    onClick={onClearSpawnRate}
                                    style={{
                                    fontSize: 11, padding: "3px 8px",
                                        background: PANEL_BG,
                                        border: `1px solid ${BORDER}`,
                                        borderRadius: 4,
                                        color: MUTED, cursor: "pointer", fontFamily: "inherit",
                                    }}
                                >
                                    Reset to global
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── main panel ───────────────────────────────────────────────────────────────

export default function SelectionPanel() {
    const { selectedObjects } = useJModellerContext();
    const [collapsed, setCollapsed] = useState(false);

    if (selectedObjects.length === 0) return null;

    // Most-recently selected first, max 2
    const ids = [...selectedObjects].reverse().slice(0, 2);
    const twoSelected = ids.length === 2;

    return (
        <div style={{
            position: "fixed",
            top: HEADER_H,
            left: 0,
            right: 0,
            zIndex: 45,
            maxHeight: "36vh",
            display: "flex",
            flexDirection: "column",
            background: "rgba(9,9,11,0.97)",
            borderBottom: `1px solid ${BORDER}`,
            fontFamily: "var(--font-mono), 'Courier New', monospace",
            color: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
            {/* ── title bar ── */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 24px",
                borderBottom: `1px solid ${BORDER}`,
                flexShrink: 0,
            }}>
                <span style={{ fontSize: 12, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase" }}>
                    Selection{twoSelected ? " — 2 objects" : ""}
                </span>
                <button
                    onClick={() => setCollapsed(c => !c)}
                    title={collapsed ? "Expand" : "Collapse"}
                    style={{
                        background: "none", border: "none",
                        color: MUTED, cursor: "pointer", lineHeight: 0, padding: 2,
                    }}
                >
                    <ChevronDown size={16} style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }} />
                </button>
            </div>

            {!collapsed && (
                <div style={{ overflowY: "auto", flex: 1, padding: "14px 24px" }}>
                    {twoSelected ? (
                        /* ── two objects side by side ── */
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 0", alignItems: "start" }}>
                            <div style={{ paddingRight: 24, borderRight: `1px solid ${BORDER}`, minWidth: 0 }}>
                                <ObjectConfig key={ids[0]} objId={ids[0]} />
                            </div>
                            <div style={{ paddingLeft: 24, minWidth: 0 }}>
                                <ObjectConfig key={ids[1]} objId={ids[1]} />
                            </div>
                        </div>
                    ) : (
                        /* ── single object ── */
                        <ObjectConfig key={ids[0]} objId={ids[0]} />
                    )}
                </div>
            )}
        </div>
    );
}
