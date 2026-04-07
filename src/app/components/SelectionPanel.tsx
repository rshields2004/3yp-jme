/**
 * SelectionPanel.tsx
 *
 * Side panel for editing the selected junction object or exit,
 * including lane counts, exit lengths, and spawn rate overrides.
 */

"use client";

import { useEffect, useState } from "react";
import { useJModellerContext } from "../context/JModellerContext";
import { defaultExitConfig } from "../includes/constants";
import { ExitConfig, ExitRef } from "../includes/types/types";
import { ChevronDown, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { usePeer } from "../context/PeerContext";
import { HEADER_HEIGHT } from "../includes/constants";

/**
 * Labelled slider row for numeric config values in the selection panel.
 * @param label - descriptive text
 * @param min - slider minimum
 * @param max - slider maximum
 * @param step - slider step increment
 * @param value - current value
 * @param onChange - callback with the new value
 * @param display - formatted string shown beside the label
 * @returns the rendered slider row
 */
const SliderRow = ({
    label, min, max, step, value, onChange, display,
}: {
    label: string; min: number; max: number; step: number;
    value: number; onChange: (v: number) => void; display: string;
}) => (
    <div className="mb-1.5">
        <div className="flex justify-between text-[13px] mb-1 text-white/95">
            <span>{label}</span>
            <span className="tabular-nums text-white">{display}</span>
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

/**
 * Configuration sub-panel for a single selected junction object.
 * Shows exit controls, lane counts, spawn rates, and a delete button.
 * @param objId - ID of the junction object to configure
 * @returns the rendered configuration panel for one junction object
 */
const ObjectConfig = ({ objId }: { objId: string }) => {
    const {
        junction, setJunction, removeObject,
        simIsRunning, isConfigConfirmed, simConfig,
    } = useJModellerContext();

    const obj = junction.junctionObjects.find(o => o.id === objId);
    if (!obj) return null;

    // handlers
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

    // render
    return (
        <fieldset disabled={simIsRunning} className="border-none p-0 m-0">
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
                <div>
                    <div className="text-[12px] tracking-[0.15em] text-white/92 uppercase mb-0.5">
                        {obj.type}
                    </div>
                    <div className="text-[18px] font-bold text-white/95 tracking-wider">
                        {obj.name}
                    </div>
                </div>
                {!isConfigConfirmed && !simIsRunning && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeObject(obj.id)}
                        className="gap-1 text-xs border-red-500/20 text-red-400/70 bg-red-500/[0.07] hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/40"
                    >
                        <Trash2 size={13} /> Delete
                    </Button>
                )}
            </div>

            {/* Exits count (pre-confirm only) */}
            {!isConfigConfirmed && (
                <div className="mb-3.5">
                    <div className="text-[12px] tracking-[0.12em] text-white/92 uppercase mb-1.5">Exits</div>
                    <div className="flex items-center gap-2.5">
                        <Slider
                            data-slider="numExits"
                            min={2}
                            max={obj.type === "roundabout" ? 6 : 10}
                            value={[obj.config.numExits]}
                            onValueChange={([v]) => handleNumExits(v)}
                            className="flex-1"
                        />
                        <span className="text-[14px] text-white/95 tabular-nums min-w-[16px] text-right">
                            {obj.config.numExits}
                        </span>
                    </div>
                </div>
            )}

            {/* All-connected warning */}

            {/* Per-exit config */}
            {obj.config.exitConfig.map((exit, j) => (
                <ExitRow
                    key={j}
                    j={j}
                    exit={exit}
                    obj={obj}
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

/**
 * Collapsible row displaying and editing the config for a single exit arm.
 * @param j - zero-based exit index
 * @param exit - current exit configuration
 * @param obj - the parent junction object
 * @param globalSpawnRate - fallback spawn rate used when no per-exit override is set
 * @param onLaneCount - callback to change lane count
 * @param onExitLength - callback to change exit length
 * @param onNumLanesIn - callback to change inbound lane count
 * @param onSpawnRate - callback to set a per-exit spawn rate override
 * @param onClearSpawnRate - callback to remove the per-exit override
 * @returns the rendered exit configuration row
 */
const ExitRow = ({ j, exit, obj, globalSpawnRate, onLaneCount, onExitLength, onNumLanesIn, onSpawnRate, onClearSpawnRate }: {
    j: number;
    exit: ExitConfig;
    obj: ReturnType<typeof useJModellerContext>["junction"]["junctionObjects"][number];
    globalSpawnRate: number;
    onLaneCount: (v: number) => void;
    onExitLength: (v: number) => void;
    onNumLanesIn: (v: number) => void;
    onSpawnRate: (v: number) => void;
    onClearSpawnRate: () => void;
}) => {
    const [open, setOpen] = useState(true);
    return (
        <div className="mb-1.5 border border-white/[0.08] rounded overflow-hidden">
            {/* exit header */}
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center justify-between w-full px-2.5 py-[7px] bg-white/[0.04] border-none cursor-pointer font-mono text-white/88 hover:bg-white/[0.07] transition-colors"
            >
                <span className="text-[13px] tracking-[0.08em]">
                    Exit {j + 1}
                </span>
                <ChevronDown
                    size={14}
                    className={cn("opacity-55 transition-transform duration-150", !open && "-rotate-90")}
                />
            </button>

            {open && (
                <div className="px-2.5 pb-2 pt-2.5">
                    <SliderRow label="Lanes" min={2} max={obj.config.numExits * 2} step={1} value={exit.laneCount} onChange={onLaneCount} display={String(exit.laneCount)} />
                    <SliderRow label="Length" min={obj.type === "roundabout" ? 20 : 10} max={70} step={1} value={exit.exitLength} onChange={onExitLength} display={String(exit.exitLength)} />
                    <SliderRow label="Lanes in" min={1} max={exit.laneCount - 1} step={1} value={exit.numLanesIn} onChange={onNumLanesIn} display={String(exit.numLanesIn)} />
                    <SliderRow
                        label="Spawn Rate (veh/s)"
                        min={0} max={4} step={0.01}
                        value={exit.spawnRate ?? globalSpawnRate}
                        onChange={onSpawnRate}
                        display={exit.spawnRate != null ? exit.spawnRate.toFixed(2) : `${globalSpawnRate.toFixed(2)} (global)`}
                    />
                    {exit.spawnRate != null && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onClearSpawnRate}
                            className="text-[11px] h-auto py-1 px-2 bg-white/[0.04] border-white/[0.08] text-white/75 hover:bg-white/[0.08] hover:text-white"
                        >
                            Reset to global
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Side panel listing configuration controls for every selected junction object.
 * @returns the rendered side panel
 */
const SelectionPanel = () => {
    const {
        selectedObjects, junction, setJunction, setSelectedObjects,
        isConfigConfirmed, simIsRunning,
    } = useJModellerContext();
    const { isHost, connections } = usePeer();
    const isClientConnected = !isHost && connections.length > 0;
    const [collapsed, setCollapsed] = useState(false);
    const isOpen = selectedObjects.length > 0;

    // Expand the panel whenever a new selection is made
    useEffect(() => {
        if (isOpen) setCollapsed(false);
    }, [isOpen]);

    const objId = selectedObjects[0];

    return (
        <div
            className="fixed left-0 flex flex-col overflow-hidden bg-zinc-950/97 border-r border-white/[0.08] font-mono text-white/95 backdrop-blur-xl shadow-[8px_0_32px_rgba(0,0,0,0.5)]"
            style={{
                top: HEADER_HEIGHT,
                bottom: 0,
                width: "25vw",
                zIndex: 45,
                transform: isOpen ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                pointerEvents: isOpen ? "auto" : "none",
            }}
        >
            {/* ── title bar ── */}
            <div className="flex items-center justify-between px-6 py-1.5 border-b border-white/[0.08] flex-shrink-0">
                <span className="text-[12px] tracking-[0.18em] text-white/75 uppercase">
                    Selection
                </span>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-white/75 hover:text-white hover:bg-white/[0.07]"
                        onClick={() => setCollapsed(c => !c)}
                        title={collapsed ? "Expand" : "Collapse"}
                    >
                        <ChevronDown
                            size={16}
                            className={cn("transition-transform duration-150", collapsed && "-rotate-90")}
                        />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-white/75 hover:text-white hover:bg-white/[0.07]"
                        onClick={() => setSelectedObjects([])}
                        title="Deselect (Esc)"
                        data-action="deselect"
                    >
                        <X size={16} />
                    </Button>
                </div>
            </div>

            {!collapsed && objId && (
                <div className="overflow-y-auto flex-1 px-6 py-3.5">
                    <ObjectConfig key={objId} objId={objId} />
                </div>
            )}
        </div>
    );
}

export default SelectionPanel;
