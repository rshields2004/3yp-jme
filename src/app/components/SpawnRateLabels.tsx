import { Billboard, Html } from "@react-three/drei";
import { Route, SimConfig, SimulationStats } from "../includes/types/simulation";
import * as THREE from "three";
import { useJModellerContext } from "../context/JModellerContext";
import { IntersectionConfig, IntersectionStructure } from "../includes/types/intersection";
import { RoundaboutStructure } from "../includes/types/roundabout";
import { getStructureData } from "../includes/utils";

type SpawnRateLabelsProps = {
    junctionGroups: THREE.Group[];
    stats: SimulationStats;
    positionsCache: Map<string, THREE.Vector3>;
    routes: Route[];
    simConfig: SimConfig;
};

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
                        console.log("Spawn label position", pos);
                        return (
                            <group key={entryKey} position={pos}>
                                <Billboard follow lockX={false} lockY={false} lockZ={false}>
                                    <Html center sprite distanceFactor={10} transform>
                                        <div
                                            style={{
                                                background: "rgba(0, 0, 0, 0.75)",
                                                color: "white",
                                                padding: "4px 6px",
                                                borderRadius: 6,
                                                fontSize: 11,
                                                lineHeight: 1.2,
                                                whiteSpace: "nowrap",
                                                fontFamily: "system-ui, sans-serif",
                                                border: "1px solid rgba(0, 0, 0, 0.5)"
                                            }}
                                        >
                                            <div style={{ fontWeight: 600 }}>
                                                {structureData.id.slice(0, 6)} Ex{exitIndex}
                                            </div>
                                            <div>{spawnRate.toFixed(1)} veh/s</div>
                                            <div style={{ fontSize: 10, opacity: 0.9 }}>Queue: {queuedVehicles}</div>
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