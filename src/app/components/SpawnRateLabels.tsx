/**
 * SpawnRateLabels.tsx
 *
 * Renders floating labels above each exit showing the effective
 * spawn rate when the simulation configuration panel is open.
 */

import { Billboard, Html } from "@react-three/drei";
import { Route, SimConfig, SimulationStats } from "../includes/types/simulation";
import * as THREE from "three";
import { useJModellerContext } from "../context/JModellerContext";
import { IntersectionStructure } from "../includes/types/intersection";
import { RoundaboutStructure } from "../includes/types/roundabout";
import { getStructureData } from "../includes/utils";

type SpawnRateLabelsProps = {
    junctionGroups: THREE.Group[];
    stats: SimulationStats;
    positionsCache: Map<string, THREE.Vector3>;
    routes: Route[];
    simConfig: SimConfig;
};

/**
 * Floating HTML labels at each spawn point showing the current spawn rate and demand.
 *
 * @param junctionGroups - array of junction Three.js groups
 * @param stats - aggregated simulation statistics
 * @param positionsCache - cached world positions for exit labels
 * @param routes - array of computed routes
 * @param simConfig - the simulation configuration
 * @returns the rendered floating spawn-rate labels
 */
export const SpawnRateLabels = ({ junctionGroups, stats, positionsCache, routes, simConfig }: SpawnRateLabelsProps) => {
    const isSpawnPoint = (structureID: string, exitIndex: number): boolean => {
        if (!routes || routes.length === 0) return true;
        return routes.some(route => {
            const firstSeg = route.segments?.[0];
            return firstSeg?.from?.structureID === structureID && firstSeg?.from?.exitIndex === exitIndex;
        });
    };

    const { junction } = useJModellerContext();

    return (
        <>
            {junctionGroups.filter((group) => {
                const structureData = getStructureData(group);
                return structureData && structureData.type !== "link";
            }).map((group) => {
                    const structureData = getStructureData(group);
                    if (!structureData) {
                        return null;
                    }
                    
                    let exitInfo;

                    if (structureData.type === "intersection") {
                        const info = group.userData.intersectionStructure as IntersectionStructure;
                        exitInfo = info.exitInfo;
                    }
                    else if (structureData.type === "roundabout") {
                        const info = group.userData.roundaboutStructure as RoundaboutStructure;
                        exitInfo = info.exitStructures;
                    }
                    else {
                        return null;
                    }
                    
                    const exitConfig = junction.junctionObjects.find(cfg => cfg.id === structureData.id)?.config.exitConfig;
                    if (!exitConfig || !exitInfo) return [];

                    return exitConfig.map((config, exitIndex) => {
                        const spawnRate = config.spawnRate ?? simConfig.spawning.spawnRate;
                        if (spawnRate === 0 || !isSpawnPoint(structureData.id, exitIndex)) {
                            return null;
                        }

                        const entryKey = `${structureData.id}-${exitIndex}`;
                        group.updateWorldMatrix(true, true);
                        const pos = new THREE.Vector3();

                        const exit = exitInfo[exitIndex];
                        const labelPos = exit.laneLines[0].line.end.clone().add(exit.laneLines[exit.laneLines.length - 1].line.end.clone()).multiplyScalar(0.5);
                        pos.copy(labelPos);

                        group.localToWorld(pos);
                        pos.y += 3;
                        positionsCache.set(entryKey, pos);

                        const queuedVehicles = stats.spawnQueueByEntry?.[entryKey] ?? 0;
                        return (
                            <group key={entryKey} position={pos}>
                                <Billboard follow lockX={false} lockY={false} lockZ={false}>
                                    <Html center sprite distanceFactor={10} transform>
                                        <div
                                            style={{
                                                background: "rgba(9,9,11,0.93)",
                                                border: "1px solid rgba(161,161,170,0.15)",
                                                borderRadius: 7,
                                                padding: "6px 10px",
                                                fontFamily: "var(--font-mono), 'Courier New', monospace",
                                                whiteSpace: "nowrap",
                                                boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
                                                backdropFilter: "blur(8px)",
                                                minWidth: 110,
                                            }}
                                        >
                                            <div style={{
                                                fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                                                color: "rgba(255,255,255,0.9)", textTransform: "uppercase",
                                                marginBottom: 5, paddingBottom: 4,
                                                borderBottom: "1px solid rgba(161,161,170,0.12)",
                                            }}>
                                                {(() => {
                                                    const obj = junction.junctionObjects.find(o => o.id === structureData.id);
                                                    return obj ? `${obj.type} ${obj.name}` : structureData.id.slice(0, 8);
                                                })()} - Exit {exitIndex + 1}
                                            </div>
                                            <div style={{
                                                display: "flex", justifyContent: "space-between",
                                                gap: 12, fontSize: 11, padding: "2px 0",
                                                borderBottom: "1px solid rgba(161,161,170,0.07)",
                                            }}>
                                                <span style={{ color: "rgba(225,225,230,0.85)" }}>Spawn</span>
                                                <span style={{ color: "rgba(255,255,255,0.95)", fontVariantNumeric: "tabular-nums" }}>{spawnRate.toFixed(2)} v/s</span>
                                            </div>
                                            <div style={{
                                                display: "flex", justifyContent: "space-between",
                                                gap: 12, fontSize: 11, paddingTop: 2,
                                            }}>
                                                <span style={{ color: "rgba(225,225,230,0.85)" }}>Queue</span>
                                                <span style={{ color: queuedVehicles > 0 ? "rgba(255,255,255,0.95)" : "rgba(225,225,230,0.5)", fontVariantNumeric: "tabular-nums" }}>{queuedVehicles}</span>
                                            </div>
                                        </div>
                                    </Html>
                                </Billboard>
                            </group>
                        );
                    }).filter(Boolean);
                })}
        </>
    );
}