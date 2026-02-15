import { Billboard, Html } from "@react-three/drei";
import { SimulationStats } from "../includes/types/simulation";
import * as THREE from "three";
import { useJModellerContext } from "../context/JModellerContext";
import { getStructureData } from "../includes/utils";


type JunctionStatsLabelsProps = {
    junctionGroups: THREE.Group[];
    stats: SimulationStats;
    positionsCache: Map<string, THREE.Vector3>;
};

export const JunctionStatsLabels = ({ junctionGroups, stats, positionsCache}: JunctionStatsLabelsProps) => {
    
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
                const js = stats.junctions.byId?.[structureData.id];
                if (!js) {
                    return null;
                }

                let pos = positionsCache.get(structureData.id);
                if (!pos) {
                    pos = new THREE.Vector3();
                    group.getWorldPosition(pos);
                    pos.y += 10; // tweak height
                    positionsCache.set(structureData.id, pos);
                }
                const junctionObject = junction.junctionObjects.find(obj => obj.id === structureData.id);
                return (
                    <group key={structureData.id} position={pos}>
                        <Billboard follow lockX={false} lockY={false} lockZ={false}>
                            <Html center sprite distanceFactor={12} transform>
                                <div
                                    style={{
                                        background: "rgba(0,0,0,0.65)",
                                        color: "white",
                                        padding: "6px 8px",
                                        borderRadius: 8,
                                        fontSize: 12,
                                        lineHeight: 1.2,
                                        whiteSpace: "nowrap",
                                        fontFamily: "system-ui, sans-serif"
                                    }}
                                >
                                    <div style={{ fontWeight: 700 }}>
                                        {js.type === "roundabout" ? "Roundabout" : "Intersection"} {junctionObject?.name}
                                    </div>
                                    <div>Approaching:{js.approaching} W:{js.waiting} I:{js.inside} X:{js.exiting}</div>
                                    <div>in:{js.entered} out:{js.exited}</div>
                                    <div>Avg Wait: {js.avgWaitTime.toFixed(1)}s</div>
                                    {js.state && <div>sig:{js.state}</div>}
                                </div>
                            </Html>
                        </Billboard>
                    </group>
                );
            })}
        </>
    );
}